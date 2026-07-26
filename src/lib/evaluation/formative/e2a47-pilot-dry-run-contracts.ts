import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";

export const PILOT_DRY_RUN_WORKFLOW_CONTRACT_VERSION =
  "pilot-dry-run-workflow-contract-v1" as const;
export const END_TO_END_DATA_TRACE_CONTRACT_VERSION =
  "end-to-end-data-trace-contract-v1" as const;
export const RUNTIME_SCHEMA_ALIGNMENT_CONTRACT_VERSION =
  "runtime-schema-alignment-contract-v1" as const;
export const RESEARCH_EXPORT_READINESS_CONTRACT_VERSION =
  "research-export-readiness-contract-v1" as const;
export const PILOT_FAILURE_RECOVERY_CONTRACT_VERSION =
  "pilot-failure-recovery-contract-v1" as const;
export const TEACHER_REVIEW_VALIDATION_CONTRACT_VERSION =
  "teacher-review-validation-contract-v1" as const;

export const DryRunStudentArchetypeSchema = z.enum([
  "fast_learner",
  "slow_engaged_learner",
  "persistent_misconception",
  "copied_wording",
  "self_correction"
]);
export type DryRunStudentArchetype = z.infer<
  typeof DryRunStudentArchetypeSchema
>;

export const DryRunTraceStageSchema = z.enum([
  "assessment_item",
  "student_response",
  "evidence_extraction",
  "learning_profile_update",
  "engagement_profile_update",
  "intervention_selection",
  "post_intervention_response",
  "revision_evidence",
  "transfer_evidence",
  "closure_decision",
  "teacher_evidence_summary",
  "research_export"
]);
export type DryRunTraceStage = z.infer<
  typeof DryRunTraceStageSchema
>;

export const DryRunTraceRecordSchema = z.object({
  record_id: z.string().regex(/^trace_[a-z0-9_]+$/u),
  stage: DryRunTraceStageSchema,
  student_public_id: z.string().regex(/^synthetic_student_[a-e]$/u),
  session_public_id: z.string().regex(/^synthetic_session_[a-e]$/u),
  sequence_index: z.number().int().positive(),
  source_record_ids: z.array(z.string()).max(3),
  evidence_source: z.enum([
    "frozen_assessment_fixture",
    "synthetic_student_fixture",
    "deterministic_evidence_fixture",
    "deterministic_profile_fixture",
    "deterministic_engagement_fixture",
    "deterministic_intervention_fixture",
    "deterministic_closure_fixture",
    "teacher_projection_fixture",
    "research_projection_fixture"
  ]),
  contract_version: z.string().min(1),
  created_at: z.string().datetime(),
  payload_summary: z.record(z.string(), z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.string())
  ])),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict();
export type DryRunTraceRecord = z.infer<
  typeof DryRunTraceRecordSchema
>;

export const DryRunStudentDefinitionSchema = z.object({
  student_public_id: z.string().regex(/^synthetic_student_[a-e]$/u),
  session_public_id: z.string().regex(/^synthetic_session_[a-e]$/u),
  research_student_id: z.string().regex(/^research_synthetic_[a-e]$/u),
  archetype: DryRunStudentArchetypeSchema,
  trajectory: z.array(z.string().min(1)).min(2),
  expected_profile_states: z.array(z.string().min(1)).min(2),
  expected_intervention_strategies: z.array(z.string().min(1)).min(1),
  expected_closure: z.string().min(1),
  expected_sound: z.boolean(),
  expected_instructor_followup: z.boolean()
}).strict();
export type DryRunStudentDefinition = z.infer<
  typeof DryRunStudentDefinitionSchema
>;

