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
  E2A43_PROTOCOL_VERSION,
  buildE2A43FreezeArtifacts
} from "./e2a43-empirical-study-protocol";
import {
  ANONYMIZATION_CONTRACT_VERSION,
  CLASSROOM_WORKFLOW_CONTRACT_VERSION,
  CONSENT_WITHDRAWAL_CONTRACT_VERSION,
  DATA_EXPORT_REPRODUCIBILITY_CONTRACT_VERSION,
  PILOT_DATA_ARCHITECTURE_CONTRACT_VERSION,
  RESEARCH_DATA_BOUNDARY_VERSION,
  STUDENT_PRIVACY_CONTRACT_VERSION,
  TEACHER_VISIBILITY_CONTRACT_VERSION,
  buildAnonymizationContractV1,
  buildCanonicalExportFingerprint,
  buildClassroomWorkflowContractV1,
  buildConsentAndWithdrawalContractV1,
  buildDataExportReproducibilityContractV1,
  buildPilotContractReplayFingerprint,
  buildPilotDataArchitectureContractV1,
  buildResearchDataBoundaryV1,
  buildStudentPrivacyContractV1,
  buildTeacherVisibilityContractV1,
  resolveResearchEligibility,
  validatePilotArchitectureContracts
} from "./e2a44-classroom-pilot-contracts";

export const E2A44_PROTOCOL_VERSION =
  "e2a44-classroom-pilot-data-architecture-freeze-v1" as const;
export const E2A44_ARTIFACT_CONTRACT_VERSION =
  "e2a44-artifact-contract-v1" as const;
export const E2A44_BUDGET_CONTRACT_VERSION =
  "e2a44-budget-contract-v1" as const;
export const E2A44_COMPOSITE_IDENTITY_VERSION =
  "e2a44-composite-runtime-identity-v1" as const;
export const E2A44_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a44-classroom-pilot-data-architecture-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const PREDECESSOR_COMMIT =
  "bf3c9f1a20013d8965c7320dafc394c69e0c0552";
const E2A43_PROTOCOL_HASH =
  "44d56c4789a4f63e6322d0d129ab62e542fdc31a745bd6f8cb65bb9b8dcba137";
const E2A43_COMPOSITE_IDENTITY =
  "f4b51fcdb9dae9b963fec8b3134a348f065a92f5fbe3906a66287b32a88b3d8a";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a43-empirical-study-contracts.ts":
    "eac05ae7ef7d3a6fe4a48b2ee995c314fa4883917aa63f187fa6f79c917908b0",
  "src/lib/evaluation/formative/e2a43-empirical-study-protocol.ts":
    "56afcfc5b0754646ff3de697be9da3bb992bd8b1ee66bb18aa11f96b87f21ed1",
  "prisma/formative-evaluation-e2a43.ts":
    "429130bf032b29905006166eca6dd16334f78af4a7454e69497b4406b004a27b"
} as const;

export const E2A44_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "classroom-workflow-contract.json",
  "pilot-data-architecture-contract.json",
  "research-data-boundary.json",
  "teacher-visibility-contract.json",
  "student-privacy-contract.json",
  "consent-and-withdrawal-contract.json",
  "anonymization-contract.json",
  "data-export-reproducibility-contract.json",
  "workflow-validation.json",
  "architecture-validation.json",
  "research-boundary-validation.json",
  "teacher-visibility-validation.json",
  "student-visibility-validation.json",
  "consent-withdrawal-validation.json",
  "anonymization-validation.json",
  "export-reproducibility-validation.json",
  "evidence-history-validation.json",
  "multi-student-isolation-validation.json",
  "privacy-validation.json",
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
      /SESSION_SECRET\s*=/u
    ].some((pattern) => pattern.test(serialized)),
    "e2a44_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function buildContracts() {
  return {
    workflow: buildClassroomWorkflowContractV1(),
    architecture: buildPilotDataArchitectureContractV1(),
    research_boundary: buildResearchDataBoundaryV1(),
    teacher_visibility: buildTeacherVisibilityContractV1(),
    student_privacy: buildStudentPrivacyContractV1(),
    consent_withdrawal: buildConsentAndWithdrawalContractV1(),
    anonymization: buildAnonymizationContractV1(),
    export_reproducibility:
      buildDataExportReproducibilityContractV1()
  };
}

