import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  candidateActiveOperationalConfigHash,
  candidateOperationalModelHash,
  candidateRuntimeConfigurationHash,
  readCandidateOperationalModelConfig
} from "@/lib/operational/model-upgrade";
import { resolveActiveOperationalApproval } from "@/lib/operational/active-approval-bundle";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_INSTRUCTIONS,
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner";
import {
  FORMATIVE_CONVERSATION_OPENING_VERSION
} from "@/lib/services/student-assessment/formative-conversation/opening-contract";
import {
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  FormativeConversationV5ApprovalPlaceholderSchema,
  FormativeConversationV5CandidateIdentitySchema,
  FormativeConversationV5CandidateManifestSchema,
  FormativeConversationV5CompiledPlanSchema,
  FormativeConversationV5FixtureManifestSchema,
  FormativeConversationV5FixtureSchema,
  FormativeConversationV5ProtocolSchema,
  FormativeConversationV5SourceConfigurationSchema,
  type FormativeConversationV5Fixture,
  type FormativeConversationV5Protocol
} from "./contracts";
import {
  assertFormativeConversationV5CompilationParity,
  compileFormativeConversationV5ExecutionPlan
} from "./compiler";

const OLD_CANDIDATE_MANIFEST_PATH =
  "config/operational-candidates/formative-conversation-host-v5/candidate-manifest.json";
const OLD_PROTOCOL_PATH =
  "config/operational-candidates/formative-conversation-host-v5/evaluation-protocol.json";

export type FormativeConversationV5Package = ReturnType<
  typeof loadFormativeConversationV5EvaluationPackage
>;

function absolute(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8")) as unknown;
}

export function formativeConversationV5FileSha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

export function formativeConversationV5FixtureHash(
  fixture: Omit<FormativeConversationV5Fixture, "fixture_hash"> | FormativeConversationV5Fixture
) {
  const { fixture_hash: ignoredFixtureHash, ...hashable } =
    fixture as FormativeConversationV5Fixture;
  void ignoredFixtureHash;
  return stableHash(hashable);
}

export function formativeConversationV5AggregateFixtureHash(
  fixtures: readonly FormativeConversationV5Fixture[]
) {
  return stableHash(
    fixtures.map((fixture) => ({
      case_id: fixture.case_id,
      case_order: fixture.case_order,
      fixture_hash: fixture.fixture_hash
    }))
  );
}

function assertCondition(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(code);
  }
}

export function assertFormativeConversationV5ProtocolHash(
  expectedHash: string,
  protocol: unknown
) {
  assertCondition(
    stableHash(protocol) === expectedHash,
    "formative_conversation_v5_protocol_hash_mismatch"
  );
}

export function assertFormativeConversationV5FixtureHash(
  expectedHash: string,
  fixture:
    | Omit<FormativeConversationV5Fixture, "fixture_hash">
    | FormativeConversationV5Fixture
) {
  assertCondition(
    formativeConversationV5FixtureHash(fixture) === expectedHash,
    "formative_conversation_v5_fixture_hash_mismatch"
  );
}

export function assertFormativeConversationV5RuntimeFingerprint(
  identity: FormativeConversationV5Protocol["target_identity"]
) {
  assertCondition(
    FORMATIVE_CONVERSATION_PROMPT_VERSION === identity.prompt_version &&
      FORMATIVE_CONVERSATION_PROMPT_HASH === identity.prompt_hash &&
      FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION ===
        identity.schema_version &&
      FORMATIVE_CONVERSATION_OPENING_VERSION ===
        identity.opening_validator_version &&
      FORMATIVE_CONVERSATION_INSTRUCTIONS.trim().length > 0,
    "formative_conversation_v5_runtime_fingerprint_mismatch"
  );
}

export function assertFormativeConversationV5RunnerBinding(
  runnerVersion: string
) {
  assertCondition(
    runnerVersion ===
      "formative-conversation-v5-protocol-runner-v2",
    "formative_conversation_v5_runner_substitution_not_permitted"
  );
}