export function buildPilotDryRunWorkflowContractV1() {
  return {
    contract_version: PILOT_DRY_RUN_WORKFLOW_CONTRACT_VERSION,
    target_context: "synthetic_university_course_pilot_dry_run",
    before_class: [
      "instructor_selects_assessment_activity",
      "learning_objectives_are_defined",
      "target_misconceptions_are_reviewed",
      "activity_settings_are_configured"
    ],
    during_class: [
      "student_accesses_activity",
      "student_answers_item",
      "student_provides_reasoning",
      "student_provides_confidence",
      "student_receives_formative_dialogue",
      "student_revises_when_appropriate",
      "student_completes_transfer_or_closure_when_appropriate"
    ],
    after_class: [
      "teacher_reviews_evidence_summary",
      "teacher_identifies_instructional_needs",
      "researcher_receives_approved_anonymized_export"
    ],
    required_student_archetypes: [
      "fast_learner",
      "slow_engaged_learner",
      "persistent_misconception",
      "copied_wording",
      "self_correction"
    ],
    application_owns_state_transitions: true,
    persisted_state_is_authoritative: true,
    synthetic_dry_run_only: true,
    classroom_effectiveness_established: false,
    real_student_usability_established: false
  } as const;
}

export function buildEndToEndDataTraceContractV1() {
  return {
    contract_version: END_TO_END_DATA_TRACE_CONTRACT_VERSION,
    ordered_stages: [
      "assessment_item",
      "student_response",
      "evidence_extraction",
      "learning_profile_update",
      "engagement_profile_update",
      "intervention_selection",
      "post_intervention_response",
      "revision_evidence",
      "transfer_evidence",
      "closure_decision",
      "teacher_evidence_summary",
      "research_export"
    ] satisfies DryRunTraceStage[],
    every_transition_requires: [
      "stable_record_id",
      "student_scope",
      "session_scope",
      "sequence_index",
      "source_record_link",
      "contract_version",
      "timestamp",
      "content_hash"
    ],
    source_links_are_append_only: true,
    profile_updates_require_evidence_source: true,
    interventions_require_profile_source: true,
    teacher_summary_requires_closure_source: true,
    research_export_requires_teacher_and_trace_sources: true,
    hidden_reasoning_is_not_a_provenance_source: true
  } as const;
}

export function buildRuntimeSchemaAlignmentContractV1() {
  return {
    contract_version: RUNTIME_SCHEMA_ALIGNMENT_CONTRACT_VERSION,
    predecessor_architecture_version:
      "pilot-data-architecture-contract-v1",
    layer_alignment: {
      assessment_object: {
        conceptual_entities: [
          "item",
          "concept",
          "objective",
          "misconception_target"
        ],
        runtime_objects: [
          "assessment_snapshot",
          "item_snapshot",
          "teacher_diagnostic_context"
        ]
      },
      student_evidence: {
        conceptual_entities: [
          "response",
          "confidence",
          "structured_evidence",
          "distractor",
          "revision_evidence",
          "transfer_evidence"
        ],
        runtime_objects: [
          "item_response",
          "conversation_turn",
          "response_package",
          "activity_evidence_record"
        ]
      },
      learning_state_evolution: {
        conceptual_entities: [
          "profile_history",
          "transitions",
          "evidence_source"
        ],
        runtime_objects: [
          "student_profile",
          "profile_transition",
          "followup_evidence_update_package"
        ]
      },
      intervention: {
        conceptual_entities: [
          "strategy",
          "targeted_gap",
          "outcome"
        ],
        runtime_objects: [
          "formative_decision",
          "activity_runtime_attempt",
          "post_activity_snapshot"
        ]
      },
      classroom_research: {
        conceptual_entities: [
          "student",
          "instructor",
          "course",
          "research_separation"
        ],
        runtime_objects: [
          "teacher_evidence_summary",
          "pseudonymous_research_export",
          "export_manifest"
        ]
      }
    },
    schema_change_required: false,
    alignment_is_contractual_not_migration: true,
    runtime_objects_are_synthetic_in_this_phase: true
  } as const;
}

export function buildResearchExportReadinessContractV1() {
  return {
    contract_version: RESEARCH_EXPORT_READINESS_CONTRACT_VERSION,
    required_fields: [
      "anonymized_student_id",
      "item_public_id",
      "response",
      "evidence_summary",
      "confidence",
      "profile_transitions",
      "intervention_history",
      "revision",
      "transfer",
      "outcome"
    ],
    prohibited_fields: [
      "student_name",
      "username",
      "email",
      "operational_user_id",
      "password",
      "access_code",
      "chain_of_thought",
      "hidden_reasoning",
      "hidden_prompt",
      "raw_provider_payload",
      "api_key",
      "session_secret",
      "unnecessary_internal_metadata"
    ],
    only_approved_research_records: true,
    pseudonymous_identifier_required: true,
    consent_and_withdrawal_gate_required: true,
    stable_ordering_required: true,
    manifest_and_file_hashes_required: true,
    export_failure_must_be_retryable: true
  } as const;
}

