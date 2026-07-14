import { Prisma, type PrismaClient } from "@prisma/client";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import {
  activeOperationalConfigHash,
  activeOperationalAgentConfigSnapshot,
  approvedModelConfigForAgent,
  readApprovedOperationalAgentConfig,
  verifyApprovedOperationalAgentConfig
} from "@/lib/agents/operational/approved-config";
import { checkLlmLiveCallReadiness, type LlmUsageGuardBlockedReason } from "@/lib/llm/usage/usage-guard";
import { prisma } from "@/lib/db";
import { safeParseServerEnv, type EnvConfigurationIssue } from "@/lib/env";
import { databaseNameFromUrl } from "@/lib/services/operational-live-canary/database-url";
import {
  missingCanaryContextDiagnostics,
  validateOperationalLiveCanaryContext,
  type CanaryContextDiagnostics,
  type CanaryContextInvalidSubreason,
  type OperationalLiveCanaryContext
} from "@/lib/operational/live-canary-context";

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

export type OperationalExecutionBlockReason =
  | "operational_mode_disabled"
  | "legacy_mode_conflict"
  | "provider_not_openai"
  | "live_calls_disabled"
  | "api_key_missing"
  | "approved_manifest_invalid"
  | "approved_config_hash_mismatch"
  | "model_snapshot_mismatch"
  | "effective_result_version_mismatch"
  | "effective_validator_version_mismatch"
  | "evaluation_evidence_missing"
  | "usage_guard_blocked"
  | "database_unavailable"
  | "canary_context_invalid"
  | "other_typed_configuration_error";

type OperationalConfigurationErrorSummary = {
  code: "invalid_environment_configuration";
  issue_count: number;
  issues: EnvConfigurationIssue[];
};

export type SanitizedReadinessSnapshot = CanaryContextDiagnostics & {
  agent_name: AgentNameType | null;
  operational_mode: OperationalAgentMode;
  legacy_alias_value: boolean | null;
  legacy_alias_explicit: boolean;
  provider: string;
  live_calls_enabled: boolean;
  api_key_configured: boolean;
  approved_manifest_valid: boolean;
  approved_config_hash_configured: boolean;
  approved_config_hash_matches: boolean;
  active_config_hash_matches: boolean;
  model_snapshot_matches: boolean;
  effective_result_version_matches: boolean;
  effective_validator_version_matches: boolean;
  usage_guard_allowed: boolean | "not_checked";
  usage_guard_reason: string | null;
  database_ready: boolean | "not_checked";
  evaluation_evidence_required: boolean;
  evaluation_evidence_found: boolean;
  evaluation_evidence_source: string | null;
  canary_context_recognized: boolean;
  canary_context_subreason: CanaryContextInvalidSubreason | null;
  isolated_database_name: string | null;
  final_guard_allowed: boolean;
  typed_blocked_reason: OperationalExecutionBlockReason | null;
  typed_blocking_reasons: OperationalExecutionBlockReason[];
  legacy_blocking_reasons: OperationalAgentIntegrationBlockReason[];
  sanitized_warnings: string[];
};

export type OperationalExecutionReadiness =
  | {
      allowed: true;
      readinessSnapshot: SanitizedReadinessSnapshot;
    }
  | {
      allowed: false;
      reason: OperationalExecutionBlockReason;
      readinessSnapshot: SanitizedReadinessSnapshot;
    };

export type OperationalAgentIntegrationReadiness = {
  allowed: boolean;
  mode: OperationalAgentMode;
  enabled: boolean;
  block_reason: OperationalAgentIntegrationBlockReason | null;
  blocking_reasons: OperationalAgentIntegrationBlockReason[];
  typed_block_reason: OperationalExecutionBlockReason | null;
  typed_blocking_reasons: OperationalExecutionBlockReason[];
  readiness_snapshot: SanitizedReadinessSnapshot;
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
  active_agent_versions: ReturnType<typeof activeAgentVersionSnapshot> | Record<string, never>;
  live_call_permitted: boolean;
  details?: Record<string, unknown>;
};

