import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentModelConfig } from "@/lib/llm/config";
import {
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
  applyCanonicalTopicDialogueActionGate,
  isTopicDialogueAuthorizationSummarySafe,
  normalizeTopicDialogueProgressionAction,
  topicDialogueAuthorizationAuditProjection
} from "@/lib/services/student-assessment/topic-dialogue-action-normalization";
import {
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
  TopicDialogueOutputV3Schema,
  topicDialogueOutputV3ToRuntimeV2,
  topicDialogueV3AuditProjection,
  validateTopicDialogueOutputV3,
  type TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import { buildContextCoverage } from "./e2a3-topic-dialogue-evaluation";
import {
  E2A4_APPROVED_V2_HASH,
  E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH
} from "./e2a4-topic-dialogue-contract";
import {
  E2A5_CANDIDATE_PATH,
  E2A5_FAILED_V4_FILE_SHA256,
  E2A5_FAILED_V4_HASH,
  E2A5_PROGRESSION_AUTHORIZATION_VERSION,
  E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
  E2A5_TOPIC_DIALOGUE_PROMPT_HASH,
  E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  E2A5_TOPIC_DIALOGUE_PROMPT_VERSION,
  E2A5_TOPIC_DIALOGUE_VALIDATOR_VERSION,
  detectUnauthorizedProgressionLanguage,
  evaluateE2A5Candidate,
  topicDialogueInputV3ToReadinessGateV2,
  topicDialogueInputV4ToV3,
  validateTopicDialogueOutputForE2A5
} from "./e2a5-topic-dialogue-progression-contract";
import {
  e2a5ProtectedArtifactSnapshot
} from "./e2a5-progression-adjudication";
import {
  buildE2A6AllRoleSchemaAudit,
  compileE2A6CandidateRequestsNoNetwork
} from "./e2a6-v5-request-compilation";
import {
  E2A6_PROTOCOL_VERSION,
  e2a6DispatchCanaryCases,
  e2a6FullProtocolCases,
  e2a6ProtocolHash,
  e2a6ProtocolSnapshot,
  type E2A6CasePhase,
  type E2A6TopicDialogueCase
} from "./e2a6-v5-topic-dialogue-protocol";
import {
  findVisibleTextPrivacyFindings,
  type StudentPrivacyFinding
} from "./student-privacy-scanner";

export const E2A6_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a6-v5-topic-dialogue-evaluation"
);
export const E2A6_CANDIDATE_HASH =
  "37e563710ae04ff1004f8e20b5484ee56189f964b0afb5ee5f818d324c11a712";
export const E2A6_CANDIDATE_FILE_SHA256 =
  "7e39e59c70c7f8c53e9c18a278835d5594df88eecaa96a0bee13b09d997dd87e";
export const E2A6_FAILED_V4_EVALUATION_SHA256 =
  "b5f07709010523298b32706790b32b4c3aa133952e3bdaf29207b514f9597d8f";
export const E2A6_EVALUATOR_VERSION =
  "e2a6-v5-topic-dialogue-evaluator-v1" as const;

const ACTIVE_APPROVAL_ROOT = path.join(
  process.cwd(),
  ".data",
  "operational-model-upgrade",
  "active-approval"
);
const ACTIVE_BUNDLE_PATH = path.join(
  ACTIVE_APPROVAL_ROOT,
  "active-approval-bundle.json"
);

type EvaluationStatus =
  | "provider_evidence_ready_for_human_review"
  | "candidate_evaluation_failed"
  | "candidate_evaluation_incomplete";

export type E2A6Budget = {
  maximum_cases: number;
  maximum_generation_calls: number;
  maximum_input_tokens: number;
  maximum_output_tokens: number;
  maximum_estimated_cost_usd: number;
  maximum_candidate_regenerations_per_case: 1;
  transport_retries: 0;
};

type RubricFinding = {
  dimension: string;
  status: "passed" | "failed";
  severity: "critical" | "major";
  evidence: string;
};

type E2A6ProviderAttempt = {
  attempt_index: number;
  regeneration: boolean;
  provider_request_status: string;
  provider_request_id: string | null;
  provider_response_id: string | null;
  provider_error: E2A6CaseResult["provider_error"];
  generation_dispatched: boolean;
  parsed_output_present: boolean;
  raw_output_present: boolean;
  raw_output_sha256: string | null;
  provider_output: TopicDialogueOutputV3 | null;
  schema_valid: boolean;
  schema_issues: Array<{ field_path: string; rule_code: string }>;
  candidate_valid: boolean;
  candidate_issues: E2A6CaseResult["candidate_issues"];
  normalization_status: string | null;
  normalization_rejection_code: string | null;
  usage: E2A6CaseResult["usage"];
  latency_ms: number;
};

type E2A6CaseResult = {
  case_id: string;
  source_case_id: string;
  category: string;
  phase: E2A6CasePhase;
  student_turn_count: number;
  tenth_turn: boolean;
  authorized_action: string;
  status: "passed_automated" | "failed" | "provider_failed" | "skipped_budget";
  adapter_attempts: number;
  generation_provider_calls: number;
  candidate_regenerations: number;
  provider_attempts: E2A6ProviderAttempt[];
  provider_request_status: string;
  provider_request_id: string | null;
  provider_response_id: string | null;
  provider_error: {
    category: string;
    message: string;
    retryable: boolean;
    typed_failure_reason: string | null;
    http_status: number | null;
  } | null;
  provider_output: TopicDialogueOutputV3 | null;
  schema_valid: boolean;
  schema_issues: Array<{ field_path: string; rule_code: string }>;
  candidate_valid: boolean;
  candidate_issues: Array<{
    field_path: string;
    rule_code: string;
    taxonomy_level: string;
    safe_detail: string;
  }>;
  platform_gate: ReturnType<typeof applyCanonicalTopicDialogueActionGate> | null;
  progression_taxonomy: Record<string, unknown>;
  context_coverage: ReturnType<typeof buildContextCoverage>;
  privacy_findings: StudentPrivacyFinding[];
  rubric: RubricFinding[];
  critical_findings: string[];
  major_findings: string[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cached_input_tokens: number;
    total_tokens: number;
    usage_verified: boolean;
    pricing_available: boolean;
    estimated_cost_usd: number | null;
  };
  latency_ms: number;
  human_review_required: true;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, value: unknown) {
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function relative(filePath: string) {
  return path.relative(process.cwd(), filePath) || ".";
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function artifactSecretScan(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /authorization\s*:/iu,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a6_artifact_secret_scan_failed");
  }
}

function activeBundle() {
  if (!existsSync(ACTIVE_BUNDLE_PATH)) {
    throw new Error("e2a6_active_approval_bundle_missing");
  }
  return readJson<{
    runtime_candidate_hash?: string;
    source_provider_run_id?: string;
    derived_evaluation_id?: string;
    evaluation_protocol_hash?: string;
    approval_evidence?: { path?: string; sha256?: string };
    approved_manifest?: { path?: string; sha256?: string };
  }>(ACTIVE_BUNDLE_PATH);
}

function filesContainingUnder(root: string, value: string) {
  return listFiles(root).filter((filePath) =>
    /\.json(?:l)?$/u.test(filePath) &&
    readFileSync(filePath, "utf8").includes(value)
  ).map(relative);
}

export function resolveE2A6CanaryBudget(
  env: NodeJS.ProcessEnv = process.env
): E2A6Budget {
  return resolveBudget(env, "CANARY", {
    maximum_cases: 5,
    maximum_generation_calls: 15,
    maximum_input_tokens: 150_000,
    maximum_output_tokens: 25_000,
    maximum_estimated_cost_usd: 8,
    maximum_candidate_regenerations_per_case: 1,
    transport_retries: 0
  });
}

export function resolveE2A6FullBudget(
  env: NodeJS.ProcessEnv = process.env
): E2A6Budget {
  return resolveBudget(env, "FULL", {
    maximum_cases: 30,
    maximum_generation_calls: 120,
    maximum_input_tokens: 600_000,
    maximum_output_tokens: 120_000,
    maximum_estimated_cost_usd: 25,
    maximum_candidate_regenerations_per_case: 1,
    transport_retries: 0
  });
}

function resolveBudget(
  env: NodeJS.ProcessEnv,
  scope: "CANARY" | "FULL",
  maximum: E2A6Budget
): E2A6Budget {
  const integer = (name: string, fallback: number, cap: number) => {
    const raw = env[`EVAL_E2A6_${scope}_${name}`];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0 || value > cap) {
      throw new Error(`e2a6_${scope.toLowerCase()}_${name.toLowerCase()}_invalid`);
    }
    return value;
  };
  const number = (name: string, fallback: number, cap: number) => {
    const raw = env[`EVAL_E2A6_${scope}_${name}`];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > cap) {
      throw new Error(`e2a6_${scope.toLowerCase()}_${name.toLowerCase()}_invalid`);
    }
    return value;
  };
  return {
    maximum_cases: integer("MAX_CASES", maximum.maximum_cases, maximum.maximum_cases),
    maximum_generation_calls: integer(
      "MAX_CALLS",
      maximum.maximum_generation_calls,
      maximum.maximum_generation_calls
    ),
    maximum_input_tokens: integer(
      "MAX_INPUT_TOKENS",
      maximum.maximum_input_tokens,
      maximum.maximum_input_tokens
    ),
    maximum_output_tokens: integer(
      "MAX_OUTPUT_TOKENS",
      maximum.maximum_output_tokens,
      maximum.maximum_output_tokens
    ),
    maximum_estimated_cost_usd: number(
      "MAX_COST_USD",
      maximum.maximum_estimated_cost_usd,
      maximum.maximum_estimated_cost_usd
    ),
    maximum_candidate_regenerations_per_case: 1,
    transport_retries: 0
  };
}

