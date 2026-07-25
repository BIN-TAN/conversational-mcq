import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PEDAGOGICAL_INTERVENTION_MEMORY_VERSION
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  type SelfCorrectionConceptualEvidenceObservationV1,
  SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
  buildSelfCorrectionEvidenceContractV1,
  resolveSelfCorrectionEvidenceV1,
  resolveSelfCorrectionIntentSignalV1
} from "./self-correction-evidence-v1";
import {
  buildSelfCorrectionIntentContractV1
} from "./self-correction-intent-v1";
import {
  type TrajectoryEnvelopeContract,
  evaluateTrajectoryEnvelope
} from "./trajectory-envelope-v1";

export const E2A36_LEARNING_PROFILE_EVOLUTION_VERSION =
  "learning_profile_evolution_v1" as const;
export const E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION =
  "engagement_profile_evolution_v1" as const;
export const E2A36_INTERVENTION_MEMORY_VERSION =
  "longitudinal-intervention-memory-v1" as const;
export const E2A36_ADAPTIVE_STOPPING_POLICY_VERSION =
  "adaptive-stopping-policy-v1" as const;
export const E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION =
  "instructor-escalation-policy-v1" as const;
export const E2A36_STUDENT_FACING_COMMUNICATION_VERSION =
  "student-facing-communication-v1" as const;
export const E2A36_LONGITUDINAL_METRICS_VERSION =
  "e2a36-longitudinal-dialogue-metrics-v1" as const;

export const MeasurementConceptFamilySchema = z.enum([
  "reliability_validity",
  "observed_score_error",
  "sample_dependent_statistics",
  "reliability_types",
  "standard_error_of_measurement",
  "score_comparability",
  "ctt_irt_interpretation"
]);
export type MeasurementConceptFamily = z.infer<
  typeof MeasurementConceptFamilySchema
>;

export const LearningConceptualUnderstandingSchema = z.enum([
  "unresolved",
  "misconception",
  "partial",
  "sound"
]);
export const LearningMisconceptionStatusSchema = z.enum([
  "not_assessed",
  "persists",
  "uncertain",
  "resolved_for_current_anchor"
]);
export const LearningReasoningQualitySchema = z.enum([
  "insufficient",
  "misconception",
  "partial",
  "sound"
]);
export const LearningAnchorInterpretationSchema = z.object({
  application: z.enum(["absent", "implicit", "explicit"]),
  stance: z.enum([
    "not_expressed",
    "ambiguous",
    "endorses_distractor",
    "rejects_distractor"
  ]),
  consistency: z.enum([
    "not_assessable",
    "consistent_with_conceptual_reasoning",
    "contradictory_to_conceptual_reasoning",
    "unresolved"
  ])
}).strict();

export const LearningProfileSnapshotV1Schema = z.object({
  snapshot_id: z.string().min(1),
  sequence_index: z.number().int().positive(),
  source_student_turn_id: z.string().min(1),
  concept_family: MeasurementConceptFamilySchema,
  conceptual_understanding: LearningConceptualUnderstandingSchema,
  misconception_status: LearningMisconceptionStatusSchema,
  knowledge_gap: z.string().min(1).max(700),
  reasoning_quality: LearningReasoningQualitySchema,
  anchor_interpretation: LearningAnchorInterpretationSchema,
  unresolved_contradictions: z.array(z.string().min(1).max(300)).max(16),
  missing_links: z.array(z.string().min(1).max(300)).max(16),
  transfer_readiness: z.boolean(),
  confidence_alignment: z.enum([
    "not_assessable",
    "aligned",
    "confidence_exceeds_evidence",
    "confidence_below_evidence"
  ]),
  self_correction_intent: z.boolean(),
  conceptual_evidence_update: z.boolean(),
  profile_update_eligible: z.boolean(),
  observable_evidence_present: z.boolean(),
  independent_evidence_present: z.boolean(),
  created_at: z.string().datetime()
}).strict();
export type LearningProfileSnapshotV1 = z.infer<
  typeof LearningProfileSnapshotV1Schema
>;

export const LearningProfileEvolutionV1Schema = z.object({
  evolution_version: z.literal(E2A36_LEARNING_PROFILE_EVOLUTION_VERSION),
  current_profile_snapshot_id: z.string().min(1),
  latest_observation_snapshot_id: z.string().min(1),
  current_profile: LearningProfileSnapshotV1Schema,
  trajectory_history: z.array(LearningProfileSnapshotV1Schema).min(1).max(32),
  historical_misconception_snapshot_ids:
    z.array(z.string().min(1)).max(32),
  misconception_reopened_count: z.number().int().nonnegative(),
  latest_valid_evidence_precedence: z.literal(true),
  learning_history_preserved: z.literal(true),
  correction_intent_separate_from_evidence: z.literal(true)
}).strict();
export type LearningProfileEvolutionV1 = z.infer<
  typeof LearningProfileEvolutionV1Schema
>;

export const LearningProfileEvolutionContractV1Schema = z.object({
  contract_version: z.literal(E2A36_LEARNING_PROFILE_EVOLUTION_VERSION),
  tracked_dimensions: z.array(z.enum([
    "conceptual_understanding",
    "misconception_status",
    "knowledge_gap",
    "reasoning_quality",
    "anchor_interpretation",
    "unresolved_contradictions",
    "missing_links",
    "transfer_readiness",
    "confidence_alignment"
  ])).length(9),
  update_policy: z.object({
    latest_valid_evidence_updates_current_profile: z.literal(true),
    invalid_or_intent_only_evidence_preserves_current_profile: z.literal(true),
    historical_misconceptions_remain_in_trajectory: z.literal(true),
    sound_then_misconception_reopens_profile: z.literal(true),
    stale_sound_state_prohibited: z.literal(true)
  }).strict()
}).strict();

export function buildLearningProfileEvolutionContractV1() {
  return LearningProfileEvolutionContractV1Schema.parse({
    contract_version: E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
    tracked_dimensions: [
      "conceptual_understanding",
      "misconception_status",
      "knowledge_gap",
      "reasoning_quality",
      "anchor_interpretation",
      "unresolved_contradictions",
      "missing_links",
      "transfer_readiness",
      "confidence_alignment"
    ],
    update_policy: {
      latest_valid_evidence_updates_current_profile: true,
      invalid_or_intent_only_evidence_preserves_current_profile: true,
      historical_misconceptions_remain_in_trajectory: true,
      sound_then_misconception_reopens_profile: true,
      stale_sound_state_prohibited: true
    }
  });
}

export function createLearningProfileSnapshotV1(input: Omit<
  LearningProfileSnapshotV1,
  "snapshot_id"
> & { snapshot_id?: string }) {
  const core = {
    ...input,
    snapshot_id: undefined
  };
  return LearningProfileSnapshotV1Schema.parse({
    ...input,
    snapshot_id: input.snapshot_id ??
      `lps_${createHash("sha256").update(JSON.stringify(core))
        .digest("hex").slice(0, 24)}`
  });
}

function profileIsSound(snapshot: LearningProfileSnapshotV1) {
  return snapshot.conceptual_understanding === "sound" &&
    snapshot.reasoning_quality === "sound" &&
    snapshot.misconception_status === "resolved_for_current_anchor" &&
    snapshot.anchor_interpretation.application === "explicit" &&
    snapshot.anchor_interpretation.stance === "rejects_distractor" &&
    snapshot.anchor_interpretation.consistency ===
      "consistent_with_conceptual_reasoning" &&
    snapshot.unresolved_contradictions.length === 0 &&
    snapshot.missing_links.length === 0 &&
    snapshot.transfer_readiness;
}

function profileShowsRegression(snapshot: LearningProfileSnapshotV1) {
  return snapshot.conceptual_understanding === "misconception" ||
    snapshot.reasoning_quality === "misconception" ||
    snapshot.misconception_status === "persists" ||
    snapshot.anchor_interpretation.stance === "endorses_distractor" ||
    snapshot.anchor_interpretation.consistency ===
      "contradictory_to_conceptual_reasoning" ||
    snapshot.unresolved_contradictions.length > 0;
}

