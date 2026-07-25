import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";

export const CLASSROOM_WORKFLOW_CONTRACT_VERSION =
  "classroom-workflow-contract-v1" as const;
export const PILOT_DATA_ARCHITECTURE_CONTRACT_VERSION =
  "pilot-data-architecture-contract-v1" as const;
export const RESEARCH_DATA_BOUNDARY_VERSION =
  "research-data-boundary-v1" as const;
export const TEACHER_VISIBILITY_CONTRACT_VERSION =
  "teacher-visibility-contract-v1" as const;
export const STUDENT_PRIVACY_CONTRACT_VERSION =
  "student-privacy-contract-v1" as const;
export const CONSENT_WITHDRAWAL_CONTRACT_VERSION =
  "consent-and-withdrawal-contract-v1" as const;
export const ANONYMIZATION_CONTRACT_VERSION =
  "anonymization-contract-v1" as const;
export const DATA_EXPORT_REPRODUCIBILITY_CONTRACT_VERSION =
  "data-export-reproducibility-contract-v1" as const;

export const PilotLayerIdSchema = z.enum([
  "assessment_object",
  "student_evidence",
  "learning_state_evolution",
  "intervention",
  "classroom_research"
]);
export type PilotLayerId = z.infer<typeof PilotLayerIdSchema>;

export const PilotLayerEntitySchema = z.object({
  entity_name: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  layer: PilotLayerIdSchema,
  purpose: z.string().min(1),
  authoritative_source: z.string().min(1),
  required_fields: z.array(z.string().min(1)).min(1).max(16),
  temporal_rule: z.string().min(1),
  isolation_scope: z.string().min(1),
  interpretation_caution: z.string().min(1)
}).strict();
export type PilotLayerEntity = z.infer<typeof PilotLayerEntitySchema>;

export const PilotWorkflowStateSchema = z.object({
  state_id: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  purpose: z.string().min(1),
  required_preconditions: z.array(z.string().min(1)).max(12),
  permitted_actions: z.array(z.string().min(1)).min(1).max(12),
  prohibited_actions: z.array(z.string().min(1)).min(1).max(12)
}).strict();
export type PilotWorkflowState = z.infer<
  typeof PilotWorkflowStateSchema
>;

export const VisibilityRuleSchema = z.object({
  field_or_summary: z.string().min(1),
  visibility: z.enum(["allowed", "disallowed"]),
  rationale: z.string().min(1),
  scope_requirement: z.string().min(1)
}).strict();
export type VisibilityRule = z.infer<typeof VisibilityRuleSchema>;

export const ResearchConsentStatusSchema = z.enum([
  "not_requested",
  "pending",
  "consented",
  "declined",
  "withdrawn"
]);
export type ResearchConsentStatus = z.infer<
  typeof ResearchConsentStatusSchema
>;

