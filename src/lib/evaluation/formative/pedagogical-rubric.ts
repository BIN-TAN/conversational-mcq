import {
  PedagogicalRubricDimensionSchema,
  type FormativeEvaluationScenario,
  type FormativeEvaluationStrategy,
  type PedagogicalRubricDimension,
  type PedagogicalRubricRecord
} from "./schemas";
import type { FormativeEvaluationRunArtifacts } from "./types";

export const PEDAGOGICAL_RUBRIC_VERSION = "pedagogical-review-required-v2";

function record(
  dimension: PedagogicalRubricDimension,
  status: PedagogicalRubricRecord["status"],
  rationale: string,
  score: 0 | null = null
): PedagogicalRubricRecord {
  return {
    dimension, status, score, rationale,
    evidence: [{ artifact: "pedagogical-rubric.json", record_key: dimension,
      detail: `${PEDAGOGICAL_RUBRIC_VERSION}: ${rationale}` }]
  };
}

export function evaluatePedagogicalRubric(input: {
  scenario: FormativeEvaluationScenario;
  artifacts: Pick<FormativeEvaluationRunArtifacts, "visible_turns" | "final_student_state" | "profile_history" | "plan_history">;
  strategies: FormativeEvaluationStrategy[];
  answer_key_leak_count: number;
}) {
  const earlyResolution = input.artifacts.final_student_state.evidence_history.some(change =>
    change.evidence_type === "misconception_status" && change.resulting_value === "resolved" &&
    change.turn_index < (input.scenario.expected_behavior.misconception_must_not_resolve_before_turn ?? 0)
  );

  // Mechanical checks can demonstrate particular failures, not educational success.
  // Reply linkage, keywords, length, strategy labels and simulator state stay in
  // the source artifacts; none is a substitute for independent content review.
  return PedagogicalRubricDimensionSchema.options.map(dimension => {
    if (dimension === "avoids_answer_dumping" && input.answer_key_leak_count > 0) {
      return record(dimension, "scored", `Detected ${input.answer_key_leak_count} protected answer-key leaks.`, 0);
    }
    if (dimension === "avoids_premature_misconception_resolution" && earlyResolution) {
      return record(dimension, "scored", "Resolution precedes this controlled scenario's evidence boundary.", 0);
    }
    if ((dimension === "revision_readiness_supported" && !input.scenario.expected_behavior.revision_expected) ||
        (dimension === "transfer_readiness_supported" && !input.scenario.expected_behavior.transfer_expected) ||
        (dimension === "distinguishes_task_and_concept_confusion" && !input.scenario.tags.includes("task_confusion"))) {
      return record(dimension, "not_applicable", "This scenario does not isolate this dimension.");
    }
    return record(dimension, "manual_review_required",
      "Independent review of the task, student evidence and tutor response is required. No positive quality score is inferred from structural checks or simulated learning.");
  });
}