export function evolveLearningProfileV1(input: {
  prior: LearningProfileEvolutionV1 | null;
  observation: LearningProfileSnapshotV1;
}) {
  const observation = LearningProfileSnapshotV1Schema.parse(
    input.observation
  );
  if (observation.conceptual_understanding === "sound" &&
      !profileIsSound(observation)) {
    throw new Error("e2a36_sound_profile_missing_required_evidence");
  }
  const prior = input.prior
    ? LearningProfileEvolutionV1Schema.parse(input.prior)
    : null;
  const eligible = observation.profile_update_eligible &&
    observation.conceptual_evidence_update &&
    observation.observable_evidence_present &&
    observation.independent_evidence_present;
  const current = eligible || !prior
    ? observation
    : prior.current_profile;
  const reopened = Boolean(
    prior &&
    profileIsSound(prior.current_profile) &&
    eligible &&
    profileShowsRegression(observation)
  );
  return LearningProfileEvolutionV1Schema.parse({
    evolution_version: E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
    current_profile_snapshot_id: current.snapshot_id,
    latest_observation_snapshot_id: observation.snapshot_id,
    current_profile: current,
    trajectory_history: [
      ...(prior?.trajectory_history ?? []),
      observation
    ],
    historical_misconception_snapshot_ids: [
      ...(prior?.historical_misconception_snapshot_ids ?? []),
      ...(profileShowsRegression(observation)
        ? [observation.snapshot_id]
        : [])
    ],
    misconception_reopened_count:
      (prior?.misconception_reopened_count ?? 0) + (reopened ? 1 : 0),
    latest_valid_evidence_precedence: true,
    learning_history_preserved: true,
    correction_intent_separate_from_evidence: true
  });
}

export const EngagementProfileSnapshotV1Schema = z.object({
  snapshot_id: z.string().min(1),
  sequence_index: z.number().int().positive(),
  source_student_turn_id: z.string().min(1),
  participation: z.enum(["none", "minimal", "active"]),
  response_quality_trend: z.enum([
    "not_assessable",
    "declining",
    "stable",
    "improving"
  ]),
  effort: z.enum([
    "insufficient_evidence",
    "limited_observed_effort",
    "sustained_observed_effort"
  ]),
  persistence: z.enum(["not_observed", "limited", "sustained"]),
  help_seeking: z.enum(["none", "procedural", "conceptual"]),
  frustration: z.enum(["not_observed", "possible", "explicit"]),
  disengagement: z.enum(["not_observed", "possible", "sustained"]),
  responsiveness_to_intervention: z.enum([
    "not_assessable",
    "no_observable_change",
    "partial_response",
    "productive_response"
  ]),
  strategy_uptake: z.enum([
    "not_assessable",
    "not_observed",
    "partial",
    "clear"
  ]),
  evidence_basis: z.array(z.string().min(1).max(300)).min(1).max(16),
  correctness_independence: z.literal(true),
  created_at: z.string().datetime()
}).strict();
export type EngagementProfileSnapshotV1 = z.infer<
  typeof EngagementProfileSnapshotV1Schema
>;

export const EngagementProfileEvolutionV1Schema = z.object({
  evolution_version: z.literal(E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION),
  current_snapshot: EngagementProfileSnapshotV1Schema,
  trajectory_history: z.array(EngagementProfileSnapshotV1Schema).min(1).max(32),
  engagement_informs_stopping_only: z.literal(true),
  engagement_determines_correctness: z.literal(false),
  evidence_qualified_not_trait_claim: z.literal(true)
}).strict();
export type EngagementProfileEvolutionV1 = z.infer<
  typeof EngagementProfileEvolutionV1Schema
>;

export const EngagementProfileEvolutionContractV1Schema = z.object({
  contract_version: z.literal(E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION),
  tracked_dimensions: z.array(z.enum([
    "participation",
    "response_quality_trend",
    "effort",
    "persistence",
    "help_seeking",
    "frustration",
    "disengagement",
    "responsiveness_to_intervention",
    "strategy_uptake"
  ])).length(9),
  interpretation_boundary: z.object({
    process_evidence_only: z.literal(true),
    informs_stopping_decisions: z.literal(true),
    never_determines_correctness: z.literal(true),
    never_student_visible_as_internal_label: z.literal(true),
    never_interpreted_as_stable_trait: z.literal(true)
  }).strict()
}).strict();

export function buildEngagementProfileEvolutionContractV1() {
  return EngagementProfileEvolutionContractV1Schema.parse({
    contract_version: E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
    tracked_dimensions: [
      "participation",
      "response_quality_trend",
      "effort",
      "persistence",
      "help_seeking",
      "frustration",
      "disengagement",
      "responsiveness_to_intervention",
      "strategy_uptake"
    ],
    interpretation_boundary: {
      process_evidence_only: true,
      informs_stopping_decisions: true,
      never_determines_correctness: true,
      never_student_visible_as_internal_label: true,
      never_interpreted_as_stable_trait: true
    }
  });
}

export function createEngagementProfileSnapshotV1(input: Omit<
  EngagementProfileSnapshotV1,
  "snapshot_id" | "correctness_independence"
> & { snapshot_id?: string }) {
  const core = {
    ...input,
    snapshot_id: undefined
  };
  return EngagementProfileSnapshotV1Schema.parse({
    ...input,
    snapshot_id: input.snapshot_id ??
      `eps_${createHash("sha256").update(JSON.stringify(core))
        .digest("hex").slice(0, 24)}`,
    correctness_independence: true
  });
}

export function evolveEngagementProfileV1(input: {
  prior: EngagementProfileEvolutionV1 | null;
  observation: EngagementProfileSnapshotV1;
}) {
  const observation = EngagementProfileSnapshotV1Schema.parse(
    input.observation
  );
  const prior = input.prior
    ? EngagementProfileEvolutionV1Schema.parse(input.prior)
    : null;
  return EngagementProfileEvolutionV1Schema.parse({
    evolution_version: E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
    current_snapshot: observation,
    trajectory_history: [
      ...(prior?.trajectory_history ?? []),
      observation
    ],
    engagement_informs_stopping_only: true,
    engagement_determines_correctness: false,
    evidence_qualified_not_trait_claim: true
  });
}

export const LongitudinalInterventionOutcomeSchema = z.enum([
  "awaiting_response",
  "no_new_evidence",
  "misconception_persists",
  "partial_improvement",
  "sound_understanding",
  "recurrence",
  "task_confusion",
  "engagement_support_needed"
]);

export const LongitudinalInterventionRecordV1Schema = z.object({
  memory_version: z.literal(E2A36_INTERVENTION_MEMORY_VERSION),
  base_memory_version: z.literal(PEDAGOGICAL_INTERVENTION_MEMORY_VERSION),
  intervention_id: z.string().min(1),
  sequence_index: z.number().int().positive(),
  strategy: z.string().min(1).max(160),
  targeted_gap: z.string().min(1).max(500),
  evidence_sought: z.array(z.string().min(1).max(300)).min(1).max(12),
  student_response_evidence_summary: z.string().min(1).max(700),
  observed_outcome: LongitudinalInterventionOutcomeSchema,
  changed_understanding: z.boolean(),
  effective_for_target_gap: z.boolean(),
  created_at: z.string().datetime()
}).strict();
export type LongitudinalInterventionRecordV1 = z.infer<
  typeof LongitudinalInterventionRecordV1Schema
>;

export const LongitudinalInterventionMemoryContractV1Schema = z.object({
  contract_version: z.literal(E2A36_INTERVENTION_MEMORY_VERSION),
  base_runtime_memory_version:
    z.literal(PEDAGOGICAL_INTERVENTION_MEMORY_VERSION),
  required_memory: z.array(z.enum([
    "previous_strategy",
    "targeted_gap",
    "evidence_sought",
    "student_response",
    "understanding_change"
  ])).length(5),
  selection_policy: z.object({
    ineffective_strategy_repetition_prohibited: z.literal(true),
    same_strategy_same_gap_requires_new_evidence_rationale: z.literal(true),
    strategy_selected_from_current_gap_and_history: z.literal(true),
    fixed_strategy_count_stopping_prohibited: z.literal(true)
  }).strict()
}).strict();