export function buildPilotFailureRecoveryContractV1() {
  return {
    contract_version: PILOT_FAILURE_RECOVERY_CONTRACT_VERSION,
    scenarios: [
      {
        failure_type: "student_session_interruption",
        expected_behavior: "restore_last_persisted_state",
        duplicate_effects_allowed: false
      },
      {
        failure_type: "duplicate_submission",
        expected_behavior: "return_canonical_idempotent_result",
        duplicate_effects_allowed: false
      },
      {
        failure_type: "provider_unavailable",
        expected_behavior: "fail_closed_without_data_corruption",
        duplicate_effects_allowed: false
      },
      {
        failure_type: "teacher_review_before_completion",
        expected_behavior: "mark_partial_evidence_explicitly",
        duplicate_effects_allowed: false
      },
      {
        failure_type: "export_interrupted",
        expected_behavior: "retry_from_immutable_source_records",
        duplicate_effects_allowed: false
      },
      {
        failure_type: "profile_update_failure",
        expected_behavior: "preserve_prior_profile_and_failed_audit",
        duplicate_effects_allowed: false
      }
    ],
    evidence_must_be_preserved: true,
    prior_audit_must_be_preserved: true,
    recovery_must_not_invent_evidence: true,
    provider_failure_never_counts_as_success: true
  } as const;
}

export function buildTeacherReviewValidationContractV1() {
  return {
    contract_version: TEACHER_REVIEW_VALIDATION_CONTRACT_VERSION,
    class_level_allowed: [
      "candidate_misconception_patterns",
      "assessment_specific_concept_difficulty"
    ],
    individual_allowed: [
      "authorized_evidence_summary",
      "assessment_specific_learning_gap",
      "revision_status",
      "followup_suggestion",
      "partial_evidence_status"
    ],
    prohibited: [
      "chain_of_thought",
      "hidden_reasoning",
      "hidden_prompts",
      "model_internals",
      "raw_provider_payload",
      "credentials",
      "unnecessary_private_information",
      "cross_course_student_data"
    ],
    summaries_are_bounded_evidence_not_final_judgment: true,
    partial_evidence_must_be_marked: true,
    course_scope_authorization_required: true
  } as const;
}

export function buildDryRunStudentDefinitions() {
  const definitions: DryRunStudentDefinition[] = [
    {
      student_public_id: "synthetic_student_a",
      session_public_id: "synthetic_session_a",
      research_student_id: "research_synthetic_a",
      archetype: "fast_learner",
      trajectory: ["misconception", "sound", "closure"],
      expected_profile_states: ["misconception_visible", "sound"],
      expected_intervention_strategies: ["specific_flaw_contrast"],
      expected_closure: "ready_for_closure",
      expected_sound: true,
      expected_instructor_followup: false
    },
    {
      student_public_id: "synthetic_student_b",
      session_public_id: "synthetic_session_b",
      research_student_id: "research_synthetic_b",
      archetype: "slow_engaged_learner",
      trajectory: ["misconception", "partial", "improvement"],
      expected_profile_states: [
        "misconception_visible",
        "partial",
        "improving"
      ],
      expected_intervention_strategies: [
        "concept_boundary_prompt",
        "guided_application"
      ],
      expected_closure: "bounded_support_complete",
      expected_sound: false,
      expected_instructor_followup: true
    },
    {
      student_public_id: "synthetic_student_c",
      session_public_id: "synthetic_session_c",
      research_student_id: "research_synthetic_c",
      archetype: "persistent_misconception",
      trajectory: [
        "misconception",
        "strategy_change",
        "unresolved"
      ],
      expected_profile_states: [
        "misconception_visible",
        "persistent_unresolved"
      ],
      expected_intervention_strategies: [
        "specific_flaw_contrast",
        "independent_reconstruction"
      ],
      expected_closure: "supportive_bounded_stop",
      expected_sound: false,
      expected_instructor_followup: true
    },
    {
      student_public_id: "synthetic_student_d",
      session_public_id: "synthetic_session_d",
      research_student_id: "research_synthetic_d",
      archetype: "copied_wording",
      trajectory: [
        "correct_terminology_without_evidence",
        "independent_probe",
        "partial"
      ],
      expected_profile_states: [
        "insufficient_independent_evidence",
        "partial"
      ],
      expected_intervention_strategies: [
        "independent_reconstruction"
      ],
      expected_closure: "bounded_support_complete",
      expected_sound: false,
      expected_instructor_followup: true
    },
    {
      student_public_id: "synthetic_student_e",
      session_public_id: "synthetic_session_e",
      research_student_id: "research_synthetic_e",
      archetype: "self_correction",
      trajectory: [
        "misconception",
        "reflection",
        "evidence_based_correction"
      ],
      expected_profile_states: [
        "misconception_visible",
        "reflection",
        "sound"
      ],
      expected_intervention_strategies: [
        "self_explanation_prompt"
      ],
      expected_closure: "ready_for_closure",
      expected_sound: true,
      expected_instructor_followup: false
    }
  ];
  return definitions.map((definition) =>
    DryRunStudentDefinitionSchema.parse(definition)
  );
}

