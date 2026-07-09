import { Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashSecret, verifySecret } from "@/lib/password";
import { toPrismaJson } from "@/lib/services/json";
import { generatePublicId } from "@/lib/services/ids";
import { generateHashedAccessCode, type AccessCodeGenerator } from "./access-codes";
import { credentialCsv, oneTimeCredentialWarning, type OneTimeCredential } from "./credentials";
import { StudentAccountServiceError } from "./errors";
import {
  displayNameValidationError,
  normalizeUserId,
  parseDisplayName,
  parseStudentEmail,
  parseStudentPassword,
  parseUserId,
  studentEmailValidationError,
  userIdValidationError
} from "./validation";

const pageSizeMax = 100;

const createStudentSchema = z.object({
  user_id: z.unknown(),
  display_name: z.unknown().optional().nullable(),
  email: z.unknown().optional().nullable(),
  temporary_password: z.unknown().optional().nullable(),
  generate_password: z.boolean().optional()
}).strict();

const updateStudentSchema = z.object({
  display_name: z.unknown().optional().nullable(),
  email: z.unknown().optional().nullable()
}).strict();

const changePasswordSchema = z.object({
  current_password: z.string().optional(),
  new_password: z.unknown(),
  confirm_new_password: z.unknown()
}).strict();

const rosterPreviewSchema = z.object({
  csv_text: z.string().min(1, "CSV text is required."),
  source_file_name: z.string().trim().max(255).optional()
}).strict();

const rosterCommitSchema = z.object({
  apply_display_name_updates: z.boolean().default(false)
}).strict();

export const studentListQuerySchema = z.object({
  search: z.string().trim().optional(),
  account_status: z.enum(["active", "inactive"]).optional(),
  has_sessions: z.coerce.boolean().optional(),
  sort: z.enum(["user_id", "created_at", "updated_at", "last_login_at", "password_changed_at"]).default("user_id"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(pageSizeMax).default(25)
});

type RosterRowStatus =
  | "new_student"
  | "existing_unchanged"
  | "display_name_change"
  | "invalid"
  | "duplicate_file_row"
  | "role_conflict";

type RosterNormalizedRow = {
  source_row_number: number;
  user_id: string;
  user_id_normalized: string;
  display_name: string | null;
  email: string | null;
  existing_display_name?: string | null;
  existing_email?: string | null;
  row_status: RosterRowStatus;
  validation_errors: Array<{ code: string; message: string; column?: string }>;
};

function serializeDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function publicRosterRow(row: RosterNormalizedRow) {
  return {
    source_row_number: row.source_row_number,
    user_id: row.user_id,
    display_name: row.display_name,
    email: row.email,
    existing_display_name: row.existing_display_name ?? null,
    existing_email: row.existing_email ?? null,
    row_status: row.row_status,
    validation_errors: row.validation_errors
  };
}

function summarizeRosterRows(rows: RosterNormalizedRow[]) {
  return {
    total_rows: rows.length,
    new_student_rows: rows.filter((row) => row.row_status === "new_student").length,
    existing_unchanged_rows: rows.filter((row) => row.row_status === "existing_unchanged").length,
    display_name_change_rows: rows.filter((row) => row.row_status === "display_name_change").length,
    invalid_rows: rows.filter((row) => row.row_status === "invalid").length,
    duplicate_rows: rows.filter((row) => row.row_status === "duplicate_file_row").length,
    role_conflict_rows: rows.filter((row) => row.row_status === "role_conflict").length
  };
}

function csvRecords(csvText: string): Array<{ record: Record<string, string>; rowNumber: number }> {
  try {
    const parsed = parse(csvText, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: false,
      info: true
    }) as Array<{ record: Record<string, string>; info: { lines: number } }>;

    return parsed
      .filter((entry) =>
        Object.values(entry.record).some((value) => String(value ?? "").trim().length > 0)
      )
      .map((entry) => ({ record: entry.record, rowNumber: entry.info.lines }));
  } catch (error) {
    throw new StudentAccountServiceError(
      "csv_parse_failed",
      "Roster CSV could not be parsed.",
      400,
      { message: error instanceof Error ? error.message : String(error) }
    );
  }
}

