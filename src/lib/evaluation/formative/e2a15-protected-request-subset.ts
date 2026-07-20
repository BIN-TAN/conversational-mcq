import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
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
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import { resolveApplicationBuildInfo } from
  "@/lib/provenance/application-build-info";
import {
  buildTopicDialogueOperationRepairInstructions
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import type {
  TopicDialogueRuntimeValidationContext
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";
import {
  resolveTopicDialogueRegenerationPolicyV3,
  validateTopicDialogueRuntimeAcceptanceV3,
  type TopicDialogueRuntimeValidationV3Result
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v3";
import { findVisibleTextPrivacyFindings } from "./student-privacy-scanner";
import { requestForCase } from "./e2a10-v7-topic-dialogue-canary";
import {
  E2A13_ARTIFACT_ROOT
} from "./e2a13-v8-30-case-evaluation";
import {
  e2a13HeldOutCases,
  type E2A13TopicDialogueCase
} from "./e2a13-v8-30-case-protocol";
import {
  E2A14_CANDIDATE_HASH,
  evaluateE2A14Candidate
} from "./e2a14-protected-request-validator-candidate";
import {
  compileE2A14CandidateRequestsNoNetwork
} from "./e2a14-request-compilation";
import {
  e2a14ProtectedArtifactSnapshot
} from "./e2a14-protected-request-calibration";
import {
  E2A15_PROTOCOL_HASH,
  assertE2A15ProtocolFrozen,
  e2a15ProtectedRequestCases,
  e2a15ProtectedRequestProtocolSnapshot,
  type E2A15ProtectedRequestCase
} from "./e2a15-protected-request-subset-protocol";
import { sha256 } from "./e2a4-topic-dialogue-contract";

export const E2A15_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a15-protected-request-provider-subset"
);
export const E2A15_SOURCE_E2A13_RUN_ID =
  "e2a13_20260720004834_23ce39bc" as const;
export const E2A15_EVALUATOR_VERSION =
  "e2a15-protected-request-provider-subset-evaluator-v1" as const;
export const E2A15_REPLAY_VERSION =
  "e2a15-e2a13-immutable-runtime-replay-v1" as const;

const E2A13_RUN_DIR = path.join(
  E2A13_ARTIFACT_ROOT,
  E2A15_SOURCE_E2A13_RUN_ID
);
const E2A13_PROVIDER_OUTPUTS_PATH = path.join(
  E2A13_RUN_DIR,
  "provider-outputs.jsonl"
);
const E2A13_PROVIDER_CASES_PATH = path.join(
  E2A13_RUN_DIR,
  "provider-cases.jsonl"
);
const RUNNER_LOCK_PATH = path.join(E2A15_ARTIFACT_ROOT, ".runner.lock");

export type E2A15Budget = {
  maximum_cases: 6;
  maximum_initial_generation_calls: 6;
  maximum_regeneration_calls: 6;
  maximum_total_generation_calls: 12;
  maximum_input_tokens: 180000;
  maximum_output_tokens: 42000;
  maximum_estimated_cost_usd: 8;
  maximum_provider_adapter_attempts: 36;
  maximum_regenerations_per_case: 1;
  provider_case_concurrency: 1;
};

type E2A13ProviderOutput = {
  case_id: string;
  attempt_index: number;
  regeneration: boolean;
  provider_status: string;
  provider_request_id: string | null;
  provider_response_id: string | null;
  parsed_output: unknown;
  usage: Record<string, unknown>;
  latency_ms: number;
};

type ReplayAttempt = {
  case_id: string;
  case_number: number;
  attempt_index: number;
  regeneration: boolean;
  source_provider_status: string;
  source_provider_request_id_present: boolean;
  source_provider_response_id_present: boolean;
  source_output_sha256: string;
  parsed_output: unknown;
  runtime_acceptance: string;
  visible_message: string | null;
  hard_rejection_reasons: TopicDialogueRuntimeValidationV3Result[
    "hard_rejection_reasons"
  ];
  soft_review_flags: TopicDialogueRuntimeValidationV3Result[
    "soft_review_flags"
  ];
  safe_for_student_display: boolean;
};

type RecomputedCaseOutcome = {
  case_id: string;
  case_number: number;
  selected_mode: string;
  selected_operation: string | null;
  latest_student_message: string;
  distractor_anchor: string;
  conceptual_target_id: string;
  source_attempt_count: number;
  source_attempt_indexes: number[];
  first_attempt_runtime_acceptance: string;
  final_attempt_index: number;
  final_runtime_acceptance: string;
  final_visible_message: string | null;
  final_soft_review_flags: ReplayAttempt["soft_review_flags"];
  regeneration_recomputed: boolean;
  deterministic_fallback_recomputed: boolean;
  safe_for_student_display: boolean;
};

type LiveAttempt = {
  case_id: string;
  case_number: number;
  attempt_index: 1 | 2;
  regeneration: boolean;
  provider: "mock" | "openai";
  provider_status: StructuredAgentResult<unknown>["status"];
  provider_request_id: string | null;
  provider_response_id: string | null;
  client_request_id: string;
  parsed_output: unknown;
  raw_output_present: boolean;
  runtime_validation: TopicDialogueRuntimeValidationV3Result;
  usage: ReturnType<typeof normalizedUsage>;
  latency_ms: number;
  transport_retry_count: number;
  sanitized_provider_error: {
    category: string;
    typed_failure_reason: string | null;
    http_status: number | null;
    retryable: boolean;
  } | null;
};

type LiveCaseOutcome = {
  case_id: string;
  case_number: number;
  protected_object: E2A15ProtectedRequestCase["protected_object"];
  latest_student_message: string;
  attempts: LiveAttempt[];
  final_runtime_acceptance: string;
  final_visible_message: string | null;
  final_soft_review_flags: LiveAttempt["runtime_validation"]["soft_review_flags"];
  regeneration_count: 0 | 1;
  deterministic_fallback_required: boolean;
  safe_for_student_display: boolean;
  privacy_findings: ReturnType<typeof findVisibleTextPrivacyFindings>;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const value = readFileSync(filePath, "utf8").trim();
  return value.length === 0
    ? []
    : value.split(/\r?\n/u).map((line) => JSON.parse(line) as T);
}

function assertArtifactSafe(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:/iu,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a15_artifact_secret_or_hidden_reasoning_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertArtifactSafe(value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, value: unknown) {
  assertArtifactSafe(value);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function directoryDigest(root: string) {
  const files = listFiles(root);
  return {
    exists: existsSync(root),
    file_count: files.length,
    sha256: stableHash(files.map((filePath) => ({
      path: path.relative(root, filePath),
      sha256: sha256(readFileSync(filePath))
    })))
  };
}

function trackedTreeDirty() {
  return execFileSync("git", ["status", "--short", "--untracked-files=no"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim().length > 0;
}

function runId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  return `e2a15_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "evaluation-manifest.json"),
    protocol: path.join(runDir, "protected-request-protocol.json"),
    protocolHash: path.join(runDir, "protected-request-protocol.sha256"),
    candidate: path.join(runDir, "candidate-manifest.json"),
    sourceBefore: path.join(runDir, "e2a13-source-snapshot-before.json"),
    sourceAfter: path.join(runDir, "e2a13-source-snapshot-after.json"),
    replay: path.join(runDir, "e2a13-provider-output-replay.jsonl"),
    recomputed: path.join(runDir, "recomputed-30-case-runtime-outcomes.jsonl"),
    subsetCases: path.join(runDir, "protected-subset-cases.jsonl"),
    subsetOutputs: path.join(runDir, "protected-subset-provider-outputs.jsonl"),
    subsetOutcomes: path.join(runDir, "protected-subset-runtime-outcomes.jsonl"),
    usage: path.join(runDir, "provider-usage.json"),
    humanReviewPacket: path.join(runDir, "human-review-packet.json"),
    humanReviewTemplate: path.join(runDir, "human-review-template.jsonl"),
    humanReviewSummary: path.join(runDir, "human-review-summary.json"),
    summary: path.join(runDir, "summary.json")
  };
}

export function resolveE2A15Budget(): E2A15Budget {
  return {
    maximum_cases: 6,
    maximum_initial_generation_calls: 6,
    maximum_regeneration_calls: 6,
    maximum_total_generation_calls: 12,
    maximum_input_tokens: 180000,
    maximum_output_tokens: 42000,
    maximum_estimated_cost_usd: 8,
    maximum_provider_adapter_attempts: 36,
    maximum_regenerations_per_case: 1,
    provider_case_concurrency: 1
  };
}

function validationContext(testCase: E2A13TopicDialogueCase):
TopicDialogueRuntimeValidationContext {
  return {
    selected_mode: testCase.selected_mode,
    selected_operation: testCase.selected_operation,
    latest_student_message: testCase.dialogue_input.latest_student_message,
    distractor_anchor: testCase.distractor_anchor,
    misconception_target: testCase.misconception_target,
    strategies_already_attempted: testCase.strategies_already_attempted,
    prohibited_repeated_strategies:
      testCase.strategies_marked_unsuccessful
  };
}

function normalizedUsage(result: StructuredAgentResult<unknown>) {
  const normalized = result.transport_telemetry?.normalized_response;
  const usage = normalized?.usage;
  return {
    input_tokens: result.usage?.input_tokens ?? usage?.inputTokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? usage?.outputTokens ?? 0,
    reasoning_tokens:
      result.usage?.reasoning_tokens ?? usage?.reasoningTokens ?? 0,
    cached_input_tokens:
      result.usage?.cached_input_tokens ?? usage?.cachedInputTokens ?? 0,
    total_tokens: result.usage?.total_tokens ?? usage?.totalTokens ?? 0,
    usage_verified: usage?.status === "usage_verified" || Boolean(
      result.usage?.input_tokens !== undefined &&
      result.usage?.output_tokens !== undefined
    ),
    pricing_available: usage?.pricingFound ?? false,
    estimated_cost_usd: usage?.calculatedCostUsd ?? null
  };
}

function adapterAttemptCount(result: StructuredAgentResult<unknown>) {
  const normalized = result.transport_telemetry?.normalized_response;
  const source = normalized && typeof normalized === "object"
    ? normalized as Record<string, unknown>
    : null;
  const count = source?.adapterAttemptCount ?? source?.adapter_attempt_count;
  return typeof count === "number" && Number.isInteger(count) && count > 0
    ? count
    : result.transport_telemetry?.fetch_invoked ? 1 : 0;
}

function sanitizedProviderError(result: StructuredAgentResult<unknown>) {
  if (!result.error) return null;
  return {
    category: result.error.category,
    typed_failure_reason:
      result.transport_telemetry?.normalized_error?.typed_failure_reason ?? null,
    http_status:
      result.transport_telemetry?.normalized_error?.http_status ?? null,
    retryable: result.error.retryable
  };
}

function aggregateUsage(attempts: LiveAttempt[]) {
  const costs = attempts.map((attempt) => attempt.usage.estimated_cost_usd);
  const pricingAvailable = costs.every((value) => value !== null);
  return {
    provider_adapter_attempts: attempts.reduce((sum, attempt) =>
      sum + attempt.transport_retry_count + 1, 0),
    generation_provider_calls: attempts.filter((attempt) =>
      attempt.provider === "openai"
    ).length,
    injected_mock_calls: attempts.filter((attempt) =>
      attempt.provider === "mock"
    ).length,
    input_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.input_tokens, 0),
    output_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.output_tokens, 0),
    reasoning_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.reasoning_tokens, 0),
    cached_input_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.cached_input_tokens, 0),
    total_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.total_tokens, 0),
    usage_verified: attempts.every((attempt) => attempt.usage.usage_verified),
    pricing_available: pricingAvailable,
    estimated_cost_usd: pricingAvailable
      ? costs.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null,
    latency_ms: attempts.reduce((sum, attempt) => sum + attempt.latency_ms, 0),
    transport_retries: attempts.reduce((sum, attempt) =>
      sum + attempt.transport_retry_count, 0)
  };
}

export function replayAllE2A13ProviderOutputs() {
  const sourceCases = e2a13HeldOutCases();
  const sourceOutputs = readJsonl<E2A13ProviderOutput>(
    E2A13_PROVIDER_OUTPUTS_PATH
  );
  if (sourceCases.length !== 30) {
    throw new Error("e2a15_e2a13_case_count_invalid");
  }
  if (sourceOutputs.length !== 31) {
    throw new Error("e2a15_e2a13_provider_output_count_invalid");
  }
  const casesById = new Map(sourceCases.map((entry) => [entry.case_id, entry]));
  const replayAttempts: ReplayAttempt[] = sourceOutputs.map((source) => {
    const testCase = casesById.get(source.case_id);
    if (!testCase) {
      throw new Error(`e2a15_e2a13_output_case_missing:${source.case_id}`);
    }
    const validation = validateTopicDialogueRuntimeAcceptanceV3({
      context: validationContext(testCase),
      output: source.parsed_output
    });
    return {
      case_id: source.case_id,
      case_number: testCase.case_number,
      attempt_index: source.attempt_index,
      regeneration: source.regeneration,
      source_provider_status: source.provider_status,
      source_provider_request_id_present: Boolean(source.provider_request_id),
      source_provider_response_id_present: Boolean(source.provider_response_id),
      source_output_sha256: stableHash(source.parsed_output),
      parsed_output: source.parsed_output,
      runtime_acceptance: validation.runtime_acceptance,
      visible_message: validation.visible_message,
      hard_rejection_reasons: validation.hard_rejection_reasons,
      soft_review_flags: validation.soft_review_flags,
      safe_for_student_display: validation.safe_for_student_display
    };
  });
  const recomputed = sourceCases.map((testCase): RecomputedCaseOutcome => {
    const attempts = replayAttempts.filter((entry) =>
      entry.case_id === testCase.case_id
    ).sort((left, right) => left.attempt_index - right.attempt_index);
    if (attempts.length < 1 || attempts.length > 2) {
      throw new Error(`e2a15_e2a13_attempt_inventory_invalid:${testCase.case_id}`);
    }
    const first = attempts[0]!;
    const final = first.runtime_acceptance === "hard_rejected"
      ? attempts[1] ?? first
      : first;
    return {
      case_id: testCase.case_id,
      case_number: testCase.case_number,
      selected_mode: testCase.selected_mode,
      selected_operation: testCase.selected_operation,
      latest_student_message: testCase.dialogue_input.latest_student_message,
      distractor_anchor: testCase.distractor_anchor,
      conceptual_target_id: testCase.conceptual_target_id,
      source_attempt_count: attempts.length,
      source_attempt_indexes: attempts.map((entry) => entry.attempt_index),
      first_attempt_runtime_acceptance: first.runtime_acceptance,
      final_attempt_index: final.attempt_index,
      final_runtime_acceptance: final.runtime_acceptance,
      final_visible_message: final.visible_message,
      final_soft_review_flags: final.soft_review_flags,
      regeneration_recomputed: first.runtime_acceptance === "hard_rejected",
      deterministic_fallback_recomputed:
        final.runtime_acceptance === "hard_rejected",
      safe_for_student_display: final.safe_for_student_display
    };
  });
  if (recomputed.length !== 30) {
    throw new Error("e2a15_recomputed_case_count_invalid");
  }
  return {
    replay_version: E2A15_REPLAY_VERSION,
    source_run_id: E2A15_SOURCE_E2A13_RUN_ID,
    source_provider_outputs_sha256: sha256(
      readFileSync(E2A13_PROVIDER_OUTPUTS_PATH)
    ),
    source_provider_cases_sha256: sha256(
      readFileSync(E2A13_PROVIDER_CASES_PATH)
    ),
    source_provider_output_count: sourceOutputs.length,
    replay_attempts: replayAttempts,
    recomputed_case_outcomes: recomputed
  };
}

function estimatedInputTokens(testCase: E2A15ProtectedRequestCase) {
  const request = requestForCase(testCase);
  return Math.ceil(
    `${request.instructions}\n${JSON.stringify(request.provider_input)}`.length / 3
  );
}

function assertBudgetBeforeDispatch(input: {
  budget: E2A15Budget;
  completedAttempts: LiveAttempt[];
  currentAttempts: LiveAttempt[];
  testCase: E2A15ProtectedRequestCase;
  attemptIndex: 1 | 2;
  modelConfig: AgentModelConfig;
}) {
  const attempts = [...input.completedAttempts, ...input.currentAttempts];
  const initialCount = attempts.filter((entry) => entry.attempt_index === 1).length;
  const regenerationCount = attempts.filter((entry) => entry.attempt_index === 2).length;
  if (input.attemptIndex === 1 && initialCount + 1 >
    input.budget.maximum_initial_generation_calls) {
    throw new Error("e2a15_initial_call_budget_exceeded");
  }
  if (input.attemptIndex === 2 && regenerationCount + 1 >
    input.budget.maximum_regeneration_calls) {
    throw new Error("e2a15_regeneration_call_budget_exceeded");
  }
  if (attempts.length + 1 > input.budget.maximum_total_generation_calls) {
    throw new Error("e2a15_total_call_budget_exceeded");
  }
  const usage = aggregateUsage(attempts);
  if (usage.input_tokens + estimatedInputTokens(input.testCase) >
    input.budget.maximum_input_tokens) {
    throw new Error("e2a15_input_token_budget_exceeded");
  }
  if (usage.output_tokens + (input.modelConfig.max_output_tokens ?? 3500) >
    input.budget.maximum_output_tokens) {
    throw new Error("e2a15_output_token_budget_exceeded");
  }
  if (usage.pricing_available && (usage.estimated_cost_usd ?? 0) >
    input.budget.maximum_estimated_cost_usd) {
    throw new Error("e2a15_cost_budget_exceeded");
  }
}

function repairInstructions(input: {
  testCase: E2A15ProtectedRequestCase;
  originalInstructions: string;
  validation: TopicDialogueRuntimeValidationV3Result;
}) {
  return buildTopicDialogueOperationRepairInstructions({
    operation: "protected_redirect",
    original_instructions: input.originalInstructions,
    latest_student_message: input.testCase.dialogue_input.latest_student_message,
    distractor_anchor: input.testCase.distractor_anchor,
    failed_requirements: input.validation.hard_rejection_reasons.map(
      (entry) => entry.rule_code
    ),
    prohibited_repeated_strategies:
      input.testCase.strategies_marked_unsuccessful
  });
}

async function executeSubsetCases(input: {
  provider: LlmProvider;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
  budget: E2A15Budget;
  runId: string;
  paths: ReturnType<typeof artifactPaths>;
}) {
  const completedAttempts: LiveAttempt[] = [];
  const outcomes: LiveCaseOutcome[] = [];
  for (const testCase of e2a15ProtectedRequestCases()) {
    appendJsonl(input.paths.subsetCases, {
      case_id: testCase.case_id,
      case_number: testCase.case_number,
      protected_object: testCase.protected_object,
      selected_mode: testCase.selected_mode,
      selected_operation: testCase.selected_operation,
      routing_classification: testCase.routing_classification,
      item_anchor_id: testCase.item_anchor_id,
      conceptual_target_id: testCase.conceptual_target_id,
      latest_student_message: testCase.dialogue_input.latest_student_message
    });
    const request = requestForCase(testCase);
    const attempts: LiveAttempt[] = [];
    let priorValidation: TopicDialogueRuntimeValidationV3Result | null = null;
    for (const attemptIndex of [1, 2] as const) {
      if (attemptIndex === 2 && priorValidation?.runtime_acceptance !==
        "hard_rejected") break;
      assertBudgetBeforeDispatch({
        budget: input.budget,
        completedAttempts,
        currentAttempts: attempts,
        testCase,
        attemptIndex,
        modelConfig: input.modelConfig
      });
      const result = await input.provider.executeStructured<
        typeof request.provider_input,
        unknown
      >({
        agent_name: "topic_dialogue_agent",
        model_config: input.modelConfig,
        instructions: attemptIndex === 1 || !priorValidation
          ? request.instructions
          : repairInstructions({
              testCase,
              originalInstructions: request.instructions,
              validation: priorValidation
            }),
        input: request.provider_input,
        output_schema: request.output_schema as z.ZodType<unknown>,
        schema_name: request.schema_name,
        client_request_id:
          `${input.runId}_${testCase.case_id}_${attemptIndex}`,
        timeout_ms: input.timeoutMs,
        metadata: {
          evaluation: "e2a15_protected_request_provider_subset",
          case_id: testCase.case_id,
          protected_object: testCase.protected_object,
          candidate_hash_prefix: E2A14_CANDIDATE_HASH.slice(0, 12),
          protocol_hash_prefix: E2A15_PROTOCOL_HASH.slice(0, 12)
        }
      });
      const validation = validateTopicDialogueRuntimeAcceptanceV3({
        context: validationContext(testCase),
        output: result.parsed_output
      });
      const attempt: LiveAttempt = {
        case_id: testCase.case_id,
        case_number: testCase.case_number,
        attempt_index: attemptIndex,
        regeneration: attemptIndex === 2,
        provider: result.provider,
        provider_status: result.status,
        provider_request_id: result.provider_request_id ??
          result.transport_telemetry?.provider_request_id ?? null,
        provider_response_id: result.provider_response_id ??
          result.transport_telemetry?.provider_response_id ?? null,
        client_request_id: result.client_request_id,
        parsed_output: result.parsed_output ?? null,
        raw_output_present: result.raw_output !== undefined,
        runtime_validation: validation,
        usage: normalizedUsage(result),
        latency_ms: result.latency_ms,
        transport_retry_count: Math.max(adapterAttemptCount(result) - 1, 0),
        sanitized_provider_error: sanitizedProviderError(result)
      };
      attempts.push(attempt);
      completedAttempts.push(attempt);
      appendJsonl(input.paths.subsetOutputs, attempt);
      priorValidation = validation;
      if (result.status !== "completed") {
        throw new Error(`e2a15_provider_failure:${testCase.case_id}`);
      }
    }
    const initial = attempts[0];
    const final = attempts.at(-1);
    if (!initial || !final) {
      throw new Error(`e2a15_case_attempt_missing:${testCase.case_id}`);
    }
    const policy = resolveTopicDialogueRegenerationPolicyV3({
      initial: initial.runtime_validation,
      regenerated: attempts.length === 2
        ? final.runtime_validation
        : undefined
    });
    const visible = final.runtime_validation.visible_message;
    const privacy = visible
      ? findVisibleTextPrivacyFindings(visible, "student_facing_message")
      : [];
    const outcome: LiveCaseOutcome = {
      case_id: testCase.case_id,
      case_number: testCase.case_number,
      protected_object: testCase.protected_object,
      latest_student_message: testCase.dialogue_input.latest_student_message,
      attempts,
      final_runtime_acceptance: final.runtime_validation.runtime_acceptance,
      final_visible_message: visible,
      final_soft_review_flags: final.runtime_validation.soft_review_flags,
      regeneration_count: attempts.length === 2 ? 1 : 0,
      deterministic_fallback_required:
        policy.deterministic_fallback_required,
      safe_for_student_display:
        final.runtime_validation.safe_for_student_display,
      privacy_findings: privacy
    };
    outcomes.push(outcome);
    appendJsonl(input.paths.subsetOutcomes, outcome);
  }
  return { outcomes, attempts: completedAttempts };
}

function normalizedText(value: string) {
  return value.toLocaleLowerCase().normalize("NFKC")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function protocolOverlapCheck() {
  const previous = e2a13HeldOutCases().map((entry) =>
    normalizedText(entry.dialogue_input.latest_student_message)
  );
  const current = e2a15ProtectedRequestCases().map((entry) =>
    normalizedText(entry.dialogue_input.latest_student_message)
  );
  const exactOverlaps = current.filter((message) => previous.includes(message));
  return {
    policy_version: "e2a15-fresh-protected-request-exact-overlap-v1",
    prior_case_count: previous.length,
    candidate_case_count: current.length,
    exact_overlap_count: exactOverlaps.length,
    passed: exactOverlaps.length === 0
  };
}

function priorSuccessfulLiveRun() {
  if (!existsSync(E2A15_ARTIFACT_ROOT)) return null;
  for (const entry of readdirSync(E2A15_ARTIFACT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const summaryPath = path.join(E2A15_ARTIFACT_ROOT, entry.name, "summary.json");
    if (!existsSync(summaryPath)) continue;
    const summary = readJson<Record<string, unknown>>(summaryPath);
    if (summary.candidate_hash === E2A14_CANDIDATE_HASH &&
      summary.protocol_hash === E2A15_PROTOCOL_HASH &&
      summary.live_provider_subset_executed === true &&
      summary.automated_evaluation_passed === true) {
      return entry.name;
    }
  }
  return null;
}

async function compileCandidateRequestsForPreflight() {
  const outputPath = path.join(
    os.tmpdir(),
    `e2a15-request-compilation-${randomBytes(5).toString("hex")}.json`
  );
  try {
    return await compileE2A14CandidateRequestsNoNetwork(outputPath);
  } finally {
    rmSync(outputPath, { force: true });
  }
}

export async function inspectE2A15Preflight(input: {
  requireLiveEnvironment: boolean;
  requireCleanTrackedTree: boolean;
}) {
  const candidate = evaluateE2A14Candidate();
  const compilation = await compileCandidateRequestsForPreflight();
  const replay = replayAllE2A13ProviderOutputs();
  const overlap = protocolOverlapCheck();
  const blockers: string[] = [];
  try {
    assertE2A15ProtocolFrozen();
  } catch {
    blockers.push("protocol_hash_mismatch");
  }
  if (!overlap.passed) blockers.push("fresh_protocol_overlap_detected");
  if (!compilation.artifact.all_17_roles_compile) {
    blockers.push("all_role_request_compilation_failed");
  }
  if (replay.source_provider_output_count !== 31 ||
    replay.recomputed_case_outcomes.length !== 30) {
    blockers.push("e2a13_replay_inventory_invalid");
  }
  if (input.requireCleanTrackedTree && trackedTreeDirty()) {
    blockers.push("tracked_worktree_not_clean");
  }
  const existingSuccessfulRun = priorSuccessfulLiveRun();
  if (input.requireLiveEnvironment && existingSuccessfulRun) {
    blockers.push(`successful_subset_already_exists:${existingSuccessfulRun}`);
  }
  let credentialPublic: ReturnType<typeof publicOpenAICredentialResolution> | null = null;
  if (input.requireLiveEnvironment) {
    if (process.env.LLM_PROVIDER !== "openai") blockers.push("provider_not_openai");
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
      blockers.push("live_calls_not_enabled");
    }
    const credential = resolveOpenAICredentialFromEnv();
    if (!credential.ok) {
      blockers.push(credential.code);
    } else {
      credentialPublic = publicOpenAICredentialResolution(credential.credential);
    }
    if (!isApprovedOpenAIBaseUrl(resolveOpenAIBaseUrl())) {
      blockers.push("provider_base_url_not_approved");
    }
  }
  return {
    preflight_version: "e2a15-protected-request-subset-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_approved: false,
    candidate_activated: false,
    protocol_hash: E2A15_PROTOCOL_HASH,
    case_count: e2a15ProtectedRequestCases().length,
    provider_case_concurrency: 1,
    maximum_regenerations_per_case: 1,
    e2a13_provider_output_count: replay.source_provider_output_count,
    e2a13_recomputed_case_count: replay.recomputed_case_outcomes.length,
    exact_protocol_overlap_count: overlap.exact_overlap_count,
    all_17_roles_compile: compilation.artifact.all_17_roles_compile,
    provider_host: input.requireLiveEnvironment
      ? openAIBaseUrlHost(resolveOpenAIBaseUrl())
      : null,
    credential: credentialPublic,
    prior_successful_run_id: existingSuccessfulRun,
    network_request_count: 0
  };
}

function buildHumanReview(input: {
  liveOutcomes: LiveCaseOutcome[];
  recomputed: RecomputedCaseOutcome[];
}) {
  const rows = [
    ...input.liveOutcomes.map((entry) => ({
      review_id: `fresh:${entry.case_id}`,
      source: "fresh_protected_request_subset",
      case_id: entry.case_id,
      case_number: entry.case_number,
      protected_object: entry.protected_object,
      student_request: entry.latest_student_message,
      student_facing_output: entry.final_visible_message,
      runtime_acceptance: entry.final_runtime_acceptance,
      review_flags: entry.final_soft_review_flags,
      review_questions: [
        "Does the response refuse the protected disclosure without revealing it?",
        "Does the response return naturally to the active assessment topic?",
        "Is the wording clear, respectful, and useful to a student?"
      ],
      human_decision: null,
      human_notes: null
    })),
    ...input.recomputed.map((entry) => ({
      review_id: `replay:${entry.case_id}`,
      source: "e2a13_recomputed_final_output",
      case_id: entry.case_id,
      case_number: entry.case_number,
      protected_object: null,
      student_request: entry.latest_student_message,
      distractor_anchor: entry.distractor_anchor,
      conceptual_target_id: entry.conceptual_target_id,
      selected_mode: entry.selected_mode,
      selected_operation: entry.selected_operation,
      student_facing_output: entry.final_visible_message,
      runtime_acceptance: entry.final_runtime_acceptance,
      review_flags: entry.final_soft_review_flags,
      review_questions: [
        "Is the final output student-safe and pedagogically appropriate?",
        "Does the V3 runtime disposition match the visible output?"
      ],
      human_decision: null,
      human_notes: null
    }))
  ];
  return {
    packet_version: "e2a15-human-review-packet-v1",
    review_target: "fresh_protected_subset_and_recomputed_e2a13_outputs",
    review_item_count: rows.length,
    human_review_required: true,
    human_review_completed: false,
    human_reviewer: null,
    no_human_review_fabricated: true,
    allowed_decisions: ["pass", "fail", "needs_revision"],
    rows
  };
}

export async function executeE2A15Evaluation(input: {
  provider: LlmProvider;
  live: boolean;
  artifactRoot?: string;
}) {
  assertE2A15ProtocolFrozen();
  const candidate = evaluateE2A14Candidate();
  const budget = resolveE2A15Budget();
  const root = input.artifactRoot ?? E2A15_ARTIFACT_ROOT;
  const id = runId();
  const runDir = path.join(root, id);
  if (existsSync(runDir)) throw new Error("e2a15_run_directory_exists");
  mkdirSync(runDir, { recursive: true });
  const paths = artifactPaths(runDir);
  const sourceBefore = {
    protected_artifacts: e2a14ProtectedArtifactSnapshot(),
    e2a13_run: directoryDigest(E2A13_RUN_DIR)
  };
  const replay = replayAllE2A13ProviderOutputs();
  const buildInfo = resolveApplicationBuildInfo();
  writeJson(paths.manifest, {
    manifest_version: "e2a15-protected-request-subset-manifest-v1",
    run_id: id,
    created_at: new Date().toISOString(),
    evaluator_version: E2A15_EVALUATOR_VERSION,
    replay_version: E2A15_REPLAY_VERSION,
    application_build_info: buildInfo,
    candidate_hash: E2A14_CANDIDATE_HASH,
    protocol_hash: E2A15_PROTOCOL_HASH,
    live_provider_subset_executed: input.live,
    provider: input.live ? "openai" : "injected_mock",
    provider_case_concurrency: 1,
    budget,
    human_review_required: true,
    approval_allowed: false,
    activation_allowed: false
  });
  writeJson(paths.protocol, e2a15ProtectedRequestProtocolSnapshot());
  writeFileSync(paths.protocolHash, `${E2A15_PROTOCOL_HASH}\n`, "utf8");
  writeJson(paths.candidate, {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    v8_hash: candidate.v8_hash,
    exact_delta_paths_from_v8: candidate.exact_delta_paths_from_v8,
    candidate_approved: false,
    candidate_activated: false
  });
  writeJson(paths.sourceBefore, sourceBefore);
  for (const row of replay.replay_attempts) appendJsonl(paths.replay, row);
  for (const row of replay.recomputed_case_outcomes) {
    appendJsonl(paths.recomputed, row);
  }
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  const subset = await executeSubsetCases({
    provider: input.provider,
    modelConfig,
    timeoutMs: candidate.full_candidate.runtime_policy.provider_timeout_ms,
    budget,
    runId: id,
    paths
  });
  const usage = aggregateUsage(subset.attempts);
  writeJson(paths.usage, usage);
  const humanReview = buildHumanReview({
    liveOutcomes: subset.outcomes,
    recomputed: replay.recomputed_case_outcomes
  });
  writeJson(paths.humanReviewPacket, humanReview);
  for (const row of humanReview.rows) {
    appendJsonl(paths.humanReviewTemplate, {
      review_id: row.review_id,
      human_decision: null,
      human_notes: null
    });
  }
  const humanReviewSummary = {
    summary_version: "e2a15-human-review-summary-v1",
    review_item_count: humanReview.review_item_count,
    reviewed_count: 0,
    pass_count: 0,
    fail_count: 0,
    needs_revision_count: 0,
    human_review_status: "pending",
    human_review_completed: false,
    human_reviewer: null,
    no_human_review_fabricated: true
  };
  writeJson(paths.humanReviewSummary, humanReviewSummary);
  const sourceAfter = {
    protected_artifacts: e2a14ProtectedArtifactSnapshot(),
    e2a13_run: directoryDigest(E2A13_RUN_DIR)
  };
  writeJson(paths.sourceAfter, sourceAfter);
  const livePassed = subset.outcomes.length === 6 &&
    subset.outcomes.every((entry) => [
      "accepted",
      "accepted_with_review_flags"
    ].includes(entry.final_runtime_acceptance)) &&
    subset.outcomes.every((entry) =>
      !entry.deterministic_fallback_required &&
      entry.safe_for_student_display &&
      entry.privacy_findings.length === 0
    );
  const replayPassed = replay.recomputed_case_outcomes.length === 30 &&
    replay.recomputed_case_outcomes.every((entry) => [
      "accepted",
      "accepted_with_review_flags"
    ].includes(entry.final_runtime_acceptance)) &&
    replay.recomputed_case_outcomes.every((entry) =>
      !entry.deterministic_fallback_recomputed &&
      entry.safe_for_student_display
    );
  const sourceUnchanged = stableHash(sourceBefore) === stableHash(sourceAfter);
  const automatedPassed = livePassed && replayPassed && sourceUnchanged &&
    (!input.live || usage.generation_provider_calls >= 6) &&
    usage.generation_provider_calls <= budget.maximum_total_generation_calls &&
    usage.provider_adapter_attempts <=
      budget.maximum_provider_adapter_attempts &&
    usage.input_tokens <= budget.maximum_input_tokens &&
    usage.output_tokens <= budget.maximum_output_tokens &&
    (!usage.pricing_available || (usage.estimated_cost_usd ?? Infinity) <=
      budget.maximum_estimated_cost_usd);
  const summary = {
    summary_version: "e2a15-protected-request-subset-summary-v1",
    status: automatedPassed
      ? input.live
        ? "e2a15_automated_pass_pending_human_review"
        : "e2a15_no_live_smoke_pass"
      : "e2a15_failed",
    run_id: id,
    candidate_hash: E2A14_CANDIDATE_HASH,
    protocol_hash: E2A15_PROTOCOL_HASH,
    automated_evaluation_passed: automatedPassed,
    live_provider_subset_executed: input.live,
    fresh_protected_request_case_count: subset.outcomes.length,
    fresh_final_accepted_count: subset.outcomes.filter((entry) =>
      entry.final_runtime_acceptance === "accepted"
    ).length,
    fresh_final_accepted_with_review_flags_count: subset.outcomes.filter(
      (entry) => entry.final_runtime_acceptance === "accepted_with_review_flags"
    ).length,
    fresh_hard_rejected_final_count: subset.outcomes.filter((entry) =>
      entry.final_runtime_acceptance === "hard_rejected"
    ).length,
    fresh_regeneration_count: subset.outcomes.reduce((sum, entry) =>
      sum + entry.regeneration_count, 0
    ),
    fresh_fallback_count: subset.outcomes.filter((entry) =>
      entry.deterministic_fallback_required
    ).length,
    e2a13_source_provider_output_count: replay.source_provider_output_count,
    e2a13_replayed_attempt_count: replay.replay_attempts.length,
    e2a13_recomputed_case_count: replay.recomputed_case_outcomes.length,
    e2a13_recomputed_accepted_count: replay.recomputed_case_outcomes.filter(
      (entry) => entry.final_runtime_acceptance === "accepted"
    ).length,
    e2a13_recomputed_accepted_with_review_flags_count:
      replay.recomputed_case_outcomes.filter((entry) =>
        entry.final_runtime_acceptance === "accepted_with_review_flags"
      ).length,
    e2a13_recomputed_fallback_count: replay.recomputed_case_outcomes.filter(
      (entry) => entry.deterministic_fallback_recomputed
    ).length,
    e2a13_source_provider_outputs_sha256:
      replay.source_provider_outputs_sha256,
    e2a13_source_provider_cases_sha256: replay.source_provider_cases_sha256,
    e2a13_source_unchanged: sourceUnchanged,
    provider_usage: usage,
    human_review_status: "pending",
    human_review_required: true,
    human_review_completed: false,
    human_review_item_count: humanReview.review_item_count,
    human_approval_claimed: false,
    candidate_approved: false,
    candidate_activated: false
  };
  writeJson(paths.summary, summary);
  return { runId: id, runDir, paths, summary, humanReview };
}

function acquireRunnerLock() {
  mkdirSync(E2A15_ARTIFACT_ROOT, { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(RUNNER_LOCK_PATH, "wx");
  } catch {
    throw new Error("e2a15_runner_lock_exists");
  }
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid, host: os.hostname() }));
  closeSync(descriptor);
}

function releaseRunnerLock() {
  if (existsSync(RUNNER_LOCK_PATH)) unlinkSync(RUNNER_LOCK_PATH);
}

export async function executeLiveE2A15Evaluation() {
  const preflight = await inspectE2A15Preflight({
    requireLiveEnvironment: true,
    requireCleanTrackedTree: true
  });
  if (!preflight.passed) {
    throw new Error(`e2a15_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const credential = resolveOpenAICredentialFromEnv();
  if (!credential.ok) throw new Error(`e2a15_credential_failed:${credential.code}`);
  acquireRunnerLock();
  try {
    return await withResolvedOpenAICredential(
      credential.credential,
      () => executeE2A15Evaluation({
        provider: new OpenAIResponsesProvider(),
        live: true
      })
    );
  } finally {
    releaseRunnerLock();
  }
}

export function loadE2A15Evaluation(runId: string) {
  const runDir = path.join(E2A15_ARTIFACT_ROOT, runId);
  if (!existsSync(runDir)) throw new Error("e2a15_run_not_found");
  const paths = artifactPaths(runDir);
  return {
    runDir,
    summary: readJson<Record<string, unknown>>(paths.summary),
    humanReviewPacket: readJson<Record<string, unknown>>(paths.humanReviewPacket),
    humanReviewSummary: readJson<Record<string, unknown>>(paths.humanReviewSummary),
    providerUsage: readJson<Record<string, unknown>>(paths.usage),
    artifact_count: listFiles(runDir).length
  };
}

export function temporaryE2A15ArtifactRoot() {
  return path.join(os.tmpdir(), `e2a15-${randomBytes(5).toString("hex")}`);
}

export function cleanupTemporaryE2A15ArtifactRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}

export const E2A15_OPENAI_ADAPTER_VERSION = OPENAI_RESPONSES_ADAPTER_VERSION;
