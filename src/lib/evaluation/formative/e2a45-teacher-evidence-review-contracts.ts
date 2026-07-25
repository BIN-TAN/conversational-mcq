import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";

export const TEACHER_EVIDENCE_VIEW_CONTRACT_VERSION =
  "teacher-evidence-view-contract-v1" as const;
export const TEACHER_EVIDENCE_INTERPRETATION_CONTRACT_VERSION =
  "teacher-evidence-interpretation-contract-v1" as const;
export const TEACHER_ACTION_CONTRACT_VERSION =
  "teacher-action-contract-v1" as const;
export const TEACHER_RESEARCH_BOUNDARY_VERSION =
  "teacher-research-boundary-v1" as const;
export const TEACHER_FEEDBACK_LOOP_VERSION =
  "teacher-feedback-loop-v1" as const;
export const TEACHER_ACCESS_CONTROL_VERSION =
  "teacher-access-control-v1" as const;

export const TeacherReviewScopeSchema = z.enum([
  "class_level",
  "individual_student"
]);
export type TeacherReviewScope = z.infer<
  typeof TeacherReviewScopeSchema
>;

export const TeacherEvidenceVisibilityRuleSchema = z.object({
  field_or_summary: z.string().min(1),
  scope: z.enum(["class_level", "individual_student", "all"]),
  visibility: z.enum(["allowed", "disallowed"]),
  rationale: z.string().min(1),
  authorization_requirement: z.string().min(1)
}).strict();

export const TeacherInterpretationLayerSchema = z.object({
  layer: z.enum([
    "evidence_observed",
    "system_interpretation",
    "teacher_judgment"
  ]),
  authority: z.enum([
    "observable_record",
    "provisional_system_inference",
    "human_instructional_decision"
  ]),
  required_language: z.array(z.string().min(1)).min(1),
  prohibited_language: z.array(z.string().min(1)).min(1)
}).strict();

export const SyntheticTeacherEvidenceRecordSchema = z.object({
  record_id: z.string().regex(/^ev_[a-z0-9_]+$/u),
  course_public_id: z.string().regex(/^course_[a-z0-9_]+$/u),
  research_student_id: z.string().regex(/^research_[a-z0-9_]+$/u),
  authorized_student_label: z.string().min(1),
  concept_id: z.string().regex(/^concept_[a-z0-9_]+$/u),
  learning_state: z.enum([
    "needs_more_work",
    "still_developing",
    "mostly_understood"
  ]),
  misconception_pattern: z.string().nullable(),
  selected_distractor: z.enum(["A", "B", "C", "D"]).nullable(),
  evidence_summary: z.string().min(1),
  learning_gap: z.string().nullable(),
  revision_status: z.enum([
    "not_requested",
    "in_progress",
    "revised",
    "revision_not_needed"
  ]),
  transfer_status: z.enum([
    "not_offered",
    "not_attempted",
    "in_progress",
    "completed"
  ]),
  intervention_strategy: z.string().nullable(),
  intervention_outcome: z.enum([
    "not_observed",
    "improved",
    "unchanged",
    "mixed"
  ]),
  evidence_source_ids: z.array(
    z.string().regex(/^source_[a-z0-9_]+$/u)
  ).min(1),
  observed_at: z.string().datetime()
}).strict();
export type SyntheticTeacherEvidenceRecord = z.infer<
  typeof SyntheticTeacherEvidenceRecordSchema
>;

export type TeacherAccessRequest = {
  actor_role: "teacher" | "researcher" | "student";
  actor_public_id: string;
  authorized_course_public_ids: string[];
  requested_course_public_id: string;
  requested_scope: TeacherReviewScope;
  requested_student_research_id?: string;
  current_student_research_id?: string;
};

