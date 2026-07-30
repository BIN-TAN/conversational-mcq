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
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  FORMATIVE_CONVERSATION_V5_V3_DISPATCH_PATH,
  FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT,
  FormativeConversationV5FixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v4/contracts";
import {
  compileFormativeConversationV5ExecutionPlan
} from "../src/lib/operational/formative-conversation-v5-evaluation-v4/compiler";
import {
  formativeConversationV5FixtureSources
} from "../src/lib/operational/formative-conversation-v5-evaluation-v4/fixture-source";

const RUNTIME_CANDIDATE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/runtime-candidate-manifest.json`;
const V3_SOURCE_CONFIGURATION_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v3/source-configuration.json";
const FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v3-failure-analysis.json`;
const HUMAN_REVIEW_ADVISORY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v3-human-review-advisory.json`;
const CASE7_OPENING_REGRESSION_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/case7-opening-output.json`;
const V3_SOURCE_PROVIDER_RUN_PATH =
  `${FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT}/source-provider-run.json`;
const V3_DERIVED_EVALUATION_PATH =
  `${FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT}/derived-evaluation.json`;

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
const sourceCandidateFileSha = fileSha(RUNTIME_CANDIDATE_PATH);
const previousSourceConfiguration = readJson(
  V3_SOURCE_CONFIGURATION_PATH
);
const previousGovernance =
  previousSourceConfiguration.preserved_governance as Record<
    string,
    unknown
  >;
const targetRole =
  sourceCandidate.roles.formative_conversation_agent;
