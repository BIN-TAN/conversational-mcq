import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();
const port = 3227;
const baseUrl = `http://localhost:${port}`;
const prefix = `account_ui_smoke_${Date.now()}`;
const rosterSourceFileName = "student-account-ui-smoke.csv";

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
  await prisma.user.deleteMany({
    where: { id: { in: userIds } }
  });
  await prisma.rosterImportBatch.deleteMany({
    where: { source_file_name: rosterSourceFileName }
  });
}

async function waitForHealth(child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let childExited = false;

  child.once("exit", () => {
    childExited = true;
  });

  while (Date.now() - startedAt < 45_000) {
    if (childExited) {
      throw new Error("Next dev server exited before health check passed.");
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.status === 200) {
        return;
      }
    } catch {
      // Server not ready yet.
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
  const body = await response.text();

  return { response, cookie, body };
}

async function jsonRequest<T>(path: string, cookie: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie,
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }

  return JSON.parse(text) as T;
}

function assertNoPrivateData(text: string, label: string) {
  assert(!text.includes("password_hash"), `${label} exposed password_hash.`);
  assert(!text.includes("access_code_hash"), `${label} exposed access_code_hash.`);
  assert(!text.includes("auth_version"), `${label} exposed auth_version.`);
  assert(!/SESSION_SECRET|OPENAI_API_KEY|DATABASE_URL|cmcq_session=/i.test(text), `${label} exposed secret-like data.`);
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text), `${label} exposed an internal UUID.`);
}

async function main() {
  await cleanup();
  await ensureTeacherReviewDemoUsers(prisma);
  const beforeAgentCalls = await prisma.agentCall.count();
  let output = "";
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "student-account-ui-smoke-session-secret-32",
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
    const student = await login({
      user_id: "student_demo",
      access_code: "student_demo_access_code"
    });
    assert(student.response.status === 200, "Student login should work.");

    for (const path of ["/teacher/students", "/teacher/students/new", "/teacher/students/import"]) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: teacher.cookie } });
      const text = await response.text();

      assert(response.status === 200, `${path} should render for teacher.`);
      assert(text.includes("Student") || text.includes("Roster"), `${path} did not render expected page copy.`);
    }

    const created = await jsonRequest<{
      student: { user_id: string };
      one_time_credentials: Array<{ temporary_access_code: string }>;
      credential_csv: string;
    }>("/api/teacher/students", teacher.cookie, {
      method: "POST",
      body: JSON.stringify({
        user_id: `${prefix}_created`,
        display_name: "Account UI Created"
      })
    });
    const createdCode = created.one_time_credentials[0]?.temporary_access_code ?? "";
    assert(createdCode.length >= 14, "Create response should include a high-entropy one-time code.");
    assert(created.credential_csv.includes("temporary_access_code"), "Credential CSV should be generated.");

    const listText = JSON.stringify(
      await jsonRequest(`/api/teacher/students?search=${prefix}_created`, teacher.cookie)
    );
    assert(listText.includes(`${prefix}_created`), "Search should find created student.");
    assertNoPrivateData(listText, "Student list API");

    const rosterPreview = await jsonRequest<{
      batch_public_id: string;
      new_student_rows: number;
      invalid_rows: number;
      preview_rows: unknown[];
    }>("/api/teacher/students/import/preview", teacher.cookie, {
      method: "POST",
      body: JSON.stringify({
        source_file_name: rosterSourceFileName,
        csv_text: [
          "user_id,display_name",
          `${prefix}_roster_valid,Roster Valid`,
          ` ${prefix}_bad,Roster Invalid`
        ].join("\n")
      })
    });
    assert(rosterPreview.new_student_rows === 1, "Roster preview should show one valid student.");
    assert(rosterPreview.invalid_rows === 1, "Roster preview should show invalid rows.");

    const rosterCommit = await jsonRequest<{
      one_time_credentials: Array<{ user_id: string; temporary_access_code: string }>;
    }>(`/api/teacher/students/import/${rosterPreview.batch_public_id}/commit`, teacher.cookie, {
      method: "POST",
      body: JSON.stringify({ apply_display_name_updates: false })
    });
    assert(rosterCommit.one_time_credentials.length === 1, "Roster commit should show new credentials once.");

    const detail = await jsonRequest(
      `/api/teacher/students/${encodeURIComponent(created.student.user_id)}`,
      teacher.cookie
    );
    const detailText = JSON.stringify(detail);
    assert(detailText.includes("Account UI Created"), "Student detail should load.");
    assert(!detailText.includes(createdCode), "One-time code should be absent from later detail API.");
    assertNoPrivateData(detailText, "Student detail API");

    await jsonRequest(`/api/teacher/students/${encodeURIComponent(created.student.user_id)}`, teacher.cookie, {
      method: "PATCH",
      body: JSON.stringify({ display_name: "Account UI Updated" })
    });
    const reset = await jsonRequest<{
      one_time_credentials: Array<{ temporary_access_code: string }>;
    }>(
      `/api/teacher/students/${encodeURIComponent(created.student.user_id)}/reset-access-code`,
      teacher.cookie,
      { method: "POST" }
    );
    assert(reset.one_time_credentials[0]?.temporary_access_code, "Reset should return one-time code.");
    await jsonRequest(
      `/api/teacher/students/${encodeURIComponent(created.student.user_id)}/deactivate`,
      teacher.cookie,
      { method: "POST" }
    );
    await jsonRequest(
      `/api/teacher/students/${encodeURIComponent(created.student.user_id)}/reactivate`,
      teacher.cookie,
      { method: "POST" }
    );

    const pageAfterActions = await fetch(
      `${baseUrl}/teacher/students/${encodeURIComponent(created.student.user_id)}`,
      { headers: { cookie: teacher.cookie } }
    );
    const pageText = await pageAfterActions.text();
    assert(pageAfterActions.status === 200, "Student detail page should render.");
    assert(pageText.includes("Student detail"), "Student detail page title missing.");
    assert(!pageText.includes(createdCode), "Plaintext code should be absent after leaving one-time result.");

    const studentPage = await fetch(`${baseUrl}/teacher/students`, {
      headers: { cookie: student.cookie },
      redirect: "manual"
    });
    assert(
      studentPage.status === 307 || studentPage.status === 308,
      "Student should be redirected away from teacher student pages."
    );
    const studentApi = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { cookie: student.cookie }
    });
    assert(studentApi.status === 403, "Student should receive 403 from student-account API.");
    assert(
      (await prisma.agentCall.count()) === beforeAgentCalls,
      "Student account UI smoke must not create LLM agent calls."
    );

    console.log("Student account UI smoke test passed.");
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
