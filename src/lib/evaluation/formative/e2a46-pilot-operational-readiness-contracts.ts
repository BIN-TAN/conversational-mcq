import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";

export const INSTRUCTOR_ONBOARDING_CONTRACT_VERSION =
  "instructor-onboarding-contract-v1" as const;
export const STUDENT_ONBOARDING_CONTRACT_VERSION =
  "student-onboarding-contract-v1" as const;
export const PILOT_WORKFLOW_READINESS_CONTRACT_VERSION =
  "pilot-workflow-readiness-contract-v1" as const;
export const PILOT_FAILURE_HANDLING_CONTRACT_VERSION =
  "pilot-failure-handling-contract-v1" as const;
export const PILOT_PRIVACY_READINESS_CONTRACT_VERSION =
  "pilot-privacy-readiness-contract-v1" as const;
export const PILOT_MONITORING_CONTRACT_VERSION =
  "pilot-monitoring-contract-v1" as const;
export const PILOT_READINESS_CRITERIA_VERSION =
  "pilot-readiness-criteria-v1" as const;
export const PILOT_READINESS_CHECKLIST_VERSION =
  "pilot-readiness-checklist-v1" as const;

export const PilotReadinessStatusSchema = z.enum([
  "verified",
  "not_verified",
  "failed",
  "not_applicable"
]);
export type PilotReadinessStatus = z.infer<
  typeof PilotReadinessStatusSchema
>;

export const PilotReadinessCheckSchema = z.object({
  check_id: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  category: z.enum(["technical", "research", "teaching"]),
  requirement: z.string().min(1),
  required: z.boolean(),
  status: PilotReadinessStatusSchema,
  evidence_reference: z.string().min(1).nullable(),
  responsible_role: z.enum([
    "operator",
    "instructor",
    "researcher",
    "institution"
  ])
}).strict();
export type PilotReadinessCheck = z.infer<
  typeof PilotReadinessCheckSchema
>;

export const PilotFailureScenarioSchema = z.object({
  failure_type: z.enum([
    "provider_unavailable",
    "student_disconnect",
    "duplicate_submission",
    "incomplete_response",
    "teacher_override",
    "export_failure"
  ]),
  student_facing_behavior: z.string().min(1),
  system_behavior: z.array(z.string().min(1)).min(1),
  recovery_behavior: z.array(z.string().min(1)).min(1),
  evidence_preserved: z.boolean(),
  audit_preserved: z.boolean(),
  data_corruption_allowed: z.literal(false)
}).strict();

export function buildInstructorOnboardingContractV1() {
  return {
    contract_version: INSTRUCTOR_ONBOARDING_CONTRACT_VERSION,
    target_context: "controlled_university_course_pilot",
    instructor_must_understand: [
      "cba_is_formative_diagnostic_support",
      "formative_evidence_is_not_a_grade",
      "evidence_summaries_are_bounded",
      "system_interpretations_are_provisional",
      "teacher_judgment_remains_separate",
      "teacher_overrides_are_append_only",
      "privacy_and_course_scope_responsibilities"
    ],
    competency_checks: [
      "interpret_an_evidence_summary",
      "identify_when_followup_may_be_helpful",
      "recognize_when_no_followup_is_needed",
      "reject_ai_output_as_final_judgment",
      "apply_course_scope_and_privacy_boundaries"
    ],
    completion_evidence_required: [
      "orientation_version",
      "completed_at",
      "competency_check_result",
      "instructor_acknowledgment"
    ],
    misunderstanding_requires_remediation: true,
    onboarding_completion_does_not_grant_research_access: true
  } as const;
}

export function evaluateInstructorOnboarding(input: {
  identifies_formative_not_grade: boolean;
  interprets_summary_as_bounded_evidence: boolean;
  identifies_followup_when_supported: boolean;
  avoids_unnecessary_followup: boolean;
  treats_ai_as_provisional: boolean;
  understands_override_and_privacy_boundary: boolean;
}) {
  const checks = {
    formative_not_grade:
      input.identifies_formative_not_grade,
    bounded_evidence:
      input.interprets_summary_as_bounded_evidence,
    followup_when_supported:
      input.identifies_followup_when_supported,
    no_unnecessary_followup:
      input.avoids_unnecessary_followup,
    ai_is_provisional: input.treats_ai_as_provisional,
    override_and_privacy:
      input.understands_override_and_privacy_boundary
  };
  return {
    evaluation_version: "e2a46-instructor-onboarding-evaluation-v1",
    checks,
    passed: Object.values(checks).every(Boolean),
    remediation_required:
      !Object.values(checks).every(Boolean)
  };
}