export function buildClassroomWorkflowContractV1() {
  const states: PilotWorkflowState[] = [
    {
      state_id: "pilot_setup",
      purpose:
        "Verify course, instructor, assessment, privacy, retention, and approved research configuration.",
      required_preconditions: [
        "authorized_operator",
        "approved_course_scope"
      ],
      permitted_actions: [
        "configure_course",
        "assign_assessment",
        "verify_access_controls"
      ],
      prohibited_actions: [
        "assume_reb_approval",
        "enable_unapproved_research_collection"
      ]
    },
    {
      state_id: "participant_access",
      purpose:
        "Create or import scoped student access without exposing credentials or joining research identity.",
      required_preconditions: [
        "course_configured",
        "instructor_authorized"
      ],
      permitted_actions: [
        "create_student_access",
        "distribute_credentials_securely"
      ],
      prohibited_actions: [
        "print_credentials_in_logs",
        "create_cross_course_access"
      ]
    },
    {
      state_id: "research_eligibility",
      purpose:
        "Record consent status separately from course participation and grade operations.",
      required_preconditions: [
        "approved_consent_process_if_research_is_enabled"
      ],
      permitted_actions: [
        "record_consent_status",
        "record_withdrawal",
        "exclude_nonconsenting_records"
      ],
      prohibited_actions: [
        "condition_course_access_on_research_consent",
        "condition_grade_on_research_consent"
      ]
    },
    {
      state_id: "student_assessment",
      purpose:
        "Run the application-governed chat-native assessment for the assigned student.",
      required_preconditions: [
        "student_authenticated",
        "assessment_available",
        "attempt_policy_satisfied"
      ],
      permitted_actions: [
        "start_or_resume_attempt",
        "collect_assessment_evidence",
        "pause_or_end_attempt"
      ],
      prohibited_actions: [
        "cross_student_access",
        "llm_owned_state_transition"
      ]
    },
    {
      state_id: "teacher_review",
      purpose:
        "Provide course-scoped evidence summaries and instructional support without exposing hidden internals.",
      required_preconditions: [
        "teacher_authenticated",
        "teacher_course_scope_verified"
      ],
      permitted_actions: [
        "review_evidence_summary",
        "review_candidate_misconception_patterns",
        "review_instructional_support"
      ],
      prohibited_actions: [
        "view_hidden_model_reasoning",
        "view_cross_course_student_records"
      ]
    },
    {
      state_id: "research_export",
      purpose:
        "Create a versioned, pseudonymous, reproducible export containing only eligible approved records.",
      required_preconditions: [
        "research_authorization_active",
        "consent_status_consented",
        "withdrawal_status_not_withdrawn",
        "export_scope_approved"
      ],
      permitted_actions: [
        "build_pseudonymous_export",
        "write_export_manifest",
        "verify_export_hashes"
      ],
      prohibited_actions: [
        "export_nonconsenting_records",
        "export_direct_identifiers",
        "export_hidden_reasoning"
      ]
    },
    {
      state_id: "withdrawal_processing",
      purpose:
        "Stop future research inclusion and apply the approved withdrawal and retention policy without affecting course standing.",
      required_preconditions: [
        "withdrawal_request_recorded"
      ],
      permitted_actions: [
        "exclude_future_exports",
        "apply_approved_record_disposition",
        "preserve_course_research_separation"
      ],
      prohibited_actions: [
        "penalize_course_participation",
        "silently_reinclude_withdrawn_records"
      ]
    }
  ];
  return {
    contract_version: CLASSROOM_WORKFLOW_CONTRACT_VERSION,
    states: states.map((state) =>
      PilotWorkflowStateSchema.parse(state)
    ),
    state_order: states.map((state) => state.state_id),
    application_owns_authoritative_transitions: true,
    course_participation_independent_of_research_consent: true,
    research_export_fails_closed: true,
    deployment_authorized_by_freeze: false
  };
}

