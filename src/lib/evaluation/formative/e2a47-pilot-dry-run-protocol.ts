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
  buildPilotDataArchitectureContractV1
} from "./e2a44-classroom-pilot-contracts";
import {
  E2A46_PROTOCOL_VERSION,
  buildE2A46FreezeArtifacts
} from "./e2a46-pilot-operational-readiness-protocol";
import {
  END_TO_END_DATA_TRACE_CONTRACT_VERSION,
  PILOT_DRY_RUN_WORKFLOW_CONTRACT_VERSION,
  PILOT_FAILURE_RECOVERY_CONTRACT_VERSION,
  RESEARCH_EXPORT_READINESS_CONTRACT_VERSION,
  RUNTIME_SCHEMA_ALIGNMENT_CONTRACT_VERSION,
  TEACHER_REVIEW_VALIDATION_CONTRACT_VERSION,
  buildDryRunStudentDefinitions,
  buildEndToEndDataTraceContractV1,
  buildPilotDryRunContractFingerprint,
  buildPilotDryRunWorkflowContractV1,
  buildPilotFailureRecoveryContractV1,
  buildResearchExportProjection,
  buildResearchExportReadinessContractV1,
  buildRuntimeSchemaAlignmentContractV1,
  buildSyntheticStudentDryRun,
  buildTeacherReviewProjection,
  buildTeacherReviewValidationContractV1,
  simulatePilotFailureRecovery,
  validateEndToEndTrace,
  validatePilotDryRunContracts,
  validateResearchExportProjection,
  validateRuntimeSchemaAlignment,
  validateTeacherReviewProjection
} from "./e2a47-pilot-dry-run-contracts";

export const E2A47_PROTOCOL_VERSION =
  "e2a47-pilot-dry-run-end-to-end-classroom-validation-freeze-v1" as const;
export const E2A47_ARTIFACT_CONTRACT_VERSION =
  "e2a47-artifact-contract-v1" as const;
export const E2A47_BUDGET_CONTRACT_VERSION =
  "e2a47-budget-contract-v1" as const;
export const E2A47_COMPOSITE_IDENTITY_VERSION =
  "e2a47-composite-runtime-identity-v1" as const;
export const E2A47_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a47-pilot-dry-run-protocol-freeze"
);

const PREDECESSOR_COMMIT =
  "a211f5d40c738fc72639061ad1224f88ce71f410";
const E2A46_PROTOCOL_HASH =
  "68c0f468fa41c01dd5ae9574580453b762ea1d7212c10549274033a980bc38ca";
const E2A46_COMPOSITE_IDENTITY =
  "1bbc21e220e77a8dc40e17fc04eb254a8019fbd3a2e84ea586402af6766f5f10";
const E2A44_PROTOCOL_HASH =
  "6818e181e5ecbd500afe2bb22d50e33edf56b39f788e0dfd31f406db34c25ea0";
const E2A44_COMPOSITE_IDENTITY =
  "8eac47d0060a905fe6c94725af97ed62797481fae0cb3e4164405da3fa687c5f";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a44-classroom-pilot-contracts.ts":
    "be4c3a5e4c4914029a523caff2ba0352e03cc4b4b5e93fd584c7e76d7fec8105",
  "src/lib/evaluation/formative/e2a45-teacher-evidence-review-contracts.ts":
    "2fff424799dae8f84bde0c5d11e1f01b28e1c8284178b030b2026aa79cb05f9e",
  "src/lib/evaluation/formative/e2a46-pilot-operational-readiness-contracts.ts":
    "3f0162a43875f14dc105d69cd80986e3a66215491e110114b10a24c77e64e2df",
  "src/lib/evaluation/formative/e2a46-pilot-operational-readiness-protocol.ts":
    "8fbe63abc808f8ad8e6a231d509f595c67f302cd34edafc3ea80e9f259f0c878",
  "prisma/formative-evaluation-e2a46.ts":
    "f690c4d0780d2dbe9fc1b68a7189d2d5bdf8ca6cd5f854730bd93f3da9dcdb26"
} as const;

export const E2A47_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "pilot-dry-run-workflow-contract.json",
  "end-to-end-data-trace-contract.json",
  "runtime-schema-alignment-contract.json",
  "research-export-readiness-contract.json",
  "pilot-failure-recovery-contract.json",
  "teacher-review-validation-contract.json",
  "contract-validation.json",
  "synthetic-student-definitions.json",
  "synthetic-pilot-dry-runs.json",
  "end-to-end-trace-validation.json",
  "runtime-schema-alignment-validation.json",
  "workflow-validation.json",
  "profile-evolution-validation.json",
  "engagement-evolution-validation.json",
  "intervention-history-validation.json",
  "teacher-review-projection.json",
  "teacher-review-validation.json",
  "research-export-projection.json",
  "research-export-validation.json",
  "failure-recovery-validation.json",
  "privacy-boundary-validation.json",
  "audit-preservation-validation.json",
  "multi-student-isolation-validation.json",
  "pilot-readiness-metrics.json",
  "deterministic-replay-results.json",
  "deterministic-regression-results.json",
  "e2a44-architecture-alignment.json",
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
    "e2a47_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function buildContracts() {
  return {
    workflow: buildPilotDryRunWorkflowContractV1(),
    data_trace: buildEndToEndDataTraceContractV1(),
    schema_alignment: buildRuntimeSchemaAlignmentContractV1(),
    research_export: buildResearchExportReadinessContractV1(),
    failure_recovery: buildPilotFailureRecoveryContractV1(),
    teacher_review: buildTeacherReviewValidationContractV1()
  };
}