export function buildLongitudinalInterventionMemoryContractV1() {
  return LongitudinalInterventionMemoryContractV1Schema.parse({
    contract_version: E2A36_INTERVENTION_MEMORY_VERSION,
    base_runtime_memory_version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
    required_memory: [
      "previous_strategy",
      "targeted_gap",
      "evidence_sought",
      "student_response",
      "understanding_change"
    ],
    selection_policy: {
      ineffective_strategy_repetition_prohibited: true,
      same_strategy_same_gap_requires_new_evidence_rationale: true,
      strategy_selected_from_current_gap_and_history: true,
      fixed_strategy_count_stopping_prohibited: true
    }
  });
}

const STRATEGY_CANDIDATES = {
  reliability_validity: [
    "contrast_consistency_with_interpretation",
    "counterexample_consistent_wrong_construct",
    "evidence_claim_audit"
  ],
  observed_score_error: [
    "observed_score_error_decomposition",
    "sem_uncertainty_comparison",
    "score_difference_boundary_case"
  ],
  sample_dependent_statistics: [
    "compare_two_samples",
    "ctt_statistic_interpretation",
    "framework_contrast"
  ],
  reliability_types: [
    "match_design_to_reliability_evidence",
    "contrast_internal_consistency_and_stability",
    "evidence_source_sort"
  ],
  standard_error_of_measurement: [
    "score_band_construction",
    "measurement_uncertainty_case",
    "precision_interpretation"
  ],
  score_comparability: [
    "scale_and_form_comparability_check",
    "score_context_boundary",
    "comparability_counterexample"
  ],
  ctt_irt_interpretation: [
    "framework_assumption_contrast",
    "sample_invariance_boundary",
    "parameter_interpretation_case"
  ]
} satisfies Record<MeasurementConceptFamily, string[]>;

export function selectLongitudinalInterventionV1(input: {
  concept_family: MeasurementConceptFamily;
  targeted_gap: string;
  evidence_sought: string[];
  prior_interventions: LongitudinalInterventionRecordV1[];
}) {
  const prior = input.prior_interventions.map((entry) =>
    LongitudinalInterventionRecordV1Schema.parse(entry)
  );
  const ineffective = new Set(prior
    .filter((entry) =>
      entry.targeted_gap === input.targeted_gap &&
      !entry.effective_for_target_gap
    )
    .map((entry) => entry.strategy));
  const candidates = STRATEGY_CANDIDATES[input.concept_family];
  const strategy = candidates.find((candidate) => !ineffective.has(candidate));
  if (!strategy) {
    throw new Error("e2a36_no_nonrepeating_intervention_available");
  }
  const sequenceIndex = prior.length + 1;
  const core = {
    concept_family: input.concept_family,
    targeted_gap: input.targeted_gap,
    strategy,
    sequence_index: sequenceIndex
  };
  return LongitudinalInterventionRecordV1Schema.parse({
    memory_version: E2A36_INTERVENTION_MEMORY_VERSION,
    base_memory_version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
    intervention_id:
      `e2a36_int_${createHash("sha256").update(JSON.stringify(core))
        .digest("hex").slice(0, 20)}`,
    sequence_index: sequenceIndex,
    strategy,
    targeted_gap: input.targeted_gap,
    evidence_sought: input.evidence_sought,
    student_response_evidence_summary: "Awaiting observable student evidence.",
    observed_outcome: "awaiting_response",
    changed_understanding: false,
    effective_for_target_gap: false,
    created_at: new Date(0).toISOString()
  });
}

export const AdaptiveStoppingInternalDecisionSchema = z.enum([
  "continue_dialogue",
  "stop_formative_dialogue",
  "bounded_stop_instructor_support",
  "engagement_support_needed"
]);

export const AdaptiveStoppingPolicyContractV1Schema = z.object({
  contract_version: z.literal(E2A36_ADAPTIVE_STOPPING_POLICY_VERSION),
  authority_boundary: z.object({
    stopping_is_internal_orchestration: z.literal(true),
    provider_does_not_control_stopping: z.literal(true),
    fixed_intervention_count_stop_prohibited: z.literal(true),
    engagement_never_determines_correctness: z.literal(true)
  }).strict(),
  sound_stop_requires: z.array(z.enum([
    "conceptual_gap_resolved",
    "evidence_sufficient",
    "anchor_resolved",
    "no_essential_missing_links",
    "transfer_or_revision_ready"
  ])).length(5),
  productive_partial_continues_when: z.array(z.enum([
    "new_evidence",
    "strategy_uptake",
    "knowledge_gap_narrowing",
    "engagement_supports_learning"
  ])).length(4),
  bounded_stop_may_consider: z.array(z.enum([
    "session_budget_exhausted",
    "persistent_misconception_after_meaningful_interventions",
    "low_expected_benefit",
    "unresolved_conceptual_barrier"
  ])).length(4),
  disengagement_uses_supportive_redirect: z.literal(true)
}).strict();

export function buildAdaptiveStoppingPolicyContractV1() {
  return AdaptiveStoppingPolicyContractV1Schema.parse({
    contract_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
    authority_boundary: {
      stopping_is_internal_orchestration: true,
      provider_does_not_control_stopping: true,
      fixed_intervention_count_stop_prohibited: true,
      engagement_never_determines_correctness: true
    },
    sound_stop_requires: [
      "conceptual_gap_resolved",
      "evidence_sufficient",
      "anchor_resolved",
      "no_essential_missing_links",
      "transfer_or_revision_ready"
    ],
    productive_partial_continues_when: [
      "new_evidence",
      "strategy_uptake",
      "knowledge_gap_narrowing",
      "engagement_supports_learning"
    ],
    bounded_stop_may_consider: [
      "session_budget_exhausted",
      "persistent_misconception_after_meaningful_interventions",
      "low_expected_benefit",
      "unresolved_conceptual_barrier"
    ],
    disengagement_uses_supportive_redirect: true
  });
}

export const AdaptiveStoppingDecisionV1Schema = z.object({
  policy_version: z.literal(E2A36_ADAPTIVE_STOPPING_POLICY_VERSION),
  internal_decision: AdaptiveStoppingInternalDecisionSchema,
  revision_ready: z.boolean(),
  tutor_dispatch_allowed: z.boolean(),
  instructor_support_recommended: z.boolean(),
  internal_reason_codes: z.array(z.string().min(1).max(160)).min(1).max(12),
  student_message_kind: z.enum([
    "ready_to_apply",
    "continue_learning",
    "support_next_step",
    "refocus_support"
  ]),
  internal_state_student_visible: z.literal(false)
}).strict();
export type AdaptiveStoppingDecisionV1 = z.infer<
  typeof AdaptiveStoppingDecisionV1Schema
>;

