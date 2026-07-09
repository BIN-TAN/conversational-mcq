import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { ensureRosterDemoTeacher } from "./demo-roster-fixture";

const prisma = new PrismaClient();
const port = 3239;
const baseUrl = `http://localhost:${port}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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

async function loginTeacher() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: "teacher_demo",
      password: "teacher_demo_password"
    })
  });
  const body = (await response.json().catch(() => null)) as
    | { user?: { role?: string; user_id?: string } }
    | null;
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";

  return { response, body, cookie };
}

function assertLandingIsCourseFacing(html: string) {
  assert(html.includes("EDPY 507: Measurement Theory"), "Landing page should show the course title.");
  assert(html.includes("EDPY 507 course activity"), "Landing page should show the course activity label.");
  assert(html.includes("Student Login"), "Landing page should include the student login entry.");
  assert(html.includes("Instructor Dashboard"), "Landing page should include the instructor dashboard entry.");

  for (const forbidden of [
    "prototype",
    "project shell",
    "scaffold",
    "placeholder",
    "Assessment Shell",
    "later phases",
    "answer key",
    "correct option",
    "correctness"
  ]) {
    assert(!html.toLowerCase().includes(forbidden.toLowerCase()), `Landing page still contains ${forbidden}.`);
  }
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";

  await ensureRosterDemoTeacher(prisma);
  const beforeAgentCalls = await prisma.agentCall.count();
  let output = "";
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "course-landing-ui-smoke-session-secret-32",
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

    const landing = await fetch(`${baseUrl}/`);
    assert(landing.status === 200, "Landing page should load.");
    assertLandingIsCourseFacing(await landing.text());

    const studentLogin = await fetch(`${baseUrl}/student/login`);
    assert(studentLogin.status === 200, "Student login page should load.");
    const studentLoginHtml = await studentLogin.text();
    assert(studentLoginHtml.includes("Course access"), "Student login should use course-facing copy.");
    assert(!/prototype|project shell|scaffold|placeholder/i.test(studentLoginHtml), "Student login should not contain scaffold copy.");

    const teacher = await loginTeacher();
    assert(teacher.response.status === 200, "Teacher login should work.");
    assert(teacher.body?.user?.role === "teacher_researcher", "Teacher login should return teacher role.");
    assert(teacher.cookie, "Teacher login should set a session cookie.");

    const dashboard = await fetch(`${baseUrl}/teacher/dashboard`, {
      headers: { cookie: teacher.cookie }
    });
    assert(dashboard.status === 200, "Teacher dashboard should load after login.");
    const dashboardHtml = await dashboard.text();
    assert(dashboardHtml.includes("Log out"), "Teacher dashboard should include a logout control.");
    assert(!/password_hash|access_code_hash|SESSION_SECRET|OPENAI_API_KEY|DATABASE_URL/i.test(dashboardHtml), "Teacher dashboard exposed protected data.");

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: teacher.cookie }
    });
    assert(logout.status === 200, "Logout API should return success.");
    const clearedCookie = logout.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert(clearedCookie.startsWith("cmcq_session="), "Logout should clear the session cookie.");

    const protectedAfterLogout = await fetch(`${baseUrl}/teacher/dashboard`, {
      headers: { cookie: clearedCookie },
      redirect: "manual"
    });
    assert(
      protectedAfterLogout.status === 307 || protectedAfterLogout.status === 308,
      "Protected teacher page should redirect after logout."
    );

    const landingAfterLogout = await fetch(`${baseUrl}/`);
    assert(landingAfterLogout.status === 200, "Course landing page should remain available after logout.");
    assertLandingIsCourseFacing(await landingAfterLogout.text());

    assert(
      (await prisma.agentCall.count()) === beforeAgentCalls,
      "Course landing UI smoke must not create LLM agent calls."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          landing_course_title_present: true,
          prototype_copy_removed: true,
          student_entry_present: true,
          instructor_entry_present: true,
          teacher_logout_control_present: true,
          teacher_protected_route_blocked_after_logout: true,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
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
