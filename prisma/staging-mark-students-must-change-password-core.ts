import type { PrismaClient } from "@prisma/client";
import { normalizeUserId, parseUserId } from "../src/lib/services/student-accounts/validation";

export type MarkStudentsMustChangePasswordConfig = {
  enabled: boolean;
  classroomId?: string;
  studentUserId?: string;
};

export type MarkStudentsMustChangePasswordSummary = {
  status: "completed";
  matched_student_count: number;
  eligible_temporary_student_count: number;
  updated_student_count: number;
  already_required_count: number;
  skipped_not_temporary_credential_count: number;
  classroom_filter_applied: boolean;
  student_filter_applied: boolean;
  no_openai_call_occurred: true;
  raw_secret_values_printed: false;
};

export class MarkStudentsMustChangePasswordError extends Error {
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
  throw new MarkStudentsMustChangePasswordError(`${name} must be true or false.`, {
    variable_name: name,
    expected_values: ["true", "false"],
    missing: value === undefined
  });
}

export function parseMarkStudentsMustChangePasswordConfig(
  env: Record<string, string | undefined>
): MarkStudentsMustChangePasswordConfig {
  const enabled = parseBoolean(
    optionalTrimmed(env.MARK_STUDENT_PASSWORD_CHANGE_ENABLED),
    "MARK_STUDENT_PASSWORD_CHANGE_ENABLED"
  );
  const classroomId = optionalTrimmed(env.MARK_STUDENT_CLASSROOM_ID);
  const studentUserId = optionalTrimmed(env.MARK_STUDENT_USER_ID);

  return {
    enabled,
    classroomId: classroomId ? parseUserId(classroomId) : undefined,
    studentUserId: studentUserId ? parseUserId(studentUserId) : undefined
  };
}

function metadataClassroomId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).classroom_id;
  return typeof value === "string" ? value : null;
}

export async function markStudentsMustChangePassword(
  prisma: PrismaClient,
  config: MarkStudentsMustChangePasswordConfig
): Promise<MarkStudentsMustChangePasswordSummary> {
  if (!config.enabled) {
    throw new MarkStudentsMustChangePasswordError(
      "MARK_STUDENT_PASSWORD_CHANGE_ENABLED must be true to mark student accounts.",
      {
        variable_name: "MARK_STUDENT_PASSWORD_CHANGE_ENABLED",
        expected_value: "true"
      }
    );
  }

  const activeStudents = await prisma.user.findMany({
    where: {
      role: "student",
      account_status: "active",
      ...(config.studentUserId
        ? { user_id_normalized: normalizeUserId(config.studentUserId) }
        : {})
    },
    select: {
      id: true,
      must_change_password: true,
      password_hash: true,
      access_code_hash: true
    }
  });

  let matchedStudents = activeStudents;

  if (config.classroomId) {
    const classroomEvents = await prisma.studentAccountEvent.findMany({
      where: {
        student_user_db_id: { in: activeStudents.map((student) => student.id) },
        event_type: {
          in: ["teacher_student_account_created", "student_created_by_roster"]
        }
      },
      select: {
        student_user_db_id: true,
        metadata: true
      }
    });
    const classroomStudentIds = new Set(
      classroomEvents
        .filter((event) => metadataClassroomId(event.metadata) === config.classroomId)
        .map((event) => event.student_user_db_id)
    );
    matchedStudents = activeStudents.filter((student) => classroomStudentIds.has(student.id));
  }

  const temporaryCredentialStudents = matchedStudents.filter(
    (student) => student.access_code_hash !== null && student.password_hash === null
  );
  const alreadyRequired = temporaryCredentialStudents.filter((student) => student.must_change_password);
  const toUpdate = temporaryCredentialStudents.filter((student) => !student.must_change_password);

  if (toUpdate.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: toUpdate.map((student) => student.id) } },
      data: { must_change_password: true }
    });
  }

  return {
    status: "completed",
    matched_student_count: matchedStudents.length,
    eligible_temporary_student_count: temporaryCredentialStudents.length,
    updated_student_count: toUpdate.length,
    already_required_count: alreadyRequired.length,
    skipped_not_temporary_credential_count: matchedStudents.length - temporaryCredentialStudents.length,
    classroom_filter_applied: Boolean(config.classroomId),
    student_filter_applied: Boolean(config.studentUserId),
    no_openai_call_occurred: true,
    raw_secret_values_printed: false
  };
}

export function markStudentsMustChangePasswordErrorPayload(error: unknown) {
  if (error instanceof MarkStudentsMustChangePasswordError) {
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
