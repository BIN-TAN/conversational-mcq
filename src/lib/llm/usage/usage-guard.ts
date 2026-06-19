import { z } from "zod";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import { getServerEnv } from "@/lib/env";
import { getLlmUsageLimitConfig } from "./usage-limits";
import { getLlmUsageSnapshot, type LlmUsageSnapshot } from "./usage-accounting";

export const LlmUsageGuardBlockedReason = z.enum([
  "student_daily_call_limit_exceeded",
  "student_daily_token_limit_exceeded",
  "session_call_limit_exceeded",
  "session_token_limit_exceeded",
  "agent_session_call_limit_exceeded",
  "class_daily_call_limit_exceeded",
  "class_daily_token_limit_exceeded",
  "cost_hard_limit_exceeded",
  "live_calls_disabled",
  "provider_not_configured",
  "model_not_configured"
]);

export type LlmUsageGuardBlockedReason = z.infer<typeof LlmUsageGuardBlockedReason>;

export type LlmUsageGuardResult =
  | {
      allowed: true;
      warnings: string[];
      usage_snapshot: LlmUsageSnapshot;
    }
  | {
      allowed: false;
      reason: LlmUsageGuardBlockedReason;
      usage_snapshot: LlmUsageSnapshot;
      retry_after?: string;
    };

export type LlmUsageGuardInput = {
  agent_name: AgentNameType;
  assessment_session_db_id?: string | null;
  model_configured?: boolean;
  now?: Date;
};

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function withBlock(
  reason: LlmUsageGuardBlockedReason,
  usageSnapshot: LlmUsageSnapshot,
  retryAfter?: string
): LlmUsageGuardResult {
  return {
    allowed: false,
    reason,
    usage_snapshot: usageSnapshot,
    retry_after: retryAfter
  };
}

export async function checkLlmLiveCallReadiness(input: LlmUsageGuardInput): Promise<LlmUsageGuardResult> {
  const agentName = AgentName.parse(input.agent_name);
  const env = getServerEnv();
  const limits = getLlmUsageLimitConfig();
  const usageSnapshot = await getLlmUsageSnapshot({
    agent_name: agentName,
    assessment_session_db_id: input.assessment_session_db_id ?? null,
    now: input.now
  });
  const retryAfter = usageSnapshot.window_end;

  if (env.LLM_PROVIDER !== "openai") {
    return withBlock("provider_not_configured", usageSnapshot);
  }

  if (!env.LLM_LIVE_CALLS_ENABLED) {
    return withBlock("live_calls_disabled", usageSnapshot);
  }

  if (!configured(env.OPENAI_API_KEY)) {
    return withBlock("provider_not_configured", usageSnapshot);
  }

  if (input.model_configured === false) {
    return withBlock("model_not_configured", usageSnapshot);
  }

  if (usageSnapshot.class_daily.call_count >= limits.daily_class_call_limit) {
    return withBlock("class_daily_call_limit_exceeded", usageSnapshot, retryAfter);
  }

  if (usageSnapshot.class_daily.total_tokens >= limits.daily_class_token_limit) {
    return withBlock("class_daily_token_limit_exceeded", usageSnapshot, retryAfter);
  }

  if (
    usageSnapshot.student_daily &&
    usageSnapshot.student_daily.call_count >= limits.daily_student_call_limit
  ) {
    return withBlock("student_daily_call_limit_exceeded", usageSnapshot, retryAfter);
  }

  if (
    usageSnapshot.student_daily &&
    usageSnapshot.student_daily.total_tokens >= limits.daily_student_token_limit
  ) {
    return withBlock("student_daily_token_limit_exceeded", usageSnapshot, retryAfter);
  }

  if (usageSnapshot.session && usageSnapshot.session.call_count >= limits.session_call_limit) {
    return withBlock("session_call_limit_exceeded", usageSnapshot);
  }

  if (usageSnapshot.session && usageSnapshot.session.total_tokens >= limits.session_token_limit) {
    return withBlock("session_token_limit_exceeded", usageSnapshot);
  }

  if (
    usageSnapshot.agent_session &&
    usageSnapshot.agent_session.call_count >= limits.agent_call_limit_per_session
  ) {
    return withBlock("agent_session_call_limit_exceeded", usageSnapshot);
  }

  if (
    limits.cost_hard_limit_usd !== null &&
    usageSnapshot.class_daily.cost_estimation_available &&
    usageSnapshot.class_daily.estimated_cost_usd !== null &&
    usageSnapshot.class_daily.estimated_cost_usd >= limits.cost_hard_limit_usd
  ) {
    return withBlock("cost_hard_limit_exceeded", usageSnapshot, retryAfter);
  }

  const warnings: string[] = [];

  if (
    (limits.cost_warning_limit_usd !== null || limits.cost_hard_limit_usd !== null) &&
    !usageSnapshot.class_daily.cost_estimation_available
  ) {
    warnings.push("cost_limits_configured_but_no_pricing_registry_or_estimated_cost");
  }

  if (
    limits.cost_warning_limit_usd !== null &&
    usageSnapshot.class_daily.cost_estimation_available &&
    usageSnapshot.class_daily.estimated_cost_usd !== null &&
    usageSnapshot.class_daily.estimated_cost_usd >= limits.cost_warning_limit_usd
  ) {
    warnings.push("cost_warning_limit_reached");
  }

  return {
    allowed: true,
    warnings,
    usage_snapshot: usageSnapshot
  };
}
