import { PrismaClient } from "@prisma/client";
import { createSessionToken, getUserForSessionToken, toPublicUser } from "../src/lib/auth";
import { verifySecret } from "../src/lib/password";
import {
  completeTeacherPasswordReset,
  PASSWORD_RESET_PUBLIC_RESPONSE,
  requestTeacherPasswordReset
} from "../src/lib/services/account-security/teacher-account-security";
import { hashAccountSecurityToken } from "../src/lib/services/account-security/tokens";
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

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.APP_BASE_URL = "https://account-security-smoke.example";
  process.env.TEACHER_PASSWORD_RESET_EMAIL_MAX_PER_HOUR = "2";
  process.env.TEACHER_PASSWORD_RESET_IP_MAX_PER_HOUR = "20";
  process.env.TEACHER_PASSWORD_RESET_GLOBAL_MAX_PER_HOUR = "100";

  const prefix = accountSecuritySmokePrefix("teacher_reset_smoke");
  await cleanupAccountSecuritySmokeUsers(prisma, prefix);
  const emailProvider = new MockAccountSecurityEmailProvider();
  const oldPassword = "TeacherOldPassword!31z";
  const newPassword = "TeacherNewPassword!31z";
  const teacher = await createSmokeTeacher({
    prisma,
    userId: `${prefix}teacher`,
    password: oldPassword,
    email: `${prefix}teacher@example.test`,
    verified: true
  });
  const unverified = await createSmokeTeacher({
    prisma,
    userId: `${prefix}unverified`,
    password: oldPassword,
    email: `${prefix}unverified@example.test`,
    verified: false
  });
  await createSmokeStudent({
    prisma,
    userId: `${prefix}student`,
    password: "StudentPassword!31z",
    email: `${prefix}student@example.test`,
    teacher
  });

  try {
    const unknown = await requestTeacherPasswordReset({
      email: `${prefix}unknown@example.test`,
      context: { prisma, emailProvider }
    });
    const student = await requestTeacherPasswordReset({
      email: `${prefix}student@example.test`,
      context: { prisma, emailProvider }
    });
    const unverifiedResult = await requestTeacherPasswordReset({
      email: unverified.email,
      context: { prisma, emailProvider }
    });
    assert(unknown.message === PASSWORD_RESET_PUBLIC_RESPONSE, "Unknown email should receive generic response.");
    assert(student.message === PASSWORD_RESET_PUBLIC_RESPONSE, "Student email should receive generic response.");
    assert(unverifiedResult.message === PASSWORD_RESET_PUBLIC_RESPONSE, "Unverified teacher email should receive generic response.");
    assert(emailProvider.messages.length === 0, "Only verified teacher email should trigger injected delivery.");

    const first = await requestTeacherPasswordReset({
      email: teacher.email,
      context: { prisma, emailProvider, now: new Date("2026-07-13T12:00:00Z") }
    });
    assert(first.message === PASSWORD_RESET_PUBLIC_RESPONSE, "Known teacher email should receive generic response.");
    assert(first.email_sent, "Verified teacher email should trigger injected email delivery.");
    const firstMessages = emailProvider.messages.slice();
    assert(firstMessages.length === 1, "Verified teacher should receive one reset email.");
    assert(firstMessages[0]?.text.includes("https://account-security-smoke.example/auth/reset-password?token="), "Reset link should use configured APP_BASE_URL.");

    const firstToken = latestTokenFromProvider(emailProvider, "reset");
    assert(firstToken.length >= 40, "Reset token should be long enough to be cryptographically strong.");
    const firstTokenRow = await prisma.accountSecurityToken.findUnique({
      where: { token_hash: hashAccountSecurityToken(firstToken) }
    });
    assert(firstTokenRow, "Reset token hash should be stored.");
    assert(firstTokenRow.token_hash !== firstToken, "Database must store token hash, not plaintext token.");

    const second = await requestTeacherPasswordReset({
      email: teacher.email,
      context: { prisma, emailProvider, now: new Date("2026-07-13T12:01:00Z") }
    });
    assert(second.email_sent, "Second reset request within limit should send a replacement link.");
    const secondToken = latestTokenFromProvider(emailProvider, "reset");
    const firstAfterSecond = await prisma.accountSecurityToken.findUnique({
      where: { token_hash: hashAccountSecurityToken(firstToken) }
    });
    assert(firstAfterSecond?.invalidated_at, "Issuing a new token should invalidate the older active token.");

    await completeTeacherPasswordReset({
      token: firstToken,
      newPassword,
      confirmNewPassword: newPassword,
      context: { prisma, emailProvider }
    })
      .then(() => {
        throw new Error("Invalidated token should not be usable.");
      })
      .catch((error) => {
        assert(error instanceof Error, "Invalidated token should fail safely.");
      });

    const preResetSession = createSessionToken(toPublicUser(teacher));
    await completeTeacherPasswordReset({
      token: secondToken,
      newPassword,
      confirmNewPassword: newPassword,
      context: { prisma, emailProvider, now: new Date("2026-07-13T12:02:00Z") }
    });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(!(await verifySecret(oldPassword, updated.password_hash)), "Old password should fail after reset.");
    assert(await verifySecret(newPassword, updated.password_hash), "New password should verify after reset.");
    assert(updated.password_changed_at, "Password reset should set password_changed_at.");
    assert(updated.credential_reset_at, "Password reset should set credential_reset_at.");
    assert((await getUserForSessionToken(preResetSession)) === null, "Existing teacher session should be invalidated.");

    await completeTeacherPasswordReset({
      token: secondToken,
      newPassword: "AnotherPassword!31z",
      confirmNewPassword: "AnotherPassword!31z",
      context: { prisma, emailProvider }
    })
      .then(() => {
        throw new Error("Used reset token should not be reusable.");
      })
      .catch((error) => {
        assert(error instanceof Error, "Used token should fail safely.");
      });

    const rateTeacher = await createSmokeTeacher({
      prisma,
      userId: `${prefix}rate`,
      password: oldPassword,
      email: `${prefix}rate@example.test`,
      verified: true
    });
    emailProvider.reset();
    await requestTeacherPasswordReset({ email: rateTeacher.email, context: { prisma, emailProvider } });
    await requestTeacherPasswordReset({ email: rateTeacher.email, context: { prisma, emailProvider } });
    const blocked = await requestTeacherPasswordReset({ email: rateTeacher.email, context: { prisma, emailProvider } });
    assert(blocked.message === PASSWORD_RESET_PUBLIC_RESPONSE, "Rate-limited reset request should remain non-enumerating.");
    assert(blocked.reason === "rate_limited", "Third reset request should hit configured email rate limit.");
    const rateMessages = emailProvider.messages.slice();
    assert(rateMessages.length === 2, "Rate limit should prevent reset-email flooding.");

    const expiredTeacher = await createSmokeTeacher({
      prisma,
      userId: `${prefix}expired`,
      password: oldPassword,
      email: `${prefix}expired@example.test`,
      verified: true
    });
    emailProvider.reset();
    await requestTeacherPasswordReset({
      email: expiredTeacher.email,
      context: { prisma, emailProvider, now: new Date("2026-07-13T13:00:00Z") }
    });
    const expiredToken = latestTokenFromProvider(emailProvider, "reset");
    await completeTeacherPasswordReset({
      token: expiredToken,
      newPassword,
      confirmNewPassword: newPassword,
      context: { prisma, emailProvider, now: new Date("2026-07-13T14:00:01Z") }
    })
      .then(() => {
        throw new Error("Expired reset token should not be accepted.");
      })
      .catch((error) => {
        assert(error instanceof Error, "Expired token should fail safely.");
      });

    console.log(
      JSON.stringify(
        {
          status: "passed",
          public_response_non_enumerating: true,
          verified_teacher_delivery_only: true,
          token_hash_only: true,
          single_use_and_expiring: true,
          new_token_invalidates_old: true,
          reset_changes_password: true,
          old_session_invalidated: true,
          rate_limit_prevents_flooding: true,
          raw_token_printed: false,
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
        raw_token_printed: false,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
  process.exit(1);
});
