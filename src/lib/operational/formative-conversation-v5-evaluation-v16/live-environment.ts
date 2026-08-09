import { accessSync, constants, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  approvedCandidateRoleConfigResolution,
  approvedCandidateRoleLiveCallsEnabled,
  resolveActiveOperationalApproval
} from "@/lib/operational/active-approval-bundle";
import { guardedOperationalAgentIntegrationConfig } from "@/lib/operational/guarded-agent-integration";
import { stableHash } from "@/lib/operational/stable-hash";
import { safeParseServerEnv } from "@/lib/env";
import {
  getLlmRuntimeConfig,
  resolveOpenAIModelConfigForRole,
  resolveOperationalRoleLiveCallsEnabled
} from "@/lib/llm/config";
import { resolveOpenAICredentialFromEnv } from "@/lib/llm/openai-credential-resolver";

export const FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION =
  "formative-conversation-v16-live-environment-parity-v1";
export const FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION =
  "formative-conversation-v5-canonical-node-import-tsx-launcher-v2";
export const FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM =
  "node --import tsx";
export const FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION =
  "formative-conversation-v5-canonical-node-import-tsx-v1";

export const FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT = [
  "NODE_ENV",
  "APP_ENV",
  "APP_BASE_URL",
  "DATABASE_URL",
  "SESSION_SECRET",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_FORMATIVE_CONVERSATION",
  "OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION",
  "OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION",
  "FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED",
  "OPENAI_REQUEST_TIMEOUT_MS",
  "OPENAI_MAX_RETRIES",
  "OPERATIONAL_AGENT_MODE",
  "OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED",
  "OPERATIONAL_APPROVED_CONFIG_HASH",
  "OPERATIONAL_APPROVAL_BUNDLE_PATH",
  "OPERATIONAL_APPROVED_MANIFEST_PATH",
  "OPERATIONAL_APPROVAL_EVIDENCE_PATH",
  "OPERATIONAL_EFFECTIVE_RESULT_VERSION",
  "OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION",
  "STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED",
  "TOPIC_DIALOGUE_LIVE_CALLS_ENABLED",
  "TOPIC_DIALOGUE_MAX_STUDENT_TURNS",
  "TOPIC_DIALOGUE_RECENT_TURN_WINDOW",
  "TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS",
  "TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS",
  "RESEARCH_PSEUDONYMIZATION_KEY",
  "FORMATIVE_CONVERSATION_V5_V16_CANONICAL_SERVICE_NAME",
  "FORMATIVE_CONVERSATION_V5_V16_MIGRATIONS_CURRENT",
  "FORMATIVE_CONVERSATION_V5_V16_LIVE_EVALUATION_ENABLED",
  "FORMATIVE_CONVERSATION_V5_V16_DATABASE_CONNECTION_SOURCE",
  "FORMATIVE_CONVERSATION_V5_V16_DATABASE_IDENTITY_MATCHED",
  "FORMATIVE_CONVERSATION_V5_V16_CANONICAL_LAUNCHER_VALIDATED",
  "FORMATIVE_CONVERSATION_V5_V16_CANONICAL_LOADER_VERSION"
] as const;

export const FORMATIVE_CONVERSATION_V16_DATABASE_CANARY_REQUIRED_ENVIRONMENT = [
  ...FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT.filter(
    (name) =>
      name !== "OPENAI_API_KEY" &&
      name !==
        "FORMATIVE_CONVERSATION_V5_V16_LIVE_EVALUATION_ENABLED"
  ),
  "OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED",
  "FORMATIVE_CONVERSATION_V5_V16_CANARY_SESSION_SECRET_SOURCE",
  "FORMATIVE_CONVERSATION_V5_V16_REMOTE_DATABASE_CANARY_ENABLED"
] as const;

export const FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_FILE",
  "RESEARCH_PSEUDONYMIZATION_KEY"
] as const;

type CandidateConfiguration = {
  roles: {
    formative_conversation_agent?: {
      model_name: string;
      reasoning_effort:
        | "none"
        | "low"
        | "medium"
        | "high"
        | "xhigh"
        | "max";
      max_output_tokens: number;
    };
  };
  runtime_policy?: {
    provider_timeout_ms: number;
    provider_max_retries?: number;
    role_live_toggles: {
      student_communication_agent: boolean;
      topic_dialogue_agent: boolean;
      formative_conversation_agent?: boolean;
    };
    topic_dialogue_policy: {
      maximum_student_turns: number;
      recent_raw_turn_window: number;
      maximum_student_message_characters: number;
      assessment_system_questions_allowed: boolean;
    };
  };
};