function makeTraceRecord(input: Omit<DryRunTraceRecord, "content_hash">) {
  return DryRunTraceRecordSchema.parse({
    ...input,
    content_hash: stableHash(input)
  });
}

export function buildSyntheticStudentDryRun(
  definition: DryRunStudentDefinition
) {
  const parsed = DryRunStudentDefinitionSchema.parse(definition);
  const timestampBase = Date.parse("2026-01-15T16:00:00.000Z");
  const stageContract = buildEndToEndDataTraceContractV1();
  const records: DryRunTraceRecord[] = [];
  let previousRecordId: string | null = null;
  for (const [index, stage] of stageContract.ordered_stages.entries()) {
    const recordId = `trace_${parsed.student_public_id.replace(
      "synthetic_student_",
      ""
    )}_${stage}`;
    const record = makeTraceRecord({
      record_id: recordId,
      stage,
      student_public_id: parsed.student_public_id,
      session_public_id: parsed.session_public_id,
      sequence_index: index + 1,
      source_record_ids:
        previousRecordId === null ? [] : [previousRecordId],
      evidence_source:
        stage === "assessment_item"
          ? "frozen_assessment_fixture"
          : stage === "student_response" ||
              stage === "post_intervention_response"
            ? "synthetic_student_fixture"
            : stage === "evidence_extraction" ||
                stage === "revision_evidence" ||
                stage === "transfer_evidence"
              ? "deterministic_evidence_fixture"
              : stage === "learning_profile_update"
                ? "deterministic_profile_fixture"
                : stage === "engagement_profile_update"
                  ? "deterministic_engagement_fixture"
                  : stage === "intervention_selection"
                    ? "deterministic_intervention_fixture"
                    : stage === "closure_decision"
                      ? "deterministic_closure_fixture"
                      : stage === "teacher_evidence_summary"
                        ? "teacher_projection_fixture"
                        : "research_projection_fixture",
      contract_version:
        stage === "teacher_evidence_summary"
          ? TEACHER_REVIEW_VALIDATION_CONTRACT_VERSION
          : stage === "research_export"
            ? RESEARCH_EXPORT_READINESS_CONTRACT_VERSION
            : END_TO_END_DATA_TRACE_CONTRACT_VERSION,
      created_at: new Date(timestampBase + index * 1_000).toISOString(),
      payload_summary: buildStagePayload(parsed, stage)
    });
    records.push(record);
    previousRecordId = record.record_id;
  }
  return {
    dry_run_version: "e2a47-synthetic-student-dry-run-v1",
    definition: parsed,
    trace_records: records,
    profile_history: parsed.expected_profile_states.map((state, index) => ({
      profile_snapshot_id:
        `${parsed.student_public_id}_profile_${index + 1}`,
      state,
      evidence_source_record_id:
        records[Math.min(index + 2, records.length - 1)].record_id,
      sequence_index: index + 1
    })),
    intervention_history:
      parsed.expected_intervention_strategies.map((strategy, index) => ({
        intervention_id:
          `${parsed.student_public_id}_intervention_${index + 1}`,
        strategy,
        targeted_gap: "assessment_specific_conceptual_gap",
        source_profile_snapshot_id:
          `${parsed.student_public_id}_profile_${Math.min(
            index + 1,
            parsed.expected_profile_states.length
          )}`,
        outcome:
          index === parsed.expected_intervention_strategies.length - 1
            ? parsed.expected_closure
            : "continued_support"
      })),
    engagement_history: [
      {
        evidence_context: "task_specific_process_signals",
        category:
          parsed.archetype === "fast_learner"
            ? "sufficient_engagement_signals"
            : parsed.archetype === "slow_engaged_learner"
              ? "sustained_engagement_signals"
              : "bounded_engagement_evidence",
        stable_trait_claimed: false
      }
    ],
    closure: {
      reason: parsed.expected_closure,
      sound: parsed.expected_sound,
      instructor_followup_recommended:
        parsed.expected_instructor_followup
    }
  };
}

