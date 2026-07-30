import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  candidateActiveOperationalConfigHash,
  candidateOperationalModelHash,
  candidateRuntimeConfigurationHash,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  PROVIDER_FAILURE_TAXONOMY_VERSION,
  PROVIDER_REQUEST_TRACING_POLICY_VERSION
} from "../src/lib/llm/provider-transport-retry";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_MEMORY_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner";
import {
  FORMATIVE_CONVERSATION_OPENING_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/opening-contract";
import {
  FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import {
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH,
  FormativeConversationV5FixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v5/contracts";
import {
  compileFormativeConversationV5ExecutionPlan
} from "../src/lib/operational/formative-conversation-v5-evaluation-v5/compiler";
import {
  formativeConversationV5FixtureSources
} from "../src/lib/operational/formative-conversation-v5-evaluation-v5/fixture-source";
import {
  FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT,
  FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v5/live-environment";

const EXPECTED_RUNTIME_CANDIDATE_HASH =
  "a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3";
const FAILED_V4_PROTOCOL_HASH =
  "662a9e2e9ec2929147bd7ec0150708186f07e32ff2029f606de6b0e9d502c84e";
const FAILED_V4_SOURCE_COMMIT =
  "c9082e8457c1f3a11a5fd9acbd1ca250e889363c";
const RUNTIME_CANDIDATE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/runtime-candidate-manifest.json`;
const V4_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v4";
const V4_SOURCE_CONFIGURATION_PATH =
  `${V4_ROOT}/source-configuration.json`;
const V4_PROTOCOL_PATH =
  `${V4_ROOT}/executable-evaluation-protocol.json`;
const V4_PLAN_ARTIFACTS = [
  {
    path: ".data/operational-formative-conversation-v5-evaluation-v4/plans/fcv5_plan_20260730095417_dee56813.json",
    sha256:
      "9b9be1c503999c8b3bc0629759b4a45ccade7ee471ed8b4281d418cff2784f77"
  },
  {
    path: ".data/operational-formative-conversation-v5-evaluation-v4/plans/fcv5_plan_20260730103510_32dd5b3c.json",
    sha256:
      "7e70f72e890563599af5c833663727c258e3c5887d9a352a55ab99dbe62dbbff"
  }
] as const;
const FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v3-failure-analysis.json`;
const HUMAN_REVIEW_ADVISORY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v3-human-review-advisory.json`;
const CASE7_OPENING_REGRESSION_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/case7-opening-output.json`;
function absolute(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

function readJson(relativePath: string) {
  return JSON.parse(
    readFileSync(absolute(relativePath), "utf8")
  ) as Record<string, unknown>;
}

function writeJson(relativePath: string, value: unknown) {
  const outputPath = absolute(relativePath);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

function fileSha(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

const sourceCandidate =
  readCandidateOperationalModelConfig(RUNTIME_CANDIDATE_PATH);
const sourceCandidateHash =
  candidateOperationalModelHash(sourceCandidate);
const runtimeCandidateHash =
  candidateRuntimeConfigurationHash(sourceCandidate);
const candidateActiveConfigurationHash =
  candidateActiveOperationalConfigHash(sourceCandidate);
if (runtimeCandidateHash !== EXPECTED_RUNTIME_CANDIDATE_HASH) {
  throw new Error(
    "formative_conversation_v5_v5_runtime_candidate_changed"
  );
}
if (
  fileSha(RUNTIME_CANDIDATE_PATH) !==
  fileSha(`${V4_ROOT}/runtime-candidate-manifest.json`)
) {
  throw new Error(
    "formative_conversation_v5_v5_runtime_manifest_changed"
  );
}

const v4SourceConfiguration = readJson(
  V4_SOURCE_CONFIGURATION_PATH
);
const previousGovernance =
  v4SourceConfiguration.preserved_governance as Record<
    string,
    unknown
  >;
const v4Protocol = readJson(V4_PROTOCOL_PATH);
if (stableHash(v4Protocol) !== FAILED_V4_PROTOCOL_HASH) {
  throw new Error(
    "formative_conversation_v5_v4_protocol_changed"
  );
}
for (const plan of V4_PLAN_ARTIFACTS) {
  if (fileSha(plan.path) !== plan.sha256) {
    throw new Error(
      "formative_conversation_v5_v4_plan_evidence_changed"
    );
  }
}

const targetRole =
  sourceCandidate.roles.formative_conversation_agent;
if (!targetRole) {
  throw new Error(
    "formative_conversation_v5_v5_target_role_missing"
  );
}
const targetRoleIdentity = {
  agent_name: "formative_conversation_agent",
  model_snapshot: targetRole.model_name,
  reasoning_effort: targetRole.reasoning_effort,
  max_output_tokens: targetRole.max_output_tokens,
  prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
  prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
  schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  safety_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  memory_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
  opening_validator_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
  profile_transition_version:
    FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION,
  provider_failure_taxonomy_version:
    PROVIDER_FAILURE_TAXONOMY_VERSION,
  provider_request_tracing_version:
    PROVIDER_REQUEST_TRACING_POLICY_VERSION
};

const failedV4PreDispatch = {
  artifact_version:
    "formative-conversation-v5-v4-pre-dispatch-evidence-v1",
  source_commit_sha: FAILED_V4_SOURCE_COMMIT,
  runtime_candidate_hash: EXPECTED_RUNTIME_CANDIDATE_HASH,
  protocol_hash: FAILED_V4_PROTOCOL_HASH,
  source_plan_artifacts: V4_PLAN_ARTIFACTS,
  sandbox_launcher_failure: "tsx_ipc_socket_eperm",
  approved_execution_failure: "approved_config_hash_mismatch",
  dispatch_checkpoint_created: false,
  provider_run_created: false,
  generation_request_created: false,
  provider_calls: 0,
  secrets_displayed: false,
  secrets_persisted: false,
  preserved_immutable: true,
  rerunnable: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH,
  failedV4PreDispatch
);
const failedV4EvidenceSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH
);

const liveEnvironmentContract = {
  contract_version:
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  launcher: {
    version: FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
    mechanism: FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
    path: "scripts/operational-formative-conversation-v5-v5-launcher.mjs",
    child_cli_path:
      "prisma/operational-formative-conversation-v5-v5-evaluate.ts",
    plan_and_live_share_launcher: true,
    tsx_cli_ipc_used: false
  },
  environment_sources: [
    "render_process_local",
    "render_runtime",
    "deterministic_test"
  ],
  required_injected_environment: [
    ...FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT
  ],
  secret_environment: [
    ...FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT
  ],
  active_approval_and_candidate_separate: true,
  active_approval_paths_must_be_explicit_and_readable: true,
  local_path_projection_requires_render_source_paths: true,
  database_probe_required: true,
  research_export_probe_required: true,
  provider_credential_shape_check_only: true,
  provider_auth_network_requests: 0,
  provider_generation_requests: 0,
  checkpoint_created_during_preflight: false,
  secrets_recorded: false,
  secret_fingerprints_recorded: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
  liveEnvironmentContract
);
const liveEnvironmentContractHash = stableHash(
  liveEnvironmentContract
);

const sourceConfiguration = {
  artifact_version:
    "formative-conversation-v5-executable-source-configuration-v5",
  captured_from_application_git_commit: currentGitCommit(),
  source_candidate_manifest: {
    path: RUNTIME_CANDIDATE_PATH,
    canonical_hash: sourceCandidateHash,
    file_sha256: fileSha(RUNTIME_CANDIDATE_PATH)
  },
  source_runtime_identity: {
    runtime_candidate_hash: runtimeCandidateHash,
    candidate_active_configuration_hash:
      candidateActiveConfigurationHash,
    role_count: 18
  },
  target_role_configuration: {
    ...targetRoleIdentity,
    model_name: targetRole.model_name,
    live_calls_enabled: true,
    instructional_fallback: "none"
  },
  required_environment: {
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_BASE_URL: "existing_render_process_value",
    DATABASE_URL: "required_process_local_secret_not_persisted",
    SESSION_SECRET: "required_process_local_secret_not_persisted",
    OPENAI_API_KEY: "required_process_local_secret_not_persisted",
    LLM_PROVIDER: "openai",
    LLM_LIVE_CALLS_ENABLED: true,
    OPENAI_MODEL_FORMATIVE_CONVERSATION: targetRole.model_name,
    OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION:
      targetRole.reasoning_effort,
    OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION:
      targetRole.max_output_tokens,
    FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: true,
    OPENAI_REQUEST_TIMEOUT_MS:
      sourceCandidate.runtime_policy?.provider_timeout_ms ?? 90_000,
    OPENAI_MAX_RETRIES:
      sourceCandidate.runtime_policy?.provider_max_retries ?? 2,
    OPERATIONAL_AGENT_MODE: "guarded_live",
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED:
      "application_default_true_when_render_value_absent",
    OPERATIONAL_APPROVED_CONFIG_HASH:
      previousGovernance.active_runtime_hash as string,
    OPERATIONAL_APPROVAL_BUNDLE_PATH:
      "existing_render_active_approval_bundle_path",
    OPERATIONAL_APPROVED_MANIFEST_PATH:
      "existing_render_approved_manifest_path",
    OPERATIONAL_APPROVAL_EVIDENCE_PATH:
      "existing_render_approval_evidence_path",
    OPERATIONAL_EFFECTIVE_RESULT_VERSION:
      "effective-system-eval-v2",
    OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION:
      "effective-validator-v1",
    STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED: true,
    TOPIC_DIALOGUE_LIVE_CALLS_ENABLED: true,
    TOPIC_DIALOGUE_MAX_STUDENT_TURNS: 10,
    TOPIC_DIALOGUE_RECENT_TURN_WINDOW: 12,
    TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS: 5000,
    TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS: true,
    RESEARCH_PSEUDONYMIZATION_KEY:
      "required_process_local_secret_not_persisted",
    FORMATIVE_CONVERSATION_V5_V5_LIVE_EVALUATION_ENABLED: true
  },
  preserved_governance: {
    ...previousGovernance,
    failed_v4_protocol_hash: FAILED_V4_PROTOCOL_HASH,
    failed_v4_source_commit_sha: FAILED_V4_SOURCE_COMMIT,
    failed_v4_pre_dispatch_evidence_path:
      FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH,
    failed_v4_pre_dispatch_evidence_sha256:
      failedV4EvidenceSha,
    failed_v4_dispatch_checkpoint_created: false,
    failed_v4_provider_calls: 0
  },
  source_code_references: {
    runtime_prompt_and_identity:
      "src/lib/services/student-assessment/formative-conversation/live-runner.ts",
    output_contract:
      "src/lib/services/student-assessment/formative-conversation/agent-contract.ts",
    context_compiler:
      "src/lib/services/student-assessment/formative-conversation/context.ts",
    memory:
      "src/lib/services/student-assessment/formative-conversation/memory.ts",
    safety_boundary:
      "src/lib/services/student-assessment/formative-conversation/safety-boundary.ts",
    opening_validator:
      "src/lib/services/student-assessment/formative-conversation/opening-contract.ts",
    profile_transition:
      "src/lib/services/student-assessment/formative-conversation/profile-update.ts",
    provider_retry:
      "src/lib/llm/provider-transport-retry.ts",
    formative_runtime:
      "src/lib/services/student-assessment/formative-conversation/runtime.ts",
    live_environment_parity:
      "src/lib/operational/formative-conversation-v5-evaluation-v5/live-environment.ts",
    launch_mechanism:
      "scripts/operational-formative-conversation-v5-v5-launcher.mjs",
    secure_process_local_injection:
      "scripts/operational-formative-conversation-v5-v5-process-local-runner.mjs",
    protocol_case_compiler:
      "src/lib/operational/formative-conversation-v5-evaluation-v5/compiler.ts",
    protocol_runner:
      "src/lib/operational/formative-conversation-v5-evaluation-v5/service.ts",
    production_execution_harness:
      "src/lib/evaluation/synthetic-student-validation/framework.ts"
  }
};
writeJson(
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  sourceConfiguration
);

const candidateManifest = {
  manifest_version:
    "formative-conversation-host-v5-executable-candidate-revision-v5",
  approval_state: "candidate_not_approved",
  activation_permitted: false,
  runtime_behavior_changed: false,
  source_candidate_manifest:
    sourceConfiguration.source_candidate_manifest,
  runtime_candidate_hash: runtimeCandidateHash,
  runtime_candidate_hash_unchanged: true,
  executable_protocol_path:
    FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  fixture_manifest_path:
    FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  compiled_execution_plan_path:
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  live_environment_contract_path:
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
  target_role: "formative_conversation_agent",
  target_role_identity: targetRoleIdentity,
  preserved_active_runtime_hash:
    previousGovernance.active_runtime_hash,
  preserved_rollback_runtime_hash:
    previousGovernance.rollback_runtime_hash,
  prior_incomplete_protocol_hash:
    previousGovernance.prior_incomplete_protocol_hash,
  failed_v2_protocol_hash:
    previousGovernance.failed_v2_protocol_hash,
  failed_v3_protocol_hash:
    previousGovernance.failed_v3_protocol_hash,
  failed_v4_protocol_hash: FAILED_V4_PROTOCOL_HASH
};
writeJson(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  candidateManifest
);

const fixtureRecords = formativeConversationV5FixtureSources.map(
  (source) => {
    const fixtureHash = stableHash(source);
    const fixture = FormativeConversationV5FixtureSchema.parse({
      ...source,
      fixture_hash: fixtureHash
    });
    const fixturePath =
      `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixtures/${source.case_id}.json`;
    writeJson(fixturePath, fixture);
    return {
      fixture,
      reference: {
        case_id: source.case_id,
        order: source.case_order,
        path: fixturePath,
        fixture_hash: fixtureHash,
        file_sha256: fileSha(fixturePath)
      }
    };
  }
);
const aggregateFixtureHash = stableHash(
  fixtureRecords.map(({ reference }) => ({
    case_id: reference.case_id,
    case_order: reference.order,
    fixture_hash: reference.fixture_hash
  }))
);
const fixtureManifest = {
  manifest_version: "formative-conversation-v5-fixture-manifest-v5",
  fixture_hash_semantics:
    "stable_hash_of_fixture_with_fixture_hash_omitted",
  fixture_count: 8,
  fixed_case_order: fixtureRecords.map(
    ({ reference }) => reference.case_id
  ),
  fixtures: fixtureRecords.map(({ reference }) => reference),
  aggregate_fixture_hash: aggregateFixtureHash,
  execution_engine:
    FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION,
  frozen_case_schema:
    "formative-conversation-v5-protocol-case-schema-v1",
  forbidden_runner_substitutions: [
    "operational_model_upgrade_legacy_21_case_runner",
    "synthetic_student_persona_cli",
    "synthetic_student_persona_schema"
  ]
};
writeJson(
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  fixtureManifest
);

const runnerImplementationFiles = [
  {
    role: "secure_process_local_injector",
    path: "scripts/operational-formative-conversation-v5-v5-process-local-runner.mjs"
  },
  {
    role: "launcher",
    path: "scripts/operational-formative-conversation-v5-v5-launcher.mjs"
  },
  {
    role: "cli",
    path: "prisma/operational-formative-conversation-v5-v5-evaluate.ts"
  },
  {
    role: "orchestration_service",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v5/service.ts"
  },
  {
    role: "environment_parity_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v5/live-environment.ts"
  },
  {
    role: "environment_contract",
    path: FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
  },
  {
    role: "candidate_transport_runner",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v5/candidate-runner.ts"
  },
  {
    role: "package_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v5/package.ts"
  },
  {
    role: "contract_schemas",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v5/contracts.ts"
  },
  {
    role: "case_compiler",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v5/compiler.ts"
  },
  {
    role: "production_execution_harness",
    path: "src/lib/evaluation/synthetic-student-validation/framework.ts"
  },
  {
    role: "provider_retry_policy",
    path: "src/lib/llm/provider-transport-retry.ts"
  },
  {
    role: "opening_validator",
    path: "src/lib/services/student-assessment/formative-conversation/opening-contract.ts"
  },
  {
    role: "profile_transition_persistence",
    path: "src/lib/services/student-assessment/formative-conversation/profile-update.ts"
  },
  {
    role: "formative_runtime",
    path: "src/lib/services/student-assessment/formative-conversation/runtime.ts"
  },
  {
    role: "correction_evidence",
    path: FAILURE_ANALYSIS_PATH
  },
  {
    role: "human_review_advisory",
    path: HUMAN_REVIEW_ADVISORY_PATH
  },
  {
    role: "regression_evidence",
    path: CASE7_OPENING_REGRESSION_PATH
  },
  {
    role: "failed_pre_dispatch_evidence",
    path: FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH
  }
].map((entry) => ({
  ...entry,
  sha256: fileSha(entry.path)
}));
const runnerImplementation = {
  aggregate_hash: stableHash(runnerImplementationFiles),
  files: runnerImplementationFiles
};

const protocol: Record<string, unknown> = {
  ...v4Protocol,
  protocol_version:
    "formative-conversation-host-v5-executable-evaluation-v5",
  candidate_manifest_path:
    FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  fixture_manifest_path:
    FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  compiled_execution_plan_path:
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  live_environment_contract_path:
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH,
  live_environment_contract_hash: liveEnvironmentContractHash,
  failed_v4_pre_dispatch: {
    source_commit_sha: FAILED_V4_SOURCE_COMMIT,
    runtime_candidate_hash: EXPECTED_RUNTIME_CANDIDATE_HASH,
    protocol_hash: FAILED_V4_PROTOCOL_HASH,
    sandbox_launcher_failure: "tsx_ipc_socket_eperm",
    live_environment_failure: "approved_config_hash_mismatch",
    dispatch_checkpoint_created: false,
    provider_run_created: false,
    generation_request_created: false,
    provider_calls: 0,
    source_plan_artifacts: V4_PLAN_ARTIFACTS,
    evidence_path:
      FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH,
    evidence_sha256: failedV4EvidenceSha,
    preserved_immutable: true,
    rerunnable: false
  },
  target_identity: {
    runtime_candidate_hash: runtimeCandidateHash,
    model_snapshot: targetRoleIdentity.model_snapshot,
    reasoning_effort: targetRoleIdentity.reasoning_effort,
    max_output_tokens: targetRoleIdentity.max_output_tokens,
    prompt_version: targetRoleIdentity.prompt_version,
    prompt_hash: targetRoleIdentity.prompt_hash,
    schema_version: targetRoleIdentity.schema_version,
    context_version: targetRoleIdentity.context_version,
    safety_version: targetRoleIdentity.safety_version,
    memory_version: targetRoleIdentity.memory_version,
    opening_validator_version:
      targetRoleIdentity.opening_validator_version,
    profile_transition_version:
      targetRoleIdentity.profile_transition_version,
    provider_failure_taxonomy_version:
      targetRoleIdentity.provider_failure_taxonomy_version,
    provider_request_tracing_version:
      targetRoleIdentity.provider_request_tracing_version
  },
  execution_policy: {
    ...(v4Protocol.execution_policy as Record<string, unknown>),
    runner_version:
      FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
  },
  runner_implementation: runnerImplementation,
  isolation: {
    ...(v4Protocol.isolation as Record<string, unknown>),
    provider_run_id_template:
      "fcv5v5_provider_<timestamp>_<random>",
    derived_evaluation_id_template:
      "fcv5v5_derived_<timestamp>_<random>"
  },
  live_authorization_template:
    "I authorize one live execution of formative-conversation-host-v5-executable-v5 for runtime candidate hash <runtime_candidate_hash> and evaluation protocol hash <evaluation_protocol_hash>, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.",
  required_live_environment_flag:
    "FORMATIVE_CONVERSATION_V5_V5_LIVE_EVALUATION_ENABLED=true"
};
writeJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH, protocol);

const protocolHash = stableHash(protocol);
const fixtureManifestHash = stableHash(fixtureManifest);
const budget =
  protocol.budget as Parameters<
    typeof compileFormativeConversationV5ExecutionPlan
  >[0]["budget"];
const isolation = protocol.isolation as {
  run_namespace_template: string;
  case_namespace_template: string;
};
const compiledPlan = compileFormativeConversationV5ExecutionPlan({
  runtime_candidate_hash: runtimeCandidateHash,
  evaluation_protocol_hash: protocolHash,
  runner_implementation_hash:
    runnerImplementation.aggregate_hash,
  live_environment_contract_hash: liveEnvironmentContractHash,
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
  run_namespace_template: isolation.run_namespace_template,
  case_namespace_template: isolation.case_namespace_template,
  intended_artifacts: protocol.intended_artifacts as string[]
});
writeJson(
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  compiledPlan
);

const approvalPlaceholder = {
  artifact_version:
    "formative-conversation-v5-executable-approval-placeholder-v5",
  artifact_state: "placeholder_not_approval_evidence",
  runtime_candidate_hash: runtimeCandidateHash,
  evaluation_protocol_hash: protocolHash,
  provider_evaluation: {
    status: "not_run",
    source_provider_run_id: null,
    derived_evaluation_id: null
  },
  human_review: {
    status: "not_started",
    student_facing_outputs_reviewed: false,
    decision: null
  },
  approval: {
    eligible: false,
    approved_at: null,
    approval_evidence_hash: null
  },
  activation: {
    permitted: false,
    activated_at: null
  }
};
writeJson(
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  approvalPlaceholder
);

const candidateIdentity = {
  artifact_version:
    "formative-conversation-v5-executable-candidate-identity-v5",
  approval_state: "candidate_not_approved",
  activation_permitted: false,
  no_provider_call_during_freeze: true,
  runtime_candidate_hash: runtimeCandidateHash,
  runtime_candidate_hash_unchanged: true,
  source_candidate_manifest_hash: sourceCandidateHash,
  candidate_revision_manifest_hash: stableHash(candidateManifest),
  candidate_revision_manifest_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH
  ),
  executable_evaluation_protocol_hash: protocolHash,
  executable_evaluation_protocol_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH
  ),
  runner_implementation_hash:
    runnerImplementation.aggregate_hash,
  live_environment_contract_hash: liveEnvironmentContractHash,
  live_environment_contract_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
  ),
  fixture_manifest_hash: fixtureManifestHash,
  fixture_manifest_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
  ),
  aggregate_fixture_hash: aggregateFixtureHash,
  compiled_execution_plan_hash: compiledPlan.compiled_plan_hash,
  compiled_execution_plan_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH
  ),
  source_configuration_hash: stableHash(sourceConfiguration),
  source_configuration_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH
  ),
  approval_placeholder_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH
  ),
  preserved_incomplete_protocol_hash:
    previousGovernance.prior_incomplete_protocol_hash,
  preserved_active_runtime_hash:
    previousGovernance.active_runtime_hash,
  preserved_rollback_runtime_hash:
    previousGovernance.rollback_runtime_hash,
  candidate_active_configuration_hash:
    candidateActiveConfigurationHash,
  failed_v2_protocol_hash:
    previousGovernance.failed_v2_protocol_hash,
  failed_v2_checkpoint_sha256:
    previousGovernance.failed_v2_dispatch_checkpoint_sha256,
  failed_v3_protocol_hash:
    previousGovernance.failed_v3_protocol_hash,
  failed_v3_checkpoint_sha256:
    previousGovernance.failed_v3_dispatch_checkpoint_sha256,
  failed_v3_source_provider_run_sha256:
    previousGovernance.failed_v3_source_provider_run_sha256,
  failed_v3_derived_evaluation_sha256:
    previousGovernance.failed_v3_derived_evaluation_sha256,
  failed_v4_protocol_hash: FAILED_V4_PROTOCOL_HASH,
  failed_v4_pre_dispatch_evidence_sha256:
    failedV4EvidenceSha,
  source_application_git_commit:
    sourceConfiguration.captured_from_application_git_commit
};
writeJson(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  candidateIdentity
);

console.log(
  JSON.stringify(
    {
      status: "materialized",
      provider_calls: 0,
      provider_network_requests: 0,
      runtime_candidate_hash: runtimeCandidateHash,
      runtime_candidate_hash_unchanged: true,
      evaluation_protocol_hash: protocolHash,
      runner_implementation_hash:
        runnerImplementation.aggregate_hash,
      live_environment_contract_hash:
        liveEnvironmentContractHash,
      fixture_manifest_hash: fixtureManifestHash,
      aggregate_fixture_hash: aggregateFixtureHash,
      candidate_manifest_hash: stableHash(candidateManifest),
      compiled_plan_hash: compiledPlan.compiled_plan_hash,
      failed_v4_evidence_sha256: failedV4EvidenceSha
    },
    null,
    2
  )
);
