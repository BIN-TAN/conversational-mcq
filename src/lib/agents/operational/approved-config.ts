import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import { listAgentPrompts } from "@/lib/agents/prompts/registry";
import {
  liveModelRoleEnvSources,
  modelConfigCompatibilityIssues,
  type AgentModelConfig,
  type LiveModelRole
} from "@/lib/llm/config";
import { getServerEnv } from "@/lib/env";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  type ActiveDerivedOperationalApproval,
  type ApprovedCandidateManifest,
  type ApprovedOperationalRoleName,
  APPROVED_OPERATIONAL_ROLE_NAMES,
  approvedCandidateRoleConfig,
  OperationalApprovalBundleError,
  resolveActiveOperationalApproval
} from "@/lib/operational/active-approval-bundle";

export const APPROVED_OPERATIONAL_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "approved-operational-agent-config.json"
);

const agentConfigSchema = z.object({
  agent_version: z.string().min(1),
  prompt_version: z.string().min(1),
  prompt_hash: z.string().min(1),
  schema_version: z.string().min(1),
  max_output_tokens: z.number().int().positive()
}).strict();

const approvedConfigSchema = z.object({
  manifest_version: z.string().min(1),
  generated_from_git_commit: z.string().min(1),
  model_snapshot: z.literal("gpt-5.4-mini-2026-03-17"),
  reasoning_effort: z.literal("low"),
  agents: z.record(AgentName, agentConfigSchema),
  semantic_validator_version: z.literal("eval-semantic-v3"),
  safety_validator_version: z.literal("eval-safety-v3"),
  effective_result_version: z.literal("effective-system-eval-v2"),
  effective_validator_version: z.literal("effective-validator-v1"),
  deterministic_guard_versions: z.record(z.string(), z.string()),
  canonicalization_versions: z.record(z.string(), z.string()),
  fallback_versions: z.record(z.string(), z.string()),
  evaluation_evidence: z.object({
    canary_run_public_id: z.literal("evr_20260623_trzkizm"),
    full_pilot_run_public_id: z.literal("evr_20260623_ga6kzai"),
    targeted_run_public_id: z.literal("evr_20260624_bltzgtq"),
    review_target: z.literal("effective_system_output"),
    review_artifact_version: z.literal("effective-system-eval-v2"),
    targeted_ai_review: z.object({
      pass_count: z.literal(22),
      fail_count: z.literal(0),
      critical_failure_count: z.literal(0)
    }).strict(),
    recommendation: z.literal("ready_for_guarded_integration_patch"),
    classroom_validity: z.literal(false),
    human_review_pending: z.literal(true)
  }).strict(),
  approved_active_configuration_hash: z.string().min(1),
  config_hash: z.string().min(1)
}).strict();

export type ApprovedOperationalAgentConfig = z.infer<typeof approvedConfigSchema>;

export type ApprovedOperationalConfigVerification = {
  approval_kind: "phase8a_legacy" | "derived_approval";
  valid: boolean;
  manifest_hash: string;
  approved_hash: string;
  issues: Array<{ code: string; message: string; details?: unknown }>;
  active_configuration_hash: string;
  active_agents: Record<string, {
    agent_version: string;
    prompt_version: string;
    prompt_hash: string;
    schema_version: string;
    max_output_tokens: number;
  }>;
  runtime_model_resolution: Record<string, {
    approved_model_snapshot: string;
    resolved_model_snapshot: string | null;
    approved_reasoning_effort: string;
    resolved_reasoning_effort: string | null;
    approved_max_output_tokens: number;
    resolved_max_output_tokens: number | null;
    source: string;
  }>;
  manifest: ApprovedOperationalAgentConfig;
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string | null;
  approval_evidence_hash: string | null;
  role_inventory: string[];
  runtime_policy: ApprovedCandidateManifest["runtime_policy"] | null;
  approval_bundle_path: string | null;
  semantic_validator_version: string;
  safety_validator_version: string;
  effective_result_version: string;
  effective_validator_version: string;
};

type ActiveAgentConfig = ApprovedOperationalConfigVerification["active_agents"][string];
type RuntimeModelResolution = {
  model_name?: string | null;
  reasoning_effort?: string | null;
  max_output_tokens?: number | null;
  source: string;
};