export function assertFormativeConversationV5Isolation(
  protocol: FormativeConversationV5Protocol,
  fixtures: readonly FormativeConversationV5Fixture[]
) {
  assertCondition(
    protocol.isolation.classroom_collision_forbidden &&
      protocol.isolation.ordinary_teacher_summary_inclusion_forbidden &&
      protocol.isolation.export_markers_required &&
      protocol.isolation.approval_activation_forbidden &&
      protocol.isolation.provider_run_id_template.startsWith(
        "fcv5v3_provider_"
      ) &&
      protocol.isolation.derived_evaluation_id_template.startsWith(
        "fcv5v3_derived_"
      ) &&
      fixtures.every(
        (fixture) =>
          fixture.synthetic_only &&
          !fixture.real_student_information_present &&
          fixture.synthetic_identity.namespace_template.includes(
            "<provider_run_id>"
          ) &&
          fixture.synthetic_identity.namespace_template.includes(
            fixture.case_id
          )
      ) &&
      new Set(
        fixtures.map((fixture) => fixture.execution_subject_id)
      ).size === fixtures.length,
    "formative_conversation_v5_isolation_contract_invalid"
  );
}

function verifyFixtureCallGraph(fixture: FormativeConversationV5Fixture) {
  const expectedCalls = 1 + fixture.student_messages.length;
  assertCondition(
    fixture.opening_executed &&
      fixture.expected_student_message_count ===
        fixture.student_messages.length &&
      fixture.call_graph.student_message_count ===
        fixture.student_messages.length,
    `${fixture.case_id}:student_message_count_mismatch`
  );
  assertCondition(
    fixture.expected_logical_call_count === expectedCalls &&
      fixture.call_graph.expected_logical_calls === expectedCalls &&
      fixture.call_graph.maximum_logical_calls === expectedCalls &&
      fixture.call_graph.logical_calls.length === expectedCalls,
    `${fixture.case_id}:logical_call_count_mismatch`
  );
  assertCondition(
    fixture.call_graph.logical_calls.every(
      (call, index) => call.sequence === index + 1
    ),
    `${fixture.case_id}:logical_call_order_invalid`
  );
  assertCondition(
    fixture.call_graph.logical_calls[0].call_type ===
      "assistant_first_opening" &&
      fixture.call_graph.logical_calls[0].student_message_sequence === null,
    `${fixture.case_id}:opening_call_missing`
  );
  assertCondition(
    fixture.student_messages.every(
      (message, index) => message.sequence === index + 1
    ),
    `${fixture.case_id}:student_message_order_invalid`
  );
  assertCondition(
    fixture.call_graph.logical_calls.slice(1).every(
      (call, index) =>
        call.call_type === "student_message_response" &&
        call.student_message_sequence === index + 1
    ),
    `${fixture.case_id}:student_message_call_graph_invalid`
  );
  assertCondition(
    fixture.assessment_responses.every(
      (response, index) => response.item_number === index + 1
    ),
    `${fixture.case_id}:assessment_response_order_invalid`
  );
}

