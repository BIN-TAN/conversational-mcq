import { z } from "zod";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import { getServerEnv } from "@/lib/env";
import { resolveOpenAICredentialFromEnv } from "@/lib/llm/openai-credential-resolver";
import {
  type ApprovedCandidateManifest,
  LEGACY_GPT54_APPROVED_RUNTIME_HASH,
  approvedCandidateRoleConfig,
  OperationalApprovalBundleError,
  resolveActiveOperationalApproval
} from "@/lib/operational/active-approval-bundle";

export const ReasoningEffort = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);
export const Verbosity = z.enum(["low", "medium", "high"]);
export const LiveModelRole = z.enum([
  "item_verification_agent",
  "item_administration_tutor_agent",
  "response_collection_agent",
  "student_profiling_agent",
  "profile_integration_agent",
  "formative_value_and_planning_agent",
  "formative_value_determination_agent",
  "followup_agent",
  "formative_activity_dialogue_agent",
  "formative_activity_quality_reviewer_agent",
  "formative_activity_response_evaluator_agent",
  "post_activity_evidence_evaluator_agent",
  "student_communication_agent",
  "topic_dialogue_agent",
  "mcq_diagnostic_authoring_assistant_agent",
  "mcq_import_formatting_assistant_agent",
  "connectivity_test"
]);

export type ReasoningEffort = z.infer<typeof ReasoningEffort>;
export type Verbosity = z.infer<typeof Verbosity>;
export type LiveModelRole = z.infer<typeof LiveModelRole>;

export type LlmProviderName = "mock" | "openai";

export type AgentModelConfig = {
  model_name: string;
  reasoning_effort?: ReasoningEffort;
  temperature?: number;
  max_output_tokens?: number;
  verbosity?: Verbosity;
};

export type LlmRuntimeConfig = {
  provider: LlmProviderName;
  live_calls_enabled: boolean;
  openai_key_configured: boolean;
  request_timeout_ms: number;
  max_retries: number;
};

export class LlmConfigurationError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "LlmConfigurationError";
    this.code = code;
    this.details = details;
  }
}

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

const agentEnvKeys = {
  item_verification_agent: {
    model: "OPENAI_MODEL_ITEM_VERIFICATION",
    reasoning: "OPENAI_REASONING_EFFORT_ITEM_VERIFICATION",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION"
  },
  response_collection_agent: {
    model: "OPENAI_MODEL_RESPONSE_COLLECTION",
    reasoning: "OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION"
  },
  student_profiling_agent: {
    model: "OPENAI_MODEL_PROFILING",
    reasoning: "OPENAI_REASONING_EFFORT_PROFILING",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PROFILING"
  },
  formative_value_and_planning_agent: {
    model: "OPENAI_MODEL_PLANNING",
    reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING"
  },
  followup_agent: {
    model: "OPENAI_MODEL_FOLLOWUP",
    reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP"
  }
} as const satisfies Record<AgentNameType, {
  model: keyof ReturnType<typeof getServerEnv>;
  reasoning: keyof ReturnType<typeof getServerEnv>;
  maxTokens: keyof ReturnType<typeof getServerEnv>;
}>;

type EnvKey = keyof ReturnType<typeof getServerEnv>;
type RoleSource = {
  model: EnvKey;
  reasoning: EnvKey;
  maxTokens?: EnvKey;
  defaultMaxTokens?: number;
};

