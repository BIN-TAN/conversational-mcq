import { getServerEnv } from "@/lib/env";

export type LlmUsageLimitConfig = {
  daily_class_call_limit: number;
  daily_class_token_limit: number;
  daily_student_call_limit: number;
  daily_student_token_limit: number;
  session_call_limit: number;
  session_token_limit: number;
  agent_call_limit_per_session: number;
  cost_warning_limit_usd: number | null;
  cost_hard_limit_usd: number | null;
  usage_timezone: string;
  cost_limits_enforced: boolean;
  cost_limit_policy: "disabled_without_pricing_registry";
};

export function getLlmUsageLimitConfig(): LlmUsageLimitConfig {
  const env = getServerEnv();

  return {
    daily_class_call_limit: env.LLM_DAILY_CLASS_CALL_LIMIT,
    daily_class_token_limit: env.LLM_DAILY_CLASS_TOKEN_LIMIT,
    daily_student_call_limit: env.LLM_DAILY_STUDENT_CALL_LIMIT,
    daily_student_token_limit: env.LLM_DAILY_STUDENT_TOKEN_LIMIT,
    session_call_limit: env.LLM_SESSION_CALL_LIMIT,
    session_token_limit: env.LLM_SESSION_TOKEN_LIMIT,
    agent_call_limit_per_session: env.LLM_AGENT_CALL_LIMIT_PER_SESSION,
    cost_warning_limit_usd: env.LLM_COST_WARNING_LIMIT_USD ?? null,
    cost_hard_limit_usd: env.LLM_COST_HARD_LIMIT_USD ?? null,
    usage_timezone: env.LLM_USAGE_TIMEZONE,
    cost_limits_enforced: false,
    cost_limit_policy: "disabled_without_pricing_registry"
  };
}
