import { prisma } from "@/lib/db";
import { LiveModelRole } from "@/lib/llm/config";
import { toPrismaJson } from "@/lib/services/json";
import { checkLlmLiveCallReadiness, type LlmUsageGuardBlockedReason } from "./usage-guard";

export class LlmUsageBlockedError extends Error {
  constructor(public readonly reason: LlmUsageGuardBlockedReason, public readonly retryAfter?: string) {
    super("Learning support has reached its usage allowance. Your responses are saved.");
    this.name = "LlmUsageBlockedError";
  }
}

// The reserved call is excluded from its own allowance check, but other in-flight calls count.
export async function assertAgentCallUsageAllowed(agentCallId: string) {
  const call = await prisma.agentCall.findUniqueOrThrow({ where: { id: agentCallId } });
  if (call.provider !== "openai") return;
  if (call.call_status !== "started") throw new Error("usage_guard_requires_started_agent_call");
  const readiness = await checkLlmLiveCallReadiness({
    agent_name: LiveModelRole.parse(call.agent_name),
    assessment_session_db_id: call.assessment_session_db_id,
    exclude_agent_call_db_id: call.id,
    model_configured: Boolean(call.model_name?.trim())
  });
  if (!readiness.allowed) {
    await prisma.agentCall.update({
      where: { id: call.id },
      data: {
        call_status: "failed", live_call_allowed: false, output_validated: false,
        blocked_reason: readiness.reason, error_category: "usage_guard_blocked",
        usage_guard_snapshot: toPrismaJson(readiness), completed_at: new Date()
      }
    });
    throw new LlmUsageBlockedError(readiness.reason, readiness.retry_after);
  }
}
