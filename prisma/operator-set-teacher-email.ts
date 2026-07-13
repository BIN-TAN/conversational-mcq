import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import {
  AccountSecurityError,
  publicAccountSecurityError,
  setTeacherEmailByOperator
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

function parseBooleanRequired(value: string | undefined, name: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AccountSecurityError("invalid_configuration", `${name} must be true or false.`, 400, {
    variable_name: name,
    expected_values: ["true", "false"],
    missing: value === undefined
  });
}

async function main() {
  const enabled = parseBooleanRequired(process.env.TEACHER_EMAIL_SETUP_ENABLED, "TEACHER_EMAIL_SETUP_ENABLED");
  if (!enabled) {
    throw new AccountSecurityError("setup_not_enabled", "TEACHER_EMAIL_SETUP_ENABLED must be true.", 403, {
      variable_name: "TEACHER_EMAIL_SETUP_ENABLED",
      expected_value: "true"
    });
  }

  const username = parseRequired(process.env.TEACHER_USERNAME, "TEACHER_USERNAME");
  const email = parseRequired(process.env.TEACHER_EMAIL, "TEACHER_EMAIL");
  const markVerified = parseBooleanRequired(process.env.TEACHER_EMAIL_MARK_VERIFIED, "TEACHER_EMAIL_MARK_VERIFIED");

  const result = await setTeacherEmailByOperator({
    username,
    email,
    markVerified,
    context: { prisma }
  });

  console.log(
    JSON.stringify(
      {
        status: result.status,
        user_id: result.user_id,
        masked_email: result.masked_email,
        verified: result.verified ?? markVerified,
        verification_required: !markVerified,
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