function rosterRowsFromBatch(value: unknown): RosterNormalizedRow[] {
  if (!Array.isArray(value)) {
    throw new StudentAccountServiceError(
      "invalid_batch_state",
      "Roster batch does not contain normalized preview rows.",
      409
    );
  }

  return value as RosterNormalizedRow[];
}

async function createAccountEvent(
  tx: Prisma.TransactionClient,
  input: {
    student_user_db_id: string;
    performed_by_user_db_id: string;
    event_type:
      | "student_created_manually"
      | "student_created_by_roster"
      | "display_name_updated"
      | "access_code_reset"
      | "student_deactivated"
      | "student_reactivated"
      | "teacher_student_account_created"
      | "teacher_student_password_reset"
      | "teacher_student_deactivated"
      | "teacher_student_reactivated"
      | "student_password_changed";
    roster_import_batch_db_id?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await tx.studentAccountEvent.create({
    data: {
      id: crypto.randomUUID(),
      event_public_id: generatePublicId("student_account_event"),
      student_user_db_id: input.student_user_db_id,
      performed_by_user_db_id: input.performed_by_user_db_id,
      event_type: input.event_type,
      roster_import_batch_db_id: input.roster_import_batch_db_id ?? null,
      metadata: toPrismaJson(input.metadata ?? {}) ?? {}
    }
  });
}

function serializeCredentialResult(credentials: OneTimeCredential[]) {
  return {
    one_time_credentials: credentials,
    credential_csv: credentialCsv(credentials),
    credential_warning: oneTimeCredentialWarning
  };
}

function credentialRecord(input: {
  user_id: string;
  display_name: string | null;
  email?: string | null;
  temporary_password: string;
}): OneTimeCredential {
  return {
    user_id: input.user_id,
    display_name: input.display_name,
    email: input.email ?? null,
    temporary_access_code: input.temporary_password,
    temporary_password: input.temporary_password
  };
}

async function buildTemporaryCredential(input: {
  user_id: string;
  temporary_password?: unknown;
  generate_password?: boolean;
  accessCodeGenerator?: AccessCodeGenerator;
}) {
  if (input.temporary_password !== undefined && input.temporary_password !== null) {
    const temporaryPassword = parseStudentPassword(input.temporary_password, input.user_id);

    return {
      temporary_password: temporaryPassword,
      temporary_password_hash: await hashSecret(temporaryPassword)
    };
  }

  if (input.generate_password === false) {
    throw new StudentAccountServiceError(
      "temporary_password_required",
      "A temporary password is required when password generation is disabled.",
      400
    );
  }

  const credential = await generateHashedAccessCode(input.accessCodeGenerator);

  return {
    temporary_password: credential.access_code,
    temporary_password_hash: credential.access_code_hash
  };
}

async function findStudentByUserIdOrThrow(userId: string) {
  const normalized = normalizeUserId(userId);
  const user = await prisma.user.findUnique({
    where: { user_id_normalized: normalized },
    include: {
      assessment_sessions: {
        orderBy: { started_at: "desc" },
        take: 25,
        select: {
          session_public_id: true,
          status: true,
          current_phase: true,
          attempt_number: true,
          started_at: true,
          last_activity_at: true,
          completed_at: true,
          assessment: {
            select: {
              assessment_public_id: true,
              title: true
            }
          }
        }
      },
      summative_outcomes: {
        where: { record_status: "active" },
        orderBy: [{ outcome_name: "asc" }, { assessment_date: "desc" }],
        select: {
          outcome_public_id: true,
          outcome_name: true,
          outcome_score: true,
          max_score: true,
          assessment_date: true,
          notes: true
        }
      },
      student_account_events: {
        orderBy: { created_at: "desc" },
        take: 50,
        select: {
          event_public_id: true,
          event_type: true,
          metadata: true,
          created_at: true,
          performed_by: {
            select: { user_id: true }
          },
          roster_import_batch: {
            select: { batch_public_id: true, source_file_name: true }
          }
        }
      }
    }
  });

  if (!user || user.role !== "student") {
    throw new StudentAccountServiceError("not_found", "Student account was not found.", 404);
  }

  return user;
}

function serializeStudentDetail(user: Awaited<ReturnType<typeof findStudentByUserIdOrThrow>>) {
  return {
    student: {
      user_id: user.user_id,
      display_name: user.display_name,
      email: user.email,
      account_status: user.account_status,
      must_change_password: user.must_change_password,
      created_at: serializeDate(user.created_at),
      updated_at: serializeDate(user.updated_at),
      last_login_at: serializeDate(user.last_login_at),
      deactivated_at: serializeDate(user.deactivated_at),
      credential_updated_at: serializeDate(user.credential_updated_at),
      credential_reset_at: serializeDate(user.credential_reset_at),
      password_changed_at: serializeDate(user.password_changed_at),
      assessment_sessions: user.assessment_sessions.map((session) => ({
        session_public_id: session.session_public_id,
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_title: session.assessment.title,
        attempt_number: session.attempt_number,
        status: session.status,
        current_phase: session.current_phase,
        started_at: serializeDate(session.started_at),
        last_activity_at: serializeDate(session.last_activity_at),
        completed_at: serializeDate(session.completed_at)
      })),
      summative_outcomes: user.summative_outcomes.map((outcome) => ({
        outcome_public_id: outcome.outcome_public_id,
        outcome_name: outcome.outcome_name,
        outcome_score: String(outcome.outcome_score),
        max_score: String(outcome.max_score),
        assessment_date: outcome.assessment_date.toISOString().slice(0, 10),
        notes: outcome.notes
      })),
      account_events: user.student_account_events.map((event) => ({
        event_public_id: event.event_public_id,
        event_type: event.event_type,
        metadata: event.metadata,
        created_at: serializeDate(event.created_at),
        performed_by_user_id: event.performed_by.user_id,
        roster_import_batch: event.roster_import_batch
          ? {
              batch_public_id: event.roster_import_batch.batch_public_id,
              source_file_name: event.roster_import_batch.source_file_name
            }
          : null
      }))
    }
  };
}

export async function listStudents(input: z.input<typeof studentListQuerySchema>) {
  const query = studentListQuerySchema.parse(input);
  const normalizedSearch = query.search ? normalizeUserId(query.search) : "";
  const where: Prisma.UserWhereInput = {
    role: "student",
    ...(query.account_status ? { account_status: query.account_status } : {}),
    ...(query.has_sessions === true ? { assessment_sessions: { some: {} } } : {}),
    ...(query.has_sessions === false ? { assessment_sessions: { none: {} } } : {}),
    ...(normalizedSearch
      ? {
          OR: [
            { user_id_normalized: { contains: normalizedSearch } },
            { display_name: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const take = query.page_size;
  const skip = (query.page - 1) * take;
  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { [query.sort]: query.direction },
      skip,
      take,
      include: {
        assessment_sessions: {
          select: { status: true }
        },
        _count: {
          select: {
            summative_outcomes: true
          }
        }
      }
    }),
    prisma.user.count({ where })
  ]);

  return {
    students: students.map((student) => {
      const activeSessionCount = student.assessment_sessions.filter(
        (session) => session.status === "active" || session.status === "paused"
      ).length;
      const completedSessionCount = student.assessment_sessions.filter(
        (session) => session.status === "completed"
      ).length;

      return {
        user_id: student.user_id,
        display_name: student.display_name,
        email: student.email,
        account_status: student.account_status,
        must_change_password: student.must_change_password,
        created_at: serializeDate(student.created_at),
        updated_at: serializeDate(student.updated_at),
        last_login_at: serializeDate(student.last_login_at),
        deactivated_at: serializeDate(student.deactivated_at),
        credential_reset_at: serializeDate(student.credential_reset_at),
        password_changed_at: serializeDate(student.password_changed_at),
        assessment_session_count: student.assessment_sessions.length,
        completed_session_count: completedSessionCount,
        active_session_count: activeSessionCount,
        summative_outcome_count: student._count.summative_outcomes
      };
    }),
    pagination: {
      page: query.page,
      page_size: take,
      total,
      total_pages: Math.max(1, Math.ceil(total / take))
    }
  };
}

export async function getStudentDetail(userId: string) {
  return serializeStudentDetail(await findStudentByUserIdOrThrow(userId));
}

export async function createStudentAccount(input: {
  teacher_user_db_id: string;
  data: z.input<typeof createStudentSchema>;
  accessCodeGenerator?: AccessCodeGenerator;
}) {
  const parsed = createStudentSchema.parse(input.data);
  const userId = parseUserId(parsed.user_id);
  const userIdNormalized = normalizeUserId(userId);
  const displayName = parseDisplayName(parsed.display_name);
  const email = parseStudentEmail(parsed.email);
  const existing = await prisma.user.findUnique({
    where: { user_id_normalized: userIdNormalized },
    select: { role: true }
  });

  if (existing) {
    throw new StudentAccountServiceError(
      existing.role === "student" ? "student_already_exists" : "user_id_role_conflict",
      existing.role === "student"
        ? "A student account already exists for this user_id."
        : "This user_id belongs to a teacher_researcher account.",
      409
    );
  }

  const credential = await buildTemporaryCredential({
    user_id: userId,
    temporary_password: parsed.temporary_password,
    generate_password: parsed.generate_password,
    accessCodeGenerator: input.accessCodeGenerator
  });
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id: crypto.randomUUID(),
        user_id: userId,
        user_id_normalized: userIdNormalized,
        display_name: displayName,
        email,
        role: "student",
        access_code_hash: credential.temporary_password_hash,
        password_hash: null,
        account_status: "active",
        auth_version: 1,
        must_change_password: true,
        credential_updated_at: now,
        credential_reset_at: now,
        created_by_teacher_user_id: input.teacher_user_db_id
      }
    });
    await createAccountEvent(tx, {
      student_user_db_id: created.id,
      performed_by_user_db_id: input.teacher_user_db_id,
      event_type: "teacher_student_account_created",
      metadata: {
        user_id: created.user_id,
        display_name: created.display_name,
        email_present: Boolean(created.email),
        temporary_credential_generated: parsed.temporary_password === undefined || parsed.temporary_password === null
      }
    });
    return created;
  });

  return {
    student: {
      user_id: user.user_id,
      display_name: user.display_name,
      email: user.email,
      account_status: user.account_status,
      must_change_password: user.must_change_password,
      created_at: serializeDate(user.created_at)
    },
    ...serializeCredentialResult([
      credentialRecord({
        user_id: user.user_id,
        display_name: user.display_name,
        email: user.email,
        temporary_password: credential.temporary_password
      })
    ])
  };
}

