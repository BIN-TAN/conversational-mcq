import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "../src/lib/operational/stable-hash";
import { buildFormativeConversationV18R2UxPolishArtifacts } from "../src/lib/operational/formative-conversation-v18r2-ux-polish/candidate";
import {
  V18R2_UX_CANARY_ARTIFACT_PATHS,
  V18R2_UX_CANARY_BUDGET,
  V18R2_UX_CANARY_CASE_ORDER,
  V18R2_UX_CANARY_FIXTURE_ROOT,
  V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS,
  V18R2_UX_CANARY_MACHINE_CRITERIA,
  V18R2_UX_CANARY_REVISION,
  V18R2_UX_CANARY_RUNNER_SOURCE_PATHS,
  V18R2_UX_CANARY_SECURITY_SOURCE_PATHS
} from "../src/lib/operational/formative-conversation-v18r2-ux-polish-canary/contracts";
import {
  v18r2UxCanaryFileSha256,
  v18r2UxCanaryRunnerHash,
  v18r2UxCanarySecurityWrapperHash
} from "../src/lib/operational/formative-conversation-v18r2-ux-polish-canary/package";
import { buildV18R2UxPolishCanaryFixtures } from "./helpers/formative-conversation-v18r2-ux-polish-canary-fixtures";

const MATERIALIZER_PATH =
  "prisma/operational-formative-conversation-v18r2-ux-polish-canary-materialize.ts";
const MATERIALIZATION_SMOKE_PATH =
  "prisma/operational-formative-conversation-v18r2-ux-polish-canary-smoke-test.ts";
const FIXTURE_HELPER_PATH =
  "prisma/helpers/formative-conversation-v18r2-ux-polish-canary-fixtures.ts";
const BASE_UX_ROOT =
  "config/operational-candidates/formative-conversation-v18r2-ux-polish";
const HISTORICAL_RUN_ID = "fcv5v18r2_provider_20260814042303_c675790a";

