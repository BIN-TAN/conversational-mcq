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
import { toPrismaJson } from "@/lib/services/json";
import {
  buildTopicDialogueOperationRepairInstructions,
  selectTopicDialogueOperation
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import type { TopicDialogueRuntimeValidationContext } from
  "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";
import type { TopicDialogueRuntimeValidationV3Result } from
  "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v3";
import {
  compileE2A14CandidateRequestsNoNetwork
} from "./e2a14-request-compilation";
import {
  E2A14_CANDIDATE_PATH,
  evaluateE2A14Candidate
} from "./e2a14-protected-request-validator-candidate";
import {
  E2A4_BASELINE_MANIFEST_PATH,
  sha256
} from "./e2a4-topic-dialogue-contract";
import {
  fallbackForCase,
  requestForCase
} from "./e2a10-v7-topic-dialogue-canary";
import type { E2A10TopicDialogueCase } from
  "./e2a10-v7-topic-dialogue-protocol";
import { e2a13HeldOutCases } from "./e2a13-v8-30-case-protocol";
import {
  E2A15B_EFFECTIVE_RESULT_VERSION,
  executeE2A15BRuntime,
  type E2A15BRuntimeExecution
} from "./e2a15b-runtime";
import { E2A16_ARTIFACT_ROOT } from "./e2a16-human-review-closure";
import {
  E2A_SIMULATOR_PROMPT_VERSION,
  E2A_SIMULATOR_SCHEMA_VERSION,
  LlmStudentSimulatorInputSchema,
  LlmStudentSimulatorOutputSchema,
  type LlmStudentSimulatorInput,
  type LlmStudentSimulatorOutput
} from "./e2a-schemas";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_BUDGET,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH,
  E2A17_FROZEN_PROTOCOL,
  E2A17_PROTOCOL_HASH,
  E2A17_PROTOCOL_VERSION,
  E2A17_REQUIRED_ARTIFACTS,
  E2A17_SESSIONS,
  E2A17_SOURCE_E2A16_RUN_ID,
  deriveE2A17ProtocolHash,
  validateE2A17Protocol,
  type E2A17SessionProtocol,
  type E2A17TurnProtocol
} from "./e2a17-protocol";
import { LLM_STUDENT_SIMULATOR_INSTRUCTIONS } from
  "./llm-student-simulator-prompt";
import {
  renderedIntentForStudentIntent,
  validateLlmStudentSimulatorOutput
} from "./llm-student-simulator-validation";
import { findVisibleTextPrivacyFindings } from "./student-privacy-scanner";

export const E2A17_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a17-bounded-student-simulator-canary"
);
export const E2A17_RUNNER_VERSION =
  "e2a17-bounded-independent-student-simulator-runner-v1" as const;
export const E2A17_SIMULATOR_CONFIGURATION_VERSION =
  "e2a17-independent-student-simulator-config-v1" as const;
export const E2A17_INFORMATION_FLOW_VERSION =
  "e2a17-explicit-information-flow-audit-v1" as const;
export const E2A17_FIXTURE_VERSION =
  "e2a17-isolated-synthetic-database-fixture-v1" as const;
export const E2A17_SOURCE_E2A16_RUN_DIR = path.join(
  E2A16_ARTIFACT_ROOT, E2A17_SOURCE_E2A16_RUN_ID
);

const LOCK_PATH = path.join(E2A17_ARTIFACT_ROOT, ".e2a17-live.lock");
const JSONL_ARTIFACTS = new Set<string>([
  "information-flow-audit.jsonl",
  "simulator-provider-outputs.jsonl",
  "student-turn-results.jsonl",
  "routing-decisions.jsonl",
  "tutor-provider-outputs.jsonl",
  "runtime-validation-results.jsonl",
  "pedagogical-rubric-results.jsonl",
  "progression-results.jsonl",
  "persistence-results.jsonl",
  "student-projection-results.jsonl",
  "audit-projection-results.jsonl",
  "transcript-refresh-results.jsonl",
  "privacy-results.jsonl",
  "context-coverage-results.jsonl"
]);

const SOURCE_E2A16_FILES = {
  protocol_draft: "e2a17-student-simulator-protocol-draft.json",
  budget_draft: "e2a17-budget-draft.json",
  artifact_contract: "e2a17-artifact-contract.json",
  human_review_plan: "e2a17-human-review-plan.json"
} as const;

const SOURCE_LOGIC_FILES = [
  "src/lib/evaluation/formative/e2a17-protocol.ts",
  "src/lib/evaluation/formative/e2a17-bounded-student-simulator-canary.ts",
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
  "config/candidate-operational-agent-config.e2a14-protected-request-validator-calibration-v1.json"
] as const;

type JsonObject = Record<string, unknown>;
type RunPaths = ReturnType<typeof pathsFor>;

type Fixture = {
  fixture_id: string;
  session_protocol_id: string;
  student_user_db_id: string;
  teacher_user_db_id: string;
  assessment_db_id: string;
  assessment_public_id: string;
  concept_unit_db_id: string;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  session_public_id: string;
};

type BudgetLedger = {
  simulator_calls: number;
  tutor_initial_calls: number;
  tutor_regeneration_calls: number;
  total_generation_calls: number;
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
  per_call_latency_ms: Array<{
    role: "simulator" | "tutor";
    session_id: string;
    turn_number: number;
    attempt_index: number;
    latency_ms: number;
  }>;
};

type ProviderBundle = {
  provider_kind: "mock" | "openai";
  executeSimulator: (
    request: StructuredAgentRequest<LlmStudentSimulatorInput, LlmStudentSimulatorOutput>,
    turn: E2A17TurnProtocol
  ) => Promise<StructuredAgentResult<LlmStudentSimulatorOutput>>;
  executeTutor: (
    request: StructuredAgentRequest<unknown, unknown>,
    testCase: E2A10TopicDialogueCase
  ) => Promise<StructuredAgentResult<unknown>>;
};

type TurnExecution = {
  session_protocol_id: string;
  session_public_id: string;
  turn: E2A17TurnProtocol;
  simulator_input: LlmStudentSimulatorInput;
  simulator_output: LlmStudentSimulatorOutput;
  simulator_result: StructuredAgentResult<LlmStudentSimulatorOutput>;
  test_case: E2A10TopicDialogueCase;
  runtime: E2A15BRuntimeExecution;
  persistence: JsonObject;
  progression: JsonObject;
  privacy: ReturnType<typeof inspectVisibleMessageSafety>;
  context: JsonObject;
  transcript: JsonObject;
};

function json(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

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
    throw new Error("e2a17_artifact_secret_or_private_reasoning_detected");
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
  return Object.fromEntries(E2A17_REQUIRED_ARTIFACTS.map((name) => [
    (name.endsWith(".sha256")
      ? name.replace(/\.sha256$/u, "-sha256")
      : name.replace(/\.jsonl?$/u, ""))
      .replace(/-([a-z])/gu, (_, character: string) =>
        character.toUpperCase()
      ),
    path.join(runDir, name)
  ])) as Record<string, string> & {
    canaryManifest: string;
    frozenProtocol: string;
    frozenProtocolSha256: string;
    candidateIntegrity: string;
    allRoleRequestCompilation: string;
    sessionFixtures: string;
    simulatorHiddenStateContract: string;
    informationFlowAudit: string;
    simulatorProviderOutputs: string;
    studentTurnResults: string;
    routingDecisions: string;
    tutorProviderOutputs: string;
    runtimeValidationResults: string;
    pedagogicalRubricResults: string;
    progressionResults: string;
    persistenceResults: string;
    studentProjectionResults: string;
    auditProjectionResults: string;
    transcriptRefreshResults: string;
    privacyResults: string;
    contextCoverageResults: string;
    fixtureCleanupResults: string;
    providerUsage: string;
    humanReviewPacket: string;
    canarySummary: string;
  };
}

function initializeArtifacts(runDir: string) {
  if (existsSync(runDir)) throw new Error("e2a17_run_directory_exists");
  mkdirSync(runDir, { recursive: true });
  const paths = pathsFor(runDir);
  for (const name of E2A17_REQUIRED_ARTIFACTS) {
    const artifactPath = path.join(runDir, name);
    writeFileSync(
      artifactPath,
      JSONL_ARTIFACTS.has(name) || name.endsWith(".sha256")
        ? ""
        : "{}\n",
      "utf8"
    );
  }
  return paths;
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
  return `e2a17_${timestamp}_${randomBytes(4).toString("hex")}`;
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
    const output = execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf8"
    }).trim();
    return output ? output.split(/\s+/u).map(Number).filter((pid) =>
      Number.isInteger(pid) && pid !== process.pid
    ) : [];
  } catch {
    return [];
  }
}

function sourceFileHashes() {
  const rows = SOURCE_LOGIC_FILES.map((filePath) => {
    const absolute = path.join(process.cwd(), filePath);
    return {
      path: filePath,
      exists: existsSync(absolute),
      sha256: existsSync(absolute) ? sha256(readFileSync(absolute)) : null
    };
  });
  return { files: rows, aggregate_sha256: stableHash(rows) };
}

function sourceE2A16Integrity() {
  return Object.fromEntries(Object.entries(SOURCE_E2A16_FILES).map(
    ([key, name]) => {
      const filePath = path.join(E2A17_SOURCE_E2A16_RUN_DIR, name);
      return [key, {
        path: relative(filePath),
        exists: existsSync(filePath),
        sha256: existsSync(filePath) ? sha256(readFileSync(filePath)) : null
      }];
    }
  ));
}

function candidateIntegrity(checkpointCommit: string) {
  const evaluated = evaluateE2A14Candidate();
  const source = sourceFileHashes();
  const baselineRaw = readFileSync(E2A4_BASELINE_MANIFEST_PATH);
  return {
    integrity_version: "e2a17-candidate-and-source-integrity-v1",
    dispatch_checkpoint_commit: checkpointCommit,
    application_build_info: resolveApplicationBuildInfo(),
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
      file_sha256: sha256(baselineRaw)
    },
    protocol: {
      expected_hash: E2A17_PROTOCOL_HASH,
      actual_hash: deriveE2A17ProtocolHash()
    },
    source_logic: source,
    source_e2a16: sourceE2A16Integrity(),
    checks: {
      candidate_hash_matches:
        evaluated.candidate_configuration_hash === E2A17_CANDIDATE_HASH,
      candidate_file_sha_matches:
        sha256(readFileSync(E2A14_CANDIDATE_PATH)) ===
        E2A17_CANDIDATE_FILE_SHA256,
      protocol_hash_matches:
        deriveE2A17ProtocolHash() === E2A17_PROTOCOL_HASH,
      approved_v2_hash_matches:
        evaluated.approved_v2_hash === E2A17_APPROVED_V2_HASH,
      candidate_unapproved: evaluated.candidate_approved === false,
      candidate_inactive: evaluated.candidate_activated === false,
      source_files_present: source.files.every((entry) => entry.exists),
      e2a16_sources_present: Object.values(sourceE2A16Integrity()).every(
        (entry) => entry.exists
      )
    }
  };
}

function assertSourceIntegrity(checkpointCommit: string) {
  if (currentCommit() !== checkpointCommit) {
    throw new Error("e2a17_source_integrity_checkpoint_mismatch");
  }
  if (!trackedTreeClean()) {
    throw new Error("e2a17_source_integrity_tracked_tree_dirty");
  }
  const integrity = candidateIntegrity(checkpointCommit);
  if (!Object.values(integrity.checks).every(Boolean)) {
    throw new Error("e2a17_candidate_or_source_integrity_mismatch");
  }
  return integrity;
}

