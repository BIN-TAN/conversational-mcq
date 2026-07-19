import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
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
  TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION,
  TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
  TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
  TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES,
  TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION,
  TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION,
  buildTopicDialogueOperationFallback,
  buildTopicDialogueOperationRepairInstructions,
  buildTopicDialogueOperationRequestEnvelope,
  validateTopicDialogueOperationOutput,
  type TopicDialogueOperation
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import {
  TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
  TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
  TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
  buildTopicDialogueModeFallback,
  buildTopicDialogueModeRequestEnvelope,
  validateTopicDialogueModeOutput,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import { findVisibleTextPrivacyFindings } from "./student-privacy-scanner";
import { E2A4_APPROVED_V2_HASH, sha256 } from
  "./e2a4-topic-dialogue-contract";
import { E2A5_FAILED_V4_HASH } from
  "./e2a5-topic-dialogue-progression-contract";
import { E2A6_CANDIDATE_HASH } from
  "./e2a6-v5-topic-dialogue-evaluation";
import {
  E2A7_CANDIDATE_HASH,
  buildTopicDialogueModeProviderInput
} from "./e2a7-topic-dialogue-mode-candidate";
import {
  E2A9_ARTIFACT_ROOT,
  e2a9ArtifactAggregateHash,
  e2a9ProtectedArtifactSnapshot
} from "./e2a9-remain-dialogue-adjudication";
import {
  buildE2A9SchemaAudit,
  compileE2A9CandidateRequestsNoNetwork
} from "./e2a9-request-compilation";
import {
  E2A9_CANDIDATE_FILE_SHA256,
  E2A9_CANDIDATE_HASH,
  E2A9_CANDIDATE_PATH,
  buildTopicDialogueOperationProviderInput,
  evaluateE2A9Candidate
} from "./e2a9-topic-dialogue-operation-candidate";
import {
  E2A10_PROTOCOL_VERSION,
  e2a10CanaryCases,
  e2a10ProtocolHash,
  e2a10ProtocolSnapshot,
  type E2A10TopicDialogueCase
} from "./e2a10-v7-topic-dialogue-protocol";

export const E2A10_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a10-v7-topic-dialogue-canary"
);
export const E2A10_E2A9_RUN_ID =
  "e2a9_20260719202113_86f1194e" as const;
export const E2A10_EVALUATOR_VERSION =
  "e2a10-v7-operation-specific-canary-evaluator-v1" as const;

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
const E2A9_RUN_DIR = path.join(E2A9_ARTIFACT_ROOT, E2A10_E2A9_RUN_ID);

type OperationOutput = {
  schema_version: string;
  student_facing_message: string;
};
type ProgressionOutput = {
  schema_version: string;
  response_function: string;
  tutor_message: string;
  evidence_update: string;
  remaining_issue: string | null;
  student_safe_summary: string;
  expected_response_guidance: string | null;
  safety_flags: string[];
  requires_student_response: boolean;
};
type CandidateOutput = OperationOutput | ProgressionOutput;

type Usage = {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  usage_verified: boolean;
  pricing_available: boolean;
  estimated_cost_usd: number | null;
};

export type E2A10Budget = {
  maximum_cases: 10;
  maximum_initial_generation_calls: 10;
  maximum_regeneration_calls: 10;
  maximum_total_generation_calls: 20;
  maximum_input_tokens: 280000;
  maximum_output_tokens: 45000;
  maximum_estimated_cost_usd: 12;
  maximum_regenerations_per_case: 1;
  provider_case_concurrency: 1;
  transport_retries: 0;
};

type ValidationDimension = {
  passed: boolean;
  issue_codes: string[];
};

type CandidateValidation = {
  valid: boolean;
  selected_mode: TopicDialogueResponseMode;
  selected_operation: TopicDialogueOperation | null;
  output: CandidateOutput | null;
  visible_message: string | null;
  findings: Array<{
    field_path: string;
    rule_code: string;
    safe_detail: string;
    triggering_spans: string[];
  }>;
  dimensions: Record<string, ValidationDimension>;
  privacy_findings: ReturnType<typeof findVisibleTextPrivacyFindings>;
  answer_key_findings: string[];
};

type ProviderAttempt = {
  attempt_index: number;
  regeneration: boolean;
  provider_request_status: string;
  generation_dispatched: boolean;
  provider_request_id: string | null;
  provider_response_id: string | null;
  provider_error: {
    category: string;
    message: string;
    retryable: boolean;
    typed_failure_reason: string | null;
    http_status: number | null;
  } | null;
  parsed_output_present: boolean;
  raw_output_present: boolean;
  raw_output_sha256: string | null;
  safe_provider_output: CandidateOutput | null;
  validation: CandidateValidation;
  usage: Usage;
  latency_ms: number;
};

type ContextCoverage = {
  case_id: string;
  required_for_acceptance: boolean;
  prior_student_message_count: number;
  prior_assistant_reply_count: number;
  expected_visible_turn_ids: string[];
  serialized_visible_turn_ids: string[];
  missing_visible_turn_ids: string[];
  duplicated_visible_turn_ids: string[];
  order_matches: boolean;
  exact_content_matches: boolean;
  latest_student_message_separate: boolean;
  initial_activity_present: boolean;
  invisible_history_excluded: boolean;
  internal_records_separated: boolean;
  current_turn_directive_authoritative: boolean;
  historical_recommendations_non_authoritative: boolean;
  complete_tenth_turn_context: boolean;
};

type CaseResult = {
  case_id: string;
  case_number: number;
  selected_mode: TopicDialogueResponseMode;
  selected_operation: TopicDialogueOperation | null;
  status: "passed_automated" | "failed" | "provider_failed" | "skipped_budget";
  first_attempt_valid: boolean;
  regeneration_count: number;
  regeneration_succeeded: boolean;
  candidate_semantic_valid: boolean;
  deterministic_fallback_used: boolean;
  provider_attempts: ProviderAttempt[];
  platform_safety: {
    selected_mode: TopicDialogueResponseMode;
    selected_operation: TopicDialogueOperation | null;
    provider_schema_valid: boolean;
    provider_semantic_valid: boolean;
    regeneration_attempted: boolean;
    regeneration_succeeded: boolean;
    deterministic_fallback_used: boolean;
    platform_authorized_action: TopicDialogueResponseMode;
    platform_gate_result: "authorized_mode_and_operation_preserved";
    ui_progression_available: boolean;
    executed_transition: false;
    candidate_case_pass: boolean;
  };
  context_coverage: ContextCoverage;
  privacy_findings: ReturnType<typeof findVisibleTextPrivacyFindings>;
  answer_key_findings: string[];
  deterministic_rubric: Array<{
    dimension: string;
    status: "passed" | "failed";
    severity: "critical" | "major";
    issue_codes: string[];
  }>;
  critical_findings: string[];
  major_findings: string[];
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function assertArtifactSafe(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a10_artifact_secret_scan_failed");
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

function directoryDigest(root: string) {
  if (!existsSync(root)) return { exists: false, file_count: 0, sha256: null };
  const files = listFiles(root);
  return {
    exists: true,
    file_count: files.length,
    sha256: stableHash(files.map((filePath) => ({
      path: path.relative(root, filePath),
      sha256: sha256(readFileSync(filePath))
    })))
  };
}

export function e2a10ProtectedArtifactSnapshot() {
  const inherited = e2a9ProtectedArtifactSnapshot();
  const trackedGroups = {
    ...inherited.tracked_groups,
    v7_candidate_manifest: {
      exists: existsSync(E2A9_CANDIDATE_PATH),
      file_count: existsSync(E2A9_CANDIDATE_PATH) ? 1 : 0,
      sha256: existsSync(E2A9_CANDIDATE_PATH)
        ? sha256(readFileSync(E2A9_CANDIDATE_PATH))
        : null
    },
    e2a9_evidence: directoryDigest(E2A9_RUN_DIR)
  };
  return {
    snapshot_version: "e2a10-protected-artifact-snapshot-v1",
    approved_runtime_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_candidate_hash: E2A5_FAILED_V4_HASH,
    failed_v5_candidate_hash: E2A6_CANDIDATE_HASH,
    failed_v6_candidate_hash: E2A7_CANDIDATE_HASH,
    v7_candidate_hash: E2A9_CANDIDATE_HASH,
    tracked_groups: trackedGroups,
    environment_metadata: inherited.environment_metadata,
    aggregate_sha256: stableHash({
      tracked_groups: trackedGroups,
      environment_metadata: inherited.environment_metadata
    })
  };
}

function positiveInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  cap: number
) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > cap) {
    throw new Error(`e2a10_invalid_budget:${name}`);
  }
  return value;
}

function positiveNumber(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  cap: number
) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > cap) {
    throw new Error(`e2a10_invalid_budget:${name}`);
  }
  return value;
}

export function resolveE2A10Budget(
  env: Readonly<Record<string, string | undefined>> = process.env
): E2A10Budget {
  return {
    maximum_cases: positiveInteger(env, "EVAL_E2A10_MAX_CASES", 10, 10) as 10,
    maximum_initial_generation_calls: positiveInteger(
      env, "EVAL_E2A10_MAX_INITIAL_CALLS", 10, 10
    ) as 10,
    maximum_regeneration_calls: positiveInteger(
      env, "EVAL_E2A10_MAX_REGENERATION_CALLS", 10, 10
    ) as 10,
    maximum_total_generation_calls: positiveInteger(
      env, "EVAL_E2A10_MAX_TOTAL_CALLS", 20, 20
    ) as 20,
    maximum_input_tokens: positiveInteger(
      env, "EVAL_E2A10_MAX_INPUT_TOKENS", 280_000, 280_000
    ) as 280000,
    maximum_output_tokens: positiveInteger(
      env, "EVAL_E2A10_MAX_OUTPUT_TOKENS", 45_000, 45_000
    ) as 45000,
    maximum_estimated_cost_usd: positiveNumber(
      env, "EVAL_E2A10_MAX_COST_USD", 12, 12
    ) as 12,
    maximum_regenerations_per_case: 1,
    provider_case_concurrency: 1,
    transport_retries: 0
  };
}

