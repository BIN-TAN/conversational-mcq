import type { AgentCall, StudentProfile } from "@prisma/client";
import { serializeDate } from "@/lib/services/teacher-review/serializers";

export type StudentProfileWithAgentCall = StudentProfile & {
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

export function serializeStudentProfileForTeacher(profile: StudentProfileWithAgentCall) {
  return {
    profile_type: profile.profile_type,
    ability_profile: profile.ability_profile,
    ability_pattern_flags: profile.ability_pattern_flags,
    engagement_profile: profile.engagement_profile,
    engagement_pattern_flags: profile.engagement_pattern_flags,
    integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
    integrated_profile_confidence: profile.integrated_profile_confidence,
    integrated_profile_rationale: profile.integrated_profile_rationale,
    evidence_sufficiency: profile.evidence_sufficiency,
    confidence_alignment: profile.confidence_alignment,
    independence_interpretability: profile.independence_interpretability,
    misconception_indicators: profile.misconception_indicators,
    item_level_evidence: profile.item_level_evidence,
    reasoning_quality_summary: profile.reasoning_quality_summary,
    engagement_summary: profile.engagement_summary,
    process_interpretation_cautions: profile.process_interpretation_cautions,
    profile_confidence: profile.profile_confidence,
    rationale: profile.rationale,
    recommended_next_evidence: profile.recommended_next_evidence,
    created_at: serializeDate(profile.created_at),
    based_on_agent_call: profile.based_on_agent_call
      ? {
          agent_name: profile.based_on_agent_call.agent_name,
          provider: profile.based_on_agent_call.provider,
          model_name: profile.based_on_agent_call.model_name,
          agent_version: profile.based_on_agent_call.agent_version,
          prompt_version: profile.based_on_agent_call.prompt_version,
          schema_version: profile.based_on_agent_call.schema_version,
          prompt_hash: profile.based_on_agent_call.prompt_hash,
          retry_count: profile.based_on_agent_call.retry_count,
          call_status: profile.based_on_agent_call.call_status,
          output_validated: profile.based_on_agent_call.output_validated,
          live_call_allowed: profile.based_on_agent_call.live_call_allowed,
          blocked_reason: profile.based_on_agent_call.blocked_reason,
          created_at: serializeDate(profile.based_on_agent_call.created_at),
          completed_at: serializeDate(profile.based_on_agent_call.completed_at)
        }
      : null
  };
}

export function serializeStudentProfileForStudent() {
  return {
    profile_available_to_student: false,
    message:
      "Your initial responses have been reviewed. The next support step is not available yet in this prototype."
  };
}
