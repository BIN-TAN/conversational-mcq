import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_LAUNCHER_VERSION =
  "formative-conversation-v5-canonical-node-import-tsx-launcher-v18r2";
const CANARY_LAUNCHER_VERSION =
  "formative-conversation-v18r2-ux-polish-canary-launcher-v1";
const LOADER_VERSION =
  "formative-conversation-v18r2-canonical-node-import-tsx-v1";
const CLI =
  "prisma/operational-formative-conversation-v18r2-ux-polish-canary-evaluate.ts";
const PATH_PROJECTIONS = {
  OPERATIONAL_APPROVAL_BUNDLE_PATH:
    "FORMATIVE_CONVERSATION_V5_V18R2_LOCAL_APPROVAL_BUNDLE_PATH",
  OPERATIONAL_APPROVED_MANIFEST_PATH:
    "FORMATIVE_CONVERSATION_V5_V18R2_LOCAL_APPROVED_MANIFEST_PATH",
  OPERATIONAL_APPROVAL_EVIDENCE_PATH:
    "FORMATIVE_CONVERSATION_V5_V18R2_LOCAL_APPROVAL_EVIDENCE_PATH"
};
const SOURCE_PATHS = {
  OPERATIONAL_APPROVAL_BUNDLE_PATH:
    "FORMATIVE_CONVERSATION_V5_V18R2_SOURCE_APPROVAL_BUNDLE_PATH",
  OPERATIONAL_APPROVED_MANIFEST_PATH:
    "FORMATIVE_CONVERSATION_V5_V18R2_SOURCE_APPROVED_MANIFEST_PATH",
  OPERATIONAL_APPROVAL_EVIDENCE_PATH:
    "FORMATIVE_CONVERSATION_V5_V18R2_SOURCE_APPROVAL_EVIDENCE_PATH"
};
const LOCAL_DATABASE_URL =
  "FORMATIVE_CONVERSATION_V5_V18R2_LOCAL_DATABASE_URL";

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalLoaderActive() {
  return process.execArgv.some(
    (argument, index, list) =>
      argument === "--import=tsx" ||
      (argument === "--import" && list[index + 1] === "tsx")
  );
}

function projectedDatabaseUrl(sourceValue, projectedValue) {
  let source;
  let projected;
  try {
    source = new URL(sourceValue);
    projected = new URL(projectedValue);
  } catch {
    throw new Error("v18r2_ux_canary_database_projection_url_invalid");
  }
  const protocols = new Set(["postgres:", "postgresql:"]);
  const sourceHost = source.hostname.toLowerCase();
  const projectedHost = projected.hostname.toLowerCase();
  if (
    !protocols.has(source.protocol) ||
    !protocols.has(projected.protocol) ||
    source.username !== projected.username ||
    source.password !== projected.password ||
    source.pathname !== projected.pathname ||
    (source.port || "5432") !== (projected.port || "5432") ||
    sourceHost === projectedHost ||
    !projectedHost.startsWith(`${sourceHost}.`)
  ) {
    throw new Error("v18r2_ux_canary_database_projection_identity_mismatch");
  }
  return projectedValue;
}

