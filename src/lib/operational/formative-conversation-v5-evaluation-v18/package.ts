import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveActiveOperationalApproval } from "@/lib/operational/active-approval-bundle";
import { stableHash } from "@/lib/operational/stable-hash";
import { formativeConversationV18SecurityWrapperFingerprint } from "./security-release";
import {
  assertFormativeConversationV18CompilationParity,
  compileFormativeConversationV18ExecutionPlan
} from "./compiler";
import {
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_IMMUTABLE_V17_REFERENCE_PATH,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
  FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_RUNTIME_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  FormativeConversationV18BudgetSchema,
  FormativeConversationV18CompiledPlanSchema,
  FormativeConversationV18FixtureSchema,
  type FormativeConversationV18Fixture
} from "./contracts";

type JsonRecord = Record<string, unknown>;

export type FormativeConversationV18CandidateConfiguration = {
  roles: {
    student_profiling_agent: {
      model_name: string;
      reasoning_effort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
      max_output_tokens: number;
    };
    formative_conversation_agent: {
      model_name: string;
      reasoning_effort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
      max_output_tokens: number;
    };
  };
  runtime_policy: {
    provider_timeout_ms: number;
    provider_max_retries: number;
    role_live_toggles: {
      student_communication_agent: boolean;
      topic_dialogue_agent: boolean;
      formative_conversation_agent: boolean;
    };
    topic_dialogue_policy: {
      maximum_student_turns: number;
      recent_raw_turn_window: number;
      maximum_student_message_characters: number;
      assessment_system_questions_allowed: boolean;
    };
  };
};