type ApprovedOperationalConfigVerificationOptions = {
  activeAgentConfigOverridesForTest?: Partial<Record<LiveModelRole, Partial<ActiveAgentConfig>>>;
  runtimeModelConfigOverridesForTest?: Partial<Record<LiveModelRole, Partial<RuntimeModelResolution>>>;
};

const agentMaxTokenEnvKeys: Record<AgentNameType, keyof ReturnType<typeof getServerEnv>> = {
  item_verification_agent: "OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION",
  response_collection_agent: "OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION",
  student_profiling_agent: "OPENAI_MAX_OUTPUT_TOKENS_PROFILING",
  formative_value_and_planning_agent: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
  followup_agent: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP"
};

const operationalExtensionRoles: LiveModelRole[] = [
  "item_administration_tutor_agent",
  "profile_integration_agent",
  "formative_value_determination_agent",
  "formative_activity_dialogue_agent",
  "formative_activity_quality_reviewer_agent",
  "formative_activity_response_evaluator_agent",
  "post_activity_evidence_evaluator_agent",
  "student_communication_agent",
  "topic_dialogue_agent"
];

function configuredString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function approvedBaselineModelEquivalent(model: string | null, approvedSnapshot: string) {
  return model === null || model === approvedSnapshot || model === "gpt-5.4-mini";
}

function explicitOperationalRuntimeModelOverrides(
  env: ReturnType<typeof getServerEnv>,
  approvedConfig: ApprovedOperationalAgentConfig
) {
  const sourcesByRole = liveModelRoleEnvSources();
  const roles = [...AgentName.options, ...operationalExtensionRoles] as LiveModelRole[];
  const overrides: Record<string, unknown> = {};

  for (const role of roles) {
    const selectedSource = sourcesByRole[role].find((source) => configuredString(env[source.model]));
    if (!selectedSource) {
      continue;
    }

    const selectedMaxTokensKey = "maxTokens" in selectedSource ? selectedSource.maxTokens : undefined;
    const model = configuredString(env[selectedSource.model]);
    const reasoning = configuredString(env[selectedSource.reasoning]);
    const maxOutputTokens = selectedMaxTokensKey && typeof env[selectedMaxTokensKey] === "number"
      ? env[selectedMaxTokensKey]
      : undefined;
    const approvedMaxOutputTokens = AgentName.safeParse(role).success
      ? approvedConfig.agents[role as AgentNameType]?.max_output_tokens
      : selectedSource.defaultMaxTokens;
    const differs =
      !approvedBaselineModelEquivalent(model, approvedConfig.model_snapshot) ||
      (reasoning !== null && reasoning !== approvedConfig.reasoning_effort) ||
      (maxOutputTokens !== undefined && maxOutputTokens !== approvedMaxOutputTokens);

    if (differs) {
      overrides[role] = {
        model_name: model,
        reasoning_effort: reasoning,
        max_output_tokens: maxOutputTokens ?? null,
        model_env_key: selectedSource.model,
        reasoning_env_key: selectedSource.reasoning,
        max_output_tokens_env_key: selectedMaxTokensKey ?? null
      };
    }
  }

  return overrides;
}

export { stableHash } from "@/lib/operational/stable-hash";

export function readApprovedOperationalAgentConfig() {
  return approvedConfigSchema.parse(
    JSON.parse(readFileSync(APPROVED_OPERATIONAL_CONFIG_PATH, "utf8"))
  );
}

function readLegacyApprovedOperationalAgentConfig(filePath: string) {
  return approvedConfigSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}

export type ActiveApprovedOperationalRuntimeConfig =
  | {
      kind: "phase8a_legacy";
      manifest_version: string;
      approved_active_configuration_hash: string;
      config_hash: string;
      semantic_validator_version: string;
      safety_validator_version: string;
      effective_result_version: string;
      effective_validator_version: string;
      roles: Partial<Record<LiveModelRole, AgentModelConfig>>;
      runtime_policy: null;
      evaluation_evidence: {
        source: "phase8a_manifest";
        found: boolean;
        source_provider_run_id: null;
        derived_evaluation_id: null;
        evaluation_protocol_hash: null;
        approval_evidence_hash: null;
      };
      legacy_manifest: ApprovedOperationalAgentConfig;
      active_bundle: null;
    }
  | {
      kind: "derived_approval";
      manifest_version: string;
      approved_active_configuration_hash: string;
      config_hash: string;
      semantic_validator_version: string;
      safety_validator_version: string;
      effective_result_version: string;
      effective_validator_version: string;
      roles: Record<ApprovedOperationalRoleName, AgentModelConfig>;
      runtime_policy: ApprovedCandidateManifest["runtime_policy"];
      evaluation_evidence: {
        source: "derived_approval_bundle";
        found: boolean;
        source_provider_run_id: string;
        derived_evaluation_id: string;
        evaluation_protocol_hash: string;
        approval_evidence_hash: string;
      };
      legacy_manifest: ApprovedOperationalAgentConfig;
      active_bundle: ActiveDerivedOperationalApproval;
    };

