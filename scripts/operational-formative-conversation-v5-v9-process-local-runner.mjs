import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanExactSecretArtifactSet } from "../src/lib/operational/exact-secret-artifact-scanner.ts";

const LAUNCHER =
  "scripts/operational-formative-conversation-v5-v9-launcher.mjs";
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
      no_secret_values_printed: true,
      ...details
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
  let raw = readFileSync(fifoPath, "utf8");
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
        value.length >= 8 &&
        !["true", "false", "null", "undefined"].includes(
          value.toLowerCase()
        )
    )
    .map(([, value]) => value);
}

function artifactRoots(stdout, workspaceRoot) {
  try {
    const output = JSON.parse(stdout);
    const candidates = [
      output.plan_artifact_path,
      output.artifact_root,
      output.artifacts?.run_root
    ].filter((value) => typeof value === "string");
    const expectedRoot = path.resolve(
      workspaceRoot,
      ".data/operational-formative-conversation-v5-evaluation-v9"
    );
    return candidates.map((candidate) => {
      const artifactPath = path.resolve(candidate);
      if (
        artifactPath !== expectedRoot &&
        !artifactPath.startsWith(`${expectedRoot}${path.sep}`)
      ) {
        throw new Error(
          "formative_conversation_v5_artifact_path_invalid"
        );
      }
      return artifactPath;
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "formative_conversation_v5_artifact_path_invalid"
    ) {
      throw error;
    }
    return [];
  }
}

async function run() {
  const options = parsedOptions(process.argv.slice(2));
  const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  let injectedEnvironment = readEnvironmentOnce(options.fifo_path);
  let secrets = secretValues(injectedEnvironment);
  const childEnvironment = {
    ...safeHostEnvironment(),
    ...injectedEnvironment
  };
  let stdout = "";
  let stderr = "";
  try {
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
    const childErrorCode =
      stderr.match(/"error_code":"([^"]+)"/)?.[1] ?? null;
    const scan = await scanExactSecretArtifactSet({
      artifact_roots: artifactRoots(stdout, workspaceRoot),
      buffered_outputs: [stdout, stderr],
      exact_secret_values: secrets
    });
    if (scan.status !== "passed") {
      fail("formative_conversation_v5_process_local_secret_leak_detected", {
        child_error_code: childErrorCode,
        secrets_checked: scan.secrets_checked,
        files_checked: scan.files_checked,
        zip_entries_checked: scan.zip_entries_checked,
        buffered_outputs_checked: scan.buffered_outputs_checked,
        exact_matches_found: scan.exact_matches_found,
        generic_matches_found: scan.generic_matches_found,
        matches_found: scan.matches_found
      });
      return;
    }
    if (result.code !== 0 || result.signal) {
      const safeCode =
        childErrorCode ??
        "formative_conversation_v5_process_local_child_failed";
      throw new Error(safeCode);
    }
    process.stdout.write(stdout);
    process.stderr.write(
      `${JSON.stringify({
        status: "secret_scan_passed",
        scanner_version: scan.scanner_version,
        secrets_checked: scan.secrets_checked,
        files_checked: scan.files_checked,
        zip_entries_checked: scan.zip_entries_checked,
        buffered_outputs_checked: scan.buffered_outputs_checked,
        matches_found: scan.matches_found
      })}\n`
    );
  } finally {
    for (const name of Object.keys(childEnvironment)) {
      childEnvironment[name] = "";
    }
    for (const name of Object.keys(injectedEnvironment)) {
      injectedEnvironment[name] = "";
    }
    injectedEnvironment = {};
    secrets = [];
    stdout = "";
    stderr = "";
    if (existsSync(options.fifo_path)) {
      unlinkSync(options.fifo_path);
    }
  }
}

run().catch((error) => {
  fail(
    error instanceof Error
      ? error.message.split(":", 1)[0]
      : "formative_conversation_v5_process_local_runner_failed"
  );
});
