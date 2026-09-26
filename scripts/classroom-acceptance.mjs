import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import nextEnv from "@next/env";

const phase = process.argv[2] ?? "all";
assert(["all", "server", "browser"].includes(phase), "Choose all, server, or browser");
nextEnv.loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname), "Only a local database may create disposable acceptance databases");
const output = mkdtempSync(join(tmpdir(), "cmcq-acceptance-"));
const sourceHash = () => {
  const sourceFiles = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src", "prisma", "scripts", "config", "package.json", "package-lock.json", "next.config.*", "tsconfig.json"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const hash = createHash("sha256");
  for (const file of [...new Set(sourceFiles)].sort()) hash.update(file + "\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
};
const identity = sourceHash();
const env = { ...process.env, NODE_ENV: "test", APP_ENV: "development",
  NODE_OPTIONS: `--max-old-space-size=8192 --import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}`,
  SESSION_SECRET: "classroom-acceptance-local-synthetic-secret", NEXT_TELEMETRY_DISABLED: "1",
  RESEARCH_PSEUDONYMIZATION_KEY: "classroom-acceptance-synthetic-research-key",
  OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "", LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false",
  FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", ALLOW_LOCAL_MOCK_RUNTIME: "true",
  ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true", ITEM_ADMIN_TUTOR_MODE: "mock",
  OPERATIONAL_AGENT_MODE: "disabled", OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "false" };
const results = [];
const report = () => writeFileSync(join(output, "report.json"), JSON.stringify({
  version: "classroom-acceptance-run-v2", intended_use: "teacher_supervised_formative_classroom", source_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  source_sha256: identity, source_unchanged: sourceHash() === identity, phase, results,
  completed_at: new Date().toISOString(), provider_calls: 0,
  classroom_instructional_validation: "pending_independent_review_and_student_pilot",
  high_stakes_status: "consequential_decisions_not_authorized",
  unverified: ["current-live-model diagnostic and instructional quality", "independent content and key review",
    "response-process interpretation with representative students", "classroom-scale full browser/provider load",
    "fairness and accessibility with representative students", "learning and transfer effects", "teacher oversight and intervention"]
}, null, 2));
function run(name, command, args, runEnv = env, timeout = 240000) {
  console.log(`RUN ${name}`);
  const started = Date.now();
  const result = spawnSync(command, args, { env: runEnv, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
  writeFileSync(join(output, `${name}.log`), log);
  results.push({ name, passed: result.status === 0 && !result.error, exit_code: result.status,
    duration_ms: Date.now() - started, log_sha256: createHash("sha256").update(log).digest("hex") });
  report(); console.log(`${results.at(-1).passed ? "PASS" : "FAIL"} ${name}`);
  if (!results.at(-1).passed) console.log(log.slice(-3000));
  return results.at(-1).passed;
}
const admin = new PrismaClient({ datasourceUrl: url.href });
async function database(prefix, operation) {
  const name = `${prefix}${randomBytes(5).toString("hex")}`;
  assert(/^[a-z0-9_]+$/.test(name) && name.length <= 63);
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
    const local = new URL(url); local.pathname = `/${name}`;
    const localEnv = { ...env, DATABASE_URL: local.href, E2E_DATABASE_URL: local.href };
    assert(run(`${name}-migrate`, process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], localEnv));
    assert(run(`${name}-seed`, process.execPath, ["--import", "tsx", "prisma/seed.ts"], localEnv));
    await operation(localEnv);
  } finally {
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
}
console.log(`Acceptance artifacts: ${output}`);
try {
  if (phase !== "browser") {
    run("typecheck", "npm", ["run", "typecheck"]);
    run("lint", "npm", ["run", "lint"]);
    await database("conversational_mcq_classroom_audit_acceptance_", async localEnv => {
      run("classroom-audit", process.execPath, ["scripts/classroom-audit.mjs"], localEnv, 1800000);
    });
    await database("conversational_mcq_classroom_audit_login_flow_", async localEnv => {
      run("navigation-audit", process.execPath, ["scripts/student-navigation-audit.mjs"], localEnv, 900000);
    });
  }
  if (phase !== "server") {
    // Some server tests start next dev. Build only after those children stop.
    const built = run("production-build", "npm", ["run", "build"], { ...env, NODE_ENV: "production" }, 900000);
    if (built) {
      await database("conversational_mcq_classroom_audit_login_flow_", async localEnv => {
        run("login-progression-browser", process.execPath, ["--import", "tsx", "scripts/classroom-login-progression-browser-smoke.mjs"], localEnv);
      });
      await database("conversational_mcq_classroom_audit_ux_", async localEnv => {
        run("response-stage-browser", process.execPath, ["--import", "tsx", "scripts/response-stage-browser-smoke.mjs"], localEnv);
        run("initial-preparation-browser", process.execPath, ["--import", "tsx", "scripts/initial-preparation-ux-smoke.mjs"], localEnv);
      });
    }
  }
} catch (error) {
  results.push({ name: "runner", passed: false, error: error instanceof Error ? error.message : "runner_failed" });
} finally {
  await admin.$disconnect(); report();
  process.exitCode = results.length > 0 && results.every(result => result.passed) && sourceHash() === identity ? 0 : 1;
  console.log(`Engineering result: ${process.exitCode === 0 ? "passed selected phase" : "failed"}. Classroom instructional validation remains open. ${output}`);
}