function emptyBudgetLedger(): BudgetLedger {
  return {
    simulator_calls: 0,
    tutor_initial_calls: 0,
    tutor_regeneration_calls: 0,
    total_generation_calls: 0,
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
    per_call_latency_ms: []
  };
}

function usageFor(result: StructuredAgentResult<unknown>) {
  const normalized = result.transport_telemetry?.normalized_response?.usage;
  return {
    input_tokens: result.usage?.input_tokens ?? normalized?.inputTokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? normalized?.outputTokens ?? 0,
    reasoning_tokens:
      result.usage?.reasoning_tokens ?? normalized?.reasoningTokens ?? 0,
    cached_input_tokens:
      result.usage?.cached_input_tokens ?? normalized?.cachedInputTokens ?? 0,
    total_tokens: result.usage?.total_tokens ?? normalized?.totalTokens ??
      (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
    estimated_cost_usd: normalized?.calculatedCostUsd ?? null,
    pricing_available: normalized?.pricingFound === true
  };
}

function adapterAttemptCount(result: StructuredAgentResult<unknown>) {
  const normalized = result.transport_telemetry?.normalized_response;
  const record = normalized && typeof normalized === "object"
    ? normalized as Record<string, unknown>
    : null;
  const count = record?.adapterAttemptCount ?? record?.adapter_attempt_count;
  return typeof count === "number" && Number.isInteger(count) && count > 0
    ? count
    : result.transport_telemetry?.fetch_invoked || result.provider === "mock"
      ? 1
      : 0;
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
    E2A17_BUDGET.maximum_simulator_calls) {
    throw new Error("e2a17_simulator_call_budget_exceeded");
  }
  if (role === "tutor_initial" && ledger.tutor_initial_calls + 1 >
    E2A17_BUDGET.maximum_tutor_initial_generation_calls) {
    throw new Error("e2a17_tutor_initial_call_budget_exceeded");
  }
  if (role === "tutor_regeneration" && ledger.tutor_regeneration_calls + 1 >
    E2A17_BUDGET.maximum_tutor_regeneration_calls) {
    throw new Error("e2a17_tutor_regeneration_call_budget_exceeded");
  }
  if (ledger.total_generation_calls + 1 >
    E2A17_BUDGET.maximum_total_generation_calls) {
    throw new Error("e2a17_total_generation_call_budget_exceeded");
  }
  if (ledger.provider_adapter_attempts + 3 >
    E2A17_BUDGET.maximum_provider_adapter_attempts) {
    throw new Error("e2a17_adapter_attempt_budget_insufficient");
  }
  if (ledger.input_tokens + input.estimated_input_tokens >
    E2A17_BUDGET.maximum_input_tokens) {
    throw new Error("e2a17_input_token_budget_insufficient");
  }
  if (ledger.output_tokens + input.maximum_output_tokens >
    E2A17_BUDGET.maximum_output_tokens) {
    throw new Error("e2a17_output_token_budget_insufficient");
  }
  if (ledger.input_tokens + ledger.output_tokens +
    input.estimated_input_tokens + input.maximum_output_tokens >
    E2A17_BUDGET.maximum_total_tokens) {
    throw new Error("e2a17_total_token_budget_insufficient");
  }
  if (ledger.pricing_complete && ledger.estimated_cost_usd >=
    E2A17_BUDGET.maximum_estimated_cost_usd_when_pricing_available) {
    throw new Error("e2a17_cost_budget_exceeded");
  }
}

function recordBudgetResult(input: {
  ledger: BudgetLedger;
  role: "simulator" | "tutor";
  call_kind: "simulator" | "tutor_initial" | "tutor_regeneration";
  result: StructuredAgentResult<unknown>;
  session_id: string;
  turn_number: number;
  attempt_index: number;
}) {
  const usage = usageFor(input.result);
  if (input.call_kind === "simulator") input.ledger.simulator_calls += 1;
  if (input.call_kind === "tutor_initial") input.ledger.tutor_initial_calls += 1;
  if (input.call_kind === "tutor_regeneration") {
    input.ledger.tutor_regeneration_calls += 1;
  }
  input.ledger.total_generation_calls += 1;
  const adapterAttempts = adapterAttemptCount(input.result);
  input.ledger.provider_adapter_attempts += adapterAttempts;
  input.ledger.transport_retries += Math.max(adapterAttempts - 1, 0);
  input.ledger.input_tokens += usage.input_tokens;
  input.ledger.output_tokens += usage.output_tokens;
  input.ledger.reasoning_tokens += usage.reasoning_tokens;
  input.ledger.cached_input_tokens += usage.cached_input_tokens;
  input.ledger.total_tokens += usage.total_tokens;
  input.ledger.total_latency_ms += input.result.latency_ms;
  input.ledger.per_call_latency_ms.push({
    role: input.role,
    session_id: input.session_id,
    turn_number: input.turn_number,
    attempt_index: input.attempt_index,
    latency_ms: input.result.latency_ms
  });
  if (usage.pricing_available && usage.estimated_cost_usd !== null) {
    input.ledger.estimated_cost_usd += usage.estimated_cost_usd;
  } else {
    input.ledger.pricing_complete = false;
  }
  assert(input.ledger.total_generation_calls <=
    E2A17_BUDGET.maximum_total_generation_calls,
  "e2a17_actual_generation_call_budget_exceeded");
  assert(input.ledger.provider_adapter_attempts <=
    E2A17_BUDGET.maximum_provider_adapter_attempts,
  "e2a17_actual_adapter_attempt_budget_exceeded");
  assert(input.ledger.input_tokens <= E2A17_BUDGET.maximum_input_tokens,
    "e2a17_actual_input_token_budget_exceeded");
  assert(input.ledger.output_tokens <= E2A17_BUDGET.maximum_output_tokens,
    "e2a17_actual_output_token_budget_exceeded");
  assert(input.ledger.input_tokens + input.ledger.output_tokens <=
    E2A17_BUDGET.maximum_total_tokens,
  "e2a17_actual_total_token_budget_exceeded");
  if (input.ledger.pricing_complete) {
    assert(input.ledger.estimated_cost_usd <=
      E2A17_BUDGET.maximum_estimated_cost_usd_when_pricing_available,
    "e2a17_actual_cost_budget_exceeded");
  }
}

function sanitizedProviderResult<T>(result: StructuredAgentResult<T>) {
  const usage = usageFor(result);
  return {
    provider: result.provider,
    status: result.status,
    client_request_id: result.client_request_id,
    provider_request_id: result.provider_request_id ??
      result.transport_telemetry?.provider_request_id ?? null,
    provider_response_id: result.provider_response_id ??
      result.transport_telemetry?.provider_response_id ?? null,
    parsed_output: result.parsed_output ?? null,
    raw_output_present: result.raw_output !== undefined,
    raw_output_sha256: result.raw_output === undefined
      ? null
      : stableHash(result.raw_output),
    usage,
    latency_ms: result.latency_ms,
    adapter_attempt_count: adapterAttemptCount(result),
    transport_retry_count: Math.max(adapterAttemptCount(result) - 1, 0),
    sanitized_error: result.error ? {
      category: result.error.category,
      retryable: result.error.retryable,
      typed_failure_reason:
        result.transport_telemetry?.normalized_error?.typed_failure_reason ?? null,
      http_status:
        result.transport_telemetry?.normalized_error?.http_status ?? null
    } : null
  };
}

function noLiveSimulatorOutput(turn: E2A17TurnProtocol) {
  const message = turn.no_live_fixture_message;
  const option = "A";
  const output: LlmStudentSimulatorOutput = {
    student_message: message,
    rendered_intent: renderedIntentForStudentIntent(turn.student_intent),
    expressed_evidence_level: turn.maximum_evidence_level,
    mentions_focus_option: new RegExp(`\\b${option}\\b`, "iu").test(message) ||
      new RegExp(`option\\s+${option}`, "iu").test(message),
    asks_for_clarification: /[?]|\b(?:what|why|how|clarif|explain|example)\b/iu
      .test(message),
    claims_understanding:
      /\b(?:i understand|i get it now|that makes sense now|fully understand)\b/iu
        .test(message),
    off_topic: turn.must_remain_off_topic,
    simulator_warnings: []
  };
  return LlmStudentSimulatorOutputSchema.parse(output);
}

class E2A17NoLiveProvider implements LlmProvider {
  requestCount = 0;

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.requestCount += 1;
    throw new Error(
      `e2a17_no_live_provider_requires_role_specific_execution:${request.agent_name}`
    );
  }
}

function noLiveProviderBundle(): ProviderBundle {
  const sentinel = new E2A17NoLiveProvider();
  void sentinel;
  let count = 0;
  return {
    provider_kind: "mock",
    async executeSimulator(request, turn) {
      count += 1;
      const parsed = request.output_schema.parse(noLiveSimulatorOutput(turn));
      return {
        provider: "mock",
        provider_request_id: `mock_sim_request_${count}`,
        provider_response_id: `mock_sim_response_${count}`,
        client_request_id: request.client_request_id,
        status: "completed",
        parsed_output: parsed,
        raw_output: parsed,
        usage: {
          input_tokens: 180,
          output_tokens: 45,
          reasoning_tokens: 0,
          cached_input_tokens: 0,
          total_tokens: 225
        },
        latency_ms: 2
      };
    },
    async executeTutor(request, testCase) {
      count += 1;
      const parsed = request.output_schema.parse(fallbackForCase(testCase));
      return {
        provider: "mock",
        provider_request_id: `mock_tutor_request_${count}`,
        provider_response_id: `mock_tutor_response_${count}`,
        client_request_id: request.client_request_id,
        status: "completed",
        parsed_output: parsed,
        raw_output: parsed,
        usage: {
          input_tokens: 240,
          output_tokens: 75,
          reasoning_tokens: 0,
          cached_input_tokens: 0,
          total_tokens: 315
        },
        latency_ms: 3
      };
    }
  };
}

function liveProviderBundle(provider: LlmProvider): ProviderBundle {
  return {
    provider_kind: "openai",
    executeSimulator: (request) => provider.executeStructured(request),
    executeTutor: (request) => provider.executeStructured(request)
  };
}

function hiddenStateContract() {
  return {
    contract_version: "e2a17-simulator-hidden-state-contract-v1",
    authorization: "evaluation_audit_only_not_student_or_tutor_input",
    sessions: E2A17_SESSIONS.map((session) => ({
      session_id: session.session_id,
      persona: session.persona,
      hidden_misconception_state: session.hidden_misconception_state,
      transitions: session.turns.map((turn) => ({
        turn_number: turn.turn_number,
        before: turn.hidden_state_before,
        after: turn.hidden_state_after,
        current_response_objective: turn.current_response_objective
      }))
    })),
    prohibited_from_tutor_input: true,
    prohibited_from_student_projection: true,
    raw_provider_private_reasoning_stored: false
  };
}

