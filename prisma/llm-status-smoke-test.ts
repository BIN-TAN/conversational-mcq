import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const port = 3215;
const baseUrl = `http://localhost:${port}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth(child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let childExited = false;

  child.once("exit", () => {
    childExited = true;
  });

  while (Date.now() - startedAt < 30_000) {
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

  return { response, cookie };
}

function assertNoSecrets(value: string, label: string) {
  assert(
    !/OPENAI_API_KEY=|SESSION_SECRET=|DATABASE_URL=|cmcq_session=|teacher_demo_password|student_demo_access_code|sk-[A-Za-z0-9_-]{12,}|postgresql:\/\//i.test(
      value
    ),
    `${label} exposed secret-like data.`
  );
}

async function main() {
  let output = "";
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
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

    const unauthenticated = await fetch(`${baseUrl}/api/teacher/system/llm-status`);
    assert(unauthenticated.status === 401, "Unauthenticated status request should return 401.");

    const student = await login({
      user_id: "student_demo",
      access_code: "student_demo_access_code"
    });
    assert(student.response.status === 200, "Student login failed.");
    const studentStatus = await fetch(`${baseUrl}/api/teacher/system/llm-status`, {
      headers: { cookie: student.cookie }
    });
    assert(studentStatus.status === 403, "Student status request should return 403.");

    const teacher = await login({
      user_id: "teacher_demo",
      password: "teacher_demo_password"
    });
    assert(teacher.response.status === 200, "Teacher login failed.");
    const teacherStatus = await fetch(`${baseUrl}/api/teacher/system/llm-status`, {
      headers: { cookie: teacher.cookie }
    });
    assert(teacherStatus.status === 200, "Teacher status request should return 200.");
    const statusText = await teacherStatus.text();
    const statusJson = JSON.parse(statusText) as {
      llm?: {
        provider?: string;
        usage?: unknown;
        agent_model_configured?: unknown;
      };
    };
    assert(statusJson.llm?.provider === "mock", "Status should show mock provider.");
    assert(statusJson.llm?.usage, "Status should include usage metadata.");
    assert(statusJson.llm?.agent_model_configured, "Status should include model metadata.");
    assertNoSecrets(statusText, "LLM status API");

    const page = await fetch(`${baseUrl}/teacher/system/llm`, {
      headers: { cookie: teacher.cookie }
    });
    assert(page.status === 200, "Teacher LLM system page should load.");
    const pageText = await page.text();
    assert(pageText.includes("LLM system status"), "LLM status page title missing.");
    assertNoSecrets(pageText, "LLM system page");

    console.log("LLM status smoke test passed.");
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
