import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { verifySecret } from "../src/lib/password";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { ensureRosterDemoTeacher } from "./demo-roster-fixture";
import { markStudentsMustChangePassword } from "./staging-mark-students-must-change-password-core";

const prisma = new PrismaClient();
const port = 3238;
const baseUrl = `http://localhost:${port}`;
const prefix = `teacher_student_account_smoke_${Date.now()}`;

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

  await prisma.studentAccountEvent.deleteMany({ where: { student_user_db_id: { in: userIds } } });
  await prisma.assessmentSession.deleteMany({ where: { user_db_id: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function waitForHealth(child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let exited = false;

  child.once("exit", () => {
    exited = true;
  });

  while (Date.now() - startedAt < 45_000) {
    if (exited) {
      throw new Error("Next dev server exited before health check passed.");
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.status === 200) {
        return;
      }
    } catch {
      // Server not ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Timed out waiting for Next dev server.");
}

async function login(payload: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const body = (await response.json().catch(() => null)) as
    | { user?: { user_id: string; role: string; must_change_password?: boolean } }
    | null;

  return { response, cookie, body };
}

async function jsonRequest<T>(path: string, cookie: string, init?: RequestInit): Promise<{
  response: Response;
  body: T | null;
  text: string;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie,
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : null;

  return { response, body, text };
}

async function textRequest(path: string, cookie: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init?.headers ?? {})
    },
    redirect: "manual"
  });
}

function assertNoPrivateAccountData(text: string, secrets: string[] = []) {
  assert(!text.includes("password_hash"), "Response exposed password_hash.");
  assert(!text.includes("access_code_hash"), "Response exposed access_code_hash.");
  assert(!text.includes("auth_version"), "Response exposed auth_version.");
  assert(!/SESSION_SECRET|OPENAI_API_KEY|DATABASE_URL|cmcq_session=/i.test(text), "Response exposed secret-like data.");

  for (const secret of secrets) {
    assert(!text.includes(secret), "Response exposed a one-time credential outside the immediate result.");
  }
}

