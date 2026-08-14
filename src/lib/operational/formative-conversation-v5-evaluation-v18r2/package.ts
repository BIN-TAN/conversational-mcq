import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveActiveOperationalApproval } from "@/lib/operational/active-approval-bundle";
import {
  FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS,
  buildFormativeConversationV18R2RuntimeCandidateManifest
} from "@/lib/operational/formative-conversation-v18r2/candidate";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V18R2_SECURITY_WRAPPER_SOURCE_PATHS,
  formativeConversationV18SecurityWrapperFingerprint
} from "./security-release";
import {
  assertFormativeConversationV18CompilationParity,
  compileFormativeConversationV18ExecutionPlan
} from "../formative-conversation-v5-evaluation-v18/compiler";
import {
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_IMMUTABLE_V18_REFERENCE_PATH,
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
import { FORMATIVE_CONVERSATION_V18R2_RUNNER_SOURCE_PATHS } from "./provenance";

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

function fileIdentities(paths: readonly string[]) {
  return paths.map((sourcePath) => ({
    path: sourcePath,
    sha256: formativeConversationV18FileSha256(sourcePath)
  }));
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
  const immutableV18Reference = readJson(FORMATIVE_CONVERSATION_V5_IMMUTABLE_V18_REFERENCE_PATH);
  const provenanceContract = readJson(FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH);
  const securityWrapperManifest = readJson(FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH);
  const committedCompiledPlan = FormativeConversationV18CompiledPlanSchema.parse(
    readJson(FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH)
  );

  const runtimeCandidateHash = String(candidateManifest.runtime_candidate_hash ?? "");
  const recomputedRuntimeManifest =
    buildFormativeConversationV18R2RuntimeCandidateManifest();
  assertCondition(
    stableHash(runtimeManifest) === stableHash(recomputedRuntimeManifest) &&
      recomputedRuntimeManifest.runtime_candidate_hash === runtimeCandidateHash,
    "formative_conversation_v18r2_runtime_source_identity_mismatch"
  );
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
  const deployedSecuritySourceFiles = fileIdentities(
    FORMATIVE_CONVERSATION_V18R2_SECURITY_WRAPPER_SOURCE_PATHS
  );
  const deployedSecurityWrapperHash =
    formativeConversationV18SecurityWrapperFingerprint(
      Object.fromEntries(
        deployedSecuritySourceFiles.map((entry) => [entry.path, entry.sha256])
      )
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
      ) &&
      securityWrapperHash === deployedSecurityWrapperHash,
    "formative_conversation_v18_security_wrapper_hash_mismatch"
  );
  const sourceConfigurationHash = assertEmbeddedHash(
    sourceConfiguration,
    "source_configuration_hash",
    "formative_conversation_v18_source_configuration_hash_mismatch"
  );

  const immutableV18ReferenceHash = stableHash(immutableV18Reference);
  const generatedArtifactHashes = asRecord(candidateIdentity.file_sha256);
  const generatedArtifacts = {
    runtime_candidate_manifest: FORMATIVE_CONVERSATION_V5_RUNTIME_MANIFEST_PATH,
    candidate_manifest: FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
    executable_evaluation_protocol: FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
    fixture_manifest: FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
    compiled_execution_plan: FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
    live_environment_contract:
      FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
    dispatch_checkpoint_contract:
      FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH,
    provenance_contract: FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH,
    security_wrapper_manifest:
      FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH,
    source_configuration: FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
    immutable_v18r1_reference: FORMATIVE_CONVERSATION_V5_IMMUTABLE_V18_REFERENCE_PATH,
    approval_evidence_placeholder:
      FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
    live_execution_authorization: FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH,
    live_execution_document: `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/LIVE_EXECUTION.md`
  } as const;
  for (const [name, artifactPath] of Object.entries(generatedArtifacts)) {
    assertCondition(
      generatedArtifactHashes[name] ===
        formativeConversationV18FileSha256(artifactPath),
      `formative_conversation_v18r2_generated_artifact_hash_mismatch:${name}`
    );
  }

  assertCondition(
    runtimeManifest.runtime_candidate_hash === runtimeCandidateHash &&
      protocol.runtime_candidate_hash === runtimeCandidateHash &&
      candidateIdentity.runtime_candidate_hash === runtimeCandidateHash &&
      candidateIdentity.protocol_hash === protocolHash &&
      candidateIdentity.candidate_manifest_hash ===
        candidateRevisionManifestHash &&
      candidateIdentity.fixture_manifest_hash === fixtureManifestHash &&
      candidateIdentity.compiled_plan_hash ===
        committedCompiledPlan.compiled_plan_hash &&
      candidateIdentity.environment_contract_hash ===
        liveEnvironmentContractHash &&
      candidateIdentity.dispatch_checkpoint_contract_hash ===
        dispatchCheckpointContractHash &&
      candidateIdentity.source_configuration_hash ===
        sourceConfigurationHash &&
      candidateIdentity.immutable_v18r1_reference_hash ===
        immutableV18ReferenceHash &&
      candidateIdentity.materializer_implementation_hash ===
        candidateManifest.materializer_implementation_hash &&
      candidateIdentity.materializer_implementation_hash ===
        protocol.materializer_implementation_hash &&
      candidateIdentity.provenance_contract_hash === provenanceContractHash &&
      candidateIdentity.security_wrapper_hash === securityWrapperHash &&
      candidateManifest.protocol_hash === protocolHash &&
      candidateManifest.runner_implementation_hash ===
        protocol.runner_implementation_hash &&
      candidateManifest.fixture_manifest_hash === fixtureManifestHash &&
      candidateManifest.compiled_plan_hash ===
        committedCompiledPlan.compiled_plan_hash &&
      candidateManifest.environment_contract_hash ===
        liveEnvironmentContractHash &&
      candidateManifest.dispatch_checkpoint_contract_hash ===
        dispatchCheckpointContractHash &&
      candidateManifest.security_wrapper_hash === securityWrapperHash &&
      candidateManifest.provenance_contract_hash === provenanceContractHash &&
      candidateManifest.source_configuration_hash ===
        sourceConfigurationHash &&
      candidateManifest.immutable_v18r1_reference_hash ===
        immutableV18ReferenceHash &&
      protocol.fixture_manifest_hash === fixtureManifestHash &&
      protocol.aggregate_fixture_hash === fixtureManifest.aggregate_fixture_hash &&
      protocol.live_environment_contract_hash ===
        liveEnvironmentContractHash &&
      protocol.dispatch_checkpoint_contract_hash ===
        dispatchCheckpointContractHash &&
      protocol.security_wrapper_hash === securityWrapperHash &&
      protocol.provenance_contract_hash === provenanceContractHash &&
      protocol.immutable_v18r1_reference_hash ===
        immutableV18ReferenceHash &&
      authorizationPackage.runtime_candidate_hash === runtimeCandidateHash &&
      authorizationPackage.protocol_hash === protocolHash &&
      authorizationPackage.runner_implementation_hash ===
        protocol.runner_implementation_hash &&
      authorizationPackage.fixture_manifest_hash === fixtureManifestHash &&
      authorizationPackage.aggregate_fixture_hash ===
        fixtureManifest.aggregate_fixture_hash &&
      authorizationPackage.compiled_plan_hash ===
        committedCompiledPlan.compiled_plan_hash &&
      approvalPlaceholder.runtime_candidate_hash === runtimeCandidateHash &&
      approvalPlaceholder.protocol_hash === protocolHash &&
      asRecord(candidateManifest.approval).eligible === false &&
      asRecord(candidateManifest.activation).permitted === false &&
      candidateManifest.live_execution_prepared === true &&
      protocol.live_execution_prepared === true &&
      authorizationPackage.live_execution_prepared === true &&
      candidateIdentity.live_execution_prepared === true &&
      protocol.approval_eligible === false &&
      protocol.activation_permitted === false &&
      approvalPlaceholder.approval_status === "not_approved" &&
      approvalPlaceholder.activation_status === "not_permitted",
    "formative_conversation_v18_governance_artifact_invalid"
  );
  assertCondition(
    typeof candidateIdentity.deployed_source_closure_hash === "string" &&
      /^[a-f0-9]{64}$/u.test(candidateIdentity.deployed_source_closure_hash) &&
      candidateIdentity.deployed_source_closure_hash ===
        candidateManifest.deployed_source_closure_hash &&
      candidateIdentity.deployed_source_closure_hash ===
        protocol.deployed_source_closure_hash,
    "formative_conversation_v18r2_deployed_source_closure_invalid"
  );
  assertCondition(
    immutableV18Reference.source_revision ===
      "formative-conversation-host-v5-executable-v18r1" &&
      immutableV18Reference.git_commit ===
        "2147e4d340e9adbfd8014433ceede852fbdc54fc" &&
      immutableV18Reference.runtime_candidate_hash ===
        "17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca" &&
      immutableV18Reference.provider_run_id ===
        "fcv5v18r1_provider_20260813160503_9f33cf65" &&
      immutableV18Reference.local_artifact_policy ===
        "committed_hash_reference_only" &&
      immutableV18Reference.required_for_v18r2_live_readiness === false &&
      immutableV18Reference.candidate_artifacts_mutated === false &&
      immutableV18Reference.run_artifacts_mutated === false,
    "formative_conversation_v18r2_immutable_v18_reference_invalid"
  );

  const deployedRuntimeSources = fileIdentities(
    FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS
  );
  const deployedRunnerSources = fileIdentities(
    FORMATIVE_CONVERSATION_V18R2_RUNNER_SOURCE_PATHS
  );
  const deployedRunnerHash = stableHash({
    runner_version: FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
    canonical_loading_mechanism: "node --import tsx",
    plan_live_loader_parity: true,
    dual_role_execution: [
      "student_profiling_agent",
      "formative_conversation_agent"
    ],
    source_files: deployedRunnerSources,
    security_wrapper_hash: deployedSecurityWrapperHash
  });
  const materializerSource = {
    path: "prisma/operational-formative-conversation-v18r2-materialize.ts",
    sha256: formativeConversationV18FileSha256(
      "prisma/operational-formative-conversation-v18r2-materialize.ts"
    )
  };
  const deployedSourceClosureHash = stableHash({
    closure_version: "formative-conversation-v18r2-deployed-source-closure-v1",
    runtime_source_files: deployedRuntimeSources,
    runner_source_files: deployedRunnerSources,
    materializer_source: materializerSource,
    immutable_v18r1_reference_hash: immutableV18ReferenceHash
  });
  assertCondition(
    deployedRunnerHash === protocol.runner_implementation_hash &&
      deployedRunnerHash === candidateIdentity.runner_implementation_hash,
    "formative_conversation_v18r2_runner_source_identity_mismatch"
  );
  assertCondition(
    deployedSourceClosureHash === candidateIdentity.deployed_source_closure_hash &&
      deployedSourceClosureHash === candidateManifest.deployed_source_closure_hash &&
      deployedSourceClosureHash === protocol.deployed_source_closure_hash,
    "formative_conversation_v18r2_deployed_source_closure_mismatch"
  );
  const formativePromptHash =
    recomputedRuntimeManifest.formative_conversation_role.prompt_hash;
  const profilingPromptHash =
    recomputedRuntimeManifest.student_profiling_role.prompt_hash;
  const canonicalEvidenceIdentityImplementationHash =
    deployedRuntimeSources.find(
      (entry) => entry.path === "src/lib/domain/canonical-evidence-identity.ts"
    )?.sha256 ?? "";
  const misconceptionClaimIdentityImplementationHash =
    deployedRuntimeSources.find(
      (entry) => entry.path === "src/lib/domain/misconception-claim-identity.ts"
    )?.sha256 ?? "";
  assertCondition(
    protocol.formative_prompt_hash === formativePromptHash &&
      protocol.profiling_prompt_hash === profilingPromptHash &&
      candidateIdentity.formative_prompt_hash === formativePromptHash &&
      candidateIdentity.profiling_prompt_hash === profilingPromptHash &&
      candidateIdentity.canonical_evidence_identity_implementation_hash ===
        canonicalEvidenceIdentityImplementationHash &&
      candidateIdentity.misconception_claim_identity_implementation_hash ===
        misconceptionClaimIdentityImplementationHash,
    "formative_conversation_v18r2_prompt_or_claim_identity_mismatch"
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
    immutable_v18_reference: immutableV18Reference,
    // Structural compatibility for the shared compiler; the persisted artifact
    // is explicitly the immutable V18R1 lineage reference.
    immutable_v17_reference: immutableV18Reference,
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
    approval_placeholder: approvalPlaceholder,
    deployed_artifact_identity: {
      runtime_candidate_hash: recomputedRuntimeManifest.runtime_candidate_hash,
      evaluation_protocol_hash: protocolHash,
      runner_implementation_hash: deployedRunnerHash,
      candidate_manifest_hash: candidateRevisionManifestHash,
      fixture_manifest_hash: fixtureManifestHash,
      aggregate_fixture_hash: aggregateFixtureHash,
      compiled_plan_hash: committedCompiledPlan.compiled_plan_hash,
      live_environment_contract_hash: liveEnvironmentContractHash,
      dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash,
      provenance_contract_hash: provenanceContractHash,
      deployed_source_closure_hash: deployedSourceClosureHash,
      security_wrapper_hash: deployedSecurityWrapperHash,
      formative_prompt_hash: formativePromptHash,
      profiling_prompt_hash: profilingPromptHash,
      canonical_evidence_identity_implementation_hash:
        canonicalEvidenceIdentityImplementationHash,
      misconception_claim_identity_implementation_hash:
        misconceptionClaimIdentityImplementationHash
    }
  };
}

export type FormativeConversationV18Package = ReturnType<
  typeof loadFormativeConversationV18EvaluationPackage
>;

export function exactFormativeConversationV18LiveAuthorization(
  loaded: FormativeConversationV18Package,
  expectedDeployedGitSha?: string
) {
  return String(loaded.protocol.live_authorization_template)
    .replaceAll("<runtime_candidate_hash>", loaded.runtime_candidate_hash)
    .replaceAll("<evaluation_protocol_hash>", loaded.protocol_hash)
    .replaceAll(
      "<expected_deployed_git_sha>",
      expectedDeployedGitSha ?? "<expected_deployed_git_sha>"
    );
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
    required_live_authorization_text: null,
    future_live_authorization_template:
      exactFormativeConversationV18LiveAuthorization(loaded),
    required_live_command: null,
    future_live_command_template: String(
      loaded.authorization_package.future_live_command_template
    ),
    intended_artifact_root: FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
    plan_artifact_root: FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
    intended_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
    live_execution_prepared: true,
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
    FORMATIVE_CONVERSATION_V5_IMMUTABLE_V18_REFERENCE_PATH,
    FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH,
    FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH
  ].every((filePath) => existsSync(absolute(filePath)));
}
