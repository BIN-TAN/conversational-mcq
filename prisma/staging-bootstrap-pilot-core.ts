import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient, type User } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { generatePublicId } from "../src/lib/services/ids";
import { generateHashedAccessCode } from "../src/lib/services/student-accounts/access-codes";
import { credentialCsv, oneTimeCredentialWarning, type OneTimeCredential } from "../src/lib/services/student-accounts/credentials";
import { normalizeUserId, parseDisplayName, parseUserId } from "../src/lib/services/student-accounts/validation";
import { maskEmail, normalizeTeacherEmail } from "../src/lib/services/account-security/email";
import {
  demoAssessmentPublicId,
  ensureFixedIrtMvpAssessment
} from "./demo-student-assessment-fixture";

export type BootstrapPilotConfig = {
  enabled: boolean;
  teacherUsername: string;
  teacherPassword: string;
  teacherEmail?: string;
  classroomId: string;
  classroomName: string;
  studentCount?: number;
  studentRosterPath?: string;
  defaultAssessmentId: string;
  outputDir: string;
};

export type BootstrapPilotStudentInput = {
  user_id: string;
  display_name: string | null;
};

export type BootstrapPilotSummary = {
  status: "completed";
  classroom: {
    classroom_id: string;
    classroom_name: string;
    persistence_model: "bootstrap_metadata_only";
  };
  teacher: {
    user_id: string;
    created: boolean;
    existing: boolean;
    recovery_email_configured: boolean;
    recovery_email_verified: boolean;
    masked_recovery_email: string | null;
  };
  students: {
    requested_count: number;
    created_count: number;
    existing_count: number;
    role_conflict_count: number;
    access_codes_printed: false;
    access_codes_output_path: string | null;
    credential_warning: string | null;
  };
  assessment: {
    assessment_public_id: string;
    title: string;
    status: string;
    workflow_mode: string;
    initial_item_count: number;
    transfer_item_count: number;
    availability_model: "published_assessment_visible_to_active_students";
  };
  no_openai_call_occurred: true;
  raw_secret_values_printed: false;
};

class BootstrapError extends Error {
  constructor(
    message: string,
    readonly safeDetails: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

function optionalTrimmed(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, name: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BootstrapError(`${name} must be true or false.`, {
    variable_name: name,
    expected_values: ["true", "false"],
    missing: value === undefined
  });
}

function parseStudentCount(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new BootstrapError("BOOTSTRAP_STUDENT_COUNT must be an integer from 1 to 200.", {
      variable_name: "BOOTSTRAP_STUDENT_COUNT",
      expected: "integer 1..200"
    });
  }
  return parsed;
}

function safeMissingConfig(names: string[]) {
  throw new BootstrapError("Missing required bootstrap configuration.", {
    missing_variable_names: names
  });
}

export function parseBootstrapPilotConfig(
  env: Record<string, string | undefined>,
  options?: { outputDir?: string }
): BootstrapPilotConfig {
  const enabledRaw = optionalTrimmed(env.BOOTSTRAP_ENABLED);
  const enabled = parseBoolean(enabledRaw, "BOOTSTRAP_ENABLED");
  const required = [
    "BOOTSTRAP_TEACHER_USERNAME",
    "BOOTSTRAP_TEACHER_PASSWORD",
    "BOOTSTRAP_CLASSROOM_ID",
    "BOOTSTRAP_CLASSROOM_NAME",
    "BOOTSTRAP_DEFAULT_ASSESSMENT_ID"
  ] as const;
  const missing = required.filter((name) => !optionalTrimmed(env[name]));
  const studentCount = parseStudentCount(optionalTrimmed(env.BOOTSTRAP_STUDENT_COUNT));
  const studentRosterPath = optionalTrimmed(env.BOOTSTRAP_STUDENT_ROSTER_PATH);

  if (missing.length > 0) {
    safeMissingConfig([...missing]);
  }

  if (!studentCount && !studentRosterPath) {
    safeMissingConfig(["BOOTSTRAP_STUDENT_COUNT or BOOTSTRAP_STUDENT_ROSTER_PATH"]);
  }

  if (studentCount && studentRosterPath) {
    throw new BootstrapError("Use either BOOTSTRAP_STUDENT_COUNT or BOOTSTRAP_STUDENT_ROSTER_PATH, not both.", {
      conflicting_variable_names: ["BOOTSTRAP_STUDENT_COUNT", "BOOTSTRAP_STUDENT_ROSTER_PATH"]
    });
  }

  return {
    enabled,
    teacherUsername: parseUserId(env.BOOTSTRAP_TEACHER_USERNAME),
    teacherPassword: env.BOOTSTRAP_TEACHER_PASSWORD ?? "",
    teacherEmail: optionalTrimmed(env.BOOTSTRAP_TEACHER_EMAIL),
    classroomId: parseUserId(env.BOOTSTRAP_CLASSROOM_ID),
    classroomName: parseDisplayName(env.BOOTSTRAP_CLASSROOM_NAME) ?? parseUserId(env.BOOTSTRAP_CLASSROOM_ID),
    studentCount,
    studentRosterPath,
    defaultAssessmentId: parseUserId(env.BOOTSTRAP_DEFAULT_ASSESSMENT_ID),
    outputDir: options?.outputDir ?? path.join(process.cwd(), ".data", "bootstrap")
  };
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function generatedStudentRoster(input: { classroomId: string; classroomName: string; count: number }): BootstrapPilotStudentInput[] {
  return Array.from({ length: input.count }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, "0");
    return {
      user_id: parseUserId(`${input.classroomId}_student_${ordinal}`),
      display_name: `${input.classroomName} Student ${ordinal}`
    };
  });
}

