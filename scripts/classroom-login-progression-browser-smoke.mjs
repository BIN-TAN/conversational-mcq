import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import JSZip from "jszip";

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
    RESEARCH_PSEUDONYMIZATION_KEY: "classroom-login-progression-synthetic-research-key",
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
  const submittedIds = [];
  const submittedObservations = [];
  let dropSavedReply = true;
  await chat.route("**/items/*/option", async route => {
    submittedIds.push(route.request().postDataJSON().client_action_id);
    submittedObservations.push(route.request().postDataJSON().response_observation);
    if (!dropSavedReply) return route.continue();
    dropSavedReply = false;
    const saved = await route.fetch();
    assert(saved.ok(), await saved.text());
    await route.abort("failed");
  });
  await chat.getByTestId(/chat-option-card-.*-A$/).click();
  await chat.getByRole("button", { name: /Retry/ }).click();
  await chat.getByTestId("reasoning-input").waitFor();
  assert.equal(submittedIds.length, 2);
  assert.equal(submittedIds[0], submittedIds[1], "A lost reply must retry the same operation");
  assert.deepEqual(submittedObservations[0], submittedObservations[1], "Retry must preserve the observation link to the accepted action");
  await chat.getByTestId("reasoning-input").fill("What is theta?");
  const rejectedReason = chat.waitForResponse(response => response.url().endsWith("/reasoning") && response.request().method() === "POST");
  await chat.getByTestId("reasoning-input-send").click();
  assert((await rejectedReason).ok());
  await chat.getByTestId("reasoning-input").fill("I don't know the reason yet.");
  await chat.getByTestId("reasoning-input-send").click();
  await chat.getByTestId("chat-confidence-low").click();
  await chat.getByTestId(/chat-tempting-option-.*-B$/).click();
  await chat.getByTestId("in-flow-edit-answer").click();
  await chat.getByTestId("in-flow-edit-answer-option-B").click();
  await chat.getByTestId("in-flow-edit-cancel").click();
  await chat.getByTestId("tempting-reason-input").waitFor();
  await chat.getByTestId("in-flow-edit-answer").click();
  await chat.getByTestId("in-flow-edit-answer-option-B").click();
  await chat.getByTestId("in-flow-edit-save").click();
  await chat.getByTestId(/chat-tempting-option-.*-A$/).waitFor();
  await chat.reload();
  await chat.getByTestId(/chat-tempting-option-.*-A$/).waitFor();
  await chat.getByTestId("save-exit").click();
  await chat.waitForURL("**/student/assessment");
  await chat.getByRole("button", { name: /Resume/ }).first().click();
  await chat.getByTestId(/chat-tempting-option-.*-A$/).waitFor();
  console.log("PASS: lost reply retry, deferred content question, uncertainty, cancel edit, changed answer, reload, pause/resume");
  await chat.getByTestId("chat-no-tempting").click();
  await chat.getByTestId("package-review-list").waitFor();
  const firstResponse = await db.itemResponse.findFirstOrThrow({
    where: { concept_unit_session: { assessment_session: { session_public_id: sessionId } } },
    orderBy: { item: { item_order: "asc" } }, include: { item: true }
  });
  const firstItem = firstResponse.item.item_public_id;
  await chat.getByTestId(`package-review-edit-${firstItem}`).click();
  await chat.getByTestId(`package-review-edit-confidence-${firstItem}-high`).click();
  await chat.getByTestId(`package-review-cancel-${firstItem}`).click();
  assert.equal((await db.itemResponse.findUniqueOrThrow({ where: { id: firstResponse.id } })).confidence_rating, "medium");
  await chat.getByTestId(`package-review-edit-${firstItem}`).click();
  await chat.getByTestId(`package-review-edit-confidence-${firstItem}-high`).click();
  const savedReview = chat.waitForResponse(response => response.url().endsWith("/package-review-edit") && response.request().method() === "POST");
  await chat.getByTestId(`package-review-save-${firstItem}`).click();
  assert((await savedReview).ok());
  await chat.getByTestId(`package-review-edit-${firstItem}`).waitFor();
  await chat.reload();
  await chat.getByTestId("package-review-list").waitFor();
  assert.equal((await db.itemResponse.findUniqueOrThrow({ where: { id: firstResponse.id } })).confidence_rating, "high");
  chat.once("dialog", dialog => dialog.dismiss());
  await chat.getByTestId("end-attempt").click();
  assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { session_public_id: sessionId } })).status, "active");
  chat.once("dialog", dialog => dialog.accept());
  await chat.getByTestId("end-attempt").click();
  await chat.waitForURL("**/student/assessment");
  await chat.getByTestId("review-attempt-history-assessment_mvp_irt_theta_invariance").click();
  await chat.getByTestId(`review-attempt-${sessionId}`).click();
  await chat.getByTestId("back-to-assessments").waitFor();
  assert.equal(await chat.getByTestId("end-attempt").count(), 0);
  assert.equal(await chat.locator('[data-testid^="package-review-edit-"]').count(), 0);
  console.log("PASS: package edit/cancel/save/reload, end cancel/confirm, and read-only history");
  // Verify the browser's difficult paths through the same ZIP teachers download.
  const exported = await page.evaluate(async id => {
    const response = await fetch(`/api/teacher/research-data/analysis-ready?session_public_id=${id}`);
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, sessionId);
  assert.equal(exported.status, 200, new TextDecoder().decode(new Uint8Array(exported.bytes)));
  const zip = await JSZip.loadAsync(new Uint8Array(exported.bytes));
  const file = name => zip.file(Object.keys(zip.files).find(path => path.endsWith(name)));
  const csv = async name => parse(await file(name).async("string"), { columns: true, skip_empty_lines: true });
  const csvTrue = value => value === "true" || value === "1";
  const responseRows = await csv("item_responses.csv");
  const revisionRows = await csv("response_revision_history.csv");
  const stageRows = await csv("response_stage_events.csv");
  const processRows = await csv("process_events.csv");
  const savedResponses = await db.itemResponse.findMany({ where: { concept_unit_session: { assessment_session: { session_public_id: sessionId } } }, include: { item: true } });
  assert.equal(responseRows.length, 3);
  for (const response of savedResponses) {
    const row = responseRows.find(r => r.item_public_id === response.item.item_public_id);
    for (const key of ["selected_option", "reasoning_text", "confidence_rating", "revision_count"]) assert.equal(row[key], String(response[key]));
    assert.equal(new Set(revisionRows.filter(r => r.item_public_id === row.item_public_id).map(r => r.source_turn_sequence_index)).size, response.revision_count);
    for (const type of ["item_completed", "item_submitted"]) assert.equal(processRows.filter(r => r.item_public_id === row.item_public_id && r.event_type === type).length, 1);
  }
  const lostReplyOutcome = stageRows.filter(r => r.event_type === "response_stage_outcome" && r.client_action_id === submittedIds[0]);
  assert.equal(lostReplyOutcome.length, 1, "A retried accepted request must have exactly one authoritative outcome");
  assert(csvTrue(lostReplyOutcome[0].accepted));
  assert.equal(lostReplyOutcome[0].submission_id, submittedObservations[0].submission_id);
  assert(stageRows.some(r => r.event_type === "response_stage_observation" && r.result === "request_failed"), "Lost reply is recorded as a connection failure, not lost product evidence");
  const finalItem = lostReplyOutcome[0].item_public_id;
  const finalResponse = responseRows.find(r => r.item_public_id === finalItem);
  assert.equal(finalResponse.selected_option, "B");
  assert.equal(finalResponse.reasoning_text, "I don't know the reason yet.");
  assert.equal(finalResponse.no_tempting_option, "true");
  assert.equal(finalResponse.tempting_option, "");
  assert.equal(revisionRows.filter(r => r.item_public_id === finalItem && r.changed_field === "selected_option").length, 1, "Canceling an edit must not create an accepted revision");
  assert(revisionRows.some(r => r.item_public_id === finalItem && r.changed_field === "tempting_option" && r.previous_value === "B" && r.new_value === ""));
  assert(revisionRows.some(r => r.item_public_id === firstItem && r.changed_field === "confidence_rating" && r.previous_value === "medium" && r.new_value === "high" && r.revision_phase === "before_feedback_review"));
  assert(stageRows.some(r => csvTrue(r.validation_rejected)), "Deferred content question is not an accepted justification");
  for (const type of ["attempt_paused", "attempt_resumed", "attempt_ended_by_student"]) {
    assert.equal(processRows.filter(r => r.event_type === type).length, 1, `Lifecycle event exported once: ${type}`);
  }
  await writeFile(join(output, "research-checks.json"), JSON.stringify({ sessionId, product_rows: responseRows.length,
    revision_rows: revisionRows.length, stage_rows: stageRows.length, lost_reply_accepted_outcomes: lostReplyOutcome.length, passed: true }, null, 2));
  console.log("PASS: persisted browser responses, revisions, completion counts, retry outcomes and research ZIP agree");
  await chat.screenshot({ path: join(output, "student-next-item-mobile.png"), fullPage: true });
  assert.equal(await chat.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  console.log("PASS: mobile edit advances, reload recovers old stuck state, no horizontal overflow or browser errors");
  await writeFile(join(output, "results.json"), JSON.stringify({ passed: true, errors, sessionId }));
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close(); await db.$disconnect(); server.kill("SIGTERM"); await exited;
}