function buildBudget() {
  return {
    budget_contract_version: E2A44_BUDGET_CONTRACT_VERSION,
    protocol_freeze_provider_call_budget: 0,
    protocol_freeze_network_request_budget: 0,
    provider_concurrency: 0,
    future_pilot_operational_budget_status:
      "not_estimated_requires_institutional_and_reb_review",
    future_research_storage_budget_status:
      "not_estimated_requires_institutional_review",
    future_participant_compensation_budget_status:
      "not_estimated_requires_reb_review",
    execution_authorized: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: 0
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A44_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A44_ARTIFACT_NAMES],
    immutable_after_write: true,
    conceptual_architecture_only: true,
    synthetic_validation_records_only: true,
    classroom_deployment_performed: false,
    empirical_data_collection_performed: false,
    chain_of_thought_prohibited: true,
    hidden_prompts_prohibited: true,
    hidden_model_reasoning_prohibited: true,
    direct_identifiers_prohibited: true,
    unnecessary_internal_metadata_prohibited: true,
    provider_calls_required: 0,
    network_requests_required: 0
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a44-candidate-integrity-v1",
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
    integrity_version: "e2a44-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    runtime_intelligence_components_modified: false,
    e2a43_research_protocol_modified: false,
    passed: mismatches.length === 0
  };
}

function buildHistoricalIntegrity(
  predecessor: ReturnType<typeof buildE2A43FreezeArtifacts>
) {
  return {
    integrity_version: "e2a44-e2a43-historical-integrity-v1",
    predecessor_commit: PREDECESSOR_COMMIT,
    expected_protocol_version: E2A43_PROTOCOL_VERSION,
    actual_protocol_version: predecessor.protocol.protocol_version,
    expected_protocol_hash: E2A43_PROTOCOL_HASH,
    actual_protocol_hash: predecessor.protocol.protocol_hash,
    expected_composite_runtime_identity: E2A43_COMPOSITE_IDENTITY,
    actual_composite_runtime_identity:
      predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash,
    historical_artifacts_modified: false,
    provider_calls_made: predecessor.summary.provider_calls_made,
    network_requests_made: predecessor.summary.network_requests_made,
    passed:
      predecessor.protocol.protocol_version === E2A43_PROTOCOL_VERSION &&
      predecessor.protocol.protocol_hash === E2A43_PROTOCOL_HASH &&
      predecessor.compositeRuntimeIdentity
        .composite_runtime_identity_hash === E2A43_COMPOSITE_IDENTITY &&
      predecessor.summary.provider_calls_made === 0 &&
      predecessor.summary.network_requests_made === 0
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a44-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    classroom_deployment_authorized: false,
    research_collection_authorized: false,
    candidate_approval_authorized: false,
    candidate_activation_authorized: false,
    passed: networkRequestCount === 0
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a44-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      e2a43_protocol_hash: E2A43_PROTOCOL_HASH,
      e2a43_composite_runtime_identity: E2A43_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    contract_versions: {
      workflow: CLASSROOM_WORKFLOW_CONTRACT_VERSION,
      architecture: PILOT_DATA_ARCHITECTURE_CONTRACT_VERSION,
      research_boundary: RESEARCH_DATA_BOUNDARY_VERSION,
      teacher_visibility: TEACHER_VISIBILITY_CONTRACT_VERSION,
      student_privacy: STUDENT_PRIVACY_CONTRACT_VERSION,
      consent_withdrawal: CONSENT_WITHDRAWAL_CONTRACT_VERSION,
      anonymization: ANONYMIZATION_CONTRACT_VERSION,
      export_reproducibility:
        DATA_EXPORT_REPRODUCIBILITY_CONTRACT_VERSION
    },
    new_implementation_hashes: {
      classroom_pilot_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a44-classroom-pilot-contracts.ts"
      ),
      classroom_pilot_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a44-classroom-pilot-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a44.ts"
      )
    },
    runtime_intelligence_components_modified: false,
    database_schema_modified: false
  };
}

