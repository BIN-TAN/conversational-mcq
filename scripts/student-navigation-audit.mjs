import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_login_flow_"));
const output = mkdtempSync(join(tmpdir(), "cmcq-navigation-audit-"));
const suites = process.argv.slice(2);
const tests = suites.length ? suites : [
  "student-navigation-matrix-test",
  "classroom-progression-regression-test",
  "student-state-machine-smoke-test",
  "student-initial-admin-smoke-test",
  "student-conversational-flow-smoke-test",
  "student-dynamic-initial-item-count-smoke-test",
  "student-package-review-edit-smoke-test",
  "student-package-feedback-recovery-smoke-test",
  "student-assessment-start-resume-conflict-smoke-test",
  "student-attempt-lifecycle-smoke-test",
  "initial-preparation-smoke-test",
  "student-demo-recovery-smoke-test",
  "student-formative-conversation-foundation-smoke-test",
  "formative-conversation-v18r2-pipeline-runtime-smoke-test",
  "formative-conversation-v18r2-lifecycle-runtime-smoke-test",
  "formative-misconception-coverage-regression-test",
  "student-formative-waiting-attempt-review-smoke-test",
  "student-research-export-integrity-smoke-test",
  "student-teacher-readable-transcript-smoke-test",
  "student-selected-session-export-smoke-test"
];
const env = { ...process.env, NODE_ENV: "test", ALLOW_LOCAL_MOCK_RUNTIME: "true",
  ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true", LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false",
  FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false", ITEM_ADMIN_TUTOR_MODE: "mock",
  OPERATIONAL_AGENT_MODE: "disabled", OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: "" };
const results = [];
console.log(`Audit output: ${output}`);
for (const test of tests) {
  assert(/^[a-z0-9-]+$/.test(test));
  const start = Date.now();
  const run = spawnSync(process.execPath, ["--import", "./scripts/classroom-audit-network-guard.mjs",
    "--import", "tsx", `prisma/${test}.ts`], { env, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(output, `${test}.log`), `${run.stdout ?? ""}\n${run.stderr ?? ""}\n${run.error ?? ""}`);
  results.push({ test, passed: run.status === 0, seconds: (Date.now() - start) / 1000 });
  console.log(`${run.status === 0 ? "PASS" : "FAIL"} ${test} (${results.at(-1).seconds}s)`);
  if (run.status !== 0) console.log((run.stderr || run.stdout).slice(-1800));
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
}
console.log(`${results.filter(r => r.passed).length}/${results.length} suites passed. ${output}`);
process.exitCode = results.every(r => r.passed) ? 0 : 1;