export function decideAdaptiveStoppingV1(input: {
  learning_profile: LearningProfileEvolutionV1;
  engagement_profile: EngagementProfileEvolutionV1;
  intervention_memory: LongitudinalInterventionRecordV1[];
  session_budget_exhausted: boolean;
  new_evidence_observed: boolean;
  knowledge_gap_narrowing: boolean;
  strategy_uptake_observed: boolean;
  expected_benefit: "low" | "uncertain" | "high";
  unresolved_conceptual_barrier: boolean;
}) {
  const learning = LearningProfileEvolutionV1Schema.parse(
    input.learning_profile
  );
  const engagement = EngagementProfileEvolutionV1Schema.parse(
    input.engagement_profile
  );
  const current = learning.current_profile;
  const currentEngagement = engagement.current_snapshot;
  const meaningfulIntervention = input.intervention_memory.some((entry) => {
    const record = LongitudinalInterventionRecordV1Schema.parse(entry);
    return record.observed_outcome !== "awaiting_response";
  });
  if (profileIsSound(current)) {
    return AdaptiveStoppingDecisionV1Schema.parse({
      policy_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      internal_decision: "stop_formative_dialogue",
      revision_ready: true,
      tutor_dispatch_allowed: false,
      instructor_support_recommended: false,
      internal_reason_codes: [
        "conceptual_gap_resolved",
        "anchor_resolved",
        "no_essential_missing_links",
        "transfer_readiness_achieved"
      ],
      student_message_kind: "ready_to_apply",
      internal_state_student_visible: false
    });
  }
  if (
    currentEngagement.disengagement === "sustained" ||
    (
      currentEngagement.frustration === "explicit" &&
      currentEngagement.participation === "none"
    )
  ) {
    return AdaptiveStoppingDecisionV1Schema.parse({
      policy_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      internal_decision: "engagement_support_needed",
      revision_ready: false,
      tutor_dispatch_allowed: false,
      instructor_support_recommended: false,
      internal_reason_codes: ["supportive_reengagement_needed"],
      student_message_kind: "refocus_support",
      internal_state_student_visible: false
    });
  }
  const persistentBarrier = current.misconception_status === "persists" &&
    input.unresolved_conceptual_barrier;
  if (
    input.session_budget_exhausted ||
    (
      persistentBarrier &&
      meaningfulIntervention &&
      input.expected_benefit === "low"
    )
  ) {
    return AdaptiveStoppingDecisionV1Schema.parse({
      policy_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      internal_decision: "bounded_stop_instructor_support",
      revision_ready: false,
      tutor_dispatch_allowed: false,
      instructor_support_recommended: true,
      internal_reason_codes: [
        ...(input.session_budget_exhausted
          ? ["session_budget_exhausted"]
          : []),
        ...(persistentBarrier
          ? ["persistent_misconception_with_unresolved_barrier"]
          : []),
        ...(input.expected_benefit === "low"
          ? ["low_expected_benefit_from_immediate_continuation"]
          : [])
      ],
      student_message_kind: "support_next_step",
      internal_state_student_visible: false
    });
  }
  const productivePartial =
    current.conceptual_understanding === "partial" &&
    (
      input.new_evidence_observed ||
      input.knowledge_gap_narrowing ||
      input.strategy_uptake_observed
    );
  return AdaptiveStoppingDecisionV1Schema.parse({
    policy_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
    internal_decision: "continue_dialogue",
    revision_ready: false,
    tutor_dispatch_allowed: true,
    instructor_support_recommended: false,
    internal_reason_codes: [
      productivePartial
        ? "productive_partial_understanding"
        : "additional_evidence_has_learning_value"
    ],
    student_message_kind: "continue_learning",
    internal_state_student_visible: false
  });
}

export const InstructorEscalationPolicyContractV1Schema = z.object({
  contract_version: z.literal(E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION),
  eligible_internal_decisions: z.array(
    AdaptiveStoppingInternalDecisionSchema
  ).length(1),
  required_student_language: z.array(z.enum([
    "summarize_key_point",
    "suggest_instructor_discussion",
    "avoid_failure_language",
    "avoid_ai_limitation_language"
  ])).length(4),
  escalation_is_not_correctness_judgment: z.literal(true)
}).strict();

export function buildInstructorEscalationPolicyContractV1() {
  return InstructorEscalationPolicyContractV1Schema.parse({
    contract_version: E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
    eligible_internal_decisions: ["bounded_stop_instructor_support"],
    required_student_language: [
      "summarize_key_point",
      "suggest_instructor_discussion",
      "avoid_failure_language",
      "avoid_ai_limitation_language"
    ],
    escalation_is_not_correctness_judgment: true
  });
}

export function evaluateInstructorEscalationV1(
  decision: AdaptiveStoppingDecisionV1
) {
  const parsed = AdaptiveStoppingDecisionV1Schema.parse(decision);
  return {
    policy_version: E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
    recommend_instructor_support:
      parsed.internal_decision === "bounded_stop_instructor_support",
    based_on_correctness_alone: false,
    internal_only: true
  } as const;
}

const STUDENT_FACING_BLOCKED_PATTERNS: Array<{
  rule_code: string;
  pattern: RegExp;
}> = [
  {
    rule_code: "misconception_status_exposed",
    pattern: /\bmisconception status\b/iu
  },
  {
    rule_code: "reasoning_quality_exposed",
    pattern: /\breasoning quality\b/iu
  },
  {
    rule_code: "engagement_state_exposed",
    pattern: /\b(?:engagement score|engagement profile|disengagement)\b/iu
  },
  {
    rule_code: "session_budget_exposed",
    pattern: /\b(?:session budget|turn budget|token budget)\b/iu
  },
  {
    rule_code: "intervention_count_exposed",
    pattern: /\bintervention count\b/iu
  },
  {
    rule_code: "ai_confidence_exposed",
    pattern: /\bai confidence\b/iu
  },
  {
    rule_code: "escalation_rule_exposed",
    pattern: /\bescalation rule\b/iu
  },
  {
    rule_code: "profile_field_exposed",
    pattern: /\b(?:profile field|learning profile|internal profile)\b/iu
  },
  {
    rule_code: "system_limitation_exposed",
    pattern: /\b(?:system limitation|the ai cannot help|the system stopped)\b/iu
  },
  {
    rule_code: "internal_stop_state_exposed",
    pattern:
      /\b(?:sound state|stop_formative_dialogue|bounded_stop|engagement_support_needed)\b/iu
  },
  {
    rule_code: "failure_language_exposed",
    pattern: /\byou failed\b/iu
  }
];

export const StudentFacingCommunicationContractV1Schema = z.object({
  contract_version: z.literal(E2A36_STUDENT_FACING_COMMUNICATION_VERSION),
  visible_message_requirements: z.array(z.enum([
    "supportive",
    "actionable",
    "learning_oriented",
    "internal_state_free"
  ])).length(4),
  prohibited_internal_content: z.array(z.string().min(1)).min(8),
  internal_to_visible_mapping: z.record(
    AdaptiveStoppingInternalDecisionSchema,
    z.enum([
      "ready_to_apply",
      "continue_learning",
      "support_next_step",
      "refocus_support"
    ])
  )
}).strict();

export function buildStudentFacingCommunicationContractV1() {
  return StudentFacingCommunicationContractV1Schema.parse({
    contract_version: E2A36_STUDENT_FACING_COMMUNICATION_VERSION,
    visible_message_requirements: [
      "supportive",
      "actionable",
      "learning_oriented",
      "internal_state_free"
    ],
    prohibited_internal_content: [
      "misconception status",
      "reasoning quality labels",
      "engagement scores",
      "session budgets",
      "intervention counts",
      "AI confidence",
      "escalation rules",
      "profile fields",
      "system limitations"
    ],
    internal_to_visible_mapping: {
      continue_dialogue: "continue_learning",
      stop_formative_dialogue: "ready_to_apply",
      bounded_stop_instructor_support: "support_next_step",
      engagement_support_needed: "refocus_support"
    }
  });
}

export function validateStudentFacingCommunicationV1(message: string) {
  const trimmed = message.trim();
  const issueCodes = STUDENT_FACING_BLOCKED_PATTERNS
    .filter((entry) => entry.pattern.test(trimmed))
    .map((entry) => entry.rule_code);
  if (trimmed.length === 0) issueCodes.push("student_message_missing");
  return {
    validator_version: E2A36_STUDENT_FACING_COMMUNICATION_VERSION,
    passed: issueCodes.length === 0,
    issue_codes: [...new Set(issueCodes)],
    raw_internal_state_included: issueCodes.length > 0
  };
}

export function translateStoppingDecisionForStudentV1(
  decision: AdaptiveStoppingDecisionV1
) {
  const parsed = AdaptiveStoppingDecisionV1Schema.parse(decision);
  const message = parsed.student_message_kind === "ready_to_apply"
    ? "Your explanation now captures the key idea. You are ready to apply this understanding to a new situation."
    : parsed.student_message_kind === "support_next_step"
      ? "We have explored this idea from several perspectives. I will summarize the key point and suggest what to discuss next with your instructor."
      : parsed.student_message_kind === "refocus_support"
        ? "Let’s pause and make the next step smaller. Tell me which part feels unclear, or continue when you are ready."
        : "You have added useful evidence. Let’s work on one more connection so you can apply the idea clearly.";
  const validation = validateStudentFacingCommunicationV1(message);
  if (!validation.passed) {
    throw new Error(
      `e2a36_student_facing_communication_rejected:${validation.issue_codes.join("|")}`
    );
  }
  return {
    communication_version: E2A36_STUDENT_FACING_COMMUNICATION_VERSION,
    message_kind: parsed.student_message_kind,
    student_facing_message: message,
    validation,
    internal_decision_exposed: false
  };
}

