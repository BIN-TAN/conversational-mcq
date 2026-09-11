import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname), "local_database_required");
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"), "disposable_audit_database_required");

const files = [
  "classroom-data-integrity-smoke-test.ts",
  "student-formative-conversation-foundation-smoke-test.ts",
  "student-initial-admin-smoke-test.ts",
  "student-assessment-start-resume-conflict-smoke-test.ts",
  "student-attempt-lifecycle-smoke-test.ts",
  "student-conversational-flow-smoke-test.ts",
  "student-package-review-edit-smoke-test.ts",
  "student-package-feedback-recovery-smoke-test.ts",
  "student-logging-smoke-test.ts",
  "student-formative-privacy-smoke-test.ts",
  "student-dynamic-initial-item-count-smoke-test.ts",
  "student-process-event-specificity-smoke-test.ts",
  "student-item-timing-contract-smoke-test.ts",
  "student-visibility-timing-smoke-test.ts",
  "student-resumed-session-timing-smoke-test.ts",
  "auth-account-status-smoke-test.ts",
  "auth-llm-config-isolation-smoke-test.ts",
  "teacher-student-account-smoke-test.ts",
  "teacher-batch-cleanup-runtime-database-smoke-test.ts",
  "content-governance-smoke-test.ts",
  "content-revision-runtime-database-smoke-test.ts",
  "teacher-evidence-centered-item-design-smoke-test.ts",
  "teacher-evidence-centered-item-design-runtime-smoke-test.ts",
  "teacher-item-design-material-upload-smoke-test.ts",
  "teacher-student-password-reset-ui-smoke-test.ts",
  "teacher-student-batch-deletion-contract-smoke-test.ts",
  "teacher-batch-cleanup-contract-smoke-test.ts",
  "teacher-navigation-smoke-test.ts",
  "teacher-mcq-authoring-navigation-smoke-test.ts",
  "student-formative-waiting-attempt-review-smoke-test.ts",
  "student-research-export-format-smoke-test.ts",
  "student-research-export-integrity-smoke-test.ts",
  "student-research-export-readiness-smoke-test.ts",
  "student-research-export-error-ui-smoke-test.ts",
  "student-data-dictionary-privacy-smoke-test.ts",
  "student-data-dictionary-timing-smoke-test.ts",
  "formative-conversation-v18r2-contract-smoke-test.ts",
  "formative-conversation-v18r2-pipeline-runtime-smoke-test.ts",
  "formative-conversation-v18r2-lifecycle-runtime-smoke-test.ts",
  "formative-conversation-v17-transition-runtime-smoke-test.ts",
  "student-teacher-bulk-export-smoke-test.ts",
  "student-teacher-readable-transcript-smoke-test.ts",
  "student-selected-session-export-smoke-test.ts"
];

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}`.trim(),
  DATABASE_URL: database.href,
  E2E_DATABASE_URL: database.href,
  NODE_ENV: "test",
  APP_ENV: "development",
  SESSION_SECRET: "classroom-audit-nonproduction-secret-key",
  OPENAI_API_KEY: "",
  OPENAI_API_KEY_FILE: "",
  LLM_PROVIDER: "mock",
  LLM_LIVE_CALLS_ENABLED: "false",
  ITEM_ADMIN_TUTOR_MODE: "mock",
  ALLOW_LOCAL_MOCK_RUNTIME: "true",
  OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "false",
  RESEARCH_PSEUDONYMIZATION_KEY: "classroom-audit-nonproduction-pseudonymization-key"
};
const results = [];
for (const file of files) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [
    "--import", "./scripts/classroom-audit-network-guard.mjs", "--import", "tsx", `prisma/${file}`
  ], { env, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  const passed = result.status === 0;
  results.push({ file, passed, duration_ms: Date.now() - started });
  console.log(`${passed ? "PASS" : "FAIL"} ${file}`);
  if (!passed) {
    // Inputs are synthetic. Limit failure output; never print process environment.
    console.log((result.stdout + result.stderr).slice(-6000));
  }
}
console.log(JSON.stringify({
  results,
  passed: results.filter((result) => result.passed).length,
  total: files.length,
  historical_test_blockers: [
    "student-formative-conversation-runtime-smoke-test.ts: obsolete v5.3 assertion and pre-canonical-claim fixtures; unchanged, superseded here by current V18R2 runtime/lifecycle tests"
  ]
}, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