export function buildPilotDataArchitectureContractV1() {
  const entities: PilotLayerEntity[] = [
    {
      entity_name: "item",
      layer: "assessment_object",
      purpose: "Versioned administered MCQ content and option structure.",
      authoritative_source: "administered_item_snapshot",
      required_fields: [
        "item_public_id",
        "content_version",
        "stem",
        "options"
      ],
      temporal_rule:
        "Use the administered snapshot rather than mutable current content.",
      isolation_scope: "assessment_and_concept_unit",
      interpretation_caution:
        "Protected answer-key fields remain outside student-visible output."
    },
    {
      entity_name: "concept",
      layer: "assessment_object",
      purpose: "Concept associated with the administered item.",
      authoritative_source: "versioned_content_metadata",
      required_fields: ["concept_public_id", "concept_name"],
      temporal_rule: "Bind the version active at administration.",
      isolation_scope: "assessment",
      interpretation_caution:
        "A concept label does not establish complete content coverage."
    },
    {
      entity_name: "objective",
      layer: "assessment_object",
      purpose: "Teacher-authored learning or diagnostic objective.",
      authoritative_source: "teacher_authored_content_metadata",
      required_fields: ["objective_id", "objective_text"],
      temporal_rule: "Retain the administered objective version.",
      isolation_scope: "item_or_concept",
      interpretation_caution:
        "Objective alignment requires expert review."
    },
    {
      entity_name: "misconception_target",
      layer: "assessment_object",
      purpose:
        "Teacher-authored candidate misconception represented by a distractor.",
      authoritative_source: "teacher_authored_diagnostic_context",
      required_fields: [
        "misconception_target_id",
        "linked_option",
        "diagnostic_summary"
      ],
      temporal_rule: "Retain the administered diagnostic-context version.",
      isolation_scope: "item_and_option",
      interpretation_caution:
        "A target is a candidate interpretation, not a confirmed student state."
    },
    {
      entity_name: "evidence_requirements",
      layer: "assessment_object",
      purpose:
        "Observable evidence needed to support bounded diagnostic decisions.",
      authoritative_source: "versioned_evidence_contract",
      required_fields: [
        "contract_version",
        "required_evidence_types",
        "sound_criteria"
      ],
      temporal_rule: "Bind the evaluator contract used for the decision.",
      isolation_scope: "item_or_activity",
      interpretation_caution:
        "Required evidence must not be replaced by hidden model reasoning."
    },
    {
      entity_name: "response",
      layer: "student_evidence",
      purpose: "Student-selected answer for an administered item.",
      authoritative_source: "item_response_record",
      required_fields: [
        "response_public_id",
        "selected_option",
        "submitted_at"
      ],
      temporal_rule: "Preserve initial and latest accepted values.",
      isolation_scope: "student_session_item",
      interpretation_caution:
        "Answer correctness alone does not establish reasoning quality."
    },
    {
      entity_name: "confidence",
      layer: "student_evidence",
      purpose: "Student-selected task-specific confidence evidence.",
      authoritative_source: "item_response_record",
      required_fields: ["confidence_value", "selected_at"],
      temporal_rule: "Preserve initial, final, and revision timestamps.",
      isolation_scope: "student_session_item",
      interpretation_caution:
        "Confidence is task-specific and not a stable learner trait."
    },
    {
      entity_name: "distractor",
      layer: "student_evidence",
      purpose: "Tempting-option selection and student-authored rationale.",
      authoritative_source: "item_response_and_conversation_records",
      required_fields: [
        "tempting_option",
        "tempting_option_reason",
        "submitted_at"
      ],
      temporal_rule: "Preserve accepted revisions and source turns.",
      isolation_scope: "student_session_item",
      interpretation_caution:
        "Distractor evidence supports a candidate pattern, not a confirmed misconception."
    },
    {
      entity_name: "structured_evidence",
      layer: "student_evidence",
      purpose:
        "Validated observable evidence spans and bounded classifications.",
      authoritative_source: "validated_evidence_pipeline",
      required_fields: [
        "evidence_id",
        "source_record_id",
        "evidence_type",
        "validator_version"
      ],
      temporal_rule: "Append versioned accepted and rejected evidence decisions.",
      isolation_scope: "student_session_interaction",
      interpretation_caution:
        "Structured evidence must retain provenance and cannot include chain-of-thought."
    },
    {
      entity_name: "revision_evidence",
      layer: "student_evidence",
      purpose: "Student revision with before, after, and source evidence links.",
      authoritative_source: "revision_and_conversation_records",
      required_fields: [
        "revision_id",
        "previous_record_id",
        "revised_record_id",
        "revised_at"
      ],
      temporal_rule: "Never overwrite the prior accepted revision state.",
      isolation_scope: "student_session_item_or_activity",
      interpretation_caution:
        "A revision is not by itself proof of durable learning."
    },
    {
      entity_name: "transfer_evidence",
      layer: "student_evidence",
      purpose: "Observable response evidence from an administered transfer item.",
      authoritative_source: "transfer_item_response_snapshot",
      required_fields: [
        "transfer_response_id",
        "transfer_item_public_id",
        "submitted_at"
      ],
      temporal_rule: "Store only actually administered transfer evidence.",
      isolation_scope: "student_session_transfer_item",
      interpretation_caution:
        "One transfer response provides bounded, context-specific evidence."
    },
    {
      entity_name: "profile_history",
      layer: "learning_state_evolution",
      purpose:
        "Append-only history of assessment-specific evidence summaries.",
      authoritative_source: "validated_profile_snapshots",
      required_fields: [
        "profile_snapshot_id",
        "profile_version",
        "created_at"
      ],
      temporal_rule: "Append snapshots; never replace historical states.",
      isolation_scope: "student_session_concept",
      interpretation_caution:
        "Profiles are assessment-specific evidence summaries, not stable traits."
    },
    {
      entity_name: "transitions",
      layer: "learning_state_evolution",
      purpose: "Versioned links between consecutive profile snapshots.",
      authoritative_source: "validated_profile_transition_decision",
      required_fields: [
        "transition_id",
        "from_snapshot_id",
        "to_snapshot_id",
        "decision_version"
      ],
      temporal_rule: "Order by accepted evidence sequence and timestamp.",
      isolation_scope: "student_session_concept",
      interpretation_caution:
        "A transition describes current evidence, not a causal effect."
    },
    {
      entity_name: "evidence_source",
      layer: "learning_state_evolution",
      purpose: "Provenance links from a state transition to observable records.",
      authoritative_source: "research_audit_evidence_links",
      required_fields: [
        "source_record_id",
        "source_type",
        "evidence_sequence"
      ],
      temporal_rule: "Retain source links for every accepted transition.",
      isolation_scope: "student_session_interaction",
      interpretation_caution:
        "Hidden prompts and hidden model reasoning are not evidence sources."
    },
    {
      entity_name: "timestamps",
      layer: "learning_state_evolution",
      purpose: "Server-authoritative ordering and bounded client timing context.",
      authoritative_source: "server_persisted_timestamps",
      required_fields: [
        "created_at",
        "accepted_at",
        "sequence_number"
      ],
      temporal_rule:
        "Use server sequence for ordering and preserve clock-source metadata.",
      isolation_scope: "student_session",
      interpretation_caution:
        "Timing alone does not prove understanding, effort, or misconduct."
    },
    {
      entity_name: "strategy",
      layer: "intervention",
      purpose: "Validated intervention strategy selected for current evidence.",
      authoritative_source: "formative_decision_record",
      required_fields: [
        "strategy_id",
        "strategy_version",
        "selected_at"
      ],
      temporal_rule: "Retain every selected strategy as an immutable decision.",
      isolation_scope: "student_session_concept",
      interpretation_caution:
        "Selection does not prove that the intervention was effective."
    },
    {
      entity_name: "targeted_gap",
      layer: "intervention",
      purpose: "Evidence-linked gap targeted by an intervention.",
      authoritative_source: "validated_formative_decision",
      required_fields: [
        "gap_id",
        "evidence_source_ids",
        "decision_version"
      ],
      temporal_rule: "Bind the gap to the evidence available at selection.",
      isolation_scope: "student_session_concept",
      interpretation_caution:
        "The gap is a bounded working hypothesis."
    },
    {
      entity_name: "outcome",
      layer: "intervention",
      purpose: "Observed bounded response following an intervention.",
      authoritative_source: "activity_and_followup_records",
      required_fields: [
        "outcome_id",
        "intervention_id",
        "observed_record_ids"
      ],
      temporal_rule: "Append after accepted student evidence.",
      isolation_scope: "student_session_intervention",
      interpretation_caution:
        "Temporal order does not alone establish intervention causality."
    },
    {
      entity_name: "adaptation_history",
      layer: "intervention",
      purpose:
        "Ordered history of strategy changes and evidence-linked rationale codes.",
      authoritative_source: "validated_intervention_decisions",
      required_fields: [
        "adaptation_id",
        "previous_strategy_id",
        "next_strategy_id",
        "evidence_source_ids"
      ],
      temporal_rule: "Append every adaptation; retain prior strategies.",
      isolation_scope: "student_session_concept",
      interpretation_caution:
        "Expose bounded summaries to teachers, not internal routing details to students."
    },
    {
      entity_name: "student",
      layer: "classroom_research",
      purpose: "Course account linked to a separate pseudonymous research ID.",
      authoritative_source: "user_and_research_identity_mapping_services",
      required_fields: [
        "operational_user_id",
        "research_student_id",
        "course_scope"
      ],
      temporal_rule: "Version consent and identity-linkage status separately.",
      isolation_scope: "student_and_course",
      interpretation_caution:
        "Research exports contain the pseudonymous ID, not the operational identity."
    },
    {
      entity_name: "instructor",
      layer: "classroom_research",
      purpose: "Authorized teacher or researcher with explicit scoped roles.",
      authoritative_source: "authorization_service",
      required_fields: ["user_id", "role", "course_scope"],
      temporal_rule: "Audit role and scope changes.",
      isolation_scope: "authorized_course_or_research_scope",
      interpretation_caution:
        "Teacher course access does not automatically grant identifiable research-data access."
    },
    {
      entity_name: "course",
      layer: "classroom_research",
      purpose: "Container for roster, assessments, and authorization boundaries.",
      authoritative_source: "course_configuration",
      required_fields: [
        "course_public_id",
        "course_version",
        "authorized_instructor_ids"
      ],
      temporal_rule: "Retain the course configuration active for each attempt.",
      isolation_scope: "course",
      interpretation_caution:
        "Course membership does not imply research consent."
    },
    {
      entity_name: "research_separation",
      layer: "classroom_research",
      purpose:
        "Versioned boundary between course operations, grading, and research use.",
      authoritative_source: "consent_and_research_authorization_records",
      required_fields: [
        "consent_status",
        "research_eligibility",
        "grade_linkage_prohibited",
        "boundary_version"
      ],
      temporal_rule: "Apply the latest valid consent or withdrawal state.",
      isolation_scope: "student_course_study",
      interpretation_caution:
        "Research participation must not affect course access or grades."
    }
  ];
  return {
    contract_version: PILOT_DATA_ARCHITECTURE_CONTRACT_VERSION,
    layers: [
      "assessment_object",
      "student_evidence",
      "learning_state_evolution",
      "intervention",
      "classroom_research"
    ] as const,
    entities: entities.map((entity) =>
      PilotLayerEntitySchema.parse(entity)
    ),
    conceptual_model_only: true,
    database_schema_change_required_by_freeze: false,
    runtime_intelligence_modified: false,
    append_only_evidence_and_history_required: true
  };
}