export function readActiveApprovedOperationalRuntimeConfig(): ActiveApprovedOperationalRuntimeConfig {
  const activeApproval = resolveActiveOperationalApproval();
  if (activeApproval?.kind === "derived_approval") {
    const fingerprint = activeApproval.manifest.configuration_fingerprint;
    const roles = Object.fromEntries(APPROVED_OPERATIONAL_ROLE_NAMES.map((role) => [
      role,
      approvedCandidateRoleConfig(activeApproval.manifest, role)
    ])) as Record<ApprovedOperationalRoleName, AgentModelConfig>;
    return {
      kind: "derived_approval",
      manifest_version: activeApproval.manifest.manifest_version,
      approved_active_configuration_hash: activeApproval.record.runtime_candidate_hash,
      config_hash: activeApproval.record.approval_evidence_hash,
      semantic_validator_version: fingerprint.semantic_validator_version,
      safety_validator_version: fingerprint.safety_validator_version,
      effective_result_version: fingerprint.effective_result_version,
      effective_validator_version: fingerprint.effective_validator_version,
      roles,
      runtime_policy: activeApproval.manifest.runtime_policy,
      evaluation_evidence: {
        source: "derived_approval_bundle",
        found: true,
        source_provider_run_id: activeApproval.record.source_provider_run_id,
        derived_evaluation_id: activeApproval.record.derived_evaluation_id,
        evaluation_protocol_hash: activeApproval.record.evaluation_protocol_hash,
        approval_evidence_hash: activeApproval.record.approval_evidence_hash
      },
      legacy_manifest: readApprovedOperationalAgentConfig(),
      active_bundle: activeApproval
    };
  }

  const legacy = activeApproval?.kind === "legacy_gpt54_baseline"
    ? readLegacyApprovedOperationalAgentConfig(activeApproval.manifest_path)
    : readApprovedOperationalAgentConfig();
  return {
    kind: "phase8a_legacy",
    manifest_version: legacy.manifest_version,
    approved_active_configuration_hash: legacy.approved_active_configuration_hash,
    config_hash: legacy.config_hash,
    semantic_validator_version: legacy.semantic_validator_version,
    safety_validator_version: legacy.safety_validator_version,
    effective_result_version: legacy.effective_result_version,
    effective_validator_version: legacy.effective_validator_version,
    roles: Object.fromEntries(AgentName.options.map((agentName) => {
      const agent = legacy.agents[agentName];
      if (!agent) throw new Error(`Approved operational manifest is missing ${agentName}.`);
      return [agentName, {
        model_name: legacy.model_snapshot,
        reasoning_effort: legacy.reasoning_effort,
        max_output_tokens: agent.max_output_tokens
      }];
    })),
    runtime_policy: null,
    evaluation_evidence: {
      source: "phase8a_manifest",
      found: true,
      source_provider_run_id: null,
      derived_evaluation_id: null,
      evaluation_protocol_hash: null,
      approval_evidence_hash: null
    },
    legacy_manifest: legacy,
    active_bundle: null
  };
}

export function approvedOperationalConfigHash(config: ApprovedOperationalAgentConfig) {
  const copy = { ...config, config_hash: undefined } as Record<string, unknown>;
  delete copy.config_hash;
  return stableHash(copy);
}

function activeAgentsFromDerivedManifest(manifest: ApprovedCandidateManifest) {
  return Object.fromEntries(APPROVED_OPERATIONAL_ROLE_NAMES.map((role) => {
    const metadata = manifest.configuration_fingerprint.role_version_metadata[role] ?? {};
    const promptVersion = typeof metadata.prompt_version === "string"
      ? metadata.prompt_version
      : "deterministic-config";
    const schemaVersion = [
      metadata.schema_version,
      metadata.output_schema_version,
      metadata.input_schema_version
    ].find((value): value is string => typeof value === "string") ?? "not-applicable";
    return [role, {
      agent_version: promptVersion,
      prompt_version: promptVersion,
      prompt_hash: typeof metadata.prompt_hash === "string"
        ? metadata.prompt_hash
        : "deterministic-config-not-applicable",
      schema_version: schemaVersion,
      max_output_tokens: approvedCandidateRoleConfig(manifest, role).max_output_tokens
    }];
  })) as ApprovedOperationalConfigVerification["active_agents"];
}

