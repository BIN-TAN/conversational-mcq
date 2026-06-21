import { mockOutputForAgent } from "../src/lib/agents/mock-fixtures";
import type { AgentInputByName } from "../src/lib/agents/contracts";
import type { AgentName } from "../src/lib/agents/names";

export function fixtureInputForAgent<TAgentName extends AgentName>(
  agentName: TAgentName
): AgentInputByName[TAgentName] {
  switch (agentName) {
    case "item_preparation_agent":
      return {
        teacher_draft: { title: "Synthetic draft" },
        learning_objective: "Synthetic objective",
        related_concept_description: "Synthetic concept description",
        items: [{ item_stem: "Synthetic item", options: [] }],
        teacher_constraints: { exactly_three_to_four_items: true },
        administration_rules: { no_feedback_during_initial_administration: true }
      } as unknown as AgentInputByName[TAgentName];
    case "response_collection_agent":
      return {
        current_phase: "initial_item_administration",
        allowed_interaction_type: "procedural_message",
        current_item_student_safe: { item_public_id: "synthetic_item", stem: "Synthetic stem" },
        student_message_or_action: { message: "Synthetic message" },
        collected_response_state: { selected_option: null },
        missing_evidence_state: { missing: [] },
        recent_student_safe_transcript: [],
        orchestration_constraints: { no_feedback: true }
      } as unknown as AgentInputByName[TAgentName];
    case "student_profiling_agent":
      return {
        concept_unit_metadata: { concept_unit_public_id: "synthetic_concept" },
        initial_response_package: { package_type: "synthetic" },
        previous_profile: null,
        followup_evidence_package: null,
        profile_type: "initial",
        profiling_constraints: { mock_only: true }
      } as unknown as AgentInputByName[TAgentName];
    case "formative_value_and_planning_agent":
      return {
        latest_student_profile: mockOutputForAgent("student_profiling_agent"),
        response_package: { package_type: "synthetic" },
        concept_unit_metadata: { concept_unit_public_id: "synthetic_concept" },
        previous_formative_decisions: [],
        allowed_formative_values: [
          "diagnostic_clarification",
          "reasoning_refinement",
          "confidence_calibration",
          "independent_understanding_verification",
          "consolidation_or_transfer"
        ],
        planning_constraints: { mock_only: true }
      } as unknown as AgentInputByName[TAgentName];
    case "followup_agent":
      return {
        turn_type: "student_reply",
        latest_student_profile: mockOutputForAgent("student_profiling_agent"),
        latest_formative_decision: mockOutputForAgent("formative_value_and_planning_agent"),
        formative_action_plan: "Synthetic plan",
        target_evidence: ["Synthetic target evidence."],
        success_criteria: ["Synthetic success criterion."],
        followup_prompt_constraints: ["Synthetic follow-up constraint."],
        current_followup_round: {
          round_index: 1,
          status: "active",
          started_at: "2026-06-21T17:00:00.000Z",
          completed_at: null
        },
        recent_followup_transcript: [],
        student_message: "Synthetic student message",
        concept_unit_metadata: { concept_unit_public_id: "synthetic_concept" },
        relevant_item_evidence: [],
        process_context: { synthetic: true },
        followup_constraints: { mock_only: true }
      } as unknown as AgentInputByName[TAgentName];
  }
}