function buildStagePayload(
  student: DryRunStudentDefinition,
  stage: DryRunTraceStage
) {
  const common = {
    archetype: student.archetype,
    synthetic: true
  };
  const payloads: Record<
    DryRunTraceStage,
    Record<string, string | number | boolean | null | string[]>
  > = {
    assessment_item: {
      ...common,
      item_public_id: "synthetic_measurement_item_1",
      concept: "measurement_interpretation",
      objective: "distinguish_consistency_from_validity",
      misconception_target: "reliability_proves_validity"
    },
    student_response: {
      ...common,
      selected_option: "D",
      reasoning_evidence_status: "accepted_synthetic_fixture",
      confidence: student.archetype === "persistent_misconception"
        ? "high"
        : "medium"
    },
    evidence_extraction: {
      ...common,
      evidence_status:
        student.archetype === "copied_wording"
          ? "insufficient_independent_evidence"
          : "misconception_evidence_visible",
      source_span_count: 1
    },
    learning_profile_update: {
      ...common,
      latest_state:
        student.expected_profile_states.at(-1) ?? "unknown",
      transition_count:
        Math.max(student.expected_profile_states.length - 1, 1)
    },
    engagement_profile_update: {
      ...common,
      evidence_context: "task_specific_process_signals",
      stable_trait_claimed: false
    },
    intervention_selection: {
      ...common,
      strategies: student.expected_intervention_strategies,
      strategy_count:
        student.expected_intervention_strategies.length
    },
    post_intervention_response: {
      ...common,
      conceptual_status:
        student.expected_sound ? "sound" : "not_yet_sound",
      observable_evidence_present:
        student.archetype !== "copied_wording"
    },
    revision_evidence: {
      ...common,
      revision_status:
        student.expected_sound ? "accepted" : "not_authorized",
      prior_evidence_preserved: true
    },
    transfer_evidence: {
      ...common,
      transfer_status:
        student.expected_sound
          ? "completed_when_appropriate"
          : "not_administered_due_to_bounded_support",
      unadministered_content_exposed: false
    },
    closure_decision: {
      ...common,
      closure_reason: student.expected_closure,
      instructor_followup:
        student.expected_instructor_followup
    },
    teacher_evidence_summary: {
      ...common,
      evidence_scope: "authorized_course_summary",
      partial_evidence_marked: !student.expected_sound,
      hidden_reasoning_included: false
    },
    research_export: {
      ...common,
      anonymized_student_id:
        student.research_student_id,
      approved_for_synthetic_export: true,
      direct_identifiers_included: false
    }
  };
  return payloads[stage];
}

