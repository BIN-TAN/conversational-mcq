import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableHash } from "../src/lib/operational/stable-hash";
import { PROVIDER_INPUT_IDENTITY_MINIMIZATION_VERSION } from "../src/lib/llm/provider-input-privacy";
import {
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_MEMORY_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import { FORMATIVE_CONVERSATION_OPENING_VERSION } from "../src/lib/services/student-assessment/formative-conversation/opening-contract";
import { FORMATIVE_CONVERSATION_TEACHER_GUIDANCE_BOUNDARY_VERSION } from "../src/lib/services/student-assessment/formative-conversation/teacher-guidance-boundary";
import { formativeConversationV5FixtureSources } from "../src/lib/operational/formative-conversation-v5-evaluation-v14/fixture-source";
import {
  FormativeConversationV5FixtureSchema,
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/contracts";
import { compileFormativeConversationV5ExecutionPlan } from "../src/lib/operational/formative-conversation-v5-evaluation-v15/compiler";
import {
  FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT,
  FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/live-environment";
import {
  FORMATIVE_CONVERSATION_V15_DISPATCH_CHECKPOINT_VERSION
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/dispatch-checkpoint";
import {
  FORMATIVE_CONVERSATION_V15_SECURITY_WRAPPER_SOURCE_PATHS,
  formativeConversationV15SecurityWrapperFingerprint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/security-release";

const ROOT = path.resolve(process.cwd(), FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT);
const INHERITED_V14_REFERENCE_PATH = path.join(
  ROOT,
  "inherited-v14-reference.json"
);
const EXPECTED_INHERITED_V14_REFERENCE_HASH =
  "350e9ad1238b87e2bd77b6e7e85a943b15bb82ced541b9b3cad0f7e207e23176";

const runtimeDeltaSourcePaths = [
  "src/lib/agents/student-profiling/input-builder.ts",
  "src/lib/llm/provider-input-privacy.ts",
  "src/lib/services/student-assessment/formative-conversation/live-runner.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime-context.ts",
  "src/lib/services/student-assessment/formative-conversation/teacher-guidance-boundary.ts",
  "src/lib/services/teacher-detailed-csv-export/service.ts",
  "src/lib/services/teacher-research-data/analysis-ready-export.ts",
  "src/lib/services/teacher-research-export/source-identity.ts",
  "src/lib/services/teacher-simple-csv-export/service.ts"
] as const;

const runnerSourcePaths = [
  "scripts/operational-formative-conversation-v5-v15-process-local-runner.mjs",
  "scripts/operational-formative-conversation-v5-v15-launcher.mjs",
  "prisma/operational-formative-conversation-v5-v15-evaluate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/package.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/evaluation-accounting.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/live-environment.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/dispatch-checkpoint.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/provenance.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/security-release.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v15/service.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/fixture-source.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/evaluation-accounting.ts"
] as const;

const verificationSourcePaths = [
  "package.json",
  "prisma/operational-formative-conversation-v5-v15-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v15-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v15-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v15-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v15-dispatch-checkpoint-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v15-security-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v15-provenance-smoke-test.ts",
  "prisma/formative-conversation-v15-transition-evidence-closure-smoke-test.ts",
  "prisma/pilot-data-governance-v15-smoke-test.ts",
  "docs/V15_PILOT_DATA_GOVERNANCE_HARDENING.md",
  "docs/V15_LIVE_EXECUTION_FREEZE.md"
] as const;

const EXPECTED_HISTORICAL_REPLAY_DEPENDENCY_IDS = [
  "v10_profile_semantics_v8_case8_transcript",
  "opening_v3_v12_case2_transcript",
  "v14_provenance_candidate_snapshot"
] as const;

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileIdentity(relativePath: string) {
  const bytes = await readFile(path.resolve(process.cwd(), relativePath));
  return { path: relativePath, sha256: sha256(bytes) };
}

function requiredHash(record: JsonRecord, key: string) {
  const value = String(record[key] ?? "");
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`formative_conversation_v15_inherited_${key}_invalid`);
  }
  return value;
}

function historicalReplayDependencies(reference: JsonRecord) {
  if (
    reference.historical_replay_gate_policy !==
      "hash_reference_only_not_required_for_v15_live_readiness" ||
    !Array.isArray(reference.historical_replay_dependencies)
  ) {
    throw new Error(
      "formative_conversation_v15_historical_replay_policy_invalid"
    );
  }
  const dependencies = reference.historical_replay_dependencies.map(
    (entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(
          `formative_conversation_v15_historical_replay_${index}_invalid`
        );
      }
      const dependency = entry as JsonRecord;
      const dependencyId = String(dependency.dependency_id ?? "");
      const artifactSha256 = String(dependency.artifact_sha256 ?? "");
      if (
        dependency.classification !==
          "historical_evidence_hash_reference_only" ||
        dependency.required_for_v15_live_readiness !== false ||
        !/^[a-f0-9]{64}$/.test(artifactSha256) ||
        "path" in dependency ||
        "artifact_path" in dependency ||
        "local_path" in dependency
      ) {
        throw new Error(
          `formative_conversation_v15_historical_replay_${dependencyId || index}_invalid`
        );
      }
      return {
        dependency_id: dependencyId,
        source_revision: String(dependency.source_revision ?? ""),
        artifact_sha256: artifactSha256,
        classification: dependency.classification,
        required_for_v15_live_readiness: false
      };
    }
  );
  if (
    dependencies.length !== EXPECTED_HISTORICAL_REPLAY_DEPENDENCY_IDS.length ||
    dependencies.some(
      (dependency, index) =>
        dependency.dependency_id !==
        EXPECTED_HISTORICAL_REPLAY_DEPENDENCY_IDS[index]
    )
  ) {
    throw new Error(
      "formative_conversation_v15_historical_replay_dependencies_invalid"
    );
  }
  return dependencies;
}

async function inheritedV14Reference() {
  const bytes = await readFile(INHERITED_V14_REFERENCE_PATH);
  const reference = JSON.parse(bytes.toString("utf8")) as JsonRecord;
  const referenceHash = stableHash(reference);
  if (referenceHash !== EXPECTED_INHERITED_V14_REFERENCE_HASH) {
    throw new Error(
      `formative_conversation_v15_inherited_v14_reference_drift:${referenceHash}`
    );
  }
  if (
    reference.reference_version !==
      "formative-conversation-v15-inherited-v14-reference-v1" ||
    reference.historical_evidence_copied !== false ||
    reference.working_tree_dependency_permitted !== false
  ) {
    throw new Error(
      "formative_conversation_v15_inherited_v14_reference_invalid"
    );
  }
  return {
    reference,
    referenceHash,
    referenceFileSha256: sha256(bytes),
    historicalDependencies: historicalReplayDependencies(reference)
  };
}

async function writeJson(relativePath: string, value: unknown) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
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

async function main() {
  const inherited = await inheritedV14Reference();
  const immutableV14Hash = requiredHash(
    inherited.reference,
    "v14_immutable_snapshot_hash"
  );
  const baseRuntimeHash = requiredHash(
    inherited.reference,
    "base_runtime_candidate_hash"
  );
  const inheritedRunnerHash = requiredHash(
    inherited.reference,
    "runner_implementation_hash"
  );
  const activeHash = requiredHash(
    inherited.reference,
    "preserved_active_runtime_hash"
  );
  const rollbackHash = requiredHash(
    inherited.reference,
    "preserved_rollback_runtime_hash"
  );
  const inheritedPromptHash = requiredHash(inherited.reference, "prompt_hash");
  const inheritedAggregateFixtureHash = requiredHash(
    inherited.reference,
    "v14_aggregate_fixture_hash"
  );
  if (FORMATIVE_CONVERSATION_PROMPT_HASH !== inheritedPromptHash) {
    throw new Error("formative_conversation_v15_prompt_identity_invalid");
  }

  const runtimeSources = await Promise.all(
    runtimeDeltaSourcePaths.map(fileIdentity)
  );
  const runnerSources = await Promise.all(runnerSourcePaths.map(fileIdentity));
  const verificationSources = await Promise.all(
    verificationSourcePaths.map(fileIdentity)
  );
  const materializerIdentity = await fileIdentity(
    "prisma/operational-formative-conversation-v5-v15-materialize.ts"
  );
  const runtimeMaterial = {
    manifest_version: "formative-conversation-v15-runtime-candidate-v1",
    base_runtime_candidate_hash: baseRuntimeHash,
    target_role: "formative_conversation_agent",
    prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
    prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    identity_minimization_version: PROVIDER_INPUT_IDENTITY_MINIMIZATION_VERSION,
    teacher_guidance_boundary_version:
      FORMATIVE_CONVERSATION_TEACHER_GUIDANCE_BOUNDARY_VERSION,
    export_artifact_privacy_version:
      "pilot-export-artifact-identifier-privacy-v1",
    runtime_delta_sources: runtimeSources,
    explicitly_unchanged: [
      "answer_key_boundary",
      "assessment_truth_handling",
      "formative_pedagogy",
      "profile_transition_logic",
      "profile_meanings",
      "semantic_regeneration_philosophy",
      "database_schema"
    ]
  };
  const runtimeCandidateHash = stableHash(runtimeMaterial);

  const fixtureRecords = [] as Array<{
    fixture: ReturnType<typeof FormativeConversationV5FixtureSchema.parse>;
    reference: {
      case_id: string;
      order: number;
      path: string;
      fixture_hash: string;
      file_sha256: string;
    };
  }>;
  for (const source of formativeConversationV5FixtureSources) {
    const fixtureHash = stableHash(source);
    const fixture = FormativeConversationV5FixtureSchema.parse({
      ...source,
      fixture_hash: fixtureHash
    });
    const relativePath = `${FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT}/${source.case_id}.json`;
    const fileSha256 = await writeJson(relativePath, fixture);
    fixtureRecords.push({
      fixture,
      reference: {
        case_id: source.case_id,
        order: source.case_order,
        path: relativePath,
        fixture_hash: fixtureHash,
        file_sha256: fileSha256
      }
    });
  }
  if (
    fixtureRecords.length !== FORMATIVE_CONVERSATION_V5_CASE_ORDER.length ||
    fixtureRecords.some(
      ({ fixture }, index) => fixture.case_id !== FORMATIVE_CONVERSATION_V5_CASE_ORDER[index]
    )
  ) {
    throw new Error("formative_conversation_v15_fixture_order_invalid");
  }
  const aggregateFixtureHash = stableHash(
    fixtureRecords.map(({ reference }) => ({
      case_id: reference.case_id,
      case_order: reference.order,
      fixture_hash: reference.fixture_hash
    }))
  );
  if (aggregateFixtureHash !== inheritedAggregateFixtureHash) {
    throw new Error(
      "formative_conversation_v15_inherited_fixture_semantics_changed"
    );
  }
  const fixtureMaterial = {
    manifest_version: "formative-conversation-v15-fixture-manifest-v1",
    fixture_hash_semantics: "stable_hash_of_fixture_with_fixture_hash_omitted",
    fixture_count: fixtureRecords.length,
    fixed_case_order: fixtureRecords.map(({ reference }) => reference.case_id),
    fixtures: fixtureRecords.map(({ reference }) => reference),
    aggregate_fixture_hash: aggregateFixtureHash,
    inherited_v14_aggregate_fixture_hash: inheritedAggregateFixtureHash,
    historical_replay_dependencies: inherited.historicalDependencies,
    governance_regression_sources: verificationSources,
    forbidden_runner_substitutions: [
      "bare_node_without_tsx",
      "selective_case_runner",
      "persona_cli",
      "uncommitted_fixture_override"
    ]
  };
  const fixtureManifestHash = stableHash(fixtureMaterial);

  const securitySourceIdentities = await Promise.all(
    FORMATIVE_CONVERSATION_V15_SECURITY_WRAPPER_SOURCE_PATHS.map(fileIdentity)
  );
  const securityWrapperHash =
    formativeConversationV15SecurityWrapperFingerprint(
      Object.fromEntries(
        securitySourceIdentities.map((entry) => [entry.path, entry.sha256])
      )
    );
  const runnerMaterial = {
    runner_version: "formative-conversation-v5-protocol-runner-v15",
    canonical_loading_mechanism: "node --import tsx",
    plan_live_loader_parity: true,
    inherited_generation_core_hash: inheritedRunnerHash,
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
        "scripts/operational-formative-conversation-v5-v15-process-local-runner.mjs",
      canonical_launcher:
        "scripts/operational-formative-conversation-v5-v15-launcher.mjs",
      executable_cli:
        "prisma/operational-formative-conversation-v5-v15-evaluate.ts",
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
    preserved_active_runtime_hash: activeHash,
    preserved_rollback_runtime_hash: rollbackHash,
    runtime_candidate_hash: runtimeCandidateHash,
    render_access_during_materialization: false,
    provider_calls_during_materialization: 0,
    model_auth_requests_during_materialization: 0
  };
  const environmentContractHash = stableHash(environmentMaterial);

  const dispatchMaterial = {
    contract_version: "formative-conversation-v15-dispatch-contract-v1",
    checkpoint_version: FORMATIVE_CONVERSATION_V15_DISPATCH_CHECKPOINT_VERSION,
    writer_source:
      "src/lib/operational/formative-conversation-v5-evaluation-v15/dispatch-checkpoint.ts",
    writer_source_sha256: (
      await fileIdentity(
        "src/lib/operational/formative-conversation-v5-evaluation-v15/dispatch-checkpoint.ts"
      )
    ).sha256,
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
    checkpoint_precedes_provider_request: true,
    provider_request_started_at_checkpoint: false
  };
  const dispatchCheckpointContractHash = stableHash(dispatchMaterial);

  const budget = inherited.reference.inherited_live_budget as Parameters<
    typeof compileFormativeConversationV5ExecutionPlan
  >[0]["budget"];
  const liveAuthorizationTemplate =
    "I authorize one live execution of formative-conversation-host-v5-executable-v15 for runtime candidate hash <runtime_candidate_hash> and evaluation protocol hash <evaluation_protocol_hash>, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.";
  const protocolMaterial = {
    protocol_version: "formative-conversation-host-v5-executable-v15",
    status: "frozen_executable_not_run",
    runtime_candidate_hash: runtimeCandidateHash,
    prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
    prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    target_identity: {
      runtime_candidate_hash: runtimeCandidateHash,
      model_snapshot: "gpt-5.6-sol",
      reasoning_effort: "medium",
      max_output_tokens: 3500,
      prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
      safety_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
      memory_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
      opening_validator_version: FORMATIVE_CONVERSATION_OPENING_VERSION
    },
    runner_implementation_hash: runnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    inherited_v14_reference_hash: inherited.referenceHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    live_environment_contract_hash: environmentContractHash,
    dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash,
    budget,
    fixture_count: 8,
    fixed_case_order: [...FORMATIVE_CONVERSATION_V5_CASE_ORDER],
    intended_artifacts: [...FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS],
    isolation: {
      synthetic_only: true,
      case_namespaces_isolated: true,
      classroom_collision_forbidden: true,
      approval_activation_forbidden: true
    },
    semantic_regeneration_policy_unchanged: true,
    security_attestation_policy_unchanged: true,
    historical_replay_gate_policy:
      "hash_reference_only_not_required_for_v15_live_readiness",
    historical_replay_dependencies: inherited.historicalDependencies,
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

  const compiledPlan = compileFormativeConversationV5ExecutionPlan({
    runtime_candidate_hash: runtimeCandidateHash,
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
    budget,
    run_namespace_template: "<provider_run_id>",
    case_namespace_template: "<provider_run_id>:<case_id>",
    intended_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS
  });

  const exactAuthorization = liveAuthorizationTemplate
    .replace("<runtime_candidate_hash>", runtimeCandidateHash)
    .replace("<evaluation_protocol_hash>", protocolHash);
  const exactFutureLiveCommand = [
    "node --import tsx scripts/operational-formative-conversation-v5-v15-process-local-runner.mjs",
    '--env-fifo "$FORMATIVE_CONVERSATION_V15_ENV_FIFO" --',
    "--mode=live",
    `--runtime-candidate-hash ${runtimeCandidateHash}`,
    `--evaluation-protocol-hash ${protocolHash}`,
    "--confirm-live-provider-calls",
    `--authorization ${JSON.stringify(exactAuthorization)}`
  ].join(" ");
  const authorizationPackage = {
    authorization_package_version:
      "formative-conversation-v15-future-live-authorization-v1",
    runtime_candidate_hash: runtimeCandidateHash,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    compiled_plan_hash: compiledPlan.compiled_plan_hash,
    budget,
    fixture_count: 8,
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
    configuration_version: "formative-conversation-v15-source-configuration-v2",
    target_role: "formative_conversation_agent",
    prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
    prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    runtime_candidate_hash: runtimeCandidateHash,
    base_runtime_candidate_hash: baseRuntimeHash,
    active_runtime_hash: activeHash,
    rollback_runtime_hash: rollbackHash,
    operational_configuration: operationalConfiguration,
    live_configuration_changed: false,
    render_accessed: false,
    inherited_v14_reference_hash: inherited.referenceHash
  };
  const sourceConfigurationHash = stableHash(sourceConfigurationMaterial);

  const candidateManifestMaterial = {
    manifest_version:
      "formative-conversation-host-v5-executable-candidate-revision-v15",
    approval_state: "candidate_not_approved",
    approval_eligible: false,
    activation_permitted: false,
    runtime_behavior_changed: true,
    instructional_behavior_changed: false,
    prompt_changed: false,
    database_schema_changed: false,
    runtime_candidate_hash: runtimeCandidateHash,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    inherited_generation_runner_hash: inheritedRunnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    inherited_v14_reference_hash: inherited.referenceHash,
    fixture_manifest_hash: fixtureManifestHash,
    compiled_plan_hash: compiledPlan.compiled_plan_hash,
    environment_contract_hash: environmentContractHash,
    dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash,
    security_wrapper_hash: securityWrapperHash,
    preserved_active_runtime_hash: activeHash,
    preserved_rollback_runtime_hash: rollbackHash,
    v14_immutable_snapshot_hash: immutableV14Hash,
    historical_replay_gate_policy:
      "hash_reference_only_not_required_for_v15_live_readiness",
    historical_replay_dependencies: inherited.historicalDependencies,
    committed_source_dependency_closure_ready: true,
    live_execution_prepared: true,
    future_live_evaluation_requires_committed_source_freeze: true
  };
  const candidateManifestHash = stableHash(candidateManifestMaterial);

  const runtimeManifestSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/runtime-candidate-manifest.json`,
    { ...runtimeMaterial, runtime_candidate_hash: runtimeCandidateHash }
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
  const dispatchContractSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/dispatch-checkpoint-contract.json`,
    {
      ...dispatchMaterial,
      dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash
    }
  );
  const compiledPlanSha = await writeJson(
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
    compiledPlan
  );
  const sourceConfigurationSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/source-configuration.json`,
    {
      ...sourceConfigurationMaterial,
      source_configuration_hash: sourceConfigurationHash
    }
  );
  const authorizationPackageSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-execution-authorization.json`,
    authorizationPackage
  );
  const liveExecutionDocumentSha = await writeText(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/LIVE_EXECUTION.md`,
    [
      "# V15 Live Execution Freeze",
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
      "The FIFO must be owner-only, one-use, and populated by an authorized secure environment retrieval mechanism. Never place secrets on the command line.",
      ""
    ].join("\n")
  );
  const approvalPlaceholder = {
    placeholder_version: "formative-conversation-v15-approval-placeholder-v2",
    runtime_candidate_hash: runtimeCandidateHash,
    protocol_hash: protocolHash,
    approval_evidence_created: false,
    approval_eligible: false,
    activation_permitted: false,
    reason:
      "The executable package is frozen but has not been authorized, run, human-reviewed, approved, or activated."
  };
  const approvalPlaceholderSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/approval-evidence-placeholder.json`,
    approvalPlaceholder
  );
  const candidateManifestSha = await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-manifest.json`,
    {
      ...candidateManifestMaterial,
      candidate_manifest_hash: candidateManifestHash
    }
  );
  await writeJson(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-identity.json`,
    {
      identity_version: "formative-conversation-v15-candidate-identity-v2",
      runtime_candidate_hash: runtimeCandidateHash,
      prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
      protocol_hash: protocolHash,
      runner_implementation_hash: runnerHash,
      inherited_generation_runner_hash: inheritedRunnerHash,
      materializer_implementation_hash: materializerIdentity.sha256,
      inherited_v14_reference_hash: inherited.referenceHash,
      fixture_manifest_hash: fixtureManifestHash,
      aggregate_fixture_hash: aggregateFixtureHash,
      compiled_plan_hash: compiledPlan.compiled_plan_hash,
      environment_contract_hash: environmentContractHash,
      dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash,
      security_wrapper_hash: securityWrapperHash,
      candidate_manifest_hash: candidateManifestHash,
      source_configuration_hash: sourceConfigurationHash,
      file_sha256: {
        runtime_candidate_manifest: runtimeManifestSha,
        candidate_manifest: candidateManifestSha,
        executable_evaluation_protocol: protocolSha,
        fixture_manifest: fixtureManifestSha,
        compiled_execution_plan: compiledPlanSha,
        live_environment_contract: environmentSha,
        dispatch_checkpoint_contract: dispatchContractSha,
        source_configuration: sourceConfigurationSha,
        inherited_v14_reference: inherited.referenceFileSha256,
        approval_evidence_placeholder: approvalPlaceholderSha,
        live_execution_authorization: authorizationPackageSha,
        live_execution_document: liveExecutionDocumentSha
      },
      v14_immutable_snapshot_hash: immutableV14Hash,
      live_execution_prepared: true,
      approval_eligible: false,
      activation_permitted: false,
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    }
  );

  console.log(
    JSON.stringify(
      {
        status: "materialized",
        root: FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
        runtime_candidate_hash: runtimeCandidateHash,
        prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
        protocol_hash: protocolHash,
        runner_implementation_hash: runnerHash,
        materializer_implementation_hash: materializerIdentity.sha256,
        inherited_v14_reference_hash: inherited.referenceHash,
        fixture_manifest_hash: fixtureManifestHash,
        aggregate_fixture_hash: aggregateFixtureHash,
        compiled_plan_hash: compiledPlan.compiled_plan_hash,
        environment_contract_hash: environmentContractHash,
        dispatch_checkpoint_contract_hash: dispatchCheckpointContractHash,
        security_wrapper_hash: securityWrapperHash,
        candidate_manifest_hash: candidateManifestHash,
        source_configuration_hash: sourceConfigurationHash,
        v14_immutable_snapshot_hash: immutableV14Hash,
        live_execution_prepared: true,
        approval_eligible: false,
        activation_permitted: false,
        provider_calls: 0,
        model_auth_requests: 0,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
}

void main();