const roleEnvSources = {
  item_verification_agent: [{
    model: "OPENAI_MODEL_ITEM_VERIFICATION",
    reasoning: "OPENAI_REASONING_EFFORT_ITEM_VERIFICATION",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION",
    defaultMaxTokens: 3000
  }],
  item_administration_tutor_agent: [
    {
      model: "OPENAI_MODEL_ITEM_ADMIN",
      reasoning: "OPENAI_REASONING_EFFORT_ITEM_ADMIN",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_ITEM_ADMIN",
      defaultMaxTokens: 1200
    },
    {
      model: "OPENAI_MODEL_FOLLOWUP",
      reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
      defaultMaxTokens: 2500
    }
  ],
  response_collection_agent: [{
    model: "OPENAI_MODEL_RESPONSE_COLLECTION",
    reasoning: "OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION",
    defaultMaxTokens: 1500
  }],
  student_profiling_agent: [{
    model: "OPENAI_MODEL_PROFILING",
    reasoning: "OPENAI_REASONING_EFFORT_PROFILING",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PROFILING",
    defaultMaxTokens: 4000
  }],
  profile_integration_agent: [
    {
      model: "OPENAI_MODEL_PROFILE_INTEGRATION",
      reasoning: "OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_PLANNING",
      reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_FOLLOWUP",
      reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
      defaultMaxTokens: 2500
    }
  ],
  formative_value_and_planning_agent: [{
    model: "OPENAI_MODEL_PLANNING",
    reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
    defaultMaxTokens: 3000
  }],
  formative_value_determination_agent: [
    {
      model: "OPENAI_MODEL_FORMATIVE_VALUE_DETERMINATION",
      reasoning: "OPENAI_REASONING_EFFORT_FORMATIVE_VALUE_DETERMINATION",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_VALUE_DETERMINATION",
      defaultMaxTokens: 2500
    },
    {
      model: "OPENAI_MODEL_PROFILE_INTEGRATION",
      reasoning: "OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION",
      defaultMaxTokens: 2500
    },
    {
      model: "OPENAI_MODEL_PLANNING",
      reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_FOLLOWUP",
      reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
      defaultMaxTokens: 2500
    }
  ],
  followup_agent: [{
    model: "OPENAI_MODEL_FOLLOWUP",
    reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
    defaultMaxTokens: 2500
  }],
  formative_activity_dialogue_agent: [
    {
      model: "OPENAI_MODEL_FORMATIVE_ACTIVITY_DIALOGUE",
      reasoning: "OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_DIALOGUE",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_DIALOGUE",
      defaultMaxTokens: 3500
    },
    {
      model: "OPENAI_MODEL_FOLLOWUP",
      reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
      defaultMaxTokens: 3500
    },
    {
      model: "OPENAI_MODEL_PLANNING",
      reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_PROFILE_INTEGRATION",
      reasoning: "OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION",
      defaultMaxTokens: 3000
    }
  ],
  formative_activity_quality_reviewer_agent: [
    {
      model: "OPENAI_MODEL_FORMATIVE_ACTIVITY_QUALITY_REVIEWER",
      reasoning: "OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_QUALITY_REVIEWER",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_QUALITY_REVIEWER",
      defaultMaxTokens: 2500
    },
    {
      model: "OPENAI_MODEL_FOLLOWUP",
      reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
      defaultMaxTokens: 2500
    },
    {
      model: "OPENAI_MODEL_PLANNING",
      reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
      defaultMaxTokens: 3000
    }
  ],
  formative_activity_response_evaluator_agent: [
    {
      model: "OPENAI_MODEL_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR",
      reasoning: "OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_FOLLOWUP",
      reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_PLANNING",
      reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_PROFILE_INTEGRATION",
      reasoning: "OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION",
      defaultMaxTokens: 3000
    }
  ],
  post_activity_evidence_evaluator_agent: [
    {
      model: "OPENAI_MODEL_POST_ACTIVITY_EVIDENCE_EVALUATOR",
      reasoning: "OPENAI_REASONING_EFFORT_POST_ACTIVITY_EVIDENCE_EVALUATOR",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_POST_ACTIVITY_EVIDENCE_EVALUATOR",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_FOLLOWUP",
      reasoning: "OPENAI_REASONING_EFFORT_FOLLOWUP",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP",
      defaultMaxTokens: 3000
    },
    {
      model: "OPENAI_MODEL_PLANNING",
      reasoning: "OPENAI_REASONING_EFFORT_PLANNING",
      maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_PLANNING",
      defaultMaxTokens: 3000
    }
  ],
  student_communication_agent: [{
    model: "OPENAI_MODEL_STUDENT_COMMUNICATION",
    reasoning: "OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION",
    defaultMaxTokens: 2500
  }],
  topic_dialogue_agent: [{
    model: "OPENAI_MODEL_TOPIC_DIALOGUE",
    reasoning: "OPENAI_REASONING_EFFORT_TOPIC_DIALOGUE",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_TOPIC_DIALOGUE",
    defaultMaxTokens: 3500
  }],
  mcq_diagnostic_authoring_assistant_agent: [{
    model: "OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING",
    reasoning: "OPENAI_REASONING_EFFORT_MCQ_DIAGNOSTIC_AUTHORING",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_MCQ_DIAGNOSTIC_AUTHORING",
    defaultMaxTokens: 2500
  }],
  mcq_import_formatting_assistant_agent: [{
    model: "OPENAI_MODEL_MCQ_FORMATTING",
    reasoning: "OPENAI_REASONING_EFFORT_MCQ_FORMATTING",
    maxTokens: "OPENAI_MAX_OUTPUT_TOKENS_MCQ_FORMATTING",
    defaultMaxTokens: 3000
  }],
  connectivity_test: [{
    model: "OPENAI_MODEL_CONNECTIVITY_TEST",
    reasoning: "OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST",
    defaultMaxTokens: 200
  }]
} as const satisfies Record<LiveModelRole, readonly RoleSource[]>;

