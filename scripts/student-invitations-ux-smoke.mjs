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
import { stringify } from "csv-stringify/sync";
import { assertLocalAttemptTest } from "../prisma/attempt-policy-fixture.ts";
import { hashSecret } from "../src/lib/password.ts";

assertLocalAttemptTest();
const db = new PrismaClient();
const output = resolve("outputs/student-invitations-2026-09-15");
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const secret = "student-invitations-local-only-session-secret";
const keepPreview = process.argv.includes("--preview");
let server, browser, passed = false;
const accounts = [];
function cookie(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ user_db_id: user.id, user_id: user.user_id, role: user.role,
    auth_version: user.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  return { name: "cmcq_session", value: `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`,
    url: base, httpOnly: true, sameSite: "Lax" };
}
try {
  const prefix = `invitation_preview_${Date.now()}`;
  const teacher = await db.user.create({ data: { user_id: `${prefix}_teacher`, user_id_normalized: `${prefix}_teacher`,
    role: "teacher_researcher", display_name: "Course Instructor", email: "btan4@ualberta.ca", password_hash: await hashSecret("LocalPreview123!") } });
  accounts.push(teacher.id);
  const students = [];
  for (let n = 0; n < 3; n++) {
    const student = await db.user.create({ data: { user_id: `${prefix}_student${n + 1}`, user_id_normalized: `${prefix}_student${n + 1}`,
      role: "student", display_name: ["Alex Example", "Sam Example", "Taylor Example"][n], email: `demo-student${n + 1}@example.edu`,
      created_by_teacher_user_id: teacher.id, must_change_password: true, access_code_hash: await hashSecret(`SyntheticOnly${n + 1}!pass`) } });
    students.push(student); accounts.push(student.id);
  }
  const csv = stringify(students.map((student, n) => ({ user_id: student.user_id, display_name: student.display_name,
    email: student.email, temporary_password: `SyntheticOnly${n + 1}!pass` })), { header: true });
  const counts = async () => ({ sessions: await db.assessmentSession.count(), events: await db.processEvent.count(),
    calls: await db.agentCall.count(), invitations: await db.studentLoginInvitation.count() });
  const before = await counts();
  const fd = openSync(`${output}/server.log`, "w", 0o600);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    detached: keepPreview, stdio: ["ignore", fd, fd], env: { ...process.env, NODE_ENV: "production", APP_ENV: "development", APP_BASE_URL: base,
      SESSION_SECRET: secret, OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "", LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false",
      FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", OPERATIONAL_AGENT_MODE: "disabled", NEXT_TELEMETRY_DISABLED: "1",
      GMAIL_CLIENT_ID: "", GMAIL_CLIENT_SECRET: "", STUDENT_INVITATION_CONTACT_EMAIL: "btan4@ualberta.ca",
      NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` }
  });
  closeSync(fd);
  server.exited = new Promise(done => server.once("exit", done));
  let ready = false;
  for (let n = 0; n < 90; n++) {
    try { if ((await fetch(`${base}/student/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, "Preview server did not start");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies([cookie(teacher)]);
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`${base}/teacher/students`);
  await page.getByRole("link", { name: "Prepare login emails", exact: true }).click();
  await page.getByText("Gmail sending needs administrator setup. You can prepare and review emails now.").waitFor();
  assert.equal(await page.getByLabel("Gmail address and student contact email").inputValue(), "btan4@ualberta.ca");
  await page.getByLabel("Credential CSV", { exact: true }).setInputFiles({ name: "synthetic-credentials.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const prepare = async () => {
    const response = page.waitForResponse(response => response.url().endsWith("/invitations/preview"));
    await page.getByRole("button", { name: "Preview emails", exact: true }).click();
    const received = await response;
    assert.equal(received.status(), 200, received.ok() ? "" : await received.text()); await page.getByRole("region", { name: "Invitation previews" }).waitFor();
  };
  await prepare();
  assert.equal(await page.getByRole("button", { name: "Send 3 emails with Gmail", exact: true }).isEnabled(), false);
  const emailPreview = page.locator('[aria-label="Email preview"]');
  assert(!(await emailPreview.innerText()).includes("SyntheticOnly1!pass"));
  await page.getByLabel("Show temporary password", { exact: true }).check();
  assert((await emailPreview.innerText()).includes("SyntheticOnly1!pass"));
  await page.getByLabel("Show temporary password", { exact: true }).uncheck();
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.screenshot({ path: `${output}/desktop-viewport.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile page overflow");
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel("Subject", { exact: true }).fill("Updated assessment login details");
  assert.equal(await page.getByRole("region", { name: "Invitation previews" }).count(), 0);
  await prepare();
  assert.deepEqual(await counts(), before, "Preview must not create delivery or research records");

  // Exercise Google consent and the send UI without external calls or real delivery.
  const realConfig = await (await context.request.get(`${base}/api/teacher/students/invitations`)).json();
  await page.route("**/api/teacher/students/invitations", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ...realConfig, gmail_client_id: "synthetic.apps.googleusercontent.com" }) }));
  await page.route("https://accounts.google.com/gsi/client", route => route.fulfill({ contentType: "text/javascript", body:
    "window.google={accounts:{oauth2:{initCodeClient:(options)=>({requestCode:()=>options.callback({code:'synthetic-code'})})}}};" }));
  let connected = 0;
  await page.route("**/api/teacher/students/invitations/gmail", route => { connected++; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ email: "btan4@ualberta.ca" }) }); });
  const submitted = [];
  await page.route("**/api/teacher/students/invitations/send", async route => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: submitted.length === 1 ? "sent" : "unknown" }) });
  });
  await page.reload();
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  await page.getByText("Connected to btan4@ualberta.ca. No emails have been sent.", { exact: true }).waitFor();
  assert.equal(connected, 1); assert.equal(submitted.length, 0);
  await page.getByLabel("Credential CSV", { exact: true }).setInputFiles({ name: "synthetic-credentials.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await prepare();
  const sendButton = page.getByRole("button", { name: "Send 3 emails with Gmail", exact: true });
  assert.equal(await sendButton.isEnabled(), false);
  await page.getByRole("checkbox", { name: /I have reviewed the recipients/ }).check();
  await sendButton.click();
  await page.getByText("1 email confirmed sent.", { exact: true }).waitFor();
  assert.equal(submitted.length, 2, "An uncertain receipt must stop the remaining batch");
  assert.equal(submitted[0].message.to, students[0].email); assert.equal(submitted[1].message.to, students[1].email);
  assert(submitted[0].message.body.includes("SyntheticOnly1!pass")); assert(!submitted[0].message.body.includes("SyntheticOnly2!pass"));
  assert.equal(await page.getByRole("checkbox", { name: /I have reviewed the recipients/ }).isChecked(), false);
  await page.screenshot({ path: `${output}/send-status-mocked.png`, fullPage: true });
  const studentContext = await browser.newContext();
  await studentContext.addCookies([cookie(students[0])]);
  assert.equal((await studentContext.request.get(`${base}/api/teacher/students/invitations`)).status(), 403);
  const noAuth = await browser.newContext();
  assert.equal((await noAuth.request.get(`${base}/api/teacher/students/invitations`)).status(), 401);
  const crossOrigin = await context.request.post(`${base}/api/teacher/students/invitations/preview`, {
    headers: { origin: "https://attacker.example", "x-invitation-request": "1" }, data: { csv_text: csv } });
  assert.equal(crossOrigin.status(), 403);
  assert.deepEqual(await counts(), before); assert.deepEqual(errors, []);
  const result = { passed: true, preview_url: `${base}/teacher/students/invitations`, server_pid: keepPreview ? server.pid : null,
    local_teacher_login: teacher.user_id, local_password: "LocalPreview123!", synthetic_csv_path: `${output}/synthetic-credentials.csv`,
    verification: "Desktop/mobile, credential masking, template invalidation, explicit approval, separate recipients, stop on uncertain delivery, auth/origin protections. Google and sending UI mocked; zero emails and provider calls." };
  await writeFile(`${output}/synthetic-credentials.csv`, csv, { mode: 0o600 });
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2)); passed = true;
} finally {
  if (browser) await browser.close();
  if (server && (!keepPreview || !passed)) { server.kill("SIGTERM"); await server.exited; }
  else if (server) server.unref();
  if (!keepPreview || !passed) await db.user.deleteMany({ where: { id: { in: accounts } } });
  await db.$disconnect();
}
