import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  accountSecuritySmokePrefix,
  assert,
  cleanupAccountSecuritySmokeUsers,
  createSmokeStudent,
  createSmokeTeacher
} from "./account-security-smoke-helpers";

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);

async function runOperator(env: Record<string, string | undefined>) {
  return execFileAsync("npm", ["run", "operator:set-teacher-email"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false"
    },
    maxBuffer: 1024 * 1024
  });
}

async function expectOperatorFailure(env: Record<string, string | undefined>, expected: string) {
  let failed = false;
  try {
    await runOperator(env);
  } catch (error) {
    failed = true;
    const output = `${(error as { stdout?: string }).stdout ?? ""}\n${(error as { stderr?: string }).stderr ?? ""}`;
    assert(output.includes(expected), `Expected operator failure output to include ${expected}.`);
  }
  assert(failed, "Operator command should have failed.");
}

async function main() {
  const prefix = accountSecuritySmokePrefix("operator_email_smoke");
  await cleanupAccountSecuritySmokeUsers(prisma, prefix);
  const teacher = await createSmokeTeacher({
    prisma,
    userId: `${prefix}teacher`,
    password: "OperatorTeacherPassword!31z"
  });
  const student = await createSmokeStudent({
    prisma,
    userId: `${prefix}student`,
    password: "OperatorStudentPassword!31z",
    teacher
  });
  const duplicate = await createSmokeTeacher({
    prisma,
    userId: `${prefix}duplicate`,
    password: "OperatorTeacherPassword!31z",
    email: `${prefix}duplicate@example.test`,
    verified: true
  });

  try {
    await expectOperatorFailure(
      {
        TEACHER_EMAIL_SETUP_ENABLED: "false",
        TEACHER_USERNAME: teacher.user_id,
        TEACHER_EMAIL: `${prefix}teacher@example.test`,
        TEACHER_EMAIL_MARK_VERIFIED: "true"
      },
      "setup_not_enabled"
    );

    const rawEmail = `${prefix}teacher@example.test`;
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: teacher.id },
      select: { auth_version: true }
    });
    const first = await runOperator({
      TEACHER_EMAIL_SETUP_ENABLED: "true",
      TEACHER_USERNAME: teacher.user_id,
      TEACHER_EMAIL: rawEmail,
      TEACHER_EMAIL_MARK_VERIFIED: "true"
    });
    assert(first.stdout.includes('"status": "updated"'), "Operator command should update teacher recovery email.");
    assert(first.stdout.includes('"masked_email"'), "Operator output should include masked email.");
    assert(!first.stdout.includes(rawEmail), "Operator output must not print the raw email.");
    assert(!first.stderr.includes(rawEmail), "Operator error output must not print the raw email.");
    const updated = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(teacher.user_id) }
    });
    assert(updated.email === rawEmail, "Operator command should persist teacher recovery email.");
    assert(updated.email_normalized === rawEmail.toLocaleLowerCase("en-US"), "Operator command should persist normalized email.");
    assert(updated.email_verified_at, "Operator mark-verified flag should set email_verified_at.");
    assert(
      updated.auth_version === before.auth_version + 1,
      "Operator email update should increment auth_version to invalidate old teacher sessions."
    );
    assert(first.stdout.includes('"session_invalidation": "auth_version_incremented"'), "Operator output should report session invalidation.");

    const second = await runOperator({
      TEACHER_EMAIL_SETUP_ENABLED: "true",
      TEACHER_USERNAME: teacher.user_id,
      TEACHER_EMAIL: rawEmail,
      TEACHER_EMAIL_MARK_VERIFIED: "true"
    });
    assert(second.stdout.includes('"status": "already_configured"'), "Operator rerun should be idempotent.");
    assert(!second.stdout.includes(rawEmail), "Idempotent output must not print raw email.");
    const afterNoOp = await prisma.user.findUniqueOrThrow({
      where: { id: teacher.id },
      select: { auth_version: true }
    });
    assert(afterNoOp.auth_version === updated.auth_version, "Idempotent rerun should not increment auth_version.");

    await expectOperatorFailure(
      {
        TEACHER_EMAIL_SETUP_ENABLED: "true",
        TEACHER_USERNAME: student.user_id,
        TEACHER_EMAIL: `${prefix}student-target@example.test`,
        TEACHER_EMAIL_MARK_VERIFIED: "true"
      },
      "not_teacher_account"
    );

    await expectOperatorFailure(
      {
        TEACHER_EMAIL_SETUP_ENABLED: "true",
        TEACHER_USERNAME: teacher.user_id,
        TEACHER_EMAIL: duplicate.email ?? "",
        TEACHER_EMAIL_MARK_VERIFIED: "true"
      },
      "email_unavailable"
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          explicit_enable_required: true,
          teacher_email_assigned: true,
          student_rejected: true,
          normalized_uniqueness_enforced: true,
          idempotent_rerun: true,
          output_masks_email: true,
          passwords_or_secrets_printed: false,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } finally {
    await cleanupAccountSecuritySmokeUsers(prisma, prefix);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
  process.exit(1);
});