export const liveModelRoles = LiveModelRole.options;

export type RoleModelReadiness = {
  role: LiveModelRole;
  model_configured: boolean;
  effective_model: string | null;
  reasoning_effort: ReasoningEffort | null;
  max_output_tokens: number | null;
  model_env_key: string | null;
  reasoning_env_key: string | null;
  approval_boundary: "operational_manifest" | "operational_extension_required" | "teacher_tool" | "utility";
  compatibility_status: "compatible" | "incompatible" | "not_configured";
  compatibility_issues: string[];
  resolution_source?: "environment" | "active_approval_bundle";
};

function approvalBoundary(role: LiveModelRole): RoleModelReadiness["approval_boundary"] {
  if (AgentName.safeParse(role).success) {
    return "operational_manifest";
  }
  if (role === "mcq_diagnostic_authoring_assistant_agent" || role === "mcq_import_formatting_assistant_agent") {
    return "teacher_tool";
  }
  if (role === "connectivity_test") {
    return "utility";
  }
  return "operational_extension_required";
}

function modelCapabilityFor(modelName: string) {
  if (/^gpt-5\.6-luna$/u.test(modelName)) {
    return new Set<ReasoningEffort>(["none", "low"]);
  }
  if (/^gpt-5\.6-terra$/u.test(modelName)) {
    return new Set<ReasoningEffort>(["low", "medium", "high"]);
  }
  if (/^gpt-5\.6-sol$/u.test(modelName)) {
    return new Set<ReasoningEffort>(["low", "medium", "high", "xhigh", "max"]);
  }
  if (/^gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2})?$/u.test(modelName)) {
    return new Set<ReasoningEffort>(["none", "low", "medium", "high"]);
  }
  if (modelName.startsWith("mock-") || modelName.startsWith("synthetic-") || modelName.startsWith("injected-")) {
    return new Set<ReasoningEffort>(ReasoningEffort.options);
  }
  return null;
}

function roleAllowsModel(role: LiveModelRole, modelName: string) {
  if (!modelName.startsWith("gpt-5.6-")) {
    return true;
  }
  const candidateAllowed: Partial<Record<LiveModelRole, string[]>> = {
    item_verification_agent: ["gpt-5.6-terra"],
    item_administration_tutor_agent: ["gpt-5.6-luna"],
    response_collection_agent: ["gpt-5.6-luna"],
    student_profiling_agent: ["gpt-5.6-terra"],
    profile_integration_agent: ["gpt-5.6-terra"],
    formative_value_and_planning_agent: ["gpt-5.6-sol"],
    formative_value_determination_agent: ["gpt-5.6-terra", "gpt-5.6-sol"],
    followup_agent: ["gpt-5.6-sol"],
    formative_activity_dialogue_agent: ["gpt-5.6-sol"],
    formative_activity_quality_reviewer_agent: ["gpt-5.6-sol"],
    formative_activity_response_evaluator_agent: ["gpt-5.6-sol"],
    post_activity_evidence_evaluator_agent: ["gpt-5.6-sol"],
    student_communication_agent: ["gpt-5.6-terra"],
    topic_dialogue_agent: ["gpt-5.6-sol"],
    mcq_diagnostic_authoring_assistant_agent: ["gpt-5.6-terra"],
    mcq_import_formatting_assistant_agent: ["gpt-5.6-luna"],
    connectivity_test: ["gpt-5.6-luna"]
  };
  return (candidateAllowed[role] ?? []).includes(modelName);
}