export function buildTeacherEvidenceViewContractV1() {
  const rules = [
    {
      field_or_summary: "common_misconception_patterns",
      scope: "class_level",
      visibility: "allowed",
      rationale:
        "Supports review of repeated assessment-specific response patterns.",
      authorization_requirement:
        "teacher_role_and_authorized_course"
    },
    {
      field_or_summary: "concept_difficulty_patterns",
      scope: "class_level",
      visibility: "allowed",
      rationale:
        "Supports course-scoped instructional planning from observed evidence.",
      authorization_requirement:
        "teacher_role_and_authorized_course"
    },
    {
      field_or_summary: "learning_state_distribution",
      scope: "class_level",
      visibility: "allowed",
      rationale:
        "Summarizes assessment-specific states without claiming stable traits.",
      authorization_requirement:
        "teacher_role_and_authorized_course"
    },
    {
      field_or_summary: "frequently_selected_distractors",
      scope: "class_level",
      visibility: "allowed",
      rationale:
        "Surfaces repeated option patterns for teacher interpretation.",
      authorization_requirement:
        "teacher_role_and_authorized_course"
    },
    {
      field_or_summary: "aggregate_intervention_outcomes",
      scope: "class_level",
      visibility: "allowed",
      rationale:
        "Reports observed outcomes without attributing causal effect.",
      authorization_requirement:
        "teacher_role_and_authorized_course"
    },
    {
      field_or_summary: "authorized_student_identity",
      scope: "individual_student",
      visibility: "allowed",
      rationale:
        "Permits instructional follow-up for an authorized student.",
      authorization_requirement:
        "teacher_role_authorized_course_and_student_scope"
    },
    {
      field_or_summary: "individual_evidence_summary",
      scope: "individual_student",
      visibility: "allowed",
      rationale:
        "Provides bounded observable evidence for instructional review.",
      authorization_requirement:
        "teacher_role_authorized_course_and_student_scope"
    },
    {
      field_or_summary: "learning_gap_revision_transfer_and_followup",
      scope: "individual_student",
      visibility: "allowed",
      rationale:
        "Supports student-specific instructional decisions.",
      authorization_requirement:
        "teacher_role_authorized_course_and_student_scope"
    },
    {
      field_or_summary: "chain_of_thought",
      scope: "all",
      visibility: "disallowed",
      rationale:
        "Chain-of-thought is not stored or used as teacher evidence.",
      authorization_requirement: "never_teacher_visible"
    },
    {
      field_or_summary: "hidden_model_reasoning",
      scope: "all",
      visibility: "disallowed",
      rationale:
        "Hidden reasoning is neither required nor valid instructional evidence.",
      authorization_requirement: "never_teacher_visible"
    },
    {
      field_or_summary: "hidden_prompts",
      scope: "all",
      visibility: "disallowed",
      rationale:
        "Protected prompt content is outside teacher evidence review.",
      authorization_requirement: "never_teacher_visible"
    },
    {
      field_or_summary: "internal_model_confidence",
      scope: "all",
      visibility: "disallowed",
      rationale:
        "Internal confidence does not replace observable evidence.",
      authorization_requirement: "never_teacher_visible"
    },
    {
      field_or_summary: "system_only_metadata",
      scope: "all",
      visibility: "disallowed",
      rationale:
        "Runtime and protected implementation metadata are not instructional evidence.",
      authorization_requirement: "never_teacher_visible"
    }
  ] as const;
  return {
    contract_version: TEACHER_EVIDENCE_VIEW_CONTRACT_VERSION,
    rules: rules.map((rule) =>
      TeacherEvidenceVisibilityRuleSchema.parse(rule)
    ),
    class_summaries_must_be_aggregate: true,
    class_summaries_must_not_list_student_ids: true,
    individual_summaries_must_be_student_specific: true,
    cautious_pattern_language_required: true,
    stable_trait_claims_prohibited: true
  };
}

