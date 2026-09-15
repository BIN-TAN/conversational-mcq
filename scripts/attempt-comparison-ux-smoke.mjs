import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { assertLocalAttemptTest, createAttemptPolicyFixture, createRecordedAttempt } from "../prisma/attempt-policy-fixture.ts";
import { hashSecret } from "../src/lib/password.ts";

assertLocalAttemptTest();
const db = new PrismaClient();
const output = resolve("outputs/attempt-comparison-2026-09-15");
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const secret = "attempt-comparison-local-only-session-secret";
const keepPreview = process.argv.includes("--preview");
let server, browser, passed = false;
function cookie(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ user_db_id: user.id, user_id: user.user_id, role: user.role,
    auth_version: user.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  return { name: "cmcq_session", value: `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`,
    url: base, httpOnly: true, sameSite: "Lax" };
}
try {
  const f = await createAttemptPolicyFixture(db, `attempt_preview_${Date.now()}`);
  await db.assessment.update({ where: { id: f.assessment.id }, data: { title: "Measurement concepts" } });
  await db.user.update({ where: { id: f.teacher.id }, data: { password_hash: await hashSecret("LocalPreview123!") } });
  for (const [student, attempt, choice] of [[0,1,"B"],[0,2,"A"],[0,3,"A"],[1,1,"A"],[1,2,"B"],[1,3,null],[2,1,"B"]]) {
    await createRecordedAttempt(db, f, student, attempt, choice);
  }
  const counts = async () => ({ sessions: await db.assessmentSession.count(), packages: await db.responsePackage.count(),
    responses: await db.itemResponse.count(), events: await db.processEvent.count(), calls: await db.agentCall.count() });
  const before = await counts();
  const fd = openSync(`${output}/server.log`, "w", 0o600);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    detached: keepPreview, stdio: ["ignore", fd, fd], env: { ...process.env, NODE_ENV: "production", APP_ENV: "development",
      SESSION_SECRET: secret, OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "", LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false",
      FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", OPERATIONAL_AGENT_MODE: "disabled", NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` }
  });
  closeSync(fd);
  server.exited = new Promise(done => server.once("exit", done));
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { if ((await fetch(`${base}/student/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, "Preview server did not start");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies([cookie(f.teacher)]);
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const comparisonUrl = `/api/teacher/dashboard/attempts?assessment_public_id=${f.assessment.assessment_public_id}`;
  await page.goto(`${base}/teacher/dashboard`);
  await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Overview", exact: true }).getAttribute("aria-selected"), "true");
  await page.screenshot({ path: `${output}/overview-desktop.png`, fullPage: true });
  let failOnce = true;
  await page.route("**/api/teacher/dashboard/attempts?**", route => {
    if (failOnce) { failOnce = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Temporary comparison failure" } }) }); }
    return route.continue();
  });
  await page.getByRole("tab", { name: "Overview", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("region", { name: "Class results by attempt", exact: true }).waitFor();
  assert.equal(await page.locator("details[open]").count(), 0);
  const result = await (await context.request.get(`${base}${comparisonUrl}`)).json();
  assert.deepEqual(result.comparison.columns.map(row => row.student_count), [3, 2, 1, 3]);
  assert(!JSON.stringify(result).includes(f.students[0].user_id));
  assert(!JSON.stringify(result).includes("scoring_key"));
  const loaded = async () => page.getByRole("region", { name: "Class results by attempt", exact: true }).waitFor();
  const choose = async (name, option) => {
    const response = page.waitForResponse(response => response.url().includes("/dashboard/attempts?"));
    await page.getByRole("combobox", { name, exact: true }).selectOption(option);
    assert.equal((await response).status(), 200); await loaded();
  };
  await choose("Students", "matched");
  await page.getByText("2 students in comparison; 1 incomplete attempt", { exact: true }).waitFor();
  await choose("Compare", "2-3");
  await choose("Learning objective", f.concept.learning_objective);
  await page.getByRole("checkbox", { name: "Submitted all three" }).check();
  await loaded();
  await page.getByText("1 student in comparison; 0 incomplete attempts", { exact: true }).waitFor();
  await page.getByRole("checkbox", { name: "Submitted all three" }).uncheck();
  await loaded();
  await choose("Students", "all");
  await choose("Compare", "1-2");
  await choose("Learning objective", "");
  await page.screenshot({ path: `${output}/comparison-desktop.png`, fullPage: true });
  await page.screenshot({ path: `${output}/comparison-desktop-viewport.png` });
  await page.locator("summary").filter({ hasText: "1. Example" }).click();
  await page.getByRole("heading", { name: "Same-student answer changes" }).first().waitFor();
  await page.screenshot({ path: `${output}/item-comparison-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/comparison-mobile.png`, fullPage: true });
  await page.screenshot({ path: `${output}/comparison-mobile-viewport.png` });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Comparison overflows mobile viewport");
  const studentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await studentContext.addCookies([cookie(f.students[0])]);
  await studentContext.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const studentPage = await studentContext.newPage();
  await studentPage.goto(`${base}/student/assessment`);
  await studentPage.getByText("All three chances used. Previous attempts remain available for review.", { exact: true }).waitFor();
  assert.equal(await studentPage.getByRole("button", { name: "Start another attempt", exact: true }).count(), 0);
  await studentPage.getByRole("button", { name: "Review previous attempts", exact: true }).click();
  await studentPage.screenshot({ path: `${output}/student-history-mobile.png`, fullPage: true });
  const denied = await studentContext.request.get(`${base}${comparisonUrl}`);
  assert([401,403].includes(denied.status()));
  assert.deepEqual(await counts(), before, "Read-only comparisons and history must not write research evidence or call providers");
  const terminalId = `${f.assessment.assessment_public_id}_1_2`;
  const sessionPage = await context.newPage();
  await sessionPage.goto(`${base}/teacher/sessions/${terminalId}`);
  await sessionPage.getByRole("button", { name: "Restore a chance", exact: true }).click();
  assert(await sessionPage.getByRole("button", { name: "Confirm restoration", exact: true }).isDisabled());
  await sessionPage.getByRole("textbox", { name: "Technical problem", exact: true }).fill("Synthetic local browser interruption");
  await sessionPage.getByRole("button", { name: "Confirm restoration", exact: true }).click();
  await sessionPage.getByText("One chance restored. 1 chance remaining. The original attempt is preserved.", { exact: true }).waitFor();
  assert.equal(await db.agentCall.count(), before.calls);
  assert.equal(await db.responsePackage.count(), before.packages);
  assert.deepEqual(errors, []);
  passed = true;
  const report = { passed, preview_url: `${base}/teacher/dashboard`, preview_pid: server.pid,
    local_teacher: f.teacher.user_id, local_password: "LocalPreview123!", screenshots: output,
    checks: ["overview default", "keyboard tabs", "retry on failure", "cohort and pair filters", "objective filter", "collapsed item details",
      "desktop/mobile", "no mobile overflow", "three-chance student history", "teacher-only API", "technical restoration", "no AI calls", "research evidence preserved"] };
  await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  if (keepPreview && passed) server.unref();
  else if (server && server.exitCode === null) { server.kill("SIGTERM"); await server.exited; }
  await db.$disconnect();
}
