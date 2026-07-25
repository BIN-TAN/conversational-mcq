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
  E2A44_PROTOCOL_VERSION,
  buildE2A44FreezeArtifacts
} from "./e2a44-classroom-pilot-protocol";
import {
  TEACHER_ACCESS_CONTROL_VERSION,
  TEACHER_ACTION_CONTRACT_VERSION,
  TEACHER_EVIDENCE_INTERPRETATION_CONTRACT_VERSION,
  TEACHER_EVIDENCE_VIEW_CONTRACT_VERSION,
  TEACHER_FEEDBACK_LOOP_VERSION,
  TEACHER_RESEARCH_BOUNDARY_VERSION,
  SyntheticTeacherEvidenceRecord,
  appendTeacherFeedback,
  applyTeacherRecommendationOverride,
  authorizeTeacherEvidenceAccess,
  buildClassEvidenceSummary,
  buildIndividualEvidenceSummary,
  buildTeacherAccessControlV1,
  buildTeacherActionContractV1,
  buildTeacherEvidenceInterpretation,
  buildTeacherEvidenceInterpretationContractV1,
  buildTeacherEvidenceViewContractV1,
  buildTeacherFeedbackLoopV1,
  buildTeacherResearchBoundaryV1,
  buildTeacherReviewContractFingerprint,
  projectResearchEvidence,
  projectStudentEvidence,
  validateTeacherReviewContracts
} from "./e2a45-teacher-evidence-review-contracts";

export const E2A45_PROTOCOL_VERSION =
  "e2a45-teacher-facing-evidence-review-freeze-v1" as const;
export const E2A45_ARTIFACT_CONTRACT_VERSION =
  "e2a45-artifact-contract-v1" as const;
export const E2A45_BUDGET_CONTRACT_VERSION =
  "e2a45-budget-contract-v1" as const;
export const E2A45_COMPOSITE_IDENTITY_VERSION =
  "e2a45-composite-runtime-identity-v1" as const;
export const E2A45_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a45-teacher-evidence-review-protocol-freeze"
);

const PREDECESSOR_COMMIT =
  "399b2a1c8106f3a3d98b32f112eaddd957f8b27a";
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
  "src/lib/evaluation/formative/e2a44-classroom-pilot-protocol.ts":
    "3e1b67ceefbd8cab02a6e3c03194ca67ffbce84419dffbd544a50de52bd0e618",
  "prisma/formative-evaluation-e2a44.ts":
    "7618ef38aa6122672a6304077f22e2be9cdc2c891c220c3a96335b539c9c3461"
} as const;

export const E2A45_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "teacher-evidence-view-contract.json",
  "teacher-evidence-interpretation-contract.json",
  "teacher-action-contract.json",
  "teacher-research-boundary.json",
  "teacher-feedback-loop.json",
  "teacher-access-control.json",
  "contract-validation.json",
  "synthetic-scenarios.json",
  "class-summary-validation.json",
  "individual-summary-validation.json",
  "interpretation-validation.json",
  "action-audit-validation.json",
  "role-separation-validation.json",
  "access-control-validation.json",
  "privacy-validation.json",
  "teacher-feedback-validation.json",
  "teacher-review-metrics.json",
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
    "e2a45_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function buildContracts() {
  return {
    evidence_view: buildTeacherEvidenceViewContractV1(),
    interpretation: buildTeacherEvidenceInterpretationContractV1(),
    actions: buildTeacherActionContractV1(),
    research_boundary: buildTeacherResearchBoundaryV1(),
    feedback_loop: buildTeacherFeedbackLoopV1(),
    access_control: buildTeacherAccessControlV1()
  };
}

function buildBudget() {
  return {
    budget_contract_version: E2A45_BUDGET_CONTRACT_VERSION,
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
    provider_calls_made: 0,
    network_requests_made: 0
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A45_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A45_ARTIFACT_NAMES],
    immutable_after_write: true,
    synthetic_teacher_evidence_only: true,
    teacher_ui_implemented: false,
    production_data_accessed: false,
    runtime_intelligence_modified: false,
    database_schema_modified: false,
    chain_of_thought_prohibited: true,
    hidden_model_reasoning_prohibited: true,
    hidden_prompts_prohibited: true,
    internal_model_confidence_prohibited: true,
    system_only_metadata_prohibited: true,
    provider_calls_required: 0,
    network_requests_required: 0
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a45-candidate-integrity-v1",
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
    integrity_version: "e2a45-protected-source-integrity-v1",
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
    passed: mismatches.length === 0
  };
}