export function validateEndToEndTrace(input: {
  definition: DryRunStudentDefinition;
  records: DryRunTraceRecord[];
}) {
  const contract = buildEndToEndDataTraceContractV1();
  const records = input.records.map((record) =>
    DryRunTraceRecordSchema.parse(record)
  );
  const stages = records.map((record) => record.stage);
  const stageOrderMatches =
    stableHash(stages) === stableHash(contract.ordered_stages);
  const sequenceIsMonotonic = records.every((record, index) =>
    record.sequence_index === index + 1
  );
  const provenanceLinksComplete = records.every((record, index) =>
    index === 0
      ? record.source_record_ids.length === 0
      : record.source_record_ids.includes(records[index - 1].record_id)
  );
  const scopeIsolated = records.every((record) =>
    record.student_public_id === input.definition.student_public_id &&
    record.session_public_id === input.definition.session_public_id
  );
  const hashesValid = records.every((record) => {
    const source = Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => key !== "content_hash"
      )
    );
    return record.content_hash === stableHash(source);
  });
  return {
    validation_version: "e2a47-end-to-end-trace-validation-v1",
    expected_stage_count: contract.ordered_stages.length,
    actual_stage_count: records.length,
    stage_order_matches: stageOrderMatches,
    sequence_is_monotonic: sequenceIsMonotonic,
    provenance_links_complete: provenanceLinksComplete,
    scope_isolated: scopeIsolated,
    hashes_valid: hashesValid,
    passed:
      records.length === contract.ordered_stages.length &&
      stageOrderMatches &&
      sequenceIsMonotonic &&
      provenanceLinksComplete &&
      scopeIsolated &&
      hashesValid
  };
}

export function validateRuntimeSchemaAlignment(input: {
  predecessor_entities: Array<{
    entity_name: string;
    layer: string;
  }>;
}) {
  const contract = buildRuntimeSchemaAlignmentContractV1();
  const results = Object.entries(contract.layer_alignment).map(
    ([layer, definition]) => {
      const available = input.predecessor_entities
        .filter((entity) => entity.layer === layer)
        .map((entity) => entity.entity_name);
      const missing = definition.conceptual_entities.filter(
        (entity) => !available.includes(entity)
      );
      return {
        layer,
        conceptual_entities:
          [...definition.conceptual_entities],
        runtime_objects: [...definition.runtime_objects],
        missing_predecessor_entities: missing,
        passed: missing.length === 0
      };
    }
  );
  return {
    validation_version:
      "e2a47-runtime-schema-alignment-validation-v1",
    layer_results: results,
    schema_change_required: false,
    passed: results.every((result) => result.passed)
  };
}

export function buildTeacherReviewProjection(input: {
  dryRuns: ReturnType<typeof buildSyntheticStudentDryRun>[];
}) {
  return {
    projection_version: "e2a47-teacher-review-projection-v1",
    course_scope: "synthetic_course_edpy507",
    class_level: {
      candidate_misconception_patterns: [
        {
          pattern: "reliability_treated_as_validity",
          synthetic_student_count: input.dryRuns.length,
          confirmed_misconception: false
        }
      ],
      assessment_specific_concept_difficulty: {
        concept: "measurement_interpretation",
        evidence_basis: "synthetic_dry_run_only"
      }
    },
    individual: input.dryRuns.map((dryRun) => ({
      student_public_id: dryRun.definition.student_public_id,
      authorized_evidence_summary:
        dryRun.closure.sound
          ? "Current evidence supports the target distinction."
          : "Current evidence remains partial or unresolved.",
      assessment_specific_learning_gap:
        dryRun.closure.sound
          ? null
          : "distinguish_consistency_from_validity",
      revision_status:
        dryRun.closure.sound ? "accepted" : "not_authorized",
      followup_suggestion:
        dryRun.closure.instructor_followup_recommended
          ? "Consider a course-scoped follow-up."
          : null,
      partial_evidence_status:
        dryRun.closure.sound ? "complete_for_dry_run" : "partial"
    }))
  };
}

export function validateTeacherReviewProjection(
  projection: ReturnType<typeof buildTeacherReviewProjection>
) {
  const contract = buildTeacherReviewValidationContractV1();
  const serialized = JSON.stringify(projection);
  const prohibitedValuesAbsent = contract.prohibited.every(
    (field) => !serialized.includes(`"${field}":`)
  );
  return {
    validation_version:
      "e2a47-teacher-review-projection-validation-v1",
    class_summary_present:
      projection.class_level.candidate_misconception_patterns.length > 0,
    concept_difficulty_present:
      projection.class_level.assessment_specific_concept_difficulty
        .concept.length > 0,
    individual_summary_count: projection.individual.length,
    partial_evidence_marked: projection.individual.every(
      (record) => record.partial_evidence_status.length > 0
    ),
    hidden_reasoning_absent:
      !Object.hasOwn(projection, "chain_of_thought"),
    hidden_prompts_absent:
      !Object.hasOwn(projection, "hidden_prompts"),
    model_internals_absent:
      !Object.hasOwn(projection, "model_internals"),
    private_information_absent:
      !Object.hasOwn(projection, "unnecessary_private_information"),
    prohibited_values_absent: prohibitedValuesAbsent,
    passed:
      projection.class_level.candidate_misconception_patterns.length > 0 &&
      projection.individual.length === 5 &&
      projection.individual.every(
        (record) => record.partial_evidence_status.length > 0
      ) &&
      prohibitedValuesAbsent
  };
}

