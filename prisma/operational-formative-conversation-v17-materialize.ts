import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPromptForAgent } from "../src/lib/agents/prompts/registry";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V17_ACTIVE_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V17_ROLLBACK_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V17_RUNTIME_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V17_PRE_FREEZE_CANDIDATE_IDENTITY,
  FORMATIVE_CONVERSATION_V17_V16_PROTOCOL_HASH,
  FORMATIVE_CONVERSATION_V17_V16_RUN_ID,
  FORMATIVE_CONVERSATION_V17_V16_RUNTIME_HASH,
  buildFormativeConversationV17RuntimeCandidateManifest
} from "../src/lib/operational/formative-conversation-v17/candidate";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_MEMORY_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import { FORMATIVE_CONVERSATION_OPENING_VERSION } from "../src/lib/services/student-assessment/formative-conversation/opening-contract";
import { FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";
import { FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_VERSION } from "../src/lib/services/student-assessment/formative-conversation/transition-evidence-closure";
import {
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
  FORMATIVE_CONVERSATION_V17_OFFLINE_REPLAY_ROOT,
  FormativeConversationV17BudgetSchema,
  FormativeConversationV17FixtureSchema,
  type FormativeConversationV17Fixture
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/contracts";
import { compileFormativeConversationV17ExecutionPlan } from "../src/lib/operational/formative-conversation-v5-evaluation-v17/compiler";
import {
  FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT,
  FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/live-environment";
import { FORMATIVE_CONVERSATION_V17_DISPATCH_CHECKPOINT_VERSION } from "../src/lib/operational/formative-conversation-v5-evaluation-v17/dispatch-checkpoint";
import {
  FORMATIVE_CONVERSATION_V17_SECURITY_WRAPPER_SOURCE_PATHS,
  formativeConversationV17SecurityWrapperFingerprint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/security-release";
import { FORMATIVE_CONVERSATION_V17_COMMITTED_SOURCE_PATHS } from "../src/lib/operational/formative-conversation-v5-evaluation-v17/provenance";
import { materializeFormativeConversationV17Fixtures } from "./formative-conversation-v17-fixture-materialize";

const EXPECTED_RUNTIME_HASH =
  "b077ba062c37340eac2918a2578f118c36fa852006196d31ef4735598ed21e6e";
const V16_IDENTITY_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v16/candidate-identity.json";
const V16_IDENTITY_FILE_SHA256 =
  "57cfbded76f74091a6fc6a40d418443c6d9d62bf1be56489e7eef7be1f083c43";
const V16_REPLAY_FILE_SHA256 = {
  fcv5_05_sound_profile_transition:
    "cde1a337d6a5c049886e99fbf81ecfdd4748d1338b9ee10dfe40e86065f5cf7e",
  fcv5_06_largely_improved_temporal:
    "c4e3c7f3f81f327976081b642f8d1405f94b9a8193a9161091e078f7133af316",
  fcv5_08_mixed_resolved_evidence:
    "125e89924201cc1bbb2840ce67d19d76c3158a50bf7cf07a5598a6b55f6534c8"
} as const;

const runnerSourcePaths = [
  "scripts/operational-formative-conversation-v5-v17-process-local-runner.mjs",
  "scripts/operational-formative-conversation-v5-v17-launcher.mjs",
  "prisma/operational-formative-conversation-v5-v17-evaluate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/package.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/evaluation-accounting.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/live-environment.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/dispatch-checkpoint.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/provenance.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/security-release.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v17/service.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts"
] as const;

const verificationSourcePaths = [
  "package.json",
  "prisma/formative-conversation-v17-fixture-materialize.ts",
  "prisma/operational-formative-conversation-v17-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v17-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v17-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v17-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v17-dispatch-checkpoint-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v17-security-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v17-provenance-smoke-test.ts",
  "prisma/helpers/formative-conversation-v5-v17-test-environment.ts",
  "prisma/formative-conversation-v17-misconception-identity-smoke-test.ts",
  "prisma/formative-conversation-v17-profiling-canary-smoke-test.ts",
  "prisma/formative-conversation-v17-transition-runtime-smoke-test.ts",
  "prisma/formative-conversation-v17-runtime-database-smoke-test.ts",
  "prisma/formative-conversation-v17-v16-replay-smoke-test.ts",
  "prisma/formative-conversation-v17-v16-replay-fixture-materialize.ts",
  "prisma/formative-conversation-profile-transition-v4-smoke-test.ts",
  "prisma/formative-conversation-semantic-regeneration-v2-smoke-test.ts",
  "prisma/student-research-export-integrity-smoke-test.ts",
  "prisma/student-teacher-readable-transcript-smoke-test.ts",
  "docs/operations/FORMATIVE_CONVERSATION_V17_CLAIM_IDENTITY.md"
] as const;

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileIdentity(relativePath: string) {
  const bytes = await readFile(path.resolve(process.cwd(), relativePath));
  return { path: relativePath, sha256: sha256(bytes) };
}

async function writeJson(relativePath: string, value: unknown) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const absolutePath = path.resolve(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, serialized, "utf8");
  return sha256(serialized);
}

async function writeText(relativePath: string, value: string) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, value, "utf8");
  return sha256(value);
}

async function immutableV16Reference() {
  const bytes = await readFile(path.resolve(process.cwd(), V16_IDENTITY_PATH));
  if (sha256(bytes) !== V16_IDENTITY_FILE_SHA256) {
    throw new Error("formative_conversation_v17_v16_identity_drift");
  }
  const identity = JSON.parse(bytes.toString("utf8")) as JsonRecord;
  if (
    identity.runtime_candidate_hash !== FORMATIVE_CONVERSATION_V17_V16_RUNTIME_HASH ||
    identity.protocol_hash !== FORMATIVE_CONVERSATION_V17_V16_PROTOCOL_HASH
  ) {
    throw new Error("formative_conversation_v17_v16_reference_invalid");
  }
  const replayFixtures = await Promise.all(
    Object.entries(V16_REPLAY_FILE_SHA256).map(
      async ([caseId, expectedSha256]) => {
        const replayPath = `${FORMATIVE_CONVERSATION_V17_OFFLINE_REPLAY_ROOT}/${caseId}.json`;
        const identity = await fileIdentity(replayPath);
        if (identity.sha256 !== expectedSha256) {
          throw new Error(`formative_conversation_v17_v16_replay_drift:${caseId}`);
        }
        return {
          case_id: caseId,
          path: replayPath,
          file_sha256: identity.sha256
        };
      }
    )
  );
  return {
    reference_version: "formative-conversation-v17-immutable-v16-reference-v1",
    source_revision: "formative-conversation-host-v5-executable-v16",
    runtime_candidate_hash: FORMATIVE_CONVERSATION_V17_V16_RUNTIME_HASH,
    protocol_hash: FORMATIVE_CONVERSATION_V17_V16_PROTOCOL_HASH,
    source_provider_run_id: FORMATIVE_CONVERSATION_V17_V16_RUN_ID,
    candidate_identity_file_sha256: V16_IDENTITY_FILE_SHA256,
    preserved_case_replays: [
      "fcv5_05_sound_profile_transition",
      "fcv5_06_largely_improved_temporal",
      "fcv5_08_mixed_resolved_evidence"
    ],
    offline_replay_fixtures: replayFixtures,
    local_artifact_policy:
      "hash_reference_only_not_required_for_v17_live_readiness",
    required_for_v17_live_readiness: false,
    historical_records_mutated: false
  } as const;
}

async function main() {
  const runtimeManifest = buildFormativeConversationV17RuntimeCandidateManifest();
  if (runtimeManifest.runtime_candidate_hash !== EXPECTED_RUNTIME_HASH) {
    throw new Error("formative_conversation_v17_runtime_candidate_hash_drift");
  }
  const profilingPrompt = getPromptForAgent("student_profiling_agent");
  const immutableV16 = await immutableV16Reference();
  await materializeFormativeConversationV17Fixtures();

  const runtimeSources = await Promise.all(
    FORMATIVE_CONVERSATION_V17_RUNTIME_SOURCE_PATHS.map(fileIdentity)
  );
  const runnerSources = await Promise.all(runnerSourcePaths.map(fileIdentity));
  const verificationSources = await Promise.all(
    verificationSourcePaths.map(fileIdentity)
  );
  const materializerIdentity = await fileIdentity(
    "prisma/operational-formative-conversation-v17-materialize.ts"
  );

  const fixtureRecords: Array<{
    fixture: FormativeConversationV17Fixture;
    reference: {
      case_id: string;
      case_type: string;
      order: number;
      path: string;
      fixture_hash: string;
      file_sha256: string;
    };
  }> = [];
  for (const caseId of FORMATIVE_CONVERSATION_V5_CASE_ORDER) {
    const fixturePath = `${FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT}/${caseId}.json`;
    const fixture = FormativeConversationV17FixtureSchema.parse(
      JSON.parse(await readFile(path.resolve(process.cwd(), fixturePath), "utf8"))
    );
    const { fixture_hash: ignored, ...hashable } = fixture;
    void ignored;
    if (stableHash(hashable) !== fixture.fixture_hash) {
      throw new Error(`formative_conversation_v17_fixture_hash_invalid:${caseId}`);
    }
    fixtureRecords.push({
      fixture,
      reference: {
        case_id: fixture.case_id,
        case_type: fixture.case_type,
        order: fixture.case_order,
        path: fixturePath,
        fixture_hash: fixture.fixture_hash,
        file_sha256: (await fileIdentity(fixturePath)).sha256
      }
    });
  }
  const aggregateFixtureHash = stableHash(
    fixtureRecords.map(({ reference }) => ({
      case_id: reference.case_id,
      case_order: reference.order,
      fixture_hash: reference.fixture_hash
    }))
  );
  const fixtureMaterial = {
    manifest_version: "formative-conversation-v17-fixture-manifest-v1",
    fixture_hash_semantics: "stable_hash_with_fixture_hash_omitted",
    fixture_count: 11,
    profiling_contract_canary_count: 3,
    formative_conversation_case_count: 8,
    fixed_case_order: [...FORMATIVE_CONVERSATION_V5_CASE_ORDER],
    fixtures: fixtureRecords.map(({ reference }) => reference),
    aggregate_fixture_hash: aggregateFixtureHash,
    immutable_v16_reference_hash: stableHash(immutableV16),
    verification_source_files: verificationSources,
    provider_calls_during_materialization: 0,
    model_auth_requests_during_materialization: 0,
    dispatch_checkpoints_during_materialization: 0
  };
  const fixtureManifestHash = stableHash(fixtureMaterial);

  const securitySourceIdentities = await Promise.all(
    FORMATIVE_CONVERSATION_V17_SECURITY_WRAPPER_SOURCE_PATHS.map(fileIdentity)
  );
  const securityWrapperHash =
    formativeConversationV17SecurityWrapperFingerprint(
      Object.fromEntries(
        securitySourceIdentities.map((entry) => [entry.path, entry.sha256])
      )
    );
  const securityWrapperMaterial = {
    manifest_version: "formative-conversation-v17-security-wrapper-manifest-v1",
    source_files: securitySourceIdentities,
    exact_secret_scan_before_clear_required: true,
    zip_entries_scanned: true,
    buffered_output_scanned: true,
    owner_only_atomic_release: true,
    secrets_persisted: false
  };
  const securityWrapperManifestHash = stableHash({
    ...securityWrapperMaterial,
    security_wrapper_hash: securityWrapperHash
  });

  const runnerMaterial = {
    runner_version: "formative-conversation-v5-protocol-runner-v17",
    canonical_loading_mechanism: "node --import tsx",
    plan_live_loader_parity: true,
    dual_role_execution: [
      "student_profiling_agent",
      "formative_conversation_agent"
    ],
    source_files: runnerSources,
    security_wrapper_hash: securityWrapperHash
  };
  const runnerHash = stableHash(runnerMaterial);

  const environmentMaterial = {
    contract_version: FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
    canonical_service: {
      required_name: "conversational-mcq",
      deprecated_name_forbidden: "conversational-mcq-staging"
    },
    launcher: {
      version: FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
      mechanism: FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
      canonical_loader_version: FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
      process_local_runner:
        "scripts/operational-formative-conversation-v5-v17-process-local-runner.mjs",
      canonical_launcher:
        "scripts/operational-formative-conversation-v5-v17-launcher.mjs",
      executable_cli:
        "prisma/operational-formative-conversation-v5-v17-evaluate.ts",
      plan_live_loading_identical: true,
      bare_node_forbidden: true
    },
    checks: [
      "canonical_service_identity",
      "database_identity",
      "database_connectivity",
      "migration_set_current",
      "active_approval_bundle_readable_and_exact",
      "rollback_bundle_identity_exact",
      "student_profiling_model_configuration_present",
      "formative_conversation_model_configuration_present",
      "openai_configuration_present",
      "research_pseudonymization_configuration_present",
      "runtime_candidate_identity_exact",
      "evaluation_protocol_identity_exact"
    ],
    required_injected_environment: [
      ...FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT
    ],
    secret_environment: [...FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT],
    secret_injection: {
      mechanism: "owner_only_one_use_fifo_to_process_local_child",
      visible_command_line_forbidden: true,
      persistence_forbidden: true,
      exact_value_scan_before_clear_required: true
    },
    active_and_candidate_identities_separate: true,
    preserved_active_runtime_hash: FORMATIVE_CONVERSATION_V17_ACTIVE_RUNTIME_HASH,
    preserved_rollback_runtime_hash: FORMATIVE_CONVERSATION_V17_ROLLBACK_RUNTIME_HASH,
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    pre_freeze_candidate_identity:
      FORMATIVE_CONVERSATION_V17_PRE_FREEZE_CANDIDATE_IDENTITY,
    render_access_during_materialization: false,
    provider_calls_during_materialization: 0,
    model_auth_requests_during_materialization: 0
  };
  const environmentContractHash = stableHash(environmentMaterial);

  const dispatchSource = await fileIdentity(
    "src/lib/operational/formative-conversation-v5-evaluation-v17/dispatch-checkpoint.ts"
  );
  const dispatchMaterial = {
    contract_version: "formative-conversation-v17-dispatch-contract-v1",
    checkpoint_version: FORMATIVE_CONVERSATION_V17_DISPATCH_CHECKPOINT_VERSION,
    writer_source: dispatchSource.path,
    writer_source_sha256: dispatchSource.sha256,
    exact_checkpoint_count: 1,
    boundary: "immediately_before_first_generation_request",
    plan_mode_checkpoint_count: 0,
    exclusive_create_required: true,
    rerun_after_checkpoint_forbidden: true,
    immutable_identity_fields: [
      "provider_run_id",
      "derived_evaluation_id",
      "runtime_candidate_hash",
      "evaluation_protocol_hash",
      "runner_implementation_hash",
      "fixture_manifest_hash",
      "aggregate_fixture_hash",
      "compiled_plan_hash",
      "live_environment_contract_hash",
      "dispatch_checkpoint_contract_hash"
    ],
    shared_dispatch_boundary_for_both_roles: true,
    checkpoint_precedes_provider_request: true,
    provider_request_started_at_checkpoint: false
  };
  const checkpointHash = stableHash(dispatchMaterial);

  const provenanceMaterial = {
    contract_version: "formative-conversation-v17-provenance-contract-v1",
    future_committed_source_required: true,
    current_source_commit: null,
    clean_checkout_rematerialization_required: true,
    working_tree_only_dependencies_forbidden: true,
    v16_artifact_mutation_forbidden: true,
    immutable_v16_reference_hash: stableHash(immutableV16),
    committed_source_paths: [...FORMATIVE_CONVERSATION_V17_COMMITTED_SOURCE_PATHS],
    runtime_source_files: runtimeSources,
    runner_source_files: runnerSources,
    verification_source_files: verificationSources,
    materializer_source: materializerIdentity
  };
  const provenanceContractHash = stableHash(provenanceMaterial);

  const budget = FormativeConversationV17BudgetSchema.parse({
    base_profiling_call_count: 3,
    base_formative_call_count: 21,
    expected_logical_call_count: 24,
    maximum_semantic_regeneration_count: 11,
    maximum_logical_call_count: 35,
    expected_provider_attempt_count: 24,
    maximum_provider_attempt_count: 105,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_token_count: 1_100_000,
    maximum_output_token_count: 125_500,
    maximum_total_token_count: 1_225_500,
    maximum_wall_clock_duration_ms: 7_200_000,
    maximum_concurrency: 1,
    maximum_cost_usd: 40,
    pricing_metadata_status: "unavailable",
    cost_enforcement:
      "operator_ceiling_required_actual_estimate_recorded_when_available",
    maximum_semantic_regenerations_per_agent_call: 1
  });
  const liveAuthorizationTemplate =
    "I authorize one live execution of formative-conversation-host-v5-executable-v17 for runtime candidate hash <runtime_candidate_hash> and evaluation protocol hash <evaluation_protocol_hash>, using exactly 11 isolated synthetic cases with 3 profiling base calls, 21 formative base calls, at most 35 logical calls, 105 provider attempts, 1100000 input tokens, 125500 output tokens, 1225500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 40 ceiling.";
  const protocolMaterial = {
    protocol_version: "formative-conversation-host-v5-executable-v17",
    status: "frozen_executable_not_run",
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    pre_freeze_candidate_identity:
      FORMATIVE_CONVERSATION_V17_PRE_FREEZE_CANDIDATE_IDENTITY,
    formative_prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
    formative_prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    profiling_prompt_version: profilingPrompt.prompt_version,
    profiling_prompt_hash: profilingPrompt.prompt_hash,
    target_identity: {
      runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
      pre_freeze_candidate_identity:
        FORMATIVE_CONVERSATION_V17_PRE_FREEZE_CANDIDATE_IDENTITY,
      model_snapshot: "gpt-5.6-sol",
      reasoning_effort: "medium",
      max_output_tokens: 3500,
      prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
      safety_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
      memory_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
      opening_validator_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
      profile_transition_validator_version:
        FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
      transition_evidence_closure_version:
        FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_VERSION
    },
    profiling_identity: {
      agent_name: "student_profiling_agent",
      model_snapshot: "gpt-5.6-terra",
      reasoning_effort: "medium",
      max_output_tokens: 4000,
      prompt_version: profilingPrompt.prompt_version,
      prompt_hash: profilingPrompt.prompt_hash,
      schema_version: profilingPrompt.schema_version,
      platform_assigns_machine_ids_after_validation: true
    },
    runner_implementation_hash: runnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    live_environment_contract_hash: environmentContractHash,
    dispatch_checkpoint_contract_hash: checkpointHash,
    security_wrapper_hash: securityWrapperHash,
    provenance_contract_hash: provenanceContractHash,
    immutable_v16_reference_hash: stableHash(immutableV16),
    budget,
    fixture_count: 11,
    fixed_case_order: [...FORMATIVE_CONVERSATION_V5_CASE_ORDER],
    intended_artifacts: [...FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS],
    call_graph: {
      profiling_base_calls: 3,
      formative_base_calls: 21,
      semantic_regeneration_calls_maximum: 11,
      transport_retries_per_logical_call_maximum: 2
    },
    isolation: {
      synthetic_only: true,
      case_namespaces_isolated: true,
      classroom_collision_forbidden: true,
      approval_activation_forbidden: true
    },
    semantic_regeneration_policy_frozen: true,
    security_attestation_policy_frozen: true,
    committed_source_dependency_closure_ready: true,
    live_execution_prepared: true,
    live_execution_preparation_blockers: [],
    dispatch_checkpoint_permitted: true,
    exact_live_authorization_required: true,
    live_authorization_template: liveAuthorizationTemplate,
    approval_eligible: false,
    activation_permitted: false
  };
  const protocolHash = stableHash(protocolMaterial);

  const compiledPlan = compileFormativeConversationV17ExecutionPlan({
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    evaluation_protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    live_environment_contract_hash: environmentContractHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    fixtures: fixtureRecords.map(({ fixture }) => fixture),
    fixture_file_sha256_by_case: Object.fromEntries(
      fixtureRecords.map(({ reference }) => [
        reference.case_id,
        reference.file_sha256
      ])
    ),
    budget
  });

  const exactAuthorization = liveAuthorizationTemplate
    .replace("<runtime_candidate_hash>", EXPECTED_RUNTIME_HASH)
    .replace("<evaluation_protocol_hash>", protocolHash);
  const exactFutureLiveCommand = [
    "node --import tsx scripts/operational-formative-conversation-v5-v17-process-local-runner.mjs",
    '--env-fifo "$FORMATIVE_CONVERSATION_V17_ENV_FIFO" --',
    "--mode=live",
    `--runtime-candidate-hash=${EXPECTED_RUNTIME_HASH}`,
    `--evaluation-protocol-hash=${protocolHash}`,
    "--confirm-live-provider-calls",
    `--authorization=${JSON.stringify(exactAuthorization)}`
  ].join(" ");
  const authorizationPackage = {
    authorization_package_version:
      "formative-conversation-v17-future-live-authorization-v1",
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    compiled_plan_hash: compiledPlan.compiled_plan_hash,
    budget,
    fixture_count: 11,
    profiling_contract_canary_count: 3,
    formative_conversation_case_count: 8,
    exact_future_authorization_text: exactAuthorization,
    exact_future_live_command: exactFutureLiveCommand,
    secure_environment_channel:
      "owner_only_one_use_fifo_injected_into_single_child_process",
    live_execution_authorized: false,
    approval_eligible: false,
    activation_permitted: false
  };

  const operationalConfiguration = {
    roles: {
      student_profiling_agent: {
        model_name: "gpt-5.6-terra",
        reasoning_effort: "medium",
        max_output_tokens: 4000
      },
      formative_conversation_agent: {
        model_name: "gpt-5.6-sol",
        reasoning_effort: "medium",
        max_output_tokens: 3500
      }
    },
    runtime_policy: {
      provider_timeout_ms: 90000,
      provider_max_retries: 2,
      role_live_toggles: {
        student_communication_agent: true,
        topic_dialogue_agent: true,
        formative_conversation_agent: true
      },
      topic_dialogue_policy: {
        maximum_student_turns: 10,
        recent_raw_turn_window: 12,
        maximum_student_message_characters: 5000,
        assessment_system_questions_allowed: true
      }
    }
  };
  const sourceConfigurationMaterial = {
    configuration_version: "formative-conversation-v17-source-configuration-v1",
    evaluated_roles: [
      "student_profiling_agent",
      "formative_conversation_agent"
    ],
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    active_runtime_hash: FORMATIVE_CONVERSATION_V17_ACTIVE_RUNTIME_HASH,
    rollback_runtime_hash: FORMATIVE_CONVERSATION_V17_ROLLBACK_RUNTIME_HASH,
    operational_configuration: operationalConfiguration,
    live_configuration_changed: false,
    render_accessed: false
  };
  const sourceConfigurationHash = stableHash(sourceConfigurationMaterial);

  const candidateManifestMaterial = {
    manifest_version:
      "formative-conversation-host-v5-executable-candidate-revision-v17",
    candidate_state: "inactive",
    approval: { eligible: false, evidence_created: false },
    activation: { permitted: false },
    runtime_behavior_changed: true,
    instructional_behavior_changed: false,
    database_schema_changed: false,
    runtime_change_scope: "canonical_misconception_claim_identity_only",
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    pre_freeze_candidate_identity:
      FORMATIVE_CONVERSATION_V17_PRE_FREEZE_CANDIDATE_IDENTITY,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    fixture_manifest_hash: fixtureManifestHash,
    compiled_plan_hash: compiledPlan.compiled_plan_hash,
    environment_contract_hash: environmentContractHash,
    dispatch_checkpoint_contract_hash: checkpointHash,
    security_wrapper_hash: securityWrapperHash,
    provenance_contract_hash: provenanceContractHash,
    source_configuration_hash: sourceConfigurationHash,
    preserved_active_runtime_hash: FORMATIVE_CONVERSATION_V17_ACTIVE_RUNTIME_HASH,
    preserved_rollback_runtime_hash: FORMATIVE_CONVERSATION_V17_ROLLBACK_RUNTIME_HASH,
    immutable_v16_reference_hash: stableHash(immutableV16),
    committed_source_dependency_closure_ready: true,
    live_execution_prepared: true,
    future_live_evaluation_requires_committed_source_freeze: true,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  };
  const candidateManifestHash = stableHash(candidateManifestMaterial);

  const immutableV16Sha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/immutable-v16-reference.json`,
    immutableV16
  );
  const runtimeManifestSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/runtime-candidate-manifest.json`,
    runtimeManifest
  );
  const fixtureManifestSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixture-manifest.json`,
    { ...fixtureMaterial, fixture_manifest_hash: fixtureManifestHash }
  );
  const protocolSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/executable-evaluation-protocol.json`,
    { ...protocolMaterial, protocol_hash: protocolHash }
  );
  const environmentSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-environment-contract.json`,
    { ...environmentMaterial, environment_contract_hash: environmentContractHash }
  );
  const checkpointSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/dispatch-checkpoint-contract.json`,
    { ...dispatchMaterial, dispatch_checkpoint_contract_hash: checkpointHash }
  );
  const provenanceSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/provenance-contract.json`,
    { ...provenanceMaterial, provenance_contract_hash: provenanceContractHash }
  );
  const securitySha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/security-wrapper-manifest.json`,
    {
      ...securityWrapperMaterial,
      security_wrapper_hash: securityWrapperHash,
      security_wrapper_manifest_hash: securityWrapperManifestHash
    }
  );
  const compiledPlanSha = await writeJson(
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
    compiledPlan
  );
  const sourceConfigurationSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/source-configuration.json`,
    { ...sourceConfigurationMaterial, source_configuration_hash: sourceConfigurationHash }
  );
  const authorizationSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-execution-authorization.json`,
    authorizationPackage
  );
  const liveDocumentSha = await writeText(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/LIVE_EXECUTION.md`,
    [
      "# V17 Live Execution Freeze",
      "",
      "This candidate is inactive and has not been authorized or executed.",
      "",
      "## Required authorization",
      "",
      exactAuthorization,
      "",
      "## Canonical command",
      "",
      "```sh",
      exactFutureLiveCommand,
      "```",
      "",
      "The FIFO must be owner-only and one-use. Secrets must never appear on the command line or in artifacts.",
      ""
    ].join("\n")
  );
  const approvalPlaceholder = {
    placeholder_version: "formative-conversation-v17-approval-placeholder-v1",
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    protocol_hash: protocolHash,
    approval_status: "not_approved",
    activation_status: "not_permitted",
    approval_evidence_created: false,
    approval_eligible: false,
    activation_permitted: false,
    reason:
      "The executable package is frozen but has not been authorized, run, human-reviewed, approved, or activated."
  };
  const approvalSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/approval-evidence-placeholder.json`,
    approvalPlaceholder
  );
  const candidateManifestSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-manifest.json`,
    { ...candidateManifestMaterial, candidate_manifest_hash: candidateManifestHash }
  );
  await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-identity.json`,
    {
      identity_version: "formative-conversation-v17-candidate-identity-v1",
      pre_freeze_candidate_identity:
        FORMATIVE_CONVERSATION_V17_PRE_FREEZE_CANDIDATE_IDENTITY,
      runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
      formative_prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
      profiling_prompt_hash: profilingPrompt.prompt_hash,
      protocol_hash: protocolHash,
      runner_implementation_hash: runnerHash,
      materializer_implementation_hash: materializerIdentity.sha256,
      fixture_manifest_hash: fixtureManifestHash,
      aggregate_fixture_hash: aggregateFixtureHash,
      compiled_plan_hash: compiledPlan.compiled_plan_hash,
      environment_contract_hash: environmentContractHash,
      dispatch_checkpoint_contract_hash: checkpointHash,
      security_wrapper_hash: securityWrapperHash,
      provenance_contract_hash: provenanceContractHash,
      candidate_manifest_hash: candidateManifestHash,
      source_configuration_hash: sourceConfigurationHash,
      immutable_v16_reference_hash: stableHash(immutableV16),
      file_sha256: {
        runtime_candidate_manifest: runtimeManifestSha,
        candidate_manifest: candidateManifestSha,
        executable_evaluation_protocol: protocolSha,
        fixture_manifest: fixtureManifestSha,
        compiled_execution_plan: compiledPlanSha,
        live_environment_contract: environmentSha,
        dispatch_checkpoint_contract: checkpointSha,
        provenance_contract: provenanceSha,
        security_wrapper_manifest: securitySha,
        source_configuration: sourceConfigurationSha,
        immutable_v16_reference: immutableV16Sha,
        approval_evidence_placeholder: approvalSha,
        live_execution_authorization: authorizationSha,
        live_execution_document: liveDocumentSha
      },
      live_execution_prepared: true,
      approval_eligible: false,
      activation_permitted: false,
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    }
  );

  console.log(JSON.stringify({
    status: "materialized",
    root: FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    formative_prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    profiling_prompt_hash: profilingPrompt.prompt_hash,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    candidate_manifest_hash: candidateManifestHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    compiled_plan_hash: compiledPlan.compiled_plan_hash,
    environment_contract_hash: environmentContractHash,
    dispatch_checkpoint_contract_hash: checkpointHash,
    security_wrapper_hash: securityWrapperHash,
    provenance_contract_hash: provenanceContractHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    case_count: 11,
    base_profiling_calls: 3,
    base_formative_calls: 21,
    maximum_logical_calls: 35,
    maximum_provider_attempts: 105,
    live_execution_prepared: true,
    approval_eligible: false,
    activation_permitted: false,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  }, null, 2));
}

void main();