type GuardedOperationalAgentIntegrationConfig = {
  mode: OperationalAgentMode;
  enabled: boolean;
  legacy_alias_enabled: boolean;
  legacy_alias_explicit: boolean;
  legacy_alias_conflict: boolean;
  approved_targeted_run_public_id: string;
  provider: string;
  live_calls_enabled: boolean;
  openai_key_configured: boolean;
  operational_approved_config_hash_configured: boolean;
  operational_approved_config_hash: string | null;
  operational_approved_config_hash_source: string | null;
  evaluation_evidence_required: boolean;
  effective_result_version: string;
  effective_validator_version: string;
  phase_8a_allows_live_openai_calls_only_in_guarded_live: boolean;
  configuration_valid: boolean;
  configuration_error: OperationalConfigurationErrorSummary | null;
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

function typedToLegacyReason(reason: OperationalExecutionBlockReason): OperationalAgentIntegrationBlockReason {
  switch (reason) {
    case "operational_mode_disabled":
      return "operational_agent_mode_disabled";
    case "legacy_mode_conflict":
      return "operational_mode_legacy_alias_conflict";
    case "provider_not_openai":
      return "guarded_live_requires_openai_provider";
    case "live_calls_disabled":
      return "guarded_live_requires_live_calls";
    case "api_key_missing":
      return "guarded_live_openai_key_missing";
    case "approved_manifest_invalid":
    case "model_snapshot_mismatch":
    case "effective_result_version_mismatch":
    case "effective_validator_version_mismatch":
    case "evaluation_evidence_missing":
    case "canary_context_invalid":
    case "other_typed_configuration_error":
      return "approved_manifest_invalid";
    case "approved_config_hash_mismatch":
      return "approved_config_hash_mismatch";
    case "usage_guard_blocked":
      return "database_unavailable";
    case "database_unavailable":
      return "database_unavailable";
  }
}

function firstManifestIssueCode(manifestVerification: ReturnType<typeof verifyApprovedOperationalAgentConfig>) {
  return manifestVerification.issues[0]?.code ?? null;
}

export function operationalModeStatus() {
  const parsed = safeParseServerEnv();
  if (!parsed.success) {
    return {
      mode: "disabled" as const,
      mode_explicit: explicitEnv("OPERATIONAL_AGENT_MODE"),
      legacy_alias_explicit: explicitEnv("OPERATIONAL_AGENT_INTEGRATION_ENABLED"),
      legacy_alias_mode: "disabled" as const,
      alias_conflict: false,
      warning: "Operational LLM configuration is invalid; operational agents fail closed."
    };
  }
  const env = parsed.data;
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

function configurationErrorSummary(error: { issues: EnvConfigurationIssue[] }): OperationalConfigurationErrorSummary {
  return {
    code: "invalid_environment_configuration",
    issue_count: error.issues.length,
    issues: error.issues
  };
}

export function guardedOperationalAgentIntegrationConfig(): GuardedOperationalAgentIntegrationConfig {
  const parsed = safeParseServerEnv();
  if (!parsed.success) {
    return {
      mode: "disabled",
      enabled: false,
      legacy_alias_enabled: false,
      legacy_alias_explicit: explicitEnv("OPERATIONAL_AGENT_INTEGRATION_ENABLED"),
      legacy_alias_conflict: false,
      approved_targeted_run_public_id: process.env.OPERATIONAL_AGENT_INTEGRATION_APPROVED_TARGETED_RUN_ID?.trim() || "evr_20260624_bltzgtq",
      provider: "configuration_error",
      live_calls_enabled: false,
      openai_key_configured: false,
      operational_approved_config_hash_configured: false,
      operational_approved_config_hash: null,
      operational_approved_config_hash_source: null,
      evaluation_evidence_required: true,
      effective_result_version: process.env.OPERATIONAL_EFFECTIVE_RESULT_VERSION?.trim() || "effective-system-eval-v2",
      effective_validator_version: process.env.OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION?.trim() || "effective-validator-v1",
      phase_8a_allows_live_openai_calls_only_in_guarded_live: true,
      configuration_valid: false,
      configuration_error: configurationErrorSummary(parsed.error)
    };
  }
  const env = parsed.data;
  const modeStatus = operationalModeStatus();
  const effectiveApprovedConfigHash =
    env.OPERATIONAL_APPROVED_CONFIG_HASH ??
    (env.OPERATIONAL_LIVE_CANARY_ENABLED ? env.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH : undefined);

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
    operational_approved_config_hash_configured: configured(effectiveApprovedConfigHash),
    operational_approved_config_hash: effectiveApprovedConfigHash ?? null,
    operational_approved_config_hash_source:
      env.OPERATIONAL_APPROVED_CONFIG_HASH
        ? "OPERATIONAL_APPROVED_CONFIG_HASH"
        : env.OPERATIONAL_LIVE_CANARY_ENABLED && env.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH
          ? "OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH"
          : null,
    evaluation_evidence_required: env.OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED,
    effective_result_version: env.OPERATIONAL_EFFECTIVE_RESULT_VERSION,
    effective_validator_version: env.OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION,
    phase_8a_allows_live_openai_calls_only_in_guarded_live: true,
    configuration_valid: true,
    configuration_error: null
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

function currentIsolatedDatabaseName() {
  if (process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE !== "true") {
    return null;
  }

  const value = process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL?.trim();
  if (!value) {
    return null;
  }

  try {
    return databaseNameFromUrl(value);
  } catch {
    return null;
  }
}

function manifestIssueToTypedReason(code: string | null): OperationalExecutionBlockReason {
  if (!code) {
    return "approved_manifest_invalid";
  }
  if (code.includes("model_snapshot") || code.includes("reasoning_effort") || code.includes("runtime_token")) {
    return "model_snapshot_mismatch";
  }
  if (code === "effective_result_version_mismatch") {
    return "effective_result_version_mismatch";
  }
  if (code === "effective_validator_version_mismatch") {
    return "effective_validator_version_mismatch";
  }
  if (code === "approved_config_hash_env_mismatch" || code === "active_configuration_hash_mismatch") {
    return "approved_config_hash_mismatch";
  }
  return "approved_manifest_invalid";
}

function evidenceFromApprovedManifest(input: {
  config: ReturnType<typeof guardedOperationalAgentIntegrationConfig>;
  manifest: ReturnType<typeof readApprovedOperationalAgentConfig>;
  manifestVerificationValid: boolean;
  canaryContextRecognized: boolean;
  canaryContextValid: boolean;
  forceMissing?: boolean;
}) {
  if (!input.config.evaluation_evidence_required) {
    return {
      required: false,
      found: true,
      source: "not_required_by_configuration"
    };
  }

  if (input.forceMissing) {
    return {
      required: true,
      found: false,
      source: null
    };
  }

  const manifestEvidenceMatches =
    input.manifest.evaluation_evidence.targeted_run_public_id ===
      PHASE_8A_GUARDED_OPERATIONAL_INTEGRATION.approved_targeted_run_public_id &&
    input.manifest.evaluation_evidence.review_artifact_version ===
      PHASE_8A_GUARDED_OPERATIONAL_INTEGRATION.effective_artifact_version &&
    input.manifest.evaluation_evidence.recommendation ===
      PHASE_8A_GUARDED_OPERATIONAL_INTEGRATION.final_recommendation &&
    input.manifest.evaluation_evidence.classroom_validity === false;

  if (!input.manifestVerificationValid || !manifestEvidenceMatches) {
    return {
      required: true,
      found: false,
      source: null
    };
  }

  if (input.canaryContextRecognized) {
    return {
      required: true,
      found: input.canaryContextValid,
      source: input.canaryContextValid ? "approved_manifest_canary_attestation" : null
    };
  }

  return {
    required: true,
    found: true,
    source: "approved_manifest_evaluation_evidence"
  };
}

export async function evaluateOperationalExecutionReadiness(input: {
  agentName?: AgentNameType | null;
  operationalContext?: {
    assessment_session_db_id?: string | null;
    metadata?: Record<string, string | undefined>;
  };
  checkDatabase?: boolean;
  checkUsageGuard?: boolean;
  evidenceContext?: {
    operationalLiveCanaryContext?: OperationalLiveCanaryContext | null;
    canaryPrisma?: PrismaClient;
    canaryRunPublicId?: string | null;
    canaryManifestHash?: string | null;
    isolatedDatabaseName?: string | null;
    canaryRunCreatedThroughCli?: boolean;
    forceMissingEvaluationEvidence?: boolean;
    forceCanaryContextInvalid?: boolean;
  };
  usageContext?: {
    forceBlockedReason?: LlmUsageGuardBlockedReason;
  };
} = {}): Promise<OperationalExecutionReadiness> {
  const config = guardedOperationalAgentIntegrationConfig();
  const manifest = readApprovedOperationalAgentConfig();
  const manifestVerification = config.configuration_valid
    ? verifyApprovedOperationalAgentConfig()
    : {
        valid: false,
        manifest_hash: manifest.config_hash,
        approved_hash: manifest.approved_active_configuration_hash,
        issues: [
          {
            code: "invalid_environment_configuration",
            message: "Operational LLM configuration is invalid.",
            details: config.configuration_error
          }
        ],
        active_configuration_hash: "unavailable_due_to_invalid_environment",
        active_agents: {},
        runtime_model_resolution: {},
        manifest
      };
  const activeHash = config.configuration_valid
    ? activeOperationalConfigHash()
    : "unavailable_due_to_invalid_environment";
  const blockingReasons: OperationalExecutionBlockReason[] = [];
  const warnings = [
    ...(config.configuration_error
      ? [
          `Operational LLM configuration is invalid: ${config.configuration_error.issues
            .map((issue) => issue.path)
            .join(", ")}`
        ]
      : []),
    ...(config.legacy_alias_explicit
      ? ["OPERATIONAL_AGENT_INTEGRATION_ENABLED is deprecated; use OPERATIONAL_AGENT_MODE."]
      : [])
  ];
  const isolatedDatabaseName =
    input.evidenceContext?.operationalLiveCanaryContext?.databaseName ??
    input.evidenceContext?.isolatedDatabaseName ??
    currentIsolatedDatabaseName();
  const metadata = input.operationalContext?.metadata ?? {};
  const canaryRunPublicId =
    input.evidenceContext?.operationalLiveCanaryContext?.runPublicId ??
    input.evidenceContext?.canaryRunPublicId ??
    metadata.operational_live_canary_run_public_id ??
    null;
  const canaryManifestHash =
    input.evidenceContext?.operationalLiveCanaryContext?.manifestHash ??
    input.evidenceContext?.canaryManifestHash ??
    metadata.operational_live_canary_manifest_hash ??
    null;
  const operationalLiveCanaryContext =
    input.evidenceContext?.operationalLiveCanaryContext ?? null;
  const canaryContextRecognized = Boolean(
    operationalLiveCanaryContext ||
    canaryRunPublicId ||
      canaryManifestHash ||
      input.evidenceContext?.canaryRunCreatedThroughCli ||
      process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE === "true"
  );
  const canaryValidation = canaryContextRecognized
    ? input.evidenceContext?.forceCanaryContextInvalid
      ? {
          valid: false,
          failedRule: "canary_context_missing" as const,
          diagnostics: operationalLiveCanaryContext
            ? missingCanaryContextDiagnostics()
            : missingCanaryContextDiagnostics()
        }
      : await validateOperationalLiveCanaryContext({
          context: operationalLiveCanaryContext,
          agentName: input.agentName,
          prisma: input.evidenceContext?.canaryPrisma ?? prisma
        })
    : {
        valid: true,
        failedRule: null,
        diagnostics: {
          ...missingCanaryContextDiagnostics(),
          final_canary_context_valid: null,
          failed_canary_context_rule: null
        }
      };
  const canaryContextValid = canaryValidation.valid;

  if (!config.configuration_valid) {
    blockingReasons.push("other_typed_configuration_error");
  } else if (config.legacy_alias_conflict) {
    blockingReasons.push("legacy_mode_conflict");
  }

  if (config.configuration_valid && config.mode === "disabled") {
    blockingReasons.push("operational_mode_disabled");
  }

  if (config.configuration_valid && config.mode === "mock") {
    if (config.provider !== "mock" || config.live_calls_enabled) {
      blockingReasons.push("other_typed_configuration_error");
    }
  }

  if (config.configuration_valid && config.mode === "guarded_live") {
    if (config.provider !== "openai") {
      blockingReasons.push("provider_not_openai");
    }

    if (!config.live_calls_enabled) {
      blockingReasons.push("live_calls_disabled");
    }

    if (!config.openai_key_configured) {
      blockingReasons.push("api_key_missing");
    }

    if (!config.operational_approved_config_hash_configured) {
      blockingReasons.push("approved_config_hash_mismatch");
    }

    if (
      config.operational_approved_config_hash_configured &&
      config.operational_approved_config_hash !== manifest.approved_active_configuration_hash
    ) {
      blockingReasons.push("approved_config_hash_mismatch");
    }
  }

  if (!manifestVerification.valid) {
    blockingReasons.push(manifestIssueToTypedReason(firstManifestIssueCode(manifestVerification)));
  }

  const databaseReady = input.checkDatabase ? await databaseAvailable() : "not_checked";
  if (databaseReady === false) {
    blockingReasons.push("database_unavailable");
  }

  if (canaryContextRecognized && !canaryContextValid) {
    blockingReasons.push("canary_context_invalid");
  }

  const evidence = evidenceFromApprovedManifest({
    config,
    manifest,
    manifestVerificationValid: manifestVerification.valid,
    canaryContextRecognized,
    canaryContextValid,
    forceMissing: input.evidenceContext?.forceMissingEvaluationEvidence
  });
  if (evidence.required && !evidence.found) {
    blockingReasons.push("evaluation_evidence_missing");
  }

  let usageGuardAllowed: SanitizedReadinessSnapshot["usage_guard_allowed"] = "not_checked";
  let usageGuardReason: string | null = null;
  if (
    input.usageContext?.forceBlockedReason &&
    config.mode === "guarded_live"
  ) {
    usageGuardAllowed = false;
    usageGuardReason = input.usageContext.forceBlockedReason;
    blockingReasons.push("usage_guard_blocked");
  } else if (
    input.checkUsageGuard &&
    input.agentName &&
    config.mode === "guarded_live" &&
    blockingReasons.length === 0
  ) {
    const usageGuard = await checkLlmLiveCallReadiness({
      agent_name: input.agentName,
      assessment_session_db_id: input.operationalContext?.assessment_session_db_id ?? null,
      model_configured: true
    });
    usageGuardAllowed = usageGuard.allowed;
    usageGuardReason = usageGuard.allowed ? null : usageGuard.reason;
    if (!usageGuard.allowed) {
      blockingReasons.push("usage_guard_blocked");
    }
  }

  const uniqueTypedReasons = [...new Set(blockingReasons)];
  const legacyReasons = [...new Set(uniqueTypedReasons.map(typedToLegacyReason))];
  const allowed = uniqueTypedReasons.length === 0;
  const modelSnapshotMatches = config.configuration_valid && !manifestVerification.issues.some((issue) =>
    ["model_snapshot_missing", "model_snapshot_mismatch", "reasoning_effort_missing", "reasoning_effort_mismatch", "runtime_token_limit_mismatch"].includes(issue.code)
  );
  const effectiveResultVersionMatches =
    config.configuration_valid && manifest.effective_result_version === config.effective_result_version;
  const effectiveValidatorVersionMatches =
    config.configuration_valid && manifest.effective_validator_version === config.effective_validator_version;
  const snapshot: SanitizedReadinessSnapshot = {
    agent_name: input.agentName ?? null,
    operational_mode: config.mode,
    legacy_alias_value: config.legacy_alias_explicit ? config.legacy_alias_enabled : null,
    legacy_alias_explicit: config.legacy_alias_explicit,
    provider: config.provider,
    live_calls_enabled: config.live_calls_enabled,
    api_key_configured: config.openai_key_configured,
    approved_manifest_valid: manifestVerification.valid,
    approved_config_hash_configured: config.operational_approved_config_hash_configured,
    approved_config_hash_matches:
      config.operational_approved_config_hash_configured &&
      config.operational_approved_config_hash === manifest.approved_active_configuration_hash,
    active_config_hash_matches: manifest.approved_active_configuration_hash === activeHash,
    model_snapshot_matches: modelSnapshotMatches,
    effective_result_version_matches: effectiveResultVersionMatches,
    effective_validator_version_matches: effectiveValidatorVersionMatches,
    usage_guard_allowed: usageGuardAllowed,
    usage_guard_reason: usageGuardReason,
    database_ready: databaseReady,
    evaluation_evidence_required: evidence.required,
    evaluation_evidence_found: evidence.found,
    evaluation_evidence_source: evidence.source,
    canary_context_recognized: canaryContextRecognized,
    canary_context_subreason: canaryValidation.failedRule,
    isolated_database_name: isolatedDatabaseName,
    final_guard_allowed: allowed,
    typed_blocked_reason: uniqueTypedReasons[0] ?? null,
    typed_blocking_reasons: uniqueTypedReasons,
    legacy_blocking_reasons: legacyReasons,
    sanitized_warnings: warnings,
    ...canaryValidation.diagnostics
  };

  if (allowed) {
    return {
      allowed: true,
      readinessSnapshot: snapshot
    };
  }

  return {
    allowed: false,
    reason: uniqueTypedReasons[0] ?? "other_typed_configuration_error",
    readinessSnapshot: snapshot
  };
}

export async function getGuardedOperationalAgentIntegrationReadiness(
  input: { checkDatabase?: boolean } = {}
): Promise<OperationalAgentIntegrationReadiness> {
  const readiness = await evaluateOperationalExecutionReadiness({
    checkDatabase: input.checkDatabase,
    checkUsageGuard: false
  });
  const config = guardedOperationalAgentIntegrationConfig();
  const manifest = readApprovedOperationalAgentConfig();
  const activeHash = activeOperationalConfigHash();
  const snapshot = readiness.readinessSnapshot;

  return {
    allowed: readiness.allowed,
    mode: config.mode,
    enabled: config.enabled,
    block_reason: snapshot.legacy_blocking_reasons[0] ?? null,
    blocking_reasons: snapshot.legacy_blocking_reasons,
    typed_block_reason: snapshot.typed_blocked_reason,
    typed_blocking_reasons: snapshot.typed_blocking_reasons,
    readiness_snapshot: snapshot,
    sanitized_warnings: snapshot.sanitized_warnings,
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
    active_agent_versions: config.configuration_valid ? activeAgentVersionSnapshot() : {},
    live_call_permitted: readiness.allowed && config.mode === "guarded_live",
    details: config.configuration_error
      ? { configuration_error: config.configuration_error }
      : snapshot.approved_manifest_valid
        ? undefined
        : { manifest_issues: verifyApprovedOperationalAgentConfig().issues }
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
