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
  E2A42_PROTOCOL_VERSION,
  buildE2A42FreezeArtifacts
} from "./e2a42-evaluation-framework-protocol";
import {
  ANALYSIS_FRAMEWORK_VERSION,
  CLASSROOM_PILOT_CONTRACT_VERSION,
  EMPIRICAL_STUDY_DESIGN_VERSION,
  EXPERT_RATING_FRAMEWORK_VERSION,
  RESEARCH_DATA_SCHEMA_VERSION,
  RESEARCH_ETHICS_BOUNDARY_VERSION,
  RESEARCH_PROTOCOL_CONTRACT_VERSION,
  RESEARCH_QUESTION_FRAMEWORK_VERSION,
  STUDY_COMPARISON_FRAMEWORK_VERSION,
  STUDY_LIMITATIONS_VERSION,
  buildAnalysisFrameworkV1,
  buildClassroomPilotContractV1,
  buildEmpiricalProtocolReplayFingerprint,
  buildEmpiricalStudyDesignV1,
  buildExpertRatingFrameworkV1,
  buildResearchDataSchemaV1,
  buildResearchEthicsBoundaryV1,
  buildResearchProtocolContractV1,
  buildResearchQuestionFrameworkV1,
  buildStudyComparisonFrameworkV1,
  buildStudyLimitationsV1,
  validateEmpiricalStudyContracts
} from "./e2a43-empirical-study-contracts";

export const E2A43_PROTOCOL_VERSION =
  "e2a43-cba-empirical-evaluation-study-freeze-v1" as const;
export const E2A43_ARTIFACT_CONTRACT_VERSION =
  "e2a43-artifact-contract-v1" as const;
export const E2A43_BUDGET_CONTRACT_VERSION =
  "e2a43-budget-contract-v1" as const;
export const E2A43_COMPOSITE_IDENTITY_VERSION =
  "e2a43-composite-runtime-identity-v1" as const;
export const E2A43_MEASUREMENT_INTEGRATION_VERSION =
  "e2a43-e2a42-measurement-integration-v1" as const;
export const E2A43_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a43-cba-empirical-evaluation-study-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const PREDECESSOR_COMMIT =
  "2557d385a51ca6581ea4ee8e09beb7f1c645d2ff";
const E2A42_PROTOCOL_HASH =
  "8e3e42352ba285620e6fd01903b2d4eb9b380c8b29cb77ec4d7fa60620d8b169";
const E2A42_COMPOSITE_IDENTITY =
  "3715fc851a07b69e80cffd4744da50478b61163505781d28b87bb28a53ab7bcc";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a42-evaluation-framework-contracts.ts":
    "8fd281001705cccd2e6003987ad20b874f378bac0d87e0996868a02c3c0b850d",
  "src/lib/evaluation/formative/e2a42-evaluation-framework-protocol.ts":
    "400f3da8e28eec6294a886fc557b5a349c6567edda5d74306801796fd14b86ed",
  "prisma/formative-evaluation-e2a42.ts":
    "3edac6193a3f5d8de17ab35570560bc585cf608867333b5489438f8d4dc33960"
} as const;

export const E2A43_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "research-protocol-contract.json",
  "research-question-framework.json",
  "empirical-study-design-contract.json",
  "expert-rating-framework.json",
  "classroom-pilot-contract.json",
  "study-comparison-framework.json",
  "measurement-framework-integration.json",
  "research-data-schema.json",
  "research-ethics-boundary.json",
  "analysis-framework.json",
  "study-limitations.json",
  "protocol-validation.json",
  "research-question-validation.json",
  "study-design-validation.json",
  "expert-evaluation-validation.json",
  "classroom-pilot-validation.json",
  "comparison-validation.json",
  "measurement-integration-validation.json",
  "research-schema-validation.json",
  "ethics-validation.json",
  "analysis-validation.json",
  "privacy-validation.json",
  "limitations-validation.json",
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
    "e2a43_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function buildContracts() {
  return {
    research_protocol: buildResearchProtocolContractV1(),
    research_questions: buildResearchQuestionFrameworkV1(),
    study_design: buildEmpiricalStudyDesignV1(),
    expert_rating: buildExpertRatingFrameworkV1(),
    classroom_pilot: buildClassroomPilotContractV1(),
    comparison: buildStudyComparisonFrameworkV1(),
    research_data_schema: buildResearchDataSchemaV1(),
    research_ethics: buildResearchEthicsBoundaryV1(),
    analysis: buildAnalysisFrameworkV1(),
    limitations: buildStudyLimitationsV1()
  };
}

