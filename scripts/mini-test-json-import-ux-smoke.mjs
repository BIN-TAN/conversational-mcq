import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import * as XLSX from "xlsx";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname.startsWith("/conversational_mcq_classroom_audit_"), "disposable_local_database_required");
const prisma = new PrismaClient({ datasourceUrl: database.href });
const output = await mkdtemp(join(tmpdir(), "cmcq-json-import-"));
const secret = "synthetic-json-import-ux-session-secret";
const env = { ...process.env, DATABASE_URL: database.href, SESSION_SECRET: secret,
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", OPERATIONAL_AGENT_MODE: "disabled",
  ALLOW_LOCAL_MOCK_RUNTIME: "true", APP_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--max-old-space-size=12288 --import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` };
const users = [], checks = [], unexpected = [], pageErrors = [];
let server, exited, browser, log;
const sample = await readFile("public/samples/mini-test-import.json", "utf8");
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({ user_db_id: user.id, user_id: user.user_id, role: user.role,
    auth_version: user.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`;
}
async function evidenceCounts() {
  return [await prisma.assessmentSession.count(), await prisma.itemResponse.count(), await prisma.processEvent.count(), await prisma.agentCall.count()];
}
try {
  for (const role of ["teacher_researcher", "student"]) {
    const id = `json_ux_${randomUUID()}`;
    users.push(await prisma.user.create({ data: { user_id: id, user_id_normalized: id, role } }));
  }
  const before = await evidenceCounts();
  const socket = createServer();
  await new Promise(done => socket.listen(0, "127.0.0.1", done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`;
  log = await open(join(output, "server.log"), "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", log.fd, log.fd] });
  exited = new Promise(done => server.once("exit", done));
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(base + "/student/login", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Local startup. */ }
    if (server.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, `server_not_ready: ${output}`);
  const endpoint = "/api/teacher/content/import-json/preview";
  const headers = user => ({ "Content-Type": "application/json", origin: base, ...(user ? { cookie: `cmcq_session=${session(user)}` } : {}) });
  for (const [user, status] of [[null, 401], [users[1], 403]]) {
    assert.equal((await fetch(base + endpoint, { method: "POST", headers: headers(user), body: sample })).status, status);
  }
  assert.equal((await fetch(base + endpoint, { method: "POST", headers: headers(users[0]), body: "{broken" })).status, 400);
  assert.equal((await fetch(base + endpoint, { method: "POST", headers: headers(users[0]), body: " ".repeat(2_000_001) })).status, 413);
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[0].id } }), 0);
  checks.push("anonymous/student rejection and server-side malformed/oversized payload guards, no writes");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  await context.addCookies([{ name: "cmcq_session", value: session(users[0]), url: base, httpOnly: true, sameSite: "Lax" }]);
  let failNextStage = true;
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base || /\/(suggest|format|generate|assistant)(\/|$)/.test(url.pathname)) {
      unexpected.push(url.pathname); return route.abort();
    }
    if (url.pathname === endpoint && failNextStage) {
      failNextStage = false;
      return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Synthetic retryable error" } } });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  const url = base + "/teacher/content/import-json";
  await page.goto(url, { waitUntil: "networkidle" });
  const next = page.getByRole("button", { name: "Continue to item review", exact: true });
  assert(await next.isDisabled());
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download sample JSON", exact: true }).click();
  const download = await downloadReady;
  assert.equal(download.suggestedFilename(), "mini-test-import.json");
  assert.equal(await readFile(await download.path(), "utf8"), sample);
  await page.getByRole("button", { name: "Use sample", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Mini-test JSON", exact: true });
  await page.getByRole("heading", { name: "Interpreting measurement evidence", exact: true }).waitFor();
  assert.equal(await text.inputValue(), sample);
  assert(await next.isEnabled());
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[0].id } }), 0);
  checks.push("sample downloaded directly; sample loading and validation create no records");

  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Use sample", exact: true }).click();
  assert.equal(await text.inputValue(), sample);
  await text.fill("{broken");
  await page.getByText("Invalid JSON. Check commas, quotation marks, and brackets.", { exact: true }).waitFor();
  assert(await next.isDisabled());
  page.once("dialog", dialog => dialog.accept());
  await page.getByLabel("JSON file", { exact: true }).setInputFiles({ name: "teacher-items.json", mimeType: "application/json", buffer: Buffer.from(sample) });
  await page.getByRole("heading", { name: "Interpreting measurement evidence", exact: true }).waitFor();
  assert.equal(await text.inputValue(), sample);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow_${width}`);
    await page.screenshot({ path: join(output, `import-${width}.png`), fullPage: true });
  }
  checks.push("upload/paste validation, unsaved replacement guard, responsive 320/390/768/1440 layouts");
  await next.click();
  await page.getByText("Synthetic retryable error", { exact: true }).waitFor();
  assert.equal(await text.inputValue(), sample);
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[0].id } }), 0);
  await next.click();
  await page.getByRole("heading", { name: "Review imported items", exact: true }).waitFor();
  const reviewUrl = page.url();
  assert(reviewUrl.includes("/import-mcq?batch="));
  const assessment = await prisma.assessment.findFirstOrThrow({ where: { created_by_user_db_id: users[0].id } });
  const itemCount = () => prisma.item.count({ where: { concept_unit: { assessment_db_id: assessment.id } } });
  assert.equal(await itemCount(), 0);
  assert.equal(assessment.status, "draft");
  const add = page.getByRole("button", { name: "Add selected drafts (3)", exact: true });
  assert(await add.isDisabled());
  assert.equal(await page.getByRole("article").count(), 3);
  assert.equal(await page.getByRole("link", { name: "Review design", exact: true }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "JSON template", exact: true }).getAttribute("href"), "/samples/mini-test-import.json");
  await page.getByRole("link", { name: "Review design", exact: true }).click();
  await page.getByRole("heading", { name: "1. Section and learning goals", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Section or topic", exact: true }).inputValue(), JSON.parse(sample).design.section_topic);
  await page.locator("summary").filter({ hasText: "Learning objective 1" }).click();
  assert.equal(await page.getByRole("textbox", { name: /^What observable evidence would demonstrate this\?/ }).inputValue(), JSON.parse(sample).design.objectives[0].evidence_requirements.join("\n"));
  await page.goto(reviewUrl, { waitUntil: "networkidle" });
  await page.getByRole("article").first().waitFor();
  const keyButtons = page.getByRole("button", { name: "Confirm imported key", exact: true });
  for (let i = 0; i < 3; i++) await keyButtons.nth(i).click();
  assert(await add.isEnabled());
  await add.click();
  await page.getByText("Added to mini test", { exact: true }).first().waitFor();
  assert.equal(await itemCount(), 3);
  assert.equal(await page.getByText("Added to mini test", { exact: true }).count(), 3);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByText("Added to mini test", { exact: true }).count(), 3);
  assert.equal(await itemCount(), 3);
  checks.push("error preserves source; direct design review with saved evidence; explicit key confirmation, selected import, reload does not duplicate");

  const repeated = await fetch(base + endpoint, { method: "POST", headers: headers(users[0]), body: sample });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).review_url, new URL(reviewUrl).pathname + new URL(reviewUrl).search);
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[0].id } }), 1);
  assert.deepEqual(await evidenceCounts(), before);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(pageErrors, []);
  checks.push("repeat-file reuse; research records unchanged; no provider/external calls or browser errors");
  const workbook = XLSX.utils.book_new();
  for (const [index, count] of [5, 4, 6].entries()) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(Array.from({ length: count }, (_, row) => ({
      item_label: `T${index + 1}-${row + 1}`, stem: `Synthetic item ${index + 1}.${row + 1}?`,
      option_a: "First", option_b: "Second", option_c: "Third", option_d: "Fourth", key: "A"
    }))), `Test ${index + 1}`);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Diagnostic guide"], ["Item ID", "Learning objective"], ["T1-1", "A teacher-only objective"]]), "Diagnostic guide");
  const workbookBytes = process.env.WORKBOOK_TEST_FILE ? await readFile(process.env.WORKBOOK_TEST_FILE) : Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  const workbookPath = "/api/teacher/content/import-workbook?filename=items.xlsx";
  for (const [user, status] of [[null, 401], [users[1], 403]]) {
    assert.equal((await fetch(base + workbookPath, { method: "POST", headers: headers(user), body: workbookBytes })).status, status);
  }
  assert.equal((await fetch(base + workbookPath, { method: "POST", headers: headers(users[0]), body: Buffer.alloc(2_000_001) })).status, 413);
  const initialCount = await prisma.assessment.count({ where: { created_by_user_db_id: users[0].id } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Excel workbook", exact: true }).click();
  const excelDownloadReady = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download sample Excel" }).click();
  const excelDownload = await excelDownloadReady;
  assert.equal(excelDownload.suggestedFilename(), "mini-test-import.xlsx");
  const templatePreview = await fetch(base + workbookPath, { method: "POST", headers: headers(users[0]), body: await readFile(await excelDownload.path()) });
  assert.equal(templatePreview.status, 200);
  assert.equal((await templatePreview.json()).sheets[0].item_count, 3);
  await page.getByLabel("Excel workbook", { exact: true }).setInputFiles({ name: "items.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbookBytes });
  const prepare = page.getByRole("button", { name: "Prepare 3 mini tests", exact: true });
  await prepare.waitFor();
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[0].id } }), initialCount);
  const selection = page.getByRole("region", { name: "Mini tests in workbook" }).getByRole("checkbox");
  assert.equal(await selection.count(), 3);
  await selection.first().uncheck();
  await page.getByRole("button", { name: "Prepare 2 mini tests", exact: true }).waitFor();
  await selection.first().check();
  await page.locator("summary").filter({ hasText: "Diagnostic guide" }).click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `workbook_overflow_${width}`);
    await page.screenshot({ path: join(output, `workbook-${width}.png`), fullPage: true });
  }
  await prepare.click();
  await page.getByRole("heading", { name: "Draft mini tests ready for review" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Review items", exact: true }).count(), 3);
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[0].id } }), initialCount + 3);
  const firstReview = await page.getByRole("link", { name: "Review items", exact: true }).first().getAttribute("href");
  await page.getByRole("link", { name: "Review items", exact: true }).first().click();
  await page.getByRole("article").first().waitFor();
  assert.equal(await page.getByRole("article").count(), 5);
  assert(await page.getByRole("button", { name: "Add selected drafts (5)", exact: true }).isDisabled());
  await page.locator("summary").filter({ hasText: "Diagnostic guide" }).click();
  assert(await page.getByRole("region", { name: "Diagnostic guide", exact: true }).isVisible());
  await page.getByRole("article").first().locator("summary").filter({ hasText: "Item guide notes" }).click();
  assert(await page.getByRole("article").first().getByText("Learning objective", { exact: true }).isVisible());
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `workbook_review_overflow_${width}`);
    await page.screenshot({ path: join(output, `workbook-review-${width}.png`), fullPage: true });
  }
  const workbookAssessmentId = firstReview.split("/")[4];
  await page.goto(`${base}/teacher/content/assessments/${workbookAssessmentId}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Open item review", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open item review", exact: true }).getAttribute("href"), firstReview);
  await page.getByRole("link", { name: "Open item review", exact: true }).click();
  await page.getByRole("article").first().waitFor();
  assert.equal(await page.getByRole("article").count(), 5);
  assert.deepEqual(await evidenceCounts(), before);
  assert.deepEqual(unexpected, []); assert.deepEqual(pageErrors, []);
  checks.push("Excel template/download, HTTP authorization/size limits, all 15 items across three drafts, selection, mobile/desktop guide, key gate, persistent review links, no student/provider records");
  console.log(JSON.stringify({ status: "passed", checks, output, provider_calls: 0 }, null, 2));
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await exited; }
  await log?.close();
  const where = { created_by_user_db_id: { in: users.map(user => user.id) } };
  await prisma.mcqItemImportBatch.deleteMany({ where: { assessment: where } });
  await prisma.item.deleteMany({ where: { concept_unit: { assessment: where } } });
  await prisma.conceptUnit.deleteMany({ where: { assessment: where } });
  await prisma.assessment.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  await prisma.$disconnect();
}