function filesContainingUnder(root: string, value: string) {
  return listFiles(root).filter((filePath) =>
    /\.json(?:l)?$/u.test(filePath) &&
    readFileSync(filePath, "utf8").includes(value)
  ).map(relative);
}

function activeBundle() {
  if (!existsSync(ACTIVE_BUNDLE_PATH)) {
    throw new Error("e2a10_active_approval_bundle_missing");
  }
  return readJson<{ runtime_candidate_hash?: string }>(ACTIVE_BUNDLE_PATH);
}

export function isSuccessfulE1Summary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const summary = value as Record<string, unknown>;
  return summary.run_count === 12 &&
    summary.scenario_pass_rate === 1 &&
    summary.critical_invariant_failure_rate === 0 &&
    summary.provider_call_count === 0;
}

function latestSuccessfulE1Exists() {
  const root = path.join(process.cwd(), ".data", "formative-evaluation-smoke");
  return listFiles(root).filter((filePath) => path.basename(filePath) === "summary.json")
    .some((filePath) => {
      try {
        return isSuccessfulE1Summary(readJson<unknown>(filePath));
      } catch {
        return false;
      }
    });
}

function latestSuccessfulPrivacyE2EExists() {
  const root = path.join(process.cwd(), ".data", "e2e");
  return listFiles(root).filter((filePath) => path.basename(filePath) === "report.json")
    .some((filePath) => {
      try {
        const value = readJson<{
          suite?: string;
          external_llm_calls?: number;
          gates?: Array<{ status?: string }>;
        }>(filePath);
        return value.suite === "privacy-smoke" &&
          value.external_llm_calls === 0 &&
          Array.isArray(value.gates) &&
          value.gates.length > 0 &&
          value.gates.every((gate) => gate.status === "pass");
      } catch {
        return false;
      }
    });
}

function postgresHealthy() {
  try {
    const output = execFileSync("docker", [
      "inspect",
      "--format",
      "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}",
      "conversational-mcq-postgres"
    ], { encoding: "utf8" }).trim();
    return output === "running healthy" || output === "running no-healthcheck";
  } catch {
    return false;
  }
}

function duplicateRunnerPids() {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8"
    }).split("\n").flatMap((line) => {
      if (!/formative-evaluation-e2a10-(?:live|preflight)/u.test(line)) return [];
      const pid = Number(line.trim().split(/\s+/u)[0]);
      return Number.isInteger(pid) && pid !== process.pid && pid !== process.ppid
        ? [pid]
        : [];
    });
  } catch {
    return [];
  }
}

export async function inspectE2A10Preflight(input: {
  requireLiveEnvironment?: boolean;
  requireCleanTree?: boolean;
} = {}) {
  const candidate = evaluateE2A9Candidate();
  const active = activeBundle();
  const schemaAudit = buildE2A9SchemaAudit();
  const protectedArtifacts = e2a10ProtectedArtifactSnapshot();
  const compilationPath = path.join(
    os.tmpdir(),
    `e2a10-compilation-${randomBytes(5).toString("hex")}.json`
  );
  const compilation = await compileE2A9CandidateRequestsNoNetwork(
    compilationPath
  );
  rmSync(compilationPath, { force: true });
  const budget = resolveE2A10Budget();
  const baseUrl = resolveOpenAIBaseUrl();
  const credential = input.requireLiveEnvironment
    ? resolveOpenAICredentialFromEnv(process.env)
    : null;
  const blockers: string[] = [];
  const approvalOrActivationPaths = filesContainingUnder(
    ACTIVE_APPROVAL_ROOT,
    E2A9_CANDIDATE_HASH
  );
  if (candidate.candidate_configuration_hash !== E2A9_CANDIDATE_HASH) {
    blockers.push("v7_candidate_hash_mismatch");
  }
  if (candidate.candidate_file_sha256 !== E2A9_CANDIDATE_FILE_SHA256) {
    blockers.push("v7_candidate_file_sha_mismatch");
  }
  if (candidate.approved_v2_hash !== E2A4_APPROVED_V2_HASH) {
    blockers.push("approved_v2_hash_mismatch");
  }
  if (candidate.failed_v4_hash !== E2A5_FAILED_V4_HASH) {
    blockers.push("failed_v4_hash_mismatch");
  }
  if (candidate.failed_v5_hash !== E2A6_CANDIDATE_HASH) {
    blockers.push("failed_v5_hash_mismatch");
  }
  if (candidate.failed_v6_hash !== E2A7_CANDIDATE_HASH) {
    blockers.push("failed_v6_hash_mismatch");
  }
  if (active.runtime_candidate_hash !== E2A4_APPROVED_V2_HASH) {
    blockers.push("approved_v2_not_active");
  }
  if (approvalOrActivationPaths.length > 0 ||
    candidate.candidate_approved || candidate.candidate_activated) {
    blockers.push("v7_approval_or_activation_evidence_exists");
  }
  if (!existsSync(E2A9_RUN_DIR)) blockers.push("e2a9_evidence_missing");
  if (existsSync(E2A9_RUN_DIR)) {
    const manifest = readJson<{ status?: string; provider_call_count?: number }>(
      path.join(E2A9_RUN_DIR, "adjudication-manifest.json")
    );
    if (manifest.status !== "e2a9_passed_pending_v7_provider_canary" ||
      manifest.provider_call_count !== 0) {
      blockers.push("e2a9_evidence_not_eligible");
    }
  }
  if (Object.keys(candidate.role_config_hashes).length !== 17) {
    blockers.push("v7_role_inventory_mismatch");
  }
  if (!schemaAudit.all_operation_schemas_compile ||
    !schemaAudit.all_retained_progression_schemas_compile ||
    !schemaAudit.all_provider_control_fields_absent) {
    blockers.push("v7_schema_gate_failed");
  }
  if (!compilation.artifact.all_17_roles_compile ||
    compilation.artifact.request_count !== 26 ||
    compilation.artifact.network_request_count !== 0) {
    blockers.push("v7_request_compilation_gate_failed");
  }
  if (input.requireLiveEnvironment && !latestSuccessfulE1Exists()) {
    blockers.push("e1_12_of_12_evidence_missing");
  }
  if (input.requireLiveEnvironment && !latestSuccessfulPrivacyE2EExists()) {
    blockers.push("privacy_e2e_pass_evidence_missing");
  }
  if (input.requireLiveEnvironment && !postgresHealthy()) {
    blockers.push("local_postgresql_not_healthy");
  }
  const duplicatePids = duplicateRunnerPids();
  if (duplicatePids.length > 0) blockers.push("duplicate_e2a10_runner_active");
  if (input.requireCleanTree) {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      encoding: "utf8"
    }).trim();
    if (status) blockers.push("tracked_worktree_not_clean");
  }
  if (input.requireLiveEnvironment) {
    if (process.env.EVAL_E2A10_LIVE_PROVIDER !== "1") {
      blockers.push("live_e2a10_opt_in_missing");
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
    preflight_version: "e2a10-v7-live-canary-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v5_hash: candidate.failed_v5_hash,
    failed_v6_hash: candidate.failed_v6_hash,
    active_runtime_hash: active.runtime_candidate_hash ?? null,
    active_runtime_references_v7:
      active.runtime_candidate_hash === E2A9_CANDIDATE_HASH,
    v7_candidate_approved: false,
    v7_candidate_activated: false,
    existing_v7_approval_or_activation_paths: approvalOrActivationPaths,
    role_count: Object.keys(candidate.role_config_hashes).length,
    operation_schema_count: schemaAudit.operation_schema_count,
    retained_progression_schema_count:
      schemaAudit.retained_progression_schema_count,
    all_operation_schemas_compile:
      schemaAudit.all_operation_schemas_compile,
    all_retained_progression_schemas_compile:
      schemaAudit.all_retained_progression_schemas_compile,
    all_17_roles_compile: compilation.artifact.all_17_roles_compile,
    request_count: compilation.artifact.request_count,
    request_compilation_network_count:
      compilation.artifact.network_request_count,
    e1_12_of_12_verified: latestSuccessfulE1Exists(),
    privacy_e2e_verified: latestSuccessfulPrivacyE2EExists(),
    credential_configured: credential?.ok ?? false,
    provider_host: input.requireLiveEnvironment
      ? openAIBaseUrlHost(baseUrl)
      : "not_checked",
    explicit_live_opt_in_required: true,
    local_postgresql_healthy: postgresHealthy(),
    duplicate_runner_pids: duplicatePids,
    budget,
    provider_case_concurrency: 1,
    protected_artifact_hash: protectedArtifacts.aggregate_sha256,
    protected_artifact_groups: protectedArtifacts.tracked_groups,
    e2a9_evidence_sha256: existsSync(E2A9_RUN_DIR)
      ? e2a9ArtifactAggregateHash(E2A9_RUN_DIR)
      : null
  };
}