export const E2A36LongitudinalMetricsContractSchema = z.object({
  contract_version: z.literal(E2A36_LONGITUDINAL_METRICS_VERSION),
  metrics: z.array(z.object({
    metric_id: z.enum([
      "dialogue_efficiency",
      "unnecessary_turn_detection",
      "missed_progression_detection",
      "intervention_count",
      "strategy_adaptation",
      "learning_gain_per_turn",
      "stopping_appropriateness",
      "instructor_escalation_appropriateness",
      "student_facing_communication_quality"
    ]),
    definition: z.string().min(1).max(500),
    interpretation_caution: z.string().min(1).max(500)
  }).strict()).length(9)
}).strict();

export function buildE2A36LongitudinalMetricsContract() {
  const caution =
    "Protocol metric for bounded synthetic review; it is not a stable learner trait or classroom-validity claim.";
  return E2A36LongitudinalMetricsContractSchema.parse({
    contract_version: E2A36_LONGITUDINAL_METRICS_VERSION,
    metrics: [
      {
        metric_id: "dialogue_efficiency",
        definition:
          "Accepted conceptual evidence gains divided by completed dialogue turns.",
        interpretation_caution: caution
      },
      {
        metric_id: "unnecessary_turn_detection",
        definition:
          "Turns attempted after the evidence-driven sound gate authorized revision.",
        interpretation_caution: caution
      },
      {
        metric_id: "missed_progression_detection",
        definition:
          "Sound-gate passes that did not immediately produce revision readiness.",
        interpretation_caution: caution
      },
      {
        metric_id: "intervention_count",
        definition:
          "Count of persisted intervention-memory records for the episode.",
        interpretation_caution: caution
      },
      {
        metric_id: "strategy_adaptation",
        definition:
          "Whether an ineffective strategy-gap pair was replaced with a different strategy.",
        interpretation_caution: caution
      },
      {
        metric_id: "learning_gain_per_turn",
        definition:
          "Ordered conceptual-quality change per accepted evidence-bearing turn.",
        interpretation_caution: caution
      },
      {
        metric_id: "stopping_appropriateness",
        definition:
          "Agreement between profile evidence and the internal stopping-policy outcome.",
        interpretation_caution: caution
      },
      {
        metric_id: "instructor_escalation_appropriateness",
        definition:
          "Whether instructor support is suggested only for bounded unresolved barriers.",
        interpretation_caution: caution
      },
      {
        metric_id: "student_facing_communication_quality",
        definition:
          "Share of visible outcome messages that are supportive, actionable, and free of internal orchestration labels.",
        interpretation_caution: caution
      }
    ]
  });
}

function learningFixture(input: {
  sequence_index: number;
  conceptual_understanding: z.infer<
    typeof LearningConceptualUnderstandingSchema
  >;
  reasoning_quality: z.infer<typeof LearningReasoningQualitySchema>;
  misconception_status: z.infer<typeof LearningMisconceptionStatusSchema>;
  stance: z.infer<
    typeof LearningAnchorInterpretationSchema
  >["stance"];
  contradictions?: string[];
  missing_links?: string[];
  transfer_readiness?: boolean;
  conceptual_evidence_update?: boolean;
  profile_update_eligible?: boolean;
  self_correction_intent?: boolean;
  concept_family?: MeasurementConceptFamily;
}) {
  const sound = input.conceptual_understanding === "sound";
  return createLearningProfileSnapshotV1({
    sequence_index: input.sequence_index,
    source_student_turn_id: `student_turn_${input.sequence_index}`,
    concept_family: input.concept_family ?? "reliability_validity",
    conceptual_understanding: input.conceptual_understanding,
    misconception_status: input.misconception_status,
    knowledge_gap: sound
      ? "No essential gap remains for the active anchor."
      : "The distinction between consistency evidence and interpretation evidence remains incomplete.",
    reasoning_quality: input.reasoning_quality,
    anchor_interpretation: {
      application: input.stance === "not_expressed" ? "absent" : "explicit",
      stance: input.stance,
      consistency: input.contradictions?.length
        ? "contradictory_to_conceptual_reasoning"
        : sound
          ? "consistent_with_conceptual_reasoning"
          : "unresolved"
    },
    unresolved_contradictions: input.contradictions ?? [],
    missing_links: input.missing_links ?? (sound ? [] : ["validity_boundary"]),
    transfer_readiness: input.transfer_readiness ?? sound,
    confidence_alignment: "not_assessable",
    self_correction_intent: input.self_correction_intent ?? false,
    conceptual_evidence_update:
      input.conceptual_evidence_update ?? true,
    profile_update_eligible: input.profile_update_eligible ?? true,
    observable_evidence_present:
      input.conceptual_evidence_update ?? true,
    independent_evidence_present:
      input.profile_update_eligible ?? true,
    created_at: new Date(input.sequence_index * 1000).toISOString()
  });
}

function engagementFixture(input: {
  sequence_index: number;
  participation?: EngagementProfileSnapshotV1["participation"];
  disengagement?: EngagementProfileSnapshotV1["disengagement"];
  frustration?: EngagementProfileSnapshotV1["frustration"];
  trend?: EngagementProfileSnapshotV1["response_quality_trend"];
  uptake?: EngagementProfileSnapshotV1["strategy_uptake"];
}) {
  return createEngagementProfileSnapshotV1({
    sequence_index: input.sequence_index,
    source_student_turn_id: `student_turn_${input.sequence_index}`,
    participation: input.participation ?? "active",
    response_quality_trend: input.trend ?? "improving",
    effort: "sustained_observed_effort",
    persistence: "sustained",
    help_seeking: "conceptual",
    frustration: input.frustration ?? "not_observed",
    disengagement: input.disengagement ?? "not_observed",
    responsiveness_to_intervention: "productive_response",
    strategy_uptake: input.uptake ?? "clear",
    evidence_basis: ["student responded to the targeted conceptual prompt"],
    created_at: new Date(input.sequence_index * 1000).toISOString()
  });
}

function completedIntervention(input: {
  strategy: string;
  gap: string;
  effective: boolean;
  sequence_index?: number;
}): LongitudinalInterventionRecordV1 {
  return LongitudinalInterventionRecordV1Schema.parse({
    memory_version: E2A36_INTERVENTION_MEMORY_VERSION,
    base_memory_version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
    intervention_id: `prior_${input.strategy}`,
    sequence_index: input.sequence_index ?? 1,
    strategy: input.strategy,
    targeted_gap: input.gap,
    evidence_sought: ["observable conceptual distinction"],
    student_response_evidence_summary:
      input.effective ? "Partial conceptual improvement." : "No new evidence.",
    observed_outcome:
      input.effective ? "partial_improvement" : "misconception_persists",
    changed_understanding: input.effective,
    effective_for_target_gap: input.effective,
    created_at: new Date(0).toISOString()
  });
}

function stoppingInput(input: {
  learning: LearningProfileEvolutionV1;
  engagement?: EngagementProfileEvolutionV1;
  memory?: LongitudinalInterventionRecordV1[];
  budget?: boolean;
  newEvidence?: boolean;
  narrowing?: boolean;
  uptake?: boolean;
  expectedBenefit?: "low" | "uncertain" | "high";
  barrier?: boolean;
}) {
  const engagement = input.engagement ?? evolveEngagementProfileV1({
    prior: null,
    observation: engagementFixture({ sequence_index: 1 })
  });
  return {
    learning_profile: input.learning,
    engagement_profile: engagement,
    intervention_memory: input.memory ?? [],
    session_budget_exhausted: input.budget ?? false,
    new_evidence_observed: input.newEvidence ?? false,
    knowledge_gap_narrowing: input.narrowing ?? false,
    strategy_uptake_observed: input.uptake ?? false,
    expected_benefit: input.expectedBenefit ?? "high",
    unresolved_conceptual_barrier: input.barrier ?? false
  } as const;
}

function suiteResult(name: string, cases: Array<{
  case_id: string;
  passed: boolean;
  detail: Record<string, unknown>;
}>) {
  return {
    suite_version: `e2a36-${name}-regressions-v1`,
    case_count: cases.length,
    cases,
    passed: cases.every((entry) => entry.passed)
  };
}

