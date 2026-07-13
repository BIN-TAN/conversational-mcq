import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createSessionToken, getUserForSessionToken, toPublicUser } from "../src/lib/auth";
import {
  cancelTeacherEmailChange,
  getTeacherAccountSecurity,
  requestTeacherEmailChange,
  requestTeacherPasswordReset,
  verifyTeacherEmailChangeToken
} from "../src/lib/services/account-security/teacher-account-security";
import { hashAccountSecurityToken } from "../src/lib/services/account-security/tokens";
import { teacherPrimaryNavItems } from "../src/components/teacher-primary-nav-items";
import {
  accountSecuritySmokePrefix,
  assert,
  cleanupAccountSecuritySmokeUsers,
  createSmokeStudent,
  createSmokeTeacher,
  latestTokenFromProvider,
  MockAccountSecurityEmailProvider
} from "./account-security-smoke-helpers";

const prisma = new PrismaClient();

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function expectSafeFailure(action: () => Promise<unknown>, label: string) {
  let failed = false;
  try {
    await action();
  } catch {
    failed = true;
  }
  assert(failed, label);
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.APP_BASE_URL = "https://account-security-smoke.example";

  const prefix = accountSecuritySmokePrefix("teacher_email_change_smoke");
  await cleanupAccountSecuritySmokeUsers(prisma, prefix);
  const emailProvider = new MockAccountSecurityEmailProvider();
  const password = "TeacherEmailChange!31z";
  const teacher = await createSmokeTeacher({
    prisma,
    userId: `${prefix}teacher`,
    password,
    email: `${prefix}old@example.test`,
    verified: true
  });
  const otherTeacher = await createSmokeTeacher({
    prisma,
    userId: `${prefix}other`,
    password,
    email: `${prefix}duplicate@example.test`,
    verified: true
  });
  const student = await createSmokeStudent({
    prisma,
    userId: `${prefix}student`,
    password: "StudentPassword!31z",
    email: `${prefix}student@example.test`,
    teacher
  });

  try {
    const initial = await getTeacherAccountSecurity({ userDbId: teacher.id, context: { prisma } });
    assert(initial.email === `${prefix}old@example.test`, "Authenticated teacher should see current email.");
    assert(initial.email_verified_at, "Smoke teacher current email should be verified.");

    await expectSafeFailure(
      () =>
        requestTeacherEmailChange({
          userDbId: teacher.id,
          currentPassword: "wrong password",
          newEmail: `${prefix}new@example.test`,
          context: { prisma, emailProvider }
        }),
      "Email change should require current password."
    );

    await expectSafeFailure(
      () =>
        requestTeacherEmailChange({
          userDbId: teacher.id,
          currentPassword: password,
          newEmail: otherTeacher.email,
          context: { prisma, emailProvider }
        }),
      "Duplicate normalized teacher email should be rejected."
    );

    const pending = await requestTeacherEmailChange({
      userDbId: teacher.id,
      currentPassword: password,
      newEmail: `${prefix}new@example.test`,
      context: { prisma, emailProvider, now: new Date("2026-07-13T12:00:00Z") }
    });
    assert(pending.pending_email === `${prefix}new@example.test`, "New email should be stored as pending.");
    const pendingUser = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(pendingUser.email === `${prefix}old@example.test`, "Old email should remain current before verification.");
    assert(pendingUser.pending_email === `${prefix}new@example.test`, "Pending email should be visible only in account settings.");
    const firstVerifyToken = latestTokenFromProvider(emailProvider, "verify");
    const firstVerifyRow = await prisma.accountSecurityToken.findUnique({
      where: { token_hash: hashAccountSecurityToken(firstVerifyToken) }
    });
    assert(firstVerifyRow, "Verification token hash should be stored.");
    assert(firstVerifyRow.token_hash !== firstVerifyToken, "Verification token plaintext must not be stored.");

    await cancelTeacherEmailChange({
      userDbId: teacher.id,
      currentPassword: password,
      context: { prisma, emailProvider }
    });
    const cancelled = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(cancelled.email === `${prefix}old@example.test`, "Cancelling pending change should retain old email.");
    assert(cancelled.pending_email === null, "Cancelling pending change should clear pending email.");
    await expectSafeFailure(
      () => verifyTeacherEmailChangeToken({ token: firstVerifyToken, context: { prisma, emailProvider } }),
      "Cancelled verification token should not be usable."
    );

    emailProvider.reset();
    await requestTeacherEmailChange({
      userDbId: teacher.id,
      currentPassword: password,
      newEmail: `${prefix}new@example.test`,
      context: { prisma, emailProvider, now: new Date("2026-07-13T12:05:00Z") }
    });
    const activeVerifyToken = latestTokenFromProvider(emailProvider, "verify");
    const preVerifySession = createSessionToken(toPublicUser(teacher));
    const verified = await verifyTeacherEmailChangeToken({
      token: activeVerifyToken,
      context: { prisma, emailProvider, now: new Date("2026-07-13T12:06:00Z") }
    });
    assert(verified.email === `${prefix}new@example.test`, "Verified new email should become current.");
    const changed = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(changed.user_id === teacher.user_id, "Email change must not alter teacher username.");
    assert(changed.id === teacher.id, "Email change must not alter teacher database identity.");
    assert(changed.email === `${prefix}new@example.test`, "Verified new email should persist on user.");
    assert(changed.pending_email === null, "Verified email change should clear pending email.");
    assert(changed.email_verified_at, "Verified email change should set email_verified_at.");
    assert((await getUserForSessionToken(preVerifySession)) === null, "Email verification should invalidate older sessions.");
    await expectSafeFailure(
      () => verifyTeacherEmailChangeToken({ token: activeVerifyToken, context: { prisma, emailProvider } }),
      "Verification token should be single-use."
    );

    emailProvider.reset();
    const oldReset = await requestTeacherPasswordReset({
      email: `${prefix}old@example.test`,
      context: { prisma, emailProvider }
    });
    assert(!oldReset.email_sent, "Old email should no longer work for reset requests after verification.");
    const newReset = await requestTeacherPasswordReset({
      email: `${prefix}new@example.test`,
      context: { prisma, emailProvider }
    });
    assert(newReset.email_sent, "New verified email should work for reset requests.");

    await expectSafeFailure(
      () => getTeacherAccountSecurity({ userDbId: student.id, context: { prisma } }),
      "Student should not be able to access teacher account settings service."
    );

    const expectedNav = [
      "Dashboard",
      "Assessment management",
      "Student accounts",
      "Student sessions",
      "Data and outcomes",
      "LLM status"
    ];
    assert(teacherPrimaryNavItems.length === expectedNav.length, "Teacher primary nav should remain six entries.");
    assert(
      teacherPrimaryNavItems.every((item, index) => item.label === expectedNav[index]),
      "Teacher primary nav labels should remain canonical."
    );
    assert(
      teacherPrimaryNavItems.every((item) => String(item.label) !== "Account settings"),
      "Account settings must not become a primary nav entry."
    );
    assert(
      source("src/components/teacher-account-utility-link.tsx").includes("Account settings"),
      "Account settings should be exposed as a utility action."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          authenticated_teacher_sees_current_email: true,
          current_password_required: true,
          pending_until_verified: true,
          token_hash_only: true,
          duplicate_email_rejected: true,
          pending_email_cancelled: true,
          old_email_disabled_for_reset: true,
          new_email_enabled_for_reset: true,
          username_and_identity_preserved: true,
          old_session_invalidated: true,
          account_settings_utility_not_primary_nav: true,
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