function absolute(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

function readJson(relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8")) as JsonRecord;
}

function assertCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function withoutHash(value: JsonRecord, field: string) {
  const { [field]: ignored, ...hashable } = value;
  void ignored;
  return hashable;
}

function assertEmbeddedHash(value: JsonRecord, field: string, code: string) {
  const expected = value[field];
  assertCondition(
    typeof expected === "string" && stableHash(withoutHash(value, field)) === expected,
    code
  );
  return expected;
}

export function formativeConversationV18FileSha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

export function formativeConversationV18FixtureHash(
  fixture: FormativeConversationV18Fixture
) {
  const { fixture_hash: ignored, ...hashable } = fixture;
  void ignored;
  return stableHash(hashable);
}

export function formativeConversationV18AggregateFixtureHash(
  fixtures: readonly FormativeConversationV18Fixture[]
) {
  return stableHash(
    fixtures.map((fixture) => ({
      case_id: fixture.case_id,
      case_order: fixture.case_order,
      fixture_hash: fixture.fixture_hash
    }))
  );
}

export function loadFormativeConversationV18EvaluationPackage() {
  const candidateManifest = readJson(FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH);
  const candidateIdentity = readJson(FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH);
  const runtimeManifest = readJson(FORMATIVE_CONVERSATION_V5_RUNTIME_MANIFEST_PATH);
  const protocol = readJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH);
  const fixtureManifest = readJson(FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH);
  const sourceConfiguration = readJson(FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH);
  const approvalPlaceholder = readJson(FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH);
  const liveEnvironmentContract = readJson(FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH);
  const dispatchCheckpointContract = readJson(FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH);
  const authorizationPackage = readJson(FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH);
  const immutableV17Reference = readJson(FORMATIVE_CONVERSATION_V5_IMMUTABLE_V17_REFERENCE_PATH);
  const provenanceContract = readJson(FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH);
  const securityWrapperManifest = readJson(FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH);
  const committedCompiledPlan = FormativeConversationV18CompiledPlanSchema.parse(
    readJson(FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH)
  );

  const runtimeCandidateHash = String(candidateManifest.runtime_candidate_hash ?? "");
  const protocolHash = assertEmbeddedHash(
    protocol,
    "protocol_hash",
    "formative_conversation_v18_protocol_hash_mismatch"
  );
  const fixtureManifestHash = assertEmbeddedHash(
    fixtureManifest,
    "fixture_manifest_hash",
    "formative_conversation_v18_fixture_manifest_hash_mismatch"
  );
  const liveEnvironmentContractHash = assertEmbeddedHash(
    liveEnvironmentContract,
    "environment_contract_hash",
    "formative_conversation_v18_environment_contract_hash_mismatch"
  );
  const dispatchCheckpointContractHash = assertEmbeddedHash(
    dispatchCheckpointContract,
    "dispatch_checkpoint_contract_hash",
    "formative_conversation_v18_dispatch_contract_hash_mismatch"
  );
  const candidateRevisionManifestHash = assertEmbeddedHash(
    candidateManifest,
    "candidate_manifest_hash",
    "formative_conversation_v18_candidate_manifest_hash_mismatch"
  );
  const provenanceContractHash = assertEmbeddedHash(
    provenanceContract,
    "provenance_contract_hash",
    "formative_conversation_v18_provenance_contract_hash_mismatch"
  );
  assertEmbeddedHash(
    securityWrapperManifest,
    "security_wrapper_manifest_hash",
    "formative_conversation_v18_security_wrapper_manifest_hash_mismatch"
  );
  const securitySourceFiles = securityWrapperManifest.source_files;
  assertCondition(
    Array.isArray(securitySourceFiles),
    "formative_conversation_v18_security_wrapper_sources_missing"
  );
  const securityWrapperHash = String(
    securityWrapperManifest.security_wrapper_hash ?? ""
  );
  assertCondition(
    securityWrapperHash ===
      formativeConversationV18SecurityWrapperFingerprint(
        Object.fromEntries(
          securitySourceFiles.map((entry) => {
            const source = asRecord(entry);
            return [String(source.path ?? ""), String(source.sha256 ?? "")];
          })
        )
      ),
    "formative_conversation_v18_security_wrapper_hash_mismatch"
  );
  assertEmbeddedHash(
    sourceConfiguration,
    "source_configuration_hash",
    "formative_conversation_v18_source_configuration_hash_mismatch"
  );

  assertCondition(
    runtimeManifest.runtime_candidate_hash === runtimeCandidateHash &&
      protocol.runtime_candidate_hash === runtimeCandidateHash &&
      candidateIdentity.runtime_candidate_hash === runtimeCandidateHash &&
      candidateIdentity.protocol_hash === protocolHash &&
      candidateIdentity.provenance_contract_hash === provenanceContractHash &&
      candidateIdentity.security_wrapper_hash === securityWrapperHash &&
      candidateManifest.protocol_hash === protocolHash &&
      asRecord(candidateManifest.approval).eligible === false &&
      asRecord(candidateManifest.activation).permitted === false &&
      candidateManifest.live_execution_prepared === true &&
      protocol.live_execution_prepared === true &&
      protocol.approval_eligible === false &&
      protocol.activation_permitted === false &&
      approvalPlaceholder.approval_status === "not_approved" &&
      approvalPlaceholder.activation_status === "not_permitted",
    "formative_conversation_v18_governance_artifact_invalid"
  );
  assertCondition(
    immutableV17Reference.source_revision ===
      "formative-conversation-host-v5-executable-v17" &&
      immutableV17Reference.local_artifact_policy ===
        "hash_reference_only_not_required_for_v18_live_readiness" &&
      immutableV17Reference.required_for_v18_live_readiness === false &&
      immutableV17Reference.candidate_artifacts_mutated === false &&
      immutableV17Reference.run_artifacts_mutated === false &&
      /^[a-f0-9]{64}$/u.test(
        String(immutableV17Reference.candidate_tree_sha256 ?? "")
      ) &&
      /^[a-f0-9]{64}$/u.test(
        String(immutableV17Reference.run_tree_sha256 ?? "")
      ),
    "formative_conversation_v18_immutable_v17_reference_invalid"
  );

  const fixtureReferences = fixtureManifest.fixtures;
  assertCondition(
    Array.isArray(fixtureReferences) && fixtureReferences.length === 12,
    "formative_conversation_v18_fixture_inventory_invalid"
  );
  const fixtures = fixtureReferences.map((reference: JsonRecord, index: number) => {
    const fixturePath = String(reference.path ?? "");
    const fixture = FormativeConversationV18FixtureSchema.parse(readJson(fixturePath));
    assertCondition(
      fixture.case_id === FORMATIVE_CONVERSATION_V5_CASE_ORDER[index] &&
        fixture.case_id === reference.case_id &&
        fixture.case_order === index + 1 &&
        fixture.fixture_hash === reference.fixture_hash &&
        formativeConversationV18FixtureHash(fixture) === fixture.fixture_hash &&
        formativeConversationV18FileSha256(fixturePath) === reference.file_sha256,
      `${fixture.case_id}:formative_conversation_v18_fixture_identity_mismatch`
    );
    return fixture;
  });
  const aggregateFixtureHash = formativeConversationV18AggregateFixtureHash(fixtures);
  assertCondition(
    aggregateFixtureHash === fixtureManifest.aggregate_fixture_hash &&
      fixtureManifest.fixture_manifest_hash === fixtureManifestHash,
    "formative_conversation_v18_aggregate_fixture_hash_mismatch"
  );

  const sourceCandidate = sourceConfiguration.operational_configuration;
  assertCondition(
    sourceCandidate && typeof sourceCandidate === "object" && !Array.isArray(sourceCandidate),
    "formative_conversation_v18_operational_configuration_missing"
  );
  const candidate = sourceCandidate as FormativeConversationV18CandidateConfiguration;
  assertCondition(
    candidate.roles.student_profiling_agent.model_name === "gpt-5.6-terra" &&
      candidate.roles.student_profiling_agent.reasoning_effort === "medium" &&
      candidate.roles.student_profiling_agent.max_output_tokens === 4_000 &&
      candidate.roles.formative_conversation_agent.model_name === "gpt-5.6-sol" &&
      candidate.roles.formative_conversation_agent.reasoning_effort === "medium" &&
      candidate.roles.formative_conversation_agent.max_output_tokens === 7_000,
    "formative_conversation_v18_role_configuration_invalid"
  );
  const budget = FormativeConversationV18BudgetSchema.parse(protocol.budget);
  const compiled = compileFormativeConversationV18ExecutionPlan({
    runtime_candidate_hash: runtimeCandidateHash,
    evaluation_protocol_hash: protocolHash,
    runner_implementation_hash: String(protocol.runner_implementation_hash),
    live_environment_contract_hash: liveEnvironmentContractHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    fixtures,
    fixture_file_sha256_by_case: Object.fromEntries(
      fixtureReferences.map((reference: JsonRecord) => [
        String(reference.case_id),
        String(reference.file_sha256)
      ])
    ),
    budget
  });
  assertFormativeConversationV18CompilationParity({
    committed: committedCompiledPlan,
    compiled
  });

  return {
    candidate_manifest: candidateManifest as JsonRecord & {
      preserved_active_runtime_hash: string;
      preserved_rollback_runtime_hash: string;
    },
    candidate_identity: candidateIdentity,
    runtime_manifest: runtimeManifest,
    protocol: {
      ...protocol,
      budget
    } as JsonRecord & {
      budget: typeof budget;
      runner_implementation_hash: string;
      live_authorization_template: string;
      target_identity: {
        prompt_version: string;
        prompt_hash: string;
        schema_version: string;
        context_version: string;
        safety_version: string;
        memory_version: string;
        opening_validator_version: string;
      };
    },
    protocol_hash: protocolHash,
    fixture_manifest: fixtureManifest,
    fixture_manifest_hash: fixtureManifestHash,
    live_environment_contract: liveEnvironmentContract,
    live_environment_contract_hash: liveEnvironmentContractHash,
    dispatch_checkpoint_contract: dispatchCheckpointContract,
    dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash,
    authorization_package: authorizationPackage,
    immutable_v17_reference: immutableV17Reference,
    provenance_contract: provenanceContract,
    provenance_contract_hash: provenanceContractHash,
    security_wrapper_manifest: securityWrapperManifest,
    security_wrapper_hash: securityWrapperHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    fixtures,
    compiled_plan: committedCompiledPlan,
    source_configuration: sourceConfiguration,
    source_candidate: candidate,
    runtime_candidate_hash: runtimeCandidateHash,
    candidate_revision_manifest_hash: candidateRevisionManifestHash,
    approval_placeholder: approvalPlaceholder
  };
}