export async function updateStudentAccount(input: {
  teacher_user_db_id: string;
  user_id: string;
  data: z.input<typeof updateStudentSchema>;
}) {
  const parsed = updateStudentSchema.parse(input.data);
  const nextDisplayName =
    Object.prototype.hasOwnProperty.call(parsed, "display_name")
      ? parseDisplayName(parsed.display_name)
      : undefined;
  const nextEmail =
    Object.prototype.hasOwnProperty.call(parsed, "email")
      ? parseStudentEmail(parsed.email)
      : undefined;
  const student = await findStudentByUserIdOrThrow(input.user_id);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: student.id },
      data: {
        ...(nextDisplayName !== undefined ? { display_name: nextDisplayName } : {}),
        ...(nextEmail !== undefined ? { email: nextEmail } : {})
      }
    });

    if (nextDisplayName !== undefined && (student.display_name ?? null) !== nextDisplayName) {
      await createAccountEvent(tx, {
        student_user_db_id: student.id,
        performed_by_user_db_id: input.teacher_user_db_id,
        event_type: "display_name_updated",
        metadata: {
          previous_display_name: student.display_name,
          new_display_name: nextDisplayName
        }
      });
    }

    return result;
  });

  return {
    student: {
      user_id: updated.user_id,
      display_name: updated.display_name,
      email: updated.email,
      account_status: updated.account_status,
      must_change_password: updated.must_change_password,
      updated_at: serializeDate(updated.updated_at)
    }
  };
}