export function buildStudentOnboardingContractV1() {
  return {
    contract_version: STUDENT_ONBOARDING_CONTRACT_VERSION,
    students_must_understand: [
      "reasoning_supports_formative_feedback",
      "confidence_is_task_specific_evidence",
      "feedback_uses_current_assessment_responses",
      "ai_supports_learning_not_grading",
      "participation_and_withdrawal_rights"
    ],
    student_facing_requirements: [
      "plain_language",
      "concise",
      "withdrawal_path_is_clear",
      "no_hidden_system_decisions",
      "no_internal_profile_or_routing_labels"
    ],
    prohibited_student_facing_terms: [
      "internal_profile",
      "engagement_profile",
      "routing_decision",
      "system_prompt",
      "chain_of_thought",
      "model_confidence",
      "agent_call"
    ],
    orientation_is_not_consent_record: true,
    research_consent_requires_separate_approved_process: true
  } as const;
}

export function evaluateStudentOrientation(input: {
  visible_text: string;
}) {
  const normalized = input.visible_text.toLowerCase();
  const prohibited = buildStudentOnboardingContractV1()
    .prohibited_student_facing_terms
    .filter((term) =>
      normalized.includes(term.replaceAll("_", " "))
    );
  const requiredConcepts = {
    reasoning: normalized.includes("reasoning"),
    confidence: normalized.includes("confidence"),
    feedback: normalized.includes("feedback"),
    learning_not_grading:
      normalized.includes("support your learning") &&
      (
        normalized.includes("does not determine your grade") ||
        normalized.includes("not used to determine your grade")
      ),
    withdrawal:
      normalized.includes("withdraw") &&
      normalized.includes("without affecting")
  };
  return {
    evaluation_version: "e2a46-student-orientation-evaluation-v1",
    required_concepts: requiredConcepts,
    prohibited_terms_found: prohibited,
    hidden_system_decisions_exposed: false,
    internal_labels_exposed: prohibited.length > 0,
    withdrawal_information_clear:
      requiredConcepts.withdrawal,
    passed:
      Object.values(requiredConcepts).every(Boolean) &&
      prohibited.length === 0
  };
}

export function buildPilotWorkflowReadinessContractV1() {
  return {
    contract_version: PILOT_WORKFLOW_READINESS_CONTRACT_VERSION,
    target_context: "university_course_controlled_pilot",
    roles: {
      student:
        "uses_cba_activities_and_receives_formative_feedback",
      instructor:
        "selects_activities_reviews_evidence_and_provides_followup",
      researcher:
        "manages_approved_research_data_and_evaluation",
      system:
        "collects_evidence_manages_dialogue_and_preserves_audit"
    },
    phases: {
      before_class: [
        "instructor_selects_activity",
        "learning_objectives_defined",
        "misconception_targets_prepared",
        "access_and_privacy_checks_complete"
      ],
      during_class: [
        "student_completes_initial_item",
        "student_provides_reasoning",
        "student_provides_confidence",
        "student_interacts_with_formative_dialogue",
        "student_revises_when_appropriate",
        "student_completes_transfer_when_appropriate"
      ],
      after_class: [
        "instructor_reviews_evidence_summary",
        "instructor_identifies_followup_needs",
        "researcher_receives_only_approved_research_data"
      ]
    },
    application_owns_authoritative_transitions: true,
    one_active_prompt_at_a_time: true,
    resume_uses_persisted_state: true,
    provider_does_not_own_workflow: true
  } as const;
}