async function rosterFromCsv(filePath: string): Promise<BootstrapPilotStudentInput[]> {
  const csv = await readFile(filePath, "utf8");
  const rows = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: false
  }) as Array<Record<string, string>>;

  return rows
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim().length > 0))
    .map((row) => ({
      user_id: parseUserId(row.user_id),
      display_name: parseDisplayName(row.display_name)
    }));
}

async function studentInputs(config: BootstrapPilotConfig) {
  if (config.studentRosterPath) {
    return rosterFromCsv(config.studentRosterPath);
  }

  return generatedStudentRoster({
    classroomId: config.classroomId,
    classroomName: config.classroomName,
    count: config.studentCount ?? 0
  });
}

function assertUniqueStudents(students: BootstrapPilotStudentInput[]) {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const student of students) {
    const normalized = normalizeUserId(student.user_id);
    if (seen.has(normalized)) {
      duplicates.push(student.user_id);
    }
    seen.add(normalized);
  }

  if (duplicates.length > 0) {
    throw new BootstrapError("Bootstrap student roster contains duplicate user IDs.", {
      duplicate_user_ids: duplicates
    });
  }
}

async function ensureTeacher(prisma: PrismaClient, config: BootstrapPilotConfig) {
  const normalized = normalizeUserId(config.teacherUsername);
  const existing = await prisma.user.findUnique({ where: { user_id_normalized: normalized } });
  const teacherEmail = config.teacherEmail ? normalizeTeacherEmail(config.teacherEmail) : null;

  if (existing) {
    if (existing.role !== "teacher_researcher") {
      throw new BootstrapError("Bootstrap teacher user_id already belongs to a non-teacher account.", {
        user_id: config.teacherUsername,
        existing_role: existing.role
      });
    }
    if (teacherEmail) {
      const conflicting = await prisma.user.findFirst({
        where: {
          role: "teacher_researcher",
          email_normalized: teacherEmail.normalized,
          id: { not: existing.id }
        },
        select: { id: true }
      });
      if (conflicting) {
        throw new BootstrapError("Bootstrap teacher recovery email is already used by another teacher account.", {
          email_masked: maskEmail(teacherEmail.display)
        });
      }
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          email: teacherEmail.display,
          email_normalized: teacherEmail.normalized,
          email_verified_at: existing.email_verified_at ?? new Date(),
          pending_email: null,
          pending_email_normalized: null,
          email_change_requested_at: null
        }
      });
      return { teacher: updated, created: false };
    }
    return { teacher: existing, created: false };
  }

  const created = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      user_id: config.teacherUsername,
      user_id_normalized: normalized,
      display_name: "Pilot Teacher",
      role: "teacher_researcher",
      password_hash: await hashSecret(config.teacherPassword),
      access_code_hash: null,
      account_status: "active",
      auth_version: 1,
      credential_updated_at: new Date(),
      email: teacherEmail?.display ?? null,
      email_normalized: teacherEmail?.normalized ?? null,
      email_verified_at: teacherEmail ? new Date() : null
    }
  });

  return { teacher: created, created: true };
}

async function createStudentAccount(input: {
  prisma: PrismaClient;
  student: BootstrapPilotStudentInput;
  teacher: User;
  classroomId: string;
  classroomName: string;
}) {
  const credential = await generateHashedAccessCode();
  const created = await input.prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      user_id: input.student.user_id,
      user_id_normalized: normalizeUserId(input.student.user_id),
      display_name: input.student.display_name,
      role: "student",
      account_status: "active",
      auth_version: 1,
      must_change_password: true,
      password_hash: null,
      access_code_hash: credential.access_code_hash,
      credential_updated_at: new Date(),
      credential_reset_at: new Date(),
      created_by_teacher_user_id: input.teacher.id
    }
  });

  await input.prisma.studentAccountEvent.create({
    data: {
      id: crypto.randomUUID(),
      event_public_id: generatePublicId("student_account_event"),
      student_user_db_id: created.id,
      performed_by_user_db_id: input.teacher.id,
      event_type: "teacher_student_account_created",
      metadata: {
        source: "staging_bootstrap_pilot",
        classroom_id: input.classroomId,
        classroom_name: input.classroomName,
        user_id: created.user_id,
        display_name: created.display_name
      }
    }
  });

  return {
    user: created,
    credential: {
      user_id: created.user_id,
      display_name: created.display_name,
      temporary_access_code: credential.access_code,
      temporary_password: credential.access_code
    } satisfies OneTimeCredential
  };
}

