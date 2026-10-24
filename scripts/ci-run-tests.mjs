#!/usr/bin/env node
// Runs one list of tests from config/ci-tests.json, one test at a time, and reports the results.
//
//   node scripts/ci-run-tests.mjs <unit|database|browser> [--filter text] [--config file] [--dry-run]
//
// Every .ts and .mjs entry runs through the tsx CLI (the same as `npx tsx <file>`), so .mjs browser
// scripts can import TypeScript fixtures. Each test gets its own time limit (defaults.timeoutMinutes,
// or the entry's timeoutMinutes) and its whole process group is stopped when the limit is reached.
// Output goes to ci-logs/<list>/<name>.log. At the end the script prints a PASS/FAIL table, appends a
// Markdown summary to $GITHUB_STEP_SUMMARY when that is set, writes ci-logs/<list>/junit.xml, and exits
// 1 when any test without allowFailure failed.
//
// An entry with "database": "<name>" runs with DATABASE_URL (and E2E_DATABASE_URL) pointing at that
// database on the same server as DATABASE_URL. The database is created, migrated and seeded the first
// time it is needed. Several tests refuse to run unless the database name has a given prefix.
//
// Unless CI_NETWORK_GUARD=0, every test runs with scripts/classroom-audit-network-guard.mjs imported
// through NODE_OPTIONS, so fetch/http/https requests to any host other than localhost throw. CI never
// makes live model calls; this makes an accidental one fail instead of reaching a provider.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const args = process.argv.slice(2);
const usage = "Usage: node scripts/ci-run-tests.mjs <unit|database|browser> [--filter text] [--config file] [--dry-run]";

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} needs a value. ${usage}`);
  args.splice(index, 2);
  return value;
}
function fail(message) {
  console.error(message);
  process.exit(2);
}

const configPath = resolve(root, option("--config") ?? "config/ci-tests.json");
const filters = [];
for (let value = option("--filter"); value !== undefined; value = option("--filter")) filters.push(value);
const dryRun = args.includes("--dry-run");
const listName = args.find((arg) => !arg.startsWith("--"));
if (!listName) fail(usage);

const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!Array.isArray(config[listName])) fail(`No list "${listName}" in ${configPath}. ${usage}`);
const defaultTimeoutMinutes = Number(config.defaults?.timeoutMinutes ?? 10);

function resolveEntryPath(raw) {
  if (raw.includes("/")) return raw;
  for (const candidate of [`prisma/${raw}.ts`, `prisma/${raw}`, `scripts/${raw}.mjs`, `scripts/${raw}`]) {
    if (existsSync(join(root, candidate))) return candidate;
  }
  return `prisma/${raw}.ts`;
}

const entries = config[listName].map((raw) => {
  const entry = typeof raw === "string" ? { path: raw } : { ...raw };
  if (!entry.path) fail(`An entry in "${listName}" has no path: ${JSON.stringify(raw)}`);
  entry.path = resolveEntryPath(entry.path);
  entry.name = basename(entry.path, extname(entry.path));
  entry.timeoutMs = Number(entry.timeoutMinutes ?? defaultTimeoutMinutes) * 60_000;
  if (entry.database !== undefined && !/^[a-z][a-z0-9_]{0,62}$/.test(entry.database)) {
    fail(`Database name for ${entry.path} must be lower-case letters, digits and underscores.`);
  }
  return entry;
}).filter((entry) => filters.length === 0 || filters.some((text) => entry.path.includes(text)));

const seen = new Set();
for (const entry of entries) {
  if (seen.has(entry.path)) console.warn(`::warning::${entry.path} is listed twice in "${listName}".`);
  seen.add(entry.path);
}

const requireFromRoot = createRequire(join(root, "package.json"));
function tryResolve(specifier) {
  try {
    return requireFromRoot.resolve(specifier);
  } catch {
    return null;
  }
}
const tsxCli = tryResolve("tsx/cli");
function tsxCommand(file, extra = []) {
  return tsxCli
    ? [process.execPath, [tsxCli, file, ...extra]]
    : ["npx", ["--no-install", "tsx", file, ...extra]];
}

const baseEnv = { ...process.env, CHECKPOINT_DISABLE: "1", NEXT_TELEMETRY_DISABLED: "1" };
const guardPath = resolve(root, "scripts/classroom-audit-network-guard.mjs");
if (process.env.CI_NETWORK_GUARD !== "0" && existsSync(guardPath)) {
  const guard = `--import ${pathToFileURL(guardPath).href}`;
  if (!(baseEnv.NODE_OPTIONS ?? "").includes("classroom-audit-network-guard.mjs")) {
    baseEnv.NODE_OPTIONS = `${baseEnv.NODE_OPTIONS ?? ""} ${guard}`.trim();
  }
}

const logDir = resolve(root, "ci-logs", listName);
mkdirSync(logDir, { recursive: true });

// Databases named by entries: created on the DATABASE_URL server, migrated and seeded once per run.
const preparedDatabases = new Map();
async function databaseUrlFor(name) {
  if (preparedDatabases.has(name)) return preparedDatabases.get(name);
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL is required to prepare database ${name}.`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  const { PrismaClient } = requireFromRoot("@prisma/client");
  const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const rows = await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname = $1", name);
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
  // Migrations and seed run without the network guard; they only talk to the local database.
  const env = { ...process.env, CHECKPOINT_DISABLE: "1", DATABASE_URL: url.href, E2E_DATABASE_URL: url.href };
  const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
  const steps = [
    ["migrate deploy", process.execPath, [prismaCli, "migrate", "deploy"]],
    ["seed", ...tsxCommand("prisma/seed.ts")]
  ];
  for (const [label, command, commandArgs] of steps) {
    const result = spawnSync(command, commandArgs, { cwd: root, env, encoding: "utf8", timeout: 300_000 });
    writeFileSync(join(logDir, `_database-${name}-${label.replace(" ", "-")}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
    if (result.status !== 0) {
      throw new Error(`${label} failed for database ${name}: ${(result.stderr || result.stdout || result.error?.message || "").slice(-2000)}`);
    }
  }
  console.log(`Prepared database ${name} (created if missing, migrated, seeded).`);
  preparedDatabases.set(name, url.href);
  return url.href;
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group has already exited.
  }
}

function runOne(entry, env) {
  return new Promise((done) => {
    const logPath = join(logDir, `${entry.name}.log`);
    const log = createWriteStream(logPath);
    const tail = [];
    let tailBytes = 0;
    const keep = (chunk) => {
      log.write(chunk);
      tail.push(chunk);
      tailBytes += chunk.length;
      while (tailBytes > 200_000 && tail.length > 1) tailBytes -= tail.shift().length;
    };
    const [command, commandArgs] = tsxCommand(entry.path, entry.args ?? []);
    const started = Date.now();
    let timedOut = false;
    let child;
    try {
      child = spawn(command, commandArgs, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      log.end(String(error));
      done({ status: "FAIL", code: null, seconds: 0, detail: `could not start: ${error.message}`, logPath, output: String(error) });
      return;
    }
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      keep(Buffer.from(`\n[ci-run-tests] Time limit of ${entry.timeoutMs / 60_000} minutes reached; stopping.\n`));
      killGroup(child.pid, "SIGTERM");
      setTimeout(() => killGroup(child.pid, "SIGKILL"), 10_000).unref();
    }, entry.timeoutMs);
    let finished = false;
    const finish = (code, signal, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      // Stop anything the test left running (for example a local app server).
      killGroup(child.pid, "SIGKILL");
      const seconds = (Date.now() - started) / 1000;
      const passed = code === 0 && !timedOut && !error;
      const detail = timedOut
        ? "time limit reached"
        : error
          ? `could not start: ${error.message}`
          : code === 0
            ? ""
            : signal
              ? `stopped by ${signal}`
              : `exit code ${code}`;
      log.end(() => done({ status: passed ? "PASS" : "FAIL", code, seconds, detail, logPath, output: Buffer.concat(tail).toString("utf8") }));
    };
    child.once("error", (error) => finish(null, null, error));
    // "close" follows "exit" once the output pipes have drained. A grandchild that keeps the pipes
    // open must not hold up the run, so finish at most 5 seconds after "exit".
    child.once("close", (code, signal) => finish(code, signal));
    child.once("exit", (code, signal) => {
      setTimeout(() => finish(code, signal), 5_000).unref();
    });
  });
}

function formatSeconds(seconds) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(1)}s`;
}
function lastLines(text, count) {
  const lines = text.split("\n");
  return (lines.length > count ? [`... (${lines.length - count} earlier lines are in the log file)`, ...lines.slice(-count)] : lines).join("\n");
}
function escapeXml(text) {
  // XML 1.0 does not allow most control characters, which can appear in captured test output.
  const printable = Array.from(String(text))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");
  return printable
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

console.log(`Running ${entries.length} ${listName} test(s) from ${configPath.replace(`${root}/`, "")}${filters.length ? ` (filter: ${filters.join(", ")})` : ""}.`);
if (dryRun) {
  for (const entry of entries) console.log(`${entry.path}${entry.database ? `  [database ${entry.database}]` : ""}${entry.allowFailure ? "  [allowed to fail]" : ""}`);
  process.exit(0);
}

const results = [];
const runStarted = Date.now();
for (const [index, entry] of entries.entries()) {
  const label = `[${index + 1}/${entries.length}] ${entry.path}`;
  console.log(`RUN  ${label}`);
  let result;
  if (!existsSync(resolve(root, entry.path))) {
    result = { status: "FAIL", code: null, seconds: 0, detail: "file not found", logPath: "", output: "" };
  } else {
    const env = { ...baseEnv, ...(entry.env ?? {}) };
    try {
      if (entry.database) {
        env.DATABASE_URL = await databaseUrlFor(entry.database);
        env.E2E_DATABASE_URL = env.DATABASE_URL;
      }
      result = await runOne(entry, env);
    } catch (error) {
      result = { status: "FAIL", code: null, seconds: 0, detail: error.message.split("\n")[0], logPath: "", output: String(error.stack ?? error) };
    }
  }
  const allowed = result.status === "FAIL" && Boolean(entry.allowFailure);
  const shown = allowed ? "FAIL (allowed)" : result.status;
  results.push({ entry, ...result, allowed, shown });
  console.log(`${shown}  ${label}  ${formatSeconds(result.seconds)}${result.detail ? `  (${result.detail})` : ""}`);
  if (result.status === "FAIL") {
    console.log(`::group::Output of ${entry.path} (last 300 lines)`);
    console.log(lastLines(result.output, 300));
    console.log("::endgroup::");
    if (!allowed) console.log(`::error title=${listName} test failed::${entry.path}: ${result.detail}`);
    else console.log(`::warning title=${listName} test failed (allowed)::${entry.path}: ${result.detail}`);
  } else if (entry.allowFailure) {
    console.log(`::notice title=Allowed failure now passes::${entry.path} passed; its allowFailure can be removed from config/ci-tests.json.`);
  }
}

const totalSeconds = (Date.now() - runStarted) / 1000;
const failed = results.filter((result) => result.status === "FAIL" && !result.allowed);
const allowedFailures = results.filter((result) => result.allowed);
const passed = results.filter((result) => result.status === "PASS");

const width = Math.max(4, ...results.map((result) => result.entry.path.length));
console.log("");
console.log(`Results for the ${listName} list`);
console.log(`${"RESULT".padEnd(15)} ${"TEST".padEnd(width)} TIME`);
for (const result of [...results].sort((a, b) => (a.status === b.status ? 0 : a.status === "FAIL" ? -1 : 1))) {
  console.log(`${result.shown.padEnd(15)} ${result.entry.path.padEnd(width)} ${formatSeconds(result.seconds)}${result.detail ? `  ${result.detail}` : ""}`);
}
console.log("");
console.log(`${passed.length} passed, ${failed.length} failed, ${allowedFailures.length} failed but allowed, of ${results.length}, in ${formatSeconds(totalSeconds)}.`);
if (results.length) console.log(`Logs: ${logDir.replace(`${root}/`, "")}/`);

const junit = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<testsuite name="${escapeXml(listName)}" tests="${results.length}" failures="${failed.length}" skipped="${allowedFailures.length}" time="${totalSeconds.toFixed(1)}">`,
  ...results.map((result) => {
    const head = `  <testcase classname="${escapeXml(listName)}" name="${escapeXml(result.entry.path)}" time="${result.seconds.toFixed(1)}"`;
    if (result.status === "PASS") return `${head}/>`;
    const body = escapeXml(lastLines(result.output, 200));
    if (result.allowed) return `${head}><skipped message="${escapeXml(`failed but allowed: ${result.detail}`)}"/><system-out>${body}</system-out></testcase>`;
    return `${head}><failure message="${escapeXml(result.detail)}">${body}</failure></testcase>`;
  }),
  "</testsuite>",
  ""
].join("\n");
writeFileSync(join(logDir, "junit.xml"), junit);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = [...results].sort((a, b) => (a.status === b.status ? 0 : a.status === "FAIL" ? -1 : 1));
  const icon = (result) => (result.status === "PASS" ? "PASS" : result.allowed ? "FAIL (allowed)" : "**FAIL**");
  const markdown = [
    `### ${listName} tests: ${failed.length ? `${failed.length} failed` : "all required tests passed"}`,
    "",
    `${passed.length} passed, ${failed.length} failed, ${allowedFailures.length} failed but allowed, of ${results.length}, in ${formatSeconds(totalSeconds)}.`,
    "",
    "<details" + (failed.length ? " open" : "") + `><summary>All ${results.length} results</summary>`,
    "",
    "| Result | Test | Time | Detail |",
    "| --- | --- | --- | --- |",
    ...rows.map((result) => `| ${icon(result)} | \`${escapeCell(result.entry.path)}\` | ${formatSeconds(result.seconds)} | ${escapeCell(result.detail || (result.entry.allowFailure && result.status === "PASS" ? "passes; allowFailure can be removed" : ""))} |`),
    "",
    "</details>",
    ""
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

process.exitCode = failed.length ? 1 : 0;
