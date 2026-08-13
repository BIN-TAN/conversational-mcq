import { resolveActiveOperationalApproval } from "../../src/lib/operational/active-approval-bundle";
import { approvedRoleEnvironmentAssertions } from "../../src/lib/llm/config";
import {
  FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
  FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT
} from "../../src/lib/operational/formative-conversation-v5-evaluation-v18r1/live-environment";

export function buildFormativeConversationV5TestEnvironment(
  overrides: Record<string, string | undefined> = {}
) {
  const active = resolveActiveOperationalApproval();
  if (active?.kind !== "derived_approval") {
    throw new Error("formative_conversation_v5_test_active_approval_missing");
  }
  const assertions = approvedRoleEnvironmentAssertions(active.manifest);
  const env = {
    ...process.env,
    ...assertions,
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_BASE_URL: "https://example.invalid",
    SESSION_SECRET:
      "formative-conversation-v5-test-session-secret-000000000000",
    LLM_PROVIDER: "openai",
    LLM_LIVE_CALLS_ENABLED: "true",
    OPENAI_API_KEY:
      ["sk", "formativeconversationv18deterministictest000000"].join("-"),
    OPENAI_MODEL_PROFILING: "gpt-5.6-terra",
    OPENAI_REASONING_EFFORT_PROFILING: "medium",
    OPENAI_MAX_OUTPUT_TOKENS_PROFILING: "4000",
    OPENAI_MODEL_FORMATIVE_CONVERSATION: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION: "medium",
    OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION: "7000",
    FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "true",
    OPERATIONAL_AGENT_MODE: "guarded_live",
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: "true",
    OPERATIONAL_APPROVED_CONFIG_HASH: active.record.runtime_candidate_hash,
    OPERATIONAL_APPROVAL_BUNDLE_PATH: active.bundle_path,
    OPERATIONAL_APPROVED_MANIFEST_PATH: active.manifest_path,
    OPERATIONAL_APPROVAL_EVIDENCE_PATH: active.approval_evidence_path,
    OPERATIONAL_EFFECTIVE_RESULT_VERSION: "effective-system-eval-v2",
    OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: "effective-validator-v1",
    RESEARCH_PSEUDONYMIZATION_KEY:
      "formative-conversation-v5-test-research-key-000000000000",
    RENDER_GIT_COMMIT: "a".repeat(40),
    FORMATIVE_CONVERSATION_V5_V18R1_PROVENANCE_MODE:
      "render_deployed_artifact",
    FORMATIVE_CONVERSATION_V5_V18R1_CANONICAL_SERVICE_NAME:
      "conversational-mcq",
    FORMATIVE_CONVERSATION_V5_V18R1_MIGRATIONS_CURRENT: "true",
    FORMATIVE_CONVERSATION_V5_V18R1_LIVE_EVALUATION_ENABLED: "true",
    FORMATIVE_CONVERSATION_V5_V18R1_ENVIRONMENT_SOURCE: "deterministic_test",
    FORMATIVE_CONVERSATION_V5_V18R1_APPROVAL_PATH_PROJECTION_USED: "false",
    FORMATIVE_CONVERSATION_V5_V18R1_DATABASE_CONNECTION_SOURCE:
      "deterministic_test",
    FORMATIVE_CONVERSATION_V5_V18R1_DATABASE_IDENTITY_MATCHED: "true",
    FORMATIVE_CONVERSATION_V5_V18R1_LAUNCHER_VERSION:
      FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
    FORMATIVE_CONVERSATION_V5_V18R1_LAUNCH_MECHANISM:
      FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
    FORMATIVE_CONVERSATION_V5_V18R1_CANONICAL_LAUNCHER_VALIDATED: "true",
    FORMATIVE_CONVERSATION_V5_V18R1_CANONICAL_LOADER_VERSION:
      FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
    ...overrides
  } as NodeJS.ProcessEnv;
  delete env.OPENAI_API_KEY_FILE;
  delete env.OPERATIONAL_AGENT_INTEGRATION_ENABLED;
  env.FORMATIVE_CONVERSATION_V5_V18R1_INJECTED_ENVIRONMENT_KEYS = [
    ...new Set([
      ...Object.entries(env)
        .filter(([, value]) => Boolean(value?.trim()))
        .map(([name]) => name),
      ...FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT
    ])
  ]
    .sort()
    .join(",");
  return env;
}

export function installFormativeConversationV5TestEnvironment(
  overrides: Record<string, string | undefined> = {}
) {
  const original = { ...process.env };
  const env = buildFormativeConversationV5TestEnvironment(overrides);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  };
}