function buildBudget() {
  return {
    budget_contract_version: E2A47_BUDGET_CONTRACT_VERSION,
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
    classroom_dry_run_executed: false,
    deployment_authorized: false,
    provider_calls_made: 0,
    network_requests_made: 0
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A47_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A47_ARTIFACT_NAMES],
    immutable_after_write: true,
    synthetic_data_only: true,
    production_data_accessed: false,
    real_student_data_accessed: false,
    live_classroom_testing_executed: false,
    provider_calls_required: 0,
    network_requests_required: 0,
    chain_of_thought_prohibited: true,
    hidden_model_reasoning_prohibited: true,
    hidden_prompts_prohibited: true,
    direct_identifiers_prohibited: true,
    runtime_intelligence_modified: false,
    database_schema_modified: false
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a47-candidate-integrity-v1",
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
    integrity_version: "e2a47-protected-source-integrity-v1",
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
  predecessor: ReturnType<typeof buildE2A46FreezeArtifacts>
) {
  return {
    integrity_version: "e2a47-e2a46-historical-integrity-v1",
    predecessor_commit: PREDECESSOR_COMMIT,
    expected_protocol_version: E2A46_PROTOCOL_VERSION,
    actual_protocol_version: predecessor.protocol.protocol_version,
    expected_protocol_hash: E2A46_PROTOCOL_HASH,
    actual_protocol_hash: predecessor.protocol.protocol_hash,
    expected_composite_runtime_identity: E2A46_COMPOSITE_IDENTITY,
    actual_composite_runtime_identity:
      predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash,
    predecessor_contract_validation_passed:
      predecessor.deterministic.contractValidation.passed,
    predecessor_failure_handling_passed:
      predecessor.deterministic.validations.failure_recovery.passed,
    predecessor_privacy_passed:
      predecessor.deterministic.validations.privacy_readiness.passed,
    predecessor_monitoring_passed:
      predecessor.deterministic.validations.monitoring.passed,
    historical_artifacts_modified: false,
    provider_calls_made: predecessor.summary.provider_calls_made,
    network_requests_made: predecessor.summary.network_requests_made,
    passed:
      predecessor.protocol.protocol_version === E2A46_PROTOCOL_VERSION &&
      predecessor.protocol.protocol_hash === E2A46_PROTOCOL_HASH &&
      predecessor.compositeRuntimeIdentity
        .composite_runtime_identity_hash === E2A46_COMPOSITE_IDENTITY &&
      predecessor.deterministic.contractValidation.passed &&
      predecessor.deterministic.validations.failure_recovery.passed &&
      predecessor.deterministic.validations.privacy_readiness.passed &&
      predecessor.deterministic.validations.monitoring.passed &&
      predecessor.summary.provider_calls_made === 0 &&
      predecessor.summary.network_requests_made === 0
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a47-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a47_execution_authorized: false,
    classroom_testing_authorized: false,
    candidate_approval_authorized: false,
    candidate_activation_authorized: false,
    passed: networkRequestCount === 0
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a47-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      protocol_hash: E2A46_PROTOCOL_HASH,
      composite_runtime_identity: E2A46_COMPOSITE_IDENTITY
    },
    data_architecture: {
      protocol_hash: E2A44_PROTOCOL_HASH,
      composite_runtime_identity: E2A44_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    contract_versions: {
      workflow: PILOT_DRY_RUN_WORKFLOW_CONTRACT_VERSION,
      data_trace: END_TO_END_DATA_TRACE_CONTRACT_VERSION,
      schema_alignment: RUNTIME_SCHEMA_ALIGNMENT_CONTRACT_VERSION,
      research_export: RESEARCH_EXPORT_READINESS_CONTRACT_VERSION,
      failure_recovery: PILOT_FAILURE_RECOVERY_CONTRACT_VERSION,
      teacher_review: TEACHER_REVIEW_VALIDATION_CONTRACT_VERSION
    },
    new_implementation_hashes: {
      pilot_dry_run_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a47-pilot-dry-run-contracts.ts"
      ),
      pilot_dry_run_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a47-pilot-dry-run-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a47.ts"
      )
    },
    runtime_intelligence_components_modified: false,
    database_schema_modified: false,
    production_deployment_configuration_modified: false
  };
}

