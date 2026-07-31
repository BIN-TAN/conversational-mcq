import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER_VERSION =
  "formative-conversation-v5-node-import-tsx-launcher-v1";
const LAUNCH_MECHANISM = "node --import tsx";
const EVALUATION_CLI =
  "prisma/operational-formative-conversation-v5-v6-evaluate.ts";
const LOCAL_PATH_PROJECTION = {
  OPERATIONAL_APPROVAL_BUNDLE_PATH:
    "FORMATIVE_CONVERSATION_V5_V6_LOCAL_APPROVAL_BUNDLE_PATH",
  OPERATIONAL_APPROVED_MANIFEST_PATH:
    "FORMATIVE_CONVERSATION_V5_V6_LOCAL_APPROVED_MANIFEST_PATH",
  OPERATIONAL_APPROVAL_EVIDENCE_PATH:
    "FORMATIVE_CONVERSATION_V5_V6_LOCAL_APPROVAL_EVIDENCE_PATH"
};
const SOURCE_PATH_ENV = {
  OPERATIONAL_APPROVAL_BUNDLE_PATH:
    "FORMATIVE_CONVERSATION_V5_V6_SOURCE_APPROVAL_BUNDLE_PATH",
  OPERATIONAL_APPROVED_MANIFEST_PATH:
    "FORMATIVE_CONVERSATION_V5_V6_SOURCE_APPROVED_MANIFEST_PATH",
  OPERATIONAL_APPROVAL_EVIDENCE_PATH:
    "FORMATIVE_CONVERSATION_V5_V6_SOURCE_APPROVAL_EVIDENCE_PATH"
};
const LOCAL_DATABASE_URL =
  "FORMATIVE_CONVERSATION_V5_V6_LOCAL_DATABASE_URL";

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

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

function validatedProjectedDatabaseUrl(sourceValue, projectedValue) {
  let source;
  let projected;
  try {
    source = new URL(sourceValue);
    projected = new URL(projectedValue);
  } catch {
    throw new Error(
      "formative_conversation_v5_database_projection_url_invalid"
    );
  }
  const postgresProtocols = new Set(["postgres:", "postgresql:"]);
  const sourceHost = source.hostname.toLowerCase();
  const projectedHost = projected.hostname.toLowerCase();
  if (
    !postgresProtocols.has(source.protocol) ||
    !postgresProtocols.has(projected.protocol) ||
    source.username !== projected.username ||
    source.password !== projected.password ||
    source.pathname !== projected.pathname ||
    (source.port || "5432") !== (projected.port || "5432") ||
    sourceHost === projectedHost ||
    !projectedHost.startsWith(`${sourceHost}.`)
  ) {
    throw new Error(
      "formative_conversation_v5_database_projection_identity_mismatch"
    );
  }
  return projectedValue;
}

