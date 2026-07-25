import { z } from "zod";

export const CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION =
  "conceptual-evidence-update-source-v1" as const;

export const ConceptualEvidenceInteractionKindV1Schema = z.enum([
  "ordinary_conceptual_response",
  "self_correction",
  "reflection_or_uncertainty",
  "unsupported_understanding_claim",
  "non_conceptual_response"
]);

const ReasoningQualityV1Schema = z.enum([
  "insufficient",
  "misconception",
  "partial",
  "sound"
]);

const ProfileUpdateDispositionV1Schema = z.enum([
  "initialize_unresolved_profile",
  "preserve_prior_profile",
  "update_from_latest_evidence",
  "reopen_from_latest_contradiction"
]);

const AnchorApplicationV1Schema = z.enum([
  "absent",
  "implicit",
  "explicit"
]);

const AnchorStanceV1Schema = z.enum([
  "not_expressed",
  "ambiguous",
  "endorses_distractor",
  "rejects_distractor"
]);

const AnchorConsistencyV1Schema = z.enum([
  "not_assessable",
  "consistent_with_conceptual_reasoning",
  "contradictory_to_conceptual_reasoning",
  "unresolved"
]);

export const EvaluatorConceptualEvidenceV1Schema = z.object({
  validation_status: z.enum([
    "accepted",
    "rejected_copied_language",
    "rejected_unsupported_claim",
    "not_applicable"
  ]),
  conceptual_evidence_applicable: z.boolean(),
  reasoning_quality: ReasoningQualityV1Schema,
  observable_evidence_span_count: z.number().int().nonnegative(),
  anchor_application: AnchorApplicationV1Schema,
  anchor_stance: AnchorStanceV1Schema,
  anchor_consistency: AnchorConsistencyV1Schema,
  misconception_status: z.enum([
    "not_assessed",
    "persists",
    "uncertain",
    "resolved_for_current_anchor"
  ]),
  essential_missing_link_count: z.number().int().nonnegative(),
  contradiction_count: z.number().int().nonnegative(),
  mapped_update_disposition: ProfileUpdateDispositionV1Schema
}).strict();

export const SelfCorrectionEvidenceContextV1Schema = z.object({
  self_correction_intent: z.boolean(),
  conceptual_evidence_update: z.boolean(),
  observable_conceptual_evidence_present: z.boolean(),
  independent_conceptual_evidence_present: z.boolean(),
  conceptual_evidence_quality: z.enum([
    "none",
    "answer_revision_only",
    "copied_insufficient",
    "misconception",
    "partial",
    "sound",
    "contradictory"
  ]),
  profile_update_disposition: ProfileUpdateDispositionV1Schema
}).strict();

export const ConceptualEvidenceUpdateSourceInputV1Schema = z.object({
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  prior_profile_present: z.boolean(),
  interaction_kind: ConceptualEvidenceInteractionKindV1Schema,
  evaluator_evidence: EvaluatorConceptualEvidenceV1Schema,
  self_correction_context: SelfCorrectionEvidenceContextV1Schema
}).strict();
export type ConceptualEvidenceUpdateSourceInputV1 = z.infer<
  typeof ConceptualEvidenceUpdateSourceInputV1Schema
>;

const ConceptualEvidenceUpdateReasonCodeV1Schema = z.enum([
  "ordinary_evaluator_evidence_selected",
  "self_correction_evidence_selected",
  "self_correction_intent_separate",
  "self_correction_context_not_authoritative_for_ordinary_response",
  "accepted_evaluator_evidence_required",
  "observable_conceptual_evidence_required",
  "intent_only_correction_not_evidence",
  "copied_or_unsupported_evidence_rejected",
  "non_conceptual_interaction_not_profile_eligible",
  "latest_valid_evidence_updates_profile",
  "regression_reopens_profile",
  "prior_profile_preserved",
  "unresolved_profile_initialized",
  "sound_update_eligible",
  "sound_blocked_by_missing_link_or_contradiction"
]);

