import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { AgentModelConfig } from "@/lib/llm/config";
import {
  publicOpenAICredentialResolution,
  resolveOpenAICredentialFromEnv,
  withResolvedOpenAICredential
} from "@/lib/llm/openai-credential-resolver";
import {
  isApprovedOpenAIBaseUrl,
  openAIBaseUrlHost,
  resolveOpenAIBaseUrl
} from "@/lib/llm/openai-transport-diagnostics";
import {
  OPENAI_RESPONSES_ADAPTER_VERSION,
  OpenAIResponsesProvider
} from "@/lib/llm/providers/openai-responses-provider";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import { resolveApplicationBuildInfo } from
  "@/lib/provenance/application-build-info";
import {
  compileE2A14CandidateRequestsNoNetwork
} from "./e2a14-request-compilation";
import {
  E2A14_CANDIDATE_PATH,
  evaluateE2A14Candidate
} from "./e2a14-protected-request-validator-candidate";
import { e2a14ProtectedArtifactSnapshot } from
  "./e2a14-protected-request-calibration";
import {
  E2A4_BASELINE_MANIFEST_PATH,
  sha256
} from "./e2a4-topic-dialogue-contract";
import { fallbackForCase, requestForCase } from
  "./e2a10-v7-topic-dialogue-canary";
import {
  executeE2A15BRuntime,
  type E2A15BRuntimeExecution
} from "./e2a15b-runtime";
import {
  E2A17_NO_LIVE_PROVIDER_FACTORY,
  auditE2AInformationFlow,
  buildE2ADynamicTutorCase,
  buildE2ASimulatorInput,
  buildE2ATutorRepairInstructions,
  buildE2ATutorValidationContext,
  cleanupE2AEvaluationFixture,
  countE2AEvaluationPersistence,
  createE2AEvaluationFixture,
  e2aAdapterAttemptCount,
  e2aUsageFor,
  executeE2AProgression,
  inspectE2ATranscript,
  inspectE2AVisibleMessageSafety,
  loadE2AEvaluationTranscript,
  persistE2ARouteDecision,
  persistE2AStudentTurn,
  sanitizedE2AProviderResult,
  type E2AEvaluationFixture,
  type E2AEvaluationProviderBundle
} from "./e2a17-bounded-student-simulator-canary";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH,
  type E2A17SessionProtocol,
  type E2A17TurnProtocol
} from "./e2a17-protocol";
import {
  E2A18_ARTIFACT_ROOT,
  E2A17_AUTHORITATIVE_RUN_ID
} from "./e2a18-simulator-contract-adjudication";
import {
  E2A18_SIMULATOR_CONTRACT_VERSION,
  E2A18_SIMULATOR_PROMPT_VERSION,
  E2A18_SIMULATOR_SCHEMA_VERSION
} from "./e2a18-student-simulator-contract-v2";
import {
  adjudicateEvidenceDrivenTransition
} from "./e2a20-evidence-driven-transition-adjudication";
import {
  E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  validateLlmStudentSimulatorOutputV3
} from "./e2a20a-student-simulator-evidence-classifier-v3";
import {
  E2A_SIMULATOR_SCHEMA_VERSION,
  LlmStudentSimulatorInputSchema,
  LlmStudentSimulatorOutputSchema,
  type LlmStudentSimulatorInput,
  type LlmStudentSimulatorOutput
} from "./e2a-schemas";
import { LLM_STUDENT_SIMULATOR_INSTRUCTIONS } from
  "./llm-student-simulator-prompt";
import { renderedIntentForStudentIntent } from
  "./llm-student-simulator-validation";
import {
  assertEvidenceFirstProfileIsFresh,
  buildEvidenceFirstProgressionAuthorization,
  createTopicDialogueTurnEvidenceProfile,
  EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
  integrateTopicDialogueEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  evaluateThetaInformationTurn
} from "./e2a22-evidence-first-profile-routing";
import {
  E2A23_ARTIFACT_CONTRACT,
  E2A23_ARTIFACT_CONTRACT_HASH,
  E2A23_AUTHORIZED_ARTIFACTS,
  E2A23_BUDGET,
  E2A23_FROZEN_PROTOCOL,
  E2A23_PROTOCOL_HASH,
  E2A23_RUNNER_VERSION,
  E2A23_SESSION,
  validateE2A23Protocol,
  type E2A23ArtifactName
} from "./e2a23-protocol";

export const E2A23_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a23-evidence-first-micro-canary"
);
export const E2A23_AUTHORITATIVE_E2A18_RUN_ID =
  "e2a18_20260720082941_39cf7af8" as const;

const E2A18_RUN_DIR = path.join(
  E2A18_ARTIFACT_ROOT, E2A23_AUTHORITATIVE_E2A18_RUN_ID
);
const LOCK_PATH = path.join(E2A23_ARTIFACT_ROOT, ".e2a23-live.lock");
const CLASSIFIER_SOURCE_PATH = path.join(
  process.cwd(),
  "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts"
);
const SOURCE_LOGIC_FILES = [
  "src/lib/evaluation/formative/e2a23-protocol.ts",
  "src/lib/evaluation/formative/e2a23-evidence-first-micro-canary.ts",
  "src/lib/evaluation/formative/e2a22-evidence-first-profile-routing.ts",
  "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts",
  "src/lib/evaluation/formative/e2a18-student-simulator-contract-v2.ts",
  "src/lib/evaluation/formative/e2a17-bounded-student-simulator-canary.ts",
  "src/lib/evaluation/formative/e2a17-protocol.ts",
  "src/lib/evaluation/formative/e2a15b-runtime.ts",
  "src/lib/evaluation/formative/e2a14-protected-request-validator-candidate.ts",
  "src/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary.ts",
  "src/lib/evaluation/formative/llm-student-simulator-prompt.ts",
  "src/lib/evaluation/formative/llm-student-simulator-validation.ts",
  "src/lib/evaluation/formative/e2a-schemas.ts",
  "src/lib/services/student-assessment/topic-dialogue-operation-contract.ts",
  "src/lib/services/student-assessment/topic-dialogue-response-mode.ts",
  "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v2.ts",
  "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v3.ts",
  "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts",
  "src/lib/services/student-assessment/activity-runtime-ui.ts",
  "config/candidate-operational-agent-config.e2a14-protected-request-validator-calibration-v1.json"
] as const;

const PROTECTED_EVIDENCE_DIRS = {
  e2a12: path.join(
    process.cwd(), ".data", "e2a12-v8-held-out-canary",
    "e2a12_20260719234834_59a67eaf"
  ),
  e2a13: path.join(
    process.cwd(), ".data", "e2a13-v8-30-case-evaluation",
    "e2a13_20260720004834_23ce39bc"
  ),
  e2a14: path.join(
    process.cwd(), ".data", "e2a14-protected-request-calibration",
    "e2a14_20260720020517_64483a8b"
  ),
  e2a15: path.join(
    process.cwd(), ".data", "e2a15-protected-request-provider-subset",
    "e2a15_20260720030832_efc41543"
  ),
  e2a15a: path.join(
    process.cwd(), ".data", "e2a15a-protocol-audit",
    "e2a15a_20260720045022_658b008c"
  ),
  e2a15b: path.join(
    process.cwd(), ".data", "e2a15b-protected-request-supplement",
    "e2a15b_20260720053628_0e8a35af"
  ),
  e2a16: path.join(
    process.cwd(), ".data", "e2a16-human-review-closure",
    "e2a16_20260720071641_9e2e4f59"
  ),
  e2a17: path.join(
    process.cwd(), ".data", "e2a17-bounded-student-simulator-canary",
    E2A17_AUTHORITATIVE_RUN_ID
  ),
  e2a18: E2A18_RUN_DIR,
  e2a19: path.join(
    process.cwd(), ".data", "e2a19-single-session-micro-canary",
    "e2a19_20260720094054_74982b99"
  ),
  e2a20: path.join(
    process.cwd(), ".data", "e2a20-evidence-driven-transition-adjudication",
    "e2a20_20260720095853_6b995450"
  ),
  e2a20a: path.join(
    process.cwd(), ".data", "e2a20a-turn4-classification-adjudication",
    "e2a20a_20260720103109_e94fce3d"
  ),
  e2a21: path.join(
    process.cwd(), ".data", "e2a21-evidence-driven-micro-canary",
    "e2a21_20260720110713_3f9764d1"
  ),
  e2a22: path.join(
    process.cwd(), ".data", "e2a22-evidence-first-profile-routing",
    "e2a22_20260720124123_ee4b88aa"
  )
} as const;

const JSONL_ARTIFACTS = new Set<E2A23ArtifactName>(
  E2A23_AUTHORIZED_ARTIFACTS.filter((name) => name.endsWith(".jsonl"))
);

type JsonObject = Record<string, unknown>;
type RunPaths = ReturnType<typeof pathsFor>;
type EvidenceClassification = ReturnType<
  typeof validateLlmStudentSimulatorOutputV3
>["evidence_adjudication"];

type BudgetLedger = {
  simulator_calls: number;
  tutor_initial_calls: number;
  tutor_regeneration_calls: number;
  total_logical_generation_calls: number;
  provider_adapter_attempts: number;
  transport_retries: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  pricing_complete: boolean;
  total_latency_ms: number;
  per_call: Array<{
    role: "simulator" | "tutor";
    turn_number: number;
    attempt_index: number;
    latency_ms: number;
    adapter_attempts: number;
    retries: number;
  }>;
};