type ValidationInput = {
  env: NodeJS.ProcessEnv;
  candidate: CandidateConfiguration;
  runtime_candidate_hash: string;
  expected_active_runtime_hash: string;
  expected_rollback_runtime_hash: string;
  allowed_environment_sources?: readonly string[];
  validation_purpose?:
    | "live_provider_evaluation"
    | "no_provider_database_canary";
};

function assertCondition(
  condition: unknown,
  code: string
): asserts condition {
  if (!condition) {
    throw new Error(code);
  }
}

function configured(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function fileSha256(filePath: string) {
  return createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex");
}

function parseInjectedEnvironmentKeys(env: NodeJS.ProcessEnv) {
  const value =
    env.FORMATIVE_CONVERSATION_V5_V16_INJECTED_ENVIRONMENT_KEYS;
  assertCondition(
    configured(value),
    "formative_conversation_v5_injected_environment_manifest_missing"
  );
  return new Set(
    String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function requireInjectedEnvironment(
  env: NodeJS.ProcessEnv,
  required: readonly string[]
) {
  const injected = parseInjectedEnvironmentKeys(env);
  for (const name of required) {
    assertCondition(
      injected.has(name) && configured(env[name]),
      `formative_conversation_v5_required_environment_missing:${name}`
    );
  }
  return injected;
}

function requireExactString(
  env: NodeJS.ProcessEnv,
  name: string,
  expected: string
) {
  assertCondition(
    env[name] === expected,
    `formative_conversation_v5_environment_value_mismatch:${name}`
  );
}

function requireExactNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  expected: number
) {
  assertCondition(
    Number(env[name]) === expected,
    `formative_conversation_v5_environment_value_mismatch:${name}`
  );
}

function requireExactBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  expected: boolean
) {
  requireExactString(env, name, expected ? "true" : "false");
}

function assertReadable(filePath: string, code: string) {
  try {
    accessSync(filePath, constants.R_OK);
  } catch {
    throw new Error(code);
  }
}

export function validateFormativeConversationV5LiveEnvironment(
  input: ValidationInput
) {
  const { env } = input;
  const validationPurpose =
    input.validation_purpose ?? "live_provider_evaluation";
  const noProviderDatabaseCanary =
    validationPurpose === "no_provider_database_canary";
  const requiredEnvironment = noProviderDatabaseCanary
    ? FORMATIVE_CONVERSATION_V16_DATABASE_CANARY_REQUIRED_ENVIRONMENT
    : FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT;
  const injected = requireInjectedEnvironment(env, requiredEnvironment);
  const environmentSource =
    env.FORMATIVE_CONVERSATION_V5_V16_ENVIRONMENT_SOURCE;
  const allowedSources =
    input.allowed_environment_sources ?? [
      "render_process_local",
      "render_runtime",
      "deterministic_test"
    ];
  assertCondition(
    configured(environmentSource) &&
      allowedSources.includes(String(environmentSource)),
    "formative_conversation_v5_environment_source_invalid"
  );
  requireExactString(
    env,
    "FORMATIVE_CONVERSATION_V5_V16_LAUNCHER_VERSION",
    FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION
  );
  requireExactString(
    env,
    "FORMATIVE_CONVERSATION_V5_V16_LAUNCH_MECHANISM",
    FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM
  );
  requireExactBoolean(
    env,
    "FORMATIVE_CONVERSATION_V5_V16_CANONICAL_LAUNCHER_VALIDATED",
    true
  );
  requireExactString(
    env,
    "FORMATIVE_CONVERSATION_V5_V16_CANONICAL_LOADER_VERSION",
    FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION
  );
  const databaseConnectionSource =
    env.FORMATIVE_CONVERSATION_V5_V16_DATABASE_CONNECTION_SOURCE;
  assertCondition(
    databaseConnectionSource === "render_internal" ||
      databaseConnectionSource ===
        "render_external_process_local" ||
      databaseConnectionSource === "deterministic_test",
    "formative_conversation_v5_database_connection_source_invalid"
  );
  requireExactBoolean(
    env,
    "FORMATIVE_CONVERSATION_V5_V16_DATABASE_IDENTITY_MATCHED",
    true
  );

  const parsedEnv = noProviderDatabaseCanary
    ? null
    : safeParseServerEnv(env);
  assertCondition(
    noProviderDatabaseCanary || parsedEnv?.success,
    "formative_conversation_v5_server_environment_invalid"
  );
  requireExactString(env, "NODE_ENV", "production");
  requireExactString(env, "APP_ENV", "production");
  requireExactString(
    env,
    "FORMATIVE_CONVERSATION_V5_V16_CANONICAL_SERVICE_NAME",
    "conversational-mcq"
  );
  assertCondition(
    env.FORMATIVE_CONVERSATION_V5_V16_CANONICAL_SERVICE_NAME !==
      "conversational-mcq-staging",
    "formative_conversation_v16_deprecated_service_forbidden"
  );
  requireExactBoolean(
    env,
    "FORMATIVE_CONVERSATION_V5_V16_MIGRATIONS_CURRENT",
    true
  );
  requireExactString(env, "LLM_PROVIDER", "openai");
  requireExactBoolean(env, "LLM_LIVE_CALLS_ENABLED", true);
  requireExactString(env, "OPERATIONAL_AGENT_MODE", "guarded_live");
  requireExactBoolean(
    env,
    "OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED",
    true
  );
  if (noProviderDatabaseCanary) {
    requireExactBoolean(
      env,
      "FORMATIVE_CONVERSATION_V5_V16_REMOTE_DATABASE_CANARY_ENABLED",
      true
    );
    assertCondition(
      !injected.has("OPENAI_API_KEY") &&
        !injected.has("OPENAI_API_KEY_FILE") &&
        !configured(env.OPENAI_API_KEY) &&
        !configured(env.OPENAI_API_KEY_FILE) &&
        configured(env.SESSION_SECRET),
      "formative_conversation_v16_canary_provider_credential_injected"
    );
    requireExactString(
      env,
      "FORMATIVE_CONVERSATION_V5_V16_CANARY_SESSION_SECRET_SOURCE",
      "ephemeral_canary"
    );
  } else {
    requireExactBoolean(
      env,
      "FORMATIVE_CONVERSATION_V5_V16_LIVE_EVALUATION_ENABLED",
      true
    );
  }
  requireExactString(
    env,
    "OPERATIONAL_EFFECTIVE_RESULT_VERSION",
    "effective-system-eval-v2"
  );
  requireExactString(
    env,
    "OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION",
    "effective-validator-v1"
  );

  const active = resolveActiveOperationalApproval({ env });
  assertCondition(
    active?.kind === "derived_approval",
    "formative_conversation_v5_active_approval_unavailable"
  );
  assertCondition(
    env.OPERATIONAL_APPROVED_CONFIG_HASH ===
      active.record.runtime_candidate_hash,
    "formative_conversation_v5_active_approval_hash_mismatch"
  );
  assertCondition(
    active.record.runtime_candidate_hash ===
      input.expected_active_runtime_hash,
    "formative_conversation_v5_unexpected_active_approval_hash"
  );
  assertCondition(
    active.record.rollback.approved_runtime_hash ===
      input.expected_rollback_runtime_hash,
    "formative_conversation_v5_rollback_runtime_hash_mismatch"
  );
  assertCondition(
    active.record.runtime_candidate_hash !==
      input.runtime_candidate_hash,
    "formative_conversation_v5_active_candidate_identity_conflated"
  );
  assertReadable(
    active.bundle_path,
    "formative_conversation_v5_active_bundle_unreadable"
  );
  assertReadable(
    active.manifest_path,
    "formative_conversation_v5_active_manifest_unreadable"
  );
  assertReadable(
    active.approval_evidence_path,
    "formative_conversation_v5_active_evidence_unreadable"
  );

  const role = input.candidate.roles.formative_conversation_agent;
  const policy = input.candidate.runtime_policy;
  assertCondition(
    role && policy,
    "formative_conversation_v5_candidate_runtime_configuration_missing"
  );
  const providerMaxRetries = policy.provider_max_retries ?? 2;
  requireExactString(
    env,
    "OPENAI_MODEL_FORMATIVE_CONVERSATION",
    role.model_name
  );
  requireExactString(
    env,
    "OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION",
    role.reasoning_effort
  );
  requireExactNumber(
    env,
    "OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION",
    role.max_output_tokens
  );
  requireExactBoolean(
    env,
    "FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED",
    policy.role_live_toggles.formative_conversation_agent === true
  );
  requireExactBoolean(
    env,
    "STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED",
    policy.role_live_toggles.student_communication_agent
  );
  requireExactBoolean(
    env,
    "TOPIC_DIALOGUE_LIVE_CALLS_ENABLED",
    policy.role_live_toggles.topic_dialogue_agent
  );
  requireExactNumber(
    env,
    "OPENAI_REQUEST_TIMEOUT_MS",
    policy.provider_timeout_ms
  );
  requireExactNumber(
    env,
    "OPENAI_MAX_RETRIES",
    providerMaxRetries
  );
  requireExactNumber(
    env,
    "TOPIC_DIALOGUE_MAX_STUDENT_TURNS",
    policy.topic_dialogue_policy.maximum_student_turns
  );
  requireExactNumber(
    env,
    "TOPIC_DIALOGUE_RECENT_TURN_WINDOW",
    policy.topic_dialogue_policy.recent_raw_turn_window
  );
  requireExactNumber(
    env,
    "TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS",
    policy.topic_dialogue_policy.maximum_student_message_characters
  );
  requireExactBoolean(
    env,
    "TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS",
    policy.topic_dialogue_policy.assessment_system_questions_allowed
  );

  const activeRole = approvedCandidateRoleConfigResolution(
    active.manifest,
    "formative_conversation_agent"
  );
  assertCondition(
    activeRole.config.model_name === role.model_name &&
      activeRole.config.reasoning_effort === role.reasoning_effort &&
      activeRole.config.max_output_tokens === role.max_output_tokens,
    "formative_conversation_v5_active_role_candidate_role_mismatch"
  );
  assertCondition(
    approvedCandidateRoleLiveCallsEnabled(
      active.manifest,
      "formative_conversation_agent"
    ) === true,
    "formative_conversation_v5_active_role_live_calls_unapproved"
  );

  if (!noProviderDatabaseCanary) {
    const credential = resolveOpenAICredentialFromEnv(env);
    if (!credential.ok) {
      throw new Error(
        `formative_conversation_v5_openai_credential_unavailable:${credential.code}`
      );
    }
  }
  assertCondition(
    configured(env.RESEARCH_PSEUDONYMIZATION_KEY),
    "formative_conversation_v5_research_key_unavailable"
  );
  assertCondition(
    configured(env.DATABASE_URL) &&
      configured(env.APP_BASE_URL) &&
      configured(env.SESSION_SECRET),
    "formative_conversation_v5_application_environment_incomplete"
  );

  const projectionUsed =
    env.FORMATIVE_CONVERSATION_V5_V16_APPROVAL_PATH_PROJECTION_USED ===
    "true";
  if (projectionUsed) {
    for (const sourceName of [
      "FORMATIVE_CONVERSATION_V5_V16_SOURCE_APPROVAL_BUNDLE_PATH",
      "FORMATIVE_CONVERSATION_V5_V16_SOURCE_APPROVED_MANIFEST_PATH",
      "FORMATIVE_CONVERSATION_V5_V16_SOURCE_APPROVAL_EVIDENCE_PATH"
    ]) {
      assertCondition(
        configured(env[sourceName]),
        `formative_conversation_v5_projection_source_missing:${sourceName}`
      );
    }
  }

  const safeSnapshot = {
    contract_version:
      FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
    validation_purpose: validationPurpose,
    environment_source: environmentSource,
    launcher: {
      version: FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
      mechanism: FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
      canonical_loader_version:
        FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
      cli_loaded_in_child_process: true
    },
    injected_environment_key_count: injected.size,
    required_environment_key_count:
      requiredEnvironment.length,
    approval_path_projection_used: projectionUsed,
    database_connection: {
      source: databaseConnectionSource,
      identity_matched: true,
      url_recorded: false,
      credential_recorded: false
    },
    canonical_service: {
      name: "conversational-mcq",
      deprecated_staging_forbidden: true,
      migrations_current: true
    },
    approval_artifact_sources: {
      bundle_path: projectionUsed
        ? env
            .FORMATIVE_CONVERSATION_V5_V16_SOURCE_APPROVAL_BUNDLE_PATH
        : active.bundle_path,
      manifest_path: projectionUsed
        ? env
            .FORMATIVE_CONVERSATION_V5_V16_SOURCE_APPROVED_MANIFEST_PATH
        : active.manifest_path,
      evidence_path: projectionUsed
        ? env
            .FORMATIVE_CONVERSATION_V5_V16_SOURCE_APPROVAL_EVIDENCE_PATH
        : active.approval_evidence_path
    },
    active_approval: {
      runtime_candidate_hash: active.record.runtime_candidate_hash,
      bundle_path: active.bundle_path,
      bundle_sha256: fileSha256(active.bundle_path),
      manifest_path: active.manifest_path,
      manifest_sha256: fileSha256(active.manifest_path),
      evidence_path: active.approval_evidence_path,
      evidence_sha256: fileSha256(active.approval_evidence_path),
      compatibility_role:
        activeRole.approved_role,
      compatibility_used: activeRole.compatibility_used
    },
    inactive_candidate: {
      runtime_candidate_hash: input.runtime_candidate_hash,
      separate_from_active_approval: true
    },
    rollback_runtime_hash:
      active.record.rollback.approved_runtime_hash,
    runtime_assertions: {
      provider: env.LLM_PROVIDER,
      live_calls_enabled: env.LLM_LIVE_CALLS_ENABLED === "true",
      operational_agent_mode: env.OPERATIONAL_AGENT_MODE,
      model_name: role.model_name,
      reasoning_effort: role.reasoning_effort,
      max_output_tokens: role.max_output_tokens,
      request_timeout_ms: policy.provider_timeout_ms,
      max_retries: providerMaxRetries,
      formative_conversation_live_calls_enabled: true,
      evaluation_evidence_required: true,
      live_evaluation_gate_enabled: noProviderDatabaseCanary
        ? false
        : true,
      provider_credential_required: !noProviderDatabaseCanary,
      provider_calls_permitted: !noProviderDatabaseCanary
    },
    secret_presence: {
      database_url: true,
      session_secret: true,
      session_secret_source: noProviderDatabaseCanary
        ? "ephemeral_canary"
        : "injected_runtime",
      openai_credential: !noProviderDatabaseCanary,
      research_pseudonymization_key: true
    },
    secrets_recorded: false,
    secret_fingerprints_recorded: false
  };

  return {
    ...safeSnapshot,
    environment_fingerprint: stableHash(safeSnapshot)
  };
}

export function resolveFormativeConversationV5ApplicationReadiness(
  input: ValidationInput
) {
  const environment =
    validateFormativeConversationV5LiveEnvironment(input);
  const llmRuntime = getLlmRuntimeConfig();
  const roleConfig = resolveOpenAIModelConfigForRole(
    "formative_conversation_agent"
  );
  const roleLiveCalls =
    resolveOperationalRoleLiveCallsEnabled(
      "formative_conversation_agent"
    );
  const operational =
    guardedOperationalAgentIntegrationConfig();

  assertCondition(
    llmRuntime.provider === "openai" &&
      llmRuntime.live_calls_enabled &&
      llmRuntime.openai_key_configured,
    "formative_conversation_v5_application_llm_runtime_unavailable"
  );
  assertCondition(
    roleConfig.model_name ===
      environment.runtime_assertions.model_name &&
      roleConfig.reasoning_effort ===
        environment.runtime_assertions.reasoning_effort &&
      roleConfig.max_output_tokens ===
        environment.runtime_assertions.max_output_tokens,
    "formative_conversation_v5_application_role_resolution_mismatch"
  );
  assertCondition(
    roleLiveCalls &&
      operational.configuration_valid &&
      operational.enabled &&
      operational.mode === "guarded_live" &&
      operational.provider === "openai" &&
      operational.live_calls_enabled &&
      operational.operational_approved_config_hash ===
        environment.active_approval.runtime_candidate_hash,
    "formative_conversation_v5_operational_readiness_failed"
  );

  return {
    ...environment,
    application_readiness: {
      llm_runtime_resolved: true,
      operational_integration_resolved: true,
      formative_conversation_role_resolved: true,
      formative_conversation_live_calls_approved: true,
      model_auth_network_requests: 0
    }
  };
}