export async function resetStudentPassword(input: {
  teacher_user_db_id: string;
  user_id: string;
  temporary_password?: unknown;
  generate_password?: boolean;
  accessCodeGenerator?: AccessCodeGenerator;
}) {
  const student = await findStudentByUserIdOrThrow(input.user_id);
  const credential = await buildTemporaryCredential({
    user_id: student.user_id,
    temporary_password: input.temporary_password,
    generate_password: input.generate_password,
    accessCodeGenerator: input.accessCodeGenerator
  });
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: student.id },
      data: {
        access_code_hash: credential.temporary_password_hash,
        password_hash: null,
        must_change_password: true,
        auth_version: { increment: 1 },
        credential_updated_at: now,
        credential_reset_at: now
      }
    });
    await createAccountEvent(tx, {
      student_user_db_id: student.id,
      performed_by_user_db_id: input.teacher_user_db_id,
      event_type: "teacher_student_password_reset",
      metadata: {
        user_id: student.user_id,
        temporary_credential_generated: input.temporary_password === undefined || input.temporary_password === null
      }
    });
    return result;
  });

  return {
    student: {
      user_id: updated.user_id,
      display_name: updated.display_name,
      email: updated.email,
      account_status: updated.account_status,
      must_change_password: updated.must_change_password,
      credential_updated_at: serializeDate(updated.credential_updated_at),
      credential_reset_at: serializeDate(updated.credential_reset_at)
    },
    ...serializeCredentialResult([
      credentialRecord({
        user_id: updated.user_id,
        display_name: updated.display_name,
        email: updated.email,
        temporary_password: credential.temporary_password
      })
    ])
  };
}