export function activeOperationalAgentConfigSnapshot() {
  const activeRuntime = readActiveApprovedOperationalRuntimeConfig();
  if (activeRuntime.kind === "derived_approval") {
    return {
      model_snapshot: "role_specific",
      reasoning_effort: "role_specific",
      agents: activeAgentsFromDerivedManifest(activeRuntime.active_bundle.manifest),
      semantic_validator_version: activeRuntime.semantic_validator_version,
      safety_validator_version: activeRuntime.safety_validator_version,
      effective_result_version: activeRuntime.effective_result_version,
      effective_validator_version: activeRuntime.effective_validator_version,
      runtime_model_overrides: undefined
    };
  }
  const env = getServerEnv();
  const prompts = Object.fromEntries(listAgentPrompts().map((prompt) => [prompt.agent_name, prompt]));
  const approvedConfig = readApprovedOperationalAgentConfig();
  const runtimeModelOverrides = explicitOperationalRuntimeModelOverrides(env, approvedConfig);

  const snapshot: Record<string, unknown> = {
    model_snapshot: "gpt-5.4-mini-2026-03-17",
    reasoning_effort: "low",
    agents: Object.fromEntries(
      AgentName.options.map((agentName) => {
        const prompt = prompts[agentName];
        const approvedAgent = approvedConfig.agents[agentName];

        if (!prompt || !approvedAgent) {
          throw new Error(`Operational agent registry is missing ${agentName}.`);
        }

        const configuredMaxTokens = env[agentMaxTokenEnvKeys[agentName]];
        return [
          agentName,
          {
            agent_version: prompt.agent_version,
            prompt_version: prompt.prompt_version,
            prompt_hash: prompt.prompt_hash,
            schema_version: prompt.schema_version,
            max_output_tokens:
              typeof configuredMaxTokens === "number"
                ? configuredMaxTokens
                : approvedAgent.max_output_tokens
          }
        ];
      })
    ),
    semantic_validator_version: "eval-semantic-v3",
    safety_validator_version: "eval-safety-v3",
    effective_result_version: env.OPERATIONAL_EFFECTIVE_RESULT_VERSION,
    effective_validator_version: env.OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION
  };

  if (Object.keys(runtimeModelOverrides).length > 0) {
    snapshot.runtime_model_overrides = runtimeModelOverrides;
  }

  return snapshot as {
    model_snapshot: string;
    reasoning_effort: string;
    agents: ApprovedOperationalConfigVerification["active_agents"];
    semantic_validator_version: string;
    safety_validator_version: string;
    effective_result_version: string;
    effective_validator_version: string;
    runtime_model_overrides?: Record<string, unknown>;
  };
}

export function activeOperationalConfigHash() {
  const activeRuntime = readActiveApprovedOperationalRuntimeConfig();
  if (activeRuntime.kind === "derived_approval") {
    return activeRuntime.approved_active_configuration_hash;
  }
  return stableHash(activeOperationalAgentConfigSnapshot());
}

function resolvedOperationalRuntimeModelConfig(
  agentName: AgentNameType,
  override?: Partial<RuntimeModelResolution>
): RuntimeModelResolution {
  const approved = approvedModelConfigForAgent(agentName);
  return {
    model_name: approved.model_name,
    reasoning_effort: approved.reasoning_effort ?? null,
    max_output_tokens: approved.max_output_tokens ?? null,
    source: "approvedOperationalModelConfigForAgent",
    ...(override ?? {})
  };
}

function applyActiveAgentOverrides(
  activeAgents: ApprovedOperationalConfigVerification["active_agents"],
  overrides?: ApprovedOperationalConfigVerificationOptions["activeAgentConfigOverridesForTest"]
) {
  if (!overrides) {
    return activeAgents;
  }

  return Object.fromEntries(
    Object.entries(activeAgents).map(([agentName, config]) => [
      agentName,
      {
        ...config,
        ...(overrides[agentName as AgentNameType] ?? {})
      }
    ])
  ) as ApprovedOperationalConfigVerification["active_agents"];
}