export function buildTeacherEvidenceInterpretationContractV1() {
  const layers = [
    {
      layer: "evidence_observed",
      authority: "observable_record",
      required_language: [
        "responses indicate",
        "observed evidence",
        "recorded response pattern"
      ],
      prohibited_language: [
        "proves a stable trait",
        "confirms motivation",
        "confirms misconduct"
      ]
    },
    {
      layer: "system_interpretation",
      authority: "provisional_system_inference",
      required_language: [
        "possible",
        "candidate pattern",
        "system identified"
      ],
      prohibited_language: [
        "final truth",
        "certain diagnosis",
        "teacher must accept"
      ]
    },
    {
      layer: "teacher_judgment",
      authority: "human_instructional_decision",
      required_language: [
        "teacher may decide",
        "instructional context",
        "professional judgment"
      ],
      prohibited_language: [
        "AI approval required",
        "system decision is final"
      ]
    }
  ] as const;
  return {
    contract_version:
      TEACHER_EVIDENCE_INTERPRETATION_CONTRACT_VERSION,
    layers: layers.map((layer) =>
      TeacherInterpretationLayerSchema.parse(layer)
    ),
    evidence_and_interpretation_separated: true,
    system_interpretation_is_provisional: true,
    teacher_is_instructional_decision_maker: true,
    teacher_is_not_internal_ai_approver: true,
    provenance_required_for_observed_evidence: true
  };
}

export function buildTeacherActionContractV1() {
  return {
    contract_version: TEACHER_ACTION_CONTRACT_VERSION,
    allowed_actions: [
      "review_evidence",
      "identify_instructional_priorities",
      "provide_additional_support",
      "assign_followup_activities",
      "override_instructional_recommendations"
    ],
    prohibited_actions: [
      "modify_historical_student_evidence",
      "delete_audit_records",
      "change_original_responses",
      "alter_research_provenance"
    ],
    recommendation_override_is_append_only: true,
    override_requires_teacher_actor_and_reason: true,
    override_preserves_original_recommendation: true,
    teacher_actions_do_not_rewrite_evidence: true
  } as const;
}

export function buildTeacherResearchBoundaryV1() {
  return {
    contract_version: TEACHER_RESEARCH_BOUNDARY_VERSION,
    views: {
      teacher: {
        purpose: "instructional_information",
        identity_policy:
          "authorized_identity_or_course_scoped_pseudonym",
        allowed: [
          "evidence_summaries",
          "candidate_misconception_patterns",
          "instructional_followup"
        ],
        disallowed: [
          "hidden_reasoning",
          "research_linkage_keys",
          "other_course_records"
        ]
      },
      researcher: {
        purpose: "approved_anonymized_analysis",
        identity_policy: "pseudonymous_research_identifier_only",
        allowed: [
          "approved_analysis_variables",
          "versioned_evidence",
          "aggregate_patterns"
        ],
        disallowed: [
          "direct_student_identity",
          "course_credentials",
          "hidden_reasoning"
        ]
      },
      student: {
        purpose: "feedback_and_next_steps",
        identity_policy: "current_authenticated_student_only",
        allowed: [
          "own_feedback",
          "own_next_steps",
          "own_plain_language_learning_summary"
        ],
        disallowed: [
          "teacher_only_notes",
          "class_summary",
          "other_student_records",
          "internal_ai_decisions"
        ]
      }
    },
    least_privilege_required: true,
    cross_role_projection_prohibited: true,
    course_and_research_identity_separated: true
  } as const;
}

export function buildTeacherFeedbackLoopV1() {
  return {
    contract_version: TEACHER_FEEDBACK_LOOP_VERSION,
    feedback_may_inform: [
      "future_instruction",
      "activity_design",
      "misconception_analysis"
    ],
    feedback_must_include: [
      "feedback_id",
      "teacher_actor_id",
      "course_public_id",
      "created_at",
      "target",
      "feedback_category"
    ],
    historical_evidence_rewrite_allowed: false,
    original_system_interpretation_rewrite_allowed: false,
    feedback_records_are_append_only: true,
    future_use_requires_separate_validated_process: true,
    runtime_intelligence_updated_by_freeze: false
  } as const;
}

export function buildTeacherAccessControlV1() {
  return {
    contract_version: TEACHER_ACCESS_CONTROL_VERSION,
    teacher_access_requires: [
      "authenticated_teacher_role",
      "authorized_course_scope",
      "requested_record_within_course_scope"
    ],
    student_access_requires: [
      "authenticated_student_role",
      "requested_record_owned_by_student"
    ],
    researcher_access_requires: [
      "authenticated_researcher_role",
      "approved_research_scope",
      "pseudonymous_projection"
    ],
    deny_by_default: true,
    cross_course_access_prohibited: true,
    cross_student_access_prohibited: true,
    direct_identifier_research_access_prohibited: true,
    authorization_decision_must_be_auditable: true
  } as const;
}

