import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  E2A45_PROTOCOL_VERSION,
  buildE2A45FreezeArtifacts
} from "./e2a45-teacher-evidence-review-protocol";
import {
  INSTRUCTOR_ONBOARDING_CONTRACT_VERSION,
  PILOT_FAILURE_HANDLING_CONTRACT_VERSION,
  PILOT_MONITORING_CONTRACT_VERSION,
  PILOT_PRIVACY_READINESS_CONTRACT_VERSION,
  PILOT_READINESS_CHECKLIST_VERSION,
  PILOT_READINESS_CRITERIA_VERSION,
  PILOT_WORKFLOW_READINESS_CONTRACT_VERSION,
  STUDENT_ONBOARDING_CONTRACT_VERSION,
  assessPilotOperationalReadiness,
  buildInstructorOnboardingContractV1,
  buildPilotFailureHandlingContractV1,
  buildPilotMonitoringContractV1,
  buildPilotOperationalContractFingerprint,
  buildPilotPrivacyReadinessContractV1,
  buildPilotReadinessChecklistV1,
  buildPilotReadinessCriteriaV1,
  buildPilotWorkflowReadinessContractV1,
  buildStudentOnboardingContractV1,
  evaluateInstructorOnboarding,
  evaluateMonitoringRecord,
  evaluatePrivacyReadiness,
  evaluateStudentOrientation,
  evaluateWorkflowReadiness,
  simulateFailureRecovery,
  validatePilotOperationalContracts
} from "./e2a46-pilot-operational-readiness-contracts";

export const E2A46_PROTOCOL_VERSION =
  "e2a46-classroom-pilot-operational-readiness-freeze-v1" as const;
export const E2A46_ARTIFACT_CONTRACT_VERSION =
  "e2a46-artifact-contract-v1" as const;
export const E2A46_BUDGET_CONTRACT_VERSION =
  "e2a46-budget-contract-v1" as const;
export const E2A46_COMPOSITE_IDENTITY_VERSION =
  "e2a46-composite-runtime-identity-v1" as const;
export const E2A46_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a46-pilot-operational-readiness-protocol-freeze"
);

const PREDECESSOR_COMMIT =
  "0b512cf7215447f6742a4ba0d30322c4d03e7229";
const E2A45_PROTOCOL_HASH =
  "b18dead79621673384c9ecf68e0405fdcd14bb6c55c5c8aca2d7638782c39615";
const E2A45_COMPOSITE_IDENTITY =
  "72497a0101ec8cf196e3f19b1f87464916a61144c0c73c3b3f552cb64d26b3d3";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a45-teacher-evidence-review-contracts.ts":
    "2fff424799dae8f84bde0c5d11e1f01b28e1c8284178b030b2026aa79cb05f9e",
  "src/lib/evaluation/formative/e2a45-teacher-evidence-review-protocol.ts":
    "c96e5b2a00e1c82887ed62a62d7cbe255a8e5d6b0bdbedd75be4af51aad31e30",
  "prisma/formative-evaluation-e2a45.ts":
    "b782907d6498a1f7f720a7adea2db313cd9eb40a9f433de5585e8a7fb1749146"
} as const;

export const E2A46_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "instructor-onboarding-contract.json",
  "student-onboarding-contract.json",
  "pilot-workflow-readiness-contract.json",
  "pilot-failure-handling-contract.json",
  "pilot-privacy-readiness-contract.json",
  "pilot-monitoring-contract.json",
  "pilot-readiness-criteria.json",
  "pilot-readiness-checklist.json",
  "contract-validation.json",
  "synthetic-readiness-scenarios.json",
  "instructor-onboarding-validation.json",
  "student-onboarding-validation.json",
  "workflow-readiness-validation.json",
  "failure-recovery-validation.json",
  "privacy-readiness-validation.json",
  "monitoring-validation.json",
  "data-collection-readiness-validation.json",
  "audit-preservation-validation.json",
  "teacher-student-boundary-validation.json",
  "operational-readiness-decision.json",
  "pilot-readiness-metrics.json",
  "deterministic-replay-results.json",
  "deterministic-regression-results.json",
  "historical-integrity.json",
  "budget.json",
  "artifact-contract.json",
  "candidate-integrity.json",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function writeJson(filePath: string, value: unknown) {
  const serialized = JSON.stringify(value);
  assert(
    ![
      /\bsk-[A-Za-z0-9_-]{12,}/u,
      /\bBearer\s+[A-Za-z0-9._-]+/u,
      /OPENAI_API_KEY\s*=/u,
      /DATABASE_URL\s*=/u,
      /SESSION_SECRET\s*=/u,
      /password_hash/u,
      /access_code_hash/u
    ].some((pattern) => pattern.test(serialized)),
    "e2a46_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function buildContracts() {
  return {
    instructor_onboarding: buildInstructorOnboardingContractV1(),
    student_onboarding: buildStudentOnboardingContractV1(),
    workflow: buildPilotWorkflowReadinessContractV1(),
    failure_handling: buildPilotFailureHandlingContractV1(),
    privacy: buildPilotPrivacyReadinessContractV1(),
    monitoring: buildPilotMonitoringContractV1(),
    readiness_criteria: buildPilotReadinessCriteriaV1(),
    readiness_checklist:
      buildPilotReadinessChecklistV1("not_verified")
  };
}

function buildBudget() {
  return {
    budget_contract_version: E2A46_BUDGET_CONTRACT_VERSION,
    frozen_future_live_limits: {
      maximum_logical_calls: 29,
      maximum_adapter_attempts: 87,
      provider_concurrency: 1,
      maximum_transport_retries_per_logical_call: 2,
      maximum_input_tokens: 900_000,
      maximum_output_tokens: 70_000,
      maximum_total_tokens: 970_000,
      maximum_cost_usd_when_pricing_available: 25
    },
    protocol_freeze_provider_call_budget: 0,
    protocol_freeze_network_request_budget: 0,
    execution_authorized: false,
    live_entrypoint_present: false,
    deployment_authorized: false,
    provider_calls_made: 0,
    network_requests_made: 0
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A46_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A46_ARTIFACT_NAMES],
    immutable_after_write: true,
    synthetic_readiness_evidence_only: true,
    production_data_accessed: false,
    classroom_pilot_executed: false,
    deployment_performed: false,
    runtime_intelligence_modified: false,
    database_schema_modified: false,
    chain_of_thought_prohibited: true,
    hidden_model_reasoning_prohibited: true,
    hidden_prompts_prohibited: true,
    unnecessary_personal_information_prohibited: true,
    provider_calls_required: 0,
    network_requests_required: 0
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a46-candidate-integrity-v1",
    relative_path: relativePath,
    expected_sha256: PROTECTED_SOURCE_HASHES[relativePath],
    actual_sha256: actual,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_modified: false,
    passed: actual === PROTECTED_SOURCE_HASHES[relativePath]
  };
}

function buildProtectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(PROTECTED_SOURCE_HASHES).map((relativePath) => [
      relativePath,
      fileSha256(relativePath)
    ])
  );
  const mismatches = Object.entries(PROTECTED_SOURCE_HASHES)
    .filter(([relativePath, expected]) =>
      actual[relativePath] !== expected
    )
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath] ?? null
    }));
  return {
    integrity_version: "e2a46-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    evaluator_v5_modified: false,
    tutor_candidate_modified: false,
    evidence_pipeline_modified: false,
    learning_profile_modified: false,
    engagement_profile_modified: false,
    intervention_memory_modified: false,
    stopping_policy_modified: false,
    instructor_handoff_policy_modified: false,
    auditability_contracts_modified: false,
    classroom_data_architecture_modified: false,
    teacher_evidence_review_contracts_modified: false,
    passed: mismatches.length === 0
  };
}

function buildHistoricalIntegrity(
  predecessor: ReturnType<typeof buildE2A45FreezeArtifacts>
) {
  return {
    integrity_version: "e2a46-e2a45-historical-integrity-v1",
    predecessor_commit: PREDECESSOR_COMMIT,
    expected_protocol_version: E2A45_PROTOCOL_VERSION,
    actual_protocol_version: predecessor.protocol.protocol_version,
    expected_protocol_hash: E2A45_PROTOCOL_HASH,
    actual_protocol_hash: predecessor.protocol.protocol_hash,
    expected_composite_runtime_identity: E2A45_COMPOSITE_IDENTITY,
    actual_composite_runtime_identity:
      predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash,
    teacher_review_contracts_passed:
      predecessor.deterministic.contracts.passed,
    teacher_role_separation_passed:
      predecessor.deterministic.suites.role_separation.passed,
    teacher_access_control_passed:
      predecessor.deterministic.suites.access_control.passed,
    historical_artifacts_modified: false,
    provider_calls_made: predecessor.summary.provider_calls_made,
    network_requests_made: predecessor.summary.network_requests_made,
    passed:
      predecessor.protocol.protocol_version === E2A45_PROTOCOL_VERSION &&
      predecessor.protocol.protocol_hash === E2A45_PROTOCOL_HASH &&
      predecessor.compositeRuntimeIdentity
        .composite_runtime_identity_hash === E2A45_COMPOSITE_IDENTITY &&
      predecessor.deterministic.contracts.passed &&
      predecessor.deterministic.suites.role_separation.passed &&
      predecessor.deterministic.suites.access_control.passed &&
      predecessor.summary.provider_calls_made === 0 &&
      predecessor.summary.network_requests_made === 0
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a46-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a46_execution_authorized: false,
    classroom_pilot_authorized: false,
    candidate_approval_authorized: false,
    candidate_activation_authorized: false,
    passed: networkRequestCount === 0
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a46-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      protocol_hash: E2A45_PROTOCOL_HASH,
      composite_runtime_identity: E2A45_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    contract_versions: {
      instructor_onboarding:
        INSTRUCTOR_ONBOARDING_CONTRACT_VERSION,
      student_onboarding: STUDENT_ONBOARDING_CONTRACT_VERSION,
      workflow: PILOT_WORKFLOW_READINESS_CONTRACT_VERSION,
      failure_handling:
        PILOT_FAILURE_HANDLING_CONTRACT_VERSION,
      privacy: PILOT_PRIVACY_READINESS_CONTRACT_VERSION,
      monitoring: PILOT_MONITORING_CONTRACT_VERSION,
      readiness_criteria: PILOT_READINESS_CRITERIA_VERSION,
      readiness_checklist: PILOT_READINESS_CHECKLIST_VERSION
    },
    new_implementation_hashes: {
      operational_readiness_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a46-pilot-operational-readiness-contracts.ts"
      ),
      operational_readiness_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a46-pilot-operational-readiness-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a46.ts"
      )
    },
    runtime_intelligence_components_modified: false,
    database_schema_modified: false,
    production_deployment_configuration_modified: false
  };
}