export async function resetStudentAccessCode(input: {
  teacher_user_db_id: string;
  user_id: string;
  accessCodeGenerator?: AccessCodeGenerator;
}) {
  return resetStudentPassword(input);
}

export async function setStudentAccountStatus(input: {
  teacher_user_db_id: string;
  user_id: string;
  account_status: "active" | "inactive";
}) {
  const student = await findStudentByUserIdOrThrow(input.user_id);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: student.id },
      data: {
        account_status: input.account_status,
        deactivated_at: input.account_status === "inactive" ? now : null,
        auth_version: { increment: 1 }
      }
    });
    await createAccountEvent(tx, {
      student_user_db_id: student.id,
      performed_by_user_db_id: input.teacher_user_db_id,
      event_type:
        input.account_status === "inactive"
          ? "teacher_student_deactivated"
          : "teacher_student_reactivated",
      metadata: { user_id: student.user_id }
    });
    return result;
  });

  return {
    student: {
      user_id: updated.user_id,
      display_name: updated.display_name,
      email: updated.email,
      account_status: updated.account_status,
      must_change_password: updated.must_change_password,
      deactivated_at: serializeDate(updated.deactivated_at),
      updated_at: serializeDate(updated.updated_at)
    }
  };
}

export async function changeStudentPassword(input: {
  student_user_db_id: string;
  data: z.input<typeof changePasswordSchema>;
}) {
  const parsed = changePasswordSchema.parse(input.data);
  const student = await prisma.user.findUnique({
    where: { id: input.student_user_db_id },
    select: {
      id: true,
      user_id: true,
      role: true,
      account_status: true,
      password_hash: true,
      access_code_hash: true,
      must_change_password: true
    }
  });

  if (!student || student.role !== "student" || student.account_status !== "active") {
    throw new StudentAccountServiceError(
      "account_unavailable",
      "This account is currently unavailable.",
      403
    );
  }

  const newPassword = parseStudentPassword(parsed.new_password, student.user_id);
  const confirmation = String(parsed.confirm_new_password ?? "");

  if (newPassword !== confirmation) {
    throw new StudentAccountServiceError(
      "password_confirmation_mismatch",
      "New password and confirmation do not match.",
      400
    );
  }

  if (!student.must_change_password) {
    if (!parsed.current_password) {
      throw new StudentAccountServiceError(
        "current_password_required",
        "Current password is required.",
        400
      );
    }

    const currentMatches =
      (await verifySecret(parsed.current_password, student.password_hash)) ||
      (await verifySecret(parsed.current_password, student.access_code_hash));

    if (!currentMatches) {
      throw new StudentAccountServiceError(
        "current_password_invalid",
        "Current password was not accepted.",
        403
      );
    }
  }

  const now = new Date();
  const passwordHash = await hashSecret(newPassword);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: student.id },
      data: {
        password_hash: passwordHash,
        access_code_hash: null,
        must_change_password: false,
        password_changed_at: now,
        credential_updated_at: now,
        auth_version: { increment: 1 }
      }
    });

    await createAccountEvent(tx, {
      student_user_db_id: student.id,
      performed_by_user_db_id: student.id,
      event_type: "student_password_changed",
      metadata: { user_id: student.user_id }
    });

    return result;
  });

  return {
    student: {
      user_id: updated.user_id,
      must_change_password: updated.must_change_password,
      password_changed_at: serializeDate(updated.password_changed_at)
    }
  };
}

