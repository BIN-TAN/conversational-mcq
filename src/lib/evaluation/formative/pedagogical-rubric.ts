import {
  PedagogicalRubricDimensionSchema,
  type FormativeEvaluationScenario,
  type FormativeEvaluationStrategy,
  type PedagogicalRubricDimension,
  type PedagogicalRubricRecord
} from "./schemas";
import { assistantRepliesForDialogue, countStrategyChanges } from "./deterministic-pedagogical-checks";
import type { FormativeEvaluationRunArtifacts } from "./types";

const MANUAL_DIMENSIONS = new Set<PedagogicalRubricDimension>([
  "misconception_targeting",
  "explains_distractor_plausibility",
  "identifies_reasoning_failure",
  "supports_target_concept_distinction",
  "profile_change_supported_by_evidence",
  "plan_change_supported_by_evidence",
  "student_facing_naturalness"
]);

function evidence(dimension: PedagogicalRubricDimension, detail: string) {
  return [{ artifact: "pedagogical-rubric.json", record_key: dimension, detail }];
}

function manual(dimension: PedagogicalRubricDimension): PedagogicalRubricRecord {
  return {
    dimension,
    status: "manual_review_required",
    score: null,
    evidence: evidence(dimension, "Human judgment is required for this qualitative dimension."),
    rationale: "E1 does not fabricate a qualitative score that structured evidence cannot establish."
  };
}

function scored(
  dimension: PedagogicalRubricDimension,
  score: 0 | 1 | 2,
  rationale: string,
  detail: string
): PedagogicalRubricRecord {
  return { dimension, status: "scored", score, evidence: evidence(dimension, detail), rationale };
}

function notApplicable(dimension: PedagogicalRubricDimension, rationale: string): PedagogicalRubricRecord {
  return { dimension, status: "not_applicable", score: null, evidence: [], rationale };
}