export function runE2A36LearningProfileRegressions() {
  const misconception = evolveLearningProfileV1({
    prior: null,
    observation: learningFixture({
      sequence_index: 1,
      conceptual_understanding: "misconception",
      reasoning_quality: "misconception",
      misconception_status: "persists",
      stance: "endorses_distractor"
    })
  });
  const sound = evolveLearningProfileV1({
    prior: misconception,
    observation: learningFixture({
      sequence_index: 2,
      conceptual_understanding: "sound",
      reasoning_quality: "sound",
      misconception_status: "resolved_for_current_anchor",
      stance: "rejects_distractor"
    })
  });
  const regressed = evolveLearningProfileV1({
    prior: sound,
    observation: learningFixture({
      sequence_index: 3,
      conceptual_understanding: "misconception",
      reasoning_quality: "misconception",
      misconception_status: "persists",
      stance: "endorses_distractor",
      contradictions: ["reliability_still_claimed_as_validity"]
    })
  });
  const intentOnly = evolveLearningProfileV1({
    prior: misconception,
    observation: learningFixture({
      sequence_index: 2,
      conceptual_understanding: "unresolved",
      reasoning_quality: "insufficient",
      misconception_status: "uncertain",
      stance: "not_expressed",
      conceptual_evidence_update: false,
      profile_update_eligible: false,
      self_correction_intent: true
    })
  });
  return suiteResult("learning-profile", [
    {
      case_id: "latest_valid_evidence_updates_profile",
      passed: sound.current_profile.conceptual_understanding === "sound",
      detail: {
        current_snapshot: sound.current_profile_snapshot_id
      }
    },
    {
      case_id: "history_is_not_erased",
      passed:
        sound.trajectory_history.length === 2 &&
        sound.historical_misconception_snapshot_ids.length === 1,
      detail: {
        history_count: sound.trajectory_history.length
      }
    },
    {
      case_id: "sound_then_misconception_reopens",
      passed:
        regressed.current_profile.conceptual_understanding ===
          "misconception" &&
        regressed.misconception_reopened_count === 1,
      detail: {
        reopened_count: regressed.misconception_reopened_count
      }
    },
    {
      case_id: "intent_only_preserves_prior_profile",
      passed:
        intentOnly.current_profile_snapshot_id ===
          misconception.current_profile_snapshot_id &&
        intentOnly.latest_observation_snapshot_id !==
          intentOnly.current_profile_snapshot_id,
      detail: {
        current_snapshot: intentOnly.current_profile_snapshot_id,
        latest_observation: intentOnly.latest_observation_snapshot_id
      }
    }
  ]);
}

export function runE2A36EngagementProfileRegressions() {
  const first = evolveEngagementProfileV1({
    prior: null,
    observation: engagementFixture({
      sequence_index: 1,
      trend: "stable",
      uptake: "not_observed"
    })
  });
  const second = evolveEngagementProfileV1({
    prior: first,
    observation: engagementFixture({
      sequence_index: 2,
      trend: "improving",
      uptake: "clear"
    })
  });
  return suiteResult("engagement-profile", [
    {
      case_id: "engagement_history_evolves",
      passed:
        second.trajectory_history.length === 2 &&
        second.current_snapshot.response_quality_trend === "improving",
      detail: {
        history_count: second.trajectory_history.length
      }
    },
    {
      case_id: "strategy_uptake_is_tracked",
      passed: second.current_snapshot.strategy_uptake === "clear",
      detail: {
        strategy_uptake: second.current_snapshot.strategy_uptake
      }
    },
    {
      case_id: "engagement_never_determines_correctness",
      passed:
        second.engagement_determines_correctness === false &&
        second.current_snapshot.correctness_independence,
      detail: {
        correctness_independence:
          second.current_snapshot.correctness_independence
      }
    }
  ]);
}

export function runE2A36InterventionMemoryRegressions() {
  const gap =
    "Separate score consistency evidence from validity evidence.";
  const first = selectLongitudinalInterventionV1({
    concept_family: "reliability_validity",
    targeted_gap: gap,
    evidence_sought: ["explain why consistency is not sufficient"],
    prior_interventions: []
  });
  const ineffective = completedIntervention({
    strategy: first.strategy,
    gap,
    effective: false
  });
  const adapted = selectLongitudinalInterventionV1({
    concept_family: "reliability_validity",
    targeted_gap: gap,
    evidence_sought: ["provide an independent counterexample"],
    prior_interventions: [ineffective]
  });
  const persistentProfile = evolveLearningProfileV1({
    prior: null,
    observation: learningFixture({
      sequence_index: 1,
      conceptual_understanding: "misconception",
      reasoning_quality: "misconception",
      misconception_status: "persists",
      stance: "endorses_distractor"
    })
  });
  const highEngagementContinuation = decideAdaptiveStoppingV1(stoppingInput({
    learning: persistentProfile,
    engagement: evolveEngagementProfileV1({
      prior: null,
      observation: engagementFixture({
        sequence_index: 1,
        participation: "active",
        trend: "stable",
        uptake: "partial"
      })
    }),
    memory: [ineffective],
    expectedBenefit: "high",
    barrier: true
  }));
  return suiteResult("intervention-memory", [
    {
      case_id: "memory_preserves_required_fields",
      passed:
        first.targeted_gap === gap &&
        first.evidence_sought.length === 1 &&
        first.student_response_evidence_summary.length > 0,
      detail: {
        strategy: first.strategy
      }
    },
    {
      case_id: "ineffective_strategy_is_not_repeated",
      passed: adapted.strategy !== first.strategy,
      detail: {
        first_strategy: first.strategy,
        adapted_strategy: adapted.strategy
      }
    },
    {
      case_id:
        "persistent_misconception_with_high_engagement_adapts_strategy",
      passed:
        highEngagementContinuation.internal_decision ===
          "continue_dialogue" &&
        highEngagementContinuation.tutor_dispatch_allowed &&
        adapted.strategy !== first.strategy,
      detail: {
        stopping_decision:
          highEngagementContinuation.internal_decision,
        prior_strategy: first.strategy,
        adapted_strategy: adapted.strategy
      }
    },
    {
      case_id: "different_gaps_receive_different_strategies",
      passed: new Set([
        selectLongitudinalInterventionV1({
          concept_family: "reliability_validity",
          targeted_gap: "Reliability means the same score every time.",
          evidence_sought: ["distinguish consistency and interpretation"],
          prior_interventions: []
        }).strategy,
        selectLongitudinalInterventionV1({
          concept_family: "reliability_validity",
          targeted_gap: "Cronbach alpha proves validity.",
          evidence_sought: ["audit the evidence claim"],
          prior_interventions: [completedIntervention({
            strategy: "contrast_consistency_with_interpretation",
            gap: "Cronbach alpha proves validity.",
            effective: false
          })]
        }).strategy,
        selectLongitudinalInterventionV1({
          concept_family: "observed_score_error",
          targeted_gap: "Two score points prove one student is better.",
          evidence_sought: ["account for measurement uncertainty"],
          prior_interventions: []
        }).strategy
      ]).size === 3,
      detail: {
        distinct_personalized_strategies: 3
      }
    }
  ]);
}