function usageFromResult(result: StructuredAgentResult<unknown>): Usage {
  const normalized = result.transport_telemetry?.normalized_response?.usage;
  return {
    input_tokens: result.usage?.input_tokens ?? normalized?.inputTokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? normalized?.outputTokens ?? 0,
    reasoning_tokens:
      result.usage?.reasoning_tokens ?? normalized?.reasoningTokens ?? 0,
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

function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    usage_verified: true,
    pricing_available: true,
    estimated_cost_usd: 0
  };
}

function aggregateUsage(attempts: ProviderAttempt[]): Usage {
  return attempts.reduce<Usage>((sum, attempt) => ({
    input_tokens: sum.input_tokens + attempt.usage.input_tokens,
    output_tokens: sum.output_tokens + attempt.usage.output_tokens,
    reasoning_tokens: sum.reasoning_tokens + attempt.usage.reasoning_tokens,
    cached_input_tokens:
      sum.cached_input_tokens + attempt.usage.cached_input_tokens,
    total_tokens: sum.total_tokens + attempt.usage.total_tokens,
    usage_verified: sum.usage_verified && attempt.usage.usage_verified,
    pricing_available: sum.pricing_available && attempt.usage.pricing_available,
    estimated_cost_usd:
      sum.estimated_cost_usd === null ||
      attempt.usage.estimated_cost_usd === null
        ? null
        : sum.estimated_cost_usd + attempt.usage.estimated_cost_usd
  }), emptyUsage());
}

function resultUsage(results: CaseResult[]) {
  const attempts = results.flatMap((entry) => entry.provider_attempts);
  const usage = aggregateUsage(attempts);
  return {
    provider_adapter_attempts: attempts.length,
    generation_provider_calls: attempts.filter((entry) =>
      entry.generation_dispatched
    ).length,
    initial_generation_calls: attempts.filter((entry) =>
      entry.generation_dispatched && !entry.regeneration
    ).length,
    regeneration_generation_calls: attempts.filter((entry) =>
      entry.generation_dispatched && entry.regeneration
    ).length,
    metadata_only_requests: 0,
    ...usage,
    latency_ms: attempts.reduce((sum, entry) => sum + entry.latency_ms, 0),
    transport_retries: 0
  };
}

function dimension(issueCodes: string[]): ValidationDimension {
  const unique = [...new Set(issueCodes)];
  return { passed: unique.length === 0, issue_codes: unique };
}

function finding(
  ruleCode: string,
  safeDetail: string,
  fieldPath = "student_facing_message",
  triggeringSpans: string[] = []
) {
  return {
    field_path: fieldPath,
    rule_code: ruleCode,
    safe_detail: safeDetail,
    triggering_spans: triggeringSpans
  };
}

function providerControlFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const forbidden = [
    "next_action",
    "recommended_action",
    "response_mode",
    "dialogue_operation",
    "readiness",
    "progression_status",
    "runtime_state",
    "platform_action"
  ];
  return forbidden.filter((field) => field in value);
}

function operationSpecificFindings(
  testCase: E2A10TopicDialogueCase,
  output: OperationOutput | null
) {
  if (!output || !testCase.selected_operation) {
    return [finding("operation_schema_invalid", "operation_output_missing")];
  }
  const message = output.student_facing_message;
  const operation = testCase.selected_operation;
  const findings: ReturnType<typeof finding>[] = [];
  const hasQuestionOrRequest = /\?/u.test(message) ||
    /\b(?:show|explain|compare|apply|identify|tell me|what|why|how)\b/iu.test(
      message
    );
  if ([
    "elicit_anchor_evidence",
    "clarify_concept_with_new_strategy",
    "repair_recurrence",
    "refine_partial_reasoning"
  ].includes(operation) && !hasQuestionOrRequest) {
    findings.push(finding(
      "evidence_request_alignment_missing",
      operation
    ));
  }
  if (operation === "elicit_anchor_evidence" &&
    /\b(?:you (?:now )?(?:understand|mastered)|that proves you understand|your understanding is complete)\b/iu.test(message)) {
    findings.push(finding(
      "unsupported_mastery_acceptance",
      "understanding_claim_accepted_without_evidence"
    ));
  }
  if (operation === "clarify_task") {
    const taskIndex = message.search(/\b(?:task|asked|identify|explain|write|response)\b/iu);
    const conceptIndex = message.search(/\b(?:reliab|valid|consisten|interpret)\w*/iu);
    if (taskIndex < 0 || (conceptIndex >= 0 && taskIndex > conceptIndex)) {
      findings.push(finding(
        "task_clarification_priority_failed",
        "task_instruction_not_presented_first"
      ));
    }
    if (/\bdisengag\w*\b/iu.test(message)) {
      findings.push(finding(
        "task_confusion_misclassified_as_disengagement",
        "unsupported_engagement_inference"
      ));
    }
  }
  if (operation === "protected_redirect") {
    if (!/\b(?:cannot|can not|can['’]t|will not|won['’]t)\b/iu.test(message) ||
      !hasQuestionOrRequest) {
      findings.push(finding(
        "protected_redirect_quality_failed",
        "decline_or_bounded_redirect_missing"
      ));
    }
    if (/\b(?:cheat|dishonest|misconduct|trying to trick)\b/iu.test(message)) {
      findings.push(finding(
        "protected_redirect_accusatory",
        "student_accusation_detected"
      ));
    }
  }
  if (operation === "repair_recurrence") {
    if (!/\b(?:coefficient|magnitude|almost perfect|extremely high|high)\b/iu.test(message) ||
      !/\b(?:interpret|valid|evidence|construct)\w*/iu.test(message)) {
      findings.push(finding(
        "recurrence_repair_quality_failed",
        "contradictory_current_evidence_not_addressed"
      ));
    }
    if (/\b(?:already resolved|as you established|you already understand)\b/iu.test(message)) {
      findings.push(finding(
        "recurrence_relied_on_historical_resolution",
        "earlier_apparent_resolution_treated_as_authoritative"
      ));
    }
  }
  if (operation === "redirect_off_topic" &&
    /\b(?:low engagement|not engaged|disengaged|unmotivated)\b/iu.test(message)) {
    findings.push(finding(
      "off_topic_engagement_overclaim",
      "engagement_trait_inferred_from_one_turn"
    ));
  }
  if (operation === "refine_partial_reasoning") {
    if (!/\b(?:useful|usefully|helpful|right|part|identify|recognize)\b/iu.test(message) ||
      !/\b(?:missing|add|connect|link|also)\b/iu.test(message)) {
      findings.push(finding(
        "partial_reasoning_refinement_failed",
        "useful_part_or_missing_link_not_identified"
      ));
    }
  }
  return findings;
}

function progressionSpecificFindings(
  testCase: E2A10TopicDialogueCase,
  output: ProgressionOutput | null
) {
  if (!output) {
    return [finding("progression_schema_invalid", "progression_output_missing")];
  }
  const message = `${output.tutor_message} ${output.student_safe_summary}`;
  const findings: ReturnType<typeof finding>[] = [];
  if (testCase.selected_mode === "request_revision") {
    if (!/\b(?:revise|rewrite|edit)\b/iu.test(message) ||
      !/\b(?:answer|reasoning|explanation|response|claim)\b/iu.test(message)) {
      findings.push(finding(
        "revision_target_missing",
        "revision_or_revision_target_missing",
        "tutor_message"
      ));
    }
    if (!/\b(?:reliab|consisten|valid|interpret)\w*/iu.test(message)) {
      findings.push(finding(
        "revision_conceptual_distinction_missing",
        "active_boundary_not_connected_to_revision",
        "tutor_message"
      ));
    }
  }
  if (testCase.selected_mode === "present_transfer") {
    if (!/\b(?:new context|transfer|apply)\b/iu.test(message)) {
      findings.push(finding(
        "transfer_application_purpose_missing",
        "new_context_application_not_introduced",
        "tutor_message"
      ));
    }
    if (/\b(?:A\.|B\.|C\.|D\.)\s|\?\s*$/u.test(output.tutor_message.trim())) {
      findings.push(finding(
        "provider_fabricated_transfer_item",
        "platform_owned_item_presentation_detected",
        "tutor_message"
      ));
    }
  }
  if (testCase.selected_mode === "complete_episode" &&
    output.tutor_message.length > 400) {
    findings.push(finding(
      "completion_not_concise",
      "completion_message_exceeds_400_characters",
      "tutor_message"
    ));
  }
  return findings;
}

function parseOperationOutput(
  operation: TopicDialogueOperation,
  value: unknown
): OperationOutput | null {
  const parsed = TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS[operation]
    .safeParse(value);
  return parsed.success ? parsed.data as OperationOutput : null;
}

function parseProgressionOutput(
  mode: Exclude<TopicDialogueResponseMode, "remain_in_dialogue">,
  value: unknown
): ProgressionOutput | null {
  const parsed = TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS[mode].safeParse(value);
  return parsed.success ? parsed.data as ProgressionOutput : null;
}