function buildMeasurementFrameworkIntegration(
  predecessor: ReturnType<typeof buildE2A42FreezeArtifacts>
) {
  return {
    integration_version: E2A43_MEASUREMENT_INTEGRATION_VERSION,
    predecessor: {
      protocol_version: predecessor.protocol.protocol_version,
      protocol_hash: predecessor.protocol.protocol_hash,
      composite_runtime_identity_hash:
        predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash
    },
    dimensions: {
      diagnostic: [
        "misconception_identification",
        "knowledge_gap_identification",
        "false_sound",
        "missed_misconception"
      ],
      learning: [
        "profile_improvement",
        "revision_quality",
        "transfer_performance"
      ],
      process: [
        "response_revision",
        "confidence_change",
        "help_seeking",
        "interaction_trajectory"
      ],
      experience: [
        "usability",
        "perceived_usefulness",
        "cognitive_burden"
      ],
      instructor_utility: [
        "evidence_usefulness",
        "instructional_planning_support"
      ]
    },
    e2a42_contract_versions: Object.fromEntries(
      Object.entries(predecessor.contracts).map(([name, contract]) => [
        name,
        "framework_version" in contract
          ? contract.framework_version
          : "contract_version" in contract
            ? contract.contract_version
            : stableHash(contract)
      ])
    ),
    metrics_are_measurement_definitions_not_empirical_results: true,
    e2a42_framework_modified: false
  } as const;
}

function buildBudget() {
  return {
    budget_contract_version: E2A43_BUDGET_CONTRACT_VERSION,
    protocol_freeze_provider_call_budget: 0,
    protocol_freeze_network_request_budget: 0,
    provider_concurrency: 0,
    future_empirical_study_budget_status:
      "not_estimated_requires_reb_and_institutional_review",
    participant_compensation_budget_status:
      "not_estimated_requires_reb_and_institutional_review",
    research_data_storage_budget_status:
      "not_estimated_requires_institutional_review",
    execution_authorized: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: 0
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A43_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A43_ARTIFACT_NAMES],
    immutable_after_write: true,
    protocol_planning_records_only: true,
    empirical_participant_data_present: false,
    empirical_results_present: false,
    effect_sizes_present: false,
    chain_of_thought_prohibited: true,
    hidden_prompts_prohibited: true,
    hidden_model_reasoning_prohibited: true,
    direct_identifiers_prohibited: true,
    raw_private_data_prohibited: true,
    provider_calls_required: 0,
    network_requests_required: 0
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a43-candidate-integrity-v1",
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
    integrity_version: "e2a43-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    protected_components_modified: false,
    passed: mismatches.length === 0
  };
}

