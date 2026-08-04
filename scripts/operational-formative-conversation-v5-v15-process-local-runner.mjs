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
  "scripts/operational-formative-conversation-v5-v15-launcher.mjs";
const CANONICAL_LOADER_VERSION =
  "formative-conversation-v5-canonical-node-import-tsx-v1";
const CANONICAL_LOADER_MECHANISM = "node --import tsx";
const MAX_ENVIRONMENT_BYTES = 512 * 1024;
const EXACT_SECRET_NAMES = new Set([
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_FILE",
  "RESEARCH_PSEUDONYMIZATION_KEY",
  "SESSION_SECRET"
]);

function fail(code, details = {}) {
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      error_code: code,
      package_released: false,
      review_links_available: false,
      no_secret_values_printed: true,
      ...details
    })}\n`
  );
  process.exitCode = 1;
}

function canonicalLoaderActive() {
  return process.execArgv.some(
    (argument, index, argumentsList) =>
      argument === "--import=tsx" ||
      (argument === "--import" && argumentsList[index + 1] === "tsx")
  );
}

function assertCanonicalLoader() {
  if (!canonicalLoaderActive()) {
    throw new Error(
      "formative_conversation_v15_canonical_loader_required"
    );
  }
}

function parsedOptions(args) {
  const separator = args.indexOf("--");
  const wrapperArgs = separator >= 0 ? args.slice(0, separator) : args;
  const launcherArgs = separator >= 0 ? args.slice(separator + 1) : [];
  const fifoIndex = wrapperArgs.indexOf("--env-fifo");
  const fifoPath = fifoIndex >= 0 ? wrapperArgs[fifoIndex + 1] : null;
  if (
    wrapperArgs.length !== 2 ||
    fifoIndex !== 0 ||
    !fifoPath ||
    launcherArgs.length === 0
  ) {
    throw new Error(
      "formative_conversation_v15_process_local_arguments_invalid"
    );
  }
  const modeArguments = launcherArgs.filter((argument) =>
    argument.startsWith("--mode=")
  );
  if (modeArguments.length !== 1) {
    throw new Error(
      "formative_conversation_v15_process_local_mode_required"
    );
  }
  const mode = modeArguments[0].slice("--mode=".length);
  if (
    mode !== "module-load-probe" &&
    mode !== "environment-preflight" &&
    mode !== "preflight" &&
    mode !== "plan" &&
    mode !== "live"
  ) {
    throw new Error(
      "formative_conversation_v15_process_local_mode_not_permitted"
    );
  }
  return {
    fifo_path: path.resolve(fifoPath),
    launcher_args: launcherArgs,
    mode
  };
}

function readEnvironmentOnce(fifoPath) {
  const metadata = lstatSync(fifoPath);
  if (
    !metadata.isFIFO() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "formative_conversation_v15_environment_fifo_invalid"
    );
  }
  let raw = readFileSync(fifoPath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_ENVIRONMENT_BYTES) {
    throw new Error(
      "formative_conversation_v15_environment_payload_too_large"
    );
  }
  const parsed = JSON.parse(raw);
  raw = "";
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== "string")
  ) {
    throw new Error(
      "formative_conversation_v15_environment_payload_invalid"
    );
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

function exactSecretValues(environment) {
  return [
    ...new Set(
      Object.entries(environment)
        .filter(
          ([name, value]) =>
            (EXACT_SECRET_NAMES.has(name) ||
              name.endsWith("_DATABASE_URL") ||
              /(?:^|_)(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL)$/.test(
                name
              )) &&
            typeof value === "string" &&
            value.length >= 8 &&
            !["true", "false", "null", "undefined"].includes(
              value.toLowerCase()
            )
        )
        .map(([, value]) => value)
    )
  ];
}

function ensureOwnerOnlyDirectory(directoryPath) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  chmodSync(directoryPath, 0o700);
}

function safeErrorCode(error) {
  const code =
    error instanceof Error
      ? error.message.split(":", 1)[0]
      : "formative_conversation_v15_process_local_runner_failed";
  return /^formative_conversation_v15_[a-z0-9_]+$/.test(code)
    ? code
    : "formative_conversation_v15_process_local_runner_failed";
}

async function run() {
  assertCanonicalLoader();
  const {
    createFormativeConversationV15ControlChannel,
    FORMATIVE_CONVERSATION_V15_DATA_ROOT,
    FORMATIVE_CONVERSATION_V15_STAGING_ROOT,
    readFormativeConversationV15ControlPayload,
    releaseFormativeConversationV15Artifacts,
    removeFormativeConversationV15ControlChannel,
    scanFormativeConversationV15BufferedOutputs,
    writeFormativeConversationV15SafeFailureRecord
  } = await import(
    "../src/lib/operational/formative-conversation-v5-evaluation-v15/security-release.ts"
  );
  const options = parsedOptions(process.argv.slice(2));
  const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const dataRoot = path.resolve(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V15_DATA_ROOT
  );
  const stagingBoundary = path.resolve(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V15_STAGING_ROOT
  );
  let controlChannel = null;
  let stagingBase = null;
  let injectedEnvironment = {};
  let secrets = [];
  let childEnvironment = {};
  let stdout = "";
  let stderr = "";
  let secretsCleared = false;
  let channelsCleaned = false;
  let fifoRemoved = false;

  const clearSecrets = () => {
    for (let index = 0; index < secrets.length; index += 1) {
      secrets[index] = "";
    }
    for (const name of Object.keys(childEnvironment)) {
      childEnvironment[name] = "";
    }
    for (const name of Object.keys(injectedEnvironment)) {
      injectedEnvironment[name] = "";
    }
    injectedEnvironment = {};
    secretsCleared = true;
  };

  const cleanupChannels = async () => {
    if (channelsCleaned) {
      return;
    }
    if (!fifoRemoved && existsSync(options.fifo_path)) {
      unlinkSync(options.fifo_path);
      fifoRemoved = true;
    }
    if (controlChannel) {
      await removeFormativeConversationV15ControlChannel({
        control_path: controlChannel.control_path,
        control_directory: controlChannel.directory
      });
    }
    if (stagingBase) {
      rmSync(stagingBase, { recursive: true, force: true });
    }
    channelsCleaned = true;
  };

  const recordPreReleaseFailure = async (failureCode) => {
    if (!controlChannel) {
      return null;
    }
    return writeFormativeConversationV15SafeFailureRecord({
      workspace_root: workspaceRoot,
      failure_code: failureCode,
      control_nonce: controlChannel.control_nonce
    });
  };

  try {
    ensureOwnerOnlyDirectory(dataRoot);
    ensureOwnerOnlyDirectory(stagingBoundary);
    controlChannel = await createFormativeConversationV15ControlChannel();
    stagingBase = path.join(
      stagingBoundary,
      controlChannel.control_nonce
    );
    ensureOwnerOnlyDirectory(stagingBase);

    injectedEnvironment = readEnvironmentOnce(options.fifo_path);
    if (existsSync(options.fifo_path)) {
      unlinkSync(options.fifo_path);
      fifoRemoved = true;
    }
    secrets = exactSecretValues(injectedEnvironment);
    childEnvironment = {
      ...safeHostEnvironment(),
      ...injectedEnvironment,
      FORMATIVE_CONVERSATION_V5_V15_CANONICAL_OUTER_LOADER_VERSION:
        CANONICAL_LOADER_VERSION,
      FORMATIVE_CONVERSATION_V5_V15_CANONICAL_OUTER_LOADER_MECHANISM:
        CANONICAL_LOADER_MECHANISM,
      FORMATIVE_CONVERSATION_V5_V15_CANONICAL_OUTER_LOADER_VALIDATED:
        "true",
      FORMATIVE_CONVERSATION_V5_V15_CONTROL_PATH:
        controlChannel.control_path,
      FORMATIVE_CONVERSATION_V5_V15_CONTROL_NONCE:
        controlChannel.control_nonce,
      FORMATIVE_CONVERSATION_V5_V15_STAGING_BASE_ROOT: stagingBase
    };

    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(workspaceRoot, LAUNCHER),
        ...options.launcher_args
      ],
      {
        cwd: workspaceRoot,
        env: childEnvironment,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const childErrorCode =
      stderr.match(/"error_code":"([^"]+)"/)?.[1] ?? null;
    if (result.code !== 0 || result.signal) {
      let failureCode =
        childErrorCode ??
        "formative_conversation_v15_process_local_child_failed";
      try {
        scanFormativeConversationV15BufferedOutputs({
          exact_secret_values: secrets,
          buffered_outputs: [stdout, stderr]
        });
      } catch (error) {
        failureCode = safeErrorCode(error);
      }
      await recordPreReleaseFailure(failureCode);
      clearSecrets();
      rmSync(stagingBase, { recursive: true, force: true });
      throw new Error(failureCode);
    }

    if (options.mode !== "live") {
      const bufferedOutputScan =
        scanFormativeConversationV15BufferedOutputs({
          exact_secret_values: secrets,
          buffered_outputs: [stdout, stderr]
        });
      clearSecrets();
      await cleanupChannels();
      process.stdout.write(
        `${JSON.stringify({
          status: `process_local_${options.mode.replaceAll("-", "_")}_passed`,
          mode: options.mode,
          launch_mechanism_verified: true,
          control_payload_expected: false,
          package_released: false,
          checkpoint_created: false,
          provider_calls: 0,
          provider_auth_network_requests: 0,
          buffered_output_scan: bufferedOutputScan,
          secrets_cleared: secretsCleared,
          secure_channels_cleaned: channelsCleaned
        })}\n`
      );
      return;
    }

    let control;
    try {
      control = await readFormativeConversationV15ControlPayload({
        control_path: controlChannel.control_path,
        expected_nonce: controlChannel.control_nonce
      });
    } catch (error) {
      let failureCode = safeErrorCode(error);
      try {
        scanFormativeConversationV15BufferedOutputs({
          exact_secret_values: secrets,
          buffered_outputs: [stdout, stderr]
        });
      } catch (scanError) {
        failureCode = safeErrorCode(scanError);
      }
      await recordPreReleaseFailure(failureCode);
      clearSecrets();
      throw new Error(failureCode);
    }
    const release = await releaseFormativeConversationV15Artifacts({
      workspace_root: workspaceRoot,
      control,
      exact_secret_values: secrets,
      buffered_outputs: [stdout, stderr],
      clear_exact_secrets: clearSecrets
    });
    if (!secretsCleared) {
      throw new Error(
        "formative_conversation_v15_process_local_secret_clear_missing"
      );
    }
    await cleanupChannels();
    process.stdout.write(
      `${JSON.stringify({
        status: "completed_pending_human_review",
        artifact_release: release,
        ordinary_stdout_bytes: Buffer.byteLength(stdout, "utf8"),
        ordinary_stderr_bytes: Buffer.byteLength(stderr, "utf8"),
        control_channel_schema:
          control.schema_version,
        control_channel_cleaned: channelsCleaned,
        source_provider_run_id: control.provider_run_id,
        derived_evaluation_id: control.derived_evaluation_id,
        approval_eligible: false,
        activation_permitted: false
      })}\n`
    );
  } finally {
    if (!secretsCleared) {
      clearSecrets();
    }
    secrets = [];
    stdout = "";
    stderr = "";
    await cleanupChannels();
  }
}

run().catch((error) => {
  fail(
    safeErrorCode(error)
  );
});