export function evaluatePedagogicalRubric(input: {
  scenario: FormativeEvaluationScenario;
  artifacts: Pick<FormativeEvaluationRunArtifacts, "visible_turns" | "final_student_state" | "profile_history" | "plan_history">;
  strategies: FormativeEvaluationStrategy[];
  answer_key_leak_count: number;
}) {
  const pairs = assistantRepliesForDialogue(input.artifacts.visible_turns);
  const replies = pairs.filter((pair) => pair.assistant).length;
  const responseRatio = pairs.length === 0 ? 1 : replies / pairs.length;
  const assistantText = pairs.map((pair) => pair.assistant?.message_text ?? "").join("\n");
  const genericCount = (assistantText.match(/focus on this boundary/gi) ?? []).length;
  const strategyChanges = countStrategyChanges(input.strategies);
  const expectedChanges = input.scenario.expected_behavior.minimum_strategy_changes ?? 0;
  const taskClarification = input.strategies.includes("task_clarification");
  const offTopicRedirect = input.strategies.includes("off_topic_redirect");
  const substantiveMessages = pairs.filter((pair) => pair.student.message_text.trim().length >= 24).length;
  const resolvedTooSoon = input.artifacts.final_student_state.evidence_history.some((change) =>
    change.evidence_type === "misconception_status" &&
    change.resulting_value === "resolved" &&
    change.turn_index < (input.scenario.expected_behavior.misconception_must_not_resolve_before_turn ?? 0)
  );

  const records = new Map<PedagogicalRubricDimension, PedagogicalRubricRecord>();
  for (const dimension of PedagogicalRubricDimensionSchema.options) {
    if (MANUAL_DIMENSIONS.has(dimension)) records.set(dimension, manual(dimension));
  }
  records.set("direct_response_to_latest_message", scored("direct_response_to_latest_message", responseRatio === 1 ? 2 : responseRatio > 0 ? 1 : 0, "Based on persisted student-to-assistant turn pairs.", `reply_ratio=${responseRatio}`));
  records.set("continuity_with_visible_history", scored("continuity_with_visible_history", pairs.length > 0 && replies === pairs.length ? 2 : 1, "Persisted replies can be linked to prior visible student turns.", `pairs=${pairs.length}`));
  records.set("distractor_focus", scored("distractor_focus", /theta|item difficulty|item discrimination|option\s+[A-D]|item\s+\d+/i.test(assistantText) ? 2 : 0, "Structured content-anchor terms are checked without judging prose quality.", "assistant anchor scan"));
  records.set("distinguishes_task_and_concept_confusion", input.scenario.tags.includes("task_confusion")
    ? scored("distinguishes_task_and_concept_confusion", taskClarification ? 2 : 0, "Task-confusion scenarios require an observable clarification operation.", `task_clarification=${taskClarification}`)
    : notApplicable("distinguishes_task_and_concept_confusion", "Scenario does not isolate task-language confusion."));
  records.set("strategy_adaptation", expectedChanges > 0
    ? scored("strategy_adaptation", strategyChanges >= expectedChanges ? 2 : strategyChanges > 0 ? 1 : 0, "Only changes in classified instructional operation count.", `changes=${strategyChanges};required=${expectedChanges}`)
    : scored("strategy_adaptation", strategyChanges > 0 ? 2 : 1, "No minimum change was required; repetition remains visible for review.", `changes=${strategyChanges}`));
  records.set("avoids_failed_strategy_repetition", scored("avoids_failed_strategy_repetition", genericCount <= 1 ? 2 : genericCount === 2 ? 1 : 0, "Repeated deterministic boundary prompts are counted.", `generic_repetition_count=${genericCount}`));
  records.set("avoids_generic_tutoring", scored("avoids_generic_tutoring", /theta|difficulty|discrimination|option\s+[A-D]|item\s+\d+/i.test(assistantText) ? 2 : 0, "Responses must retain an assessment-specific anchor.", "assessment anchor scan"));
  records.set("avoids_answer_dumping", scored("avoids_answer_dumping", input.answer_key_leak_count === 0 ? 2 : 0, "Protected answer-key structures are scanned deterministically.", `leaks=${input.answer_key_leak_count}`));
  records.set("elicits_substantive_student_evidence", scored("elicits_substantive_student_evidence", substantiveMessages > 0 ? 2 : pairs.length > 0 ? 1 : 0, "Student messages are checked for minimal substantive length, not conceptual quality.", `substantive_messages=${substantiveMessages}`));
  records.set("revision_readiness_supported", input.scenario.expected_behavior.revision_expected
    ? scored("revision_readiness_supported", input.artifacts.final_student_state.evidence_history.some((entry) => entry.evidence_type === "conceptual_state" && entry.resulting_value === "mostly_correct_understanding") ? 2 : 0, "Revision readiness requires a hidden-state evidence change in this controlled scenario.", "hidden-state revision evidence")
    : notApplicable("revision_readiness_supported", "Scenario does not require revision readiness."));
  records.set("transfer_readiness_supported", input.scenario.expected_behavior.transfer_expected
    ? scored("transfer_readiness_supported", input.artifacts.final_student_state.misconception_status === "recurred" ? 2 : 1, "Transfer failure must remain distinguishable from revision success.", `final_misconception_status=${input.artifacts.final_student_state.misconception_status}`)
    : notApplicable("transfer_readiness_supported", "Scenario does not require transfer evidence."));
  records.set("avoids_premature_misconception_resolution", scored("avoids_premature_misconception_resolution", resolvedTooSoon ? 0 : 2, "Resolution timing is compared with controlled hidden truth.", `premature=${resolvedTooSoon}`));
  if (input.scenario.tags.includes("off_topic")) {
    records.set("direct_response_to_latest_message", scored("direct_response_to_latest_message", offTopicRedirect ? 2 : 1, "Off-topic input should receive a bounded topic redirect.", `off_topic_redirect=${offTopicRedirect}`));
  }

  return PedagogicalRubricDimensionSchema.options.map((dimension) =>
    records.get(dimension) ?? manual(dimension)
  );
}