function childEnvironment() {
  const child = { ...process.env };
  const injectedKeys = new Set(
    Object.entries(process.env)
      .filter(([, value]) => configured(value))
      .map(([name]) => name)
  );
  const projectionEntries = Object.entries(
    LOCAL_PATH_PROJECTION
  ).filter(([, projectionName]) =>
    configured(process.env[projectionName])
  );

  if (
    projectionEntries.length !== 0 &&
    projectionEntries.length !==
      Object.keys(LOCAL_PATH_PROJECTION).length
  ) {
    throw new Error(
      "formative_conversation_v5_approval_path_projection_incomplete"
    );
  }

  if (projectionEntries.length > 0) {
    for (const [runtimeName, projectionName] of projectionEntries) {
      const sourceValue = process.env[runtimeName];
      if (!configured(sourceValue)) {
        throw new Error(
          `formative_conversation_v5_render_source_path_missing:${runtimeName}`
        );
      }
      child[SOURCE_PATH_ENV[runtimeName]] = sourceValue;
      child[runtimeName] = path.resolve(
        String(process.env[projectionName])
      );
      injectedKeys.add(runtimeName);
    }
    child.FORMATIVE_CONVERSATION_V5_V6_APPROVAL_PATH_PROJECTION_USED =
      "true";
    child.FORMATIVE_CONVERSATION_V5_V6_ENVIRONMENT_SOURCE ??=
      "render_process_local";
  } else {
    child.FORMATIVE_CONVERSATION_V5_V6_APPROVAL_PATH_PROJECTION_USED =
      "false";
    if (
      !configured(
        child.FORMATIVE_CONVERSATION_V5_V6_ENVIRONMENT_SOURCE
      ) &&
      (configured(child.RENDER_SERVICE_ID) ||
        configured(child.RENDER_INSTANCE_ID))
    ) {
      child.FORMATIVE_CONVERSATION_V5_V6_ENVIRONMENT_SOURCE =
        "render_runtime";
    }
  }

  if (configured(process.env[LOCAL_DATABASE_URL])) {
    if (!configured(process.env.DATABASE_URL)) {
      throw new Error(
        "formative_conversation_v5_render_database_source_missing"
      );
    }
    child.DATABASE_URL = validatedProjectedDatabaseUrl(
      process.env.DATABASE_URL,
      process.env[LOCAL_DATABASE_URL]
    );
    child.FORMATIVE_CONVERSATION_V5_V6_DATABASE_CONNECTION_SOURCE =
      "render_external_process_local";
    child.FORMATIVE_CONVERSATION_V5_V6_DATABASE_IDENTITY_MATCHED =
      "true";
    injectedKeys.add("DATABASE_URL");
  } else if (
    child.FORMATIVE_CONVERSATION_V5_V6_ENVIRONMENT_SOURCE ===
    "render_runtime"
  ) {
    child.FORMATIVE_CONVERSATION_V5_V6_DATABASE_CONNECTION_SOURCE =
      "render_internal";
    child.FORMATIVE_CONVERSATION_V5_V6_DATABASE_IDENTITY_MATCHED =
      "true";
  }

  for (const projectionName of Object.values(
    LOCAL_PATH_PROJECTION
  )) {
    delete child[projectionName];
  }
  delete child[LOCAL_DATABASE_URL];
  child.FORMATIVE_CONVERSATION_V5_V6_LAUNCHER_VERSION =
    LAUNCHER_VERSION;
  child.FORMATIVE_CONVERSATION_V5_V6_LAUNCH_MECHANISM =
    LAUNCH_MECHANISM;
  for (const name of [
    "FORMATIVE_CONVERSATION_V5_V6_ENVIRONMENT_SOURCE",
    "FORMATIVE_CONVERSATION_V5_V6_APPROVAL_PATH_PROJECTION_USED",
    "FORMATIVE_CONVERSATION_V5_V6_DATABASE_CONNECTION_SOURCE",
    "FORMATIVE_CONVERSATION_V5_V6_DATABASE_IDENTITY_MATCHED",
    "FORMATIVE_CONVERSATION_V5_V6_LAUNCHER_VERSION",
    "FORMATIVE_CONVERSATION_V5_V6_LAUNCH_MECHANISM"
  ]) {
    if (configured(child[name])) {
      injectedKeys.add(name);
    }
  }
  child.FORMATIVE_CONVERSATION_V5_V6_INJECTED_ENVIRONMENT_KEYS =
    [...injectedKeys].sort().join(",");
  return child;
}

function main() {
  const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  let env;
  try {
    env = childEnvironment();
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message.split(":", 1)[0]
        : "formative_conversation_v5_launcher_environment_failed"
    );
    return;
  }

  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(workspaceRoot, EVALUATION_CLI),
      ...process.argv.slice(2)
    ],
    {
      cwd: workspaceRoot,
      env,
      stdio: "inherit"
    }
  );
  child.once("error", () => {
    fail("formative_conversation_v5_cli_child_start_failed");
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

main();
