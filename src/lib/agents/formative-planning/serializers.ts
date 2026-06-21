import type { AgentCall, FormativeDecision } from "@prisma/client";
import { serializeDate } from "@/lib/services/teacher-review/serializers";

export type FormativeDecisionWithAgentCall = FormativeDecision & {
  based_on_agent_call?: Pick<
    AgentCall,
    | "agent_name"
    | "provider"
    | "model_name"
    | "agent_version"
    | "prompt_version"
    | "schema_version"
    | "prompt_hash"
    | "retry_count"
    | "call_status"
    | "output_validated"
    | "live_call_allowed"
    | "blocked_reason"
    | "created_at"
    | "completed_at"
  > | null;
};

export function serializeFormativeDecisionForTeacher(
  decision: FormativeDecisionWithAgentCall
) {
  return {
    formative_value: decision.formative_value,
    formative_action_plan: decision.formative_action_plan,
    target_evidence: decision.target_evidence,
    success_criteria: decision.success_criteria,
    followup_prompt_constraints: decision.followup_prompt_constraints,
    profile_update_triggers: decision.profile_update_triggers,
    rationale: decision.rationale,
    mapping_followed: decision.mapping_followed,
    mapping_deviation_reason: decision.mapping_deviation_reason,
    created_at: serializeDate(decision.created_at),
    based_on_agent_call: decision.based_on_agent_call
      ? {
          agent_name: decision.based_on_agent_call.agent_name,
          provider: decision.based_on_agent_call.provider,
          model_name: decision.based_on_agent_call.model_name,
          agent_version: decision.based_on_agent_call.agent_version,
          prompt_version: decision.based_on_agent_call.prompt_version,
          schema_version: decision.based_on_agent_call.schema_version,
          prompt_hash: decision.based_on_agent_call.prompt_hash,
          retry_count: decision.based_on_agent_call.retry_count,
          call_status: decision.based_on_agent_call.call_status,
          output_validated: decision.based_on_agent_call.output_validated,
          live_call_allowed: decision.based_on_agent_call.live_call_allowed,
          blocked_reason: decision.based_on_agent_call.blocked_reason,
          created_at: serializeDate(decision.based_on_agent_call.created_at),
          completed_at: serializeDate(decision.based_on_agent_call.completed_at),
          mock_or_live:
            decision.based_on_agent_call.provider === "mock" ? "mock" : "live"
        }
      : null,
    mock_output_notice:
      decision.based_on_agent_call?.provider === "mock"
        ? "Mock provider output for infrastructure testing only; not validated educational guidance."
        : null
  };
}

export function serializeFormativeDecisionForStudent() {
  return {
    planning_available_to_student: false,
    message:
      "A support plan has been prepared. Interactive follow-up is not available yet in this prototype."
  };
}