export function runE2A36StoppingPolicyRegressions() {
  const partial = evolveLearningProfileV1({
    prior: null,
    observation: learningFixture({
      sequence_index: 1,
      conceptual_understanding: "partial",
      reasoning_quality: "partial",
      misconception_status: "uncertain",
      stance: "ambiguous"
    })
  });
  const sound = evolveLearningProfileV1({
    prior: partial,
    observation: learningFixture({
      sequence_index: 2,
      conceptual_understanding: "sound",
      reasoning_quality: "sound",
      misconception_status: "resolved_for_current_anchor",
      stance: "rejects_distractor"
    })
  });
  const persistent = evolveLearningProfileV1({
    prior: null,
    observation: learningFixture({
      sequence_index: 1,
      conceptual_understanding: "misconception",
      reasoning_quality: "misconception",
      misconception_status: "persists",
      stance: "endorses_distractor"
    })
  });
  const earlySound = decideAdaptiveStoppingV1(stoppingInput({
    learning: sound
  }));
  const productivePartial = decideAdaptiveStoppingV1(stoppingInput({
    learning: partial,
    newEvidence: true,
    narrowing: true,
    uptake: true
  }));
  const bounded = decideAdaptiveStoppingV1(stoppingInput({
    learning: persistent,
    memory: [completedIntervention({
      strategy: "contrast_consistency_with_interpretation",
      gap: "reliability_validity",
      effective: false
    })],
    budget: true,
    expectedBenefit: "low",
    barrier: true
  }));
  const disengaged = decideAdaptiveStoppingV1(stoppingInput({
    learning: partial,
    engagement: evolveEngagementProfileV1({
      prior: null,
      observation: engagementFixture({
        sequence_index: 1,
        participation: "none",
        disengagement: "sustained",
        frustration: "explicit"
      })
    })
  }));
  return suiteResult("stopping-policy", [
    {
      case_id: "early_sound_stops_immediately",
      passed:
        earlySound.internal_decision === "stop_formative_dialogue" &&
        earlySound.revision_ready &&
        !earlySound.tutor_dispatch_allowed,
      detail: {
        decision: earlySound.internal_decision
      }
    },
    {
      case_id: "productive_partial_continues",
      passed:
        productivePartial.internal_decision === "continue_dialogue" &&
        productivePartial.tutor_dispatch_allowed,
      detail: {
        decision: productivePartial.internal_decision
      }
    },
    {
      case_id: "persistent_misconception_after_budget_bounds_support",
      passed:
        bounded.internal_decision ===
          "bounded_stop_instructor_support" &&
        bounded.instructor_support_recommended,
      detail: {
        decision: bounded.internal_decision
      }
    },
    {
      case_id: "disengagement_uses_supportive_path",
      passed:
        disengaged.internal_decision === "engagement_support_needed" &&
        !disengaged.revision_ready,
      detail: {
        decision: disengaged.internal_decision
      }
    }
  ]);
}

export function runE2A36InstructorEscalationRegressions() {
  const persistent = evolveLearningProfileV1({
    prior: null,
    observation: learningFixture({
      sequence_index: 1,
      conceptual_understanding: "misconception",
      reasoning_quality: "misconception",
      misconception_status: "persists",
      stance: "endorses_distractor"
    })
  });
  const bounded = decideAdaptiveStoppingV1(stoppingInput({
    learning: persistent,
    budget: true,
    barrier: true,
    expectedBenefit: "low"
  }));
  const continuation = decideAdaptiveStoppingV1(stoppingInput({
    learning: persistent,
    expectedBenefit: "high"
  }));
  return suiteResult("instructor-escalation", [
    {
      case_id: "bounded_stop_recommends_instructor_support",
      passed: evaluateInstructorEscalationV1(bounded)
        .recommend_instructor_support,
      detail: {
        decision: bounded.internal_decision
      }
    },
    {
      case_id: "ordinary_continuation_does_not_escalate",
      passed: !evaluateInstructorEscalationV1(continuation)
        .recommend_instructor_support,
      detail: {
        decision: continuation.internal_decision
      }
    },
    {
      case_id: "escalation_is_not_correctness_judgment",
      passed: !evaluateInstructorEscalationV1(bounded)
        .based_on_correctness_alone,
      detail: {
        based_on_correctness_alone: false
      }
    }
  ]);
}

export function runE2A36StudentCommunicationRegressions() {
  const decisions: AdaptiveStoppingDecisionV1[] = [
    AdaptiveStoppingDecisionV1Schema.parse({
      policy_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      internal_decision: "stop_formative_dialogue",
      revision_ready: true,
      tutor_dispatch_allowed: false,
      instructor_support_recommended: false,
      internal_reason_codes: ["sound_evidence"],
      student_message_kind: "ready_to_apply",
      internal_state_student_visible: false
    }),
    AdaptiveStoppingDecisionV1Schema.parse({
      policy_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      internal_decision: "bounded_stop_instructor_support",
      revision_ready: false,
      tutor_dispatch_allowed: false,
      instructor_support_recommended: true,
      internal_reason_codes: ["unresolved_barrier"],
      student_message_kind: "support_next_step",
      internal_state_student_visible: false
    }),
    AdaptiveStoppingDecisionV1Schema.parse({
      policy_version: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      internal_decision: "engagement_support_needed",
      revision_ready: false,
      tutor_dispatch_allowed: false,
      instructor_support_recommended: false,
      internal_reason_codes: ["support_needed"],
      student_message_kind: "refocus_support",
      internal_state_student_visible: false
    })
  ];
  const visible = decisions.map(translateStoppingDecisionForStudentV1);
  const leakage = validateStudentFacingCommunicationV1(
    "The engagement profile triggered bounded_stop because the session budget was exhausted."
  );
  const internalLeakSamples = [
    "The misconception status is unresolved.",
    "Your reasoning quality is partial.",
    "Your engagement score is low.",
    "The session budget is exhausted.",
    "The intervention count is four.",
    "The AI confidence is low.",
    "The escalation rule now applies.",
    "The learning profile has a missing field.",
    "The AI cannot help with this system limitation.",
    "The system stopped at bounded_stop.",
    "You failed this activity."
  ];
  const internalLeakResults = internalLeakSamples.map(
    validateStudentFacingCommunicationV1
  );
  return suiteResult("student-facing-communication", [
    {
      case_id: "sound_message_is_supportive_and_actionable",
      passed:
        visible[0]?.validation.passed === true &&
        visible[0].student_facing_message.includes("ready to apply"),
      detail: {
        message_kind: visible[0]?.message_kind
      }
    },
    {
      case_id: "student_facing_escalation_language_passes",
      passed:
        visible[1]?.validation.passed === true &&
        visible[1].student_facing_message.includes("your instructor"),
      detail: {
        message_kind: visible[1]?.message_kind
      }
    },
    {
      case_id: "disengagement_label_is_not_visible",
      passed:
        visible[2]?.validation.passed === true &&
        !/\bengagement\b/iu.test(visible[2].student_facing_message),
      detail: {
        message_kind: visible[2]?.message_kind
      }
    },
    {
      case_id: "internal_stopping_decision_leakage_hard_fails",
      passed:
        !leakage.passed &&
        leakage.issue_codes.includes("internal_stop_state_exposed") &&
        leakage.issue_codes.includes("session_budget_exposed"),
      detail: {
        issue_codes: leakage.issue_codes
      }
    },
    {
      case_id: "all_internal_orchestration_labels_are_rejected",
      passed: internalLeakResults.every((result) => !result.passed),
      detail: {
        rejected_sample_count: internalLeakResults.filter(
          (result) => !result.passed
        ).length,
        sample_count: internalLeakResults.length
      }
    }
  ]);
}

function selfCorrectionObservation(input: {
  kind: SelfCorrectionConceptualEvidenceObservationV1["evidence_kind"];
  quality: SelfCorrectionConceptualEvidenceObservationV1["reasoning_quality"];
  spans: string[];
  independent: boolean;
  copied?: boolean;
  stance?: SelfCorrectionConceptualEvidenceObservationV1["anchor_stance"];
  status?: SelfCorrectionConceptualEvidenceObservationV1["misconception_status"];
  contradictions?: string[];
  missing?: string[];
}): SelfCorrectionConceptualEvidenceObservationV1 {
  return {
    evidence_source: "deterministic_fixture",
    evidence_kind: input.kind,
    reasoning_quality: input.quality,
    observable_evidence_spans: input.spans.map((span, index) => ({
      label: `evidence_${index + 1}`,
      span
    })),
    independent_application_present: input.independent,
    copied_or_formulaic_language_detected: input.copied ?? false,
    topic_relevant: true,
    anchor_application: input.stance ? "explicit" : "absent",
    anchor_stance: input.stance ?? "not_expressed",
    anchor_consistency: input.contradictions?.length
      ? "contradictory_to_conceptual_reasoning"
      : input.stance === "rejects_distractor"
        ? "consistent_with_conceptual_reasoning"
        : "unresolved",
    misconception_status: input.status ?? "uncertain",
    essential_missing_links: input.missing ?? [],
    contradictions: input.contradictions ?? [],
    prior_profile_status: "persists"
  };
}

