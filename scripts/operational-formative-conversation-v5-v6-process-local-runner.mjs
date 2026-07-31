import { spawn } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER =
  "scripts/operational-formative-conversation-v5-v6-launcher.mjs";
const MAX_ENVIRONMENT_BYTES = 512 * 1024;
const EXACT_SECRET_NAMES = new Set([
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_FILE",
  "RESEARCH_PSEUDONYMIZATION_KEY",
  "SESSION_SECRET"
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

function parsedOptions(args) {
  const separator = args.indexOf("--");
  const wrapperArgs =
    separator >= 0 ? args.slice(0, separator) : args;
  const launcherArgs =
    separator >= 0 ? args.slice(separator + 1) : [];
  const fifoIndex = wrapperArgs.indexOf("--env-fifo");
  const fifoPath =
    fifoIndex >= 0 ? wrapperArgs[fifoIndex + 1] : null;
  if (
    wrapperArgs.length !== 2 ||
    fifoIndex !== 0 ||
    !fifoPath ||
    launcherArgs.length === 0
  ) {
    throw new Error(
      "formative_conversation_v5_process_local_arguments_invalid"
    );
  }
  return {
    fifo_path: path.resolve(fifoPath),
    launcher_args: launcherArgs
  };
}

function readEnvironmentOnce(fifoPath) {
  const stat = lstatSync(fifoPath);
  if (
    !stat.isFIFO() ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" &&
      stat.uid !== process.getuid())
  ) {
    throw new Error(
      "formative_conversation_v5_environment_fifo_invalid"
    );
  }
  let raw;
  try {
    raw = readFileSync(fifoPath, "utf8");
  } finally {
    unlinkSync(fifoPath);
  }
  if (
    Buffer.byteLength(raw, "utf8") > MAX_ENVIRONMENT_BYTES
  ) {
    throw new Error(
      "formative_conversation_v5_environment_payload_too_large"
    );
  }
  const parsed = JSON.parse(raw);
  raw = "";
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some(
      (value) => typeof value !== "string"
    )
  ) {
    throw new Error(
      "formative_conversation_v5_environment_payload_invalid"
    );
  }
  return parsed;
}

function safeHostEnvironment() {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "SHELL",
      "LANG",
      "LC_ALL",
      "TERM"
    ]
      .filter((name) => typeof process.env[name] === "string")
      .map((name) => [name, process.env[name]])
  );
}

function secretValues(environment) {
  return Object.entries(environment)
    .filter(
      ([name, value]) =>
        (EXACT_SECRET_NAMES.has(name) ||
          name.endsWith("_DATABASE_URL") ||
          /(?:^|_)(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL)$/.test(
            name
          )) &&
        typeof value === "string" &&
        value.length > 0
    )
    .map(([, value]) => value);
}

function containsSecret(text, secrets) {
  return secrets.some((secret) => text.includes(secret));
}

function planArtifactPath(stdout, workspaceRoot) {
  try {
    const output = JSON.parse(stdout);
    if (
      output.status !== "planned" ||
      typeof output.plan_artifact_path !== "string"
    ) {
      return null;
    }
    const artifactPath = path.resolve(
      output.plan_artifact_path
    );
    const expectedRoot = path.resolve(
      workspaceRoot,
      ".data/operational-formative-conversation-v5-evaluation-v6/plans"
    );
    if (
      artifactPath !== expectedRoot &&
      !artifactPath.startsWith(`${expectedRoot}${path.sep}`)
    ) {
      throw new Error(
        "formative_conversation_v5_plan_artifact_path_invalid"
      );
    }
    return artifactPath;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "formative_conversation_v5_plan_artifact_path_invalid"
    ) {
      throw error;
    }
    return null;
  }
}

async function run() {
  const options = parsedOptions(process.argv.slice(2));
  const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  let injectedEnvironment = readEnvironmentOnce(
    options.fifo_path
  );
  const secrets = secretValues(injectedEnvironment);
  const childEnvironment = {
    ...safeHostEnvironment(),
    ...injectedEnvironment
  };
  const child = spawn(
    process.execPath,
    [
      path.join(workspaceRoot, LAUNCHER),
      ...options.launcher_args
    ],
    {
      cwd: workspaceRoot,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

  let artifactPath = null;
  if (result.code === 0 && !result.signal) {
    artifactPath = planArtifactPath(stdout, workspaceRoot);
  }
  const artifactText = artifactPath
    ? readFileSync(artifactPath, "utf8")
    : "";
  const leaked =
    containsSecret(stdout, secrets) ||
    containsSecret(stderr, secrets) ||
    containsSecret(artifactText, secrets);

  for (const name of Object.keys(childEnvironment)) {
    childEnvironment[name] = "";
  }
  for (const name of Object.keys(injectedEnvironment)) {
    injectedEnvironment[name] = "";
  }
  injectedEnvironment = {};

  if (leaked) {
    throw new Error(
      "formative_conversation_v5_process_local_secret_leak_detected"
    );
  }
  if (result.code !== 0 || result.signal) {
    const safeCode =
      stderr.match(/"error_code":"([^"]+)"/)?.[1] ??
      "formative_conversation_v5_process_local_child_failed";
    throw new Error(safeCode);
  }
  process.stdout.write(stdout);
}

run().catch((error) => {
  fail(
    error instanceof Error
      ? error.message.split(":", 1)[0]
      : "formative_conversation_v5_process_local_runner_failed"
  );
});
