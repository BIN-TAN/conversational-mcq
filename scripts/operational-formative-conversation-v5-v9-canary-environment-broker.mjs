import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const MAX_ENVIRONMENT_BYTES = 512 * 1024;
const RENDER_ENVIRONMENT_NAMES = new Set([
  "NODE_ENV",
  "APP_ENV",
  "APP_BASE_URL",
  "DATABASE_URL",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_MODEL_FORMATIVE_CONVERSATION",
  "OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION",
  "OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION",
  "FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED",
  "OPENAI_REQUEST_TIMEOUT_MS",
  "OPENAI_MAX_RETRIES",
  "OPERATIONAL_AGENT_MODE",
  "OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED",
  "OPERATIONAL_APPROVED_CONFIG_HASH",
  "OPERATIONAL_APPROVAL_BUNDLE_PATH",
  "OPERATIONAL_APPROVED_MANIFEST_PATH",
  "OPERATIONAL_APPROVAL_EVIDENCE_PATH",
  "OPERATIONAL_EFFECTIVE_RESULT_VERSION",
  "OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION",
  "STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED",
  "TOPIC_DIALOGUE_LIVE_CALLS_ENABLED",
  "TOPIC_DIALOGUE_MAX_STUDENT_TURNS",
  "TOPIC_DIALOGUE_RECENT_TURN_WINDOW",
  "TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS",
  "TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS",
  "RESEARCH_PSEUDONYMIZATION_KEY",
  "RENDER_SERVICE_ID",
  "RENDER_INSTANCE_ID",
  "RENDER_GIT_COMMIT"
]);

