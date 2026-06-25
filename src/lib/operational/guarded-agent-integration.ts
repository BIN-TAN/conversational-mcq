import { Prisma } from "@prisma/client";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import {
  activeOperationalConfigHash,
  activeOperationalAgentConfigSnapshot,
  approvedModelConfigForAgent,
  readApprovedOperationalAgentConfig,
  verifyApprovedOperationalAgentConfig
} from "@/lib/agents/operational/approved-config";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export type OperationalAgentMode = "disabled" | "mock" | "guarded_live";

export const PHASE_8A_GUARDED_OPERATIONAL_INTEGRATION = {
  phase: "phase_8a_guarded_operational_agent_integration",
  canary_run_public_id: "evr_20260623_trzkizm",
  full_pilot_run_public_id: "evr_20260623_ga6kzai",
  approved_targeted_run_public_id: "evr_20260624_bltzgtq",
  effective_artifact_version: "effective-system-eval-v2",
  effective_validator_version: "effective-validator-v1",
  semantic_validator_version: "eval-semantic-v3",
  safety_validator_version: "eval-safety-v3",
  followup_move_on_fallback_version: "followup-move-on-fallback-v2",
  model_snapshot: "gpt-5.4-mini-2026-03-17",
  reasoning_effort: "low",
  final_recommendation: "ready_for_guarded_integration_patch",
  classroom_validity: false,
  human_review_pending: true,
  raw_model_review: {
    pass_count: 20,
    fail_count: 2
  },
  effective_system_v1_review: {
    pass_count: 20,
    fail_count: 2
  },
  effective_system_v2_review: {
    pass_count: 22,
    fail_count: 0,
    critical_failure_count: 0
  }
} as const;

export type OperationalAgentIntegrationBlockReason =
  | "operational_agent_mode_disabled"
  | "operational_mode_legacy_alias_conflict"
  | "operational_mock_requires_mock_provider"
  | "guarded_live_requires_openai_provider"
  | "guarded_live_requires_live_calls"
  | "guarded_live_openai_key_missing"
  | "approved_manifest_invalid"
  | "approved_config_hash_missing"
  | "approved_config_hash_mismatch"
  | "database_unavailable";

export type OperationalAgentIntegrationReadiness = {
  allowed: boolean;
  mode: OperationalAgentMode;
  enabled: boolean;
  block_reason: OperationalAgentIntegrationBlockReason | null;
  blocking_reasons: OperationalAgentIntegrationBlockReason[];
  sanitized_warnings: string[];
  evidence_status: "manifest_verified" | "not_checked" | "not_required_for_disabled";
  config: ReturnType<typeof guardedOperationalAgentIntegrationConfig>;
  approved_evaluation: typeof PHASE_8A_GUARDED_OPERATIONAL_INTEGRATION;
  approved_manifest: {
    manifest_version: string;
    manifest_hash: string;
    approved_active_configuration_hash: string;
  };
  active_configuration_hash: string;
  approved_configuration_hash: string;
  active_agent_versions: ReturnType<typeof activeAgentVersionSnapshot>;
  live_call_permitted: boolean;
  details?: Record<string, unknown>;
};

function explicitEnv(name: string) {
  return Object.prototype.hasOwnProperty.call(process.env, name);
}

function modeFromLegacyAlias(enabled: boolean): OperationalAgentMode {
  return enabled ? "mock" : "disabled";
}

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

export function operationalModeStatus() {
  const env = getServerEnv();
  const modeExplicit = explicitEnv("OPERATIONAL_AGENT_MODE");
  const legacyExplicit = explicitEnv("OPERATIONAL_AGENT_INTEGRATION_ENABLED");
  const legacyMode = modeFromLegacyAlias(env.OPERATIONAL_AGENT_INTEGRATION_ENABLED);
  const mode = modeExplicit ? env.OPERATIONAL_AGENT_MODE : legacyExplicit ? legacyMode : env.OPERATIONAL_AGENT_MODE;
  const aliasConflict = modeExplicit && legacyExplicit && mode !== legacyMode;

  return {
    mode,
    mode_explicit: modeExplicit,
    legacy_alias_explicit: legacyExplicit,
    legacy_alias_mode: legacyMode,
    alias_conflict: aliasConflict,
    warning: legacyExplicit
      ? "OPERATIONAL_AGENT_INTEGRATION_ENABLED is deprecated; use OPERATIONAL_AGENT_MODE."
      : null
  };
}

export function guardedOperationalAgentIntegrationConfig() {
  const env = getServerEnv();
  const modeStatus = operationalModeStatus();

  return {
    mode: modeStatus.mode,
    enabled: modeStatus.mode !== "disabled" && !modeStatus.alias_conflict,
    legacy_alias_enabled: env.OPERATIONAL_AGENT_INTEGRATION_ENABLED,
    legacy_alias_explicit: modeStatus.legacy_alias_explicit,
    legacy_alias_conflict: modeStatus.alias_conflict,
    approved_targeted_run_public_id: env.OPERATIONAL_AGENT_INTEGRATION_APPROVED_TARGETED_RUN_ID,
    provider: env.LLM_PROVIDER,
    live_calls_enabled: env.LLM_LIVE_CALLS_ENABLED,
    openai_key_configured: configured(env.OPENAI_API_KEY),
    operational_approved_config_hash_configured: configured(env.OPERATIONAL_APPROVED_CONFIG_HASH),
    operational_approved_config_hash: env.OPERATIONAL_APPROVED_CONFIG_HASH ?? null,
    effective_result_version: env.OPERATIONAL_EFFECTIVE_RESULT_VERSION,
    effective_validator_version: env.OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION,
    phase_8a_allows_live_openai_calls_only_in_guarded_live: true
  };
}