export function authorizeTeacherEvidenceAccess(
  request: TeacherAccessRequest
) {
  const courseAllowed =
    request.authorized_course_public_ids.includes(
      request.requested_course_public_id
    );
  if (request.actor_role === "teacher") {
    return {
      allowed: courseAllowed,
      projection:
        request.requested_scope === "class_level"
          ? "teacher_class_summary"
          : "teacher_individual_summary",
      reason_code: courseAllowed
        ? "authorized_teacher_course_scope"
        : "teacher_course_scope_denied"
    } as const;
  }
  if (request.actor_role === "student") {
    const ownsRecord =
      request.requested_scope === "individual_student" &&
      request.requested_student_research_id ===
        request.current_student_research_id;
    return {
      allowed: false,
      student_owned_record: ownsRecord,
      projection: "student_feedback_only",
      reason_code: "teacher_evidence_view_denied_to_student"
    } as const;
  }
  return {
    allowed: false,
    projection: "research_pseudonymous_export_only",
    reason_code: "teacher_evidence_view_denied_to_researcher"
  } as const;
}

function countBy<T extends string>(
  values: T[]
): Record<T, number> {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {} as Record<T, number>);
}

export function buildClassEvidenceSummary(input: {
  course_public_id: string;
  records: SyntheticTeacherEvidenceRecord[];
}) {
  const scoped = input.records
    .map((record) => SyntheticTeacherEvidenceRecordSchema.parse(record))
    .filter((record) =>
      record.course_public_id === input.course_public_id
    );
  const misconceptionCounts = countBy(
    scoped
      .map((record) => record.misconception_pattern)
      .filter((value): value is string => value !== null)
  );
  const distractorCounts = countBy(
    scoped
      .map((record) => record.selected_distractor)
      .filter((value): value is "A" | "B" | "C" | "D" =>
        value !== null
      )
  );
  const stateCounts = countBy(
    scoped.map((record) => record.learning_state)
  );
  const interventionOutcomeCounts = countBy(
    scoped.map((record) => record.intervention_outcome)
  );
  const commonPatterns = Object.entries(misconceptionCounts)
    .filter(([, count]) => count >= 2)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pattern, count]) => ({
      pattern,
      count,
      interpretation:
        `A candidate response pattern appeared in ${count} synthetic records; teacher review is required.`
    }));
  return {
    summary_version: "e2a45-class-evidence-summary-v1",
    course_public_id: input.course_public_id,
    student_record_count: scoped.length,
    common_misconception_patterns: commonPatterns,
    concept_difficulty_patterns: commonPatterns.map((pattern) => ({
      concept_id: scoped.find((record) =>
        record.misconception_pattern === pattern.pattern
      )?.concept_id ?? "concept_unknown",
      candidate_pattern: pattern.pattern,
      count: pattern.count
    })),
    learning_state_distribution: stateCounts,
    frequently_selected_distractors: distractorCounts,
    aggregate_intervention_outcomes: interventionOutcomeCounts,
    student_identifiers_included: false,
    direct_identifiers_included: false,
    final_diagnosis_claimed: false,
    teacher_judgment_required: true,
    source_record_count: scoped.length
  };
}

