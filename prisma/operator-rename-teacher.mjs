import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

class OperatorError extends Error {
  constructor(code, message, details = {}, status = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

const controlCharacters = /[\p{Cc}\p{Cf}]/u;
const allowedUserIdCharacters = /^[\p{L}\p{N}._@-]+$/u;

function normalizeUserId(value) {
  return String(value).trim().normalize("NFC").toLocaleLowerCase("en-US");
}

function parseRequired(value, name) {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.normalize("NFC");
  const trimmed = normalized.trim();

  if (!trimmed) {
    throw new OperatorError("missing_configuration", `${name} is required.`, { variable_name: name });
  }
  if (trimmed !== normalized) {
    throw new OperatorError("invalid_username", `${name} must not include leading or trailing whitespace.`, {
      variable_name: name
    });
  }
  if (trimmed.length > 100) {
    throw new OperatorError("invalid_username", `${name} must be 100 characters or fewer.`, {
      variable_name: name
    });
  }
  if (controlCharacters.test(trimmed) || trimmed.includes("\n") || trimmed.includes("\r")) {
    throw new OperatorError("invalid_username", `${name} must not include control characters or line breaks.`, {
      variable_name: name
    });
  }
  if (!allowedUserIdCharacters.test(trimmed)) {
    throw new OperatorError(
      "invalid_username",
      `${name} may contain letters, numbers, period, underscore, hyphen, and @.`,
      { variable_name: name }
    );
  }
  return trimmed;
}

function assertEnabled() {
  if (process.env.TEACHER_USERNAME_RENAME_ENABLED !== "true") {
    throw new OperatorError(
      "rename_not_enabled",
      "TEACHER_USERNAME_RENAME_ENABLED must be true.",
      {
        variable_name: "TEACHER_USERNAME_RENAME_ENABLED",
        expected_value: "true"
      },
      2
    );
  }
  if (process.env.CONFIRM_TEACHER_USERNAME_RENAME !== "RENAME_TEACHER") {
    throw new OperatorError(
      "confirmation_required",
      "CONFIRM_TEACHER_USERNAME_RENAME must be RENAME_TEACHER.",
      {
        variable_name: "CONFIRM_TEACHER_USERNAME_RENAME",
        expected_value: "RENAME_TEACHER"
      },
      2
    );
  }
}

async function findTeacher(currentNormalized, newNormalized) {
  const select = {
    id: true,
    user_id: true,
    user_id_normalized: true,
    role: true,
    account_status: true,
    auth_version: true
  };
  const current = await prisma.user.findUnique({
    where: { user_id_normalized: currentNormalized },
    select
  });
  if (current) {
    return { user: current, foundBy: "current_username" };
  }
  if (currentNormalized !== newNormalized) {
    const renamed = await prisma.user.findUnique({
      where: { user_id_normalized: newNormalized },
      select
    });
    if (renamed) {
      return { user: renamed, foundBy: "new_username" };
    }
  }
  return { user: null, foundBy: null };
}

async function renameTeacher() {
  assertEnabled();
  const currentUsername = parseRequired(process.env.CURRENT_TEACHER_USERNAME, "CURRENT_TEACHER_USERNAME");
  const newUsername = parseRequired(process.env.NEW_TEACHER_USERNAME, "NEW_TEACHER_USERNAME");
  const currentNormalized = normalizeUserId(currentUsername);
  const newNormalized = normalizeUserId(newUsername);

  const { user: teacher, foundBy } = await findTeacher(currentNormalized, newNormalized);
  if (!teacher) {
    throw new OperatorError("teacher_not_found", "Teacher account was not found.", {
      current_username: currentUsername,
      new_username: newUsername
    });
  }
  if (teacher.role !== "teacher_researcher") {
    throw new OperatorError("not_teacher_account", "This command can only rename teacher/research accounts.", {
      located_by: foundBy
    });
  }

  if (teacher.user_id_normalized === newNormalized) {
    return {
      status: "already_configured",
      old_username: currentUsername,
      new_username: teacher.user_id,
      role: teacher.role,
      auth_version_changed: false,
      sessions_invalidated_count: 0,
      session_invalidation: "not_changed",
      account_security_tokens_invalidated_count: 0,
      no_openai_call_occurred: true
    };
  }

  const duplicate = await prisma.user.findUnique({
    where: { user_id_normalized: newNormalized },
    select: { id: true, role: true }
  });
  if (duplicate && duplicate.id !== teacher.id) {
    throw new OperatorError("username_unavailable", "That username cannot be used. Choose another username.", {
      new_username: newUsername,
      existing_role: duplicate.role
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.user.update({
      where: { id: teacher.id },
      data: {
        user_id: newUsername,
        user_id_normalized: newNormalized,
        auth_version: { increment: 1 }
      },
      select: {
        user_id: true,
        role: true,
        account_status: true,
        auth_version: true
      }
    });
    const invalidatedTokens = await tx.accountSecurityToken.updateMany({
      where: {
        user_db_id: teacher.id,
        used_at: null,
        invalidated_at: null
      },
      data: { invalidated_at: new Date() }
    });
    await tx.accountSecurityEvent.create({
      data: {
        user_db_id: teacher.id,
        event_type: "teacher_username_operator_renamed",
        status: "completed",
        metadata_json: {
          old_username: teacher.user_id,
          new_username: next.user_id,
          auth_version_incremented: true,
          invalidated_token_count: invalidatedTokens.count
        }
      }
    });
    return {
      user: next,
      invalidatedTokenCount: invalidatedTokens.count
    };
  });

  return {
    status: "updated",
    old_username: teacher.user_id,
    new_username: updated.user.user_id,
    role: updated.user.role,
    account_status: updated.user.account_status,
    auth_version_changed: true,
    sessions_invalidated_count: null,
    session_invalidation: "auth_version_incremented",
    account_security_tokens_invalidated_count: updated.invalidatedTokenCount,
    no_openai_call_occurred: true
  };
}

try {
  const result = await renameTeacher();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const safe =
    error instanceof OperatorError
      ? {
          status: "failed",
          code: error.code,
          message: error.message,
          details: error.details,
          no_openai_call_occurred: true
        }
      : {
          status: "failed",
          code: "teacher_rename_unavailable",
          message: "Teacher rename command is unavailable. Check migrations and database configuration.",
          details: {},
          no_openai_call_occurred: true
        };
  console.error(JSON.stringify(safe, null, 2));
  process.exitCode = error instanceof OperatorError ? error.status : 1;
} finally {
  await prisma.$disconnect();
}