export function buildResearchDataBoundaryV1() {
  return {
    boundary_version: RESEARCH_DATA_BOUNDARY_VERSION,
    zones: {
      course_operations: {
        purpose: "authentication_assessment_delivery_and_course_review",
        contains_operational_identity: true,
        research_use_automatic: false
      },
      identity_linkage: {
        purpose: "restricted_pseudonym_mapping_and_consent_status",
        access: "designated_authorized_custodian_only",
        included_in_research_export: false
      },
      research_analysis: {
        purpose: "approved_pseudonymous_research_analysis",
        requires_consent: true,
        excludes_withdrawn_records: true,
        direct_identifiers_allowed: false
      }
    },
    permitted_research_categories: [
      "administered_item_snapshots",
      "student_authored_responses",
      "confidence_and_distractor_evidence",
      "structured_evidence_with_provenance",
      "profile_and_intervention_history",
      "bounded_process_indicators",
      "transfer_and_revision_evidence"
    ],
    prohibited_storage_and_export: [
      "chain_of_thought",
      "hidden_model_reasoning",
      "hidden_prompts",
      "unnecessary_internal_metadata",
      "provider_secrets",
      "password_or_access_code_hashes",
      "direct_identifiers_in_analysis_exports"
    ],
    grade_linkage: {
      research_consent_must_not_affect_grade: true,
      research_withdrawal_must_not_affect_grade: true,
      analysis_export_must_not_include_grade_unless_separately_approved:
        true,
      course_and_research_decisions_separated: true
    },
    process_data_caution:
      "Process indicators do not independently prove understanding, effort, motivation, cheating, or misconduct.",
    research_collection_authorized_by_freeze: false
  } as const;
}