export function modelConfigCompatibilityIssues(role: LiveModelRole, config: AgentModelConfig) {
  const issues: string[] = [];
  if (!roleAllowsModel(role, config.model_name)) {
    issues.push("model_not_allowed_for_agent");
  }
  if (config.reasoning_effort) {
    const capability = modelCapabilityFor(config.model_name);
    if (capability && !capability.has(config.reasoning_effort)) {
      issues.push("reasoning_effort_not_supported_by_model");
    }
  }
  if (config.max_output_tokens !== undefined && config.max_output_tokens <= 0) {
    issues.push("max_output_tokens_not_positive");
  }
  return issues;
}

export function assertModelConfigCompatible(role: LiveModelRole, config: AgentModelConfig) {
  const issues = modelConfigCompatibilityIssues(role, config);
  if (issues.length > 0) {
    throw new LlmConfigurationError(
      "agent_model_config_incompatible",
      `${role} model configuration is not compatible with the approved agent/model policy.`,
      { agent_name: role, model_name: config.model_name, reasoning_effort: config.reasoning_effort, issues }
    );
  }
}

export function getLlmRuntimeConfig(): LlmRuntimeConfig {
  const env = getServerEnv();
  const provider = env.LLM_PROVIDER;
  const liveCallsEnabled = env.LLM_LIVE_CALLS_ENABLED;
  const credentialResolution = resolveOpenAICredentialFromEnv();
  const openaiKeyConfigured = credentialResolution.ok;

  if (liveCallsEnabled && provider !== "openai") {
    throw new LlmConfigurationError(
      "live_calls_provider_mismatch",
      "LLM_LIVE_CALLS_ENABLED=true requires LLM_PROVIDER=openai."
    );
  }

  if (provider === "openai" && !liveCallsEnabled) {
    throw new LlmConfigurationError(
      "openai_live_calls_disabled",
      "LLM_PROVIDER=openai requires LLM_LIVE_CALLS_ENABLED=true for Phase 6A."
    );
  }

  if ((provider === "openai" || liveCallsEnabled) && !openaiKeyConfigured) {
    throw new LlmConfigurationError(
      credentialResolution.code,
      "A valid server-side OpenAI credential is required only when live OpenAI calls are explicitly enabled.",
      {
        credential_source: credentialResolution.source
      }
    );
  }

  if (provider === "mock") {
    return {
      provider,
      live_calls_enabled: false,
      openai_key_configured: openaiKeyConfigured,
      request_timeout_ms: env.OPENAI_REQUEST_TIMEOUT_MS,
      max_retries: env.OPENAI_MAX_RETRIES
    };
  }

  const activeApproval = resolveOperationalApprovalForModelResolution();
  const approvedRuntimePolicy = activeApproval?.manifest.runtime_policy;
  assertRuntimePolicyEnvironmentMatches(activeApproval);

  return {
    provider,
    live_calls_enabled: liveCallsEnabled,
    openai_key_configured: openaiKeyConfigured,
    request_timeout_ms: approvedRuntimePolicy?.provider_timeout_ms ?? env.OPENAI_REQUEST_TIMEOUT_MS,
    max_retries: approvedRuntimePolicy?.provider_max_retries ?? env.OPENAI_MAX_RETRIES
  };
}

function configuredProcessEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function resolveOperationalApprovalForModelResolution(
  options: { require_approved_hash_match?: boolean } = {}
) {
  try {
    const active = resolveActiveOperationalApproval();
    if (active?.kind === "derived_approval") {
      if (
        options.require_approved_hash_match !== false &&
        process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== active.record.runtime_candidate_hash
      ) {
        throw new LlmConfigurationError(
          "approved_config_hash_mismatch",
          "OPERATIONAL_APPROVED_CONFIG_HASH does not match the active operational approval bundle."
        );
      }
      return active;
    }
    if (
      configuredProcessEnv("OPERATIONAL_APPROVED_CONFIG_HASH") &&
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== LEGACY_GPT54_APPROVED_RUNTIME_HASH
    ) {
      throw new LlmConfigurationError(
        "active_approval_bundle_missing",
        "A non-legacy approved configuration hash requires an active operational approval bundle."
      );
    }
    return null;
  } catch (error) {
    if (error instanceof LlmConfigurationError) throw error;
    if (error instanceof OperationalApprovalBundleError) {
      throw new LlmConfigurationError(error.code, error.message, error.details);
    }
    throw error;
  }
}