export function validateE2A10ProviderOutput(input: {
  testCase: E2A10TopicDialogueCase;
  value: unknown;
}): CandidateValidation {
  const testCase = input.testCase;
  const controlFields = providerControlFields(input.value);
  if (testCase.selected_mode === "remain_in_dialogue") {
    if (!testCase.selected_operation) {
      throw new Error("e2a10_remain_case_operation_missing");
    }
    const base = validateTopicDialogueOperationOutput({
      selected_response_mode: "remain_in_dialogue",
      selected_operation: testCase.selected_operation,
      output: input.value,
      latest_student_message: testCase.dialogue_input.latest_student_message,
      distractor_anchor: testCase.distractor_anchor,
      misconception_target: testCase.misconception_target,
      evidence_needed: testCase.evidence_needed,
      strategies_already_attempted: testCase.strategies_already_attempted,
      prohibited_repeated_strategies:
        testCase.strategies_marked_unsuccessful
    });
    const output = parseOperationOutput(testCase.selected_operation, input.value);
    const message = output?.student_facing_message ?? null;
    const custom = operationSpecificFindings(testCase, output);
    const privacyFindings = message
      ? findVisibleTextPrivacyFindings(message, "student_facing_message")
      : [];
    const answerKeyFindings = message &&
      /\b(?:the correct answer is|correct option is|answer key|unadministered answer)\b/iu.test(message)
      ? ["answer_key_language_detected"]
      : [];
    const findings = [
      ...base.findings,
      ...custom,
      ...controlFields.map((field) => finding(
        "provider_owned_control_field_forbidden",
        field,
        field
      ))
    ];
    const codes = (predicate: (code: string) => boolean) => findings
      .filter((entry) => predicate(entry.rule_code))
      .map((entry) => entry.rule_code);
    const dimensions = {
      provider_schema_valid: dimension(base.dimensions.schema_valid
        ? [] : ["operation_schema_mismatch"]),
      selected_mode: dimension(controlFields.includes("response_mode")
        ? ["provider_selected_response_mode"] : []),
      selected_operation: dimension(controlFields.includes("dialogue_operation")
        ? ["provider_selected_dialogue_operation"] : []),
      operation_fulfilled: dimension(codes((code) => [
        "anchor_evidence_not_requested",
        "strategy_not_genuinely_adapted",
        "protected_request_not_declined",
        "task_not_clarified_first",
        "evidence_request_alignment_missing",
        "task_clarification_priority_failed",
        "protected_redirect_quality_failed",
        "recurrence_repair_quality_failed",
        "partial_reasoning_refinement_failed"
      ].includes(code))),
      direct_response_to_latest_message: dimension(base.dimensions.direct_response
        ? [] : ["latest_message_intent_not_addressed"]),
      semantic_anchor_continuity: dimension(base.dimensions.anchor_continuity
        ? [] : ["semantic_anchor_continuity_missing"]),
      evidence_request_alignment: dimension(codes((code) =>
        code === "evidence_request_alignment_missing" ||
        code === "anchor_evidence_not_requested"
      )),
      task_clarification_priority: dimension(codes((code) =>
        code.startsWith("task_")
      )),
      protected_redirect_quality: dimension(codes((code) =>
        code.startsWith("protected_")
      )),
      recurrence_repair_quality: dimension(codes((code) =>
        code.startsWith("recurrence_")
      )),
      strategy_adaptation: dimension(codes((code) =>
        code === "strategy_not_genuinely_adapted"
      )),
      unauthorized_progression_absent: dimension(base.dimensions.progression_safe
        ? [] : ["unauthorized_progression_language"]),
      unsupported_mastery_absent: dimension(codes((code) =>
        code === "unsupported_mastery_acceptance"
      )),
      provider_control_fields_absent: dimension(controlFields.map((field) =>
        `provider_control_field:${field}`
      )),
      privacy_safe: dimension(privacyFindings.map((entry) =>
        entry.matched_label
      )),
      answer_key_safe: dimension(answerKeyFindings)
    };
    return {
      valid: output !== null &&
        Object.values(dimensions).every((entry) => entry.passed),
      selected_mode: testCase.selected_mode,
      selected_operation: testCase.selected_operation,
      output,
      visible_message: message,
      findings,
      dimensions,
      privacy_findings: privacyFindings,
      answer_key_findings: answerKeyFindings
    };
  }

  const progressionMode = testCase.selected_mode as Exclude<
    TopicDialogueResponseMode,
    "remain_in_dialogue"
  >;
  const output = parseProgressionOutput(progressionMode, input.value);
  const base = validateTopicDialogueModeOutput({
    selected_mode: progressionMode,
    output: input.value,
    latest_student_message: testCase.dialogue_input.latest_student_message,
    latest_response_classification:
      testCase.dialogue_input.latest_student_message_classification ??
        "server_classification_unavailable",
    distractor_anchor: testCase.distractor_anchor,
    misconception_target: testCase.misconception_target,
    strategies_already_attempted: [],
    platform_evidence_summary:
      testCase.dialogue_input.progression_authorization
        .authorization_evidence_summary
  });
  const message = output
    ? `${output.tutor_message} ${output.student_safe_summary}`
    : null;
  const custom = progressionSpecificFindings(testCase, output);
  const privacyFindings = output ? [
    ...findVisibleTextPrivacyFindings(output.tutor_message, "tutor_message"),
    ...findVisibleTextPrivacyFindings(
      output.student_safe_summary,
      "student_safe_summary"
    )
  ] : [];
  const answerKeyFindings = message &&
    /\b(?:the correct answer is|correct option is|answer key|unadministered answer)\b/iu.test(message)
    ? ["answer_key_language_detected"]
    : [];
  const baseFindings = base.issues.map((entry) => finding(
    entry.rule_code,
    entry.safe_detail,
    entry.field_path
  ));
  const findings = [
    ...baseFindings,
    ...custom,
    ...controlFields.map((field) => finding(
      "provider_owned_control_field_forbidden",
      field,
      field
    ))
  ];
  const allCodes = findings.map((entry) => entry.rule_code);
  const dimensions = {
    provider_schema_valid: dimension(output ? [] : [
      "schema_does_not_match_selected_mode"
    ]),
    selected_mode: dimension(controlFields.includes("response_mode")
      ? ["provider_selected_response_mode"] : []),
    selected_operation: dimension(controlFields.includes("dialogue_operation")
      ? ["provider_selected_dialogue_operation"] : []),
    mode_fulfilled: dimension(allCodes.filter((code) => [
      "revision_language_required",
      "transfer_language_required",
      "completion_language_required",
      "revision_target_missing",
      "revision_conceptual_distinction_missing",
      "transfer_application_purpose_missing",
      "completion_not_concise"
    ].includes(code))),
    revision_transfer_completion_separation: dimension(allCodes.filter((code) => [
      "revision_transfer_conflation",
      "new_task_after_completion",
      "transfer_task_presented_by_provider",
      "provider_fabricated_transfer_item"
    ].includes(code))),
    no_overclaim: dimension(allCodes.filter((code) =>
      code === "completion_overclaim"
    )),
    provider_control_fields_absent: dimension(controlFields.map((field) =>
      `provider_control_field:${field}`
    )),
    privacy_safe: dimension(privacyFindings.map((entry) =>
      entry.matched_label
    )),
    answer_key_safe: dimension(answerKeyFindings)
  };
  return {
    valid: base.valid && output !== null &&
      Object.values(dimensions).every((entry) => entry.passed),
    selected_mode: testCase.selected_mode,
    selected_operation: null,
    output,
    visible_message: message,
    findings,
    dimensions,
    privacy_findings: privacyFindings,
    answer_key_findings: answerKeyFindings
  };
}

function providerError(result: StructuredAgentResult<unknown>) {
  const transport = result.transport_telemetry?.normalized_error;
  return result.error ? {
    category: result.error.category,
    message: result.error.message,
    retryable: result.error.retryable,
    typed_failure_reason: transport?.typed_failure_reason ?? null,
    http_status: transport?.http_status ?? null
  } : null;
}

function buildAttempt(input: {
  testCase: E2A10TopicDialogueCase;
  result: StructuredAgentResult<unknown>;
  attemptIndex: number;
}): ProviderAttempt {
  const validation = validateE2A10ProviderOutput({
    testCase: input.testCase,
    value: input.result.parsed_output
  });
  return {
    attempt_index: input.attemptIndex,
    regeneration: input.attemptIndex > 1,
    provider_request_status: input.result.status,
    generation_dispatched:
      input.result.transport_telemetry?.fetch_invoked === true ||
      input.result.provider === "mock",
    provider_request_id:
      input.result.provider_request_id ??
      input.result.transport_telemetry?.provider_request_id ??
      null,
    provider_response_id:
      input.result.provider_response_id ??
      input.result.transport_telemetry?.provider_response_id ??
      null,
    provider_error: providerError(input.result),
    parsed_output_present: input.result.parsed_output !== undefined,
    raw_output_present: input.result.raw_output !== undefined,
    raw_output_sha256: input.result.raw_output === undefined
      ? null
      : stableHash(input.result.raw_output),
    safe_provider_output: validation.output,
    validation,
    usage: usageFromResult(input.result),
    latency_ms: input.result.latency_ms
  };
}

