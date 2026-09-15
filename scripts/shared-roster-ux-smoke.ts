import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { prisma } from "../src/lib/db";
import { createSmokeTeacher } from "../prisma/account-security-smoke-helpers";
import { verifySecret } from "../src/lib/password";

async function main() {
  const db = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(db.hostname));
  assert(db.pathname.startsWith("/conversational_mcq_classroom_audit_"));
  const prefix = `roster_ux_${Date.now()}`;
  const secret = "synthetic-roster-ux-session-secret";
  const teacher = await createSmokeTeacher({ prisma, userId: `${prefix}_teacher`, password: "SyntheticTeacher123!" });
  const output = await mkdtemp(join(tmpdir(), "shared-roster-ux-"));
  const socket = createServer();
  await new Promise<void>(done => socket.listen(0, "127.0.0.1", done));
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>(done => socket.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATABASE_URL: db.href, SESSION_SECRET: secret, APP_ENV: "development",
    LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
    OPERATIONAL_AGENT_MODE: "disabled", ALLOW_LOCAL_MOCK_RUNTIME: "true", NEXT_TELEMETRY_DISABLED: "1",
    APP_BASE_URL: base, NEXT_PUBLIC_APP_BASE_URL: base,
    STUDENT_DEFAULT_TEMPORARY_PASSWORD: "edpy507",
    NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` };
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "ignore" });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* Local startup. */ }
      if (ready) break;
      assert.equal(server.exitCode, null, "Local server exited");
      await new Promise(done => setTimeout(done, 500));
    }
    assert(ready);
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const now = Math.floor(Date.now() / 1000);
    const token = Buffer.from(JSON.stringify({ user_db_id: teacher.id, user_id: teacher.user_id, role: teacher.role,
      auth_version: teacher.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
    await ctx.addCookies([{ name: "cmcq_session", value: `${token}.${createHmac("sha256", secret).update(token).digest("base64url")}`, url: base }]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/teacher/students/import`);
    assert.equal(page.url(), `${base}/teacher/students/import`, "Teacher session did not open roster import");
    const csv = `user_id,display_name,email\n${prefix}_student,Synthetic student,synthetic@example.edu`;
    await page.getByLabel("Paste CSV", { exact: true }).fill(csv);
    await page.getByRole("button", { name: "Preview roster", exact: true }).click();
    await page.getByLabel("Password assignment").waitFor();
    assert.equal(await page.getByLabel("Password assignment").inputValue(), "course_default");
    await page.getByText("Default temporary password: edpy507", { exact: true }).waitFor();
    await page.screenshot({ path: join(output, "default-desktop.png"), fullPage: true });
    await page.getByLabel("Password assignment").selectOption("shared");
    await page.getByLabel("Shared temporary password", { exact: true }).fill("Course7");
    assert.equal(await page.getByLabel("Shared temporary password", { exact: true }).getAttribute("type"), "password");
    await page.screenshot({ path: join(output, "desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile overflow");
    await page.screenshot({ path: join(output, "mobile.png"), fullPage: true });
    await page.getByLabel("Paste CSV", { exact: true }).fill(csv + "\n");
    assert.equal(await page.getByRole("heading", { name: "Preview results" }).count(), 0, "Changed roster must invalidate old preview");
    await page.getByRole("button", { name: "Preview roster", exact: true }).click();
    await page.getByLabel("Password assignment").waitFor();
    await page.getByLabel("Password assignment").selectOption("course_default");
    await page.getByRole("button", { name: "Import valid rows", exact: true }).click();
    await page.getByText("1 accounts created. 0 unused temporary passwords replaced. 0 profiles updated.", { exact: true }).waitFor();
    assert(await page.getByRole("button", { name: "Imported", exact: true }).isDisabled());
    const firstStudent = await prisma.user.findUniqueOrThrow({ where: { user_id: `${prefix}_student` } });
    assert(await verifySecret("edpy507", firstStudent.access_code_hash));
    await page.reload();
    assert.equal(await page.getByRole("heading", { name: "Preview results" }).count(), 0);
    await page.getByLabel("Paste CSV", { exact: true }).fill(csv);
    await page.getByRole("button", { name: "Preview roster", exact: true }).click();
    const replacement = page.getByRole("checkbox", { name: /Replace unused temporary passwords for 1 existing/ });
    await replacement.waitFor();
    assert(!await replacement.isChecked());
    assert.equal(await page.getByLabel("Password assignment").inputValue(), "course_default");
    await page.screenshot({ path: join(output, "default-mobile.png"), fullPage: true });
    await page.getByLabel("Password assignment").selectOption("shared");
    await page.getByLabel("Shared temporary password", { exact: true }).fill("NewTemp7");
    await replacement.check();
    await page.getByRole("button", { name: "Import valid rows", exact: true }).click();
    await page.getByText("0 accounts created. 1 unused temporary passwords replaced. 0 profiles updated.", { exact: true }).waitFor();
    await page.goto(`${base}/teacher/students/new`);
    assert.equal(await page.getByLabel("Password assignment").inputValue(), "course_default");
    await page.getByLabel("user_id", { exact: true }).fill(`${prefix}_single`);
    await page.getByRole("button", { name: "Save student and add another", exact: true }).click();
    await page.getByText(`Created student account ${prefix}_single.`, { exact: true }).waitFor();
    assert(await verifySecret("edpy507", (await prisma.user.findUniqueOrThrow({ where: { user_id: `${prefix}_single` } })).access_code_hash));
    assert.equal(await page.getByLabel("Password assignment").inputValue(), "course_default");
    await page.goto(`${base}/teacher/students/invitations`);
    await page.waitForURL(`${base}/teacher/students`);
    assert.equal(await page.getByRole("link", { name: "Prepare login emails" }).count(), 0);
    const studentCtx = await browser.newContext();
    const login = await studentCtx.request.post(base + "/api/auth/login", { data: { user_id: `${prefix}_student`, access_code: "NewTemp7" } });
    assert.equal(login.status(), 200);
    assert.equal((await login.json()).user.must_change_password, true);
    const studentPage = await studentCtx.newPage();
    await studentPage.goto(base + "/student/assessment");
    await studentPage.waitForURL(base + "/student/account/password");
    const studentCookie = (await studentCtx.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
    assert.equal((await studentCtx.request.get(base + "/api/teacher/students", { headers: { cookie: studentCookie } })).status(), 403);
    await studentPage.getByLabel("New password", { exact: true }).fill("PrivateChoice123!");
    await studentPage.getByLabel("Confirm new password", { exact: true }).fill("PrivateChoice123!");
    await studentPage.getByRole("button", { name: /password/i }).click();
    await studentPage.waitForURL(base + "/student/assessment");
    assert.equal((await studentCtx.request.post(base + "/api/auth/login", { data: { user_id: `${prefix}_student`, access_code: "NewTemp7" } })).status(), 401);
    assert.equal((await studentCtx.request.post(base + "/api/auth/login", { data: { user_id: `${prefix}_student`, password: "PrivateChoice123!" } })).status(), 200);
    assert.equal((await ctx.request.post(base + "/api/teacher/students/invitations/send", { data: {} })).status(), 410);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "passed", output, viewport_checks: [1440, 390], real_local_import: true,
      pending_replacement: true, stale_preview_protection: true, mandatory_private_password: true, email_sending_retired: true }));
  } finally {
    await browser?.close();
    const exited = new Promise<void>(done => server.once("exit", () => done()));
    if (server.exitCode === null) { server.kill("SIGTERM"); await exited; }
    await prisma.studentAccountEvent.deleteMany({ where: { student: { user_id: { startsWith: prefix } } } });
    await prisma.rosterImportBatch.deleteMany({ where: { uploaded_by_user_db_id: teacher.id } });
    await prisma.user.deleteMany({ where: { user_id: { startsWith: prefix }, role: "student" } });
    await prisma.user.delete({ where: { id: teacher.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