function buildProtocol(input: {
  contractFingerprint: ReturnType<
    typeof buildPilotOperationalContractFingerprint
  >;
  bindings: ReturnType<typeof buildComponentBindings>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A46_PROTOCOL_VERSION,
    status: "frozen_pilot_operational_readiness_no_execution",
    purpose:
      "instructor_student_workflow_privacy_data_failure_support_and_monitoring_operational_readiness",
    contract_hashes: input.contractFingerprint.contract_hashes,
    contract_fingerprint_hash:
      input.contractFingerprint.fingerprint_hash,
    component_bindings_hash: stableHash(input.bindings),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      operational_readiness_protocol_only: true,
      operational_preparedness_not_effectiveness: true,
      verified_external_evidence_required_for_readiness: true,
      unverified_required_check_yields_not_determined: true,
      failed_required_check_blocks_readiness: true,
      no_deployment_assumption: true,
      no_reb_or_ethics_approval_assumption: true,
      runtime_intelligence_components_unchanged: true,
      classroom_data_architecture_unchanged: true,
      teacher_evidence_review_contracts_unchanged: true
    },
    execution: {
      authorized: false,
      executable: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      classroom_pilot_authorized: false,
      deployment_authorized: false,
      candidate_approval_authorized: false,
      candidate_activation_authorized: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  };
  return {
    ...core,
    protocol_hash: stableHash(core)
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  bindings: ReturnType<typeof buildComponentBindings>;
  protectedIntegrity: ReturnType<
    typeof buildProtectedSourceIntegrity
  >;
  contractFingerprint: ReturnType<
    typeof buildPilotOperationalContractFingerprint
  >;
}) {
  const core = {
    identity_version: E2A46_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    predecessor_protocol_hash: E2A45_PROTOCOL_HASH,
    predecessor_composite_runtime_identity:
      E2A45_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    contract_fingerprint_hash:
      input.contractFingerprint.fingerprint_hash,
    protected_source_hashes:
      input.protectedIntegrity.actual_sha256,
    contract_versions: input.bindings.contract_versions,
    no_runtime_intelligence_component_added: true,
    no_database_schema_change: true,
    no_deployment_configuration_change: true,
    no_live_entrypoint_present: true
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

function metric(
  metric_id: string,
  checks: boolean[],
  threshold = 1
) {
  const achieved = checks.filter(Boolean).length;
  const possible = checks.length;
  const score = possible === 0 ? 0 : achieved / possible;
  return {
    metric_id,
    achieved,
    possible,
    score,
    threshold,
    passed: score >= threshold
  };
}

function buildDeterministicVerification(input: {
  contracts: ReturnType<typeof buildContracts>;
  historicalIntegrity: ReturnType<typeof buildHistoricalIntegrity>;
}) {
  const contractValidation =
    validatePilotOperationalContracts(input.contracts);
  const instructorReady = evaluateInstructorOnboarding({
    identifies_formative_not_grade: true,
    interprets_summary_as_bounded_evidence: true,
    identifies_followup_when_supported: true,
    avoids_unnecessary_followup: true,
    treats_ai_as_provisional: true,
    understands_override_and_privacy_boundary: true
  });
  const instructorMisunderstanding = evaluateInstructorOnboarding({
    identifies_formative_not_grade: false,
    interprets_summary_as_bounded_evidence: false,
    identifies_followup_when_supported: true,
    avoids_unnecessary_followup: false,
    treats_ai_as_provisional: false,
    understands_override_and_privacy_boundary: false
  });
  const safeOrientationText =
    "Your reasoning helps this activity provide feedback about your current responses. Confidence shows how sure you feel about this task. AI is used to support your learning and does not determine your grade. You may withdraw from research participation without affecting your course access or grade.";
  const unsafeOrientationText =
    "The internal profile and routing decision determine your grade.";
  const studentReady = evaluateStudentOrientation({
    visible_text: safeOrientationText
  });
  const studentUnsafe = evaluateStudentOrientation({
    visible_text: unsafeOrientationText
  });
  const workflowReady = evaluateWorkflowReadiness({
    before_class_completed: [
      ...input.contracts.workflow.phases.before_class
    ],
    during_class_completed: [
      ...input.contracts.workflow.phases.during_class
    ],
    after_class_completed: [
      ...input.contracts.workflow.phases.after_class
    ]
  });
  const workflowIncomplete = evaluateWorkflowReadiness({
    before_class_completed: [],
    during_class_completed: [],
    after_class_completed: []
  });
  const baselineEvidence = [
    {
      evidence_id: "evidence_01",
      status: "accepted",
      source_id: "source_01"
    }
  ];
  const baselineAudit = [
    {
      audit_id: "audit_01",
      event: "evidence_accepted"
    }
  ];
  const failureRecoveries =
    input.contracts.failure_handling.scenarios.map((scenario) =>
      simulateFailureRecovery({
        failure_type: scenario.failure_type,
        evidence_records: baselineEvidence,
        audit_records: baselineAudit
      })
    );
  const privacyVerified = evaluatePrivacyReadiness({
    consent_process_verified: true,
    withdrawal_process_verified: true,
    anonymization_verified: true,
    access_control_verified: true,
    research_instruction_separation_verified: true,
    reb_or_ethics_approval_verified: true
  });
  const privacyNotVerified = evaluatePrivacyReadiness({
    consent_process_verified: false,
    withdrawal_process_verified: false,
    anonymization_verified: false,
    access_control_verified: false,
    research_instruction_separation_verified: false,
    reb_or_ethics_approval_verified: false
  });
  const safeMonitoring = evaluateMonitoringRecord({
    signal_name: "typed_interaction_failure_count",
    payload_keys: ["safe_reason_code", "event_count"],
    safe_reason_code_present: true
  });
  const unsafeMonitoring = evaluateMonitoringRecord({
    signal_name: "typed_interaction_failure_count",
    payload_keys: ["raw_password", "event_count"],
    safe_reason_code_present: true
  });
  const actualChecklist =
    buildPilotReadinessChecklistV1("not_verified");
  const syntheticVerifiedChecklist =
    buildPilotReadinessChecklistV1("verified");
  const actualReadiness = assessPilotOperationalReadiness({
    checks: actualChecklist.checks
  });
  const syntheticVerifiedReadiness =
    assessPilotOperationalReadiness({
      checks: syntheticVerifiedChecklist.checks
    });
  const failedChecklist = buildPilotReadinessChecklistV1("verified");
  failedChecklist.checks[0] = {
    ...failedChecklist.checks[0],
    status: "failed",
    evidence_reference: "synthetic_failed_environment_check"
  };
  const failedReadiness = assessPilotOperationalReadiness({
    checks: failedChecklist.checks
  });

  const instructorValidation = {
    validation_version:
      "e2a46-instructor-onboarding-validation-v1",
    complete_onboarding_passes: instructorReady.passed,
    misunderstanding_fails:
      !instructorMisunderstanding.passed &&
      instructorMisunderstanding.remediation_required,
    identifies_evidence_summary:
      instructorReady.checks.bounded_evidence,
    identifies_followup:
      instructorReady.checks.followup_when_supported,
    ai_not_final_judgment:
      instructorReady.checks.ai_is_provisional,
    passed: false
  };
  instructorValidation.passed =
    instructorValidation.complete_onboarding_passes &&
    instructorValidation.misunderstanding_fails &&
    instructorValidation.identifies_evidence_summary &&
    instructorValidation.identifies_followup &&
    instructorValidation.ai_not_final_judgment;

  const studentValidation = {
    validation_version:
      "e2a46-student-onboarding-validation-v1",
    safe_orientation_passes: studentReady.passed,
    reasoning_explained:
      studentReady.required_concepts.reasoning,
    confidence_explained:
      studentReady.required_concepts.confidence,
    feedback_explained:
      studentReady.required_concepts.feedback,
    ai_learning_not_grading:
      studentReady.required_concepts.learning_not_grading,
    withdrawal_information_clear:
      studentReady.withdrawal_information_clear,
    internal_labels_absent:
      !studentReady.internal_labels_exposed,
    unsafe_orientation_rejected: !studentUnsafe.passed,
    passed: false
  };
  studentValidation.passed =
    studentValidation.safe_orientation_passes &&
    studentValidation.reasoning_explained &&
    studentValidation.confidence_explained &&
    studentValidation.feedback_explained &&
    studentValidation.ai_learning_not_grading &&
    studentValidation.withdrawal_information_clear &&
    studentValidation.internal_labels_absent &&
    studentValidation.unsafe_orientation_rejected;

  const workflowValidation = {
    validation_version:
      "e2a46-workflow-readiness-validation-v1",
    complete_workflow_passes: workflowReady.passed,
    incomplete_workflow_fails: !workflowIncomplete.passed,
    before_class_complete:
      workflowReady.missing.before_class.length === 0,
    during_class_complete:
      workflowReady.missing.during_class.length === 0,
    after_class_complete:
      workflowReady.missing.after_class.length === 0,
    application_owns_transitions:
      input.contracts.workflow
        .application_owns_authoritative_transitions,
    passed: false
  };
  workflowValidation.passed =
    workflowValidation.complete_workflow_passes &&
    workflowValidation.incomplete_workflow_fails &&
    workflowValidation.before_class_complete &&
    workflowValidation.during_class_complete &&
    workflowValidation.after_class_complete &&
    workflowValidation.application_owns_transitions;

  const failureValidation = {
    validation_version:
      "e2a46-failure-recovery-validation-v1",
    scenario_count: failureRecoveries.length,
    every_scenario_preserves_evidence:
      failureRecoveries.every((recovery) =>
        recovery.evidence_preserved
      ),
    every_scenario_preserves_prior_audit:
      failureRecoveries.every((recovery) =>
        recovery.prior_audit_preserved
      ),
    every_scenario_records_typed_failure:
      failureRecoveries.every((recovery) =>
        recovery.typed_failure_recorded
      ),
    no_data_corruption:
      failureRecoveries.every((recovery) =>
        !recovery.data_corrupted
      ),
    duplicate_is_idempotent:
      failureRecoveries.find((recovery) =>
        recovery.failure_type === "duplicate_submission"
      )?.duplicate_effect_count === 0,
    provider_message_is_graceful:
      failureRecoveries.find((recovery) =>
        recovery.failure_type === "provider_unavailable"
      )?.student_facing_behavior.includes("temporary-unavailable") ??
      false,
    passed: false
  };
  failureValidation.passed =
    failureValidation.scenario_count === 6 &&
    failureValidation.every_scenario_preserves_evidence &&
    failureValidation.every_scenario_preserves_prior_audit &&
    failureValidation.every_scenario_records_typed_failure &&
    failureValidation.no_data_corruption &&
    failureValidation.duplicate_is_idempotent &&
    failureValidation.provider_message_is_graceful;

  const privacyValidation = {
    validation_version:
      "e2a46-privacy-readiness-validation-v1",
    verified_fixture_ready: privacyVerified.ready,
    missing_evidence_not_ready: !privacyNotVerified.ready,
    no_reb_approval_assumed:
      privacyNotVerified.no_reb_approval_assumed,
    missing_consent_excludes_research_not_course:
      input.contracts.privacy
        .missing_consent_excludes_research_not_course,
    withdrawal_excludes_research_not_course:
      input.contracts.privacy
        .withdrawal_excludes_future_research_not_course,
    prohibited_data_defined:
      input.contracts.privacy.prohibited_data.length === 6,
    passed: false
  };
  privacyValidation.passed =
    privacyValidation.verified_fixture_ready &&
    privacyValidation.missing_evidence_not_ready &&
    privacyValidation.no_reb_approval_assumed &&
    privacyValidation
      .missing_consent_excludes_research_not_course &&
    privacyValidation
      .withdrawal_excludes_research_not_course &&
    privacyValidation.prohibited_data_defined;

  const monitoringValidation = {
    validation_version: "e2a46-monitoring-validation-v1",
    safe_record_passes: safeMonitoring.passed,
    personal_information_rejected: !unsafeMonitoring.passed,
    all_required_signals_present:
      input.contracts.monitoring
        .permitted_monitoring_signals.length === 5,
    safe_reason_codes_required:
      input.contracts.monitoring
        .alert_requires_safe_reason_code,
    no_misconduct_inference:
      input.contracts.monitoring
        .monitoring_does_not_infer_misconduct,
    passed: false
  };
  monitoringValidation.passed =
    monitoringValidation.safe_record_passes &&
    monitoringValidation.personal_information_rejected &&
    monitoringValidation.all_required_signals_present &&
    monitoringValidation.safe_reason_codes_required &&
    monitoringValidation.no_misconduct_inference;

  const dataCollectionValidation = {
    validation_version:
      "e2a46-data-collection-readiness-validation-v1",
    evidence_collection_required:
      input.contracts.readiness_criteria.success_means
        .includes("evidence_is_collected_correctly"),
    profile_update_required:
      input.contracts.readiness_criteria.success_means
        .includes("profiles_update_from_valid_evidence"),
    audit_preservation_required:
      input.contracts.failure_handling.scenarios.every((scenario) =>
        scenario.audit_preserved
      ),
    research_data_requires_approval:
      input.contracts.workflow.phases.after_class
        .includes("researcher_receives_only_approved_research_data"),
    production_data_used: false,
    passed: false
  };
  dataCollectionValidation.passed =
    dataCollectionValidation.evidence_collection_required &&
    dataCollectionValidation.profile_update_required &&
    dataCollectionValidation.audit_preservation_required &&
    dataCollectionValidation.research_data_requires_approval &&
    !dataCollectionValidation.production_data_used;

  const auditPreservationValidation = {
    validation_version:
      "e2a46-audit-preservation-validation-v1",
    evidence_preserved_after_every_failure:
      failureValidation.every_scenario_preserves_evidence,
    audit_preserved_after_every_failure:
      failureValidation.every_scenario_preserves_prior_audit,
    teacher_override_is_append_only:
      input.contracts.failure_handling.scenarios
        .find((scenario) =>
          scenario.failure_type === "teacher_override"
        )?.system_behavior.includes("append_override_record") ??
      false,
    export_failure_preserves_source_records:
      input.contracts.failure_handling.scenarios
        .find((scenario) =>
          scenario.failure_type === "export_failure"
        )?.system_behavior.includes("preserve_source_records") ??
      false,
    passed: false
  };
  auditPreservationValidation.passed =
    auditPreservationValidation
      .evidence_preserved_after_every_failure &&
    auditPreservationValidation
      .audit_preserved_after_every_failure &&
    auditPreservationValidation.teacher_override_is_append_only &&
    auditPreservationValidation
      .export_failure_preserves_source_records;

  const teacherStudentBoundaryValidation = {
    validation_version:
      "e2a46-teacher-student-boundary-validation-v1",
    predecessor_teacher_review_contracts_passed:
      input.historicalIntegrity.teacher_review_contracts_passed,
    predecessor_role_separation_passed:
      input.historicalIntegrity.teacher_role_separation_passed,
    predecessor_access_control_passed:
      input.historicalIntegrity.teacher_access_control_passed,
    student_internal_labels_absent:
      !studentReady.internal_labels_exposed,
    instructor_ai_judgment_boundary_understood:
      instructorReady.checks.ai_is_provisional,
    passed: false
  };
  teacherStudentBoundaryValidation.passed =
    teacherStudentBoundaryValidation
      .predecessor_teacher_review_contracts_passed &&
    teacherStudentBoundaryValidation
      .predecessor_role_separation_passed &&
    teacherStudentBoundaryValidation
      .predecessor_access_control_passed &&
    teacherStudentBoundaryValidation
      .student_internal_labels_absent &&
    teacherStudentBoundaryValidation
      .instructor_ai_judgment_boundary_understood;

  const operationalReadinessDecision = {
    decision_version:
      "e2a46-operational-readiness-decision-v1",
    current_evidence_decision: actualReadiness.decision,
    current_verified_check_count:
      actualReadiness.verified_check_count,
    current_unverified_check_ids:
      actualReadiness.unverified_check_ids,
    synthetic_complete_fixture_decision:
      syntheticVerifiedReadiness.decision,
    failed_fixture_decision: failedReadiness.decision,
    deterministic_protocol_complete: true,
    actual_classroom_pilot_readiness_established: false,
    deployment_authorized: false,
    effectiveness_established: false,
    reb_or_ethics_approval_assumed: false,
    passed:
      actualReadiness.decision === "not_determined" &&
      syntheticVerifiedReadiness.decision ===
        "ready_for_authorized_controlled_pilot_review" &&
      failedReadiness.decision === "not_ready" &&
      !actualReadiness.deployment_authorized
  };

  const metricResults = [
    metric("instructor_readiness", [
      instructorValidation.passed
    ]),
    metric("student_readiness", [
      studentValidation.passed
    ]),
    metric("workflow_readiness", [
      workflowValidation.passed
    ]),
    metric("privacy_readiness_protocol", [
      privacyValidation.passed
    ]),
    metric("data_collection_readiness_protocol", [
      dataCollectionValidation.passed
    ]),
    metric("failure_handling_readiness", [
      failureValidation.passed,
      auditPreservationValidation.passed
    ]),
    metric("support_and_monitoring_readiness_protocol", [
      monitoringValidation.passed
    ])
  ];
  const readinessMetrics = {
    metrics_version: "e2a46-pilot-readiness-metrics-v1",
    metrics: metricResults,
    deterministic_protocol_metrics_passed:
      metricResults.every((entry) => entry.passed),
    actual_operational_readiness_score_reported: false,
    interpretation:
      "These synthetic checks establish protocol completeness, not deployment readiness or classroom effectiveness."
  };

  const scenarios = {
    scenario_version: "e2a46-synthetic-readiness-scenarios-v1",
    synthetic_only: true,
    real_student_data_used: false,
    safe_student_orientation: safeOrientationText,
    instructor_ready: instructorReady,
    instructor_misunderstanding: instructorMisunderstanding,
    workflow_ready: workflowReady,
    workflow_incomplete: workflowIncomplete,
    failure_recoveries: failureRecoveries,
    privacy_verified_fixture: privacyVerified,
    privacy_unverified_fixture: privacyNotVerified,
    safe_monitoring_fixture: safeMonitoring,
    unsafe_monitoring_fixture: unsafeMonitoring,
    actual_unverified_checklist: actualChecklist,
    synthetic_verified_checklist: syntheticVerifiedChecklist,
    synthetic_failed_checklist: failedChecklist
  };
  const contractFingerprint =
    buildPilotOperationalContractFingerprint(input.contracts);
  const replayOne = stableHash({
    contractFingerprint,
    instructorValidation,
    studentValidation,
    workflowValidation,
    failureValidation,
    privacyValidation,
    monitoringValidation,
    dataCollectionValidation,
    auditPreservationValidation,
    teacherStudentBoundaryValidation,
    operationalReadinessDecision,
    readinessMetrics
  });
  const replayTwo = stableHash({
    contractFingerprint:
      buildPilotOperationalContractFingerprint(input.contracts),
    instructorValidation,
    studentValidation,
    workflowValidation,
    failureValidation,
    privacyValidation,
    monitoringValidation,
    dataCollectionValidation,
    auditPreservationValidation,
    teacherStudentBoundaryValidation,
    operationalReadinessDecision,
    readinessMetrics
  });
  const replayValidation = {
    validation_version: "e2a46-deterministic-replay-v1",
    first_replay_hash: replayOne,
    second_replay_hash: replayTwo,
    replay_stable: replayOne === replayTwo,
    provider_calls_required: 0,
    passed: replayOne === replayTwo
  };

  const regressionTests = [
    {
      test_id: "instructor_misunderstanding_ai_output",
      passed:
        !instructorMisunderstanding.passed &&
        instructorMisunderstanding.remediation_required
    },
    {
      test_id: "student_misunderstanding_feedback_purpose",
      passed: !studentUnsafe.passed
    },
    {
      test_id: "provider_outage_recovers_without_corruption",
      passed:
        failureRecoveries.find((entry) =>
          entry.failure_type === "provider_unavailable"
        )?.evidence_preserved === true
    },
    {
      test_id: "student_session_interruption_is_recoverable",
      passed:
        failureRecoveries.find((entry) =>
          entry.failure_type === "student_disconnect"
        )?.evidence_preserved === true
    },
    {
      test_id: "duplicate_submissions_are_idempotent",
      passed: failureValidation.duplicate_is_idempotent
    },
    {
      test_id: "withdrawal_request_excludes_research_not_course",
      passed:
        input.contracts.privacy
          .withdrawal_excludes_future_research_not_course
    },
    {
      test_id: "unauthorized_teacher_access_is_denied",
      passed:
        input.historicalIntegrity.teacher_access_control_passed
    },
    {
      test_id: "export_failure_preserves_data_and_can_retry",
      passed:
        failureRecoveries.find((entry) =>
          entry.failure_type === "export_failure"
        )?.recovery_behavior.includes(
          "retry_with_new_export_run_id"
        ) === true
    },
    {
      test_id: "evidence_is_preserved_after_failure",
      passed:
        failureValidation.every_scenario_preserves_evidence
    },
    {
      test_id: "audit_trail_is_preserved_after_failure",
      passed:
        failureValidation.every_scenario_preserves_prior_audit
    },
    {
      test_id: "student_facing_communication_has_no_internal_leakage",
      passed:
        studentValidation.internal_labels_absent &&
        !studentReady.hidden_system_decisions_exposed
    },
    {
      test_id: "research_and_instruction_data_remain_separate",
      passed:
        privacyValidation
          .missing_consent_excludes_research_not_course &&
        teacherStudentBoundaryValidation
          .predecessor_role_separation_passed
    }
  ];
  const regressions = {
    regression_version: "e2a46-deterministic-regressions-v1",
    tests: regressionTests,
    test_count: regressionTests.length,
    passed:
      regressionTests.length === 12 &&
      regressionTests.every((test) => test.passed)
  };

  const suites = {
    onboarding: {
      instructor_passed: instructorValidation.passed,
      student_passed: studentValidation.passed,
      test_count: 13,
      passed:
        instructorValidation.passed &&
        studentValidation.passed
    },
    workflow_readiness: {
      ...workflowValidation,
      test_count: 6
    },
    failure_recovery: {
      ...failureValidation,
      test_count: 7
    },
    privacy: {
      ...privacyValidation,
      test_count: 6
    },
    monitoring: {
      ...monitoringValidation,
      test_count: 5
    },
    audit_preservation: {
      ...auditPreservationValidation,
      test_count: 4
    },
    teacher_student_boundary: {
      ...teacherStudentBoundaryValidation,
      test_count: 5
    },
    data_collection: {
      ...dataCollectionValidation,
      test_count: 5
    },
    readiness_decision: {
      ...operationalReadinessDecision,
      test_count: 6
    },
    metrics: {
      metrics: metricResults,
      actual_operational_readiness_score_reported: false,
      test_count: metricResults.length,
      passed:
        readinessMetrics.deterministic_protocol_metrics_passed
    },
    replay: {
      ...replayValidation,
      test_count: 2
    }
  };
  const deterministicCheckCount =
    Object.values(suites).reduce(
      (sum, suite) => sum + suite.test_count,
      0
    ) + regressions.test_count;
  return {
    contractValidation,
    scenarios,
    validations: {
      instructor_onboarding: instructorValidation,
      student_onboarding: studentValidation,
      workflow_readiness: workflowValidation,
      failure_recovery: failureValidation,
      privacy_readiness: privacyValidation,
      monitoring: monitoringValidation,
      data_collection_readiness: dataCollectionValidation,
      audit_preservation: auditPreservationValidation,
      teacher_student_boundary: teacherStudentBoundaryValidation
    },
    operationalReadinessDecision,
    readinessMetrics,
    replay: replayValidation,
    regressions,
    suites,
    deterministic_check_count: deterministicCheckCount,
    passed:
      contractValidation.passed &&
      Object.values(suites).every((suite) => suite.passed) &&
      regressions.passed &&
      operationalReadinessDecision.passed &&
      input.historicalIntegrity.passed
  };
}

export function buildE2A46FreezeArtifacts(networkRequestCount = 0) {
  const predecessor = buildE2A45FreezeArtifacts(0);
  const contracts = buildContracts();
  const contractFingerprint =
    buildPilotOperationalContractFingerprint(contracts);
  const historicalIntegrity = buildHistoricalIntegrity(predecessor);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const bindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a46_provider_call_guard_failed");
  const deterministic = buildDeterministicVerification({
    contracts,
    historicalIntegrity
  });
  const protocol = buildProtocol({
    contractFingerprint,
    bindings,
    budget,
    artifactContract
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    bindings,
    protectedIntegrity,
    contractFingerprint
  });
  const passed =
    deterministic.passed &&
    historicalIntegrity.passed &&
    candidateIntegrity.passed &&
    protectedIntegrity.passed &&
    providerCallGuard.passed;
  assert(
    passed,
    `e2a46_summary_failed:${JSON.stringify({
      contract_validation: deterministic.contractValidation.passed,
      failed_suites: Object.entries(deterministic.suites)
        .filter(([, suite]) => !suite.passed)
        .map(([name]) => name),
      failed_regressions: deterministic.regressions.tests
        .filter((test) => !test.passed)
        .map((test) => test.test_id),
      operational_readiness_decision:
        deterministic.operationalReadinessDecision,
      historical_integrity: historicalIntegrity.passed,
      protected_integrity: protectedIntegrity.passed,
      protected_mismatches: protectedIntegrity.mismatches,
      provider_call_guard: providerCallGuard.passed
    })}`
  );
  const summary = {
    status:
      "e2a46_pilot_operational_readiness_protocol_frozen_no_execution",
    passed,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    contract_count: Object.keys(contracts).length,
    required_regression_count:
      deterministic.regressions.test_count,
    deterministic_check_count:
      deterministic.deterministic_check_count,
    deterministic_protocol_metrics_passed:
      deterministic.readinessMetrics
        .deterministic_protocol_metrics_passed,
    operational_readiness_decision:
      deterministic.operationalReadinessDecision
        .current_evidence_decision,
    actual_classroom_pilot_readiness_established: false,
    classroom_effectiveness_established: false,
    deployment_authorized: false,
    reb_or_ethics_approval_assumed: false,
    database_schema_modified: false,
    runtime_intelligence_modified: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a46_execution_authorized: false,
    e2a46_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    production_data_used: false,
    real_student_data_used: false,
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    unnecessary_personal_information_stored: false
  };
  const manifest = {
    manifest_version: "e2a46-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A46_ARTIFACT_NAMES],
    operational_readiness_protocol_only: true,
    synthetic_evidence_only: true,
    actual_readiness_not_determined: true,
    no_live_execution: true,
    no_deployment: true,
    no_runtime_intelligence_change: true
  };
  return {
    manifest,
    protocol,
    contracts,
    contractFingerprint,
    deterministic,
    historicalIntegrity,
    budget,
    artifactContract,
    candidateIntegrity,
    protectedIntegrity,
    bindings,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function artifactValues(
  artifacts: ReturnType<typeof buildE2A46FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256":
      `${artifacts.protocol.protocol_hash}\n`,
    "component-contract-bindings.json": artifacts.bindings,
    "instructor-onboarding-contract.json":
      artifacts.contracts.instructor_onboarding,
    "student-onboarding-contract.json":
      artifacts.contracts.student_onboarding,
    "pilot-workflow-readiness-contract.json":
      artifacts.contracts.workflow,
    "pilot-failure-handling-contract.json":
      artifacts.contracts.failure_handling,
    "pilot-privacy-readiness-contract.json":
      artifacts.contracts.privacy,
    "pilot-monitoring-contract.json":
      artifacts.contracts.monitoring,
    "pilot-readiness-criteria.json":
      artifacts.contracts.readiness_criteria,
    "pilot-readiness-checklist.json":
      artifacts.contracts.readiness_checklist,
    "contract-validation.json":
      artifacts.deterministic.contractValidation,
    "synthetic-readiness-scenarios.json":
      artifacts.deterministic.scenarios,
    "instructor-onboarding-validation.json":
      artifacts.deterministic.validations.instructor_onboarding,
    "student-onboarding-validation.json":
      artifacts.deterministic.validations.student_onboarding,
    "workflow-readiness-validation.json":
      artifacts.deterministic.validations.workflow_readiness,
    "failure-recovery-validation.json":
      artifacts.deterministic.validations.failure_recovery,
    "privacy-readiness-validation.json":
      artifacts.deterministic.validations.privacy_readiness,
    "monitoring-validation.json":
      artifacts.deterministic.validations.monitoring,
    "data-collection-readiness-validation.json":
      artifacts.deterministic.validations
        .data_collection_readiness,
    "audit-preservation-validation.json":
      artifacts.deterministic.validations.audit_preservation,
    "teacher-student-boundary-validation.json":
      artifacts.deterministic.validations
        .teacher_student_boundary,
    "operational-readiness-decision.json":
      artifacts.deterministic.operationalReadinessDecision,
    "pilot-readiness-metrics.json":
      artifacts.deterministic.readinessMetrics,
    "deterministic-replay-results.json":
      artifacts.deterministic.replay,
    "deterministic-regression-results.json":
      artifacts.deterministic.regressions,
    "historical-integrity.json": artifacts.historicalIntegrity,
    "budget.json": artifacts.budget,
    "artifact-contract.json": artifacts.artifactContract,
    "candidate-integrity.json": artifacts.candidateIntegrity,
    "protected-source-integrity.json":
      artifacts.protectedIntegrity,
    "composite-runtime-identity.json":
      artifacts.compositeRuntimeIdentity,
    "provider-call-guard.json": artifacts.providerCallGuard,
    "summary.json": artifacts.summary
  };
}

function validateArtifactDirectory(runDirectory: string) {
  const expected = new Set(E2A46_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) =>
    !actual.includes(name)
  );
  const unexpected = actual.filter((name) =>
    !expected.has(name as (typeof E2A46_ARTIFACT_NAMES)[number])
  );
  const protocol = readJson<{ protocol_hash: string }>(
    path.join(runDirectory, "frozen-protocol.json")
  );
  const protocolHashFile = readFileSync(
    path.join(runDirectory, "frozen-protocol.sha256"),
    "utf8"
  ).trim();
  const summary = readJson<{
    passed: boolean;
    operational_readiness_decision: string;
    actual_classroom_pilot_readiness_established: boolean;
    classroom_effectiveness_established: boolean;
    deployment_authorized: boolean;
    reb_or_ethics_approval_assumed: boolean;
    database_schema_modified: boolean;
    runtime_intelligence_modified: boolean;
    e2a46_execution_authorized: boolean;
    e2a46_live_execution_performed: boolean;
    provider_calls_made: number;
    network_requests_made: number;
    production_data_used: boolean;
    real_student_data_used: boolean;
    chain_of_thought_stored: boolean;
    hidden_model_reasoning_stored: boolean;
    hidden_prompts_stored: boolean;
    unnecessary_personal_information_stored: boolean;
  }>(path.join(runDirectory, "summary.json"));
  return {
    validation_version: "e2a46-artifact-validation-v1",
    expected_artifact_count: E2A46_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    operational_readiness_decision:
      summary.operational_readiness_decision,
    actual_classroom_pilot_readiness_established:
      summary.actual_classroom_pilot_readiness_established,
    classroom_effectiveness_established:
      summary.classroom_effectiveness_established,
    deployment_authorized: summary.deployment_authorized,
    reb_or_ethics_approval_assumed:
      summary.reb_or_ethics_approval_assumed,
    database_schema_modified: summary.database_schema_modified,
    runtime_intelligence_modified:
      summary.runtime_intelligence_modified,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    artifacts: actual.map((name) => ({
      name,
      sha256: sha256(
        readFileSync(path.join(runDirectory, name))
      ),
      size_bytes: statSync(path.join(runDirectory, name)).size
    })),
    passed:
      missing.length === 1 &&
      missing[0] === "artifact-validation.json" &&
      unexpected.length === 0 &&
      protocol.protocol_hash === protocolHashFile &&
      summary.passed &&
      summary.operational_readiness_decision === "not_determined" &&
      !summary.actual_classroom_pilot_readiness_established &&
      !summary.classroom_effectiveness_established &&
      !summary.deployment_authorized &&
      !summary.reb_or_ethics_approval_assumed &&
      !summary.database_schema_modified &&
      !summary.runtime_intelligence_modified &&
      !summary.e2a46_execution_authorized &&
      !summary.e2a46_live_execution_performed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      !summary.production_data_used &&
      !summary.real_student_data_used &&
      !summary.chain_of_thought_stored &&
      !summary.hidden_model_reasoning_stored &&
      !summary.hidden_prompts_stored &&
      !summary.unnecessary_personal_information_stored
  };
}

export function writeE2A46FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a46_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A46FreezeArtifacts(
    input.networkRequestCount ?? 0
  );
  for (const [name, value] of Object.entries(
    artifactValues(artifacts)
  )) {
    if (name === "frozen-protocol.sha256") {
      writeFileSync(
        path.join(input.runDirectory, name),
        value as string,
        "utf8"
      );
    } else {
      writeJson(path.join(input.runDirectory, name), value);
    }
  }
  const artifactValidation =
    validateArtifactDirectory(input.runDirectory);
  assert(
    artifactValidation.passed,
    "e2a46_artifact_validation_failed"
  );
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A46_ARTIFACT_NAMES) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return {
    ...artifacts,
    artifactValidation: {
      ...artifactValidation,
      final_artifact_count:
        readdirSync(input.runDirectory).length
    }
  };
}