export function runE2A36SelfCorrectionRegressions() {
  const intentContract = buildSelfCorrectionIntentContractV1({
    active_topic_terms: [
      "reliability",
      "validity",
      "consistent scores",
      "interpretation",
      "construct"
    ],
    active_anchor_aliases: ["option D", "D", "that option"],
    unrelated_topic_terms: ["weather", "movie", "sports"]
  });
  const contract = buildSelfCorrectionEvidenceContractV1();
  const resolve = (
    message: string,
    evidence: SelfCorrectionConceptualEvidenceObservationV1
  ) => resolveSelfCorrectionEvidenceV1({
    contract,
    intent_signal: resolveSelfCorrectionIntentSignalV1({
      message,
      intent_contract: intentContract
    }),
    conceptual_evidence: evidence
  });
  const noEvidence = resolve(
    "I was wrong. I meant D.",
    selfCorrectionObservation({
      kind: "answer_revision_only",
      quality: "insufficient",
      spans: [],
      independent: false
    })
  );
  const validEvidence = resolve(
    "I was wrong because reliability only addresses consistency, not whether the score interpretation is appropriate.",
    selfCorrectionObservation({
      kind: "conceptual_reasoning",
      quality: "sound",
      spans: [
        "reliability only addresses consistency",
        "not whether the score interpretation is appropriate"
      ],
      independent: true,
      stance: "rejects_distractor",
      status: "resolved_for_current_anchor"
    })
  );
  const preservedMisconception = resolve(
    "I was wrong, but D is still correct.",
    selfCorrectionObservation({
      kind: "contradictory_reasoning",
      quality: "misconception",
      spans: ["D is still correct"],
      independent: true,
      stance: "endorses_distractor",
      status: "persists",
      contradictions: ["correction_preserves_active_misconception"],
      missing: ["validity_boundary"]
    })
  );
  return suiteResult("self-correction", [
    {
      case_id: "self_correction_without_evidence",
      passed:
        noEvidence.self_correction_intent &&
        !noEvidence.conceptual_evidence_update &&
        !noEvidence.profile_update_eligible,
      detail: {
        disposition: noEvidence.profile_update_disposition
      }
    },
    {
      case_id: "self_correction_with_evidence",
      passed:
        validEvidence.self_correction_intent &&
        validEvidence.conceptual_evidence_update &&
        validEvidence.profile_update_eligible &&
        validEvidence.sound_update_eligible,
      detail: {
        disposition: validEvidence.profile_update_disposition
      }
    },
    {
      case_id: "self_correction_preserving_misconception_is_not_sound",
      passed:
        preservedMisconception.self_correction_intent &&
        preservedMisconception.conceptual_evidence_update &&
        !preservedMisconception.sound_update_eligible,
      detail: {
        quality: preservedMisconception.conceptual_evidence_quality
      }
    },
    {
      case_id: "e2a35a_contract_version_is_integrated",
      passed:
        contract.contract_version ===
          SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
      detail: {
        contract_version: contract.contract_version
      }
    }
  ]);
}

export function runE2A36TrajectoryEnvelopeRegressions(
  envelope: TrajectoryEnvelopeContract
) {
  const turn = envelope.turns[1] ?? envelope.turns[0]!;
  const earlySound = evaluateTrajectoryEnvelope({
    turn_contract: turn,
    evaluator_reasoning_quality: "sound",
    sound_gate_result: {
      gate_version: "e2a36-deterministic-sound-gate-fixture",
      passed: true,
      failure_codes: []
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: false,
    prior_reasoning_quality: "partial",
    prior_sound_gate_passed: false,
    turn_budget_exhausted: false
  });
  const prolongedPartial = evaluateTrajectoryEnvelope({
    turn_contract: turn,
    evaluator_reasoning_quality: "partial",
    sound_gate_result: {
      gate_version: "e2a36-deterministic-sound-gate-fixture",
      passed: false,
      failure_codes: ["essential_missing_link"]
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: false,
    prior_reasoning_quality: "partial",
    prior_sound_gate_passed: false,
    turn_budget_exhausted: false
  });
  const regression = evaluateTrajectoryEnvelope({
    turn_contract: turn,
    evaluator_reasoning_quality: "misconception",
    sound_gate_result: {
      gate_version: "e2a36-deterministic-sound-gate-fixture",
      passed: false,
      failure_codes: ["blocking_contradiction"]
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: true,
    prior_reasoning_quality: "sound",
    prior_sound_gate_passed: true,
    turn_budget_exhausted: false
  });
  return suiteResult("trajectory-envelope", [
    {
      case_id: "sound_evidence_overrides_trajectory",
      passed:
        earlySound.progression_decision === "immediate_revision" &&
        earlySound.revision_required_immediately,
      detail: {
        progression: earlySound.progression_decision
      }
    },
    {
      case_id: "prolonged_partial_continues",
      passed:
        prolongedPartial.progression_decision ===
          "continue_evidence_targeted_tutor",
      detail: {
        progression: prolongedPartial.progression_decision
      }
    },
    {
      case_id: "sound_then_regression_reopens_support",
      passed:
        regression.progression_decision === "reopen_targeted_support" &&
        regression.trajectory_adherence === "contradiction_after_sound",
      detail: {
        progression: regression.progression_decision
      }
    }
  ]);
}

export function runE2A36PersonalizationRegressions() {
  const studentA = selectLongitudinalInterventionV1({
    concept_family: "reliability_validity",
    targeted_gap: "Reliability means the same score every time.",
    evidence_sought: ["distinguish consistency from exact score repetition"],
    prior_interventions: []
  });
  const studentB = selectLongitudinalInterventionV1({
    concept_family: "reliability_validity",
    targeted_gap: "Cronbach alpha proves validity.",
    evidence_sought: ["identify what alpha can and cannot support"],
    prior_interventions: [completedIntervention({
      strategy: "contrast_consistency_with_interpretation",
      gap: "Cronbach alpha proves validity.",
      effective: false
    })]
  });
  const studentC = selectLongitudinalInterventionV1({
    concept_family: "observed_score_error",
    targeted_gap: "Two score points prove one student is better.",
    evidence_sought: ["explain measurement uncertainty and SEM"],
    prior_interventions: []
  });
  return suiteResult("personalization", [
    {
      case_id: "student_a_receives_concept_distinction",
      passed:
        studentA.strategy === "contrast_consistency_with_interpretation",
      detail: { strategy: studentA.strategy }
    },
    {
      case_id: "student_b_receives_claim_audit_after_prior_strategy",
      passed: studentB.strategy === "counterexample_consistent_wrong_construct",
      detail: { strategy: studentB.strategy }
    },
    {
      case_id: "student_c_receives_measurement_error_intervention",
      passed: studentC.strategy === "observed_score_error_decomposition",
      detail: { strategy: studentC.strategy }
    },
    {
      case_id: "personalized_strategies_are_not_identical",
      passed: new Set([
        studentA.strategy,
        studentB.strategy,
        studentC.strategy
      ]).size === 3,
      detail: {
        strategies: [
          studentA.strategy,
          studentB.strategy,
          studentC.strategy
        ]
      }
    }
  ]);
}

export function runAllE2A36DeterministicSuites(
  trajectoryEnvelope: TrajectoryEnvelopeContract
) {
  const suites = {
    learning_profile: runE2A36LearningProfileRegressions(),
    engagement_profile: runE2A36EngagementProfileRegressions(),
    intervention_memory: runE2A36InterventionMemoryRegressions(),
    stopping_policy: runE2A36StoppingPolicyRegressions(),
    instructor_escalation: runE2A36InstructorEscalationRegressions(),
    student_facing_communication:
      runE2A36StudentCommunicationRegressions(),
    self_correction: runE2A36SelfCorrectionRegressions(),
    trajectory_envelope:
      runE2A36TrajectoryEnvelopeRegressions(trajectoryEnvelope),
    personalization: runE2A36PersonalizationRegressions()
  };
  return {
    suite_version: "e2a36-longitudinal-deterministic-regressions-v1",
    suites,
    total_case_count: Object.values(suites).reduce(
      (sum, suite) => sum + suite.case_count,
      0
    ),
    passed: Object.values(suites).every((suite) => suite.passed)
  };
}
