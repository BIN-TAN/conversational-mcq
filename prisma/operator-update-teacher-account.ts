import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import {
  AccountSecurityError,
  publicAccountSecurityError,
  updateTeacherAccountByOperator
} from "../src/lib/services/account-security/teacher-account-security";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

function parseRequired(value: string | undefined, name: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new AccountSecurityError("missing_configuration", `${name} is required.`, 400, {
      variable_name: name
    });
  }
  return trimmed;
}

function parseOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseBooleanRequired(value: string | undefined, name: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AccountSecurityError("invalid_configuration", `${name} must be true or false.`, 400, {
    variable_name: name,
    expected_values: ["true", "false"],
    missing: value === undefined
  });
}

function parseBooleanOptional(value: string | undefined, name: string) {
  if (value === undefined || value.trim().length === 0) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AccountSecurityError("invalid_configuration", `${name} must be true or false when supplied.`, 400, {
    variable_name: name,
    expected_values: ["true", "false"]
  });
}

async function main() {
  const enabled = parseBooleanRequired(process.env.TEACHER_ACCOUNT_UPDATE_ENABLED, "TEACHER_ACCOUNT_UPDATE_ENABLED");
  if (!enabled) {
    throw new AccountSecurityError("update_not_enabled", "TEACHER_ACCOUNT_UPDATE_ENABLED must be true.", 403, {
      variable_name: "TEACHER_ACCOUNT_UPDATE_ENABLED",
      expected_value: "true"
    });
  }

  const confirmation = parseRequired(process.env.CONFIRM_TEACHER_ACCOUNT_UPDATE, "CONFIRM_TEACHER_ACCOUNT_UPDATE");
  if (confirmation !== "UPDATE_TEACHER_ACCOUNT") {
    throw new AccountSecurityError("confirmation_required", "CONFIRM_TEACHER_ACCOUNT_UPDATE must be UPDATE_TEACHER_ACCOUNT.", 403, {
      variable_name: "CONFIRM_TEACHER_ACCOUNT_UPDATE",
      expected_value: "UPDATE_TEACHER_ACCOUNT"
    });
  }

  const result = await updateTeacherAccountByOperator({
    currentUsername: parseRequired(process.env.CURRENT_TEACHER_USERNAME, "CURRENT_TEACHER_USERNAME"),
    newUsername: parseRequired(process.env.NEW_TEACHER_USERNAME, "NEW_TEACHER_USERNAME"),
    newEmail: parseOptional(process.env.NEW_TEACHER_EMAIL),
    markEmailVerified: parseBooleanOptional(process.env.TEACHER_EMAIL_MARK_VERIFIED, "TEACHER_EMAIL_MARK_VERIFIED"),
    context: { prisma }
  });

  console.log(
    JSON.stringify(
      {
        status: result.status,
        current_username: result.current_username,
        new_username: result.new_username,
        masked_email: result.masked_email,
        email_verified: result.verified,
        auth_version_incremented: result.auth_version_incremented,
        sessions_invalidated_count: result.auth_version_incremented ? null : 0,
        session_invalidation: result.auth_version_incremented ? "auth_version_incremented" : "not_changed",
        tokens_invalidated_count: result.invalidated_token_count,
        audit_event_public_id: result.audit_event_public_id,
        raw_email_printed: false,
        password_or_secret_printed: false,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    const safe = publicAccountSecurityError(error);
    console.error(
      JSON.stringify(
        {
          status: "failed",
          code: safe.code,
          message: safe.message,
          details: safe.details,
          raw_email_printed: false,
          password_or_secret_printed: false,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
