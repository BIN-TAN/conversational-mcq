import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_login_flow_"));
const db = new PrismaClient();
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const output = await mkdtemp(join(tmpdir(), "cmcq-login-progression-"));
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: { ...process.env, SESSION_SECRET: "classroom-login-progression-synthetic-secret", APP_ENV: "development",
    LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", ITEM_ADMIN_TUTOR_MODE: "mock", ALLOW_LOCAL_MOCK_RUNTIME: "true",
    ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true", OPERATIONAL_AGENT_MODE: "disabled", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "" },
  stdio: "ignore"
});
const exited = new Promise(done => server.once("exit", done));
let browser;
try {
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(base + "/student/login")).ok) break; } catch { /* Local startup. */ }
    await new Promise(done => setTimeout(done, 500));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(base);
  await page.getByRole("link", { name: "Instructor Dashboard" }).click();
  await page.getByLabel("Username", { exact: true }).fill("teacher_demo");
  await page.getByLabel("Access code or password").fill("teacher_demo_password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/teacher/dashboard");
  await page.getByRole("heading", { name: "Assessment dashboard" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Assessment dashboard" }).waitFor();
  await page.screenshot({ path: join(output, "teacher-login.png") });
  console.log("PASS: instructor entry, first sign-in redirects to dashboard, refresh stays signed in");

  const student = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await student.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const demo = await db.user.findUniqueOrThrow({ where: { user_id_normalized: "student_demo" } });
  const userId = `browser_progression_${Date.now()}`;
  await db.user.create({ data: { user_id: userId, user_id_normalized: userId,
    role: "student", account_status: "active", access_code_hash: demo.access_code_hash,
    created_by_teacher_user_id: demo.created_by_teacher_user_id } });
  const chat = await student.newPage();
  chat.setDefaultTimeout(20000);
  chat.on("pageerror", error => errors.push(String(error)));
  await chat.goto(base + "/student/login");
  await chat.getByLabel("Username", { exact: true }).fill(userId);
  await chat.getByLabel("Access code or password").fill("student_demo_access_code");
  await chat.getByRole("button", { name: "Sign in", exact: true }).click();
  await chat.waitForURL("**/student/assessment");
  const started = await chat.evaluate(async () => {
    const response = await fetch("/api/student/assessments/assessment_mvp_irt_theta_invariance/sessions/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    return { ok: response.ok, body: await response.json() };
  });
  assert(started.ok, JSON.stringify(started.body));
  const sessionId = started.body.session.session_public_id;
  await chat.goto(`${base}/student/assessment/${sessionId}`);
  const begin = chat.getByTestId("begin-concept-unit");
  await begin.waitFor(); await begin.click();
  for (let item = 0; item < 2; item++) {
    await chat.locator('[data-testid^="chat-option-card-"]').first().click();
    await chat.getByTestId("reasoning-input").fill("I think difficulty changes the ability estimate because harder test questions are more challenging.");
    await chat.getByTestId("reasoning-input-send").click();
    await chat.getByTestId("chat-confidence-medium").click();
    await chat.locator('[data-testid^="chat-tempting-option-"]').first().click();
    await chat.getByTestId("tempting-reason-input").waitFor();
    if (item === 0) {
      await chat.getByTestId("in-flow-edit-tempting").click();
      await chat.getByTestId("in-flow-edit-tempting-reason-input").fill("This option also seemed to describe item difficulty.");
      await chat.getByTestId("in-flow-edit-save").click();
    } else {
      const session = await db.assessmentSession.findUniqueOrThrow({ where: { session_public_id: sessionId } });
      const response = await db.itemResponse.findFirstOrThrow({ where: { concept_unit_session: { assessment_session_db_id: session.id }, item_submitted_at: null } });
      await db.conversationTurn.create({ data: { assessment_session_db_id: session.id,
        concept_unit_session_db_id: response.concept_unit_session_db_id, item_db_id: response.item_db_id,
        actor_type: "student", phase: "initial_item_administration", message_text: "No other option was tempting.",
        structured_payload: { source: "initial_tempting_option", no_tempting_option: true } } });
      await chat.reload();
    }
    await chat.locator('[data-testid^="chat-option-card-"]').first().waitFor();
  }
  await chat.screenshot({ path: join(output, "student-next-item-mobile.png"), fullPage: true });
  assert.equal(await chat.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  console.log("PASS: mobile edit advances, reload recovers old stuck state, no horizontal overflow or browser errors");
  await writeFile(join(output, "results.json"), JSON.stringify({ passed: true, errors, sessionId }));
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close(); await db.$disconnect(); server.kill("SIGTERM"); await exited;
}