export async function previewRosterImport(input: {
  teacher_user_db_id: string;
  data: z.input<typeof rosterPreviewSchema>;
}) {
  const parsed = rosterPreviewSchema.parse(input.data);
  const rows: RosterNormalizedRow[] = csvRecords(parsed.csv_text).map(({ record, rowNumber }) => {
    const rawUserId = record.user_id ?? "";
    const userIdError = userIdValidationError(rawUserId);
    const displayNameError = displayNameValidationError(record.display_name ?? "");
    const emailError = studentEmailValidationError(record.email ?? "");
    const userId = userIdError ? String(rawUserId ?? "").trim() : parseUserId(rawUserId);
    const displayName = displayNameError ? null : parseDisplayName(record.display_name ?? "");
    const email = emailError ? null : parseStudentEmail(record.email ?? "");
    const validationErrors: RosterNormalizedRow["validation_errors"] = [];

    if (!("user_id" in record)) {
      validationErrors.push({
        code: "missing_user_id_column",
        column: "user_id",
        message: "user_id column is required."
      });
    }

    if (userIdError) {
      validationErrors.push({ code: "invalid_user_id", column: "user_id", message: userIdError });
    }

    if (displayNameError) {
      validationErrors.push({
        code: "invalid_display_name",
        column: "display_name",
        message: displayNameError
      });
    }

    if (emailError) {
      validationErrors.push({
        code: "invalid_email",
        column: "email",
        message: emailError
      });
    }

    return {
      source_row_number: rowNumber,
      user_id: userId,
      user_id_normalized: userIdError ? "" : normalizeUserId(userId),
      display_name: displayName,
      email,
      row_status: validationErrors.length > 0 ? "invalid" : "new_student",
      validation_errors: validationErrors
    };
  });

  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.row_status === "invalid") {
      continue;
    }
    const first = seen.get(row.user_id_normalized);
    if (first !== undefined) {
      row.row_status = "duplicate_file_row";
      row.validation_errors.push({
        code: "duplicate_user_id",
        column: "user_id",
        message: `Duplicate normalized user_id. First seen at CSV row ${first}.`
      });
    } else {
      seen.set(row.user_id_normalized, row.source_row_number);
    }
  }

  const candidateIds = [...new Set(rows.map((row) => row.user_id_normalized).filter(Boolean))];
  const users = candidateIds.length
    ? await prisma.user.findMany({
        where: { user_id_normalized: { in: candidateIds } },
        select: { id: true, user_id: true, user_id_normalized: true, display_name: true, email: true, role: true }
      })
    : [];
  const usersByNormalizedId = new Map(users.map((user) => [user.user_id_normalized, user]));

  for (const row of rows) {
    if (row.row_status !== "new_student") {
      continue;
    }
    const existing = usersByNormalizedId.get(row.user_id_normalized);
    if (!existing) {
      continue;
    }
    row.existing_display_name = existing.display_name;
    row.existing_email = existing.email;
    if (existing.role !== "student") {
      row.row_status = "role_conflict";
      row.validation_errors.push({
        code: "teacher_account_conflict",
        column: "user_id",
        message: "This user_id belongs to a teacher_researcher account."
      });
      continue;
    }

    row.row_status =
      (existing.display_name ?? null) === (row.display_name ?? null) &&
      (existing.email ?? null) === (row.email ?? null)
        ? "existing_unchanged"
        : "display_name_change";
  }

  const summary = summarizeRosterRows(rows);
  const previewRows = rows.map((row) => publicRosterRow(row));
  const validationErrors = previewRows.flatMap((row) =>
    row.validation_errors.map((error) => ({
      source_row_number: row.source_row_number,
      user_id: row.user_id,
      ...error
    }))
  );

  const batch = await prisma.rosterImportBatch.create({
    data: {
      id: crypto.randomUUID(),
      batch_public_id: generatePublicId("roster_import_batch"),
      uploaded_by_user_db_id: input.teacher_user_db_id,
      source_file_name: parsed.source_file_name,
      status: "previewed",
      ...summary,
      committed_new_students: 0,
      committed_display_name_updates: 0,
      normalized_preview_payload: toPrismaJson(rows) ?? [],
      validation_summary: toPrismaJson({ ...summary, preview_rows: previewRows, validation_errors: validationErrors }) ?? {}
    }
  });

  return {
    batch_public_id: batch.batch_public_id,
    source_file_name: batch.source_file_name,
    ...summary,
    preview_rows: previewRows,
    validation_errors: validationErrors
  };
}