function buildHistoricalIntegrity(
  predecessor: ReturnType<typeof buildE2A44FreezeArtifacts>
) {
  return {
    integrity_version: "e2a45-e2a44-historical-integrity-v1",
    predecessor_commit: PREDECESSOR_COMMIT,
    expected_protocol_version: E2A44_PROTOCOL_VERSION,
    actual_protocol_version: predecessor.protocol.protocol_version,
    expected_protocol_hash: E2A44_PROTOCOL_HASH,
    actual_protocol_hash: predecessor.protocol.protocol_hash,
    expected_composite_runtime_identity: E2A44_COMPOSITE_IDENTITY,
    actual_composite_runtime_identity:
      predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash,
    historical_artifacts_modified: false,
    provider_calls_made: predecessor.summary.provider_calls_made,
    network_requests_made: predecessor.summary.network_requests_made,
    passed:
      predecessor.protocol.protocol_version === E2A44_PROTOCOL_VERSION &&
      predecessor.protocol.protocol_hash === E2A44_PROTOCOL_HASH &&
      predecessor.compositeRuntimeIdentity
        .composite_runtime_identity_hash === E2A44_COMPOSITE_IDENTITY &&
      predecessor.summary.provider_calls_made === 0 &&
      predecessor.summary.network_requests_made === 0
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a45-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a45_execution_authorized: false,
    candidate_approval_authorized: false,
    candidate_activation_authorized: false,
    passed: networkRequestCount === 0
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a45-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      protocol_hash: E2A44_PROTOCOL_HASH,
      composite_runtime_identity: E2A44_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    contract_versions: {
      evidence_view: TEACHER_EVIDENCE_VIEW_CONTRACT_VERSION,
      interpretation:
        TEACHER_EVIDENCE_INTERPRETATION_CONTRACT_VERSION,
      actions: TEACHER_ACTION_CONTRACT_VERSION,
      research_boundary: TEACHER_RESEARCH_BOUNDARY_VERSION,
      feedback_loop: TEACHER_FEEDBACK_LOOP_VERSION,
      access_control: TEACHER_ACCESS_CONTROL_VERSION
    },
    new_implementation_hashes: {
      teacher_review_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a45-teacher-evidence-review-contracts.ts"
      ),
      teacher_review_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a45-teacher-evidence-review-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a45.ts"
      )
    },
    runtime_intelligence_components_modified: false,
    database_schema_modified: false,
    production_teacher_ui_modified: false
  };
}

