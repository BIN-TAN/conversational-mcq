import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
import { FORMATIVE_CONVERSATION_CANDIDATE_ACCEPTANCE_VERSION } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation";
import {
  FORMATIVE_CONVERSATION_V13_ADVERSARIAL_MATRIX_HASH,
  FORMATIVE_CONVERSATION_V13_ADVERSARIAL_MATRIX_VERSION
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/adversarial-matrix";
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
  EVALUATION_DATABASE_CONNECTION_OWNER_VERSION,
  EVALUATION_DATABASE_READ_RECOVERY_VERSION
} from "../src/lib/operational/evaluation-database-connection-owner";
import {
  FORMATIVE_CONVERSATION_V13_CONTROL_SCHEMA_VERSION,
  FORMATIVE_CONVERSATION_V13_PREVENTIVE_SCANNER_VERSION,
  FORMATIVE_CONVERSATION_V13_RELEASE_POLICY_VERSION,
  FORMATIVE_CONVERSATION_V13_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  FORMATIVE_CONVERSATION_V13_SCAN_ATTESTATION_VERSION,
  FORMATIVE_CONVERSATION_V13_SECURITY_WRAPPER_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V13_SECURITY_WRAPPER_VERSION,
  formativeConversationV13SecurityWrapperFingerprint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/security-release";
import {
  FORMATIVE_CONVERSATION_V13_RUN_PROVENANCE_VERSION
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/provenance";
import {
  verifyFormativeConversationV13CommittedSource
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/provenance";
import { FORMATIVE_CONVERSATION_PROFILE_FIELD_SEMANTICS_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-field-semantics";
import { FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION } from "../src/lib/services/student-assessment/formative-conversation/persistence-observability";
import {
  FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION,
  FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_ACCOUNTING_VERSION,
  FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_HASH,
  FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_VERSION,
  FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/semantic-regeneration";
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
  FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH,
  FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH,
  FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH,
  FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH,
  FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH,
  FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH,
  FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V11_LAUNCHER_FAILURE_ANALYSIS_PATH,
  FORMATIVE_CONVERSATION_V5_V13_REMOTE_CANARY_EVIDENCE_PATH,
  FORMATIVE_CONVERSATION_V5_CASE7_EXACT_REPLAY_PATH,
  FORMATIVE_CONVERSATION_V5_CASE8_EXACT_REPLAY_PATH,
  FormativeConversationV5FixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/contracts";
import {
  compileFormativeConversationV5ExecutionPlan
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/compiler";
import {
  formativeConversationV5FixtureSources
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/fixture-source";
import {
  FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
  FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
  FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V5_REQUIRED_INJECTED_ENVIRONMENT,
  FORMATIVE_CONVERSATION_V5_SECRET_ENVIRONMENT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/live-environment";
import {
  FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
  FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_VERSION
} from "../src/lib/operational/formative-conversation-v5-evaluation-v9/remote-database-canary";

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
const FAILED_V8_RUNTIME_CANDIDATE_HASH =
  "132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80";
const FAILED_V8_PROTOCOL_HASH =
  "6359d96e27ed727e0eb1797f621bb08b4e6877f8065f5d6d7be6492a1d8eac15";
const FAILED_V8_SOURCE_COMMIT =
  "afd7422b9e88c324b0150475ccd2954ebad86f8e";
const FAILED_V8_PROVIDER_RUN_ID =
  "fcv5v8_provider_20260801134821_4d583c17";
const FAILED_V8_DERIVED_EVALUATION_ID =
  "fcv5v8_derived_20260801134821_7de783d0";
const FAILED_V9_RUNTIME_CANDIDATE_HASH =
  "5c0347287fa10cb67b9e9677dff0fc679f99af78ea3b08fe086cf693af146198";
const FAILED_V9_PROTOCOL_HASH =
  "fcc7f5c3b7ffcbd10731fd27b626e431f1a012083702ea40ffbe388a1474aa13";
const FAILED_V9_SOURCE_COMMIT =
  "9d9cf2e404bdae7a9a68c652ea776b81f385a5c5";
const FAILED_V9_PROVIDER_RUN_ID =
  "fcv5v9_provider_20260802030051_18dd2d4b";
const FAILED_V9_DERIVED_EVALUATION_ID =
  "fcv5v9_derived_20260802030051_1118d823";
const FROZEN_V11_RUNTIME_CANDIDATE_HASH =
  "2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c";
const FROZEN_V12_RUNTIME_CANDIDATE_HASH =
  "2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c";
const FROZEN_V12_PROTOCOL_HASH =
  "72e0c28ea5b1735c28baa83f97843280795bad4c818bcf79b2590dae81c956cd";
const BLOCKED_V11_PROTOCOL_HASH =
  "b4053264bcc2caf72a7e77ff34ae1f90be17fdebb0a0857f09c98a15c293e6b5";
const BLOCKED_V11_SOURCE_COMMIT =
  "c14990b659b13076af053563284de3e4172dd43b";
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
const V7_PROTOCOL_PATH = `${V7_ROOT}/executable-evaluation-protocol.json`;
const V8_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v8";
const V8_RUNTIME_CANDIDATE_PATH = `${V8_ROOT}/runtime-candidate-manifest.json`;
const V8_PROTOCOL_PATH = `${V8_ROOT}/executable-evaluation-protocol.json`;
const V8_RUN_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v8/runs/fcv5v8_provider_20260801134821_4d583c17";
const V8_ARTIFACT_HASH_MANIFEST_PATH =
  `${V8_RUN_ROOT}/artifact-hash-manifest.json`;
const V9_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v9";
const V9_RUNTIME_CANDIDATE_PATH = `${V9_ROOT}/runtime-candidate-manifest.json`;
const V9_SOURCE_CONFIGURATION_PATH = `${V9_ROOT}/source-configuration.json`;
const V9_PROTOCOL_PATH = `${V9_ROOT}/executable-evaluation-protocol.json`;
const V10_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v10";
const V10_RUNTIME_CANDIDATE_PATH =
  `${V10_ROOT}/runtime-candidate-manifest.json`;
const V11_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v11";
const V11_RUNTIME_CANDIDATE_PATH =
  `${V11_ROOT}/runtime-candidate-manifest.json`;
const V11_PROTOCOL_PATH =
  `${V11_ROOT}/executable-evaluation-protocol.json`;
const V11_DISPATCH_PATH =
  `.data/operational-formative-conversation-v5-evaluation-v11/runs/dispatch/${BLOCKED_V11_PROTOCOL_HASH}.json`;
const V12_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v12";
const V12_RUNTIME_CANDIDATE_PATH =
  `${V12_ROOT}/runtime-candidate-manifest.json`;
const V12_PROTOCOL_PATH = `${V12_ROOT}/executable-evaluation-protocol.json`;
const V12_RUN_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v12/runs/fcv5v12_provider_20260803134449_100f045f";
const V12_OPENING_FAILURE_EVIDENCE = [
  {
    case_id: "fcv5_02_first_principles_adaptation",
    path: `${V12_RUN_ROOT}/cases/fcv5_02_first_principles_adaptation-transcript.json`,
    sha256: "3fb9752dcf041ac55cf627874ddc4f786467b4c7da76843f171e5650f457963d"
  },
  {
    case_id: "fcv5_03_direct_answer_handling",
    path: `${V12_RUN_ROOT}/cases/fcv5_03_direct_answer_handling-transcript.json`,
    sha256: "8999469f3d2a8235154dd089343cb2b9f8d5b99d257268407d28f5d3505f7047"
  }
] as const;
const V9_RUN_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v9/runs/fcv5v9_provider_20260802030051_18dd2d4b";
const V9_SOURCE_PROVIDER_RUN_PATH = `${V9_RUN_ROOT}/source-provider-run.json`;
const V9_DERIVED_EVALUATION_PATH = `${V9_RUN_ROOT}/derived-evaluation.json`;
const V9_AGGREGATE_EVALUATION_PATH = `${V9_RUN_ROOT}/aggregate-evaluation.json`;
const V9_HUMAN_REVIEW_PACKAGE_PATH = `${V9_RUN_ROOT}/human-review-package.json`;
const V9_PROVENANCE_MANIFEST_PATH = `${V9_RUN_ROOT}/provenance-manifest.json`;
const V9_ARTIFACT_HASH_MANIFEST_PATH = `${V9_RUN_ROOT}/artifact-hash-manifest.json`;
const V9_RESEARCH_EXPORT_PATH = `${V9_RUN_ROOT}/research-export.zip`;
const V9_CASE4_TRANSCRIPT_PATH =
  `${V9_RUN_ROOT}/cases/fcv5_04_related_concept_discussion-transcript.json`;
const V9_CASE4_VALIDATION_PATH =
  `${V9_RUN_ROOT}/cases/fcv5_04_related_concept_discussion-validation.json`;
const V9_CASE6_TRANSCRIPT_PATH =
  `${V9_RUN_ROOT}/cases/fcv5_06_largely_improved_temporal-transcript.json`;
const V9_CASE6_VALIDATION_PATH =
  `${V9_RUN_ROOT}/cases/fcv5_06_largely_improved_temporal-validation.json`;
const V9_CASE7_TRANSCRIPT_PATH =
  `${V9_RUN_ROOT}/cases/fcv5_07_persistent_barrier_teacher_assistance-transcript.json`;
const V9_CASE7_VALIDATION_PATH =
  `${V9_RUN_ROOT}/cases/fcv5_07_persistent_barrier_teacher_assistance-validation.json`;
const V9_REMOTE_CANARY_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v9/remote-database-canaries/fcv5v9_db_canary_20260801174128495_b588b3f0";
const V9_REMOTE_CANARY_REPORT_PATH = `${V9_REMOTE_CANARY_ROOT}/canary-report.json`;
const V9_REMOTE_CANARY_EXPORT_PATH = `${V9_REMOTE_CANARY_ROOT}/research-export.zip`;
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

const initializationRequested = process.argv.includes("--initialize");

function writeJson(relativePath: string, value: unknown) {
  const outputPath = absolute(relativePath);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (initializationRequested) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf8");
    return;
  }
  if (!existsSync(outputPath)) {
    throw new Error(
      `formative_conversation_v13_tracked_artifact_missing:${relativePath}`
    );
  }
  if (readFileSync(outputPath, "utf8") !== serialized) {
    throw new Error(
      `formative_conversation_v13_tracked_artifact_drift:${relativePath}`
    );
  }
}

function copyOrVerify(sourcePath: string, targetPath: string) {
  if (initializationRequested) {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    return;
  }
  if (
    !existsSync(targetPath) ||
    !readFileSync(sourcePath).equals(readFileSync(targetPath))
  ) {
    throw new Error(
      `formative_conversation_v13_preserved_evidence_drift:${path.relative(process.cwd(), targetPath)}`
    );
  }
}

function fileSha(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

const failedV5Candidate =
  readCandidateOperationalModelConfig(V5_RUNTIME_CANDIDATE_PATH);
const failedV6Candidate =
  readCandidateOperationalModelConfig(V6_RUNTIME_CANDIDATE_PATH);
const failedV7Candidate =
  readCandidateOperationalModelConfig(V7_RUNTIME_CANDIDATE_PATH);
const failedV8Candidate =
  readCandidateOperationalModelConfig(V8_RUNTIME_CANDIDATE_PATH);
const failedV9Candidate =
  readCandidateOperationalModelConfig(V9_RUNTIME_CANDIDATE_PATH);
const frozenV10Candidate =
  readCandidateOperationalModelConfig(V10_RUNTIME_CANDIDATE_PATH);
const frozenV11Candidate =
  readCandidateOperationalModelConfig(V11_RUNTIME_CANDIDATE_PATH);
const frozenV12Candidate =
  readCandidateOperationalModelConfig(V12_RUNTIME_CANDIDATE_PATH);

const runtimeCandidateDraft = structuredClone(frozenV12Candidate);
const runtimeFingerprint = runtimeCandidateDraft.configuration_fingerprint;
if (!runtimeFingerprint) {
  throw new Error("formative_conversation_v5_v13_runtime_fingerprint_missing");
}
const formativeRoleMetadata =
  runtimeFingerprint.role_version_metadata.formative_conversation_agent;
if (!formativeRoleMetadata) {
  throw new Error("formative_conversation_v5_v13_role_metadata_missing");
}
if (
  formativeRoleMetadata.prompt_version !== FORMATIVE_CONVERSATION_PROMPT_VERSION ||
  formativeRoleMetadata.prompt_hash !== FORMATIVE_CONVERSATION_PROMPT_HASH ||
  formativeRoleMetadata.profile_transition_version !==
    FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION ||
  formativeRoleMetadata.profile_transition_validator_version !==
    FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION
) {
  throw new Error("formative_conversation_v5_v13_v11_runtime_fingerprint_drift");
}
formativeRoleMetadata.validator_version = FORMATIVE_CONVERSATION_OPENING_VERSION;
runtimeFingerprint.deterministic_guard_versions = {
  ...runtimeFingerprint.deterministic_guard_versions,
  formative_conversation_opening_validation:
    FORMATIVE_CONVERSATION_OPENING_VERSION,
  formative_conversation_candidate_acceptance:
    FORMATIVE_CONVERSATION_CANDIDATE_ACCEPTANCE_VERSION,
  formative_conversation_semantic_regeneration:
    FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION,
  formative_conversation_semantic_regeneration_instruction:
    FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_HASH,
  formative_conversation_semantic_regeneration_accounting:
    FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_ACCOUNTING_VERSION,
  formative_conversation_safe_invalid_output_evidence:
    FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION
};
writeJson(RUNTIME_CANDIDATE_PATH, runtimeCandidateDraft);

const sourceCandidate =
  readCandidateOperationalModelConfig(RUNTIME_CANDIDATE_PATH);

const preservedV9RelativePaths = [
  "v3-failure-analysis.json",
  "v3-human-review-advisory.json",
  "v5-failure-analysis.json",
  "v5-human-review-advisory.json",
  "v6-failure-analysis.json",
  "v6-human-review-advisory.json",
  "v7-failure-analysis.json",
  "v7-human-review-adjudication.json",
  "regressions/case7-opening-output.json",
  "regressions/case7-exact-v5-output-replay.json",
  "regressions/case8-exact-v5-output-replay.json",
  "regressions/immutable-v7-aggregate-evaluation.json",
  "regressions/immutable-v7-artifact-hash-manifest.json",
  "regressions/immutable-v7-case5-transcript.json",
  "regressions/immutable-v7-case7-transcript.json",
  "regressions/immutable-v7-case8-transcript.json"
] as const;
for (const relativePath of preservedV9RelativePaths) {
  const sourcePath = absolute(`${V9_ROOT}/${relativePath}`);
  const targetPath = absolute(
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/${relativePath}`
  );
  copyOrVerify(sourcePath, targetPath);
}
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
const failedV8RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(failedV8Candidate);
const failedV9RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(failedV9Candidate);
const frozenV10RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(frozenV10Candidate);
const frozenV11RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(frozenV11Candidate);
const frozenV12RuntimeCandidateHash =
  candidateRuntimeConfigurationHash(frozenV12Candidate);
const candidateActiveConfigurationHash =
  candidateActiveOperationalConfigHash(sourceCandidate);
if (
  failedV5RuntimeCandidateHash !== FAILED_V5_RUNTIME_CANDIDATE_HASH ||
  failedV6RuntimeCandidateHash !== FAILED_V6_RUNTIME_CANDIDATE_HASH ||
  failedV7RuntimeCandidateHash !== FAILED_V7_RUNTIME_CANDIDATE_HASH ||
  failedV8RuntimeCandidateHash !== FAILED_V8_RUNTIME_CANDIDATE_HASH ||
  failedV9RuntimeCandidateHash !== FAILED_V9_RUNTIME_CANDIDATE_HASH ||
  frozenV10RuntimeCandidateHash !== FROZEN_V11_RUNTIME_CANDIDATE_HASH ||
  frozenV11RuntimeCandidateHash !== FROZEN_V11_RUNTIME_CANDIDATE_HASH ||
  frozenV12RuntimeCandidateHash !== FROZEN_V12_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V5_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V6_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V7_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V8_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FAILED_V9_RUNTIME_CANDIDATE_HASH ||
  runtimeCandidateHash === FROZEN_V12_RUNTIME_CANDIDATE_HASH
) {
  throw new Error(
    "formative_conversation_v5_v13_runtime_candidate_identity_invalid"
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
    JSON.stringify(failedV7Candidate.runtime_policy) ||
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(failedV8Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(failedV8Candidate.runtime_policy) ||
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(failedV9Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(failedV9Candidate.runtime_policy) ||
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(frozenV10Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(frozenV10Candidate.runtime_policy) ||
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(frozenV11Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(frozenV11Candidate.runtime_policy) ||
  JSON.stringify(sourceCandidate.roles) !==
    JSON.stringify(frozenV12Candidate.roles) ||
  JSON.stringify(sourceCandidate.runtime_policy) !==
    JSON.stringify(frozenV12Candidate.runtime_policy)
) {
  throw new Error(
    "formative_conversation_v5_v13_model_or_runtime_policy_changed"
  );
}

const v9SourceConfiguration = readJson(
  V9_SOURCE_CONFIGURATION_PATH
);
const previousGovernance =
  v9SourceConfiguration.preserved_governance as Record<
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
const v8Protocol = readJson(V8_PROTOCOL_PATH);
if (stableHash(v8Protocol) !== FAILED_V8_PROTOCOL_HASH) {
  throw new Error("formative_conversation_v5_v8_protocol_changed");
}
const v9Protocol = readJson(V9_PROTOCOL_PATH);
if (stableHash(v9Protocol) !== FAILED_V9_PROTOCOL_HASH) {
  throw new Error("formative_conversation_v5_v9_protocol_changed");
}
const blockedV11Protocol = readJson(V11_PROTOCOL_PATH);
if (
  stableHash(blockedV11Protocol) !== BLOCKED_V11_PROTOCOL_HASH ||
  existsSync(absolute(V11_DISPATCH_PATH))
) {
  throw new Error(
    "formative_conversation_v5_v11_predispatch_evidence_changed"
  );
}
const frozenV12Protocol = readJson(V12_PROTOCOL_PATH);
if (stableHash(frozenV12Protocol) !== FROZEN_V12_PROTOCOL_HASH) {
  throw new Error("formative_conversation_v5_v12_protocol_changed");
}
for (const evidence of V12_OPENING_FAILURE_EVIDENCE) {
  if (fileSha(evidence.path) !== evidence.sha256) {
    throw new Error(
      `formative_conversation_v5_v12_opening_evidence_changed:${evidence.case_id}`
    );
  }
}
const immutableV9Evidence = [
  {
    role: "source_provider_run",
    path: V9_SOURCE_PROVIDER_RUN_PATH,
    sha256: "a481462bcef544249b95d591738175c736245c054f916824a0315f44ac7161da"
  },
  {
    role: "derived_evaluation",
    path: V9_DERIVED_EVALUATION_PATH,
    sha256: "cbe89af55780b56fba8a3e2c1ec959e67b64cf6f1b3918f6393544f7c86c0af6"
  },
  {
    role: "aggregate_evaluation",
    path: V9_AGGREGATE_EVALUATION_PATH,
    sha256: "8a9252f849bbfe22087ecc66d1a3ebb5d3f6197fbf7f2cfea43f46179a282760"
  },
  {
    role: "human_review_package",
    path: V9_HUMAN_REVIEW_PACKAGE_PATH,
    sha256: "6a28faee3b25d09e4b6a8dd353a1e2d3c47ca5c2ba848db7dd6b68ab663953b0"
  },
  {
    role: "provenance_manifest",
    path: V9_PROVENANCE_MANIFEST_PATH,
    sha256: "44c9edb0054c020a2c0c3583c21f7e4552990dea0d576b63ebaaa8476221ea02"
  },
  {
    role: "artifact_hash_manifest",
    path: V9_ARTIFACT_HASH_MANIFEST_PATH,
    sha256: "2736e6e1fdf196683e95b2e463d20eb92a83516551f19edd9368440350e2c03b"
  },
  {
    role: "research_export",
    path: V9_RESEARCH_EXPORT_PATH,
    sha256: "c9fced21507ddbd70148e772a7d86ef6152936d87e7a7645cedb322d44d04e06"
  },
  {
    role: "case4_transcript",
    path: V9_CASE4_TRANSCRIPT_PATH,
    sha256: "facba4f919a7494c1ba1de152b790363c7b9eb930f5659feb9af0737b4e602f5"
  },
  {
    role: "case4_validation",
    path: V9_CASE4_VALIDATION_PATH,
    sha256: "f6226245e9ab62839b3851f64b50b35d7628d928a6220b2e37afb979c2075c03"
  },
  {
    role: "case6_transcript",
    path: V9_CASE6_TRANSCRIPT_PATH,
    sha256: "815a3b97e8e9b146ca7ad17bc23ddb8d413ea59914c979d8f499ddadeb4ac142"
  },
  {
    role: "case6_validation",
    path: V9_CASE6_VALIDATION_PATH,
    sha256: "1b16f59637024bb7b17bec552b5c5608d9f13df7d908fec2cb8d88448340e731"
  },
  {
    role: "case7_transcript",
    path: V9_CASE7_TRANSCRIPT_PATH,
    sha256: "7621645e8f9bc03386ed585b3f392732c9e58e8ae272300a89918c3361118761"
  },
  {
    role: "case7_validation",
    path: V9_CASE7_VALIDATION_PATH,
    sha256: "6c8541961bb4c9042d6992f5eba04f7542035d552e198734831b1d4e097fea8a"
  }
] as const;
for (const evidence of immutableV9Evidence) {
  if (fileSha(evidence.path) !== evidence.sha256) {
    throw new Error(`formative_conversation_v5_v9_evidence_changed:${evidence.role}`);
  }
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
const securityWrapperFingerprint =
  formativeConversationV13SecurityWrapperFingerprint(
    Object.fromEntries(
      FORMATIVE_CONVERSATION_V13_SECURITY_WRAPPER_SOURCE_PATHS.map(
        (sourcePath) => [sourcePath, fileSha(sourcePath)]
      )
    )
  );
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
  candidate_acceptance_version:
    FORMATIVE_CONVERSATION_CANDIDATE_ACCEPTANCE_VERSION,
  adversarial_matrix_version:
    FORMATIVE_CONVERSATION_V13_ADVERSARIAL_MATRIX_VERSION,
  adversarial_matrix_hash:
    FORMATIVE_CONVERSATION_V13_ADVERSARIAL_MATRIX_HASH,
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
    EVALUATION_DATABASE_LIFECYCLE_VERSION,
  profile_field_semantics_version:
    FORMATIVE_CONVERSATION_PROFILE_FIELD_SEMANTICS_VERSION,
  persistence_observability_version:
    FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION,
  evaluation_database_connection_owner_version:
    EVALUATION_DATABASE_CONNECTION_OWNER_VERSION,
  evaluation_database_read_recovery_version:
    EVALUATION_DATABASE_READ_RECOVERY_VERSION,
  exact_secret_artifact_scanner_version:
    FORMATIVE_CONVERSATION_V13_PREVENTIVE_SCANNER_VERSION,
  artifact_control_channel_version:
    FORMATIVE_CONVERSATION_V13_CONTROL_SCHEMA_VERSION,
  artifact_release_policy_version:
    FORMATIVE_CONVERSATION_V13_RELEASE_POLICY_VERSION,
  scan_attestation_version:
    FORMATIVE_CONVERSATION_V13_SCAN_ATTESTATION_VERSION,
  scan_attestation_schema_fingerprint:
    FORMATIVE_CONVERSATION_V13_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  security_wrapper_version:
    FORMATIVE_CONVERSATION_V13_SECURITY_WRAPPER_VERSION,
  security_wrapper_fingerprint: securityWrapperFingerprint,
  run_scoped_provenance_version:
    FORMATIVE_CONVERSATION_V13_RUN_PROVENANCE_VERSION,
  semantic_regeneration_policy_version:
    FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION,
  semantic_regeneration_instruction_version:
    FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_VERSION,
  semantic_regeneration_instruction_hash:
    FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_HASH,
  semantic_regeneration_accounting_version:
    FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_ACCOUNTING_VERSION,
  safe_invalid_output_evidence_version:
    FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION,
  remote_database_canary_version:
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_VERSION,
  remote_database_canary_contract_hash:
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH
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

const v8ArtifactHashManifest = readJson(
  V8_ARTIFACT_HASH_MANIFEST_PATH
) as {
  artifact_version: string;
  source_provider_run_id: string;
  artifacts: Array<{ path: string; sha256: string }>;
};
if (
  v8ArtifactHashManifest.artifact_version !==
    "formative-conversation-v5-artifact-hash-manifest-v1" ||
  v8ArtifactHashManifest.source_provider_run_id !==
    FAILED_V8_PROVIDER_RUN_ID ||
  v8ArtifactHashManifest.artifacts.length !== 23
) {
  throw new Error("formative_conversation_v5_v8_artifact_manifest_invalid");
}
for (const artifact of v8ArtifactHashManifest.artifacts) {
  if (fileSha(`${V8_RUN_ROOT}/${artifact.path}`) !== artifact.sha256) {
    throw new Error(
      "formative_conversation_v5_v8_immutable_evidence_changed"
    );
  }
}
const failedV8Aggregate = readJson(`${V8_RUN_ROOT}/aggregate-evaluation.json`);
if (
  failedV8Aggregate.provider_run_id !== FAILED_V8_PROVIDER_RUN_ID ||
  failedV8Aggregate.derived_evaluation_id !==
    FAILED_V8_DERIVED_EVALUATION_ID ||
  failedV8Aggregate.status !== "completed_failed" ||
  failedV8Aggregate.case_count !== 8 ||
  failedV8Aggregate.actual_logical_call_count !== 18
) {
  throw new Error("formative_conversation_v5_v8_failure_identity_invalid");
}
const immutableV8Evidence = {
  artifact_version:
    "formative-conversation-v5-v8-immutable-evaluation-evidence-v1",
  source_commit_sha: FAILED_V8_SOURCE_COMMIT,
  runtime_candidate_hash: FAILED_V8_RUNTIME_CANDIDATE_HASH,
  protocol_hash: FAILED_V8_PROTOCOL_HASH,
  provider_run_id: FAILED_V8_PROVIDER_RUN_ID,
  derived_evaluation_id: FAILED_V8_DERIVED_EVALUATION_ID,
  status: "completed_failed",
  passed: 6,
  failed: 2,
  invalid: 0,
  not_exercised: 0,
  actual_logical_calls: 18,
  expected_logical_calls: 21,
  approval_eligible: false,
  activation_permitted: false,
  rerunnable: false,
  artifact_hash_manifest_sha256: fileSha(V8_ARTIFACT_HASH_MANIFEST_PATH),
  artifacts: v8ArtifactHashManifest.artifacts,
  preserved_immutable: true
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH,
  immutableV8Evidence
);

const v8FailureAnalysis = {
  artifact_version: "formative-conversation-v5-v8-failure-analysis-v1",
  source_runtime_candidate_hash: FAILED_V8_RUNTIME_CANDIDATE_HASH,
  source_protocol_hash: FAILED_V8_PROTOCOL_HASH,
  source_provider_run_id: FAILED_V8_PROVIDER_RUN_ID,
  source_derived_evaluation_id: FAILED_V8_DERIVED_EVALUATION_ID,
  execution_status: "completed_failed",
  findings: [
    {
      cases: [
        "fcv5_05_sound_profile_transition",
        "fcv5_07_persistent_barrier_teacher_assistance"
      ],
      classification:
        "database_connection_lifecycle_interrupt_after_valid_provider_output",
      evidence:
        "Provider bodies completed and validated before later database operations failed; subsequent cases recovered.",
      correction:
        "Evaluation-owned connection lifecycle, bounded stale-connection recovery, idempotent write reconciliation, and typed persistence diagnostics."
    },
    {
      cases: ["fcv5_08_mixed_resolved_evidence"],
      classification: "misconception_field_semantic_contract_defect",
      evidence:
        "The persisted recommendation used current misconception evidence for resolved evidence and a remaining question.",
      correction:
        "Shared field-semantics validation rejects semantically misplaced misconception evidence before persistence."
    },
    {
      cases: ["all"],
      classification: "exact_value_scan_lifecycle_incomplete",
      evidence:
        "Generic scanning completed, but exact secret values were cleared before an artifact-wide exact-value proof.",
      correction:
        "Exact values remain process-local through regular-file, ZIP-entry, and buffered-output scanning, then are cleared."
    }
  ],
  candidate_output_defects: [
    "case_8_misconception_field_semantics"
  ],
  runtime_environment_defects: [
    "cases_5_and_7_database_connection_lifecycle",
    "artifact_exact_secret_scan_ordering"
  ],
  teaching_prompt_changed: true,
  teaching_prompt_change_scope:
    "field-disposition and misconception-field semantics only",
  provider_calls: 0,
  approval_eligible: false,
  activation_permitted: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH,
  v8FailureAnalysis
);

const v8HumanReviewAdvisory = {
  artifact_version:
    "formative-conversation-v5-v8-human-review-advisory-v1",
  source_provider_run_id: FAILED_V8_PROVIDER_RUN_ID,
  review_scope: "all_available_student_visible_tutor_outputs",
  status: "diagnostic_advisory_not_approval",
  findings: {
    conceptual_accuracy: "no_blocking_error_identified_in_available_outputs",
    adaptation: "present_in_completed_exchanges",
    direct_answer_compliance: "acceptable",
    related_concept_handling: "acceptable",
    unjustified_mastery_claims: "not_identified",
    excessive_praise: "not_identified",
    directive_tone: "minor_review_only",
    report_or_activity_language: "not_blocking",
    internal_terminology: "not_identified",
    markdown_support: "within_supported_contract",
    privacy_and_answer_visibility: "passed"
  },
  runtime_failures_prevent_official_approval: true,
  approval_eligible: false,
  activation_permitted: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH,
  v8HumanReviewAdvisory
);

const v9Case4SafeFailureEvidence = {
  artifact_version:
    "formative-conversation-v9-case4-safe-failure-evidence-v1",
  source_commit_sha: FAILED_V9_SOURCE_COMMIT,
  runtime_candidate_hash: FAILED_V9_RUNTIME_CANDIDATE_HASH,
  protocol_hash: FAILED_V9_PROTOCOL_HASH,
  provider_run_id: FAILED_V9_PROVIDER_RUN_ID,
  case_id: "fcv5_04_related_concept_discussion",
  source_artifacts: immutableV9Evidence.filter((entry) =>
    entry.role.startsWith("case4_")
  ),
  agent_call_public_id: "cmsb7s8gm002xne3eu9k5gffc",
  provider_response_id: "resp_030a341623011298016a6eb326397481999cd8d0a76d7810af",
  provider_body_completed: true,
  input_tokens: 6806,
  output_tokens: 367,
  latency_ms: 5849,
  call_status: "invalid_output",
  typed_failure: "formative_conversation_opening_validation",
  exact_generated_opening_available: false,
  validator_issue_paths_available: false,
  student_visible_output_persisted: false,
  classification:
    "indeterminate_candidate_or_validator_failure_due_to_v9_safe_output_evidence_omission",
  correction_scope:
    "preserve_opening_validator_and_add_prospective_safe_invalid_output_evidence",
  preserved_immutable: true,
  rerunnable: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH,
  v9Case4SafeFailureEvidence
);

const v9Case6SafeFailureEvidence = {
  artifact_version:
    "formative-conversation-v9-case6-safe-failure-evidence-v1",
  source_commit_sha: FAILED_V9_SOURCE_COMMIT,
  runtime_candidate_hash: FAILED_V9_RUNTIME_CANDIDATE_HASH,
  protocol_hash: FAILED_V9_PROTOCOL_HASH,
  provider_run_id: FAILED_V9_PROVIDER_RUN_ID,
  case_id: "fcv5_06_largely_improved_temporal",
  source_artifacts: immutableV9Evidence.filter((entry) =>
    entry.role.startsWith("case6_")
  ),
  agent_call_public_id: "cmsb7tzcv005fne3eibpcocgl",
  provider_response_id: "resp_032296815bf4b64c016a6eb377b994819ab0508bb9fc189326",
  provider_body_completed: true,
  input_tokens: 7840,
  output_tokens: 2394,
  latency_ms: 33061,
  call_status: "failed",
  typed_failure: "formative_conversation_agent_execution",
  provider_failure_classification: "response_schema_invalid",
  semantic_regeneration_eligible: true,
  semantic_regeneration_attempted: false,
  exact_invalid_candidate_available: false,
  exact_schema_issue_paths_available: false,
  transition_persisted: false,
  classification:
    "semantic_regeneration_policy_and_runner_evidence_preservation_defect",
  preserved_immutable: true,
  rerunnable: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH,
  v9Case6SafeFailureEvidence
);

const v9Case7TransitionAudit = {
  artifact_version:
    "formative-conversation-v9-case7-successive-transition-audit-v1",
  source_commit_sha: FAILED_V9_SOURCE_COMMIT,
  runtime_candidate_hash: FAILED_V9_RUNTIME_CANDIDATE_HASH,
  protocol_hash: FAILED_V9_PROTOCOL_HASH,
  provider_run_id: FAILED_V9_PROVIDER_RUN_ID,
  case_id: "fcv5_07_persistent_barrier_teacher_assistance",
  source_artifacts: immutableV9Evidence.filter((entry) =>
    entry.role.startsWith("case7_") || entry.role === "research_export"
  ),
  transitions: [
    {
      transition_public_id: "cmsb7vx67006une3ew60gknti",
      outcome: "teacher_assistance_recommended",
      source_agent_call_public_id: "cmsb7v74f006kne3exjlcmhks",
      source_turn_sequence_index: 707,
      supporting_student_turns: [704, 706],
      updated_evidence:
        "persistent misconception after two contrasting explanations"
    },
    {
      transition_public_id: "cmsb7wjsh007cne3edsb873bt",
      outcome: "teacher_assistance_recommended",
      source_agent_call_public_id: "cmsb7vxan0072ne3efyp4h8lg",
      source_turn_sequence_index: 709,
      supporting_student_turns: [704, 706, 708],
      updated_evidence:
        "new practical application evidence that the student would advise a teacher using the misconception"
    }
  ],
  canonical_fields_retained_with_evidence: [
    "ability_profile",
    "integrated_diagnostic_profile",
    "evidence_sufficiency",
    "confidence_alignment",
    "misconception_indicators"
  ],
  canonical_fields_updated_by_second_transition: [
    "integrated_profile_rationale",
    "item_level_evidence",
    "reasoning_quality_summary",
    "engagement_summary",
    "recommended_next_evidence"
  ],
  classification: "two_substantively_different_evidence_supported_versions",
  no_op_suppression_required: false,
  preserved_immutable: true,
  rerunnable: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH,
  v9Case7TransitionAudit
);

const v9FailureAnalysis = {
  artifact_version: "formative-conversation-v9-failure-analysis-v1",
  source_commit_sha: FAILED_V9_SOURCE_COMMIT,
  runtime_candidate_hash: FAILED_V9_RUNTIME_CANDIDATE_HASH,
  protocol_hash: FAILED_V9_PROTOCOL_HASH,
  provider_run_id: FAILED_V9_PROVIDER_RUN_ID,
  derived_evaluation_id: FAILED_V9_DERIVED_EVALUATION_ID,
  execution_status: "completed_failed",
  result_counts: { passed: 6, failed: 2, invalid: 0, not_exercised: 0 },
  usage: {
    logical_calls: 20,
    provider_attempts: 20,
    transport_retries: 0,
    input_tokens: 148899,
    output_tokens: 18636,
    wall_clock_ms: 298901
  },
  case4: v9Case4SafeFailureEvidence,
  case6: v9Case6SafeFailureEvidence,
  case7: v9Case7TransitionAudit,
  defect_classification: {
    candidate_output_defect: "not_proven_for_case4_or_case6",
    opening_validator_defect: "not_proven_because_exact_case4_output_is_absent",
    output_schema_contract_defect: "not_proven",
    structured_output_generation_defect:
      "case6_generated_a_schema_invalid_result_but_exact_invalid_object_is_absent",
    semantic_regeneration_policy_defect:
      "case6_was_eligible_but_no_bounded_regeneration_was_executed",
    profile_transition_defect: "not_identified",
    evaluation_protocol_defect:
      "budgets_and_call_graph_did_not_account_for_semantic_regeneration",
    runner_accounting_defect:
      "safe_invalid_output_and_validation_paths_were_not_preserved",
    human_review_issue:
      "case4_related_concept_and_case6_final_output_were_not_exercised_or_visible"
  },
  approval_eligible: false,
  activation_permitted: false,
  rerunnable: false,
  preserved_immutable: true
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH,
  v9FailureAnalysis
);

const v9HumanReviewAdvisory = {
  artifact_version:
    "formative-conversation-v9-diagnostic-human-review-advisory-v1",
  source_commit_sha: FAILED_V9_SOURCE_COMMIT,
  provider_run_id: FAILED_V9_PROVIDER_RUN_ID,
  review_scope: "all_student_visible_v9_tutor_outputs",
  official_human_review_status: "not_started",
  findings: {
    conceptual_accuracy: "passed_for_visible_outputs",
    contextual_continuity: "passed_for_completed_exchanges",
    adaptive_explanation_quality: "acceptable",
    direct_answer_compliance: "acceptable_and_allowed",
    related_concept_handling: "not_exercised_due_to_case4_opening_failure",
    unsupported_mastery_claims: "not_identified",
    excessive_praise: "not_identified",
    directive_or_coercive_tone: "not_identified",
    report_style_language: "minor_formality_only",
    activity_like_language: "not_identified",
    internal_terminology: "not_identified",
    markdown_compatibility: "within_supported_student_renderer",
    privacy_and_answer_visibility: "passed"
  },
  approval_evidence_created: false,
  approval_eligible: false,
  activation_permitted: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH,
  v9HumanReviewAdvisory
);

const v9FailureAnalysisSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH
);
const v9HumanReviewAdvisorySha = fileSha(
  FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH
);
const v9Case4SafeFailureSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH
);
const v9Case6SafeFailureSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH
);
const v9Case7TransitionAuditSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH
);

const remoteCanaryReport = readJson(V9_REMOTE_CANARY_REPORT_PATH);
const remoteCanaryReportSha = fileSha(V9_REMOTE_CANARY_REPORT_PATH);
const remoteCanaryExportSha = fileSha(V9_REMOTE_CANARY_EXPORT_PATH);
if (
  remoteCanaryReportSha !==
    "2e73b3ed454e4be8b063499c3fb20ea047810330966a5e913aba8af5b523333e" ||
  remoteCanaryExportSha !==
    "13827abcb36fa34efbb30dcd16d2e7da4cc3723b251e644a40f26793fc496f65" ||
  remoteCanaryReport.contract_hash !==
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH ||
  remoteCanaryReport.status !== "passed" ||
  remoteCanaryReport.provider_calls !== 0 ||
  remoteCanaryReport.model_auth_requests !== 0 ||
  remoteCanaryReport.dispatch_checkpoints !== 0 ||
  remoteCanaryReport.ordinary_classroom_records_used !== false
) {
  throw new Error(
    "formative_conversation_v5_v9_remote_canary_evidence_invalid"
  );
}
const remoteCanaryEvidence = {
  artifact_version:
    "formative-conversation-v9-remote-database-canary-evidence-v1",
  source_commit_sha: FAILED_V9_SOURCE_COMMIT,
  contract_hash:
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
  run_public_id: remoteCanaryReport.run_public_id,
  status: "passed",
  report_sha256: remoteCanaryReportSha,
  research_export_sha256: remoteCanaryExportSha,
  waits: remoteCanaryReport.waits,
  connection_recovery: remoteCanaryReport.connection_recovery,
  transaction_summary: remoteCanaryReport.transaction_summary,
  persistence_integrity: remoteCanaryReport.persistence_integrity,
  idempotency_replay: remoteCanaryReport.idempotency_replay,
  outcomes: remoteCanaryReport.outcomes,
  research_export: remoteCanaryReport.research_export,
  artifact_secret_scan: remoteCanaryReport.artifact_secret_scan,
  isolated_record_counts: remoteCanaryReport.isolated_record_counts,
  cleanup: remoteCanaryReport.cleanup,
  provider_calls: 0,
  model_auth_requests: 0,
  dispatch_checkpoints: 0,
  ordinary_classroom_records_used: false,
  secrets_recorded: false,
  preserved_as_no_provider_gate_evidence: true
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V13_REMOTE_CANARY_EVIDENCE_PATH,
  remoteCanaryEvidence
);
const failedV8EvidenceSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH
);
const failedV8FailureAnalysisSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH
);
const failedV8HumanReviewAdvisorySha = fileSha(
  FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH
);
const remoteCanaryEvidenceSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V13_REMOTE_CANARY_EVIDENCE_PATH
);

const v10SecurityWrapperFailureAnalysis = {
  artifact_version:
    "formative-conversation-v10-security-wrapper-failure-analysis-v1",
  preserved_source_commit:
    "c8e445062ad302d1fec5f316f661a83c90f86e34",
  preserved_runtime_candidate_hash:
    FROZEN_V11_RUNTIME_CANDIDATE_HASH,
  preserved_protocol_hash:
    "932d7a8ccb21847f30fa8d6f340275733c129e4d2dc3688681998d8859bb1189",
  preserved_provider_run_id:
    "fcv5v10_provider_20260803083252_623e2625",
  preserved_derived_evaluation_id:
    "fcv5v10_derived_20260803083252_8294069b",
  v10_status: "completed_pending_human_review",
  approval_eligible: false,
  activation_permitted: false,
  approval_blocker: "preventive_artifact_security_scan_failed",
  process_boundary_findings: {
    child_stdout_process:
      "V10 evaluation launcher child stdout captured by the process-local runner",
    exact_prefix_bytes_preserved: false,
    exact_emitting_library_reconstructable: false,
    observed_outer_parser_process: "shell-side jq summary process",
    observed_outer_parser_error:
      "jq: parse error: Invalid numeric literal at line 1, column 7",
    evidence_limit:
      "The temporary buffered child stdout was securely deleted, so attribution below the child-process boundary would be unsupported."
  },
  root_causes: {
    whole_buffer_parse:
      "artifactRoots(stdout) called JSON.parse on an ordinary mixed stdout buffer instead of using a dedicated control channel.",
    empty_scan_targets:
      "The parse exception was swallowed and artifactRoots returned an empty array.",
    zero_coverage_pass:
      "exact-secret-artifact-scanner-v1 based status only on match count and did not reject zero files or zero ZIP entries.",
    premature_artifact_visibility:
      "The evaluation service wrote final artifacts directly under the run root before wrapper scanning completed.",
    secret_lifecycle:
      "The exact in-memory secret array was cleared in the wrapper finally block after the ineffective zero-file scan, before the retrospective supplemental scan.",
    implicit_control_channel:
      "The wrapper treated ordinary stdout as the implicit machine-readable artifact-location channel.",
    retrospective_scan_limit:
      "The later scan used freshly retrieved values after local artifact inspection and therefore cannot satisfy the original preventive pre-release control."
  },
  original_wrapper_scan: {
    secrets_checked: 5,
    files_checked: 0,
    zip_entries_checked: 0,
    buffered_outputs_checked: 2,
    matches_found: 0,
    preventive_attestation_satisfied: false
  },
  retrospective_supplemental_scan: {
    secrets_checked: 5,
    files_checked: 25,
    zip_entries_checked: 16,
    exact_value_matches: 0,
    generic_pattern_matches: 0,
    status: "passed",
    preventive_attestation_satisfied: false
  },
  v10_evidence_and_records_immutable: true,
  v10_human_review_status_changed: false
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH,
  v10SecurityWrapperFailureAnalysis
);
const v10SecurityWrapperFailureAnalysisSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH
);

const v11LauncherFailureAnalysis = {
  artifact_version:
    "formative-conversation-v11-launcher-failure-analysis-v1",
  source_commit_sha: BLOCKED_V11_SOURCE_COMMIT,
  runtime_candidate_hash: FROZEN_V11_RUNTIME_CANDIDATE_HASH,
  evaluation_protocol_hash: BLOCKED_V11_PROTOCOL_HASH,
  status: "blocked_before_dispatch",
  frozen_command:
    "node scripts/operational-formative-conversation-v5-v11-process-local-runner.mjs",
  observed_error_code: "ERR_MODULE_NOT_FOUND",
  root_cause:
    "The outer process-local runner imported TypeScript modules containing @/ aliases without loading the tsx import hook.",
  verification_gap:
    "Module probe, environment preflight, and plan used the loader-aware launcher, while the frozen live command invoked the process-local runner with bare node.",
  correction_scope:
    "Require and validate node --import tsx at the outer process-local boundary and every launcher path.",
  dispatch_checkpoint_created: false,
  provider_run_id: null,
  derived_evaluation_id: null,
  provider_calls: 0,
  model_auth_requests: 0,
  synthetic_records_created: 0,
  approval_eligible: false,
  activation_permitted: false,
  rerunnable_as_v11: false,
  preserved_immutable: true
};
writeJson(
  FORMATIVE_CONVERSATION_V5_V11_LAUNCHER_FAILURE_ANALYSIS_PATH,
  v11LauncherFailureAnalysis
);
const v11LauncherFailureAnalysisSha = fileSha(
  FORMATIVE_CONVERSATION_V5_V11_LAUNCHER_FAILURE_ANALYSIS_PATH
);

const liveEnvironmentContract = {
  contract_version:
    FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_VERSION,
  launcher: {
    version: FORMATIVE_CONVERSATION_V5_LAUNCHER_VERSION,
    mechanism: FORMATIVE_CONVERSATION_V5_LAUNCH_MECHANISM,
    canonical_loader_version:
      FORMATIVE_CONVERSATION_V5_CANONICAL_LOADER_VERSION,
    canonical_invocation:
      "node --import tsx",
    path: "scripts/operational-formative-conversation-v5-v13-launcher.mjs",
    process_local_runner_path:
      "scripts/operational-formative-conversation-v5-v13-process-local-runner.mjs",
    child_cli_path:
      "prisma/operational-formative-conversation-v5-v13-evaluate.ts",
    plan_and_live_share_launcher: true,
    module_probe_environment_preflight_plan_and_live_share_loader: true,
    bare_node_fails_typed_before_dispatch: true,
    invalid_invocation_error_code:
      "formative_conversation_v13_canonical_loader_required",
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
  secret_fingerprints_recorded: false,
  artifact_control_channel: {
    schema_version:
      FORMATIVE_CONVERSATION_V13_CONTROL_SCHEMA_VERSION,
    ordinary_stdout_used_for_control: false,
    owner_only_control_file: true,
    duplicate_missing_malformed_conflicting_fail_closed: true
  },
  preventive_artifact_release: {
    scanner_version:
      FORMATIVE_CONVERSATION_V13_PREVENTIVE_SCANNER_VERSION,
    release_policy_version:
      FORMATIVE_CONVERSATION_V13_RELEASE_POLICY_VERSION,
    attestation_version:
      FORMATIVE_CONVERSATION_V13_SCAN_ATTESTATION_VERSION,
    attestation_schema_fingerprint:
      FORMATIVE_CONVERSATION_V13_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
    exact_secrets_cleared_before_release: true,
    atomic_promotion_required: true
  }
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
    "formative-conversation-v5-executable-source-configuration-v13",
  source_commit_capture: "run_scoped_derived_provenance",
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
    FORMATIVE_CONVERSATION_V5_V13_LIVE_EVALUATION_ENABLED: true
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
    failed_v7_immutable_evidence: immutableV7Evidence,
    failed_v8_runtime_candidate_hash:
      FAILED_V8_RUNTIME_CANDIDATE_HASH,
    failed_v8_protocol_hash: FAILED_V8_PROTOCOL_HASH,
    failed_v8_source_commit_sha: FAILED_V8_SOURCE_COMMIT,
    failed_v8_provider_run_id: FAILED_V8_PROVIDER_RUN_ID,
    failed_v8_derived_evaluation_id:
      FAILED_V8_DERIVED_EVALUATION_ID,
    failed_v8_execution_status: "completed_failed",
    failed_v8_approval_eligible: false,
    failed_v8_activation_permitted: false,
    failed_v8_rerunnable: false,
    failed_v8_evidence_path:
      FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH,
    failed_v8_evidence_sha256: failedV8EvidenceSha,
    failed_v8_failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH,
    failed_v8_failure_analysis_sha256:
      failedV8FailureAnalysisSha,
    failed_v8_human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH,
    failed_v8_human_review_advisory_sha256:
      failedV8HumanReviewAdvisorySha,
    failed_v9_runtime_candidate_hash:
      FAILED_V9_RUNTIME_CANDIDATE_HASH,
    failed_v9_protocol_hash: FAILED_V9_PROTOCOL_HASH,
    failed_v9_source_commit_sha: FAILED_V9_SOURCE_COMMIT,
    failed_v9_provider_run_id: FAILED_V9_PROVIDER_RUN_ID,
    failed_v9_derived_evaluation_id:
      FAILED_V9_DERIVED_EVALUATION_ID,
    failed_v9_execution_status: "completed_failed",
    failed_v9_approval_eligible: false,
    failed_v9_activation_permitted: false,
    failed_v9_rerunnable: false,
    failed_v9_immutable_evidence: immutableV9Evidence,
    failed_v9_failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH,
    failed_v9_failure_analysis_sha256: v9FailureAnalysisSha,
    failed_v9_human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH,
    failed_v9_human_review_advisory_sha256:
      v9HumanReviewAdvisorySha,
    failed_v9_case4_safe_failure_path:
      FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH,
    failed_v9_case4_safe_failure_sha256:
      v9Case4SafeFailureSha,
    failed_v9_case6_safe_failure_path:
      FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH,
    failed_v9_case6_safe_failure_sha256:
      v9Case6SafeFailureSha,
    failed_v9_case7_transition_audit_path:
      FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH,
    failed_v9_case7_transition_audit_sha256:
      v9Case7TransitionAuditSha,
    remote_database_canary_contract_hash:
      FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
    remote_database_canary_evidence_path:
      FORMATIVE_CONVERSATION_V5_V13_REMOTE_CANARY_EVIDENCE_PATH,
    remote_database_canary_evidence_sha256:
      remoteCanaryEvidenceSha,
    remote_database_canary_status: "passed"
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
    evaluation_database_connection_owner:
      "src/lib/operational/evaluation-database-connection-owner.ts",
    persistence_observability:
      "src/lib/services/student-assessment/formative-conversation/persistence-observability.ts",
    profile_field_semantics:
      "src/lib/services/student-assessment/formative-conversation/profile-field-semantics.ts",
    exact_secret_artifact_scanner:
      "src/lib/operational/formative-conversation-v5-evaluation-v13/security-release.ts",
    run_scoped_provenance:
      "src/lib/operational/formative-conversation-v5-evaluation-v13/provenance.ts",
    remote_database_canary:
      "src/lib/operational/formative-conversation-v5-evaluation-v9/remote-database-canary.ts",
    canary_environment_broker:
      "scripts/operational-formative-conversation-v5-v9-canary-environment-broker.mjs",
    formative_runtime:
      "src/lib/services/student-assessment/formative-conversation/runtime.ts",
    live_environment_parity:
      "src/lib/operational/formative-conversation-v5-evaluation-v13/live-environment.ts",
    launch_mechanism:
      "scripts/operational-formative-conversation-v5-v13-launcher.mjs",
    secure_process_local_injection:
      "scripts/operational-formative-conversation-v5-v13-process-local-runner.mjs",
    protocol_case_compiler:
      "src/lib/operational/formative-conversation-v5-evaluation-v13/compiler.ts",
    protocol_runner:
      "src/lib/operational/formative-conversation-v5-evaluation-v13/service.ts",
    production_execution_harness:
      "src/lib/evaluation/synthetic-student-validation/framework.ts",
    v10_security_wrapper_failure_analysis:
      FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH,
    v11_launcher_failure_analysis:
      FORMATIVE_CONVERSATION_V5_V11_LAUNCHER_FAILURE_ANALYSIS_PATH
  }
};
writeJson(
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  sourceConfiguration
);

const candidateManifest = {
  manifest_version:
    "formative-conversation-host-v5-executable-candidate-revision-v13",
  approval_state: "candidate_not_approved",
  activation_permitted: false,
  runtime_behavior_changed: true,
  instructional_behavior_changed: false,
  evaluation_governance_changed: true,
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
  failed_v7_rerunnable: false,
  failed_v8_protocol_hash: FAILED_V8_PROTOCOL_HASH,
  failed_v8_runtime_candidate_hash:
    FAILED_V8_RUNTIME_CANDIDATE_HASH,
  failed_v8_execution_status: "completed_failed",
  failed_v8_rerunnable: false,
  failed_v9_protocol_hash: FAILED_V9_PROTOCOL_HASH,
  failed_v9_runtime_candidate_hash:
    FAILED_V9_RUNTIME_CANDIDATE_HASH,
  failed_v9_execution_status: "completed_failed",
  failed_v9_rerunnable: false,
  remote_database_canary_contract_hash:
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
  remote_database_canary_status: "passed",
  frozen_v10_runtime_candidate_hash:
    FROZEN_V11_RUNTIME_CANDIDATE_HASH,
  frozen_v12_runtime_candidate_hash:
    FROZEN_V12_RUNTIME_CANDIDATE_HASH,
  frozen_v12_protocol_hash: FROZEN_V12_PROTOCOL_HASH,
  immutable_v12_opening_failure_evidence:
    V12_OPENING_FAILURE_EVIDENCE,
  frozen_v10_protocol_hash:
    "932d7a8ccb21847f30fa8d6f340275733c129e4d2dc3688681998d8859bb1189",
  frozen_v10_execution_status:
    "completed_pending_human_review",
  frozen_v10_approval_eligible: false
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
  manifest_version: "formative-conversation-v5-fixture-manifest-v13",
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
    path: "scripts/operational-formative-conversation-v5-v13-process-local-runner.mjs"
  },
  {
    role: "launcher",
    path: "scripts/operational-formative-conversation-v5-v13-launcher.mjs"
  },
  {
    role: "cli",
    path: "prisma/operational-formative-conversation-v5-v13-evaluate.ts"
  },
  {
    role: "orchestration_service",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/service.ts"
  },
  {
    role: "environment_parity_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/live-environment.ts"
  },
  {
    role: "environment_contract",
    path: FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
  },
  {
    role: "candidate_transport_runner",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/candidate-runner.ts"
  },
  {
    role: "package_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/package.ts"
  },
  {
    role: "contract_schemas",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/contracts.ts"
  },
  {
    role: "case_compiler",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/compiler.ts"
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
    role: "semantic_regeneration_policy",
    path: "src/lib/services/student-assessment/formative-conversation/semantic-regeneration.ts"
  },
  {
    role: "candidate_acceptance_boundary",
    path: "src/lib/services/student-assessment/formative-conversation/candidate-validation.ts"
  },
  {
    role: "adversarial_offline_matrix",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/adversarial-matrix.ts"
  },
  ...V12_OPENING_FAILURE_EVIDENCE.map((evidence) => ({
    role: `immutable_v12_${evidence.case_id}`,
    path: evidence.path
  })),
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
  },
  {
    role: "profile_field_semantics",
    path: "src/lib/services/student-assessment/formative-conversation/profile-field-semantics.ts"
  },
  {
    role: "persistence_observability",
    path: "src/lib/services/student-assessment/formative-conversation/persistence-observability.ts"
  },
  {
    role: "database_connection_owner",
    path: "src/lib/operational/evaluation-database-connection-owner.ts"
  },
  {
    role: "exact_secret_scanner",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/security-release.ts"
  },
  {
    role: "preventive_artifact_release",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/security-release.ts"
  },
  {
    role: "run_scoped_provenance",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v13/provenance.ts"
  },
  {
    role: "remote_database_canary",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v9/remote-database-canary.ts"
  },
  {
    role: "canary_environment_broker",
    path: "scripts/operational-formative-conversation-v5-v9-canary-environment-broker.mjs"
  },
  {
    role: "immutable_v8_evaluation",
    path: FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH
  },
  {
    role: "immutable_v8_failure_analysis",
    path: FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH
  },
  {
    role: "immutable_v8_human_review",
    path: FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH
  },
  {
    role: "immutable_v9_failure_analysis",
    path: FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH
  },
  {
    role: "immutable_v9_human_review",
    path: FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH
  },
  {
    role: "immutable_v9_case4_failure",
    path: FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH
  },
  {
    role: "immutable_v9_case6_failure",
    path: FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH
  },
  {
    role: "immutable_v9_case7_transition_audit",
    path: FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH
  },
  {
    role: "remote_database_canary_evidence",
    path: FORMATIVE_CONVERSATION_V5_V13_REMOTE_CANARY_EVIDENCE_PATH
  },
  {
    role: "v10_security_wrapper_failure_analysis",
    path: FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH
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
  ...v9Protocol,
  protocol_version:
    "formative-conversation-host-v5-executable-evaluation-v13",
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
  failed_v8_execution: {
    frozen_commit: FAILED_V8_SOURCE_COMMIT,
    runtime_candidate_hash: FAILED_V8_RUNTIME_CANDIDATE_HASH,
    protocol_hash: FAILED_V8_PROTOCOL_HASH,
    provider_run_id: FAILED_V8_PROVIDER_RUN_ID,
    derived_evaluation_id: FAILED_V8_DERIVED_EVALUATION_ID,
    execution_status: "completed_failed",
    passed: 6,
    failed: 2,
    invalid: 0,
    not_exercised: 0,
    actual_logical_calls: 18,
    expected_logical_calls: 21,
    approval_eligible: false,
    activation_permitted: false,
    rerunnable: false,
    preserved_immutable: true,
    evidence_path:
      FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH,
    evidence_sha256: failedV8EvidenceSha,
    failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH,
    failure_analysis_sha256: failedV8FailureAnalysisSha,
    human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH,
    human_review_advisory_sha256:
      failedV8HumanReviewAdvisorySha,
    root_cause_classification: {
      cases_5_and_7:
        "database_connection_lifecycle_interrupt_after_valid_provider_output",
      case_8: "misconception_field_semantic_contract_defect",
      secret_scan: "exact_value_scan_lifecycle_incomplete"
    }
  },
  failed_v9_execution: {
    frozen_commit: FAILED_V9_SOURCE_COMMIT,
    runtime_candidate_hash: FAILED_V9_RUNTIME_CANDIDATE_HASH,
    protocol_hash: FAILED_V9_PROTOCOL_HASH,
    provider_run_id: FAILED_V9_PROVIDER_RUN_ID,
    derived_evaluation_id: FAILED_V9_DERIVED_EVALUATION_ID,
    execution_status: "completed_failed",
    passed: 6,
    failed: 2,
    invalid: 0,
    not_exercised: 0,
    actual_logical_calls: 20,
    actual_provider_attempts: 20,
    approval_eligible: false,
    activation_permitted: false,
    rerunnable: false,
    preserved_immutable: true,
    immutable_evidence: immutableV9Evidence,
    failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH,
    failure_analysis_sha256: v9FailureAnalysisSha,
    human_review_advisory_path:
      FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH,
    human_review_advisory_sha256: v9HumanReviewAdvisorySha,
    case4_safe_failure_path:
      FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH,
    case4_safe_failure_sha256: v9Case4SafeFailureSha,
    case6_safe_failure_path:
      FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH,
    case6_safe_failure_sha256: v9Case6SafeFailureSha,
    case7_transition_audit_path:
      FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH,
    case7_transition_audit_sha256: v9Case7TransitionAuditSha,
    root_cause_classification: {
      case4: "indeterminate_due_to_safe_output_evidence_omission",
      case6: "semantic_regeneration_and_evidence_preservation_defect",
      case7: "two_substantively_different_evidence_supported_versions"
    }
  },
  remote_database_canary: {
    contract_hash:
      FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
    evidence_path:
      FORMATIVE_CONVERSATION_V5_V13_REMOTE_CANARY_EVIDENCE_PATH,
    evidence_sha256: remoteCanaryEvidenceSha,
    status: "passed",
    real_waits_completed: true,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0,
    retained_synthetic_records: 0,
    ordinary_classroom_records_used: false,
    exact_secret_scan_passed: true
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
    candidate_acceptance_version:
      targetRoleIdentity.candidate_acceptance_version,
    adversarial_matrix_version:
      targetRoleIdentity.adversarial_matrix_version,
    adversarial_matrix_hash:
      targetRoleIdentity.adversarial_matrix_hash,
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
      targetRoleIdentity.evaluation_database_lifecycle_version,
    profile_field_semantics_version:
      targetRoleIdentity.profile_field_semantics_version,
    persistence_observability_version:
      targetRoleIdentity.persistence_observability_version,
    evaluation_database_connection_owner_version:
      targetRoleIdentity.evaluation_database_connection_owner_version,
    evaluation_database_read_recovery_version:
      targetRoleIdentity.evaluation_database_read_recovery_version,
    exact_secret_artifact_scanner_version:
      targetRoleIdentity.exact_secret_artifact_scanner_version,
    artifact_control_channel_version:
      targetRoleIdentity.artifact_control_channel_version,
    artifact_release_policy_version:
      targetRoleIdentity.artifact_release_policy_version,
    scan_attestation_version:
      targetRoleIdentity.scan_attestation_version,
    scan_attestation_schema_fingerprint:
      targetRoleIdentity.scan_attestation_schema_fingerprint,
    security_wrapper_version:
      targetRoleIdentity.security_wrapper_version,
    security_wrapper_fingerprint:
      targetRoleIdentity.security_wrapper_fingerprint,
    run_scoped_provenance_version:
      targetRoleIdentity.run_scoped_provenance_version,
    semantic_regeneration_policy_version:
      targetRoleIdentity.semantic_regeneration_policy_version,
    semantic_regeneration_instruction_version:
      targetRoleIdentity.semantic_regeneration_instruction_version,
    semantic_regeneration_instruction_hash:
      targetRoleIdentity.semantic_regeneration_instruction_hash,
    semantic_regeneration_accounting_version:
      targetRoleIdentity.semantic_regeneration_accounting_version,
    safe_invalid_output_evidence_version:
      targetRoleIdentity.safe_invalid_output_evidence_version,
    remote_database_canary_version:
      targetRoleIdentity.remote_database_canary_version,
    remote_database_canary_contract_hash:
      targetRoleIdentity.remote_database_canary_contract_hash
  },
  budget: {
    ...(v9Protocol.budget as Record<string, unknown>),
    expected_logical_call_count: 21,
    maximum_logical_call_count: 29,
    expected_provider_attempt_count: 21,
    maximum_provider_attempt_count: 87,
    maximum_semantic_regenerations_per_agent_call: 1,
    maximum_semantic_regeneration_count: 8,
    maximum_input_token_count: 900000,
    maximum_output_token_count: 101500,
    maximum_total_token_count: 1001500
  },
  execution_policy: {
    ...(v9Protocol.execution_policy as Record<string, unknown>),
    runner_version:
      FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
  },
  runner_implementation: runnerImplementation,
  isolation: {
    ...(v9Protocol.isolation as Record<string, unknown>),
    provider_run_id_template:
      "fcv5v13_provider_<timestamp>_<random>",
    derived_evaluation_id_template:
      "fcv5v13_derived_<timestamp>_<random>"
  },
  live_authorization_template:
    "I authorize one live execution of formative-conversation-host-v5-executable-v13 for runtime candidate hash <runtime_candidate_hash> and evaluation protocol hash <evaluation_protocol_hash>, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.",
  required_live_environment_flag:
    "FORMATIVE_CONVERSATION_V5_V13_LIVE_EVALUATION_ENABLED=true",
  artifact_contract: {
    ...(v9Protocol.artifact_contract as Record<string, unknown>),
    contract_version:
      "formative-conversation-v5-live-artifact-contract-v3",
    preventive_manifest_scan_required: true,
    atomic_release_after_attestation_required: true,
    ordinary_stdout_is_not_control_channel: true,
    v10_security_wrapper_failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH,
    v10_security_wrapper_failure_analysis_sha256:
      v10SecurityWrapperFailureAnalysisSha,
    v11_launcher_failure_analysis_path:
      FORMATIVE_CONVERSATION_V5_V11_LAUNCHER_FAILURE_ANALYSIS_PATH,
    v11_launcher_failure_analysis_sha256:
      v11LauncherFailureAnalysisSha
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
    "formative-conversation-v5-executable-approval-placeholder-v13",
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
    "formative-conversation-v5-executable-candidate-identity-v13",
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
  failed_v8_runtime_candidate_hash:
    FAILED_V8_RUNTIME_CANDIDATE_HASH,
  failed_v8_protocol_hash: FAILED_V8_PROTOCOL_HASH,
  failed_v8_evidence_sha256: failedV8EvidenceSha,
  failed_v8_failure_analysis_sha256:
    failedV8FailureAnalysisSha,
  failed_v8_human_review_advisory_sha256:
    failedV8HumanReviewAdvisorySha,
  failed_v9_runtime_candidate_hash:
    FAILED_V9_RUNTIME_CANDIDATE_HASH,
  failed_v9_protocol_hash: FAILED_V9_PROTOCOL_HASH,
  failed_v9_immutable_evidence: immutableV9Evidence,
  failed_v9_failure_analysis_sha256: v9FailureAnalysisSha,
  failed_v9_human_review_advisory_sha256:
    v9HumanReviewAdvisorySha,
  failed_v9_case4_safe_failure_sha256:
    v9Case4SafeFailureSha,
  failed_v9_case6_safe_failure_sha256:
    v9Case6SafeFailureSha,
  failed_v9_case7_transition_audit_sha256:
    v9Case7TransitionAuditSha,
  remote_database_canary_contract_hash:
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
  remote_database_canary_evidence_sha256:
    remoteCanaryEvidenceSha,
  source_application_git_commit_location:
    "run_scoped_derived_provenance",
  artifact_control_channel_version:
    FORMATIVE_CONVERSATION_V13_CONTROL_SCHEMA_VERSION,
  security_wrapper_fingerprint: securityWrapperFingerprint,
  scan_attestation_schema_fingerprint:
    FORMATIVE_CONVERSATION_V13_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  v10_security_wrapper_failure_analysis_sha256:
    v10SecurityWrapperFailureAnalysisSha
};
writeJson(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  candidateIdentity
);

const sourceApplicationGitCommit = execFileSync(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: process.cwd(), encoding: "utf8" }
).trim();
let committedSourceVerification: ReturnType<
  typeof verifyFormativeConversationV13CommittedSource
> | null = null;
const candidateIdentityTracked = execFileSync(
  "git",
  [
    "ls-files",
    `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-identity.json`
  ],
  { cwd: process.cwd(), encoding: "utf8" }
).trim().length > 0;
if (candidateIdentityTracked) {
  committedSourceVerification =
    verifyFormativeConversationV13CommittedSource();
}
const provenanceRoot = absolute(
  ".data/operational-formative-conversation-v5-evaluation-v13/provenance"
);
mkdirSync(provenanceRoot, { recursive: true, mode: 0o700 });
chmodSync(provenanceRoot, 0o700);
const materializationTimestamp = new Date().toISOString();
const materializationProvenance = {
  artifact_version:
    "formative-conversation-v13-materialization-provenance-v1",
  provenance_contract_version:
    FORMATIVE_CONVERSATION_V13_RUN_PROVENANCE_VERSION,
  source_application_git_commit: sourceApplicationGitCommit,
  deployed_application_git_commit: null,
  materialized_at: materializationTimestamp,
  mode: initializationRequested ? "initialize" : "verify",
  tracked_candidate_files_written: initializationRequested,
  tracked_candidate_files_rewritten_during_verification: false,
  committed_source_status: committedSourceVerification
    ? "verified_from_committed_source"
    : "uncommitted_preparation",
  committed_source_provenance_hash:
    committedSourceVerification?.provenance_hash ?? null
};
const materializationProvenancePath = path.join(
  provenanceRoot,
  `materialization-${materializationTimestamp.replace(/[-:.TZ]/g, "")}-${process.pid}.json`
);
writeFileSync(
  materializationProvenancePath,
  `${JSON.stringify(materializationProvenance, null, 2)}\n`,
  { encoding: "utf8", flag: "wx", mode: 0o600 }
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
      failed_v7_immutable_evidence: immutableV7Evidence,
      failed_v8_evidence_sha256: failedV8EvidenceSha,
      failed_v8_failure_analysis_sha256:
        failedV8FailureAnalysisSha,
      failed_v8_human_review_advisory_sha256:
        failedV8HumanReviewAdvisorySha,
      blocked_v11_protocol_hash: BLOCKED_V11_PROTOCOL_HASH,
      blocked_v11_launcher_failure_analysis_sha256:
        v11LauncherFailureAnalysisSha,
      remote_database_canary_contract_hash:
        FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
      remote_database_canary_evidence_sha256:
        remoteCanaryEvidenceSha,
      source_application_git_commit:
        sourceApplicationGitCommit,
      source_provenance_location:
        path.relative(process.cwd(), materializationProvenancePath),
      committed_source_status:
        materializationProvenance.committed_source_status,
      tracked_candidate_files_rewritten_during_verification:
        false
    },
    null,
    2
  )
);
