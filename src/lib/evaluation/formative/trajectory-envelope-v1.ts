import { z } from "zod";

export const TRAJECTORY_ENVELOPE_VERSION =
  "trajectory-envelope-v1" as const;
export const TRAJECTORY_SOUND_GATE_OVERRIDE_RULE =
  "production_sound_gate_overrides_trajectory_expectation_and_requires_immediate_revision" as const;

export const TrajectoryReasoningQualitySchema = z.enum([
  "insufficient",
  "misconception",
  "partial",
  "sound"
]);
export type TrajectoryReasoningQuality = z.infer<
  typeof TrajectoryReasoningQualitySchema
>;

export const TrajectoryRoleSchema = z.enum([
  "initial_anchor_position",
  "mechanism_exploration",
  "anchor_reconciliation",
  "independent_reconstruction",
  "revision_readiness",
  "post_sound_revision"
]);
export type TrajectoryRole = z.infer<typeof TrajectoryRoleSchema>;

export const TrajectoryProhibitedStateSchema = z.enum([
  "trajectory_expectation_overrides_evaluator",
  "revision_delayed_after_sound",
  "copied_wording_without_evidence",
  "blocking_contradiction",
  "unsupported_sound_promotion"
]);
export type TrajectoryProhibitedState = z.infer<
  typeof TrajectoryProhibitedStateSchema
>;

export const TrajectoryProgressionConsequenceSchema = z.object({
  when_sound_gate_passes: z.literal("immediate_revision"),
  when_evidence_is_not_sound: z.literal(
    "continue_evidence_targeted_tutor"
  ),
  when_evidence_regresses: z.literal("reopen_targeted_support"),
  when_independent_evidence_is_missing: z.literal(
    "request_independent_evidence"
  ),
  when_turn_budget_is_exhausted: z.literal("safe_stop_for_review")
}).strict();
export type TrajectoryProgressionConsequence = z.infer<
  typeof TrajectoryProgressionConsequenceSchema
>;

export const TrajectoryEnvelopeTurnSchema = z.object({
  turn_index: z.number().int().positive(),
  expected_trajectory_role: TrajectoryRoleSchema,
  allowed_reasoning_quality_set: z.array(
    TrajectoryReasoningQualitySchema
  ).min(1).max(4).refine(
    (values) => new Set(values).size === values.length,
    "allowed_reasoning_quality_set must not contain duplicates"
  ),
  sound_gate_override_rule: z.literal(
    TRAJECTORY_SOUND_GATE_OVERRIDE_RULE
  ),
  progression_consequence: TrajectoryProgressionConsequenceSchema,
  prohibited_states: z.array(TrajectoryProhibitedStateSchema)
    .min(1)
    .refine(
      (values) => new Set(values).size === values.length,
      "prohibited_states must not contain duplicates"
    )
}).strict();
export type TrajectoryEnvelopeTurn = z.infer<
  typeof TrajectoryEnvelopeTurnSchema
>;

export const TrajectoryEnvelopeContractSchema = z.object({
  trajectory_envelope_version: z.literal(TRAJECTORY_ENVELOPE_VERSION),
  authority_boundary: z.object({
    simulator_intended_trajectory_is_non_authoritative: z.literal(true),
    evaluator_follows_observable_evidence: z.literal(true),
    production_sound_gate_is_authoritative_for_progression: z.literal(true),
    exact_turn_by_turn_reasoning_labels_prohibited: z.literal(true)
  }).strict(),
  separation: z.object({
    simulator_intended_trajectory: z.string().min(1).max(1200),
    acceptable_reasoning_quality_envelope: z.string().min(1).max(1200),
    progression_consequences: z.string().min(1).max(1200)
  }).strict(),
  turns: z.array(TrajectoryEnvelopeTurnSchema).min(1).max(12).refine(
    (turns) => turns.every(
      (turn, index) => turn.turn_index === index + 1
    ),
    "turn_index values must be contiguous and one-based"
  )
}).strict();
export type TrajectoryEnvelopeContract = z.infer<
  typeof TrajectoryEnvelopeContractSchema