export function activeAgentVersionSnapshot() {
  const snapshot = activeOperationalAgentConfigSnapshot();
  const approvedConfig = readApprovedOperationalAgentConfig();

  return Object.fromEntries(
    AgentName.options.map((agentName) => {
      const agent = snapshot.agents[agentName];
      const approvedAgent = approvedConfig.agents[agentName];

      if (!agent || !approvedAgent) {
        throw new Error(`Operational agent registry is missing ${agentName}.`);
      }

      return [
        agentName,
        {
          ...agent,
          prompt_matches_evaluated: approvedAgent.prompt_version === agent.prompt_version,
          schema_matches_evaluated: approvedAgent.schema_version === agent.schema_version,
          prompt_hash_matches_evaluated: approvedAgent.prompt_hash === agent.prompt_hash
        }
      ];
    })
  );
}

async function databaseAvailable() {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export async function getGuardedOperationalAgentIntegrationReadiness(
  input: { checkDatabase?: boolean } = {}
): Promise<OperationalAgentIntegrationReadiness> {
  const config = guardedOperationalAgentIntegrationConfig();
  const manifest = readApprovedOperationalAgentConfig();
  const manifestVerification = verifyApprovedOperationalAgentConfig();
  const activeHash = activeOperationalConfigHash();
  const blockingReasons: OperationalAgentIntegrationBlockReason[] = [];
  const warnings = [
    ...(config.legacy_alias_explicit
      ? ["OPERATIONAL_AGENT_INTEGRATION_ENABLED is deprecated; use OPERATIONAL_AGENT_MODE."]
      : [])
  ];

  if (config.legacy_alias_conflict) {
    blockingReasons.push("operational_mode_legacy_alias_conflict");
  }

  if (config.mode === "disabled") {
    blockingReasons.push("operational_agent_mode_disabled");
  }

  if (config.mode === "mock") {
    if (config.provider !== "mock" || config.live_calls_enabled) {
      blockingReasons.push("operational_mock_requires_mock_provider");
    }
  }

  if (config.mode === "guarded_live") {
    if (config.provider !== "openai") {
      blockingReasons.push("guarded_live_requires_openai_provider");
    }

    if (!config.live_calls_enabled) {
      blockingReasons.push("guarded_live_requires_live_calls");
    }

    if (!config.openai_key_configured) {
      blockingReasons.push("guarded_live_openai_key_missing");
    }

    if (!config.operational_approved_config_hash_configured) {
      blockingReasons.push("approved_config_hash_missing");
    }

    if (
      config.operational_approved_config_hash_configured &&
      config.operational_approved_config_hash !== manifest.approved_active_configuration_hash
    ) {
      blockingReasons.push("approved_config_hash_mismatch");
    }
  }

  if (!manifestVerification.valid) {
    blockingReasons.push("approved_manifest_invalid");
  }

  if (input.checkDatabase && !(await databaseAvailable())) {
    blockingReasons.push("database_unavailable");
  }

  const uniqueBlockingReasons = [...new Set(blockingReasons)];
  const allowed = uniqueBlockingReasons.length === 0;

  return {
    allowed,
    mode: config.mode,
    enabled: config.enabled,
    block_reason: uniqueBlockingReasons[0] ?? null,
    blocking_reasons: uniqueBlockingReasons,
    sanitized_warnings: warnings,
    evidence_status: config.mode === "disabled" ? "not_required_for_disabled" : "manifest_verified",
    config,
    approved_evaluation: PHASE_8A_GUARDED_OPERATIONAL_INTEGRATION,
    approved_manifest: {
      manifest_version: manifest.manifest_version,
      manifest_hash: manifest.config_hash,
      approved_active_configuration_hash: manifest.approved_active_configuration_hash
    },
    active_configuration_hash: activeHash,
    approved_configuration_hash: manifest.approved_active_configuration_hash,
    active_agent_versions: activeAgentVersionSnapshot(),
    live_call_permitted: allowed && config.mode === "guarded_live",
    details: manifestVerification.valid
      ? undefined
      : { manifest_issues: manifestVerification.issues }
  };
}

export function approvedOperationalModelConfigForAgent(agentName: AgentNameType) {
  return approvedModelConfigForAgent(agentName);
}

export function guardedOperationalAgentIntegrationDisabledFallbackReason(
  readiness: OperationalAgentIntegrationReadiness
) {
  if (readiness.allowed) {
    return null;
  }

  return readiness.block_reason;
}

export function operationalReadinessHasFatalConfigurationBlock(
  readiness: Pick<OperationalAgentIntegrationReadiness, "blocking_reasons">
) {
  return readiness.blocking_reasons.some((reason) =>
    [
      "operational_mode_legacy_alias_conflict",
      "approved_manifest_invalid",
      "approved_config_hash_mismatch"
    ].includes(reason)
  );
}
