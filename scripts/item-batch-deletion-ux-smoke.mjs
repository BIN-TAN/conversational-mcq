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
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_item_delete"));
const output = await mkdtemp(join(tmpdir(), "cmcq-item-delete-ux-"));
const secret = "synthetic-item-delete-nonproduction-session-secret";
const env = { ...process.env, DATABASE_URL: database.href, SESSION_SECRET: secret,
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", OPERATIONAL_AGENT_MODE: "disabled",
  ALLOW_LOCAL_MOCK_RUNTIME: "true", APP_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
  RESEARCH_PSEUDONYMIZATION_KEY: "synthetic-item-delete-nonproduction-research-key",
  NODE_OPTIONS: `--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}` };
const seeded = spawnSync(process.execPath, ["--import", "tsx", "prisma/item-batch-deletion-smoke-test.ts", "--fixture"], { env, encoding: "utf8", timeout: 60_000 });
assert.equal(seeded.status, 0, seeded.stderr);
const fixture = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "ignore" });
const exited = new Promise(done => server.once("exit", done));
let browser;
const checks = [], external = [], mutations = [];
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/student/login")).ok) { ready = true; break; } } catch { /* Local server startup. */ }
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ user_db_id: fixture.teacher.id, user_id: fixture.teacher.user_id, role: fixture.teacher.role, auth_version: fixture.teacher.auth_version, iat: now, exp: now + 3600 })).toString("base64url");
  await context.addCookies([{ name: "cmcq_session", value: `${claims}.${createHmac("sha256", secret).update(claims).digest("base64url")}`, url: base, httpOnly: true, sameSite: "Lax" }]);
  const api = `/api/teacher/assessments/${fixture.assessmentId}`;
  const endpoint = `${api}/items/batch-deletion`;
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { external.push(url.origin); return route.abort(); }
    if (!["GET", "HEAD"].includes(request.method())) {
      mutations.push(url.pathname);
      if (request.method() !== "POST" || ![endpoint, `${endpoint}/preview`].includes(url.pathname)) return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`${base}/teacher/content/assessments/${fixture.assessmentId}`, { waitUntil: "networkidle" });
  const select = page.getByRole("checkbox", { name: /^Select item \d/ });
  assert.equal(await select.count(), 6);
  assert(await page.getByRole("button", { name: "Delete selected items", exact: true }).isDisabled());
  await page.getByRole("checkbox", { name: "Select all items", exact: true }).check();
  assert.equal(await select.filter({ visible: true }).count(), 6);
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByRole("checkbox", { name: "Select item 4", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select item 5", exact: true }).check();
  await page.getByLabel("Assessment name", { exact: true }).fill("Unsaved teacher title");
  await page.getByRole("button", { name: "Delete selected items", exact: true }).click();
  await page.getByText("After deletion: 4 items, 4 included.", { exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Delete items permanently" }).isDisabled());
  await page.getByLabel("Type DELETE 2 ITEMS to confirm").fill("DELETE");
  assert(await page.getByRole("button", { name: "Delete items permanently" }).isDisabled());
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow at ${width}`);
    assert(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth), `dialog overflow at ${width}`);
    await page.screenshot({ path: join(output, `confirmation-${width}.png`) });
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await select.count(), 6);
  assert.equal(mutations.filter(path => path === endpoint).length, 0);
  checks.push("selection, preview, exact confirmation, responsive modal and cancellation without deletion");
  await page.getByRole("button", { name: "Delete selected items", exact: true }).click();
  await page.getByLabel("Type DELETE 2 ITEMS to confirm").fill("DELETE 2 ITEMS");
  await page.getByRole("button", { name: "Delete items permanently" }).evaluate(button => { button.click(); button.click(); });
  await page.getByText("Deleted 2 items.", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(mutations.filter(path => path === endpoint).length, 1);
  assert.equal(await select.count(), 4);
  assert.equal(await page.getByLabel("Assessment name", { exact: true }).inputValue(), "Unsaved teacher title");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await select.count(), 4);
  assert.equal(await page.getByRole("checkbox", { name: "Select item 4", exact: true }).count(), 0);
  checks.push("real local deletion persists, double clicks dispatch once, unsaved settings preserved");

  await page.route(base + endpoint, route => route.fulfill({ status: 409, json: { error: { code: "conflict", message: "The mini test changed. Refresh and preview the deletion again." } } }));
  await page.getByRole("checkbox", { name: "Select item 1", exact: true }).check();
  await page.getByRole("button", { name: "Delete selected items", exact: true }).click();
  await page.getByLabel("Type DELETE 1 ITEM to confirm").fill("DELETE 1 ITEM");
  await page.getByRole("button", { name: "Delete items permanently" }).click();
  await page.getByRole("dialog").getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "Delete items permanently" }).count(), 0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await select.count(), 4);
  checks.push("stale-preview error cannot be blindly retried; items retained");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `item list overflow at ${width}`);
    await page.getByRole("heading", { name: "MCQ items", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `items-${width}.png`) });
  }
  const response = await context.request.get(base + api);
  assert.equal(response.status(), 200);
  const data = await response.json();
  await page.route(base + api, route => route.fulfill({ json: { assessment: { ...data.assessment, content_state: "locked_after_student_session", has_student_sessions: true, is_content_locked: true } } }));
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await select.count(), 0);
  assert.equal(await page.getByRole("button", { name: "Delete selected items", exact: true }).count(), 0);
  checks.push("student-used assessment projection hides deletion; desktop/mobile item list fits");
  const unauthenticated = await browser.newContext();
  const denied = await unauthenticated.request.post(base + endpoint + "/preview", { data: { item_public_ids: [fixture.itemIds[0]] } });
  assert.equal(denied.status(), 401);
  await unauthenticated.close();
  checks.push("unauthenticated deletion API rejected");
  assert.deepEqual(external, []); assert.deepEqual(pageErrors, []);
  assert(mutations.every(path => [endpoint, endpoint + "/preview"].includes(path)));
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, provider_calls: 0, production_writes: 0 }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, output }));
} finally {
  await browser?.close(); server.kill("SIGTERM"); await exited;
}
