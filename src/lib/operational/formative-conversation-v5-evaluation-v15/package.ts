import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveActiveOperationalApproval } from "@/lib/operational/active-approval-bundle";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner";
import {
  assertFormativeConversationV5CompilationParity,
  compileFormativeConversationV5ExecutionPlan
} from "./compiler";
import {
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH,
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
  FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  FormativeConversationV5CompiledPlanSchema,
  FormativeConversationV5FixtureSchema,
  type FormativeConversationV5Fixture
} from "./contracts";

type JsonRecord = Record<string, unknown>;

export type FormativeConversationV5CandidateConfiguration = {
  roles: {
    formative_conversation_agent: {
      model_name: string;
      reasoning_effort:
        | "none"
        | "low"
        | "medium"
        | "high"
        | "xhigh"
        | "max";
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
  if (!condition) {
    throw new Error(code);
  }
}

function withoutHash(value: JsonRecord, field: string) {
  const { [field]: ignored, ...hashable } = value;
  void ignored;
  return hashable;
}

function assertEmbeddedHash(
  value: JsonRecord,
  field: string,
  code: string
) {
  const expected = value[field];
  assertCondition(
    typeof expected === "string" &&
      stableHash(withoutHash(value, field)) === expected,
    code
  );
  return expected;
}

export function formativeConversationV5FileSha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

export function formativeConversationV5FixtureHash(
  fixture: FormativeConversationV5Fixture
) {
  const { fixture_hash: ignored, ...hashable } = fixture;
  void ignored;
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

export function loadFormativeConversationV5EvaluationPackage() {
  const candidateManifest = readJson(
    FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH
  );
  const candidateIdentity = readJson(
    FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH
  );
  const protocol = readJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH);
  const fixtureManifest = readJson(
    FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
  );
  const sourceConfiguration = readJson(
    FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH
  );
  const approvalPlaceholder = readJson(
    FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH
  );
  const liveEnvironmentContract = readJson(
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
  );
  const dispatchCheckpointContract = readJson(
    FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH
  );
  const authorizationPackage = readJson(
    FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH
  );
  const committedCompiledPlan =
    FormativeConversationV5CompiledPlanSchema.parse(
      readJson(FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH)
    );

  const runtimeCandidateHash = String(
    candidateManifest.runtime_candidate_hash ?? ""
  );
  const protocolHash = assertEmbeddedHash(
    protocol,
    "protocol_hash",
    "formative_conversation_v15_protocol_hash_mismatch"
  );
  const fixtureManifestHash = assertEmbeddedHash(
    fixtureManifest,
    "fixture_manifest_hash",
    "formative_conversation_v15_fixture_manifest_hash_mismatch"
  );
  const liveEnvironmentContractHash = assertEmbeddedHash(
    liveEnvironmentContract,
    "environment_contract_hash",
    "formative_conversation_v15_environment_contract_hash_mismatch"
  );
  const dispatchCheckpointContractHash = assertEmbeddedHash(
    dispatchCheckpointContract,
    "dispatch_checkpoint_contract_hash",
    "formative_conversation_v15_dispatch_contract_hash_mismatch"
  );
  const candidateRevisionManifestHash = assertEmbeddedHash(
    candidateManifest,
    "candidate_manifest_hash",
    "formative_conversation_v15_candidate_manifest_hash_mismatch"
  );
  assertEmbeddedHash(
    sourceConfiguration,
    "source_configuration_hash",
    "formative_conversation_v15_source_configuration_hash_mismatch"
  );

  const fixtureReferences = fixtureManifest.fixtures;
  assertCondition(
    Array.isArray(fixtureReferences) &&
      fixtureReferences.length === FORMATIVE_CONVERSATION_V5_CASE_ORDER.length,
    "formative_conversation_v15_fixture_inventory_invalid"
  );
  const fixtures = fixtureReferences.map((entry, index) => {
    assertCondition(
      entry !== null && typeof entry === "object" && !Array.isArray(entry),
      "formative_conversation_v15_fixture_reference_invalid"
    );
    const reference = entry as JsonRecord;
    const fixturePath = String(reference.path ?? "");
    const fixture = FormativeConversationV5FixtureSchema.parse(
      readJson(fixturePath)
    );
    assertCondition(
      fixture.case_id === FORMATIVE_CONVERSATION_V5_CASE_ORDER[index] &&
        fixture.case_id === reference.case_id &&
        fixture.fixture_hash === reference.fixture_hash &&
        formativeConversationV5FixtureHash(fixture) === fixture.fixture_hash &&
        formativeConversationV5FileSha256(fixturePath) === reference.file_sha256,
      `${fixture.case_id}:formative_conversation_v15_fixture_identity_mismatch`
    );
    return fixture;
  });
  const aggregateFixtureHash =
    formativeConversationV5AggregateFixtureHash(fixtures);
  assertCondition(
    aggregateFixtureHash === fixtureManifest.aggregate_fixture_hash,
    "formative_conversation_v15_aggregate_fixture_hash_mismatch"
  );

  const sourceCandidate = sourceConfiguration.operational_configuration;
  assertCondition(
    sourceCandidate !== null &&
      typeof sourceCandidate === "object" &&
      !Array.isArray(sourceCandidate),
    "formative_conversation_v15_operational_configuration_missing"
  );
  const candidate = sourceCandidate as FormativeConversationV5CandidateConfiguration;
  assertCondition(
    candidate.roles?.formative_conversation_agent?.model_name ===
      "gpt-5.6-sol" &&
      candidate.roles.formative_conversation_agent.reasoning_effort ===
        "medium" &&
      candidate.roles.formative_conversation_agent.max_output_tokens === 3500 &&
      candidate.runtime_policy?.role_live_toggles
        .formative_conversation_agent === true,
    "formative_conversation_v15_candidate_role_configuration_invalid"
  );

  assertCondition(
    protocol.runtime_candidate_hash === runtimeCandidateHash &&
      protocol.prompt_hash === FORMATIVE_CONVERSATION_PROMPT_HASH &&
      protocol.prompt_version === FORMATIVE_CONVERSATION_PROMPT_VERSION &&
      protocol.fixture_manifest_hash === fixtureManifestHash &&
      protocol.live_environment_contract_hash ===
        liveEnvironmentContractHash &&
      protocol.dispatch_checkpoint_contract_hash ===
        dispatchCheckpointContractHash &&
      protocol.approval_eligible === false &&
      protocol.activation_permitted === false &&
      protocol.live_execution_prepared === true &&
      protocol.dispatch_checkpoint_permitted === true &&
      candidateManifest.approval_eligible === false &&
      candidateManifest.activation_permitted === false &&
      candidateManifest.live_execution_prepared === true &&
      approvalPlaceholder.approval_eligible === false &&
      approvalPlaceholder.activation_permitted === false,
    "formative_conversation_v15_governance_boundary_invalid"
  );
  assertCondition(
    candidateIdentity.runtime_candidate_hash === runtimeCandidateHash &&
      candidateIdentity.protocol_hash === protocolHash &&
      candidateIdentity.fixture_manifest_hash === fixtureManifestHash &&
      candidateIdentity.compiled_plan_hash ===
        committedCompiledPlan.compiled_plan_hash &&
      candidateIdentity.environment_contract_hash ===
        liveEnvironmentContractHash &&
      candidateIdentity.dispatch_checkpoint_contract_hash ===
        dispatchCheckpointContractHash,
    "formative_conversation_v15_candidate_identity_mismatch"
  );
  assertCondition(
    authorizationPackage.runtime_candidate_hash === runtimeCandidateHash &&
      authorizationPackage.protocol_hash === protocolHash &&
      authorizationPackage.fixture_manifest_hash === fixtureManifestHash &&
      authorizationPackage.compiled_plan_hash ===
        committedCompiledPlan.compiled_plan_hash &&
      authorizationPackage.live_execution_authorized === false,
    "formative_conversation_v15_authorization_package_mismatch"
  );

  const compiled = compileFormativeConversationV5ExecutionPlan({
    runtime_candidate_hash: runtimeCandidateHash,
    evaluation_protocol_hash: protocolHash,
    runner_implementation_hash: String(
      protocol.runner_implementation_hash
    ),
    live_environment_contract_hash: liveEnvironmentContractHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    fixtures,
    fixture_file_sha256_by_case: Object.fromEntries(
      fixtureReferences.map((entry) => {
        const reference = entry as JsonRecord;
        return [String(reference.case_id), String(reference.file_sha256)];
      })
    ),
    budget: protocol.budget as Parameters<
      typeof compileFormativeConversationV5ExecutionPlan
    >[0]["budget"],
    run_namespace_template: "<provider_run_id>",
    case_namespace_template: "<provider_run_id>:<case_id>",
    intended_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS
  });
  assertFormativeConversationV5CompilationParity({
    committed: committedCompiledPlan,
    compiled
  });

  return {
    candidate_manifest: candidateManifest as JsonRecord & {
      preserved_active_runtime_hash: string;
      preserved_rollback_runtime_hash: string;
    },
    candidate_identity: candidateIdentity,
    protocol: protocol as JsonRecord & {
      budget: Parameters<
        typeof compileFormativeConversationV5ExecutionPlan
      >[0]["budget"];
      runner_implementation_hash: string;
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
    protocol_file_sha256: formativeConversationV5FileSha256(
      FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH
    ),
    fixture_manifest: fixtureManifest,
    fixture_manifest_hash: fixtureManifestHash,
    fixture_manifest_file_sha256: formativeConversationV5FileSha256(
      FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
    ),
    live_environment_contract: liveEnvironmentContract,
    live_environment_contract_hash: liveEnvironmentContractHash,
    live_environment_contract_file_sha256:
      formativeConversationV5FileSha256(
        FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
      ),
    dispatch_checkpoint_contract: dispatchCheckpointContract,
    dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash,
    authorization_package: authorizationPackage,
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

export type FormativeConversationV5Package = ReturnType<
  typeof loadFormativeConversationV5EvaluationPackage
>;

export function exactFormativeConversationV5LiveAuthorization(
  loaded: FormativeConversationV5Package
) {
  return String(loaded.protocol.live_authorization_template)
    .replaceAll("<runtime_candidate_hash>", loaded.runtime_candidate_hash)
    .replaceAll("<evaluation_protocol_hash>", loaded.protocol_hash);
}

export function verifyFormativeConversationV5Governance(
  loaded: FormativeConversationV5Package
) {
  const active = resolveActiveOperationalApproval();
  assertCondition(
    active?.kind === "derived_approval",
    "formative_conversation_v15_active_approval_unavailable"
  );
  assertCondition(
    active.record.runtime_candidate_hash ===
      loaded.candidate_manifest.preserved_active_runtime_hash &&
      active.record.rollback.approved_runtime_hash ===
        loaded.candidate_manifest.preserved_rollback_runtime_hash &&
      active.record.runtime_candidate_hash !== loaded.runtime_candidate_hash,
    "formative_conversation_v15_active_or_rollback_identity_changed"
  );
  return {
    active_runtime_hash: active.record.runtime_candidate_hash,
    rollback_runtime_hash: active.record.rollback.approved_runtime_hash,
    candidate_inactive: true,
    approval_eligible: false,
    activation_permitted: false
  } as const;
}

export function buildFormativeConversationV5EvaluationPlan() {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const governance = verifyFormativeConversationV5Governance(loaded);
  const exactAuthorization =
    exactFormativeConversationV5LiveAuthorization(loaded);
  return {
    plan_version: "formative-conversation-v15-evaluation-plan-v1",
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
      runner_implementation_hash:
        loaded.protocol.runner_implementation_hash
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
        fixture_hash: entry.fixture_hash,
        expected_logical_calls:
          entry.call_graph.expected_logical_call_count,
        maximum_logical_calls:
          entry.call_graph.maximum_logical_call_count,
        namespace: entry.namespace.case_namespace_template
      }))
    },
    compiled_execution_plan: {
      hash: loaded.compiled_plan.compiled_plan_hash,
      aggregate_call_graph:
        loaded.compiled_plan.aggregate_call_graph,
      isolated_namespaces: loaded.compiled_plan.isolated_namespaces
    },
    budget: loaded.protocol.budget,
    governance,
    required_live_authorization_text: exactAuthorization,
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
    FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
    FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
    FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
    FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
    FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH,
    FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH
  ].every((filePath) => existsSync(absolute(filePath)));
}
