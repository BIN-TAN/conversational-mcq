import { PrismaClient } from "@prisma/client";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { getUserForSessionToken } from "../src/lib/auth";
import { verifySecret } from "../src/lib/password";
import {
  createStudentAccount,
  resetStudentAccessCode,
  setStudentAccountStatus,
  updateStudentAccount
} from "../src/lib/services/student-accounts/service";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { ensureRosterDemoTeacher } from "./demo-roster-fixture";

const prisma = new PrismaClient();
const prefix = `account_smoke_${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { user_id: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  await prisma.studentAccountEvent.deleteMany({
    where: { student_user_db_id: { in: userIds } }
  });
  await prisma.assessmentSession.deleteMany({
    where: { user_db_id: { in: userIds } }
  });
  await prisma.user.deleteMany({
    where: { id: { in: userIds } }
  });
  await prisma.assessment.deleteMany({
    where: { assessment_public_id: { startsWith: prefix } }
  });
}

async function login(payload: Record<string, string>) {
  const response = await loginPost(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
  const cookie = response.headers.get("set-cookie") ?? "";
  const token = cookie.match(/cmcq_session=([^;]+)/)?.[1] ?? "";
  const body = (await response.json().catch(() => null)) as unknown;

  return { response, token, body };
}

function assertPublicAuthBody(body: unknown) {
  const serialized = JSON.stringify(body);

  assert(!serialized.includes("password_hash"), "Auth response exposed password hash.");
  assert(!serialized.includes("access_code_hash"), "Auth response exposed access-code hash.");
  assert(!serialized.includes("auth_version"), "Auth response exposed auth_version.");
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(serialized), "Auth response exposed an internal UUID.");
}

async function main() {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "student-account-smoke-session-secret-32";
  await cleanup();
  const beforeAgentCalls = await prisma.agentCall.count();
  const teacher = await ensureRosterDemoTeacher(prisma);

  try {
    const userId = `${prefix}_student`;
    const created = await createStudentAccount({
      teacher_user_db_id: teacher.id,
      data: {
        user_id: userId,
        display_name: "Account Smoke Student"
      }
    });
    const firstCode = created.one_time_credentials[0]?.temporary_access_code;
    assert(firstCode, "Create should return a one-time access code.");

    const stored = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(userId) },
      select: {
        id: true,
        user_id: true,
        user_id_normalized: true,
        access_code_hash: true,
        auth_version: true,
        display_name: true
      }
    });
    assert(stored.user_id === userId, "Canonical user_id should be preserved.");
    assert(stored.user_id_normalized === normalizeUserId(userId), "Normalized user_id should be stored.");
    assert(stored.access_code_hash !== firstCode, "Plaintext code must not be stored.");
    assert(await verifySecret(firstCode, stored.access_code_hash), "Returned code should verify.");

    const eventText = JSON.stringify(
      await prisma.studentAccountEvent.findMany({ where: { student_user_db_id: stored.id } })
    );
    assert(!eventText.includes(firstCode), "Plaintext code must not be stored in account events.");

    const canonicalLogin = await login({ user_id: userId, access_code: firstCode });
    assert(canonicalLogin.response.status === 200, "Student should log in with canonical user_id.");
    assertPublicAuthBody(canonicalLogin.body);
    assert(await getUserForSessionToken(canonicalLogin.token), "Fresh cookie should be current.");

    const caseLogin = await login({ user_id: userId.toUpperCase(), access_code: firstCode });
    assert(caseLogin.response.status === 200, "Student should log in with case-variant user_id.");

    const userIdOnly = await login({ user_id: userId });
    assert(userIdOnly.response.status !== 200, "Login with user_id alone must fail.");

    const badCode = await login({ user_id: userId, access_code: "wrong-code" });
    assert(badCode.response.status === 401, "Incorrect access code should fail.");

    await updateStudentAccount({
      teacher_user_db_id: teacher.id,
      user_id: userId,
      data: { display_name: "Updated Smoke Name" }
    });
    const updatedName = await prisma.user.findUniqueOrThrow({
      where: { id: stored.id },
      select: { display_name: true, user_id: true }
    });
    assert(updatedName.display_name === "Updated Smoke Name", "Display name should update.");
    assert(updatedName.user_id === userId, "Display-name update must not change user_id.");

    let rejectedUserIdUpdate = false;
    try {
      await updateStudentAccount({
        teacher_user_db_id: teacher.id,
        user_id: userId,
        data: { display_name: "Bad", user_id: "changed" } as unknown as { display_name: string }
      });
    } catch {
      rejectedUserIdUpdate = true;
    }
    assert(rejectedUserIdUpdate, "User ID update payload should be rejected.");

    const reset = await resetStudentAccessCode({
      teacher_user_db_id: teacher.id,
      user_id: userId
    });
    const newCode = reset.one_time_credentials[0]?.temporary_access_code;
    assert(newCode && newCode !== firstCode, "Reset should return a new access code.");
    const afterReset = await prisma.user.findUniqueOrThrow({
      where: { id: stored.id },
      select: { auth_version: true, access_code_hash: true }
    });
    assert(afterReset.auth_version === stored.auth_version + 1, "Reset should increment auth_version.");
    assert(await verifySecret(newCode, afterReset.access_code_hash), "New code should verify.");
    assert((await login({ user_id: userId, access_code: firstCode })).response.status === 401, "Old code should fail after reset.");
    assert((await login({ user_id: userId, access_code: newCode })).response.status === 200, "New code should work.");
    assert(
      (await getUserForSessionToken(canonicalLogin.token)) === null,
      "Old cookie should be invalid after access-code reset."
    );

    const currentLogin = await login({ user_id: userId, access_code: newCode });
    const sessionCountBefore = await prisma.assessmentSession.count({ where: { user_db_id: stored.id } });
    await setStudentAccountStatus({
      teacher_user_db_id: teacher.id,
      user_id: userId,
      account_status: "inactive"
    });
    assert(
      (await login({ user_id: userId, access_code: newCode })).response.status === 403,
      "Inactive student login should fail."
    );
    assert(
      (await getUserForSessionToken(currentLogin.token)) === null,
      "Deactivation should invalidate existing cookie."
    );
    assert(
      (await prisma.assessmentSession.count({ where: { user_db_id: stored.id } })) === sessionCountBefore,
      "Deactivation should preserve assessment sessions."
    );

    await setStudentAccountStatus({
      teacher_user_db_id: teacher.id,
      user_id: userId,
      account_status: "active"
    });
    assert(
      (await login({ user_id: userId, access_code: newCode })).response.status === 200,
      "Reactivation should restore login with current code."
    );

    let teacherModified = false;
    try {
      await resetStudentAccessCode({
        teacher_user_db_id: teacher.id,
        user_id: "teacher_demo"
      });
      teacherModified = true;
    } catch {
      teacherModified = false;
    }
    assert(!teacherModified, "Teacher account should not be modified through student action.");
    assert(
      (await prisma.agentCall.count()) === beforeAgentCalls,
      "Student account smoke must not create LLM agent calls."
    );

    console.log("Student account smoke test passed. No LLM call was made.");
  } finally {
    await cleanup();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