export function makeE2A46FreezeRunId() {
  return `e2a46_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A46FreezeRunDirectory() {
  assert(
    existsSync(E2A46_ARTIFACT_ROOT),
    "e2a46_artifact_root_missing"
  );
  const latest = readdirSync(E2A46_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A46_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a46_freeze_run_missing");
  return path.join(E2A46_ARTIFACT_ROOT, latest);
}

export function inspectE2A46FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    readiness_decision: readJson<JsonRecord>(
      path.join(runDirectory, "operational-readiness-decision.json")
    ),
    onboarding: {
      instructor: readJson<JsonRecord>(
        path.join(runDirectory, "instructor-onboarding-validation.json")
      ),
      student: readJson<JsonRecord>(
        path.join(runDirectory, "student-onboarding-validation.json")
      )
    },
    workflow: readJson<JsonRecord>(
      path.join(runDirectory, "workflow-readiness-validation.json")
    ),
    failure_recovery: readJson<JsonRecord>(
      path.join(runDirectory, "failure-recovery-validation.json")
    ),
    privacy: readJson<JsonRecord>(
      path.join(runDirectory, "privacy-readiness-validation.json")
    ),
    monitoring: readJson<JsonRecord>(
      path.join(runDirectory, "monitoring-validation.json")
    ),
    metrics: readJson<JsonRecord>(
      path.join(runDirectory, "pilot-readiness-metrics.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    )
  };
}