export const ConceptualEvidenceUpdateSourceResolutionV1Schema = z.object({
  resolver_version: z.literal(CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  conceptual_evidence_source: z.enum([
    "ordinary_evaluator_evidence",
    "self_correction_evidence",
    "no_eligible_conceptual_evidence"
  ]),
  conceptual_evidence_update: z.boolean(),
  self_correction_intent: z.boolean(),
  self_correction_evidence_context: z.enum([
    "not_applicable",
    "intent_only",
    "copied_or_insufficient",
    "eligible_conceptual_evidence",
    "contradictory_conceptual_evidence"
  ]),
  profile_update_eligible: z.boolean(),
  profile_update_disposition: ProfileUpdateDispositionV1Schema,
  observable_evidence_present: z.boolean(),
  independently_evaluated_evidence_present: z.boolean(),
  sound_update_eligible: z.boolean(),
  intent_and_conceptual_evidence_decoupled: z.literal(true),
  ordinary_evidence_independent_of_self_correction_flags: z.literal(true),
  reason_codes:
    z.array(ConceptualEvidenceUpdateReasonCodeV1Schema).min(2).max(16)
}).strict();
export type ConceptualEvidenceUpdateSourceResolutionV1 = z.infer<
  typeof ConceptualEvidenceUpdateSourceResolutionV1Schema
>;

export const ConceptualEvidenceUpdateSourceContractV1Schema = z.object({
  contract_version: z.literal(CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION),
  separation_policy: z.object({
    ordinary_conceptual_evidence_uses_evaluator_source: z.literal(true),
    self_correction_intent_is_not_conceptual_evidence: z.literal(true),
    self_correction_evidence_context_applies_only_to_correction_turns:
      z.literal(true),
    copied_or_unsupported_language_cannot_update_profile: z.literal(true),
    accepted_partial_or_misconception_evidence_may_update_profile:
      z.literal(true),
    latest_valid_evidence_controls_longitudinal_current_profile:
      z.literal(true)
  }).strict(),
  stopping_boundary: z.object({
    sound_profile_must_reach_unchanged_stopping_policy: z.literal(true),
    sound_evidence_cannot_leave_stale_partial_current_profile:
      z.literal(true),
    correction_does_not_modify_sound_gate_criteria: z.literal(true)
  }).strict()
}).strict();

export function buildConceptualEvidenceUpdateSourceContractV1() {
  return ConceptualEvidenceUpdateSourceContractV1Schema.parse({
    contract_version: CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
    separation_policy: {
      ordinary_conceptual_evidence_uses_evaluator_source: true,
      self_correction_intent_is_not_conceptual_evidence: true,
      self_correction_evidence_context_applies_only_to_correction_turns: true,
      copied_or_unsupported_language_cannot_update_profile: true,
      accepted_partial_or_misconception_evidence_may_update_profile: true,
      latest_valid_evidence_controls_longitudinal_current_profile: true
    },
    stopping_boundary: {
      sound_profile_must_reach_unchanged_stopping_policy: true,
      sound_evidence_cannot_leave_stale_partial_current_profile: true,
      correction_does_not_modify_sound_gate_criteria: true
    }
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function selfCorrectionContext(
  input: ConceptualEvidenceUpdateSourceInputV1
): ConceptualEvidenceUpdateSourceResolutionV1[
  "self_correction_evidence_context"
] {
  const context = input.self_correction_context;
  if (!context.self_correction_intent) return "not_applicable";
  if (!context.conceptual_evidence_update) {
    return context.conceptual_evidence_quality === "copied_insufficient"
      ? "copied_or_insufficient"
      : "intent_only";
  }
  return context.conceptual_evidence_quality === "contradictory"
    ? "contradictory_conceptual_evidence"
    : "eligible_conceptual_evidence";
}

export function resolveConceptualEvidenceUpdateSourceV1(
  rawInput: ConceptualEvidenceUpdateSourceInputV1
): ConceptualEvidenceUpdateSourceResolutionV1 {
  const input = ConceptualEvidenceUpdateSourceInputV1Schema.parse(rawInput);
  const evaluator = input.evaluator_evidence;
  const correction = input.self_correction_context;
  const evaluatorAccepted =
    evaluator.validation_status === "accepted" &&
    evaluator.conceptual_evidence_applicable &&
    evaluator.reasoning_quality !== "insufficient" &&
    evaluator.observable_evidence_span_count > 0 &&
    [
      "update_from_latest_evidence",
      "reopen_from_latest_contradiction"
    ].includes(evaluator.mapped_update_disposition);
  const ordinaryUpdate =
    input.interaction_kind === "ordinary_conceptual_response" &&
    evaluatorAccepted;
  const selfCorrectionUpdate =
    input.interaction_kind === "self_correction" &&
    correction.self_correction_intent &&
    correction.conceptual_evidence_update &&
    correction.observable_conceptual_evidence_present &&
    correction.independent_conceptual_evidence_present &&
    evaluatorAccepted;
  const conceptualUpdate = ordinaryUpdate || selfCorrectionUpdate;
  const regression =
    conceptualUpdate &&
    evaluator.mapped_update_disposition ===
      "reopen_from_latest_contradiction";
  const disposition = conceptualUpdate
    ? regression
      ? "reopen_from_latest_contradiction" as const
      : "update_from_latest_evidence" as const
    : input.prior_profile_present
      ? "preserve_prior_profile" as const
      : "initialize_unresolved_profile" as const;
  const sound =
    conceptualUpdate &&
    evaluator.reasoning_quality === "sound" &&
    evaluator.anchor_application === "explicit" &&
    evaluator.anchor_stance === "rejects_distractor" &&
    evaluator.anchor_consistency ===
      "consistent_with_conceptual_reasoning" &&
    evaluator.misconception_status === "resolved_for_current_anchor" &&
    evaluator.essential_missing_link_count === 0 &&
    evaluator.contradiction_count === 0;
  const source = ordinaryUpdate
    ? "ordinary_evaluator_evidence" as const
    : selfCorrectionUpdate
      ? "self_correction_evidence" as const
      : "no_eligible_conceptual_evidence" as const;
  const reasons: Array<
    z.infer<typeof ConceptualEvidenceUpdateReasonCodeV1Schema>
  > = [
    "self_correction_intent_separate",
    "accepted_evaluator_evidence_required"
  ];
  if (ordinaryUpdate) {
    reasons.push(
      "ordinary_evaluator_evidence_selected",
      "self_correction_context_not_authoritative_for_ordinary_response"
    );
  } else if (selfCorrectionUpdate) {
    reasons.push("self_correction_evidence_selected");
  }
  if (evaluator.observable_evidence_span_count === 0) {
    reasons.push("observable_conceptual_evidence_required");
  }
  if (
    evaluator.validation_status === "rejected_copied_language" ||
    evaluator.validation_status === "rejected_unsupported_claim"
  ) {
    reasons.push("copied_or_unsupported_evidence_rejected");
  }
  if (
    input.interaction_kind === "self_correction" &&
    !correction.conceptual_evidence_update
  ) {
    reasons.push("intent_only_correction_not_evidence");
  }
  if ([
    "reflection_or_uncertainty",
    "unsupported_understanding_claim",
    "non_conceptual_response"
  ].includes(input.interaction_kind)) {
    reasons.push("non_conceptual_interaction_not_profile_eligible");
  }
  if (conceptualUpdate) {
    reasons.push(
      regression
        ? "regression_reopens_profile"
        : "latest_valid_evidence_updates_profile"
    );
  } else {
    reasons.push(
      input.prior_profile_present
        ? "prior_profile_preserved"
        : "unresolved_profile_initialized"
    );
  }
  if (sound) {
    reasons.push("sound_update_eligible");
  } else if (
    conceptualUpdate &&
    (
      evaluator.essential_missing_link_count > 0 ||
      evaluator.contradiction_count > 0
    )
  ) {
    reasons.push("sound_blocked_by_missing_link_or_contradiction");
  }

  return ConceptualEvidenceUpdateSourceResolutionV1Schema.parse({
    resolver_version: CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    conceptual_evidence_source: source,
    conceptual_evidence_update: conceptualUpdate,
    self_correction_intent: correction.self_correction_intent,
    self_correction_evidence_context: selfCorrectionContext(input),
    profile_update_eligible: conceptualUpdate,
    profile_update_disposition: disposition,
    observable_evidence_present:
      conceptualUpdate && evaluator.observable_evidence_span_count > 0,
    independently_evaluated_evidence_present:
      conceptualUpdate && evaluator.validation_status === "accepted",
    sound_update_eligible: sound,
    intent_and_conceptual_evidence_decoupled: true,
    ordinary_evidence_independent_of_self_correction_flags: true,
    reason_codes: unique(reasons)
  });
}

export function learningObservationUpdateFlagsFromSourceV1(
  resolution: ConceptualEvidenceUpdateSourceResolutionV1
) {
  const parsed = ConceptualEvidenceUpdateSourceResolutionV1Schema.parse(
    resolution
  );
  return {
    self_correction_intent: parsed.self_correction_intent,
    conceptual_evidence_update: parsed.conceptual_evidence_update,
    profile_update_eligible: parsed.profile_update_eligible,
    observable_evidence_present: parsed.observable_evidence_present,
    independent_evidence_present:
      parsed.independently_evaluated_evidence_present
  };
}