function contextCoverage(testCase: E2A10TopicDialogueCase): ContextCoverage {
  const history = testCase.dialogue_input.visible_dialogue_history;
  const studentTurns = history.filter((turn) => turn.actor_type === "student");
  const assistantTurns = history.filter((turn) => turn.actor_type === "agent");
  const expected = [] as typeof history;
  for (let index = 0; index < Math.max(
    studentTurns.length,
    assistantTurns.length
  ); index += 1) {
    if (studentTurns[index]) expected.push(studentTurns[index]!);
    if (assistantTurns[index]) expected.push(assistantTurns[index]!);
  }
  const expectedIds = expected.map((turn) => turn.visible_turn_id);
  const serializedIds = history.map((turn) => turn.visible_turn_id);
  const counts = new Map<string, number>();
  for (const id of serializedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const initialActivityPresent = Boolean(
    testCase.dialogue_input.activity_contract.safe_activity_prompt.trim()
  );
  const latestSeparate = !serializedIds.includes(
    testCase.dialogue_input.latest_student_turn_id
  ) && Boolean(testCase.dialogue_input.latest_student_message.trim());
  const invisibleExcluded = !history.some((turn) =>
    turn.visible_turn_id.includes("hidden_draft") ||
    /invisible draft/iu.test(turn.message_text)
  );
  const complete = !testCase.require_tenth_turn_context || (
    testCase.dialogue_input.dialogue_turn_number === 10 &&
    studentTurns.length === 9 &&
    assistantTurns.length === 9 &&
    expectedIds.length === 18 &&
    JSON.stringify(expectedIds) === JSON.stringify(serializedIds) &&
    JSON.stringify(expected) === JSON.stringify(history) &&
    latestSeparate &&
    initialActivityPresent &&
    invisibleExcluded
  );
  return {
    case_id: testCase.case_id,
    required_for_acceptance: testCase.require_tenth_turn_context,
    prior_student_message_count: studentTurns.length,
    prior_assistant_reply_count: assistantTurns.length,
    expected_visible_turn_ids: expectedIds,
    serialized_visible_turn_ids: serializedIds,
    missing_visible_turn_ids: expectedIds.filter((id) =>
      !serializedIds.includes(id)
    ),
    duplicated_visible_turn_ids: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
    order_matches: JSON.stringify(expectedIds) === JSON.stringify(serializedIds),
    exact_content_matches: JSON.stringify(expected) === JSON.stringify(history),
    latest_student_message_separate: latestSeparate,
    initial_activity_present: initialActivityPresent,
    invisible_history_excluded: invisibleExcluded,
    internal_records_separated: true,
    current_turn_directive_authoritative: true,
    historical_recommendations_non_authoritative: true,
    complete_tenth_turn_context: complete
  };
}

function deterministicRubric(
  validation: CandidateValidation,
  coverage: ContextCoverage
) {
  const criticalNames = new Set([
    "provider_schema_valid",
    "selected_mode",
    "selected_operation",
    "provider_control_fields_absent",
    "privacy_safe",
    "answer_key_safe"
  ]);
  const dimensions = Object.entries(validation.dimensions).map(
    ([name, result]) => ({
      dimension: name,
      status: result.passed ? "passed" as const : "failed" as const,
      severity: criticalNames.has(name) ? "critical" as const : "major" as const,
      issue_codes: result.issue_codes
    })
  );
  dimensions.push({
    dimension: "tenth_turn_context_complete",
    status: coverage.complete_tenth_turn_context
      ? "passed" as const
      : "failed" as const,
    severity: "critical" as const,
    issue_codes: coverage.complete_tenth_turn_context
      ? []
      : ["tenth_turn_context_incomplete"]
  });
  return dimensions;
}

function fallbackForCase(testCase: E2A10TopicDialogueCase): CandidateOutput {
  if (testCase.selected_mode === "remain_in_dialogue") {
    if (!testCase.selected_operation) {
      throw new Error("e2a10_operation_fallback_missing_operation");
    }
    return buildTopicDialogueOperationFallback({
      operation: testCase.selected_operation,
      distractor_anchor: testCase.distractor_anchor
    });
  }
  return buildTopicDialogueModeFallback({
    selected_mode: testCase.selected_mode,
    distractor_anchor: testCase.distractor_anchor,
    misconception_target: testCase.misconception_target,
    platform_evidence_summary:
      testCase.dialogue_input.progression_authorization
        .authorization_evidence_summary
  }) as CandidateOutput;
}

function finalizeCase(
  testCase: E2A10TopicDialogueCase,
  attempts: ProviderAttempt[],
  forcedFinding?: string
): CaseResult {
  const finalAttempt = attempts.at(-1);
  const finalValidation = finalAttempt?.validation ??
    validateE2A10ProviderOutput({ testCase, value: undefined });
  const candidateValid = finalAttempt?.provider_request_status === "completed" &&
    finalValidation.valid;
  const coverage = contextCoverage(testCase);
  const rubric = deterministicRubric(finalValidation, coverage);
  const critical = rubric.filter((entry) =>
    entry.status === "failed" && entry.severity === "critical"
  ).map((entry) => entry.dimension);
  const major = rubric.filter((entry) =>
    entry.status === "failed" && entry.severity === "major"
  ).map((entry) => entry.dimension);
  if (forcedFinding && !major.includes(forcedFinding)) major.push(forcedFinding);
  const providerFailed = attempts.length > 0 &&
    attempts.every((entry) => entry.provider_request_status !== "completed");
  const passed = candidateValid && coverage.complete_tenth_turn_context &&
    critical.length === 0 && major.length === 0;
  void fallbackForCase(testCase);
  return {
    case_id: testCase.case_id,
    case_number: testCase.case_number,
    selected_mode: testCase.selected_mode,
    selected_operation: testCase.selected_operation,
    status: passed
      ? "passed_automated"
      : attempts.length === 0
        ? "skipped_budget"
        : providerFailed
          ? "provider_failed"
          : "failed",
    first_attempt_valid: attempts[0]?.validation.valid === true,
    regeneration_count: attempts.filter((entry) => entry.regeneration).length,
    regeneration_succeeded:
      attempts.length === 2 && attempts[1]?.validation.valid === true,
    candidate_semantic_valid: candidateValid,
    deterministic_fallback_used: !candidateValid,
    provider_attempts: attempts,
    platform_safety: {
      selected_mode: testCase.selected_mode,
      selected_operation: testCase.selected_operation,
      provider_schema_valid:
        finalValidation.dimensions.provider_schema_valid?.passed === true,
      provider_semantic_valid: candidateValid,
      regeneration_attempted: attempts.some((entry) => entry.regeneration),
      regeneration_succeeded:
        attempts.length === 2 && attempts[1]?.validation.valid === true,
      deterministic_fallback_used: !candidateValid,
      platform_authorized_action: testCase.selected_mode,
      platform_gate_result: "authorized_mode_and_operation_preserved",
      ui_progression_available: testCase.selected_mode !== "remain_in_dialogue",
      executed_transition: false,
      candidate_case_pass: passed
    },
    context_coverage: coverage,
    privacy_findings: finalValidation.privacy_findings,
    answer_key_findings: finalValidation.answer_key_findings,
    deterministic_rubric: rubric,
    critical_findings: critical,
    major_findings: major
  };
}

function requestForCase(testCase: E2A10TopicDialogueCase) {
  if (testCase.selected_mode === "remain_in_dialogue") {
    if (!testCase.selected_operation || !testCase.routing_classification) {
      throw new Error("e2a10_operation_request_context_missing");
    }
    const providerInput = buildTopicDialogueOperationProviderInput({
      dialogue_input: testCase.dialogue_input,
      selected_operation: testCase.selected_operation,
      routing_classification: testCase.routing_classification,
      distractor_anchor: testCase.distractor_anchor,
      misconception_target: testCase.misconception_target,
      evidence_needed: testCase.evidence_needed,
      strategies_already_attempted: testCase.strategies_already_attempted,
      strategies_marked_unsuccessful:
        testCase.strategies_marked_unsuccessful
    });
    const envelope = buildTopicDialogueOperationRequestEnvelope({
      selected_response_mode: "remain_in_dialogue",
      selected_operation: testCase.selected_operation,
      provider_input: providerInput,
      prompt_context: {
        latest_student_message: providerInput.latest_student_message,
        distractor_anchor: testCase.distractor_anchor,
        misconception_or_partial_understanding_target:
          testCase.misconception_target,
        evidence_needed: testCase.evidence_needed,
        strategies_already_attempted: testCase.strategies_already_attempted,
        strategies_marked_unsuccessful:
          testCase.strategies_marked_unsuccessful,
        visible_dialogue_history: providerInput.visible_dialogue_history
      }
    });
    return {
      provider_input: envelope.provider_input,
      instructions: envelope.instructions,
      output_schema: envelope.output_schema,
      output_schema_version: envelope.output_schema_version,
      schema_name: envelope.schema_name
    };
  }
  const providerInput = buildTopicDialogueModeProviderInput({
    dialogue_input: testCase.dialogue_input,
    selected_mode: testCase.selected_mode
  });
  const envelope = buildTopicDialogueModeRequestEnvelope({
    authorization: testCase.dialogue_input.progression_authorization,
    provider_input: providerInput
  });
  return {
    provider_input: envelope.provider_input,
    instructions: envelope.instructions,
    output_schema: envelope.output_schema,
    output_schema_version: envelope.output_schema_version,
    schema_name: envelope.schema_name
  };
}

function repairInstructions(
  testCase: E2A10TopicDialogueCase,
  originalInstructions: string,
  validation: CandidateValidation
) {
  const failedRequirements = [...new Set([
    ...validation.findings.map((entry) => entry.rule_code),
    ...Object.values(validation.dimensions).flatMap((entry) =>
      entry.issue_codes
    )
  ])];
  if (testCase.selected_mode === "remain_in_dialogue") {
    if (!testCase.selected_operation) {
      throw new Error("e2a10_operation_repair_missing_operation");
    }
    return buildTopicDialogueOperationRepairInstructions({
      operation: testCase.selected_operation,
      original_instructions: originalInstructions,
      latest_student_message: testCase.dialogue_input.latest_student_message,
      distractor_anchor: testCase.distractor_anchor,
      failed_requirements: failedRequirements,
      prohibited_repeated_strategies:
        testCase.strategies_marked_unsuccessful
    });
  }
  return `${originalInstructions}\n\n` +
    "The prior output was rejected. " +
    `The platform-selected response mode remains exactly ${testCase.selected_mode}. ` +
    "Do not select another mode, operation, action, readiness state, or runtime state.\n" +
    `Latest student message: ${testCase.dialogue_input.latest_student_message}\n` +
    `Current distractor anchor: ${testCase.distractor_anchor}\n` +
    `Correct every failed requirement: ${failedRequirements.join(", ") || "mode contract"}.\n` +
    "Return one fresh complete object for the same mode-specific schema.";
}

function estimatedInputTokens(testCase: E2A10TopicDialogueCase) {
  const request = requestForCase(testCase);
  return Math.ceil(
    `${request.instructions}\n${JSON.stringify(request.provider_input)}`.length / 3
  );
}

function assertBudgetBeforeDispatch(input: {
  budget: E2A10Budget;
  completedResults: CaseResult[];
  currentAttempts: ProviderAttempt[];
  testCase: E2A10TopicDialogueCase;
  modelConfig: AgentModelConfig;
  regeneration: boolean;
}) {
  const prior = resultUsage(input.completedResults);
  const current = aggregateUsage(input.currentAttempts);
  const currentCalls = input.currentAttempts.filter((entry) =>
    entry.generation_dispatched
  ).length;
  if (!input.regeneration && input.completedResults.length >=
    input.budget.maximum_cases) {
    throw new Error("e2a10_case_budget_exceeded");
  }
  if (!input.regeneration && prior.initial_generation_calls + 1 >
    input.budget.maximum_initial_generation_calls) {
    throw new Error("e2a10_initial_call_budget_exceeded");
  }
  if (input.regeneration && prior.regeneration_generation_calls +
    input.currentAttempts.filter((entry) =>
      entry.regeneration && entry.generation_dispatched
    ).length + 1 > input.budget.maximum_regeneration_calls) {
    throw new Error("e2a10_regeneration_call_budget_exceeded");
  }
  if (prior.generation_provider_calls + currentCalls + 1 >
    input.budget.maximum_total_generation_calls) {
    throw new Error("e2a10_total_call_budget_exceeded");
  }
  if (prior.input_tokens + current.input_tokens +
    estimatedInputTokens(input.testCase) > input.budget.maximum_input_tokens) {
    throw new Error("e2a10_input_token_budget_insufficient");
  }
  if (prior.output_tokens + current.output_tokens +
    (input.modelConfig.max_output_tokens ?? 3500) >
    input.budget.maximum_output_tokens) {
    throw new Error("e2a10_output_token_budget_insufficient");
  }
  const attempts = [
    ...input.completedResults.flatMap((entry) => entry.provider_attempts),
    ...input.currentAttempts
  ];
  const priced = attempts.filter((entry) =>
    entry.usage.estimated_cost_usd !== null
  );
  const priorCost = priced.reduce(
    (sum, entry) => sum + (entry.usage.estimated_cost_usd ?? 0),
    0
  );
  const reserve = priced.length === 0 ? 0 : priorCost / priced.length;
  if (priced.length === attempts.length && priorCost + reserve >
    input.budget.maximum_estimated_cost_usd) {
    throw new Error("e2a10_cost_budget_insufficient");
  }
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "canary-manifest.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    operationContract: path.join(runDir, "dialogue-operation-contract.json"),
    requestCompilation: path.join(runDir, "all-role-request-compilation.json"),
    protocol: path.join(runDir, "canary-protocol.json"),
    providerCases: path.join(runDir, "provider-cases.jsonl"),
    providerOutputs: path.join(runDir, "provider-outputs.jsonl"),
    candidateValidation: path.join(runDir, "candidate-validation.jsonl"),
    platformSafety: path.join(runDir, "platform-safety.jsonl"),
    contextCoverage: path.join(runDir, "context-coverage.jsonl"),
    privacyResults: path.join(runDir, "privacy-results.jsonl"),
    deterministicRubric: path.join(runDir, "deterministic-rubric.jsonl"),
    providerUsage: path.join(runDir, "provider-usage.json"),
    humanReviewPacket: path.join(runDir, "human-review-packet.json"),
    summary: path.join(runDir, "canary-summary.json")
  };
}

