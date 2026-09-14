import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}`.trim(),
  DATABASE_URL: database.href, E2E_DATABASE_URL: database.href,
  NODE_ENV: "test", APP_ENV: "development", LLM_PROVIDER: "mock",
  LLM_LIVE_CALLS_ENABLED: "false", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "",
  ITEM_ADMIN_TUTOR_MODE: "mock", ALLOW_LOCAL_MOCK_RUNTIME: "true",
  OPERATIONAL_AGENT_MODE: "disabled", OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "false",
  SESSION_SECRET: "demo-audit-local-nonproduction-secret",
  RESEARCH_PSEUDONYMIZATION_KEY: "demo-audit-local-nonproduction-key"
};
const tests = [
  "student-demo-recovery-smoke-test.ts",
  "student-evidence-integrated-profile-smoke-test.ts",
  "student-agent-usage-admission-smoke-test.ts",
  "service-smoke-test.ts",
  "student-formative-conversation-foundation-smoke-test.ts",
  "student-attempt-lifecycle-smoke-test.ts",
  "student-lifecycle-command-result-smoke-test.ts",
  "student-assessment-start-resume-conflict-smoke-test.ts",
  "classroom-data-integrity-smoke-test.ts",
  "formative-conversation-v18r2-pipeline-runtime-smoke-test.ts",
  "formative-conversation-v18r2-lifecycle-runtime-smoke-test.ts",
  "student-formative-conversation-profile-handoff-smoke-test.ts",
  "student-package-feedback-recovery-smoke-test.ts",
  "student-formative-waiting-attempt-review-smoke-test.ts",
  "student-teacher-session-data-audit-smoke-test.ts",
  "student-data-collection-completeness-smoke-test.ts",
  "student-research-export-integrity-smoke-test.ts",
  "student-item-timing-contract-smoke-test.ts",
  "student-conversation-latency-grain-smoke-test.ts",
  "student-formative-privacy-smoke-test.ts",
  "research-process-delivery-smoke-test.ts",
  "research-data-quality-audit.ts"
];
const results = [];
for (const test of tests) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ["--import", "./scripts/classroom-audit-network-guard.mjs", "--import", "tsx", `prisma/${test}`], {
    env, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024
  });
  results.push({ test, passed: result.status === 0, duration_ms: Date.now() - started });
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${test}`);
  if (result.status !== 0) console.log((result.stdout + result.stderr).slice(-6000));
}
console.log(JSON.stringify({ results, passed: results.filter((result) => result.passed).length, total: tests.length }, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
