import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER =
  "scripts/operational-formative-conversation-v18r2-ux-polish-canary-launcher.mjs";
const MAX_ENVIRONMENT_BYTES = 512 * 1024;
const EXACT_SECRET_NAMES = new Set([
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_FILE",
  "RESEARCH_PSEUDONYMIZATION_KEY",
  "SESSION_SECRET"
]);

function canonicalLoaderActive() {
  return process.execArgv.some(
    (argument, index, list) =>
      argument === "--import=tsx" ||
      (argument === "--import" && list[index + 1] === "tsx")
  );
}

function parseOptions(args) {
  const separator = args.indexOf("--");
  const wrapper = separator >= 0 ? args.slice(0, separator) : args;
  const launcher = separator >= 0 ? args.slice(separator + 1) : [];
  if (
    wrapper.length !== 2 ||
    wrapper[0] !== "--env-fifo" ||
    !wrapper[1] ||
    launcher.length === 0
  ) {
    throw new Error("v18r2_ux_canary_process_local_arguments_invalid");
  }
  const modeArgs = launcher.filter((value) => value.startsWith("--mode="));
  if (modeArgs.length !== 1) {
    throw new Error("v18r2_ux_canary_process_local_mode_required");
  }
  const mode = modeArgs[0].slice(7);
  if (!["module-load-probe", "environment-preflight", "preflight", "plan", "live"].includes(mode)) {
    throw new Error("v18r2_ux_canary_process_local_mode_invalid");
  }
  return { fifo_path: path.resolve(wrapper[1]), launcher_args: launcher, mode };
}

function readEnvironmentOnce(fifoPath) {
  const metadata = lstatSync(fifoPath);
  if (
    !metadata.isFIFO() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("v18r2_ux_canary_environment_fifo_invalid");
  }
  let raw = readFileSync(fifoPath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_ENVIRONMENT_BYTES) {
    throw new Error("v18r2_ux_canary_environment_payload_too_large");
  }
  const parsed = JSON.parse(raw);
  raw = "";
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== "string")
  ) {
    throw new Error("v18r2_ux_canary_environment_payload_invalid");
  }
  return parsed;
}

function safeHostEnvironment() {
  return Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "SHELL", "LANG", "LC_ALL", "TERM"]
      .filter((name) => typeof process.env[name] === "string")
      .map((name) => [name, process.env[name]])
  );
}

function exactSecrets(environment) {
  return [...new Set(
    Object.entries(environment)
      .filter(
        ([name, value]) =>
          (EXACT_SECRET_NAMES.has(name) ||
            name.endsWith("_DATABASE_URL") ||
            /(?:^|_)(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL)$/u.test(name)) &&
          typeof value === "string" &&
          value.length >= 8 &&
          !["true", "false", "null", "undefined"].includes(value.toLowerCase())
      )
      .map(([, value]) => value)
  )];
}

function ownerOnlyDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function safeErrorCode(error) {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^[a-z0-9_]+$/u.test(code)
    ? code
    : "v18r2_ux_canary_process_local_runner_failed";
}