function writeCaseInput(
  paths: ReturnType<typeof artifactPaths>,
  testCase: E2A10TopicDialogueCase,
  dispatchStatus: "planned" | "skipped",
  skippedReason: string | null = null
) {
  const request = requestForCase(testCase);
  appendJsonl(paths.providerCases, {
    case_id: testCase.case_id,
    case_number: testCase.case_number,
    selected_mode: testCase.selected_mode,
    selected_dialogue_operation: testCase.selected_operation,
    platform_authorized_action: testCase.selected_mode,
    scenario_truth_summary: testCase.scenario_truth_summary,
    latest_student_message: testCase.dialogue_input.latest_student_message,
    safe_visible_history_excerpt:
      testCase.dialogue_input.visible_dialogue_history.slice(-4),
    distractor_anchor: testCase.distractor_anchor,
    evidence_needed: testCase.evidence_needed,
    strategies_already_attempted: testCase.strategies_already_attempted,
    strategies_marked_unsuccessful:
      testCase.strategies_marked_unsuccessful,
    request_schema_name: request.schema_name,
    request_output_schema_version: request.output_schema_version,
    visible_history_turn_count:
      testCase.dialogue_input.visible_dialogue_history.length,
    dispatch_status: dispatchStatus,
    dispatch_skipped_reason: skippedReason
  });
}

function writeAttemptArtifacts(
  paths: ReturnType<typeof artifactPaths>,
  result: CaseResult
) {
  for (const attempt of result.provider_attempts) {
    appendJsonl(paths.providerOutputs, {
      case_id: result.case_id,
      attempt_index: attempt.attempt_index,
      regeneration: attempt.regeneration,
      provider_request_status: attempt.provider_request_status,
      generation_dispatched: attempt.generation_dispatched,
      provider_request_id: attempt.provider_request_id,
      provider_response_id: attempt.provider_response_id,
      provider_error: attempt.provider_error,
      parsed_output_present: attempt.parsed_output_present,
      raw_output_present: attempt.raw_output_present,
      raw_output_sha256: attempt.raw_output_sha256,
      safe_provider_output: attempt.safe_provider_output,
      usage: attempt.usage,
      latency_ms: attempt.latency_ms
    });
    appendJsonl(paths.candidateValidation, {
      case_id: result.case_id,
      attempt_index: attempt.attempt_index,
      regeneration: attempt.regeneration,
      valid: attempt.validation.valid,
      selected_mode: attempt.validation.selected_mode,
      selected_dialogue_operation: attempt.validation.selected_operation,
      dimensions: attempt.validation.dimensions,
      findings: attempt.validation.findings
    });
  }
  appendJsonl(paths.platformSafety, {
    case_id: result.case_id,
    ...result.platform_safety
  });
  appendJsonl(paths.contextCoverage, result.context_coverage);
  appendJsonl(paths.privacyResults, {
    case_id: result.case_id,
    privacy_safe: result.privacy_findings.length === 0,
    answer_key_safe: result.answer_key_findings.length === 0,
    privacy_findings: result.privacy_findings,
    answer_key_findings: result.answer_key_findings
  });
  appendJsonl(paths.deterministicRubric, {
    case_id: result.case_id,
    status: result.status,
    rubric: result.deterministic_rubric,
    critical_findings: result.critical_findings,
    major_findings: result.major_findings
  });
}

async function executeCases(input: {
  cases: E2A10TopicDialogueCase[];
  provider: LlmProvider;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
  budget: E2A10Budget;
  paths: ReturnType<typeof artifactPaths>;
  runId: string;
}) {
  const results: CaseResult[] = [];
  let stopReason: string | null = null;
  for (const testCase of input.cases) {
    if (stopReason) {
      writeCaseInput(input.paths, testCase, "skipped", stopReason);
      const skipped = finalizeCase(testCase, [], stopReason);
      results.push(skipped);
      writeAttemptArtifacts(input.paths, skipped);
      continue;
    }
    writeCaseInput(input.paths, testCase, "planned");
    const attempts: ProviderAttempt[] = [];
    try {
      for (let attemptIndex = 1; attemptIndex <= 2; attemptIndex += 1) {
        assertBudgetBeforeDispatch({
          budget: input.budget,
          completedResults: results,
          currentAttempts: attempts,
          testCase,
          modelConfig: input.modelConfig,
          regeneration: attemptIndex === 2
        });
        const request = requestForCase(testCase);
        const priorValidation = attempts.at(-1)?.validation;
        const providerResult = await input.provider.executeStructured<
          typeof request.provider_input,
          unknown
        >({
          agent_name: "topic_dialogue_agent",
          model_config: input.modelConfig,
          instructions: attemptIndex === 1 || !priorValidation
            ? request.instructions
            : repairInstructions(
                testCase,
                request.instructions,
                priorValidation
              ),
          input: request.provider_input,
          output_schema: request.output_schema as z.ZodType<unknown>,
          schema_name: request.schema_name,
          client_request_id:
            `${input.runId}_${testCase.case_id}_${attemptIndex}`,
          timeout_ms: input.timeoutMs,
          metadata: {
            evaluation: "e2a10_v7_topic_dialogue_canary",
            case_id: testCase.case_id,
            selected_response_mode: testCase.selected_mode,
            selected_dialogue_operation:
              testCase.selected_operation ?? "none",
            candidate_hash_prefix: E2A9_CANDIDATE_HASH.slice(0, 12)
          }
        });
        const attempt = buildAttempt({
          testCase,
          result: providerResult,
          attemptIndex
        });
        attempts.push(attempt);
        if (providerResult.status !== "completed" || attempt.validation.valid) {
          break;
        }
      }
      const result = finalizeCase(testCase, attempts);
      results.push(result);
      writeAttemptArtifacts(input.paths, result);
      if (result.status === "provider_failed") {
        stopReason = `provider_failure_after:${testCase.case_id}`;
      }
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "e2a10_budget_or_dispatch_block";
      const result = finalizeCase(testCase, attempts, reason);
      results.push(result);
      writeAttemptArtifacts(input.paths, result);
      stopReason = reason;
    }
  }
  return results;
}