>;

export const TrajectorySoundGateResultSchema = z.object({
  gate_version: z.string().min(1),
  passed: z.boolean(),
  failure_codes: z.array(z.string().min(1))
}).strict();

export const TrajectoryProgressionDecisionSchema = z.enum([
  "immediate_revision",
  "continue_evidence_targeted_tutor",
  "reopen_targeted_support",
  "request_independent_evidence",
  "safe_stop_for_review"
]);
export type TrajectoryProgressionDecision = z.infer<
  typeof TrajectoryProgressionDecisionSchema
>;

export const TrajectoryAdherenceDispositionSchema = z.enum([
  "inside_allowed_envelope",
  "sound_earlier_than_intended",
  "partial_longer_than_intended",
  "regression_after_improvement",
  "contradiction_after_sound",
  "copied_wording_without_evidence",
  "outside_allowed_envelope"
]);
export type TrajectoryAdherenceDisposition = z.infer<
  typeof TrajectoryAdherenceDispositionSchema
>;

export const TrajectoryEnvelopeObservationSchema = z.object({
  turn_contract: TrajectoryEnvelopeTurnSchema,
  evaluator_reasoning_quality: TrajectoryReasoningQualitySchema,
  sound_gate_result: TrajectorySoundGateResultSchema,
  evidence_independently_supported: z.boolean(),
  copied_wording_without_evidence: z.boolean(),
  blocking_contradiction: z.boolean(),
  prior_reasoning_quality: TrajectoryReasoningQualitySchema.nullable(),
  prior_sound_gate_passed: z.boolean(),
  turn_budget_exhausted: z.boolean()
}).strict();
export type TrajectoryEnvelopeObservation = z.infer<
  typeof TrajectoryEnvelopeObservationSchema
>;

export const TrajectoryEnvelopeDecisionSchema = z.object({
  trajectory_envelope_version: z.literal(TRAJECTORY_ENVELOPE_VERSION),
  turn_index: z.number().int().positive(),
  expected_trajectory_role: TrajectoryRoleSchema,
  evaluator_reasoning_quality: TrajectoryReasoningQualitySchema,
  evaluator_reasoning_quality_preserved: z.literal(true),
  inside_allowed_reasoning_quality_envelope: z.boolean(),
  trajectory_adherence: TrajectoryAdherenceDispositionSchema,
  sound_gate_passed: z.boolean(),
  sound_gate_override_applied: z.boolean(),
  progression_decision: TrajectoryProgressionDecisionSchema,
  revision_required_immediately: z.boolean(),
  tutor_should_be_called: z.boolean(),
  prohibited_states_detected: z.array(TrajectoryProhibitedStateSchema),
  trajectory_expectation_changed_evaluator_output: z.literal(false)
}).strict();
export type TrajectoryEnvelopeDecision = z.infer<
  typeof TrajectoryEnvelopeDecisionSchema
>;