export function evaluateWorkflowReadiness(input: {
  before_class_completed: string[];
  during_class_completed: string[];
  after_class_completed: string[];
}) {
  const contract = buildPilotWorkflowReadinessContractV1();
  const missing = {
    before_class: contract.phases.before_class.filter((step) =>
      !input.before_class_completed.includes(step)
    ),
    during_class: contract.phases.during_class.filter((step) =>
      !input.during_class_completed.includes(step)
    ),
    after_class: contract.phases.after_class.filter((step) =>
      !input.after_class_completed.includes(step)
    )
  };
  return {
    evaluation_version: "e2a46-workflow-readiness-evaluation-v1",
    missing,
    passed:
      missing.before_class.length === 0 &&
      missing.during_class.length === 0 &&
      missing.after_class.length === 0
  };
}

export function buildPilotFailureHandlingContractV1() {
  const scenarios = [
    {
      failure_type: "provider_unavailable",
      student_facing_behavior:
        "Show a concise temporary-unavailable message without internal details.",
      system_behavior: [
        "fail_closed",
        "preserve_current_state",
        "record_typed_sanitized_failure"
      ],
      recovery_behavior: [
        "reuse_persisted_state",
        "allow_valid_retry_when_available"
      ],
      evidence_preserved: true,
      audit_preserved: true,
      data_corruption_allowed: false
    },
    {
      failure_type: "student_disconnect",
      student_facing_behavior:
        "Resume from the last accepted persisted assessment state.",
      system_behavior: [
        "preserve_accepted_turns",
        "preserve_attempt_lifecycle",
        "do_not_regenerate_persisted_prompts"
      ],
      recovery_behavior: [
        "authenticate_student",
        "restore_persisted_session"
      ],
      evidence_preserved: true,
      audit_preserved: true,
      data_corruption_allowed: false
    },
    {
      failure_type: "duplicate_submission",
      student_facing_behavior:
        "Return the already accepted result without duplicating evidence.",
      system_behavior: [
        "apply_idempotency_key",
        "do_not_duplicate_turn_or_event"
      ],
      recovery_behavior: [
        "return_canonical_command_result"
      ],
      evidence_preserved: true,
      audit_preserved: true,
      data_corruption_allowed: false
    },
    {
      failure_type: "incomplete_response",
      student_facing_behavior:
        "Ask a bounded clarification or offer a valid closure path.",
      system_behavior: [
        "do_not_invent_missing_evidence",
        "keep_authoritative_state"
      ],
      recovery_behavior: [
        "accept_valid_clarification",
        "allow_policy_permitted_closure"
      ],
      evidence_preserved: true,
      audit_preserved: true,
      data_corruption_allowed: false
    },
    {
      failure_type: "teacher_override",
      student_facing_behavior:
        "Show only the resulting valid instructional next step.",
      system_behavior: [
        "append_override_record",
        "preserve_original_recommendation",
        "preserve_evidence_provenance"
      ],
      recovery_behavior: [
        "use_latest_valid_instructional_decision"
      ],
      evidence_preserved: true,
      audit_preserved: true,
      data_corruption_allowed: false
    },
    {
      failure_type: "export_failure",
      student_facing_behavior:
        "Do not expose the research export failure to students.",
      system_behavior: [
        "fail_export_closed",
        "preserve_source_records",
        "record_safe_failure_status"
      ],
      recovery_behavior: [
        "retry_with_new_export_run_id",
        "verify_manifest_and_hashes"
      ],
      evidence_preserved: true,
      audit_preserved: true,
      data_corruption_allowed: false
    }
  ] as const;
  return {
    contract_version: PILOT_FAILURE_HANDLING_CONTRACT_VERSION,
    scenarios: scenarios.map((scenario) =>
      PilotFailureScenarioSchema.parse(scenario)
    ),
    provider_failure_never_counts_as_success: true,
    retries_do_not_create_new_logical_evidence: true,
    recovery_uses_persisted_authoritative_state: true,
    failure_messages_exclude_system_internals: true
  };
}

