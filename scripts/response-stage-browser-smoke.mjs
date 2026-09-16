import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import JSZip from "jszip";
import { deriveResponseStageVisits } from "../src/lib/services/student-assessment/response-stage-data.ts";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_ux"));
const output = await mkdtemp(join(tmpdir(), "cmcq-response-stage-"));
const secret = "response-stage-synthetic-test-secret";
const env = { ...process.env, DATABASE_URL: database.href, SESSION_SECRET: secret,
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  ITEM_ADMIN_TUTOR_MODE: "mock", ALLOW_LOCAL_MOCK_RUNTIME: "true", APP_ENV: "development",
  OPERATIONAL_AGENT_MODE: "disabled", OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "false",
  RESEARCH_PSEUDONYMIZATION_KEY: "response-stage-synthetic-research-key", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` };
const seed = spawnSync(process.execPath, ["--import", "tsx", "prisma/classroom-ux-fixture.ts"], { env, encoding: "utf8", timeout: 90_000 });
assert.equal(seed.status, 0, seed.stderr);
const fixture = JSON.parse(seed.stdout.trim().split("\n").at(-1));
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", d => { logs += d; }); server.stderr.on("data", d => { logs += d; });
const serverExited = new Promise(done => server.once("exit", done));
const db = new PrismaClient({ datasourceUrl: database.href });
let browser;
const checks = [], browserErrors = [], eventErrors = [];
async function context(user, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  ctx.setDefaultTimeout(15000);
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({ user_db_id: user.id, user_id: user.user_id, role: user.role, auth_version: user.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  await ctx.addCookies([{ name: "cmcq_session", value: `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`, url: base, httpOnly: true, sameSite: "Lax" }]);
  await ctx.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return ctx;
}
const wait = ms => new Promise(done => setTimeout(done, ms));
try {
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(base + "/student/login")).ok) break; } catch { /* Local startup. */ }
    assert.equal(server.exitCode, null, logs); await wait(500);
  }
  browser = await chromium.launch({ headless: true });
  const ctx = await context(fixture.student);
  const page = await ctx.newPage();
  page.on("pageerror", e => browserErrors.push(String(e)));
  page.on("response", r => { if (r.url().endsWith("/events") && !r.ok()) eventErrors.push(r.status()); });
  const api = `/api/student/sessions/${fixture.activeSession}`;
  const session = await db.assessmentSession.findUniqueOrThrow({ where: { session_public_id: fixture.activeSession } });
  await db.assessmentSession.update({ where: { id: session.id }, data: { started_at: new Date(), last_activity_at: new Date() } });
  const rows = () => db.processEvent.findMany({ where: { assessment_session_db_id: session.id }, include: { item: true }, orderBy: { created_at: "asc" } });
  const visits = async () => deriveResponseStageVisits((await rows()).map(e => ({ ...e, item_public_id: e.item?.item_public_id })));
  async function waitFor(predicate, label) {
    for (let n = 0; n < 100; n++) { if (await predicate()) return; await wait(100); }
    throw new Error(`Timed out: ${label}`);
  }
  await page.goto(`${base}/student/assessment/${fixture.activeSession}`, { waitUntil: "networkidle" });
  const start = page.getByTestId("begin-concept-unit");
  if (await start.count()) await start.click();
  const option = page.locator('[data-testid^="chat-option-card-"]').first();
  await option.scrollIntoViewIfNeeded();
  await waitFor(async () => (await visits()).some(v => v.response_stage === "answer"), "answer ready");
  await wait(200); await option.click();
  const reason = page.getByTestId("reasoning-input");
  await reason.waitFor(); await reason.scrollIntoViewIfNeeded();
  await waitFor(async () => (await visits()).some(v => v.response_stage === "reasoning"), "reason ready");
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await wait(100);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await reason.fill("deadw"); await page.getByTestId("reasoning-input-send").click();
  await waitFor(async () => (await visits()).some(v => v.validation_rejection_count > 0), "rejected submission outcome");
  await reason.fill("Theta describes the person's standing on the latent trait, while calibrated item parameters describe item characteristics.");
  await page.getByTestId("reasoning-input-send").click();
  const confidence = page.getByTestId("chat-confidence-high");
  await confidence.waitFor(); await confidence.scrollIntoViewIfNeeded();
  await waitFor(async () => (await visits()).some(v => v.response_stage === "confidence"), "confidence ready");
  await page.getByTestId("in-flow-edit-reasoning").click();
  const editedReason = "The person estimate and calibrated item properties have different meanings, so theta is not an item difficulty parameter.";
  await page.getByTestId("in-flow-edit-reasoning-input").fill(editedReason);
  await page.getByTestId("in-flow-edit-save").click();
  await confidence.waitFor();
  await confidence.click();
  await page.locator('[data-testid^="chat-tempting-option-"]').first().click();
  await page.getByTestId("tempting-reason-input").fill("This option was tempting because it also mentions item difficulty, but that is different from the person's trait estimate.");
  await page.getByTestId("tempting-reason-input-send").click();
  await waitFor(async () => (await visits()).filter(v => v.response_stage === "answer").length >= 2, "next item");
  checks.push("browser-ready stages, first input, rejection, accepted retry, confidence and next item");
  let captured = await visits();
  const explanation = captured.find(v => v.response_stage === "reasoning");
  assert.equal(explanation.submission_count, 2);
  assert.equal(explanation.accepted_submission_count, 1);
  assert(explanation.input_start_latency_ms !== null && explanation.system_wait_ms > 0);
  assert(explanation.time_to_accepted_submission_ms >= explanation.response_elapsed_ms);
  assert.equal(explanation.offline_count, 1);
  assert(explanation.offline_duration_ms !== null);
  assert(captured.some(v => v.response_stage === "tempting_reason" && v.input_start_latency_ms !== null && v.accepted_submission_count === 1));
  assert(captured.some(v => v.response_stage === "reasoning" && v.response_phase === "revision" && v.input_start_latency_ms !== null && v.accepted_submission_count === 1), "Immediate editor input must belong to the revision, not the previous confidence stage.");
  assert(captured.filter(v => v.response_stage === "confidence" && v.response_phase === "initial").every(v => v.input_start_latency_ms === null && v.input_change_count === 0), "Chip-only confidence stages cannot receive reasoning input events.");
  const firstDoc = captured[0].browser_tab_id;
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-testid^="chat-option-card-"]').first().scrollIntoViewIfNeeded();
  await waitFor(async () => (await visits()).some(v => v.browser_tab_id !== firstDoc), "new browser document");
  checks.push("reload preserves observations and separates monotonic clocks");
  await page.getByTestId("save-exit").click();
  await page.waitForURL(base + "/student/assessment");
  await waitFor(async () => (await rows()).some(e => e.event_type === "attempt_paused"), "explicit pause");
  checks.push("explicit pause without overwriting prior response evidence");
  const recorded = (await rows()).find(e => e.event_type === "response_stage_observation");
  const { client_event_id, browser_tab_id, client_occurred_at, server_received_at, clock_source, timing_contract_version, timing_source_version, timing_quality_status, ...payload } = recorded.payload;
  void server_received_at; void clock_source; void timing_contract_version; void timing_source_version; void timing_quality_status;
  const duplicate = { event_type: recorded.event_type, item_public_id: recorded.item.item_public_id, client_event_id, browser_tab_id, client_occurred_at, payload };
  const duplicateCount = () => db.processEvent.count({ where: { assessment_session_db_id: session.id, payload: { path: ["client_event_id"], equals: client_event_id } } });
  const beforeDuplicate = await duplicateCount();
  for (let n = 0; n < 2; n++) assert((await ctx.request.post(base + api + "/events", { headers: { origin: base }, data: { events: [duplicate] } })).ok());
  assert.equal(await duplicateCount(), beforeDuplicate);
  const forged = await ctx.request.post(base + api + "/events", { headers: { origin: base }, data: { events: [{ ...duplicate, event_type: "response_stage_outcome" }] } });
  assert.equal(forged.status(), 400);
  checks.push("delivery deduplication and rejection of client-forged outcome events");

  const outsider = await context(fixture.historyStudent, 390);
  const forbidden = await outsider.request.get(base + api + "/state");
  assert([403, 404].includes(forbidden.status()));
  const foreignWrite = await outsider.request.post(base + api + "/events", { headers: { origin: base }, data: { events: [{ event_type: "navigation_event", payload: { reason: "synthetic_isolation_check" } }] } });
  assert([403, 404].includes(foreignWrite.status()));
  const historyPage = await outsider.newPage();
  const historyCount = await db.processEvent.count({ where: { assessment_session: { session_public_id: fixture.historySession } } });
  await historyPage.goto(`${base}/student/assessment/${fixture.historySession}?review=1`, { waitUntil: "networkidle" });
  await wait(300);
  assert.equal(await db.processEvent.count({ where: { assessment_session: { session_public_id: fixture.historySession } } }), historyCount);
  checks.push("student isolation and read-only history does not generate process activity");

  const teacher = await context(fixture.teacher);
  const teacherPage = await teacher.newPage();
  await teacherPage.goto(`${base}/teacher/sessions/${fixture.activeSession}`, { waitUntil: "networkidle" });
  await teacherPage.getByRole("button", { name: "Process data", exact: true }).click();
  await teacherPage.getByText("Response stages and interruptions", { exact: true }).click();
  await teacherPage.getByText("Before typing", { exact: true }).waitFor();
  await teacherPage.screenshot({ path: join(output, "process-data-desktop.png"), fullPage: true });
  await teacherPage.setViewportSize({ width: 390, height: 844 });
  await teacherPage.screenshot({ path: join(output, "process-data-mobile.png"), fullPage: true });
  assert(await teacherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(await teacherPage.evaluate(() => [...document.querySelectorAll("h1,h2,h3,section,main,table")].filter(e => e.getBoundingClientRect().right > innerWidth).map(e => ({ tag: e.tagName, class: e.className, width: e.getBoundingClientRect().width, text: e.textContent.slice(0, 80) })))));
  const auditResponse = await teacher.request.get(`${base}/api/teacher/sessions/${fixture.activeSession}/data-audit`);
  assert(auditResponse.ok());
  const audit = await auditResponse.json();
  assert(audit.behavior_summary.items.some(i => i.stage_visits.length >= 4));
  const exported = await teacher.request.get(`${base}/api/teacher/research-data/analysis-ready?session_public_id=${fixture.activeSession}`);
  assert(exported.ok(), await exported.text());
  const zip = await JSZip.loadAsync(await exported.body());
  const find = name => zip.file(Object.keys(zip.files).find(path => path.endsWith(name)));
  const exportedVisits = parse(await find("response_stage_visits.csv").async("string"), { columns: true });
  captured = await visits();
  assert.equal(exportedVisits.length, captured.length);
  assert(exportedVisits.some(v => v.validation_rejection_count === "1"));
  assert(exportedVisits.some(v => v.response_stage === "reasoning" && v.response_phase === "revision" && v.input_start_latency_ms !== ""));
  assert(exportedVisits.filter(v => v.response_stage === "confidence" && v.response_phase === "initial").every(v => v.input_start_latency_ms === "" && v.input_change_count === "0"));
  const revisions = parse(await find("response_revision_history.csv").async("string"), { columns: true });
  assert(revisions.some(r => r.changed_field === "reasoning_text" && r.new_value === editedReason && r.previous_value.includes("Theta describes")));
  assert(!(await find("response_stage_events.csv").async("string")).includes(editedReason));
  assert(audit.behavior_summary.items.length >= 2, "Viewed unanswered items belong in the teacher process summary.");
  assert(find("response_stage_data_dictionary.csv"));
  const coverage = parse(await find("data_coverage.csv").async("string"), { columns: true });
  for (const stage of ["answer", "reasoning", "confidence", "tempting_option", "tempting_reason"]) {
    const populated = coverage.find(r => r.dataset === "response_stage_visits.csv" && r.group_by === "response_stage" && r.group_value === stage && r.variable_name === "response_elapsed_ms");
    assert(Number(populated?.populated_count) > 0, `${stage} response timing must actually reach the export.`);
  }
  await writeFile(join(output, "data-coverage.csv"), await find("data_coverage.csv").async("string"));
  await writeFile(join(output, "response-stage-data-dictionary.csv"), await find("response_stage_data_dictionary.csv").async("string"));
  assert.equal(await db.agentCall.count({ where: { provider: { not: "mock" } } }), 0);
  assert.deepEqual(eventErrors, []);
  assert.deepEqual(browserErrors, []);
  checks.push("teacher desktop/mobile, database and research ZIP agree; no live provider calls");
  console.log(JSON.stringify({ status: "PASS", checks, output, stage_visits: captured.length, provider_calls: 0 }, null, 2));
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await serverExited; clearTimeout(timer);
  await db.$disconnect();
  await writeFile(join(output, "server.log"), logs);
  console.log(`Test artifacts: ${output}`);
}
