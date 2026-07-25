import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  StudentIsolationScopeSchema,
  isolationNamespace,
  type StudentIsolationScope
} from "./e2a40-classroom-isolation-contracts";
import {
  validateStudentAuditSeparationV1,
  type ResearchAuditDataset
} from "./e2a41-research-audit-contracts";

export const EVALUATION_FRAMEWORK_VERSION =
  "evaluation-framework-v1" as const;
export const EVALUATION_FRAMEWORK_CONTRACT_VERSION =
  "evaluation-framework-contract-v1" as const;
export const DIAGNOSTIC_EVALUATION_CONTRACT_VERSION =
  "diagnostic-evaluation-contract-v1" as const;
export const INTERVENTION_QUALITY_CONTRACT_VERSION =
  "intervention-quality-contract-v1" as const;
export const LEARNING_PROGRESSION_CONTRACT_VERSION =
  "learning-progression-contract-v1" as const;
export const DIALOGUE_EFFICIENCY_CONTRACT_VERSION =
  "dialogue-efficiency-contract-v1" as const;
export const STUDENT_EXPERIENCE_EVALUATION_VERSION =
  "student-experience-evaluation-v1" as const;
export const STUDENT_EXPERIENCE_CONTRACT_VERSION =
  "student-experience-contract-v1" as const;
export const TEACHER_RESEARCH_UTILITY_EVALUATION_VERSION =
  "teacher-research-utility-evaluation-v1" as const;
export const TEACHER_UTILITY_CONTRACT_VERSION =
  "teacher-utility-contract-v1" as const;
export const BASELINE_COMPARISON_CONTRACT_VERSION =
  "baseline-comparison-contract-v1" as const;
export const EVALUATION_REPLAY_CONTRACT_VERSION =
  "evaluation-replay-contract-v1" as const;

export const EvaluationBaselineSchema = z.enum([
  "traditional_mcq_only",
  "mcq_with_generic_ai_explanation",
  "conversation_based_assessment"
]);
export type EvaluationBaseline = z.infer<typeof EvaluationBaselineSchema>;

export const ReasoningStateSchema = z.enum([
  "misconception",
  "copied",
  "partial",
  "contradictory",
  "sound",
  "regressed"
]);
export type ReasoningState = z.infer<typeof ReasoningStateSchema>;

export const InterventionNeedSchema = z.enum([
  "conceptual_distinction",
  "confidence_calibration",
  "counterexample",
  "independent_application",
  "no_intervention"
]);
export type InterventionNeed = z.infer<typeof InterventionNeedSchema>;

export const InterventionStrategySchema = z.enum([
  "contrast_reliability_and_validity",
  "confidence_evidence_audit",
  "counterexample_test",
  "independent_reconstruction",
  "generic_explanation",
  "none"
]);
export type InterventionStrategy = z.infer<
  typeof InterventionStrategySchema
>;

export const EvaluationEvidenceSchema = z.object({
  reasoning_evidence: z.boolean(),
  confidence_evidence: z.boolean(),
  distractor_stance_evidence: z.boolean(),
  conceptual_application_evidence: z.boolean(),
  revision_evidence: z.boolean(),
  transfer_evidence: z.boolean(),
  keyword_only: z.boolean(),
  copied_without_understanding: z.boolean(),
  unsupported_understanding_claim: z.boolean(),
  essential_missing_link_codes: z.array(z.string().min(1)).max(12),
  source_evidence_ids: z.array(z.string().min(1)).max(24),
  evidence_preserved_to_decision: z.boolean()
}).strict();

export const EvaluationInterventionSchema = z.object({
  expected_need: InterventionNeedSchema,
  selected_strategy: InterventionStrategySchema,
  strategy_adapted_from_previous: z.boolean(),
  personalized_to_observed_gap: z.boolean(),
  generic_identical_feedback: z.boolean(),
  intervention_effective: z.boolean().nullable()
}).strict();

export const EvaluationProgressionSchema = z.object({
  expected_states: z.array(ReasoningStateSchema).min(1).max(12),
  observed_states: z.array(ReasoningStateSchema).min(1).max(12),
  resolution_turn: z.number().int().positive().nullable(),
  regression_present: z.boolean(),
  regression_reopened_profile: z.boolean(),
  transfer_demonstrated: z.boolean()
}).strict();

