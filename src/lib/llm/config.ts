import { z } from "zod";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import { getServerEnv } from "@/lib/env";
import { resolveOpenAICredentialFromEnv } from "@/lib/llm/openai-credential-resolver";

export const ReasoningEffort = z.enum(["none", "minimal", "low", "medium", "high"]);
export const Verbosity = z.enum(["low", "medium", "high"]);

export type ReasoningEffort = z.infer<typeof ReasoningEffort>;
export type Verbosity = z.infer<typeof Verbosity>;

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

  return {
    provider,
    live_calls_enabled: liveCallsEnabled,
    openai_key_configured: openaiKeyConfigured,
    request_timeout_ms: env.OPENAI_REQUEST_TIMEOUT_MS,
    max_retries: env.OPENAI_MAX_RETRIES
  };
}

export function resolveAgentModelConfig(agentName: AgentNameType): AgentModelConfig {
  const parsedAgentName = AgentName.parse(agentName);
  const runtime = getLlmRuntimeConfig();
  const env = getServerEnv();
  const keys = agentEnvKeys[parsedAgentName];

  if (runtime.provider === "mock") {
    return {
      model_name: `mock-${parsedAgentName}`
    };
  }

  const modelName = env[keys.model];

  if (!configured(typeof modelName === "string" ? modelName : undefined)) {
    throw new LlmConfigurationError(
      "agent_model_missing",
      `Model name is required for ${parsedAgentName} when OpenAI live calls are enabled.`,
      { agent_name: parsedAgentName }
    );
  }

  const reasoningEffort = env[keys.reasoning] as ReasoningEffort | undefined;
  const maxOutputTokens = env[keys.maxTokens] as number | undefined;

  return {
    model_name: String(modelName),
    reasoning_effort: reasoningEffort,
    max_output_tokens: maxOutputTokens
  };
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

  if (!configured(env.OPENAI_MODEL_CONNECTIVITY_TEST)) {
    throw new LlmConfigurationError(
      "connectivity_model_missing",
      "OPENAI_MODEL_CONNECTIVITY_TEST is required for llm:connectivity."
    );
  }

  return {
    model_name: String(env.OPENAI_MODEL_CONNECTIVITY_TEST),
    max_output_tokens: 200
  };
}

export function agentModelReadiness() {
  return Object.fromEntries(
    AgentName.options.map((agentName) => {
      const keys = agentEnvKeys[agentName];
      const env = getServerEnv();
      const model = env[keys.model];

      return [
        agentName,
        {
          model_configured: configured(typeof model === "string" ? model : undefined)
        }
      ];
    })
  ) as Record<AgentNameType, { model_configured: boolean }>;
}
