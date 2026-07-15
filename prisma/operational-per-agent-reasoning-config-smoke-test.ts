import { loadEnvConfig } from "@next/env";
import {
  activeOperationalConfigHash,
  verifyApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import { getAuthEnv, safeParseServerEnv } from "../src/lib/env";
import {
  LlmConfigurationError,
  liveModelRoles,
  resolveOpenAIModelConfigForRole
} from "../src/lib/llm/config";

loadEnvConfig(process.cwd());

const envKeys = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_REASONING_EFFORT_ITEM_VERIFICATION",
  "OPENAI_REASONING_EFFORT_ITEM_ADMIN",
  "OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION",
  "OPENAI_REASONING_EFFORT_PROFILING",
  "OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION",
  "OPENAI_REASONING_EFFORT_PLANNING",
  "OPENAI_REASONING_EFFORT_FOLLOWUP",
  "OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION",
  "OPENAI_REASONING_EFFORT_MCQ_DIAGNOSTIC_AUTHORING",
  "OPENAI_REASONING_EFFORT_MCQ_FORMATTING",
  "OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST",
  "OPENAI_MODEL_ITEM_VERIFICATION",
  "OPENAI_MODEL_ITEM_ADMIN",
  "OPENAI_MODEL_RESPONSE_COLLECTION",
  "OPENAI_MODEL_PROFILING",
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP",
  "OPENAI_MODEL_STUDENT_COMMUNICATION",
  "OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING",
  "OPENAI_MODEL_MCQ_FORMATTING",
  "OPENAI_MODEL_CONNECTIVITY_TEST",
  "OPENAI_MAX_OUTPUT_TOKENS_ITEM_ADMIN",
  "OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION",
  "OPERATIONAL_AGENT_MODE",
  "OPERATIONAL_APPROVED_CONFIG_HASH",
  "OPERATIONAL_EFFECTIVE_RESULT_VERSION",
  "OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION"
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function withEnv<T>(values: Partial<Record<(typeof envKeys)[number], string | undefined>>, fn: () => T | Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const key of envKeys) {
    previous.set(key, process.env[key]);
  }
  for (const key of envKeys) {
    delete process.env[key];
  }
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/conversational_mcq_smoke";
  process.env.SESSION_SECRET = "phase31ad-smoke-session-secret-at-least-32-characters";
  process.env.OPERATIONAL_EFFECTIVE_RESULT_VERSION = "effective-system-eval-v2";
  process.env.OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION = "effective-validator-v1";
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const candidateEnv = {
  LLM_PROVIDER: "openai",
  LLM_LIVE_CALLS_ENABLED: "true",
  OPENAI_API_KEY: "sk-proj_synthetic_phase31ad_smoke_key_do_not_use",
  OPENAI_MODEL_ITEM_VERIFICATION: "gpt-5.6-terra",
  OPENAI_REASONING_EFFORT_ITEM_VERIFICATION: "medium",
  OPENAI_MODEL_ITEM_ADMIN: "gpt-5.6-luna",
  OPENAI_REASONING_EFFORT_ITEM_ADMIN: "low",
  OPENAI_MODEL_RESPONSE_COLLECTION: "gpt-5.6-luna",
  OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION: "low",
  OPENAI_MODEL_PROFILING: "gpt-5.6-terra",
  OPENAI_REASONING_EFFORT_PROFILING: "medium",
  OPENAI_MODEL_PROFILE_INTEGRATION: "gpt-5.6-terra",
  OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION: "medium",
  OPENAI_MODEL_PLANNING: "gpt-5.6-sol",
  OPENAI_REASONING_EFFORT_PLANNING: "medium",
  OPENAI_MODEL_FOLLOWUP: "gpt-5.6-sol",
  OPENAI_REASONING_EFFORT_FOLLOWUP: "medium",
  OPENAI_MODEL_STUDENT_COMMUNICATION: "gpt-5.6-terra",
  OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION: "low",
  OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION: "1600",
  OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING: "gpt-5.6-terra",
  OPENAI_REASONING_EFFORT_MCQ_DIAGNOSTIC_AUTHORING: "medium",
  OPENAI_MODEL_MCQ_FORMATTING: "gpt-5.6-luna",
  OPENAI_REASONING_EFFORT_MCQ_FORMATTING: "low",
  OPENAI_MODEL_CONNECTIVITY_TEST: "gpt-5.6-luna",
  OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST: "none"
} as const;

async function main() {
  await withEnv({}, () => {
    const auth = getAuthEnv();
    assert(auth.SESSION_SECRET.length >= 32, "Auth env should parse without optional LLM config.");
    const verification = verifyApprovedOperationalAgentConfig();
    assert(verification.valid, "Absent model/effort overrides should preserve the approved baseline.");
  });

  await withEnv(candidateEnv, () => {
    const parsed = safeParseServerEnv();
    assert(parsed.success, "Candidate effort variables should parse.");

    for (const role of liveModelRoles) {
      const config = resolveOpenAIModelConfigForRole(role);
      assert(config.model_name.startsWith("gpt-5.6-"), `${role} should resolve a candidate model.`);
      assert(config.reasoning_effort, `${role} should resolve reasoning effort.`);
    }

    const itemAdminConfig = resolveOpenAIModelConfigForRole("item_administration_tutor_agent");
    assert(itemAdminConfig.reasoning_effort === "low", "Item-admin effort should reach provider model config.");
    assert(itemAdminConfig.max_output_tokens === 1200, "Item-admin should preserve current token default.");
  });

  await withEnv({
    ...candidateEnv,
    OPENAI_REASONING_EFFORT_ITEM_ADMIN: "max"
  }, () => {
    let blocked = false;
    try {
      resolveOpenAIModelConfigForRole("item_administration_tutor_agent");
    } catch (error) {
      blocked = error instanceof LlmConfigurationError &&
        error.code === "agent_model_config_incompatible";
    }
    assert(blocked, "Unsupported model/effort combination should fail closed.");
  });

  await withEnv({
    OPENAI_REASONING_EFFORT_PLANNING: "minimal"
  }, () => {
    const parsed = safeParseServerEnv();
    assert(!parsed.success, "Legacy minimal reasoning effort should be rejected.");
    assert(
      parsed.success === false &&
      parsed.error.issues.some((issue) => issue.path === "OPENAI_REASONING_EFFORT_PLANNING"),
      "Invalid effort should produce a safe typed environment issue."
    );
    assert(getAuthEnv().SESSION_SECRET.length >= 32, "Auth env should remain available with invalid optional LLM config.");
  });

  await withEnv({}, () => {
    const baselineHash = activeOperationalConfigHash();
    process.env.OPENAI_API_KEY = "sk-proj_different_synthetic_hash_test_key";
    const hashWithKey = activeOperationalConfigHash();
    assert(baselineHash === hashWithKey, "API keys must not affect the active operational hash.");
    process.env.OPENAI_MODEL_FOLLOWUP = "gpt-5.6-sol";
    process.env.OPENAI_REASONING_EFFORT_FOLLOWUP = "medium";
    const hashWithOverride = activeOperationalConfigHash();
    assert(hashWithOverride !== baselineHash, "Explicit non-baseline model/effort override should alter active hash.");
  });

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    roles_checked: liveModelRoles.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
