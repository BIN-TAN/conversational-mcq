import { createHash } from "node:crypto";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { AgentName } from "@/lib/agents/names";
import { getServerEnv } from "@/lib/env";

export const EVAL_CANARY_MODEL_SNAPSHOT = "gpt-5.4-mini-2026-03-17";
export const EVAL_CANARY_REASONING_EFFORT = "low";
export const EVAL_CANARY_CASES_PER_AGENT = 5;
export const EVAL_CANARY_REPETITIONS = 1;
export const EVAL_CANARY_TOTAL_ITEMS = 25;
export const EVAL_CANARY_AGENT_ORDER = AgentName.options;
export const EVAL_CANARY_PHASE = "phase7e2a";

export type CanaryConfigIssue = {
  code: string;
  message: string;
};

export type CanaryOutputTokenLimits = Record<AgentNameType, number>;

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

export function sha256Json(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function getEvalCanaryOutputTokenLimits(): CanaryOutputTokenLimits {
  const env = getServerEnv();

  return {
    item_verification_agent: env.EVAL_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION,
    response_collection_agent: env.EVAL_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION,
    student_profiling_agent: env.EVAL_MAX_OUTPUT_TOKENS_PROFILING,
    formative_value_and_planning_agent: env.EVAL_MAX_OUTPUT_TOKENS_PLANNING,
    followup_agent: env.EVAL_MAX_OUTPUT_TOKENS_FOLLOWUP
  };
}

export function evalCanaryConfigSnapshot() {
  const env = getServerEnv();
  const maxOutputTokens = getEvalCanaryOutputTokenLimits();

  return {
    phase: EVAL_CANARY_PHASE,
    provider: env.EVAL_PROVIDER,
    live_calls_enabled: env.EVAL_LIVE_CALLS_ENABLED,
    api_key_configured: configured(env.OPENAI_API_KEY),
    model_snapshot: env.EVAL_TARGET_MODEL,
    required_model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
    reasoning_effort: env.EVAL_REASONING_EFFORT,
    repetition_count: env.EVAL_CANARY_REPETITIONS,
    cases_per_agent: env.EVAL_CANARY_CASES_PER_AGENT,
    planned_run_item_count: EVAL_CANARY_TOTAL_ITEMS,
    cost_hard_limit_usd: env.EVAL_COST_HARD_LIMIT_USD,
    max_concurrency: env.EVAL_MAX_CONCURRENCY,
    max_retries: env.EVAL_MAX_RETRIES,
    request_timeout_ms: env.EVAL_REQUEST_TIMEOUT_MS,
    max_provider_requests: env.EVAL_MAX_PROVIDER_REQUESTS,
    max_output_tokens_by_agent: maxOutputTokens,
    classroom_provider: env.LLM_PROVIDER,
    classroom_live_calls_enabled: env.LLM_LIVE_CALLS_ENABLED
  };
}

export function validateEvalCanaryConfig(input: {
  requireLiveEnabled?: boolean;
  requireApiKey?: boolean;
} = {}) {
  const snapshot = evalCanaryConfigSnapshot();
  const issues: CanaryConfigIssue[] = [];

  if (snapshot.provider !== "openai") {
    issues.push({
      code: "eval_provider_not_openai",
      message: "EVAL_PROVIDER=openai is required for the paid live canary."
    });
  }

  if (input.requireLiveEnabled && !snapshot.live_calls_enabled) {
    issues.push({
      code: "eval_live_calls_disabled",
      message: "EVAL_LIVE_CALLS_ENABLED=true is required for the paid live canary."
    });
  }

  if (input.requireApiKey && !snapshot.api_key_configured) {
    issues.push({
      code: "openai_key_missing",
      message: "OPENAI_API_KEY must be configured locally before the paid live canary."
    });
  }

  if (snapshot.model_snapshot !== EVAL_CANARY_MODEL_SNAPSHOT) {
    issues.push({
      code: "invalid_model_snapshot",
      message: `EVAL_TARGET_MODEL must be exactly ${EVAL_CANARY_MODEL_SNAPSHOT}.`
    });
  }

  if (snapshot.model_snapshot === "gpt-5.4-mini") {
    issues.push({
      code: "alias_model_rejected",
      message: "The Phase 7E2A canary rejects the gpt-5.4-mini alias; use the exact snapshot."
    });
  }

  if (/gpt-5\.5/i.test(snapshot.model_snapshot)) {
    issues.push({
      code: "gpt_5_5_rejected",
      message: "Phase 7E2A does not compare or run GPT-5.5."
    });
  }

  if (/nano/i.test(snapshot.model_snapshot)) {
    issues.push({
      code: "nano_rejected",
      message: "Phase 7E2A does not compare or run nano models."
    });
  }

  if (snapshot.reasoning_effort !== EVAL_CANARY_REASONING_EFFORT) {
    issues.push({
      code: "invalid_reasoning_effort",
      message: "EVAL_REASONING_EFFORT must be low for Phase 7E2A."
    });
  }

  if (snapshot.repetition_count !== EVAL_CANARY_REPETITIONS) {
    issues.push({
      code: "invalid_repetition_count",
      message: "EVAL_CANARY_REPETITIONS must be 1 for Phase 7E2A."
    });
  }

  if (snapshot.cases_per_agent !== EVAL_CANARY_CASES_PER_AGENT) {
    issues.push({
      code: "invalid_cases_per_agent",
      message: "EVAL_CANARY_CASES_PER_AGENT must be 5 for Phase 7E2A."
    });
  }

  if (snapshot.max_concurrency !== 1) {
    issues.push({
      code: "invalid_concurrency",
      message: "EVAL_MAX_CONCURRENCY must be 1 for the Phase 7E2A canary."
    });
  }

  if (snapshot.max_retries !== 1) {
    issues.push({
      code: "invalid_retry_count",
      message: "EVAL_MAX_RETRIES must be 1 for the Phase 7E2A canary."
    });
  }

  if (snapshot.max_provider_requests > 50) {
    issues.push({
      code: "provider_request_limit_too_high",
      message: "EVAL_MAX_PROVIDER_REQUESTS must not exceed 50 for Phase 7E2A."
    });
  }

  if (snapshot.classroom_provider !== "mock" || snapshot.classroom_live_calls_enabled) {
    issues.push({
      code: "classroom_live_calls_not_mocked",
      message: "Classroom LLM settings must remain LLM_PROVIDER=mock and LLM_LIVE_CALLS_ENABLED=false."
    });
  }

  for (const [agentName, maxOutputTokens] of Object.entries(snapshot.max_output_tokens_by_agent)) {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      issues.push({
        code: "invalid_max_output_tokens",
        message: `Max output tokens for ${agentName} must be a positive integer.`
      });
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    snapshot,
    config_hash: sha256Json(snapshot)
  };
}
