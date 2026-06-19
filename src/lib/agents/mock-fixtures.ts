import type { AgentName } from "./names";

const base = {
  agent_version: "6a-draft",
  prompt_version: "mock-prompt-v1",
  schema_version: "mock-schema-v1",
  output_status: "ok" as const,
  warnings: [] as string[]
};

export function mockOutputForAgent(agentName: AgentName) {
  switch (agentName) {
    case "item_preparation_agent":
      return {
        ...base,
        agent_name: agentName,
        normalized_concept_unit: {
          title: "Mock concept unit",
          teacher_review_required: true
        },
        normalized_items: [
          {
            item_order: 1,
            item_stem: "Mock item stem",
            options: [
              { label: "A", text: "Mock option A" },
              { label: "B", text: "Mock option B" }
            ]
          }
        ],
        item_quality_flags: ["teacher_review_required"],
        ambiguity_warnings: [],
        missing_required_fields: [],
        teacher_review_required: true
      };
    case "response_collection_agent":
      return {
        ...base,
        agent_name: agentName,
        assistant_message: "Mock procedural message.",
        intervention_type: "procedural_clarification",
        should_advance: false,
        blocked_content_help: false,
        missing_evidence_status: "not_applicable",
        events_to_log: []
      };
    case "student_profiling_agent":
      return {
        ...base,
        agent_name: agentName,
        profile_type: "initial",
        ability_profile: "insufficient_evidence",
        ability_pattern_flags: ["no_clear_pattern"],
        engagement_profile: "insufficient_process_evidence",
        engagement_pattern_flags: ["no_clear_pattern"],
        integrated_diagnostic_profile: "insufficient_evidence_for_formative_decision",
        integrated_profile_confidence: "low",
        integrated_profile_rationale: "Mock output only; not generated from classroom evidence.",
        evidence_sufficiency: "insufficient",
        confidence_alignment: "insufficient_evidence",
        independence_interpretability: "insufficient_evidence",
        misconception_indicators: [],
        item_level_evidence: [],
        reasoning_quality_summary: "Mock output only.",
        engagement_summary: "Mock output only.",
        process_interpretation_cautions: ["Mock output must not be used as a student profile."],
        profile_confidence: "low",
        rationale: "Mock provider fixture for infrastructure testing.",
        recommended_next_evidence: []
      };
    case "formative_value_and_planning_agent":
      return {
        ...base,
        agent_name: agentName,
        formative_value: "diagnostic_clarification",
        formative_action_plan: "Mock plan only; not connected to workflow.",
        target_evidence: [],
        success_criteria: [],
        followup_prompt_constraints: {
          mock_only: true
        },
        profile_update_triggers: [],
        rationale: "Mock provider fixture for infrastructure testing.",
        mapping_followed: true,
        mapping_deviation_reason: null
      };
    case "followup_agent":
      return {
        ...base,
        agent_name: agentName,
        assistant_message: "Mock follow-up message.",
        followup_action_type: "ask_clarifying_question",
        target_formative_value: "diagnostic_clarification",
        evidence_request: "Mock evidence request.",
        expects_student_response: true,
        evidence_trigger_candidate: false,
        should_offer_move_on: false,
        off_topic_detected: false,
        events_to_log: []
      };
  }
}
