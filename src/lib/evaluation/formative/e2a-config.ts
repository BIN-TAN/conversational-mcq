import { createHash } from "node:crypto";
import {
  E2A_SIMULATOR_PROMPT_VERSION,
  E2A_SIMULATOR_SCHEMA_VERSION,
  E2ABudgetLimitsSchema,
  E2ASimulatorConfigurationSchema,
  type E2ABudgetLimits,
  type E2ASimulatorConfiguration
} from "./e2a-schemas";

export type E2AStage = "canary" | "full";

function requiredString(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`e2a_configuration_missing:${name}`);
  return value;
}

function strictBoolean(env: NodeJS.ProcessEnv, name: string, fallback = false) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`e2a_configuration_invalid:${name}:expected_true_or_false`);
}

function numberValue(input: {
  env: NodeJS.ProcessEnv;
  name: string;
  fallback: number;
  integer?: boolean;
  min: number;
  max?: number;
}) {
  const raw = input.env[input.name];
  const value = raw === undefined || raw === "" ? input.fallback : Number(raw);
  if (!Number.isFinite(value) || (input.integer && !Number.isInteger(value)) || value < input.min || (input.max !== undefined && value > input.max)) {
    throw new Error(`e2a_configuration_invalid:${input.name}`);
  }
  return value;
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function resolveE2ASimulatorConfiguration(
  env: NodeJS.ProcessEnv = process.env
): E2ASimulatorConfiguration {
  const unhashed = {
    simulator_enabled: strictBoolean(env, "EVAL_LLM_STUDENT_SIMULATOR_ENABLED"),
    model_name: requiredString(env, "EVAL_LLM_STUDENT_SIMULATOR_MODEL"),
    max_output_tokens: numberValue({ env, name: "EVAL_LLM_STUDENT_SIMULATOR_MAX_OUTPUT_TOKENS", fallback: 500, integer: true, min: 64, max: 2500 }),
    temperature: numberValue({ env, name: "EVAL_LLM_STUDENT_SIMULATOR_TEMPERATURE", fallback: 0.7, min: 0, max: 2 }),
    max_regeneration_attempts: numberValue({ env, name: "EVAL_LLM_STUDENT_SIMULATOR_MAX_RETRIES", fallback: 2, integer: true, min: 0, max: 2 }),
    timeout_ms: numberValue({ env, name: "EVAL_LLM_STUDENT_SIMULATOR_TIMEOUT_MS", fallback: 90_000, integer: true, min: 1000, max: 180_000 }),
    prompt_version: E2A_SIMULATOR_PROMPT_VERSION,
    schema_version: E2A_SIMULATOR_SCHEMA_VERSION
  };
  return E2ASimulatorConfigurationSchema.parse({
    ...unhashed,
    configuration_hash: stableHash(unhashed)
  });
}

const stageDefaults: Record<E2AStage, E2ABudgetLimits> = {
  canary: {
    maximum_sessions: 4,
    maximum_simulator_calls: 24,
    maximum_total_provider_calls: 150,
    maximum_total_input_tokens: 500_000,
    maximum_total_output_tokens: 100_000,
    maximum_cost_usd: 15
  },
  full: {
    maximum_sessions: 36,
    maximum_simulator_calls: 216,
    maximum_total_provider_calls: 1200,
    maximum_total_input_tokens: 5_000_000,
    maximum_total_output_tokens: 1_000_000,
    maximum_cost_usd: 100
  }
};

export function resolveE2ABudgetLimits(
  stage: E2AStage,
  env: NodeJS.ProcessEnv = process.env
): E2ABudgetLimits {
  const defaults = stageDefaults[stage];
  const capped = {
    maximum_sessions: Math.min(defaults.maximum_sessions, numberValue({ env, name: "EVAL_E2A_MAX_SESSIONS", fallback: defaults.maximum_sessions, integer: true, min: 1 })),
    maximum_simulator_calls: Math.min(defaults.maximum_simulator_calls, numberValue({ env, name: "EVAL_E2A_MAX_SIMULATOR_CALLS", fallback: defaults.maximum_simulator_calls, integer: true, min: 1 })),
    maximum_total_provider_calls: Math.min(defaults.maximum_total_provider_calls, numberValue({ env, name: "EVAL_E2A_MAX_TOTAL_PROVIDER_CALLS", fallback: defaults.maximum_total_provider_calls, integer: true, min: 1 })),
    maximum_total_input_tokens: Math.min(defaults.maximum_total_input_tokens, numberValue({ env, name: "EVAL_E2A_MAX_TOTAL_INPUT_TOKENS", fallback: defaults.maximum_total_input_tokens, integer: true, min: 1 })),
    maximum_total_output_tokens: Math.min(defaults.maximum_total_output_tokens, numberValue({ env, name: "EVAL_E2A_MAX_TOTAL_OUTPUT_TOKENS", fallback: defaults.maximum_total_output_tokens, integer: true, min: 1 })),
    maximum_cost_usd: Math.min(defaults.maximum_cost_usd, numberValue({ env, name: "EVAL_E2A_MAX_COST_USD", fallback: defaults.maximum_cost_usd, min: 0.01 }))
  };
  return E2ABudgetLimitsSchema.parse(capped);
}

export function assertE2ALiveOptIn(env: NodeJS.ProcessEnv = process.env) {
  if (env.EVAL_E2A_LIVE_PROVIDER !== "1") {
    throw new Error("e2a_live_provider_opt_in_required");
  }
  const configuration = resolveE2ASimulatorConfiguration(env);
  if (!configuration.simulator_enabled) {
    throw new Error("e2a_student_simulator_not_enabled");
  }
  return configuration;
}