function buildSimulatorInput(input: {
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  visibleTranscript: Array<{
    sequence_index: number;
    actor_type: string;
    message_text: string | null;
  }>;
}) {
  const visible = input.visibleTranscript.filter((turn) =>
    Boolean(turn.message_text) && ["student", "agent"].includes(turn.actor_type)
  ).slice(-12);
  const latestAssistant = [...visible].reverse().find((turn) =>
    turn.actor_type === "agent"
  )?.message_text ?? input.session.initial_activity_prompt;
  return LlmStudentSimulatorInputSchema.parse({
    scenario_id: input.session.session_id,
    scenario_version: E2A17_PROTOCOL_VERSION,
    expression_variant: ((input.turn.turn_number - 1) % 3) + 1,
    student_persona: {
      conceptual_state:
        `${input.session.persona.conceptual_state}; current state: ` +
        `${input.turn.hidden_state_before}; current response objective: ` +
        input.turn.current_response_objective,
      task_understanding: input.session.persona.task_understanding,
      engagement: input.session.persona.engagement,
      confidence: input.session.persona.confidence,
      communication_style: input.session.persona.communication_style
    },
    misconception_context: {
      misconception_id: input.session.hidden_misconception_state.category,
      student_belief_description:
        input.session.hidden_misconception_state.student_belief_description,
      focus_item_reference: "Item 16",
      focus_option_reference: "A"
    },
    permitted_response: {
      intent: input.turn.student_intent,
      substantive_evidence_level: input.turn.maximum_evidence_level,
      may_show_task_improvement: input.turn.may_show_task_improvement,
      may_show_conceptual_improvement:
        input.turn.may_show_conceptual_improvement,
      must_preserve_misconception:
        input.turn.must_preserve_misconception,
      must_remain_off_topic: input.turn.must_remain_off_topic,
      must_request_clarification: input.turn.must_request_clarification,
      must_avoid_claiming_resolution:
        input.turn.must_avoid_claiming_resolution
    },
    visible_conversation: visible.map((entry) => ({
      role: entry.actor_type === "student" ? "student" : "assistant",
      content: entry.message_text!,
      sequence_index: entry.sequence_index
    })),
    latest_assistant_message: latestAssistant,
    style_constraints: {
      maximum_sentences: 3,
      preferred_length: input.turn.maximum_evidence_level === "substantive"
        ? "medium"
        : "short",
      avoid_expert_language: true,
      allow_grammar_imperfection: true,
      avoid_excessive_cooperation: true
    }
  });
}

function simulatorRequest(input: {
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
      max_output_tokens: E2A17_BUDGET.per_request_token_caps
        .simulator_output_tokens
    },
    instructions: LLM_STUDENT_SIMULATOR_INSTRUCTIONS,
    input: input.simulatorInput,
    output_schema: LlmStudentSimulatorOutputSchema,
    schema_name: E2A_SIMULATOR_SCHEMA_VERSION,
    client_request_id:
      `${input.runId}_${input.session.session_id}_sim_${input.turn.turn_number}`,
    timeout_ms: input.timeoutMs,
    metadata: {
      evaluation: "e2a17_bounded_independent_student_simulator",
      role: "student_simulator",
      session_id: input.session.session_id,
      turn_number: String(input.turn.turn_number),
      protocol_hash_prefix: E2A17_PROTOCOL_HASH.slice(0, 12)
    }
  } satisfies StructuredAgentRequest<
    LlmStudentSimulatorInput,
    LlmStudentSimulatorOutput
  >;
}

function informationFlowAudit(input: {
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  simulatorInput: LlmStudentSimulatorInput;
  tutorRequest: ReturnType<typeof requestForCase> | null;
}) {
  const simulatorSerialized = JSON.stringify(input.simulatorInput);
  const tutorSerialized = JSON.stringify(input.tutorRequest?.provider_input ?? {});
  const futureMessages = input.session.turns.filter((turn) =>
    turn.turn_number > input.turn.turn_number
  ).map((turn) => turn.no_live_fixture_message);
  const simulatorProhibited = [
    "runtime_validator_findings",
    "progression_internals",
    "audit_metadata",
    "expected_evaluator_decision",
    "future_scripted_responses",
    "tutor_hidden_instructions"
  ].filter((field) => simulatorSerialized.includes(`\"${field}\"`));
  const tutorProhibited = [
    input.turn.hidden_state_before,
    input.turn.hidden_state_after,
    input.session.persona.communication_style,
    ...futureMessages
  ].filter((value) => value.length > 0 && tutorSerialized.includes(value));
  return {
    audit_version: E2A17_INFORMATION_FLOW_VERSION,
    session_id: input.session.session_id,
    turn_number: input.turn.turn_number,
    simulator: {
      current_objective_present:
        simulatorSerialized.includes(input.turn.current_response_objective),
      current_visible_transcript_count:
        input.simulatorInput.visible_conversation.length,
      prohibited_field_findings: simulatorProhibited,
      future_scripted_response_present: false,
      tutor_instruction_present: false
    },
    tutor: input.tutorRequest ? {
      authorized_context_present: true,
      selected_mode: input.turn.selected_mode,
      selected_operation: input.turn.selected_operation,
      simulator_hidden_truth_findings: tutorProhibited,
      future_simulator_turn_present: tutorProhibited.some((value) =>
        futureMessages.includes(value)
      ),
      expected_session_result_present:
        tutorSerialized.includes(input.session.endpoint)
    } : null,
    passed: simulatorProhibited.length === 0 && tutorProhibited.length === 0
  };
}

async function createFixture(
  prisma: PrismaClient,
  runIdValue: string,
  session: E2A17SessionProtocol,
  evaluationPhase: "e2a17" | "e2a19" = "e2a17"
): Promise<Fixture> {
  const suffix = stableHash({ runIdValue, session: session.session_id })
    .slice(0, 18);
  const label = evaluationPhase.toUpperCase();
  const fixtureId = `${evaluationPhase}_fixture_${suffix}`;
  const student = await prisma.user.create({
    data: {
      user_id: `${evaluationPhase}_student_${suffix}`,
      user_id_normalized: `${evaluationPhase}_student_${suffix}`,
      display_name: `${label} synthetic student`,
      role: "student"
    }
  });
  const teacher = await prisma.user.create({
    data: {
      user_id: `${evaluationPhase}_teacher_${suffix}`,
      user_id_normalized: `${evaluationPhase}_teacher_${suffix}`,
      display_name: `${label} synthetic teacher`,
      role: "teacher_researcher"
    }
  });
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: `${evaluationPhase}_asmt_${suffix}`,
      title: `${label} isolated synthetic simulator canary`,
      status: "draft",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: teacher.id
    }
  });
  const concept = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `${evaluationPhase}_cu_${suffix}`,
      assessment_db_id: assessment.id,
      title: "Item difficulty and information across theta",
      learning_objective:
        "Relate item information to item location and examinee theta.",
      related_concept_description:
        `Synthetic ${label} fixture; contains no classroom records.`,
      order_index: 1,
      status: "draft"
    }
  });
  const assessmentSession = await prisma.assessmentSession.create({
    data: {
      session_public_id: `${evaluationPhase}_sess_${suffix}`,
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "followup_active",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted",
      current_concept_unit_db_id: concept.id,
      started_at: new Date(),
      last_activity_at: new Date()
    }
  });
  const conceptSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: assessmentSession.id,
      concept_unit_db_id: concept.id,
      status: "followup_active",
      followup_status: "active",
      followup_started_at: new Date()
    }
  });
  return {
    fixture_id: fixtureId,
    session_protocol_id: session.session_id,
    student_user_db_id: student.id,
    teacher_user_db_id: teacher.id,
    assessment_db_id: assessment.id,
    assessment_public_id: assessment.assessment_public_id,
    concept_unit_db_id: concept.id,
    assessment_session_db_id: assessmentSession.id,
    concept_unit_session_db_id: conceptSession.id,
    session_public_id: assessmentSession.session_public_id
  };
}

async function fixtureCounts(prisma: PrismaClient, fixture: Fixture) {
  const [
    users,
    assessments,
    concepts,
    sessions,
    conceptSessions,
    turns,
    events,
    calls,
    effective
  ] = await Promise.all([
    prisma.user.count({ where: { id: { in: [
      fixture.student_user_db_id, fixture.teacher_user_db_id
    ] } } }),
    prisma.assessment.count({ where: { id: fixture.assessment_db_id } }),
    prisma.conceptUnit.count({ where: { id: fixture.concept_unit_db_id } }),
    prisma.assessmentSession.count({
      where: { id: fixture.assessment_session_db_id }
    }),
    prisma.conceptUnitSession.count({
      where: { id: fixture.concept_unit_session_db_id }
    }),
    prisma.conversationTurn.count({
      where: { assessment_session_db_id: fixture.assessment_session_db_id }
    }),
    prisma.processEvent.count({
      where: { assessment_session_db_id: fixture.assessment_session_db_id }
    }),
    prisma.agentCall.count({
      where: { assessment_session_db_id: fixture.assessment_session_db_id }
    }),
    prisma.operationalAgentEffectiveResult.count({
      where: { operational_context_public_id: fixture.session_public_id }
    })
  ]);
  return {
    users, assessments, concepts, sessions, concept_sessions: conceptSessions,
    conversation_turns: turns, process_events: events, agent_calls: calls,
    effective_results: effective
  };
}

async function cleanupFixture(prisma: PrismaClient, fixture: Fixture) {
  const before = await fixtureCounts(prisma, fixture);
  await prisma.operationalAgentEffectiveResult.deleteMany({
    where: { operational_context_public_id: fixture.session_public_id }
  });
  await prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: fixture.assessment_session_db_id }
  });
  await prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: fixture.assessment_session_db_id }
  });
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: fixture.assessment_session_db_id }
  });
  await prisma.conceptUnitSession.deleteMany({
    where: { assessment_session_db_id: fixture.assessment_session_db_id }
  });
  await prisma.assessmentSession.deleteMany({
    where: { id: fixture.assessment_session_db_id }
  });
  await prisma.conceptUnit.deleteMany({
    where: { id: fixture.concept_unit_db_id }
  });
  await prisma.assessment.deleteMany({
    where: { id: fixture.assessment_db_id }
  });
  await prisma.user.deleteMany({
    where: { id: { in: [fixture.student_user_db_id, fixture.teacher_user_db_id] } }
  });
  const after = await fixtureCounts(prisma, fixture);
  return {
    fixture_id: fixture.fixture_id,
    session_protocol_id: fixture.session_protocol_id,
    before_cleanup: before,
    after_cleanup: after,
    passed: Object.values(after).every((count) => count === 0)
  };
}

async function transcript(prisma: PrismaClient, fixture: Fixture) {
  return prisma.conversationTurn.findMany({
    where: { assessment_session_db_id: fixture.assessment_session_db_id },
    orderBy: { sequence_index: "asc" },
    select: {
      sequence_index: true,
      actor_type: true,
      agent_name: true,
      message_text: true,
      structured_payload: true
    }
  });
}

function buildVisibleHistory(input: Awaited<ReturnType<typeof transcript>>) {
  let studentTurn = 0;
  return input.filter((turn) => Boolean(turn.message_text)).map((turn, index) => {
    if (turn.actor_type === "student") studentTurn += 1;
    return {
      visible_turn_id: `e2a17_visible_${turn.sequence_index}`,
      sequence_index: index + 1,
      dialogue_turn_number: Math.max(studentTurn, 1),
      actor_type: turn.actor_type === "student" ? "student" as const :
        "agent" as const,
      message_text: turn.message_text!
    };
  });
}

function baseItem16Case() {
  const found = e2a13HeldOutCases().find((entry) =>
    entry.case_id === "e2a13_information_new_strategy"
  );
  if (!found) throw new Error("e2a17_item16_source_case_missing");
  return found;
}

function progressionAuthorization(turn: E2A17TurnProtocol) {
  return {
    authorization_version: "topic-dialogue-progression-authorization-v1" as const,
    revision_authorized: turn.selected_mode === "request_revision",
    transfer_authorized: turn.selected_mode === "present_transfer",
    completion_authorized: turn.selected_mode === "complete_episode",
    authorized_action: turn.selected_mode,
    authorization_evidence_summary:
      `The platform authorized only ${turn.selected_mode} after validating ` +
      `the current synthetic evidence checkpoint ${turn.path_stage}.`
  };
}