function absolute(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

function sha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

function writeJson(relativePath: string, value: unknown) {
  const target = absolute(relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(relativePath: string, value: string) {
  const target = absolute(relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function fileIdentities(paths: readonly string[]) {
  return paths.map((sourcePath) => ({ path: sourcePath, sha256: sha256(sourcePath) }));
}

const ux = buildFormativeConversationV18R2UxPolishArtifacts();
if (
  ux.runtimeCandidateManifest.runtime_candidate_hash !==
    "2d458a8578427e4c6ad1ca143f51ecb17b2c5f762a11aebf1f11a01aebe32d90" ||
  ux.runtimeCandidateManifest.formative_conversation_role.prompt_hash !==
    "27488d814b1f3978723a086a05ca22ec31618764f0adb1f64ba83d9f45758b80" ||
  ux.targetedValidationProtocol.protocol_hash !==
    "ac6e24d46ab56ca4b66b3a3f8359a0beab9b3aab0ded06e97e98d80adc1a2731" ||
  ux.fixtureManifest.fixture_manifest_hash !==
    "bb16f8c53eeaadf86751c03f373bd31cab2c13d6ee24104996606f9920b19ccb" ||
  ux.candidateIdentity.candidate_identity_hash !==
    "aa26e16c1c560d66e906f4b58516f6eda693d46d90cce7054df30eb623f9010f"
) {
  throw new Error("v18r2_ux_canary_accepted_base_identity_mismatch");
}

writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.runtime_manifest,
  ux.runtimeCandidateManifest
);
const baseReference = {
  reference_version: "formative-conversation-v18r2-ux-candidate-reference-v1",
  base_candidate_root: BASE_UX_ROOT,
  base_candidate_identity_hash: ux.candidateIdentity.candidate_identity_hash,
  base_no_provider_protocol_hash: ux.targetedValidationProtocol.protocol_hash,
  base_fixture_manifest_hash: ux.fixtureManifest.fixture_manifest_hash,
  historical_v18r2_provider_run_id: HISTORICAL_RUN_ID,
  historical_evidence_mutated: false,
  historical_run_rerun_permitted: false
} as const;
writeJson(V18R2_UX_CANARY_ARTIFACT_PATHS.base_candidate_reference, baseReference);

const fixtureReferences = buildV18R2UxPolishCanaryFixtures().map((fixture) => {
  const fixtureHash = stableHash(fixture);
  const materialized = { ...fixture, fixture_hash: fixtureHash };
  const fixturePath = `${V18R2_UX_CANARY_FIXTURE_ROOT}/${fixture.case_id}.json`;
  writeJson(fixturePath, materialized);
  return {
    case_id: fixture.case_id,
    case_order: fixture.case_order,
    path: fixturePath,
    fixture_hash: fixtureHash,
    file_sha256: sha256(fixturePath)
  };
});
const aggregateFixtureHash = stableHash(
  fixtureReferences.map(({ case_id, case_order, fixture_hash }) => ({
    case_id,
    case_order,
    fixture_hash
  }))
);
const fixtureManifestIdentity = {
  manifest_version: "formative-conversation-v18r2-ux-canary-fixture-manifest-v1",
  fixed_case_order: [...V18R2_UX_CANARY_CASE_ORDER],
  fixture_count: 4,
  fixtures: fixtureReferences,
  aggregate_fixture_hash: aggregateFixtureHash
} as const;
const fixtureManifest = {
  ...fixtureManifestIdentity,
  fixture_manifest_hash: stableHash(fixtureManifestIdentity)
};
writeJson(V18R2_UX_CANARY_ARTIFACT_PATHS.fixture_manifest, fixtureManifest);

const sourceConfigurationIdentity = {
  configuration_version: "formative-conversation-v18r2-ux-canary-source-v1",
  evaluated_roles: ["formative_conversation_agent"],
  runtime_candidate_hash: ux.runtimeCandidateManifest.runtime_candidate_hash,
  active_runtime_hash:
    "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993",
  rollback_runtime_hash:
    "58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2",
  operational_configuration: {
    roles: {
      student_profiling_agent: {
        model_name: "gpt-5.6-terra",
        reasoning_effort: "medium",
        max_output_tokens: 4_000
      },
      formative_conversation_agent: {
        model_name: "gpt-5.6-sol",
        reasoning_effort: "medium",
        max_output_tokens: 7_000
      }
    },
    runtime_policy: {
      provider_timeout_ms: 90_000,
      provider_max_retries: 2,
      role_live_toggles: {
        student_communication_agent: true,
        topic_dialogue_agent: true,
        formative_conversation_agent: true
      },
      topic_dialogue_policy: {
        maximum_student_turns: 10,
        recent_raw_turn_window: 12,
        maximum_student_message_characters: 5_000,
        assessment_system_questions_allowed: true
      },
      topic_dialogue_policy_authoritative_for_canary: false
    }
  },
  canary_uses_profiling_provider_calls: false,
  live_configuration_changed: false,
  render_accessed_during_materialization: false
} as const;
const sourceConfiguration = {
  ...sourceConfigurationIdentity,
  source_configuration_hash: stableHash(sourceConfigurationIdentity)
};
writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.source_configuration,
  sourceConfiguration
);

const environmentIdentity = {
  contract_version: "formative-conversation-v18r2-ux-canary-environment-v1",
  canonical_service: "conversational-mcq",
  deprecated_service_forbidden: "conversational-mcq-staging",
  canonical_loader: "node --import tsx",
  plan_live_loader_parity: true,
  bare_node_forbidden: true,
  required_checks: [
    "canonical_service_identity",
    "deployed_git_sha_exact",
    "database_reachable",
    "schema_ready",
    "sixty_migrations_current",
    "active_approval_bundle_exact_and_readable",
    "rollback_bundle_unchanged",
    "openai_credential_present",
    "research_pseudonymization_key_present",
    "formative_model_gpt_5_6_sol",
    "formative_reasoning_medium",
    "formative_max_output_tokens_7000",
    "formative_live_calls_enabled",
    "candidate_runtime_and_protocol_exact"
  ],
  required_canary_environment: [
    "RENDER_GIT_COMMIT",
    "FORMATIVE_CONVERSATION_V18R2_UX_CANARY_LIVE_EVALUATION_ENABLED"
  ],
  secret_injection: {
    mechanism: "owner_only_one_use_fifo_to_process_local_child",
    command_line_values_forbidden: true,
    persistence_forbidden: true,
    exact_value_scan_before_clear_required: true
  },
  database_migrations_run: false,
  render_access_during_materialization: false,
  provider_calls_during_materialization: 0,
  model_auth_requests_during_materialization: 0
} as const;
const environmentContract = {
  ...environmentIdentity,
  environment_contract_hash: stableHash(environmentIdentity)
};
writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.environment_contract,
  environmentContract
);

const checkpointWriter =
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/dispatch-checkpoint.ts";
const checkpointIdentity = {
  contract_version: "formative-conversation-v18r2-ux-canary-checkpoint-v1",
  inherited_checkpoint_version:
    "formative-conversation-v18r2-dispatch-checkpoint-v1",
  writer_source: checkpointWriter,
  writer_source_sha256: sha256(checkpointWriter),
  exact_checkpoint_count: 1,
  boundary: "immediately_before_first_generation_request",
  plan_mode_checkpoint_count: 0,
  preflight_checkpoint_count: 0,
  exclusive_create_required: true,
  rerun_after_checkpoint_forbidden: true,
  immutable_identity_binding_required: true
} as const;
const checkpointContract = {
  ...checkpointIdentity,
  checkpoint_contract_hash: stableHash(checkpointIdentity)
};
writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.checkpoint_contract,
  checkpointContract
);

const securityWrapperHash = v18r2UxCanarySecurityWrapperHash();
const securityManifestIdentity = {
  manifest_version: "formative-conversation-v18r2-ux-canary-security-v1",
  wrapper_version: "formative-conversation-v18r2-ux-polish-canary-security-wrapper-v1",
  inherited_attestation_boundary:
    "formative-conversation-v18r2-security-wrapper-v1",
  source_files: fileIdentities(V18R2_UX_CANARY_SECURITY_SOURCE_PATHS),
  security_wrapper_hash: securityWrapperHash,
  exact_secret_scan_required: true,
  generic_credential_scan_required: true,
  zip_entry_scan_required: true,
  secrets_cleared_only_after_attestation: true
} as const;
const securityManifest = {
  ...securityManifestIdentity,
  security_wrapper_manifest_hash: stableHash(securityManifestIdentity)
};
writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.security_manifest,
  securityManifest
);