if (!targetRole) {
  throw new Error(
    "formative_conversation_v5_v4_target_role_missing"
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

const failedV3 = {
  protocol_hash:
    "13186b2e5dc54486864b216292afd02774c832340a548c77585886a53c7642b5",
  provider_run_id: "fcv5v3_provider_20260730082804_8bf128c4",
  derived_evaluation_id:
    "fcv5v3_derived_20260730082804_abbbd408",
  dispatch_checkpoint_path:
    FORMATIVE_CONVERSATION_V5_V3_DISPATCH_PATH,
  dispatch_checkpoint_sha256: fileSha(
    FORMATIVE_CONVERSATION_V5_V3_DISPATCH_PATH
  ),
  source_provider_run_sha256: fileSha(
    V3_SOURCE_PROVIDER_RUN_PATH
  ),
  derived_evaluation_sha256: fileSha(
    V3_DERIVED_EVALUATION_PATH
  ),
  execution_status: "completed_failed",
  approval_eligible: false,
  rerunnable: false,
  preserved_immutable: true
};

const sourceConfiguration = {
  artifact_version:
    "formative-conversation-v5-executable-source-configuration-v3",
  captured_from_application_git_commit: currentGitCommit(),
  source_candidate_manifest: {
    path: RUNTIME_CANDIDATE_PATH,
    canonical_hash: sourceCandidateHash,
    file_sha256: sourceCandidateFileSha
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
    OPENAI_MODEL_FORMATIVE_CONVERSATION: targetRole.model_name,
    OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION:
      targetRole.reasoning_effort,
    OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION:
      targetRole.max_output_tokens,
    FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: true,
    FORMATIVE_CONVERSATION_V5_V4_LIVE_EVALUATION_ENABLED: true,
    OPENAI_REQUEST_TIMEOUT_MS: 90_000,
    OPENAI_MAX_RETRIES: 2
  },
  preserved_governance: {
    ...previousGovernance,
    failed_v3_protocol_hash: failedV3.protocol_hash,
    failed_v3_provider_run_id: failedV3.provider_run_id,
    failed_v3_derived_evaluation_id:
      failedV3.derived_evaluation_id,
    failed_v3_dispatch_checkpoint_path:
      failedV3.dispatch_checkpoint_path,
    failed_v3_dispatch_checkpoint_sha256:
      failedV3.dispatch_checkpoint_sha256,
    failed_v3_source_provider_run_path:
      V3_SOURCE_PROVIDER_RUN_PATH,
    failed_v3_source_provider_run_sha256:
      failedV3.source_provider_run_sha256,
    failed_v3_derived_evaluation_path:
      V3_DERIVED_EVALUATION_PATH,
    failed_v3_derived_evaluation_sha256:
      failedV3.derived_evaluation_sha256
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
    protocol_case_compiler:
      "src/lib/operational/formative-conversation-v5-evaluation-v4/compiler.ts",
    protocol_runner:
      "src/lib/operational/formative-conversation-v5-evaluation-v4/service.ts",
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
    "formative-conversation-host-v5-executable-candidate-revision-v4",
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
  failed_v3_protocol_hash: failedV3.protocol_hash
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
  manifest_version: "formative-conversation-v5-fixture-manifest-v3",
  fixture_hash_semantics:
    "stable_hash_of_fixture_with_fixture_hash_omitted",
  fixture_count: 8,
  fixed_case_order: fixtureRecords.map(
    ({ reference }) => reference.case_id
  ),
  fixtures: fixtureRecords.map(({ reference }) => reference),
  aggregate_fixture_hash: aggregateFixtureHash,
  execution_engine:
    "formative-conversation-v5-protocol-runner-v3",
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

const protocol = readJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH);
protocol.protocol_version =
  "formative-conversation-host-v5-executable-evaluation-v4";
protocol.target_identity = {
  runtime_candidate_hash: runtimeCandidateHash,
  ...targetRoleIdentity,
  agent_name: undefined
};
delete (
  protocol.target_identity as Record<string, unknown>
).agent_name;
protocol.failed_v3_execution = failedV3;
protocol.required_live_environment_flag =
  "FORMATIVE_CONVERSATION_V5_V4_LIVE_EVALUATION_ENABLED=true";
protocol.live_authorization_template =
  "I authorize one live execution of formative-conversation-host-v5-executable-v4 for runtime candidate hash <runtime_candidate_hash> and evaluation protocol hash <evaluation_protocol_hash>, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.";
const executionPolicy =
  protocol.execution_policy as Record<string, unknown>;
executionPolicy.runner_version =
  "formative-conversation-v5-protocol-runner-v3";

const runnerImplementationFiles = [
  {
    role: "cli",
    path: "prisma/operational-formative-conversation-v5-v4-evaluate.ts"
  },
  {
    role: "orchestration_service",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v4/service.ts"
  },
  {
    role: "candidate_transport_runner",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v4/candidate-runner.ts"
  },
  {
    role: "package_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v4/package.ts"
  },
  {
    role: "contract_schemas",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v4/contracts.ts"
  },
  {
    role: "case_compiler",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v4/compiler.ts"
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
    role: "correction_evidence",
    path: CASE7_OPENING_REGRESSION_PATH
  }
].map((entry) => ({
  ...entry,
  sha256: fileSha(entry.path)
}));
const runnerImplementation = {
  aggregate_hash: stableHash(runnerImplementationFiles),
  files: runnerImplementationFiles
};
protocol.runner_implementation = runnerImplementation;
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
const intendedArtifacts = protocol.intended_artifacts as string[];
const compiledPlan = compileFormativeConversationV5ExecutionPlan({
  runtime_candidate_hash: runtimeCandidateHash,
  evaluation_protocol_hash: protocolHash,
  runner_implementation_hash:
    runnerImplementation.aggregate_hash,
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
  intended_artifacts: intendedArtifacts
});
writeJson(FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH, compiledPlan);

const approvalPlaceholder = {
  artifact_version:
    "formative-conversation-v5-executable-approval-placeholder-v3",
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
    "formative-conversation-v5-executable-candidate-identity-v3",
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
  failed_v3_protocol_hash: failedV3.protocol_hash,
  failed_v3_checkpoint_sha256:
    failedV3.dispatch_checkpoint_sha256,
  failed_v3_source_provider_run_sha256:
    failedV3.source_provider_run_sha256,
  failed_v3_derived_evaluation_sha256:
    failedV3.derived_evaluation_sha256,
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
      fixture_count: fixtureRecords.length,
      runtime_candidate_hash: runtimeCandidateHash,
      source_candidate_manifest_hash: sourceCandidateHash,
      aggregate_fixture_hash: aggregateFixtureHash,
      fixture_manifest_hash: fixtureManifestHash,
      evaluation_protocol_hash: protocolHash,
      runner_implementation_hash:
        runnerImplementation.aggregate_hash,
      candidate_manifest_hash: stableHash(candidateManifest),
      compiled_plan_hash: compiledPlan.compiled_plan_hash
    },
    null,
    2
  )
);