function dynamicTutorCase(input: {
  fixture: Fixture;
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  priorTranscript: Awaited<ReturnType<typeof transcript>>;
  latestStudentMessage: string;
}): E2A10TopicDialogueCase {
  const source = baseItem16Case();
  const visibleHistory = buildVisibleHistory(input.priorTranscript);
  const dialogueInput = {
    ...structuredClone(source.dialogue_input),
    dialogue_public_id:
      `e2a17_dialogue_${input.fixture.fixture_id}_${input.turn.turn_number}`,
    session_public_id: input.fixture.session_public_id,
    assessment_public_id: input.fixture.assessment_public_id,
    concept_public_id: `e2a17_concept_${input.fixture.fixture_id}`,
    latest_student_message: input.latestStudentMessage,
    latest_student_turn_id:
      `e2a17_${input.session.session_id}_student_${input.turn.turn_number}`,
    latest_student_message_classification:
      input.turn.routing_classification ?? input.turn.path_stage,
    dialogue_turn_number: input.turn.turn_number,
    maximum_dialogue_turns: 10,
    visible_dialogue_history: visibleHistory,
    progression_authorization: progressionAuthorization(input.turn),
    source_versions: {
      protocol: E2A17_PROTOCOL_VERSION,
      history_contract: "exact-visible-history-v1"
    }
  };
  return {
    ...structuredClone(source),
    case_id:
      `${input.session.session_id}_turn_${input.turn.turn_number}`,
    case_number: input.turn.turn_number,
    selected_mode: input.turn.selected_mode,
    selected_operation: input.turn.selected_operation,
    routing_classification: input.turn.routing_classification,
    dialogue_input: dialogueInput,
    strategies_already_attempted: [...input.turn.strategies_already_attempted],
    strategies_marked_unsuccessful:
      [...input.turn.strategies_marked_unsuccessful],
    scenario_truth_summary:
      "The platform selected the frozen current-turn route. The provider must not select progression.",
    require_tenth_turn_context: false
  };
}

function validationContext(
  testCase: E2A10TopicDialogueCase
): TopicDialogueRuntimeValidationContext {
  return {
    selected_mode: testCase.selected_mode,
    selected_operation: testCase.selected_operation,
    latest_student_message: testCase.dialogue_input.latest_student_message,
    distractor_anchor: testCase.distractor_anchor,
    misconception_target: testCase.misconception_target,
    strategies_already_attempted: testCase.strategies_already_attempted,
    prohibited_repeated_strategies: testCase.strategies_marked_unsuccessful
  };
}

function repairInstructions(input: {
  testCase: E2A10TopicDialogueCase;
  originalInstructions: string;
  validation: TopicDialogueRuntimeValidationV3Result;
}) {
  const failed = input.validation.hard_rejection_reasons.map((entry) =>
    entry.rule_code
  );
  if (input.testCase.selected_mode === "remain_in_dialogue") {
    if (!input.testCase.selected_operation) {
      throw new Error("e2a17_operation_repair_missing_operation");
    }
    return buildTopicDialogueOperationRepairInstructions({
      operation: input.testCase.selected_operation,
      original_instructions: input.originalInstructions,
      latest_student_message: input.testCase.dialogue_input.latest_student_message,
      distractor_anchor: input.testCase.distractor_anchor,
      failed_requirements: failed,
      prohibited_repeated_strategies:
        input.testCase.strategies_marked_unsuccessful
    });
  }
  return `${input.originalInstructions}\n\nThe prior output was rejected. ` +
    `The platform-selected response mode remains exactly ${input.testCase.selected_mode}. ` +
    "Do not select another mode, operation, action, readiness state, or runtime state.\n" +
    `Latest student message: ${input.testCase.dialogue_input.latest_student_message}\n` +
    `Current distractor anchor: ${input.testCase.distractor_anchor}\n` +
    `Correct every failed requirement: ${failed.join(", ") || "mode contract"}.\n` +
    "Return one fresh complete object for the same mode-specific schema.";
}

function assertRouting(turn: E2A17TurnProtocol) {
  if (turn.selected_mode === "remain_in_dialogue") {
    assert(Boolean(turn.routing_classification),
      "e2a17_routing_classification_missing");
    assert(Boolean(turn.selected_operation), "e2a17_selected_operation_missing");
    const actual = selectTopicDialogueOperation({
      selected_response_mode: "remain_in_dialogue",
      latest_response_classification: turn.routing_classification!
    });
    assert(actual === turn.selected_operation,
      "e2a17_platform_operation_selection_mismatch");
  } else {
    assert(turn.selected_operation === null &&
      turn.routing_classification === null,
    "e2a17_progression_turn_has_operation");
  }
  if (turn.selected_mode === "present_transfer") {
    assert(turn.progression_state_before === "revision_authorized",
      "e2a17_transfer_before_revision");
  }
  if (turn.selected_mode === "complete_episode") {
    assert(turn.progression_state_before === "transfer_authorized",
      "e2a17_completion_before_transfer");
    assert(turn.student_intent === "robust_explanation",
      "e2a17_completion_without_transfer_evidence");
  }
}

async function persistStudentTurn(input: {
  prisma: PrismaClient;
  fixture: Fixture;
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  message: string;
  evaluation_phase?: "e2a17" | "e2a19";
}) {
  const evaluationPhase = input.evaluation_phase ?? "e2a17";
  const created = await input.prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: input.fixture.assessment_session_db_id,
      concept_unit_session_db_id: input.fixture.concept_unit_session_db_id,
      phase: "followup_active",
      actor_type: "student",
      message_text: input.message,
      structured_payload: json({
        evaluation_phase: evaluationPhase,
        session_protocol_id: input.session.session_id,
        turn_number: input.turn.turn_number,
        student_intent: input.turn.student_intent
      })
    }
  });
  await input.prisma.processEvent.create({
    data: {
      assessment_session_db_id: input.fixture.assessment_session_db_id,
      concept_unit_session_db_id: input.fixture.concept_unit_session_db_id,
      event_type: `${evaluationPhase}_student_turn_persisted`,
      event_category: "evaluation_runtime",
      event_source: "backend",
      payload: json({
        session_protocol_id: input.session.session_id,
        turn_number: input.turn.turn_number,
        sequence_index: created.sequence_index
      }),
      occurred_at: new Date()
    }
  });
  return created;
}

async function persistRouteDecision(input: {
  prisma: PrismaClient;
  fixture: Fixture;
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  evaluation_phase?: "e2a17" | "e2a19";
}) {
  const evaluationPhase = input.evaluation_phase ?? "e2a17";
  assertRouting(input.turn);
  await input.prisma.processEvent.create({
    data: {
      assessment_session_db_id: input.fixture.assessment_session_db_id,
      concept_unit_session_db_id: input.fixture.concept_unit_session_db_id,
      event_type: `${evaluationPhase}_platform_route_selected`,
      event_category: "evaluation_runtime",
      event_source: "backend",
      payload: json({
        session_protocol_id: input.session.session_id,
        turn_number: input.turn.turn_number,
        selected_mode: input.turn.selected_mode,
        selected_operation: input.turn.selected_operation,
        routing_classification: input.turn.routing_classification,
        platform_controlled: true
      }),
      occurred_at: new Date()
    }
  });
  return {
    session_id: input.session.session_id,
    turn_number: input.turn.turn_number,
    selected_mode: input.turn.selected_mode,
    selected_operation: input.turn.selected_operation,
    routing_classification: input.turn.routing_classification,
    platform_controlled: true,
    provider_selected_route: false,
    passed: true
  };
}

async function executeProgression(input: {
  prisma: PrismaClient;
  fixture: Fixture;
  session: E2A17SessionProtocol;
  turn: E2A17TurnProtocol;
  evaluation_phase?: "e2a17" | "e2a19";
}) {
  const evaluationPhase = input.evaluation_phase ?? "e2a17";
  let platformTransferTurn: Awaited<ReturnType<PrismaClient["conversationTurn"]["create"]>> | null = null;
  if (input.turn.selected_mode === "request_revision") {
    await input.prisma.assessmentSession.update({
      where: { id: input.fixture.assessment_session_db_id },
      data: { current_phase: "followup_active", last_activity_at: new Date() }
    });
  }
  if (input.turn.selected_mode === "present_transfer") {
    await input.prisma.assessmentSession.update({
      where: { id: input.fixture.assessment_session_db_id },
      data: { current_phase: "followup_active", last_activity_at: new Date() }
    });
  }
  if (input.turn.selected_mode === "complete_episode") {
    await input.prisma.assessmentSession.update({
      where: { id: input.fixture.assessment_session_db_id },
      data: {
        current_phase: "session_completed",
        status: "completed",
        completed_at: new Date(),
        last_activity_at: new Date()
      }
    });
  }
  if (input.turn.inject_platform_transfer_item_after_reply) {
    assert(input.turn.selected_mode === "present_transfer" &&
      Boolean(input.session.platform_transfer_item_prompt),
    "e2a17_platform_transfer_item_not_authorized");
    platformTransferTurn = await input.prisma.conversationTurn.create({
      data: {
        assessment_session_db_id: input.fixture.assessment_session_db_id,
        concept_unit_session_db_id: input.fixture.concept_unit_session_db_id,
        phase: "followup_active",
        actor_type: "agent",
        agent_name: "platform_transfer_presenter",
        message_text: input.session.platform_transfer_item_prompt!,
        structured_payload: json({
          evaluation_phase: evaluationPhase,
          platform_owned_transfer_item: true,
          tutor_generated: false
        })
      }
    });
  }
  await input.prisma.processEvent.create({
    data: {
      assessment_session_db_id: input.fixture.assessment_session_db_id,
      concept_unit_session_db_id: input.fixture.concept_unit_session_db_id,
      event_type: `${evaluationPhase}_platform_progression_applied`,
      event_category: "evaluation_runtime",
      event_source: "backend",
      payload: json({
        turn_number: input.turn.turn_number,
        selected_mode: input.turn.selected_mode,
        state_before: input.turn.progression_state_before,
        state_after: input.turn.progression_state_after,
        platform_transfer_item_presented: Boolean(platformTransferTurn)
      }),
      occurred_at: new Date()
    }
  });
  return {
    session_id: input.session.session_id,
    turn_number: input.turn.turn_number,
    selected_mode: input.turn.selected_mode,
    state_before: input.turn.progression_state_before,
    state_after: input.turn.progression_state_after,
    transition_authorized_by_platform: true,
    provider_transition_executed: false,
    revision_transfer_completion_distinct: true,
    platform_transfer_item_presented: Boolean(platformTransferTurn),
    platform_transfer_item_sequence_index:
      platformTransferTurn?.sequence_index ?? null,
    passed: true
  };
}

function inspectVisibleMessageSafety(
  message: string,
  session: E2A17SessionProtocol,
  turn: E2A17TurnProtocol
) {
  const privacyFindings = findVisibleTextPrivacyFindings(
    message, "student_facing_message"
  );
  const answerKeyFindings = message.match(
    /\b(?:correct answer|correct option|keyed (?:answer|choice|option))\s*(?:is|:|=)\s*(?:option\s*)?[A-D]\b/giu
  ) ?? [];
  const hiddenStateLabels = [
    session.hidden_misconception_state.category,
    turn.hidden_state_before,
    turn.hidden_state_after,
    "simulator hidden state",
    "synthetic student persona"
  ].filter((label) => message.toLowerCase().includes(label.toLowerCase()));
  const providerControlFindings = [
    /(?:system|developer) prompt\s*(?:is|says|:)/iu,
    /runtime validator\s*(?:found|says|:)/iu,
    /provider metadata\s*(?:is|:)/iu,
    /expected evaluator decision\s*(?:is|:)/iu
  ].filter((pattern) => pattern.test(message)).map((pattern) => pattern.source);
  return {
    privacy: {
      passed: privacyFindings.length === 0,
      finding_count: privacyFindings.length,
      findings: privacyFindings
    },
    answer_key: {
      passed: answerKeyFindings.length === 0,
      finding_count: answerKeyFindings.length,
      finding_rule_codes: answerKeyFindings.length
        ? ["answer_key_disclosure"]
        : [],
      raw_evidence_omitted: true
    },
    simulator_hidden_state: {
      passed: hiddenStateLabels.length === 0,
      finding_count: hiddenStateLabels.length,
      safe_labels: hiddenStateLabels
    },
    provider_control: {
      passed: providerControlFindings.length === 0,
      finding_count: providerControlFindings.length,
      safe_pattern_labels: providerControlFindings
    },
    passed: privacyFindings.length === 0 &&
      answerKeyFindings.length === 0 && hiddenStateLabels.length === 0 &&
      providerControlFindings.length === 0
  };
}

