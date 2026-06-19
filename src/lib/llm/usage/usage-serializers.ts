import { prisma } from "@/lib/db";
import { AgentName } from "@/lib/agents/names";
import { getLlmUsageLimitConfig } from "./usage-limits";
import { getLlmUsageSnapshot, getUsageWindow } from "./usage-accounting";
import { LlmUsageGuardBlockedReason } from "./usage-guard";

function decimalToNumber(value: { toString(): string } | null) {
  return value === null ? null : Number(value.toString());
}

export async function getTeacherLlmUsageStatus() {
  const limits = getLlmUsageLimitConfig();
  const window = getUsageWindow(new Date(), limits.usage_timezone);
  const [usageSnapshot, recentCalls, dailyCalls] = await Promise.all([
    getLlmUsageSnapshot({ agent_name: "response_collection_agent" }),
    prisma.agentCall.findMany({
      orderBy: { created_at: "desc" },
      take: 20,
      select: {
        created_at: true,
        completed_at: true,
        agent_name: true,
        provider: true,
        model_name: true,
        call_status: true,
        blocked_reason: true,
        live_call_allowed: true,
        retry_count: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true,
        estimated_cost: true,
        error_category: true,
        latency_ms: true
      }
    }),
    prisma.agentCall.findMany({
      where: {
        created_at: {
          gte: window.start,
          lt: window.end
        }
      },
      select: {
        agent_name: true,
        blocked_reason: true,
        retry_count: true,
        call_status: true,
        error_category: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true
      }
    })
  ]);
  const blockedReasons = Object.fromEntries(
    LlmUsageGuardBlockedReason.options.map((reason) => [
      reason,
      dailyCalls.filter((call) => call.blocked_reason === reason).length
    ])
  );
  const perAgentAllProviders = Object.fromEntries(
    AgentName.options.map((agentName) => {
      const rows = dailyCalls.filter((call) => call.agent_name === agentName);

      return [
        agentName,
        {
          call_count: rows.length,
          input_tokens: rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
          output_tokens: rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
          total_tokens: rows.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0)
        }
      ];
    })
  );

  return {
    limits,
    current_usage: usageSnapshot,
    per_agent_all_provider_counts_today: perAgentAllProviders,
    blocked_calls_today_by_reason: blockedReasons,
    retry_count_today: dailyCalls.filter((call) => call.retry_count > 0).length,
    failed_call_count_today: dailyCalls.filter((call) => call.call_status === "failed").length,
    validation_failure_count_today: dailyCalls.filter(
      (call) => call.error_category === "schema_validation" || call.call_status === "invalid_output"
    ).length,
    recent_agent_calls: recentCalls.map((call) => ({
      created_at: call.created_at.toISOString(),
      completed_at: call.completed_at?.toISOString() ?? null,
      agent_name: call.agent_name,
      provider: call.provider,
      model_name: call.model_name,
      call_status: call.call_status,
      blocked_reason: call.blocked_reason,
      live_call_allowed: call.live_call_allowed,
      retry_count: call.retry_count,
      input_tokens: call.input_tokens,
      output_tokens: call.output_tokens,
      total_tokens: call.total_tokens,
      estimated_cost_usd: decimalToNumber(call.estimated_cost),
      error_category: call.error_category,
      latency_ms: call.latency_ms
    }))
  };
}
