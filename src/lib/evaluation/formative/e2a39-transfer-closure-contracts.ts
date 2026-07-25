import { createHash } from "node:crypto";
import { z } from "zod";

export const TRANSFER_EVIDENCE_CONTRACT_VERSION =
  "transfer-evidence-contract-v1" as const;
export const TRANSFER_READINESS_PROFILE_VERSION =
  "transfer-readiness-profile-v1" as const;
export const EPISODE_CLOSURE_POLICY_VERSION =
  "episode-closure-policy-v1" as const;
export const STUDENT_FACING_CLOSURE_LANGUAGE_VERSION =
  "student-facing-closure-language-v1" as const;

const ConfidenceAlignmentSchema = z.enum([
  "not_assessable",
  "aligned",
  "confidence_exceeds_evidence",
  "confidence_below_evidence"
]);

const StudentQuestionKindSchema = z.enum([
  "none",
  "legitimate_transfer_question",
  "unrelated_question"
]);

export const TransferEvidenceInputV1Schema = z.object({
  evidence_id: z.string().min(1),
  sequence_index: z.number().int().positive(),
  context_kind: z.enum(["original_context", "novel_context"]),
  response_form: z.enum([
    "independent_explanation",
    "definition_only",
    "copied_definition",
    "application_attempt",
    "student_question",
    "unrelated_response"
  ]),
  conceptual_understanding: z.enum([
    "unresolved",
    "misconception",
    "partial",
    "sound"
  ]),
  novel_context_application: z.enum([
    "not_observed",
    "incorrect",
    "partial",
    "successful"
  ]),
  mechanism_preservation: z.enum([
    "not_observed",
    "lost",
    "partial",
    "preserved"
  ]),
  surface_feature_independence: z.enum([
    "not_observed",
    "surface_bound",
    "partial",
    "demonstrated"
  ]),
  conclusion_quality: z.enum([
    "incoherent",
    "contradictory",
    "partial",
    "coherent"
  ]),
  misconception_recurrence: z.enum([
    "not_observed",
    "possible",
    "confirmed"
  ]),
  confidence_alignment: ConfidenceAlignmentSchema,
  observable_evidence_span_count: z.number().int().nonnegative(),
  copied_definition_detected: z.boolean(),
  student_question_kind: StudentQuestionKindSchema
}).strict();
export type TransferEvidenceInputV1 = z.infer<
  typeof TransferEvidenceInputV1Schema
>;

const TransferEvidenceReasonCodeSchema = z.enum([
  "original_sound_evidence_present",
  "novel_context_application_observed",
  "novel_context_application_successful",
  "mechanism_preserved",
  "surface_features_distinguished",
  "coherent_conclusion",
  "copied_definition_not_transfer",
  "definition_only_requires_application",
  "application_incomplete",
  "mechanism_not_preserved",
  "surface_bound_reasoning",
  "misconception_recurred",
  "observable_evidence_required",
  "legitimate_transfer_question_not_evidence",
  "unrelated_question_not_evidence"
]);

export const TransferEvidenceResolutionV1Schema = z.object({
  contract_version: z.literal(TRANSFER_EVIDENCE_CONTRACT_VERSION),
  evidence_id: z.string().min(1),
  sequence_index: z.number().int().positive(),
  original_conceptual_sound: z.boolean(),
  transfer_evidence_present: z.boolean(),
  transfer_ready: z.boolean(),
  conceptual_generalization: z.enum([
    "not_assessed",
    "definition_only",
    "context_bound",
    "generalized"
  ]),
  application_to_novel_context: z.enum([
    "not_assessed",
    "failed",
    "partial",
    "successful"
  ]),
  mechanism_preservation: z.enum([
    "not_assessed",
    "not_preserved",
    "partial",
    "preserved"
  ]),
  surface_feature_independence: z.enum([
    "not_assessed",
    "surface_bound",
    "partial",
    "demonstrated"
  ]),
  misconception_recurrence: z.enum([
    "not_observed",
    "possible",
    "confirmed"
  ]),
  confidence_alignment: ConfidenceAlignmentSchema,
  evidence_update_eligible: z.boolean(),
  application_evidence_needed: z.boolean(),
  copied_definition_blocked: z.boolean(),
  student_question_kind: StudentQuestionKindSchema,
  exact_wording_required: z.literal(false),
  textbook_phrase_required: z.literal(false),
  identical_example_required: z.literal(false),
  reason_codes: z.array(TransferEvidenceReasonCodeSchema).min(1).max(16)
}).strict();
export type TransferEvidenceResolutionV1 = z.infer<
  typeof TransferEvidenceResolutionV1Schema