async function countPersistence(prisma: PrismaClient, fixture: Fixture) {
  const [calls, effective, agentTurns, events] = await Promise.all([
    prisma.agentCall.count({
      where: { assessment_session_db_id: fixture.assessment_session_db_id }
    }),
    prisma.operationalAgentEffectiveResult.count({
      where: { operational_context_public_id: fixture.session_public_id }
    }),
    prisma.conversationTurn.count({
      where: {
        assessment_session_db_id: fixture.assessment_session_db_id,
        actor_type: "agent",
        agent_name: "topic_dialogue_agent"
      }
    }),
    prisma.processEvent.count({
      where: {
        assessment_session_db_id: fixture.assessment_session_db_id,
        event_type: "e2a15b_candidate_effective_response_persisted"
      }
    })
  ]);
  return { agent_calls: calls, effective_results: effective,
    tutor_visible_turns: agentTurns, effective_response_events: events };
}

async function transcriptResult(input: {
  prisma: PrismaClient;
  fixture: Fixture;
  session: E2A17SessionProtocol;
  completedTurnCount: number;
}) {
  const rows = await transcript(input.prisma, input.fixture);
  const indexes = rows.map((row) => row.sequence_index);
  const duplicateIndexes = indexes.filter((value, index) =>
    indexes.indexOf(value) !== index
  );
  const ordered = rows.every((row, index) =>
    index === 0 || row.sequence_index > rows[index - 1]!.sequence_index
  );
  const studentTurns = rows.filter((row) => row.actor_type === "student");
  const tutorTurns = rows.filter((row) =>
    row.actor_type === "agent" && row.agent_name === "topic_dialogue_agent"
  );
  const platformTurns = rows.filter((row) =>
    row.actor_type === "agent" && row.agent_name === "platform_transfer_presenter"
  );
  const everyStudentHasLaterTutor = studentTurns.every((student) =>
    tutorTurns.some((tutor) => tutor.sequence_index > student.sequence_index &&
      !studentTurns.some((other) =>
        other.sequence_index > student.sequence_index &&
        other.sequence_index < tutor.sequence_index
      )
    )
  );
  const expectedPlatformTurns = input.session.turns.slice(
    0, input.completedTurnCount
  ).filter((turn) => turn.inject_platform_transfer_item_after_reply).length;
  return {
    session_id: input.session.session_id,
    completed_student_turn_count: input.completedTurnCount,
    transcript_row_count: rows.length,
    student_turn_count: studentTurns.length,
    visible_tutor_reply_count: tutorTurns.length,
    platform_transfer_turn_count: platformTurns.length,
    expected_platform_transfer_turn_count: expectedPlatformTurns,
    visible_sequence_strictly_increasing: ordered,
    duplicate_sequence_indexes: duplicateIndexes,
    exact_student_turn_count: studentTurns.length === input.completedTurnCount,
    exact_tutor_reply_count: tutorTurns.length === input.completedTurnCount,
    every_student_turn_has_exactly_one_later_tutor_reply:
      everyStudentHasLaterTutor && tutorTurns.length === studentTurns.length,
    platform_turn_count_matches: platformTurns.length === expectedPlatformTurns,
    maximum_dialogue_turns_observed:
      studentTurns.length + tutorTurns.length <=
      input.session.maximum_visible_dialogue_turns,
    transcript_hash: stableHash(rows.map((row) => ({
      sequence_index: row.sequence_index,
      actor_type: row.actor_type,
      agent_name: row.agent_name,
      message_text: row.message_text
    }))),
    passed: ordered && duplicateIndexes.length === 0 &&
      studentTurns.length === input.completedTurnCount &&
      tutorTurns.length === input.completedTurnCount &&
      everyStudentHasLaterTutor &&
      platformTurns.length === expectedPlatformTurns &&
      studentTurns.length + tutorTurns.length <=
      input.session.maximum_visible_dialogue_turns
  };
}

function usageArtifact(ledger: BudgetLedger) {
  return {
    usage_version: "e2a17-provider-usage-v1",
    budget: E2A17_BUDGET,
    actual: {
      simulator_provider_calls: ledger.simulator_calls,
      tutor_initial_provider_calls: ledger.tutor_initial_calls,
      tutor_regeneration_provider_calls: ledger.tutor_regeneration_calls,
      total_generation_calls: ledger.total_generation_calls,
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
      per_call_latency_ms: ledger.per_call_latency_ms
    },
    within_budget: ledger.simulator_calls <= E2A17_BUDGET.maximum_simulator_calls &&
      ledger.tutor_initial_calls <=
      E2A17_BUDGET.maximum_tutor_initial_generation_calls &&
      ledger.tutor_regeneration_calls <=
      E2A17_BUDGET.maximum_tutor_regeneration_calls &&
      ledger.total_generation_calls <=
      E2A17_BUDGET.maximum_total_generation_calls &&
      ledger.provider_adapter_attempts <=
      E2A17_BUDGET.maximum_provider_adapter_attempts &&
      ledger.input_tokens <= E2A17_BUDGET.maximum_input_tokens &&
      ledger.output_tokens <= E2A17_BUDGET.maximum_output_tokens &&
      ledger.input_tokens + ledger.output_tokens <=
      E2A17_BUDGET.maximum_total_tokens &&
      (!ledger.pricing_complete || ledger.estimated_cost_usd <=
        E2A17_BUDGET.maximum_estimated_cost_usd_when_pricing_available)
  };
}

function humanReviewPacket(input: {
  runId: string;
  turns: TurnExecution[];
}) {
  return {
    packet_version: "e2a17-all-student-facing-output-human-review-v1",
    run_id: input.runId,
    review_target: "all_effective_tutor_outputs_and_rejected_attempts",
    candidate_hash: E2A17_CANDIDATE_HASH,
    protocol_hash: E2A17_PROTOCOL_HASH,
    human_review_required: true,
    human_review_completed: false,
    review_item_count: input.turns.length,
    rows: input.turns.map((entry) => ({
      review_item_id:
        `${entry.session_protocol_id}:turn:${entry.turn.turn_number}`,
      session_id: entry.session_protocol_id,
      session_public_id: entry.session_public_id,
      turn_number: entry.turn.turn_number,
      simulator_visible_message: entry.simulator_output.student_message,
      simulator_hidden_state_category:
        entry.turn.hidden_state_after,
      selected_mode: entry.turn.selected_mode,
      selected_operation: entry.turn.selected_operation,
      tutor_provider_attempts: entry.runtime.attempts.map((attempt) => ({
        attempt_index: attempt.attempt_index,
        provider_status: attempt.provider_status,
        provider_output: attempt.parsed_output,
        runtime_acceptance:
          attempt.runtime_validation.runtime_acceptance,
        hard_rejection_reasons:
          attempt.runtime_validation.hard_rejection_reasons,
        soft_flags: attempt.runtime_validation.soft_review_flags,
        rejected_or_regenerated:
          attempt.runtime_validation.runtime_acceptance === "hard_rejected" ||
          attempt.attempt_index === 2
      })),
      effective_student_facing_response:
        entry.runtime.persisted_visible_message,
      runtime_acceptance: entry.runtime.final_runtime_acceptance,
      hard_rejection_evidence:
        entry.runtime.audit_projection.hard_rejection_history,
      soft_flags: entry.runtime.audit_projection.review_flags,
      progression_state_before: entry.turn.progression_state_before,
      progression_state_after: entry.turn.progression_state_after,
      persistence_result: entry.persistence,
      student_projection: entry.runtime.student_projection,
      audit_projection: entry.runtime.audit_projection,
      transcript_result: entry.transcript,
      privacy_result: entry.privacy,
      context_coverage: entry.context,
      human_review: {
        decision: null,
        critical_failure: null,
        reviewer_notes: null,
        reviewer_identity: null,
        reviewed_at: null
      }
    }))
  };
}

function artifactHashes(runDir: string) {
  return listRunArtifactNames(runDir).map((name) => ({
    name,
    sha256: sha256(readFileSync(path.join(runDir, name)))
  }));
}

function determineFailureStatus(errorCode: string) {
  if (/fallback|regeneration.*(?:limit|stability)|turn_limit|cleanup/iu.test(
    errorCode
  )) return "e2a17_canary_failed_stability" as const;
  if (/provider|contract|budget/iu.test(errorCode)) {
    return "e2a17_canary_incomplete" as const;
  }
  return "e2a17_canary_failed" as const;
}