export function buildIndividualEvidenceSummary(input: {
  course_public_id: string;
  research_student_id: string;
  records: SyntheticTeacherEvidenceRecord[];
}) {
  const record = input.records
    .map((candidate) =>
      SyntheticTeacherEvidenceRecordSchema.parse(candidate)
    )
    .find((candidate) =>
      candidate.course_public_id === input.course_public_id &&
      candidate.research_student_id === input.research_student_id
    );
  if (!record) return null;
  const followup = record.learning_state === "mostly_understood"
    ? null
    : record.learning_gap
      ? `Consider additional support focused on ${record.learning_gap}.`
      : "Review the observed evidence before selecting additional support.";
  return {
    summary_version: "e2a45-individual-evidence-summary-v1",
    course_public_id: record.course_public_id,
    student_label: record.authorized_student_label,
    research_student_id: record.research_student_id,
    evidence_observed: record.evidence_summary,
    evidence_source_ids: [...record.evidence_source_ids],
    assessment_specific_learning_state: record.learning_state,
    possible_learning_gap: record.learning_gap,
    revision_status: record.revision_status,
    transfer_status: record.transfer_status,
    recommended_instructional_followup: followup,
    recommendation_is_advisory: true,
    hidden_reasoning_included: false,
    internal_model_confidence_included: false,
    system_metadata_included: false
  };
}

export function buildTeacherEvidenceInterpretation(input: {
  evidence_observed: string;
  source_evidence_ids: string[];
  possible_pattern: string | null;
}) {
  return {
    interpretation_version: "e2a45-teacher-interpretation-v1",
    evidence_observed: {
      statement: input.evidence_observed,
      source_evidence_ids: [...input.source_evidence_ids],
      authority: "observable_record"
    },
    system_interpretation: {
      statement: input.possible_pattern
        ? `The system identified a possible ${input.possible_pattern} response pattern.`
        : "The system did not identify a sufficiently supported candidate response pattern.",
      authority: "provisional_system_inference",
      final_truth_claimed: false
    },
    teacher_judgment: {
      statement:
        "The teacher may decide whether additional instruction is needed using this evidence and the instructional context.",
      authority: "human_instructional_decision",
      required_for_instructional_action: true
    }
  } as const;
}

export function applyTeacherRecommendationOverride<T extends {
  evidence_history: readonly unknown[];
  original_recommendation: string;
  current_recommendation: string;
  override_history: readonly unknown[];
}>(input: {
  state: T;
  teacher_actor_id: string;
  reason: string;
  replacement_recommendation: string;
  created_at: string;
}) {
  const evidenceHashBefore = stableHash(input.state.evidence_history);
  const next = {
    ...input.state,
    current_recommendation: input.replacement_recommendation,
    override_history: [
      ...input.state.override_history,
      {
        override_id:
          `override_${input.state.override_history.length + 1}`,
        teacher_actor_id: input.teacher_actor_id,
        reason: input.reason,
        previous_recommendation:
          input.state.current_recommendation,
        replacement_recommendation:
          input.replacement_recommendation,
        created_at: input.created_at
      }
    ]
  };
  return {
    state: next,
    evidence_history_preserved:
      evidenceHashBefore === stableHash(next.evidence_history),
    original_recommendation_preserved:
      next.original_recommendation ===
        input.state.original_recommendation,
    provenance_preserved: true
  };
}

export function appendTeacherFeedback<T extends {
  historical_evidence: readonly unknown[];
  feedback_history: readonly unknown[];
}>(input: {
  state: T;
  feedback: {
    feedback_id: string;
    teacher_actor_id: string;
    course_public_id: string;
    created_at: string;
    target: "future_instruction" | "activity_design" | "misconception_analysis";
    feedback_category: string;
  };
}) {
  const evidenceHashBefore = stableHash(input.state.historical_evidence);
  const state = {
    ...input.state,
    feedback_history: [
      ...input.state.feedback_history,
      input.feedback
    ]
  };
  return {
    state,
    historical_evidence_preserved:
      evidenceHashBefore === stableHash(state.historical_evidence),
    feedback_appended:
      state.feedback_history.length ===
        input.state.feedback_history.length + 1
  };
}

export function projectResearchEvidence(
  records: SyntheticTeacherEvidenceRecord[]
) {
  return records.map((record) => ({
    research_student_id: record.research_student_id,
    course_public_id: record.course_public_id,
    concept_id: record.concept_id,
    learning_state: record.learning_state,
    misconception_pattern: record.misconception_pattern,
    revision_status: record.revision_status,
    transfer_status: record.transfer_status,
    evidence_source_ids: [...record.evidence_source_ids],
    observed_at: record.observed_at
  }));
}