>;

export const TransferEvidenceContractV1Schema = z.object({
  contract_version: z.literal(TRANSFER_EVIDENCE_CONTRACT_VERSION),
  required_evidence: z.array(z.enum([
    "novel_context_application",
    "underlying_mechanism_preservation",
    "surface_feature_independence",
    "coherent_conclusion"
  ])).length(4),
  nonrequirements: z.array(z.enum([
    "exact_wording",
    "textbook_phrases",
    "identical_examples"
  ])).length(3),
  safeguards: z.object({
    copied_definition_is_not_transfer: z.literal(true),
    definition_without_application_is_not_transfer: z.literal(true),
    misconception_recurrence_blocks_transfer: z.literal(true),
    ordinary_sound_does_not_force_transfer: z.literal(true),
    latest_valid_evidence_controls_readiness: z.literal(true)
  }).strict()
}).strict();

export function buildTransferEvidenceContractV1() {
  return TransferEvidenceContractV1Schema.parse({
    contract_version: TRANSFER_EVIDENCE_CONTRACT_VERSION,
    required_evidence: [
      "novel_context_application",
      "underlying_mechanism_preservation",
      "surface_feature_independence",
      "coherent_conclusion"
    ],
    nonrequirements: [
      "exact_wording",
      "textbook_phrases",
      "identical_examples"
    ],
    safeguards: {
      copied_definition_is_not_transfer: true,
      definition_without_application_is_not_transfer: true,
      misconception_recurrence_blocks_transfer: true,
      ordinary_sound_does_not_force_transfer: true,
      latest_valid_evidence_controls_readiness: true
    }
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function resolveTransferEvidenceV1(
  rawInput: TransferEvidenceInputV1
): TransferEvidenceResolutionV1 {
  const input = TransferEvidenceInputV1Schema.parse(rawInput);
  const observable = input.observable_evidence_span_count > 0;
  const originalSound =
    input.context_kind === "original_context" &&
    input.response_form === "independent_explanation" &&
    input.conceptual_understanding === "sound" &&
    input.conclusion_quality === "coherent" &&
    observable &&
    !input.copied_definition_detected &&
    input.misconception_recurrence !== "confirmed";
  const novelEvidence =
    input.context_kind === "novel_context" &&
    input.response_form === "application_attempt" &&
    observable &&
    !input.copied_definition_detected;
  const transferReady =
    novelEvidence &&
    input.conceptual_understanding === "sound" &&
    input.novel_context_application === "successful" &&
    input.mechanism_preservation === "preserved" &&
    input.surface_feature_independence === "demonstrated" &&
    input.conclusion_quality === "coherent" &&
    input.misconception_recurrence === "not_observed";
  const questionOnly = input.response_form === "student_question";
  const copiedOrDefinition =
    input.copied_definition_detected ||
    input.response_form === "copied_definition" ||
    input.response_form === "definition_only";
  const evidenceUpdateEligible =
    (originalSound || novelEvidence) &&
    !questionOnly &&
    input.response_form !== "unrelated_response";
  const generalization = transferReady
    ? "generalized" as const
    : copiedOrDefinition
      ? "definition_only" as const
      : input.context_kind === "novel_context" && novelEvidence
        ? "context_bound" as const
        : "not_assessed" as const;
  const application = input.context_kind !== "novel_context"
    ? "not_assessed" as const
    : input.novel_context_application === "successful"
      ? "successful" as const
      : input.novel_context_application === "partial"
        ? "partial" as const
        : "failed" as const;
  const mechanism = input.context_kind !== "novel_context"
    ? "not_assessed" as const
    : input.mechanism_preservation === "preserved"
      ? "preserved" as const
      : input.mechanism_preservation === "partial"
        ? "partial" as const
        : "not_preserved" as const;
  const surface = input.context_kind !== "novel_context"
    ? "not_assessed" as const
    : input.surface_feature_independence === "demonstrated"
      ? "demonstrated" as const
      : input.surface_feature_independence === "partial"
        ? "partial" as const
        : "surface_bound" as const;
  const reasons: Array<z.infer<typeof TransferEvidenceReasonCodeSchema>> = [];
  if (originalSound) reasons.push("original_sound_evidence_present");
  if (novelEvidence) reasons.push("novel_context_application_observed");
  if (transferReady) {
    reasons.push(
      "novel_context_application_successful",
      "mechanism_preserved",
      "surface_features_distinguished",
      "coherent_conclusion"
    );
  }
  if (copiedOrDefinition) {
    reasons.push(
      input.copied_definition_detected ||
      input.response_form === "copied_definition"
        ? "copied_definition_not_transfer"
        : "definition_only_requires_application"
    );
  }
  if (
    input.context_kind === "novel_context" &&
    input.novel_context_application !== "successful"
  ) {
    reasons.push("application_incomplete");
  }
  if (
    input.context_kind === "novel_context" &&
    input.mechanism_preservation !== "preserved"
  ) {
    reasons.push("mechanism_not_preserved");
  }
  if (
    input.context_kind === "novel_context" &&
    input.surface_feature_independence !== "demonstrated"
  ) {
    reasons.push("surface_bound_reasoning");
  }
  if (input.misconception_recurrence === "confirmed") {
    reasons.push("misconception_recurred");
  }
  if (!observable) reasons.push("observable_evidence_required");
  if (input.student_question_kind === "legitimate_transfer_question") {
    reasons.push("legitimate_transfer_question_not_evidence");
  }
  if (input.student_question_kind === "unrelated_question") {
    reasons.push("unrelated_question_not_evidence");
  }

  return TransferEvidenceResolutionV1Schema.parse({
    contract_version: TRANSFER_EVIDENCE_CONTRACT_VERSION,
    evidence_id: input.evidence_id,
    sequence_index: input.sequence_index,
    original_conceptual_sound: originalSound,
    transfer_evidence_present: novelEvidence,
    transfer_ready: transferReady,
    conceptual_generalization: generalization,
    application_to_novel_context: application,
    mechanism_preservation: mechanism,
    surface_feature_independence: surface,
    misconception_recurrence: input.misconception_recurrence,
    confidence_alignment: input.confidence_alignment,
    evidence_update_eligible: evidenceUpdateEligible,
    application_evidence_needed:
      copiedOrDefinition ||
      (input.context_kind === "novel_context" && !transferReady),
    copied_definition_blocked: copiedOrDefinition,
    student_question_kind: input.student_question_kind,
    exact_wording_required: false,
    textbook_phrase_required: false,
    identical_example_required: false,
    reason_codes: unique(
      reasons.length > 0 ? reasons : ["observable_evidence_required"]
    )
  });
}

export const TransferReadinessProfileSnapshotV1Schema = z.object({
  profile_version: z.literal(TRANSFER_READINESS_PROFILE_VERSION),
  snapshot_id: z.string().min(1),
  source_evidence_id: z.string().min(1),
  sequence_index: z.number().int().positive(),
  conceptual_generalization: z.enum([
    "not_assessed",
    "definition_only",
    "context_bound",
    "generalized"
  ]),
  application_to_novel_context: z.enum([
    "not_assessed",
    "failed",
    "partial",
    "successful"
  ]),
  mechanism_preservation: z.enum([
    "not_assessed",
    "not_preserved",
    "partial",
    "preserved"
  ]),
  misconception_recurrence: z.enum([
    "not_observed",
    "possible",
    "confirmed"
  ]),
  confidence_alignment: ConfidenceAlignmentSchema,
  transfer_ready: z.boolean(),
  profile_update_eligible: z.boolean(),
  created_at: z.string().datetime()
}).strict();
export type TransferReadinessProfileSnapshotV1 = z.infer<
  typeof TransferReadinessProfileSnapshotV1Schema
>;

export const TransferReadinessProfileEvolutionV1Schema = z.object({
  profile_version: z.literal(TRANSFER_READINESS_PROFILE_VERSION),
  current_snapshot_id: z.string().min(1),
  latest_observation_snapshot_id: z.string().min(1),
  current_snapshot: TransferReadinessProfileSnapshotV1Schema,
  history: z.array(TransferReadinessProfileSnapshotV1Schema).min(1).max(32),
  successful_transfer_snapshot_ids: z.array(z.string().min(1)).max(32),
  misconception_reopened_count: z.number().int().nonnegative(),
  latest_valid_evidence_precedence: z.literal(true),
  successful_transfer_can_be_reopened: z.literal(true)
}).strict();
export type TransferReadinessProfileEvolutionV1 = z.infer<
  typeof TransferReadinessProfileEvolutionV1Schema
>;

export const TransferReadinessProfileContractV1Schema = z.object({
  profile_version: z.literal(TRANSFER_READINESS_PROFILE_VERSION),
  tracked_dimensions: z.array(z.enum([
    "conceptual_generalization",
    "application_to_novel_context",
    "mechanism_preservation",
    "misconception_recurrence",
    "confidence_alignment"
  ])).length(5),
  update_policy: z.object({
    latest_valid_evidence_has_precedence: z.literal(true),
    copied_definition_cannot_mark_ready: z.literal(true),
    successful_transfer_can_be_reopened_by_regression: z.literal(true),
    confidence_is_context_not_mastery: z.literal(true)
  }).strict()
}).strict();

export function buildTransferReadinessProfileContractV1() {
  return TransferReadinessProfileContractV1Schema.parse({
    profile_version: TRANSFER_READINESS_PROFILE_VERSION,
    tracked_dimensions: [
      "conceptual_generalization",
      "application_to_novel_context",
      "mechanism_preservation",
      "misconception_recurrence",
      "confidence_alignment"
    ],
    update_policy: {
      latest_valid_evidence_has_precedence: true,
      copied_definition_cannot_mark_ready: true,
      successful_transfer_can_be_reopened_by_regression: true,
      confidence_is_context_not_mastery: true
    }
  });
}

export function createTransferReadinessSnapshotV1(
  resolution: TransferEvidenceResolutionV1,
  createdAt = "2026-01-01T00:00:00.000Z"
) {
  const parsed = TransferEvidenceResolutionV1Schema.parse(resolution);
  const core = {
    source_evidence_id: parsed.evidence_id,
    sequence_index: parsed.sequence_index,
    conceptual_generalization: parsed.conceptual_generalization,
    application_to_novel_context: parsed.application_to_novel_context,
    mechanism_preservation: parsed.mechanism_preservation,
    misconception_recurrence: parsed.misconception_recurrence,
    confidence_alignment: parsed.confidence_alignment,
    transfer_ready: parsed.transfer_ready,
    profile_update_eligible: parsed.evidence_update_eligible,
    created_at: createdAt
  };
  return TransferReadinessProfileSnapshotV1Schema.parse({
    profile_version: TRANSFER_READINESS_PROFILE_VERSION,
    snapshot_id: `trp_${createHash("sha256")
      .update(JSON.stringify(core))
      .digest("hex")
      .slice(0, 24)}`,
    ...core
  });
}

export function evolveTransferReadinessProfileV1(input: {
  prior: TransferReadinessProfileEvolutionV1 | null;
  observation: TransferReadinessProfileSnapshotV1;
}) {
  const observation = TransferReadinessProfileSnapshotV1Schema.parse(
    input.observation
  );
  const prior = input.prior
    ? TransferReadinessProfileEvolutionV1Schema.parse(input.prior)
    : null;
  const current = observation.profile_update_eligible || !prior
    ? observation
    : prior.current_snapshot;
  const reopened = Boolean(
    prior?.current_snapshot.transfer_ready &&
    observation.profile_update_eligible &&
    (
      !observation.transfer_ready ||
      observation.misconception_recurrence === "confirmed"
    )
  );
  return TransferReadinessProfileEvolutionV1Schema.parse({
    profile_version: TRANSFER_READINESS_PROFILE_VERSION,
    current_snapshot_id: current.snapshot_id,
    latest_observation_snapshot_id: observation.snapshot_id,
    current_snapshot: current,
    history: [...(prior?.history ?? []), observation],
    successful_transfer_snapshot_ids: [
      ...(prior?.successful_transfer_snapshot_ids ?? []),
      ...(observation.transfer_ready ? [observation.snapshot_id] : [])
    ],
    misconception_reopened_count:
      (prior?.misconception_reopened_count ?? 0) + (reopened ? 1 : 0),
    latest_valid_evidence_precedence: true,
    successful_transfer_can_be_reopened: true
  });
}

const ClosureOutcomeSchema = z.enum([
  "close_after_sound",
  "close_after_transfer",
  "continue_learning",
  "instructor_next_step"
]);

const ClosureMessageByOutcome = {
  close_after_sound:
    "Your explanation captures the key distinction. You are ready to apply this understanding.",
  close_after_transfer:
    "You successfully applied the idea to a new situation.",
  continue_learning:
    "Let's examine the remaining distinction before moving on.",
  instructor_next_step:
    "Summarizing this distinction may help guide a useful discussion with your instructor."
} as const;

const ClosureQuestionMessageByKind = {
  none: null,
  legitimate_transfer_question:
    "Let's use that question to examine how the distinction applies in this situation.",
  unrelated_question:
    "Let's stay with how reliability and validity apply in this situation."
} as const;

export const EpisodeClosureInputV1Schema = z.object({
  decision_id: z.string().min(1),
  base_conceptual_sound: z.boolean(),
  base_stopping_signal: z.enum([
    "stop_formative_dialogue",
    "continue_dialogue",
    "instructor_next_step"
  ]),
  transfer_was_requested: z.boolean(),
  transfer_profile: TransferReadinessProfileEvolutionV1Schema.nullable(),
  copied_definition_detected: z.boolean(),
  essential_missing_link_count: z.number().int().nonnegative(),
  blocking_contradiction_count: z.number().int().nonnegative(),
  student_question_kind: StudentQuestionKindSchema,
  instructor_next_step_eligible: z.boolean()
}).strict();
export type EpisodeClosureInputV1 = z.infer<
  typeof EpisodeClosureInputV1Schema
>;

export const EpisodeClosureDecisionV1Schema = z.object({
  policy_version: z.literal(EPISODE_CLOSURE_POLICY_VERSION),
  decision_id: z.string().min(1),
  outcome: ClosureOutcomeSchema,
  episode_closed: z.boolean(),
  transfer_required_for_closure: z.literal(false),
  transfer_was_requested: z.boolean(),
  transfer_ready: z.boolean(),
  misconception_reopened: z.boolean(),
  tutor_dispatch_allowed: z.boolean(),
  instructor_next_step: z.boolean(),
  question_handling: z.enum([
    "none",
    "continue_with_legitimate_transfer_question",
    "redirect_unrelated_without_evidence_update"
  ]),
  student_facing_message: z.string().min(1).max(300),
  student_facing_question_message: z.string().min(1).max(300).nullable(),
  fixed_turn_count_used: z.literal(false),
  mandatory_transfer_used: z.literal(false),
  internal_state_exposed: z.literal(false)
}).strict();
export type EpisodeClosureDecisionV1 = z.infer<
  typeof EpisodeClosureDecisionV1Schema
>;

export const EpisodeClosurePolicyContractV1Schema = z.object({
  policy_version: z.literal(EPISODE_CLOSURE_POLICY_VERSION),
  outcomes: z.array(ClosureOutcomeSchema).length(4),
  policy: z.object({
    sound_may_close_without_transfer: z.literal(true),
    transfer_is_never_mandatory: z.literal(true),
    successful_transfer_may_close: z.literal(true),
    copied_definition_cannot_close: z.literal(true),
    transfer_regression_reopens: z.literal(true),
    fixed_turn_count_is_not_authoritative: z.literal(true),
    additional_tutor_after_closure_prohibited: z.literal(true),
    application_controls_closure: z.literal(true)
  }).strict()
}).strict();

export function buildEpisodeClosurePolicyContractV1() {
  return EpisodeClosurePolicyContractV1Schema.parse({
    policy_version: EPISODE_CLOSURE_POLICY_VERSION,
    outcomes: [
      "close_after_sound",
      "close_after_transfer",
      "continue_learning",
      "instructor_next_step"
    ],
    policy: {
      sound_may_close_without_transfer: true,
      transfer_is_never_mandatory: true,
      successful_transfer_may_close: true,
      copied_definition_cannot_close: true,
      transfer_regression_reopens: true,
      fixed_turn_count_is_not_authoritative: true,
      additional_tutor_after_closure_prohibited: true,
      application_controls_closure: true
    }
  });
}

export const StudentFacingClosureLanguageContractV1Schema = z.object({
  language_version: z.literal(STUDENT_FACING_CLOSURE_LANGUAGE_VERSION),
  messages: z.object({
    close_after_sound: z.literal(
      ClosureMessageByOutcome.close_after_sound
    ),
    close_after_transfer: z.literal(
      ClosureMessageByOutcome.close_after_transfer
    ),
    continue_learning: z.literal(
      ClosureMessageByOutcome.continue_learning
    ),
    instructor_next_step: z.literal(
      ClosureMessageByOutcome.instructor_next_step
    )
  }).strict(),
  prohibited_categories: z.array(z.enum([
    "mastery_label",
    "transfer_score",
    "closure_rule",
    "profile_field",
    "turn_requirement",
    "internal_routing"
  ])).length(6),
  internal_language_prohibited: z.literal(true)
}).strict();

export function buildStudentFacingClosureLanguageContractV1() {
  return StudentFacingClosureLanguageContractV1Schema.parse({
    language_version: STUDENT_FACING_CLOSURE_LANGUAGE_VERSION,
    messages: ClosureMessageByOutcome,
    prohibited_categories: [
      "mastery_label",
      "transfer_score",
      "closure_rule",
      "profile_field",
      "turn_requirement",
      "internal_routing"
    ],
    internal_language_prohibited: true
  });
}

const STUDENT_FACING_FORBIDDEN_PATTERNS = [
  /\bmaster(?:y|ed)\b/iu,
  /\btransfer[_ -]?score\b/iu,
  /\bclosure[_ -]?(?:rule|policy|decision)\b/iu,
  /\bprofile[_ -]?(?:field|state|snapshot)\b/iu,
  /\bturn[_ -]?(?:count|minimum|requirement)\b/iu,
  /\b(?:routing|runtime|schema|validator|fallback)\b/iu,
  /\b(?:sound|partial|misconception)[_ -]?(?:state|label)\b/iu
];

export function validateStudentFacingClosureTextV1(text: string) {
  const normalized = z.string().min(1).max(300).parse(text);
  const blocked = STUDENT_FACING_FORBIDDEN_PATTERNS
    .map((pattern, index) => ({
      pattern_id: `closure_forbidden_${index + 1}`,
      matched: pattern.test(normalized)
    }))
    .filter((entry) => entry.matched)
    .map((entry) => entry.pattern_id);
  return {
    language_version: STUDENT_FACING_CLOSURE_LANGUAGE_VERSION,
    passed: blocked.length === 0,
    blocked_pattern_ids: blocked,
    raw_internal_state_exposed: false
  };
}

export function decideEpisodeClosureV1(
  rawInput: EpisodeClosureInputV1
): EpisodeClosureDecisionV1 {
  const input = EpisodeClosureInputV1Schema.parse(rawInput);
  const currentTransfer = input.transfer_profile?.current_snapshot ?? null;
  const transferReady = currentTransfer?.transfer_ready ?? false;
  const misconceptionReopened =
    currentTransfer?.misconception_recurrence === "confirmed" ||
    (
      Boolean(input.transfer_profile) &&
      (input.transfer_profile?.misconception_reopened_count ?? 0) > 0 &&
      !transferReady
    );
  const blocked =
    input.copied_definition_detected ||
    input.essential_missing_link_count > 0 ||
    input.blocking_contradiction_count > 0 ||
    misconceptionReopened;
  const legitimateQuestion =
    input.student_question_kind === "legitimate_transfer_question";
  const instructorNext =
    input.instructor_next_step_eligible &&
    input.base_stopping_signal === "instructor_next_step";
  let outcome: z.infer<typeof ClosureOutcomeSchema>;
  if (instructorNext) {
    outcome = "instructor_next_step";
  } else if (
    blocked ||
    legitimateQuestion ||
    input.base_stopping_signal === "continue_dialogue" ||
    !input.base_conceptual_sound
  ) {
    outcome = "continue_learning";
  } else if (input.transfer_was_requested) {
    outcome = transferReady
      ? "close_after_transfer"
      : "continue_learning";
  } else {
    outcome = "close_after_sound";
  }
  const episodeClosed = [
    "close_after_sound",
    "close_after_transfer"
  ].includes(outcome);
  const questionHandling = input.student_question_kind ===
      "legitimate_transfer_question"
    ? "continue_with_legitimate_transfer_question" as const
    : input.student_question_kind === "unrelated_question"
      ? "redirect_unrelated_without_evidence_update" as const
      : "none" as const;
  const decision = EpisodeClosureDecisionV1Schema.parse({
    policy_version: EPISODE_CLOSURE_POLICY_VERSION,
    decision_id: input.decision_id,
    outcome,
    episode_closed: episodeClosed,
    transfer_required_for_closure: false,
    transfer_was_requested: input.transfer_was_requested,
    transfer_ready: transferReady,
    misconception_reopened: misconceptionReopened,
    tutor_dispatch_allowed: outcome === "continue_learning",
    instructor_next_step: outcome === "instructor_next_step",
    question_handling: questionHandling,
    student_facing_message: ClosureMessageByOutcome[outcome],
    student_facing_question_message:
      ClosureQuestionMessageByKind[input.student_question_kind],
    fixed_turn_count_used: false,
    mandatory_transfer_used: false,
    internal_state_exposed: false
  });
  const visibleText = [
    decision.student_facing_message,
    decision.student_facing_question_message
  ].filter((value): value is string => Boolean(value));
  for (const text of visibleText) {
    const validation = validateStudentFacingClosureTextV1(text);
    if (!validation.passed) {
      throw new Error(
        `e2a39_student_facing_closure_language_rejected:${
          validation.blocked_pattern_ids.join(",")
        }`
      );
    }
  }
  if (decision.episode_closed && decision.tutor_dispatch_allowed) {
    throw new Error("e2a39_tutor_dispatch_after_closure_prohibited");
  }
  return decision;
}