function explicitlyConfigured(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function verifyDerivedApprovedOperationalConfig(
  activeRuntime: Extract<ActiveApprovedOperationalRuntimeConfig, { kind: "derived_approval" }>,
  options: ApprovedOperationalConfigVerificationOptions
): ApprovedOperationalConfigVerification {
  const env = getServerEnv();
  const manifest = activeRuntime.active_bundle.manifest;
  const issues: ApprovedOperationalConfigVerification["issues"] = [];
  const sources = liveModelRoleEnvSources();
  const activeAgents = applyActiveAgentOverrides(
    activeAgentsFromDerivedManifest(manifest),
    options.activeAgentConfigOverridesForTest
  );
  const runtimeModelResolution = Object.fromEntries(APPROVED_OPERATIONAL_ROLE_NAMES.map((role) => {
    const approved = approvedCandidateRoleConfig(manifest, role);
    const roleSource = sources[role][0];
    const configuredModel = explicitlyConfigured(roleSource.model)
      ? String(process.env[roleSource.model] ?? "")
      : null;
    const configuredReasoning = explicitlyConfigured(roleSource.reasoning)
      ? String(process.env[roleSource.reasoning] ?? "")
      : null;
    const configuredMaxTokens = "maxTokens" in roleSource && roleSource.maxTokens && explicitlyConfigured(roleSource.maxTokens)
      ? Number(process.env[roleSource.maxTokens])
      : null;
    const override = options.runtimeModelConfigOverridesForTest?.[role];
    const resolved = {
      model_name: override?.model_name === undefined ? approved.model_name : override.model_name,
      reasoning_effort: override?.reasoning_effort === undefined
        ? approved.reasoning_effort
        : override.reasoning_effort,
      max_output_tokens: override?.max_output_tokens === undefined
        ? approved.max_output_tokens
        : override.max_output_tokens,
      source: override?.source ?? "active_approval_bundle"
    };

    if (configuredModel !== null && configuredModel !== approved.model_name) {
      issues.push({
        code: "model_snapshot_mismatch",
        message: `${role} environment model assertion does not match the active approval bundle.`,
        details: { agent_name: role, model_env_key: roleSource.model }
      });
    }
    if (configuredReasoning !== null && configuredReasoning !== approved.reasoning_effort) {
      issues.push({
        code: "reasoning_effort_mismatch",
        message: `${role} environment reasoning assertion does not match the active approval bundle.`,
        details: { agent_name: role, reasoning_env_key: roleSource.reasoning }
      });
    }
    if (configuredMaxTokens !== null && configuredMaxTokens !== approved.max_output_tokens) {
      issues.push({
        code: "runtime_token_limit_mismatch",
        message: `${role} environment token assertion does not match the active approval bundle.`,
        details: { agent_name: role, max_output_tokens_env_key: "maxTokens" in roleSource ? roleSource.maxTokens : null }
      });
    }

    const compatibilityIssues = modelConfigCompatibilityIssues(role, approved);
    if (compatibilityIssues.length > 0) {
      issues.push({
        code: "approved_role_configuration_incompatible",
        message: `${role} is incompatible with the approved role policy.`,
        details: { agent_name: role, compatibility_issues: compatibilityIssues }
      });
    }
    if (resolved.model_name !== approved.model_name) {
      issues.push({ code: "model_snapshot_mismatch", message: `${role} resolved model is not approved.`, details: { agent_name: role } });
    }
    if (resolved.reasoning_effort !== approved.reasoning_effort) {
      issues.push({ code: "reasoning_effort_mismatch", message: `${role} resolved reasoning effort is not approved.`, details: { agent_name: role } });
    }
    if (resolved.max_output_tokens !== approved.max_output_tokens) {
      issues.push({ code: "runtime_token_limit_mismatch", message: `${role} resolved token limit is not approved.`, details: { agent_name: role } });
    }

    return [role, {
      approved_model_snapshot: approved.model_name,
      resolved_model_snapshot: resolved.model_name ?? null,
      approved_reasoning_effort: approved.reasoning_effort,
      resolved_reasoning_effort: resolved.reasoning_effort ?? null,
      approved_max_output_tokens: approved.max_output_tokens,
      resolved_max_output_tokens: resolved.max_output_tokens ?? null,
      source: resolved.source
    }];
  })) as ApprovedOperationalConfigVerification["runtime_model_resolution"];

  for (const role of AgentName.options) {
    const prompt = listAgentPrompts().find((entry) => entry.agent_name === role);
    const metadata = manifest.configuration_fingerprint.role_version_metadata[role];
    if (prompt && metadata) {
      for (const [field, actual, approved] of [
        ["prompt_version", prompt.prompt_version, metadata.prompt_version],
        ["prompt_hash", prompt.prompt_hash, metadata.prompt_hash],
        ["schema_version", prompt.schema_version, metadata.schema_version]
      ] as const) {
        if (typeof approved === "string" && actual !== approved) {
          issues.push({
            code: "active_agent_config_mismatch",
            message: `${role} ${field} does not match the approved operational bundle.`,
            details: { agent_name: role, field }
          });
        }
      }
    }
  }

  const policyAssertions: Array<[string, unknown, unknown]> = [
    ["OPENAI_REQUEST_TIMEOUT_MS", env.OPENAI_REQUEST_TIMEOUT_MS, manifest.runtime_policy.provider_timeout_ms],
    ["OPENAI_MAX_RETRIES", env.OPENAI_MAX_RETRIES, manifest.runtime_policy.provider_max_retries],
    ["STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED", env.STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED, manifest.runtime_policy.role_live_toggles.student_communication_agent],
    ["TOPIC_DIALOGUE_LIVE_CALLS_ENABLED", env.TOPIC_DIALOGUE_LIVE_CALLS_ENABLED, manifest.runtime_policy.role_live_toggles.topic_dialogue_agent],
    ["TOPIC_DIALOGUE_MAX_STUDENT_TURNS", env.TOPIC_DIALOGUE_MAX_STUDENT_TURNS, manifest.runtime_policy.topic_dialogue_policy.maximum_student_turns],
    ["TOPIC_DIALOGUE_RECENT_TURN_WINDOW", env.TOPIC_DIALOGUE_RECENT_TURN_WINDOW, manifest.runtime_policy.topic_dialogue_policy.recent_raw_turn_window],
    ["TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS", env.TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS, manifest.runtime_policy.topic_dialogue_policy.maximum_student_message_characters],
    ["TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS", env.TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS, manifest.runtime_policy.topic_dialogue_policy.assessment_system_questions_allowed]
  ];
  for (const [name, actual, approved] of policyAssertions) {
    if (explicitlyConfigured(name) && actual !== approved) {
      issues.push({
        code: "runtime_policy_env_mismatch",
        message: `${name} does not match the active approval bundle.`,
        details: { environment_variable: name }
      });
    }
  }

  if (env.OPERATIONAL_EFFECTIVE_RESULT_VERSION !== activeRuntime.effective_result_version) {
    issues.push({ code: "effective_result_version_mismatch", message: "Effective result version does not match the active approval bundle." });
  }
  if (env.OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION !== activeRuntime.effective_validator_version) {
    issues.push({ code: "effective_validator_version_mismatch", message: "Effective validator version does not match the active approval bundle." });
  }
  if (env.OPERATIONAL_APPROVED_CONFIG_HASH !== activeRuntime.approved_active_configuration_hash) {
    issues.push({
      code: env.OPERATIONAL_APPROVED_CONFIG_HASH ? "approved_config_hash_env_mismatch" : "approved_config_hash_missing",
      message: "OPERATIONAL_APPROVED_CONFIG_HASH must exactly match the active approval bundle."
    });
  }

  return {
    approval_kind: "derived_approval",
    valid: issues.length === 0,
    manifest_hash: activeRuntime.active_bundle.record.approved_manifest.sha256,
    approved_hash: activeRuntime.active_bundle.record.approval_evidence_hash,
    issues,
    active_configuration_hash: activeRuntime.approved_active_configuration_hash,
    active_agents: activeAgents,
    runtime_model_resolution: runtimeModelResolution,
    manifest: activeRuntime.legacy_manifest,
    runtime_candidate_hash: activeRuntime.approved_active_configuration_hash,
    evaluation_protocol_hash: activeRuntime.evaluation_evidence.evaluation_protocol_hash,
    approval_evidence_hash: activeRuntime.evaluation_evidence.approval_evidence_hash,
    role_inventory: [...APPROVED_OPERATIONAL_ROLE_NAMES],
    runtime_policy: manifest.runtime_policy,
    approval_bundle_path: activeRuntime.active_bundle.bundle_path,
    semantic_validator_version: activeRuntime.semantic_validator_version,
    safety_validator_version: activeRuntime.safety_validator_version,
    effective_result_version: activeRuntime.effective_result_version,
    effective_validator_version: activeRuntime.effective_validator_version
  };
}

export function verifyApprovedOperationalAgentConfig(
  options: ApprovedOperationalConfigVerificationOptions = {}
): ApprovedOperationalConfigVerification {
  let activeRuntime: ActiveApprovedOperationalRuntimeConfig;
  try {
    activeRuntime = readActiveApprovedOperationalRuntimeConfig();
  } catch (error) {
    if (!(error instanceof OperationalApprovalBundleError || error instanceof z.ZodError)) {
      throw error;
    }
    const manifest = readApprovedOperationalAgentConfig();
    const code = error instanceof OperationalApprovalBundleError
      ? error.code
      : "active_approval_bundle_schema_invalid";
    return {
      approval_kind: "derived_approval",
      valid: false,
      manifest_hash: "unavailable",
      approved_hash: process.env.OPERATIONAL_APPROVED_CONFIG_HASH ?? "unavailable",
      issues: [{
        code,
        message: "Configured active operational approval bundle is invalid.",
        details: error instanceof OperationalApprovalBundleError ? error.details : undefined
      }],
      active_configuration_hash: "unavailable",
      active_agents: {},
      runtime_model_resolution: {},
      manifest,
      runtime_candidate_hash: "unavailable",
      evaluation_protocol_hash: null,
      approval_evidence_hash: null,
      role_inventory: [],
      runtime_policy: null,
      approval_bundle_path: process.env.OPERATIONAL_APPROVAL_BUNDLE_PATH ?? null,
      semantic_validator_version: manifest.semantic_validator_version,
      safety_validator_version: manifest.safety_validator_version,
      effective_result_version: manifest.effective_result_version,
      effective_validator_version: manifest.effective_validator_version
    };
  }
  if (activeRuntime.kind === "derived_approval") {
    return verifyDerivedApprovedOperationalConfig(activeRuntime, options);
  }
  const env = getServerEnv();
  const manifest = readApprovedOperationalAgentConfig();
  const issues: ApprovedOperationalConfigVerification["issues"] = [];
  const manifestHash = approvedOperationalConfigHash(manifest);
  const activeSnapshot = activeOperationalAgentConfigSnapshot();
  activeSnapshot.agents = applyActiveAgentOverrides(
    activeSnapshot.agents,
    options.activeAgentConfigOverridesForTest
  );
  const activeHash = stableHash(activeSnapshot);
  const runtimeModelResolution = Object.fromEntries(
    AgentName.options.map((agentName) => {
      const approved = manifest.agents[agentName];
      const resolved = resolvedOperationalRuntimeModelConfig(
        agentName,
        options.runtimeModelConfigOverridesForTest?.[agentName]
      );
      return [
        agentName,
        {
          approved_model_snapshot: manifest.model_snapshot,
          resolved_model_snapshot: resolved.model_name ?? null,
          approved_reasoning_effort: manifest.reasoning_effort,
          resolved_reasoning_effort: resolved.reasoning_effort ?? null,
          approved_max_output_tokens: approved?.max_output_tokens ?? null,
          resolved_max_output_tokens: resolved.max_output_tokens ?? null,
          source: resolved.source
        }
      ];
    })
  ) as ApprovedOperationalConfigVerification["runtime_model_resolution"];

  if (manifestHash !== manifest.config_hash) {
    issues.push({
      code: "manifest_hash_mismatch",
      message: "Approved operational manifest hash does not match manifest contents."
    });
  }

  for (const agentName of AgentName.options) {
    const active = activeSnapshot.agents[agentName];
    const approved = manifest.agents[agentName];

    if (!approved) {
      issues.push({ code: "missing_approved_agent", message: `Manifest is missing ${agentName}.` });
      continue;
    }

    for (const key of ["agent_version", "prompt_version", "prompt_hash", "schema_version", "max_output_tokens"] as const) {
      if (active[key] !== approved[key]) {
        issues.push({
          code: "active_agent_config_mismatch",
          message: `${agentName} ${key} does not match approved operational manifest.`,
          details: { agent_name: agentName, field: key }
        });
      }
    }

    const resolved = runtimeModelResolution[agentName];

    if (!resolved.resolved_model_snapshot) {
      issues.push({
        code: "model_snapshot_missing",
        message: `${agentName} resolved runtime model snapshot is missing.`,
        details: { agent_name: agentName, source: resolved.source }
      });
    } else if (resolved.resolved_model_snapshot !== resolved.approved_model_snapshot) {
      issues.push({
        code: "model_snapshot_mismatch",
        message: `${agentName} resolved runtime model is not the approved exact snapshot.`,
        details: {
          agent_name: agentName,
          source: resolved.source,
          approved_model_snapshot: resolved.approved_model_snapshot,
          resolved_model_snapshot: resolved.resolved_model_snapshot
        }
      });
    }

    if (!resolved.resolved_reasoning_effort) {
      issues.push({
        code: "reasoning_effort_missing",
        message: `${agentName} resolved runtime reasoning effort is missing.`,
        details: { agent_name: agentName, source: resolved.source }
      });
    } else if (resolved.resolved_reasoning_effort !== resolved.approved_reasoning_effort) {
      issues.push({
        code: "reasoning_effort_mismatch",
        message: `${agentName} resolved runtime reasoning effort is not the approved value.`,
        details: {
          agent_name: agentName,
          source: resolved.source,
          approved_reasoning_effort: resolved.approved_reasoning_effort,
          resolved_reasoning_effort: resolved.resolved_reasoning_effort
        }
      });
    }

    if (resolved.resolved_max_output_tokens !== resolved.approved_max_output_tokens) {
      issues.push({
        code: "runtime_token_limit_mismatch",
        message: `${agentName} resolved runtime token limit does not match the approved manifest.`,
        details: {
          agent_name: agentName,
          source: resolved.source,
          approved_max_output_tokens: resolved.approved_max_output_tokens,
          resolved_max_output_tokens: resolved.resolved_max_output_tokens
        }
      });
    }
  }

  if (activeSnapshot.effective_result_version !== manifest.effective_result_version) {
    issues.push({
      code: "effective_result_version_mismatch",
      message: "OPERATIONAL_EFFECTIVE_RESULT_VERSION does not match the approved manifest."
    });
  }

  if (activeSnapshot.effective_validator_version !== manifest.effective_validator_version) {
    issues.push({
      code: "effective_validator_version_mismatch",
      message: "OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION does not match the approved manifest."
    });
  }

  if (env.OPERATIONAL_APPROVED_CONFIG_HASH && env.OPERATIONAL_APPROVED_CONFIG_HASH !== activeHash) {
    issues.push({
      code: "approved_config_hash_env_mismatch",
      message: "OPERATIONAL_APPROVED_CONFIG_HASH does not match the active operational configuration hash."
    });
  }

  if (manifest.approved_active_configuration_hash !== activeHash) {
    issues.push({
      code: "active_configuration_hash_mismatch",
      message: "Active operational configuration hash does not match the approved manifest hash."
    });
  }

  return {
    approval_kind: "phase8a_legacy",
    valid: issues.length === 0,
    manifest_hash: manifestHash,
    approved_hash: manifest.config_hash,
    issues,
    active_configuration_hash: activeHash,
    active_agents: activeSnapshot.agents,
    runtime_model_resolution: runtimeModelResolution,
    manifest,
    runtime_candidate_hash: manifest.approved_active_configuration_hash,
    evaluation_protocol_hash: null,
    approval_evidence_hash: null,
    role_inventory: [...AgentName.options],
    runtime_policy: null,
    approval_bundle_path: null,
    semantic_validator_version: manifest.semantic_validator_version,
    safety_validator_version: manifest.safety_validator_version,
    effective_result_version: manifest.effective_result_version,
    effective_validator_version: manifest.effective_validator_version
  };
}

export function approvedModelConfigForAgent(agentName: AgentNameType): AgentModelConfig {
  return approvedModelConfigForRole(agentName);
}

export function approvedModelConfigForRole(role: LiveModelRole): AgentModelConfig {
  const activeRuntime = readActiveApprovedOperationalRuntimeConfig();
  const approved = activeRuntime.roles[role];

  if (!approved) {
    throw new OperationalApprovalBundleError(
      "approved_role_missing",
      `Active approved operational configuration is missing ${role}.`
    );
  }
  return { ...approved };
}