export function buildResearchExportProjection(input: {
  dryRuns: ReturnType<typeof buildSyntheticStudentDryRun>[];
}) {
  return {
    export_version: RESEARCH_EXPORT_READINESS_CONTRACT_VERSION,
    source_cutoff: "2026-01-15T17:00:00.000Z",
    stable_ordering: "anonymized_student_id_item_public_id",
    records: input.dryRuns.map((dryRun) => ({
      anonymized_student_id:
        dryRun.definition.research_student_id,
      item_public_id: "synthetic_measurement_item_1",
      response: "synthetic_response_fixture",
      evidence_summary:
        dryRun.closure.sound
          ? "sound_evidence"
          : "partial_or_unresolved_evidence",
      confidence:
        dryRun.definition.archetype === "persistent_misconception"
          ? "high"
          : "medium",
      profile_transitions:
        dryRun.profile_history.map((profile) => profile.state),
      intervention_history:
        dryRun.intervention_history.map(
          (intervention) => intervention.strategy
        ),
      revision:
        dryRun.closure.sound ? "accepted" : "not_authorized",
      transfer:
        dryRun.closure.sound
          ? "completed_when_appropriate"
          : "not_administered",
      outcome: dryRun.closure.reason
    })),
    manifest: {
      record_count: input.dryRuns.length,
      source_hash: stableHash(
        input.dryRuns.map((dryRun) => dryRun.trace_records)
      ),
      schema_version: RESEARCH_EXPORT_READINESS_CONTRACT_VERSION
    }
  };
}

export function validateResearchExportProjection(
  projection: ReturnType<typeof buildResearchExportProjection>
) {
  const contract = buildResearchExportReadinessContractV1();
  const requiredFieldsPresent = projection.records.every((record) =>
    contract.required_fields.every((field) =>
      Object.hasOwn(record, field)
    )
  );
  const prohibitedFieldsAbsent = projection.records.every((record) =>
    contract.prohibited_fields.every((field) =>
      !Object.hasOwn(record, field)
    )
  );
  const stableOrdering = projection.records.every(
    (record, index, all) =>
      index === 0 ||
      all[index - 1].anonymized_student_id.localeCompare(
        record.anonymized_student_id
      ) <= 0
  );
  return {
    validation_version:
      "e2a47-research-export-projection-validation-v1",
    record_count: projection.records.length,
    required_fields_present: requiredFieldsPresent,
    prohibited_fields_absent: prohibitedFieldsAbsent,
    direct_identifiers_absent: projection.records.every(
      (record) =>
        record.anonymized_student_id.startsWith(
          "research_synthetic_"
        )
    ),
    hidden_reasoning_absent: prohibitedFieldsAbsent,
    stable_ordering: stableOrdering,
    manifest_record_count_matches:
      projection.manifest.record_count === projection.records.length,
    passed:
      projection.records.length === 5 &&
      requiredFieldsPresent &&
      prohibitedFieldsAbsent &&
      stableOrdering &&
      projection.manifest.record_count === projection.records.length
  };
}

