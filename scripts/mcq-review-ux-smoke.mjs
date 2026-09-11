import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_ux"));
const output = await mkdtemp(join(tmpdir(), "cmcq-review-ux-"));
const secret = "synthetic-review-ux-nonproduction-session-secret";
const env = { ...process.env, DATABASE_URL: database.href, SESSION_SECRET: secret,
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  ALLOW_LOCAL_MOCK_RUNTIME: "true", APP_ENV: "development", OPERATIONAL_AGENT_MODE: "disabled",
  RESEARCH_PSEUDONYMIZATION_KEY: "synthetic-review-nonproduction-research-key", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` };
const seeded = spawnSync(process.execPath, ["--import", "tsx", "prisma/mcq-review-ux-fixture.ts"], { env, encoding: "utf8", timeout: 60_000 });
assert.equal(seeded.status, 0, "synthetic_fixture_failed");
const fixture = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "ignore" });
const exited = new Promise(done => server.once("exit", done));
let browser;
const checks = [], external = [], unexpected = [];
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/student/login")).ok) { ready = true; break; } } catch { /* Local server startup. */ }
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(10000);
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ user_db_id: fixture.teacher.id, user_id: fixture.teacher.user_id, role: fixture.teacher.role, auth_version: fixture.teacher.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  await context.addCookies([{ name: "cmcq_session", value: `${claims}.${createHmac("sha256", secret).update(claims).digest("base64url")}`, url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); }
    if (!["GET", "HEAD"].includes(route.request().method())) { unexpected.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  const candidate = { candidate_public_id: "candidate_1", import_selected: true, item_label: "Item 1", stem: "What does reliability describe?", options: [{label:"A",text:"Consistency"},{label:"B",text:"Every interpretation is valid"}], imported_key: "A", teacher_confirmed_key: null,
    status: "needs_key", source_location: "Generated draft 1", parsing_confidence: 1, issue_flags: [], duplicate_warnings: [],
    target_reasoning_note: null, strong_reasoning_should_mention: "Existing teacher note", distractor_diagnostic_notes: "Existing distractor note", media_assets: [], suggestion_decisions: {}, formatting_decisions: {}, suggestion_status: "none" };
  let batch = { batch_public_id: "synthetic-review", source_type: "generated_evidence_blueprint", candidate_count: 1, candidates: [candidate], updated_at: "2026-09-11T00:00:00.000Z" };
  const api = `/api/teacher/assessments/${fixture.draftId}/mcq-import/synthetic-review`;
  let saveFails = false, resolveIncoming, release;
  const incoming = new Promise(done => { resolveIncoming = done; });
  const pending = new Promise(done => { release = done; });
  await page.route(base + api + "**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/suggest")) {
      resolveIncoming(route.request().postDataJSON()); await pending;
      batch = { ...batch, candidates: [{ ...candidate, suggestion_status: "pending_teacher_review", suggestion: { suggested_target_reasoning_note: "Explain consistency across repeated measurements." } }] };
    } else if (route.request().method() === "PUT") {
      if (saveFails) return route.fulfill({ status: 503, json: { error: { code: "synthetic_failure", message: "Review could not be saved." } } });
      const payload = route.request().postDataJSON();
      assert.equal(payload.expected_updated_at, batch.updated_at);
      batch = { ...batch, candidates: batch.candidates.map((entry, index) => ({ ...entry, ...payload.candidate_updates[index] })) };
    } else assert.equal(route.request().method(), "GET", "unexpected action");
    return route.fulfill({ json: { batch } });
  });
  const url = base + `/teacher/content/assessments/${fixture.draftId}/import-mcq?batch=synthetic-review`;
  await page.goto(url, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("button", { name: "Repair imported layout" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Add selected drafts (1)" }).isDisabled(), true);
  checks.push("generated drafts omit import repair; unconfirmed keys block add");
  await page.getByRole("button", { name: "Suggest missing notes (1)" }).click();
  const request = await incoming;
  assert.deepEqual(request.candidate_public_ids, ["candidate_1"]);
  assert.equal(await page.getByLabel("Stem", {exact:false}).isDisabled(), true);
  release();
  await page.getByRole("button", { name: "Review suggested notes (1)" }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: join(output, "suggestion-preview.png") });
  await page.getByRole("button", { name: "Apply 1 note", exact:true }).click();
  assert.equal(await page.getByLabel("Target reasoning note", {exact:false}).inputValue(), "Explain consistency across repeated measurements.");
  assert.equal(await page.getByLabel("Strong reasoning should mention", {exact:false}).inputValue(), "Existing teacher note");
  assert.equal(await page.getByLabel("Teacher-confirmed key", {exact:false}).inputValue(), "");
  checks.push("previewed note fills immediately without overwriting teacher notes or confirming key");
  await page.getByRole("button", { name: "Confirm imported key" }).click();
  await page.getByRole("button", { name: "Save review", exact:true }).click();
  await page.getByText("Review saved.", {exact:true}).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByLabel("Target reasoning note", {exact:false}).inputValue(), "Explain consistency across repeated measurements.");
  await page.getByLabel("Stem", {exact:false}).fill("Revised question?");
  assert.equal(await page.getByLabel("Teacher-confirmed key", {exact:false}).inputValue(), "");
  saveFails = true;
  await page.getByRole("button", { name: "Save review", exact:true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Stem", {exact:false}).inputValue(), "Revised question?");
  saveFails = false;
  await page.getByRole("button", { name: "Save review", exact:true }).click();
  await page.getByText("Review saved.", {exact:true}).waitFor();
  checks.push("saved edits survive reload; failed saves retain text; content changes reset key confirmation");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(() => scrollTo(0, 0));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    await page.screenshot({ path: join(output, `review-${width}.png`), fullPage: true });
  }
  batch = { ...batch, candidates: [{ ...batch.candidates[0], status: "imported", imported_item_public_id: "synthetic-item" }] };
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByRole("link", { name: "Open item" }).count(), 1);
  assert.equal(await page.getByLabel("Stem", {exact:false}).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Add selected drafts (0)" }).isDisabled(), true);
  checks.push("responsive layout and imported-item read-only state");
  assert.deepEqual(external, []); assert.deepEqual(unexpected, []);
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, provider_calls:0, production_writes:0 }, null, 2));
  console.log(JSON.stringify({ passed:checks.length, checks, output }));
} finally {
  await browser?.close(); server.kill("SIGTERM"); await exited;
}