export async function inspectE2A6Preflight(input: {
  requireLiveEnvironment?: boolean;
  requireCleanTree?: boolean;
} = {}) {
  const candidate = evaluateE2A5Candidate();
  const active = activeBundle();
  const protectedSnapshot = e2a5ProtectedArtifactSnapshot();
  const schemaAudit = buildE2A6AllRoleSchemaAudit();
  const requestCompilation = await compileE2A6CandidateRequestsNoNetwork(
    path.join(os.tmpdir(), `e2a6-request-compilation-${randomBytes(4).toString("hex")}.json`)
  );
  const baseUrl = resolveOpenAIBaseUrl();
  const credential = input.requireLiveEnvironment
    ? resolveOpenAICredentialFromEnv(process.env)
    : null;
  const approvalMatches = filesContainingUnder(ACTIVE_APPROVAL_ROOT, E2A6_CANDIDATE_HASH);
  const blockers: string[] = [];
  const expectedV4Delta = [
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.input_schema_version",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.progression_authorization_version",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.prompt_hash",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.prompt_version",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.validator_version"
  ];
  if (candidate.candidate_configuration_hash !== E2A6_CANDIDATE_HASH) {
    blockers.push("candidate_hash_mismatch");
  }
  if (candidate.candidate_file_sha256 !== E2A6_CANDIDATE_FILE_SHA256) {
    blockers.push("candidate_file_sha_mismatch");
  }
  if (candidate.failed_v4_hash !== E2A5_FAILED_V4_HASH) {
    blockers.push("failed_v4_hash_mismatch");
  }
  if (candidate.failed_v4_file_sha256 !== E2A5_FAILED_V4_FILE_SHA256) {
    blockers.push("failed_v4_file_sha_mismatch");
  }
  if (protectedSnapshot.tracked_groups.failed_v4_evaluation.sha256 !==
    E2A6_FAILED_V4_EVALUATION_SHA256) {
    blockers.push("failed_v4_evaluation_changed");
  }
  if (active.runtime_candidate_hash !== E2A4_APPROVED_V2_HASH) {
    blockers.push("approved_v2_not_active");
  }
  if (approvalMatches.length > 0) {
    blockers.push("v5_approval_or_activation_evidence_exists");
  }
  if (JSON.stringify(candidate.exact_delta_paths_from_failed_v4) !==
    JSON.stringify(expectedV4Delta)) {
    blockers.push("undocumented_candidate_delta");
  }
  if (Object.keys(candidate.role_config_hashes).length !== 17) {
    blockers.push("role_inventory_mismatch");
  }
  if (!schemaAudit.all_candidate_role_schemas_compile) {
    blockers.push("candidate_role_schema_incompatible");
  }
  if (!requestCompilation.artifact.all_requests_ready_for_dispatch) {
    blockers.push("request_compilation_failed");
  }
  if (requestCompilation.artifact.network_request_count !== 0) {
    blockers.push("request_compilation_made_network_call");
  }
  const protocolCases = [
    ...e2a6DispatchCanaryCases(),
    ...e2a6FullProtocolCases()
  ];
  if (!protocolCases.every((entry) =>
    isTopicDialogueAuthorizationSummarySafe(
      entry.input.progression_authorization.authorization_evidence_summary
    ))) {
    blockers.push("authorization_summary_not_sanitized");
  }
  if (input.requireCleanTree) {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      encoding: "utf8"
    }).trim();
    if (status) blockers.push("tracked_worktree_not_clean");
  }
  if (input.requireLiveEnvironment) {
    if (process.env.EVAL_E2A6_LIVE_PROVIDER !== "1") {
      blockers.push("live_e2a6_opt_in_missing");
    }
    if (process.env.LLM_PROVIDER !== "openai") blockers.push("provider_not_openai");
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
      blockers.push("live_calls_not_enabled");
    }
    if (process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== E2A4_APPROVED_V2_HASH) {
      blockers.push("approved_config_hash_mismatch");
    }
    if (!isApprovedOpenAIBaseUrl(baseUrl)) {
      blockers.push("openai_base_url_not_approved");
    }
    if (!credential?.ok) blockers.push(credential?.code ?? "credential_missing");
  }
  return {
    preflight_version: "e2a6-v5-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: active.runtime_candidate_hash ?? null,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v4_file_sha256: candidate.failed_v4_file_sha256,
    failed_v4_evaluation_sha256:
      protectedSnapshot.tracked_groups.failed_v4_evaluation.sha256,
    protected_artifact_sha256: protectedSnapshot.aggregate_sha256,
    role_count: Object.keys(candidate.role_config_hashes).length,
    exact_delta_paths_from_failed_v4: candidate.exact_delta_paths_from_failed_v4,
    all_role_schema_audit_passed: schemaAudit.all_candidate_role_schemas_compile,
    request_compilation_passed:
      requestCompilation.artifact.all_requests_ready_for_dispatch,
    request_compilation_network_count:
      requestCompilation.artifact.network_request_count,
    authorization_summaries_sanitized: !blockers.includes(
      "authorization_summary_not_sanitized"
    ),
    candidate_approved: false,
    candidate_activated: false,
    existing_approval_or_activation_paths: approvalMatches,
    provider: input.requireLiveEnvironment ? "openai" : "not_checked",
    provider_host: input.requireLiveEnvironment
      ? openAIBaseUrlHost(baseUrl)
      : "not_checked",
    credential_configured: credential?.ok ?? false,
    credential_fingerprint_prefix: credential?.ok
      ? credential.credential.fingerprint_prefix
      : null,
    inherited_evidence: {
      source_provider_run_id: active.source_provider_run_id ?? null,
      source_derived_evaluation_id: active.derived_evaluation_id ?? null,
      evaluation_protocol_hash: active.evaluation_protocol_hash ?? null,
      approval_evidence_path: active.approval_evidence?.path ?? null,
      approval_evidence_sha256: active.approval_evidence?.sha256 ?? null,
      approved_manifest_path: active.approved_manifest?.path ?? null,
      approved_manifest_sha256: active.approved_manifest?.sha256 ?? null,
      semantics: "immutable_reference_only_not_new_candidate_approval"
    }
  };
}

function resultUsage(result: StructuredAgentResult<TopicDialogueOutputV3>) {
  const normalized = result.transport_telemetry?.normalized_response?.usage;
  return {
    input_tokens: result.usage?.input_tokens ?? normalized?.inputTokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? normalized?.outputTokens ?? 0,
    reasoning_tokens: result.usage?.reasoning_tokens ?? normalized?.reasoningTokens ?? 0,
    cached_input_tokens:
      result.usage?.cached_input_tokens ?? normalized?.cachedInputTokens ?? 0,
    total_tokens: result.usage?.total_tokens ?? normalized?.totalTokens ?? 0,
    usage_verified: normalized?.status === "usage_verified" || Boolean(
      result.usage?.input_tokens !== undefined &&
      result.usage?.output_tokens !== undefined
    ),
    pricing_available: normalized?.pricingFound ?? false,
    estimated_cost_usd: normalized?.calculatedCostUsd ?? null
  };
}

function sanitizedProviderError(
  result: StructuredAgentResult<TopicDialogueOutputV3>
): E2A6CaseResult["provider_error"] {
  const transportError = result.transport_telemetry?.normalized_error;
  return result.error
    ? {
        category: result.error.category,
        message: result.error.message,
        retryable: result.error.retryable,
        typed_failure_reason: transportError?.typed_failure_reason ?? null,
        http_status: transportError?.http_status ?? null
      }
    : null;
}

function aggregateAttemptUsage(attempts: E2A6ProviderAttempt[]) {
  return attempts.reduce((usage, attempt) => ({
    input_tokens: usage.input_tokens + attempt.usage.input_tokens,
    output_tokens: usage.output_tokens + attempt.usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens + attempt.usage.reasoning_tokens,
    cached_input_tokens:
      usage.cached_input_tokens + attempt.usage.cached_input_tokens,
    total_tokens: usage.total_tokens + attempt.usage.total_tokens,
    usage_verified: usage.usage_verified && attempt.usage.usage_verified,
    pricing_available: usage.pricing_available && attempt.usage.pricing_available,
    estimated_cost_usd:
      usage.estimated_cost_usd === null || attempt.usage.estimated_cost_usd === null
        ? null
        : usage.estimated_cost_usd + attempt.usage.estimated_cost_usd
  }), {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    usage_verified: true,
    pricing_available: true,
    estimated_cost_usd: 0 as number | null
  });
}

