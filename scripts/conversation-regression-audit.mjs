import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL);
assert(["localhost", "127.0.0.1"].includes(url.hostname), "Only local synthetic databases allowed.");
const admin = new PrismaClient({ datasourceUrl: url.href });
const name = "conversational_mcq_classroom_audit_login_flow_" + randomBytes(5).toString("hex");
const local = new URL(url); local.pathname = "/" + name;
const output = ".data/conversation-regression/" + name;
mkdirSync(output, { recursive: true });
const env = { ...process.env, DATABASE_URL: local.href, NODE_ENV: "test",
  SESSION_SECRET: "local-synthetic-regression-secret-key", RESEARCH_PSEUDONYMIZATION_KEY: "synthetic-research-only-key",
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false",
  ALLOW_LOCAL_MOCK_RUNTIME: "true", ITEM_ADMIN_TUTOR_MODE: "mock", OPERATIONAL_AGENT_MODE: "disabled", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "" };
const suites = [
  "student-navigation-matrix-test", "classroom-progression-regression-test",
  "student-assessment-start-resume-conflict-smoke-test", "student-attempt-lifecycle-smoke-test",
  "student-package-review-edit-smoke-test", "student-package-feedback-recovery-smoke-test",
  "initial-preparation-smoke-test", "initial-feedback-failure-smoke-test",
  "formative-conversation-v18r2-pipeline-runtime-smoke-test", "formative-conversation-v18r2-lifecycle-runtime-smoke-test",
  "formative-conversation-v18r2-ux-polish-smoke-test", "formative-misconception-coverage-regression-test",
  "student-formative-waiting-attempt-review-smoke-test", "feedback-display-completion-smoke-test",
  "student-research-export-integrity-smoke-test", "student-selected-session-export-smoke-test",
  "profile-record-projection-smoke-test", "research-timing-separation-smoke-test",
  "response-stage-observation-smoke-test", "research-suitability-contract-smoke-test",
  "teacher-dashboard-smoke-test", "student-teacher-readable-transcript-smoke-test"
];
const selectedSuites = process.argv.slice(2).length ? process.argv.slice(2) : suites;
let created = false;
const results = [];
function run(label, args) {
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(`${output}/${label}.log`, (result.stdout || "") + (result.stderr || "") + (result.error || ""));
  results.push({ label, passed: result.status === 0 && !result.error });
  console.log(label, result.status, (result.stdout || "").slice(-14000), (result.stderr || "").slice(-2500));
  return results.at(-1).passed;
}
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
  assert(run("migrate", ["node_modules/prisma/build/index.js", "migrate", "deploy"]));
  assert(run("seed", ["--import", "tsx", "prisma/seed.ts"]));
  run("suites", ["scripts/student-navigation-audit.mjs", ...selectedSuites]);
} finally {
  if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.$disconnect();
  writeFileSync(`${output}/results.json`, JSON.stringify({ suites: selectedSuites, results, database_dropped: created }, null, 2));
  console.log(JSON.stringify({ output, results }));
  process.exitCode = results.every(row => row.passed) ? 0 : 1;
}