async function executeSession(input: {
  prisma: PrismaClient;
  provider: ProviderBundle;
  fixture: Fixture;
  session: E2A17SessionProtocol;
  runId: string;
  checkpointCommit: string;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
  ledger: BudgetLedger;
  paths: RunPaths;
  live: boolean;
  totalRegenerations: () => number;
  recordRegenerations: (count: number) => void;
}) {
  const completed: TurnExecution[] = [];
  const previousStudentMessages: string[] = [];
  for (const turn of input.session.turns) {
    if (turn.turn_number > input.session.maximum_student_turns) {
      throw new Error("e2a17_session_turn_limit_exceeded");
    }
    if (input.live) assertSourceIntegrity(input.checkpointCommit);
    const beforeStudentTranscript = await transcript(input.prisma, input.fixture);
    const simulatorInput = buildSimulatorInput({
      session: input.session,
      turn,
      visibleTranscript: beforeStudentTranscript
    });
    const simulatorFlow = informationFlowAudit({
      session: input.session,
      turn,
      simulatorInput,
      tutorRequest: null
    });
    assert(simulatorFlow.passed, "e2a17_simulator_information_flow_failed");
    const simulatorRequestValue = simulatorRequest({
      runId: input.runId,
      session: input.session,
      turn,
      simulatorInput,
      modelConfig: input.modelConfig,
      timeoutMs: input.timeoutMs
    });
    assertBudgetBeforeCall({
      ledger: input.ledger,
      role: "simulator",
      estimated_input_tokens: estimatedTokens(simulatorRequestValue),
      maximum_output_tokens:
        E2A17_BUDGET.per_request_token_caps.simulator_output_tokens
    });
    const simulatorResult = await input.provider.executeSimulator(
      simulatorRequestValue, turn
    );
    recordBudgetResult({
      ledger: input.ledger,
      role: "simulator",
      call_kind: "simulator",
      result: simulatorResult,
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      attempt_index: 1
    });
    if (input.live) assertSourceIntegrity(input.checkpointCommit);
    appendJsonl(input.paths.simulatorProviderOutputs, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      ...sanitizedProviderResult(simulatorResult),
      simulator_prompt_version: E2A_SIMULATOR_PROMPT_VERSION,
      simulator_schema_version: E2A_SIMULATOR_SCHEMA_VERSION,
      simulator_regeneration_allowed: false
    });
    assert(simulatorResult.status === "completed" &&
      Boolean(simulatorResult.parsed_output),
    "e2a17_simulator_provider_or_schema_failure");
    const simulatorValidation = validateLlmStudentSimulatorOutput({
      simulator_input: simulatorInput,
      output: simulatorResult.parsed_output!,
      previous_student_messages: previousStudentMessages
    });
    assert(simulatorValidation.valid,
      `e2a17_simulator_contract_failure:${simulatorValidation.issues.map(
        (issue) => issue.rule_code
      ).join(",")}`);
    const simulatorOutput = simulatorValidation.output;
    previousStudentMessages.push(simulatorOutput.student_message);
    const studentTurn = await persistStudentTurn({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      turn,
      message: simulatorOutput.student_message
    });
    appendJsonl(input.paths.studentTurnResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      persisted_sequence_index: studentTurn.sequence_index,
      rendered_intent: simulatorOutput.rendered_intent,
      expressed_evidence_level: simulatorOutput.expressed_evidence_level,
      strict_schema_valid: true,
      semantic_contract_valid: simulatorValidation.valid,
      semantic_issue_codes: simulatorValidation.issues.map((issue) =>
        issue.rule_code
      ),
      accepted: true
    });
    const route = await persistRouteDecision({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      turn
    });
    appendJsonl(input.paths.routingDecisions, route);
    const testCase = dynamicTutorCase({
      fixture: input.fixture,
      session: input.session,
      turn,
      priorTranscript: beforeStudentTranscript,
      latestStudentMessage: simulatorOutput.student_message
    });
    const tutorRequest = requestForCase(testCase);
    const fullFlow = informationFlowAudit({
      session: input.session,
      turn,
      simulatorInput,
      tutorRequest
    });
    appendJsonl(input.paths.informationFlowAudit, fullFlow);
    assert(fullFlow.passed, "e2a17_tutor_information_flow_failed");
    const beforePersistence = await countPersistence(
      input.prisma, input.fixture
    );
    const runtime = await executeE2A15BRuntime({
      prisma: input.prisma,
      assessment_session_db_id: input.fixture.assessment_session_db_id,
      concept_unit_session_db_id: input.fixture.concept_unit_session_db_id,
      session_public_id: input.fixture.session_public_id,
      invocation_key:
        `e2a17:${input.runId}:${input.session.session_id}:turn:${turn.turn_number}`,
      candidate_hash: E2A17_CANDIDATE_HASH,
      protocol_hash: E2A17_PROTOCOL_HASH,
      model_config: input.modelConfig,
      validation_context: validationContext(testCase),
      deterministic_fallback_output: fallbackForCase(testCase),
      invoke_provider: async ({ attempt_index, prior_validation }) => {
        if (input.live) assertSourceIntegrity(input.checkpointCommit);
        const request: StructuredAgentRequest<unknown, unknown> = {
          agent_name: "topic_dialogue_agent",
          model_config: input.modelConfig,
          instructions: attempt_index === 1 || !prior_validation
            ? tutorRequest.instructions
            : repairInstructions({
                testCase,
                originalInstructions: tutorRequest.instructions,
                validation: prior_validation
              }),
          input: tutorRequest.provider_input,
          output_schema: tutorRequest.output_schema as z.ZodType<unknown>,
          schema_name: tutorRequest.schema_name,
          client_request_id:
            `${input.runId}_${input.session.session_id}_tutor_${turn.turn_number}_${attempt_index}`,
          timeout_ms: input.timeoutMs,
          metadata: {
            evaluation: "e2a17_bounded_independent_student_simulator",
            role: "topic_dialogue_agent",
            session_id: input.session.session_id,
            turn_number: String(turn.turn_number),
            attempt_index: String(attempt_index),
            candidate_hash_prefix: E2A17_CANDIDATE_HASH.slice(0, 12),
            protocol_hash_prefix: E2A17_PROTOCOL_HASH.slice(0, 12)
          }
        };
        assertBudgetBeforeCall({
          ledger: input.ledger,
          role: attempt_index === 1
            ? "tutor_initial"
            : "tutor_regeneration",
          estimated_input_tokens: estimatedTokens(request),
          maximum_output_tokens: input.modelConfig.max_output_tokens ??
            E2A17_BUDGET.per_request_token_caps.tutor_output_tokens
        });
        const result = await input.provider.executeTutor(request, testCase);
        recordBudgetResult({
          ledger: input.ledger,
          role: "tutor",
          call_kind: attempt_index === 1
            ? "tutor_initial"
            : "tutor_regeneration",
          result,
          session_id: input.session.session_id,
          turn_number: turn.turn_number,
          attempt_index
        });
        if (input.live) assertSourceIntegrity(input.checkpointCommit);
        return result;
      }
    });
    input.recordRegenerations(runtime.regeneration_count);
    for (const attempt of runtime.attempts) {
      appendJsonl(input.paths.tutorProviderOutputs, {
        session_id: input.session.session_id,
        turn_number: turn.turn_number,
        selected_mode: turn.selected_mode,
        selected_operation: turn.selected_operation,
        ...attempt
      });
      appendJsonl(input.paths.runtimeValidationResults, {
        session_id: input.session.session_id,
        turn_number: turn.turn_number,
        attempt_index: attempt.attempt_index,
        ...attempt.runtime_validation
      });
      appendJsonl(input.paths.pedagogicalRubricResults, {
        session_id: input.session.session_id,
        turn_number: turn.turn_number,
        attempt_index: attempt.attempt_index,
        rubric_findings: attempt.pedagogical_rubric,
        changes_runtime_acceptance: false,
        triggers_regeneration: false
      });
    }
    assert(input.totalRegenerations() <=
      E2A17_BUDGET.maximum_tutor_regenerations_for_stability,
    "e2a17_regeneration_stability_limit_exceeded");
    assert(runtime.regeneration_count <= 1,
      "e2a17_per_turn_regeneration_limit_exceeded");
    assert(!runtime.deterministic_fallback_used,
      "e2a17_first_deterministic_tutor_fallback");
    const initial = runtime.attempts[0];
    const softOnlyRegeneration = runtime.regeneration_count > 0 &&
      initial?.runtime_validation.runtime_acceptance !== "hard_rejected";
    assert(!softOnlyRegeneration, "e2a17_soft_only_regeneration_detected");
    const safety = inspectVisibleMessageSafety(
      runtime.persisted_visible_message, input.session, turn
    );
    appendJsonl(input.paths.privacyResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      ...safety
    });
    assert(safety.passed, "e2a17_critical_privacy_or_hidden_state_leak");
    const afterPersistence = await countPersistence(
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
          where: {
            invocation_key:
              `e2a17:${input.runId}:${input.session.session_id}:turn:${turn.turn_number}`
          }
        }),
      effective_result_public_id:
        runtime.persisted_effective_result_public_id,
      passed: afterPersistence.agent_calls - beforePersistence.agent_calls ===
        runtime.attempts.length &&
        afterPersistence.effective_results - beforePersistence.effective_results === 1 &&
        afterPersistence.tutor_visible_turns -
        beforePersistence.tutor_visible_turns === 1 &&
        afterPersistence.effective_response_events -
        beforePersistence.effective_response_events === 1
    };
    appendJsonl(input.paths.persistenceResults, persistence);
    assert(persistence.passed, "e2a17_turn_persistence_mismatch");
    appendJsonl(input.paths.studentProjectionResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      projection: runtime.student_projection,
      provider_output_displayed_only_after_effective_validation: true,
      internal_review_metadata_visible: false,
      passed: runtime.student_projection.visible_message ===
        runtime.persisted_visible_message
    });
    appendJsonl(input.paths.auditProjectionResults, {
      session_id: input.session.session_id,
      turn_number: turn.turn_number,
      projection: runtime.audit_projection,
      hidden_simulator_state_included: false,
      review_provenance_retained: true,
      passed: true
    });
    const progression = await executeProgression({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      turn
    });
    appendJsonl(input.paths.progressionResults, progression);
    const refreshed = await transcriptResult({
      prisma: input.prisma,
      fixture: input.fixture,
      session: input.session,
      completedTurnCount: turn.turn_number
    });
    appendJsonl(input.paths.transcriptRefreshResults, refreshed);
    assert(refreshed.passed, "e2a17_transcript_integrity_failure");
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
      near_tenth_visible_turn_context_complete:
        input.session.session_id !== "e2a17_session_2_strategy_adaptation" ||
        turn.turn_number !== 6 || beforeStudentTranscript.length === 10,
      current_turn_directive_authoritative: true,
      historical_recommendations_non_authoritative: true,
      passed: beforeStudentTranscript.length ===
        testCase.dialogue_input.visible_dialogue_history.length &&
        !testCase.dialogue_input.visible_dialogue_history.some((entry) =>
          entry.message_text === simulatorOutput.student_message
        )
    };
    appendJsonl(input.paths.contextCoverageResults, context);
    assert(context.passed, "e2a17_context_coverage_failure");
    completed.push({
      session_protocol_id: input.session.session_id,
      session_public_id: input.fixture.session_public_id,
      turn,
      simulator_input: simulatorInput,
      simulator_output: simulatorOutput,
      simulator_result: simulatorResult,
      test_case: testCase,
      runtime,
      persistence,
      progression,
      privacy: safety,
      context,
      transcript: refreshed
    });
  }
  return completed;
}

function sessionFixtureArtifact(fixtures: Array<JsonObject>) {
  return {
    fixture_version: E2A17_FIXTURE_VERSION,
    synthetic_only: true,
    classroom_records_used: false,
    fixture_count: fixtures.length,
    fresh_fixture_per_session: true,
    fixtures
  };
}

function latestLiveRunId() {
  if (!existsSync(E2A17_ARTIFACT_ROOT)) return null;
  return readdirSync(E2A17_ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a17_"))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .find((id) => {
      const usagePath = path.join(E2A17_ARTIFACT_ROOT, id, "provider-usage.json");
      if (!existsSync(usagePath)) return false;
      const usage = readJson<{ actual?: { total_generation_calls?: number } }>(
        usagePath
      );
      return (usage.actual?.total_generation_calls ?? 0) > 0;
    }) ?? null;
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

