import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, open } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname), "local_database_required");
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"), "disposable_database_required");
const prisma = new PrismaClient({ datasourceUrl: database.href });
const output = await mkdtemp(join(tmpdir(), "cmcq-assessment-preview-"));
const secret = "synthetic-whole-test-preview-session-secret";
const env = { ...process.env, DATABASE_URL: database.href, SESSION_SECRET: secret,
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", OPERATIONAL_AGENT_MODE: "disabled",
  ALLOW_LOCAL_MOCK_RUNTIME: "true", APP_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` };
const users = [], checks = [], external = [], mutations = [], pageErrors = [];
let assessment, server, exited, browser, log;

function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ user_db_id: user.id, user_id: user.user_id, role: user.role,
    auth_version: user.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  return `${claims}.${createHmac("sha256", secret).update(claims).digest("base64url")}`;
}

async function evidenceCounts() {
  return {
    attempts: await prisma.assessmentSession.count(), responses: await prisma.itemResponse.count(),
    events: await prisma.processEvent.count(), conversations: await prisma.conversationTurn.count(),
    agents: await prisma.agentCall.count()
  };
}

async function contentSnapshot() {
  return prisma.assessment.findUnique({ where: { id: assessment.id }, include: {
    concept_units: { orderBy: { order_index: "asc" }, include: {
      items: { orderBy: { item_order: "asc" }, include: { media_assets: { orderBy: { order_index: "asc" } } } }
    } }
  } });
}

try {
  for (const role of ["teacher_researcher", "teacher_researcher", "student"]) {
    const userId = `preview_${randomUUID()}`;
    users.push(await prisma.user.create({ data: { user_id: userId, user_id_normalized: userId, role } }));
  }
  assessment = await prisma.assessment.create({ data: {
    title: "Measurement: whole-test preview", status: "published", created_by_user_db_id: users[0].id
  } });
  const stems = [
    "A researcher reports high internal consistency. Which conclusion is justified?",
    "How should a score be interpreted when its standard error of measurement is large?",
    "Which evidence best supports using a test for a new purpose?",
    "Which change would improve the representativeness of the assessment?",
    "A test is reliable in one population. What should be checked before using it elsewhere?"
  ];
  let includedIndex = 0;
  // Insert topics and item orders in reverse; the real detail API must restore their order.
  for (const unitOrder of [3, 2, 1]) {
    const unit = await prisma.conceptUnit.create({ data: {
      assessment_db_id: assessment.id, title: `Topic ${unitOrder}`, learning_objective: "Interpret measurement evidence",
      related_concept_description: "Measurement", order_index: unitOrder, status: unitOrder === 3 ? "archived" : "published"
    } });
    for (const order of unitOrder === 1 ? [17, 16, 15, 14, 13] : unitOrder === 2 ? [2, 1] : [1]) {
      const isExtra = unitOrder === 1 && order > 15;
      const stemIndex = unitOrder === 1 ? order - 13 : order + 2;
      await prisma.item.create({ data: {
        concept_unit_db_id: unit.id, item_order: order,
        item_stem: isExtra || unitOrder === 3 ? `Excluded content ${unitOrder}/${order}` : stems[stemIndex],
        options: ["A", "B", "C", "D"].map(label => ({ label, text: `Option ${label}: interpret the evidence in context.` })),
        correct_option: "B", status: order === 17 ? "archived" : "published", included_in_published_set: order !== 16,
        administration_rules: { teacher_only_note: "PRIVATE_DIAGNOSTIC_NOTE" },
        media_assets: unitOrder === 1 && order === 13 ? { create: [
          { placement: "item_stem", media_type: "image", source_type: "uploaded", public_or_signed_url: "/brand/ualberta-logo.png",
            alt_text_or_description: "Synthetic course figure", student_alt_text: "Synthetic course figure", teacher_llm_media_description: "PRIVATE_MEDIA_NOTE",
            media_context_hash: "synthetic_stem", order_index: 0 },
          { placement: "option", option_label: "C", media_type: "reference_link", source_type: "external_url", external_url: "https://example.invalid/course-notes",
            title: "Course reference", alt_text_or_description: "Option C reference", media_context_hash: "synthetic_link", order_index: 1 },
          { placement: "item_stem", media_type: "image", source_type: "uploaded", public_or_signed_url: "/brand/ualberta-logo.png",
            alt_text_or_description: "Inactive figure", active: false, media_context_hash: "synthetic_inactive", order_index: 2 }
        ] } : undefined
      } });
      if (!isExtra && unitOrder !== 3) includedIndex++;
    }
  }
  assert.equal(includedIndex, 5);
  const before = await evidenceCounts(), original = await contentSnapshot();
  const socket = createServer();
  await new Promise(done => socket.listen(0, "127.0.0.1", done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`;
  log = await open(join(output, "server.log"), "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", log.fd, log.fd] });
  exited = new Promise(done => server.once("exit", done));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/student/login", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Local startup. */ }
    if (server.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, `local_server_not_ready: ${output}`);
  const api = `/api/teacher/assessments/${assessment.assessment_public_id}`;
  assert.equal((await fetch(base + api)).status, 401);
  for (const [user, status] of [[users[1], 404], [users[2], 403]]) {
    const response = await fetch(base + api, { headers: { cookie: `cmcq_session=${session(user)}` } });
    assert.equal(response.status, status);
    assert(!(await response.text()).includes("correct_option"));
  }
  const response = await fetch(base + api, { headers: { cookie: `cmcq_session=${session(users[0])}` } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.assessment.mini_test_items.length, 8);
  checks.push("real teacher API: owner can read; anonymous, student and other teacher cannot access keys");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  await context.addCookies([{ name: "cmcq_session", value: session(users[0]), url: base, httpOnly: true, sameSite: "Lax" }]);
  let override, detailReads = 0;
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { external.push(url.origin); return route.abort(); }
    if (!["GET", "HEAD"].includes(request.method())) { mutations.push(url.pathname); return route.abort(); }
    if (url.pathname === api) {
      detailReads++;
      if (override) return route.fulfill({ json: override });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  const url = base + `/teacher/content/assessments/${assessment.assessment_public_id}`;
  await page.goto(url, { waitUntil: "networkidle" });
  const trigger = page.getByRole("button", { name: "Preview whole test", exact: true });
  await trigger.click();
  const modal = page.getByRole("dialog", { name: "Whole-test preview", exact: true });
  await modal.waitFor();
  assert.equal(await modal.getByRole("article").count(), 5);
  for (const [index, stem] of stems.entries()) {
    assert((await modal.getByRole("article").nth(index).innerText()).includes(stem));
    assert.equal(await modal.getByRole("list", { name: `Options for item ${index + 1}`, exact: true }).getByRole("listitem").count(), 4);
  }
  assert.equal(await modal.getByTestId("preview-answer-key").count(), 0);
  assert(!(await modal.innerText()).includes("PRIVATE_"));
  const image = modal.getByRole("img", { name: "Synthetic course figure", exact: true });
  await image.evaluate(el => el.decode());
  assert(await image.evaluate(el => el.naturalWidth > 0));
  assert.equal(await modal.getByRole("img", { name: "Inactive figure" }).count(), 0);
  assert.equal(await modal.getByRole("listitem").filter({ hasText: "Option C:" }).first().getByRole("link", { name: "Course reference" }).count(), 1);
  checks.push("five complete items, sequential numbering and multi-topic order; active stem/option media; keys and internal notes hidden");

  await modal.getByLabel("Show answer keys", { exact: true }).check();
  assert.equal(await modal.getByTestId("preview-answer-key").count(), 5);
  assert((await modal.getByTestId("preview-answer-key").allTextContents()).every(text => text === "Answer key: B"));
  await modal.getByRole("combobox", { name: "Items", exact: true }).selectOption("all");
  assert.equal(await modal.getByRole("article").count(), 8);
  assert.equal(await modal.getByText("Not included", { exact: true }).count(), 3);
  await page.keyboard.press("Escape");
  assert.equal(await modal.count(), 0);
  assert(await trigger.evaluate(el => el === document.activeElement));
  await trigger.click();
  assert.equal(await modal.getByTestId("preview-answer-key").count(), 0);
  assert.equal(await modal.getByRole("article").count(), 5);
  checks.push("explicit key toggle, excluded/archived item and topic labels; Escape restores focus and reopening resets options");

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await modal.evaluate(el => el.scrollWidth <= el.clientWidth), `modal overflow ${width}`);
    const close = modal.getByRole("button", { name: "Close whole-test preview" });
    const box = await close.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
    await modal.getByRole("article").last().scrollIntoViewIfNeeded();
    assert(await modal.getByRole("article").last().isVisible());
    await modal.getByTestId("assessment-preview-items").evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(output, `preview-${width}.png`) });
  }
  await modal.getByRole("button", { name: "Close whole-test preview" }).focus();
  // Native dialogs can yield focus to browser chrome, but never to the inert page.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+Tab");
    assert(await modal.evaluate(el => document.activeElement === document.body || el.contains(document.activeElement)), "background must remain inert");
  }
  await trigger.evaluate(el => el.focus());
  assert(!(await trigger.evaluate(el => el === document.activeElement)), "background trigger cannot receive focus while modal is open");
  await modal.getByRole("button", { name: "Close whole-test preview" }).focus();
  await page.keyboard.press("Escape");
  assert.equal(detailReads, 1, "opening, filtering and keys must not fetch more assessment data");
  checks.push("desktop/mobile scroll, controls and modal focus containment; no additional data reads for preview");

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const status of ["draft", "archived", "locked"]) {
    override = structuredClone(data);
    override.assessment.status = status === "locked" ? "published" : status;
    override.assessment.content_state = status === "draft" ? "draft_editable" : status === "locked" ? "locked_after_student_session" : "archived";
    override.assessment.is_content_locked = status === "locked";
    override.assessment.has_student_sessions = status === "locked";
    await page.reload({ waitUntil: "networkidle" });
    if (status === "draft") await page.getByLabel("Assessment name", { exact: true }).fill("Unsaved teacher edit");
    await trigger.click();
    assert.equal(await modal.getByRole("article").count(), 5);
    await modal.getByRole("button", { name: "Close whole-test preview" }).click();
    if (status === "draft") assert.equal(await page.getByLabel("Assessment name", { exact: true }).inputValue(), "Unsaved teacher edit");
  }
  override.assessment.mini_test_items = [];
  await page.reload({ waitUntil: "networkidle" });
  await trigger.click();
  await modal.getByText("No items have been added yet.", { exact: true }).waitFor();
  checks.push("draft, locked and archived views; unsaved edits preserved; empty test handled without errors");
  override = structuredClone(data);
  const incomplete = override.assessment.mini_test_items[0];
  incomplete.status = "draft";
  incomplete.options = null;
  incomplete.correct_option = "";
  incomplete.item_stem = "A".repeat(400);
  incomplete.media_assets[0].url = "javascript:alert('unsafe')";
  override.assessment.mini_test_items = [incomplete];
  await page.reload({ waitUntil: "networkidle" });
  await trigger.click();
  await modal.getByText("No answer options yet.", { exact: true }).waitFor();
  await modal.getByText("Media unavailable", { exact: true }).waitFor();
  await modal.getByLabel("Show answer keys", { exact: true }).check();
  assert.equal(await modal.getByTestId("preview-answer-key").innerText(), "Answer key: Not set");
  await page.setViewportSize({ width: 320, height: 700 });
  assert(await modal.getByRole("article").evaluate(el => el.scrollWidth <= el.clientWidth));
  incomplete.included_in_published_set = false;
  await page.reload({ waitUntil: "networkidle" });
  await trigger.click();
  await modal.getByText("No included items.", { exact: true }).waitFor();
  await modal.getByRole("combobox", { name: "Items", exact: true }).selectOption("all");
  assert.equal(await modal.getByRole("article").count(), 1);
  checks.push("incomplete drafts, long text, unsafe media URLs and excluded-only tests handled safely");
  assert.deepEqual(mutations, []);
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(await evidenceCounts(), before);
  assert.deepEqual(await contentSnapshot(), original);
  checks.push("zero mutations, external requests or provider calls; saved content and all research evidence counts unchanged");
  console.log(JSON.stringify({ passed: checks.length, checks, provider_calls: 0, mutation_requests: 0, output }, null, 2));
} finally {
  await browser?.close();
  if (server) { server.kill("SIGTERM"); await exited; }
  await log?.close();
  if (assessment) {
    await prisma.item.deleteMany({ where: { concept_unit: { assessment_db_id: assessment.id } } });
    await prisma.conceptUnit.deleteMany({ where: { assessment_db_id: assessment.id } });
    await prisma.assessment.delete({ where: { id: assessment.id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  await prisma.$disconnect();
}