export function loadFormativeConversationV5EvaluationPackage() {
  const candidateManifest =
    FormativeConversationV5CandidateManifestSchema.parse(
      readJson(FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH)
    );
  const protocol = FormativeConversationV5ProtocolSchema.parse(
    readJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH)
  );
  const fixtureManifest =
    FormativeConversationV5FixtureManifestSchema.parse(
      readJson(FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH)
    );
  const approvalPlaceholder =
    FormativeConversationV5ApprovalPlaceholderSchema.parse(
      readJson(FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH)
    );
  const sourceConfiguration =
    FormativeConversationV5SourceConfigurationSchema.parse(
    readJson(FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH)
  );
  const candidateIdentity =
    FormativeConversationV5CandidateIdentitySchema.parse(
    readJson(FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH)
  );
  const committedCompiledPlan =
    FormativeConversationV5CompiledPlanSchema.parse(
      readJson(FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH)
    );
  const sourceCandidate = readCandidateOperationalModelConfig(
    OLD_CANDIDATE_MANIFEST_PATH
  );
  const fixtures = fixtureManifest.fixtures.map((reference) => {
    const fixture = FormativeConversationV5FixtureSchema.parse(
      readJson(reference.path)
    );
    assertCondition(
      fixture.case_id === reference.case_id &&
        fixture.case_order === reference.order,
      `${reference.case_id}:fixture_reference_identity_mismatch`
    );
    assertCondition(
      fixture.fixture_hash === reference.fixture_hash,
      `${reference.case_id}:fixture_hash_mismatch`
    );
    assertFormativeConversationV5FixtureHash(
      reference.fixture_hash,
      fixture
    );
    assertCondition(
      formativeConversationV5FileSha256(reference.path) ===
        reference.file_sha256,
      `${reference.case_id}:fixture_file_sha256_mismatch`
    );
    verifyFixtureCallGraph(fixture);
    return fixture;
  });

  const runtimeCandidateHash =
    candidateRuntimeConfigurationHash(sourceCandidate);
  const sourceCandidateHash = candidateOperationalModelHash(sourceCandidate);
  const candidateActiveConfigurationHash =
    candidateActiveOperationalConfigHash(sourceCandidate);
  const candidateRevisionManifestHash = stableHash(candidateManifest);
  const protocolHash = stableHash(protocol);
  const fixtureManifestHash = stableHash(fixtureManifest);
  const aggregateFixtureHash =
    formativeConversationV5AggregateFixtureHash(fixtures);
  const sourceConfigurationHash = stableHash(sourceConfiguration);
  const priorIncompleteProtocolHash = stableHash(
    readJson(OLD_PROTOCOL_PATH)
  );

  assertCondition(
    fixtureManifest.fixed_case_order.every(
      (caseId, index) => caseId === FORMATIVE_CONVERSATION_V5_CASE_ORDER[index]
    ) &&
      fixtures.every(
        (fixture, index) =>
          fixture.case_id === FORMATIVE_CONVERSATION_V5_CASE_ORDER[index] &&
          fixture.case_order === index + 1
      ),
    "formative_conversation_v5_case_order_mismatch"
  );
  assertCondition(
    new Set(fixtures.map((fixture) => fixture.case_id)).size === 8,
    "formative_conversation_v5_case_inventory_not_exact"
  );
  assertCondition(
    aggregateFixtureHash === fixtureManifest.aggregate_fixture_hash,
    "formative_conversation_v5_aggregate_fixture_hash_mismatch"
  );
  assertCondition(
    runtimeCandidateHash === candidateManifest.runtime_candidate_hash &&
      runtimeCandidateHash ===
        protocol.target_identity.runtime_candidate_hash &&
      runtimeCandidateHash === approvalPlaceholder.runtime_candidate_hash &&
      runtimeCandidateHash === candidateIdentity.runtime_candidate_hash,
    "formative_conversation_v5_runtime_candidate_hash_mismatch"
  );
  assertCondition(
    sourceCandidateHash ===
      candidateManifest.source_candidate_manifest.canonical_hash &&
      sourceCandidateHash ===
        sourceConfiguration.source_candidate_manifest.canonical_hash &&
      sourceCandidateHash === candidateIdentity.source_candidate_manifest_hash,
    "formative_conversation_v5_source_manifest_hash_mismatch"
  );
  assertCondition(
    formativeConversationV5FileSha256(
      candidateManifest.source_candidate_manifest.path
    ) === candidateManifest.source_candidate_manifest.file_sha256 &&
      formativeConversationV5FileSha256(
        sourceConfiguration.source_candidate_manifest.path
      ) === sourceConfiguration.source_candidate_manifest.file_sha256,
    "formative_conversation_v5_source_candidate_file_changed"
  );
  assertCondition(
    protocolHash === approvalPlaceholder.evaluation_protocol_hash &&
      protocolHash ===
        candidateIdentity.executable_evaluation_protocol_hash,
    "formative_conversation_v5_protocol_hash_mismatch"
  );
  assertFormativeConversationV5ProtocolHash(
    approvalPlaceholder.evaluation_protocol_hash,
    protocol
  );
  assertCondition(
    priorIncompleteProtocolHash ===
      protocol.prior_incomplete_protocol.protocol_hash &&
      priorIncompleteProtocolHash ===
        candidateManifest.prior_incomplete_protocol_hash &&
      priorIncompleteProtocolHash ===
        candidateIdentity.preserved_incomplete_protocol_hash,
    "formative_conversation_v5_prior_protocol_not_preserved"
  );
  assertCondition(
    formativeConversationV5FileSha256(
      sourceConfiguration.preserved_governance
        .prior_incomplete_protocol_path
    ) ===
      sourceConfiguration.preserved_governance
        .prior_incomplete_protocol_file_sha256,
    "formative_conversation_v5_prior_protocol_file_changed"
  );
  assertFormativeConversationV5RuntimeFingerprint(
    protocol.target_identity
  );
  assertFormativeConversationV5RunnerBinding(
    protocol.execution_policy.runner_version
  );
  assertFormativeConversationV5RunnerBinding(
    fixtureManifest.execution_engine
  );
  assertCondition(
    protocol.runner_implementation.files.every(
      (reference) =>
        formativeConversationV5FileSha256(reference.path) ===
        reference.sha256
    ) &&
      stableHash(protocol.runner_implementation.files) ===
        protocol.runner_implementation.aggregate_hash,
    "formative_conversation_v5_runner_implementation_mismatch"
  );
  assertFormativeConversationV5Isolation(protocol, fixtures);

  const expectedLogicalCalls = fixtures.reduce(
    (total, fixture) =>
      total + fixture.call_graph.expected_logical_calls,
    0
  );
  assertCondition(
    expectedLogicalCalls ===
      protocol.budget.expected_logical_call_count &&
      protocol.budget.maximum_provider_attempt_count ===
        protocol.budget.maximum_logical_call_count *
          (protocol.budget.maximum_transport_retries_per_logical_call + 1),
    "formative_conversation_v5_budget_call_graph_mismatch"
  );
  const recompiledPlan =
    compileFormativeConversationV5ExecutionPlan({
      runtime_candidate_hash: runtimeCandidateHash,
      evaluation_protocol_hash: protocolHash,
      runner_implementation_hash:
        protocol.runner_implementation.aggregate_hash,
      fixture_manifest_hash: fixtureManifestHash,
      aggregate_fixture_hash: aggregateFixtureHash,
      fixtures,
      fixture_file_sha256_by_case: Object.fromEntries(
        fixtureManifest.fixtures.map((reference) => [
          reference.case_id,
          reference.file_sha256
        ])
      ),
      budget: protocol.budget,
      run_namespace_template:
        protocol.isolation.run_namespace_template,
      case_namespace_template:
        protocol.isolation.case_namespace_template,
      intended_artifacts: protocol.intended_artifacts
    });
  assertFormativeConversationV5CompilationParity({
    committed: committedCompiledPlan,
    compiled: recompiledPlan
  });
  assertCondition(
    candidateManifest.compiled_execution_plan_path ===
      FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH &&
      protocol.compiled_execution_plan_path ===
        FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
    "formative_conversation_v5_v3_compiled_plan_path_mismatch"
  );
  assertCondition(
    protocol.failed_v2_execution.protocol_hash ===
        candidateManifest.failed_v2_protocol_hash &&
      protocol.failed_v2_execution.protocol_hash ===
        sourceConfiguration.preserved_governance
          .failed_v2_protocol_hash &&
      protocol.failed_v2_execution.protocol_hash ===
        candidateIdentity.failed_v2_protocol_hash &&
      protocol.failed_v2_execution.dispatch_checkpoint_sha256 ===
        sourceConfiguration.preserved_governance
          .failed_v2_dispatch_checkpoint_sha256 &&
      protocol.failed_v2_execution.dispatch_checkpoint_sha256 ===
        candidateIdentity.failed_v2_checkpoint_sha256,
    "formative_conversation_v5_v2_failure_evidence_mismatch"
  );
  if (
    existsSync(
      absolute(
        protocol.failed_v2_execution.dispatch_checkpoint_path
      )
    )
  ) {
    assertCondition(
      formativeConversationV5FileSha256(
        protocol.failed_v2_execution.dispatch_checkpoint_path
      ) ===
        protocol.failed_v2_execution
          .dispatch_checkpoint_sha256,
      "formative_conversation_v5_v2_checkpoint_changed"
    );
  }
  assertCondition(
    candidateIdentity.candidate_revision_manifest_hash ===
      candidateRevisionManifestHash &&
      candidateIdentity.candidate_revision_manifest_sha256 ===
        formativeConversationV5FileSha256(
          FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH
        ) &&
      candidateIdentity.executable_evaluation_protocol_sha256 ===
        formativeConversationV5FileSha256(
          FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH
        ) &&
      candidateIdentity.runner_implementation_hash ===
        protocol.runner_implementation.aggregate_hash &&
      candidateIdentity.fixture_manifest_hash === fixtureManifestHash &&
      candidateIdentity.fixture_manifest_sha256 ===
        formativeConversationV5FileSha256(
          FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
        ) &&
      candidateIdentity.aggregate_fixture_hash === aggregateFixtureHash &&
      candidateIdentity.compiled_execution_plan_hash ===
        committedCompiledPlan.compiled_plan_hash &&
      candidateIdentity.compiled_execution_plan_sha256 ===
        formativeConversationV5FileSha256(
          FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH
        ) &&
      candidateIdentity.source_configuration_hash ===
        sourceConfigurationHash &&
      candidateIdentity.source_configuration_sha256 ===
        formativeConversationV5FileSha256(
          FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH
        ) &&
      candidateIdentity.approval_placeholder_sha256 ===
        formativeConversationV5FileSha256(
          FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH
        ) &&
      candidateIdentity.candidate_active_configuration_hash ===
        candidateActiveConfigurationHash &&
      candidateIdentity.source_application_git_commit ===
        sourceConfiguration.captured_from_application_git_commit,
    "formative_conversation_v5_candidate_identity_mismatch"
  );

  return {
    candidate_manifest: candidateManifest,
    candidate_identity: candidateIdentity,
    protocol,
    protocol_hash: protocolHash,
    protocol_file_sha256: formativeConversationV5FileSha256(
      FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH
    ),
    fixture_manifest: fixtureManifest,
    fixture_manifest_hash: fixtureManifestHash,
    fixture_manifest_file_sha256: formativeConversationV5FileSha256(
      FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
    ),
    aggregate_fixture_hash: aggregateFixtureHash,
    fixtures,
    compiled_plan: committedCompiledPlan,
    source_configuration: sourceConfiguration,
    source_configuration_hash: sourceConfigurationHash,
    source_candidate: sourceCandidate,
    source_candidate_hash: sourceCandidateHash,
    runtime_candidate_hash: runtimeCandidateHash,
    candidate_active_configuration_hash:
      candidateActiveConfigurationHash,
    candidate_revision_manifest_hash: candidateRevisionManifestHash,
    prior_incomplete_protocol_hash: priorIncompleteProtocolHash,
    approval_placeholder: approvalPlaceholder
  };
}