const QUALITY_RANK: Record<TrajectoryReasoningQuality, number> = {
  insufficient: 0,
  misconception: 1,
  partial: 2,
  sound: 3
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function detectProhibitedStates(
  observation: TrajectoryEnvelopeObservation
): TrajectoryProhibitedState[] {
  const states: TrajectoryProhibitedState[] = [];
  if (observation.copied_wording_without_evidence) {
    states.push("copied_wording_without_evidence");
  }
  if (observation.blocking_contradiction) {
    states.push("blocking_contradiction");
  }
  if (
    observation.evaluator_reasoning_quality === "sound" &&
    !observation.sound_gate_result.passed
  ) {
    states.push("unsupported_sound_promotion");
  }
  return unique(states).filter((state) =>
    observation.turn_contract.prohibited_states.includes(state)
  );
}

function trajectoryAdherence(
  observation: TrajectoryEnvelopeObservation,
  insideEnvelope: boolean
): TrajectoryAdherenceDisposition {
  if (observation.copied_wording_without_evidence) {
    return "copied_wording_without_evidence";
  }
  if (
    observation.prior_sound_gate_passed &&
    observation.blocking_contradiction
  ) {
    return "contradiction_after_sound";
  }
  if (
    observation.prior_reasoning_quality !== null &&
    QUALITY_RANK[observation.evaluator_reasoning_quality] <
      QUALITY_RANK[observation.prior_reasoning_quality]
  ) {
    return "regression_after_improvement";
  }
  if (
    observation.sound_gate_result.passed &&
    !insideEnvelope
  ) {
    return "sound_earlier_than_intended";
  }
  if (
    observation.evaluator_reasoning_quality === "partial" &&
    observation.turn_contract.expected_trajectory_role ===
      "revision_readiness"
  ) {
    return "partial_longer_than_intended";
  }
  return insideEnvelope
    ? "inside_allowed_envelope"
    : "outside_allowed_envelope";
}

export function evaluateTrajectoryEnvelope(
  input: TrajectoryEnvelopeObservation
): TrajectoryEnvelopeDecision {
  const observation = TrajectoryEnvelopeObservationSchema.parse(input);
  const insideEnvelope =
    observation.turn_contract.allowed_reasoning_quality_set.includes(
      observation.evaluator_reasoning_quality
    );
  const prohibitedStates = detectProhibitedStates(observation);
  const adherence = trajectoryAdherence(observation, insideEnvelope);

  let progression: TrajectoryProgressionDecision;
  if (
    observation.copied_wording_without_evidence ||
    !observation.evidence_independently_supported
  ) {
    progression =
      observation.turn_contract.progression_consequence
        .when_independent_evidence_is_missing;
  } else if (
    adherence === "contradiction_after_sound" ||
    adherence === "regression_after_improvement" ||
    observation.blocking_contradiction
  ) {
    progression =
      observation.turn_contract.progression_consequence
        .when_evidence_regresses;
  } else if (observation.sound_gate_result.passed) {
    progression =
      observation.turn_contract.progression_consequence
        .when_sound_gate_passes;
  } else if (observation.turn_budget_exhausted) {
    progression =
      observation.turn_contract.progression_consequence
        .when_turn_budget_is_exhausted;
  } else {
    progression =
      observation.turn_contract.progression_consequence
        .when_evidence_is_not_sound;
  }

  const revisionRequired = progression === "immediate_revision";
  return TrajectoryEnvelopeDecisionSchema.parse({
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    turn_index: observation.turn_contract.turn_index,
    expected_trajectory_role:
      observation.turn_contract.expected_trajectory_role,
    evaluator_reasoning_quality:
      observation.evaluator_reasoning_quality,
    evaluator_reasoning_quality_preserved: true,
    inside_allowed_reasoning_quality_envelope: insideEnvelope,
    trajectory_adherence: adherence,
    sound_gate_passed: observation.sound_gate_result.passed,
    sound_gate_override_applied:
      observation.sound_gate_result.passed && !insideEnvelope,
    progression_decision: progression,
    revision_required_immediately: revisionRequired,
    tutor_should_be_called:
      progression === "continue_evidence_targeted_tutor" ||
      progression === "reopen_targeted_support" ||
      progression === "request_independent_evidence",
    prohibited_states_detected: prohibitedStates,
    trajectory_expectation_changed_evaluator_output: false
  });
}

export function buildDefaultTrajectoryProgressionConsequences():
  TrajectoryProgressionConsequence {
  return TrajectoryProgressionConsequenceSchema.parse({
    when_sound_gate_passes: "immediate_revision",
    when_evidence_is_not_sound: "continue_evidence_targeted_tutor",
    when_evidence_regresses: "reopen_targeted_support",
    when_independent_evidence_is_missing: "request_independent_evidence",
    when_turn_budget_is_exhausted: "safe_stop_for_review"
  });
}