function finalValidation(result: CaseResult) {
  return result.provider_attempts.at(-1)?.validation ?? null;
}

function findingCount(results: CaseResult[], dimensionName: string) {
  return results.filter((result) =>
    finalValidation(result)?.dimensions[dimensionName]?.passed === false
  ).length;
}

function buildSummary(
  results: CaseResult[],
  budget: E2A10Budget,
  protectedBefore: ReturnType<typeof e2a10ProtectedArtifactSnapshot>,
  protectedAfter: ReturnType<typeof e2a10ProtectedArtifactSnapshot>
) {
  const usage = resultUsage(results);
  const attempts = results.flatMap((entry) => entry.provider_attempts);
  const contextRequired = results.filter((entry) =>
    entry.context_coverage.required_for_acceptance
  );
  const protectedUnchanged = protectedBefore.aggregate_sha256 ===
    protectedAfter.aggregate_sha256;
  const allDispatched = results.length === 10 && results.every((entry) =>
    entry.provider_attempts[0]?.generation_dispatched === true
  );
  const budgetWithinLimits =
    usage.generation_provider_calls <= budget.maximum_total_generation_calls &&
    usage.initial_generation_calls <= budget.maximum_initial_generation_calls &&
    usage.regeneration_generation_calls <= budget.maximum_regeneration_calls &&
    usage.input_tokens <= budget.maximum_input_tokens &&
    usage.output_tokens <= budget.maximum_output_tokens &&
    (!usage.pricing_available ||
      (usage.estimated_cost_usd ?? Infinity) <=
        budget.maximum_estimated_cost_usd);
  const eventualPass = allDispatched && results.every((entry) =>
    entry.status === "passed_automated" &&
    entry.candidate_semantic_valid &&
    !entry.deterministic_fallback_used &&
    entry.critical_findings.length === 0 &&
    entry.major_findings.length === 0
  ) && contextRequired.length === 2 && contextRequired.every((entry) =>
    entry.context_coverage.complete_tenth_turn_context
  ) && budgetWithinLimits && protectedUnchanged;
  const regenerationCount = results.reduce((sum, entry) =>
    sum + entry.regeneration_count, 0
  );
  const stablePass = eventualPass && regenerationCount <= 2;
  const incomplete = !allDispatched || results.some((entry) =>
    entry.status === "skipped_budget" || entry.status === "provider_failed"
  );
  const finalStatus = stablePass
    ? "v7_canary_passed_pending_human_review" as const
    : eventualPass && regenerationCount > 2
      ? "v7_canary_failed_stability_threshold" as const
      : incomplete
        ? "v7_canary_incomplete" as const
        : "v7_canary_failed" as const;
  return {
    summary_version: "e2a10-v7-live-canary-summary-v1",
    final_status: finalStatus,
    automated_canary_passed: stablePass,
    eventual_semantic_pass: eventualPass,
    stability_threshold_passed: regenerationCount <= 2,
    human_review_status: "pending",
    human_review_required: true,
    human_approval_claimed: false,
    candidate_approved: false,
    candidate_activated: false,
    thirty_case_evaluation_executed: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false,
    case_count: results.length,
    initial_cases_dispatched: results.filter((entry) =>
      entry.provider_attempts[0]?.generation_dispatched
    ).length,
    automated_case_pass_count: results.filter((entry) =>
      entry.status === "passed_automated"
    ).length,
    automated_case_fail_count: results.filter((entry) =>
      entry.status !== "passed_automated"
    ).length,
    first_attempt_valid_count: results.filter((entry) =>
      entry.first_attempt_valid
    ).length,
    candidate_validation_failure_count: attempts.filter((entry) =>
      !entry.validation.valid
    ).length,
    regeneration_count: regenerationCount,
    regeneration_success_count: results.filter((entry) =>
      entry.regeneration_succeeded
    ).length,
    fallback_count: results.filter((entry) =>
      entry.deterministic_fallback_used
    ).length,
    context_coverage_pass_count: contextRequired.filter((entry) =>
      entry.context_coverage.complete_tenth_turn_context
    ).length,
    context_coverage_required_count: 2,
    privacy_finding_count: results.reduce((sum, entry) =>
      sum + entry.privacy_findings.length, 0
    ),
    answer_key_finding_count: results.reduce((sum, entry) =>
      sum + entry.answer_key_findings.length, 0
    ),
    provider_selected_operation_count: findingCount(
      results,
      "selected_operation"
    ),
    provider_selected_platform_action_count: results.filter((entry) =>
      finalValidation(entry)?.dimensions.provider_control_fields_absent
        ?.passed === false
    ).length,
    unauthorized_language_finding_count: findingCount(
      results,
      "unauthorized_progression_absent"
    ),
    direct_response_failure_count: findingCount(
      results,
      "direct_response_to_latest_message"
    ),
    strategy_adaptation_failure_count: findingCount(
      results,
      "strategy_adaptation"
    ),
    distractor_focus_failure_count: findingCount(
      results,
      "semantic_anchor_continuity"
    ),
    task_clarification_failure_count: findingCount(
      results,
      "task_clarification_priority"
    ),
    protected_redirect_failure_count: findingCount(
      results,
      "protected_redirect_quality"
    ),
    recurrence_repair_failure_count: findingCount(
      results,
      "recurrence_repair_quality"
    ),
    unsupported_mastery_acceptance_count: findingCount(
      results,
      "unsupported_mastery_absent"
    ),
    revision_transfer_completion_conflation_count: findingCount(
      results,
      "revision_transfer_completion_separation"
    ),
    completion_overclaim_count: findingCount(results, "no_overclaim"),
    critical_invariant_failure_count: results.reduce((sum, entry) =>
      sum + entry.critical_findings.length, 0
    ),
    major_invariant_failure_count: results.reduce((sum, entry) =>
      sum + entry.major_findings.length, 0
    ),
    invalid_platform_transition_count: results.filter((entry) =>
      entry.platform_safety.executed_transition
    ).length,
    provider_usage: usage,
    budget,
    budget_within_limits: budgetWithinLimits,
    protected_artifacts_before_sha256: protectedBefore.aggregate_sha256,
    protected_artifacts_after_sha256: protectedAfter.aggregate_sha256,
    protected_artifacts_unchanged: protectedUnchanged,
    database_fixture_records_created: 0,
    database_fixture_cleanup_complete: true,
    case_results: results.map((entry) => ({
      case_id: entry.case_id,
      case_number: entry.case_number,
      selected_mode: entry.selected_mode,
      selected_dialogue_operation: entry.selected_operation,
      status: entry.status,
      candidate_semantic_valid: entry.candidate_semantic_valid,
      platform_safe:
        entry.platform_safety.platform_gate_result ===
          "authorized_mode_and_operation_preserved",
      first_attempt_valid: entry.first_attempt_valid,
      regeneration_count: entry.regeneration_count,
      deterministic_fallback_used: entry.deterministic_fallback_used,
      critical_findings: entry.critical_findings,
      major_findings: entry.major_findings
    }))
  };
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line) as T) : [];
}

function buildHumanReviewPacket(
  cases: E2A10TopicDialogueCase[],
  results: CaseResult[],
  paths: ReturnType<typeof artifactPaths>
) {
  const outputs = readJsonl<Record<string, unknown>>(paths.providerOutputs);
  const validations = readJsonl<Record<string, unknown>>(
    paths.candidateValidation
  );
  return {
    packet_version: "e2a10-v7-human-review-packet-v1",
    review_target: "v7_topic_dialogue_provider_outputs",
    review_status: "pending",
    human_review_required: true,
    human_review_completed: false,
    human_reviewer: null,
    human_decision: null,
    human_scores: null,
    no_human_review_fabricated: true,
    provider_output_count: outputs.length,
    cases: cases.map((testCase) => {
      const result = results.find((entry) =>
        entry.case_id === testCase.case_id
      );
      if (!result) throw new Error(`e2a10_review_case_missing:${testCase.case_id}`);
      return {
        case_id: testCase.case_id,
        selected_mode: testCase.selected_mode,
        selected_dialogue_operation: testCase.selected_operation,
        latest_student_message: testCase.dialogue_input.latest_student_message,
        safe_visible_history_excerpt:
          testCase.dialogue_input.visible_dialogue_history.slice(-4),
        distractor_anchor: testCase.distractor_anchor,
        evidence_needed: testCase.evidence_needed,
        attempted_strategies: testCase.strategies_already_attempted,
        prohibited_repeated_strategies:
          testCase.strategies_marked_unsuccessful,
        provider_attempts: outputs.filter((entry) =>
          entry.case_id === testCase.case_id
        ),
        validator_findings: validations.filter((entry) =>
          entry.case_id === testCase.case_id
        ),
        fallback_result: result.deterministic_fallback_used
          ? fallbackForCase(testCase)
          : null,
        platform_safety_result: result.platform_safety,
        context_coverage: result.context_coverage,
        privacy_result: {
          privacy_findings: result.privacy_findings,
          answer_key_findings: result.answer_key_findings
        },
        deterministic_rubric: result.deterministic_rubric,
        unresolved_manual_dimensions: [
          "naturalness_and_tone",
          "pedagogical_quality",
          "conceptual_precision",
          "student_specificity",
          "strategy_difference_quality"
        ],
        human_review: {
          status: "pending",
          pass: null,
          notes: null,
          critical_failure: null
        }
      };
    })
  };
}