function assertExplicitPolicyValue(name: string, actual: unknown, approved: unknown) {
  if (configuredProcessEnv(name) && actual !== approved) {
    throw new LlmConfigurationError(
      "runtime_policy_env_mismatch",
      `${name} does not match the active operational approval bundle.`,
      { environment_variable: name }
    );
  }
}

function assertRuntimePolicyEnvironmentMatches(
  active: ReturnType<typeof resolveOperationalApprovalForModelResolution>
) {
  if (!active) return;
  const env = getServerEnv();
  const policy = active.manifest.runtime_policy;
  assertExplicitPolicyValue("OPENAI_REQUEST_TIMEOUT_MS", env.OPENAI_REQUEST_TIMEOUT_MS, policy.provider_timeout_ms);
  assertExplicitPolicyValue("OPENAI_MAX_RETRIES", env.OPENAI_MAX_RETRIES, policy.provider_max_retries);
  assertExplicitPolicyValue(
    "STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED",
    env.STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED,
    policy.role_live_toggles.student_communication_agent
  );
  assertExplicitPolicyValue(
    "TOPIC_DIALOGUE_LIVE_CALLS_ENABLED",
    env.TOPIC_DIALOGUE_LIVE_CALLS_ENABLED,
    policy.role_live_toggles.topic_dialogue_agent
  );
  assertExplicitPolicyValue(
    "TOPIC_DIALOGUE_MAX_STUDENT_TURNS",
    env.TOPIC_DIALOGUE_MAX_STUDENT_TURNS,
    policy.topic_dialogue_policy.maximum_student_turns
  );
  assertExplicitPolicyValue(
    "TOPIC_DIALOGUE_RECENT_TURN_WINDOW",
    env.TOPIC_DIALOGUE_RECENT_TURN_WINDOW,
    policy.topic_dialogue_policy.recent_raw_turn_window
  );
  assertExplicitPolicyValue(
    "TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS",
    env.TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS,
    policy.topic_dialogue_policy.maximum_student_message_characters
  );
  assertExplicitPolicyValue(
    "TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS",
    env.TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS,
    policy.topic_dialogue_policy.assessment_system_questions_allowed
  );
}

function assertRoleEnvironmentMatchesApproved(role: LiveModelRole, approved: AgentModelConfig) {
  const env = getServerEnv();
  const source = roleEnvSources[role][0];
  const model = sourceModelValue(env, source);
  const reasoning = reasoningValue(env, source.reasoning);
  const tokens = numberValue(env, maxTokensKey(source));
  if (model !== null && model !== approved.model_name) {
    throw new LlmConfigurationError("model_snapshot_mismatch", `${role} model assertion does not match the active approval bundle.`);
  }
  if (reasoning !== undefined && reasoning !== approved.reasoning_effort) {
    throw new LlmConfigurationError("reasoning_effort_mismatch", `${role} reasoning assertion does not match the active approval bundle.`);
  }
  if (tokens !== undefined && tokens !== approved.max_output_tokens) {
    throw new LlmConfigurationError("runtime_token_limit_mismatch", `${role} token assertion does not match the active approval bundle.`);
  }
}

function sourceModelValue(env: ReturnType<typeof getServerEnv>, source: RoleSource) {
  const modelValue = env[source.model];
  return configured(typeof modelValue === "string" ? modelValue : undefined)
    ? String(modelValue)
    : null;
}

function numberValue(env: ReturnType<typeof getServerEnv>, key?: EnvKey) {
  if (!key) return undefined;
  const value = env[key];
  return typeof value === "number" ? value : undefined;
}

function maxTokensKey(source: RoleSource) {
  return "maxTokens" in source ? source.maxTokens : undefined;
}

function reasoningValue(env: ReturnType<typeof getServerEnv>, key: EnvKey) {
  const value = env[key];
  return typeof value === "string" ? ReasoningEffort.parse(value) : undefined;
}

function resolveRoleSource(env: ReturnType<typeof getServerEnv>, role: LiveModelRole) {
  const sources = roleEnvSources[role];
  return sources.find((source) => sourceModelValue(env, source)) ?? null;
}