function buildHistoricalIntegrity(
  predecessor: ReturnType<typeof buildE2A42FreezeArtifacts>
) {
  return {
    integrity_version: "e2a43-e2a42-historical-integrity-v1",
    predecessor_commit: PREDECESSOR_COMMIT,
    expected_protocol_version: E2A42_PROTOCOL_VERSION,
    actual_protocol_version: predecessor.protocol.protocol_version,
    expected_protocol_hash: E2A42_PROTOCOL_HASH,
    actual_protocol_hash: predecessor.protocol.protocol_hash,
    expected_composite_runtime_identity: E2A42_COMPOSITE_IDENTITY,
    actual_composite_runtime_identity:
      predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash,
    e2a42_framework_modified: false,
    historical_artifacts_modified: false,
    provider_calls_made: predecessor.summary.provider_calls_made,
    network_requests_made: predecessor.summary.network_requests_made,
    passed:
      predecessor.protocol.protocol_version === E2A42_PROTOCOL_VERSION &&
      predecessor.protocol.protocol_hash === E2A42_PROTOCOL_HASH &&
      predecessor.compositeRuntimeIdentity
        .composite_runtime_identity_hash === E2A42_COMPOSITE_IDENTITY &&
      predecessor.summary.provider_calls_made === 0 &&
      predecessor.summary.network_requests_made === 0
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a43-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    empirical_study_execution_authorized: false,
    participant_recruitment_authorized: false,
    data_collection_authorized: false,
    passed: networkRequestCount === 0
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a43-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      e2a42_protocol_hash: E2A42_PROTOCOL_HASH,
      e2a42_composite_runtime_identity: E2A42_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    empirical_contract_versions: {
      research_protocol: RESEARCH_PROTOCOL_CONTRACT_VERSION,
      research_questions: RESEARCH_QUESTION_FRAMEWORK_VERSION,
      study_design: EMPIRICAL_STUDY_DESIGN_VERSION,
      expert_rating: EXPERT_RATING_FRAMEWORK_VERSION,
      classroom_pilot: CLASSROOM_PILOT_CONTRACT_VERSION,
      comparison: STUDY_COMPARISON_FRAMEWORK_VERSION,
      measurement_integration: E2A43_MEASUREMENT_INTEGRATION_VERSION,
      research_data_schema: RESEARCH_DATA_SCHEMA_VERSION,
      research_ethics: RESEARCH_ETHICS_BOUNDARY_VERSION,
      analysis: ANALYSIS_FRAMEWORK_VERSION,
      limitations: STUDY_LIMITATIONS_VERSION
    },
    new_implementation_hashes: {
      empirical_study_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a43-empirical-study-contracts.ts"
      ),
      empirical_study_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a43-empirical-study-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a43.ts"
      )
    },
    protected_components_modified: false
  };
}