export function simulateFailureRecovery(input: {
  failure_type:
    | "provider_unavailable"
    | "student_disconnect"
    | "duplicate_submission"
    | "incomplete_response"
    | "teacher_override"
    | "export_failure";
  evidence_records: readonly unknown[];
  audit_records: readonly unknown[];
}) {
  const scenario = buildPilotFailureHandlingContractV1()
    .scenarios
    .find((candidate) =>
      candidate.failure_type === input.failure_type
    );
  if (!scenario) {
    throw new Error("e2a46_unknown_failure_scenario");
  }
  const evidenceHash = stableHash(input.evidence_records);
  const auditHash = stableHash(input.audit_records);
  const nextEvidence = [...input.evidence_records];
  const nextAudit = [
    ...input.audit_records,
    {
      failure_type: input.failure_type,
      status: "handled",
      sanitized: true
    }
  ];
  return {
    failure_type: input.failure_type,
    student_facing_behavior: scenario.student_facing_behavior,
    recovery_behavior: [...scenario.recovery_behavior],
    evidence_records: nextEvidence,
    audit_records: nextAudit,
    evidence_preserved:
      stableHash(nextEvidence) === evidenceHash,
    prior_audit_preserved:
      stableHash(nextAudit.slice(0, -1)) === auditHash,
    duplicate_effect_count:
      input.failure_type === "duplicate_submission" ? 0 : null,
    typed_failure_recorded: true,
    data_corrupted: false
  };
}

export function buildPilotPrivacyReadinessContractV1() {
  return {
    contract_version: PILOT_PRIVACY_READINESS_CONTRACT_VERSION,
    required_boundaries: [
      "approved_consent_process",
      "withdrawal_process",
      "versioned_anonymization",
      "deny_by_default_access_control",
      "research_instruction_separation"
    ],
    prohibited_data: [
      "chain_of_thought",
      "hidden_model_reasoning",
      "hidden_prompts",
      "unnecessary_personal_information",
      "credentials",
      "direct_identifiers_in_research_export"
    ],
    missing_consent_excludes_research_not_course: true,
    withdrawal_excludes_future_research_not_course: true,
    no_deployment_assumption: true,
    no_reb_approval_assumption: true,
    privacy_readiness_requires_external_evidence: true
  } as const;
}

export function evaluatePrivacyReadiness(input: {
  consent_process_verified: boolean;
  withdrawal_process_verified: boolean;
  anonymization_verified: boolean;
  access_control_verified: boolean;
  research_instruction_separation_verified: boolean;
  reb_or_ethics_approval_verified: boolean;
}) {
  const checks = {
    consent_process_verified:
      input.consent_process_verified,
    withdrawal_process_verified:
      input.withdrawal_process_verified,
    anonymization_verified: input.anonymization_verified,
    access_control_verified: input.access_control_verified,
    research_instruction_separation_verified:
      input.research_instruction_separation_verified,
    reb_or_ethics_approval_verified:
      input.reb_or_ethics_approval_verified
  };
  return {
    evaluation_version: "e2a46-privacy-readiness-evaluation-v1",
    checks,
    ready: Object.values(checks).every(Boolean),
    no_reb_approval_assumed:
      !input.reb_or_ethics_approval_verified
  };
}

export function buildPilotMonitoringContractV1() {
  return {
    contract_version: PILOT_MONITORING_CONTRACT_VERSION,
    permitted_monitoring_signals: [
      "system_availability",
      "incomplete_session_count",
      "typed_interaction_failure_count",
      "data_quality_issue_count",
      "teacher_support_request_count"
    ],
    prohibited_monitoring_data: [
      "raw_password",
      "access_code",
      "api_key",
      "session_secret",
      "unnecessary_direct_identifier",
      "raw_reasoning_text",
      "hidden_prompt",
      "chain_of_thought"
    ],
    monitoring_grain: "aggregate_or_pseudonymous_operational_event",
    alert_requires_safe_reason_code: true,
    monitoring_does_not_infer_misconduct: true,
    retention_and_access_policy_required: true
  } as const;
}

export function evaluateMonitoringRecord(input: {
  signal_name: string;
  payload_keys: string[];
  safe_reason_code_present: boolean;
}) {
  const contract = buildPilotMonitoringContractV1();
  const allowedSignal =
    contract.permitted_monitoring_signals.includes(
      input.signal_name as
        (typeof contract.permitted_monitoring_signals)[number]
    );
  const prohibitedKeys = input.payload_keys.filter((key) =>
    contract.prohibited_monitoring_data.includes(
      key as (typeof contract.prohibited_monitoring_data)[number]
    )
  );
  return {
    evaluation_version: "e2a46-monitoring-record-evaluation-v1",
    allowed_signal: allowedSignal,
    prohibited_payload_keys: prohibitedKeys,
    safe_reason_code_present: input.safe_reason_code_present,
    passed:
      allowedSignal &&
      prohibitedKeys.length === 0 &&
      input.safe_reason_code_present
  };
}