function childEnvironment() {
  const child = { ...process.env };
  const injected = new Set(
    Object.entries(child)
      .filter(([, value]) => configured(value))
      .map(([name]) => name)
  );
  const projectedPaths = Object.entries(PATH_PROJECTIONS).filter(
    ([, projection]) => configured(process.env[projection])
  );
  if (
    projectedPaths.length !== 0 &&
    projectedPaths.length !== Object.keys(PATH_PROJECTIONS).length
  ) {
    throw new Error("v18r2_ux_canary_approval_path_projection_incomplete");
  }
  if (projectedPaths.length > 0) {
    for (const [runtimeName, projectionName] of projectedPaths) {
      if (!configured(process.env[runtimeName])) {
        throw new Error("v18r2_ux_canary_render_approval_source_missing");
      }
      child[SOURCE_PATHS[runtimeName]] = process.env[runtimeName];
      child[runtimeName] = path.resolve(process.env[projectionName]);
      injected.add(runtimeName);
    }
    child.FORMATIVE_CONVERSATION_V5_V18R2_APPROVAL_PATH_PROJECTION_USED =
      "true";
    child.FORMATIVE_CONVERSATION_V5_V18R2_ENVIRONMENT_SOURCE ??=
      "render_process_local";
  } else {
    child.FORMATIVE_CONVERSATION_V5_V18R2_APPROVAL_PATH_PROJECTION_USED =
      "false";
    if (
      !configured(child.FORMATIVE_CONVERSATION_V5_V18R2_ENVIRONMENT_SOURCE) &&
      (configured(child.RENDER_SERVICE_ID) || configured(child.RENDER_INSTANCE_ID))
    ) {
      child.FORMATIVE_CONVERSATION_V5_V18R2_ENVIRONMENT_SOURCE =
        "render_runtime";
    }
  }
  if (configured(process.env[LOCAL_DATABASE_URL])) {
    if (!configured(process.env.DATABASE_URL)) {
      throw new Error("v18r2_ux_canary_render_database_source_missing");
    }
    child.DATABASE_URL = projectedDatabaseUrl(
      process.env.DATABASE_URL,
      process.env[LOCAL_DATABASE_URL]
    );
    child.FORMATIVE_CONVERSATION_V5_V18R2_DATABASE_CONNECTION_SOURCE =
      "render_external_process_local";
    child.FORMATIVE_CONVERSATION_V5_V18R2_DATABASE_IDENTITY_MATCHED = "true";
    injected.add("DATABASE_URL");
  } else if (
    child.FORMATIVE_CONVERSATION_V5_V18R2_ENVIRONMENT_SOURCE === "render_runtime"
  ) {
    child.FORMATIVE_CONVERSATION_V5_V18R2_DATABASE_CONNECTION_SOURCE =
      "render_internal";
    child.FORMATIVE_CONVERSATION_V5_V18R2_DATABASE_IDENTITY_MATCHED = "true";
  }
  for (const name of Object.values(PATH_PROJECTIONS)) delete child[name];
  delete child[LOCAL_DATABASE_URL];
  Object.assign(child, {
    FORMATIVE_CONVERSATION_V5_V18R2_LAUNCHER_VERSION: BASE_LAUNCHER_VERSION,
    FORMATIVE_CONVERSATION_V5_V18R2_LAUNCH_MECHANISM: "node --import tsx",
    FORMATIVE_CONVERSATION_V5_V18R2_CANONICAL_LAUNCHER_VALIDATED: "true",
    FORMATIVE_CONVERSATION_V5_V18R2_CANONICAL_LOADER_VERSION: LOADER_VERSION,
    FORMATIVE_CONVERSATION_V18R2_UX_CANARY_CANONICAL_LAUNCHER_VALIDATED:
      "true",
    FORMATIVE_CONVERSATION_V18R2_UX_CANARY_LAUNCHER_VERSION:
      CANARY_LAUNCHER_VERSION
  });
  for (const name of Object.keys(child)) {
    if (configured(child[name])) injected.add(name);
  }
  child.FORMATIVE_CONVERSATION_V5_V18R2_INJECTED_ENVIRONMENT_KEYS =
    [...injected].sort().join(",");
  return child;
}

function validateArguments(args) {
  const mode = args.find((value) => value.startsWith("--mode="))?.slice(7) ?? "plan";
  if (!["module-load-probe", "environment-preflight", "preflight", "plan", "live"].includes(mode)) {
    throw new Error("v18r2_ux_canary_mode_invalid");
  }
  if (["environment-preflight", "preflight", "live"].includes(mode)) {
    const expected = args.filter((value) =>
      value.startsWith("--expected-deployed-git-sha=")
    );
    if (expected.length !== 1 || !/^[a-f0-9]{40}$/u.test(expected[0].slice(28))) {
      throw new Error("v18r2_ux_canary_expected_git_sha_invalid");
    }
  }
}

function fail(error) {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  process.stderr.write(`${JSON.stringify({
    status: "blocked",
    error_code: /^[a-z0-9_]+$/u.test(code)
      ? code
      : "v18r2_ux_canary_launcher_failed",
    no_secret_values_printed: true
  })}\n`);
  process.exitCode = 1;
}

function main() {
  try {
    if (!canonicalLoaderActive()) {
      throw new Error("v18r2_ux_canary_canonical_loader_required");
    }
    const args = process.argv.slice(2);
    validateArguments(args);
    const workspaceRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      ".."
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(workspaceRoot, CLI), ...args],
      { cwd: workspaceRoot, env: childEnvironment(), stdio: "inherit" }
    );
    child.once("error", () => fail(new Error("v18r2_ux_canary_cli_start_failed")));
    child.once("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
    });
  } catch (error) {
    fail(error);
  }
}

main();
