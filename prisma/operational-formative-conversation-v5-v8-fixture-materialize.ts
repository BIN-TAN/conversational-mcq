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
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
  PROVIDER_REQUEST_TRACING_POLICY_VERSION
} from "../src/lib/llm/provider-transport-retry";
import { OPENAI_RESPONSES_ADAPTER_VERSION } from "../src/lib/llm/providers/openai-responses-provider";
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
  FORMATIVE_CONVERSATION_STUDENT_OUTPUT_FORMAT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/output-format";
import {
  FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import { FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";
import { FORMATIVE_CONVERSATION_PERSISTENCE_CONTRACT_VERSION } from "../src/lib/services/student-assessment/formative-conversation/persistence-errors";
import { FORMATIVE_CONVERSATION_PROVIDER_PERSISTENCE_BOUNDARY_VERSION } from "../src/lib/services/student-assessment/formative-conversation/provider-persistence-boundary";
import { EVALUATION_DATABASE_LIFECYCLE_VERSION } from "../src/lib/operational/evaluation-database-lifecycle";
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
  FORMATIVE_CONVERSATION_V5_V5_DISPATCH_PATH,
  FORMATIVE_CONVERSATION_V5_V5_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V5_HUMAN_REVIEW_ADVISORY_PATH,
  FORMATIVE_CONVERSATION_V5_V5_RUN_ROOT,
  FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH,
  FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH,
  FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT,
  FORMATIVE_CONVERSATION_V5_V7_AGGREGATE_PATH,
  FORMATIVE_CONVERSATION_V5_V7_CASE5_TRANSCRIPT_PATH,
  FORMATIVE_CONVERSATION_V5_V7_CASE7_TRANSCRIPT_PATH,
  FORMATIVE_CONVERSATION_V5_V7_CASE8_TRANSCRIPT_PATH,
  FORMATIVE_CONVERSATION_V5_V7_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V7_HASH_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_V7_HUMAN_REVIEW_ADJUDICATION_PATH,
  FORMATIVE_CONVERSATION_V5_CASE7_EXACT_REPLAY_PATH,
  FORMATIVE_CONVERSATION_V5_CASE8_EXACT_REPLAY_PATH,
  FormativeConversationV5FixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/contracts";
import {
  compileFormativeConversationV5ExecutionPlan
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/compiler";
import {
  formativeConversationV5FixtureSources
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/fixture-source";
import {
  FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT,
  FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v8/live-environment";

const FAILED_V5_RUNTIME_CANDIDATE_HASH =
  "a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3";
const FAILED_V5_PROTOCOL_HASH =
  "7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c";
const FAILED_V5_SOURCE_COMMIT =
  "3b55bed5ff20831070c5d5ef1b1902aa77527236";
const FAILED_V6_RUNTIME_CANDIDATE_HASH =
  "494ed38226f655c19429e0f54dc78c78239a6492f39895cd5231fc5d22a87f59";
const FAILED_V6_PROTOCOL_HASH =
  "8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625";
const FAILED_V6_SOURCE_COMMIT =
  "c33cb7123b0411e8dbfca6ffd95355a70f3292d0";
const FAILED_V7_RUNTIME_CANDIDATE_HASH =
  "81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356";
const FAILED_V7_PROTOCOL_HASH =
  "620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d";
const FAILED_V7_SOURCE_COMMIT =
  "c0c05b60755ab1b9b293c8e12a2ac5645a952c17";
const FAILED_V7_PROVIDER_RUN_ID =
  "fcv5v7_provider_20260801013024_27f671a7";
const FAILED_V7_DERIVED_EVALUATION_ID =
  "fcv5v7_derived_20260801013024_4da7a38f";
const FAILED_V4_PROTOCOL_HASH =
  "662a9e2e9ec2929147bd7ec0150708186f07e32ff2029f606de6b0e9d502c84e";
const FAILED_V4_SOURCE_COMMIT =
  "c9082e8457c1f3a11a5fd9acbd1ca250e889363c";
const RUNTIME_CANDIDATE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/runtime-candidate-manifest.json`;
const V5_RUNTIME_CANDIDATE_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v5/runtime-candidate-manifest.json";
const V6_RUNTIME_CANDIDATE_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v6/runtime-candidate-manifest.json";
const V7_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v7";
const V7_RUNTIME_CANDIDATE_PATH = `${V7_ROOT}/runtime-candidate-manifest.json`;
const V7_SOURCE_CONFIGURATION_PATH = `${V7_ROOT}/source-configuration.json`;
const V7_PROTOCOL_PATH = `${V7_ROOT}/executable-evaluation-protocol.json`;
const V4_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v4";
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
const failedV5Candidate =
  readCandidateOperationalModelConfig(V5_RUNTIME_CANDIDATE_PATH);
const failedV6Candidate =
  readCandidateOperationalModelConfig(V6_RUNTIME_CANDIDATE_PATH);
const failedV7Candidate =
  readCandidateOperationalModelConfig(V7_RUNTIME_CANDIDATE_PATH);
const sourceCandidateHash =
  candidateOperationalModelHash(sourceCandidate);
const runtimeCandidateHash =
  candidateRuntimeConfigurationHash(sourceCandidate);
const failedV5RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(failedV5Candidate);
const failedV6RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(failedV6Candidate);
const failedV7RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(failedV7Candidate);
const candidateActiveConfigurationHash =
  candidateActiveOperationalConfigHash(sourceCandidate);
if (
  failedV5RuntimeCandidateHash !== FAILED_V5_RUNTIME_CANDIDATE_HASH ||
  failedV6RuntimeCandidateHash !== FAILED_V6_RUNTIME_CANDIDATE_HASH ||
  failedV7RuntimeCandidateHash !== FAILED_V7_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V5_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V6_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V7_RUNTIME_CANDIDATE_HASH
) {
  throw new Error(
    "formative_conversation_v5_v8_runtime_candidate_identity_invalid"
  );
}
if (
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(failedV5Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(failedV5Candidate.runtime_policy) ||
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(failedV6Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(failedV6Candidate.runtime_policy) ||
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(failedV7Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(failedV7Candidate.runtime_policy)
) {
  throw new Error(
    "formative_conversation_v5_v8_model_or_runtime_policy_changed"
  );
}

const v7SourceConfiguration = readJson(
  V7_SOURCE_CONFIGURATION_PATH
);
const previousGovernance =
  v7SourceConfiguration.preserved_governance as Record<
    string,
    unknown
  >;
const v4Protocol = readJson(V4_PROTOCOL_PATH);
if (stableHash(v4Protocol) !== FAILED_V4_PROTOCOL_HASH) {
  throw new Error(
    "formative_conversation_v5_v4_protocol_changed"
  );
}
const v7Protocol = readJson(V7_PROTOCOL_PATH);
if (stableHash(v7Protocol) !== FAILED_V7_PROTOCOL_HASH) {
  throw new Error(
    "formative_conversation_v5_v7_protocol_changed"
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
  profile_transition_validator_version:
    FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
  student_output_format_version:
    FORMATIVE_CONVERSATION_STUDENT_OUTPUT_FORMAT_VERSION,
  provider_failure_taxonomy_version:
    PROVIDER_FAILURE_TAXONOMY_VERSION,
  provider_transport_retry_policy_version:
    PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
  provider_request_tracing_version:
    PROVIDER_REQUEST_TRACING_POLICY_VERSION,
  provider_adapter_version:
    OPENAI_RESPONSES_ADAPTER_VERSION,
  persistence_contract_version:
    FORMATIVE_CONVERSATION_PERSISTENCE_CONTRACT_VERSION,
  provider_persistence_boundary_version:
    FORMATIVE_CONVERSATION_PROVIDER_PERSISTENCE_BOUNDARY_VERSION,
  evaluation_database_lifecycle_version:
    EVALUATION_DATABASE_LIFECYCLE_VERSION
};

const failedV4PreDispatch = {
  artifact_version:
    "formative-conversation-v5-v4-pre-dispatch-evidence-v1",
  source_commit_sha: FAILED_V4_SOURCE_COMMIT,
  runtime_candidate_hash: FAILED_V5_RUNTIME_CANDIDATE_HASH,
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
const failedV5SourceProviderRunPath =
  `${FORMATIVE_CONVERSATION_V5_V5_RUN_ROOT}/source-provider-run.json`;
const failedV5DerivedEvaluationPath =
  `${FORMATIVE_CONVERSATION_V5_V5_RUN_ROOT}/derived-evaluation.json`;
const failedV5SourceProviderRunSha =
  fileSha(failedV5SourceProviderRunPath);
const failedV5DerivedEvaluationSha =
  fileSha(failedV5DerivedEvaluationPath);
const failedV5CheckpointSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V5_DISPATCH_PATH
);
const failedV5FailureAnalysisSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V5_FAILURE_ANALYSIS_PATH
);
const failedV5HumanReviewAdvisorySha = fileSha(
  FORMATIVE_CONVERSATION_V5_V5_HUMAN_REVIEW_ADVISORY_PATH
);
if (
  failedV5SourceProviderRunSha !==
    "646e65e590cd3cc8369261f5f7033c1e5d59a6205280b15664027ef6bfe3538e" ||
  failedV5DerivedEvaluationSha !==
    "022dfd8466894fdc191a8371f6b79af822ac8f0c308723391a994c570ec61562" ||
  failedV5CheckpointSha !==
    "1aceb19602ca99e5b26733a59cc565d2552d0a9f8d243e7a0243fcbd1ccdba4a"
) {
  throw new Error(
    "formative_conversation_v5_v5_immutable_evidence_changed"
  );
}

const failedV6SourceProviderRunPath =
  `${FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT}/source-provider-run.json`;
const failedV6DerivedEvaluationPath =
  `${FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT}/derived-evaluation.json`;
const failedV6HumanReviewPackagePath =
  `${FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT}/human-review-package.json`;
const failedV6SourceProviderRunSha =
  fileSha(failedV6SourceProviderRunPath);
const failedV6DerivedEvaluationSha =
  fileSha(failedV6DerivedEvaluationPath);
const failedV6HumanReviewPackageSha =
  fileSha(failedV6HumanReviewPackagePath);
const failedV6CheckpointSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH
);
const failedV6FailureAnalysisSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH
);
const failedV6HumanReviewAdvisorySha = fileSha(
  FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH
);
if (
  failedV6SourceProviderRunSha !==
    "5df093a9bd4d7639636e6e0facc8cb3c19649bcabbc44479bc532eaa9e15eb34" ||
  failedV6DerivedEvaluationSha !==
    "b09f885149478e8a0160ce2337f25f1623f56427715ddb29cae575f95f86cc80" ||
  failedV6HumanReviewPackageSha !==
    "3420c91ddf69d027e0d9815283193d40fc17cd056865c9d5d27b641d0efc3a6f" ||
  failedV6CheckpointSha !==
    "8eef8a8af1e336abaed0a307487ff5f51a6535fd7c0a0b44dde12a0586d6d5f1"
) {
  throw new Error(
    "formative_conversation_v5_v6_immutable_evidence_changed"
  );
}

const immutableV7Evidence = [
  {
    path: FORMATIVE_CONVERSATION_V5_V7_AGGREGATE_PATH,
    sha256:
      "0d23da8b553c5c2d9ab197e65abd3ba35084320aedfb41cd7bd9648a063b63bc"
  },
  {
    path: FORMATIVE_CONVERSATION_V5_V7_HASH_MANIFEST_PATH,
    sha256:
      "259e303ed5abc2a351cd7b6af419f5f92315109e1fca7dd253eff357acdaeeba"
  },
  {
    path: FORMATIVE_CONVERSATION_V5_V7_CASE5_TRANSCRIPT_PATH,
    sha256:
      "09535e05b2054107b9e0ed73c4c9023487171d5f6bb7ad7d2fb73d4a68af61cd"
  },
  {
    path: FORMATIVE_CONVERSATION_V5_V7_CASE7_TRANSCRIPT_PATH,
    sha256:
      "a8d2d5abe9312df71f267ecb5f5b713f92f423229edb301adad037ca06ba70dd"
  },
  {
    path: FORMATIVE_CONVERSATION_V5_V7_CASE8_TRANSCRIPT_PATH,
    sha256:
      "2923a467af248b472f0cd0acac7a3d7d14ee27a8d72d88824fdf59b620e5f93b"
  }
] as const;
for (const artifact of immutableV7Evidence) {
  if (fileSha(artifact.path) !== artifact.sha256) {
    throw new Error(
      "formative_conversation_v5_v7_immutable_evidence_changed"
    );
  }
}
const failedV7Aggregate = readJson(
  FORMATIVE_CONVERSATION_V5_V7_AGGREGATE_PATH
);
if (
  failedV7Aggregate.provider_run_id !== FAILED_V7_PROVIDER_RUN_ID ||
  failedV7Aggregate.derived_evaluation_id !==
    FAILED_V7_DERIVED_EVALUATION_ID ||
  failedV7Aggregate.status !== "completed_failed"
) {
  throw new Error(
    "formative_conversation_v5_v7_failure_identity_invalid"
  );
}

const liveEnvironmentContract = {
  contract_version:
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  launcher: {
    version: FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
    mechanism: FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
    path: "scripts/operational-formative-conversation-v5-v8-launcher.mjs",
    child_cli_path:
      "prisma/operational-formative-conversation-v5-v8-evaluate.ts",
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
    "formative-conversation-v5-executable-source-configuration-v8",
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
    FORMATIVE_CONVERSATION_V5_V8_LIVE_EVALUATION_ENABLED: true
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
    failed_v4_provider_calls: 0,
    failed_v5_protocol_hash: FAILED_V5_PROTOCOL_HASH,
    failed_v5_source_commit_sha: FAILED_V5_SOURCE_COMMIT,
    failed_v5_provider_run_id:
      "fcv5v5_provider_20260730170219_4ac51142",
    failed_v5_derived_evaluation_id:
      "fcv5v5_derived_20260730170219_0a1eb734",
    failed_v5_dispatch_checkpoint_path:
      FORMATIVE_CONVERSATION_V5_V5_DISPATCH_PATH,
    failed_v5_dispatch_checkpoint_sha256:
      failedV5CheckpointSha,
    failed_v5_source_provider_run_path:
      failedV5SourceProviderRunPath,
    failed_v5_source_provider_run_sha256:
      failedV5SourceProviderRunSha,
    failed_v5_derived_evaluation_path:
      failedV5DerivedEvaluationPath,
    failed_v5_derived_evaluation_sha256:
      failedV5DerivedEvaluationSha,
    failed_v5_failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V5_FAILURE_ANALYSIS_PATH,
    failed_v5_failure_analysis_sha256:
      failedV5FailureAnalysisSha,
    failed_v5_human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V5_HUMAN_REVIEW_ADVISORY_PATH,
    failed_v5_human_review_advisory_sha256:
      failedV5HumanReviewAdvisorySha,
    failed_v5_execution_status: "completed_failed",
    failed_v5_approval_eligible: false,
    failed_v5_activation_permitted: false,
    failed_v5_rerunnable: false,
    failed_v6_protocol_hash: FAILED_V6_PROTOCOL_HASH,
    failed_v6_source_commit_sha: FAILED_V6_SOURCE_COMMIT,
    failed_v6_provider_run_id:
      "fcv5v6_provider_20260731032817_863a9cdd",
    failed_v6_derived_evaluation_id:
      "fcv5v6_derived_20260731032817_0bd6f382",
    failed_v6_dispatch_checkpoint_path:
      FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH,
    failed_v6_dispatch_checkpoint_sha256:
      failedV6CheckpointSha,
    failed_v6_source_provider_run_path:
      failedV6SourceProviderRunPath,
    failed_v6_source_provider_run_sha256:
      failedV6SourceProviderRunSha,
    failed_v6_derived_evaluation_path:
      failedV6DerivedEvaluationPath,
    failed_v6_derived_evaluation_sha256:
      failedV6DerivedEvaluationSha,
    failed_v6_human_review_package_path:
      failedV6HumanReviewPackagePath,
    failed_v6_human_review_package_sha256:
      failedV6HumanReviewPackageSha,
    failed_v6_failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH,
    failed_v6_failure_analysis_sha256:
      failedV6FailureAnalysisSha,
    failed_v6_human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH,
    failed_v6_human_review_advisory_sha256:
      failedV6HumanReviewAdvisorySha,
    failed_v6_execution_status: "completed_failed",
    failed_v6_approval_eligible: false,
    failed_v6_activation_permitted: false,
    failed_v6_rerunnable: false,
    failed_v7_runtime_candidate_hash:
      FAILED_V7_RUNTIME_CANDIDATE_HASH,
    failed_v7_protocol_hash: FAILED_V7_PROTOCOL_HASH,
    failed_v7_source_commit_sha: FAILED_V7_SOURCE_COMMIT,
    failed_v7_provider_run_id: FAILED_V7_PROVIDER_RUN_ID,
    failed_v7_derived_evaluation_id:
      FAILED_V7_DERIVED_EVALUATION_ID,
    failed_v7_execution_status: "completed_failed",
    failed_v7_approval_eligible: false,
    failed_v7_activation_permitted: false,
    failed_v7_rerunnable: false,
    failed_v7_immutable_evidence: immutableV7Evidence
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
    profile_transition_validator:
      "src/lib/services/student-assessment/formative-conversation/profile-transition-validator.ts",
    persistence_contract:
      "src/lib/services/student-assessment/formative-conversation/persistence-errors.ts",
    provider_persistence_boundary:
      "src/lib/services/student-assessment/formative-conversation/provider-persistence-boundary.ts",
    student_output_format:
      "src/lib/services/student-assessment/formative-conversation/output-format.ts",
    provider_retry:
      "src/lib/llm/provider-transport-retry.ts",
    provider_adapter:
      "src/lib/llm/providers/openai-responses-provider.ts",
    provider_adapter_identity:
      "src/lib/llm/providers/openai-responses-adapter-version.ts",
    provider_transport_diagnostics:
      "src/lib/llm/openai-transport-diagnostics.ts",
    evaluation_database_lifecycle:
      "src/lib/operational/evaluation-database-lifecycle.ts",
    formative_runtime:
      "src/lib/services/student-assessment/formative-conversation/runtime.ts",
    live_environment_parity:
      "src/lib/operational/formative-conversation-v5-evaluation-v8/live-environment.ts",
    launch_mechanism:
      "scripts/operational-formative-conversation-v5-v8-launcher.mjs",
    secure_process_local_injection:
      "scripts/operational-formative-conversation-v5-v8-process-local-runner.mjs",
    protocol_case_compiler:
      "src/lib/operational/formative-conversation-v5-evaluation-v8/compiler.ts",
    protocol_runner:
      "src/lib/operational/formative-conversation-v5-evaluation-v8/service.ts",
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
    "formative-conversation-host-v5-executable-candidate-revision-v8",
  approval_state: "candidate_not_approved",
  activation_permitted: false,
  runtime_behavior_changed: true,
  source_candidate_manifest:
    sourceConfiguration.source_candidate_manifest,
  runtime_candidate_hash: runtimeCandidateHash,
  runtime_candidate_hash_unchanged: false,
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
  failed_v4_protocol_hash: FAILED_V4_PROTOCOL_HASH,
  failed_v5_protocol_hash: FAILED_V5_PROTOCOL_HASH,
  failed_v6_protocol_hash: FAILED_V6_PROTOCOL_HASH,
  failed_v7_protocol_hash: FAILED_V7_PROTOCOL_HASH,
  failed_v7_runtime_candidate_hash:
    FAILED_V7_RUNTIME_CANDIDATE_HASH,
  failed_v7_execution_status: "completed_failed",
  failed_v7_rerunnable: false
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
  manifest_version: "formative-conversation-v5-fixture-manifest-v8",
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
    path: "scripts/operational-formative-conversation-v5-v8-process-local-runner.mjs"
  },
  {
    role: "launcher",
    path: "scripts/operational-formative-conversation-v5-v8-launcher.mjs"
  },
  {
    role: "cli",
    path: "prisma/operational-formative-conversation-v5-v8-evaluate.ts"
  },
  {
    role: "orchestration_service",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v8/service.ts"
  },
  {
    role: "environment_parity_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v8/live-environment.ts"
  },
  {
    role: "environment_contract",
    path: FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
  },
  {
    role: "candidate_transport_runner",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v8/candidate-runner.ts"
  },
  {
    role: "package_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v8/package.ts"
  },
  {
    role: "contract_schemas",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v8/contracts.ts"
  },
  {
    role: "case_compiler",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v8/compiler.ts"
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
    role: "provider_adapter",
    path: "src/lib/llm/providers/openai-responses-provider.ts"
  },
  {
    role: "provider_adapter_identity",
    path: "src/lib/llm/providers/openai-responses-adapter-version.ts"
  },
  {
    role: "provider_transport_diagnostics",
    path: "src/lib/llm/openai-transport-diagnostics.ts"
  },
  {
    role: "opening_validator",
    path: "src/lib/services/student-assessment/formative-conversation/opening-contract.ts"
  },
  {
    role: "profile_transition_validator",
    path: "src/lib/services/student-assessment/formative-conversation/profile-transition-validator.ts"
  },
  {
    role: "profile_transition_persistence",
    path: "src/lib/services/student-assessment/formative-conversation/profile-update.ts"
  },
  {
    role: "student_output_format_validator",
    path: "src/lib/services/student-assessment/formative-conversation/output-format.ts"
  },
  {
    role: "formative_runtime",
    path: "src/lib/services/student-assessment/formative-conversation/runtime.ts"
  },
  {
    role: "formative_persistence_contract",
    path: "src/lib/services/student-assessment/formative-conversation/persistence-errors.ts"
  },
  {
    role: "provider_persistence_boundary",
    path: "src/lib/services/student-assessment/formative-conversation/provider-persistence-boundary.ts"
  },
  {
    role: "initial_profile_persistence",
    path: "src/lib/agents/student-profiling/persistence.ts"
  },
  {
    role: "conversation_session_persistence",
    path: "src/lib/services/student-assessment/formative-conversation/service.ts"
  },
  {
    role: "database_lifecycle",
    path: "src/lib/operational/evaluation-database-lifecycle.ts"
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
  },
  {
    role: "immutable_case7_replay",
    path: FORMATIVE_CONVERSATION_V5_CASE7_EXACT_REPLAY_PATH
  },
  {
    role: "immutable_case8_replay",
    path: FORMATIVE_CONVERSATION_V5_CASE8_EXACT_REPLAY_PATH
  },
  {
    role: "failed_v5_analysis",
    path: FORMATIVE_CONVERSATION_V5_V5_FAILURE_ANALYSIS_PATH
  },
  {
    role: "failed_v5_human_review",
    path: FORMATIVE_CONVERSATION_V5_V5_HUMAN_REVIEW_ADVISORY_PATH
  },
  {
    role: "failed_v6_analysis",
    path: FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH
  },
  {
    role: "failed_v6_human_review",
    path: FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH
  },
  {
    role: "immutable_v7_aggregate",
    path: FORMATIVE_CONVERSATION_V5_V7_AGGREGATE_PATH
  },
  {
    role: "immutable_v7_hash_manifest",
    path: FORMATIVE_CONVERSATION_V5_V7_HASH_MANIFEST_PATH
  },
  {
    role: "immutable_v7_case5_replay",
    path: FORMATIVE_CONVERSATION_V5_V7_CASE5_TRANSCRIPT_PATH
  },
  {
    role: "immutable_v7_case7_replay",
    path: FORMATIVE_CONVERSATION_V5_V7_CASE7_TRANSCRIPT_PATH
  },
  {
    role: "immutable_v7_case8_replay",
    path: FORMATIVE_CONVERSATION_V5_V7_CASE8_TRANSCRIPT_PATH
  },
  {
    role: "immutable_v7_failure_analysis",
    path: FORMATIVE_CONVERSATION_V5_V7_FAILURE_ANALYSIS_PATH
  },
  {
    role: "immutable_v7_human_review",
    path: FORMATIVE_CONVERSATION_V5_V7_HUMAN_REVIEW_ADJUDICATION_PATH
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
  ...v7Protocol,
  protocol_version:
    "formative-conversation-host-v5-executable-evaluation-v8",
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
    runtime_candidate_hash: FAILED_V5_RUNTIME_CANDIDATE_HASH,
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
  failed_v5_execution: {
    frozen_commit: FAILED_V5_SOURCE_COMMIT,
    runtime_candidate_hash: FAILED_V5_RUNTIME_CANDIDATE_HASH,
    protocol_hash: FAILED_V5_PROTOCOL_HASH,
    provider_run_id:
      "fcv5v5_provider_20260730170219_4ac51142",
    derived_evaluation_id:
      "fcv5v5_derived_20260730170219_0a1eb734",
    dispatch_checkpoint_path:
      FORMATIVE_CONVERSATION_V5_V5_DISPATCH_PATH,
    dispatch_checkpoint_sha256: failedV5CheckpointSha,
    source_provider_run_path: failedV5SourceProviderRunPath,
    source_provider_run_sha256: failedV5SourceProviderRunSha,
    derived_evaluation_path: failedV5DerivedEvaluationPath,
    derived_evaluation_sha256: failedV5DerivedEvaluationSha,
    failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V5_FAILURE_ANALYSIS_PATH,
    failure_analysis_sha256: failedV5FailureAnalysisSha,
    human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V5_HUMAN_REVIEW_ADVISORY_PATH,
    human_review_advisory_sha256:
      failedV5HumanReviewAdvisorySha,
    execution_status: "completed_failed",
    approval_eligible: false,
    activation_permitted: false,
    rerunnable: false,
    preserved_immutable: true
  },
  failed_v6_execution: {
    frozen_commit: FAILED_V6_SOURCE_COMMIT,
    runtime_candidate_hash: FAILED_V6_RUNTIME_CANDIDATE_HASH,
    protocol_hash: FAILED_V6_PROTOCOL_HASH,
    provider_run_id:
      "fcv5v6_provider_20260731032817_863a9cdd",
    derived_evaluation_id:
      "fcv5v6_derived_20260731032817_0bd6f382",
    dispatch_checkpoint_path:
      FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH,
    dispatch_checkpoint_sha256: failedV6CheckpointSha,
    source_provider_run_path: failedV6SourceProviderRunPath,
    source_provider_run_sha256: failedV6SourceProviderRunSha,
    derived_evaluation_path: failedV6DerivedEvaluationPath,
    derived_evaluation_sha256: failedV6DerivedEvaluationSha,
    human_review_package_path: failedV6HumanReviewPackagePath,
    human_review_package_sha256: failedV6HumanReviewPackageSha,
    failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH,
    failure_analysis_sha256: failedV6FailureAnalysisSha,
    human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH,
    human_review_advisory_sha256:
      failedV6HumanReviewAdvisorySha,
    execution_status: "completed_failed",
    passed: 5,
    failed: 3,
    invalid: 0,
    not_exercised: 0,
    approval_eligible: false,
    activation_permitted: false,
    rerunnable: false,
    preserved_immutable: true
  },
  failed_v7_execution: {
    frozen_commit: FAILED_V7_SOURCE_COMMIT,
    runtime_candidate_hash: FAILED_V7_RUNTIME_CANDIDATE_HASH,
    protocol_hash: FAILED_V7_PROTOCOL_HASH,
    provider_run_id: FAILED_V7_PROVIDER_RUN_ID,
    derived_evaluation_id: FAILED_V7_DERIVED_EVALUATION_ID,
    execution_status: "completed_failed",
    passed: 3,
    failed: 5,
    invalid: 0,
    not_exercised: 0,
    approval_eligible: false,
    activation_permitted: false,
    rerunnable: false,
    preserved_immutable: true,
    immutable_evidence: immutableV7Evidence,
    root_cause_classification: {
      cases_3_and_6:
        "initial_profile_conversation_creation_transaction_expired",
      cases_5_7_and_8:
        "profile_transition_persistence_transaction_expired",
      case_5_oracle:
        "fixture_overconstrained_sound_with_unresolved_sem"
    }
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
    profile_transition_validator_version:
      targetRoleIdentity.profile_transition_validator_version,
    student_output_format_version:
      targetRoleIdentity.student_output_format_version,
    provider_failure_taxonomy_version:
      targetRoleIdentity.provider_failure_taxonomy_version,
    provider_transport_retry_policy_version:
      targetRoleIdentity.provider_transport_retry_policy_version,
    provider_request_tracing_version:
      targetRoleIdentity.provider_request_tracing_version,
    provider_adapter_version:
      targetRoleIdentity.provider_adapter_version,
    persistence_contract_version:
      targetRoleIdentity.persistence_contract_version,
    provider_persistence_boundary_version:
      targetRoleIdentity.provider_persistence_boundary_version,
    evaluation_database_lifecycle_version:
      targetRoleIdentity.evaluation_database_lifecycle_version
  },
  execution_policy: {
    ...(v7Protocol.execution_policy as Record<string, unknown>),
    runner_version:
      FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
  },
  runner_implementation: runnerImplementation,
  isolation: {
    ...(v7Protocol.isolation as Record<string, unknown>),
    provider_run_id_template:
      "fcv5v8_provider_<timestamp>_<random>",
    derived_evaluation_id_template:
      "fcv5v8_derived_<timestamp>_<random>"
  },
  live_authorization_template:
    "I authorize one live execution of formative-conversation-host-v5-executable-v8 for runtime candidate hash <runtime_candidate_hash> and evaluation protocol hash <evaluation_protocol_hash>, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.",
  required_live_environment_flag:
    "FORMATIVE_CONVERSATION_V5_V8_LIVE_EVALUATION_ENABLED=true",
  artifact_contract: {
    ...(v7Protocol.artifact_contract as Record<string, unknown>),
    contract_version:
      "formative-conversation-v5-live-artifact-contract-v3"
  }
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
    "formative-conversation-v5-executable-approval-placeholder-v8",
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
    "formative-conversation-v5-executable-candidate-identity-v8",
  approval_state: "candidate_not_approved",
  activation_permitted: false,
  no_provider_call_during_freeze: true,
  runtime_candidate_hash: runtimeCandidateHash,
  runtime_candidate_hash_unchanged: false,
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
  failed_v5_protocol_hash: FAILED_V5_PROTOCOL_HASH,
  failed_v5_checkpoint_sha256: failedV5CheckpointSha,
  failed_v5_source_provider_run_sha256:
    failedV5SourceProviderRunSha,
  failed_v5_derived_evaluation_sha256:
    failedV5DerivedEvaluationSha,
  failed_v5_failure_analysis_sha256:
    failedV5FailureAnalysisSha,
  failed_v5_human_review_advisory_sha256:
    failedV5HumanReviewAdvisorySha,
  failed_v6_protocol_hash: FAILED_V6_PROTOCOL_HASH,
  failed_v6_checkpoint_sha256: failedV6CheckpointSha,
  failed_v6_source_provider_run_sha256:
    failedV6SourceProviderRunSha,
  failed_v6_derived_evaluation_sha256:
    failedV6DerivedEvaluationSha,
  failed_v6_human_review_package_sha256:
    failedV6HumanReviewPackageSha,
  failed_v6_failure_analysis_sha256:
    failedV6FailureAnalysisSha,
  failed_v6_human_review_advisory_sha256:
    failedV6HumanReviewAdvisorySha,
  failed_v7_runtime_candidate_hash:
    FAILED_V7_RUNTIME_CANDIDATE_HASH,
  failed_v7_protocol_hash: FAILED_V7_PROTOCOL_HASH,
  failed_v7_immutable_evidence: immutableV7Evidence,
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
      runtime_candidate_hash_unchanged: false,
      evaluation_protocol_hash: protocolHash,
      runner_implementation_hash:
        runnerImplementation.aggregate_hash,
      live_environment_contract_hash:
        liveEnvironmentContractHash,
      fixture_manifest_hash: fixtureManifestHash,
      aggregate_fixture_hash: aggregateFixtureHash,
      candidate_manifest_hash: stableHash(candidateManifest),
      compiled_plan_hash: compiledPlan.compiled_plan_hash,
      failed_v4_evidence_sha256: failedV4EvidenceSha,
      failed_v5_failure_analysis_sha256:
        failedV5FailureAnalysisSha,
      failed_v5_human_review_advisory_sha256:
        failedV5HumanReviewAdvisorySha,
      failed_v6_failure_analysis_sha256:
        failedV6FailureAnalysisSha,
      failed_v6_human_review_advisory_sha256:
        failedV6HumanReviewAdvisorySha,
      failed_v7_immutable_evidence: immutableV7Evidence
    },
    null,
    2
  )
);