export function buildPilotReadinessCriteriaV1() {
  return {
    contract_version: PILOT_READINESS_CRITERIA_VERSION,
    success_means: [
      "students_can_complete_workflow",
      "evidence_is_collected_correctly",
      "profiles_update_from_valid_evidence",
      "teachers_can_interpret_bounded_summaries",
      "privacy_boundaries_hold",
      "failures_recover_safely"
    ],
    success_does_not_mean: [
      "ai_answers_correctly",
      "classroom_effectiveness_established",
      "learning_gain_proven",
      "reb_or_ethics_approval_assumed",
      "production_deployment_authorized"
    ],
    every_required_check_needs_evidence: true,
    failed_required_check_blocks_readiness: true,
    unverified_required_check_yields_not_determined: true,
    operational_preparedness_not_effectiveness: true
  } as const;
}

export function buildPilotReadinessChecklistV1(
  status: PilotReadinessStatus = "not_verified"
) {
  const definitions = [
    ["deployment_environment", "technical", "Deployment environment is configured and verified.", "operator"],
    ["availability_monitoring", "technical", "Availability and safe failure monitoring are configured.", "operator"],
    ["backup_process", "technical", "Backup process is documented and tested.", "operator"],
    ["recovery_process", "technical", "Recovery and rollback process is documented and tested.", "operator"],
    ["research_consent_process", "research", "Approved consent process and materials are verified.", "researcher"],
    ["withdrawal_process", "research", "Withdrawal handling and record disposition are verified.", "researcher"],
    ["research_data_handling", "research", "Pseudonymization, access, retention, and export handling are verified.", "researcher"],
    ["reb_or_ethics_approval", "research", "Required institutional ethics approval is documented.", "institution"],
    ["pilot_documentation", "research", "Protocol, limitations, and incident documentation are available.", "researcher"],
    ["instructor_training", "teaching", "Instructor onboarding and competency checks are complete.", "instructor"],
    ["student_orientation", "teaching", "Student orientation and participation-rights information are ready.", "instructor"],
    ["support_process", "teaching", "Student and instructor support and escalation paths are staffed.", "operator"]
  ] as const;
  return {
    contract_version: PILOT_READINESS_CHECKLIST_VERSION,
    checks: definitions.map(([
      check_id,
      category,
      requirement,
      responsible_role
    ]) => PilotReadinessCheckSchema.parse({
      check_id,
      category,
      requirement,
      required: true,
      status,
      evidence_reference:
        status === "verified"
          ? `synthetic_evidence_${check_id}`
          : null,
      responsible_role
    })),
    checklist_completion_does_not_authorize_deployment: true,
    operator_signoff_required: true,
    institutional_approval_required_when_applicable: true
  };
}

export function assessPilotOperationalReadiness(input: {
  checks: PilotReadinessCheck[];
}) {
  const parsed = input.checks.map((check) =>
    PilotReadinessCheckSchema.parse(check)
  );
  const failed = parsed.filter((check) =>
    check.required && check.status === "failed"
  );
  const unverified = parsed.filter((check) =>
    check.required && check.status === "not_verified"
  );
  const missingEvidence = parsed.filter((check) =>
    check.required &&
    check.status === "verified" &&
    check.evidence_reference === null
  );
  const decision = failed.length > 0 || missingEvidence.length > 0
    ? "not_ready"
    : unverified.length > 0
      ? "not_determined"
      : "ready_for_authorized_controlled_pilot_review";
  return {
    assessment_version:
      "e2a46-pilot-operational-readiness-assessment-v1",
    decision,
    required_check_count:
      parsed.filter((check) => check.required).length,
    verified_check_count:
      parsed.filter((check) =>
        check.required &&
        check.status === "verified" &&
        check.evidence_reference !== null
      ).length,
    failed_check_ids: failed.map((check) => check.check_id),
    unverified_check_ids:
      unverified.map((check) => check.check_id),
    missing_evidence_check_ids:
      missingEvidence.map((check) => check.check_id),
    deployment_authorized: false,
    effectiveness_established: false,
    reb_or_ethics_approval_assumed: false
  } as const;
}