export function exactFormativeConversationV5LiveAuthorization(
  loaded: FormativeConversationV5Package
) {
  return loaded.protocol.live_authorization_template
    .replaceAll(
      "<runtime_candidate_hash>",
      loaded.runtime_candidate_hash
    )
    .replaceAll(
      "<evaluation_protocol_hash>",
      loaded.protocol_hash
    );
}

export function verifyFormativeConversationV5Governance(
  loaded: FormativeConversationV5Package
) {
  const active = resolveActiveOperationalApproval();
  assertCondition(
    active !== null,
    "formative_conversation_v5_active_approval_bundle_missing"
  );
  assertCondition(
    active.kind === "derived_approval",
    "formative_conversation_v5_derived_active_approval_required"
  );
  assertCondition(
    active.record.runtime_candidate_hash ===
      loaded.candidate_manifest.preserved_active_runtime_hash &&
      active.record.runtime_candidate_hash ===
        loaded.candidate_identity.preserved_active_runtime_hash,
    "formative_conversation_v5_active_approval_hash_changed"
  );
  assertCondition(
    active.record.runtime_candidate_hash !==
      loaded.runtime_candidate_hash,
    "formative_conversation_v5_candidate_must_remain_inactive"
  );
  assertCondition(
    active.record.rollback.approved_runtime_hash ===
        loaded.candidate_manifest.preserved_rollback_runtime_hash &&
    active.record.rollback.approved_runtime_hash ===
        loaded.candidate_identity.preserved_rollback_runtime_hash,
    "formative_conversation_v5_rollback_hash_changed"
  );
  assertCondition(
    active.record.rollback.manifest.sha256 ===
      loaded.source_configuration.preserved_governance
        .rollback_manifest_sha256,
    "formative_conversation_v5_rollback_manifest_changed"
  );
  assertCondition(
    loaded.approval_placeholder.approval.eligible === false &&
      loaded.approval_placeholder.activation.permitted === false &&
      loaded.candidate_manifest.approval_state ===
        "candidate_not_approved" &&
      loaded.candidate_manifest.activation_permitted === false,
    "formative_conversation_v5_inactive_boundary_failed"
  );
  return {
    active_runtime_hash: active.record.runtime_candidate_hash,
    rollback_runtime_hash: active.record.rollback.approved_runtime_hash,
    candidate_inactive: true,
    approval_eligible: false,
    activation_permitted: false
  };
}