export type FormativeConversationV18Package = ReturnType<
  typeof loadFormativeConversationV18EvaluationPackage
>;

export function exactFormativeConversationV18LiveAuthorization(
  loaded: FormativeConversationV18Package
) {
  return String(loaded.protocol.live_authorization_template)
    .replaceAll("<runtime_candidate_hash>", loaded.runtime_candidate_hash)
    .replaceAll("<evaluation_protocol_hash>", loaded.protocol_hash);
}

export function verifyFormativeConversationV18Governance(
  loaded: FormativeConversationV18Package
) {
  const active = resolveActiveOperationalApproval();
  assertCondition(
    active?.kind === "derived_approval",
    "formative_conversation_v18_active_approval_unavailable"
  );
  assertCondition(
    active.record.runtime_candidate_hash ===
      loaded.candidate_manifest.preserved_active_runtime_hash &&
      active.record.rollback.approved_runtime_hash ===
        loaded.candidate_manifest.preserved_rollback_runtime_hash &&
      active.record.runtime_candidate_hash !== loaded.runtime_candidate_hash,
    "formative_conversation_v18_active_or_rollback_identity_changed"
  );
  return {
    active_runtime_hash: active.record.runtime_candidate_hash,
    rollback_runtime_hash: active.record.rollback.approved_runtime_hash,
    candidate_inactive: true,
    approval_eligible: false,
    activation_permitted: false
  } as const;
}

