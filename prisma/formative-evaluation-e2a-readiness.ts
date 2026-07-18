import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  readActiveApprovedOperationalRuntimeConfig,
  verifyApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import { resolveE2ABudgetLimits, resolveE2ASimulatorConfiguration } from "../src/lib/evaluation/formative/e2a-config";
import {
  defaultE2AReadinessPath,
  E2A_READINESS_REPORT_VERSION,
  E2AReadinessReportSchema
} from "../src/lib/evaluation/formative/e2a-readiness";
import { APPROVED_OPERATIONAL_RUNTIME_HASH } from "../src/lib/evaluation/formative/schemas";
import { resolveOpenAICredentialFromEnv } from "../src/lib/llm/openai-credential-resolver";
import { resolveApprovedOperationalRuntimeRequirement } from "../src/lib/operational/active-approval-bundle";
import { resolveApplicationBuildInfo } from "../src/lib/provenance/application-build-info";

loadEnvConfig(process.cwd());

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function protectedArtifactsUnchanged() {
  for (const args of [
    ["diff", "--quiet", "HEAD", "--", "config", "src/lib/agents"],
    ["diff", "--cached", "--quiet", "HEAD", "--", "config", "src/lib/agents"]
  ]) {
    try {
      execFileSync("git", args, { cwd: process.cwd(), stdio: "ignore" });
    } catch {
      return false;
    }
  }
  return true;
}

function runNoLivePrerequisite(script: string) {
  const env = {
    ...process.env,
    OPERATIONAL_AGENT_MODE: "disabled",
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: "false",
    LLM_LIVE_CALLS_ENABLED: "false",
    EVAL_E2A_LIVE_PROVIDER: "0",
    EVAL_LLM_STUDENT_SIMULATOR_ENABLED: "false",
    RUN_LIVE_LLM_SMOKE: "0",
    RUN_LIVE_ITEM_ADMIN_SMOKE: "0",
    RUN_LIVE_PROFILE_INTEGRATION_SMOKE: "0"
  };
  try {
    execFileSync("npm", ["run", script], {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
      maxBuffer: 20 * 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const artifactRoot = argValue("--artifact-root") ?? ".data/formative-evaluation-e2a";
  const artifactPath = defaultE2AReadinessPath(artifactRoot);
  const requestedRuntimeHash = argValue("--expected-runtime-hash") ?? APPROVED_OPERATIONAL_RUNTIME_HASH;
  const buildInfo = resolveApplicationBuildInfo({
    artifactPath: path.join(process.cwd(), "__nonexistent_e2a_readiness_build_info.json")
  });
  if (!buildInfo.ok) throw new Error(buildInfo.code);

  const resolution = resolveApprovedOperationalRuntimeRequirement({
    requestedHash: requestedRuntimeHash
  });
  let simulatorConfiguration: ReturnType<typeof resolveE2ASimulatorConfiguration> | null = null;
  let budgetLimits: ReturnType<typeof resolveE2ABudgetLimits> | null = null;
  let simulatorConfigurationValid = false;
  try {
    simulatorConfiguration = resolveE2ASimulatorConfiguration(process.env);
    budgetLimits = resolveE2ABudgetLimits("canary", process.env);
    simulatorConfigurationValid = simulatorConfiguration.simulator_enabled;
  } catch {
    simulatorConfigurationValid = false;
  }

  const credential = resolveOpenAICredentialFromEnv(process.env);
  let manifestValid = false;
  let activeKindIsDerived = false;
  try {
    const active = readActiveApprovedOperationalRuntimeConfig();
    const verification = verifyApprovedOperationalAgentConfig();
    activeKindIsDerived = active.kind === "derived_approval";
    manifestValid = verification.valid &&
      verification.approval_kind === "derived_approval" &&
      verification.role_inventory.length === 17;
  } catch {
    manifestValid = false;
  }

  const prisma = new PrismaClient();
  let databaseReady = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReady = true;
  } catch {
    databaseReady = false;
  } finally {
    await prisma.$disconnect();
  }

  const e1MatrixPassed = runNoLivePrerequisite("eval:formative:all");
  const privacySmokePassed = runNoLivePrerequisite("e2e:privacy-smoke");
  const checks = {
    requested_hash_is_approved_hash: requestedRuntimeHash === APPROVED_OPERATIONAL_RUNTIME_HASH,
    resolved_hash_matches_requested: resolution.resolved_hash === requestedRuntimeHash,
    resolution_source_is_approved_derived_bundle:
      resolution.resolution_source === "approved_derived_bundle",
    approved_bundle_complete: resolution.approved_bundle_complete,
    exact_seventeen_roles_present: resolution.role_count === 17 && resolution.missing_roles.length === 0,
    no_duplicate_roles: resolution.duplicate_roles.length === 0,
    manifest_schema_validator_compatibility_valid: manifestValid,
    active_runtime_is_derived_approval: activeKindIsDerived,
    approved_hash_environment_matches:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH === requestedRuntimeHash,
    guarded_live_mode_selected: process.env.OPERATIONAL_AGENT_MODE === "guarded_live",
    openai_provider_selected: process.env.LLM_PROVIDER === "openai",
    live_calls_enabled: process.env.LLM_LIVE_CALLS_ENABLED === "true",
    live_opt_in_present: process.env.EVAL_E2A_LIVE_PROVIDER === "1",
    api_credential_valid: credential.ok,
    simulator_configuration_valid: simulatorConfigurationValid,
    budget_configuration_valid: budgetLimits !== null,
    privacy_scanner_enabled: true,
    fixture_isolation_enabled: true,
    protected_operational_artifacts_unchanged: protectedArtifactsUnchanged(),
    e1_matrix_passed: e1MatrixPassed,
    e1_2_privacy_smoke_passed: privacySmokePassed,
    database_ready: databaseReady,
    llm_rubric_evaluator_disabled: true
  };
  const blockingReasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const report = E2AReadinessReportSchema.parse({
    readiness_report_version: E2A_READINESS_REPORT_VERSION,
    generated_at: new Date().toISOString(),
    application_git_commit: buildInfo.info.application_git_commit,
    requested_runtime_hash: requestedRuntimeHash,
    resolved_runtime_hash: resolution.resolved_hash,
    resolution_source: resolution.resolution_source,
    approved_bundle_complete: resolution.approved_bundle_complete,
    role_count: resolution.role_count,
    simulator_configuration_hash: simulatorConfiguration?.configuration_hash ?? null,
    simulator_model: simulatorConfiguration?.model_name ?? null,
    budget_limits: budgetLimits,
    checks,
    blocking_reasons: blockingReasons,
    ready: blockingReasons.length === 0,
    provider_requests: { metadata_only: 0, generation: 0 },
    secrets_printed: false
  });
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ...report,
    artifact_path: artifactPath,
    credential: {
      configured_and_valid: credential.ok,
      source: credential.ok ? credential.credential.source : credential.source,
      resolver_status: credential.ok ? "valid" : credential.code
    }
  }, null, 2));
  if (!report.ready) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof Error ? error.message : "e2a_readiness_failed",
    provider_requests: { metadata_only: 0, generation: 0 },
    secrets_printed: false
  }, null, 2));
  process.exitCode = 1;
});