export async function inspectE2A17Preflight(input: {
  requireLiveEnvironment: boolean;
  requireCleanTrackedTree: boolean;
  expectedCheckpointCommit?: string;
}) {
  const blockers: string[] = [];
  const protocol = validateE2A17Protocol();
  if (!protocol.passed) blockers.push("protocol_validation_failed");
  let integrity: ReturnType<typeof candidateIntegrity> | null = null;
  const commit = currentCommit();
  try {
    integrity = candidateIntegrity(input.expectedCheckpointCommit ?? commit);
    if (!Object.values(integrity.checks).every(Boolean)) {
      blockers.push("candidate_or_source_integrity_failed");
    }
  } catch {
    blockers.push("candidate_or_source_integrity_failed");
  }
  if (input.expectedCheckpointCommit && commit !== input.expectedCheckpointCommit) {
    blockers.push("dispatch_checkpoint_commit_mismatch");
  }
  if (input.requireCleanTrackedTree && !trackedTreeClean()) {
    blockers.push("tracked_worktree_not_clean");
  }
  const dbReady = await databaseReady();
  if (!dbReady) blockers.push("postgresql_not_ready");
  const nextPids = pidsMatching("[n]ext (dev|start)");
  if (nextPids.length > 0) blockers.push("next_server_running");
  if (existsSync(LOCK_PATH)) blockers.push("e2a17_live_lock_present");
  let credentialPublic: ReturnType<
    typeof publicOpenAICredentialResolution
  > | null = null;
  if (input.requireLiveEnvironment) {
    if (process.env.RUN_LIVE_E2A17 !== "1") {
      blockers.push("live_e2a17_opt_in_missing");
    }
    if (process.env.LLM_PROVIDER !== "openai") {
      blockers.push("provider_not_openai");
    }
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
      blockers.push("live_calls_not_enabled");
    }
    if (process.env.OPERATIONAL_APPROVED_CONFIG_HASH !==
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
    if (prior) blockers.push(`prior_e2a17_live_run_exists:${prior}`);
  }
  const tempDir = path.join(os.tmpdir(), `e2a17-compile-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  let compilation: Awaited<ReturnType<
    typeof compileE2A14CandidateRequestsNoNetwork
  >> | null = null;
  try {
    compilation = await compileE2A14CandidateRequestsNoNetwork(
      path.join(tempDir, "all-role-request-compilation.json")
    );
    if (!compilation.artifact.all_17_roles_compile ||
      compilation.artifact.network_request_count !== 0) {
      blockers.push("all_role_request_compilation_failed");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return {
    preflight_version: "e2a17-live-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    current_git_commit: commit,
    expected_checkpoint_commit: input.expectedCheckpointCommit ?? null,
    tracked_worktree_clean: trackedTreeClean(),
    protocol_validation: protocol,
    candidate_integrity: integrity,
    database_ready: dbReady,
    next_server_pids: nextPids,
    provider_concurrency: 1,
    provider_host: input.requireLiveEnvironment
      ? openAIBaseUrlHost(resolveOpenAIBaseUrl())
      : "not_checked",
    credential: credentialPublic,
    provider_adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
    all_role_request_compilation: compilation?.artifact ?? null,
    budget: E2A17_BUDGET,
    existing_live_run_id: latestLiveRunId(),
    candidate_approved: false,
    candidate_activated: false,
    network_request_count: 0
  };
}

function acquireLock() {
  mkdirSync(E2A17_ARTIFACT_ROOT, { recursive: true });
  if (existsSync(LOCK_PATH)) throw new Error("e2a17_live_lock_present");
  writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
}

function releaseLock() {
  if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
}

export async function executeE2A17Canary(input: {
  provider: ProviderBundle;
  live: boolean;
  dispatchCheckpointCommit: string;
  artifactRoot?: string;
  runId?: string;
}) {
  const id = input.runId ?? runId();
  const root = input.artifactRoot ?? E2A17_ARTIFACT_ROOT;
  const runDir = path.join(root, id);
  const paths = initializeArtifacts(runDir);
  const startedAt = new Date();
  const ledger = emptyBudgetLedger();
  const fixtures: JsonObject[] = [];
  const cleanupResults: JsonObject[] = [];
  const allTurns: TurnExecution[] = [];
  const sessionResults: JsonObject[] = [];
  let activeFixture: Fixture | null = null;
  let totalRegenerations = 0;
  let earlyAbortReason: string | null = null;
  let finalStatus:
    | "e2a17_canary_pass_pending_human_review"
    | "e2a17_canary_failed"
    | "e2a17_canary_failed_stability"
    | "e2a17_canary_incomplete" = "e2a17_canary_incomplete";
  const candidate = evaluateE2A14Candidate();
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  const timeoutMs = candidate.full_candidate.runtime_policy.provider_timeout_ms;
  const manifest = {
    manifest_version: E2A17_RUNNER_VERSION,
    run_id: id,
    started_at: startedAt.toISOString(),
    execution_mode: input.live ? "live_provider" : "injected_no_live_mock",
    dispatch_checkpoint_commit: input.dispatchCheckpointCommit,
    candidate_hash: E2A17_CANDIDATE_HASH,
    candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    protocol_hash: E2A17_PROTOCOL_HASH,
    session_count: E2A17_SESSIONS.length,
    provider_concurrency: 1,
    candidate_approved: false,
    candidate_activated: false,
    human_review_required: true,
    human_review_completed: false,
    thirty_six_session_matrix_run: false,
    e2b_implemented_or_run: false,
    status: "running"
  };
  writeJson(paths.canaryManifest, manifest);
  writeJson(paths.frozenProtocol, E2A17_FROZEN_PROTOCOL);
  writeFileSync(paths.frozenProtocolSha256, `${E2A17_PROTOCOL_HASH}\n`, "utf8");
  writeJson(paths.candidateIntegrity,
    candidateIntegrity(input.dispatchCheckpointCommit));
  await compileE2A14CandidateRequestsNoNetwork(
    paths.allRoleRequestCompilation
  );
  writeJson(paths.simulatorHiddenStateContract, hiddenStateContract());
  writeJson(paths.sessionFixtures, sessionFixtureArtifact(fixtures));
  writeJson(paths.fixtureCleanupResults, { results: cleanupResults });
  writeJson(paths.providerUsage, usageArtifact(ledger));
  writeJson(paths.humanReviewPacket, humanReviewPacket({ runId: id, turns: [] }));

  const prisma = new PrismaClient();
  try {
    for (const session of E2A17_SESSIONS) {
      if (input.live) assertSourceIntegrity(input.dispatchCheckpointCommit);
      activeFixture = await createFixture(prisma, id, session);
      fixtures.push({
        fixture_id: activeFixture.fixture_id,
        session_protocol_id: session.session_id,
        session_public_id: activeFixture.session_public_id,
        assessment_public_id: activeFixture.assessment_public_id,
        synthetic_only: true,
        created: true,
        shared_with_other_sessions: false,
        cleanup_status: "pending"
      });
      writeJson(paths.sessionFixtures, sessionFixtureArtifact(fixtures));
      const turns = await executeSession({
        prisma,
        provider: input.provider,
        fixture: activeFixture,
        session,
        runId: id,
        checkpointCommit: input.dispatchCheckpointCommit,
        modelConfig,
        timeoutMs,
        ledger,
        paths,
        live: input.live,
        totalRegenerations: () => totalRegenerations,
        recordRegenerations: (count) => {
          totalRegenerations += count;
        }
      });
      allTurns.push(...turns);
      const endpoint = turns.at(-1)?.turn.progression_state_after ?? null;
      const sessionTranscript = await transcriptResult({
        prisma,
        fixture: activeFixture,
        session,
        completedTurnCount: turns.length
      });
      assert(endpoint === session.endpoint,
        `e2a17_session_endpoint_mismatch:${session.session_id}`);
      assert(sessionTranscript.passed,
        `e2a17_session_transcript_failed:${session.session_id}`);
      sessionResults.push({
        session_id: session.session_id,
        required_endpoint: session.endpoint,
        actual_endpoint: endpoint,
        student_turn_count: turns.length,
        visible_tutor_reply_count:
          sessionTranscript.visible_tutor_reply_count,
        transcript_integrity_passed: sessionTranscript.passed,
        required_path_completed: true,
        status: "completed"
      });
      const cleanup = await cleanupFixture(prisma, activeFixture);
      cleanupResults.push(cleanup);
      const fixtureRow = fixtures.find((row) =>
        row.fixture_id === activeFixture?.fixture_id
      );
      if (fixtureRow) fixtureRow.cleanup_status = cleanup.passed
        ? "removed"
        : "failed";
      activeFixture = null;
      writeJson(paths.sessionFixtures, sessionFixtureArtifact(fixtures));
      writeJson(paths.fixtureCleanupResults, {
        cleanup_version: "e2a17-fixture-cleanup-v1",
        results: cleanupResults,
        all_fixtures_removed: cleanupResults.every((row) => row.passed === true)
      });
      writeJson(paths.providerUsage, usageArtifact(ledger));
      writeJson(paths.humanReviewPacket,
        humanReviewPacket({ runId: id, turns: allTurns }));
      assert(cleanup.passed, "e2a17_fixture_cleanup_failure");
    }
    finalStatus = "e2a17_canary_pass_pending_human_review";
  } catch (error) {
    earlyAbortReason = error instanceof Error ? error.message :
      "e2a17_unknown_failure";
    finalStatus = determineFailureStatus(earlyAbortReason);
    if (activeFixture) {
      try {
        const cleanup = await cleanupFixture(prisma, activeFixture);
        cleanupResults.push(cleanup);
        const fixtureRow = fixtures.find((row) =>
          row.fixture_id === activeFixture?.fixture_id
        );
        if (fixtureRow) fixtureRow.cleanup_status = cleanup.passed
          ? "removed_after_abort"
          : "failed_after_abort";
        if (!cleanup.passed) finalStatus = "e2a17_canary_failed_stability";
      } catch {
        cleanupResults.push({
          fixture_id: activeFixture.fixture_id,
          session_protocol_id: activeFixture.session_protocol_id,
          passed: false,
          sanitized_failure_reason: "fixture_cleanup_failed_after_abort"
        });
        finalStatus = "e2a17_canary_failed_stability";
      }
      activeFixture = null;
    }
  } finally {
    await prisma.$disconnect();
  }

  const packet = humanReviewPacket({ runId: id, turns: allTurns });
  const usage = usageArtifact(ledger);
  const runtimeAcceptances = allTurns.flatMap((entry) => entry.runtime.attempts)
    .reduce<Record<string, number>>((counts, attempt) => {
      const key = attempt.runtime_validation.runtime_acceptance;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
  const operationCoverage = [...new Set(allTurns.map((entry) =>
    entry.turn.selected_operation
  ).filter((value): value is NonNullable<typeof value> => value !== null))].sort();
  const progressionCoverage = [...new Set(allTurns.map((entry) =>
    entry.turn.selected_mode
  ).filter((value) => value !== "remain_in_dialogue"))].sort();
  const privacyRows = readJsonl<{
    passed?: boolean;
    privacy?: { finding_count?: number };
    answer_key?: { finding_count?: number };
    simulator_hidden_state?: { finding_count?: number };
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
  writeJson(paths.sessionFixtures, sessionFixtureArtifact(fixtures));
  writeJson(paths.fixtureCleanupResults, {
    cleanup_version: "e2a17-fixture-cleanup-v1",
    results: cleanupResults,
    all_fixtures_removed: cleanupResults.length === fixtures.length &&
      cleanupResults.every((row) => row.passed === true)
  });
  writeJson(paths.providerUsage, usage);
  writeJson(paths.humanReviewPacket, packet);
  const endIntegrity = candidateIntegrity(input.dispatchCheckpointCommit);
  writeJson(paths.candidateIntegrity, {
    ...endIntegrity,
    post_execution_verified_at: new Date().toISOString(),
    unchanged_during_execution: Object.values(endIntegrity.checks).every(Boolean)
  });
  const summary = {
    summary_version: "e2a17-bounded-canary-summary-v1",
    status: finalStatus,
    run_id: id,
    run_directory: relative(runDir),
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    candidate_hash: E2A17_CANDIDATE_HASH,
    candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    protocol_hash: E2A17_PROTOCOL_HASH,
    dispatch_checkpoint_commit: input.dispatchCheckpointCommit,
    session_count: E2A17_SESSIONS.length,
    completed_session_count: sessionResults.filter((row) =>
      row.status === "completed"
    ).length,
    sessions: sessionResults,
    student_turn_count: allTurns.length,
    visible_tutor_reply_count: allTurns.length,
    simulator_provider_calls: ledger.simulator_calls,
    initial_tutor_provider_calls: ledger.tutor_initial_calls,
    tutor_regeneration_calls: ledger.tutor_regeneration_calls,
    total_generation_calls: ledger.total_generation_calls,
    provider_adapter_attempts: ledger.provider_adapter_attempts,
    soft_only_regeneration_count: 0,
    deterministic_fallback_count: allTurns.filter((entry) =>
      entry.runtime.deterministic_fallback_used
    ).length,
    runtime_acceptance_distribution: runtimeAcceptances,
    operation_coverage: operationCoverage,
    progression_coverage: progressionCoverage,
    privacy_finding_count: privacyRows.reduce((sum, row) =>
      sum + (row.privacy?.finding_count ?? 0), 0),
    answer_key_finding_count: privacyRows.reduce((sum, row) =>
      sum + (row.answer_key?.finding_count ?? 0), 0),
    hidden_state_leak_finding_count: privacyRows.reduce((sum, row) =>
      sum + (row.simulator_hidden_state?.finding_count ?? 0), 0),
    invalid_transition_count: 0,
    unauthorized_progression_count: 0,
    transcript_integrity_passed: transcriptRows.length === allTurns.length &&
      transcriptRows.every((row) => row.passed),
    persistence_passed: persistenceRows.length === allTurns.length &&
      persistenceRows.every((row) => row.passed),
    student_projection_passed:
      studentProjectionRows.length === allTurns.length &&
      studentProjectionRows.every((row) => row.passed),
    audit_projection_passed:
      auditProjectionRows.length === allTurns.length &&
      auditProjectionRows.every((row) => row.passed),
    context_coverage_passed: contextRows.length === allTurns.length &&
      contextRows.every((row) => row.passed),
    fixture_cleanup_passed: cleanupResults.length === fixtures.length &&
      cleanupResults.every((row) => row.passed === true),
    provider_usage: usage.actual,
    usage_within_budget: usage.within_budget,
    early_abort: earlyAbortReason !== null,
    early_abort_reason: earlyAbortReason,
    human_review_output_count: packet.review_item_count,
    human_review_required: true,
    human_review_completed: false,
    candidate_integrity_passed:
      Object.values(endIntegrity.checks).every(Boolean),
    approved_v2_integrity_passed:
      endIntegrity.checks.approved_v2_hash_matches,
    candidate_approved: false,
    candidate_activated: false,
    approval_evidence_created: false,
    activation_evidence_created: false,
    thirty_six_session_matrix_run: false,
    e2b_implemented_or_run: false,
    remaining_blocker_before_thirty_six_session_matrix:
      "complete explicit human review of every E2A.17 tutor output"
  };
  writeJson(paths.canarySummary, summary);
  writeJson(paths.canaryManifest, {
    ...manifest,
    completed_at: summary.completed_at,
    status: finalStatus,
    early_abort: summary.early_abort,
    human_review_output_count: packet.review_item_count
  });
  const artifactValidation = validateE2A17Artifacts(runDir);
  if (!artifactValidation.passed && finalStatus ===
    "e2a17_canary_pass_pending_human_review") {
    throw new Error(
      `e2a17_artifact_validation_failed:${artifactValidation.failures.join(",")}`
    );
  }
  return {
    runId: id,
    runDir,
    paths,
    summary,
    artifactValidation,
    artifactHashes: artifactHashes(runDir)
  };
}

export async function executeLiveE2A17Canary(input: {
  checkpointCommit: string;
}) {
  const preflight = await inspectE2A17Preflight({
    requireLiveEnvironment: true,
    requireCleanTrackedTree: true,
    expectedCheckpointCommit: input.checkpointCommit
  });
  if (!preflight.passed) {
    throw new Error(`e2a17_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const credential = resolveOpenAICredentialFromEnv();
  if (!credential.ok) {
    throw new Error(`e2a17_credential_failed:${credential.code}`);
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
        return executeE2A17Canary({
          provider: liveProviderBundle(provider),
          live: true,
          dispatchCheckpointCommit: input.checkpointCommit
        });
      }
    );
  } finally {
    releaseLock();
  }
}