const provenanceSourcePaths = [
  ...new Set([
    ...ux.runtimeCandidateManifest.runtime_source_files.map((entry) => entry.path),
    ...V18R2_UX_CANARY_RUNNER_SOURCE_PATHS,
    ...V18R2_UX_CANARY_SECURITY_SOURCE_PATHS,
    MATERIALIZER_PATH,
    MATERIALIZATION_SMOKE_PATH,
    FIXTURE_HELPER_PATH,
    "package.json"
  ])
].sort();
const provenanceIdentity = {
  contract_version: "formative-conversation-v18r2-ux-canary-provenance-v1",
  future_committed_source_required: true,
  current_source_commit: null,
  expected_deployed_git_sha_required_at_live_authorization: true,
  clean_checkout_rematerialization_required: true,
  working_tree_only_dependencies_forbidden: true,
  base_ux_candidate_reference: baseReference,
  historical_v18r2_run_mutation_forbidden: true,
  source_files: fileIdentities(provenanceSourcePaths),
  git_runtime_dependency_forbidden: true,
  git_metadata_runtime_dependency_forbidden: true
} as const;
const provenanceContract = {
  ...provenanceIdentity,
  provenance_contract_hash: stableHash(provenanceIdentity)
};
writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.provenance_contract,
  provenanceContract
);