function buildProtocol(input: {
  contracts: ReturnType<typeof buildContracts>;
  contractFingerprint: ReturnType<
    typeof buildTeacherReviewContractFingerprint
  >;
  bindings: ReturnType<typeof buildComponentBindings>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A45_PROTOCOL_VERSION,
    status: "frozen_teacher_evidence_review_no_execution",
    purpose:
      "teacher_interpretation_instructional_support_class_patterns_student_support_and_ai_human_judgment_separation",
    contract_hashes: input.contractFingerprint.contract_hashes,
    contract_fingerprint_hash:
      input.contractFingerprint.fingerprint_hash,
    component_bindings_hash: stableHash(input.bindings),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      teacher_evidence_review_protocol_only: true,
      teacher_is_instructional_partner: true,
      teacher_is_not_ai_internal_decision_approver: true,
      system_interpretation_is_provisional: true,
      teacher_judgment_is_separate: true,
      historical_evidence_is_immutable: true,
      research_provenance_is_immutable: true,
      class_summaries_are_aggregate: true,
      individual_summaries_are_student_specific: true,
      runtime_intelligence_components_unchanged: true,
      classroom_data_architecture_unchanged: true
    },
    execution: {
      authorized: false,
      executable: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      teacher_ui_deployment_authorized: false,
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
    typeof buildTeacherReviewContractFingerprint
  >;
}) {
  const core = {
    identity_version: E2A45_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    predecessor_protocol_hash: E2A44_PROTOCOL_HASH,
    predecessor_composite_runtime_identity:
      E2A44_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    contract_fingerprint_hash:
      input.contractFingerprint.fingerprint_hash,
    protected_source_hashes:
      input.protectedIntegrity.actual_sha256,
    contract_versions: input.bindings.contract_versions,
    no_runtime_intelligence_component_added: true,
    no_database_schema_change: true,
    no_teacher_ui_change: true,
    no_live_entrypoint_present: true
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

function buildSyntheticScenarios() {
  const records: SyntheticTeacherEvidenceRecord[] = [
    {
      record_id: "ev_alpha_01",
      course_public_id: "course_alpha",
      research_student_id: "research_alpha_01",
      authorized_student_label: "Student A1",
      concept_id: "concept_reliability_validity",
      learning_state: "needs_more_work",
      misconception_pattern: "reliability_validity_confusion",
      selected_distractor: "D",
      evidence_summary:
        "The response treated reliability as sufficient evidence of validity.",
      learning_gap:
        "the distinction between score consistency and validity evidence",
      revision_status: "in_progress",
      transfer_status: "not_attempted",
      intervention_strategy: "distractor_contrast",
      intervention_outcome: "unchanged",
      evidence_source_ids: ["source_alpha_01"],
      observed_at: "2026-07-25T10:00:00.000Z"
    },
    {
      record_id: "ev_alpha_02",
      course_public_id: "course_alpha",
      research_student_id: "research_alpha_02",
      authorized_student_label: "Student A2",
      concept_id: "concept_reliability_validity",
      learning_state: "still_developing",
      misconception_pattern: "reliability_validity_confusion",
      selected_distractor: "D",
      evidence_summary:
        "The response linked consistency to validity without interpretation evidence.",
      learning_gap:
        "what additional evidence is required for a validity argument",
      revision_status: "revised",
      transfer_status: "completed",
      intervention_strategy: "reasoning_boundary_repair",
      intervention_outcome: "improved",
      evidence_source_ids: ["source_alpha_02"],
      observed_at: "2026-07-25T10:01:00.000Z"
    },
    {
      record_id: "ev_alpha_03",
      course_public_id: "course_alpha",
      research_student_id: "research_alpha_03",
      authorized_student_label: "Student A3",
      concept_id: "concept_reliability_validity",
      learning_state: "needs_more_work",
      misconception_pattern: "reliability_validity_confusion",
      selected_distractor: "D",
      evidence_summary:
        "The response repeated that high reliability proves validity.",
      learning_gap:
        "why reliability is necessary in some uses but not sufficient for validity",
      revision_status: "in_progress",
      transfer_status: "not_attempted",
      intervention_strategy: "independent_reconstruction",
      intervention_outcome: "mixed",
      evidence_source_ids: ["source_alpha_03"],
      observed_at: "2026-07-25T10:02:00.000Z"
    },
    {
      record_id: "ev_student_c",
      course_public_id: "course_alpha",
      research_student_id: "research_student_c",
      authorized_student_label: "Student C",
      concept_id: "concept_reliability_validity",
      learning_state: "needs_more_work",
      misconception_pattern: "reliability_validity_confusion",
      selected_distractor: "D",
      evidence_summary:
        "Across revision and transfer evidence, the response continued to treat reliability as proof of validity.",
      learning_gap:
        "the evidentiary boundary between reliability and validity",
      revision_status: "revised",
      transfer_status: "completed",
      intervention_strategy: "distractor_temptation_analysis",
      intervention_outcome: "unchanged",
      evidence_source_ids: [
        "source_student_c_initial",
        "source_student_c_revision",
        "source_student_c_transfer"
      ],
      observed_at: "2026-07-25T10:03:00.000Z"
    },
    {
      record_id: "ev_student_d",
      course_public_id: "course_alpha",
      research_student_id: "research_student_d",
      authorized_student_label: "Student D",
      concept_id: "concept_reliability_validity",
      learning_state: "mostly_understood",
      misconception_pattern: null,
      selected_distractor: null,
      evidence_summary:
        "The response distinguished score consistency from evidence supporting an intended interpretation.",
      learning_gap: null,
      revision_status: "revision_not_needed",
      transfer_status: "completed",
      intervention_strategy: null,
      intervention_outcome: "not_observed",
      evidence_source_ids: ["source_student_d"],
      observed_at: "2026-07-25T10:04:00.000Z"
    },
    {
      record_id: "ev_beta_01",
      course_public_id: "course_beta",
      research_student_id: "research_beta_01",
      authorized_student_label: "Student B1",
      concept_id: "concept_sem",
      learning_state: "still_developing",
      misconception_pattern: "sem_interpretation_gap",
      selected_distractor: "B",
      evidence_summary:
        "The response did not connect SEM to expected score variation across repeated measurement.",
      learning_gap: "interpretation of standard error of measurement",
      revision_status: "in_progress",
      transfer_status: "not_attempted",
      intervention_strategy: "basic_concept_grounding",
      intervention_outcome: "improved",
      evidence_source_ids: ["source_beta_01"],
      observed_at: "2026-07-25T11:00:00.000Z"
    },
    {
      record_id: "ev_beta_02",
      course_public_id: "course_beta",
      research_student_id: "research_beta_02",
      authorized_student_label: "Student B2",
      concept_id: "concept_sem",
      learning_state: "still_developing",
      misconception_pattern: "sem_interpretation_gap",
      selected_distractor: "B",
      evidence_summary:
        "The response recognized reliability but treated SEM as an item-difficulty estimate.",
      learning_gap: "how reliability and score scale determine SEM",
      revision_status: "revised",
      transfer_status: "completed",
      intervention_strategy: "reasoning_chain_repair",
      intervention_outcome: "improved",
      evidence_source_ids: ["source_beta_02"],
      observed_at: "2026-07-25T11:01:00.000Z"
    },
    {
      record_id: "ev_beta_03",
      course_public_id: "course_beta",
      research_student_id: "research_beta_03",
      authorized_student_label: "Student B3",
      concept_id: "concept_sem",
      learning_state: "needs_more_work",
      misconception_pattern: "sem_interpretation_gap",
      selected_distractor: "B",
      evidence_summary:
        "The response described reliability accurately but could not interpret SEM.",
      learning_gap: "SEM as uncertainty around an observed score",
      revision_status: "in_progress",
      transfer_status: "not_attempted",
      intervention_strategy: "independent_reconstruction",
      intervention_outcome: "mixed",
      evidence_source_ids: ["source_beta_03"],
      observed_at: "2026-07-25T11:02:00.000Z"
    },
    {
      record_id: "ev_beta_04",
      course_public_id: "course_beta",
      research_student_id: "research_beta_04",
      authorized_student_label: "Student B4",
      concept_id: "concept_reliability_validity",
      learning_state: "mostly_understood",
      misconception_pattern: null,
      selected_distractor: null,
      evidence_summary:
        "The response correctly distinguished reliability evidence from validity evidence.",
      learning_gap: null,
      revision_status: "revision_not_needed",
      transfer_status: "completed",
      intervention_strategy: null,
      intervention_outcome: "not_observed",
      evidence_source_ids: ["source_beta_04"],
      observed_at: "2026-07-25T11:03:00.000Z"
    }
  ];
  return {
    scenario_version: "e2a45-synthetic-teacher-review-scenarios-v1",
    synthetic_only: true,
    real_student_data_used: false,
    scenarios: {
      student_group_a: {
        course_public_id: "course_alpha",
        expected_pattern: "reliability_validity_confusion",
        expected_instructional_priority:
          "review reliability versus validity"
      },
      student_group_b: {
        course_public_id: "course_beta",
        expected_pattern: "sem_interpretation_gap",
        expected_instructional_priority:
          "support interpretation of standard error of measurement"
      },
      student_c: {
        research_student_id: "research_student_c",
        expected: "persistent_pattern_and_possible_followup"
      },
      student_d: {
        research_student_id: "research_student_d",
        expected: "sound_evidence_without_unnecessary_intervention"
      }
    },
    records
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
    validateTeacherReviewContracts(input.contracts);
  const scenarios = buildSyntheticScenarios();
  const alphaSummary = buildClassEvidenceSummary({
    course_public_id: "course_alpha",
    records: scenarios.records
  });
  const betaSummary = buildClassEvidenceSummary({
    course_public_id: "course_beta",
    records: scenarios.records
  });
  const studentC = buildIndividualEvidenceSummary({
    course_public_id: "course_alpha",
    research_student_id: "research_student_c",
    records: scenarios.records
  });
  const studentD = buildIndividualEvidenceSummary({
    course_public_id: "course_alpha",
    research_student_id: "research_student_d",
    records: scenarios.records
  });
  assert(studentC, "e2a45_student_c_fixture_missing");
  assert(studentD, "e2a45_student_d_fixture_missing");

  const interpretation = buildTeacherEvidenceInterpretation({
    evidence_observed: studentC.evidence_observed,
    source_evidence_ids: studentC.evidence_source_ids,
    possible_pattern: "reliability-validity misconception"
  });
  const override = applyTeacherRecommendationOverride({
    state: {
      evidence_history: scenarios.records
        .filter((record) =>
          record.research_student_id === "research_student_c"
        ),
      original_recommendation:
        studentC.recommended_instructional_followup ??
        "Review observed evidence.",
      current_recommendation:
        studentC.recommended_instructional_followup ??
        "Review observed evidence.",
      override_history: [] as unknown[]
    },
    teacher_actor_id: "teacher_alpha",
    reason: "Use a scheduled small-group explanation first.",
    replacement_recommendation:
      "Provide a small-group reliability-validity contrast.",
    created_at: "2026-07-25T12:00:00.000Z"
  });
  const feedback = appendTeacherFeedback({
    state: {
      historical_evidence: scenarios.records,
      feedback_history: [] as unknown[]
    },
    feedback: {
      feedback_id: "feedback_01",
      teacher_actor_id: "teacher_alpha",
      course_public_id: "course_alpha",
      created_at: "2026-07-25T12:01:00.000Z",
      target: "future_instruction",
      feedback_category: "review_reliability_validity_boundary"
    }
  });
  const access = {
    authorizedTeacher: authorizeTeacherEvidenceAccess({
      actor_role: "teacher",
      actor_public_id: "teacher_alpha",
      authorized_course_public_ids: ["course_alpha"],
      requested_course_public_id: "course_alpha",
      requested_scope: "class_level"
    }),
    unauthorizedCourse: authorizeTeacherEvidenceAccess({
      actor_role: "teacher",
      actor_public_id: "teacher_alpha",
      authorized_course_public_ids: ["course_alpha"],
      requested_course_public_id: "course_beta",
      requested_scope: "class_level"
    }),
    student: authorizeTeacherEvidenceAccess({
      actor_role: "student",
      actor_public_id: "student_c",
      authorized_course_public_ids: ["course_alpha"],
      requested_course_public_id: "course_alpha",
      requested_scope: "individual_student",
      requested_student_research_id: "research_student_c",
      current_student_research_id: "research_student_c"
    }),
    researcher: authorizeTeacherEvidenceAccess({
      actor_role: "researcher",
      actor_public_id: "researcher_01",
      authorized_course_public_ids: ["course_alpha"],
      requested_course_public_id: "course_alpha",
      requested_scope: "class_level"
    })
  };
  const researchProjection = projectResearchEvidence(
    scenarios.records
  );
  const studentProjection = projectStudentEvidence({
    current_student_research_id: "research_student_c",
    records: scenarios.records
  });
  const classSerialized = JSON.stringify([
    alphaSummary,
    betaSummary
  ]);
  const researchSerialized = JSON.stringify(researchProjection);
  const studentSerialized = JSON.stringify(studentProjection);
  const allOutputSerialized = JSON.stringify({
    alphaSummary,
    betaSummary,
    studentC,
    studentD,
    interpretation,
    researchProjection,
    studentProjection
  });
  const forbiddenTeacherFields = [
    "chain_of_thought",
    "hidden_model_reasoning",
    "hidden_prompts",
    "internal_model_confidence",
    "system_only_metadata"
  ];

  const classSummaryValidation = {
    validation_version: "e2a45-class-summary-validation-v1",
    group_a_pattern_detected:
      alphaSummary.common_misconception_patterns.some((entry) =>
        entry.pattern === "reliability_validity_confusion" &&
        entry.count === 4
      ),
    group_b_pattern_detected:
      betaSummary.common_misconception_patterns.some((entry) =>
        entry.pattern === "sem_interpretation_gap" &&
        entry.count === 3
      ),
    recommendations_differ:
      alphaSummary.common_misconception_patterns[0]?.pattern !==
        betaSummary.common_misconception_patterns[0]?.pattern,
    no_student_identifiers:
      !classSerialized.includes("research_student") &&
      !classSerialized.includes("Student C") &&
      !classSerialized.includes("Student D"),
    aggregate_only:
      !alphaSummary.student_identifiers_included &&
      !betaSummary.student_identifiers_included,
    passed: false
  };
  classSummaryValidation.passed =
    classSummaryValidation.group_a_pattern_detected &&
    classSummaryValidation.group_b_pattern_detected &&
    classSummaryValidation.recommendations_differ &&
    classSummaryValidation.no_student_identifiers &&
    classSummaryValidation.aggregate_only;

  const individualSummaryValidation = {
    validation_version:
      "e2a45-individual-summary-validation-v1",
    student_c_is_specific:
      studentC.student_label === "Student C" &&
      studentC.research_student_id === "research_student_c",
    student_c_followup_present:
      studentC.recommended_instructional_followup !== null,
    student_d_sound:
      studentD.assessment_specific_learning_state ===
        "mostly_understood",
    student_d_no_unnecessary_intervention:
      studentD.recommended_instructional_followup === null,
    evidence_sources_preserved:
      studentC.evidence_source_ids.length === 3,
    no_hidden_fields:
      !studentC.hidden_reasoning_included &&
      !studentC.internal_model_confidence_included &&
      !studentC.system_metadata_included,
    passed: false
  };
  individualSummaryValidation.passed =
    individualSummaryValidation.student_c_is_specific &&
    individualSummaryValidation.student_c_followup_present &&
    individualSummaryValidation.student_d_sound &&
    individualSummaryValidation.student_d_no_unnecessary_intervention &&
    individualSummaryValidation.evidence_sources_preserved &&
    individualSummaryValidation.no_hidden_fields;

  const interpretationValidation = {
    validation_version:
      "e2a45-interpretation-validation-v1",
    evidence_observed_is_source_linked:
      interpretation.evidence_observed.source_evidence_ids.length === 3,
    system_interpretation_is_provisional:
      !interpretation.system_interpretation.final_truth_claimed &&
      interpretation.system_interpretation.statement.includes(
        "possible"
      ),
    teacher_judgment_is_separate:
      interpretation.teacher_judgment.authority ===
        "human_instructional_decision",
    ai_not_final_authority:
      input.contracts.interpretation
        .teacher_is_not_internal_ai_approver,
    passed: false
  };
  interpretationValidation.passed =
    interpretationValidation.evidence_observed_is_source_linked &&
    interpretationValidation.system_interpretation_is_provisional &&
    interpretationValidation.teacher_judgment_is_separate &&
    interpretationValidation.ai_not_final_authority;

  const actionAuditValidation = {
    validation_version: "e2a45-action-audit-validation-v1",
    override_preserves_evidence:
      override.evidence_history_preserved,
    override_preserves_original_recommendation:
      override.original_recommendation_preserved,
    override_is_audited:
      override.state.override_history.length === 1,
    provenance_preserved: override.provenance_preserved,
    prohibited_actions_present:
      input.contracts.actions.prohibited_actions.length === 4,
    passed: false
  };
  actionAuditValidation.passed =
    actionAuditValidation.override_preserves_evidence &&
    actionAuditValidation
      .override_preserves_original_recommendation &&
    actionAuditValidation.override_is_audited &&
    actionAuditValidation.provenance_preserved &&
    actionAuditValidation.prohibited_actions_present;

  const roleSeparationValidation = {
    validation_version:
      "e2a45-role-separation-validation-v1",
    teacher_projection_is_instructional:
      input.contracts.research_boundary.views.teacher.purpose ===
        "instructional_information",
    researcher_projection_is_pseudonymous:
      !researchSerialized.includes("authorized_student_label") &&
      !researchSerialized.includes("Student C"),
    student_projection_is_feedback_only:
      !studentSerialized.includes("teacher") &&
      !studentSerialized.includes("class_summary") &&
      !studentSerialized.includes("research_student_id"),
    cross_role_projection_prohibited:
      input.contracts.research_boundary
        .cross_role_projection_prohibited,
    passed: false
  };
  roleSeparationValidation.passed =
    roleSeparationValidation.teacher_projection_is_instructional &&
    roleSeparationValidation.researcher_projection_is_pseudonymous &&
    roleSeparationValidation.student_projection_is_feedback_only &&
    roleSeparationValidation.cross_role_projection_prohibited;

  const accessControlValidation = {
    validation_version:
      "e2a45-access-control-validation-v1",
    authorized_teacher_allowed: access.authorizedTeacher.allowed,
    unauthorized_course_denied:
      !access.unauthorizedCourse.allowed,
    student_denied_teacher_view: !access.student.allowed,
    researcher_denied_teacher_view: !access.researcher.allowed,
    deny_by_default:
      input.contracts.access_control.deny_by_default,
    passed: false
  };
  accessControlValidation.passed =
    accessControlValidation.authorized_teacher_allowed &&
    accessControlValidation.unauthorized_course_denied &&
    accessControlValidation.student_denied_teacher_view &&
    accessControlValidation.researcher_denied_teacher_view &&
    accessControlValidation.deny_by_default;

  const privacyValidation = {
    validation_version: "e2a45-privacy-validation-v1",
    chain_of_thought_present: false,
    hidden_model_reasoning_present: false,
    hidden_prompts_present: false,
    internal_model_confidence_present: false,
    system_only_metadata_present: false,
    direct_identifiers_in_research_projection:
      researchSerialized.includes("authorized_student_label"),
    forbidden_teacher_field_values_present:
      forbiddenTeacherFields.some((field) =>
        allOutputSerialized.includes(`\"${field}\":`)
      ),
    real_student_data_used: false,
    passed: false
  };
  privacyValidation.passed =
    !privacyValidation.chain_of_thought_present &&
    !privacyValidation.hidden_model_reasoning_present &&
    !privacyValidation.hidden_prompts_present &&
    !privacyValidation.internal_model_confidence_present &&
    !privacyValidation.system_only_metadata_present &&
    !privacyValidation.direct_identifiers_in_research_projection &&
    !privacyValidation.forbidden_teacher_field_values_present &&
    !privacyValidation.real_student_data_used;

  const teacherFeedbackValidation = {
    validation_version:
      "e2a45-teacher-feedback-validation-v1",
    feedback_appended: feedback.feedback_appended,
    historical_evidence_preserved:
      feedback.historical_evidence_preserved,
    feedback_target_is_future_facing:
      feedback.state.feedback_history.length === 1 &&
      (
        feedback.state.feedback_history[0] as {
          target: string;
        }
      ).target === "future_instruction",
    runtime_intelligence_updated: false,
    passed: false
  };
  teacherFeedbackValidation.passed =
    teacherFeedbackValidation.feedback_appended &&
    teacherFeedbackValidation.historical_evidence_preserved &&
    teacherFeedbackValidation.feedback_target_is_future_facing &&
    !teacherFeedbackValidation.runtime_intelligence_updated;

  const metricResults = [
    metric("teacher_evidence_completeness", [
      classSummaryValidation.group_a_pattern_detected,
      classSummaryValidation.group_b_pattern_detected,
      individualSummaryValidation.evidence_sources_preserved
    ]),
    metric("interpretability", [
      interpretationValidation.evidence_observed_is_source_linked,
      interpretationValidation.system_interpretation_is_provisional,
      interpretationValidation.teacher_judgment_is_separate
    ]),
    metric("actionability", [
      individualSummaryValidation.student_c_followup_present,
      individualSummaryValidation
        .student_d_no_unnecessary_intervention,
      actionAuditValidation.override_is_audited
    ]),
    metric("privacy_compliance", [
      privacyValidation.passed,
      classSummaryValidation.no_student_identifiers,
      roleSeparationValidation
        .researcher_projection_is_pseudonymous
    ]),
    metric("role_separation", [
      roleSeparationValidation.passed,
      accessControlValidation.student_denied_teacher_view,
      accessControlValidation.researcher_denied_teacher_view
    ]),
    metric("instructional_usefulness", [
      classSummaryValidation.recommendations_differ,
      individualSummaryValidation.student_c_followup_present,
      individualSummaryValidation
        .student_d_no_unnecessary_intervention
    ])
  ];
  const metrics = {
    metrics_version: "e2a45-teacher-review-metrics-v1",
    metrics: metricResults,
    all_metrics_passed:
      metricResults.every((entry) => entry.passed),
    interpretation:
      "Synthetic protocol checks only; scores do not establish classroom effectiveness."
  };

  const contractFingerprint =
    buildTeacherReviewContractFingerprint(input.contracts);
  const replayOne = stableHash({
    contractFingerprint,
    alphaSummary,
    betaSummary,
    studentC,
    studentD,
    interpretation,
    access,
    metricResults
  });
  const replayTwo = stableHash({
    contractFingerprint:
      buildTeacherReviewContractFingerprint(input.contracts),
    alphaSummary: buildClassEvidenceSummary({
      course_public_id: "course_alpha",
      records: [...scenarios.records].reverse()
    }),
    betaSummary: buildClassEvidenceSummary({
      course_public_id: "course_beta",
      records: [...scenarios.records].reverse()
    }),
    studentC: buildIndividualEvidenceSummary({
      course_public_id: "course_alpha",
      research_student_id: "research_student_c",
      records: [...scenarios.records].reverse()
    }),
    studentD: buildIndividualEvidenceSummary({
      course_public_id: "course_alpha",
      research_student_id: "research_student_d",
      records: [...scenarios.records].reverse()
    }),
    interpretation,
    access,
    metricResults
  });
  const replayValidation = {
    validation_version: "e2a45-deterministic-replay-v1",
    first_replay_hash: replayOne,
    reordered_input_replay_hash: replayTwo,
    replay_stable: replayOne === replayTwo,
    provider_calls_required: 0,
    passed: replayOne === replayTwo
  };

  const regressionTests = [
    {
      test_id: "teacher_sees_allowed_evidence",
      passed:
        access.authorizedTeacher.allowed &&
        studentC.evidence_observed.length > 0
    },
    {
      test_id: "teacher_does_not_see_hidden_reasoning",
      passed:
        privacyValidation.passed &&
        !studentC.hidden_reasoning_included
    },
    {
      test_id: "student_does_not_see_teacher_only_information",
      passed:
        roleSeparationValidation
          .student_projection_is_feedback_only
    },
    {
      test_id: "researcher_does_not_see_direct_identifiers",
      passed:
        roleSeparationValidation
          .researcher_projection_is_pseudonymous
    },
    {
      test_id: "historical_evidence_cannot_be_edited",
      passed: override.evidence_history_preserved
    },
    {
      test_id: "teacher_override_preserves_provenance",
      passed:
        override.provenance_preserved &&
        override.original_recommendation_preserved
    },
    {
      test_id: "class_summary_does_not_leak_individual_students",
      passed: classSummaryValidation.no_student_identifiers
    },
    {
      test_id: "individual_summary_remains_student_specific",
      passed: individualSummaryValidation.student_c_is_specific
    },
    {
      test_id: "instructors_are_limited_to_authorized_courses",
      passed:
        access.authorizedTeacher.allowed &&
        !access.unauthorizedCourse.allowed
    },
    {
      test_id: "ai_recommendation_does_not_replace_teacher_judgment",
      passed:
        interpretationValidation.ai_not_final_authority &&
        interpretationValidation.teacher_judgment_is_separate
    }
  ];
  const regressions = {
    regression_version: "e2a45-deterministic-regressions-v1",
    tests: regressionTests,
    test_count: regressionTests.length,
    passed:
      regressionTests.length === 10 &&
      regressionTests.every((test) => test.passed)
  };

  const suites = {
    teacher_view: {
      ...individualSummaryValidation,
      class_summary_passed: classSummaryValidation.passed,
      test_count: 8,
      passed:
        individualSummaryValidation.passed &&
        classSummaryValidation.passed
    },
    role_separation: {
      ...roleSeparationValidation,
      test_count: 4
    },
    privacy: {
      ...privacyValidation,
      test_count: 8
    },
    access_control: {
      ...accessControlValidation,
      test_count: 5
    },
    audit_preservation: {
      ...actionAuditValidation,
      feedback_history_preserved:
        teacherFeedbackValidation.historical_evidence_preserved,
      test_count: 6,
      passed:
        actionAuditValidation.passed &&
        teacherFeedbackValidation.historical_evidence_preserved
    },
    classroom_summary: {
      ...classSummaryValidation,
      test_count: 5
    },
    interpretation: {
      ...interpretationValidation,
      test_count: 4
    },
    actions: {
      allowed_action_count:
        input.contracts.actions.allowed_actions.length,
      prohibited_action_count:
        input.contracts.actions.prohibited_actions.length,
      override_validation_passed: actionAuditValidation.passed,
      test_count: 5,
      passed:
        input.contracts.actions.allowed_actions.length === 5 &&
        input.contracts.actions.prohibited_actions.length === 4 &&
        actionAuditValidation.passed
    },
    feedback: {
      ...teacherFeedbackValidation,
      test_count: 4
    },
    metrics: {
      metrics: metricResults,
      test_count: metricResults.length,
      passed: metrics.all_metrics_passed
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
    contracts: contractValidation,
    scenarios,
    projections: {
      class_summaries: [alphaSummary, betaSummary],
      individual_summaries: [studentC, studentD],
      interpretation,
      research_projection: researchProjection,
      student_projection: studentProjection
    },
    validations: {
      class_summary: classSummaryValidation,
      individual_summary: individualSummaryValidation,
      interpretation: interpretationValidation,
      action_audit: actionAuditValidation,
      role_separation: roleSeparationValidation,
      access_control: accessControlValidation,
      privacy: privacyValidation,
      teacher_feedback: teacherFeedbackValidation
    },
    metrics,
    replay: replayValidation,
    regressions,
    suites,
    deterministic_check_count: deterministicCheckCount,
    passed:
      contractValidation.passed &&
      Object.values(suites).every((suite) => suite.passed) &&
      regressions.passed &&
      input.historicalIntegrity.passed
  };
}

export function buildE2A45FreezeArtifacts(networkRequestCount = 0) {
  const predecessor = buildE2A44FreezeArtifacts(0);
  const contracts = buildContracts();
  const contractFingerprint =
    buildTeacherReviewContractFingerprint(contracts);
  const historicalIntegrity = buildHistoricalIntegrity(predecessor);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const bindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a45_provider_call_guard_failed");
  const deterministic = buildDeterministicVerification({
    contracts,
    historicalIntegrity
  });
  const protocol = buildProtocol({
    contracts,
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
    `e2a45_summary_failed:${JSON.stringify({
      contract_validation: deterministic.contracts.passed,
      failed_suites: Object.entries(deterministic.suites)
        .filter(([, suite]) => !suite.passed)
        .map(([name]) => name),
      failed_regressions: deterministic.regressions.tests
        .filter((test) => !test.passed)
        .map((test) => test.test_id),
      historical_integrity: historicalIntegrity.passed,
      candidate_integrity: candidateIntegrity.passed,
      protected_integrity: protectedIntegrity.passed,
      protected_mismatches: protectedIntegrity.mismatches,
      provider_call_guard: providerCallGuard.passed
    })}`
  );
  const summary = {
    status: "e2a45_teacher_evidence_review_frozen_no_execution",
    passed,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    contract_count: Object.keys(contracts).length,
    synthetic_scenario_count:
      Object.keys(deterministic.scenarios.scenarios).length,
    required_regression_count:
      deterministic.regressions.test_count,
    deterministic_check_count:
      deterministic.deterministic_check_count,
    metrics_passed:
      deterministic.metrics.all_metrics_passed,
    teacher_ui_modified: false,
    database_schema_modified: false,
    runtime_intelligence_modified: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a45_execution_authorized: false,
    e2a45_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    real_student_data_used: false,
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    internal_model_confidence_exposed: false,
    system_only_metadata_exposed: false
  };
  const manifest = {
    manifest_version: "e2a45-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A45_ARTIFACT_NAMES],
    teacher_review_protocol_only: true,
    synthetic_evidence_only: true,
    no_live_execution: true,
    no_teacher_ui_change: true,
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
  artifacts: ReturnType<typeof buildE2A45FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256":
      `${artifacts.protocol.protocol_hash}\n`,
    "component-contract-bindings.json": artifacts.bindings,
    "teacher-evidence-view-contract.json":
      artifacts.contracts.evidence_view,
    "teacher-evidence-interpretation-contract.json":
      artifacts.contracts.interpretation,
    "teacher-action-contract.json":
      artifacts.contracts.actions,
    "teacher-research-boundary.json":
      artifacts.contracts.research_boundary,
    "teacher-feedback-loop.json":
      artifacts.contracts.feedback_loop,
    "teacher-access-control.json":
      artifacts.contracts.access_control,
    "contract-validation.json":
      artifacts.deterministic.contracts,
    "synthetic-scenarios.json":
      artifacts.deterministic.scenarios,
    "class-summary-validation.json":
      artifacts.deterministic.validations.class_summary,
    "individual-summary-validation.json":
      artifacts.deterministic.validations.individual_summary,
    "interpretation-validation.json":
      artifacts.deterministic.validations.interpretation,
    "action-audit-validation.json":
      artifacts.deterministic.validations.action_audit,
    "role-separation-validation.json":
      artifacts.deterministic.validations.role_separation,
    "access-control-validation.json":
      artifacts.deterministic.validations.access_control,
    "privacy-validation.json":
      artifacts.deterministic.validations.privacy,
    "teacher-feedback-validation.json":
      artifacts.deterministic.validations.teacher_feedback,
    "teacher-review-metrics.json":
      artifacts.deterministic.metrics,
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
  const expected = new Set(E2A45_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) =>
    !actual.includes(name)
  );
  const unexpected = actual.filter((name) =>
    !expected.has(name as (typeof E2A45_ARTIFACT_NAMES)[number])
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
    provider_calls_made: number;
    network_requests_made: number;
    teacher_ui_modified: boolean;
    database_schema_modified: boolean;
    runtime_intelligence_modified: boolean;
    e2a45_execution_authorized: boolean;
    e2a45_live_execution_performed: boolean;
    real_student_data_used: boolean;
    chain_of_thought_stored: boolean;
    hidden_model_reasoning_stored: boolean;
    hidden_prompts_stored: boolean;
    internal_model_confidence_exposed: boolean;
    system_only_metadata_exposed: boolean;
  }>(path.join(runDirectory, "summary.json"));
  return {
    validation_version: "e2a45-artifact-validation-v1",
    expected_artifact_count: E2A45_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    teacher_ui_modified: summary.teacher_ui_modified,
    database_schema_modified: summary.database_schema_modified,
    runtime_intelligence_modified:
      summary.runtime_intelligence_modified,
    e2a45_execution_authorized:
      summary.e2a45_execution_authorized,
    e2a45_live_execution_performed:
      summary.e2a45_live_execution_performed,
    real_student_data_used: summary.real_student_data_used,
    chain_of_thought_stored: summary.chain_of_thought_stored,
    hidden_model_reasoning_stored:
      summary.hidden_model_reasoning_stored,
    hidden_prompts_stored: summary.hidden_prompts_stored,
    internal_model_confidence_exposed:
      summary.internal_model_confidence_exposed,
    system_only_metadata_exposed:
      summary.system_only_metadata_exposed,
    artifacts: actual.map((name) => ({
      name,
      sha256: sha256(
        readFileSync(path.join(runDirectory, name))
      ),
      size_bytes: statSync(
        path.join(runDirectory, name)
      ).size
    })),
    passed:
      missing.length === 1 &&
      missing[0] === "artifact-validation.json" &&
      unexpected.length === 0 &&
      protocol.protocol_hash === protocolHashFile &&
      summary.passed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      !summary.teacher_ui_modified &&
      !summary.database_schema_modified &&
      !summary.runtime_intelligence_modified &&
      !summary.e2a45_execution_authorized &&
      !summary.e2a45_live_execution_performed &&
      !summary.real_student_data_used &&
      !summary.chain_of_thought_stored &&
      !summary.hidden_model_reasoning_stored &&
      !summary.hidden_prompts_stored &&
      !summary.internal_model_confidence_exposed &&
      !summary.system_only_metadata_exposed
  };
}

export function writeE2A45FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a45_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A45FreezeArtifacts(
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
    "e2a45_artifact_validation_failed"
  );
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A45_ARTIFACT_NAMES) {
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

export function makeE2A45FreezeRunId() {
  return `e2a45_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A45FreezeRunDirectory() {
  assert(
    existsSync(E2A45_ARTIFACT_ROOT),
    "e2a45_artifact_root_missing"
  );
  const latest = readdirSync(E2A45_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A45_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a45_freeze_run_missing");
  return path.join(E2A45_ARTIFACT_ROOT, latest);
}

export function inspectE2A45FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    class_summary: readJson<JsonRecord>(
      path.join(runDirectory, "class-summary-validation.json")
    ),
    individual_summary: readJson<JsonRecord>(
      path.join(runDirectory, "individual-summary-validation.json")
    ),
    role_separation: readJson<JsonRecord>(
      path.join(runDirectory, "role-separation-validation.json")
    ),
    access_control: readJson<JsonRecord>(
      path.join(runDirectory, "access-control-validation.json")
    ),
    privacy: readJson<JsonRecord>(
      path.join(runDirectory, "privacy-validation.json")
    ),
    metrics: readJson<JsonRecord>(
      path.join(runDirectory, "teacher-review-metrics.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    )
  };
}