export async function commitRosterImport(input: {
  teacher_user_db_id: string;
  batch_public_id: string;
  data?: z.input<typeof rosterCommitSchema>;
  accessCodeGenerator?: AccessCodeGenerator;
}) {
  const commitOptions = rosterCommitSchema.parse(input.data ?? {});

  return prisma.$transaction(async (tx) => {
    const batch = await tx.rosterImportBatch.findUnique({
      where: { batch_public_id: input.batch_public_id }
    });

    if (!batch) {
      throw new StudentAccountServiceError("not_found", "Roster import batch was not found.", 404);
    }
    if (batch.uploaded_by_user_db_id !== input.teacher_user_db_id) {
      throw new StudentAccountServiceError(
        "forbidden",
        "This roster import batch belongs to another teacher_researcher account.",
        403
      );
    }
    if (batch.status === "committed") {
      return {
        batch_public_id: batch.batch_public_id,
        status: batch.status,
        committed_new_students: batch.committed_new_students,
        committed_display_name_updates: batch.committed_display_name_updates,
        already_committed: true,
        one_time_credentials: [],
        credential_csv: "",
        credential_warning: oneTimeCredentialWarning
      };
    }
    if (batch.status !== "previewed") {
      throw new StudentAccountServiceError(
        "invalid_batch_status",
        "Only previewed roster import batches can be committed.",
        409,
        { status: batch.status }
      );
    }

    const rows = rosterRowsFromBatch(batch.normalized_preview_payload);
    let committedNewStudents = 0;
    let committedDisplayNameUpdates = 0;
    const credentials: OneTimeCredential[] = [];

    for (const row of rows) {
      if (row.row_status === "new_student") {
        const existing = await tx.user.findUnique({
          where: { user_id_normalized: row.user_id_normalized },
          select: { id: true, role: true }
        });
        if (existing) {
          continue;
        }

        const credential = await generateHashedAccessCode(input.accessCodeGenerator);
        const created = await tx.user.create({
          data: {
            id: crypto.randomUUID(),
            user_id: row.user_id,
            user_id_normalized: row.user_id_normalized,
            display_name: row.display_name,
            email: row.email,
            role: "student",
            account_status: "active",
            auth_version: 1,
            must_change_password: true,
            password_hash: null,
            access_code_hash: credential.access_code_hash,
            credential_updated_at: new Date(),
            credential_reset_at: new Date(),
            created_by_teacher_user_id: input.teacher_user_db_id
          }
        });
        await createAccountEvent(tx, {
          student_user_db_id: created.id,
          performed_by_user_db_id: input.teacher_user_db_id,
          roster_import_batch_db_id: batch.id,
          event_type: "student_created_by_roster",
          metadata: {
            user_id: created.user_id,
            display_name: created.display_name,
            email_present: Boolean(created.email)
          }
        });
        credentials.push(credentialRecord({
          user_id: created.user_id,
          display_name: created.display_name,
          email: created.email,
          temporary_password: credential.access_code
        }));
        committedNewStudents += 1;
      }

      if (row.row_status === "display_name_change" && commitOptions.apply_display_name_updates) {
        const existing = await tx.user.findUnique({
          where: { user_id_normalized: row.user_id_normalized },
          select: { id: true, role: true, display_name: true, email: true }
        });
        if (!existing || existing.role !== "student") {
          continue;
        }
        await tx.user.update({
          where: { id: existing.id },
          data: { display_name: row.display_name, email: row.email }
        });
        await createAccountEvent(tx, {
          student_user_db_id: existing.id,
          performed_by_user_db_id: input.teacher_user_db_id,
          roster_import_batch_db_id: batch.id,
          event_type: "display_name_updated",
          metadata: {
            previous_display_name: existing.display_name,
            new_display_name: row.display_name,
            previous_email_present: Boolean(existing.email),
            new_email_present: Boolean(row.email)
          }
        });
        committedDisplayNameUpdates += 1;
      }
    }

    const updated = await tx.rosterImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "committed",
        committed_at: new Date(),
        committed_new_students: committedNewStudents,
        committed_display_name_updates: committedDisplayNameUpdates
      }
    });

    return {
      batch_public_id: updated.batch_public_id,
      status: updated.status,
      committed_new_students: updated.committed_new_students,
      committed_display_name_updates: updated.committed_display_name_updates,
      already_committed: false,
      ...serializeCredentialResult(credentials)
    };
  });
}