function buildProviderAttempt(input: {
  result: StructuredAgentResult<TopicDialogueOutputV3>;
  attemptIndex: number;
  testCase: E2A6TopicDialogueCase;
}): E2A6ProviderAttempt {
  const schemaValidation = input.result.parsed_output
    ? validateTopicDialogueOutputV3(input.result.parsed_output)
    : {
        valid: false as const,
        issues: [{ field_path: "output", rule_code: "schema_invalid" as const }]
      };
  const output = schemaValidation.valid ? schemaValidation.provider_output : null;
  const candidateValidation = output
    ? validateTopicDialogueOutputForE2A5({
        output,
        dialogue_input: input.testCase.input
      })
    : { valid: false as const, issues: [] };
  const normalization = output
    ? normalizeTopicDialogueProgressionAction({
        provider_action: output.next_action,
        authorization: input.testCase.input.progression_authorization
      })
    : null;
  return {
    attempt_index: input.attemptIndex,
    regeneration: input.attemptIndex > 1,
    provider_request_status: input.result.status,
    provider_request_id:
      input.result.provider_request_id ??
      input.result.transport_telemetry?.provider_request_id ??
      null,
    provider_response_id:
      input.result.provider_response_id ??
      input.result.transport_telemetry?.provider_response_id ??
      null,
    provider_error: sanitizedProviderError(input.result),
    generation_dispatched:
      input.result.transport_telemetry?.fetch_invoked === true,
    parsed_output_present: input.result.parsed_output !== undefined,
    raw_output_present: input.result.raw_output !== undefined,
    raw_output_sha256: input.result.raw_output === undefined
      ? null
      : stableHash(input.result.raw_output),
    provider_output: output,
    schema_valid: schemaValidation.valid,
    schema_issues: schemaValidation.issues,
    candidate_valid: candidateValidation.valid &&
      normalization !== null &&
      !normalization.status.startsWith("rejected_"),
    candidate_issues: candidateValidation.issues,
    normalization_status: normalization?.status ?? null,
    normalization_rejection_code: normalization?.rejection_code ?? null,
    usage: resultUsage(input.result),
    latency_ms: input.result.latency_ms
  };
}

function aggregateUsage(results: E2A6CaseResult[]) {
  return results.reduce((usage, result) => ({
    provider_adapter_attempts:
      usage.provider_adapter_attempts + result.adapter_attempts,
    generation_provider_calls:
      usage.generation_provider_calls + result.generation_provider_calls,
    metadata_only_requests: 0,
    input_tokens: usage.input_tokens + result.usage.input_tokens,
    output_tokens: usage.output_tokens + result.usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens + result.usage.reasoning_tokens,
    cached_input_tokens:
      usage.cached_input_tokens + result.usage.cached_input_tokens,
    total_tokens: usage.total_tokens + result.usage.total_tokens,
    latency_ms: usage.latency_ms + result.latency_ms,
    candidate_regenerations:
      usage.candidate_regenerations + result.candidate_regenerations,
    estimated_cost_usd:
      usage.estimated_cost_usd === null || result.usage.estimated_cost_usd === null
        ? null
        : usage.estimated_cost_usd + result.usage.estimated_cost_usd,
    complete_pricing_available:
      usage.complete_pricing_available && result.usage.pricing_available
  }), {
    provider_adapter_attempts: 0,
    generation_provider_calls: 0,
    metadata_only_requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    latency_ms: 0,
    candidate_regenerations: 0,
    estimated_cost_usd: 0 as number | null,
    complete_pricing_available: true
  });
}

function requestInputEstimate(testCase: E2A6TopicDialogueCase) {
  return Math.ceil(
    `${E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS}\n${JSON.stringify(testCase.input)}`.length / 3
  );
}

function assertBudgetBeforeCall(input: {
  budget: E2A6Budget;
  phaseResults: E2A6CaseResult[];
  currentCaseAttempts: E2A6ProviderAttempt[];
  testCase: E2A6TopicDialogueCase;
  modelConfig: AgentModelConfig;
}) {
  const phase = aggregateUsage(input.phaseResults);
  const current = aggregateAttemptUsage(input.currentCaseAttempts);
  const currentGenerationCalls = input.currentCaseAttempts.filter((attempt) =>
    attempt.generation_dispatched
  ).length;
  const inputReserve = requestInputEstimate(input.testCase);
  const outputReserve = input.modelConfig.max_output_tokens ?? 3500;
  const pricedAttempts = [
    ...input.phaseResults.flatMap((entry) => entry.provider_attempts),
    ...input.currentCaseAttempts
  ].filter((attempt) => attempt.usage.estimated_cost_usd !== null);
  const costReserve = pricedAttempts.length > 0
    ? pricedAttempts.reduce(
        (sum, attempt) => sum + (attempt.usage.estimated_cost_usd ?? 0),
        0
      ) / pricedAttempts.length
    : 0;
  if (input.phaseResults.length >= input.budget.maximum_cases) {
    throw new Error("e2a6_case_budget_exceeded");
  }
  if (phase.generation_provider_calls + currentGenerationCalls + 1 >
    input.budget.maximum_generation_calls) {
    throw new Error("e2a6_generation_call_budget_exceeded");
  }
  if (phase.input_tokens + current.input_tokens + inputReserve >
    input.budget.maximum_input_tokens) {
    throw new Error("e2a6_input_token_budget_insufficient");
  }
  if (phase.output_tokens + current.output_tokens + outputReserve >
    input.budget.maximum_output_tokens) {
    throw new Error("e2a6_output_token_budget_insufficient");
  }
  const currentCost = current.estimated_cost_usd;
  if (phase.complete_pricing_available &&
    current.pricing_available &&
    phase.estimated_cost_usd !== null &&
    currentCost !== null &&
    phase.estimated_cost_usd + currentCost + costReserve >
      input.budget.maximum_estimated_cost_usd) {
    throw new Error("e2a6_cost_budget_insufficient");
  }
}

function expectedProviderAction(action: string) {
  if (action === "request_revision") return "show_progression_choices";
  if (action === "present_transfer") return "continue_to_transfer";
  if (action === "complete_episode") return "end_assessment";
  return "await_topic_dialogue_response";
}

function invisibleHistoryReference(output: TopicDialogueOutputV3) {
  return /\b(?:hidden history|invisible (?:message|turn|draft)|internal turn id)\b/iu
    .test(`${output.tutor_message} ${output.student_safe_summary}`);
}

