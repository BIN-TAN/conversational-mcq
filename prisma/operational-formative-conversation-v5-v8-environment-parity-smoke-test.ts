import {
  execFileSync,
  spawn,
  spawnSync
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  createFormativeConversationV5DispatchBoundaryGate
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/candidate-runner";
import {
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/contracts";
import {
  validateFormativeConversationV5LiveEnvironment
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/live-environment";
import {
  exactFormativeConversationV5LiveAuthorization,
  loadFormativeConversationV5EvaluationPackage
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/package";
import {
  assertFormativeConversationV5LivePreflight
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/service";
import {
  buildFormativeConversationV5TestEnvironment,
  installFormativeConversationV5TestEnvironment
} from "./helpers/formative-conversation-v5-v8-test-environment";

loadEnvConfig(process.cwd());

const FAILED_V4_SOURCE_COMMIT =
  "c9082e8457c1f3a11a5fd9acbd1ca250e889363c";
const TEST_RESEARCH_KEY =
  "formative-conversation-v5-parity-secret-000000000000";
const TEST_INTERNAL_DATABASE_URL = [
  "postgresql://evaluation_user",
  "evaluation_password@dpg-evaluation-a:5432/evaluation_db"
].join(":");
const TEST_EXTERNAL_DATABASE_URL = [
  "postgresql://evaluation_user",
  "evaluation_password@dpg-evaluation-a.example.render.com:5432/evaluation_db"
].join(":");
const TEST_MISMATCHED_DATABASE_URL = [
  "postgresql://other_user",
  "other_password@dpg-other-a.example.render.com:5432/other_db"
].join(":");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function errorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof Error ? error.message : "non_error";
}

function assertThrows(
  action: () => unknown,
  expected: string
) {
  try {
    action();
  } catch (error) {
    assert(
      errorCode(error).includes(expected),
      `Expected ${expected}; received ${errorCode(error)}.`
    );
    return;
  }
  throw new Error(`Expected ${expected} to be thrown.`);
}

function sha256(filePath: string) {
  return createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex");
}

function injectedManifest(env: NodeJS.ProcessEnv) {
  env.FORMATIVE_CONVERSATION_V5_V8_INJECTED_ENVIRONMENT_KEYS =
    Object.entries(env)
      .filter(([, value]) => Boolean(value?.trim()))
      .map(([name]) => name)
      .sort()
      .join(",");
  return env;
}

async function deterministicResearchExportReadiness() {
  return {
    ready: true,
    environment: "production",
    pseudonymization_method: "HMAC-SHA-256" as const,
    pseudonymization_version: "hmac_sha256_v1",
    key_configured: true,
    safe_key_fingerprint: null,
    required_configuration: ["RESEARCH_PSEUDONYMIZATION_KEY"],
    blocking_reasons: [],
    warnings: [],
    export_schema_version: "deterministic-test-export-schema",
    readiness_version: "research-export-readiness-v1" as const,
    artifact_path_writable: true,
    database_ready: true,
    dictionary_registry_ready: true,
    restricted_export_authorization_supported: true
  };
}

async function main() {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const candidate = loaded.source_candidate;
  const base = buildFormativeConversationV5TestEnvironment({
    RESEARCH_PSEUDONYMIZATION_KEY: TEST_RESEARCH_KEY
  });
  const validationInput = {
    candidate,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    expected_active_runtime_hash:
      loaded.candidate_manifest.preserved_active_runtime_hash,
    expected_rollback_runtime_hash:
      loaded.candidate_manifest.preserved_rollback_runtime_hash
  };

  const validated = validateFormativeConversationV5LiveEnvironment({
    ...validationInput,
    env: base
  });
  assert(
    validated.active_approval.runtime_candidate_hash ===
        loaded.candidate_manifest.preserved_active_runtime_hash &&
      validated.inactive_candidate.runtime_candidate_hash ===
        loaded.runtime_candidate_hash &&
      validated.active_approval.runtime_candidate_hash !==
        validated.inactive_candidate.runtime_candidate_hash,
    "Active approval and inactive runtime candidate must be validated as separate identities."
  );

  const missingHash = injectedManifest({ ...base });
  delete missingHash.OPERATIONAL_APPROVED_CONFIG_HASH;
  assertThrows(
    () =>
      validateFormativeConversationV5LiveEnvironment({
        ...validationInput,
        env: missingHash
      }),
    "formative_conversation_v5_required_environment_missing"
  );

  const wrongHash = injectedManifest({
    ...base,
    OPERATIONAL_APPROVED_CONFIG_HASH: "f".repeat(64)
  });
  assertThrows(
    () =>
      validateFormativeConversationV5LiveEnvironment({
        ...validationInput,
        env: wrongHash
      }),
    "formative_conversation_v5_active_approval_hash_mismatch"
  );

  for (const [name, expected] of [
    [
      "OPERATIONAL_APPROVAL_BUNDLE_PATH",
      "active_approval_bundle_missing"
    ],
    [
      "OPERATIONAL_APPROVED_MANIFEST_PATH",
      "approved_manifest_path_mismatch"
    ],
    [
      "OPERATIONAL_APPROVAL_EVIDENCE_PATH",
      "approval_evidence_path_mismatch"
    ]
  ] as const) {
    const missingPath = injectedManifest({
      ...base,
      [name]: path.join(
        process.cwd(),
        `.data/missing-${name.toLowerCase()}`
      )
    });
    assertThrows(
      () =>
        validateFormativeConversationV5LiveEnvironment({
          ...validationInput,
          env: missingPath
        }),
      expected
    );
  }

  const launcherPath =
    "scripts/operational-formative-conversation-v5-v8-launcher.mjs";
  const launcherSource = readFileSync(launcherPath, "utf8");
  assert(
    launcherSource.includes('"--import"') &&
      launcherSource.includes('"tsx"') &&
      !launcherSource.includes("node_modules/.bin/tsx") &&
      !launcherSource.includes("tsx/dist/cli"),
    "The replacement launcher must use Node's tsx import hook and must not invoke the tsx IPC CLI."
  );

  const moduleProbe = spawnSync(
    process.execPath,
    [launcherPath, "--mode=module-load-probe"],
    {
      cwd: process.cwd(),
      env: base,
      encoding: "utf8"
    }
  );
  assert(
    moduleProbe.status === 0 &&
      moduleProbe.stdout.includes('"status":"cli_loaded"') &&
      !moduleProbe.stdout.includes(TEST_RESEARCH_KEY) &&
      !moduleProbe.stderr.includes(TEST_RESEARCH_KEY),
    "The exact live launcher must load the TypeScript CLI without IPC or secret disclosure."
  );

  const processLocalRunner =
    "scripts/operational-formative-conversation-v5-v8-process-local-runner.mjs";
  const processLocalTemp = mkdtempSync(
    path.join(tmpdir(), "fcv5-v5-fifo-")
  );
  const processLocalFifo = path.join(
    processLocalTemp,
    "environment.fifo"
  );
  execFileSync("mkfifo", ["-m", "600", processLocalFifo]);
  const processLocalChild = spawn(
    process.execPath,
    [
      processLocalRunner,
      "--env-fifo",
      processLocalFifo,
      "--",
      "--mode=module-load-probe"
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let processLocalStdout = "";
  let processLocalStderr = "";
  processLocalChild.stdout.on("data", (chunk) => {
    processLocalStdout += chunk.toString();
  });
  processLocalChild.stderr.on("data", (chunk) => {
    processLocalStderr += chunk.toString();
  });
  writeFileSync(
    processLocalFifo,
    JSON.stringify({
      ...base,
      DATABASE_URL: TEST_INTERNAL_DATABASE_URL,
      FORMATIVE_CONVERSATION_V5_V8_LOCAL_DATABASE_URL:
        TEST_EXTERNAL_DATABASE_URL
    })
  );
  const processLocalExit = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    processLocalChild.once("error", reject);
    processLocalChild.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  rmSync(processLocalTemp, { recursive: true, force: true });
  assert(
    processLocalExit.code === 0 &&
      !processLocalExit.signal &&
      processLocalStdout.includes('"status":"cli_loaded"') &&
      !processLocalStdout.includes(TEST_RESEARCH_KEY) &&
      !processLocalStderr.includes(TEST_RESEARCH_KEY) &&
      !processLocalStdout.includes("evaluation_password") &&
      !processLocalStderr.includes("evaluation_password"),
    "The owner-only FIFO injector must load the exact launcher without persisting or displaying secrets."
  );

  const projected = {
    ...base,
    FORMATIVE_CONVERSATION_V5_V8_ENVIRONMENT_SOURCE:
      "render_process_local",
    OPERATIONAL_APPROVAL_BUNDLE_PATH:
      "/app/.data/operational-model-upgrade/active-approval/active-approval-bundle.json",
    OPERATIONAL_APPROVED_MANIFEST_PATH:
      "/app/.data/operational-model-upgrade/active-approval/artifacts/approved-candidate-manifest.json",
    OPERATIONAL_APPROVAL_EVIDENCE_PATH:
      "/app/.data/operational-model-upgrade/active-approval/artifacts/approval-evidence.json",
    FORMATIVE_CONVERSATION_V5_V8_LOCAL_APPROVAL_BUNDLE_PATH:
      String(base.OPERATIONAL_APPROVAL_BUNDLE_PATH),
    FORMATIVE_CONVERSATION_V5_V8_LOCAL_APPROVED_MANIFEST_PATH:
      String(base.OPERATIONAL_APPROVED_MANIFEST_PATH),
    FORMATIVE_CONVERSATION_V5_V8_LOCAL_APPROVAL_EVIDENCE_PATH:
      String(base.OPERATIONAL_APPROVAL_EVIDENCE_PATH),
    DATABASE_URL: TEST_INTERNAL_DATABASE_URL,
    FORMATIVE_CONVERSATION_V5_V8_LOCAL_DATABASE_URL:
      TEST_EXTERNAL_DATABASE_URL
  };
  const preflightProbe = spawnSync(
    process.execPath,
    [launcherPath, "--mode=environment-preflight"],
    {
      cwd: process.cwd(),
      env: projected,
      encoding: "utf8",
      timeout: 120_000
    }
  );
  assert(
    preflightProbe.status === 0,
    `Exact launcher preflight failed: ${
      preflightProbe.stderr.trim() || "unknown"
    }`
  );
  assert(
    preflightProbe.stdout.includes(
      '"status": "environment_ready"'
    ) &&
      preflightProbe.stdout.includes(
        loaded.candidate_manifest.preserved_active_runtime_hash
      ) &&
      preflightProbe.stdout.includes(
        loaded.runtime_candidate_hash
      ) &&
      !preflightProbe.stdout.includes(TEST_RESEARCH_KEY) &&
      !preflightProbe.stderr.includes(TEST_RESEARCH_KEY),
    "Process-local Render projection must reach the exact pre-dispatch boundary without exposing secrets."
  );

  const mismatchedDatabaseProjection = spawnSync(
    process.execPath,
    [launcherPath, "--mode=module-load-probe"],
    {
      cwd: process.cwd(),
      env: {
        ...projected,
        FORMATIVE_CONVERSATION_V5_V8_LOCAL_DATABASE_URL:
          TEST_MISMATCHED_DATABASE_URL
      },
      encoding: "utf8"
    }
  );
  assert(
    mismatchedDatabaseProjection.status !== 0 &&
      mismatchedDatabaseProjection.stderr.includes(
        "formative_conversation_v5_database_projection_identity_mismatch"
      ) &&
      !mismatchedDatabaseProjection.stderr.includes(
        "evaluation_password"
      ) &&
      !mismatchedDatabaseProjection.stderr.includes(
        "other_password"
      ),
    "A mismatched database projection must fail before CLI loading without disclosing either credential."
  );

  const dispatchPath = path.resolve(
    FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
    "dispatch",
    `${loaded.protocol_hash}.json`
  );
  assert(
    !existsSync(dispatchPath),
    "No dispatch checkpoint may exist after no-provider environment preflight."
  );

  const restoreEnvironment =
    installFormativeConversationV5TestEnvironment({
      RESEARCH_PSEUDONYMIZATION_KEY: TEST_RESEARCH_KEY
    });
  try {
    const livePreflight =
      await assertFormativeConversationV5LivePreflight({
        runtime_candidate_hash: loaded.runtime_candidate_hash,
        evaluation_protocol_hash: loaded.protocol_hash,
        confirm_live_provider_calls: true,
        authorization:
          exactFormativeConversationV5LiveAuthorization(loaded)
      }, {
        get_research_export_readiness:
          deterministicResearchExportReadiness
      });
    assert(
      livePreflight.dispatch_boundary.status ===
        "ready_immediately_before_dispatch_checkpoint" &&
        !livePreflight.dispatch_boundary.checkpoint_created &&
        livePreflight.dispatch_boundary.provider_calls === 0,
      "Plan and live must share the same environment, module, database, export, and readiness preflight."
    );
  } finally {
    restoreEnvironment();
  }
  assert(
    !existsSync(dispatchPath),
    "Live preflight must not create a checkpoint before a generation request."
  );

  const checkpointWrites = { count: 0 };
  const checkpointWriteCount = () => checkpointWrites.count;
  const boundary =
    createFormativeConversationV5DispatchBoundaryGate(async () => {
      checkpointWrites.count += 1;
    });
  assert(
    !boundary.state().first_generation_request_authorized &&
      checkpointWriteCount() === 0,
    "The dispatch boundary must begin without a checkpoint."
  );
  await boundary.authorizeImmediatelyBeforeFirstGenerationRequest();
  await boundary.authorizeImmediatelyBeforeFirstGenerationRequest();
  assert(
    boundary.state().first_generation_request_authorized &&
      checkpointWriteCount() === 1,
    "The checkpoint callback must run exactly once at the first-generation boundary."
  );

  execFileSync(
    "git",
    [
      "diff",
      "--exit-code",
      FAILED_V4_SOURCE_COMMIT,
      "--",
      "config/operational-candidates/formative-conversation-host-v5-executable-v4",
      "prisma/operational-formative-conversation-v5-v4-fixture-materialize.ts",
      "prisma/operational-formative-conversation-v5-v4-evaluate.ts",
      "prisma/operational-formative-conversation-v5-v4-evaluation-smoke-test.ts",
      "prisma/operational-formative-conversation-v5-v4-compilation-smoke-test.ts",
      "src/lib/operational/formative-conversation-v5-evaluation-v4"
    ],
    { cwd: process.cwd(), stdio: "pipe" }
  );
  assert(
    sha256(FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH) ===
      loaded.protocol.failed_v4_pre_dispatch.evidence_sha256 &&
      loaded.failed_v4_pre_dispatch.source_plan_artifacts.every(
        (artifact) => sha256(artifact.path) === artifact.sha256
      ),
    "Committed v4 source and failed pre-dispatch evidence must remain immutable."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        runtime_candidate_hash: loaded.runtime_candidate_hash,
        active_runtime_hash:
          loaded.candidate_manifest.preserved_active_runtime_hash,
        evaluation_protocol_hash: loaded.protocol_hash,
        launcher: "node --import tsx",
        module_load_probe: "passed",
        process_local_render_projection: "passed",
        plan_live_environment_parity: "passed",
        database_readiness_queries: 0,
        provider_calls: 0,
        provider_auth_network_requests: 0,
        checkpoint_created: false,
        secret_displayed: false,
        secret_persisted: false,
        v4_evidence_immutable: true
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code: errorCode(error).split(":", 1)[0],
      provider_calls: 0,
      secrets_printed: false
    })
  );
  process.exitCode = 1;
});