async function main() {
  if (!canonicalLoaderActive()) {
    throw new Error("v18r2_ux_canary_canonical_loader_required");
  }
  const security = await import(
    "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/security-release.ts"
  );
  const options = parseOptions(process.argv.slice(2));
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataRoot = path.resolve(workspaceRoot, security.FORMATIVE_CONVERSATION_V18R2_DATA_ROOT);
  const stagingBoundary = path.resolve(
    workspaceRoot,
    security.FORMATIVE_CONVERSATION_V18R2_STAGING_ROOT
  );
  let control = null;
  let stagingBase = null;
  let injectedEnvironment = {};
  let childEnvironment = {};
  let secrets = [];
  let stdout = "";
  let stderr = "";
  let fifoRemoved = false;
  let channelsCleaned = false;
  let secretsCleared = false;

  const clearSecrets = () => {
    for (let index = 0; index < secrets.length; index += 1) secrets[index] = "";
    for (const name of Object.keys(childEnvironment)) childEnvironment[name] = "";
    for (const name of Object.keys(injectedEnvironment)) injectedEnvironment[name] = "";
    injectedEnvironment = {};
    secretsCleared = true;
  };
  const cleanup = async () => {
    if (channelsCleaned) return;
    if (!fifoRemoved && existsSync(options.fifo_path)) {
      unlinkSync(options.fifo_path);
      fifoRemoved = true;
    }
    if (control) {
      await security.removeFormativeConversationV18R2ControlChannel({
        control_path: control.control_path,
        control_directory: control.directory
      });
    }
    if (stagingBase) rmSync(stagingBase, { recursive: true, force: true });
    channelsCleaned = true;
  };
  const recordFailure = async (failureCode) =>
    control
      ? security.writeFormativeConversationV18R2SafeFailureRecord({
          workspace_root: workspaceRoot,
          failure_code: failureCode,
          control_nonce: control.control_nonce
        })
      : null;

  try {
    ownerOnlyDirectory(dataRoot);
    ownerOnlyDirectory(stagingBoundary);
    control = await security.createFormativeConversationV18R2ControlChannel();
    stagingBase = path.join(stagingBoundary, control.control_nonce);
    ownerOnlyDirectory(stagingBase);
    injectedEnvironment = readEnvironmentOnce(options.fifo_path);
    if (existsSync(options.fifo_path)) {
      unlinkSync(options.fifo_path);
      fifoRemoved = true;
    }
    secrets = exactSecrets(injectedEnvironment);
    childEnvironment = {
      ...safeHostEnvironment(),
      ...injectedEnvironment,
      FORMATIVE_CONVERSATION_V5_V18R2_CANONICAL_OUTER_LOADER_VERSION:
        "formative-conversation-v18r2-canonical-node-import-tsx-v1",
      FORMATIVE_CONVERSATION_V5_V18R2_CANONICAL_OUTER_LOADER_MECHANISM:
        "node --import tsx",
      FORMATIVE_CONVERSATION_V5_V18R2_CANONICAL_OUTER_LOADER_VALIDATED: "true",
      FORMATIVE_CONVERSATION_V18R2_UX_CANARY_OUTER_LOADER_VALIDATED: "true",
      FORMATIVE_CONVERSATION_V5_V18R2_CONTROL_PATH: control.control_path,
      FORMATIVE_CONVERSATION_V5_V18R2_CONTROL_NONCE: control.control_nonce,
      FORMATIVE_CONVERSATION_V5_V18R2_STAGING_BASE_ROOT: stagingBase
    };
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(workspaceRoot, LAUNCHER), ...options.launcher_args],
      { cwd: workspaceRoot, env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] }
    );
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (result.code !== 0 || result.signal) {
      let failureCode = stderr.match(/"error_code":"([^"]+)"/u)?.[1] ??
        "v18r2_ux_canary_process_local_child_failed";
      try {
        security.scanFormativeConversationV18R2BufferedOutputs({
          exact_secret_values: secrets,
          buffered_outputs: [stdout, stderr]
        });
      } catch (error) {
        failureCode = safeErrorCode(error);
      }
      await recordFailure(failureCode);
      clearSecrets();
      throw new Error(failureCode);
    }
    if (options.mode !== "live") {
      const scan = security.scanFormativeConversationV18R2BufferedOutputs({
        exact_secret_values: secrets,
        buffered_outputs: [stdout, stderr]
      });
      clearSecrets();
      await cleanup();
      process.stdout.write(`${JSON.stringify({
        status: `process_local_${options.mode.replaceAll("-", "_")}_passed`,
        mode: options.mode,
        launch_mechanism_verified: true,
        buffered_output_scan: scan,
        package_released: false,
        checkpoint_created: false,
        provider_calls: 0,
        model_auth_requests: 0,
        secrets_cleared: secretsCleared,
        secure_channels_cleaned: channelsCleaned
      })}\n`);
      return;
    }
    let payload;
    try {
      payload = await security.readFormativeConversationV18R2ControlPayload({
        control_path: control.control_path,
        expected_nonce: control.control_nonce
      });
    } catch (error) {
      const failureCode = safeErrorCode(error);
      await recordFailure(failureCode);
      clearSecrets();
      throw error;
    }
    const release = await security.releaseFormativeConversationV18R2Artifacts({
      workspace_root: workspaceRoot,
      control: payload,
      exact_secret_values: secrets,
      buffered_outputs: [stdout, stderr],
      clear_exact_secrets: clearSecrets
    });
    if (!secretsCleared) {
      throw new Error("v18r2_ux_canary_secret_clear_missing");
    }
    await cleanup();
    process.stdout.write(`${JSON.stringify({
      status: "completed_pending_human_review",
      source_provider_run_id: payload.provider_run_id,
      derived_evaluation_id: payload.derived_evaluation_id,
      artifact_release: release,
      approval_eligible: false,
      activation_permitted: false
    })}\n`);
  } finally {
    if (!secretsCleared) clearSecrets();
    secrets = [];
    stdout = "";
    stderr = "";
    await cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: "blocked",
    error_code: safeErrorCode(error),
    package_released: false,
    no_secret_values_printed: true
  })}\n`);
  process.exitCode = 1;
});
