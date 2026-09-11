import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname), "local_database_required");
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_ux"), "disposable_ux_database_required");
const require = createRequire(import.meta.url);
const output = await mkdtemp(join(tmpdir(), "cmcq-ux-smoke-"));
const secret = "classroom-ux-synthetic-session-secret";
const env = {
  ...process.env,
  DATABASE_URL: database.href,
  SESSION_SECRET: secret,
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  ITEM_ADMIN_TUTOR_MODE: "mock", ALLOW_LOCAL_MOCK_RUNTIME: "true", APP_ENV: "development",
  OPERATIONAL_AGENT_MODE: "disabled", OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "false",
  RESEARCH_PSEUDONYMIZATION_KEY: "classroom-ux-synthetic-research-key", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}`
};
const seed = spawnSync(process.execPath, ["--import", "tsx", "prisma/classroom-ux-fixture.ts"], { env, encoding: "utf8", timeout: 60_000 });
assert.equal(seed.status, 0, "synthetic_fixture_failed");
const fixture = JSON.parse(seed.stdout.trim().split("\n").at(-1));
const socket = createServer();
await new Promise((done, fail) => { socket.once("error", fail); socket.listen(0, "127.0.0.1", done); });
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "ignore" });
const serverExited = new Promise(done => server.once("exit", done));
let browser;
const results = [];
const blockedExternal = [];
const unexpectedWrites = [];
async function check(name, fn) {
  let timer;
  try {
    await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 40000); })]);
  } finally { clearTimeout(timer); }
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function context(user, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  ctx.setDefaultTimeout(10000);
  ctx.setDefaultNavigationTimeout(20000);
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({ user_db_id: user.id, user_id: user.user_id, role: user.role, auth_version: user.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(value).digest("base64url");
  await ctx.addCookies([{ name: "cmcq_session", value: `${value}.${signature}`, url: base, httpOnly: true, sameSite: "Lax" }]);
  await ctx.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base) { blockedExternal.push(url.hostname); return route.abort(); }
    if (!["GET", "HEAD"].includes(request.method())) {
      // Student timing telemetry is blocked too; only synthetic fixtures are used.
      if (!url.pathname.endsWith("/events")) unexpectedWrites.push(url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  return ctx;
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${base}/student/login`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Wait for loopback startup. */ }
    if (server.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, "local_server_not_ready");
  browser = await chromium.launch({ headless: true });
  const ctx = await context(fixture.teacher);
  const page = await ctx.newPage();
  const designPath = `/teacher/content/assessments/${fixture.draftId}/item-design`;
  const apiPath = `/api/teacher/assessments/${fixture.draftId}/item-design`;
  await page.goto(base + "/teacher/content", { waitUntil: "networkidle" });
  await page.goto(base + designPath, { waitUntil: "networkidle" });
  const original = await page.evaluate(async path => (await fetch(path)).json(), apiPath);
  await check("labelled upload and keyboard tabs", async () => {
    assert.equal(await page.getByLabel("Course material files").count(), 1);
    await page.getByRole("tab", { name: "Author with assistant" }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("tab", { name: "Review design" }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tabpanel").getAttribute("aria-labelledby"), "item-design-tab-review");
  });
  await check("evidence and student examples retain spaces and newlines", async () => {
    await page.locator("summary").filter({ hasText: "Learning objective 1" }).click();
    await page.locator("summary").filter({ hasText: "Misconception example 1" }).click();
    for (const field of [page.getByLabel("What observable evidence would demonstrate this?", { exact: false }).first(), page.getByLabel("How students may express this idea", { exact: false })]) {
      await field.fill("First evidence");
      await field.press("End"); await field.press("Space"); await field.press("Enter");
      await field.pressSequentially("Second evidence");
      assert.equal(await field.inputValue(), "First evidence \nSecond evidence");
    }
  });
  await check("in-app navigation and browser Back preserve cancelled edits", async () => {
    let dialogs = 0;
    const cancel = async dialog => { dialogs++; await dialog.dismiss(); };
    page.on("dialog", cancel);
    await page.getByRole("link", { name: "Return to mini test", exact: true }).click();
    assert.equal(page.url(), base + designPath);
    await page.evaluate(() => history.back());
    await page.waitForTimeout(300);
    assert.equal(page.url(), base + designPath);
    assert.equal(await page.getByLabel("What observable evidence would demonstrate this?", { exact: false }).first().inputValue(), "First evidence \nSecond evidence");
    assert.equal(dialogs, 2);
    page.off("dialog", cancel);
  });
  await check("save normalizes submitted arrays and locks pending edits", async () => {
    let received, release;
    const incoming = new Promise(done => { received = done; });
    const released = new Promise(done => { release = done; });
    await page.route(base + apiPath, async route => {
      if (route.request().method() !== "PUT") return route.fallback();
      const request = route.request().postDataJSON();
      received(request);
      await released;
      await route.fulfill({ json: { ...original, blueprint: request.blueprint } });
    });
    const saving = page.getByRole("button", { name: "Save design", exact: true }).click();
    const request = await incoming;
    assert.deepEqual(request.blueprint.objectives[0].evidence_requirements, ["First evidence", "Second evidence"]);
    assert.deepEqual(request.blueprint.misconception_hypotheses[0].student_language_examples, ["First evidence", "Second evidence"]);
    assert.equal(await page.getByLabel("What this section covers").isDisabled(), true);
    release(); await saving;
    await page.getByText("Assessment design saved.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("What this section covers").isEnabled(), true);
    await page.unroute(base + apiPath);
  });
  await check("failed saves keep the draft and focus a visible error", async () => {
    await page.getByLabel("What this section covers").fill("Unsaved synthetic revision");
    await page.route(base + apiPath, route => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: { code: "synthetic_save_failure", message: "Save failed. Please try again." } } }) : route.fallback());
    await page.getByRole("button", { name: "Save design", exact: true }).click();
    const alert = page.getByRole("region", { name: "Design actions" }).getByRole("alert");
    await alert.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert");
    await page.screenshot({ path: join(output, "save-error.png") });
    const errorPosition = await alert.evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, viewport: innerHeight }));
    assert(errorPosition.top >= 0 && errorPosition.bottom <= errorPosition.viewport, JSON.stringify(errorPosition));
    assert.equal(await page.getByLabel("What this section covers").inputValue(), "Unsaved synthetic revision");
    await page.screenshot({ path: join(output, "save-error.png") });
  });
  await check("confirmed browser Back leaves the editor", async () => {
    page.once("dialog", dialog => dialog.accept());
    await page.evaluate(() => history.back());
    await page.waitForURL(base + "/teacher/content");
  });
  await check("password modal traps focus, cancels, and restores the trigger", async () => {
    await page.goto(base + "/teacher/students", { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", { name: "Reset password", exact: true }).first();
    await trigger.click();
    await page.getByRole("dialog").waitFor();
    for (let step = 0; step < 8; step++) {
      assert(await page.evaluate(() => !!document.activeElement?.closest("dialog")));
      await page.keyboard.press(step % 2 ? "Shift+Tab" : "Tab");
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert(await trigger.evaluate(el => document.activeElement === el));
  });
  await check("busy password reset cannot close and idle failure remains cancellable", async () => {
    let release, received;
    const pending = new Promise(done => { release = done; });
    const incoming = new Promise(done => { received = done; });
    await page.route("**/reset-password", async route => { received(); await pending; await route.fulfill({ status: 503, json: { error: { code: "synthetic_failure", message: "Reset could not be completed." } } }); });
    await page.getByRole("button", { name: "Reset password", exact: true }).first().click();
    const resetting = page.getByTestId("confirm-reset-student-password").click();
    await incoming;
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 1);
    release(); await resetting;
    await page.getByText("Reset could not be completed.", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const [name, path] of [["new-test", "/teacher/content/assessments/new"], ["design", designPath], ["exports", "/teacher/data/research"]]) {
      await check(`${name} at ${width}px has no page overflow or axe violations`, async () => {
        await page.goto(base + path, { waitUntil: "networkidle" });
        if (name === "design") await page.getByRole("tab", { name: "Review design" }).click();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "horizontal_overflow");
        if (name === "design") {
          await page.evaluate(() => scrollTo(0, 450));
          assert(await page.getByRole("button", { name: "Save design", exact: true }).evaluate(el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= innerHeight), "save_action_offscreen");
        }
        if (name === "new-test" && width < 640) assert(await page.getByLabel("Assessment name").evaluate(el => el.getBoundingClientRect().bottom < innerHeight), "mobile_header_obscures_form");
        await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
        const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
        assert.deepEqual(violations, []);
        await page.screenshot({ path: join(output, `${name}-${width}.png`) });
      });
    }
  }
  await check("research tabs support keyboard navigation", async () => {
    const tabs = page.getByRole("tab");
    await tabs.first().focus(); await page.keyboard.press("End");
    assert.equal(await tabs.last().getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tabpanel").getAttribute("aria-labelledby"), await tabs.last().getAttribute("id"));
  });
  await check("new assessment warns before discarding unsaved work", async () => {
    await page.goto(base + "/teacher/content/assessments/new", { waitUntil: "networkidle" });
    await page.getByLabel("Assessment name").fill("Unsaved new test");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByLabel("Assessment name").inputValue(), "Unsaved new test");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForURL(base + "/teacher/content/assessments");
  });
  await check("student waiting notices distinguish sending from confirmed saving; IME and cancellation work", async () => {
    const studentContext = await context(fixture.student, { width: 390, height: 844 });
    const student = await studentContext.newPage();
    await student.clock.install();
    const sessionApi = `/api/student/sessions/${fixture.activeSession}`;
    const now = new Date().toISOString();
    let conversation = {
      conversation_public_id: "synthetic-ux-conversation", status: "active", started_at: now, last_activity_at: now,
      paused_at: null, completed_at: null, opening_status: "ready", can_retry_opening: false,
      can_send: true, can_pause: true, can_resume: false, can_end: true, message_max_chars: 5000,
      assistant_response: null, transcript: []
    };
    await student.route(base + sessionApi + "/state", async route => {
      const response = await route.fetch();
      const state = await response.json();
      await route.fulfill({ json: { ...state, next_step: "formative_conversation", formative_conversation: conversation } });
    });
    await student.route(base + sessionApi + "/formative-conversation", route => route.fulfill({ json: { formative_conversation: conversation } }));
    let release, received, sends = 0;
    const pending = new Promise(done => { release = done; });
    const incoming = new Promise(done => { received = done; });
    await student.route(base + sessionApi + "/formative-conversation/messages", async route => {
      sends++; received(); await pending;
      conversation = { ...conversation, can_send: false, assistant_response: { receipt_public_id: "synthetic-receipt", status: "pending", retry_count: 0, can_retry: false } };
      await route.fulfill({ json: { formative_conversation: conversation } });
    });
    await student.goto(base + `/student/assessment/${fixture.activeSession}`, { waitUntil: "networkidle" });
    await student.getByTestId("formative-conversation-input").fill("I think reliability is consistency.");
    await student.getByTestId("formative-conversation-input").dispatchEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true });
    assert.equal(sends, 0);
    await student.getByRole("button", { name: "End conversation", exact: true }).click();
    await student.getByRole("dialog").waitFor();
    await student.keyboard.press("Escape");
    assert.equal(await student.getByRole("dialog").count(), 0);
    const send = student.getByTestId("send-formative-conversation-message").click();
    await incoming;
    const notice = student.getByTestId("formative-conversation-response-pending");
    await notice.waitFor();
    await student.clock.fastForward(11000);
    assert.match(await notice.innerText(), /Sending your message/);
    assert.doesNotMatch(await notice.innerText(), /message is saved/);
    await student.clock.fastForward(15000);
    assert.match(await notice.innerText(), /Waiting for confirmation/);
    release(); await send;
    await student.reload({ waitUntil: "networkidle" });
    await notice.waitFor();
    await student.clock.fastForward(11000);
    assert.match(await notice.innerText(), /Your message is saved/);
    assert.equal(sends, 1);
    await student.screenshot({ path: join(output, "student-waiting-mobile.png") });
  });
  await check("student past attempts stay read-only on mobile", async () => {
    const history = await context(fixture.historyStudent, { width: 390, height: 844 });
    const student = await history.newPage();
    await student.goto(base + "/student/assessment", { waitUntil: "networkidle" });
    await student.getByRole("button", { name: /Review previous attempt/ }).click();
    await student.getByRole("button", { name: "Review attempt", exact: true }).click();
    await student.getByText("Past attempt review", { exact: true }).waitFor();
    assert.equal(await student.locator("textarea,input:not([type=hidden])").count(), 0);
    assert(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await student.screenshot({ path: join(output, "student-history-mobile.png") });
  });
  assert.deepEqual(blockedExternal, []);
  assert.deepEqual(unexpectedWrites, []);
} catch (error) {
  results.push({ name: "failure", passed: false, reason: String(error) });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  const killTimer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await serverExited; clearTimeout(killTimer);
  await writeFile(join(output, "results.json"), JSON.stringify({ results, blockedExternal, unexpectedWrites, provider_calls: 0 }, null, 2));
  console.log(JSON.stringify({ results, output, provider_calls: 0 }, null, 2));
}