function fail(code) {
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      error_code: code,
      no_secret_values_printed: true
    })}\n`
  );
  process.exitCode = 1;
}

function parseOptions(args) {
  const valueFor = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  if (
    args.length !== 8 ||
    args.some(
      (argument, index) =>
        index % 2 === 0 &&
        ![
          "--render-environment-fifo",
          "--external-database-fifo",
          "--output-environment-fifo",
          "--workspace-root"
        ].includes(argument)
    )
  ) {
    throw new Error(
      "formative_conversation_v9_canary_environment_broker_arguments_invalid"
    );
  }
  const options = {
    render_environment_fifo: valueFor("--render-environment-fifo"),
    external_database_fifo: valueFor("--external-database-fifo"),
    output_environment_fifo: valueFor("--output-environment-fifo"),
    workspace_root: valueFor("--workspace-root")
  };
  if (Object.values(options).some((value) => !value)) {
    throw new Error(
      "formative_conversation_v9_canary_environment_broker_arguments_invalid"
    );
  }
  return Object.fromEntries(
    Object.entries(options).map(([name, value]) => [
      name,
      path.resolve(String(value))
    ])
  );
}

function assertOwnerOnlyFifo(filePath) {
  const stat = lstatSync(filePath);
  if (
    !stat.isFIFO() ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(
      "formative_conversation_v9_canary_environment_fifo_invalid"
    );
  }
}

function readFifoOnce(filePath) {
  assertOwnerOnlyFifo(filePath);
  let raw = readFileSync(filePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_ENVIRONMENT_BYTES) {
    raw = "";
    throw new Error(
      "formative_conversation_v9_canary_environment_payload_too_large"
    );
  }
  return raw;
}

function parseRenderEnvironment(raw) {
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.entries(parsed).some(
      ([name, value]) =>
        !RENDER_ENVIRONMENT_NAMES.has(name) || typeof value !== "string"
    )
  ) {
    throw new Error(
      "formative_conversation_v9_render_environment_payload_invalid"
    );
  }
  for (const forbidden of [
    "OPENAI_API_KEY",
    "OPENAI_API_KEY_FILE",
    "SESSION_SECRET"
  ]) {
    if (Object.hasOwn(parsed, forbidden)) {
      throw new Error(
        "formative_conversation_v9_provider_or_session_secret_retrieved"
      );
    }
  }
  return parsed;
}

function localApprovalPaths(workspaceRoot) {
  const bundlePath = path.join(
    workspaceRoot,
    ".data/operational-model-upgrade/active-approval/active-approval-bundle.json"
  );
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  if (
    bundle.active_kind !== "derived_approval" ||
    typeof bundle.approved_manifest?.path !== "string" ||
    typeof bundle.approval_evidence?.path !== "string"
  ) {
    throw new Error(
      "formative_conversation_v9_local_active_approval_invalid"
    );
  }
  const resolveStored = (storedPath) =>
    path.isAbsolute(storedPath)
      ? storedPath
      : path.resolve(path.dirname(bundlePath), storedPath);
  const manifestPath = resolveStored(bundle.approved_manifest.path);
  const evidencePath = resolveStored(bundle.approval_evidence.path);
  if (
    !existsSync(bundlePath) ||
    !existsSync(manifestPath) ||
    !existsSync(evidencePath)
  ) {
    throw new Error(
      "formative_conversation_v9_local_active_approval_unreadable"
    );
  }
  return {
    bundle_path: bundlePath,
    manifest_path: manifestPath,
    evidence_path: evidencePath
  };
}

function assertProjectedDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "formative_conversation_v9_external_database_url_invalid"
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.username ||
    !parsed.password ||
    !parsed.hostname.endsWith(".render.com")
  ) {
    throw new Error(
      "formative_conversation_v9_external_database_url_invalid"
    );
  }
}

function clearObject(input) {
  for (const name of Object.keys(input)) {
    input[name] = "";
  }
}

function run() {
  const options = parseOptions(process.argv.slice(2));
  let renderRaw = "";
  let externalDatabaseUrl = "";
  let ephemeralSessionSecret = "";
  let renderEnvironment = {};
  let outputEnvironment = {};
  try {
    assertOwnerOnlyFifo(options.output_environment_fifo);
    renderRaw = readFifoOnce(options.render_environment_fifo);
    renderEnvironment = parseRenderEnvironment(renderRaw);
    renderRaw = "";
    externalDatabaseUrl = readFifoOnce(
      options.external_database_fifo
    ).trim();
    assertProjectedDatabaseUrl(externalDatabaseUrl);
    const approval = localApprovalPaths(options.workspace_root);
    ephemeralSessionSecret = `v9-canary-${randomBytes(48).toString(
      "base64url"
    )}`;
    outputEnvironment = {
      ...renderEnvironment,
      OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED:
        renderEnvironment
          .OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED || "true",
      SESSION_SECRET: ephemeralSessionSecret,
      OPENAI_API_KEY: "",
      OPENAI_API_KEY_FILE: "",
      FORMATIVE_CONVERSATION_V5_V9_ENVIRONMENT_SOURCE:
        "render_process_local",
      FORMATIVE_CONVERSATION_V5_V9_REMOTE_DATABASE_CANARY_ENABLED:
        "true",
      FORMATIVE_CONVERSATION_V5_V9_CANARY_SESSION_SECRET_SOURCE:
        "ephemeral_canary",
      FORMATIVE_CONVERSATION_V5_V9_LOCAL_DATABASE_URL:
        externalDatabaseUrl,
      FORMATIVE_CONVERSATION_V5_V9_LOCAL_APPROVAL_BUNDLE_PATH:
        approval.bundle_path,
      FORMATIVE_CONVERSATION_V5_V9_LOCAL_APPROVED_MANIFEST_PATH:
        approval.manifest_path,
      FORMATIVE_CONVERSATION_V5_V9_LOCAL_APPROVAL_EVIDENCE_PATH:
        approval.evidence_path
    };
    writeFileSync(
      options.output_environment_fifo,
      JSON.stringify(outputEnvironment),
      "utf8"
    );
    process.stdout.write(
      `${JSON.stringify({
        status: "environment_injected",
        render_environment_keys: Object.keys(renderEnvironment).length,
        external_database_projection_used: true,
        ephemeral_session_secret_used: true,
        provider_credential_retrieved: false,
        secret_values_displayed: false,
        secret_values_persisted: false
      })}\n`
    );
  } finally {
    renderRaw = "";
    externalDatabaseUrl = "";
    ephemeralSessionSecret = "";
    clearObject(renderEnvironment);
    clearObject(outputEnvironment);
    for (const fifoPath of [
      options.render_environment_fifo,
      options.external_database_fifo
    ]) {
      if (existsSync(fifoPath)) {
        unlinkSync(fifoPath);
      }
    }
  }
}

try {
  run();
} catch (error) {
  fail(
    error instanceof Error
      ? error.message.split(":", 1)[0]
      : "formative_conversation_v9_canary_environment_broker_failed"
  );
}