function authorizedActionLanguage(input: {
  action: E2A6TopicDialogueCase["expected_authorized_action"];
  message: string;
}) {
  const revision = /\b(?:revise|revision|rewrite|edit\s+(?:your|the)\s+(?:answer|claim|explanation|response))\b/iu
    .test(input.message);
  const transfer = /\b(?:transfer\s+(?:item|task|question|evidence)|apply\s+(?:this|the\s+distinction)\s+to\s+(?:another|a\s+new)\s+(?:item|question))\b/iu
    .test(input.message);
  const completion = /\b(?:(?:assessment|activity|episode)\s+is\s+complete|you(?:['’]re| are)\s+finished|end\s+the\s+assessment)\b/iu
    .test(input.message);
  const masteryOverclaim = /\b(?:mastered|fully\s+understand|definitively\s+resolved|misconception\s+(?:is|has\s+been)\s+resolved)\b/iu
    .test(input.message);
  const aligned = input.action === "remain_in_dialogue"
    ? !revision && !transfer && !completion
    : input.action === "request_revision"
      ? revision && !transfer && !completion
      : input.action === "present_transfer"
        ? transfer && !completion && !masteryOverclaim
        : completion && !masteryOverclaim;
  return { revision, transfer, completion, mastery_overclaim: masteryOverclaim, aligned };
}

function deterministicRubric(input: {
  testCase: E2A6TopicDialogueCase;
  output: TopicDialogueOutputV3 | null;
  candidateIssues: E2A6CaseResult["candidate_issues"];
  platformGate: E2A6CaseResult["platform_gate"];
  privacyFindings: StudentPrivacyFinding[];
  contextCoverage: ReturnType<typeof buildContextCoverage>;
}) {
  const findings: RubricFinding[] = [];
  const add = (
    dimension: string,
    passed: boolean,
    severity: RubricFinding["severity"],
    evidence: string
  ) => findings.push({
    dimension,
    status: passed ? "passed" : "failed",
    severity,
    evidence
  });
  const output = input.output;
  const context = input.contextCoverage;
  add("schema_adherence", Boolean(output), "critical", output
    ? "Validated topic-dialogue-output-v3."
    : "No validated provider output was available.");
  add(
    "exact_context_coverage",
    context.missing_visible_turn_ids.length === 0 &&
      context.duplicated_visible_turn_ids.length === 0 &&
      context.order_matches &&
      context.exact_content_matches &&
      context.latest_student_message_separate &&
      context.initial_activity_present &&
      context.invisible_history_excluded,
    "critical",
    "Exact visible-history IDs, order, content, latest-message separation, and activity presence were checked."
  );
  if (!output) return findings;
  const expectedAction = expectedProviderAction(
    input.testCase.expected_authorized_action
  );
  const unauthorizedLanguage = detectUnauthorizedProgressionLanguage(
    output.tutor_message,
    input.testCase.input.progression_authorization
  );
  const actionLanguage = authorizedActionLanguage({
    action: input.testCase.expected_authorized_action,
    message: output.tutor_message
  });
  const directFunction = input.testCase.expected_response_functions.includes(
    output.response_function
  );
  const strategyAdapted = !input.testCase.require_strategy_adaptation ||
    !input.testCase.prior_strategy_functions.includes(output.response_function);
  const candidateActionIssue = input.candidateIssues.some((issue) =>
    issue.rule_code === "recommendation_exceeds_authorization"
  );
  const anchorIssue = input.candidateIssues.some((issue) =>
    issue.rule_code === "distractor_anchor_lost"
  );
  const unsupportedIssue = input.candidateIssues.some((issue) =>
    issue.rule_code === "unsupported_understanding_treated_as_mastery"
  );
  const responseIssue = input.candidateIssues.some((issue) =>
    issue.rule_code === "direct_response_function_mismatch"
  );
  add(
    "authorization_alignment",
    output.next_action === expectedAction &&
      !candidateActionIssue &&
      input.platformGate?.rejected === false,
    "critical",
    `Expected ${expectedAction}; received ${output.next_action}.`
  );
  add(
    "student_facing_progression_alignment",
    unauthorizedLanguage.length === 0 && actionLanguage.aligned,
    "critical",
    unauthorizedLanguage.length || !actionLanguage.aligned
      ? unauthorizedLanguage.map((entry) => entry.pattern_label).join(",")
        || "authorized_action_language_missing_or_broadened"
      : "Visible progression language stayed within server authorization and expressed only the authorized action."
  );
  add(
    "direct_response",
    directFunction && !responseIssue,
    "major",
    `Latest-message function accepted=${directFunction}; response_function=${output.response_function}.`
  );
  add(
    "strategy_adaptation",
    strategyAdapted,
    "major",
    strategyAdapted
      ? "Response function did not repeat a listed failed strategy."
      : `Repeated prior strategy ${output.response_function}.`
  );
  add(
    "distractor_focus",
    !anchorIssue,
    "major",
    anchorIssue
      ? "Candidate validator reported distractor-anchor loss."
      : "Current reliability-validity distractor anchor remained present."
  );
  add(
    "unsupported_understanding",
    !unsupportedIssue && (!input.testCase.unsupported_understanding ||
      output.next_action === "await_topic_dialogue_response"),
    "critical",
    unsupportedIssue
      ? "Unsupported understanding was treated as progression evidence."
      : "Unsupported understanding remained in dialogue."
  );
  add(
    "recurrence_handling",
    !input.testCase.recurrence ||
      (output.next_action === "await_topic_dialogue_response" && directFunction),
    "major",
    "Recurrence requires direct help and continued dialogue."
  );
  add(
    "revision_transfer_separation",
    input.testCase.expected_authorized_action === "request_revision"
      ? output.next_action === "show_progression_choices"
      : input.testCase.expected_authorized_action === "present_transfer"
        ? output.next_action === "continue_to_transfer"
        : true,
    "critical",
    "Revision and transfer were evaluated as separate server-authorized actions."
  );
  add(
    "privacy",
    input.privacyFindings.length === 0,
    "critical",
    input.privacyFindings.length
      ? input.privacyFindings.map((entry) => entry.matched_label).join(",")
      : "Recursive visible-text privacy scan passed."
  );
  add(
    "invisible_history_reference",
    !invisibleHistoryReference(output),
    "critical",
    "Visible output was checked for references to hidden history."
  );
  return findings;
}

function makeCaseResult(input: {
  testCase: E2A6TopicDialogueCase;
  providerResult: StructuredAgentResult<TopicDialogueOutputV3>;
  providerAttempts: E2A6ProviderAttempt[];
}) : E2A6CaseResult {
  const schemaValidation = input.providerResult.parsed_output
    ? validateTopicDialogueOutputV3(input.providerResult.parsed_output)
    : {
        valid: false as const,
        issues: [{ field_path: "output", rule_code: "schema_invalid" as const }]
      };
  const output = schemaValidation.valid ? schemaValidation.provider_output : null;
  const candidateValidation = output
    ? validateTopicDialogueOutputForE2A5({
        output,
        dialogue_input: input.testCase.input
      })
    : { valid: false as const, issues: [] };
  const runtimeInput = topicDialogueInputV3ToReadinessGateV2(
    topicDialogueInputV4ToV3(input.testCase.input)
  );
  const platformGate = output
    ? applyCanonicalTopicDialogueActionGate({
        dialogue_input: runtimeInput,
        candidate_output: topicDialogueOutputV3ToRuntimeV2(output),
        authorization: input.testCase.input.progression_authorization
      })
    : null;
  const privacyFindings = output
    ? [
        ...findVisibleTextPrivacyFindings(output.tutor_message, "tutor_message"),
        ...findVisibleTextPrivacyFindings(
          output.student_safe_summary,
          "student_safe_summary"
        )
      ]
    : [];
  const contextCoverage = buildContextCoverage(input.testCase.context_case);
  const rubric = deterministicRubric({
    testCase: input.testCase,
    output,
    candidateIssues: candidateValidation.issues,
    platformGate,
    privacyFindings,
    contextCoverage
  });
  const critical = rubric.filter((entry) =>
    entry.status === "failed" && entry.severity === "critical"
  ).map((entry) => entry.dimension);
  const major = rubric.filter((entry) =>
    entry.status === "failed" && entry.severity === "major"
  ).map((entry) => entry.dimension);
  const providerError = sanitizedProviderError(input.providerResult);
  const completed = input.providerResult.status === "completed" &&
    schemaValidation.valid;
  const candidateValid = candidateValidation.valid &&
    platformGate?.rejected === false;
  const visibleProgression = output
    ? detectUnauthorizedProgressionLanguage(
        output.tutor_message,
        input.testCase.input.progression_authorization
      )
    : [];
  return {
    case_id: input.testCase.case_id,
    source_case_id: input.testCase.source_case_id,
    category: input.testCase.category,
    phase: input.testCase.phase,
    student_turn_count: input.testCase.student_turn_count,
    tenth_turn: input.testCase.tenth_turn,
    authorized_action: input.testCase.expected_authorized_action,
    status: completed && candidateValid && critical.length === 0 && major.length === 0
      ? "passed_automated"
      : completed
        ? "failed"
        : "provider_failed",
    adapter_attempts: input.providerAttempts.length,
    generation_provider_calls: input.providerAttempts.filter((attempt) =>
      attempt.generation_dispatched
    ).length,
    candidate_regenerations: input.providerAttempts.filter((attempt) =>
      attempt.regeneration
    ).length,
    provider_attempts: input.providerAttempts,
    provider_request_status: input.providerResult.status,
    provider_request_id:
      input.providerResult.provider_request_id ??
      input.providerResult.transport_telemetry?.provider_request_id ??
      null,
    provider_response_id:
      input.providerResult.provider_response_id ??
      input.providerResult.transport_telemetry?.provider_response_id ??
      null,
    provider_error: providerError,
    provider_output: output,
    schema_valid: schemaValidation.valid,
    schema_issues: schemaValidation.issues,
    candidate_valid: candidateValid,
    candidate_issues: candidateValidation.issues,
    platform_gate: platformGate,
    progression_taxonomy: {
      internal_recommendation: output
        ? normalizeTopicDialogueProgressionAction({
            provider_action: output.next_action,
            authorization: input.testCase.input.progression_authorization
          })
        : null,
      student_facing_progression_offer: {
        finding_count: visibleProgression.length,
        findings: visibleProgression
      },
      platform_authorization: topicDialogueAuthorizationAuditProjection(
        input.testCase.input.progression_authorization
      ),
      ui_progression_availability: {
        evaluated_as_controlled_projection: true,
        available: platformGate?.normalization.progression_allowed ?? false,
        action: platformGate?.normalization.effective_action ?? "remain_in_dialogue"
      },
      executed_transition: {
        occurred: false,
        reason: "provider_evaluation_does_not_execute_operational_commands"
      },
      terminal_completion: {
        occurred: false,
        reason: "provider_evaluation_does_not_mutate_assessment_state"
      }
    },
    context_coverage: contextCoverage,
    privacy_findings: privacyFindings,
    rubric,
    critical_findings: [...new Set(critical)],
    major_findings: [...new Set(major)],
    usage: aggregateAttemptUsage(input.providerAttempts),
    latency_ms: input.providerAttempts.reduce(
      (sum, attempt) => sum + attempt.latency_ms,
      0
    ),
    human_review_required: true
  };
}

function skippedResult(
  testCase: E2A6TopicDialogueCase,
  reason: string
): E2A6CaseResult {
  return {
    case_id: testCase.case_id,
    source_case_id: testCase.source_case_id,
    category: testCase.category,
    phase: testCase.phase,
    student_turn_count: testCase.student_turn_count,
    tenth_turn: testCase.tenth_turn,
    authorized_action: testCase.expected_authorized_action,
    status: "skipped_budget",
    adapter_attempts: 0,
    generation_provider_calls: 0,
    candidate_regenerations: 0,
    provider_attempts: [],
    provider_request_status: "not_dispatched",
    provider_request_id: null,
    provider_response_id: null,
    provider_error: null,
    provider_output: null,
    schema_valid: false,
    schema_issues: [{ field_path: "request", rule_code: reason }],
    candidate_valid: false,
    candidate_issues: [],
    platform_gate: null,
    progression_taxonomy: {},
    context_coverage: buildContextCoverage(testCase.context_case),
    privacy_findings: [],
    rubric: [],
    critical_findings: [],
    major_findings: [reason],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_input_tokens: 0,
      total_tokens: 0,
      usage_verified: false,
      pricing_available: false,
      estimated_cost_usd: null
    },
    latency_ms: 0,
    human_review_required: true
  };
}

function runId() {
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "").slice(0, 14);
  return `e2a6_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "evaluation-manifest.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    authorizationContract: path.join(runDir, "authorization-contract.json"),
    requestCompilation: path.join(runDir, "all-role-request-compilation.json"),
    protocol: path.join(runDir, "evaluation-protocol.json"),
    dispatchCanary: path.join(runDir, "dispatch-canary.json"),
    providerCases: path.join(runDir, "provider-cases.jsonl"),
    providerOutputs: path.join(runDir, "provider-outputs.jsonl"),
    candidateValidation: path.join(runDir, "candidate-validation.jsonl"),
    platformGateResults: path.join(runDir, "platform-gate-results.jsonl"),
    progressionTaxonomy: path.join(runDir, "progression-taxonomy.jsonl"),
    contextCoverage: path.join(runDir, "context-coverage.jsonl"),
    privacyResults: path.join(runDir, "privacy-results.jsonl"),
    deterministicRubric: path.join(runDir, "deterministic-rubric.jsonl"),
    providerUsage: path.join(runDir, "provider-usage.json"),
    humanReviewPacket: path.join(runDir, "human-review-packet.json"),
    candidateEvidenceDraft: path.join(runDir, "candidate-evidence-draft.json"),
    summary: path.join(runDir, "evaluation-summary.json"),
    protectedBefore: path.join(runDir, "protected-artifacts-before.json"),
    protectedAfter: path.join(runDir, "protected-artifacts-after.json")
  };
}

function writeIncrementalArtifacts(
  paths: ReturnType<typeof artifactPaths>,
  testCase: E2A6TopicDialogueCase,
  result: E2A6CaseResult
) {
  const providerCase = {
    case_id: testCase.case_id,
    source_case_id: testCase.source_case_id,
    phase: testCase.phase,
    category: testCase.category,
    student_turn_count: testCase.student_turn_count,
    tenth_turn: testCase.tenth_turn,
    input_schema_version: testCase.input.dialogue_schema_version,
    input_sha256: stableHash(testCase.input),
    latest_student_message: testCase.input.latest_student_message,
    active_focus_item: testCase.input.safe_item_context[0]?.item_number ?? null,
    active_focus_distractor: testCase.input.safe_item_context[0]?.option_label ?? null,
    authorization: topicDialogueAuthorizationAuditProjection(
      testCase.input.progression_authorization
    ),
    authorization_is_server_owned: true,
    expected_visible_turn_ids: result.context_coverage.expected_visible_turn_ids,
    hidden_prompt_persisted: false,
    private_profile_object_persisted: false
  };
  const providerOutputs = result.provider_attempts.length > 0
    ? result.provider_attempts.map((attempt) => ({
        case_id: result.case_id,
        phase: result.phase,
        attempt_index: attempt.attempt_index,
        regeneration: attempt.regeneration,
        provider_request_status: attempt.provider_request_status,
        provider_request_id: attempt.provider_request_id,
        provider_response_id: attempt.provider_response_id,
        provider_error: attempt.provider_error,
        generation_dispatched: attempt.generation_dispatched,
        parsed_validated_output: attempt.provider_output,
        audit_projection: attempt.provider_output
          ? topicDialogueV3AuditProjection(attempt.provider_output)
          : null,
        raw_provider_output_present: attempt.raw_output_present,
        raw_provider_output_sha256: attempt.raw_output_sha256,
        raw_provider_response_persisted: false,
        hidden_prompt_persisted: false,
        hidden_reasoning_persisted: false
      }))
    : [{
        case_id: result.case_id,
        phase: result.phase,
        attempt_index: null,
        regeneration: false,
        provider_request_status: result.provider_request_status,
        provider_request_id: null,
        provider_response_id: null,
        provider_error: result.provider_error,
        generation_dispatched: false,
        parsed_validated_output: null,
        audit_projection: null,
        raw_provider_output_present: false,
        raw_provider_output_sha256: null,
        raw_provider_response_persisted: false,
        hidden_prompt_persisted: false,
        hidden_reasoning_persisted: false
      }];
  artifactSecretScan([providerCase, providerOutputs, result]);
  appendJsonl(paths.providerCases, providerCase);
  for (const providerOutput of providerOutputs) {
    appendJsonl(paths.providerOutputs, providerOutput);
  }
  if (result.provider_attempts.length > 0) {
    for (const attempt of result.provider_attempts) {
      appendJsonl(paths.candidateValidation, {
        case_id: result.case_id,
        attempt_index: attempt.attempt_index,
        regeneration: attempt.regeneration,
        valid: attempt.candidate_valid,
        schema_valid: attempt.schema_valid,
        schema_issues: attempt.schema_issues,
        issues: attempt.candidate_issues,
        normalization_status: attempt.normalization_status,
        normalization_rejection_code: attempt.normalization_rejection_code,
        maximum_regenerations: 1
      });
    }
  } else {
    appendJsonl(paths.candidateValidation, {
      case_id: result.case_id,
      attempt_index: null,
      regeneration: false,
      valid: false,
      schema_valid: false,
      schema_issues: result.schema_issues,
      issues: [],
      normalization_status: null,
      normalization_rejection_code: null,
      maximum_regenerations: 1
    });
  }
  appendJsonl(paths.platformGateResults, {
    case_id: result.case_id,
    authorization: topicDialogueAuthorizationAuditProjection(
      testCase.input.progression_authorization
    ),
    normalization: result.platform_gate?.normalization ?? null,
    rejected: result.platform_gate?.rejected ?? null,
    overridden: result.platform_gate?.overridden ?? null,
    activity_active: result.platform_gate?.activity_active ?? null,
    student_projection_contains_authorization_fields: false
  });
  appendJsonl(paths.progressionTaxonomy, {
    case_id: result.case_id,
    ...result.progression_taxonomy
  });
  appendJsonl(paths.contextCoverage, result.context_coverage);
  appendJsonl(paths.privacyResults, {
    case_id: result.case_id,
    passed: result.privacy_findings.length === 0,
    findings: result.privacy_findings,
    answer_key_findings: [
      ...result.schema_issues,
      ...result.candidate_issues
    ].filter((entry) => entry.rule_code === "answer_key_leak")
  });
  appendJsonl(paths.deterministicRubric, {
    case_id: result.case_id,
    status: result.status,
    dimensions: result.rubric,
    critical_findings: result.critical_findings,
    major_findings: result.major_findings
  });
}

function repairInstructions(issues: E2A6CaseResult["candidate_issues"]) {
  const codes = [...new Set(issues.map((issue) => issue.rule_code))].join(", ");
  return `${E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS}\n\n` +
    "The previous structured response was rejected by the platform validator. " +
    `Correct these safe rule codes: ${codes || "schema_or_authorization_alignment"}. ` +
    "Return a fresh complete object and obey progression_authorization exactly.";
}

async function executeCases(input: {
  cases: E2A6TopicDialogueCase[];
  provider: LlmProvider;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
  budget: E2A6Budget;
  paths: ReturnType<typeof artifactPaths>;
  runPublicId: string;
}) {
  const results: E2A6CaseResult[] = [];
  for (const testCase of input.cases) {
    const providerAttempts: E2A6ProviderAttempt[] = [];
    let finalResult: StructuredAgentResult<TopicDialogueOutputV3> | null = null;
    let priorIssues: E2A6CaseResult["candidate_issues"] = [];
    try {
      for (let attempt = 0; attempt <= 1; attempt += 1) {
        assertBudgetBeforeCall({
          budget: input.budget,
          phaseResults: results,
          currentCaseAttempts: providerAttempts,
          testCase,
          modelConfig: input.modelConfig
        });
        finalResult = await input.provider.executeStructured({
          agent_name: "topic_dialogue_agent",
          model_config: input.modelConfig,
          instructions: attempt === 0
            ? E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS
            : repairInstructions(priorIssues),
          input: testCase.input,
          output_schema: TopicDialogueOutputV3Schema,
          schema_name: "topic_dialogue_output_v3",
          client_request_id:
            `${input.runPublicId}_${testCase.case_id}_${attempt + 1}`,
          timeout_ms: input.timeoutMs,
          metadata: {
            evaluation: "e2a6_v5_topic_dialogue_candidate",
            evaluation_phase: testCase.phase,
            case_id: testCase.case_id,
            authorized_action: testCase.expected_authorized_action,
            candidate_hash_prefix: E2A6_CANDIDATE_HASH.slice(0, 12)
          }
        });
        const attemptRecord = buildProviderAttempt({
          result: finalResult,
          attemptIndex: attempt + 1,
          testCase
        });
        providerAttempts.push(attemptRecord);
        if (finalResult.status !== "completed" || !attemptRecord.schema_valid) break;
        if (attemptRecord.candidate_valid) {
          break;
        }
        priorIssues = attemptRecord.candidate_issues;
      }
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "e2a6_budget_or_dispatch_block";
      if (finalResult && providerAttempts.length > 0) {
        const failed = makeCaseResult({
          testCase,
          providerResult: finalResult,
          providerAttempts
        });
        failed.status = "failed";
        failed.major_findings = [...new Set([
          ...failed.major_findings,
          `bounded_followup_not_dispatched:${reason}`
        ])];
        results.push(failed);
        writeIncrementalArtifacts(input.paths, testCase, failed);
        continue;
      }
      const skipped = skippedResult(testCase, reason);
      results.push(skipped);
      writeIncrementalArtifacts(input.paths, testCase, skipped);
      continue;
    }
    if (!finalResult) throw new Error("e2a6_provider_result_missing");
    const result = makeCaseResult({
      testCase,
      providerResult: finalResult,
      providerAttempts
    });
    results.push(result);
    writeIncrementalArtifacts(input.paths, testCase, result);
  }
  return results;
}

function dispatchCanarySummary(
  results: E2A6CaseResult[],
  budget: E2A6Budget
) {
  const usage = aggregateUsage(results);
  const attempts = results.flatMap((entry) => entry.provider_attempts);
  const passed = results.length === 5 && results.every((entry) =>
    entry.status === "passed_automated" &&
    entry.generation_provider_calls >= 1 &&
    entry.schema_valid &&
    entry.candidate_valid &&
    entry.privacy_findings.length === 0 &&
    entry.critical_findings.length === 0 &&
    entry.major_findings.length === 0
  ) && usage.generation_provider_calls <= budget.maximum_generation_calls &&
    usage.input_tokens <= budget.maximum_input_tokens &&
    usage.output_tokens <= budget.maximum_output_tokens &&
    (!usage.complete_pricing_available ||
      (usage.estimated_cost_usd ?? Infinity) <= budget.maximum_estimated_cost_usd);
  return {
    canary_version: "e2a6-v5-live-dispatch-canary-v1",
    passed,
    case_ids: results.map((entry) => entry.case_id),
    completed_case_count: results.filter((entry) =>
      entry.adapter_attempts > 0
    ).length,
    dispatched_case_count: results.filter((entry) =>
      entry.generation_provider_calls > 0
    ).length,
    passed_case_count: results.filter((entry) =>
      entry.status === "passed_automated"
    ).length,
    schema_valid_count: results.filter((entry) => entry.schema_valid).length,
    candidate_validation_failure_count: attempts.filter((attempt) =>
      !attempt.candidate_valid
    ).length,
    critical_finding_count: results.reduce(
      (sum, entry) => sum + entry.critical_findings.length,
      0
    ),
    major_finding_count: results.reduce(
      (sum, entry) => sum + entry.major_findings.length,
      0
    ),
    privacy_finding_count: results.reduce(
      (sum, entry) => sum + entry.privacy_findings.length,
      0
    ),
    usage,
    budget
  };
}

function reviewPacket(results: E2A6CaseResult[]) {
  const providerOutputCount = results.reduce(
    (sum, result) => sum + result.provider_attempts.filter((attempt) =>
      attempt.generation_dispatched
    ).length,
    0
  );
  const reviewItems = results.flatMap((result) =>
    result.provider_attempts.map((attempt) => ({
      review_id: `${result.case_id}_attempt_${attempt.attempt_index}`,
      case_id: result.case_id,
      source_case_id: result.source_case_id,
      phase: result.phase,
      category: result.category,
      student_turn_count: result.student_turn_count,
      tenth_turn: result.tenth_turn,
      authorized_action: result.authorized_action,
      attempt_index: attempt.attempt_index,
      regenerated_output: attempt.regeneration,
      provider_request_status: attempt.provider_request_status,
      generation_dispatched: attempt.generation_dispatched,
      schema_valid: attempt.schema_valid,
      candidate_valid: attempt.candidate_valid,
      tutor_message: attempt.provider_output?.tutor_message ?? null,
      response_function: attempt.provider_output?.response_function ?? null,
      evidence_sufficiency:
        attempt.provider_output?.evidence_sufficiency ?? null,
      next_action: attempt.provider_output?.next_action ?? null,
      context_coverage: result.context_coverage,
      automated_findings: [
        ...attempt.schema_issues.map((issue) => issue.rule_code),
        ...attempt.candidate_issues.map((issue) => issue.rule_code),
        ...result.critical_findings,
        ...result.major_findings
      ],
      human_scores: {
        direct_response: null,
        strategy_adaptation: null,
        distractor_focus: null,
        authorization_alignment: null,
        progression_language: null,
        unsupported_understanding: null,
        recurrence_handling: null,
        revision_transfer_boundary: null,
        privacy_and_answer_key_safety: null,
        natural_language_quality: null
      },
      human_decision: null,
      human_notes: null
    }))
  );
  return {
    packet_version: "e2a6-v5-topic-dialogue-human-review-packet-v1",
    review_status: "pending_human_review",
    reviewer_type_required: "human",
    llm_judge_used: false,
    provider_output_count: providerOutputCount,
    review_item_count: reviewItems.length,
    every_provider_output_included: reviewItems.filter((entry) =>
      entry.generation_dispatched
    ).length === providerOutputCount,
    selection_policy: [
      "all five dispatch-canary outputs",
      "all provider outputs",
      "all eighteen tenth-turn outputs",
      "all regenerated outputs",
      "all progression, revision, transfer, and flagged cases"
    ],
    review_items: reviewItems,
    undispatched_cases: results.filter((result) =>
      result.provider_attempts.length === 0
    ).map((result) => ({
      case_id: result.case_id,
      phase: result.phase,
      automated_status: result.status,
      blocking_reasons: result.major_findings
    }))
  };
}

function candidateEvidenceDraft(input: {
  runPublicId: string;
  status: EvaluationStatus;
  preflight: Awaited<ReturnType<typeof inspectE2A6Preflight>>;
  schemaAudit: ReturnType<typeof buildE2A6AllRoleSchemaAudit>;
  paths: ReturnType<typeof artifactPaths>;
}) {
  const candidate = evaluateE2A5Candidate();
  const roles = Object.keys(candidate.full_candidate.roles).sort().map((role) => ({
    role,
    role_config_hash: candidate.role_config_hashes[role],
    schema_compatible:
      input.schemaAudit.role_results.find((entry) => entry.role === role)?.compatible ?? false,
    evidence_kind: role === "topic_dialogue_agent"
      ? "new_v5_provider_evidence"
      : "inherited_immutable_reference",
    evidence_reference: role === "topic_dialogue_agent"
      ? {
          evaluation_run_public_id: input.runPublicId,
          provider_outputs_path: relative(input.paths.providerOutputs),
          human_review_packet_path: relative(input.paths.humanReviewPacket)
        }
      : input.preflight.inherited_evidence,
    inherited_evidence_approved_for_v5: false,
    human_review_required: role === "topic_dialogue_agent"
  }));
  return {
    draft_version: "e2a6-v5-candidate-evidence-draft-v1",
    record_type: "non_approving_human_review_draft",
    status: input.status,
    candidate_manifest_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    role_count: roles.length,
    unchanged_role_count: roles.filter((entry) =>
      entry.role !== "topic_dialogue_agent"
    ).length,
    newly_evaluated_roles: ["topic_dialogue_agent"],
    roles,
    topic_dialogue_contract: {
      input_schema_version: E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
      prompt_version: E2A5_TOPIC_DIALOGUE_PROMPT_VERSION,
      prompt_hash: E2A5_TOPIC_DIALOGUE_PROMPT_HASH,
      output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
      validator_version: E2A5_TOPIC_DIALOGUE_VALIDATOR_VERSION,
      progression_authorization_version: E2A5_PROGRESSION_AUTHORIZATION_VERSION
    },
    missing_evidence: [
      "human adjudication of every V5 topic-dialogue provider output",
      "explicit candidate-level human review of inherited evidence applicability"
    ],
    approval_state: "not_approved",
    activation_state: "not_activated",
    approval_evidence_ready: false
  };
}

function summarize(input: {
  canaryResults: E2A6CaseResult[];
  fullResults: E2A6CaseResult[];
  canary: ReturnType<typeof dispatchCanarySummary>;
  before: ReturnType<typeof e2a5ProtectedArtifactSnapshot>;
  after: ReturnType<typeof e2a5ProtectedArtifactSnapshot>;
}) {
  const results = [...input.canaryResults, ...input.fullResults];
  const attempts = results.flatMap((entry) => entry.provider_attempts);
  const usage = aggregateUsage(results);
  const fullUsage = aggregateUsage(input.fullResults);
  const fullBudget = resolveE2A6FullBudget();
  const tenth = input.fullResults.filter((entry) => entry.tenth_turn);
  const tenthFailures = tenth.filter((entry) =>
    entry.context_coverage.missing_visible_turn_ids.length > 0 ||
    entry.context_coverage.duplicated_visible_turn_ids.length > 0 ||
    !entry.context_coverage.order_matches ||
    !entry.context_coverage.exact_content_matches ||
    !entry.context_coverage.latest_student_message_separate ||
    !entry.context_coverage.initial_activity_present ||
    !entry.context_coverage.invisible_history_excluded
  );
  const critical = results.flatMap((entry) =>
    entry.critical_findings.map((finding) => ({
      case_id: entry.case_id,
      finding
    }))
  );
  const major = results.flatMap((entry) =>
    entry.major_findings.map((finding) => ({
      case_id: entry.case_id,
      finding
    }))
  );
  const completedFull = input.fullResults.length === 30 &&
    input.fullResults.every((entry) => entry.adapter_attempts > 0);
  const protectedUnchanged = input.before.aggregate_sha256 ===
    input.after.aggregate_sha256;
  const fullUsageWithinBudget =
    fullUsage.generation_provider_calls <= fullBudget.maximum_generation_calls &&
    fullUsage.input_tokens <= fullBudget.maximum_input_tokens &&
    fullUsage.output_tokens <= fullBudget.maximum_output_tokens &&
    (!fullUsage.complete_pricing_available ||
      (fullUsage.estimated_cost_usd ?? Infinity) <=
        fullBudget.maximum_estimated_cost_usd);
  const automatedPassed = input.canary.passed &&
    completedFull &&
    tenth.length === 18 &&
    tenthFailures.length === 0 &&
    results.every((entry) => entry.status === "passed_automated") &&
    critical.length === 0 &&
    major.length === 0 &&
    results.every((entry) => entry.schema_valid && entry.candidate_valid) &&
    results.every((entry) => entry.privacy_findings.length === 0) &&
    fullUsageWithinBudget &&
    protectedUnchanged;
  const status: EvaluationStatus = automatedPassed
    ? "provider_evidence_ready_for_human_review"
    : input.canary.passed && !completedFull
      ? "candidate_evaluation_incomplete"
      : "candidate_evaluation_failed";
  const countFinding = (name: string) => results.filter((entry) =>
    entry.critical_findings.includes(name) || entry.major_findings.includes(name)
  ).length;
  const baselineResults = input.fullResults.filter((entry) =>
    entry.category === "baseline"
  );
  const platformGateDecisions = results.reduce((counts, entry) => {
    if (!entry.platform_gate) counts.unavailable += 1;
    else if (entry.platform_gate.rejected) counts.rejected += 1;
    else if (entry.platform_gate.overridden) counts.overridden += 1;
    else counts.accepted += 1;
    return counts;
  }, { accepted: 0, rejected: 0, overridden: 0, unavailable: 0 });
  return {
    summary_version: "e2a6-v5-topic-dialogue-evaluation-summary-v1",
    final_evaluation_status: status,
    automated_evaluation_passed: automatedPassed,
    human_review_status: "pending",
    approval_evidence_ready: false,
    approval_state: "not_approved",
    activation_state: "not_activated",
    case_counts: {
      dispatch_canary_planned: 5,
      dispatch_canary_completed: input.canaryResults.filter((entry) =>
        entry.adapter_attempts > 0
      ).length,
      full_protocol_planned: 30,
      full_protocol_completed: input.fullResults.filter((entry) =>
        entry.adapter_attempts > 0
      ).length,
      full_protocol_skipped: 30 - input.fullResults.filter((entry) =>
        entry.adapter_attempts > 0
      ).length,
      passed_automated: results.filter((entry) =>
        entry.status === "passed_automated"
      ).length,
      failed: results.filter((entry) =>
        entry.status === "failed" || entry.status === "provider_failed"
      ).length,
      tenth_turn: tenth.length
    },
    dispatch_canary_passed: input.canary.passed,
    full_protocol_executed: input.fullResults.length > 0,
    full_protocol_usage_within_budget: fullUsageWithinBudget,
    full_protocol_budget: fullBudget,
    context_coverage: {
      tenth_turn_passed: tenth.length - tenthFailures.length,
      tenth_turn_failed: tenthFailures.length
    },
    baseline_regression: {
      case_count: baselineResults.length,
      passed_count: baselineResults.filter((entry) =>
        entry.status === "passed_automated"
      ).length,
      failed_count: baselineResults.filter((entry) =>
        entry.status !== "passed_automated"
      ).length,
      material_regression_detected: baselineResults.some((entry) =>
        entry.status !== "passed_automated"
      )
    },
    platform_gate_decisions: platformGateDecisions,
    schema_validation_failure_count: attempts.filter((attempt) =>
      !attempt.schema_valid
    ).length,
    candidate_validation_failure_count: attempts.filter((attempt) =>
      !attempt.candidate_valid
    ).length,
    candidate_regeneration_count: usage.candidate_regenerations,
    privacy_finding_count: results.reduce(
      (sum, entry) => sum + entry.privacy_findings.length,
      0
    ),
    answer_key_finding_count: results.reduce(
      (sum, entry) => sum + [
        ...entry.schema_issues,
        ...entry.candidate_issues
      ].filter((issue) => issue.rule_code === "answer_key_leak").length,
      0
    ),
    direct_response_failure_count: countFinding("direct_response"),
    strategy_adaptation_failure_count: countFinding("strategy_adaptation"),
    distractor_focus_failure_count: countFinding("distractor_focus"),
    unsupported_understanding_failure_count: countFinding(
      "unsupported_understanding"
    ),
    recurrence_failure_count: countFinding("recurrence_handling"),
    revision_transfer_failure_count: countFinding(
      "revision_transfer_separation"
    ),
    authorization_alignment_failure_count: countFinding(
      "authorization_alignment"
    ),
    unauthorized_progression_language_count: countFinding(
      "student_facing_progression_alignment"
    ),
    critical_findings: critical,
    major_findings: major,
    provider_usage: {
      ...usage,
      average_latency_ms: results.length
        ? Math.round(usage.latency_ms / results.length)
        : 0,
      transport_retries: 0,
      cost_status: usage.complete_pricing_available
        ? "available"
        : "unavailable"
    },
    protected_artifacts_unchanged: protectedUnchanged,
    protected_artifacts_before_sha256: input.before.aggregate_sha256,
    protected_artifacts_after_sha256: input.after.aggregate_sha256,
    human_review_required: true,
    human_review_completed: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false
  };
}

export async function executeE2A6V5TopicDialogueEvaluation(input: {
  provider?: LlmProvider;
  live: boolean;
  artifactRoot?: string;
  skipProtectedSnapshotForTest?: boolean;
}) {
  const preflight = await inspectE2A6Preflight({
    requireLiveEnvironment: input.live,
    requireCleanTree: input.live
  });
  if (!preflight.passed) {
    throw new Error(`e2a6_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const buildInfo = resolveApplicationBuildInfo({
    artifactPath: path.join(E2A6_ARTIFACT_ROOT, "nonexistent-build-info.json")
  });
  if (!buildInfo.ok) throw new Error(buildInfo.code);
  const candidate = evaluateE2A5Candidate();
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  if (!modelConfig) throw new Error("e2a6_topic_dialogue_model_config_missing");
  const provider = input.provider ?? new OpenAIResponsesProvider();
  const canaryCases = e2a6DispatchCanaryCases();
  const fullCases = e2a6FullProtocolCases();
  const runPublicId = runId();
  const root = input.artifactRoot ?? E2A6_ARTIFACT_ROOT;
  const runDir = path.join(root, runPublicId);
  const paths = artifactPaths(runDir);
  mkdirSync(runDir, { recursive: true });
  const emptySnapshot = {
    snapshot_version: "e2a5-protected-artifact-snapshot-v1",
    approved_runtime_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_candidate_hash: E2A5_FAILED_V4_HASH,
    tracked_groups: {},
    environment_metadata: {},
    aggregate_sha256: "test-protected-snapshot"
  } as ReturnType<typeof e2a5ProtectedArtifactSnapshot>;
  const before = input.skipProtectedSnapshotForTest
    ? emptySnapshot
    : e2a5ProtectedArtifactSnapshot();
  const schemaAudit = buildE2A6AllRoleSchemaAudit();
  const requestCompilation = await compileE2A6CandidateRequestsNoNetwork(
    paths.requestCompilation
  );
  if (!requestCompilation.artifact.all_requests_ready_for_dispatch ||
    requestCompilation.artifact.network_request_count !== 0) {
    throw new Error("e2a6_request_compilation_gate_failed");
  }
  const protocol = e2a6ProtocolSnapshot();
  writeJson(paths.protectedBefore, before);
  writeJson(paths.protocol, {
    ...protocol,
    evaluation_protocol_hash: e2a6ProtocolHash()
  });
  writeJson(paths.candidateDelta, {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v4_file_sha256: candidate.failed_v4_file_sha256,
    exact_delta_paths_from_approved_v2:
      candidate.exact_delta_paths_from_approved_v2,
    exact_delta_paths_from_failed_v4:
      candidate.exact_delta_paths_from_failed_v4,
    exact_delta_from_approved_v2: candidate.exact_delta_from_approved_v2,
    exact_delta_from_failed_v4: candidate.exact_delta_from_failed_v4,
    role_config_hashes: candidate.role_config_hashes
  });
  writeJson(paths.authorizationContract, {
    authorization_version: E2A5_PROGRESSION_AUTHORIZATION_VERSION,
    server_owned_fields: [
      "revision_authorized",
      "transfer_authorized",
      "completion_authorized",
      "authorized_action",
      "authorization_evidence_summary",
      "authorization_version"
    ],
    canonical_actions: [
      "remain_in_dialogue",
      "request_revision",
      "present_transfer",
      "complete_episode"
    ],
    provider_cannot_broaden_authorization: true,
    authorization_summary_sanitized: true,
    student_projection_omits_authorization_fields: true,
    audit_projection_retains_provenance: true
  });
  for (const filePath of [
    paths.providerCases,
    paths.providerOutputs,
    paths.candidateValidation,
    paths.platformGateResults,
    paths.progressionTaxonomy,
    paths.contextCoverage,
    paths.privacyResults,
    paths.deterministicRubric
  ]) writeFileSync(filePath, "", "utf8");
  const manifestBase = {
    manifest_version: "e2a6-v5-topic-dialogue-evaluation-manifest-v1",
    run_public_id: runPublicId,
    evaluation_status: "running",
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_hash: E2A5_FAILED_V4_HASH,
    application_git_commit: buildInfo.info.application_git_commit,
    application_git_commit_source: buildInfo.info.application_git_commit_source,
    application_build_timestamp: buildInfo.info.application_build_timestamp,
    evaluation_protocol_version: E2A6_PROTOCOL_VERSION,
    evaluation_protocol_hash: e2a6ProtocolHash(),
    provider: input.live ? "openai" : "injected_no_live_provider",
    model: modelConfig.model_name,
    reasoning_effort: modelConfig.reasoning_effort,
    max_output_tokens: modelConfig.max_output_tokens,
    adapter_version: input.live
      ? OPENAI_RESPONSES_ADAPTER_VERSION
      : "injected-test-provider",
    prompt_version: E2A5_TOPIC_DIALOGUE_PROMPT_VERSION,
    prompt_hash: E2A5_TOPIC_DIALOGUE_PROMPT_HASH,
    input_schema_version: E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
    output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
    validator_version: E2A5_TOPIC_DIALOGUE_VALIDATOR_VERSION,
    authorization_version: E2A5_PROGRESSION_AUTHORIZATION_VERSION,
    fallback_version: "topic-dialogue-deterministic-fallback-v1",
    raw_provider_output_persisted: false,
    hidden_prompts_persisted: false,
    hidden_reasoning_persisted: false,
    human_review_required: true,
    candidate_approved: false,
    candidate_activated: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false,
    dispatch_canary_budget: resolveE2A6CanaryBudget(),
    full_protocol_budget: resolveE2A6FullBudget(),
    started_at: new Date().toISOString()
  };
  writeJson(paths.manifest, manifestBase);
  const canaryResults = await executeCases({
    cases: canaryCases,
    provider,
    modelConfig,
    timeoutMs: candidate.full_candidate.runtime_policy.provider_timeout_ms,
    budget: resolveE2A6CanaryBudget(),
    paths,
    runPublicId
  });
  const canary = dispatchCanarySummary(
    canaryResults,
    resolveE2A6CanaryBudget()
  );
  writeJson(paths.dispatchCanary, canary);
  const fullResults = canary.passed
    ? await executeCases({
        cases: fullCases,
        provider,
        modelConfig,
        timeoutMs: candidate.full_candidate.runtime_policy.provider_timeout_ms,
        budget: resolveE2A6FullBudget(),
        paths,
        runPublicId
      })
    : [];
  const after = input.skipProtectedSnapshotForTest
    ? before
    : e2a5ProtectedArtifactSnapshot();
  const summary = summarize({
    canaryResults,
    fullResults,
    canary,
    before,
    after
  });
  const allResults = [...canaryResults, ...fullResults];
  const packet = reviewPacket(allResults);
  const evidenceDraft = candidateEvidenceDraft({
    runPublicId,
    status: summary.final_evaluation_status,
    preflight,
    schemaAudit,
    paths
  });
  const usage = summary.provider_usage;
  artifactSecretScan([summary, packet, evidenceDraft, usage]);
  writeJson(paths.protectedAfter, after);
  writeJson(paths.providerUsage, usage);
  writeJson(paths.humanReviewPacket, packet);
  writeJson(paths.candidateEvidenceDraft, evidenceDraft);
  writeJson(paths.summary, summary);
  const finalManifest = {
    ...manifestBase,
    evaluation_status: summary.final_evaluation_status,
    completed_at: new Date().toISOString(),
    provider_adapter_attempt_count: usage.provider_adapter_attempts,
    generation_call_count: usage.generation_provider_calls,
    metadata_only_request_count: usage.metadata_only_requests,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    latency_ms: usage.latency_ms,
    transport_retries: usage.transport_retries,
    candidate_regenerations: usage.candidate_regenerations,
    estimated_cost_usd: usage.estimated_cost_usd,
    estimated_cost_status: usage.cost_status,
    protected_artifacts_before_sha256: before.aggregate_sha256,
    protected_artifacts_after_sha256: after.aggregate_sha256,
    protected_artifacts_unchanged: summary.protected_artifacts_unchanged,
    human_review_status: "pending",
    artifact_paths: Object.fromEntries(
      Object.entries(paths).map(([key, filePath]) => [key, relative(filePath)])
    )
  };
  writeJson(paths.manifest, finalManifest);
  writeJson(path.join(root, "latest-run.json"), {
    run_public_id: runPublicId,
    run_directory: relative(runDir),
    evaluation_status: summary.final_evaluation_status,
    updated_at: new Date().toISOString()
  });
  return {
    runPublicId,
    runDir,
    paths,
    manifest: finalManifest,
    summary,
    canary,
    results: allResults
  };
}

export async function executeLiveE2A6V5TopicDialogueEvaluation() {
  const credential = resolveOpenAICredentialFromEnv(process.env);
  if (!credential.ok) throw new Error(credential.code);
  return withResolvedOpenAICredential(
    credential.credential,
    () => executeE2A6V5TopicDialogueEvaluation({ live: true })
  );
}

export function loadE2A6Evaluation(
  runPublicId?: string,
  artifactRoot = E2A6_ARTIFACT_ROOT
) {
  const latestPath = path.join(artifactRoot, "latest-run.json");
  if (!runPublicId && !existsSync(latestPath)) {
    throw new Error("e2a6_latest_run_missing");
  }
  const latest = runPublicId
    ? {
        run_public_id: runPublicId,
        run_directory: path.join(artifactRoot, runPublicId)
      }
    : readJson<{
        run_public_id: string;
        run_directory: string;
      }>(latestPath);
  const runDir = path.isAbsolute(latest.run_directory)
    ? latest.run_directory
    : path.join(process.cwd(), latest.run_directory);
  if (!existsSync(runDir)) throw new Error("e2a6_run_missing");
  return {
    latest,
    manifest: readJson(path.join(runDir, "evaluation-manifest.json")),
    summary: readJson(path.join(runDir, "evaluation-summary.json")),
    dispatch_canary: readJson(path.join(runDir, "dispatch-canary.json")),
    human_review_packet: readJson(path.join(runDir, "human-review-packet.json")),
    candidate_evidence_draft: readJson(
      path.join(runDir, "candidate-evidence-draft.json")
    )
  };
}

export function loadLatestE2A6Evaluation(
  artifactRoot = E2A6_ARTIFACT_ROOT
) {
  return loadE2A6Evaluation(undefined, artifactRoot);
}

export function temporaryE2A6ArtifactRoot() {
  return path.join(os.tmpdir(), `e2a6-topic-dialogue-${randomBytes(5).toString("hex")}`);
}

export const E2A6_PROTECTED_INPUTS = {
  approved_v2_hash: E2A4_APPROVED_V2_HASH,
  failed_v4_hash: E2A5_FAILED_V4_HASH,
  failed_v4_candidate_path: E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH,
  v5_candidate_path: E2A5_CANDIDATE_PATH,
  v5_candidate_file_sha256: E2A6_CANDIDATE_FILE_SHA256
};