export function simulatePilotFailureRecovery(input: {
  failure_type:
    | "student_session_interruption"
    | "duplicate_submission"
    | "provider_unavailable"
    | "teacher_review_before_completion"
    | "export_interrupted"
    | "profile_update_failure";
  evidence_records: readonly unknown[];
  audit_records: readonly unknown[];
}) {
  const scenario = buildPilotFailureRecoveryContractV1()
    .scenarios
    .find((candidate) =>
      candidate.failure_type === input.failure_type
    );
  if (!scenario) {
    throw new Error("e2a47_unknown_failure_scenario");
  }
  const evidenceHash = stableHash(input.evidence_records);
  const auditHash = stableHash(input.audit_records);
  const nextEvidence = [...input.evidence_records];
  const nextAudit = [
    ...input.audit_records,
    {
      failure_type: input.failure_type,
      status: "handled",
      safe_reason_code: `e2a47_${input.failure_type}`,
      raw_error_included: false
    }
  ];
  return {
    failure_type: input.failure_type,
    expected_behavior: scenario.expected_behavior,
    evidence_records: nextEvidence,
    audit_records: nextAudit,
    evidence_preserved:
      stableHash(nextEvidence) === evidenceHash,
    prior_audit_preserved:
      stableHash(nextAudit.slice(0, -1)) === auditHash,
    duplicate_effect_count: 0,
    profile_pointer_changed:
      input.failure_type === "profile_update_failure"
        ? false
        : null,
    partial_evidence_marked:
      input.failure_type === "teacher_review_before_completion"
        ? true
        : null,
    retry_uses_immutable_sources:
      input.failure_type === "export_interrupted"
        ? true
        : null,
    data_corrupted: false
  };
}

export function buildPilotDryRunContractFingerprint(input: {
  workflow: ReturnType<typeof buildPilotDryRunWorkflowContractV1>;
  data_trace: ReturnType<typeof buildEndToEndDataTraceContractV1>;
  schema_alignment: ReturnType<typeof buildRuntimeSchemaAlignmentContractV1>;
  research_export: ReturnType<typeof buildResearchExportReadinessContractV1>;
  failure_recovery: ReturnType<typeof buildPilotFailureRecoveryContractV1>;
  teacher_review: ReturnType<typeof buildTeacherReviewValidationContractV1>;
}) {
  return {
    fingerprint_version:
      "e2a47-pilot-dry-run-contract-fingerprint-v1",
    contract_versions: {
      workflow: input.workflow.contract_version,
      data_trace: input.data_trace.contract_version,
      schema_alignment: input.schema_alignment.contract_version,
      research_export: input.research_export.contract_version,
      failure_recovery: input.failure_recovery.contract_version,
      teacher_review: input.teacher_review.contract_version
    },
    contract_hashes: Object.fromEntries(
      Object.entries(input).map(([name, contract]) => [
        name,
        stableHash(contract)
      ])
    ),
    fingerprint_hash: stableHash(input)
  };
}

export function validatePilotDryRunContracts(input: {
  workflow: ReturnType<typeof buildPilotDryRunWorkflowContractV1>;
  data_trace: ReturnType<typeof buildEndToEndDataTraceContractV1>;
  schema_alignment: ReturnType<typeof buildRuntimeSchemaAlignmentContractV1>;
  research_export: ReturnType<typeof buildResearchExportReadinessContractV1>;
  failure_recovery: ReturnType<typeof buildPilotFailureRecoveryContractV1>;
  teacher_review: ReturnType<typeof buildTeacherReviewValidationContractV1>;
}) {
  const checks = {
    workflow_has_all_three_phases:
      input.workflow.before_class.length > 0 &&
      input.workflow.during_class.length > 0 &&
      input.workflow.after_class.length > 0,
    workflow_has_five_archetypes:
      input.workflow.required_student_archetypes.length === 5,
    data_trace_has_full_chain:
      input.data_trace.ordered_stages.length === 12,
    schema_has_five_layers:
      Object.keys(input.schema_alignment.layer_alignment).length === 5,
    export_has_required_fields:
      input.research_export.required_fields.length === 10,
    export_excludes_hidden_reasoning:
      input.research_export.prohibited_fields.includes(
        "hidden_reasoning"
      ),
    failure_recovery_has_six_scenarios:
      input.failure_recovery.scenarios.length === 6,
    teacher_review_excludes_internals:
      input.teacher_review.prohibited.includes("model_internals"),
    operational_validation_only:
      !input.workflow.classroom_effectiveness_established &&
      !input.workflow.real_student_usability_established
  };
  return {
    validation_version:
      "e2a47-pilot-dry-run-contract-validation-v1",
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}