const runnerHash = v18r2UxCanaryRunnerHash();
const materializerHash = sha256(MATERIALIZER_PATH);
const protocolIdentity = {
  protocol_version: "formative-conversation-v18r2-ux-canary-executable-v1",
  candidate_revision: V18R2_UX_CANARY_REVISION,
  runtime_candidate_hash: ux.runtimeCandidateManifest.runtime_candidate_hash,
  formative_prompt_version:
    ux.runtimeCandidateManifest.formative_conversation_role.prompt_version,
  formative_prompt_hash:
    ux.runtimeCandidateManifest.formative_conversation_role.prompt_hash,
  base_ux_candidate_identity_hash: ux.candidateIdentity.candidate_identity_hash,
  base_ux_no_provider_protocol_hash: ux.targetedValidationProtocol.protocol_hash,
  runner_implementation_hash: runnerHash,
  materializer_implementation_hash: materializerHash,
  fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
  aggregate_fixture_hash: aggregateFixtureHash,
  live_environment_contract_hash: environmentContract.environment_contract_hash,
  dispatch_checkpoint_contract_hash: checkpointContract.checkpoint_contract_hash,
  provenance_contract_hash: provenanceContract.provenance_contract_hash,
  security_wrapper_hash: securityWrapperHash,
  fixed_case_order: [...V18R2_UX_CANARY_CASE_ORDER],
  canary_count: 4,
  machine_validation_criteria: [...V18R2_UX_CANARY_MACHINE_CRITERIA],
  human_review_dimensions: [...V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS],
  human_judgment_first: true,
  deterministic_ux_wording_assertions: false,
  budget: V18R2_UX_CANARY_BUDGET,
  no_selective_reruns: true,
  full_v18r2_evaluation_permitted: false,
  provider_calls_during_materialization: 0,
  model_auth_requests_during_materialization: 0,
  generation_network_requests_during_materialization: 0,
  real_dispatch_checkpoints_during_materialization: 0,
  live_execution_prepared: true,
  approval_eligible: false,
  activation_permitted: false
} as const;
const protocol = {
  ...protocolIdentity,
  protocol_hash: stableHash(protocolIdentity)
};
writeJson(V18R2_UX_CANARY_ARTIFACT_PATHS.protocol, protocol);

const compiledPlanIdentity = {
  compiled_plan_version: "formative-conversation-v18r2-ux-canary-plan-v1",
  compilation_status: "ready_for_dispatch",
  runtime_candidate_hash: protocol.runtime_candidate_hash,
  evaluation_protocol_hash: protocol.protocol_hash,
  runner_implementation_hash: runnerHash,
  fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
  aggregate_fixture_hash: aggregateFixtureHash,
  live_environment_contract_hash: environmentContract.environment_contract_hash,
  checkpoint_contract_hash: checkpointContract.checkpoint_contract_hash,
  provenance_contract_hash: provenanceContract.provenance_contract_hash,
  security_wrapper_hash: securityWrapperHash,
  fixed_case_order: [...V18R2_UX_CANARY_CASE_ORDER],
  cases: fixtureReferences.map((reference) => ({
    case_id: reference.case_id,
    case_order: reference.case_order,
    fixture_hash: reference.fixture_hash,
    fixture_file_sha256: reference.file_sha256,
    isolated_namespace_template: `<provider_run_id>:${reference.case_id}`,
    base_formative_calls: 1,
    maximum_semantic_regenerations: 1
  })),
  aggregate_call_graph: {
    base_profiling_calls: 0,
    base_formative_calls: 4,
    total_base_calls: 4,
    maximum_semantic_regeneration_calls: 4,
    maximum_logical_calls: 8,
    maximum_provider_attempts: 24,
    concurrency: 1
  },
  budget: V18R2_UX_CANARY_BUDGET,
  isolated_namespaces_required: true,
  provider_calls_during_compilation: 0,
  model_auth_requests_during_compilation: 0,
  dispatch_checkpoints_during_compilation: 0
} as const;
const compiledPlan = {
  ...compiledPlanIdentity,
  compiled_plan_hash: stableHash(compiledPlanIdentity)
};
writeJson(V18R2_UX_CANARY_ARTIFACT_PATHS.compiled_plan, compiledPlan);

const candidateManifestIdentity = {
  manifest_version: "formative-conversation-v18r2-ux-canary-candidate-v1",
  candidate_revision: V18R2_UX_CANARY_REVISION,
  runtime_candidate_hash: protocol.runtime_candidate_hash,
  formative_prompt_hash: protocol.formative_prompt_hash,
  protocol_hash: protocol.protocol_hash,
  runner_implementation_hash: runnerHash,
  materializer_implementation_hash: materializerHash,
  fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
  aggregate_fixture_hash: aggregateFixtureHash,
  compiled_plan_hash: compiledPlan.compiled_plan_hash,
  environment_contract_hash: environmentContract.environment_contract_hash,
  checkpoint_contract_hash: checkpointContract.checkpoint_contract_hash,
  provenance_contract_hash: provenanceContract.provenance_contract_hash,
  security_wrapper_hash: securityWrapperHash,
  preserved_active_runtime_hash: sourceConfiguration.active_runtime_hash,
  preserved_rollback_runtime_hash: sourceConfiguration.rollback_runtime_hash,
  historical_v18r2_provider_run_id: HISTORICAL_RUN_ID,
  historical_evidence_mutated: false,
  live_execution_prepared: true,
  approval: { eligible: false, status: "not_approved" },
  activation: { permitted: false, status: "not_permitted" }
} as const;
const candidateManifest = {
  ...candidateManifestIdentity,
  candidate_manifest_hash: stableHash(candidateManifestIdentity)
};
writeJson(V18R2_UX_CANARY_ARTIFACT_PATHS.candidate_manifest, candidateManifest);