export async function listRosterImportBatches() {
  const batches = await prisma.rosterImportBatch.findMany({
    orderBy: { created_at: "desc" },
    take: 100,
    select: {
      batch_public_id: true,
      source_file_name: true,
      status: true,
      total_rows: true,
      new_student_rows: true,
      existing_unchanged_rows: true,
      display_name_change_rows: true,
      invalid_rows: true,
      duplicate_rows: true,
      role_conflict_rows: true,
      committed_new_students: true,
      committed_display_name_updates: true,
      created_at: true,
      committed_at: true
    }
  });

  return {
    import_batches: batches.map((batch) => ({
      ...batch,
      created_at: serializeDate(batch.created_at),
      committed_at: serializeDate(batch.committed_at)
    }))
  };
}

export async function getRosterImportBatch(batchPublicId: string) {
  const batch = await prisma.rosterImportBatch.findUnique({
    where: { batch_public_id: batchPublicId },
    select: {
      batch_public_id: true,
      source_file_name: true,
      status: true,
      total_rows: true,
      new_student_rows: true,
      existing_unchanged_rows: true,
      display_name_change_rows: true,
      invalid_rows: true,
      duplicate_rows: true,
      role_conflict_rows: true,
      committed_new_students: true,
      committed_display_name_updates: true,
      validation_summary: true,
      created_at: true,
      committed_at: true
    }
  });

  if (!batch) {
    throw new StudentAccountServiceError("not_found", "Roster import batch was not found.", 404);
  }

  return {
    import_batch: {
      ...batch,
      created_at: serializeDate(batch.created_at),
      committed_at: serializeDate(batch.committed_at)
    }
  };
}
