import { PrismaClient } from "@prisma/client";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { getUserForSessionToken } from "../src/lib/auth";
import {
  createStudentAccount,
  resetStudentAccessCode,
  setStudentAccountStatus
} from "../src/lib/services/student-accounts/service";
import { ensureRosterDemoTeacher } from "./demo-roster-fixture";

const prisma = new PrismaClient();
const prefix = `auth_status_smoke_${Date.now()}`;

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
  const ids = users.map((user) => user.id);

  await prisma.studentAccountEvent.deleteMany({ where: { student_user_db_id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function login(payload: Record<string, string>) {
  const response = await loginPost(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
  const token = response.headers.get("set-cookie")?.match(/cmcq_session=([^;]+)/)?.[1] ?? "";
  const body = await response.json().catch(() => null);

  return { response, token, body };
}

function assertNoPrivateAuthFields(body: unknown) {
  const serialized = JSON.stringify(body);

  assert(!serialized.includes("password_hash"), "Auth response included password hash.");
  assert(!serialized.includes("access_code_hash"), "Auth response included access-code hash.");
  assert(!serialized.includes("auth_version"), "Auth response included auth version.");
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(serialized), "Auth response included an internal UUID.");
}

async function main() {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "auth-account-status-smoke-session-secret-32";
  await cleanup();
  const teacher = await ensureRosterDemoTeacher(prisma);

  try {
    const created = await createStudentAccount({
      teacher_user_db_id: teacher.id,
      data: {
        user_id: `${prefix}_student`,
        display_name: "Auth Status Smoke"
      }
    });
    const userId = created.student.user_id;
    const code = created.one_time_credentials[0]?.temporary_access_code ?? "";

    const active = await login({ user_id: userId, access_code: code });
    assert(active.response.status === 200, "Active student login should work.");
    assertNoPrivateAuthFields(active.body);

    const teacherLogin = await login({
      user_id: "teacher_demo",
      password: "teacher_demo_password"
    });
    assert(teacherLogin.response.status === 200, "Teacher login should still work.");
    assertNoPrivateAuthFields(teacherLogin.body);

    const userIdOnly = await login({ user_id: userId });
    assert(userIdOnly.response.status !== 200, "user_id-only login must fail.");
    const bad = await login({ user_id: `${prefix}_missing`, access_code: code });
    assert(bad.response.status === 401, "Unknown user should receive neutral invalid credential status.");

    const reset = await resetStudentAccessCode({
      teacher_user_db_id: teacher.id,
      user_id: userId
    });
    const newCode = reset.one_time_credentials[0]?.temporary_access_code ?? "";
    assert((await getUserForSessionToken(active.token)) === null, "Old cookie should fail after reset.");
    assert((await login({ user_id: userId, access_code: code })).response.status === 401, "Old code should fail after reset.");
    assert((await login({ user_id: userId, access_code: newCode })).response.status === 200, "New code should work.");

    const beforeDeactivate = await login({ user_id: userId, access_code: newCode });
    await setStudentAccountStatus({
      teacher_user_db_id: teacher.id,
      user_id: userId,
      account_status: "inactive"
    });
    assert((await login({ user_id: userId, access_code: newCode })).response.status === 403, "Inactive login should fail.");
    assert(
      (await getUserForSessionToken(beforeDeactivate.token)) === null,
      "Old cookie should fail after deactivation."
    );

    await setStudentAccountStatus({
      teacher_user_db_id: teacher.id,
      user_id: userId,
      account_status: "active"
    });
    assert((await login({ user_id: userId, access_code: newCode })).response.status === 200, "Reactivated login should work.");

    console.log("Auth account-status smoke test passed.");
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