const approvalPlaceholder = {
  placeholder_version: "formative-conversation-v18r2-ux-canary-approval-v1",
  runtime_candidate_hash: protocol.runtime_candidate_hash,
  protocol_hash: protocol.protocol_hash,
  candidate_manifest_hash: candidateManifest.candidate_manifest_hash,
  approval_status: "not_approved",
  activation_status: "not_permitted",
  official_approval_evidence_created: false
} as const;
writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.approval_placeholder,
  approvalPlaceholder
);

const authorization = {
  authorization_package_version:
    "formative-conversation-v18r2-ux-canary-future-authorization-v1",
  runtime_candidate_hash: protocol.runtime_candidate_hash,
  protocol_hash: protocol.protocol_hash,
  runner_implementation_hash: runnerHash,
  fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
  aggregate_fixture_hash: aggregateFixtureHash,
  compiled_plan_hash: compiledPlan.compiled_plan_hash,
  budget: V18R2_UX_CANARY_BUDGET,
  canary_count: 4,
  exact_future_authorization_text: null,
  future_authorization_template: `I authorize one live execution of ${V18R2_UX_CANARY_REVISION} from expected deployed Git SHA <expected_deployed_git_sha> for runtime candidate hash ${protocol.runtime_candidate_hash} and evaluation protocol hash ${protocol.protocol_hash}, using exactly 4 isolated synthetic canaries with 4 formative base calls, at most 8 logical calls, 24 provider attempts, 400000 input tokens, 56000 output tokens, 456000 total tokens, 1800000 milliseconds wall-clock time, concurrency 1, and a USD 15 ceiling.`,
  exact_future_live_command: null,
  future_live_command_template: `node --import tsx scripts/operational-formative-conversation-v18r2-ux-polish-canary-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V18R2_UX_CANARY_ENV_FIFO" -- --mode=live --runtime-candidate-hash=${protocol.runtime_candidate_hash} --evaluation-protocol-hash=${protocol.protocol_hash} --expected-deployed-git-sha="$FORMATIVE_CONVERSATION_V18R2_UX_CANARY_EXPECTED_DEPLOYED_GIT_SHA" --confirm-live-provider-calls --authorization="<exact authorization after committed SHA>"`,
  expected_deployed_git_sha_status: "unknown_until_committed_and_deployed",
  live_execution_prepared: true,
  live_execution_authorized: false,
  approval_eligible: false,
  activation_permitted: false
} as const;
writeJson(V18R2_UX_CANARY_ARTIFACT_PATHS.authorization, authorization);

writeText(
  V18R2_UX_CANARY_ARTIFACT_PATHS.live_document,
  `# V18R2 UX-polish targeted canary\n\nThis package freezes four isolated, human-judgment-first formative UX canaries. It is V18R2 UX polish, not V18R3 or V19.\n\n## Scope\n\n- Direct answer\n- Explain differently\n- Persistent misconception\n- Natural assistant-first opening\n\nMachine checks enforce only structured-output, privacy/truth, legacy-contamination, transition, lifecycle, and opening-acceptance contracts. Conversational quality remains pending human review.\n\n## Frozen call graph\n\n- Base formative calls: 4\n- Maximum semantic regenerations: 4\n- Maximum logical calls: 8\n- Maximum provider attempts: 24\n- Concurrency: 1\n\nNo exact authorization or executable command is usable until a final Git commit SHA exists and is deployed. The candidate remains inactive, unapproved, and ineligible for activation.\n`
);