export const EvaluationStoppingSchema = z.object({
  support_needed: z.boolean(),
  sound_reached: z.boolean(),
  sound_turn: z.number().int().positive().nullable(),
  stopping_outcome: z.enum([
    "continue",
    "revise",
    "close",
    "instructor_support"
  ]),
  episode_closed: z.boolean(),
  tutor_turns_after_sound: z.number().int().nonnegative(),
  revision_authorized: z.boolean(),
  stopping_appropriate: z.boolean()
}).strict();

export const StudentExperienceRatingsSchema = z.object({
  clarity: z.number().int().min(1).max(5),
  usefulness: z.number().int().min(1).max(5),
  personalization: z.number().int().min(1).max(5),
  cognitive_burden: z.number().int().min(1).max(5),
  communication_quality: z.number().int().min(1).max(5)
}).strict();

export const TeacherEvidencePackageSchema = z.object({
  struggling_student_signal_present: z.boolean(),
  misconception_summary_present: z.boolean(),
  instructional_planning_evidence_present: z.boolean(),
  ai_decision_trace_present: z.boolean(),
  evidence_provenance_present: z.boolean(),
  hidden_reasoning_present: z.literal(false),
  private_identifier_present: z.literal(false)
}).strict();

export const EvaluationCaseSchema = z.object({
  case_id: z.string().min(1),
  scope: StudentIsolationScopeSchema,
  baseline: EvaluationBaselineSchema,
  shared_misconception_group: z.string().min(1).nullable(),
  expected_reasoning_state: ReasoningStateSchema,
  identified_reasoning_state: ReasoningStateSchema,
  expected_gap_codes: z.array(z.string().min(1)).max(12),
  identified_gap_codes: z.array(z.string().min(1)).max(12),
  expected_profile_transition_valid: z.boolean(),
  observed_profile_transition_valid: z.boolean(),
  evidence: EvaluationEvidenceSchema,
  intervention: EvaluationInterventionSchema,
  progression: EvaluationProgressionSchema,
  stopping: EvaluationStoppingSchema,
  student_visible_messages: z.array(z.string().min(1)).min(1).max(24),
  student_experience: StudentExperienceRatingsSchema,
  teacher_evidence_package: TeacherEvidencePackageSchema
}).strict().superRefine((value, context) => {
  if (
    value.stopping.sound_reached &&
    value.stopping.sound_turn === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stopping", "sound_turn"],
      message: "sound_turn_required_when_sound_reached"
    });
  }
  if (
    !value.stopping.sound_reached &&
    value.stopping.sound_turn !== null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stopping", "sound_turn"],
      message: "sound_turn_prohibited_without_sound"
    });
  }
  if (
    value.intervention.expected_need === "no_intervention" &&
    value.intervention.selected_strategy !== "none"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["intervention", "selected_strategy"],
      message: "no_intervention_case_requires_none_strategy"
    });
  }
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

const failureTypeSchema = z.enum([
  "false_sound",
  "premature_closure",
  "excessive_tutoring",
  "wrong_intervention",
  "evidence_loss",
  "student_facing_leakage"
]);
export type EvaluationFailureType = z.infer<typeof failureTypeSchema>;

export type EvaluationDataset = {
  cases: EvaluationCase[];
  researchAuditDataset: ResearchAuditDataset;
};