async function ensureStudents(input: {
  prisma: PrismaClient;
  teacher: User;
  config: BootstrapPilotConfig;
  students: BootstrapPilotStudentInput[];
}) {
  let createdCount = 0;
  let existingCount = 0;
  const roleConflicts: string[] = [];
  const credentials: OneTimeCredential[] = [];

  for (const student of input.students) {
    const normalized = normalizeUserId(student.user_id);
    const existing = await input.prisma.user.findUnique({ where: { user_id_normalized: normalized } });

    if (existing) {
      if (existing.role !== "student") {
        roleConflicts.push(student.user_id);
        continue;
      }
      existingCount += 1;
      continue;
    }

    const created = await createStudentAccount({
      prisma: input.prisma,
      student,
      teacher: input.teacher,
      classroomId: input.config.classroomId,
      classroomName: input.config.classroomName
    });
    credentials.push(created.credential);
    createdCount += 1;
  }

  if (roleConflicts.length > 0) {
    throw new BootstrapError("Bootstrap student user_id conflicts with non-student accounts.", {
      conflicting_user_ids: roleConflicts
    });
  }

  return { createdCount, existingCount, credentials };
}

async function writeCredentialFile(input: {
  config: BootstrapPilotConfig;
  credentials: OneTimeCredential[];
}) {
  if (input.credentials.length === 0) {
    return null;
  }

  await mkdir(input.config.outputDir, { recursive: true });
  const fileName = `${timestampSlug()}-${input.config.classroomId}-student-access-codes.csv`;
  const filePath = path.join(input.config.outputDir, fileName);
  await writeFile(filePath, credentialCsv(input.credentials), { mode: 0o600 });
  return filePath;
}

async function assessmentSummary(prisma: PrismaClient, assessmentPublicId: string) {
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { assessment_public_id: assessmentPublicId },
    include: {
      concept_units: {
        include: {
          items: true
        }
      }
    }
  });
  const items = assessment.concept_units.flatMap((conceptUnit) => conceptUnit.items);

  return {
    assessment_public_id: assessment.assessment_public_id,
    title: assessment.title,
    status: assessment.status,
    workflow_mode: assessment.workflow_mode,
    initial_item_count: items.filter((item) => item.included_in_published_set && item.status === "published").length,
    transfer_item_count: items.filter((item) => !item.included_in_published_set && item.status === "published").length,
    availability_model: "published_assessment_visible_to_active_students" as const
  };
}

export async function bootstrapPilotDatabase(prisma: PrismaClient, config: BootstrapPilotConfig): Promise<BootstrapPilotSummary> {
  if (!config.enabled) {
    throw new BootstrapError("BOOTSTRAP_ENABLED must be true to run staging bootstrap.", {
      variable_name: "BOOTSTRAP_ENABLED",
      expected_value: "true"
    });
  }

  if (config.defaultAssessmentId !== demoAssessmentPublicId) {
    throw new BootstrapError("Only the fixed IRT MVP assessment is supported by this bootstrap command.", {
      expected_assessment_public_id: demoAssessmentPublicId,
      provided_assessment_public_id: config.defaultAssessmentId
    });
  }

  const students = await studentInputs(config);
  assertUniqueStudents(students);

  const teacherResult = await ensureTeacher(prisma, config);
  await ensureFixedIrtMvpAssessment(prisma, teacherResult.teacher.id);
  const studentResult = await ensureStudents({
    prisma,
    teacher: teacherResult.teacher,
    config,
    students
  });
  const outputPath = await writeCredentialFile({
    config,
    credentials: studentResult.credentials
  });

  return {
    status: "completed",
    classroom: {
      classroom_id: config.classroomId,
      classroom_name: config.classroomName,
      persistence_model: "bootstrap_metadata_only"
    },
    teacher: {
      user_id: teacherResult.teacher.user_id,
      created: teacherResult.created,
      existing: !teacherResult.created,
      recovery_email_configured: Boolean(teacherResult.teacher.email_normalized),
      recovery_email_verified: Boolean(teacherResult.teacher.email_verified_at),
      masked_recovery_email: maskEmail(teacherResult.teacher.email)
    },
    students: {
      requested_count: students.length,
      created_count: studentResult.createdCount,
      existing_count: studentResult.existingCount,
      role_conflict_count: 0,
      access_codes_printed: false,
      access_codes_output_path: outputPath,
      credential_warning: outputPath ? oneTimeCredentialWarning : null
    },
    assessment: await assessmentSummary(prisma, config.defaultAssessmentId),
    no_openai_call_occurred: true,
    raw_secret_values_printed: false
  };
}

export function bootstrapErrorPayload(error: unknown) {
  if (error instanceof BootstrapError) {
    return {
      status: "failed",
      error: error.message,
      ...error.safeDetails,
      no_openai_call_occurred: true,
      raw_secret_values_printed: false
    };
  }

  return {
    status: "failed",
    error: error instanceof Error ? error.message : "unknown_error",
    no_openai_call_occurred: true,
    raw_secret_values_printed: false
  };
}