export function buildTeacherVisibilityContractV1() {
  const rules: VisibilityRule[] = [
    {
      field_or_summary: "evidence_summaries",
      visibility: "allowed",
      rationale: "Supports bounded review of observed student evidence.",
      scope_requirement: "authorized_teacher_and_assigned_course"
    },
    {
      field_or_summary: "candidate_misconception_patterns",
      visibility: "allowed",
      rationale: "Supports teacher review without confirming a stable trait.",
      scope_requirement: "authorized_teacher_and_assigned_course"
    },
    {
      field_or_summary: "instructional_support_information",
      visibility: "allowed",
      rationale: "Supports planning tied to observed assessment evidence.",
      scope_requirement: "authorized_teacher_and_assigned_course"
    },
    {
      field_or_summary: "administered_response_and_process_summaries",
      visibility: "allowed",
      rationale: "Supports review and audit of the assigned assessment.",
      scope_requirement: "authorized_teacher_and_assigned_course"
    },
    {
      field_or_summary: "hidden_model_reasoning",
      visibility: "disallowed",
      rationale: "Hidden reasoning is neither required nor valid evidence.",
      scope_requirement: "never_teacher_visible"
    },
    {
      field_or_summary: "hidden_prompts",
      visibility: "disallowed",
      rationale: "System internals are outside classroom evidence review.",
      scope_requirement: "never_teacher_visible"
    },
    {
      field_or_summary: "system_internals",
      visibility: "disallowed",
      rationale: "Runtime routing and protected configuration are not instructional evidence.",
      scope_requirement: "never_teacher_visible"
    },
    {
      field_or_summary: "other_course_or_student_records",
      visibility: "disallowed",
      rationale: "Teacher access is scoped to assigned course and student records.",
      scope_requirement: "never_cross_scope"
    }
  ];
  return {
    contract_version: TEACHER_VISIBILITY_CONTRACT_VERSION,
    rules: rules.map((rule) => VisibilityRuleSchema.parse(rule)),
    course_scope_check_required: true,
    role_check_required: true,
    candidate_patterns_must_use_cautious_language: true,
    raw_internal_diagnostic_state_exposed: false
  };
}

