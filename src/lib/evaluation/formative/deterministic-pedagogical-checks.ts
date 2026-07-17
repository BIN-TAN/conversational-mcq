import type { FormativeEvaluationScenario, FormativeEvaluationStrategy } from "./schemas";
import type { FormativeEvaluationRunArtifacts, VisibleTurnRecord } from "./types";

export function countStrategyChanges(strategies: readonly FormativeEvaluationStrategy[]) {
  return strategies.reduce((count, strategy, index) =>
    index > 0 && strategy !== strategies[index - 1] ? count + 1 : count, 0);
}

export function classifyInstructionalStrategy(input: {
  response_function?: string | null;
  activity_family?: string | null;
  recovery_used?: boolean;
}): FormativeEvaluationStrategy {
  if (input.recovery_used) return "safe_recovery";
  switch (input.response_function) {
    case "clarification": return "task_clarification";
    case "focused_question": return "narrowed_question";
    case "misconception_contrast": return "contrast_case";
    case "foundational_scaffold": return "abstract_explanation";
    case "worked_example": return "worked_example";
    case "answer_student_question": return "task_clarification";
    case "topic_redirect": return "off_topic_redirect";
    case "readiness_confirmation": return "revision_request";
  }
  switch (input.activity_family) {
    case "distractor_contrast": return "distractor_comparison";
    case "reasoning_chain_repair": return "revision_request";
    case "transfer_and_distractor_generation": return "transfer_task";
    default: return "student_explanation_request";
  }
}

export function assistantRepliesForDialogue(turns: VisibleTurnRecord[]) {
  const students = turns.filter((turn) => turn.actor_type === "student" && turn.client_operation_id);
  return students.map((student) => ({
    student,
    assistant: turns.find((turn) =>
      turn.actor_type === "agent" &&
      turn.client_operation_id === student.client_operation_id &&
      turn.sequence_index > student.sequence_index
    ) ?? null
  }));
}

export function evaluateScenarioExpectations(input: {
  scenario: FormativeEvaluationScenario;
  artifacts: Pick<FormativeEvaluationRunArtifacts, "visible_turns" | "final_student_state" | "profile_history" | "plan_history">;
  strategies: FormativeEvaluationStrategy[];
  final_platform_state: string;
}) {
  const pairs = assistantRepliesForDialogue(input.artifacts.visible_turns);
  const assistantText = pairs.map((pair) => pair.assistant?.message_text ?? "").join("\n");
  const strategyChanges = countStrategyChanges(input.strategies);
  const minimumRepliesPassed =
    pairs.filter((pair) => pair.assistant).length >=
    input.scenario.expected_behavior.minimum_visible_assistant_replies;
  const strategyPassed =
    strategyChanges >= (input.scenario.expected_behavior.minimum_strategy_changes ?? 0);
  const distractorFocusPassed = !input.scenario.expected_behavior.expected_distractor_focus ||
    /theta|item difficulty|item discrimination|distractor|option\s+[A-D]|item\s+\d+/i.test(assistantText);
  const permittedFinalState = input.scenario.expected_behavior.permitted_final_states.includes(
    input.final_platform_state as never
  );
  const nonResolutionTurn = input.scenario.expected_behavior.misconception_must_not_resolve_before_turn;
  const prematureResolution = nonResolutionTurn
    ? input.artifacts.final_student_state.evidence_history.some(
        (change) =>
          change.evidence_type === "misconception_status" &&
          change.resulting_value === "resolved" &&
          change.turn_index < nonResolutionTurn
      )
    : false;
  const revisionExpectationPassed = !input.scenario.expected_behavior.revision_expected ||
    input.artifacts.final_student_state.evidence_history.some((change) =>
      change.evidence_type === "conceptual_state" || change.evidence_type === "misconception_status"
    );
  const transferExpectationPassed = !input.scenario.expected_behavior.transfer_expected ||
    input.final_platform_state === "transfer_item" ||
    input.final_platform_state === "session_complete";
  return {
    minimum_replies_passed: minimumRepliesPassed,
    strategy_change_expectation_passed: strategyPassed,
    distractor_focus_passed: distractorFocusPassed,
    permitted_final_state: permittedFinalState,
    premature_resolution: prematureResolution,
    revision_expectation_passed: revisionExpectationPassed,
    transfer_expectation_passed: transferExpectationPassed,
    strategy_change_count: strategyChanges
  };
}
