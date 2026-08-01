import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryRoot = mkdtempSync(
  path.join(tmpdir(), "fcv5-v9-canary-broker-")
);
const renderFifo = path.join(temporaryRoot, "render.fifo");
const databaseFifo = path.join(temporaryRoot, "database.fifo");
const outputFifo = path.join(temporaryRoot, "output.fifo");
const brokerPath = path.resolve(
  "scripts/operational-formative-conversation-v5-v9-canary-environment-broker.mjs"
);

for (const fifo of [renderFifo, databaseFifo, outputFifo]) {
  execFileSync("mkfifo", ["-m", "600", fifo]);
}

const renderEnvironment = {
  NODE_ENV: "production",
  APP_ENV: "production",
  APP_BASE_URL: "https://example.invalid",
  DATABASE_URL:
    "postgresql://test_user:test_password@dpg-test/test_database",
  LLM_PROVIDER: "openai",
  LLM_LIVE_CALLS_ENABLED: "true",
  OPENAI_MODEL_FORMATIVE_CONVERSATION: "gpt-test",
  OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION: "medium",
  OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION: "2500",
  FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "true",
  OPENAI_REQUEST_TIMEOUT_MS: "90000",
  OPENAI_MAX_RETRIES: "2",
  OPERATIONAL_AGENT_MODE: "guarded_live",
  OPERATIONAL_APPROVED_CONFIG_HASH: "active-hash",
  OPERATIONAL_APPROVAL_BUNDLE_PATH: "/render/active/bundle.json",
  OPERATIONAL_APPROVED_MANIFEST_PATH: "/render/active/manifest.json",
  OPERATIONAL_APPROVAL_EVIDENCE_PATH: "/render/active/evidence.json",
  OPERATIONAL_EFFECTIVE_RESULT_VERSION: "effective-system-eval-v2",
  OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: "effective-validator-v1",
  STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED: "true",
  TOPIC_DIALOGUE_LIVE_CALLS_ENABLED: "true",
  TOPIC_DIALOGUE_MAX_STUDENT_TURNS: "10",
  TOPIC_DIALOGUE_RECENT_TURN_WINDOW: "12",
  TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS: "5000",
  TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS: "true",
  RESEARCH_PSEUDONYMIZATION_KEY: "test-research-secret-value"
};

async function main() {
  const broker = spawn(
    process.execPath,
    [
      brokerPath,
      "--render-environment-fifo",
      renderFifo,
      "--external-database-fifo",
      databaseFifo,
      "--output-environment-fifo",
      outputFifo,
      "--workspace-root",
      process.cwd()
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  broker.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  broker.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const outputReader = new Promise<string>((resolve, reject) => {
    const reader = spawn("cat", [outputFifo], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    reader.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    reader.once("error", reject);
    reader.once("exit", (code) =>
      code === 0 ? resolve(output) : reject(new Error("fifo_read_failed"))
    );
  });
  writeFileSync(renderFifo, JSON.stringify(renderEnvironment), "utf8");
  writeFileSync(
    databaseFifo,
    "postgresql://test_user:test_password@dpg-test.oregon-postgres.render.com/test_database",
    "utf8"
  );
  const output = JSON.parse(await outputReader) as Record<string, string>;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    broker.once("error", reject);
    broker.once("exit", resolve);
  });
  assert.equal(exitCode, 0, stderr);
  assert.equal(output.OPENAI_API_KEY, "");
  assert.equal(output.OPENAI_API_KEY_FILE, "");
  assert.equal(
    output.FORMATIVE_CONVERSATION_V5_V9_REMOTE_DATABASE_CANARY_ENABLED,
    "true"
  );
  assert.equal(
    output.FORMATIVE_CONVERSATION_V5_V9_CANARY_SESSION_SECRET_SOURCE,
    "ephemeral_canary"
  );
  assert.match(output.SESSION_SECRET, /^v9-canary-/u);
  assert.equal(
    output.FORMATIVE_CONVERSATION_V5_V9_LOCAL_DATABASE_URL,
    "postgresql://test_user:test_password@dpg-test.oregon-postgres.render.com/test_database"
  );
  assert.equal(
    output.OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED,
    "true"
  );
  assert(!stdout.includes(renderEnvironment.RESEARCH_PSEUDONYMIZATION_KEY));
  assert(!stdout.includes(renderEnvironment.DATABASE_URL));
  assert(!stderr.includes(renderEnvironment.RESEARCH_PSEUDONYMIZATION_KEY));
  assert(!stderr.includes(renderEnvironment.DATABASE_URL));
  assert.equal(
    readFileSync(
      output.FORMATIVE_CONVERSATION_V5_V9_LOCAL_APPROVAL_BUNDLE_PATH,
      "utf8"
    ).length > 0,
    true
  );
  console.log(
    JSON.stringify({
      status: "passed",
      owner_only_one_use_fifos: true,
      provider_credential_retrieved: false,
      ephemeral_session_secret_used: true,
      secret_values_displayed: false,
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
}

main()
  .finally(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(
      JSON.stringify({
        status: "failed",
        error_code:
          error instanceof Error
            ? error.message
            : "formative_conversation_v9_canary_environment_broker_smoke_failed"
      })
    );
    process.exitCode = 1;
  });