function fraction(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function sameStringSet(first: string[], second: string[]) {
  return (
    first.length === second.length &&
    [...first].sort().every(
      (value, index) => value === [...second].sort()[index]
    )
  );
}

function stateRank(state: ReasoningState) {
  return {
    misconception: 0,
    copied: 1,
    contradictory: 1,
    regressed: 1,
    partial: 2,
    sound: 3
  }[state];
}

function expectedStrategy(need: InterventionNeed): InterventionStrategy {
  return {
    conceptual_distinction: "contrast_reliability_and_validity",
    confidence_calibration: "confidence_evidence_audit",
    counterexample: "counterexample_test",
    independent_application: "independent_reconstruction",
    no_intervention: "none"
  }[need] as InterventionStrategy;
}

export function buildEvaluationFrameworkContractV1() {
  return {
    framework_version: EVALUATION_FRAMEWORK_VERSION,
    contract_version: EVALUATION_FRAMEWORK_CONTRACT_VERSION,
    purpose:
      "formal_dissertation_level_conversation_based_assessment_evaluation",
    dimensions: [
      "diagnostic_accuracy",
      "evidence_quality",
      "intervention_quality",
      "learning_progression",
      "dialogue_efficiency",
      "student_experience",
      "teacher_research_utility"
    ],
    critical_error: "false_sound",
    evidence_priority_over_scripted_trajectory: true,
    multi_student_isolation_required: true,
    research_auditability_required: true,
    broad_trait_claims_prohibited: true
  } as const;
}

export function buildDiagnosticEvaluationContractV1() {
  return {
    contract_version: DIAGNOSTIC_EVALUATION_CONTRACT_VERSION,
    evaluates: [
      "misconception_identification",
      "partial_understanding_identification",
      "sound_understanding_detection",
      "knowledge_gap_identification"
    ],
    metrics: [
      "misconception_detection_accuracy",
      "false_sound_rate",
      "missed_misconception_rate",
      "profile_transition_accuracy",
      "knowledge_gap_identification_accuracy"
    ],
    false_sound_is_critical: true,
    sound_requires_sufficient_observable_evidence: true
  } as const;
}

export function buildInterventionQualityContractV1() {
  return {
    contract_version: INTERVENTION_QUALITY_CONTRACT_VERSION,
    evaluates: [
      "intervention_appropriateness",
      "strategy_adaptation",
      "personalization"
    ],
    same_misconception_different_students_requires_distinct_need_matching: true,
    generic_identical_feedback_is_personalization_weakness: true,
    valid_need_strategy_pairs: {
      conceptual_distinction: "contrast_reliability_and_validity",
      confidence_calibration: "confidence_evidence_audit",
      counterexample: "counterexample_test",
      independent_application: "independent_reconstruction",
      no_intervention: "none"
    }
  } as const;
}

export function buildLearningProgressionContractV1() {
  return {
    contract_version: LEARNING_PROGRESSION_CONTRACT_VERSION,
    illustrative_progression: [
      "misconception",
      "partial",
      "contradictory",
      "sound",
      "transfer"
    ],
    metrics: [
      "evidence_gain",
      "profile_improvement",
      "turns_to_resolution",
      "regression_handling_accuracy"
    ],
    sound_evidence_overrides_trajectory_expectation: true,
    regression_must_reopen_profile: true
  } as const;
}

export function buildDialogueEfficiencyContractV1() {
  return {
    contract_version: DIALOGUE_EFFICIENCY_CONTRACT_VERSION,
    avoid: [
      "unnecessary_tutor_turns_after_sound",
      "repeated_ineffective_interventions",
      "premature_closure",
      "excessive_questioning"
    ],
    metrics: [
      "unnecessary_dialogue_rate",
      "missed_revision_rate",
      "strategy_adaptation_rate",
      "stopping_appropriateness"
    ],
    revision_required_immediately_after_sound: true
  } as const;
}

export function buildStudentExperienceContractV1() {
  return {
    evaluation_version: STUDENT_EXPERIENCE_EVALUATION_VERSION,
    contract_version: STUDENT_EXPERIENCE_CONTRACT_VERSION,
    dimensions: [
      "clarity",
      "usefulness",
      "personalization",
      "cognitive_burden",
      "student_facing_communication_quality"
    ],
    student_visible_forbidden: [
      "internal_labels",
      "profiles",
      "stopping_rules",
      "escalation_reasons",
      "ai_limitations"
    ],
    rating_scale: {
      minimum: 1,
      maximum: 5,
      cognitive_burden_lower_is_better: true
    }
  } as const;
}

export function buildTeacherUtilityContractV1() {
  return {
    evaluation_version: TEACHER_RESEARCH_UTILITY_EVALUATION_VERSION,
    contract_version: TEACHER_UTILITY_CONTRACT_VERSION,
    evaluates_support_for: [
      "identifying_struggling_students",
      "understanding_misconceptions",
      "planning_instruction",
      "reviewing_ai_decisions"
    ],
    evidence_provenance_required: true,
    hidden_reasoning_prohibited: true,
    unnecessary_private_identifiers_prohibited: true
  } as const;
}

export function buildBaselineComparisonContractV1() {
  return {
    contract_version: BASELINE_COMPARISON_CONTRACT_VERSION,
    baselines: {
      traditional_mcq_only: {
        evidence: ["selected_answer"]
      },
      mcq_with_generic_ai_explanation: {
        evidence: ["selected_answer", "generic_explanation"]
      },
      conversation_based_assessment: {
        evidence: [
          "selected_answer",
          "reasoning",
          "confidence",
          "distractor_stance",
          "profile",
          "adaptive_dialogue",
          "process_data"
        ]
      }
    },
    comparison_dimensions: [
      "diagnostic_accuracy",
      "personalization",
      "evidence_traceability",
      "learning_progression",
      "teacher_usefulness",
      "efficiency"
    ],
    comparison_is_descriptive_not_causal: true,
    same_synthetic_case_family_required: true
  } as const;
}

export function buildEvaluationReplayContractV1() {
  return {
    contract_version: EVALUATION_REPLAY_CONTRACT_VERSION,
    predecessor_contract: "research-replay-contract-v1",
    reconstructs: [
      "student_evidence",
      "profile_transitions",
      "intervention_decisions",
      "stopping_decisions",
      "final_outcomes",
      "evaluation_metrics"
    ],
    authoritative_order: [
      "student_session_namespace",
      "accepted_turn_sequence",
      "stable_record_id"
    ],
    excludes: [
      "chain_of_thought",
      "hidden_model_reasoning",
      "hidden_prompts",
      "provider_transport_payload",
      "private_identifiers"
    ],
    deterministic_from_accepted_structured_evidence: true
  } as const;
}

export function detectEvaluationFailures(
  evaluationCase: EvaluationCase
): EvaluationFailureType[] {
  const failures: EvaluationFailureType[] = [];
  const evidenceInsufficient =
    evaluationCase.evidence.keyword_only ||
    evaluationCase.evidence.copied_without_understanding ||
    evaluationCase.evidence.unsupported_understanding_claim ||
    evaluationCase.evidence.essential_missing_link_codes.length > 0;
  if (
    evaluationCase.identified_reasoning_state === "sound" &&
    (
      evaluationCase.expected_reasoning_state !== "sound" ||
      evidenceInsufficient
    )
  ) {
    failures.push("false_sound");
  }
  if (
    evaluationCase.stopping.support_needed &&
    evaluationCase.stopping.episode_closed
  ) {
    failures.push("premature_closure");
  }
  if (evaluationCase.stopping.tutor_turns_after_sound > 0) {
    failures.push("excessive_tutoring");
  }
  if (
    evaluationCase.intervention.selected_strategy !==
      expectedStrategy(evaluationCase.intervention.expected_need) ||
    !evaluationCase.intervention.personalized_to_observed_gap
  ) {
    failures.push("wrong_intervention");
  }
  if (!evaluationCase.evidence.evidence_preserved_to_decision) {
    failures.push("evidence_loss");
  }
  if (
    evaluationCase.student_visible_messages.some(
      (message) => !validateStudentAuditSeparationV1(message).safe
    )
  ) {
    failures.push("student_facing_leakage");
  }
  return failures;
}

export function validateEvaluationDataset(raw: EvaluationDataset) {
  const cases = raw.cases.map((item) => EvaluationCaseSchema.parse(item));
  const namespaces = cases.map((item) => isolationNamespace(item.scope));
  const duplicateNamespaces = namespaces.filter(
    (value, index) => namespaces.indexOf(value) !== index
  );
  const caseIds = cases.map((item) => item.case_id);
  const duplicateCaseIds = caseIds.filter(
    (value, index) => caseIds.indexOf(value) !== index
  );
  const researchNamespaces = new Set([
    ...raw.researchAuditDataset.acceptedTurns.map((item) =>
      isolationNamespace(item.scope)
    ),
    ...raw.researchAuditDataset.evidenceSpans.map((item) =>
      isolationNamespace(item.scope)
    ),
    ...raw.researchAuditDataset.profileSnapshots.map((item) =>
      isolationNamespace(item.scope)
    ),
    ...raw.researchAuditDataset.decisionTraces.map((item) =>
      isolationNamespace(item.scope)
    )
  ]);
  const studentMessages = cases.flatMap(
    (item) => item.student_visible_messages
  );
  const unsafeMessages = studentMessages.filter(
    (message) => !validateStudentAuditSeparationV1(message).safe
  );
  const baselineSet = new Set(cases.map((item) => item.baseline));
  return {
    case_count: cases.length,
    unique_case_ids: new Set(caseIds).size,
    unique_evaluation_namespaces: new Set(namespaces).size,
    duplicate_case_ids: [...new Set(duplicateCaseIds)],
    duplicate_evaluation_namespaces: [...new Set(duplicateNamespaces)],
    research_audit_namespace_count: researchNamespaces.size,
    baseline_coverage: [...baselineSet].sort(),
    student_visible_message_count: studentMessages.length,
    unsafe_student_message_count: unsafeMessages.length,
    hidden_reasoning_required: false,
    passed:
      cases.length > 0 &&
      duplicateCaseIds.length === 0 &&
      duplicateNamespaces.length === 0 &&
      baselineSet.size === EvaluationBaselineSchema.options.length &&
      researchNamespaces.size >= 2 &&
      unsafeMessages.length === 0
  };
}

export function computeEvaluationMetrics(cases: EvaluationCase[]) {
  const evaluatedCases = cases.filter(
    (item) => item.baseline === "conversation_based_assessment"
  );
  const misconceptionCases = evaluatedCases.filter(
    (item) => item.expected_reasoning_state === "misconception"
  );
  const nonSoundCases = evaluatedCases.filter(
    (item) => item.expected_reasoning_state !== "sound"
  );
  const expectedSoundCases = evaluatedCases.filter(
    (item) => item.expected_reasoning_state === "sound"
  );
  const interventionCases = evaluatedCases.filter(
    (item) => item.intervention.expected_need !== "no_intervention"
  );
  const regressionCases = evaluatedCases.filter(
    (item) => item.progression.regression_present
  );
  const soundReachedCases = evaluatedCases.filter(
    (item) => item.stopping.sound_reached
  );
  const resolutionCases = evaluatedCases.filter(
    (item) => item.progression.resolution_turn !== null
  );
  const profileGain = evaluatedCases.map((item) => {
    const first = item.progression.observed_states[0]!;
    const last = item.progression.observed_states.at(-1)!;
    return Math.max(0, stateRank(last) - stateRank(first)) / 3;
  });
  const failureTypes = evaluatedCases.flatMap(detectEvaluationFailures);
  const studentMessages = evaluatedCases.flatMap(
    (item) => item.student_visible_messages
  );
  const completeTeacherPackages = evaluatedCases.filter((item) => {
    const packet = item.teacher_evidence_package;
    return (
      packet.struggling_student_signal_present &&
      packet.misconception_summary_present &&
      packet.instructional_planning_evidence_present &&
      packet.ai_decision_trace_present &&
      packet.evidence_provenance_present &&
      !packet.hidden_reasoning_present &&
      !packet.private_identifier_present
    );
  });
  return {
    diagnostic_accuracy: {
      misconception_detection_accuracy: fraction(
        misconceptionCases.filter(
          (item) => item.identified_reasoning_state === "misconception"
        ).length,
        misconceptionCases.length
      ),
      false_sound_rate: fraction(
        nonSoundCases.filter(
          (item) => detectEvaluationFailures(item).includes("false_sound")
        ).length,
        nonSoundCases.length
      ),
      missed_misconception_rate: fraction(
        misconceptionCases.filter(
          (item) => item.identified_reasoning_state !== "misconception"
        ).length,
        misconceptionCases.length
      ),
      sound_detection_accuracy: fraction(
        expectedSoundCases.filter(
          (item) => item.identified_reasoning_state === "sound"
        ).length,
        expectedSoundCases.length
      ),
      profile_transition_accuracy: fraction(
        evaluatedCases.filter(
          (item) =>
            item.expected_profile_transition_valid ===
            item.observed_profile_transition_valid
        ).length,
        evaluatedCases.length
      ),
      knowledge_gap_identification_accuracy: fraction(
        evaluatedCases.filter((item) =>
          sameStringSet(
            item.expected_gap_codes,
            item.identified_gap_codes
          )
        ).length,
        evaluatedCases.length
      )
    },
    evidence_quality: {
      evidence_preservation_rate: fraction(
        evaluatedCases.filter(
          (item) => item.evidence.evidence_preserved_to_decision
        ).length,
        evaluatedCases.length
      ),
      keyword_only_rejected_rate: fraction(
        evaluatedCases.filter((item) => item.evidence.keyword_only).filter(
          (item) => item.identified_reasoning_state !== "sound"
        ).length,
        evaluatedCases.filter((item) => item.evidence.keyword_only).length
      ),
      copied_wording_rejected_rate: fraction(
        evaluatedCases.filter(
          (item) => item.evidence.copied_without_understanding
        ).filter((item) => item.identified_reasoning_state !== "sound").length,
        evaluatedCases.filter(
          (item) => item.evidence.copied_without_understanding
        ).length
      ),
      unsupported_claim_rejected_rate: fraction(
        evaluatedCases.filter(
          (item) => item.evidence.unsupported_understanding_claim
        ).filter((item) => item.identified_reasoning_state !== "sound").length,
        evaluatedCases.filter(
          (item) => item.evidence.unsupported_understanding_claim
        ).length
      )
    },
    intervention_quality: {
      intervention_appropriateness: fraction(
        interventionCases.filter(
          (item) =>
            item.intervention.selected_strategy ===
              expectedStrategy(item.intervention.expected_need) &&
            item.intervention.personalized_to_observed_gap
        ).length,
        interventionCases.length
      ),
      strategy_adaptation_rate: fraction(
        interventionCases.filter(
          (item) => item.intervention.strategy_adapted_from_previous
        ).length,
        interventionCases.length
      ),
      personalization_rate: fraction(
        interventionCases.filter(
          (item) =>
            item.intervention.personalized_to_observed_gap &&
            !item.intervention.generic_identical_feedback
        ).length,
        interventionCases.length
      )
    },
    learning_progression: {
      mean_evidence_gain:
        profileGain.reduce((sum, value) => sum + value, 0) /
        profileGain.length,
      profile_improvement_rate: fraction(
        profileGain.filter((value) => value > 0).length,
        evaluatedCases.length
      ),
      mean_turns_to_resolution: resolutionCases.length === 0
        ? null
        : resolutionCases.reduce(
            (sum, item) =>
              sum + (item.progression.resolution_turn ?? 0),
            0
          ) / resolutionCases.length,
      regression_handling_accuracy: fraction(
        regressionCases.filter(
          (item) => item.progression.regression_reopened_profile
        ).length,
        regressionCases.length
      ),
      transfer_demonstration_rate: fraction(
        evaluatedCases.filter(
          (item) => item.progression.transfer_demonstrated
        ).length,
        evaluatedCases.length
      )
    },
    dialogue_efficiency: {
      unnecessary_dialogue_rate: fraction(
        soundReachedCases.reduce(
          (sum, item) => sum + item.stopping.tutor_turns_after_sound,
          0
        ),
        soundReachedCases.length
      ),
      missed_revision_rate: fraction(
        soundReachedCases.filter(
          (item) => !item.stopping.revision_authorized
        ).length,
        soundReachedCases.length
      ),
      strategy_adaptation_rate: fraction(
        interventionCases.filter(
          (item) => item.intervention.strategy_adapted_from_previous
        ).length,
        interventionCases.length
      ),
      stopping_appropriateness: fraction(
        evaluatedCases.filter(
          (item) => item.stopping.stopping_appropriate
        ).length,
        evaluatedCases.length
      )
    },
    student_experience: {
      clarity_mean:
        evaluatedCases.reduce(
          (sum, item) => sum + item.student_experience.clarity,
          0
        ) / evaluatedCases.length,
      usefulness_mean:
        evaluatedCases.reduce(
          (sum, item) => sum + item.student_experience.usefulness,
          0
        ) / evaluatedCases.length,
      personalization_mean:
        evaluatedCases.reduce(
          (sum, item) => sum + item.student_experience.personalization,
          0
        ) / evaluatedCases.length,
      cognitive_burden_mean:
        evaluatedCases.reduce(
          (sum, item) => sum + item.student_experience.cognitive_burden,
          0
        ) / evaluatedCases.length,
      communication_quality_mean:
        evaluatedCases.reduce(
          (sum, item) =>
            sum + item.student_experience.communication_quality,
          0
        ) / evaluatedCases.length,
      student_audit_separation_rate: fraction(
        studentMessages.filter(
          (message) => validateStudentAuditSeparationV1(message).safe
        ).length,
        studentMessages.length
      )
    },
    teacher_research_utility: {
      evidence_package_completeness: fraction(
        completeTeacherPackages.length,
        evaluatedCases.length
      )
    },
    failure_counts: Object.fromEntries(
      failureTypeSchema.options.map((type) => [
        type,
        failureTypes.filter((value) => value === type).length
      ])
    ) as Record<EvaluationFailureType, number>
  };
}

export function buildBaselineComparison(
  cases: EvaluationCase[]
) {
  const dimensions = {
    traditional_mcq_only: {
      evidence_channel_count: 1,
      diagnostic_accuracy: "answer_correctness_only",
      personalization: "not_supported",
      evidence_traceability: "selected_answer_only",
      learning_progression: "not_supported",
      teacher_usefulness: "item_performance_only",
      efficiency: "single_response"
    },
    mcq_with_generic_ai_explanation: {
      evidence_channel_count: 2,
      diagnostic_accuracy: "answer_correctness_only",
      personalization: "generic_not_response_adaptive",
      evidence_traceability: "answer_and_generic_explanation",
      learning_progression: "single_explanation_no_longitudinal_evidence",
      teacher_usefulness: "limited_item_performance",
      efficiency: "single_explanation"
    },
    conversation_based_assessment: {
      evidence_channel_count: 7,
      diagnostic_accuracy: "structured_multi_evidence_evaluable",
      personalization: "response_adaptive_evaluable",
      evidence_traceability: "decision_to_evidence_trace_evaluable",
      learning_progression: "longitudinal_transition_evaluable",
      teacher_usefulness: "structured_review_package_evaluable",
      efficiency: "turn_and_stopping_evaluable"
    }
  } satisfies Record<EvaluationBaseline, Record<string, string | number>>;
  const representedBaselines = new Set(
    cases.map((item) => item.baseline)
  );
  return {
    contract_version: BASELINE_COMPARISON_CONTRACT_VERSION,
    represented_baselines: [...representedBaselines].sort(),
    same_synthetic_case_family: true,
    causal_claim_made: false,
    numeric_effect_scores_reported: false,
    classifications_describe_available_evidence_not_effectiveness: true,
    dimensions,
    passed:
      representedBaselines.size === EvaluationBaselineSchema.options.length &&
      dimensions.traditional_mcq_only.evidence_channel_count === 1 &&
      dimensions.mcq_with_generic_ai_explanation
        .evidence_channel_count === 2 &&
      dimensions.conversation_based_assessment.evidence_channel_count === 7 &&
      dimensions.conversation_based_assessment.personalization ===
        "response_adaptive_evaluable"
  };
}

export function replayEvaluationDataset(dataset: EvaluationDataset) {
  const caseRecords = [...dataset.cases]
    .sort((first, second) =>
      `${isolationNamespace(first.scope)}:${first.case_id}`.localeCompare(
        `${isolationNamespace(second.scope)}:${second.case_id}`
      )
    )
    .map((item) => ({
      case_id: item.case_id,
      scope_namespace: isolationNamespace(item.scope),
      baseline: item.baseline,
      evidence_source_ids: [...item.evidence.source_evidence_ids].sort(),
      profile_transitions: item.progression.observed_states,
      intervention_decision: item.intervention.selected_strategy,
      stopping_decision: item.stopping.stopping_outcome,
      final_outcome: item.progression.observed_states.at(-1),
      failure_codes: detectEvaluationFailures(item)
    }));
  const auditRecords = dataset.researchAuditDataset.decisionTraces
    .map((trace) => ({
      scope_namespace: isolationNamespace(trace.scope),
      decision_sequence: trace.decision_sequence,
      trace_id: trace.trace_id,
      evidence_span_ids: [...trace.evidence_span_ids].sort(),
      resulting_profile_snapshot_id:
        trace.resulting_profile_snapshot_id,
      outcome_code: trace.outcome_code
    }))
    .sort((first, second) =>
      `${first.scope_namespace}:${first.decision_sequence}:${
        first.trace_id
      }`.localeCompare(
        `${second.scope_namespace}:${second.decision_sequence}:${
          second.trace_id
        }`
      )
    );
  const metrics = computeEvaluationMetrics(dataset.cases);
  const replay = {
    contract_version: EVALUATION_REPLAY_CONTRACT_VERSION,
    case_records: caseRecords,
    audit_records: auditRecords,
    metrics,
    hidden_prompts_required: false,
    hidden_model_reasoning_required: false,
    chain_of_thought_required: false,
    private_identifiers_required: false
  };
  return {
    ...replay,
    replay_hash: stableHash(replay)
  };
}

export function scopeForEvaluationCase(input: {
  student: string;
  session: string;
  misconception?: string;
}): StudentIsolationScope {
  return {
    classroom_run_id: "syn_e2a42_classroom",
    student_subject_id: `syn_student_e2a42_${input.student}`,
    session_id: `syn_session_e2a42_${input.session}`,
    concept_key: "reliability_versus_validity",
    misconception_key:
      input.misconception ?? "reliability_proves_validity"
  };
}