export function resolveOpenAIModelConfigForRole(role: LiveModelRole): AgentModelConfig {
  const parsedRole = LiveModelRole.parse(role);
  const activeApproval = resolveOperationalApprovalForModelResolution();
  if (activeApproval) {
    const approved = approvedCandidateRoleConfig(activeApproval.manifest, parsedRole);
    assertRoleEnvironmentMatchesApproved(parsedRole, approved);
    assertModelConfigCompatible(parsedRole, approved);
    return { ...approved };
  }
  const env = getServerEnv();
  const source = resolveRoleSource(env, parsedRole);

  if (!source) {
    throw new LlmConfigurationError(
      AgentName.safeParse(parsedRole).success ? "agent_model_missing" : `${parsedRole}_model_missing`,
      `${parsedRole} requires one of ${roleEnvSources[parsedRole].map((entry) => entry.model).join(", ")} when live OpenAI calls are enabled.`,
      { agent_name: parsedRole, model_env_keys: roleEnvSources[parsedRole].map((entry) => entry.model) }
    );
  }

  const config: AgentModelConfig = {
    model_name: sourceModelValue(env, source)!,
    reasoning_effort: reasoningValue(env, source.reasoning),
    max_output_tokens: numberValue(env, maxTokensKey(source)) ?? source.defaultMaxTokens
  };
  assertModelConfigCompatible(parsedRole, config);
  return config;
}

export function resolveAgentModelConfig(agentName: AgentNameType): AgentModelConfig {
  const parsedAgentName = AgentName.parse(agentName);
  const runtime = getLlmRuntimeConfig();

  if (runtime.provider === "mock") {
    return {
      model_name: `mock-${parsedAgentName}`
    };
  }

  return resolveOpenAIModelConfigForRole(parsedAgentName);
}

export function resolveConnectivityModelConfig(): AgentModelConfig {
  const runtime = getLlmRuntimeConfig();
  const env = getServerEnv();

  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    throw new LlmConfigurationError(
      "connectivity_live_calls_disabled",
      "Set LLM_PROVIDER=openai and LLM_LIVE_CALLS_ENABLED=true before running llm:connectivity."
    );
  }

  const activeApproval = resolveOperationalApprovalForModelResolution();
  if (activeApproval) {
    return resolveOpenAIModelConfigForRole("connectivity_test");
  }

  if (!configured(env.OPENAI_MODEL_CONNECTIVITY_TEST)) {
    throw new LlmConfigurationError(
      "connectivity_model_missing",
      "OPENAI_MODEL_CONNECTIVITY_TEST is required for llm:connectivity."
    );
  }

  const config: AgentModelConfig = {
    model_name: String(env.OPENAI_MODEL_CONNECTIVITY_TEST),
    reasoning_effort: env.OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST,
    max_output_tokens: 200
  };
  assertModelConfigCompatible("connectivity_test", config);
  return config;
}

export function agentModelReadiness() {
  const activeApproval = resolveOperationalApprovalForModelResolution();
  if (activeApproval) {
    return Object.fromEntries(LiveModelRole.options.map((role) => {
      const config = approvedCandidateRoleConfig(activeApproval.manifest, role);
      const issues = modelConfigCompatibilityIssues(role, config);
      return [role, {
        role,
        model_configured: true,
        effective_model: config.model_name,
        reasoning_effort: config.reasoning_effort,
        max_output_tokens: config.max_output_tokens,
        model_env_key: roleEnvSources[role][0].model,
        reasoning_env_key: roleEnvSources[role][0].reasoning,
        approval_boundary: approvalBoundary(role),
        compatibility_status: issues.length === 0 ? "compatible" : "incompatible",
        compatibility_issues: issues,
        resolution_source: "active_approval_bundle"
      }];
    })) as Record<LiveModelRole, RoleModelReadiness>;
  }
  return Object.fromEntries(
    LiveModelRole.options.map((role) => {
      const env = getServerEnv();
      const source = resolveRoleSource(env, role);
      const configuredModel = source ? sourceModelValue(env, source) : null;
      const reasoning = source ? reasoningValue(env, source.reasoning) ?? null : null;
      const maxTokens = source ? numberValue(env, maxTokensKey(source)) ?? source.defaultMaxTokens ?? null : null;
      const compatibilityIssues = configuredModel
        ? modelConfigCompatibilityIssues(role, {
            model_name: configuredModel,
            reasoning_effort: reasoning ?? undefined,
            max_output_tokens: maxTokens ?? undefined
          })
        : [];

      return [
        role,
        {
          role,
          model_configured: Boolean(configuredModel),
          effective_model: configuredModel,
          reasoning_effort: reasoning,
          max_output_tokens: maxTokens,
          model_env_key: source?.model ?? null,
          reasoning_env_key: source?.reasoning ?? null,
          approval_boundary: approvalBoundary(role),
          compatibility_status: configuredModel
            ? compatibilityIssues.length === 0 ? "compatible" : "incompatible"
            : "not_configured",
          compatibility_issues: compatibilityIssues,
          resolution_source: "environment"
        }
      ];
    })
  ) as Record<LiveModelRole, RoleModelReadiness>;
}