export function projectStudentEvidence(input: {
  current_student_research_id: string;
  records: SyntheticTeacherEvidenceRecord[];
}) {
  return input.records
    .filter((record) =>
      record.research_student_id ===
        input.current_student_research_id
    )
    .map((record) => ({
      feedback: record.learning_state === "mostly_understood"
        ? "Your explanation shows the key distinction in this item."
        : "Your response shows a useful starting point for the next step.",
      next_step: record.learning_gap
        ? "Use the next activity to strengthen the distinction in your explanation."
        : "Continue when you are ready.",
      learning_summary:
        "This summary describes evidence from your current assessment responses."
    }));
}

export function buildTeacherReviewContractFingerprint(input: {
  evidence_view: ReturnType<typeof buildTeacherEvidenceViewContractV1>;
  interpretation: ReturnType<
    typeof buildTeacherEvidenceInterpretationContractV1
  >;
  actions: ReturnType<typeof buildTeacherActionContractV1>;
  research_boundary: ReturnType<
    typeof buildTeacherResearchBoundaryV1
  >;
  feedback_loop: ReturnType<typeof buildTeacherFeedbackLoopV1>;
  access_control: ReturnType<typeof buildTeacherAccessControlV1>;
}) {
  return {
    fingerprint_version: "e2a45-teacher-review-contract-fingerprint-v1",
    contract_versions: {
      evidence_view: input.evidence_view.contract_version,
      interpretation: input.interpretation.contract_version,
      actions: input.actions.contract_version,
      research_boundary: input.research_boundary.contract_version,
      feedback_loop: input.feedback_loop.contract_version,
      access_control: input.access_control.contract_version
    },
    contract_hashes: Object.fromEntries(
      Object.entries(input).map(([name, value]) => [
        name,
        stableHash(value)
      ])
    ),
    fingerprint_hash: stableHash(input)
  };
}

export function validateTeacherReviewContracts(input: {
  evidence_view: ReturnType<typeof buildTeacherEvidenceViewContractV1>;
  interpretation: ReturnType<
    typeof buildTeacherEvidenceInterpretationContractV1
  >;
  actions: ReturnType<typeof buildTeacherActionContractV1>;
  research_boundary: ReturnType<
    typeof buildTeacherResearchBoundaryV1
  >;
  feedback_loop: ReturnType<typeof buildTeacherFeedbackLoopV1>;
  access_control: ReturnType<typeof buildTeacherAccessControlV1>;
}) {
  const disallowed = input.evidence_view.rules
    .filter((rule) => rule.visibility === "disallowed")
    .map((rule) => rule.field_or_summary);
  const requiredDisallowed = [
    "chain_of_thought",
    "hidden_model_reasoning",
    "hidden_prompts",
    "internal_model_confidence",
    "system_only_metadata"
  ];
  return {
    validation_version: "e2a45-teacher-review-contract-validation-v1",
    evidence_and_interpretation_separated:
      input.interpretation.evidence_and_interpretation_separated,
    teacher_judgment_preserved:
      input.interpretation.teacher_is_instructional_decision_maker,
    all_hidden_fields_disallowed:
      requiredDisallowed.every((field) =>
        disallowed.includes(field)
      ),
    historical_edits_prohibited:
      input.actions.prohibited_actions.includes(
        "modify_historical_student_evidence"
      ),
    feedback_append_only:
      input.feedback_loop.feedback_records_are_append_only,
    role_separation:
      input.research_boundary.cross_role_projection_prohibited,
    access_denies_by_default: input.access_control.deny_by_default,
    passed:
      input.interpretation.evidence_and_interpretation_separated &&
      input.interpretation.teacher_is_instructional_decision_maker &&
      requiredDisallowed.every((field) =>
        disallowed.includes(field)
      ) &&
      input.actions.prohibited_actions.includes(
        "modify_historical_student_evidence"
      ) &&
      input.feedback_loop.feedback_records_are_append_only &&
      input.research_boundary.cross_role_projection_prohibited &&
      input.access_control.deny_by_default
  };
}