export function buildPilotOperationalContractFingerprint(input: {
  instructor_onboarding: ReturnType<
    typeof buildInstructorOnboardingContractV1
  >;
  student_onboarding: ReturnType<
    typeof buildStudentOnboardingContractV1
  >;
  workflow: ReturnType<
    typeof buildPilotWorkflowReadinessContractV1
  >;
  failure_handling: ReturnType<
    typeof buildPilotFailureHandlingContractV1
  >;
  privacy: ReturnType<
    typeof buildPilotPrivacyReadinessContractV1
  >;
  monitoring: ReturnType<typeof buildPilotMonitoringContractV1>;
  readiness_criteria: ReturnType<
    typeof buildPilotReadinessCriteriaV1
  >;
  readiness_checklist: ReturnType<
    typeof buildPilotReadinessChecklistV1
  >;
}) {
  return {
    fingerprint_version:
      "e2a46-pilot-operational-contract-fingerprint-v1",
    contract_versions: {
      instructor_onboarding:
        input.instructor_onboarding.contract_version,
      student_onboarding:
        input.student_onboarding.contract_version,
      workflow: input.workflow.contract_version,
      failure_handling:
        input.failure_handling.contract_version,
      privacy: input.privacy.contract_version,
      monitoring: input.monitoring.contract_version,
      readiness_criteria:
        input.readiness_criteria.contract_version,
      readiness_checklist:
        input.readiness_checklist.contract_version
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

export function validatePilotOperationalContracts(input: {
  instructor_onboarding: ReturnType<
    typeof buildInstructorOnboardingContractV1
  >;
  student_onboarding: ReturnType<
    typeof buildStudentOnboardingContractV1
  >;
  workflow: ReturnType<
    typeof buildPilotWorkflowReadinessContractV1
  >;
  failure_handling: ReturnType<
    typeof buildPilotFailureHandlingContractV1
  >;
  privacy: ReturnType<
    typeof buildPilotPrivacyReadinessContractV1
  >;
  monitoring: ReturnType<typeof buildPilotMonitoringContractV1>;
  readiness_criteria: ReturnType<
    typeof buildPilotReadinessCriteriaV1
  >;
  readiness_checklist: ReturnType<
    typeof buildPilotReadinessChecklistV1
  >;
}) {
  const requiredFailureTypes = [
    "provider_unavailable",
    "student_disconnect",
    "duplicate_submission",
    "incomplete_response",
    "teacher_override",
    "export_failure"
  ];
  const actualFailureTypes =
    input.failure_handling.scenarios.map((scenario) =>
      scenario.failure_type
    );
  const checklistCategories = new Set(
    input.readiness_checklist.checks.map((check) =>
      check.category
    )
  );
  const validation = {
    validation_version:
      "e2a46-pilot-operational-contract-validation-v1",
    instructor_ai_boundary:
      input.instructor_onboarding.instructor_must_understand
        .includes("system_interpretations_are_provisional"),
    student_internal_labels_prohibited:
      input.student_onboarding.prohibited_student_facing_terms
        .includes("internal_profile"),
    workflow_has_three_phases:
      Object.keys(input.workflow.phases).length === 3,
    all_failure_types_present:
      requiredFailureTypes.every((failureType) =>
        actualFailureTypes.includes(
          failureType as (typeof actualFailureTypes)[number]
        )
      ),
    privacy_has_no_reb_assumption:
      input.privacy.no_reb_approval_assumption,
    monitoring_excludes_personal_data:
      input.monitoring.prohibited_monitoring_data
        .includes("unnecessary_direct_identifier"),
    criteria_separate_effectiveness:
      input.readiness_criteria.operational_preparedness_not_effectiveness,
    checklist_has_all_categories:
      ["technical", "research", "teaching"].every((category) =>
        checklistCategories.has(
          category as "technical" | "research" | "teaching"
        )
      ),
    passed: false
  };
  validation.passed =
    validation.instructor_ai_boundary &&
    validation.student_internal_labels_prohibited &&
    validation.workflow_has_three_phases &&
    validation.all_failure_types_present &&
    validation.privacy_has_no_reb_assumption &&
    validation.monitoring_excludes_personal_data &&
    validation.criteria_separate_effectiveness &&
    validation.checklist_has_all_categories;
  return validation;
}