export function resolveOperationalRoleLiveCallsEnabled(
  role: "student_communication_agent" | "topic_dialogue_agent"
) {
  const activeApproval = resolveOperationalApprovalForModelResolution();
  if (activeApproval) {
    assertRuntimePolicyEnvironmentMatches(activeApproval);
    return activeApproval.manifest.runtime_policy.role_live_toggles[role];
  }
  const env = getServerEnv();
  return role === "student_communication_agent"
    ? env.STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED
    : env.TOPIC_DIALOGUE_LIVE_CALLS_ENABLED;
}

export function resolveTopicDialogueRuntimePolicy(
  options: { require_environment_match?: boolean } = {}
) {
  const activeApproval = resolveOperationalApprovalForModelResolution({
    require_approved_hash_match: options.require_environment_match !== false
  });
  if (activeApproval) {
    if (options.require_environment_match !== false) {
      assertRuntimePolicyEnvironmentMatches(activeApproval);
    }
    const policy = activeApproval.manifest.runtime_policy.topic_dialogue_policy;
    return {
      maximum_student_turns: policy.maximum_student_turns,
      recent_turn_window: policy.recent_raw_turn_window,
      maximum_student_message_chars: policy.maximum_student_message_characters,
      allow_assessment_system_questions: policy.assessment_system_questions_allowed
    };
  }
  const env = getServerEnv();
  return {
    maximum_student_turns: env.TOPIC_DIALOGUE_MAX_STUDENT_TURNS,
    recent_turn_window: env.TOPIC_DIALOGUE_RECENT_TURN_WINDOW,
    maximum_student_message_chars: env.TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS,
    allow_assessment_system_questions: env.TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS
  };
}

export function legacyAgentEnvKeys() {
  return agentEnvKeys;
}

export function liveModelRoleEnvSources() {
  return roleEnvSources;
}

export function approvedRoleEnvironmentAssertions(manifest: ApprovedCandidateManifest) {
  const assertions: Record<string, string> = {};
  for (const role of LiveModelRole.options) {
    const source = roleEnvSources[role][0];
    const config = approvedCandidateRoleConfig(manifest, role);
    assertions[source.model] = config.model_name;
    assertions[source.reasoning] = config.reasoning_effort;
    if ("maxTokens" in source) assertions[source.maxTokens] = String(config.max_output_tokens);
  }
  const policy = manifest.runtime_policy;
  return {
    ...assertions,
    OPENAI_REQUEST_TIMEOUT_MS: String(policy.provider_timeout_ms),
    OPENAI_MAX_RETRIES: String(policy.provider_max_retries),
    STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED: String(policy.role_live_toggles.student_communication_agent),
    TOPIC_DIALOGUE_LIVE_CALLS_ENABLED: String(policy.role_live_toggles.topic_dialogue_agent),
    TOPIC_DIALOGUE_MAX_STUDENT_TURNS: String(policy.topic_dialogue_policy.maximum_student_turns),
    TOPIC_DIALOGUE_RECENT_TURN_WINDOW: String(policy.topic_dialogue_policy.recent_raw_turn_window),
    TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS: String(policy.topic_dialogue_policy.maximum_student_message_characters),
    TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS: String(
      policy.topic_dialogue_policy.assessment_system_questions_allowed
    )
  };
}
