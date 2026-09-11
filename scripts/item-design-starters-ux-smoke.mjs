import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
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
const output = await mkdtemp(join(tmpdir(), "cmcq-design-starters-"));
const secret = "synthetic-design-starters-session-secret";
const env = { ...process.env, DATABASE_URL: database.href, SESSION_SECRET: secret,
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", OPERATIONAL_AGENT_MODE: "disabled",
  ALLOW_LOCAL_MOCK_RUNTIME: "true", APP_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` };
const design = {
  assessment: { assessment_public_id: "synthetic_starters", title: "Mini-test design", status: "draft", is_editable: true },
  concept_unit_public_id: "synthetic_unit", concept_unit_version: 1, blueprint_hash: "synthetic_hash",
  blueprint: {
    schema_version: "evidence-centered-item-design-v1", section_topic: "Sampling", section_summary: "Sampling choices",
    objectives: [{ objective_id: "objective_1", statement: "Evaluate sampling choices", evidence_requirements: ["Identify selection bias"] }],
    misconception_hypotheses: [], exemplar_items: [],
    generation_settings: { target_item_count: 9, option_count: 5, difficulty_mix: ["analyzing"], context_notes: null }
  },
  assistant_thread: { schema_version: "evidence-centered-item-design-thread-v1", messages: [] },
  assistant_state: { ready_for_item_generation: false, change_summary: [], remaining_questions: [] }, source_materials: []
};
let teacher, server, exited, browser;
const checks = [], external = [], writes = [], pageErrors = [];
try {
  const userId = `starter_smoke_${randomUUID()}`;
  teacher = await prisma.user.create({ data: { user_id: userId, user_id_normalized: userId, role: "teacher_researcher" } });
  const socket = createServer();
  await new Promise(done => socket.listen(0, "127.0.0.1", done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "ignore" });
  exited = new Promise(done => server.once("exit", done));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/student/login", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Local startup. */ }
    if (server.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, "local_server_not_ready");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ user_db_id: teacher.id, user_id: teacher.user_id, role: teacher.role, auth_version: teacher.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  await context.addCookies([{ name: "cmcq_session", value: `${claims}.${createHmac("sha256", secret).update(claims).digest("base64url")}`, url: base, httpOnly: true, sameSite: "Lax" }]);
  const api = "/api/teacher/assessments/synthetic_starters/item-design";
  // Mock the design response and abort every mutation; no assistant can be called.
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { external.push(url.origin); return route.abort(); }
    if (!["GET", "HEAD"].includes(request.method())) { writes.push(url.pathname); return route.abort(); }
    if (url.pathname === api) return route.fulfill({ json: design });
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  const url = base + "/teacher/content/assessments/synthetic_starters/item-design";
  await page.goto(url, { waitUntil: "networkidle" });
  const input = page.getByLabel("Message the item-design assistant", { exact: true });
  const labels = ["Build from course materials", "Plan a topic-based test", "Probe common misconceptions", "Improve existing questions"];
  const prompts = [];
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const prompt = await input.inputValue();
    assert(prompt.length > label.length + 200);
    assert.match(prompt, /9 items with 5 options/);
    assert.match(prompt, /one at a time/);
    assert.match(prompt, /for my review; do not generate items yet/);
    assert(await input.evaluate(el => document.activeElement === el));
    prompts.push(prompt);
  }
  assert.match(prompts[0], /flag gaps instead of inventing source content/);
  assert.match(prompts[1], /topic, student level, and scope/);
  assert.match(prompts[2], /not established facts/);
  assert.match(prompts[3], /uncertain keys for my confirmation/);
  checks.push("four actionable, editable starters use the current target and preserve teacher review");

  await input.fill("My course excerpt: volunteers may differ from the target population.");
  await page.getByLabel("Course material files").setInputFiles({ name: "course.png", mimeType: "image/png", buffer: Buffer.from("synthetic-local-attachment") });
  await page.getByRole("button", { name: labels[0], exact: true }).click();
  const withMaterial = await input.inputValue();
  await page.getByRole("button", { name: labels[0], exact: true }).click();
  assert.equal(await input.inputValue(), withMaterial, "repeated click must not duplicate a starter");
  await page.getByRole("tab", { name: "Review design", exact: true }).click();
  await page.getByRole("tab", { name: "Author with assistant", exact: true }).click();
  await page.getByRole("button", { name: labels[1], exact: true }).click();
  const switched = await input.inputValue();
  assert(!switched.includes("Use the course material I attach"));
  assert(switched.endsWith("My course excerpt: volunteers may differ from the target population."));
  assert.equal(await page.getByRole("list", { name: "Selected course materials" }).getByText("course.png", { exact: true }).count(), 1);
  await input.fill("My edited request and notes must remain intact.");
  await page.getByRole("button", { name: labels[2], exact: true }).click();
  assert((await input.inputValue()).endsWith("My edited request and notes must remain intact."));
  checks.push("switching starters and tabs preserves notes, custom edits and attachments without duplication");

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow at ${width}`);
    for (const label of labels) {
      assert(await page.getByRole("button", { name: label, exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth), `button overflow at ${width}: ${label}`);
    }
    await page.getByRole("heading", { name: "Plan your mini test" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `starters-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: labels[3], exact: true }).focus();
  await page.keyboard.press("Enter");
  assert(await input.evaluate(el => document.activeElement === el));
  checks.push("desktop/mobile layout and keyboard activation");

  await input.fill("x".repeat(20000));
  await page.getByRole("button", { name: labels[0], exact: true }).click();
  await page.getByText(/There is not enough room to add this starter/).waitFor();
  assert.equal((await input.inputValue()).length, 20000);
  checks.push("message limit fails safely without truncating teacher content");
  assert.deepEqual(writes, [], "starter selection must not send, save or generate anything");

  page.on("dialog", dialog => dialog.accept());
  design.assessment.is_editable = false;
  await page.reload({ waitUntil: "networkidle" });
  for (const label of labels) assert(await page.getByRole("button", { name: label, exact: true }).isDisabled());
  assert(await input.isDisabled());
  checks.push("read-only design remains locked; all interactions made zero mutation requests");
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ passed: checks.length, checks, provider_calls: 0, production_writes: 0, output }));
} finally {
  await browser?.close();
  if (server) { server.kill("SIGTERM"); await exited; }
  if (teacher) await prisma.user.delete({ where: { id: teacher.id } });
  await prisma.$disconnect();
}