function newRunId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, "")
    .slice(0, 14);
  return `e2a10_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export async function executeE2A10Canary(input: {
  live: boolean;
  provider?: LlmProvider;
  artifactRoot?: string;
  runId?: string;
  skipCleanTreeForTest?: boolean;
}) {
  const candidate = evaluateE2A9Candidate();
  const budget = resolveE2A10Budget();
  const cases = e2a10CanaryCases();
  const preflight = await inspectE2A10Preflight({
    requireLiveEnvironment: input.live,
    requireCleanTree: input.live && !input.skipCleanTreeForTest
  });
  if (!preflight.passed) {
    throw new Error(`e2a10_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const runId = input.runId ?? newRunId();
  const root = input.artifactRoot ?? E2A10_ARTIFACT_ROOT;
  const runDir = path.join(root, runId);
  if (existsSync(runDir)) throw new Error("e2a10_run_already_exists");
  mkdirSync(runDir, { recursive: true });
  const paths = artifactPaths(runDir);
  const protectedBefore = e2a10ProtectedArtifactSnapshot();
  const buildInfo = resolveApplicationBuildInfo(input.live ? {} : {
    artifactPath: path.join(
      os.tmpdir(),
      `e2a10-no-live-build-info-${randomBytes(4).toString("hex")}.json`
    ),
    allowGitFallback: true
  });
  if (!buildInfo.ok) throw new Error(buildInfo.code);
  const compilation = await compileE2A9CandidateRequestsNoNetwork(
    paths.requestCompilation
  );
  const schemaAudit = buildE2A9SchemaAudit();
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  const provider = input.provider ?? new OpenAIResponsesProvider();
  const manifestBase = {
    manifest_version: "e2a10-v7-live-canary-manifest-v1",
    run_id: runId,
    canary_status: "running",
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v5_hash: candidate.failed_v5_hash,
    failed_v6_hash: candidate.failed_v6_hash,
    candidate_approved: false,
    candidate_activated: false,
    application_git_commit: buildInfo.info.application_git_commit,
    application_git_commit_source:
      buildInfo.info.application_git_commit_source,
    protocol_version: E2A10_PROTOCOL_VERSION,
    protocol_hash: e2a10ProtocolHash(),
    evaluator_version: E2A10_EVALUATOR_VERSION,
    provider: input.live ? "openai" : "injected_no_live_provider",
    model: modelConfig.model_name,
    reasoning_effort: modelConfig.reasoning_effort,
    max_output_tokens: modelConfig.max_output_tokens,
    provider_timeout_ms:
      candidate.full_candidate.runtime_policy.provider_timeout_ms,
    provider_case_concurrency: 1,
    adapter_version: input.live
      ? OPENAI_RESPONSES_ADAPTER_VERSION
      : "injected-test-provider",
    transport_retries: 0,
    operation_prompt_family_version:
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
    operation_prompt_family_hash:
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
    operation_input_schema_version:
      TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION,
    operation_contract_family_version:
      TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION,
    operation_output_schema_versions:
      TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
    operation_validator_version: TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION,
    operation_server_envelope_version:
      TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION,
    operation_fallback_version: TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
    progression_prompt_family_version:
      TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
    progression_prompt_family_hash: TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
    progression_validator_version: TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
    progression_server_envelope_version:
      TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
    progression_fallback_version: TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
    budget,
    preflight,
    protected_artifacts_before: protectedBefore,
    human_review_required: true,
    human_review_status: "pending",
    thirty_case_evaluation_executed: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false,
    database_fixture_records_created: 0,
    started_at: new Date().toISOString()
  };
  writeJson(paths.manifest, manifestBase);
  writeJson(paths.candidateDelta, {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v5_hash: candidate.failed_v5_hash,
    failed_v6_hash: candidate.failed_v6_hash,
    exact_delta_paths_from_approved_v2:
      candidate.exact_delta_paths_from_approved_v2,
    exact_delta_paths_from_failed_v6:
      candidate.exact_delta_paths_from_failed_v6,
    inherited_role_hashes: candidate.inherited_role_hashes,
    unrelated_role_configuration_changed: false
  });
  writeJson(paths.operationContract, {
    operation_contract_family_version:
      TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION,
    operation_input_schema_version:
      TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION,
    operation_prompt_family_version:
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
    operation_prompt_family_hash:
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
    operation_prompt_hashes: TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES,
    operation_output_schema_versions:
      TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
    operation_validator_version: TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION,
    operation_server_envelope_version:
      TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION,
    operation_fallback_version: TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
    retained_progression_output_schema_versions: {
      request_revision:
        TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS.request_revision,
      present_transfer:
        TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS.present_transfer,
      complete_episode:
        TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS.complete_episode
    },
    platform_selects_mode_before_request: true,
    platform_selects_operation_before_request: true,
    provider_cannot_select_operation: true,
    provider_control_fields_absent:
      schemaAudit.all_provider_control_fields_absent,
    all_operation_schemas_compile:
      schemaAudit.all_operation_schemas_compile,
    all_retained_progression_schemas_compile:
      schemaAudit.all_retained_progression_schemas_compile
  });
  writeJson(paths.protocol, e2a10ProtocolSnapshot());
  for (const filePath of [
    paths.providerCases,
    paths.providerOutputs,
    paths.candidateValidation,
    paths.platformSafety,
    paths.contextCoverage,
    paths.privacyResults,
    paths.deterministicRubric
  ]) writeFileSync(filePath, "", "utf8");
  if (!compilation.artifact.all_17_roles_compile ||
    compilation.artifact.network_request_count !== 0) {
    throw new Error("e2a10_request_compilation_gate_failed");
  }
  const results = await executeCases({
    cases,
    provider,
    modelConfig,
    timeoutMs: candidate.full_candidate.runtime_policy.provider_timeout_ms,
    budget,
    paths,
    runId
  });
  const protectedAfter = e2a10ProtectedArtifactSnapshot();
  const summary = buildSummary(results, budget, protectedBefore, protectedAfter);
  const review = buildHumanReviewPacket(cases, results, paths);
  writeJson(paths.providerUsage, summary.provider_usage);
  writeJson(paths.humanReviewPacket, review);
  writeJson(paths.summary, summary);
  writeJson(paths.manifest, {
    ...manifestBase,
    canary_status: summary.final_status,
    completed_at: new Date().toISOString(),
    protected_artifacts_after: protectedAfter,
    protected_artifacts_unchanged:
      summary.protected_artifacts_unchanged,
    provider_adapter_attempt_count:
      summary.provider_usage.provider_adapter_attempts,
    generation_call_count:
      summary.provider_usage.generation_provider_calls,
    metadata_only_request_count:
      summary.provider_usage.metadata_only_requests,
    input_tokens: summary.provider_usage.input_tokens,
    output_tokens: summary.provider_usage.output_tokens,
    reasoning_tokens: summary.provider_usage.reasoning_tokens,
    estimated_cost_usd: summary.provider_usage.estimated_cost_usd,
    cost_status: summary.provider_usage.pricing_available
      ? "complete_pricing_available"
      : "pricing_unavailable_or_incomplete",
    database_fixture_cleanup_complete: true,
    artifact_paths: Object.fromEntries(
      Object.entries(paths).map(([key, value]) => [key, relative(value)])
    )
  });
  writeJson(path.join(root, "latest-run.json"), {
    run_id: runId,
    run_directory: relative(runDir),
    final_status: summary.final_status,
    updated_at: new Date().toISOString()
  });
  return { runId, runDir, paths, results, summary, review };
}

export async function executeLiveE2A10Canary() {
  const credential = resolveOpenAICredentialFromEnv(process.env);
  if (!credential.ok) throw new Error(credential.code);
  return withResolvedOpenAICredential(
    credential.credential,
    () => executeE2A10Canary({ live: true })
  );
}

export function loadE2A10Canary(
  runId?: string,
  artifactRoot = E2A10_ARTIFACT_ROOT
) {
  const latestPath = path.join(artifactRoot, "latest-run.json");
  if (!runId && !existsSync(latestPath)) {
    throw new Error("e2a10_latest_run_missing");
  }
  const latest = runId ? {
    run_id: runId,
    run_directory: path.join(artifactRoot, runId)
  } : readJson<{ run_id: string; run_directory: string }>(latestPath);
  const runDir = path.isAbsolute(latest.run_directory)
    ? latest.run_directory
    : path.join(process.cwd(), latest.run_directory);
  if (!existsSync(runDir)) throw new Error("e2a10_run_missing");
  return {
    latest,
    run_directory: runDir,
    manifest: readJson(path.join(runDir, "canary-manifest.json")),
    summary: readJson(path.join(runDir, "canary-summary.json")),
    human_review_packet: readJson(
      path.join(runDir, "human-review-packet.json")
    ),
    provider_usage: readJson(path.join(runDir, "provider-usage.json"))
  };
}

export function temporaryE2A10ArtifactRoot() {
  return path.join(
    os.tmpdir(),
    `e2a10-v7-canary-${randomBytes(5).toString("hex")}`
  );
}
