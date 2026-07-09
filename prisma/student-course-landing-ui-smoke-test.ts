import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { ensureRosterDemoTeacher } from "./demo-roster-fixture";

const prisma = new PrismaClient();
const port = 3239;
const baseUrl = `http://localhost:${port}`;
const tempStudentUserId = `course_landing_password_gate_${Date.now().toString(36)}`;
const tempStudentCredential = "course-landing-password-gate-temp";

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

async function loginStudent() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: tempStudentUserId,
      access_code: tempStudentCredential
    })
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";

  return { response, cookie };
}

function assertLandingIsCourseFacing(html: string) {
  assert(html.includes("EDPY 507: Measurement Theory"), "Landing page should show the course title.");
  assert(html.includes("EDPY 507 course activity"), "Landing page should show the course activity label.");
  assert(html.includes("University of Alberta"), "Landing page should include accessible UAlberta logo alt text.");
  assert(
    html.includes("ualberta-logo.png") || html.includes("%2Fbrand%2Fualberta-logo.png"),
    "Landing page should include the authorized UAlberta logo asset."
  );
  assert(html.includes("Student Access"), "Landing page should include the student access entry.");
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

function visibleHtmlText(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[\s\S]*?<\/style>/giu, "")
    .replace(/<[^>]+>/gu, " ");
}

async function assertThemeTokensExist() {
  const [globalsCss, tailwindConfig, logoAsset] = await Promise.all([
    readFile("src/app/globals.css", "utf8"),
    readFile("tailwind.config.ts", "utf8"),
    readFile("public/brand/ualberta-logo.png")
  ]);
  const combined = `${globalsCss}\n${tailwindConfig}`;

  assert(logoAsset.byteLength > 0, "Authorized UAlberta logo asset should be committed under public/brand.");

  for (const token of [
    "#275D38",
    "#007C41",
    "#FFDB05",
    "#F2CD00",
    "ualberta-green-dark",
    "ualberta-gold"
  ]) {
    assert(combined.includes(token), `UAlberta-inspired theme token missing: ${token}`);
  }
}

async function createTemporaryStudent() {
  await prisma.user.create({
    data: {
      user_id: tempStudentUserId,
      user_id_normalized: normalizeUserId(tempStudentUserId),
      role: "student",
      account_status: "active",
      access_code_hash: await hashSecret(tempStudentCredential),
      password_hash: null,
      must_change_password: true
    }
  });
}

async function cleanupTemporaryStudent() {
  const user = await prisma.user.findUnique({
    where: { user_id_normalized: normalizeUserId(tempStudentUserId) },
    select: { id: true }
  });

  if (!user) {
    return;
  }

  await prisma.studentAccountEvent.deleteMany({ where: { student_user_db_id: user.id } });
  await prisma.assessmentSession.deleteMany({ where: { user_db_id: user.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";

  await ensureRosterDemoTeacher(prisma);
  await cleanupTemporaryStudent();
  await createTemporaryStudent();
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
    await assertThemeTokensExist();

    const studentLogin = await fetch(`${baseUrl}/student/login`);
    assert(studentLogin.status === 200, "Student login page should load.");
    const studentLoginHtml = await studentLogin.text();
    assert(studentLoginHtml.includes("Course access"), "Student login should use course-facing copy.");
    assert(studentLoginHtml.includes("University of Alberta"), "Student login should include accessible UAlberta logo alt text.");
    assert(
      studentLoginHtml.includes("ualberta-logo.png") || studentLoginHtml.includes("%2Fbrand%2Fualberta-logo.png"),
      "Student login should include the authorized UAlberta logo asset."
    );
    assert(!/prototype|project shell|scaffold|placeholder/i.test(studentLoginHtml), "Student login should not contain scaffold copy.");

    const student = await loginStudent();
    assert(student.response.status === 200, "Temporary student login should work.");
    const passwordPage = await fetch(`${baseUrl}/student/account/password`, {
      headers: { cookie: student.cookie }
    });
    assert(passwordPage.status === 200, "First-login password-change page should load.");
    const passwordPageHtml = await passwordPage.text();
    const visiblePasswordText = visibleHtmlText(passwordPageHtml);
    assert(passwordPageHtml.includes("University of Alberta"), "Password page should include accessible UAlberta logo alt text.");
    assert(
      passwordPageHtml.includes("ualberta-logo.png") || passwordPageHtml.includes("%2Fbrand%2Fualberta-logo.png"),
      "Password page should include the authorized UAlberta logo asset."
    );
    assert(visiblePasswordText.includes("Choose a new password"), "Password page should use first-login heading.");
    assert(visiblePasswordText.includes("Please choose a new password before continuing."), "Password page should use student-safe first-login copy.");
    assert(!/must_change_password|password_hash|access_code_hash/i.test(visiblePasswordText), "Password page exposed internal auth fields.");

    const teacher = await loginTeacher();
    assert(teacher.response.status === 200, "Teacher login should work.");
    assert(teacher.body?.user?.role === "teacher_researcher", "Teacher login should return teacher role.");
    assert(teacher.cookie, "Teacher login should set a session cookie.");

    const dashboard = await fetch(`${baseUrl}/teacher/dashboard`, {
      headers: { cookie: teacher.cookie }
    });
    assert(dashboard.status === 200, "Teacher dashboard should load after login.");
    const dashboardHtml = await dashboard.text();
    assert(dashboardHtml.includes("University of Alberta"), "Teacher dashboard should include accessible UAlberta logo alt text.");
    assert(
      dashboardHtml.includes("ualberta-logo.png") || dashboardHtml.includes("%2Fbrand%2Fualberta-logo.png"),
      "Teacher dashboard should include the authorized UAlberta logo asset."
    );
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
          authorized_university_of_alberta_logo_present: true,
          official_logo_asset_path: "/brand/ualberta-logo.png",
          student_access_entry_present: true,
          instructor_entry_present: true,
          ualberta_theme_tokens_present: true,
          student_password_change_page_verified: true,
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
    await cleanupTemporaryStudent();
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