function buildProtocol(input: {
  contractFingerprint: ReturnType<
    typeof buildPilotDryRunContractFingerprint
  >;
  bindings: ReturnType<typeof buildComponentBindings>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A47_PROTOCOL_VERSION,
    status: "frozen_pilot_dry_run_no_execution",
    purpose:
      "synthetic_end_to_end_classroom_workflow_data_trace_teacher_review_export_and_recovery_validation",
    contract_hashes: input.contractFingerprint.contract_hashes,
    contract_fingerprint_hash:
      input.contractFingerprint.fingerprint_hash,
    component_bindings_hash: stableHash(input.bindings),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      operational_validation_only: true,
      classroom_effectiveness_not_established: true,
      learning_gains_not_established: true,
      reb_or_ethics_approval_not_assumed: true,
      real_student_usability_not_established: true,
      synthetic_fixtures_only: true,
      runtime_intelligence_components_unchanged: true
    },
    execution: {
      authorized: false,
      executable: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      classroom_testing_authorized: false,
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
    typeof buildPilotDryRunContractFingerprint
  >;
}) {
  const core = {
    identity_version: E2A47_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    predecessor_protocol_hash: E2A46_PROTOCOL_HASH,
    predecessor_composite_runtime_identity:
      E2A46_COMPOSITE_IDENTITY,
    data_architecture_protocol_hash: E2A44_PROTOCOL_HASH,
    data_architecture_composite_runtime_identity:
      E2A44_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    protected_source_hashes:
      input.protectedIntegrity.actual_sha256,
    contract_fingerprint_hash:
      input.contractFingerprint.fingerprint_hash,
    runtime_intelligence_modified: false,
    database_schema_modified: false,
    execution_authorized: false
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

function buildDeterministicVerification(input: {
  contracts: ReturnType<typeof buildContracts>;
  historicalIntegrity: ReturnType<typeof buildHistoricalIntegrity>;
}) {
  const contractValidation =
    validatePilotDryRunContracts(input.contracts);
  const definitions = buildDryRunStudentDefinitions();
  const dryRuns = definitions.map((definition) =>
    buildSyntheticStudentDryRun(definition)
  );
  const traceValidations = dryRuns.map((dryRun) =>
    validateEndToEndTrace({
      definition: dryRun.definition,
      records: dryRun.trace_records
    })
  );
  const e2a44Architecture = buildPilotDataArchitectureContractV1();
  const schemaAlignment = validateRuntimeSchemaAlignment({
    predecessor_entities: e2a44Architecture.entities
  });
  const teacherProjection = buildTeacherReviewProjection({ dryRuns });
  const teacherValidation =
    validateTeacherReviewProjection(teacherProjection);
  const researchExport = buildResearchExportProjection({ dryRuns });
  const researchExportValidation =
    validateResearchExportProjection(researchExport);
  const failureTypes = [
    "student_session_interruption",
    "duplicate_submission",
    "provider_unavailable",
    "teacher_review_before_completion",
    "export_interrupted",
    "profile_update_failure"
  ] as const;
  const originalEvidence = dryRuns.flatMap(
    (dryRun) => dryRun.trace_records
  );
  const originalAudit = dryRuns.map((dryRun) => ({
    session_public_id: dryRun.definition.session_public_id,
    status: "synthetic_dry_run_complete"
  }));
  const failures = failureTypes.map((failureType) =>
    simulatePilotFailureRecovery({
      failure_type: failureType,
      evidence_records: originalEvidence,
      audit_records: originalAudit
    })
  );
  const workflowValidation = {
    validation_version: "e2a47-workflow-validation-v1",
    before_class_complete:
      input.contracts.workflow.before_class.length === 4,
    during_class_complete:
      input.contracts.workflow.during_class.length === 7,
    after_class_complete:
      input.contracts.workflow.after_class.length === 3,
    student_archetype_count: dryRuns.length,
    every_session_reaches_closure: dryRuns.every(
      (dryRun) => dryRun.closure.reason.length > 0
    ),
    no_unnecessary_tutoring_for_fast_learner:
      dryRuns[0].intervention_history.length === 1 &&
      dryRuns[0].closure.sound,
    adaptive_support_for_slow_learner:
      dryRuns[1].intervention_history.length === 2,
    persistent_barrier_has_bounded_stop:
      dryRuns[2].closure.reason === "supportive_bounded_stop" &&
      dryRuns[2].closure.instructor_followup_recommended,
    copied_wording_not_false_sound:
      !dryRuns[3].closure.sound,
    self_correction_updates_profile:
      dryRuns[4].profile_history.some(
        (profile) => profile.state === "sound"
      ),
    passed: false
  };
  workflowValidation.passed = Object.entries(workflowValidation)
    .filter(([name]) =>
      !["validation_version", "student_archetype_count", "passed"]
        .includes(name)
    )
    .every(([, value]) => value === true) &&
    workflowValidation.student_archetype_count === 5;

  const profileEvolutionValidation = {
    validation_version: "e2a47-profile-evolution-validation-v1",
    every_profile_has_history: dryRuns.every(
      (dryRun) => dryRun.profile_history.length >= 2
    ),
    every_profile_links_source_evidence: dryRuns.every(
      (dryRun) => dryRun.profile_history.every(
        (profile) => profile.evidence_source_record_id.length > 0
      )
    ),
    fast_learner_becomes_sound:
      dryRuns[0].profile_history.at(-1)?.state === "sound",
    copied_wording_remains_non_sound:
      dryRuns[3].profile_history.at(-1)?.state !== "sound",
    self_correction_becomes_sound:
      dryRuns[4].profile_history.at(-1)?.state === "sound",
    prior_states_preserved: dryRuns.every(
      (dryRun) =>
        dryRun.profile_history[0].profile_snapshot_id !==
        dryRun.profile_history.at(-1)?.profile_snapshot_id
    ),
    passed: false
  };
  profileEvolutionValidation.passed = Object.entries(
    profileEvolutionValidation
  )
    .filter(([name]) => !["validation_version", "passed"].includes(name))
    .every(([, value]) => value === true);

  const engagementEvolutionValidation = {
    validation_version:
      "e2a47-engagement-evolution-validation-v1",
    every_student_has_process_context: dryRuns.every(
      (dryRun) => dryRun.engagement_history.length > 0
    ),
    no_stable_trait_claims: dryRuns.every(
      (dryRun) => dryRun.engagement_history.every(
        (entry) => !entry.stable_trait_claimed
      )
    ),
    engagement_does_not_override_conceptual_evidence:
      !dryRuns[3].closure.sound,
    passed: false
  };
  engagementEvolutionValidation.passed =
    engagementEvolutionValidation.every_student_has_process_context &&
    engagementEvolutionValidation.no_stable_trait_claims &&
    engagementEvolutionValidation
      .engagement_does_not_override_conceptual_evidence;

  const interventionValidation = {
    validation_version:
      "e2a47-intervention-history-validation-v1",
    every_intervention_links_profile: dryRuns.every(
      (dryRun) => dryRun.intervention_history.every(
        (intervention) =>
          intervention.source_profile_snapshot_id.length > 0
      )
    ),
    multiple_strategies_preserved_for_persistent_case:
      dryRuns[2].intervention_history.length === 2,
    outcomes_recorded: dryRuns.every(
      (dryRun) => dryRun.intervention_history.every(
        (intervention) => intervention.outcome.length > 0
      )
    ),
    no_effectiveness_claim:
      dryRuns.every((dryRun) =>
        dryRun.intervention_history.every(
          (intervention) =>
            !intervention.outcome.includes("caused_learning")
        )
      ),
    passed: false
  };
  interventionValidation.passed =
    interventionValidation.every_intervention_links_profile &&
    interventionValidation
      .multiple_strategies_preserved_for_persistent_case &&
    interventionValidation.outcomes_recorded &&
    interventionValidation.no_effectiveness_claim;

  const failureValidation = {
    validation_version: "e2a47-failure-recovery-validation-v1",
    scenario_count: failures.length,
    every_scenario_preserves_evidence: failures.every(
      (failure) => failure.evidence_preserved
    ),
    every_scenario_preserves_prior_audit: failures.every(
      (failure) => failure.prior_audit_preserved
    ),
    no_duplicate_effects: failures.every(
      (failure) => failure.duplicate_effect_count === 0
    ),
    no_data_corruption: failures.every(
      (failure) => !failure.data_corrupted
    ),
    profile_failure_preserves_pointer:
      failures.find(
        (failure) =>
          failure.failure_type === "profile_update_failure"
      )?.profile_pointer_changed === false,
    partial_review_marked:
      failures.find(
        (failure) =>
          failure.failure_type ===
          "teacher_review_before_completion"
      )?.partial_evidence_marked === true,
    export_retry_uses_immutable_sources:
      failures.find(
        (failure) =>
          failure.failure_type === "export_interrupted"
      )?.retry_uses_immutable_sources === true,
    passed: false
  };
  failureValidation.passed =
    failureValidation.scenario_count === 6 &&
    failureValidation.every_scenario_preserves_evidence &&
    failureValidation.every_scenario_preserves_prior_audit &&
    failureValidation.no_duplicate_effects &&
    failureValidation.no_data_corruption &&
    failureValidation.profile_failure_preserves_pointer &&
    failureValidation.partial_review_marked &&
    failureValidation.export_retry_uses_immutable_sources;

  const privacyValidation = {
    validation_version: "e2a47-privacy-boundary-validation-v1",
    research_export_has_only_pseudonymous_ids:
      researchExportValidation.direct_identifiers_absent,
    research_export_excludes_hidden_reasoning:
      researchExportValidation.hidden_reasoning_absent,
    teacher_projection_excludes_hidden_reasoning:
      teacherValidation.hidden_reasoning_absent,
    teacher_projection_excludes_model_internals:
      teacherValidation.model_internals_absent,
    student_visible_internal_labels_present: false,
    production_data_used: false,
    real_student_data_used: false,
    passed: false
  };
  privacyValidation.passed =
    privacyValidation.research_export_has_only_pseudonymous_ids &&
    privacyValidation.research_export_excludes_hidden_reasoning &&
    privacyValidation.teacher_projection_excludes_hidden_reasoning &&
    privacyValidation.teacher_projection_excludes_model_internals &&
    !privacyValidation.student_visible_internal_labels_present &&
    !privacyValidation.production_data_used &&
    !privacyValidation.real_student_data_used;

  const auditValidation = {
    validation_version: "e2a47-audit-preservation-validation-v1",
    every_trace_hash_valid: traceValidations.every(
      (validation) => validation.hashes_valid
    ),
    every_trace_has_complete_provenance: traceValidations.every(
      (validation) => validation.provenance_links_complete
    ),
    failure_recovery_preserves_prior_audit:
      failureValidation.every_scenario_preserves_prior_audit,
    source_sequence_is_monotonic: traceValidations.every(
      (validation) => validation.sequence_is_monotonic
    ),
    passed: false
  };
  auditValidation.passed =
    auditValidation.every_trace_hash_valid &&
    auditValidation.every_trace_has_complete_provenance &&
    auditValidation.failure_recovery_preserves_prior_audit &&
    auditValidation.source_sequence_is_monotonic;

  const isolationValidation = {
    validation_version:
      "e2a47-multi-student-isolation-validation-v1",
    unique_student_ids:
      new Set(
        dryRuns.map((dryRun) =>
          dryRun.definition.student_public_id
        )
      ).size === dryRuns.length,
    unique_session_ids:
      new Set(
        dryRuns.map((dryRun) =>
          dryRun.definition.session_public_id
        )
      ).size === dryRuns.length,
    unique_research_ids:
      new Set(
        dryRuns.map((dryRun) =>
          dryRun.definition.research_student_id
        )
      ).size === dryRuns.length,
    no_cross_student_trace_links: dryRuns.every((dryRun) => {
      const ids = new Set(
        dryRun.trace_records.map((record) => record.record_id)
      );
      return dryRun.trace_records.every((record) =>
        record.source_record_ids.every((source) => ids.has(source))
      );
    }),
    no_cross_student_profile_links: dryRuns.every((dryRun) =>
      dryRun.profile_history.every((profile) =>
        profile.profile_snapshot_id.startsWith(
          dryRun.definition.student_public_id
        )
      )
    ),
    passed: false
  };
  isolationValidation.passed =
    isolationValidation.unique_student_ids &&
    isolationValidation.unique_session_ids &&
    isolationValidation.unique_research_ids &&
    isolationValidation.no_cross_student_trace_links &&
    isolationValidation.no_cross_student_profile_links;

  const e2a44Alignment = {
    alignment_version: "e2a47-e2a44-architecture-alignment-v1",
    predecessor_protocol_hash: E2A44_PROTOCOL_HASH,
    predecessor_composite_runtime_identity:
      E2A44_COMPOSITE_IDENTITY,
    predecessor_contract_version:
      e2a44Architecture.contract_version,
    predecessor_layer_count: e2a44Architecture.layers.length,
    predecessor_entity_count: e2a44Architecture.entities.length,
    schema_alignment_passed: schemaAlignment.passed,
    database_schema_change_required: false,
    passed:
      e2a44Architecture.layers.length === 5 &&
      e2a44Architecture.entities.length === 23 &&
      schemaAlignment.passed
  };

  const regressions = buildRegressions({
    dryRuns,
    traceValidations,
    failureValidation,
    teacherValidation,
    researchExportValidation,
    privacyValidation,
    auditValidation,
    isolationValidation,
    profileEvolutionValidation,
    interventionValidation
  });
  const replayA = stableHash({
    definitions,
    dryRuns,
    failures,
    teacherProjection,
    researchExport
  });
  const replayB = stableHash({
    definitions: buildDryRunStudentDefinitions(),
    dryRuns: buildDryRunStudentDefinitions().map((definition) =>
      buildSyntheticStudentDryRun(definition)
    ),
    failures,
    teacherProjection,
    researchExport
  });
  const replay = {
    replay_version: "e2a47-deterministic-replay-v1",
    first_hash: replayA,
    second_hash: replayB,
    passed: replayA === replayB
  };
  const metrics = buildMetrics({
    dryRuns,
    traceValidations,
    profileEvolutionValidation,
    teacherValidation,
    researchExportValidation,
    failureValidation,
    privacyValidation
  });
  const suites = {
    workflow: workflowValidation,
    data_trace: {
      validation_version: "e2a47-all-traces-validation-v1",
      trace_count: traceValidations.length,
      all_passed: traceValidations.every(
        (validation) => validation.passed
      ),
      passed:
        traceValidations.length === 5 &&
        traceValidations.every(
          (validation) => validation.passed
        )
    },
    schema_alignment: schemaAlignment,
    profile_evolution: profileEvolutionValidation,
    engagement_evolution: engagementEvolutionValidation,
    intervention_history: interventionValidation,
    teacher_review: teacherValidation,
    research_export: researchExportValidation,
    failure_recovery: failureValidation,
    privacy: privacyValidation,
    audit_preservation: auditValidation,
    multi_student_isolation: isolationValidation,
    e2a44_alignment: e2a44Alignment
  };
  const deterministicCheckCount =
    Object.values(contractValidation.checks).length +
    Object.values(suites).reduce(
      (count, suite) =>
        count +
        Object.entries(suite).filter(
          ([name, value]) =>
            name !== "validation_version" &&
            name !== "passed" &&
            typeof value === "boolean"
        ).length,
      0
    ) +
    regressions.test_count +
    metrics.metrics.length +
    1;
  const passed =
    contractValidation.passed &&
    Object.values(suites).every((suite) => suite.passed) &&
    regressions.passed &&
    replay.passed &&
    metrics.synthetic_protocol_metrics_passed &&
    input.historicalIntegrity.passed;
  return {
    contractValidation,
    definitions,
    dryRuns,
    traceValidations,
    e2a44Architecture,
    schemaAlignment,
    teacherProjection,
    researchExport,
    failures,
    suites,
    metrics,
    replay,
    regressions,
    deterministic_check_count: deterministicCheckCount,
    passed
  };
}

function buildRegressions(input: {
  dryRuns: ReturnType<typeof buildSyntheticStudentDryRun>[];
  traceValidations: ReturnType<typeof validateEndToEndTrace>[];
  failureValidation: {
    every_scenario_preserves_evidence: boolean;
    every_scenario_preserves_prior_audit: boolean;
    no_duplicate_effects: boolean;
    no_data_corruption: boolean;
  };
  teacherValidation: ReturnType<
    typeof validateTeacherReviewProjection
  >;
  researchExportValidation: ReturnType<
    typeof validateResearchExportProjection
  >;
  privacyValidation: {
    passed: boolean;
  };
  auditValidation: {
    passed: boolean;
  };
  isolationValidation: {
    passed: boolean;
  };
  profileEvolutionValidation: {
    passed: boolean;
  };
  interventionValidation: {
    passed: boolean;
  };
}) {
  const tests = [
    {
      test_id: "complete_successful_pilot_flow",
      passed:
        input.traceValidations.every(
          (validation) => validation.passed
        ) &&
        input.dryRuns.every(
          (dryRun) => dryRun.closure.reason.length > 0
        )
    },
    {
      test_id: "student_interruption_recovery",
      passed:
        input.failureValidation.every_scenario_preserves_evidence
    },
    {
      test_id: "duplicate_submission",
      passed: input.failureValidation.no_duplicate_effects
    },
    {
      test_id: "provider_failure",
      passed:
        input.failureValidation.no_data_corruption &&
        input.failureValidation.every_scenario_preserves_prior_audit
    },
    {
      test_id: "partial_evidence_review",
      passed: input.teacherValidation.partial_evidence_marked
    },
    {
      test_id: "export_reproducibility",
      passed:
        input.researchExportValidation.stable_ordering &&
        input.researchExportValidation
          .manifest_record_count_matches
    },
    {
      test_id: "teacher_visibility_boundary",
      passed:
        input.teacherValidation.hidden_reasoning_absent &&
        input.teacherValidation.model_internals_absent
    },
    {
      test_id: "student_privacy_boundary",
      passed: input.privacyValidation.passed
    },
    {
      test_id: "profile_evidence_consistency",
      passed: input.profileEvolutionValidation.passed
    },
    {
      test_id: "intervention_history_preservation",
      passed: input.interventionValidation.passed
    },
    {
      test_id: "multi_student_isolation",
      passed: input.isolationValidation.passed
    },
    {
      test_id: "no_hidden_reasoning_export",
      passed:
        input.researchExportValidation.hidden_reasoning_absent &&
        input.auditValidation.passed
    }
  ];
  return {
    regression_version: "e2a47-required-regressions-v1",
    tests,
    test_count: tests.length,
    passed:
      tests.length === 12 &&
      tests.every((test) => test.passed)
  };
}

function buildMetrics(input: {
  dryRuns: ReturnType<typeof buildSyntheticStudentDryRun>[];
  traceValidations: ReturnType<typeof validateEndToEndTrace>[];
  profileEvolutionValidation: { passed: boolean };
  teacherValidation: {
    passed: boolean;
    individual_summary_count: number;
  };
  researchExportValidation: {
    passed: boolean;
    record_count: number;
  };
  failureValidation: {
    passed: boolean;
    scenario_count: number;
  };
  privacyValidation: { passed: boolean };
}) {
  const metrics = [
    {
      metric_id: "workflow_completion_rate",
      numerator: input.dryRuns.filter(
        (dryRun) => dryRun.closure.reason.length > 0
      ).length,
      denominator: input.dryRuns.length
    },
    {
      metric_id: "data_trace_completeness",
      numerator: input.traceValidations.filter(
        (validation) => validation.passed
      ).length,
      denominator: input.traceValidations.length
    },
    {
      metric_id: "profile_consistency",
      numerator: input.profileEvolutionValidation.passed ? 1 : 0,
      denominator: 1
    },
    {
      metric_id: "teacher_evidence_completeness",
      numerator: input.teacherValidation.passed
        ? input.teacherValidation.individual_summary_count
        : 0,
      denominator: input.dryRuns.length
    },
    {
      metric_id: "export_completeness",
      numerator: input.researchExportValidation.passed
        ? input.researchExportValidation.record_count
        : 0,
      denominator: input.dryRuns.length
    },
    {
      metric_id: "failure_recovery_success",
      numerator: input.failureValidation.passed
        ? input.failureValidation.scenario_count
        : 0,
      denominator: 6
    },
    {
      metric_id: "privacy_boundary_compliance",
      numerator: input.privacyValidation.passed ? 1 : 0,
      denominator: 1
    }
  ].map((metric) => ({
    ...metric,
    rate:
      metric.denominator === 0
        ? 0
        : metric.numerator / metric.denominator,
    passed:
      metric.denominator > 0 &&
      metric.numerator === metric.denominator
  }));
  return {
    metrics_version: "e2a47-pilot-readiness-metrics-v1",
    metrics,
    synthetic_protocol_metrics_passed:
      metrics.every((metric) => metric.passed),
    actual_classroom_metrics_reported: false,
    classroom_effectiveness_established: false,
    interpretation:
      "These metrics validate synthetic protocol connectivity only; they do not report real classroom performance or learning gains."
  };
}

export function buildE2A47FreezeArtifacts(networkRequestCount = 0) {
  const predecessor = buildE2A46FreezeArtifacts(0);
  const contracts = buildContracts();
  const contractFingerprint =
    buildPilotDryRunContractFingerprint(contracts);
  const historicalIntegrity = buildHistoricalIntegrity(predecessor);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const bindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a47_provider_call_guard_failed");
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
    `e2a47_summary_failed:${JSON.stringify({
      contract_validation: deterministic.contractValidation.passed,
      failed_suites: Object.entries(deterministic.suites)
        .filter(([, suite]) => !suite.passed)
        .map(([name]) => name),
      failed_regressions: deterministic.regressions.tests
        .filter((test) => !test.passed)
        .map((test) => test.test_id),
      historical_integrity: historicalIntegrity.passed,
      protected_integrity: protectedIntegrity.passed,
      protected_mismatches: protectedIntegrity.mismatches,
      provider_call_guard: providerCallGuard.passed
    })}`
  );
  const summary = {
    status:
      "e2a47_pilot_dry_run_protocol_frozen_no_execution",
    passed,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    contract_count: Object.keys(contracts).length,
    synthetic_student_count:
      deterministic.dryRuns.length,
    trace_stage_count:
      contracts.data_trace.ordered_stages.length,
    failure_scenario_count:
      deterministic.failures.length,
    required_regression_count:
      deterministic.regressions.test_count,
    deterministic_check_count:
      deterministic.deterministic_check_count,
    synthetic_protocol_metrics_passed:
      deterministic.metrics.synthetic_protocol_metrics_passed,
    synthetic_end_to_end_validation_passed: true,
    actual_classroom_pilot_executed: false,
    actual_classroom_effectiveness_established: false,
    learning_gains_established: false,
    real_student_usability_established: false,
    reb_or_ethics_approval_assumed: false,
    deployment_authorized: false,
    database_schema_modified: false,
    runtime_intelligence_modified: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a47_execution_authorized: false,
    e2a47_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    production_data_used: false,
    real_student_data_used: false,
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    direct_identifiers_exported: false
  };
  const manifest = {
    manifest_version: "e2a47-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A47_ARTIFACT_NAMES],
    synthetic_end_to_end_validation_only: true,
    no_live_execution: true,
    no_classroom_testing: true,
    no_provider_calls: true,
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
  artifacts: ReturnType<typeof buildE2A47FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256":
      `${artifacts.protocol.protocol_hash}\n`,
    "component-contract-bindings.json": artifacts.bindings,
    "pilot-dry-run-workflow-contract.json":
      artifacts.contracts.workflow,
    "end-to-end-data-trace-contract.json":
      artifacts.contracts.data_trace,
    "runtime-schema-alignment-contract.json":
      artifacts.contracts.schema_alignment,
    "research-export-readiness-contract.json":
      artifacts.contracts.research_export,
    "pilot-failure-recovery-contract.json":
      artifacts.contracts.failure_recovery,
    "teacher-review-validation-contract.json":
      artifacts.contracts.teacher_review,
    "contract-validation.json":
      artifacts.deterministic.contractValidation,
    "synthetic-student-definitions.json":
      artifacts.deterministic.definitions,
    "synthetic-pilot-dry-runs.json":
      artifacts.deterministic.dryRuns,
    "end-to-end-trace-validation.json":
      artifacts.deterministic.traceValidations,
    "runtime-schema-alignment-validation.json":
      artifacts.deterministic.schemaAlignment,
    "workflow-validation.json":
      artifacts.deterministic.suites.workflow,
    "profile-evolution-validation.json":
      artifacts.deterministic.suites.profile_evolution,
    "engagement-evolution-validation.json":
      artifacts.deterministic.suites.engagement_evolution,
    "intervention-history-validation.json":
      artifacts.deterministic.suites.intervention_history,
    "teacher-review-projection.json":
      artifacts.deterministic.teacherProjection,
    "teacher-review-validation.json":
      artifacts.deterministic.suites.teacher_review,
    "research-export-projection.json":
      artifacts.deterministic.researchExport,
    "research-export-validation.json":
      artifacts.deterministic.suites.research_export,
    "failure-recovery-validation.json":
      artifacts.deterministic.suites.failure_recovery,
    "privacy-boundary-validation.json":
      artifacts.deterministic.suites.privacy,
    "audit-preservation-validation.json":
      artifacts.deterministic.suites.audit_preservation,
    "multi-student-isolation-validation.json":
      artifacts.deterministic.suites.multi_student_isolation,
    "pilot-readiness-metrics.json":
      artifacts.deterministic.metrics,
    "deterministic-replay-results.json":
      artifacts.deterministic.replay,
    "deterministic-regression-results.json":
      artifacts.deterministic.regressions,
    "e2a44-architecture-alignment.json":
      artifacts.deterministic.suites.e2a44_alignment,
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
  const expected = new Set(E2A47_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) =>
    !actual.includes(name)
  );
  const unexpected = actual.filter((name) =>
    !expected.has(name as (typeof E2A47_ARTIFACT_NAMES)[number])
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
    synthetic_end_to_end_validation_passed: boolean;
    actual_classroom_pilot_executed: boolean;
    actual_classroom_effectiveness_established: boolean;
    learning_gains_established: boolean;
    real_student_usability_established: boolean;
    reb_or_ethics_approval_assumed: boolean;
    deployment_authorized: boolean;
    database_schema_modified: boolean;
    runtime_intelligence_modified: boolean;
    e2a47_execution_authorized: boolean;
    e2a47_live_execution_performed: boolean;
    provider_calls_made: number;
    network_requests_made: number;
    production_data_used: boolean;
    real_student_data_used: boolean;
    chain_of_thought_stored: boolean;
    hidden_model_reasoning_stored: boolean;
    hidden_prompts_stored: boolean;
    direct_identifiers_exported: boolean;
  }>(path.join(runDirectory, "summary.json"));
  return {
    validation_version: "e2a47-artifact-validation-v1",
    expected_artifact_count: E2A47_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    synthetic_end_to_end_validation_passed:
      summary.synthetic_end_to_end_validation_passed,
    actual_classroom_pilot_executed:
      summary.actual_classroom_pilot_executed,
    classroom_effectiveness_established:
      summary.actual_classroom_effectiveness_established,
    learning_gains_established:
      summary.learning_gains_established,
    real_student_usability_established:
      summary.real_student_usability_established,
    reb_or_ethics_approval_assumed:
      summary.reb_or_ethics_approval_assumed,
    deployment_authorized: summary.deployment_authorized,
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
      summary.synthetic_end_to_end_validation_passed &&
      !summary.actual_classroom_pilot_executed &&
      !summary.actual_classroom_effectiveness_established &&
      !summary.learning_gains_established &&
      !summary.real_student_usability_established &&
      !summary.reb_or_ethics_approval_assumed &&
      !summary.deployment_authorized &&
      !summary.database_schema_modified &&
      !summary.runtime_intelligence_modified &&
      !summary.e2a47_execution_authorized &&
      !summary.e2a47_live_execution_performed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      !summary.production_data_used &&
      !summary.real_student_data_used &&
      !summary.chain_of_thought_stored &&
      !summary.hidden_model_reasoning_stored &&
      !summary.hidden_prompts_stored &&
      !summary.direct_identifiers_exported
  };
}

export function writeE2A47FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a47_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A47FreezeArtifacts(
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
    "e2a47_artifact_validation_failed"
  );
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A47_ARTIFACT_NAMES) {
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

export function makeE2A47FreezeRunId() {
  return `e2a47_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A47FreezeRunDirectory() {
  assert(
    existsSync(E2A47_ARTIFACT_ROOT),
    "e2a47_artifact_root_missing"
  );
  const latest = readdirSync(E2A47_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A47_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a47_freeze_run_missing");
  return path.join(E2A47_ARTIFACT_ROOT, latest);
}

export function inspectE2A47FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    metrics: readJson<JsonRecord>(
      path.join(runDirectory, "pilot-readiness-metrics.json")
    ),
    workflow: readJson<JsonRecord>(
      path.join(runDirectory, "workflow-validation.json")
    ),
    data_trace: readJson<JsonRecord>(
      path.join(runDirectory, "end-to-end-trace-validation.json")
    ),
    schema_alignment: readJson<JsonRecord>(
      path.join(
        runDirectory,
        "runtime-schema-alignment-validation.json"
      )
    ),
    teacher_review: readJson<JsonRecord>(
      path.join(runDirectory, "teacher-review-validation.json")
    ),
    research_export: readJson<JsonRecord>(
      path.join(runDirectory, "research-export-validation.json")
    ),
    failure_recovery: readJson<JsonRecord>(
      path.join(runDirectory, "failure-recovery-validation.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    )
  };
}
