import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPromptForAgent } from "../src/lib/agents/prompts/registry";
import { CANONICAL_EVIDENCE_IDENTITY_VERSION } from "../src/lib/domain/canonical-evidence-identity";
import { MISCONCEPTION_CLAIM_IDENTITY_VERSION } from "../src/lib/domain/misconception-claim-identity";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V18R2_PRESERVED_ACTIVE_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V18R2_PRESERVED_ROLLBACK_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V18R2_REQUIRED_NO_PROVIDER_TESTS,
  FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V18R2_VERIFICATION_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT,
  FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1,
  buildFormativeConversationV18R2RuntimeCandidateManifest
} from "../src/lib/operational/formative-conversation-v18r2/candidate";
import {
  FORMATIVE_CONVERSATION_MEMORY_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_PROFILE_RECOMMENDATION_VERSION,
  FORMATIVE_CONVERSATION_V18R2_PROFILE_SNAPSHOT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { FORMATIVE_CONVERSATION_OPENING_VERSION } from "../src/lib/services/student-assessment/formative-conversation/opening-contract";
import {
  FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-update-v18";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
  FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS,
  FormativeConversationV18BudgetSchema,
  FormativeConversationV18FixtureSchema,
  type FormativeConversationV18Fixture
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/contracts";
import { compileFormativeConversationV18ExecutionPlan } from "../src/lib/operational/formative-conversation-v5-evaluation-v18/compiler";
import {
  FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT,
  FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/live-environment";
import { FORMATIVE_CONVERSATION_V18R2_DISPATCH_CHECKPOINT_VERSION } from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/dispatch-checkpoint";
import {
  FORMATIVE_CONVERSATION_V18R2_SECURITY_WRAPPER_SOURCE_PATHS,
  formativeConversationV18SecurityWrapperFingerprint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/security-release";
import {
  FORMATIVE_CONVERSATION_V18R2_COMMITTED_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V18R2_RUNNER_SOURCE_PATHS
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/provenance";
import { copyFile } from "node:fs/promises";

const EXPECTED_RUNTIME_HASH =
  "db71fa1ed5e9d5ce007bddf21a102cd006ab337584708386a9c4e081a556d58e";
const IMMUTABLE_V18R1_FIXTURE_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v18r1/fixtures";

const verificationSourcePaths = [
  ...FORMATIVE_CONVERSATION_V18R2_VERIFICATION_SOURCE_PATHS
] as const;

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

function immutableV18R1Reference() {
  return {
    ...FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1,
    systematic_blocker:
      "continue_conversation_mixed_observation_evidence_with_prohibited_transition_state",
    v18r2_counterfactual_replay_only: true,
    required_for_v18r2_live_readiness: false,
    candidate_artifacts_mutated: false,
    run_artifacts_mutated: false
  } as const;
}

async function copyImmutableV18R1Fixtures() {
  await mkdir(path.resolve(process.cwd(), FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT), {
    recursive: true
  });
  for (const caseId of FORMATIVE_CONVERSATION_V5_CASE_ORDER) {
    await copyFile(
      path.resolve(
        process.cwd(),
        IMMUTABLE_V18R1_FIXTURE_ROOT,
        `${caseId}.json`
      ),
      path.resolve(process.cwd(), FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT, `${caseId}.json`)
    );
  }
}

async function main() {
  const runtimeManifest = buildFormativeConversationV18R2RuntimeCandidateManifest();
  if (runtimeManifest.runtime_candidate_hash !== EXPECTED_RUNTIME_HASH) {
    throw new Error("formative_conversation_v18r2_runtime_candidate_hash_drift");
  }
  const profilingPrompt = getPromptForAgent("student_profiling_agent");
  const immutableV18R1 = immutableV18R1Reference();
  await copyImmutableV18R1Fixtures();

  const runtimeSources = await Promise.all(
    FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS.map(fileIdentity)
  );
  const runnerSources = await Promise.all(
    FORMATIVE_CONVERSATION_V18R2_RUNNER_SOURCE_PATHS.map(fileIdentity)
  );
  const verificationSources = await Promise.all(
    verificationSourcePaths.map(fileIdentity)
  );
  const materializerIdentity = await fileIdentity(
    "prisma/operational-formative-conversation-v18r2-materialize.ts"
  );
  const preFreezeLineageSources = await Promise.all(
    [
      `${FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT}/candidate-identity.json`,
      `${FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT}/verification-manifest.json`,
      `${FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT}/v18r1-forensic-report.json`,
      `${FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT}/fixtures/v18r1-seven-failed-primary-candidates.json`
    ].map(fileIdentity)
  );
  const forensicLiveLineageIdentityHash = stableHash({
    identity_version: "formative-conversation-v18r2-forensic-live-lineage-v1",
    immutable_v18r1_reference_hash: stableHash(immutableV18R1),
    pre_freeze_lineage_sources: preFreezeLineageSources
  });
  const verificationIdentityHash = stableHash({
    identity_version: "formative-conversation-v18r2-verification-identity-v1",
    verification_source_files: verificationSources,
    required_no_provider_tests: [
      ...FORMATIVE_CONVERSATION_V18R2_REQUIRED_NO_PROVIDER_TESTS
    ],
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  });

  const fixtureRecords: Array<{
    fixture: FormativeConversationV18Fixture;
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
    const fixture = FormativeConversationV18FixtureSchema.parse(
      JSON.parse(await readFile(path.resolve(process.cwd(), fixturePath), "utf8"))
    );
    const { fixture_hash: ignored, ...hashable } = fixture;
    void ignored;
    if (stableHash(hashable) !== fixture.fixture_hash) {
      throw new Error(`formative_conversation_v18r2_fixture_hash_invalid:${caseId}`);
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
    manifest_version: "formative-conversation-v18r2-fixture-manifest-v1",
    fixture_hash_semantics: "stable_hash_with_fixture_hash_omitted",
    fixture_count: 12,
    profiling_contract_canary_count: 3,
    formative_conversation_case_count: 8,
    dissertation_end_to_end_case_count: 1,
    fixed_case_order: [...FORMATIVE_CONVERSATION_V5_CASE_ORDER],
    fixtures: fixtureRecords.map(({ reference }) => reference),
    aggregate_fixture_hash: aggregateFixtureHash,
    immutable_v18r1_reference_hash: stableHash(immutableV18R1),
    verification_source_files: verificationSources,
    verification_identity_hash: verificationIdentityHash,
    forensic_live_lineage_identity_hash: forensicLiveLineageIdentityHash,
    required_no_provider_tests: [
      ...FORMATIVE_CONVERSATION_V18R2_REQUIRED_NO_PROVIDER_TESTS
    ],
    provider_calls_during_materialization: 0,
    model_auth_requests_during_materialization: 0,
    dispatch_checkpoints_during_materialization: 0
  };
  const fixtureManifestHash = stableHash(fixtureMaterial);

  const securitySourceIdentities = await Promise.all(
    FORMATIVE_CONVERSATION_V18R2_SECURITY_WRAPPER_SOURCE_PATHS.map(fileIdentity)
  );
  const securityWrapperHash =
    formativeConversationV18SecurityWrapperFingerprint(
      Object.fromEntries(
        securitySourceIdentities.map((entry) => [entry.path, entry.sha256])
      )
    );
  const securityWrapperMaterial = {
    manifest_version: "formative-conversation-v18r2-security-wrapper-manifest-v1",
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
    runner_version: FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
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
        "scripts/operational-formative-conversation-v5-v18r2-process-local-runner.mjs",
      canonical_launcher:
        "scripts/operational-formative-conversation-v5-v18r2-launcher.mjs",
      executable_cli:
        "prisma/operational-formative-conversation-v5-v18r2-evaluate.ts",
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
      "render_git_commit_present_and_valid",
      "operator_authorized_git_sha_present_and_valid",
      "render_and_operator_git_sha_equal",
      "deployed_artifact_frozen_identity_exact",
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
    preserved_active_runtime_hash:
      FORMATIVE_CONVERSATION_V18R2_PRESERVED_ACTIVE_RUNTIME_HASH,
    preserved_rollback_runtime_hash:
      FORMATIVE_CONVERSATION_V18R2_PRESERVED_ROLLBACK_RUNTIME_HASH,
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    deployment_provenance: {
      mode: "render_deployed_artifact",
      version: "deployment-source-provenance-v1",
      git_runtime_dependency_forbidden: true,
      git_metadata_dependency_forbidden: true,
      required_runtime_environment: ["RENDER_GIT_COMMIT"],
      required_operator_input: "--expected-deployed-git-sha",
      operator_sha_embedded_in_source: false
    },
    render_access_during_materialization: false,
    provider_calls_during_materialization: 0,
    model_auth_requests_during_materialization: 0
  };
  const environmentContractHash = stableHash(environmentMaterial);

  const dispatchSource = await fileIdentity(
    "src/lib/operational/formative-conversation-v5-evaluation-v18r2/dispatch-checkpoint.ts"
  );
  const dispatchMaterial = {
    contract_version: "formative-conversation-v18r2-dispatch-contract-v1",
    checkpoint_version: FORMATIVE_CONVERSATION_V18R2_DISPATCH_CHECKPOINT_VERSION,
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
      "candidate_manifest_hash",
      "fixture_manifest_hash",
      "aggregate_fixture_hash",
      "compiled_plan_hash",
      "live_environment_contract_hash",
      "dispatch_checkpoint_contract_hash",
      "provenance_contract_hash",
      "source_commit_sha",
      "deployment_reported_commit_sha",
      "operator_authorized_commit_sha",
      "deployed_artifact_identity_status",
      "execution_authorization_identity_hash",
      "deployed_artifact_provenance_hash"
    ],
    shared_dispatch_boundary_for_both_roles: true,
    checkpoint_precedes_provider_request: true,
    provider_request_started_at_checkpoint: false
  };
  const checkpointHash = stableHash(dispatchMaterial);

  const provenanceMaterial = {
    contract_version: "formative-conversation-v18r2-dual-boundary-provenance-contract-v1",
    future_committed_source_required: true,
    current_source_commit: null,
    clean_checkout_rematerialization_required: true,
    working_tree_only_dependencies_forbidden: true,
    v18_artifact_mutation_forbidden: true,
    immutable_v18r1_reference_hash: stableHash(immutableV18R1),
    committed_source_paths: [...FORMATIVE_CONVERSATION_V18R2_COMMITTED_SOURCE_PATHS],
    runtime_source_files: runtimeSources,
    runner_source_files: runnerSources,
    verification_source_files: verificationSources,
    materializer_source: materializerIdentity
  };
  const deployedSourceClosureHash = stableHash({
    closure_version: "formative-conversation-v18r2-deployed-source-closure-v1",
    runtime_source_files: runtimeSources,
    runner_source_files: runnerSources,
    materializer_source: materializerIdentity,
    immutable_v18r1_reference_hash: stableHash(immutableV18R1)
  });
  const provenanceContractHash = stableHash(provenanceMaterial);

  const budget = FormativeConversationV18BudgetSchema.parse({
    profiling_contract_base_call_count: 3,
    formative_comparability_base_call_count: 21,
    end_to_end_profiling_base_call_count: 1,
    end_to_end_formative_base_call_count: 3,
    end_to_end_base_call_count: 4,
    base_profiling_call_count: 4,
    base_formative_call_count: 24,
    expected_logical_call_count: 28,
    maximum_semantic_regeneration_count: 28,
    maximum_logical_call_count: 56,
    expected_provider_attempt_count: 28,
    maximum_provider_attempt_count: 168,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_token_count: 1_800_000,
    maximum_output_token_count: 368_000,
    maximum_total_token_count: 2_168_000,
    maximum_wall_clock_duration_ms: 7_200_000,
    maximum_concurrency: 1,
    maximum_cost_usd: 60,
    pricing_metadata_status: "unavailable",
    cost_enforcement:
      "operator_ceiling_required_actual_estimate_recorded_when_available",
    maximum_semantic_regenerations_per_agent_call: 1
  });
  const liveAuthorizationTemplate =
    "I authorize one live execution of formative-conversation-host-v5-executable-v18r2 from expected deployed Git SHA <expected_deployed_git_sha> for runtime candidate hash <runtime_candidate_hash> and evaluation protocol hash <evaluation_protocol_hash>, using exactly 12 isolated synthetic cases with 4 profiling base calls, 24 formative base calls, at most 56 logical calls, 168 provider attempts, 1800000 input tokens, 368000 output tokens, 2168000 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 60 ceiling.";
  const protocolMaterial = {
    protocol_version: "formative-conversation-host-v5-executable-v18r2",
    status: "frozen_executable_not_run",
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    pre_freeze_candidate_identity: EXPECTED_RUNTIME_HASH,
    formative_prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
    formative_prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
    profiling_prompt_version: profilingPrompt.prompt_version,
    profiling_prompt_hash: profilingPrompt.prompt_hash,
    target_identity: {
      runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
      pre_freeze_candidate_identity: EXPECTED_RUNTIME_HASH,
      model_snapshot: "gpt-5.6-sol",
      reasoning_effort: "medium",
      max_output_tokens: 7000,
      prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
      schema_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
      context_version: FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
      safety_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
      memory_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
      opening_validator_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
      profile_transition_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION,
      profile_recommendation_version:
        FORMATIVE_CONVERSATION_V18R2_PROFILE_RECOMMENDATION_VERSION,
      profile_snapshot_version:
        FORMATIVE_CONVERSATION_V18R2_PROFILE_SNAPSHOT_VERSION,
      canonical_claim_identity_version:
        MISCONCEPTION_CLAIM_IDENTITY_VERSION,
      canonical_evidence_identity_version:
        CANONICAL_EVIDENCE_IDENTITY_VERSION
    },
    v18r2_contract: {
      nonterminal_profile_transition_recommendation: null,
      observation_evidence_is_independent_of_transition_state: true,
      canonical_evidence_ids_semantics:
        "canonical_student_evidence_supporting_the_proposed_profile_transition_only",
      terminal_outcomes: [
        "sound_understanding",
        "largely_improved_understanding",
        "teacher_assistance_recommended"
      ],
      maximum_formative_student_turns: 12,
      formative_counter_starts_after_assessment_and_profiling: true,
      final_turn_continue_is_semantically_inadmissible: true,
      final_turn_semantic_regeneration_maximum: 1,
      double_invalid_final_turn_action:
        "platform_lifecycle_handoff_without_semantic_outcome_or_transition",
      semantic_teacher_assistance_distinct_from_platform_handoff: true
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
    security_wrapper_manifest_hash: securityWrapperManifestHash,
    provenance_contract_hash: provenanceContractHash,
    verification_identity_hash: verificationIdentityHash,
    forensic_live_lineage_identity_hash: forensicLiveLineageIdentityHash,
    immutable_v18r1_reference_hash: stableHash(immutableV18R1),
    budget,
    fixture_count: 12,
    fixed_case_order: [...FORMATIVE_CONVERSATION_V5_CASE_ORDER],
    intended_artifacts: [...FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS],
    call_graph: {
      profiling_contract_base_calls: 3,
      formative_comparability_base_calls: 21,
      end_to_end_profiling_base_calls: 1,
      end_to_end_formative_base_calls: 3,
      profiling_base_calls: 4,
      formative_base_calls: 24,
      total_base_calls: 28,
      semantic_regeneration_calls_maximum: 28,
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
    required_no_provider_tests: [
      ...FORMATIVE_CONVERSATION_V18R2_REQUIRED_NO_PROVIDER_TESTS
    ],
    deployed_source_closure_hash: deployedSourceClosureHash,
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

  const compiledPlan = compileFormativeConversationV18ExecutionPlan({
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

  const authorizationTemplate = liveAuthorizationTemplate
    .replace("<runtime_candidate_hash>", EXPECTED_RUNTIME_HASH)
    .replace("<evaluation_protocol_hash>", protocolHash);
  const commandAuthorizationTemplate = authorizationTemplate.replace(
    "<expected_deployed_git_sha>",
    "${FORMATIVE_CONVERSATION_V18R2_EXPECTED_DEPLOYED_GIT_SHA}"
  );
  const exactFutureLiveCommand = [
    "node --import tsx scripts/operational-formative-conversation-v5-v18r2-process-local-runner.mjs",
    '--env-fifo "$FORMATIVE_CONVERSATION_V18R2_ENV_FIFO" --',
    "--mode=live",
    `--runtime-candidate-hash=${EXPECTED_RUNTIME_HASH}`,
    `--evaluation-protocol-hash=${protocolHash}`,
    '--expected-deployed-git-sha="$FORMATIVE_CONVERSATION_V18R2_EXPECTED_DEPLOYED_GIT_SHA"',
    "--confirm-live-provider-calls",
    `--authorization=${JSON.stringify(commandAuthorizationTemplate)}`
  ].join(" ");
  const authorizationPackage = {
    authorization_package_version:
      "formative-conversation-v18r2-future-live-authorization-v1",
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    compiled_plan_hash: compiledPlan.compiled_plan_hash,
    budget,
    fixture_count: 12,
    profiling_contract_canary_count: 3,
    formative_conversation_case_count: 8,
    dissertation_end_to_end_case_count: 1,
    exact_future_authorization_text: null,
    future_authorization_template: authorizationTemplate,
    expected_deployed_git_sha_status: "unknown_until_committed_and_deployed",
    exact_future_live_command: null,
    future_live_command_template: exactFutureLiveCommand,
    secure_environment_channel:
      "owner_only_one_use_fifo_injected_into_single_child_process",
    live_execution_prepared: true,
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
        max_output_tokens: 7000
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
      },
      topic_dialogue_policy_authoritative_for_v18r2: false
    }
  };
  const sourceConfigurationMaterial = {
    configuration_version: "formative-conversation-v18r2-source-configuration-v1",
    evaluated_roles: [
      "student_profiling_agent",
      "formative_conversation_agent"
    ],
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    active_runtime_hash:
      FORMATIVE_CONVERSATION_V18R2_PRESERVED_ACTIVE_RUNTIME_HASH,
    rollback_runtime_hash:
      FORMATIVE_CONVERSATION_V18R2_PRESERVED_ROLLBACK_RUNTIME_HASH,
    operational_configuration: operationalConfiguration,
    formative_lifecycle: {
      maximum_student_authored_formative_turns: 12,
      counter_initial_value_at_formative_start: 0,
      assessment_administration_excluded: true,
      assistant_opening_excluded: true,
      retries_replays_and_regeneration_excluded: true
    },
    live_configuration_changed: false,
    render_accessed: false
  };
  const sourceConfigurationHash = stableHash(sourceConfigurationMaterial);

  const candidateManifestMaterial = {
    manifest_version:
      "formative-conversation-host-v5-executable-candidate-revision-v18r2",
    candidate_state: "inactive",
    approval: { eligible: false, evidence_created: false },
    activation: { permitted: false },
    runtime_behavior_changed: true,
    instructional_behavior_changed: false,
    database_schema_changed: false,
    runtime_change_scope:
      "nonterminal_contract_coherence_and_bounded_formative_lifecycle",
    runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
    pre_freeze_candidate_identity: EXPECTED_RUNTIME_HASH,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    fixture_manifest_hash: fixtureManifestHash,
    compiled_plan_hash: compiledPlan.compiled_plan_hash,
    environment_contract_hash: environmentContractHash,
    dispatch_checkpoint_contract_hash: checkpointHash,
    security_wrapper_hash: securityWrapperHash,
    security_wrapper_manifest_hash: securityWrapperManifestHash,
    provenance_contract_hash: provenanceContractHash,
    verification_identity_hash: verificationIdentityHash,
    forensic_live_lineage_identity_hash: forensicLiveLineageIdentityHash,
    source_configuration_hash: sourceConfigurationHash,
    preserved_active_runtime_hash:
      FORMATIVE_CONVERSATION_V18R2_PRESERVED_ACTIVE_RUNTIME_HASH,
    preserved_rollback_runtime_hash:
      FORMATIVE_CONVERSATION_V18R2_PRESERVED_ROLLBACK_RUNTIME_HASH,
    immutable_v18r1_reference_hash: stableHash(immutableV18R1),
    committed_source_dependency_closure_ready: true,
    deployed_source_closure_hash: deployedSourceClosureHash,
    live_execution_prepared: true,
    future_live_evaluation_requires_committed_source_freeze: true,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  };
  const candidateManifestHash = stableHash(candidateManifestMaterial);

  const immutableV18R1Sha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/immutable-v18r1-reference.json`,
    immutableV18R1
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
      "# V18R2 Deployment-Provenance Live Freeze",
      "",
      "This inactive executable candidate is ready to commit. It is not live-authorized; the exact committed and canonical deployed Git SHA must be independently verified and inserted into the authorization template after deployment.",
      "",
      "## Required authorization",
      "",
      authorizationTemplate,
      "",
      "## Future command template",
      "",
      "```sh",
      exactFutureLiveCommand,
      "```",
      "",
      "The expected deployed Git SHA is a non-secret operator input and must equal RENDER_GIT_COMMIT. The FIFO remains owner-only and one-use for secrets.",
      ""
    ].join("\n")
  );
  const approvalPlaceholder = {
    placeholder_version: "formative-conversation-v18r2-approval-placeholder-v1",
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
      identity_version: "formative-conversation-v18r2-candidate-identity-v1",
      pre_freeze_candidate_identity: EXPECTED_RUNTIME_HASH,
      runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
      formative_prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
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
      security_wrapper_manifest_hash: securityWrapperManifestHash,
      provenance_contract_hash: provenanceContractHash,
      verification_identity_hash: verificationIdentityHash,
      forensic_live_lineage_identity_hash: forensicLiveLineageIdentityHash,
      candidate_manifest_hash: candidateManifestHash,
      source_configuration_hash: sourceConfigurationHash,
      immutable_v18r1_reference_hash: stableHash(immutableV18R1),
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
        immutable_v18r1_reference: immutableV18R1Sha,
        approval_evidence_placeholder: approvalSha,
        live_execution_authorization: authorizationSha,
        live_execution_document: liveDocumentSha
      },
      deployed_source_closure_hash: deployedSourceClosureHash,
      canonical_evidence_identity_implementation_hash:
        runtimeSources.find((entry) => entry.path === "src/lib/domain/canonical-evidence-identity.ts")?.sha256,
      misconception_claim_identity_implementation_hash:
        runtimeSources.find((entry) => entry.path === "src/lib/domain/misconception-claim-identity.ts")?.sha256,
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
    formative_prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
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
    security_wrapper_manifest_hash: securityWrapperManifestHash,
    provenance_contract_hash: provenanceContractHash,
    verification_identity_hash: verificationIdentityHash,
    forensic_live_lineage_identity_hash: forensicLiveLineageIdentityHash,
    source_configuration_hash: sourceConfigurationHash,
    deployed_source_closure_hash: deployedSourceClosureHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    case_count: 12,
    base_profiling_calls: 4,
    base_formative_calls: 24,
    maximum_logical_calls: 56,
    maximum_provider_attempts: 168,
    live_execution_prepared: true,
    approval_eligible: false,
    activation_permitted: false,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  }, null, 2));
}

void main();