export function buildStudentPrivacyContractV1() {
  const rules: VisibilityRule[] = [
    {
      field_or_summary: "feedback",
      visibility: "allowed",
      rationale: "Provides concise evidence-linked formative support.",
      scope_requirement: "current_student_current_attempt"
    },
    {
      field_or_summary: "next_steps",
      visibility: "allowed",
      rationale: "Explains valid student actions without exposing routing internals.",
      scope_requirement: "current_student_current_attempt"
    },
    {
      field_or_summary: "learning_summaries",
      visibility: "allowed",
      rationale: "Provides plain-language summaries of the student's observed responses.",
      scope_requirement: "current_student_current_attempt"
    },
    {
      field_or_summary: "internal_labels",
      visibility: "disallowed",
      rationale: "Internal ontology labels are not student-facing communication.",
      scope_requirement: "never_student_visible"
    },
    {
      field_or_summary: "profile_fields",
      visibility: "disallowed",
      rationale: "Raw profile fields can overstate bounded evidence.",
      scope_requirement: "never_student_visible"
    },
    {
      field_or_summary: "ai_decisions",
      visibility: "disallowed",
      rationale: "Internal model and policy decisions are not student feedback.",
      scope_requirement: "never_student_visible"
    },
    {
      field_or_summary: "other_student_records",
      visibility: "disallowed",
      rationale: "Students may access only their own current authorized records.",
      scope_requirement: "never_cross_student"
    },
    {
      field_or_summary: "hidden_prompts_or_reasoning",
      visibility: "disallowed",
      rationale: "Hidden prompts and reasoning are not required for student support.",
      scope_requirement: "never_student_visible"
    }
  ];
  return {
    contract_version: STUDENT_PRIVACY_CONTRACT_VERSION,
    rules: rules.map((rule) => VisibilityRuleSchema.parse(rule)),
    plain_language_required: true,
    current_student_scope_required: true,
    internal_state_translation_required: true,
    internal_state_exposed: false
  };
}

export function buildConsentAndWithdrawalContractV1() {
  return {
    contract_version: CONSENT_WITHDRAWAL_CONTRACT_VERSION,
    consent_statuses: ResearchConsentStatusSchema.options,
    consent_record_requires: [
      "study_version",
      "consent_status",
      "recorded_at",
      "recorded_by_process",
      "approved_information_sheet_version"
    ],
    missing_or_pending_consent: {
      course_access_blocked: false,
      research_export_eligible: false,
      research_analysis_eligible: false
    },
    declined_consent: {
      course_access_blocked: false,
      grade_effect_allowed: false,
      research_export_eligible: false
    },
    withdrawal: {
      future_research_export_eligible: false,
      future_research_analysis_eligible: false,
      course_access_blocked: false,
      grade_effect_allowed: false,
      disposition_follows_approved_protocol: true,
      withdrawal_timestamp_required: true,
      withdrawal_audit_record_required: true
    },
    reconsent_requires_new_affirmative_record: true,
    reb_approval_assumed: false,
    consent_collection_authorized_by_freeze: false
  } as const;
}

export function resolveResearchEligibility(input: {
  consentStatus: ResearchConsentStatus;
  withdrawnAt: string | null;
  studyAuthorized: boolean;
}) {
  const consented = input.consentStatus === "consented";
  const withdrawn =
    input.consentStatus === "withdrawn" ||
    input.withdrawnAt !== null;
  const eligible =
    input.studyAuthorized && consented && !withdrawn;
  return {
    course_access_allowed: true,
    research_export_eligible: eligible,
    research_analysis_eligible: eligible,
    excluded_reason: eligible
      ? null
      : !input.studyAuthorized
        ? "study_not_authorized"
        : withdrawn
          ? "withdrawn"
          : "affirmative_consent_missing",
    grade_effect_allowed: false
  } as const;
}

export function buildAnonymizationContractV1() {
  return {
    contract_version: ANONYMIZATION_CONTRACT_VERSION,
    identity_strategy:
      "keyed_hmac_sha256_or_institutionally_approved_equivalent",
    pseudonymization_not_anonymity: true,
    direct_identifier_removed_from_analysis_export: true,
    pseudonym_mapping_stored_separately: true,
    pseudonym_key_stored_outside_export: true,
    pseudonym_key_access:
      "designated_authorized_custodian_only",
    study_specific_namespace_required: true,
    deterministic_within_approved_study: true,
    stable_across_unrelated_studies: false,
    collision_check_required: true,
    small_cell_disclosure_review_required: true,
    free_text_disclosure_scan_required: true,
    reidentification_attempts_prohibited: true,
    raw_identifier_logging_prohibited: true,
    implementation_authorized_by_freeze: false
  } as const;
}