async function main() {
  await cleanup();
  await ensureRosterDemoTeacher(prisma);
  const beforeAgentCalls = await prisma.agentCall.count();
  let output = "";
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "teacher-student-account-smoke-session-secret-32",
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: ""
    }
  });

  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  try {
    await waitForHealth(child);

    const teacher = await login({
      user_id: "teacher_demo",
      password: "teacher_demo_password"
    });
    assert(teacher.response.status === 200, "Teacher login should work.");

    const generatedStudentId = `${prefix}_generated`;
    const created = await jsonRequest<{
      student: {
        user_id: string;
        display_name: string | null;
        email: string | null;
        must_change_password: boolean;
      };
      one_time_credentials: Array<{
        temporary_access_code: string;
        temporary_password?: string;
      }>;
      credential_csv: string;
    }>("/api/teacher/students", teacher.cookie, {
      method: "POST",
      body: JSON.stringify({
        user_id: generatedStudentId,
        display_name: "Teacher Account Smoke",
        email: "teacher-account-smoke@example.edu",
        generate_password: true
      })
    });
    assert(created.response.status === 201, "Teacher should create a generated-password student.");
    const generatedCredential =
      created.body?.one_time_credentials[0]?.temporary_password ??
      created.body?.one_time_credentials[0]?.temporary_access_code ??
      "";
    assert(generatedCredential.length >= 14, "Generated credential should be high entropy.");
    assert(created.body?.student.must_change_password === true, "New student must change password.");
    assert(created.body?.student.email === "teacher-account-smoke@example.edu", "Optional email should be stored.");
    assert(created.body?.credential_csv.includes("temporary_access_code"), "Compatibility CSV column should remain.");
    assert(created.body?.credential_csv.includes("temporary_password"), "Temporary password CSV column should be present.");

    const stored = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(generatedStudentId) },
      select: {
        id: true,
        access_code_hash: true,
        password_hash: true,
        email: true,
        must_change_password: true
      }
    });
    assert(stored.access_code_hash !== generatedCredential, "Plaintext credential must not be stored.");
    assert(await verifySecret(generatedCredential, stored.access_code_hash), "Temporary credential should verify.");
    assert(stored.password_hash === null, "Permanent password should not be set before student changes it.");
    assert(stored.must_change_password, "Stored student should require password change.");

    const eventsAfterCreate = JSON.stringify(
      await prisma.studentAccountEvent.findMany({ where: { student_user_db_id: stored.id } })
    );
    assert(eventsAfterCreate.includes("teacher_student_account_created"), "Create event should be audited.");
    assert(!eventsAfterCreate.includes(generatedCredential), "Account events must not store plaintext credentials.");

    const laterDetail = await jsonRequest<unknown>(
      `/api/teacher/students/${encodeURIComponent(generatedStudentId)}`,
      teacher.cookie
    );
    assert(laterDetail.response.status === 200, "Teacher should fetch student detail.");
    assertNoPrivateAccountData(laterDetail.text, [generatedCredential]);

    const duplicate = await jsonRequest<unknown>("/api/teacher/students", teacher.cookie, {
      method: "POST",
      body: JSON.stringify({ user_id: generatedStudentId })
    });
    assert(duplicate.response.status === 409, "Duplicate student_id should be rejected.");

    const tempLogin = await login({ user_id: generatedStudentId, access_code: generatedCredential });
    assert(tempLogin.response.status === 200, "Student should log in with temporary credential.");
    assert(tempLogin.body?.user?.must_change_password === true, "Temporary login should indicate password change.");

    const studentPasswordPage = await textRequest("/student/assessment", tempLogin.cookie);
    assert(
      studentPasswordPage.status === 307 || studentPasswordPage.status === 308,
      "Student assessment page should redirect temporary-credential students."
    );
    assert(
      studentPasswordPage.headers.get("location")?.includes("/student/account/password"),
      "Temporary-credential students should be sent to password change before assessment access."
    );

    const blockedAssessmentList = await jsonRequest<{ error?: { code?: string } }>(
      "/api/student/assessments/available",
      tempLogin.cookie
    );
    assert(
      blockedAssessmentList.response.status === 403 &&
        blockedAssessmentList.body?.error?.code === "password_change_required",
      "Assessment list API should block students who must change password."
    );

    const blockedAssessmentStart = await jsonRequest<{ error?: { code?: string } }>(
      "/api/student/assessments/assessment_mvp_irt_theta_invariance/sessions/start",
      tempLogin.cookie,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );
    assert(
      blockedAssessmentStart.response.status === 403 &&
        blockedAssessmentStart.body?.error?.code === "password_change_required",
      "Assessment start API should block students who must change password."
    );

    const teacherApiWithStudent = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { cookie: tempLogin.cookie }
    });
    assert(teacherApiWithStudent.status === 403, "Student should receive 403 from teacher student-management API.");

    const teacherPasswordPage = await textRequest("/student/account/password", teacher.cookie);
    assert(
      teacherPasswordPage.status === 307 || teacherPasswordPage.status === 308,
      "Teacher users should not be routed through the student password-change page."
    );
    assert(
      teacherPasswordPage.headers.get("location")?.includes("/teacher/dashboard"),
      "Teacher users should be redirected to the teacher dashboard from student password-change page."
    );

    const permanentPassword = `${prefix}_PermanentPass9`;
    const passwordChange = await jsonRequest<{
      student: { must_change_password: boolean };
    }>("/api/student/account/password", tempLogin.cookie, {
      method: "POST",
      body: JSON.stringify({
        new_password: permanentPassword,
        confirm_new_password: permanentPassword
      })
    });
    assert(passwordChange.response.status === 200, "Student should change password after temporary login.");
    assert(passwordChange.body?.student.must_change_password === false, "Password-change response should clear must_change.");
    const changedCookie = passwordChange.response.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert(changedCookie, "Password change should refresh the session cookie.");

    assert((await login({ user_id: generatedStudentId, access_code: generatedCredential })).response.status === 401, "Old temporary credential should fail after password change.");
    assert((await login({ user_id: generatedStudentId, password: permanentPassword })).response.status === 200, "Permanent password should work.");

    const allowedAssessmentList = await jsonRequest<unknown>(
      "/api/student/assessments/available",
      changedCookie
    );
    assert(
      allowedAssessmentList.response.status === 200,
      "Student assessment list should be available after password change."
    );

    const afterChange = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(generatedStudentId) },
      select: { password_hash: true, access_code_hash: true, must_change_password: true, password_changed_at: true }
    });
    assert(afterChange.password_hash !== permanentPassword, "Permanent password must not be stored in plaintext.");
    assert(await verifySecret(permanentPassword, afterChange.password_hash), "Permanent password hash should verify.");
    assert(afterChange.access_code_hash === null, "Temporary credential hash should be cleared after password change.");
    assert(afterChange.password_changed_at, "Password changed timestamp should be recorded.");

    const reset = await jsonRequest<{
      student: { must_change_password: boolean };
      one_time_credentials: Array<{ temporary_access_code: string; temporary_password?: string }>;
    }>(`/api/teacher/students/${encodeURIComponent(generatedStudentId)}/reset-password`, teacher.cookie, {
      method: "POST",
      body: JSON.stringify({ generate_password: true })
    });
    assert(reset.response.status === 200, "Teacher should reset student password.");
    const resetCredential =
      reset.body?.one_time_credentials[0]?.temporary_password ??
      reset.body?.one_time_credentials[0]?.temporary_access_code ??
      "";
    assert(resetCredential && resetCredential !== generatedCredential, "Reset should return a new temporary credential.");
    assert(reset.body?.student.must_change_password === true, "Reset should require password change.");
    assert((await login({ user_id: generatedStudentId, password: permanentPassword })).response.status === 401, "Old permanent password should fail after reset.");
    assert((await login({ user_id: generatedStudentId, access_code: resetCredential })).response.status === 200, "Reset credential should work.");

    const secondStudent = await jsonRequest<{
      student: { user_id: string; email: string | null };
      one_time_credentials: Array<{ temporary_access_code: string }>;
    }>("/api/teacher/students", teacher.cookie, {
      method: "POST",
      body: JSON.stringify({
        user_id: `${prefix}_no_email`,
        display_name: "No Email Student"
      })
    });
    assert(secondStudent.response.status === 201, "Email should be optional on create.");
    assert(secondStudent.body?.student.email === null, "Missing email should serialize as null.");

    const secondStored = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(`${prefix}_no_email`) },
      select: {
        id: true,
        password_hash: true,
        access_code_hash: true,
        must_change_password: true
      }
    });
    assert(secondStored.must_change_password, "Second teacher-created student should require password change.");
    await prisma.user.update({
      where: { id: secondStored.id },
      data: { must_change_password: false }
    });
    const repairSummary = await markStudentsMustChangePassword(prisma, {
      enabled: true,
      studentUserId: `${prefix}_no_email`
    });
    assert(repairSummary.matched_student_count === 1, "Repair command should find the selected student.");
    assert(repairSummary.updated_student_count === 1, "Repair command should mark selected temporary student.");
    const repairedSecond = await prisma.user.findUniqueOrThrow({
      where: { id: secondStored.id },
      select: { must_change_password: true, password_hash: true, access_code_hash: true }
    });
    assert(repairedSecond.must_change_password, "Repair command should set must_change_password.");
    assert(repairedSecond.password_hash === null, "Repair command should not create or alter a password.");
    assert(repairedSecond.access_code_hash === secondStored.access_code_hash, "Repair command should not rotate temporary credentials.");

    await jsonRequest(`/api/teacher/students/${encodeURIComponent(generatedStudentId)}/deactivate`, teacher.cookie, {
      method: "POST"
    });
    assert((await login({ user_id: generatedStudentId, access_code: resetCredential })).response.status === 403, "Deactivated student should not log in.");
    const unavailableAssessment = await fetch(`${baseUrl}/api/student/assessments/available`, {
      headers: { cookie: changedCookie }
    });
    assert(unavailableAssessment.status !== 200, "Deactivated student cannot start or list assessments with an old session.");

    await jsonRequest(`/api/teacher/students/${encodeURIComponent(generatedStudentId)}/reactivate`, teacher.cookie, {
      method: "POST"
    });
    assert((await login({ user_id: generatedStudentId, access_code: resetCredential })).response.status === 200, "Reactivated student should log in with current reset credential.");

    const allEvents = JSON.stringify(
      await prisma.studentAccountEvent.findMany({ where: { student_user_db_id: stored.id } })
    );
    for (const eventType of [
      "teacher_student_account_created",
      "teacher_student_password_reset",
      "teacher_student_deactivated",
      "teacher_student_reactivated",
      "student_password_changed"
    ]) {
      assert(allEvents.includes(eventType), `${eventType} should be audited.`);
    }
    assertNoPrivateAccountData(allEvents, [generatedCredential, permanentPassword, resetCredential]);

    const safeList = await jsonRequest<unknown>(`/api/teacher/students?search=${prefix}`, teacher.cookie);
    assert(safeList.response.status === 200, "Teacher should list created students.");
    assertNoPrivateAccountData(safeList.text, [generatedCredential, permanentPassword, resetCredential]);
    assert(
      (await prisma.agentCall.count()) === beforeAgentCalls,
      "Teacher-student account smoke must not create LLM agent calls."
    );

    console.log("Teacher-managed student account smoke test passed. No OpenAI call was made.");
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
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