function buildProtocol(input: {
  contracts: ReturnType<typeof buildContracts>;
  measurementIntegration: ReturnType<
    typeof buildMeasurementFrameworkIntegration
  >;
  bindings: ReturnType<typeof buildComponentBindings>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A43_PROTOCOL_VERSION,
    status: "frozen_research_protocol_no_execution",
    purpose:
      "dissertation_level_empirical_evaluation_protocol_for_cba",
    contract_hashes: Object.fromEntries([
      ...Object.entries(input.contracts),
      ["measurement_integration", input.measurementIntegration]
    ].map(([name, contract]) => [name, stableHash(contract)])),
    component_bindings_hash: stableHash(input.bindings),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      research_study_protocol_only: true,
      e2a42_framework_integrated_unchanged: true,
      evaluator_v5_unchanged: true,
      tutor_candidate_unchanged: true,
      runtime_architecture_unchanged: true,
      evidence_pipeline_unchanged: true,
      learning_profile_unchanged: true,
      stopping_policy_unchanged: true,
      auditability_contracts_unchanged: true,
      observable_structured_evidence_only: true,
      chain_of_thought_prohibited: true,
      hidden_model_reasoning_prohibited: true
    },
    execution: {
      authorized: false,
      executable: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      reb_approval_assumed: false,
      recruitment_authorized: false,
      data_collection_authorized: false,
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
    identity_version: E2A43_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    predecessor_protocol_hash: E2A42_PROTOCOL_HASH,
    predecessor_composite_runtime_identity:
      E2A42_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    protected_source_hashes: input.protectedIntegrity.actual_sha256,
    empirical_contract_versions:
      input.bindings.empirical_contract_versions,
    no_runtime_component_added: true,
    no_live_entrypoint_present: true
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

function buildDeterministicVerification(input: {
  contracts: ReturnType<typeof buildContracts>;
  measurementIntegration: ReturnType<
    typeof buildMeasurementFrameworkIntegration
  >;
  historicalIntegrity: ReturnType<typeof buildHistoricalIntegrity>;
}) {
  const validation = validateEmpiricalStudyContracts({
    researchQuestions: input.contracts.research_questions,
    studyDesign: input.contracts.study_design,
    expertRating: input.contracts.expert_rating,
    classroomPilot: input.contracts.classroom_pilot,
    comparison: input.contracts.comparison,
    dataSchema: input.contracts.research_data_schema,
    ethics: input.contracts.research_ethics,
    analysis: input.contracts.analysis,
    limitations: input.contracts.limitations
  });
  const replayOne = buildEmpiricalProtocolReplayFingerprint({
    researchQuestions: input.contracts.research_questions,
    studyDesign: input.contracts.study_design,
    comparison: input.contracts.comparison,
    dataSchema: input.contracts.research_data_schema,
    ethics: input.contracts.research_ethics,
    analysis: input.contracts.analysis
  });
  const replayTwo = buildEmpiricalProtocolReplayFingerprint({
    researchQuestions: input.contracts.research_questions,
    studyDesign: input.contracts.study_design,
    comparison: input.contracts.comparison,
    dataSchema: input.contracts.research_data_schema,
    ethics: input.contracts.research_ethics,
    analysis: input.contracts.analysis
  });
  const researchQuestionValidation = {
    validation_version: "e2a43-research-question-validation-v1",
    research_question_count:
      input.contracts.research_questions.questions.length,
    research_question_ids:
      input.contracts.research_questions.questions.map(
        (question) => question.research_question_id
      ),
    all_questions_have_claim_boundaries:
      input.contracts.research_questions.questions.every(
        (question) => question.claim_boundary.length > 0
      ),
    analysis_covers_all_questions:
      validation.analysis_rq_coverage.join("|") ===
        "RQ1|RQ2|RQ3|RQ4|RQ5",
    passed:
      input.contracts.research_questions.questions.length === 5 &&
      validation.analysis_rq_coverage.join("|") ===
        "RQ1|RQ2|RQ3|RQ4|RQ5"
  };
  const studyDesignValidation = {
    validation_version: "e2a43-study-design-validation-v1",
    phase_count: input.contracts.study_design.phases.length,
    phase_order: input.contracts.study_design.phases.map(
      (phase) => phase.phase_id
    ),
    system_validation_prohibits_learning_claims:
      input.contracts.study_design.phases[0]?.prohibited_claims
        .includes("student_learning_effectiveness") ?? false,
    human_phases_require_reb: input.contracts.study_design.phases
      .slice(1)
      .every((phase) => phase.reb_approval_required_before_execution),
    all_phases_unauthorized:
      input.contracts.study_design.phases.every(
        (phase) => !phase.execution_authorized_in_this_freeze
      ),
    passed:
      input.contracts.study_design.phases.length === 3 &&
      input.contracts.study_design.phases
        .map((phase) => phase.phase_number)
        .join("|") === "1|2|3" &&
      input.contracts.study_design.phases
        .slice(1)
        .every((phase) => phase.reb_approval_required_before_execution) &&
      input.contracts.study_design.phases.every(
        (phase) => !phase.execution_authorized_in_this_freeze
      )
  };
  const expertValidation = {
    validation_version: "e2a43-expert-evaluation-validation-v1",
    rating_dimension_count:
      input.contracts.expert_rating.rating_dimensions.length,
    agreement_method_conditionally_selected:
      !input.contracts.expert_rating.agreement_measure
        .statistic_preselected_without_data,
    results_present: input.contracts.expert_rating.results_claimed,
    passed:
      input.contracts.expert_rating.rating_dimensions.includes(
        "diagnostic_usefulness"
      ) &&
      input.contracts.expert_rating.rating_dimensions.includes(
        "feedback_usefulness"
      ) &&
      input.contracts.expert_rating.rating_dimensions.includes(
        "instructional_value"
      ) &&
      !input.contracts.expert_rating.results_claimed
  };
  const classroomPilotValidation = {
    validation_version: "e2a43-classroom-pilot-validation-v1",
    context_confirmed: input.contracts.classroom_pilot.context_is_confirmed,
    evidence_types:
      input.contracts.classroom_pilot.collected_evidence,
    unnecessary_private_information_collected:
      input.contracts.classroom_pilot
        .unnecessary_private_information_collected,
    implementation_authorized:
      input.contracts.classroom_pilot.implementation_authorized,
    passed:
      !input.contracts.classroom_pilot.context_is_confirmed &&
      input.contracts.classroom_pilot.collected_evidence.includes(
        "selected_responses"
      ) &&
      input.contracts.classroom_pilot.collected_evidence.includes(
        "student_authored_reasoning"
      ) &&
      input.contracts.classroom_pilot.collected_evidence.includes(
        "process_data"
      ) &&
      !input.contracts.classroom_pilot
        .unnecessary_private_information_collected &&
      !input.contracts.classroom_pilot.implementation_authorized
  };
  const comparisonValidation = {
    validation_version: "e2a43-comparison-validation-v1",
    condition_count: input.contracts.comparison.conditions.length,
    condition_ids: input.contracts.comparison.conditions.map(
      (condition) => condition.condition_id
    ),
    expected_outcomes_fabricated:
      input.contracts.comparison.expected_outcomes_fabricated,
    superiority_assumed:
      input.contracts.comparison.superiority_assumed,
    passed:
      input.contracts.comparison.conditions.length === 3 &&
      !input.contracts.comparison.expected_outcomes_fabricated &&
      !input.contracts.comparison.effect_sizes_fabricated &&
      !input.contracts.comparison.superiority_assumed
  };
  const measurementValidation = {
    validation_version: "e2a43-measurement-integration-validation-v1",
    expected_predecessor_protocol_hash: E2A42_PROTOCOL_HASH,
    actual_predecessor_protocol_hash:
      input.measurementIntegration.predecessor.protocol_hash,
    dimension_count: Object.keys(
      input.measurementIntegration.dimensions
    ).length,
    e2a42_framework_modified:
      input.measurementIntegration.e2a42_framework_modified,
    passed:
      input.measurementIntegration.predecessor.protocol_hash ===
        E2A42_PROTOCOL_HASH &&
      Object.keys(input.measurementIntegration.dimensions).length === 5 &&
      input.measurementIntegration.dimensions.diagnostic.includes(
        "false_sound"
      ) &&
      input.measurementIntegration.dimensions.learning.includes(
        "transfer_performance"
      ) &&
      input.measurementIntegration.dimensions.process.includes(
        "interaction_trajectory"
      ) &&
      !input.measurementIntegration.e2a42_framework_modified
  };
  const researchSchemaValidation = {
    validation_version: "e2a43-research-schema-validation-v1",
    variable_count: validation.research_variable_count,
    levels: input.contracts.research_data_schema.levels,
    missing_required_variables: validation.missing_required_variables,
    direct_identifier_count: validation.direct_identifier_count,
    passed:
      validation.research_variable_count === 15 &&
      validation.missing_required_variables.length === 0 &&
      validation.direct_identifier_count === 0 &&
      input.contracts.research_data_schema.levels.join("|") ===
        "student|item|interaction"
  };
  const ethicsValidation = {
    validation_version: "e2a43-ethics-validation-v1",
    requirements:
      input.contracts.research_ethics.requirements,
    reb_status: input.contracts.research_ethics.reb_status,
    approval_assumed:
      input.contracts.research_ethics.approval_assumed,
    recruitment_authorized:
      input.contracts.research_ethics.recruitment_authorized,
    data_collection_authorized:
      input.contracts.research_ethics.data_collection_authorized,
    passed:
      Object.values(
        input.contracts.research_ethics.requirements
      ).every(Boolean) &&
      !input.contracts.research_ethics.approval_assumed &&
      !input.contracts.research_ethics.recruitment_authorized &&
      !input.contracts.research_ethics.data_collection_authorized
  };
  const analysisValidation = {
    validation_version: "e2a43-analysis-validation-v1",
    analysis_family_count: new Set(
      input.contracts.analysis.analyses.map(
        (analysis) => analysis.family
      )
    ).size,
    all_methods_conditional:
      input.contracts.analysis.analyses.every(
        (analysis) =>
          !analysis.method_selected_before_data_review &&
          analysis.requires_sample_and_assumption_review
      ),
    results_present:
      input.contracts.analysis.inferential_results_present,
    passed:
      new Set(
        input.contracts.analysis.analyses.map(
          (analysis) => analysis.family
        )
      ).size === 4 &&
      input.contracts.analysis.analyses.every(
        (analysis) =>
          !analysis.method_selected_before_data_review &&
          analysis.requires_sample_and_assumption_review &&
          analysis.no_result_claimed
      ) &&
      !input.contracts.analysis.inferential_results_present
  };
  const privacyValidation = {
    validation_version: "e2a43-privacy-validation-v1",
    prohibited_storage_entries:
      validation.prohibited_storage_entries,
    prohibited_fields:
      input.contracts.research_data_schema.prohibited_fields,
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    direct_identifiers_exported:
      input.contracts.research_data_schema.direct_identifiers_exported,
    passed:
      validation.prohibited_storage_entries.length === 0 &&
      input.contracts.research_data_schema.prohibited_fields.includes(
        "chain_of_thought"
      ) &&
      input.contracts.research_data_schema.prohibited_fields.includes(
        "hidden_model_reasoning"
      ) &&
      !input.contracts.research_data_schema.direct_identifiers_exported
  };
  const limitationsValidation = {
    validation_version: "e2a43-limitations-validation-v1",
    limitation_codes:
      input.contracts.limitations.limitations.map(
        (limitation) => limitation.code
      ),
    acknowledged_before_execution:
      input.contracts.limitations
        .limitations_acknowledged_before_execution,
    passed:
      input.contracts.limitations.limitations.length === 5 &&
      input.contracts.limitations
        .limitations_acknowledged_before_execution
  };
  const regressionTests = [
    {
      test_id: "rq1_through_rq5_complete_and_aligned",
      passed: researchQuestionValidation.passed
    },
    {
      test_id: "three_phases_ordered_and_unauthorized",
      passed: studyDesignValidation.passed
    },
    {
      test_id: "phase_one_makes_no_learning_effectiveness_claim",
      passed:
        studyDesignValidation.system_validation_prohibits_learning_claims
    },
    {
      test_id: "expert_framework_has_no_fabricated_agreement_result",
      passed: expertValidation.passed
    },
    {
      test_id: "classroom_pilot_is_private_and_not_authorized",
      passed: classroomPilotValidation.passed
    },
    {
      test_id: "comparison_has_no_fabricated_expected_outcomes",
      passed: comparisonValidation.passed
    },
    {
      test_id: "e2a42_measurement_framework_integrated_unchanged",
      passed: measurementValidation.passed
    },
    {
      test_id: "research_schema_has_three_levels_and_required_variables",
      passed: researchSchemaValidation.passed
    },
    {
      test_id: "research_schema_excludes_direct_and_hidden_fields",
      passed: privacyValidation.passed
    },
    {
      test_id: "reb_approval_and_recruitment_not_assumed",
      passed: ethicsValidation.passed
    },
    {
      test_id: "analysis_methods_remain_conditional_and_result_free",
      passed: analysisValidation.passed
    },
    {
      test_id: "all_five_limitations_are_explicit",
      passed: limitationsValidation.passed
    },
    {
      test_id: "deterministic_protocol_replay_is_stable",
      passed: replayOne.replay_hash === replayTwo.replay_hash
    },
    {
      test_id: "e2a42_historical_identity_is_preserved",
      passed: input.historicalIntegrity.passed
    }
  ];
  const regressions = {
    regression_version: "e2a43-deterministic-regressions-v1",
    tests: regressionTests,
    test_count: regressionTests.length,
    passed:
      regressionTests.length === 14 &&
      regressionTests.every((test) => test.passed)
  };
  const suites = {
    protocol: {
      suite_version: "e2a43-protocol-validation-v1",
      test_count: 8,
      contract_validation: validation,
      passed: validation.passed
    },
    research_questions: {
      ...researchQuestionValidation,
      test_count: 4
    },
    study_design: {
      ...studyDesignValidation,
      test_count: 5
    },
    expert: {
      ...expertValidation,
      test_count: 4
    },
    classroom_pilot: {
      ...classroomPilotValidation,
      test_count: 6
    },
    comparison: {
      ...comparisonValidation,
      test_count: 4
    },
    measurement: {
      ...measurementValidation,
      test_count: 5
    },
    research_schema: {
      ...researchSchemaValidation,
      test_count: 5
    },
    ethics: {
      ...ethicsValidation,
      test_count: 6
    },
    analysis: {
      ...analysisValidation,
      test_count: 4
    },
    privacy: {
      ...privacyValidation,
      test_count: 6
    },
    limitations: {
      ...limitationsValidation,
      test_count: 2
    },
    replay: {
      suite_version: "e2a43-replay-validation-v1",
      test_count: 4,
      first_replay_hash: replayOne.replay_hash,
      second_replay_hash: replayTwo.replay_hash,
      chain_of_thought_required: false,
      hidden_model_reasoning_required: false,
      passed:
        replayOne.replay_hash === replayTwo.replay_hash
    }
  };
  return {
    contractValidation: validation,
    replay: replayOne,
    regressions,
    suites,
    passed:
      Object.values(suites).every((suite) => suite.passed) &&
      regressions.passed
  };
}

export function buildE2A43FreezeArtifacts(networkRequestCount = 0) {
  const predecessor = buildE2A42FreezeArtifacts(0);
  const contracts = buildContracts();
  const measurementIntegration =
    buildMeasurementFrameworkIntegration(predecessor);
  const historicalIntegrity = buildHistoricalIntegrity(predecessor);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const bindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a43_provider_call_guard_failed");
  const deterministic = buildDeterministicVerification({
    contracts,
    measurementIntegration,
    historicalIntegrity
  });
  const protocol = buildProtocol({
    contracts,
    measurementIntegration,
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
    `e2a43_summary_failed:${JSON.stringify({
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
    status: "e2a43_research_protocol_frozen_no_execution",
    passed,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    research_question_count:
      contracts.research_questions.research_question_count,
    study_phase_count: contracts.study_design.phases.length,
    comparison_condition_count: contracts.comparison.conditions.length,
    research_variable_count:
      contracts.research_data_schema.variables.length,
    analysis_family_count: new Set(
      contracts.analysis.analyses.map((analysis) => analysis.family)
    ).size,
    limitation_count: contracts.limitations.limitations.length,
    required_regression_count:
      deterministic.regressions.test_count,
    deterministic_check_count: deterministicCheckCount,
    reb_approval_assumed: false,
    participant_recruitment_authorized: false,
    empirical_data_collection_authorized: false,
    empirical_results_present: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a43_execution_authorized: false,
    e2a43_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    real_student_data_used: false
  };
  const manifest = {
    manifest_version: "e2a43-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A43_ARTIFACT_NAMES],
    research_protocol_only: true,
    no_live_execution: true,
    no_empirical_data_collection: true
  };
  return {
    manifest,
    protocol,
    contracts,
    measurementIntegration,
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
  artifacts: ReturnType<typeof buildE2A43FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "component-contract-bindings.json": artifacts.bindings,
    "research-protocol-contract.json":
      artifacts.contracts.research_protocol,
    "research-question-framework.json":
      artifacts.contracts.research_questions,
    "empirical-study-design-contract.json":
      artifacts.contracts.study_design,
    "expert-rating-framework.json":
      artifacts.contracts.expert_rating,
    "classroom-pilot-contract.json":
      artifacts.contracts.classroom_pilot,
    "study-comparison-framework.json":
      artifacts.contracts.comparison,
    "measurement-framework-integration.json":
      artifacts.measurementIntegration,
    "research-data-schema.json":
      artifacts.contracts.research_data_schema,
    "research-ethics-boundary.json":
      artifacts.contracts.research_ethics,
    "analysis-framework.json":
      artifacts.contracts.analysis,
    "study-limitations.json":
      artifacts.contracts.limitations,
    "protocol-validation.json":
      artifacts.deterministic.suites.protocol,
    "research-question-validation.json":
      artifacts.deterministic.suites.research_questions,
    "study-design-validation.json":
      artifacts.deterministic.suites.study_design,
    "expert-evaluation-validation.json":
      artifacts.deterministic.suites.expert,
    "classroom-pilot-validation.json":
      artifacts.deterministic.suites.classroom_pilot,
    "comparison-validation.json":
      artifacts.deterministic.suites.comparison,
    "measurement-integration-validation.json":
      artifacts.deterministic.suites.measurement,
    "research-schema-validation.json":
      artifacts.deterministic.suites.research_schema,
    "ethics-validation.json":
      artifacts.deterministic.suites.ethics,
    "analysis-validation.json":
      artifacts.deterministic.suites.analysis,
    "privacy-validation.json":
      artifacts.deterministic.suites.privacy,
    "limitations-validation.json":
      artifacts.deterministic.suites.limitations,
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
  const expected = new Set(E2A43_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.has(
    name as (typeof E2A43_ARTIFACT_NAMES)[number]
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
    chain_of_thought_stored: boolean;
    hidden_model_reasoning_stored: boolean;
    hidden_prompts_stored: boolean;
    real_student_data_used: boolean;
    reb_approval_assumed: boolean;
    participant_recruitment_authorized: boolean;
    empirical_data_collection_authorized: boolean;
    empirical_results_present: boolean;
  }>(path.join(runDirectory, "summary.json"));
  return {
    validation_version: "e2a43-artifact-validation-v1",
    expected_artifact_count: E2A43_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    reb_approval_assumed: summary.reb_approval_assumed,
    participant_recruitment_authorized:
      summary.participant_recruitment_authorized,
    empirical_data_collection_authorized:
      summary.empirical_data_collection_authorized,
    empirical_results_present: summary.empirical_results_present,
    chain_of_thought_stored: summary.chain_of_thought_stored,
    hidden_model_reasoning_stored:
      summary.hidden_model_reasoning_stored,
    hidden_prompts_stored: summary.hidden_prompts_stored,
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
      !summary.reb_approval_assumed &&
      !summary.participant_recruitment_authorized &&
      !summary.empirical_data_collection_authorized &&
      !summary.empirical_results_present &&
      !summary.chain_of_thought_stored &&
      !summary.hidden_model_reasoning_stored &&
      !summary.hidden_prompts_stored &&
      !summary.real_student_data_used
  };
}

export function writeE2A43FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a43_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A43FreezeArtifacts(
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
  assert(artifactValidation.passed, "e2a43_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A43_ARTIFACT_NAMES) {
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

export function makeE2A43FreezeRunId() {
  return `e2a43_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A43FreezeRunDirectory() {
  assert(existsSync(E2A43_ARTIFACT_ROOT), "e2a43_artifact_root_missing");
  const latest = readdirSync(E2A43_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A43_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a43_freeze_run_missing");
  return path.join(E2A43_ARTIFACT_ROOT, latest);
}

export function inspectE2A43FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    research_questions: readJson<JsonRecord>(
      path.join(runDirectory, "research-question-framework.json")
    ),
    study_design: readJson<JsonRecord>(
      path.join(runDirectory, "empirical-study-design-contract.json")
    ),
    research_ethics: readJson<JsonRecord>(
      path.join(runDirectory, "research-ethics-boundary.json")
    ),
    limitations: readJson<JsonRecord>(
      path.join(runDirectory, "study-limitations.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    )
  };
}