export function buildDataExportReproducibilityContractV1() {
  return {
    contract_version:
      DATA_EXPORT_REPRODUCIBILITY_CONTRACT_VERSION,
    manifest_fields: [
      "export_contract_version",
      "research_schema_version",
      "study_protocol_version",
      "source_snapshot_cutoff",
      "application_git_commit",
      "active_configuration_hash",
      "query_or_service_version",
      "consent_boundary_version",
      "anonymization_contract_version",
      "included_record_counts",
      "excluded_record_counts_by_reason",
      "file_names",
      "file_sha256",
      "canonical_export_hash"
    ],
    canonicalization_rules: [
      "utf8_encoding",
      "lf_line_endings",
      "stable_column_order",
      "stable_record_order",
      "explicit_null_representation",
      "iso_8601_utc_timestamps",
      "generated_at_excluded_from_canonical_hash"
    ],
    required_history: [
      "administered_item_snapshot",
      "accepted_student_evidence",
      "profile_history",
      "intervention_history",
      "revision_history",
      "transfer_history"
    ],
    prohibited_export_content: [
      "direct_identifiers",
      "chain_of_thought",
      "hidden_model_reasoning",
      "hidden_prompts",
      "credentials_or_secrets",
      "nonconsenting_or_withdrawn_records"
    ],
    identical_snapshot_and_versions_require_identical_canonical_hash:
      true,
    export_execution_authorized_by_freeze: false
  } as const;
}

export function buildCanonicalExportFingerprint(input: {
  sourceSnapshotCutoff: string;
  applicationGitCommit: string;
  activeConfigurationHash: string;
  queryOrServiceVersion: string;
  records: Array<{
    researchStudentId: string;
    sessionId: string;
    sequence: number;
    recordType: string;
    payloadHash: string;
  }>;
}) {
  const canonical = {
    contract_version:
      DATA_EXPORT_REPRODUCIBILITY_CONTRACT_VERSION,
    source_snapshot_cutoff: input.sourceSnapshotCutoff,
    application_git_commit: input.applicationGitCommit,
    active_configuration_hash: input.activeConfigurationHash,
    query_or_service_version: input.queryOrServiceVersion,
    records: [...input.records].sort((first, second) =>
      [
        first.researchStudentId,
        first.sessionId,
        first.sequence,
        first.recordType,
        first.payloadHash
      ].join("|").localeCompare([
        second.researchStudentId,
        second.sessionId,
        second.sequence,
        second.recordType,
        second.payloadHash
      ].join("|"))
    )
  };
  return {
    canonical,
    canonical_export_hash: stableHash(canonical)
  };
}

export function buildPilotContractReplayFingerprint(input: {
  workflow: ReturnType<typeof buildClassroomWorkflowContractV1>;
  architecture: ReturnType<
    typeof buildPilotDataArchitectureContractV1
  >;
  researchBoundary: ReturnType<typeof buildResearchDataBoundaryV1>;
  teacherVisibility: ReturnType<
    typeof buildTeacherVisibilityContractV1
  >;
  studentPrivacy: ReturnType<typeof buildStudentPrivacyContractV1>;
  consentWithdrawal: ReturnType<
    typeof buildConsentAndWithdrawalContractV1
  >;
  anonymization: ReturnType<typeof buildAnonymizationContractV1>;
  exportReproducibility: ReturnType<
    typeof buildDataExportReproducibilityContractV1
  >;
}) {
  const replay = {
    workflow_states: input.workflow.states.map((state) => state.state_id),
    architecture_entities: input.architecture.entities
      .map((entity) => ({
        layer: entity.layer,
        entity_name: entity.entity_name,
        required_fields: [...entity.required_fields].sort()
      }))
      .sort((first, second) =>
        `${first.layer}|${first.entity_name}`.localeCompare(
          `${second.layer}|${second.entity_name}`
        )
      ),
    research_zones: Object.keys(input.researchBoundary.zones).sort(),
    teacher_rules: input.teacherVisibility.rules
      .map((rule) => `${rule.visibility}:${rule.field_or_summary}`)
      .sort(),
    student_rules: input.studentPrivacy.rules
      .map((rule) => `${rule.visibility}:${rule.field_or_summary}`)
      .sort(),
    consent_statuses: [...input.consentWithdrawal.consent_statuses],
    anonymization_strategy: input.anonymization.identity_strategy,
    export_manifest_fields: [
      ...input.exportReproducibility.manifest_fields
    ].sort(),
    chain_of_thought_required: false,
    hidden_model_reasoning_required: false,
    provider_call_required: false
  };
  return {
    replay_version: "e2a44-pilot-contract-replay-v1",
    replay,
    replay_hash: stableHash(replay)
  };
}