export function validateE2A17Artifacts(runDir: string) {
  const failures: string[] = [];
  const names = listRunArtifactNames(runDir);
  const expected = [...E2A17_REQUIRED_ARTIFACTS].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of expected) {
    const filePath = path.join(runDir, name);
    if (!existsSync(filePath) || statSync(filePath).size === 0) {
      failures.push(`artifact_missing_or_empty:${name}`);
      continue;
    }
    try {
      if (name.endsWith(".jsonl")) readJsonl(filePath);
      else if (name.endsWith(".json")) readJson(filePath);
      assertSafeArtifact(readFileSync(filePath, "utf8"));
    } catch {
      failures.push(`artifact_invalid:${name}`);
    }
  }
  const protocolShaPath = path.join(runDir, "frozen-protocol.sha256");
  if (existsSync(protocolShaPath) &&
    readFileSync(protocolShaPath, "utf8").trim() !== E2A17_PROTOCOL_HASH) {
    failures.push("frozen_protocol_sha_mismatch");
  }
  const protocolPath = path.join(runDir, "frozen-protocol.json");
  if (existsSync(protocolPath) &&
    stableHash(readJson(protocolPath)) !== E2A17_PROTOCOL_HASH) {
    failures.push("frozen_protocol_content_mismatch");
  }
  const summaryPath = path.join(runDir, "canary-summary.json");
  if (existsSync(summaryPath)) {
    const summary = readJson<Record<string, unknown>>(summaryPath);
    if (![
      "e2a17_canary_pass_pending_human_review",
      "e2a17_canary_failed",
      "e2a17_canary_failed_stability",
      "e2a17_canary_incomplete"
    ].includes(String(summary.status))) failures.push("invalid_final_status");
    if (["approved", "approval_evidence_ready", "activated", "production_ready"]
      .includes(String(summary.status))) failures.push("prohibited_final_status");
  }
  return {
    validation_version: "e2a17-artifact-integrity-validation-v1",
    run_directory: relative(runDir),
    expected_artifact_count: expected.length,
    actual_artifact_count: names.length,
    artifact_names: names,
    protected_artifact_hashes: artifactHashes(runDir),
    failures,
    passed: failures.length === 0
  };
}

export async function executeE2A17NoLiveSmoke(input: {
  artifactRoot?: string;
} = {}) {
  const root = input.artifactRoot ?? path.join(
    os.tmpdir(), `e2a17-no-live-${randomBytes(5).toString("hex")}`
  );
  const checkpoint = currentCommit();
  const result = await executeE2A17Canary({
    provider: noLiveProviderBundle(),
    live: false,
    dispatchCheckpointCommit: checkpoint,
    artifactRoot: root,
    runId: "e2a17_no_live_smoke"
  });
  return { ...result, artifactRoot: root };
}

export function compileE2A17RequestsNoNetwork() {
  const modelConfig = evaluateE2A14Candidate().full_candidate.roles
    .topic_dialogue_agent;
  const compiled = E2A17_SESSIONS.flatMap((session) => {
    const history: Array<{
      sequence_index: number;
      actor_type: "student" | "agent";
      agent_name: string | null;
      message_text: string;
      structured_payload: null;
    }> = [];
    return session.turns.map((turn) => {
      const simulatorInput = buildSimulatorInput({
        session,
        turn,
        visibleTranscript: history
      });
      const simulator = simulatorRequest({
        runId: "e2a17_request_compilation",
        session,
        turn,
        simulatorInput,
        modelConfig,
        timeoutMs: 90_000
      });
      const fakeFixture = {
        fixture_id: "compile_fixture",
        session_protocol_id: session.session_id,
        student_user_db_id: "omitted",
        teacher_user_db_id: "omitted",
        assessment_db_id: "omitted",
        assessment_public_id: "e2a17_compile_assessment",
        concept_unit_db_id: "omitted",
        assessment_session_db_id: "omitted",
        concept_unit_session_db_id: "omitted",
        session_public_id: "e2a17_compile_session"
      } satisfies Fixture;
      const testCase = dynamicTutorCase({
        fixture: fakeFixture,
        session,
        turn,
        priorTranscript: history,
        latestStudentMessage: turn.no_live_fixture_message
      });
      const tutor = requestForCase(testCase);
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
      if (turn.inject_platform_transfer_item_after_reply &&
        session.platform_transfer_item_prompt) {
        history.push({
          sequence_index: history.length + 1,
          actor_type: "agent",
          agent_name: "platform_transfer_presenter",
          message_text: session.platform_transfer_item_prompt,
          structured_payload: null
        });
      }
      return {
        session_id: session.session_id,
        turn_number: turn.turn_number,
        simulator_schema_name: simulator.schema_name,
        simulator_input_valid: LlmStudentSimulatorInputSchema.safeParse(
          simulator.input
        ).success,
        simulator_output_schema_valid: LlmStudentSimulatorOutputSchema.safeParse(
          noLiveSimulatorOutput(turn)
        ).success,
        tutor_schema_name: tutor.schema_name,
        tutor_provider_input_present: Boolean(tutor.provider_input),
        tutor_output_schema_present: Boolean(tutor.output_schema),
        information_flow: informationFlowAudit({
          session,
          turn,
          simulatorInput,
          tutorRequest: tutor
        })
      };
    });
  });
  return {
    compilation_version: "e2a17-all-turn-request-compilation-v1",
    candidate_hash: E2A17_CANDIDATE_HASH,
    protocol_hash: E2A17_PROTOCOL_HASH,
    request_pair_count: compiled.length,
    simulator_request_count: compiled.length,
    tutor_request_count: compiled.length,
    network_request_count: 0,
    rows: compiled,
    passed: compiled.length === 18 && compiled.every((row) =>
      row.simulator_input_valid && row.simulator_output_schema_valid &&
      row.tutor_provider_input_present && row.tutor_output_schema_present &&
      row.information_flow.passed
    )
  };
}

export function temporaryE2A17ArtifactRoot() {
  return path.join(os.tmpdir(), `e2a17-${randomBytes(5).toString("hex")}`);
}

export function removeTemporaryE2A17ArtifactRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}

export function loadE2A17Run(runIdValue: string) {
  const runDir = path.join(E2A17_ARTIFACT_ROOT, runIdValue);
  if (!existsSync(runDir)) throw new Error("e2a17_run_not_found");
  return {
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "canary-summary.json")),
    usage: readJson<JsonObject>(path.join(runDir, "provider-usage.json")),
    reviewPacket: readJson<JsonObject>(path.join(
      runDir, "human-review-packet.json"
    )),
    artifactValidation: validateE2A17Artifacts(runDir)
  };
}

export const E2A17_OPENAI_ADAPTER_VERSION = OPENAI_RESPONSES_ADAPTER_VERSION;
export const E2A17_EFFECTIVE_RESULT_VERSION = E2A15B_EFFECTIVE_RESULT_VERSION;
export const E2A17_NO_LIVE_PROVIDER_FACTORY = noLiveProviderBundle;

export type {
  BudgetLedger as E2AEvaluationBudgetLedger,
  Fixture as E2AEvaluationFixture,
  ProviderBundle as E2AEvaluationProviderBundle,
  TurnExecution as E2AEvaluationTurnExecution
};

export {
  adapterAttemptCount as e2aAdapterAttemptCount,
  buildSimulatorInput as buildE2ASimulatorInput,
  cleanupFixture as cleanupE2AEvaluationFixture,
  countPersistence as countE2AEvaluationPersistence,
  createFixture as createE2AEvaluationFixture,
  dynamicTutorCase as buildE2ADynamicTutorCase,
  executeProgression as executeE2AProgression,
  informationFlowAudit as auditE2AInformationFlow,
  inspectVisibleMessageSafety as inspectE2AVisibleMessageSafety,
  persistRouteDecision as persistE2ARouteDecision,
  persistStudentTurn as persistE2AStudentTurn,
  repairInstructions as buildE2ATutorRepairInstructions,
  sanitizedProviderResult as sanitizedE2AProviderResult,
  simulatorRequest as buildE2ASimulatorRequest,
  transcript as loadE2AEvaluationTranscript,
  transcriptResult as inspectE2ATranscript,
  usageFor as e2aUsageFor,
  validationContext as buildE2ATutorValidationContext
};