export function buildFormativeConversationV5EvaluationPlan() {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const governance = verifyFormativeConversationV5Governance(loaded);
  const exactAuthorization =
    exactFormativeConversationV5LiveAuthorization(loaded);
  return {
    plan_version: "formative-conversation-v5-evaluation-plan-v2",
    mode: "plan",
    provider_calls: 0,
    provider_network_requests: 0,
    candidate: {
      revision_manifest_path:
        FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
      runtime_candidate_hash: loaded.runtime_candidate_hash,
      candidate_revision_manifest_hash:
        loaded.candidate_revision_manifest_hash,
      candidate_active_configuration_hash:
        loaded.candidate_active_configuration_hash,
      inactive: true
    },
    protocol: {
      path: FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
      hash: loaded.protocol_hash,
      file_sha256: loaded.protocol_file_sha256,
      prior_incomplete_protocol_hash:
        loaded.prior_incomplete_protocol_hash,
      runner_implementation_hash:
        loaded.protocol.runner_implementation.aggregate_hash,
      runner_implementation_files:
        loaded.protocol.runner_implementation.files
    },
    fixtures: {
      manifest_path: FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
      manifest_hash: loaded.fixture_manifest_hash,
      manifest_file_sha256:
        loaded.fixture_manifest_file_sha256,
      aggregate_fixture_hash: loaded.aggregate_fixture_hash,
      ordered_cases: loaded.compiled_plan.cases.map((entry) => ({
        case_id: entry.case_id,
        fixture_hash: entry.fixture_hash,
        compilation_status: entry.compilation_status,
        execution_case_type: entry.execution_case_type,
        declared_student_message_count:
          entry.call_graph.declared_student_message_count,
        actual_student_message_count:
          entry.call_graph.actual_student_message_count,
        opening_call_count:
          entry.call_graph.opening_call_count,
        conversation_call_count:
          entry.call_graph.student_message_call_count,
        profiling_call_count:
          entry.call_graph.profiling_call_count,
        expected_logical_calls:
          entry.call_graph.expected_logical_call_count,
        maximum_logical_calls:
          entry.call_graph.maximum_logical_call_count,
        terminal_execution_point:
          entry.call_graph.terminal_execution_point,
        call_graph: entry.call_graph.logical_calls,
        namespace: entry.namespace.case_namespace_template
      }))
    },
    compiled_execution_plan: {
      path: FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
      hash: loaded.compiled_plan.compiled_plan_hash,
      file_sha256: formativeConversationV5FileSha256(
        FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH
      ),
      compilation_status:
        loaded.compiled_plan.compilation_status,
      aggregate_call_graph:
        loaded.compiled_plan.aggregate_call_graph,
      isolated_namespaces:
        loaded.compiled_plan.isolated_namespaces,
      intended_output_artifact_locations:
        loaded.compiled_plan
          .intended_output_artifact_locations
    },
    budget: loaded.protocol.budget,
    isolation: loaded.protocol.isolation,
    governance,
    required_live_authorization_text: exactAuthorization,
    required_live_command: [
      "FORMATIVE_CONVERSATION_V5_V3_LIVE_EVALUATION_ENABLED=true",
      "npm run operational:formative-conversation-v5-v3-evaluate --",
      "--mode=live",
      `--runtime-candidate-hash ${loaded.runtime_candidate_hash}`,
      `--evaluation-protocol-hash ${loaded.protocol_hash}`,
      "--confirm-live-provider-calls",
      `--authorization ${JSON.stringify(exactAuthorization)}`
    ].join(" "),
    intended_artifact_root:
      FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
    plan_artifact_root:
      FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
    intended_artifacts: loaded.protocol.intended_artifacts,
    substitutions_forbidden:
      loaded.fixture_manifest.forbidden_runner_substitutions
  };
}

export function packagePathsExist() {
  return [
    FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
    FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
    FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
    FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
    FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
    FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH
  ].every((filePath) => existsSync(absolute(filePath)));
}