export function buildFormativeConversationV18EvaluationPlan() {
  const loaded = loadFormativeConversationV18EvaluationPackage();
  const governance = verifyFormativeConversationV18Governance(loaded);
  return {
    plan_version: "formative-conversation-v18-evaluation-plan-v1",
    mode: "plan",
    provider_calls: 0,
    provider_network_requests: 0,
    provider_auth_network_requests: 0,
    database_readiness_queries: 2,
    candidate: {
      runtime_candidate_hash: loaded.runtime_candidate_hash,
      inactive: true
    },
    protocol: {
      hash: loaded.protocol_hash,
      runner_implementation_hash: loaded.protocol.runner_implementation_hash
    },
    live_environment: {
      contract_hash: loaded.live_environment_contract_hash,
      required_injected_environment:
        loaded.live_environment_contract.required_injected_environment,
      secret_values_recorded: false,
      active_approval_and_candidate_separate: true
    },
    dispatch_checkpoint: {
      contract_hash: loaded.dispatch_checkpoint_contract_hash,
      created: false,
      boundary: "immediately_before_first_generation_request"
    },
    fixtures: {
      manifest_hash: loaded.fixture_manifest_hash,
      aggregate_fixture_hash: loaded.aggregate_fixture_hash,
      ordered_cases: loaded.compiled_plan.cases.map((entry) => ({
        case_id: entry.case_id,
        case_type: entry.case_type,
        fixture_hash: entry.fixture_hash,
        namespace: entry.namespace.case_namespace_template
      }))
    },
    compiled_execution_plan: {
      hash: loaded.compiled_plan.compiled_plan_hash,
      aggregate_call_graph: loaded.compiled_plan.aggregate_call_graph,
      isolated_namespaces: loaded.compiled_plan.isolated_namespaces
    },
    budget: loaded.protocol.budget,
    governance,
    required_live_authorization_text:
      exactFormativeConversationV18LiveAuthorization(loaded),
    required_live_command: String(
      loaded.authorization_package.exact_future_live_command
    ),
    intended_artifact_root: FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
    plan_artifact_root: FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
    intended_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
    approval_eligible: false,
    activation_permitted: false
  } as const;
}

export function packagePathsExist() {
  return [
    FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
    FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
    FORMATIVE_CONVERSATION_V5_RUNTIME_MANIFEST_PATH,
    FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
    FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
    FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
    FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
    FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH,
    FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH,
    FORMATIVE_CONVERSATION_V5_IMMUTABLE_V17_REFERENCE_PATH,
    FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH,
    FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH
  ].every((filePath) => existsSync(absolute(filePath)));
}