const generatedFilePaths = [
  V18R2_UX_CANARY_ARTIFACT_PATHS.runtime_manifest,
  V18R2_UX_CANARY_ARTIFACT_PATHS.base_candidate_reference,
  V18R2_UX_CANARY_ARTIFACT_PATHS.source_configuration,
  V18R2_UX_CANARY_ARTIFACT_PATHS.fixture_manifest,
  V18R2_UX_CANARY_ARTIFACT_PATHS.environment_contract,
  V18R2_UX_CANARY_ARTIFACT_PATHS.checkpoint_contract,
  V18R2_UX_CANARY_ARTIFACT_PATHS.security_manifest,
  V18R2_UX_CANARY_ARTIFACT_PATHS.provenance_contract,
  V18R2_UX_CANARY_ARTIFACT_PATHS.protocol,
  V18R2_UX_CANARY_ARTIFACT_PATHS.compiled_plan,
  V18R2_UX_CANARY_ARTIFACT_PATHS.candidate_manifest,
  V18R2_UX_CANARY_ARTIFACT_PATHS.approval_placeholder,
  V18R2_UX_CANARY_ARTIFACT_PATHS.authorization,
  V18R2_UX_CANARY_ARTIFACT_PATHS.live_document,
  ...fixtureReferences.map((reference) => reference.path)
];
const generatedFiles = fileIdentities(generatedFilePaths);
const generatedCoreTreeDigest = stableHash(generatedFiles);
const candidateIdentity = {
  identity_version: "formative-conversation-v18r2-ux-canary-identity-v1",
  candidate_revision: V18R2_UX_CANARY_REVISION,
  runtime_candidate_hash: protocol.runtime_candidate_hash,
  formative_prompt_hash: protocol.formative_prompt_hash,
  protocol_hash: protocol.protocol_hash,
  runner_implementation_hash: runnerHash,
  materializer_implementation_hash: materializerHash,
  fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
  aggregate_fixture_hash: aggregateFixtureHash,
  compiled_plan_hash: compiledPlan.compiled_plan_hash,
  environment_contract_hash: environmentContract.environment_contract_hash,
  checkpoint_contract_hash: checkpointContract.checkpoint_contract_hash,
  provenance_contract_hash: provenanceContract.provenance_contract_hash,
  security_wrapper_hash: securityWrapperHash,
  candidate_manifest_hash: candidateManifest.candidate_manifest_hash,
  generated_core_tree_digest: generatedCoreTreeDigest,
  generated_files: generatedFiles,
  future_source_commit: null,
  live_execution_prepared: true,
  approval_eligible: false,
  activation_permitted: false
} as const;
const finalizedCandidateIdentity = {
  ...candidateIdentity,
  candidate_identity_hash: stableHash(candidateIdentity)
};
writeJson(
  V18R2_UX_CANARY_ARTIFACT_PATHS.candidate_identity,
  finalizedCandidateIdentity
);

console.log(JSON.stringify({
  status: "materialized",
  candidate_revision: V18R2_UX_CANARY_REVISION,
  runtime_candidate_hash: protocol.runtime_candidate_hash,
  formative_prompt_hash: protocol.formative_prompt_hash,
  protocol_hash: protocol.protocol_hash,
  runner_implementation_hash: runnerHash,
  materializer_implementation_hash: materializerHash,
  fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
  aggregate_fixture_hash: aggregateFixtureHash,
  compiled_plan_hash: compiledPlan.compiled_plan_hash,
  environment_contract_hash: environmentContract.environment_contract_hash,
  checkpoint_contract_hash: checkpointContract.checkpoint_contract_hash,
  provenance_contract_hash: provenanceContract.provenance_contract_hash,
  security_wrapper_hash: securityWrapperHash,
  candidate_manifest_hash: candidateManifest.candidate_manifest_hash,
  candidate_identity_hash: finalizedCandidateIdentity.candidate_identity_hash,
  generated_core_tree_digest: generatedCoreTreeDigest,
  live_execution_prepared: true,
  exact_authorization_created: false,
  approval_eligible: false,
  activation_permitted: false,
  provider_calls: 0,
  model_auth_requests: 0,
  generation_network_requests: 0,
  real_dispatch_checkpoints: 0
}, null, 2));
