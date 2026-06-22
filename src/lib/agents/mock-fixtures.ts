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
    case "item_verification_agent":
      return {
        ...base,
        agent_name: agentName,
        agent_version: "7d-draft",
        prompt_version: "mock-item-verification-v1",
        schema_version: "mock-item-verification-output-v1",
        warnings: [
          "Mock provider output for infrastructure testing only; not a validated item-quality judgment."
        ],
        verification_status: "verified_with_warnings",
        set_level_findings: [],
        item_results: [
          {
            item_public_id: "mock-item-1",
            findings: [
              {
                issue_code: "possible_ambiguity",
                item_public_id: "mock-item-1",
                location: "item_stem",
                brief_explanation:
                  "Mock warning only. The stem may allow more than one interpretation."
              }
            ],
            teacher_review_required: true
          }
        ],
        teacher_review_required: true
      };
    case "response_collection_agent":
      return {
        ...base,
        agent_name: agentName,
        agent_version: "7c-draft",
        prompt_version: "mock-response-collection-v2",
        schema_version: "mock-response-collection-output-v2",
        assistant_message:
          "I saved the reasoning you provided. Use the option buttons to choose an answer and the confidence buttons to report confidence.",
        intervention_type: "procedural_clarification",
        should_advance: false,
        blocked_content_help: false,
        missing_evidence_status: "not_applicable",
        recognized_intents: ["reasoning_submission"],
        reasoning_capture_status: "new_reasoning",
        reasoning_evidence_segments: ["Synthetic message"],
        requires_option_button: false,
        requires_confidence_control: false,
        requested_control_action: "none",
        recommended_interaction_outcome: "stay_current_step",
        events_to_log: []
      };
    case "student_profiling_agent":
      return {
        ...base,
        agent_name: agentName,
        warnings: [
          "Mock provider output for infrastructure testing only; not a validated research inference."
        ],
        profile_type: "initial",
        ability_profile: "partial_understanding",
        ability_pattern_flags: [
          "incorrect_answer_strong_partial_reasoning",
          "confidence_reasoning_mismatch"
        ],
        engagement_profile: "adequate_engagement",
        engagement_pattern_flags: ["repeated_revision_present"],
        integrated_diagnostic_profile: "conflicting_evidence_needs_clarification",
        integrated_profile_confidence: "low",
        integrated_profile_rationale:
          "Mock output only. The fixture combines mixed correctness, reasoning, confidence, and process context to exercise the three-layer profile contract.",
        evidence_sufficiency: "limited",
        confidence_alignment: "mixed",
        independence_interpretability: "independent_understanding_uncertain",
        misconception_indicators: [
          {
            indicator: "mock_distractor_aligned_reasoning",
            evidence_reference: "mock-item-2",
            confidence: "low"
          }
        ],
        item_level_evidence: [
          {
            item_public_id: "mock-item-1",
            correctness: "correct",
            reasoning_quality: "supported",
            confidence_rating: "high"
          },
          {
            item_public_id: "mock-item-2",
            correctness: "incorrect",
            reasoning_quality: "partial",
            confidence_rating: "medium"
          }
        ],
        reasoning_quality_summary:
          "Mock output only. Example evidence shows supported reasoning on one item and partial or conflicting reasoning on another.",
        engagement_summary:
          "Mock output only. Example process context suggests adequate participation with revisions.",
        process_interpretation_cautions: [
          "Mock output must not be used as a validated student profile.",
          "Process context is engagement and evidence-sufficiency context, not misconduct evidence."
        ],
        profile_confidence: "low",
        rationale: "Mock provider fixture for infrastructure testing.",
        recommended_next_evidence: [
          {
            evidence_type: "clarify_reasoning",
            reason: "Mock next-evidence request for later planning phases."
          }
        ]
      };
    case "formative_value_and_planning_agent":
      return {
        ...base,
        agent_name: agentName,
        warnings: [
          "Mock provider output for infrastructure testing only; not validated educational guidance."
        ],
        formative_value: "diagnostic_clarification",
        formative_action_plan:
          "Mock plan only. Ask the future Follow-up Agent to clarify the student's reasoning with one neutral evidence request.",
        target_evidence: [
          "Student explains the relationship between the selected option and the concept evidence."
        ],
        success_criteria: [
          "Student provides enough reasoning to distinguish misunderstanding from incomplete evidence."
        ],
        followup_prompt_constraints: [
          "Do not reveal correctness.",
          "Do not provide hints, tutoring, or explanations.",
          "Ask only for additional evidence."
        ],
        profile_update_triggers: [
          "New reasoning resolves conflicting or insufficient evidence in the saved profile."
        ],
        rationale:
          "Mock provider fixture for infrastructure testing. The default mapping is followed for diagnostic clarification.",
        mapping_followed: true,
        mapping_deviation_reason: null
      };
    case "followup_agent":
      return {
        ...base,
        agent_name: agentName,
        assistant_message: "Mock follow-up message.",
        followup_action_type: "clarification_prompt",
        target_formative_value: "diagnostic_clarification",
        evidence_request: "Mock evidence request.",
        expects_student_response: true,
        evidence_trigger_candidate: false,
        student_turn_substantive: false,
        evidence_trigger_reasons: [],
        should_offer_move_on: false,
        off_topic_detected: false,
        events_to_log: []
      };
  }
}
