import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
const require = createRequire(import.meta.url);
const { createResponseCollectionFixture, cleanupResponseCollectionFixture } = require("../prisma/response-collection-smoke-fixture.ts");
const { cleanupSmokeStudentSessions } = require("../prisma/student-mvp-smoke-helpers.ts");
const db = new PrismaClient();
const prefix = `preparation_ux_${randomUUID().replaceAll("-", "")}`;
const output = await mkdtemp(join(tmpdir(), "cmcq-preparation-ux-"));
const secret = "preparation-ux-local-test-secret";
const env = { ...process.env, NODE_ENV: "production", APP_ENV: "development",
  SESSION_SECRET: secret, LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false",
  OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "", ITEM_ADMIN_TUTOR_MODE: "mock",
  ALLOW_LOCAL_MOCK_RUNTIME: "true", OPERATIONAL_AGENT_MODE: "disabled",
  OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "false", NEXT_TELEMETRY_DISABLED: "1",
  RESEARCH_PSEUDONYMIZATION_KEY: "preparation-ux-local-research-key",
  NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}`
};
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const children = [];
function child(args) {
  const process = spawn(globalThis.process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  process.output = "";
  process.stdout.on("data", (data) => { process.output += data; });
  process.stderr.on("data", (data) => { process.output += data; });
  process.exited = new Promise((done) => process.once("exit", done));
  children.push(process); return process;
}
async function stop(process) { if (process.exitCode === null && !process.signalCode) { process.kill("SIGTERM"); await process.exited; } }
async function ready(process) {
  for (let n = 0; n < 60; n++) {
    try { if ((await fetch(`${base}/student/login`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Startup only. */ }
    if (process.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(process.output.slice(-3000));
}
let fixture, failedFixture, browser;
let passed = 0;
const pass = (name) => { passed++; console.log(`PASS ${name}`); };
try {
  fixture = await createResponseCollectionFixture({ prisma: db, prefix, responseCollectionMode: "deterministic" });
  await db.user.update({ where: { id: fixture.student.id }, data: { created_by_teacher_user_id: fixture.teacher.id } });
  await db.itemResponse.createMany({ data: fixture.items.map((item) => ({
    concept_unit_session_db_id: fixture.conceptUnitSession.id, item_db_id: item.id,
    selected_option: "A", correct_option_snapshot: "A", correctness: "correct",
    reasoning_text: "I used the evidence to distinguish the two quantities.", confidence_rating: "medium",
    item_submitted_at: new Date(), item_version_snapshot: 1, item_snapshot: item
  })) });
  const server = child(["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)]);
  await ready(server);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15_000);
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ user_db_id: fixture.student.id, user_id: fixture.student.user_id,
    role: "student", auth_version: fixture.student.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  await context.addCookies([{ name: "cmcq_session", value: `${payload}.${signature}`, url: base, httpOnly: true, sameSite: "Lax" }]);
  const requests = [];
  await context.route("**/*", (route) => {
    const request = route.request();
    assert.equal(new URL(request.url()).origin, base, "No external browser requests");
    requests.push({ path: new URL(request.url()).pathname, method: request.method() });
    return route.continue();
  });
  const page = await context.newPage();
  // Simulate a background document without depending on headless tab-focus behavior.
  await page.addInitScript(() => {
    window.feedbackTestVisibility = "hidden";
    Object.defineProperty(document, "visibilityState", { get: () => window.feedbackTestVisibility });
  });
  const sessionId = fixture.session.session_public_id;
  const path = `/student/assessment/${sessionId}`;
  const api = `/api/student/sessions/${sessionId}`;
  assert.equal((await fetch(`${base}${api}/preparation`)).status, 401);
  pass("progress endpoint requires authentication");
  await page.goto(base + path);
  await page.getByTestId("continue-to-feedback").waitFor();
  assert((await page.getByTestId("initial-preparation-expectation").innerText()).includes("preparing your initial feedback may take about a minute or longer"));
  assert.equal(await page.getByTestId("initial-preparation-wait-notice").count(), 0);
  const submission = page.waitForResponse((response) => response.url().endsWith("/complete-initial"));
  const started = Date.now();
  await page.getByTestId("continue-to-feedback").click();
  assert.equal((await submission).status(), 202);
  console.log(`http_submission_acknowledgement_ms=${Date.now() - started}`);
  await page.getByTestId("initial-preparation-status").waitFor();
  assert.equal(await page.getByTestId("initial-preparation-wait-notice").innerText(), "Preparing your initial feedback may take about a minute or longer. You can review your responses while you wait.");
  pass("longer preparation is explained before submission and during waiting without a completion-time guarantee");
  await page.waitForFunction(() => !document.querySelector('[data-testid="end-attempt"]')?.disabled);
  assert.equal(await db.agentCall.count({ where: { assessment_session_db_id: fixture.session.id } }), 0);
  assert.equal(await page.getByTestId("end-attempt").isEnabled(), true);
  assert.equal(await page.getByTestId("save-exit").isEnabled(), true);
  await page.getByText("Review your responses", { exact: true }).click();
  assert.equal(await page.getByTestId("submitted-response-review").locator("li").count(), 3);
  assert.equal(await page.getByTestId("submitted-response-review").locator("input, textarea, button").count(), 0);
  assert(!(await page.getByTestId("submitted-response-review").innerText()).includes("Correct answer"));
  pass("HTTP submission returns without AI work; saved responses are reviewable and controls are unlocked");
  await page.screenshot({ path: join(output, "preparing-desktop.png"), fullPage: true });
  await page.reload();
  await page.getByTestId("initial-preparation-status").waitFor();
  await page.waitForTimeout(2500);
  assert.equal(requests.filter((request) => request.path.endsWith("/complete-initial")).length, 1);
  assert.equal(await db.workflowJob.count({ where: { assessment_session_db_id: fixture.session.id } }), 1);
  pass("reload resumes read-only polling without another submission");
  await page.route(`${base}${api}/preparation`, (route) => route.fulfill({ status: 503, json: { error: { code: "synthetic_outage", message: "Unavailable" } } }));
  await page.getByText("Connection interrupted. Checking progress again shortly.").waitFor();
  await page.unroute(`${base}${api}/preparation`);
  await page.getByText("Connection interrupted. Checking progress again shortly.").waitFor({ state: "hidden" });
  assert.equal(requests.filter((request) => request.path.endsWith("/complete-initial")).length, 1);
  pass("temporary connection failure recovers without resubmitting or generating");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await page.getByText("Review your responses", { exact: true }).click();
    await page.screenshot({ path: join(output, `preparing-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll("body *"))
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 8).map((element) => ({ tag: element.tagName, class: element.className, text: element.textContent?.slice(0, 100) })));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify({ output, overflow }));
    await page.getByText("Review your responses", { exact: true }).click();
  }
  pass("mobile 320/390 and desktop 1440 waiting and review layout");
  const job = await db.workflowJob.findFirstOrThrow({ where: { assessment_session_db_id: fixture.session.id } });
  await db.workflowJob.update({ where: { id: job.id }, data: { status: "failed", attempt_count: 3, last_error_category: "preparation_failed" } });
  await page.getByTestId("retry-initial-preparation").waitFor();
  assert.equal(await page.getByTestId("initial-preparation-wait-notice").count(), 0);
  assert.match(await page.getByTestId("initial-feedback-help").innerText(), /try again or contact your teacher/);
  assert.equal(await page.getByTestId("end-attempt").count(), 0);
  const retry = page.waitForResponse((response) => response.url().endsWith("/complete-initial"));
  await page.getByTestId("retry-initial-preparation").click();
  assert.equal((await retry).status(), 202);
  assert.equal(await db.workflowJob.count({ where: { assessment_session_db_id: fixture.session.id } }), 1);
  pass("failed preparation has an explicit retry using the same saved job");
  const queued = await db.workflowJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(queued.payload.execution_mode, "production");
  // Only this synthetic job uses the existing deterministic evaluation adapter.
  // Production requests keep their normal provider and approval checks.
  await db.workflowJob.update({ where: { id: job.id }, data: {
    payload: { ...queued.payload, execution_mode: "deterministic_e1" }
  } });
  const worker = child(["--import", "tsx", "prisma/initial-preparation-worker.ts"]);
  await page.getByTestId("initial-preparation-status").waitFor({ state: "hidden", timeout: 90_000 });
  assert.equal(await page.getByTestId("initial-preparation-wait-notice").count(), 0);
  const response = await context.request.get(`${base}${api}/state`);
  const state = await response.json();
  assert.equal(state.preparation.status, "ready", worker.output.slice(-3000));
  assert.equal(state.formative_conversation.opening_status, "ready");
  assert.equal(state.formative_conversation.transcript.filter((turn) => turn.actor === "tutor").length, 1);
  assert.equal(requests.filter((request) => request.path.endsWith("/complete-initial")).length, 2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(output, "ready-desktop.png"), fullPage: true });
  pass("validated opening appears automatically after the independent worker finishes");
  const exposureTypes = ["package_results_shown", "item_correctness_status_shown", "formative_feedback_shown"];
  const exposureCount = type => db.processEvent.count({ where: { assessment_session_db_id: fixture.session.id,
    event_type: type ?? { in: exposureTypes } } });
  const waitForCount = async (type, count) => {
    for (let n = 0; n < 50; n++) {
      if (await exposureCount(type) === count) return;
      await page.waitForTimeout(100);
    }
    assert.equal(await exposureCount(type), count, type);
  };
  await page.waitForTimeout(800);
  assert.equal(await exposureCount(), 0, "Generated feedback in a hidden document is not observed");
  await page.getByTestId("initial-answer-review-item").evaluateAll(items => items.forEach(item => { item.open = false; }));
  await page.evaluate(() => { window.feedbackTestVisibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  await page.getByTestId("formative-conversation-tutor-message").scrollIntoViewIfNeeded();
  await waitForCount("formative_feedback_shown", 1);
  assert.equal(await db.itemResponse.count({ where: { concept_unit_session_db_id: fixture.conceptUnitSession.id, student_display_acknowledged_at: { not: null } } }), 0);
  await page.getByTestId("package-results-summary").scrollIntoViewIfNeeded();
  await waitForCount("package_results_shown", 1);
  await page.waitForTimeout(800);
  assert.equal(await exposureCount("item_correctness_status_shown"), 0, "Collapsed/offscreen explanations are not observed");
  const reviewItem = page.getByTestId("initial-answer-review-item").first();
  await reviewItem.locator("summary").click();
  await reviewItem.getByText("Why:", { exact: true }).scrollIntoViewIfNeeded();
  await waitForCount("item_correctness_status_shown", 1);
  const eventsPath = `${base}${api}/events`;
  await page.route(eventsPath, route => route.abort("failed"));
  const secondReview = page.getByTestId("initial-answer-review-item").nth(1);
  await secondReview.locator("summary").click();
  await secondReview.getByText("Why:", { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  assert.equal(await exposureCount("item_correctness_status_shown"), 1);
  assert(await page.evaluate(() => Object.values(sessionStorage).some(value => value.includes('"content_kind":"item_feedback"'))));
  await page.unroute(eventsPath);
  await page.reload();
  await page.getByTestId("formative-conversation-input").waitFor();
  await waitForCount("item_correctness_status_shown", 2);
  assert.equal(await exposureCount("package_results_shown"), 1);
  assert.equal(await exposureCount("formative_feedback_shown"), 1);
  pass("feedback exposure respects hidden/offscreen/collapsed content, per-item granularity and reload delivery without duplicates");
  const draft = "synthetic unsent draft";
  const composer = page.getByTestId("formative-conversation-input");
  await composer.pressSequentially(draft);
  await composer.press("Backspace");
  // A synthetic paste stimulus checks aggregate capture, not clipboard content storage.
  await composer.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "synthetic clipboard content");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));
  });
  await page.reload();
  await page.getByTestId("formative-conversation-input").waitFor();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await db.processEvent.count({ where: { assessment_session_db_id: fixture.session.id, event_type: "typing_activity_summary" } })) break;
    await page.waitForTimeout(100);
  }
  const captured = await db.processEvent.findMany({ where: { assessment_session_db_id: fixture.session.id } });
  const typing = captured.find(event => event.event_type === "typing_activity_summary" && event.payload?.key_count === draft.length + 1);
  assert.equal(typing?.payload.backspace_count, 1);
  assert(captured.some(event => event.event_type === "paste_detected" && event.payload?.pasted_text_length_band === "21_100"));
  assert(!JSON.stringify(captured).includes(draft));
  assert(!JSON.stringify(captured).includes("synthetic clipboard content"));
  const ids = captured.map(event => event.payload?.client_event_id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  const { buildAnalysisReadyResearchDataBundle } = require("../src/lib/services/teacher-research-data/analysis-ready-export.ts");
  const bundle = await buildAnalysisReadyResearchDataBundle({ teacher_user_db_id: fixture.teacher.id, scope: "selected_session", session_public_id: sessionId, include_incomplete_sessions: true });
  const { parse } = require("csv-parse/sync");
  const exportedEvents = parse(bundle.files.find(file => file.path === "process_events.csv").data, { columns: true, skip_empty_lines: true });
  assert(exportedEvents.some(event => event.event_type === "typing_activity_summary" && event.payload_key_count === String(draft.length + 1) && event.payload_backspace_count === "1"));
  assert(exportedEvents.some(event => event.event_type === "paste_detected" && event.payload_pasted_text_length_band === "21_100"));
  assert(!bundle.files.some(file => file.data.includes(draft) || file.data.includes("synthetic clipboard content")));
  pass("real browser typing and synthetic paste aggregates survive reload, database capture, and research CSV export without raw input text");
  const exposureRows = parse(bundle.files.find(file => file.path === "feedback_exposure_events.csv").data, { columns: true });
  assert.equal(exposureRows.length, 4);
  assert.equal(exposureRows.find(row => row.event_type === "formative_feedback_shown").source_turn_sequence_index,
    String(state.formative_conversation.transcript[0].sequence_index));
  await page.getByRole("button", { name: "End conversation", exact: true }).click();
  await page.getByTestId("confirm-end-conversation").click();
  await page.getByTestId("finish-assessment").waitFor();
  assert.equal(await page.getByTestId("end-attempt").count(), 0, "Offer completion instead of a competing early exit");
  assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).status, "active");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId("finish-assessment").scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(output, `finish-assessment-${width}.png`) });
  }
  await page.getByTestId("finish-assessment").click();
  await page.getByTestId("back-to-assessments").waitFor();
  const completed = await db.assessmentSession.findUniqueOrThrow({ where: { id: fixture.session.id } });
  assert.equal(completed.status, "completed"); assert(completed.completed_at);
  await page.reload();
  await page.getByTestId("back-to-assessments").waitFor();
  assert.equal(await page.getByTestId("finish-assessment").count(), 0);
  pass("explicit finish persists completed status, unlocks read-only review, and survives reload at desktop/mobile widths");
  await stop(worker);
  failedFixture = await createResponseCollectionFixture({ prisma: db, prefix: `${prefix}_capacity`, responseCollectionMode: "deterministic" });
  await db.itemResponse.createMany({ data: failedFixture.items.map(item => ({
    concept_unit_session_db_id: failedFixture.conceptUnitSession.id, item_db_id: item.id,
    selected_option: "A", correct_option_snapshot: "A", reasoning_text: "Preserved synthetic response",
    confidence_rating: "medium", item_submitted_at: new Date(), item_version_snapshot: item.version, item_snapshot: item
  })) });
  const failedInput = { student_user_db_id: failedFixture.student.id, session_public_id: failedFixture.session.session_public_id,
    concept_unit_public_id: failedFixture.conceptUnit.concept_unit_public_id };
  await require("../src/lib/services/student-assessment/service.ts").submitInitialConceptUnitForPreparation(failedInput);
  await db.workflowJob.updateMany({ where: { assessment_session_db_id: failedFixture.session.id },
    data: { status: "failed", last_error_category: "output_token_limit" } });
  const savedResponses = await db.itemResponse.findMany({ where: { concept_unit_session_db_id: failedFixture.conceptUnitSession.id }, orderBy: { id: "asc" } });
  const savedPackages = await db.responsePackage.findMany({ where: { concept_unit_session_db_id: failedFixture.conceptUnitSession.id }, orderBy: { id: "asc" } });
  const savedSession = await db.assessmentSession.findUniqueOrThrow({ where: { id: failedFixture.session.id } });
  const failedPayload = Buffer.from(JSON.stringify({ user_db_id: failedFixture.student.id, user_id: failedFixture.student.user_id,
    role: "student", auth_version: failedFixture.student.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  await context.addCookies([{ name: "cmcq_session", value: `${failedPayload}.${createHmac("sha256", secret).update(failedPayload).digest("base64url")}`,
    url: base, httpOnly: true, sameSite: "Lax" }]);
  const continuePath = `/api/student/sessions/${failedInput.session_public_id}/concept-units/${failedInput.concept_unit_public_id}/continue-without-feedback`;
  assert.equal((await fetch(base + continuePath, { method: "POST" })).status, 401);
  await page.goto(`${base}/student/assessment/${failedInput.session_public_id}`);
  await page.getByText("Your responses are saved. AI feedback reached its response limit and could not finish.", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("retry-initial-preparation").isEnabled(), true);
  assert.equal(await page.getByTestId("continue-without-feedback").count(), 0);
  assert.equal(await page.getByTestId("end-after-feedback-failure").count(), 0);
  assert.equal(await page.getByTestId("end-attempt").count(), 0);
  assert.match(await page.getByTestId("initial-feedback-help").innerText(), /try again or contact your teacher/);
  assert.match(await page.getByTestId("initial-feedback-help").innerText(), /Your attempt stays open/);
  assert.equal((await context.request.post(base + continuePath)).status(), 410);
  assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: failedFixture.session.id } })).status, "active");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: join(output, `capacity-failure-${width}.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.reload();
  await page.getByTestId("initial-feedback-help").waitFor();
  assert.equal(await page.getByTestId("end-attempt").count(), 0);
  assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: failedFixture.session.id } })).status, "active");

  await db.workflowJob.updateMany({ where: { assessment_session_db_id: failedFixture.session.id },
    data: { last_error_category: "preparation_source_conflict" } });
  await page.reload();
  await page.getByTestId("initial-feedback-help").waitFor();
  assert.match(await page.getByTestId("initial-feedback-help").innerText(), /Please contact your teacher for help with this test/);
  assert.equal(await page.getByTestId("retry-initial-preparation").count(), 0);
  assert.equal(await page.getByTestId("end-attempt").count(), 0);
  pass("source conflicts recommend teacher help without unsafe retry or forced termination");

  await page.getByTestId("save-exit").click();
  await page.waitForURL(`${base}/student/assessment`);
  assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: failedFixture.session.id } })).status, "paused");
  await page.getByTestId(`resume-assessment-${failedFixture.assessment.assessment_public_id}`).click();
  await page.waitForURL(`${base}/student/assessment/${failedInput.session_public_id}`);
  await page.getByTestId("initial-feedback-help").waitFor();
  const resumed = await db.assessmentSession.findUniqueOrThrow({ where: { id: failedFixture.session.id } });
  assert.equal(resumed.status, "active");
  assert.equal(resumed.completed_at, null);
  assert.equal(resumed.attempt_number, savedSession.attempt_number);
  assert.equal(await db.assessmentSession.count({ where: { user_db_id: failedFixture.student.id, assessment_db_id: failedFixture.assessment.id } }), 1);
  assert.equal(await db.processEvent.count({ where: { assessment_session_db_id: failedFixture.session.id,
    event_type: { in: ["initial_feedback_terminated", "initial_feedback_skipped"] } } }), 0);
  assert.equal(await db.agentCall.count({ where: { assessment_session_db_id: failedFixture.session.id } }), 0);
  assert.deepEqual(await db.itemResponse.findMany({ where: { concept_unit_session_db_id: failedFixture.conceptUnitSession.id }, orderBy: { id: "asc" } }), savedResponses);
  assert.deepEqual(await db.responsePackage.findMany({ where: { concept_unit_session_db_id: failedFixture.conceptUnitSession.id }, orderBy: { id: "asc" } }), savedPackages);
  pass("capacity failure offers retry or teacher help; reload and pause/resume preserve the open attempt and all saved evidence at desktop/mobile widths");
  await stop(server);
  const supervised = child(["scripts/start-app.mjs", "start", "-H", "127.0.0.1", "-p", String(port)]);
  await ready(supervised);
  await stop(supervised);
  pass("normal production launcher starts and stops the supervised web/worker service");
  assert.equal(await db.agentCall.count({ where: { assessment_session_db_id: fixture.session.id, provider: "openai" } }), 0);
  console.log(JSON.stringify({ passed, screenshots: output, provider_calls: 0 }));
} finally {
  if (browser) await browser.close();
  for (const process of children) await stop(process);
  if (fixture) await cleanupSmokeStudentSessions({ prisma: db, userDbId: fixture.student.id, sessionPublicIds: [fixture.session.session_public_id] });
  if (failedFixture) await cleanupSmokeStudentSessions({ prisma: db, userDbId: failedFixture.student.id, sessionPublicIds: [failedFixture.session.session_public_id] });
  await cleanupResponseCollectionFixture(db, prefix);
  await db.$disconnect();
  await require("../src/lib/db.ts").prisma.$disconnect();
}