type CompletedTurn = {
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  fixture: E2AEvaluationFixture;
  simulator_message: string;
  evidence: EvidenceClassification;
  runtime: E2A15BRuntimeExecution;
  persistence: JsonObject;
  progression: JsonObject;
  privacy: ReturnType<typeof inspectE2AVisibleMessageSafety>;
  context: JsonObject;
  transcript: JsonObject;
};

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function assertSafeArtifact(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?Bearer/iu,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a23_artifact_secret_or_private_reasoning_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafeArtifact(value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, value: unknown) {
  assertSafeArtifact(value);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function relative(filePath: string) {
  return path.relative(process.cwd(), filePath);
}

function pathsFor(runDir: string) {
  return {
    canaryManifest: path.join(runDir, "canary-manifest.json"),
    compositeRuntimeIdentity: path.join(
      runDir, "composite-runtime-identity.json"
    ),
    frozenProtocol: path.join(runDir, "frozen-protocol.json"),
    frozenProtocolSha256: path.join(runDir, "frozen-protocol.sha256"),
    candidateIntegrity: path.join(runDir, "candidate-integrity.json"),
    classifierIntegrity: path.join(runDir, "classifier-integrity.json"),
    routingIntegrity: path.join(runDir, "routing-integrity.json"),
    sessionFixture: path.join(runDir, "session-fixture.json"),
    informationFlowAudit: path.join(runDir, "information-flow-audit.jsonl"),
    studentProviderOutputs: path.join(
      runDir, "student-provider-outputs.jsonl"
    ),
    intentClassifications: path.join(
      runDir, "intent-classifications.jsonl"
    ),
    conceptualEvidenceEvaluations: path.join(
      runDir, "conceptual-evidence-evaluations.jsonl"
    ),
    studentTurnResults: path.join(runDir, "student-turn-results.jsonl"),
    turnProfileSnapshots: path.join(runDir, "turn-profile-snapshots.jsonl"),
    cumulativeProfileUpdates: path.join(
      runDir, "cumulative-profile-updates.jsonl"
    ),
    routingDecisions: path.join(runDir, "routing-decisions.jsonl"),
    profileFreshnessResults: path.join(
      runDir, "profile-freshness-results.jsonl"
    ),
    tutorRequestProvenance: path.join(
      runDir, "tutor-request-provenance.jsonl"
    ),
    tutorProviderOutputs: path.join(runDir, "tutor-provider-outputs.jsonl"),
    runtimeValidationResults: path.join(
      runDir, "runtime-validation-results.jsonl"
    ),
    pedagogicalRubricResults: path.join(
      runDir, "pedagogical-rubric-results.jsonl"
    ),
    progressionResults: path.join(runDir, "progression-results.jsonl"),
    persistenceResults: path.join(runDir, "persistence-results.jsonl"),
    studentProjectionResults: path.join(
      runDir, "student-projection-results.jsonl"
    ),
    auditProjectionResults: path.join(
      runDir, "audit-projection-results.jsonl"
    ),
    transcriptRefreshResults: path.join(
      runDir, "transcript-refresh-results.jsonl"
    ),
    privacyResults: path.join(runDir, "privacy-results.jsonl"),
    contextCoverageResults: path.join(
      runDir, "context-coverage-results.jsonl"
    ),
    fixtureCleanupResult: path.join(runDir, "fixture-cleanup-result.json"),
    providerUsage: path.join(runDir, "provider-usage.json"),
    causalTimeline: path.join(runDir, "causal-timeline.json"),
    humanReviewPacket: path.join(runDir, "human-review-packet.json"),
    canarySummary: path.join(runDir, "canary-summary.json")
  };
}

function initializeArtifacts(runDir: string) {
  if (existsSync(runDir)) throw new Error("e2a23_run_directory_exists");
  mkdirSync(runDir, { recursive: true });
  for (const name of E2A23_AUTHORIZED_ARTIFACTS) {
    writeFileSync(
      path.join(runDir, name),
      JSONL_ARTIFACTS.has(name) || name.endsWith(".sha256") ? "" : "{}\n",
      "utf8"
    );
  }
  return pathsFor(runDir);
}

function listRunArtifactNames(runDir: string) {
  return readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function runId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `e2a23_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(), encoding: "utf8"
  }).trim();
}

function trackedTreeClean() {
  return execFileSync("git", [
    "status", "--porcelain", "--untracked-files=no"
  ], { cwd: process.cwd(), encoding: "utf8" }).trim() === "";
}

function pidsMatching(pattern: string) {
  try {
    const excluded = new Set<number>([process.pid]);
    let ancestor = process.pid;
    while (ancestor > 1) {
      const parent = Number(execFileSync("ps", [
        "-o", "ppid=", "-p", String(ancestor)
      ], { encoding: "utf8" }).trim());
      if (!Number.isInteger(parent) || parent <= 1 || excluded.has(parent)) {
        break;
      }
      excluded.add(parent);
      ancestor = parent;
    }
    const output = execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf8"
    }).trim();
    return output ? output.split(/\s+/u).map(Number).filter((pid) =>
      Number.isInteger(pid) && !excluded.has(pid)
    ) : [];
  } catch {
    return [];
  }
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    listFiles(path.join(root, entry.name))
  ).sort();
}

function directoryDigest(root: string) {
  const rows = listFiles(root).map((filePath) => ({
    path: path.relative(root, filePath),
    sha256: sha256(readFileSync(filePath))
  }));
  return {
    exists: existsSync(root),
    file_count: rows.length,
    aggregate_sha256: sha256(
      rows.map((row) => `${row.path}:${row.sha256}`).join("\n")
    )
  };
}

function sourceLogicSnapshot() {
  const files = SOURCE_LOGIC_FILES.map((filePath) => {
    const absolute = path.join(process.cwd(), filePath);
    return {
      path: filePath,
      exists: existsSync(absolute),
      sha256: existsSync(absolute) ? sha256(readFileSync(absolute)) : null
    };
  });
  return { files, aggregate_sha256: stableHash(files) };
}

function protectedEvidenceSnapshot() {
  const runtime = e2a14ProtectedArtifactSnapshot();
  const groups = runtime.tracked_groups;
  return {
    snapshot_version: "e2a23-protected-evidence-snapshot-v1",
    approved_v2_hash: runtime.approved_v2_hash,
    approved_v2_candidate: groups.approved_v2_candidate,
    approved_operational_manifest: groups.approved_operational_manifest,
    approved_active_bundle: groups.approved_active_bundle,
    approved_prompts: groups.approved_prompts,
    approved_provider_schema_semantics:
      groups.approved_provider_schema_semantics,
    approved_topic_validator: groups.approved_topic_validator,
    approval_evidence: groups.approval_evidence,
    activation_evidence: groups.activation_evidence,
    tutor_candidate: {
      path: relative(E2A14_CANDIDATE_PATH),
      configuration_hash: E2A17_CANDIDATE_HASH,
      expected_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
      actual_file_sha256: sha256(readFileSync(E2A14_CANDIDATE_PATH))
    },
    classifier_v3: {
      path: relative(CLASSIFIER_SOURCE_PATH),
      version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      expected_file_sha256:
        "9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899",
      actual_file_sha256: sha256(readFileSync(CLASSIFIER_SOURCE_PATH))
    },
    historical_evidence: Object.fromEntries(Object.entries(
      PROTECTED_EVIDENCE_DIRS
    ).map(([name, root]) => [name, directoryDigest(root)]))
  };
}

function authoritativeE2A22ProtocolDraftSource() {
  const filePath = path.join(
    process.cwd(), ".data", "e2a22-evidence-first-profile-routing",
    "e2a22_20260720124123_ee4b88aa",
    "e2a23-micro-canary-protocol-draft.json"
  );
  const source = existsSync(filePath) ? readJson<{
    evidence_classifier_version?: string;
    orchestration_version?: string;
    current_profile_controls_routing?: boolean;
    profile_update_precedes_tutor_request?: boolean;
    no_minimum_dialogue_turn_requirement?: boolean;
  }>(filePath) : null;
  return {
    path: relative(filePath),
    exists: existsSync(filePath),
    file_sha256: existsSync(filePath)
      ? sha256(readFileSync(filePath))
      : null,
    content_matches_frozen_protocol: source !== null &&
      source.evidence_classifier_version ===
        E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION &&
      source.orchestration_version === EVIDENCE_FIRST_PROFILE_ROUTING_VERSION &&
      source.current_profile_controls_routing === true &&
      source.profile_update_precedes_tutor_request === true &&
      source.no_minimum_dialogue_turn_requirement === true
  };
}

function candidateIntegrity(checkpointCommit: string) {
  const evaluated = evaluateE2A14Candidate();
  const source = sourceLogicSnapshot();
  const protectedSnapshot = protectedEvidenceSnapshot();
  const protocolSource = authoritativeE2A22ProtocolDraftSource();
  const classifierSha = sha256(readFileSync(CLASSIFIER_SOURCE_PATH));
  const applicationBuildInfo = resolveApplicationBuildInfo();
  const checks = {
    candidate_hash_matches:
      evaluated.candidate_configuration_hash === E2A17_CANDIDATE_HASH,
    candidate_file_sha_matches:
      sha256(readFileSync(E2A14_CANDIDATE_PATH)) ===
      E2A17_CANDIDATE_FILE_SHA256,
    candidate_unapproved: evaluated.candidate_approved === false,
    candidate_inactive: evaluated.candidate_activated === false,
    approved_v2_hash_matches:
      evaluated.approved_v2_hash === E2A17_APPROVED_V2_HASH,
    protocol_hash_matches:
      E2A23_FROZEN_PROTOCOL.protocol_hash === E2A23_PROTOCOL_HASH,
    protocol_source_matches: protocolSource.content_matches_frozen_protocol,
    simulator_contract_v2:
      E2A18_SIMULATOR_CONTRACT_VERSION ===
      "e2a18-student-simulator-contract-v2",
    evidence_classifier_v3:
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION ===
      "student-simulator-evidence-classifier-v3",
    classifier_source_present: classifierSha.length === 64,
    classifier_source_hash_matches: classifierSha ===
      "9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899",
    artifact_contract_frozen: E2A23_ARTIFACT_CONTRACT_HASH.length === 64,
    application_build_info_matches_checkpoint:
      applicationBuildInfo.ok &&
      applicationBuildInfo.info.application_git_commit === checkpointCommit,
    source_files_present: source.files.every((entry) => entry.exists),
    protected_evidence_present: Object.values(
      protectedSnapshot.historical_evidence
    ).every((entry) => entry.exists)
  };
  return {
    integrity_version: "e2a23-candidate-source-and-evidence-integrity-v1",
    dispatch_checkpoint_commit: checkpointCommit,
    application_build_info: applicationBuildInfo,
    candidate: {
      path: relative(E2A14_CANDIDATE_PATH),
      expected_configuration_hash: E2A17_CANDIDATE_HASH,
      actual_configuration_hash: evaluated.candidate_configuration_hash,
      expected_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
      actual_file_sha256: sha256(readFileSync(E2A14_CANDIDATE_PATH)),
      approval_state: evaluated.candidate.approval_state,
      activation_state: evaluated.candidate.activation_state,
      candidate_approved: evaluated.candidate_approved,
      candidate_activated: evaluated.candidate_activated
    },
    approved_v2: {
      path: relative(E2A4_BASELINE_MANIFEST_PATH),
      configuration_hash: E2A17_APPROVED_V2_HASH,
      file_sha256: sha256(readFileSync(E2A4_BASELINE_MANIFEST_PATH))
    },
    protocol: {
      expected_hash: E2A23_PROTOCOL_HASH,
      actual_hash: E2A23_FROZEN_PROTOCOL.protocol_hash,
      source: protocolSource
    },
    simulator_contract: {
      version: E2A18_SIMULATOR_CONTRACT_VERSION,
      classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      classifier_file_sha256: classifierSha
    },
    artifact_contract: {
      hash: E2A23_ARTIFACT_CONTRACT_HASH,
      contract: E2A23_ARTIFACT_CONTRACT
    },
    source_logic: source,
    protected_evidence: protectedSnapshot,
    protected_evidence_snapshot_hash: stableHash(protectedSnapshot),
    checks
  };
}

function assertSourceIntegrity(input: {
  checkpointCommit: string;
  expectedSourceAggregate: string;
  expectedProtectedSnapshotHash: string;
}) {
  if (currentCommit() !== input.checkpointCommit) {
    throw new Error("e2a23_source_integrity_checkpoint_mismatch");
  }
  if (!trackedTreeClean()) {
    throw new Error("e2a23_source_integrity_tracked_tree_dirty");
  }
  const integrity = candidateIntegrity(input.checkpointCommit);
  if (!Object.values(integrity.checks).every(Boolean)) {
    throw new Error("e2a23_candidate_protocol_or_source_integrity_mismatch");
  }
  if (integrity.source_logic.aggregate_sha256 !==
    input.expectedSourceAggregate) {
    throw new Error("e2a23_source_logic_hash_mismatch");
  }
  if (integrity.protected_evidence_snapshot_hash !==
    input.expectedProtectedSnapshotHash) {
    throw new Error("e2a23_protected_evidence_hash_mismatch");
  }
  return integrity;
}

async function databaseReady() {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

function latestLiveRunId() {
  if (!existsSync(E2A23_ARTIFACT_ROOT)) return null;
  return readdirSync(E2A23_ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a23_"))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .find((id) => {
      const manifestPath = path.join(
        E2A23_ARTIFACT_ROOT, id, "canary-manifest.json"
      );
      if (!existsSync(manifestPath)) return false;
      try {
        const manifest = readJson<{ execution_mode?: string }>(manifestPath);
        return manifest.execution_mode === "live_provider";
      } catch {
        return false;
      }
    }) ?? null;
}

export async function inspectE2A23Preflight(input: {
  requireLiveEnvironment: boolean;
  requireCleanTrackedTree: boolean;
  expectedCheckpointCommit?: string;
}) {
  const blockers: string[] = [];
  const protocol = validateE2A23Protocol();
  if (!protocol.passed) blockers.push("protocol_or_budget_validation_failed");
  const commit = currentCommit();
  let integrity: ReturnType<typeof candidateIntegrity> | null = null;
  try {
    integrity = candidateIntegrity(input.expectedCheckpointCommit ?? commit);
    if (!Object.values(integrity.checks).every(Boolean)) {
      blockers.push("candidate_protocol_or_source_integrity_failed");
    }
  } catch {
    blockers.push("candidate_protocol_or_source_integrity_failed");
  }
  if (input.expectedCheckpointCommit && commit !==
    input.expectedCheckpointCommit) {
    blockers.push("dispatch_checkpoint_commit_mismatch");
  }
  if (input.requireCleanTrackedTree && !trackedTreeClean()) {
    blockers.push("tracked_worktree_not_clean");
  }
  const dbReady = await databaseReady();
  if (!dbReady) blockers.push("postgresql_not_ready");
  const nextPids = pidsMatching("[n]ext (dev|start)");
  if (nextPids.length > 0) blockers.push("next_server_running");
  const duplicatePids = [...new Set([
    ...pidsMatching("[f]ormative-evaluation-e2a23-live"),
    ...pidsMatching("[f]ormative-evaluation-e2a23-run")
  ])];
  if (duplicatePids.length > 0) blockers.push("duplicate_e2a23_process");
  if (existsSync(LOCK_PATH)) blockers.push("e2a23_live_lock_present");
  let credentialPublic: ReturnType<
    typeof publicOpenAICredentialResolution
  > | null = null;
  if (input.requireLiveEnvironment) {
    if (process.env.RUN_LIVE_E2A23 !== "1") {
      blockers.push("live_e2a23_opt_in_missing");
    }
    if (process.env.LLM_PROVIDER !== "openai") {
      blockers.push("provider_not_openai");
    }
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
      blockers.push("live_calls_not_enabled");
    }
    if (process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== undefined &&
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH !==
      E2A17_APPROVED_V2_HASH) {
      blockers.push("approved_config_hash_mismatch");
    }
    const credential = resolveOpenAICredentialFromEnv();
    if (!credential.ok) blockers.push(credential.code);
    else credentialPublic = publicOpenAICredentialResolution(
      credential.credential
    );
    if (!isApprovedOpenAIBaseUrl(resolveOpenAIBaseUrl())) {
      blockers.push("provider_base_url_not_approved");
    }
    const prior = latestLiveRunId();
    if (prior) blockers.push(`prior_e2a23_live_run_exists:${prior}`);
  }
  const compileDir = path.join(
    os.tmpdir(), `e2a23-compile-${randomUUID()}`
  );
  mkdirSync(compileDir, { recursive: true });
  let compilation: Awaited<ReturnType<
    typeof compileE2A14CandidateRequestsNoNetwork
  >> | null = null;
  try {
    compilation = await compileE2A14CandidateRequestsNoNetwork(
      path.join(compileDir, "all-role-request-compilation.json")
    );
    if (!compilation.artifact.all_17_roles_compile ||
      compilation.artifact.network_request_count !== 0) {
      blockers.push("all_role_request_compilation_failed");
    }
  } finally {
    rmSync(compileDir, { recursive: true, force: true });
  }
  return {
    preflight_version: "e2a23-live-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    current_git_commit: commit,
    expected_checkpoint_commit: input.expectedCheckpointCommit ?? null,
    tracked_worktree_clean: trackedTreeClean(),
    protocol_validation: protocol,
    candidate_integrity: integrity,
    database_ready: dbReady,
    next_server_pids: nextPids,
    duplicate_e2a23_process_pids: duplicatePids,
    live_lock_present: existsSync(LOCK_PATH),
    provider_concurrency: 1,
    provider_host: input.requireLiveEnvironment
      ? openAIBaseUrlHost(resolveOpenAIBaseUrl())
      : "not_checked",
    credential: credentialPublic,
    provider_adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
    all_role_request_compilation: compilation?.artifact ?? null,
    budget: E2A23_BUDGET,
    approved_config_hash_assertion_configured:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== undefined,
    approved_config_hash_assertion_matches:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH === undefined ||
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH === E2A17_APPROVED_V2_HASH,
    existing_live_run_id: latestLiveRunId(),
    explicit_live_authorization_required: true,
    candidate_approved: false,
    candidate_activated: false,
    e2a17_rerun: false,
    e2a19_rerun: false,
    e2a21_rerun: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    network_request_count: 0
  };
}

function emptyBudgetLedger(): BudgetLedger {
  return {
    simulator_calls: 0,
    tutor_initial_calls: 0,
    tutor_regeneration_calls: 0,
    total_logical_generation_calls: 0,
    provider_adapter_attempts: 0,
    transport_retries: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    pricing_complete: true,
    total_latency_ms: 0,
    per_call: []
  };
}

function estimatedTokens(request: StructuredAgentRequest<unknown, unknown>) {
  return Math.max(1, Math.ceil(
    `${request.instructions}\n${JSON.stringify(request.input)}`.length / 3
  ));
}

function assertBudgetBeforeCall(input: {
  ledger: BudgetLedger;
  role: "simulator" | "tutor_initial" | "tutor_regeneration";
  estimated_input_tokens: number;
  maximum_output_tokens: number;
}) {
  const { ledger, role } = input;
  if (role === "simulator" && ledger.simulator_calls + 1 >
    E2A23_BUDGET.maximum_simulator_calls) {
    throw new Error("e2a23_simulator_call_budget_exceeded");
  }
  if (role === "tutor_initial" && ledger.tutor_initial_calls + 1 >
    E2A23_BUDGET.maximum_tutor_initial_generation_calls) {
    throw new Error("e2a23_tutor_initial_call_budget_exceeded");
  }
  if (role === "tutor_regeneration" &&
    ledger.tutor_regeneration_calls + 1 >
    E2A23_BUDGET.maximum_tutor_regeneration_calls) {
    throw new Error("e2a23_tutor_regeneration_call_budget_exceeded");
  }
  if (ledger.total_logical_generation_calls + 1 >
    E2A23_BUDGET.maximum_total_logical_generation_calls) {
    throw new Error("e2a23_total_logical_call_budget_exceeded");
  }
  if (ledger.provider_adapter_attempts + 3 >
    E2A23_BUDGET.maximum_provider_adapter_attempts) {
    throw new Error("e2a23_adapter_attempt_budget_insufficient");
  }
  if (ledger.input_tokens + input.estimated_input_tokens >
    E2A23_BUDGET.maximum_input_tokens) {
    throw new Error("e2a23_input_token_budget_insufficient");
  }
  if (ledger.output_tokens + input.maximum_output_tokens >
    E2A23_BUDGET.maximum_output_tokens) {
    throw new Error("e2a23_output_token_budget_insufficient");
  }
  if (ledger.input_tokens + ledger.output_tokens +
    input.estimated_input_tokens + input.maximum_output_tokens >
    E2A23_BUDGET.maximum_total_tokens) {
    throw new Error("e2a23_total_token_budget_insufficient");
  }
  if (ledger.pricing_complete && ledger.estimated_cost_usd >=
    E2A23_BUDGET.maximum_estimated_cost_usd_when_pricing_available) {
    throw new Error("e2a23_cost_budget_exceeded");
  }
}

function recordBudgetResult(input: {
  ledger: BudgetLedger;
  role: "simulator" | "tutor";
  call_kind: "simulator" | "tutor_initial" | "tutor_regeneration";
  result: StructuredAgentResult<unknown>;
  turn_number: number;
  attempt_index: number;
}) {
  const usage = e2aUsageFor(input.result);
  const adapterAttempts = e2aAdapterAttemptCount(input.result);
  if (input.call_kind === "simulator") input.ledger.simulator_calls += 1;
  if (input.call_kind === "tutor_initial") {
    input.ledger.tutor_initial_calls += 1;
  }
  if (input.call_kind === "tutor_regeneration") {
    input.ledger.tutor_regeneration_calls += 1;
  }
  input.ledger.total_logical_generation_calls += 1;
  input.ledger.provider_adapter_attempts += adapterAttempts;
  input.ledger.transport_retries += Math.max(adapterAttempts - 1, 0);
  input.ledger.input_tokens += usage.input_tokens;
  input.ledger.output_tokens += usage.output_tokens;
  input.ledger.reasoning_tokens += usage.reasoning_tokens;
  input.ledger.cached_input_tokens += usage.cached_input_tokens;
  input.ledger.total_tokens += usage.total_tokens;
  input.ledger.total_latency_ms += input.result.latency_ms;
  input.ledger.per_call.push({
    role: input.role,
    turn_number: input.turn_number,
    attempt_index: input.attempt_index,
    latency_ms: input.result.latency_ms,
    adapter_attempts: adapterAttempts,
    retries: Math.max(adapterAttempts - 1, 0)
  });
  if (usage.pricing_available && usage.estimated_cost_usd !== null) {
    input.ledger.estimated_cost_usd += usage.estimated_cost_usd;
  } else {
    input.ledger.pricing_complete = false;
  }
  assert(input.ledger.simulator_calls <=
    E2A23_BUDGET.maximum_simulator_calls,
  "e2a23_actual_simulator_call_budget_exceeded");
  assert(input.ledger.tutor_initial_calls <=
    E2A23_BUDGET.maximum_tutor_initial_generation_calls,
  "e2a23_actual_tutor_initial_call_budget_exceeded");
  assert(input.ledger.tutor_regeneration_calls <=
    E2A23_BUDGET.maximum_tutor_regeneration_calls,
  "e2a23_actual_tutor_regeneration_budget_exceeded");
  assert(input.ledger.total_logical_generation_calls <=
    E2A23_BUDGET.maximum_total_logical_generation_calls,
  "e2a23_actual_logical_call_budget_exceeded");
  assert(input.ledger.provider_adapter_attempts <=
    E2A23_BUDGET.maximum_provider_adapter_attempts,
  "e2a23_actual_adapter_attempt_budget_exceeded");
  assert(input.ledger.input_tokens <= E2A23_BUDGET.maximum_input_tokens,
    "e2a23_actual_input_token_budget_exceeded");
  assert(input.ledger.output_tokens <= E2A23_BUDGET.maximum_output_tokens,
    "e2a23_actual_output_token_budget_exceeded");
  assert(input.ledger.total_tokens <= E2A23_BUDGET.maximum_total_tokens,
    "e2a23_actual_provider_total_token_budget_exceeded");
  assert(input.ledger.input_tokens + input.ledger.output_tokens <=
    E2A23_BUDGET.maximum_total_tokens,
  "e2a23_actual_total_token_budget_exceeded");
  if (input.ledger.pricing_complete) {
    assert(input.ledger.estimated_cost_usd <=
      E2A23_BUDGET.maximum_estimated_cost_usd_when_pricing_available,
    "e2a23_actual_cost_budget_exceeded");
  }
}

function usageArtifact(ledger: BudgetLedger) {
  return {
    usage_version: "e2a23-provider-usage-v1",
    budget: E2A23_BUDGET,
    actual: {
      simulator_provider_calls: ledger.simulator_calls,
      initial_tutor_provider_calls: ledger.tutor_initial_calls,
      tutor_regeneration_provider_calls: ledger.tutor_regeneration_calls,
      total_logical_generation_calls: ledger.total_logical_generation_calls,
      provider_adapter_attempts: ledger.provider_adapter_attempts,
      transport_retries: ledger.transport_retries,
      input_tokens: ledger.input_tokens,
      output_tokens: ledger.output_tokens,
      reasoning_tokens: ledger.reasoning_tokens,
      cached_input_tokens: ledger.cached_input_tokens,
      total_tokens: ledger.total_tokens,
      latency_ms: ledger.total_latency_ms,
      estimated_cost_usd: ledger.pricing_complete
        ? Number(ledger.estimated_cost_usd.toFixed(6))
        : null,
      cost_status: ledger.pricing_complete
        ? "complete_pricing_available"
        : "pricing_unavailable_or_incomplete",
      pricing_complete: ledger.pricing_complete,
      per_call: ledger.per_call
    },
    within_budget: ledger.simulator_calls <=
      E2A23_BUDGET.maximum_simulator_calls &&
      ledger.tutor_initial_calls <=
      E2A23_BUDGET.maximum_tutor_initial_generation_calls &&
      ledger.tutor_regeneration_calls <=
      E2A23_BUDGET.maximum_tutor_regeneration_calls &&
      ledger.total_logical_generation_calls <=
      E2A23_BUDGET.maximum_total_logical_generation_calls &&
      ledger.provider_adapter_attempts <=
      E2A23_BUDGET.maximum_provider_adapter_attempts &&
      ledger.input_tokens <= E2A23_BUDGET.maximum_input_tokens &&
      ledger.output_tokens <= E2A23_BUDGET.maximum_output_tokens &&
      ledger.total_tokens <= E2A23_BUDGET.maximum_total_tokens &&
      ledger.input_tokens + ledger.output_tokens <=
      E2A23_BUDGET.maximum_total_tokens &&
      (!ledger.pricing_complete || ledger.estimated_cost_usd <=
        E2A23_BUDGET.maximum_estimated_cost_usd_when_pricing_available)
  };
}

function liveProviderBundle(provider: LlmProvider): E2AEvaluationProviderBundle {
  return {
    provider_kind: "openai",
    executeSimulator: (request) => provider.executeStructured(request),
    executeTutor: (request) => provider.executeStructured(request)
  };
}

function acquireLock() {
  mkdirSync(E2A23_ARTIFACT_ROOT, { recursive: true });
  if (existsSync(LOCK_PATH)) throw new Error("e2a23_live_lock_present");
  writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
}

function releaseLock() {
  if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
}

type EvidenceLevel = "none" | "minimal" | "partial" | "substantive";

const E2A23_NO_LIVE_MESSAGES = [
  "Option A still seems right because the hardest item should tell us the most about anyone.",
  "Okay, I understand it now.",
  "Option A seems too broad because difficulty alone does not make an item useful for every student.",
  "Extreme difficulty only places the item's most informative point at a very high theta; it does not make the item highly informative everywhere. Information is highest when theta is close to the item's difficulty and drops as they move farther apart, so Item 16 option A is false.",
  "It depends on how close the student's ability is to the item difficulty, but I am not sure how predictability fits yet.",
  "Option A is too broad because the item is useful near its difficulty and less useful far away, although I cannot explain the response mechanism yet."
] as const;

function buildE2A23SimulatorRequest(input: {
  runId: string;
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  simulatorInput: LlmStudentSimulatorInput;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
}) {
  return {
    agent_name: "evaluation_llm_student_simulator",
    model_config: {
      model_name: input.modelConfig.model_name,
      reasoning_effort: input.modelConfig.reasoning_effort,
      max_output_tokens:
        E2A23_BUDGET.per_request_token_caps.simulator_output_tokens
    },
    instructions: LLM_STUDENT_SIMULATOR_INSTRUCTIONS,
    input: input.simulatorInput,
    output_schema: LlmStudentSimulatorOutputSchema,
    schema_name: E2A_SIMULATOR_SCHEMA_VERSION,
    client_request_id:
      `${input.runId}_${input.session.session_id}_sim_${input.turn.turn_number}`,
    timeout_ms: input.timeoutMs,
    metadata: {
      evaluation: "e2a23_evidence_driven_single_session_micro_canary",
      role: "student_simulator",
      session_id: input.session.session_id,
      turn_number: String(input.turn.turn_number),
      protocol_hash_prefix: E2A23_PROTOCOL_HASH.slice(0, 12),
      classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION
    }
  } satisfies StructuredAgentRequest<
    LlmStudentSimulatorInput,
    LlmStudentSimulatorOutput
  >;
}

function hiddenStateForEvidence(level: EvidenceLevel) {
  if (level === "substantive") return "reasoning_is_revision_eligible";
  if (level === "partial") return "anchor_specific_evidence_is_partial";
  if (level === "minimal") return "anchor_specific_evidence_is_minimal";
  return "active_distractor_requires_evidence";
}

function dynamicTurn(input: {
  turnNumber: number;
  priorEvidence: EvidenceLevel;
  hiddenState: string;
  progressionState: string;
  strategies: string[];
}): E2A17TurnProtocol {
  const partial = input.priorEvidence === "partial";
  const initial = input.turnNumber === 1;
  const unsupported = input.turnNumber === 2 &&
    input.priorEvidence !== "substantive";
  const objective = initial
    ? "Express or clarify the active misconception without exceeding the current evidence ceiling."
    : partial
      ? "Refine the missing conceptual relationship without forcing revision readiness."
      : "Provide anchor-specific evidence or make the remaining misconception observable.";
  return {
    turn_number: input.turnNumber,
    path_stage: initial
      ? "initial_distractor_misconception"
      : partial
        ? "partial_evidence_refinement"
        : "anchor_specific_evidence_request",
    student_intent: initial
      ? "misconception_persistence"
      : unsupported
        ? "unsupported_understanding_claim"
        : partial
          ? "revision_evidence"
          : "partial_explanation",
    maximum_evidence_level: input.turnNumber <= 2
      ? "partial"
      : "substantive",
    current_response_objective: objective,
    hidden_state_before: input.hiddenState,
    hidden_state_after: input.hiddenState,
    must_preserve_misconception: initial,
    must_request_clarification: false,
    must_remain_off_topic: false,
    may_show_task_improvement: !initial,
    may_show_conceptual_improvement: !initial,
    must_avoid_claiming_resolution: initial,
    selected_mode: "remain_in_dialogue",
    selected_operation: partial
      ? "refine_partial_reasoning"
      : "elicit_anchor_evidence",
    routing_classification: partial
      ? "partial_but_incomplete_reasoning"
      : unsupported
        ? "unsupported_understanding_claim"
        : "continued_conceptual_confusion",
    strategies_already_attempted: [...input.strategies],
    strategies_marked_unsuccessful: [],
    progression_state_before: input.progressionState,
    progression_state_after: input.progressionState,
    no_live_fixture_message: E2A23_NO_LIVE_MESSAGES[input.turnNumber - 1]
  };
}

function routedTurn(input: {
  turn: E2A17TurnProtocol;
  profile: ReturnType<typeof createTopicDialogueTurnEvidenceProfile>;
  route: ReturnType<typeof selectEvidenceFirstTopicDialogueRoute>;
}): E2A17TurnProtocol {
  const requestRevision = input.route.selected_mode === "request_revision";
  const progressionState = requestRevision
    ? "revision_authorized"
    : input.turn.turn_number === E2A23_BUDGET.maximum_student_turns
      ? "bounded_stop"
      : input.profile.reasoning_quality === "partial"
        ? "partial_evidence"
        : "evidence_required";
  return {
    ...input.turn,
    hidden_state_after: hiddenStateForEvidence(requestRevision
      ? "substantive"
      : input.profile.reasoning_quality === "partial" ? "partial" : "minimal"),
    selected_mode: requestRevision ? "request_revision" : "remain_in_dialogue",
    selected_operation: requestRevision ? null : input.route.selected_operation,
    routing_classification: requestRevision ? null
      : input.route.selected_operation === "clarify_concept_with_new_strategy"
        ? "continued_conceptual_confusion"
        : input.route.selected_operation === "clarify_task"
          ? "task_language_confusion"
          : input.route.selected_operation === "protected_redirect"
            ? "protected_request"
            : input.route.selected_operation === "repair_recurrence"
              ? "recurrence_after_apparent_improvement"
              : input.route.selected_operation === "redirect_off_topic"
                ? "off_topic_response"
                : input.route.selected_operation === "refine_partial_reasoning"
                  ? "partial_but_incomplete_reasoning"
                  : "unsupported_understanding_claim",
    progression_state_after: progressionState
  };
}

function determineFailureStatus(errorCode: string) {
  if (/fallback|regeneration.*(?:limit|stability)|turn_limit|cleanup|missing.*tutor|duplicate.*tutor|transcript.*(?:order|integrity)/iu.test(errorCode)) {
    return "e2a23_micro_canary_failed_stability" as const;
  }
  if (/stale|profile.*(?:mismatch|freshness)|source_turn|source_sequence/iu.test(
    errorCode
  )) return "e2a23_micro_canary_failed_profile_freshness" as const;
  if (/unauthorized|progression|invalid.*transition/iu.test(errorCode)) {
    return "e2a23_micro_canary_failed_progression" as const;
  }
  if (/privacy|answer_key|hidden_state|provider_control|information_flow|source.*mismatch|candidate.*mismatch|classifier.*mismatch|protocol.*mismatch/iu.test(
    errorCode
  )) return "e2a23_micro_canary_failed_safety" as const;
  if (/provider|schema|budget|credential|network|timeout/iu.test(errorCode)) {
    return "e2a23_micro_canary_incomplete_infrastructure" as const;
  }
  return "e2a23_micro_canary_failed_progression" as const;
}

async function executeSession(input: {
  prisma: PrismaClient;
  provider: E2AEvaluationProviderBundle;
  fixture: E2AEvaluationFixture;
  session: E2A17SessionProtocol;
  runId: string;
  checkpointCommit: string;
  expectedSourceAggregate: string;
  expectedProtectedSnapshotHash: string;
  ledger: BudgetLedger;
  paths: RunPaths;
  reachedArtifacts: Set<E2A23ArtifactName>;
  reviewDrafts: JsonObject[];
  causalRows: JsonObject[];
  live: boolean;
}) {
  const completed: CompletedTurn[] = [];
  const previousStudentMessages: string[] = [];
  const candidate = evaluateE2A14Candidate();
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  const timeoutMs = candidate.full_candidate.runtime_policy.provider_timeout_ms;
  let totalRegenerations = 0;
  let softOnlyRegenerations = 0;
  let priorEvidence: EvidenceLevel = "none";
  let hiddenState = "initial_misconception";
  let progressionState = "active_distractor";
  let cumulativeProfile: TopicDialogueCumulativeEvidenceProfile | null = null;
  const strategies: string[] = [];
  let sessionOutcome: "passed_required_endpoint" |
    "completed_valid_bounded_stop" | null = null;
  for (let turnNumber = 1;
    turnNumber <= E2A23_BUDGET.maximum_student_turns;
    turnNumber += 1) {
    const plannedTurn = dynamicTurn({
      turnNumber,
      priorEvidence,
      hiddenState,
      progressionState,
      strategies
    });
    if (input.live) assertSourceIntegrity({
      checkpointCommit: input.checkpointCommit,
      expectedSourceAggregate: input.expectedSourceAggregate,
      expectedProtectedSnapshotHash: input.expectedProtectedSnapshotHash
    });
    const beforeStudentTranscript = await loadE2AEvaluationTranscript(
      input.prisma, input.fixture
    );
    const simulatorInput = buildE2ASimulatorInput({
      session: input.session,
      turn: plannedTurn,
      visibleTranscript: beforeStudentTranscript
    });
    const simulatorFlow = auditE2AInformationFlow({
      session: input.session,
      turn: plannedTurn,
      simulatorInput,
      tutorRequest: null
    });
    appendJsonl(input.paths.informationFlowAudit, {
      ...simulatorFlow,
      evaluation_phase: "e2a23",
      audit_stage: "before_simulator_dispatch"
    });
    input.reachedArtifacts.add("information-flow-audit.jsonl");
    assert(simulatorFlow.passed, "e2a23_simulator_information_flow_failed");
    const simulatorRequest = buildE2A23SimulatorRequest({
      runId: input.runId,
      session: input.session,
      turn: plannedTurn,
      simulatorInput,
      modelConfig,
      timeoutMs
    });
    assertBudgetBeforeCall({
      ledger: input.ledger,
      role: "simulator",
      estimated_input_tokens: estimatedTokens(simulatorRequest),
      maximum_output_tokens:
        E2A23_BUDGET.per_request_token_caps.simulator_output_tokens
    });
    const simulatorResult = await input.provider.executeSimulator(
      simulatorRequest, plannedTurn
    );
    recordBudgetResult({
      ledger: input.ledger,
      role: "simulator",
      call_kind: "simulator",
      result: simulatorResult,
      turn_number: plannedTurn.turn_number,
      attempt_index: 1
    });
    if (input.live) assertSourceIntegrity({
      checkpointCommit: input.checkpointCommit,
      expectedSourceAggregate: input.expectedSourceAggregate,
      expectedProtectedSnapshotHash: input.expectedProtectedSnapshotHash
    });
    appendJsonl(input.paths.studentProviderOutputs, {
      session_id: input.session.session_id,
      turn_number: plannedTurn.turn_number,
      ...sanitizedE2AProviderResult(simulatorResult),
      simulator_prompt_version: E2A18_SIMULATOR_PROMPT_VERSION,
      simulator_schema_version: E2A18_SIMULATOR_SCHEMA_VERSION,
      simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
      evidence_classifier_version:
        E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      simulator_regeneration_allowed: false
    });
    input.reachedArtifacts.add("student-provider-outputs.jsonl");
    assert(simulatorResult.status === "completed" &&
      Boolean(simulatorResult.parsed_output),
    "e2a23_simulator_provider_or_schema_failure");
    const simulatorValidation = validateLlmStudentSimulatorOutputV3({
      simulator_input: simulatorInput,
      output: simulatorResult.parsed_output!,
      conceptual_anchor: "theta_information",
      previous_student_messages: previousStudentMessages
    });
    const simulatorSafety = inspectE2AVisibleMessageSafety(
      simulatorValidation.output.student_message, input.session, plannedTurn
    );
    const observedState = hiddenStateForEvidence(
      simulatorValidation.evidence_adjudication.observed_level
    );
    const transitionDecision = adjudicateEvidenceDrivenTransition({
      turn_number: plannedTurn.turn_number,
      maximum_turns: E2A23_BUDGET.maximum_student_turns,
      evidence_ceiling: plannedTurn.maximum_evidence_level,
      desired_transition_level: "substantive",
      observed_evidence_level:
        simulatorValidation.evidence_adjudication.observed_level,
      current_hidden_state: observedState,
      desired_hidden_state: "reasoning_is_revision_eligible",
      exact_evidence_spans:
        simulatorValidation.evidence_adjudication.exact_evidence_spans,
      schema_valid: true,
      role_safe: simulatorSafety.passed,
      hard_constraint_satisfied: simulatorValidation.issues.every((issue) =>
        issue.rule_code === "evidence_level_exceeded"
      )
    });
    if (simulatorValidation.evidence_adjudication.above_ceiling) {
      assert(simulatorValidation.evidence_adjudication
        .above_ceiling_decision_grounded_by_exact_span &&
        simulatorValidation.evidence_adjudication.exact_evidence_spans.length > 0,
      "e2a23_above_ceiling_decision_missing_exact_span");
    }
    assert(simulatorSafety.passed,
      "e2a23_simulator_privacy_answer_key_or_hidden_state_safety_failure");
    assert(transitionDecision.contract_decision === "accepted",
      `e2a23_transition_contract_failure:` +
      `${transitionDecision.failure_rule_code ?? "unknown"}`);
    assert(simulatorValidation.valid,
      `e2a23_simulator_contract_failure:${simulatorValidation.issues.map(
        (issue) => issue.rule_code
      ).join(",")}`);
    const simulatorOutput = simulatorValidation.output;
    previousStudentMessages.push(simulatorOutput.student_message);
    const studentTurn = await persistE2AStudentTurn({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      turn: plannedTurn,
      message: simulatorOutput.student_message,
      evaluation_phase: "e2a23"
    });
    const studentPersistedAt = new Date().toISOString();
    const observation = evaluateThetaInformationTurn(
      simulatorOutput.student_message
    );
    const profile = createTopicDialogueTurnEvidenceProfile({
      source_student_turn_id: String(studentTurn.id),
      source_sequence_index: studentTurn.sequence_index,
      concept_id: "theta_information",
      distractor_anchor: "Item 16 option A",
      observation,
      evaluator_version: "e2a22-theta-information-replay-adjudicator-v1"
    });
    const priorCumulativeProfile = cumulativeProfile;
    cumulativeProfile = integrateTopicDialogueEvidenceProfile({
      prior: cumulativeProfile,
      current: profile
    });
    const platformRoute = selectEvidenceFirstTopicDialogueRoute({
      profile,
      cumulative: cumulativeProfile
    });
    const turn = routedTurn({
      turn: plannedTurn,
      profile,
      route: platformRoute
    });
    const latestTurn = await input.prisma.conversationTurn.findFirst({
      where: {
        assessment_session_db_id: input.fixture.assessment_session_db_id,
        actor_type: "student"
      },
      orderBy: [{ sequence_index: "desc" }],
      select: { id: true, sequence_index: true }
    });
    assert(latestTurn, "e2a23_latest_student_turn_missing");
    const freshness = assertEvidenceFirstProfileIsFresh({
      profile,
      route: platformRoute,
      cumulative: cumulativeProfile,
      latest_student_turn_id: String(latestTurn.id),
      latest_sequence_index: latestTurn.sequence_index
    });
    await input.prisma.conversationTurn.update({
      where: { id: studentTurn.id },
      data: {
        structured_payload: JSON.parse(JSON.stringify({
          ...(studentTurn.structured_payload as Record<string, unknown>),
          evidence_first_turn_profile: profile,
          evidence_first_cumulative_profile: cumulativeProfile,
          evidence_first_route: platformRoute,
          profile_freshness_attestation: freshness
        })) as Prisma.InputJsonValue
      }
    });
    appendJsonl(input.paths.intentClassifications, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      source_student_turn_id: String(studentTurn.id),
      source_sequence_index: studentTurn.sequence_index,
      interaction_intent: profile.interaction_intent,
      classifier: "platform_immediate_intent_classifier"
    });
    input.reachedArtifacts.add("intent-classifications.jsonl");
    appendJsonl(input.paths.conceptualEvidenceEvaluations, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      source_student_turn_id: String(studentTurn.id),
      source_sequence_index: studentTurn.sequence_index,
      strict_schema_valid: true,
      semantic_contract_valid: simulatorValidation.valid,
      semantic_issue_codes: simulatorValidation.issues.map((issue) =>
        issue.rule_code
      ),
      simulator_evidence_adjudication:
        simulatorValidation.evidence_adjudication,
      profile_observation: observation,
      response_objective: plannedTurn.current_response_objective,
      objective_fulfillment: transitionDecision.objective_fulfillment,
      audit_quality_finding: transitionDecision.audit_quality_finding,
      simulator_visible_safety: simulatorSafety,
      accepted: simulatorValidation.valid && simulatorSafety.passed
    });
    input.reachedArtifacts.add("conceptual-evidence-evaluations.jsonl");
    appendJsonl(input.paths.turnProfileSnapshots, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      immutable: true,
      profile
    });
    input.reachedArtifacts.add("turn-profile-snapshots.jsonl");
    appendJsonl(input.paths.cumulativeProfileUpdates, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      prior_profile_snapshot_id:
        priorCumulativeProfile?.latest_turn_profile_snapshot_id ?? null,
      cumulative_profile: cumulativeProfile
    });
    input.reachedArtifacts.add("cumulative-profile-updates.jsonl");
    appendJsonl(input.paths.studentTurnResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      persisted_sequence_index: studentTurn.sequence_index,
      rendered_intent: simulatorOutput.rendered_intent,
      provider_self_reported_level: simulatorOutput.expressed_evidence_level,
      platform_observed_level:
        simulatorValidation.evidence_adjudication.observed_level,
      exact_evidence_spans:
        simulatorValidation.evidence_adjudication.exact_evidence_spans,
      accepted: true
    });
    input.reachedArtifacts.add("student-turn-results.jsonl");
    const route = await persistE2ARouteDecision({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      turn,
      evaluation_phase: "e2a23"
    });
    appendJsonl(input.paths.routingDecisions, {
      ...route,
      platform_route: platformRoute,
      route_selected_after_profile_creation: true,
      provider_selected_route: false
    });
    input.reachedArtifacts.add("routing-decisions.jsonl");
    appendJsonl(input.paths.profileFreshnessResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      ...freshness,
      route_profile_snapshot_id: platformRoute.source_profile_snapshot_id,
      passed: true
    });
    input.reachedArtifacts.add("profile-freshness-results.jsonl");
    const testCase = buildE2ADynamicTutorCase({
      fixture: input.fixture,
      session: input.session,
      turn,
      priorTranscript: beforeStudentTranscript,
      latestStudentMessage: simulatorOutput.student_message
    });
    const baseTutorRequest = requestForCase(testCase);
    const progressionAuthorization =
      buildEvidenceFirstProgressionAuthorization(platformRoute);
    const requestConstructedAt = new Date().toISOString();
    const tutorRequest = baseTutorRequest;
    appendJsonl(input.paths.tutorRequestProvenance, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      source_student_turn_id: profile.source_student_turn_id,
      source_sequence_index: profile.source_sequence_index,
      profile_snapshot_id: profile.profile_snapshot_id,
      profile_evaluator_version: profile.evaluator_version,
      cumulative_profile_version: cumulativeProfile.cumulative_profile_version,
      selected_mode: platformRoute.selected_mode,
      selected_operation: platformRoute.selected_operation,
      progression_authorization: progressionAuthorization,
      remaining_conceptual_issue: platformRoute.remaining_issue,
      profile_freshness_result: freshness,
      request_constructed_at: requestConstructedAt,
      stale_profile_request_dispatched: false
    });
    input.reachedArtifacts.add("tutor-request-provenance.jsonl");
    const fullFlow = auditE2AInformationFlow({
      session: input.session,
      turn,
      simulatorInput,
      tutorRequest
    });
    appendJsonl(input.paths.informationFlowAudit, {
      ...fullFlow,
      evaluation_phase: "e2a23",
      audit_stage: "before_tutor_dispatch"
    });
    assert(fullFlow.passed, "e2a23_tutor_information_flow_failed");
    const beforePersistence = await countE2AEvaluationPersistence(
      input.prisma, input.fixture
    );
    const invocationKey =
      `e2a23:${input.runId}:${input.session.session_id}:turn:${turn.turn_number}`;
    const runtime = await executeE2A15BRuntime({
      prisma: input.prisma,
      assessment_session_db_id: input.fixture.assessment_session_db_id,
      concept_unit_session_db_id: input.fixture.concept_unit_session_db_id,
      session_public_id: input.fixture.session_public_id,
      invocation_key: invocationKey,
      candidate_hash: E2A17_CANDIDATE_HASH,
      protocol_hash: E2A23_PROTOCOL_HASH,
      model_config: modelConfig,
      validation_context: buildE2ATutorValidationContext(testCase),
      deterministic_fallback_output: fallbackForCase(testCase),
      invoke_provider: async ({ attempt_index, prior_validation }) => {
        if (input.live) assertSourceIntegrity({
          checkpointCommit: input.checkpointCommit,
          expectedSourceAggregate: input.expectedSourceAggregate,
          expectedProtectedSnapshotHash: input.expectedProtectedSnapshotHash
        });
        const request: StructuredAgentRequest<unknown, unknown> = {
          agent_name: "topic_dialogue_agent",
          model_config: modelConfig,
          instructions: attempt_index === 1 || !prior_validation
            ? tutorRequest.instructions
            : buildE2ATutorRepairInstructions({
                testCase,
                originalInstructions: tutorRequest.instructions,
                validation: prior_validation
              }),
          input: tutorRequest.provider_input,
          output_schema: tutorRequest.output_schema as z.ZodType<unknown>,
          schema_name: tutorRequest.schema_name,
          client_request_id:
            `${input.runId}_${input.session.session_id}_tutor_` +
            `${turn.turn_number}_${attempt_index}`,
          timeout_ms: timeoutMs,
          metadata: {
            evaluation: "e2a23_single_session_micro_canary",
            role: "topic_dialogue_agent",
            session_id: input.session.session_id,
            turn_number: String(turn.turn_number),
            attempt_index: String(attempt_index),
            candidate_hash_prefix: E2A17_CANDIDATE_HASH.slice(0, 12),
            protocol_hash_prefix: E2A23_PROTOCOL_HASH.slice(0, 12),
            orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
            source_student_turn_id: profile.source_student_turn_id,
            source_sequence_index: String(profile.source_sequence_index),
            profile_snapshot_id: profile.profile_snapshot_id,
            profile_evaluator_version: profile.evaluator_version,
            cumulative_profile_version:
              cumulativeProfile?.cumulative_profile_version ??
              "topic-dialogue-cumulative-evidence-profile-v1",
            selected_mode: platformRoute.selected_mode,
            selected_operation: platformRoute.selected_operation ?? "none"
          }
        };
        assertBudgetBeforeCall({
          ledger: input.ledger,
          role: attempt_index === 1
            ? "tutor_initial"
            : "tutor_regeneration",
          estimated_input_tokens: estimatedTokens(request),
          maximum_output_tokens: modelConfig.max_output_tokens ??
            E2A23_BUDGET.per_request_token_caps.tutor_output_tokens
        });
        const result = await input.provider.executeTutor(request, testCase);
        recordBudgetResult({
          ledger: input.ledger,
          role: "tutor",
          call_kind: attempt_index === 1
            ? "tutor_initial"
            : "tutor_regeneration",
          result,
          turn_number: turn.turn_number,
          attempt_index
        });
        if (input.live) assertSourceIntegrity({
          checkpointCommit: input.checkpointCommit,
          expectedSourceAggregate: input.expectedSourceAggregate,
          expectedProtectedSnapshotHash: input.expectedProtectedSnapshotHash
        });
        return result;
      }
    });
    for (const attempt of runtime.attempts) {
      input.reviewDrafts.push({
        review_item_id:
          `${input.session.session_id}:turn:${turn.turn_number}:attempt:` +
          attempt.attempt_index,
        session_id: input.session.session_id,
        session_public_id: input.fixture.session_public_id,
        student_turn_number: turn.turn_number,
        tutor_attempt_index: attempt.attempt_index,
        review_surface: attempt.runtime_validation.runtime_acceptance ===
          "hard_rejected"
          ? "rejected_tutor_attempt"
          : attempt.attempt_index > 1
            ? "regenerated_tutor_attempt"
            : "effective_tutor_response",
        latest_simulator_visible_message: simulatorOutput.student_message,
        source_student_turn_id: profile.source_student_turn_id,
        source_sequence_index: profile.source_sequence_index,
        profile_snapshot_id: profile.profile_snapshot_id,
        reasoning_quality: profile.reasoning_quality,
        anchor_application: profile.anchor_application,
        misconception_status: profile.misconception_status,
        essential_missing_links: profile.essential_missing_links,
        observable_evidence_spans: profile.observable_evidence_spans,
        revision_readiness: profile.revision_readiness,
        cumulative_profile_summary: {
          current_reasoning_quality: cumulativeProfile.current_reasoning_quality,
          current_misconception_status:
            cumulativeProfile.current_misconception_status,
          current_revision_readiness:
            cumulativeProfile.current_revision_readiness,
          latest_evidence_precedence:
            cumulativeProfile.latest_evidence_precedence
        },
        selected_mode: turn.selected_mode,
        selected_operation: turn.selected_operation,
        tutor_provider_output: attempt.parsed_output,
        effective_tutor_response: attempt.attempt_index ===
          runtime.attempts.length
          ? runtime.persisted_visible_message
          : null,
        runtime_acceptance:
          attempt.runtime_validation.runtime_acceptance,
        hard_rejection_reasons:
          attempt.runtime_validation.hard_rejection_reasons,
        soft_review_flags:
          attempt.runtime_validation.soft_review_flags,
      evidence_level_before: completed.at(-1)?.evidence.observed_level ??
          "none",
        evidence_level_after:
          simulatorValidation.evidence_adjudication.observed_level,
        exact_evidence_spans:
          simulatorValidation.evidence_adjudication.exact_evidence_spans,
        progression_state_before: turn.progression_state_before,
        progression_state_after: turn.progression_state_after,
        persistence_result: null,
        student_projection: null,
        audit_projection: null,
        transcript_result: null,
        privacy_result: null,
        context_result: null,
        profile_freshness_result: freshness,
        authorized_audit: {
          hidden_state_before: turn.hidden_state_before,
          hidden_state_after: turn.hidden_state_after,
          evidence_ceiling: plannedTurn.maximum_evidence_level,
          response_objective_fulfillment:
            transitionDecision.objective_fulfillment,
          excluded_from_student_projection: true
        },
        human_review: {
          decision: null,
          critical_failure: null,
          reviewer_notes: null,
          reviewer_identity: null,
          reviewed_at: null
        }
      });
    }
    totalRegenerations += runtime.regeneration_count;
    for (const attempt of runtime.attempts) {
      appendJsonl(input.paths.tutorProviderOutputs, {
        session_id: input.session.session_id,
        turn_number: turn.turn_number,
        selected_mode: turn.selected_mode,
        selected_operation: turn.selected_operation,
        ...attempt
      });
      input.reachedArtifacts.add("tutor-provider-outputs.jsonl");
      appendJsonl(input.paths.runtimeValidationResults, {
        session_id: input.session.session_id,
        turn_number: turn.turn_number,
        attempt_index: attempt.attempt_index,
        ...attempt.runtime_validation
      });
      input.reachedArtifacts.add("runtime-validation-results.jsonl");
      appendJsonl(input.paths.pedagogicalRubricResults, {
        session_id: input.session.session_id,
        turn_number: turn.turn_number,
        attempt_index: attempt.attempt_index,
        rubric_findings: attempt.pedagogical_rubric,
        changes_runtime_acceptance: false,
        triggers_regeneration: false
      });
      input.reachedArtifacts.add("pedagogical-rubric-results.jsonl");
    }
    assert(totalRegenerations <= E2A23_BUDGET.maximum_tutor_regeneration_calls,
      "e2a23_regeneration_stability_limit_exceeded");
    assert(runtime.regeneration_count <= 1,
      "e2a23_per_turn_regeneration_limit_exceeded");
    assert(!runtime.deterministic_fallback_used,
      "e2a23_first_deterministic_tutor_fallback");
    const initial = runtime.attempts[0];
    const softOnlyRegeneration = runtime.regeneration_count > 0 &&
      initial?.runtime_validation.runtime_acceptance !== "hard_rejected";
    if (softOnlyRegeneration) softOnlyRegenerations += 1;
    assert(!softOnlyRegeneration,
      "e2a23_soft_only_regeneration_detected");
    const safety = inspectE2AVisibleMessageSafety(
      runtime.persisted_visible_message, input.session, turn
    );
    appendJsonl(input.paths.privacyResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      ...safety
    });
    input.reachedArtifacts.add("privacy-results.jsonl");
    assert(safety.passed,
      "e2a23_critical_privacy_answer_key_or_hidden_state_leak");
    const afterPersistence = await countE2AEvaluationPersistence(
      input.prisma, input.fixture
    );
    const persistence = {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      before: beforePersistence,
      after: afterPersistence,
      delta: {
        agent_calls:
          afterPersistence.agent_calls - beforePersistence.agent_calls,
        effective_results:
          afterPersistence.effective_results - beforePersistence.effective_results,
        tutor_visible_turns:
          afterPersistence.tutor_visible_turns -
          beforePersistence.tutor_visible_turns,
        effective_response_events:
          afterPersistence.effective_response_events -
          beforePersistence.effective_response_events
      },
      invocation_effective_result_count: await input.prisma
        .operationalAgentEffectiveResult.count({
          where: { invocation_key: invocationKey }
        }),
      effective_result_public_id: runtime.persisted_effective_result_public_id,
      passed: afterPersistence.agent_calls - beforePersistence.agent_calls ===
        runtime.attempts.length &&
        afterPersistence.effective_results - beforePersistence.effective_results === 1 &&
        afterPersistence.tutor_visible_turns -
        beforePersistence.tutor_visible_turns === 1 &&
        afterPersistence.effective_response_events -
        beforePersistence.effective_response_events === 1
    };
    appendJsonl(input.paths.persistenceResults, persistence);
    input.reachedArtifacts.add("persistence-results.jsonl");
    assert(persistence.passed, "e2a23_turn_persistence_mismatch");
    appendJsonl(input.paths.studentProjectionResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      projection: runtime.student_projection,
      provider_output_displayed_only_after_effective_validation: true,
      internal_review_metadata_visible: false,
      passed: runtime.student_projection.visible_message ===
        runtime.persisted_visible_message
    });
    input.reachedArtifacts.add("student-projection-results.jsonl");
    appendJsonl(input.paths.auditProjectionResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      projection: runtime.audit_projection,
      hidden_simulator_state_included: false,
      review_provenance_retained: true,
      passed: true
    });
    input.reachedArtifacts.add("audit-projection-results.jsonl");
    const progression = await executeE2AProgression({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      turn,
      evaluation_phase: "e2a23"
    });
    appendJsonl(input.paths.progressionResults, progression);
    input.reachedArtifacts.add("progression-results.jsonl");
    const refreshed = await inspectE2ATranscript({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      completedTurnCount: turn.turn_number
    });
    appendJsonl(input.paths.transcriptRefreshResults, refreshed);
    input.reachedArtifacts.add("transcript-refresh-results.jsonl");
    assert(refreshed.passed, "e2a23_transcript_integrity_failure");
    const context = {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      prior_visible_turn_count: beforeStudentTranscript.length,
      serialized_visible_turn_count:
        testCase.dialogue_input.visible_dialogue_history.length,
      prior_transcript_hash: stableHash(beforeStudentTranscript.map((entry) => ({
        sequence_index: entry.sequence_index,
        actor_type: entry.actor_type,
        message_text: entry.message_text
      }))),
      serialized_history_hash: stableHash(
        testCase.dialogue_input.visible_dialogue_history.map((entry) => ({
          sequence_index: entry.sequence_index,
          actor_type: entry.actor_type,
          message_text: entry.message_text
        }))
      ),
      latest_student_message_separate: !testCase.dialogue_input
        .visible_dialogue_history.some((entry) =>
          entry.message_text === simulatorOutput.student_message
        ),
      current_turn_directive_authoritative: true,
      historical_recommendations_non_authoritative: true,
      tutor_received_simulator_hidden_state: false,
      tutor_received_future_simulator_response: false,
      passed: beforeStudentTranscript.length ===
        testCase.dialogue_input.visible_dialogue_history.length &&
        !testCase.dialogue_input.visible_dialogue_history.some((entry) =>
          entry.message_text === simulatorOutput.student_message
        )
    };
    appendJsonl(input.paths.contextCoverageResults, context);
    input.reachedArtifacts.add("context-coverage-results.jsonl");
    assert(context.passed, "e2a23_context_coverage_failure");
    input.causalRows.push({
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      source_sequence_index: profile.source_sequence_index,
      profile_snapshot_id: profile.profile_snapshot_id,
      order: [
        { ordinal: 1, event: "student_turn_persisted",
          at: studentPersistedAt },
        { ordinal: 2, event: "turn_profile_created",
          at: profile.created_at },
        { ordinal: 3, event: "platform_route_selected",
          selected_mode: platformRoute.selected_mode },
        { ordinal: 4, event: "tutor_request_constructed",
          at: requestConstructedAt },
        { ordinal: 5, event: "effective_tutor_response_persisted",
          at: new Date().toISOString() }
      ],
      route_and_request_profile_match:
        platformRoute.source_profile_snapshot_id === profile.profile_snapshot_id,
      profile_source_is_latest: freshness.passed,
      passed: freshness.passed
    });
    for (const draft of input.reviewDrafts.filter((entry) =>
      entry.session_id === input.session.session_id &&
      entry.student_turn_number === turn.turn_number
    )) {
      draft.persistence_result = persistence;
      draft.student_projection = runtime.student_projection;
      draft.audit_projection = runtime.audit_projection;
      draft.transcript_result = refreshed;
      draft.privacy_result = safety;
      draft.context_result = context;
    }
    completed.push({
      session: input.session,
      turn,
      fixture: input.fixture,
      simulator_message: simulatorOutput.student_message,
      evidence: simulatorValidation.evidence_adjudication,
      runtime,
      persistence,
      progression,
      privacy: safety,
      context,
      transcript: refreshed
    });
    priorEvidence = simulatorValidation.evidence_adjudication.observed_level;
    hiddenState = turn.hidden_state_after;
    progressionState = turn.progression_state_after;
    if (turn.selected_operation && !strategies.includes(
      turn.selected_operation
    )) strategies.push(turn.selected_operation);
    sessionOutcome = platformRoute.selected_mode === "request_revision"
      ? "passed_required_endpoint"
      : turn.turn_number === E2A23_BUDGET.maximum_student_turns
        ? "completed_valid_bounded_stop"
        : null;
    writeJson(input.paths.providerUsage, usageArtifact(input.ledger));
    if (sessionOutcome !== null) break;
  }
  return {
    completed,
    totalRegenerations,
    softOnlyRegenerations,
    sessionOutcome,
    finalHiddenState: hiddenState,
    finalProgressionState: progressionState
  };
}

function humanReviewPacket(input: {
  runId: string;
  reviewDrafts: JsonObject[];
}) {
  return {
    packet_version: "e2a23-all-effective-and-rejected-output-review-v1",
    run_id: input.runId,
    review_target: "all_effective_tutor_outputs_and_rejected_attempts",
    candidate_hash: E2A17_CANDIDATE_HASH,
    protocol_hash: E2A23_PROTOCOL_HASH,
    human_review_required: true,
    human_review_completed: false,
    review_item_count: input.reviewDrafts.length,
    rows: input.reviewDrafts
  };
}

function artifactHashes(runDir: string) {
  return listRunArtifactNames(runDir).map((name) => ({
    name,
    sha256: sha256(readFileSync(path.join(runDir, name)))
  }));
}

export async function executeE2A23Canary(input: {
  provider: E2AEvaluationProviderBundle;
  live: boolean;
  dispatchCheckpointCommit: string;
  expectedSourceAggregate: string;
  expectedProtectedSnapshotHash: string;
  artifactRoot?: string;
  runId?: string;
}) {
  const id = input.runId ?? runId();
  const root = input.artifactRoot ?? E2A23_ARTIFACT_ROOT;
  const runDir = path.join(root, id);
  const paths = initializeArtifacts(runDir);
  const startedAt = new Date();
  const ledger = emptyBudgetLedger();
  const reachedArtifacts = new Set<E2A23ArtifactName>();
  const reviewDrafts: JsonObject[] = [];
  const causalRows: JsonObject[] = [];
  const completedTurns: CompletedTurn[] = [];
  let activeFixture: E2AEvaluationFixture | null = null;
  let fixtureRecord: JsonObject = {
    fixture_version: "e2a23-isolated-synthetic-fixture-v1",
    synthetic_only: true,
    classroom_records_used: false,
    created: false,
    cleanup_status: "not_started"
  };
  let cleanupResult: JsonObject = {
    cleanup_version: "e2a23-fixture-cleanup-v1",
    attempted: false,
    passed: false,
    status: "not_started"
  };
  let totalRegenerations = 0;
  let softOnlyRegenerations = 0;
  let earlyAbortReason: string | null = null;
  let endpoint: string | null = null;
  let sessionOutcome:
    | "passed_required_endpoint"
    | "completed_valid_bounded_stop"
    | "failed_contract"
    | "failed_safety"
    | "failed_stability"
    | "incomplete_infrastructure" = "incomplete_infrastructure";
  let finalStatus:
    | "e2a23_micro_canary_pass_profile_first_revision"
    | "e2a23_micro_canary_complete_bounded_stop_pending_adjudication"
    | "e2a23_micro_canary_failed_profile_freshness"
    | "e2a23_micro_canary_failed_progression"
    | "e2a23_micro_canary_failed_safety"
    | "e2a23_micro_canary_failed_stability"
    | "e2a23_micro_canary_incomplete_infrastructure" =
      "e2a23_micro_canary_incomplete_infrastructure";
  const initialIntegrity = candidateIntegrity(input.dispatchCheckpointCommit);
  assert(initialIntegrity.source_logic.aggregate_sha256 ===
    input.expectedSourceAggregate,
  "e2a23_initial_source_aggregate_mismatch");
  assert(initialIntegrity.protected_evidence_snapshot_hash ===
    input.expectedProtectedSnapshotHash,
  "e2a23_initial_protected_evidence_hash_mismatch");
  const session = E2A23_SESSION as E2A17SessionProtocol;
  const manifest = {
    manifest_version: E2A23_RUNNER_VERSION,
    run_id: id,
    started_at: startedAt.toISOString(),
    execution_mode: input.live ? "live_provider" : "injected_no_live_mock",
    dispatch_checkpoint_commit: input.dispatchCheckpointCommit,
    candidate_hash: E2A17_CANDIDATE_HASH,
    candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    protocol_hash: E2A23_PROTOCOL_HASH,
    simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
    evidence_classifier_version:
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    classifier_file_sha256:
      initialIntegrity.simulator_contract.classifier_file_sha256,
    artifact_contract_hash: E2A23_ARTIFACT_CONTRACT_HASH,
    source_logic_aggregate_sha256:
      initialIntegrity.source_logic.aggregate_sha256,
    protected_evidence_snapshot_hash:
      initialIntegrity.protected_evidence_snapshot_hash,
    session_count: 1,
    provider_concurrency: 1,
    explicitly_authorized_live_stage: input.live,
    candidate_approved: false,
    candidate_activated: false,
    human_review_required: true,
    human_review_completed: false,
    e2a17_rerun: false,
    e2a19_rerun: false,
    e2a21_rerun: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    e2b_implemented_or_run: false,
    status: "running"
  };
  writeJson(paths.canaryManifest, manifest);
  const sourceByPath = Object.fromEntries(initialIntegrity.source_logic.files
    .map((entry) => [entry.path, entry.sha256]));
  const compositeIdentity = {
    identity_version: "e2a23-composite-runtime-identity-v1",
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    tutor_candidate_hash: E2A17_CANDIDATE_HASH,
    tutor_candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    classifier_file_sha256:
      initialIntegrity.simulator_contract.classifier_file_sha256,
    routing_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    routing_source_sha256: sourceByPath[
      "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts"
    ],
    activity_runtime_source_sha256: sourceByPath[
      "src/lib/services/student-assessment/activity-runtime-ui.ts"
    ],
    evidence_evaluator_source_sha256: sourceByPath[
      "src/lib/evaluation/formative/e2a22-evidence-first-profile-routing.ts"
    ],
    application_git_commit: input.dispatchCheckpointCommit,
    protocol_hash: E2A23_PROTOCOL_HASH,
    artifact_contract_hash: E2A23_ARTIFACT_CONTRACT_HASH,
    source_logic_aggregate_sha256:
      initialIntegrity.source_logic.aggregate_sha256,
    protected_evidence_snapshot_hash:
      initialIntegrity.protected_evidence_snapshot_hash
  };
  writeJson(paths.compositeRuntimeIdentity, {
    ...compositeIdentity,
    composite_identity_hash: stableHash(compositeIdentity),
    frozen_before_dispatch: true
  });
  writeJson(paths.frozenProtocol, E2A23_FROZEN_PROTOCOL);
  writeFileSync(paths.frozenProtocolSha256, `${E2A23_PROTOCOL_HASH}\n`, "utf8");
  writeJson(paths.candidateIntegrity, initialIntegrity);
  writeJson(paths.classifierIntegrity, {
    integrity_version: "e2a23-classifier-v3-integrity-v1",
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    expected_file_sha256:
      "9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899",
    actual_file_sha256:
      initialIntegrity.simulator_contract.classifier_file_sha256,
    immutable_during_dispatch: true,
    provider_self_reported_evidence_is_authoritative: false,
    matches: initialIntegrity.checks.classifier_source_hash_matches
  });
  writeJson(paths.routingIntegrity, {
    integrity_version: "e2a23-evidence-first-routing-integrity-v1",
    policy_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    protocol_hash: E2A23_PROTOCOL_HASH,
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    observed_evidence_controls_transition: true,
    desired_transition_may_force_progression: false,
    below_target_response_is_persisted: true,
    below_target_response_receives_tutor_reply: true,
    below_target_response_continues_while_budget_remains: true,
    sixth_turn_below_target_is_valid_bounded_stop: true,
    classifier_file_sha256:
      initialIntegrity.simulator_contract.classifier_file_sha256,
    routing_source_sha256: compositeIdentity.routing_source_sha256,
    activity_runtime_source_sha256:
      compositeIdentity.activity_runtime_source_sha256,
    evidence_evaluator_source_sha256:
      compositeIdentity.evidence_evaluator_source_sha256,
    latest_evidence_precedence: true,
    no_minimum_turn_requirement: true,
    platform_owns_route_selection: true
  });
  writeJson(paths.sessionFixture, fixtureRecord);
  writeJson(paths.fixtureCleanupResult, cleanupResult);
  writeJson(paths.providerUsage, usageArtifact(ledger));
  writeJson(paths.causalTimeline, {
    timeline_version: "e2a23-causal-timeline-v1", rows: causalRows
  });
  writeJson(paths.humanReviewPacket, humanReviewPacket({
    runId: id, reviewDrafts
  }));

  const prisma = new PrismaClient();
  try {
    if (input.live) assertSourceIntegrity({
      checkpointCommit: input.dispatchCheckpointCommit,
      expectedSourceAggregate: input.expectedSourceAggregate,
      expectedProtectedSnapshotHash: input.expectedProtectedSnapshotHash
    });
    activeFixture = await createE2AEvaluationFixture(
      prisma, id, session, "e2a23"
    );
    fixtureRecord = {
      fixture_version: "e2a23-isolated-synthetic-fixture-v1",
      fixture_id: activeFixture.fixture_id,
      session_protocol_id: session.session_id,
      session_public_id: activeFixture.session_public_id,
      assessment_public_id: activeFixture.assessment_public_id,
      synthetic_only: true,
      classroom_records_used: false,
      created: true,
      shared_with_other_sessions: false,
      cleanup_status: "pending"
    };
    writeJson(paths.sessionFixture, fixtureRecord);
    const sessionResult = await executeSession({
      prisma,
      provider: input.provider,
      fixture: activeFixture,
      session,
      runId: id,
      checkpointCommit: input.dispatchCheckpointCommit,
      expectedSourceAggregate: input.expectedSourceAggregate,
      expectedProtectedSnapshotHash: input.expectedProtectedSnapshotHash,
      ledger,
      paths,
      reachedArtifacts,
      reviewDrafts,
      causalRows,
      live: input.live
    });
    completedTurns.push(...sessionResult.completed);
    totalRegenerations = sessionResult.totalRegenerations;
    softOnlyRegenerations = sessionResult.softOnlyRegenerations;
    sessionOutcome = sessionResult.sessionOutcome ?? "failed_contract";
    endpoint = sessionResult.finalProgressionState;
    assert(
      sessionOutcome === "passed_required_endpoint" ||
      sessionOutcome === "completed_valid_bounded_stop",
      "e2a23_session_terminal_outcome_missing"
    );
    if (sessionOutcome === "passed_required_endpoint") {
      assert(endpoint === "revision_authorized",
        "e2a23_required_endpoint_mismatch");
    } else {
      assert(endpoint === "bounded_stop",
        "e2a23_bounded_stop_endpoint_mismatch");
    }
    const finalTranscript = await inspectE2ATranscript({
      prisma,
      fixture: activeFixture,
      session,
      completedTurnCount: completedTurns.length
    });
    assert(finalTranscript.passed,
      "e2a23_final_transcript_integrity_failure");
    assert(completedTurns.length <= E2A23_BUDGET.maximum_student_turns,
      "e2a23_session_turn_limit_exceeded");
    finalStatus = sessionOutcome === "passed_required_endpoint"
      ? "e2a23_micro_canary_pass_profile_first_revision"
      : "e2a23_micro_canary_complete_bounded_stop_pending_adjudication";
  } catch (error) {
    earlyAbortReason = error instanceof Error ? error.message :
      "e2a23_unknown_failure";
    finalStatus = determineFailureStatus(earlyAbortReason);
    sessionOutcome = finalStatus.replace("e2a23_micro_canary_", "") as
      typeof sessionOutcome;
  } finally {
    if (activeFixture) {
      try {
        const cleanup = await cleanupE2AEvaluationFixture(
          prisma, activeFixture
        );
        cleanupResult = {
          cleanup_version: "e2a23-fixture-cleanup-v1",
          attempted: true,
          ...cleanup,
          status: cleanup.passed ? "removed" : "failed"
        };
        fixtureRecord.cleanup_status = cleanup.passed
          ? earlyAbortReason ? "removed_after_abort" : "removed"
          : "failed";
        if (!cleanup.passed) {
          finalStatus = "e2a23_micro_canary_failed_stability";
          sessionOutcome = "failed_stability";
          earlyAbortReason ??= "e2a23_fixture_cleanup_failure";
        }
      } catch {
        cleanupResult = {
          cleanup_version: "e2a23-fixture-cleanup-v1",
          attempted: true,
          passed: false,
          status: "failed_after_abort",
          sanitized_failure_reason: "fixture_cleanup_failed_after_abort"
        };
        fixtureRecord.cleanup_status = "failed_after_abort";
        finalStatus = "e2a23_micro_canary_failed_stability";
        sessionOutcome = "failed_stability";
        earlyAbortReason ??= "e2a23_fixture_cleanup_failure";
      }
      activeFixture = null;
    }
    await prisma.$disconnect();
  }

  const usage = usageArtifact(ledger);
  writeJson(paths.sessionFixture, fixtureRecord);
  writeJson(paths.fixtureCleanupResult, cleanupResult);
  writeJson(paths.providerUsage, usage);
  writeJson(paths.causalTimeline, {
    timeline_version: "e2a23-causal-timeline-v1",
    rows: causalRows,
    passed: causalRows.length === completedTurns.length &&
      causalRows.every((row) => row.passed === true)
  });
  const packet = humanReviewPacket({ runId: id, reviewDrafts });
  writeJson(paths.humanReviewPacket, packet);
  const endIntegrity = candidateIntegrity(input.dispatchCheckpointCommit);
  const protectedEvidenceUnchanged =
    endIntegrity.protected_evidence_snapshot_hash ===
    input.expectedProtectedSnapshotHash;
  const sourceLogicUnchanged = endIntegrity.source_logic.aggregate_sha256 ===
    input.expectedSourceAggregate;
  writeJson(paths.candidateIntegrity, {
    ...endIntegrity,
    post_execution_verified_at: new Date().toISOString(),
    source_logic_unchanged_during_execution: sourceLogicUnchanged,
    protected_evidence_unchanged_during_execution:
      protectedEvidenceUnchanged,
    unchanged_during_execution:
      Object.values(endIntegrity.checks).every(Boolean) &&
      sourceLogicUnchanged && protectedEvidenceUnchanged
  });
  const evidenceRows = readJsonl<{
    simulator_evidence_adjudication?: EvidenceClassification;
    profile_observation?: {
      reasoning_quality?: string;
      anchor_application?: string;
      misconception_status?: string;
    };
    objective_fulfillment?: string;
    audit_quality_finding?: string | null;
    simulator_visible_safety?: {
      privacy?: { finding_count?: number };
      answer_key?: { finding_count?: number };
      simulator_hidden_state?: { finding_count?: number };
      provider_control?: { finding_count?: number };
    };
  }>(paths.conceptualEvidenceEvaluations);
  const profileRows = readJsonl<{
    turn_number?: number;
    profile?: ReturnType<typeof createTopicDialogueTurnEvidenceProfile>;
  }>(paths.turnProfileSnapshots);
  const cumulativeRows = readJsonl<{
    turn_number?: number;
    cumulative_profile?: TopicDialogueCumulativeEvidenceProfile;
  }>(paths.cumulativeProfileUpdates);
  const routeRows = readJsonl<{
    platform_route?: ReturnType<typeof selectEvidenceFirstTopicDialogueRoute>;
  }>(paths.routingDecisions);
  const freshnessRows = readJsonl<{ passed?: boolean }>(
    paths.profileFreshnessResults
  );
  const studentTurnRows = readJsonl(paths.studentTurnResults);
  const privacyRows = readJsonl<{
    privacy?: { finding_count?: number };
    answer_key?: { finding_count?: number };
    simulator_hidden_state?: { finding_count?: number };
    provider_control?: { finding_count?: number };
  }>(paths.privacyResults);
  const transcriptRows = readJsonl<{ passed?: boolean }>(
    paths.transcriptRefreshResults
  );
  const persistenceRows = readJsonl<{ passed?: boolean }>(
    paths.persistenceResults
  );
  const studentProjectionRows = readJsonl<{ passed?: boolean }>(
    paths.studentProjectionResults
  );
  const auditProjectionRows = readJsonl<{ passed?: boolean }>(
    paths.auditProjectionResults
  );
  const contextRows = readJsonl<{ passed?: boolean }>(
    paths.contextCoverageResults
  );
  const runtimeRows = readJsonl<{
    soft_review_flags?: unknown[];
    runtime_acceptance?: string;
  }>(paths.runtimeValidationResults);
  const operationCoverage = [...new Set(completedTurns.map((entry) =>
    entry.turn.selected_operation
  ).filter((value): value is NonNullable<typeof value> => value !== null))]
    .sort();
  const aboveCeiling = evidenceRows.filter((row) =>
    row.simulator_evidence_adjudication?.above_ceiling
  );
  const earliestSound = profileRows.find((row) =>
    row.profile?.reasoning_quality === "sound"
  );
  const earliestRevisionReady = profileRows.find((row) =>
    row.profile?.revision_readiness
  );
  const summary = {
    summary_version: "e2a23-single-session-micro-canary-summary-v1",
    status: finalStatus,
    run_id: id,
    run_directory: relative(runDir),
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    candidate_hash: E2A17_CANDIDATE_HASH,
    candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    dispatch_checkpoint_commit: input.dispatchCheckpointCommit,
    protocol_hash: E2A23_PROTOCOL_HASH,
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    classifier_file_sha256:
      endIntegrity.simulator_contract.classifier_file_sha256,
    artifact_contract_hash: E2A23_ARTIFACT_CONTRACT_HASH,
    session_started: fixtureRecord.created === true,
    session_count: 1,
    session_endpoint: endpoint,
    session_outcome: sessionOutcome,
    required_endpoint: E2A23_FROZEN_PROTOCOL.required_endpoint,
    valid_bounded_stopping_point:
      sessionOutcome === "completed_valid_bounded_stop",
    bounded_stop_reason: sessionOutcome === "completed_valid_bounded_stop"
      ? "maximum_student_turns_exhausted_without_substantive_revision_ready_evidence"
      : null,
    simulator_turns_attempted: ledger.simulator_calls,
    simulator_turns_accepted: evidenceRows.filter((row) =>
      row.simulator_evidence_adjudication?.accepted
    ).length,
    persisted_student_turns: studentTurnRows.length,
    effective_tutor_replies: persistenceRows.length,
    simulator_calls: ledger.simulator_calls,
    initial_tutor_calls: ledger.tutor_initial_calls,
    tutor_regenerations: ledger.tutor_regeneration_calls,
    total_logical_calls: ledger.total_logical_generation_calls,
    adapter_attempts: ledger.provider_adapter_attempts,
    evidence_level_classifications: evidenceRows.map((row, index) => ({
      turn_number: index + 1,
      authorized_ceiling:
        row.simulator_evidence_adjudication?.authorized_ceiling ?? null,
      observed_level:
        row.simulator_evidence_adjudication?.observed_level ?? null,
      accepted: row.simulator_evidence_adjudication?.accepted ?? false
    })),
    evidence_profiles_by_turn: profileRows.map((row) => ({
      turn_number: row.turn_number ?? null,
      profile_snapshot_id: row.profile?.profile_snapshot_id ?? null,
      source_sequence_index: row.profile?.source_sequence_index ?? null,
      interaction_intent: row.profile?.interaction_intent ?? null,
      reasoning_quality: row.profile?.reasoning_quality ?? null,
      anchor_application: row.profile?.anchor_application ?? null,
      misconception_status: row.profile?.misconception_status ?? null,
      revision_readiness: row.profile?.revision_readiness ?? false
    })),
    cumulative_profiles_by_turn: cumulativeRows.map((row) => ({
      turn_number: row.turn_number ?? null,
      current_reasoning_quality:
        row.cumulative_profile?.current_reasoning_quality ?? null,
      current_misconception_status:
        row.cumulative_profile?.current_misconception_status ?? null,
      current_revision_readiness:
        row.cumulative_profile?.current_revision_readiness ?? false,
      latest_evidence_precedence:
        row.cumulative_profile?.latest_evidence_precedence ?? false
    })),
    routes_by_turn: routeRows.map((row, index) => ({
      turn_number: index + 1,
      selected_mode: row.platform_route?.selected_mode ?? null,
      selected_operation: row.platform_route?.selected_operation ?? null,
      source_profile_snapshot_id:
        row.platform_route?.source_profile_snapshot_id ?? null
    })),
    profile_freshness_by_turn: freshnessRows.map((row, index) => ({
      turn_number: index + 1,
      passed: row.passed === true
    })),
    earliest_sound_turn: earliestSound?.turn_number ?? null,
    earliest_revision_ready_turn: earliestRevisionReady?.turn_number ?? null,
    revision_requested_immediately_after_sound:
      earliestSound?.turn_number !== undefined &&
      routeRows[(earliestSound.turn_number ?? 1) - 1]?.platform_route
        ?.selected_mode === "request_revision",
    unnecessary_refinement_after_sound_count: profileRows.filter((row) =>
      row.profile?.reasoning_quality === "sound" &&
      routeRows[(row.turn_number ?? 1) - 1]?.platform_route?.selected_mode ===
        "remain_in_dialogue"
    ).length,
    no_minimum_turn_invariant_passed: profileRows.every((row) =>
      !row.profile?.revision_readiness ||
      routeRows[(row.turn_number ?? 1) - 1]?.platform_route?.selected_mode ===
        "request_revision"
    ),
    stale_profile_finding_count: freshnessRows.filter((row) => !row.passed)
      .length,
    above_ceiling_rejection_count: aboveCeiling.length,
    above_ceiling_rejections: aboveCeiling.map((row) => ({
      observed_level:
        row.simulator_evidence_adjudication?.observed_level ?? null,
      authorized_ceiling:
        row.simulator_evidence_adjudication?.authorized_ceiling ?? null,
      exact_evidence_spans:
        row.simulator_evidence_adjudication?.exact_evidence_spans ?? []
    })),
    operation_coverage: operationCoverage,
    revision_authorized: endpoint === "revision_authorized",
    privacy_finding_count: privacyRows.reduce((sum, row) =>
      sum + (row.privacy?.finding_count ?? 0), 0) +
      evidenceRows.reduce((sum, row) => sum +
        (row.simulator_visible_safety?.privacy?.finding_count ?? 0), 0),
    answer_key_finding_count: privacyRows.reduce((sum, row) =>
      sum + (row.answer_key?.finding_count ?? 0), 0) +
      evidenceRows.reduce((sum, row) => sum +
        (row.simulator_visible_safety?.answer_key?.finding_count ?? 0), 0),
    hidden_state_finding_count: privacyRows.reduce((sum, row) =>
      sum + (row.simulator_hidden_state?.finding_count ?? 0), 0) +
      evidenceRows.reduce((sum, row) => sum +
        (row.simulator_visible_safety?.simulator_hidden_state?.finding_count ??
          0), 0),
    provider_control_finding_count: privacyRows.reduce((sum, row) =>
      sum + (row.provider_control?.finding_count ?? 0), 0) +
      evidenceRows.reduce((sum, row) => sum +
        (row.simulator_visible_safety?.provider_control?.finding_count ?? 0), 0),
    invalid_transition_count:
      /invalid.*transition|transition.*invalid/iu.test(earlyAbortReason ?? "")
        ? 1 : 0,
    unauthorized_progression_count:
      /unauthorized.*(?:revision|transfer|completion|progression)/iu.test(
        earlyAbortReason ?? ""
      ) ? 1 : 0,
    missing_tutor_reply_count: Math.max(
      studentTurnRows.length - persistenceRows.length, 0
    ),
    duplicate_tutor_reply_count: transcriptRows.some((row) => !row.passed)
      ? 1 : 0,
    persistence_passed: persistenceRows.length === completedTurns.length &&
      persistenceRows.every((row) => row.passed),
    student_projection_passed:
      studentProjectionRows.length === completedTurns.length &&
      studentProjectionRows.every((row) => row.passed),
    audit_projection_passed:
      auditProjectionRows.length === completedTurns.length &&
      auditProjectionRows.every((row) => row.passed),
    transcript_passed: transcriptRows.length === completedTurns.length &&
      transcriptRows.every((row) => row.passed),
    context_coverage_passed: contextRows.length === completedTurns.length &&
      contextRows.every((row) => row.passed),
    fixture_cleanup_passed: cleanupResult.passed === true,
    soft_review_flags: runtimeRows.flatMap((row) =>
      row.soft_review_flags ?? []
    ),
    soft_only_regeneration_count: softOnlyRegenerations +
      (/soft_only_regeneration/iu.test(earlyAbortReason ?? "") ? 1 : 0),
    deterministic_fallback_count: completedTurns.filter((entry) =>
      entry.runtime.deterministic_fallback_used
    ).length + (/deterministic_tutor_fallback/iu.test(
      earlyAbortReason ?? ""
    ) ? 1 : 0),
    provider_usage: usage.actual,
    usage_within_budget: usage.within_budget,
    early_abort: earlyAbortReason !== null,
    early_abort_reason: earlyAbortReason,
    reached_artifacts: [...reachedArtifacts].sort(),
    human_review_item_count: packet.review_item_count,
    human_review_required: true,
    human_review_completed: false,
    candidate_integrity_passed:
      Object.values(endIntegrity.checks).every(Boolean) &&
      sourceLogicUnchanged,
    approved_v2_integrity_passed:
      endIntegrity.checks.approved_v2_hash_matches,
    protected_evidence_unchanged: protectedEvidenceUnchanged,
    candidate_approved: false,
    candidate_activated: false,
    approval_evidence_created: false,
    activation_evidence_created: false,
    e2a17_rerun: false,
    e2a19_rerun: false,
    e2a21_rerun: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    e2b_implemented_or_run: false,
    remaining_blocker_before_four_session_canary:
      "complete explicit human review and adjudication of every E2A.23 review item"
  };
  writeJson(paths.canarySummary, summary);
  writeJson(paths.canaryManifest, {
    ...manifest,
    completed_at: summary.completed_at,
    status: finalStatus,
    early_abort: summary.early_abort,
    human_review_item_count: packet.review_item_count
  });
  const artifactValidation = validateE2A23Artifacts(runDir);
  if (!artifactValidation.passed && [
    "e2a23_micro_canary_pass_profile_first_revision",
    "e2a23_micro_canary_complete_bounded_stop_pending_adjudication"
  ].includes(finalStatus)) {
    throw new Error(
      `e2a23_artifact_validation_failed:` +
      artifactValidation.failures.join(",")
    );
  }
  return {
    runId: id,
    runDir,
    paths,
    summary,
    artifactValidation,
    artifactHashes: artifactHashes(runDir),
    totalRegenerations
  };
}

export function validateE2A23Artifacts(runDir: string) {
  const failures: string[] = [];
  const names = listRunArtifactNames(runDir);
  const expected = [...E2A23_AUTHORIZED_ARTIFACTS].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    failures.push("artifact_name_or_count_mismatch");
  }
  const summaryPath = path.join(runDir, "canary-summary.json");
  const summary = existsSync(summaryPath)
    ? readJson<{
        status?: string;
        session_outcome?: string;
        early_abort?: boolean;
        reached_artifacts?: string[];
        session_started?: boolean;
        session_endpoint?: string | null;
        persisted_student_turns?: number;
        effective_tutor_replies?: number;
        operation_coverage?: string[];
        privacy_finding_count?: number;
        answer_key_finding_count?: number;
        hidden_state_finding_count?: number;
        provider_control_finding_count?: number;
        invalid_transition_count?: number;
        unauthorized_progression_count?: number;
        stale_profile_finding_count?: number;
        revision_requested_immediately_after_sound?: boolean;
        unnecessary_refinement_after_sound_count?: number;
        no_minimum_turn_invariant_passed?: boolean;
        deterministic_fallback_count?: number;
        soft_only_regeneration_count?: number;
        tutor_regenerations?: number;
        usage_within_budget?: boolean;
        fixture_cleanup_passed?: boolean;
        candidate_approved?: boolean;
        candidate_activated?: boolean;
      }>(summaryPath)
    : null;
  const reached = new Set(summary?.reached_artifacts ?? []);
  const classifications: Array<{
    artifact: string;
    classification: string;
    stage: string;
    sha256: string | null;
  }> = [];
  for (const name of expected) {
    const filePath = path.join(runDir, name);
    const contract = E2A23_ARTIFACT_CONTRACT.artifacts.find((entry) =>
      entry.name === name
    );
    if (!existsSync(filePath)) {
      failures.push(`artifact_missing:${name}`);
      classifications.push({
        artifact: name,
        classification: "missing",
        stage: contract?.stage ?? "unknown",
        sha256: null
      });
      continue;
    }
    const empty = statSync(filePath).size === 0;
    if (empty) {
      const allowed = name.endsWith(".jsonl") && summary?.early_abort === true &&
        !reached.has(name);
      classifications.push({
        artifact: name,
        classification: allowed
          ? "expected_empty_due_to_early_abort"
          : "malformed",
        stage: contract?.stage ?? "unknown",
        sha256: sha256(readFileSync(filePath))
      });
      if (!allowed) failures.push(`artifact_unexpectedly_empty:${name}`);
      continue;
    }
    try {
      if (name.endsWith(".jsonl")) readJsonl(filePath);
      else if (name.endsWith(".json")) readJson(filePath);
      assertSafeArtifact(readFileSync(filePath, "utf8"));
      classifications.push({
        artifact: name,
        classification: "populated_and_valid",
        stage: contract?.stage ?? "unknown",
        sha256: sha256(readFileSync(filePath))
      });
    } catch {
      failures.push(`artifact_malformed_or_unsafe:${name}`);
      classifications.push({
        artifact: name,
        classification: "malformed",
        stage: contract?.stage ?? "unknown",
        sha256: sha256(readFileSync(filePath))
      });
    }
  }
  const protocolShaPath = path.join(runDir, "frozen-protocol.sha256");
  if (existsSync(protocolShaPath) &&
    readFileSync(protocolShaPath, "utf8").trim() !== E2A23_PROTOCOL_HASH) {
    failures.push("frozen_protocol_sha_mismatch");
  }
  const protocolPath = path.join(runDir, "frozen-protocol.json");
  if (existsSync(protocolPath) &&
    stableHash(readJson(protocolPath)) !== stableHash(E2A23_FROZEN_PROTOCOL)) {
    failures.push("frozen_protocol_content_mismatch");
  }
  if (summary) {
    const allowedStatuses = [
      "e2a23_micro_canary_pass_profile_first_revision",
      "e2a23_micro_canary_complete_bounded_stop_pending_adjudication",
      "e2a23_micro_canary_failed_profile_freshness",
      "e2a23_micro_canary_failed_progression",
      "e2a23_micro_canary_failed_safety",
      "e2a23_micro_canary_failed_stability",
      "e2a23_micro_canary_incomplete_infrastructure"
    ];
    if (!allowedStatuses.includes(String(summary.status))) {
      failures.push("invalid_final_status");
    }
    if (["approved", "approval_evidence_ready", "activated", "production_ready"]
      .includes(String(summary.status))) failures.push("prohibited_final_status");
    const safeCompletionStatuses = [
      "e2a23_micro_canary_pass_profile_first_revision",
      "e2a23_micro_canary_complete_bounded_stop_pending_adjudication"
    ];
    if (safeCompletionStatuses.includes(String(summary.status))) {
      if (summary.session_started !== true) failures.push("session_not_started");
      if (summary.persisted_student_turns !==
        summary.effective_tutor_replies) {
        failures.push("student_tutor_reply_count_mismatch");
      }
      if ((summary.privacy_finding_count ?? 0) !== 0 ||
        (summary.answer_key_finding_count ?? 0) !== 0 ||
        (summary.hidden_state_finding_count ?? 0) !== 0 ||
        (summary.provider_control_finding_count ?? 0) !== 0) {
        failures.push("critical_safety_finding_present");
      }
      if ((summary.invalid_transition_count ?? 0) !== 0 ||
        (summary.unauthorized_progression_count ?? 0) !== 0 ||
        (summary.stale_profile_finding_count ?? 0) !== 0) {
        failures.push("invalid_or_unauthorized_progression");
      }
      if ((summary.deterministic_fallback_count ?? 0) !== 0) {
        failures.push("deterministic_fallback_present");
      }
      if ((summary.soft_only_regeneration_count ?? 0) !== 0) {
        failures.push("soft_only_regeneration_present");
      }
      if ((summary.tutor_regenerations ?? 0) > 2) {
        failures.push("tutor_regeneration_limit_exceeded");
      }
      if (!summary.usage_within_budget) failures.push("usage_outside_budget");
      if (!summary.fixture_cleanup_passed) failures.push("fixture_cleanup_failed");
    }
    if (summary.status ===
      "e2a23_micro_canary_pass_profile_first_revision" &&
      (summary.session_outcome !== "passed_required_endpoint" ||
        summary.session_endpoint !== "revision_authorized")) {
      failures.push("required_endpoint_pass_mismatch");
    }
    if (summary.status === "e2a23_micro_canary_pass_profile_first_revision" &&
      (!summary.revision_requested_immediately_after_sound ||
        (summary.unnecessary_refinement_after_sound_count ?? 0) !== 0 ||
        !summary.no_minimum_turn_invariant_passed)) {
      failures.push("profile_first_revision_invariant_failed");
    }
    if (summary.status ===
      "e2a23_micro_canary_complete_bounded_stop_pending_adjudication" &&
      (summary.session_outcome !== "completed_valid_bounded_stop" ||
        summary.session_endpoint !== "bounded_stop")) {
      failures.push("bounded_stop_status_mismatch");
    }
    if (summary.candidate_approved !== false ||
      summary.candidate_activated !== false) {
      failures.push("candidate_approval_or_activation_state_changed");
    }
  }
  const usagePath = path.join(runDir, "provider-usage.json");
  if (existsSync(usagePath) && statSync(usagePath).size > 0) {
    const usage = readJson<{
      actual?: {
        simulator_provider_calls?: number;
        initial_tutor_provider_calls?: number;
        tutor_regeneration_provider_calls?: number;
        total_logical_generation_calls?: number;
        provider_adapter_attempts?: number;
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        estimated_cost_usd?: number | null;
      };
      within_budget?: boolean;
    }>(usagePath);
    const actual = usage.actual ?? {};
    if ((actual.simulator_provider_calls ?? 0) > 6 ||
      (actual.initial_tutor_provider_calls ?? 0) > 6 ||
      (actual.tutor_regeneration_provider_calls ?? 0) > 2 ||
      (actual.total_logical_generation_calls ?? 0) > 14 ||
      (actual.provider_adapter_attempts ?? 0) > 42 ||
      (actual.input_tokens ?? 0) > 400_000 ||
      (actual.output_tokens ?? 0) > 31_000 ||
      (actual.total_tokens ?? 0) > 431_000 ||
      (actual.estimated_cost_usd ?? 0) > 10 || usage.within_budget !== true) {
      failures.push("provider_usage_budget_violation");
    }
  }
  return {
    validation_version: "e2a23-abort-aware-artifact-validation-v1",
    run_directory: relative(runDir),
    expected_artifact_count: expected.length,
    actual_artifact_count: names.length,
    artifact_names: names,
    artifact_classifications: classifications,
    artifact_hashes: artifactHashes(runDir),
    failures,
    passed: failures.length === 0
  };
}

function noLiveSimulatorOutput(turn: E2A17TurnProtocol) {
  const message = turn.no_live_fixture_message;
  return LlmStudentSimulatorOutputSchema.parse({
    student_message: message,
    rendered_intent: renderedIntentForStudentIntent(turn.student_intent),
    expressed_evidence_level: turn.maximum_evidence_level,
    mentions_focus_option:
      /\bA\b/iu.test(message) || /option\s+A/iu.test(message),
    asks_for_clarification:
      /[?]|\b(?:what|why|how|clarif|explain|example)\b/iu.test(message),
    claims_understanding:
      /\b(?:i understand|i get it now|that makes sense now|fully understand)\b/iu
        .test(message),
    off_topic: turn.must_remain_off_topic,
    simulator_warnings: []
  });
}

const E2A23_BOUNDED_STOP_MESSAGES = [
  "I still think option A sounds right because the item is hard.",
  "I am not sure what part of the item I should compare.",
  "The item's difficulty probably matters, but I cannot explain how yet.",
  "Maybe an item works differently for different students, but I do not know why.",
  "I think option A may be too broad, though I cannot connect that to response uncertainty.",
  "I still cannot explain the mechanism well enough to revise my answer."
] as const;

export async function executeE2A23NoLiveBoundedStopSmoke(input: {
  artifactRoot?: string;
} = {}) {
  const root = input.artifactRoot ?? path.join(
    os.tmpdir(), `e2a23-bounded-${randomBytes(5).toString("hex")}`
  );
  const checkpoint = currentCommit();
  const integrity = candidateIntegrity(checkpoint);
  const base = E2A17_NO_LIVE_PROVIDER_FACTORY();
  const provider: E2AEvaluationProviderBundle = {
    ...base,
    async executeSimulator(request, turn) {
      const result = await base.executeSimulator(request, turn);
      const studentMessage = E2A23_BOUNDED_STOP_MESSAGES[
        turn.turn_number - 1
      ];
      return {
        ...result,
        parsed_output: LlmStudentSimulatorOutputSchema.parse({
          student_message: studentMessage,
          rendered_intent: renderedIntentForStudentIntent(turn.student_intent),
          expressed_evidence_level: turn.maximum_evidence_level,
          mentions_focus_option: /\bA\b|option\s+A/iu.test(studentMessage),
          asks_for_clarification: /\?|\b(?:what|why|how)\b/iu.test(
            studentMessage
          ),
          claims_understanding: false,
          off_topic: false,
          simulator_warnings: []
        })
      };
    }
  };
  const result = await executeE2A23Canary({
    provider,
    live: false,
    dispatchCheckpointCommit: checkpoint,
    expectedSourceAggregate: integrity.source_logic.aggregate_sha256,
    expectedProtectedSnapshotHash:
      integrity.protected_evidence_snapshot_hash,
    artifactRoot: root,
    runId: "e2a23_no_live_bounded_stop_smoke"
  });
  return { ...result, artifactRoot: root };
}

export function compileE2A23RequestsNoNetwork() {
  const session = E2A23_SESSION as E2A17SessionProtocol;
  const modelConfig = evaluateE2A14Candidate().full_candidate.roles
    .topic_dialogue_agent;
  const history: Array<{
    sequence_index: number;
    actor_type: "student" | "agent";
    agent_name: string | null;
    message_text: string;
    structured_payload: null;
  }> = [];
  let priorEvidence: EvidenceLevel = "none";
  let hiddenState = "initial_misconception";
  let progressionState = "active_distractor";
  let cumulativeProfile: TopicDialogueCumulativeEvidenceProfile | null = null;
  const strategies: string[] = [];
  const rows = Array.from({
    length: E2A23_BUDGET.maximum_student_turns
  }, (_, index) => {
    const turn = dynamicTurn({
      turnNumber: index + 1,
      priorEvidence,
      hiddenState,
      progressionState,
      strategies
    });
    const simulatorInput = buildE2ASimulatorInput({
      session,
      turn,
      visibleTranscript: history
    });
    const simulatorRequest = buildE2A23SimulatorRequest({
      runId: "e2a23_request_compilation",
      session,
      turn,
      simulatorInput,
      modelConfig,
      timeoutMs: 90_000
    });
    const fakeFixture = {
      fixture_id: "e2a23_compile_fixture",
      session_protocol_id: session.session_id,
      student_user_db_id: "omitted",
      teacher_user_db_id: "omitted",
      assessment_db_id: "omitted",
      assessment_public_id: "e2a23_compile_assessment",
      concept_unit_db_id: "omitted",
      assessment_session_db_id: "omitted",
      concept_unit_session_db_id: "omitted",
      session_public_id: "e2a23_compile_session"
    } satisfies E2AEvaluationFixture;
    const output = noLiveSimulatorOutput(turn);
    const validation = validateLlmStudentSimulatorOutputV3({
      simulator_input: simulatorInput,
      output,
      conceptual_anchor: "theta_information",
      previous_student_messages: []
    });
    const decision = adjudicateEvidenceDrivenTransition({
      turn_number: turn.turn_number,
      maximum_turns: E2A23_BUDGET.maximum_student_turns,
      evidence_ceiling: turn.maximum_evidence_level,
      desired_transition_level: "substantive",
      observed_evidence_level: validation.evidence_adjudication.observed_level,
      current_hidden_state: hiddenState,
      desired_hidden_state: "reasoning_is_revision_eligible",
      exact_evidence_spans: validation.evidence_adjudication.exact_evidence_spans,
      schema_valid: true,
      role_safe: true,
      hard_constraint_satisfied: validation.valid
    });
    const observation = evaluateThetaInformationTurn(
      turn.no_live_fixture_message
    );
    const profile = createTopicDialogueTurnEvidenceProfile({
      source_student_turn_id: `compile_student_turn_${turn.turn_number}`,
      source_sequence_index: history.length + 1,
      concept_id: "theta_information",
      distractor_anchor: "Item 16 option A",
      observation,
      evaluator_version: "e2a22-theta-information-replay-adjudicator-v1"
    });
    cumulativeProfile = integrateTopicDialogueEvidenceProfile({
      prior: cumulativeProfile,
      current: profile
    });
    const platformRoute = selectEvidenceFirstTopicDialogueRoute({
      profile,
      cumulative: cumulativeProfile
    });
    const routed = routedTurn({
      turn,
      profile,
      route: platformRoute
    });
    const testCase = buildE2ADynamicTutorCase({
      fixture: fakeFixture,
      session,
      turn: routed,
      priorTranscript: history,
      latestStudentMessage: turn.no_live_fixture_message
    });
    const baseTutorRequest = requestForCase(testCase);
    const tutorRequest = baseTutorRequest;
    priorEvidence = validation.evidence_adjudication.observed_level;
    hiddenState = routed.hidden_state_after;
    progressionState = routed.progression_state_after;
    if (routed.selected_operation && !strategies.includes(
      routed.selected_operation
    )) strategies.push(routed.selected_operation);
    history.push({
      sequence_index: history.length + 1,
      actor_type: "student",
      agent_name: null,
      message_text: turn.no_live_fixture_message,
      structured_payload: null
    }, {
      sequence_index: history.length + 2,
      actor_type: "agent",
      agent_name: "topic_dialogue_agent",
      message_text: "A validated tutor response occupies this visible turn.",
      structured_payload: null
    });
    return {
      turn_number: turn.turn_number,
      simulator_input_valid:
        LlmStudentSimulatorInputSchema.safeParse(simulatorRequest.input).success,
      simulator_output_valid:
        LlmStudentSimulatorOutputSchema.safeParse(output).success,
      simulator_contract_valid: validation.valid,
      observed_evidence_level:
        validation.evidence_adjudication.observed_level,
      desired_transition_level: "substantive",
      objective_fulfillment: decision.objective_fulfillment,
      contract_decision: decision.contract_decision,
      profile_snapshot_id: profile.profile_snapshot_id,
      reasoning_quality: profile.reasoning_quality,
      revision_readiness: profile.revision_readiness,
      selected_mode: platformRoute.selected_mode,
      selected_operation: platformRoute.selected_operation,
      tutor_schema_name: tutorRequest.schema_name,
      tutor_provider_input_present: Boolean(tutorRequest.provider_input),
      tutor_output_schema_present: Boolean(tutorRequest.output_schema),
      information_flow: auditE2AInformationFlow({
        session,
        turn: routed,
        simulatorInput,
        tutorRequest
      })
    };
  });
  return {
    compilation_version: "e2a23-frozen-session-request-compilation-v1",
    candidate_hash: E2A17_CANDIDATE_HASH,
    protocol_hash: E2A23_PROTOCOL_HASH,
    simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
    evidence_classifier_version:
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    request_pair_count: rows.length,
    network_request_count: 0,
    rows,
    passed: rows.length === E2A23_BUDGET.maximum_student_turns &&
      rows.every((row) =>
      row.simulator_input_valid && row.simulator_output_valid &&
      row.simulator_contract_valid && row.contract_decision === "accepted" &&
      row.tutor_provider_input_present && row.tutor_output_schema_present &&
      row.information_flow.passed
    )
  };
}

export async function executeE2A23NoLiveSmoke(input: {
  artifactRoot?: string;
} = {}) {
  const root = input.artifactRoot ?? path.join(
    os.tmpdir(), `e2a23-no-live-${randomBytes(5).toString("hex")}`
  );
  const checkpoint = currentCommit();
  const integrity = candidateIntegrity(checkpoint);
  const result = await executeE2A23Canary({
    provider: E2A17_NO_LIVE_PROVIDER_FACTORY(),
    live: false,
    dispatchCheckpointCommit: checkpoint,
    expectedSourceAggregate: integrity.source_logic.aggregate_sha256,
    expectedProtectedSnapshotHash:
      integrity.protected_evidence_snapshot_hash,
    artifactRoot: root,
    runId: "e2a23_no_live_smoke"
  });
  return { ...result, artifactRoot: root };
}

export async function executeE2A23NoLiveAbortSmoke(input: {
  artifactRoot?: string;
} = {}) {
  const root = input.artifactRoot ?? path.join(
    os.tmpdir(), `e2a23-abort-${randomBytes(5).toString("hex")}`
  );
  const checkpoint = currentCommit();
  const integrity = candidateIntegrity(checkpoint);
  const base = E2A17_NO_LIVE_PROVIDER_FACTORY();
  let simulatorCallCount = 0;
  const provider: E2AEvaluationProviderBundle = {
    ...base,
    async executeSimulator(request, turn) {
      simulatorCallCount += 1;
      const result = await base.executeSimulator(request, turn);
      return simulatorCallCount === 1
        ? { ...result, parsed_output: undefined }
        : result;
    }
  };
  const result = await executeE2A23Canary({
    provider,
    live: false,
    dispatchCheckpointCommit: checkpoint,
    expectedSourceAggregate: integrity.source_logic.aggregate_sha256,
    expectedProtectedSnapshotHash:
      integrity.protected_evidence_snapshot_hash,
    artifactRoot: root,
    runId: "e2a23_no_live_abort_smoke"
  });
  return { ...result, artifactRoot: root };
}

export async function executeLiveE2A23Canary(input: {
  checkpointCommit: string;
}) {
  const preflight = await inspectE2A23Preflight({
    requireLiveEnvironment: true,
    requireCleanTrackedTree: true,
    expectedCheckpointCommit: input.checkpointCommit
  });
  if (!preflight.passed || !preflight.candidate_integrity) {
    throw new Error(`e2a23_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const frozenIntegrity = preflight.candidate_integrity;
  const credential = resolveOpenAICredentialFromEnv();
  if (!credential.ok) {
    throw new Error(`e2a23_credential_failed:${credential.code}`);
  }
  acquireLock();
  try {
    return await withResolvedOpenAICredential(
      credential.credential,
      async () => {
        const candidate = evaluateE2A14Candidate();
        const provider = new OpenAIResponsesProvider({
          isolated_evaluation_runtime: {
            purpose: "bounded_candidate_evaluation",
            request_timeout_ms:
              candidate.full_candidate.runtime_policy.provider_timeout_ms
          }
        });
        return executeE2A23Canary({
          provider: liveProviderBundle(provider),
          live: true,
          dispatchCheckpointCommit: input.checkpointCommit,
          expectedSourceAggregate:
            frozenIntegrity.source_logic.aggregate_sha256,
          expectedProtectedSnapshotHash:
            frozenIntegrity.protected_evidence_snapshot_hash
        });
      }
    );
  } finally {
    releaseLock();
  }
}

export function temporaryE2A23ArtifactRoot() {
  return path.join(os.tmpdir(), `e2a23-${randomBytes(5).toString("hex")}`);
}

export function removeTemporaryE2A23ArtifactRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}

export function loadE2A23Run(runIdValue: string) {
  const runDir = path.join(E2A23_ARTIFACT_ROOT, runIdValue);
  if (!existsSync(runDir)) throw new Error("e2a23_run_not_found");
  return {
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "canary-summary.json")),
    usage: readJson<JsonObject>(path.join(runDir, "provider-usage.json")),
    reviewPacket: readJson<JsonObject>(path.join(
      runDir, "human-review-packet.json"
    )),
    artifactValidation: validateE2A23Artifacts(runDir)
  };
}