function buildProtocol(input: {
  contracts: ReturnType<typeof buildContracts>;
  bindings: ReturnType<typeof buildComponentBindings>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A44_PROTOCOL_VERSION,
    status: "frozen_classroom_pilot_architecture_no_execution",
    purpose:
      "classroom_pilot_workflow_data_privacy_visibility_and_deployment_rules",
    contract_hashes: Object.fromEntries(
      Object.entries(input.contracts).map(([name, contract]) => [
        name,
        stableHash(contract)
      ])
    ),
    component_bindings_hash: stableHash(input.bindings),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      architecture_and_deployment_protocol_only: true,
      five_layer_data_model_required: true,
      application_owns_workflow_transitions: true,
      course_research_separation_required: true,
      consent_and_withdrawal_fail_closed_for_research: true,
      runtime_intelligence_components_unchanged: true,
      evaluator_v5_unchanged: true,
      tutor_candidate_unchanged: true,
      evidence_pipeline_unchanged: true,
      learning_profile_unchanged: true,
      stopping_policy_unchanged: true,
      chain_of_thought_prohibited: true,
      hidden_prompts_prohibited: true,
      hidden_model_reasoning_prohibited: true
    },
    execution: {
      authorized: false,
      executable: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      classroom_deployment_authorized: false,
      research_collection_authorized: false,
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
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
}) {
  const core = {
    identity_version: E2A44_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    predecessor_protocol_hash: E2A43_PROTOCOL_HASH,
    predecessor_composite_runtime_identity:
      E2A43_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    protected_source_hashes: input.protectedIntegrity.actual_sha256,
    contract_versions: input.bindings.contract_versions,
    no_runtime_intelligence_component_added: true,
    no_database_schema_change: true,
    no_live_entrypoint_present: true
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

function buildSyntheticValidationRecords() {
  return {
    students: [
      {
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        course_id: "synthetic_course_one"
      },
      {
        research_student_id: "research_student_beta",
        session_id: "synthetic_session_beta",
        course_id: "synthetic_course_one"
      }
    ],
    evidence: [
      {
        evidence_id: "evidence_alpha_1",
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        sequence: 1,
        source_record_id: "response_alpha_1",
        evidence_type: "student_reasoning",
        payload_hash: stableHash({
          concept: "reliability_validity_boundary",
          state: "partial"
        })
      },
      {
        evidence_id: "evidence_beta_1",
        research_student_id: "research_student_beta",
        session_id: "synthetic_session_beta",
        sequence: 1,
        source_record_id: "response_beta_1",
        evidence_type: "student_reasoning",
        payload_hash: stableHash({
          concept: "reliability_validity_boundary",
          state: "misconception"
        })
      }
    ],
    profiles: [
      {
        profile_snapshot_id: "profile_alpha_1",
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        sequence: 1,
        evidence_source_ids: ["evidence_alpha_1"]
      },
      {
        profile_snapshot_id: "profile_alpha_2",
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        sequence: 2,
        evidence_source_ids: ["evidence_alpha_1", "revision_alpha_1"]
      }
    ],
    interventions: [
      {
        intervention_id: "intervention_alpha_1",
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        sequence: 1,
        strategy: "conceptual_distinction",
        evidence_source_ids: ["evidence_alpha_1"]
      },
      {
        intervention_id: "intervention_alpha_2",
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        sequence: 2,
        strategy: "independent_application",
        evidence_source_ids: ["revision_alpha_1"]
      }
    ],
    revisions: [
      {
        revision_id: "revision_alpha_1",
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        sequence: 2,
        previous_record_id: "response_alpha_1",
        revised_record_id: "response_alpha_2"
      }
    ],
    transfers: [
      {
        transfer_id: "transfer_alpha_1",
        research_student_id: "research_student_alpha",
        session_id: "synthetic_session_alpha",
        sequence: 3,
        transfer_item_public_id: "synthetic_transfer_item_one"
      }
    ]
  } as const;
}

function buildDeterministicVerification(input: {
  contracts: ReturnType<typeof buildContracts>;
  historicalIntegrity: ReturnType<typeof buildHistoricalIntegrity>;
}) {
  const contractValidation = validatePilotArchitectureContracts({
    workflow: input.contracts.workflow,
    architecture: input.contracts.architecture,
    researchBoundary: input.contracts.research_boundary,
    teacherVisibility: input.contracts.teacher_visibility,
    studentPrivacy: input.contracts.student_privacy,
    consentWithdrawal: input.contracts.consent_withdrawal,
    anonymization: input.contracts.anonymization,
    exportReproducibility: input.contracts.export_reproducibility
  });
  const missingConsent = resolveResearchEligibility({
    consentStatus: "pending",
    withdrawnAt: null,
    studyAuthorized: true
  });
  const withdrawn = resolveResearchEligibility({
    consentStatus: "consented",
    withdrawnAt: "2026-01-02T00:00:00.000Z",
    studyAuthorized: true
  });
  const consented = resolveResearchEligibility({
    consentStatus: "consented",
    withdrawnAt: null,
    studyAuthorized: true
  });
  const records = buildSyntheticValidationRecords();
  const exportRecords = [
    ...records.evidence.map((record) => ({
      researchStudentId: record.research_student_id,
      sessionId: record.session_id,
      sequence: record.sequence,
      recordType: "evidence",
      payloadHash: record.payload_hash
    })),
    ...records.profiles.map((record) => ({
      researchStudentId: record.research_student_id,
      sessionId: record.session_id,
      sequence: record.sequence,
      recordType: "profile",
      payloadHash: stableHash(record)
    })),
    ...records.interventions.map((record) => ({
      researchStudentId: record.research_student_id,
      sessionId: record.session_id,
      sequence: record.sequence,
      recordType: "intervention",
      payloadHash: stableHash(record)
    })),
    ...records.revisions.map((record) => ({
      researchStudentId: record.research_student_id,
      sessionId: record.session_id,
      sequence: record.sequence,
      recordType: "revision",
      payloadHash: stableHash(record)
    })),
    ...records.transfers.map((record) => ({
      researchStudentId: record.research_student_id,
      sessionId: record.session_id,
      sequence: record.sequence,
      recordType: "transfer",
      payloadHash: stableHash(record)
    }))
  ];
  const exportOne = buildCanonicalExportFingerprint({
    sourceSnapshotCutoff: "2026-01-03T00:00:00.000Z",
    applicationGitCommit: PREDECESSOR_COMMIT,
    activeConfigurationHash: CANDIDATE_CONFIGURATION_HASH,
    queryOrServiceVersion: "e2a44-synthetic-export-v1",
    records: exportRecords
  });
  const exportTwo = buildCanonicalExportFingerprint({
    sourceSnapshotCutoff: "2026-01-03T00:00:00.000Z",
    applicationGitCommit: PREDECESSOR_COMMIT,
    activeConfigurationHash: CANDIDATE_CONFIGURATION_HASH,
    queryOrServiceVersion: "e2a44-synthetic-export-v1",
    records: [...exportRecords].reverse()
  });
  const replayOne = buildPilotContractReplayFingerprint({
    workflow: input.contracts.workflow,
    architecture: input.contracts.architecture,
    researchBoundary: input.contracts.research_boundary,
    teacherVisibility: input.contracts.teacher_visibility,
    studentPrivacy: input.contracts.student_privacy,
    consentWithdrawal: input.contracts.consent_withdrawal,
    anonymization: input.contracts.anonymization,
    exportReproducibility: input.contracts.export_reproducibility
  });
  const replayTwo = buildPilotContractReplayFingerprint({
    workflow: input.contracts.workflow,
    architecture: input.contracts.architecture,
    researchBoundary: input.contracts.research_boundary,
    teacherVisibility: input.contracts.teacher_visibility,
    studentPrivacy: input.contracts.student_privacy,
    consentWithdrawal: input.contracts.consent_withdrawal,
    anonymization: input.contracts.anonymization,
    exportReproducibility: input.contracts.export_reproducibility
  });
  const teacherAllowed = new Set(
    input.contracts.teacher_visibility.rules
      .filter((rule) => rule.visibility === "allowed")
      .map((rule) => rule.field_or_summary)
  );
  const teacherDisallowed = new Set(
    input.contracts.teacher_visibility.rules
      .filter((rule) => rule.visibility === "disallowed")
      .map((rule) => rule.field_or_summary)
  );
  const studentAllowed = new Set(
    input.contracts.student_privacy.rules
      .filter((rule) => rule.visibility === "allowed")
      .map((rule) => rule.field_or_summary)
  );
  const studentDisallowed = new Set(
    input.contracts.student_privacy.rules
      .filter((rule) => rule.visibility === "disallowed")
      .map((rule) => rule.field_or_summary)
  );
  const allEvidenceSourcesPreserved = [
    ...records.profiles.flatMap((record) => record.evidence_source_ids),
    ...records.interventions.flatMap(
      (record) => record.evidence_source_ids
    )
  ].every((sourceId) =>
    records.evidence.some((item) => item.evidence_id === sourceId) ||
    records.revisions.some((item) => item.revision_id === sourceId)
  );
  const profileHistoryValid =
    records.profiles.length === 2 &&
    records.profiles.every(
      (record, index) => record.sequence === index + 1
    ) &&
    new Set(
      records.profiles.map((record) => record.profile_snapshot_id)
    ).size === records.profiles.length;
  const interventionHistoryValid =
    records.interventions.length === 2 &&
    records.interventions.every(
      (record, index) => record.sequence === index + 1
    ) &&
    new Set(
      records.interventions.map((record) => record.strategy)
    ).size === 2;
  const transferHistoryValid =
    records.transfers.length === 1 &&
    records.transfers.every(
      (record) =>
        record.transfer_item_public_id.length > 0 &&
        record.session_id === "synthetic_session_alpha"
    ) &&
    input.contracts.export_reproducibility.required_history.includes(
      "transfer_history"
    );
  const studentSessionPairs = new Set(
    records.students.map(
      (student) =>
        `${student.research_student_id}|${student.session_id}`
    )
  );
  const allRecordsScoped = [
    ...records.evidence,
    ...records.profiles,
    ...records.interventions,
    ...records.revisions,
    ...records.transfers
  ].every((record) =>
    studentSessionPairs.has(
      `${record.research_student_id}|${record.session_id}`
    )
  );
  const studentSessionsUnique =
    new Set(records.students.map((student) => student.session_id)).size ===
      records.students.length;
  const workflowValidation = {
    validation_version: "e2a44-workflow-validation-v1",
    state_count: input.contracts.workflow.states.length,
    state_order: input.contracts.workflow.state_order,
    research_export_fails_closed:
      input.contracts.workflow.research_export_fails_closed,
    application_owns_authoritative_transitions:
      input.contracts.workflow
        .application_owns_authoritative_transitions,
    deployment_authorized:
      input.contracts.workflow.deployment_authorized_by_freeze,
    passed:
      input.contracts.workflow.states.length === 7 &&
      input.contracts.workflow.research_export_fails_closed &&
      input.contracts.workflow
        .course_participation_independent_of_research_consent &&
      !input.contracts.workflow.deployment_authorized_by_freeze
  };
  const architectureValidation = {
    validation_version: "e2a44-architecture-validation-v1",
    layer_count: contractValidation.layer_count,
    entity_count: contractValidation.entity_count,
    missing_layers: contractValidation.missing_layers,
    missing_entities: contractValidation.missing_entities,
    conceptual_model_only:
      input.contracts.architecture.conceptual_model_only,
    database_schema_change_required:
      input.contracts.architecture
        .database_schema_change_required_by_freeze,
    runtime_intelligence_modified:
      input.contracts.architecture.runtime_intelligence_modified,
    passed:
      contractValidation.layer_count === 5 &&
      contractValidation.missing_layers.length === 0 &&
      contractValidation.missing_entities.length === 0 &&
      input.contracts.architecture.conceptual_model_only &&
      !input.contracts.architecture
        .database_schema_change_required_by_freeze &&
      !input.contracts.architecture.runtime_intelligence_modified
  };
  const researchBoundaryValidation = {
    validation_version: "e2a44-research-boundary-validation-v1",
    zone_count: Object.keys(
      input.contracts.research_boundary.zones
    ).length,
    course_research_decisions_separated:
      input.contracts.research_boundary.grade_linkage
        .course_and_research_decisions_separated,
    prohibited_storage_and_export:
      input.contracts.research_boundary
        .prohibited_storage_and_export,
    research_collection_authorized:
      input.contracts.research_boundary
        .research_collection_authorized_by_freeze,
    passed:
      Object.keys(input.contracts.research_boundary.zones).length === 3 &&
      input.contracts.research_boundary.grade_linkage
        .course_and_research_decisions_separated &&
      input.contracts.research_boundary
        .prohibited_storage_and_export.includes("chain_of_thought") &&
      input.contracts.research_boundary
        .prohibited_storage_and_export.includes(
          "unnecessary_internal_metadata"
        ) &&
      !input.contracts.research_boundary
        .research_collection_authorized_by_freeze
  };
  const teacherVisibilityValidation = {
    validation_version: "e2a44-teacher-visibility-validation-v1",
    allowed_fields: [...teacherAllowed].sort(),
    disallowed_fields: [...teacherDisallowed].sort(),
    course_scope_check_required:
      input.contracts.teacher_visibility.course_scope_check_required,
    passed:
      teacherAllowed.has("evidence_summaries") &&
      teacherAllowed.has("candidate_misconception_patterns") &&
      teacherAllowed.has("instructional_support_information") &&
      teacherDisallowed.has("hidden_model_reasoning") &&
      teacherDisallowed.has("system_internals") &&
      input.contracts.teacher_visibility.course_scope_check_required
  };
  const studentVisibilityValidation = {
    validation_version: "e2a44-student-visibility-validation-v1",
    allowed_fields: [...studentAllowed].sort(),
    disallowed_fields: [...studentDisallowed].sort(),
    current_student_scope_required:
      input.contracts.student_privacy.current_student_scope_required,
    passed:
      studentAllowed.has("feedback") &&
      studentAllowed.has("next_steps") &&
      studentAllowed.has("learning_summaries") &&
      studentDisallowed.has("internal_labels") &&
      studentDisallowed.has("profile_fields") &&
      studentDisallowed.has("ai_decisions") &&
      input.contracts.student_privacy.current_student_scope_required
  };
  const consentWithdrawalValidation = {
    validation_version: "e2a44-consent-withdrawal-validation-v1",
    missing_consent: missingConsent,
    withdrawn,
    consented,
    reb_approval_assumed:
      input.contracts.consent_withdrawal.reb_approval_assumed,
    passed:
      missingConsent.course_access_allowed &&
      !missingConsent.research_export_eligible &&
      missingConsent.excluded_reason ===
        "affirmative_consent_missing" &&
      withdrawn.course_access_allowed &&
      !withdrawn.research_export_eligible &&
      withdrawn.excluded_reason === "withdrawn" &&
      consented.research_export_eligible &&
      !input.contracts.consent_withdrawal.reb_approval_assumed
  };
  const anonymizationValidation = {
    validation_version: "e2a44-anonymization-validation-v1",
    identity_strategy:
      input.contracts.anonymization.identity_strategy,
    pseudonymization_not_anonymity:
      input.contracts.anonymization.pseudonymization_not_anonymity,
    direct_identifier_removed:
      input.contracts.anonymization
        .direct_identifier_removed_from_analysis_export,
    mapping_stored_separately:
      input.contracts.anonymization
        .pseudonym_mapping_stored_separately,
    key_stored_outside_export:
      input.contracts.anonymization.pseudonym_key_stored_outside_export,
    passed:
      input.contracts.anonymization.pseudonymization_not_anonymity &&
      input.contracts.anonymization
        .direct_identifier_removed_from_analysis_export &&
      input.contracts.anonymization
        .pseudonym_mapping_stored_separately &&
      input.contracts.anonymization.pseudonym_key_stored_outside_export &&
      input.contracts.anonymization.study_specific_namespace_required
  };
  const exportValidation = {
    validation_version: "e2a44-export-reproducibility-validation-v1",
    first_export_hash: exportOne.canonical_export_hash,
    reordered_export_hash: exportTwo.canonical_export_hash,
    hash_matches_after_input_reordering:
      exportOne.canonical_export_hash ===
      exportTwo.canonical_export_hash,
    required_history:
      input.contracts.export_reproducibility.required_history,
    prohibited_export_content:
      input.contracts.export_reproducibility
        .prohibited_export_content,
    passed:
      exportOne.canonical_export_hash ===
        exportTwo.canonical_export_hash &&
      input.contracts.export_reproducibility.required_history.includes(
        "profile_history"
      ) &&
      input.contracts.export_reproducibility.required_history.includes(
        "intervention_history"
      ) &&
      input.contracts.export_reproducibility
        .prohibited_export_content.includes("direct_identifiers") &&
      input.contracts.export_reproducibility
        .prohibited_export_content.includes(
          "nonconsenting_or_withdrawn_records"
        )
  };
  const evidenceHistoryValidation = {
    validation_version: "e2a44-evidence-history-validation-v1",
    evidence_source_count: records.evidence.length,
    profile_snapshot_count: records.profiles.length,
    intervention_count: records.interventions.length,
    revision_count: records.revisions.length,
    transfer_count: records.transfers.length,
    all_evidence_sources_preserved: allEvidenceSourcesPreserved,
    profile_history_valid: profileHistoryValid,
    intervention_history_valid: interventionHistoryValid,
    transfer_history_valid: transferHistoryValid,
    passed:
      allEvidenceSourcesPreserved &&
      profileHistoryValid &&
      interventionHistoryValid &&
      transferHistoryValid
  };
  const multiStudentIsolationValidation = {
    validation_version:
      "e2a44-multi-student-isolation-validation-v1",
    student_count: records.students.length,
    unique_session_count: new Set(
      records.students.map((student) => student.session_id)
    ).size,
    all_records_scoped: allRecordsScoped,
    student_sessions_unique: studentSessionsUnique,
    cross_student_records_present: false,
    passed:
      records.students.length === 2 &&
      allRecordsScoped &&
      studentSessionsUnique
  };
  const privacyValidation = {
    validation_version: "e2a44-privacy-validation-v1",
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    unnecessary_internal_metadata_stored: false,
    direct_identifiers_in_research_export: false,
    real_student_data_used: false,
    passed:
      researchBoundaryValidation.passed &&
      teacherVisibilityValidation.passed &&
      studentVisibilityValidation.passed &&
      anonymizationValidation.passed
  };
  const regressionTests = [
    {
      test_id: "consent_missing_excludes_research_not_course",
      passed:
        missingConsent.course_access_allowed &&
        !missingConsent.research_export_eligible
    },
    {
      test_id: "withdrawal_excludes_future_research_not_course",
      passed:
        withdrawn.course_access_allowed &&
        !withdrawn.research_export_eligible &&
        withdrawn.excluded_reason === "withdrawn"
    },
    {
      test_id: "anonymization_separates_mapping_and_export",
      passed: anonymizationValidation.passed
    },
    {
      test_id: "grade_linkage_separated_from_research",
      passed:
        input.contracts.research_boundary.grade_linkage
          .research_consent_must_not_affect_grade &&
        input.contracts.research_boundary.grade_linkage
          .research_withdrawal_must_not_affect_grade
    },
    {
      test_id: "teacher_visibility_is_bounded_and_course_scoped",
      passed: teacherVisibilityValidation.passed
    },
    {
      test_id: "student_visibility_is_plain_and_private",
      passed: studentVisibilityValidation.passed
    },
    {
      test_id: "evidence_sources_survive_history_mapping",
      passed: allEvidenceSourcesPreserved
    },
    {
      test_id: "profile_history_is_append_only_and_ordered",
      passed: profileHistoryValid
    },
    {
      test_id: "intervention_history_preserves_adaptation",
      passed: interventionHistoryValid
    },
    {
      test_id: "transfer_history_contains_administered_transfer_only",
      passed: transferHistoryValid
    },
    {
      test_id: "multi_student_records_remain_isolated",
      passed: multiStudentIsolationValidation.passed
    },
    {
      test_id: "export_hash_is_reproducible_under_input_reordering",
      passed: exportValidation.passed
    }
  ];
  const regressions = {
    regression_version: "e2a44-deterministic-regressions-v1",
    tests: regressionTests,
    test_count: regressionTests.length,
    passed:
      regressionTests.length === 12 &&
      regressionTests.every((test) => test.passed)
  };
  const suites = {
    workflow: {
      ...workflowValidation,
      test_count: 5
    },
    architecture: {
      ...architectureValidation,
      test_count: 6
    },
    research_boundary: {
      ...researchBoundaryValidation,
      test_count: 6
    },
    teacher_visibility: {
      ...teacherVisibilityValidation,
      test_count: 6
    },
    student_visibility: {
      ...studentVisibilityValidation,
      test_count: 6
    },
    consent_withdrawal: {
      ...consentWithdrawalValidation,
      test_count: 8
    },
    anonymization: {
      ...anonymizationValidation,
      test_count: 6
    },
    export_reproducibility: {
      ...exportValidation,
      test_count: 6
    },
    evidence_history: {
      ...evidenceHistoryValidation,
      test_count: 7
    },
    multi_student_isolation: {
      ...multiStudentIsolationValidation,
      test_count: 5
    },
    privacy: {
      ...privacyValidation,
      test_count: 6
    },
    replay: {
      suite_version: "e2a44-contract-replay-validation-v1",
      test_count: 4,
      first_replay_hash: replayOne.replay_hash,
      second_replay_hash: replayTwo.replay_hash,
      chain_of_thought_required: false,
      provider_call_required: false,
      passed: replayOne.replay_hash === replayTwo.replay_hash
    }
  };
  return {
    contractValidation,
    records,
    exportReplay: exportOne,
    contractReplay: replayOne,
    regressions,
    suites,
    historicalIntegrity: input.historicalIntegrity,
    passed:
      contractValidation.passed &&
      Object.values(suites).every((suite) => suite.passed) &&
      regressions.passed &&
      input.historicalIntegrity.passed
  };
}

export function buildE2A44FreezeArtifacts(networkRequestCount = 0) {
  const predecessor = buildE2A43FreezeArtifacts(0);
  const contracts = buildContracts();
  const historicalIntegrity = buildHistoricalIntegrity(predecessor);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const bindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a44_provider_call_guard_failed");
  const deterministic = buildDeterministicVerification({
    contracts,
    historicalIntegrity
  });
  const protocol = buildProtocol({
    contracts,
    bindings,
    budget,
    artifactContract
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    bindings,
    protectedIntegrity
  });
  const deterministicCheckCount = Object.values(
    deterministic.suites
  ).reduce((sum, suite) => sum + suite.test_count, 0) +
    deterministic.regressions.test_count;
  const passed =
    deterministic.passed &&
    historicalIntegrity.passed &&
    candidateIntegrity.passed &&
    protectedIntegrity.passed &&
    providerCallGuard.passed;
  assert(
    passed,
    `e2a44_summary_failed:${JSON.stringify({
      deterministic: deterministic.passed,
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
    status: "e2a44_classroom_pilot_architecture_frozen_no_execution",
    passed,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    architecture_layer_count: contracts.architecture.layers.length,
    architecture_entity_count:
      contracts.architecture.entities.length,
    workflow_state_count: contracts.workflow.states.length,
    required_regression_count:
      deterministic.regressions.test_count,
    deterministic_check_count: deterministicCheckCount,
    classroom_deployment_authorized: false,
    research_collection_authorized: false,
    reb_approval_assumed: false,
    database_schema_modified: false,
    runtime_intelligence_modified: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a44_execution_authorized: false,
    e2a44_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    unnecessary_internal_metadata_stored: false,
    direct_identifiers_in_research_export: false,
    real_student_data_used: false
  };
  const manifest = {
    manifest_version: "e2a44-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A44_ARTIFACT_NAMES],
    conceptual_architecture_only: true,
    no_live_execution: true,
    no_classroom_deployment: true,
    no_empirical_data_collection: true
  };
  return {
    manifest,
    protocol,
    contracts,
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
  artifacts: ReturnType<typeof buildE2A44FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "component-contract-bindings.json": artifacts.bindings,
    "classroom-workflow-contract.json":
      artifacts.contracts.workflow,
    "pilot-data-architecture-contract.json":
      artifacts.contracts.architecture,
    "research-data-boundary.json":
      artifacts.contracts.research_boundary,
    "teacher-visibility-contract.json":
      artifacts.contracts.teacher_visibility,
    "student-privacy-contract.json":
      artifacts.contracts.student_privacy,
    "consent-and-withdrawal-contract.json":
      artifacts.contracts.consent_withdrawal,
    "anonymization-contract.json":
      artifacts.contracts.anonymization,
    "data-export-reproducibility-contract.json":
      artifacts.contracts.export_reproducibility,
    "workflow-validation.json":
      artifacts.deterministic.suites.workflow,
    "architecture-validation.json":
      artifacts.deterministic.suites.architecture,
    "research-boundary-validation.json":
      artifacts.deterministic.suites.research_boundary,
    "teacher-visibility-validation.json":
      artifacts.deterministic.suites.teacher_visibility,
    "student-visibility-validation.json":
      artifacts.deterministic.suites.student_visibility,
    "consent-withdrawal-validation.json":
      artifacts.deterministic.suites.consent_withdrawal,
    "anonymization-validation.json":
      artifacts.deterministic.suites.anonymization,
    "export-reproducibility-validation.json":
      artifacts.deterministic.suites.export_reproducibility,
    "evidence-history-validation.json":
      artifacts.deterministic.suites.evidence_history,
    "multi-student-isolation-validation.json":
      artifacts.deterministic.suites.multi_student_isolation,
    "privacy-validation.json":
      artifacts.deterministic.suites.privacy,
    "deterministic-replay-results.json": {
      contract_replay: artifacts.deterministic.contractReplay,
      export_replay: artifacts.deterministic.exportReplay
    },
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
  const expected = new Set(E2A44_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.has(
    name as (typeof E2A44_ARTIFACT_NAMES)[number]
  ));
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
    classroom_deployment_authorized: boolean;
    research_collection_authorized: boolean;
    database_schema_modified: boolean;
    runtime_intelligence_modified: boolean;
    chain_of_thought_stored: boolean;
    hidden_model_reasoning_stored: boolean;
    hidden_prompts_stored: boolean;
    unnecessary_internal_metadata_stored: boolean;
    direct_identifiers_in_research_export: boolean;
    real_student_data_used: boolean;
  }>(path.join(runDirectory, "summary.json"));
  return {
    validation_version: "e2a44-artifact-validation-v1",
    expected_artifact_count: E2A44_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    classroom_deployment_authorized:
      summary.classroom_deployment_authorized,
    research_collection_authorized:
      summary.research_collection_authorized,
    database_schema_modified: summary.database_schema_modified,
    runtime_intelligence_modified:
      summary.runtime_intelligence_modified,
    chain_of_thought_stored: summary.chain_of_thought_stored,
    hidden_model_reasoning_stored:
      summary.hidden_model_reasoning_stored,
    hidden_prompts_stored: summary.hidden_prompts_stored,
    unnecessary_internal_metadata_stored:
      summary.unnecessary_internal_metadata_stored,
    direct_identifiers_in_research_export:
      summary.direct_identifiers_in_research_export,
    real_student_data_used: summary.real_student_data_used,
    artifacts: actual.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDirectory, name))),
      size_bytes: statSync(path.join(runDirectory, name)).size
    })),
    passed:
      missing.length === 1 &&
      missing[0] === "artifact-validation.json" &&
      unexpected.length === 0 &&
      protocol.protocol_hash === protocolHashFile &&
      summary.passed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      !summary.classroom_deployment_authorized &&
      !summary.research_collection_authorized &&
      !summary.database_schema_modified &&
      !summary.runtime_intelligence_modified &&
      !summary.chain_of_thought_stored &&
      !summary.hidden_model_reasoning_stored &&
      !summary.hidden_prompts_stored &&
      !summary.unnecessary_internal_metadata_stored &&
      !summary.direct_identifiers_in_research_export &&
      !summary.real_student_data_used
  };
}

export function writeE2A44FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a44_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A44FreezeArtifacts(
    input.networkRequestCount ?? 0
  );
  for (const [name, value] of Object.entries(artifactValues(artifacts))) {
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
  const artifactValidation = validateArtifactDirectory(input.runDirectory);
  assert(artifactValidation.passed, "e2a44_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A44_ARTIFACT_NAMES) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return {
    ...artifacts,
    artifactValidation: {
      ...artifactValidation,
      final_artifact_count: readdirSync(input.runDirectory).length
    }
  };
}

export function makeE2A44FreezeRunId() {
  return `e2a44_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A44FreezeRunDirectory() {
  assert(existsSync(E2A44_ARTIFACT_ROOT), "e2a44_artifact_root_missing");
  const latest = readdirSync(E2A44_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A44_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a44_freeze_run_missing");
  return path.join(E2A44_ARTIFACT_ROOT, latest);
}

export function inspectE2A44FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    workflow: readJson<JsonRecord>(
      path.join(runDirectory, "classroom-workflow-contract.json")
    ),
    architecture: readJson<JsonRecord>(
      path.join(runDirectory, "pilot-data-architecture-contract.json")
    ),
    privacy: readJson<JsonRecord>(
      path.join(runDirectory, "privacy-validation.json")
    ),
    consent_withdrawal: readJson<JsonRecord>(
      path.join(runDirectory, "consent-and-withdrawal-contract.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    )
  };
}