export function validatePilotArchitectureContracts(input: {
  workflow: ReturnType<typeof buildClassroomWorkflowContractV1>;
  architecture: ReturnType<
    typeof buildPilotDataArchitectureContractV1
  >;
  researchBoundary: ReturnType<typeof buildResearchDataBoundaryV1>;
  teacherVisibility: ReturnType<
    typeof buildTeacherVisibilityContractV1
  >;
  studentPrivacy: ReturnType<typeof buildStudentPrivacyContractV1>;
  consentWithdrawal: ReturnType<
    typeof buildConsentAndWithdrawalContractV1
  >;
  anonymization: ReturnType<typeof buildAnonymizationContractV1>;
  exportReproducibility: ReturnType<
    typeof buildDataExportReproducibilityContractV1
  >;
}) {
  const expectedLayers: PilotLayerId[] = [
    "assessment_object",
    "student_evidence",
    "learning_state_evolution",
    "intervention",
    "classroom_research"
  ];
  const expectedEntities = [
    "item",
    "concept",
    "objective",
    "misconception_target",
    "evidence_requirements",
    "response",
    "confidence",
    "distractor",
    "structured_evidence",
    "revision_evidence",
    "transfer_evidence",
    "profile_history",
    "transitions",
    "evidence_source",
    "timestamps",
    "strategy",
    "targeted_gap",
    "outcome",
    "adaptation_history",
    "student",
    "instructor",
    "course",
    "research_separation"
  ];
  const entityNames = input.architecture.entities.map(
    (entity) => entity.entity_name
  );
  const prohibited = new Set(
    input.researchBoundary.prohibited_storage_and_export
  );
  const teacherAllowed = input.teacherVisibility.rules
    .filter((rule) => rule.visibility === "allowed")
    .map((rule) => rule.field_or_summary);
  const teacherDisallowed = input.teacherVisibility.rules
    .filter((rule) => rule.visibility === "disallowed")
    .map((rule) => rule.field_or_summary);
  const studentAllowed = input.studentPrivacy.rules
    .filter((rule) => rule.visibility === "allowed")
    .map((rule) => rule.field_or_summary);
  const studentDisallowed = input.studentPrivacy.rules
    .filter((rule) => rule.visibility === "disallowed")
    .map((rule) => rule.field_or_summary);
  return {
    layer_count: input.architecture.layers.length,
    entity_count: input.architecture.entities.length,
    missing_layers: expectedLayers.filter(
      (layer) => !input.architecture.layers.includes(layer)
    ),
    missing_entities: expectedEntities.filter(
      (entity) => !entityNames.includes(entity)
    ),
    teacher_allowed: teacherAllowed,
    teacher_disallowed: teacherDisallowed,
    student_allowed: studentAllowed,
    student_disallowed: studentDisallowed,
    privacy_prohibitions: [...prohibited].sort(),
    passed:
      input.architecture.layers.length === 5 &&
      expectedLayers.every((layer) =>
        input.architecture.layers.includes(layer)
      ) &&
      expectedEntities.every((entity) => entityNames.includes(entity)) &&
      prohibited.has("chain_of_thought") &&
      prohibited.has("hidden_model_reasoning") &&
      prohibited.has("hidden_prompts") &&
      prohibited.has("unnecessary_internal_metadata") &&
      teacherAllowed.includes("evidence_summaries") &&
      teacherAllowed.includes("candidate_misconception_patterns") &&
      teacherDisallowed.includes("hidden_model_reasoning") &&
      teacherDisallowed.includes("system_internals") &&
      studentAllowed.includes("feedback") &&
      studentAllowed.includes("next_steps") &&
      studentAllowed.includes("learning_summaries") &&
      studentDisallowed.includes("internal_labels") &&
      studentDisallowed.includes("profile_fields") &&
      studentDisallowed.includes("ai_decisions") &&
      input.workflow.research_export_fails_closed &&
      input.consentWithdrawal
        .missing_or_pending_consent.research_export_eligible === false &&
      input.anonymization.direct_identifier_removed_from_analysis_export &&
      input.exportReproducibility
        .identical_snapshot_and_versions_require_identical_canonical_hash
  };
}
