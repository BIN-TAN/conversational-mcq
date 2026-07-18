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
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import { resolveApplicationBuildInfo } from "@/lib/provenance/application-build-info";
import {
  TOPIC_DIALOGUE_PROMPT_HASH,
  TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  TOPIC_DIALOGUE_PROMPT_VERSION,
  type TopicDialogueOutputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
  TopicDialogueOutputV3Schema,
  topicDialogueV3AuditProjection,
  validateTopicDialogueOutputV3,
  type TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import {
  buildContextCoverage,
  deterministicRubric,
  type RubricDimension
} from "./e2a3-topic-dialogue-evaluation";
import {
  e2a3EvaluationProtocolHash,
  e2a3EvaluationProtocolSnapshot,
  e2a3TopicDialogueCases,
  type E2A3TopicDialogueCase
} from "./e2a3-topic-dialogue-protocol";
import {
  E2A4_APPROVED_V2_HASH,
  E2A4_BASELINE_MANIFEST_PATH,
  E2A4_FAILED_CANDIDATE_PATH,
  E2A4_FAILED_V3_FILE_SHA256,
  E2A4_FAILED_V3_HASH,
  evaluateE2A4TopicDialogueCandidate,
  sha256
} from "./e2a4-topic-dialogue-contract";
import {
  buildE2A4AllRoleSchemaAudit,
  compileE2A4CandidateRequestsNoNetwork
} from "./e2a4-structured-output-audit";
import {
  findVisibleTextPrivacyFindings,
  type StudentPrivacyFinding
} from "./student-privacy-scanner";

export const E2A4_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a4-topic-dialogue-candidate-evaluation"
);
export const E2A4_CANDIDATE_HASH =
  "34323b51adef1839b42be2f93b50874f6c649d2cb31e7f2434fbda132532fbab";
export const E2A4_CANDIDATE_FILE_SHA256 =
  "8178b5a0262c02a60c1e8cd7b436ad2c95013a1be446a625543b22c168806e18";
export const E2A4_SOURCE_PROTOCOL_HASH =
  "9330100dd95d18b7a5581a2d69b3b821c6b8404963060209ff02097f5e43d4e1";
export const E2A4_FAILED_E2A3_ARTIFACT_SHA256 =
  "671d575a0c298a3e3f6a091dd9b5e3a328b50eff865070242ac4d2995971aaa5";
export const E2A4_FAILED_E2A3_RUN_ID = "e2a3_20260718074141_11ad51ca";
export const E2A4_EVALUATOR_VERSION = "e2a4-topic-dialogue-evaluator-v1";

const ACTIVE_APPROVAL_ROOT = path.join(
  process.cwd(),
  ".data",
  "operational-model-upgrade",
  "active-approval"
);
const ACTIVE_BUNDLE_PATH = path.join(ACTIVE_APPROVAL_ROOT, "active-approval-bundle.json");
const FAILED_E2A3_RUN_PATH = path.join(
  process.cwd(),
  ".data",
  "e2a3-topic-dialogue-candidate-evaluation",
  E2A4_FAILED_E2A3_RUN_ID
);

type EvaluationStatus =
  | "provider_evidence_ready_for_human_review"
  | "candidate_evaluation_failed"
  | "candidate_evaluation_incomplete";

export type E2A4Budget = {
  maximum_cases: number;
  maximum_generation_calls: number;
  maximum_input_tokens: number;
  maximum_output_tokens: number;
  maximum_estimated_cost_usd: number;
  maximum_retries_per_case: number;
};

type E2A4CaseResult = {
  case_id: string;
  category: string;
  repetition_index: number;
  student_turn_count: number;
  tenth_turn: boolean;
  phase: "dispatch_canary" | "full_protocol";
  status: "passed_automated" | "failed" | "provider_failed" | "skipped_budget";
  attempts: number;
  retries: number;
  network_dispatch_count: number;
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
  runtime_output: TopicDialogueOutputV1 | null;
  schema_valid: boolean;
  validator_issues: Array<{
    field_path: string;
    rule_code: string;
    blocked_pattern_label?: string;
  }>;
  privacy_findings: StudentPrivacyFinding[];
  context_coverage: ReturnType<typeof buildContextCoverage>;
  deterministic_rubric: RubricDimension[];
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

function directoryHash(root: string) {
  const files = listFiles(root);
  return {
    exists: existsSync(root),
    file_count: files.length,
    sha256: sha256(
      files.map((filePath) => `${relative(filePath)}:${sha256(readFileSync(filePath))}`).join("\n")
    )
  };
}

function envMetadata(filePath: string) {
  if (!existsSync(filePath)) return { exists: false };
  const stat = statSync(filePath);
  return {
    exists: true,
    size: stat.size,
    mode: stat.mode & 0o777,
    mtime_ms: stat.mtimeMs
  };
}

export function e2a4ProtectedArtifactSnapshot() {
  const candidate = evaluateE2A4TopicDialogueCandidate();
  const approvedSchemaAudit = buildE2A4AllRoleSchemaAudit();
  const trackedGroups = {
    approved_v2_candidate: directoryHash(E2A4_BASELINE_MANIFEST_PATH),
    approved_operational_manifest: directoryHash(
      path.join(process.cwd(), "config", "approved-operational-agent-config.json")
    ),
    approved_active_bundle: directoryHash(ACTIVE_APPROVAL_ROOT),
    approved_prompts: directoryHash(path.join(process.cwd(), "src", "lib", "agents", "prompts")),
    approved_provider_schema_semantics: {
      exists: true,
      file_count: approvedSchemaAudit.role_count,
      sha256: stableHash(
        approvedSchemaAudit.role_results.map((entry) => ({
          role: entry.role,
          schema_version: entry.output_schema_version,
          compiled_json_schema_sha256: entry.role === "topic_dialogue_agent"
            ? null
            : entry.compiled_json_schema_sha256
        }))
      )
    },
    approved_topic_validator: directoryHash(
      path.join(process.cwd(), "src", "lib", "services", "student-assessment", "topic-dialogue-agent.ts")
    ),
    approval_evidence: directoryHash(path.join(ACTIVE_APPROVAL_ROOT, "artifacts")),
    activation_evidence: directoryHash(ACTIVE_BUNDLE_PATH),
    prior_provider_runs: directoryHash(
      path.join(process.cwd(), ".data", "operational-model-upgrade", "runs")
    ),
    prior_derived_evaluations: directoryHash(
      path.join(process.cwd(), ".data", "operational-model-upgrade", "derived-evaluations")
    ),
    failed_v3_candidate: directoryHash(E2A4_FAILED_CANDIDATE_PATH),
    failed_e2a3_evaluation: directoryHash(FAILED_E2A3_RUN_PATH)
  };
  const environmentMetadata = {
    env: envMetadata(path.join(process.cwd(), ".env")),
    env_local: envMetadata(path.join(process.cwd(), ".env.local"))
  };
  return {
    snapshot_version: "e2a4-protected-artifact-snapshot-v1",
    candidate_hash: candidate.candidate_configuration_hash,
    tracked_groups: trackedGroups,
    environment_metadata: environmentMetadata,
    aggregate_sha256: stableHash({ trackedGroups, environmentMetadata })
  };
}

function artifactSecretScan(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /authorization\s*:/iu,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a4_artifact_secret_scan_failed");
  }
}

function activeBundle() {
  if (!existsSync(ACTIVE_BUNDLE_PATH)) throw new Error("e2a4_active_approval_bundle_missing");
  return readJson<{
    runtime_candidate_hash?: string;
    source_provider_run_id?: string;
    derived_evaluation_id?: string;
    evaluation_protocol_hash?: string;
    approval_evidence?: { path?: string; sha256?: string };
    approved_manifest?: { path?: string; sha256?: string };
  }>(ACTIVE_BUNDLE_PATH);
}

function filesContaining(value: string) {
  const roots = [
    path.join(process.cwd(), ".data", "operational-model-upgrade", "active-approval"),
    path.join(process.cwd(), ".data", "operational-model-upgrade", "derived-evaluations"),
    path.join(process.cwd(), ".data", "operational-model-upgrade", "runs")
  ];
  const matches: string[] = [];
  for (const root of roots) {
    for (const filePath of listFiles(root)) {
      if (!/\.json(?:l)?$/u.test(filePath)) continue;
      if (readFileSync(filePath, "utf8").includes(value)) matches.push(relative(filePath));
    }
  }
  return matches;
}

export async function inspectE2A4Preflight(input: {
  requireLiveEnvironment?: boolean;
  requireCleanTree?: boolean;
} = {}) {
  const candidate = evaluateE2A4TopicDialogueCandidate();
  const active = activeBundle();
  const schemaAudit = buildE2A4AllRoleSchemaAudit();
  const requestCompilation = await compileE2A4CandidateRequestsNoNetwork(
    path.join(os.tmpdir(), `e2a4-request-compilation-${randomBytes(4).toString("hex")}.json`)
  );
  const baseUrl = resolveOpenAIBaseUrl();
  const credential = input.requireLiveEnvironment
    ? resolveOpenAICredentialFromEnv(process.env)
    : null;
  const blockers: string[] = [];
  if (candidate.candidate_configuration_hash !== E2A4_CANDIDATE_HASH) blockers.push("candidate_hash_mismatch");
  if (candidate.candidate_file_sha256 !== E2A4_CANDIDATE_FILE_SHA256) blockers.push("candidate_file_sha_mismatch");
  if (candidate.baseline_manifest_sha256 !== "dafa5875394e1abcaa4194df1e7f5c02a63b44128b648ff6b8cfb683e0c5b977") blockers.push("approved_v2_file_sha_mismatch");
  if (candidate.failed_candidate_file_sha256 !== E2A4_FAILED_V3_FILE_SHA256) blockers.push("failed_v3_file_sha_mismatch");
  if (e2a3EvaluationProtocolHash() !== E2A4_SOURCE_PROTOCOL_HASH) blockers.push("source_protocol_hash_mismatch");
  if (directoryHash(FAILED_E2A3_RUN_PATH).sha256 !== E2A4_FAILED_E2A3_ARTIFACT_SHA256) blockers.push("failed_e2a3_artifacts_changed");
  if (!candidate.compatible) blockers.push("candidate_contract_incompatible");
  if (!schemaAudit.all_candidate_role_schemas_compile) blockers.push("candidate_role_schema_incompatible");
  if (!requestCompilation.artifact.all_requests_ready_for_dispatch) blockers.push("request_compilation_failed");
  if (requestCompilation.artifact.network_request_count !== 0) blockers.push("request_compilation_made_network_call");
  if (active.runtime_candidate_hash !== E2A4_APPROVED_V2_HASH) blockers.push("approved_v2_not_active");
  if (filesContaining(E2A4_CANDIDATE_HASH).length > 0) blockers.push("candidate_approval_or_activation_evidence_exists");
  const expectedDelta = [
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.input_schema_version",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.output_schema_version",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.validator_version",
    "runtime_policy.topic_dialogue_policy.recent_raw_turn_window"
  ];
  if (JSON.stringify(candidate.exact_delta_paths_from_baseline) !== JSON.stringify(expectedDelta)) {
    blockers.push("undocumented_candidate_delta");
  }
  if (input.requireCleanTree) {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      encoding: "utf8"
    }).trim();
    if (status) blockers.push("tracked_worktree_not_clean");
  }
  if (input.requireLiveEnvironment) {
    if (process.env.EVAL_E2A4_LIVE_PROVIDER !== "1") blockers.push("live_e2a4_opt_in_missing");
    if (process.env.LLM_PROVIDER !== "openai") blockers.push("provider_not_openai");
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") blockers.push("live_calls_not_enabled");
    if (process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== E2A4_APPROVED_V2_HASH) {
      blockers.push("approved_config_hash_mismatch");
    }
    if (!isApprovedOpenAIBaseUrl(baseUrl)) blockers.push("openai_base_url_not_approved");
    if (!credential?.ok) blockers.push(credential?.code ?? "credential_missing");
  }
  return {
    preflight_version: "e2a4-candidate-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: active.runtime_candidate_hash ?? null,
    failed_v3_hash: E2A4_FAILED_V3_HASH,
    source_protocol_hash: e2a3EvaluationProtocolHash(),
    failed_e2a3_artifact_hash: directoryHash(FAILED_E2A3_RUN_PATH).sha256,
    all_role_schema_audit_passed: schemaAudit.all_candidate_role_schemas_compile,
    request_compilation_passed: requestCompilation.artifact.all_requests_ready_for_dispatch,
    request_compilation_network_count: requestCompilation.artifact.network_request_count,
    candidate_approved: false,
    candidate_activated: false,
    provider: input.requireLiveEnvironment ? "openai" : "not_checked",
    provider_host: input.requireLiveEnvironment ? openAIBaseUrlHost(baseUrl) : "not_checked",
    credential_configured: credential?.ok ?? false,
    credential_fingerprint_prefix: credential?.ok
      ? credential.credential.fingerprint_prefix
      : null,
    exact_delta_paths: candidate.exact_delta_paths_from_baseline,
    existing_candidate_evidence_paths: filesContaining(E2A4_CANDIDATE_HASH),
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

export function resolveE2A4CanaryBudget(): E2A4Budget {
  return {
    maximum_cases: 2,
    maximum_generation_calls: 8,
    maximum_input_tokens: 80_000,
    maximum_output_tokens: 12_000,
    maximum_estimated_cost_usd: 3,
    maximum_retries_per_case: 2
  };
}

export function resolveE2A4FullBudget(): E2A4Budget {
  return {
    maximum_cases: 30,
    maximum_generation_calls: 120,
    maximum_input_tokens: 600_000,
    maximum_output_tokens: 120_000,
    maximum_estimated_cost_usd: 25,
    maximum_retries_per_case: 2
  };
}

function resultUsage(result: StructuredAgentResult<TopicDialogueOutputV3>) {
  const normalized = result.transport_telemetry?.normalized_response?.usage;
  return {
    input_tokens: result.usage?.input_tokens ?? normalized?.inputTokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? normalized?.outputTokens ?? 0,
    reasoning_tokens: result.usage?.reasoning_tokens ?? normalized?.reasoningTokens ?? 0,
    cached_input_tokens: result.usage?.cached_input_tokens ?? normalized?.cachedInputTokens ?? 0,
    total_tokens: result.usage?.total_tokens ?? normalized?.totalTokens ?? 0,
    usage_verified: normalized?.status === "usage_verified" || Boolean(
      result.usage?.input_tokens !== undefined && result.usage?.output_tokens !== undefined
    ),
    pricing_available: normalized?.pricingFound ?? false,
    estimated_cost_usd: normalized?.calculatedCostUsd ?? null
  };
}

function aggregateUsage(results: E2A4CaseResult[]) {
  return results.reduce((usage, result) => ({
    provider_adapter_attempts: usage.provider_adapter_attempts + result.attempts,
    generation_provider_calls: usage.generation_provider_calls + result.network_dispatch_count,
    metadata_only_requests: 0,
    input_tokens: usage.input_tokens + result.usage.input_tokens,
    output_tokens: usage.output_tokens + result.usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens + result.usage.reasoning_tokens,
    cached_input_tokens: usage.cached_input_tokens + result.usage.cached_input_tokens,
    total_tokens: usage.total_tokens + result.usage.total_tokens,
    latency_ms: usage.latency_ms + result.latency_ms,
    retries: usage.retries + result.retries,
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
    retries: 0,
    estimated_cost_usd: 0 as number | null,
    complete_pricing_available: true
  });
}

function requestInputEstimate(testCase: E2A3TopicDialogueCase) {
  return Math.ceil(
    `${TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS}\n${JSON.stringify(testCase.input)}`.length / 3
  );
}

function assertBudgetBeforeCall(input: {
  budget: E2A4Budget;
  results: E2A4CaseResult[];
  phaseResults: E2A4CaseResult[];
  currentCaseAttempts: number;
  testCase: E2A3TopicDialogueCase;
  modelConfig: AgentModelConfig;
}) {
  const total = aggregateUsage(input.results);
  const phase = aggregateUsage(input.phaseResults);
  const inputReserve = requestInputEstimate(input.testCase);
  const outputReserve = input.modelConfig.max_output_tokens ?? 3500;
  if (input.phaseResults.length >= input.budget.maximum_cases) throw new Error("e2a4_case_budget_exceeded");
  if (phase.generation_provider_calls + input.currentCaseAttempts + 1 > input.budget.maximum_generation_calls) {
    throw new Error("e2a4_generation_call_budget_exceeded");
  }
  if (phase.input_tokens + inputReserve > input.budget.maximum_input_tokens) {
    throw new Error("e2a4_input_token_budget_insufficient");
  }
  if (phase.output_tokens + outputReserve > input.budget.maximum_output_tokens) {
    throw new Error("e2a4_output_token_budget_insufficient");
  }
  if (
    phase.complete_pricing_available &&
    phase.estimated_cost_usd !== null &&
    phase.estimated_cost_usd >= input.budget.maximum_estimated_cost_usd
  ) {
    throw new Error("e2a4_cost_budget_exceeded");
  }
  if (total.generation_provider_calls >= 128) throw new Error("e2a4_absolute_call_cap_exceeded");
}

function invisibleHistoryFinding(output: TopicDialogueOutputV3) {
  const text = `${output.tutor_message} ${output.student_safe_summary}`;
  return /\b(hidden history|invisible (?:message|turn|draft)|draft you (?:did not|didn't) see|internal turn id)\b/iu.test(text);
}

function makeCaseResult(input: {
  testCase: E2A3TopicDialogueCase;
  phase: E2A4CaseResult["phase"];
  providerResult: StructuredAgentResult<TopicDialogueOutputV3>;
  attempts: number;
  networkDispatchCount: number;
}): E2A4CaseResult {
  const context = buildContextCoverage(input.testCase);
  const validation = input.providerResult.parsed_output
    ? validateTopicDialogueOutputV3(input.providerResult.parsed_output)
    : { valid: false as const, issues: [{ field_path: "output", rule_code: "schema_invalid" as const }] };
  const providerOutput = validation.valid ? validation.provider_output : null;
  const runtimeOutput = validation.valid ? validation.runtime_output : null;
  const privacyFindings = providerOutput
    ? [
        ...findVisibleTextPrivacyFindings(providerOutput.tutor_message, "tutor_message"),
        ...findVisibleTextPrivacyFindings(providerOutput.student_safe_summary, "student_safe_summary")
      ]
    : [];
  const rubric = runtimeOutput
    ? deterministicRubric(input.testCase, runtimeOutput, context)
    : [];
  const contextFailed = context.missing_visible_turn_ids.length > 0 ||
    context.duplicated_visible_turn_ids.length > 0 ||
    !context.order_matches ||
    !context.exact_content_matches ||
    !context.latest_student_message_separate ||
    !context.initial_activity_present ||
    !context.invisible_history_excluded;
  const invisibleReference = providerOutput ? invisibleHistoryFinding(providerOutput) : false;
  const critical = [
    ...(contextFailed ? ["context_coverage_failed"] : []),
    ...(invisibleReference ? ["invisible_history_reference"] : []),
    ...rubric.filter((entry) => entry.status === "failed" && entry.severity === "critical")
      .map((entry) => entry.dimension),
    ...validation.issues.filter((entry) =>
      entry.rule_code === "answer_key_leak" || entry.rule_code === "hidden_content_leak"
    ).map((entry) => entry.rule_code),
    ...privacyFindings.map((entry) => entry.matched_label)
  ];
  const major = [
    ...rubric.filter((entry) => entry.status === "failed" && entry.severity === "major")
      .map((entry) => entry.dimension),
    ...validation.issues.filter((entry) =>
      entry.rule_code !== "answer_key_leak" && entry.rule_code !== "hidden_content_leak"
    ).map((entry) => entry.rule_code)
  ];
  const transportError = input.providerResult.transport_telemetry?.normalized_error;
  const providerError = input.providerResult.error
    ? {
        category: input.providerResult.error.category,
        message: input.providerResult.error.message,
        retryable: input.providerResult.error.retryable,
        typed_failure_reason: transportError?.typed_failure_reason ?? null,
        http_status: transportError?.http_status ?? null
      }
    : null;
  const completed = input.providerResult.status === "completed" && validation.valid;
  return {
    case_id: input.testCase.case_id,
    category: input.testCase.category,
    repetition_index: input.testCase.repetition_index,
    student_turn_count: input.testCase.student_turn_count,
    tenth_turn: input.testCase.expectation.tenth_turn,
    phase: input.phase,
    status: completed && critical.length === 0 && major.length === 0
      ? "passed_automated"
      : completed
        ? "failed"
        : "provider_failed",
    attempts: input.attempts,
    retries: Math.max(0, input.attempts - 1),
    network_dispatch_count: input.networkDispatchCount,
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
    provider_output: providerOutput,
    runtime_output: runtimeOutput,
    schema_valid: validation.valid,
    validator_issues: validation.issues,
    privacy_findings: privacyFindings,
    context_coverage: context,
    deterministic_rubric: rubric,
    critical_findings: [...new Set(critical)],
    major_findings: [...new Set(major)],
    usage: resultUsage(input.providerResult),
    latency_ms: input.providerResult.latency_ms,
    human_review_required: true
  };
}

function skippedResult(
  testCase: E2A3TopicDialogueCase,
  phase: E2A4CaseResult["phase"],
  reason: string
): E2A4CaseResult {
  return {
    case_id: testCase.case_id,
    category: testCase.category,
    repetition_index: testCase.repetition_index,
    student_turn_count: testCase.student_turn_count,
    tenth_turn: testCase.expectation.tenth_turn,
    phase,
    status: "skipped_budget",
    attempts: 0,
    retries: 0,
    network_dispatch_count: 0,
    provider_request_status: "not_dispatched",
    provider_request_id: null,
    provider_response_id: null,
    provider_error: null,
    provider_output: null,
    runtime_output: null,
    schema_valid: false,
    validator_issues: [{ field_path: "request", rule_code: reason }],
    privacy_findings: [],
    context_coverage: buildContextCoverage(testCase),
    deterministic_rubric: [],
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
  return `e2a4_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "evaluation-manifest.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    schemaAudit: path.join(runDir, "all-role-schema-audit.json"),
    requestCompilation: path.join(runDir, "request-compilation.json"),
    protocol: path.join(runDir, "evaluation-protocol.json"),
    dispatchCanary: path.join(runDir, "dispatch-canary.json"),
    providerCases: path.join(runDir, "provider-cases.jsonl"),
    providerOutputs: path.join(runDir, "provider-outputs.jsonl"),
    contextCoverage: path.join(runDir, "context-coverage.jsonl"),
    schemaValidation: path.join(runDir, "schema-validation.jsonl"),
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
  testCase: E2A3TopicDialogueCase,
  result: E2A4CaseResult
) {
  const providerCase = {
    case_id: testCase.case_id,
    category: testCase.category,
    repetition_index: testCase.repetition_index,
    student_turn_count: testCase.student_turn_count,
    phase: result.phase,
    input_schema_version: testCase.input.dialogue_schema_version,
    input_sha256: stableHash(testCase.input),
    expected_visible_turn_ids: result.context_coverage.expected_visible_turn_ids,
    latest_student_turn_id: testCase.input.latest_student_turn_id,
    initial_activity_sha256: sha256(testCase.initial_activity_text),
    raw_student_text_persisted_in_provider_case: false,
    hidden_prompt_persisted: false
  };
  const providerOutput = {
    case_id: result.case_id,
    phase: result.phase,
    provider_request_status: result.provider_request_status,
    provider_request_id: result.provider_request_id,
    provider_response_id: result.provider_response_id,
    provider_error: result.provider_error,
    network_dispatch_count: result.network_dispatch_count,
    parsed_validated_output: result.provider_output,
    audit_projection: result.provider_output
      ? topicDialogueV3AuditProjection(result.provider_output)
      : null,
    raw_provider_response_persisted: false,
    hidden_prompt_persisted: false,
    chain_of_thought_persisted: false
  };
  artifactSecretScan([providerCase, providerOutput, result]);
  appendJsonl(paths.providerCases, providerCase);
  appendJsonl(paths.providerOutputs, providerOutput);
  appendJsonl(paths.contextCoverage, result.context_coverage);
  appendJsonl(paths.schemaValidation, {
    case_id: result.case_id,
    phase: result.phase,
    schema_valid: result.schema_valid,
    output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
    validator_version: TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3,
    issues: result.validator_issues,
    attempts: result.attempts,
    retries: result.retries
  });
  appendJsonl(paths.privacyResults, {
    case_id: result.case_id,
    passed: result.privacy_findings.length === 0,
    findings: result.privacy_findings,
    answer_key_findings: result.validator_issues.filter((entry) => entry.rule_code === "answer_key_leak")
  });
  appendJsonl(paths.deterministicRubric, {
    case_id: result.case_id,
    status: result.status,
    dimensions: result.deterministic_rubric,
    critical_findings: result.critical_findings,
    major_findings: result.major_findings
  });
}

async function executeCases(input: {
  cases: E2A3TopicDialogueCase[];
  phase: E2A4CaseResult["phase"];
  provider: LlmProvider;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
  budget: E2A4Budget;
  priorResults: E2A4CaseResult[];
  paths: ReturnType<typeof artifactPaths>;
  runPublicId: string;
}) {
  const phaseResults: E2A4CaseResult[] = [];
  for (const testCase of input.cases) {
    let attempts = 0;
    let networkDispatchCount = 0;
    let finalResult: StructuredAgentResult<TopicDialogueOutputV3> | null = null;
    try {
      for (let retry = 0; retry <= input.budget.maximum_retries_per_case; retry += 1) {
        assertBudgetBeforeCall({
          budget: input.budget,
          results: [...input.priorResults, ...phaseResults],
          phaseResults,
          currentCaseAttempts: attempts,
          testCase,
          modelConfig: input.modelConfig
        });
        attempts += 1;
        finalResult = await input.provider.executeStructured({
          agent_name: "topic_dialogue_agent",
          model_config: input.modelConfig,
          instructions: TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
          input: testCase.input,
          output_schema: TopicDialogueOutputV3Schema,
          schema_name: "topic_dialogue_output_v3",
          client_request_id: `${input.runPublicId}_${testCase.case_id}_${attempts}`,
          timeout_ms: input.timeoutMs,
          metadata: {
            evaluation: "e2a4_topic_dialogue_candidate",
            evaluation_phase: input.phase,
            case_id: testCase.case_id,
            candidate_hash_prefix: E2A4_CANDIDATE_HASH.slice(0, 12)
          }
        });
        if (finalResult.transport_telemetry?.fetch_invoked) networkDispatchCount += 1;
        const validation = finalResult.parsed_output
          ? validateTopicDialogueOutputV3(finalResult.parsed_output)
          : { valid: false };
        if (finalResult.status === "completed" && validation.valid) break;
        if (finalResult.status === "failed" && finalResult.error?.retryable !== true) break;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "e2a4_budget_or_dispatch_block";
      const skipped = skippedResult(testCase, input.phase, reason);
      phaseResults.push(skipped);
      writeIncrementalArtifacts(input.paths, testCase, skipped);
      continue;
    }
    if (!finalResult) throw new Error("e2a4_provider_result_missing");
    const result = makeCaseResult({
      testCase,
      phase: input.phase,
      providerResult: finalResult,
      attempts,
      networkDispatchCount
    });
    phaseResults.push(result);
    writeIncrementalArtifacts(input.paths, testCase, result);
  }
  return phaseResults;
}

function selectDispatchCanaryCases(cases: E2A3TopicDialogueCase[]) {
  const ordinary = cases.find((entry) =>
    entry.student_turn_count === 3 && !entry.expectation.tenth_turn
  );
  const tenth = cases.find((entry) => entry.expectation.tenth_turn);
  if (!ordinary || !tenth) throw new Error("e2a4_dispatch_canary_case_selection_failed");
  return [ordinary, tenth];
}

function dispatchCanarySummary(results: E2A4CaseResult[], budget: E2A4Budget) {
  const usage = aggregateUsage(results);
  const passed = results.length === 2 && results.every((entry) =>
    entry.status === "passed_automated" &&
    entry.network_dispatch_count >= 1 &&
    entry.schema_valid &&
    entry.privacy_findings.length === 0 &&
    !entry.critical_findings.length &&
    !entry.major_findings.length
  ) && usage.generation_provider_calls <= budget.maximum_generation_calls &&
    usage.input_tokens <= budget.maximum_input_tokens &&
    usage.output_tokens <= budget.maximum_output_tokens &&
    (!usage.complete_pricing_available || (usage.estimated_cost_usd ?? Infinity) <= budget.maximum_estimated_cost_usd);
  return {
    canary_version: "e2a4-live-dispatch-canary-v1",
    passed,
    case_ids: results.map((entry) => entry.case_id),
    completed_case_count: results.length,
    dispatched_case_count: results.filter((entry) => entry.network_dispatch_count > 0).length,
    schema_valid_count: results.filter((entry) => entry.schema_valid).length,
    provider_request_schema_invalid_count: results.filter((entry) =>
      entry.provider_error?.category === "provider_request_schema_invalid"
    ).length,
    critical_finding_count: results.reduce((sum, entry) => sum + entry.critical_findings.length, 0),
    major_finding_count: results.reduce((sum, entry) => sum + entry.major_findings.length, 0),
    privacy_finding_count: results.reduce((sum, entry) => sum + entry.privacy_findings.length, 0),
    usage,
    budget
  };
}

function reviewPacket(results: E2A4CaseResult[]) {
  return {
    packet_version: "e2a4-topic-dialogue-human-review-packet-v1",
    review_status: "pending_human_review",
    reviewer_type_required: "human",
    llm_judge_used: false,
    every_provider_output_included: true,
    every_tenth_turn_case_required: true,
    selection_policy: [
      "all provider outputs",
      "all tenth-turn cases",
      "all flagged cases",
      "all retry cases",
      "all revision and transfer cases",
      "all provider recovery cases"
    ],
    required_dimensions: [
      "directly responds to latest student message",
      "maintains visible-history continuity",
      "remains distractor-focused",
      "targets the active misconception or partial understanding",
      "changes strategy after failed explanation",
      "avoids unsupported understanding claims",
      "preserves revision and transfer boundaries",
      "does not expose answer keys or internal metadata",
      "student-facing language is natural and understandable"
    ],
    cases: results.map((result) => ({
      case_id: result.case_id,
      phase: result.phase,
      category: result.category,
      student_turn_count: result.student_turn_count,
      tenth_turn: result.tenth_turn,
      automated_status: result.status,
      tutor_message: result.provider_output?.tutor_message ?? null,
      response_function: result.provider_output?.response_function ?? null,
      evidence_sufficiency: result.provider_output?.evidence_sufficiency ?? null,
      next_action: result.provider_output?.next_action ?? null,
      context_coverage: result.context_coverage,
      automated_findings: [...result.critical_findings, ...result.major_findings],
      human_scores: {
        direct_response: null,
        visible_history_continuity: null,
        distractor_focus: null,
        misconception_targeting: null,
        strategy_adaptation: null,
        unsupported_understanding: null,
        recurrence_handling: null,
        revision_transfer_boundary: null,
        privacy_and_answer_key_safety: null,
        natural_language_quality: null
      },
      human_decision: null,
      human_notes: null
    }))
  };
}

function candidateEvidenceDraft(input: {
  runPublicId: string;
  results: E2A4CaseResult[];
  status: EvaluationStatus;
  schemaAudit: ReturnType<typeof buildE2A4AllRoleSchemaAudit>;
  preflight: Awaited<ReturnType<typeof inspectE2A4Preflight>>;
  paths: ReturnType<typeof artifactPaths>;
}) {
  const candidate = evaluateE2A4TopicDialogueCandidate();
  const unchangedRoles = Object.keys(candidate.full_candidate.roles)
    .filter((role) => role !== "topic_dialogue_agent")
    .sort();
  const roles = Object.keys(candidate.full_candidate.roles).sort().map((role) => ({
    role,
    role_config_hash: candidate.role_config_hashes[role],
    schema_compatible: input.schemaAudit.role_results.find((entry) => entry.role === role)?.dispatch_allowed ?? false,
    evidence_kind: role === "topic_dialogue_agent" ? "new_provider_evidence" : "inherited_immutable_reference",
    evidence_reference: role === "topic_dialogue_agent"
      ? {
          evaluation_run_public_id: input.runPublicId,
          provider_outputs_path: relative(input.paths.providerOutputs),
          human_review_packet_path: relative(input.paths.humanReviewPacket)
        }
      : input.preflight.inherited_evidence,
    inherited_evidence_approved_for_new_candidate: false,
    human_review_required: role === "topic_dialogue_agent"
  }));
  return {
    draft_version: "e2a4-candidate-wide-evidence-draft-v1",
    record_type: "non_approving_human_review_draft",
    status: input.status,
    candidate_manifest_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    role_count: roles.length,
    unchanged_role_count: unchangedRoles.length,
    newly_evaluated_roles: ["topic_dialogue_agent"],
    inherited_role_inventory: unchangedRoles,
    roles,
    schema_and_validator_compatibility: {
      all_role_schemas_compile: input.schemaAudit.all_candidate_role_schemas_compile,
      topic_dialogue_output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
      topic_dialogue_validator_version: TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3
    },
    evidence_provenance: {
      source_protocol_hash: E2A4_SOURCE_PROTOCOL_HASH,
      source_provider_run_id: input.preflight.inherited_evidence.source_provider_run_id,
      source_derived_evaluation_id: input.preflight.inherited_evidence.source_derived_evaluation_id,
      inherited_approval_evidence_sha256: input.preflight.inherited_evidence.approval_evidence_sha256,
      inherited_manifest_sha256: input.preflight.inherited_evidence.approved_manifest_sha256,
      new_evaluation_run_public_id: input.runPublicId
    },
    missing_evidence: [
      "human adjudication of every new topic-dialogue provider output",
      "explicit candidate-level human review of inherited evidence applicability"
    ],
    unresolved_review_requirements: [
      "pedagogical quality remains pending human review",
      "inherited evidence is referenced but is not asserted as approval for this candidate",
      "activation is forbidden until a later explicit approval phase"
    ],
    approval_state: "not_approved",
    activation_state: "not_activated",
    approval_evidence_ready: false
  };
}

function summarize(input: {
  results: E2A4CaseResult[];
  canary: ReturnType<typeof dispatchCanarySummary>;
  before: ReturnType<typeof e2a4ProtectedArtifactSnapshot>;
  after: ReturnType<typeof e2a4ProtectedArtifactSnapshot>;
}) {
  const usage = aggregateUsage(input.results);
  const tenth = input.results.filter((entry) => entry.tenth_turn);
  const tenthFailures = tenth.filter((entry) =>
    entry.context_coverage.missing_visible_turn_ids.length > 0 ||
    entry.context_coverage.duplicated_visible_turn_ids.length > 0 ||
    !entry.context_coverage.order_matches ||
    !entry.context_coverage.exact_content_matches ||
    !entry.context_coverage.latest_student_message_separate ||
    !entry.context_coverage.initial_activity_present ||
    !entry.context_coverage.invisible_history_excluded
  );
  const critical = input.results.flatMap((entry) =>
    entry.critical_findings.map((finding) => ({ case_id: entry.case_id, finding }))
  );
  const major = input.results.flatMap((entry) =>
    entry.major_findings.map((finding) => ({ case_id: entry.case_id, finding }))
  );
  const completedAll = input.results.length === 30 &&
    input.results.every((entry) => entry.attempts > 0);
  const protectedUnchanged = input.before.aggregate_sha256 === input.after.aggregate_sha256;
  const automatedPassed = input.canary.passed &&
    completedAll &&
    tenth.length === 18 &&
    tenthFailures.length === 0 &&
    input.results.every((entry) => entry.status === "passed_automated") &&
    critical.length === 0 &&
    major.length === 0 &&
    input.results.every((entry) => entry.schema_valid) &&
    input.results.every((entry) => entry.privacy_findings.length === 0) &&
    protectedUnchanged;
  const status: EvaluationStatus = automatedPassed
    ? "provider_evidence_ready_for_human_review"
    : input.canary.passed && !completedAll
      ? "candidate_evaluation_incomplete"
      : "candidate_evaluation_failed";
  return {
    summary_version: "e2a4-topic-dialogue-evaluation-summary-v1",
    final_evaluation_status: status,
    automated_evaluation_passed: automatedPassed,
    human_review_status: "pending",
    approval_evidence_ready: false,
    approval_state: "not_approved",
    activation_state: "not_activated",
    case_counts: {
      planned: 30,
      completed: input.results.filter((entry) => entry.attempts > 0).length,
      passed_automated: input.results.filter((entry) => entry.status === "passed_automated").length,
      failed: input.results.filter((entry) => entry.status === "failed" || entry.status === "provider_failed").length,
      skipped: input.results.filter((entry) => entry.status === "skipped_budget").length,
      tenth_turn: tenth.length,
      baseline_or_boundary: input.results.filter((entry) => !entry.tenth_turn).length
    },
    dispatch_canary_passed: input.canary.passed,
    context_coverage: {
      tenth_turn_passed: tenth.length - tenthFailures.length,
      tenth_turn_failed: tenthFailures.length
    },
    schema_validation_failure_count: input.results.filter((entry) => !entry.schema_valid).length,
    provider_request_schema_invalid_count: input.results.filter((entry) =>
      entry.provider_error?.category === "provider_request_schema_invalid"
    ).length,
    privacy_finding_count: input.results.reduce((sum, entry) => sum + entry.privacy_findings.length, 0),
    answer_key_finding_count: input.results.reduce(
      (sum, entry) => sum + entry.validator_issues.filter((issue) => issue.rule_code === "answer_key_leak").length,
      0
    ),
    invisible_history_reference_count: critical.filter((entry) => entry.finding === "invisible_history_reference").length,
    critical_findings: critical,
    major_findings: major,
    provider_usage: {
      ...usage,
      average_latency_ms: input.results.length
        ? Math.round(usage.latency_ms / input.results.length)
        : 0,
      cost_status: usage.complete_pricing_available ? "available" : "unavailable"
    },
    protected_artifacts_unchanged: protectedUnchanged,
    protected_artifacts_before_sha256: input.before.aggregate_sha256,
    protected_artifacts_after_sha256: input.after.aggregate_sha256,
    human_review_required: true,
    human_review_completed: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a_canary_executed: false,
    full_36_session_matrix_executed: false
  };
}

export async function executeE2A4TopicDialogueEvaluation(input: {
  provider?: LlmProvider;
  live: boolean;
  artifactRoot?: string;
  skipProtectedSnapshotForTest?: boolean;
}) {
  const preflight = await inspectE2A4Preflight({
    requireLiveEnvironment: input.live,
    requireCleanTree: false
  });
  if (!preflight.passed) throw new Error(`e2a4_preflight_failed:${preflight.blockers.join(",")}`);
  const buildInfo = resolveApplicationBuildInfo({
    artifactPath: path.join(E2A4_ARTIFACT_ROOT, "nonexistent-build-info.json")
  });
  if (!buildInfo.ok) throw new Error(buildInfo.code);
  const candidate = evaluateE2A4TopicDialogueCandidate();
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  if (!modelConfig) throw new Error("e2a4_topic_dialogue_model_config_missing");
  const provider = input.provider ?? new OpenAIResponsesProvider();
  const allCases = e2a3TopicDialogueCases();
  const canaryCases = selectDispatchCanaryCases(allCases);
  const remainingCases = allCases.filter((entry) =>
    !canaryCases.some((canary) => canary.case_id === entry.case_id)
  );
  const runPublicId = runId();
  const runDir = path.join(input.artifactRoot ?? E2A4_ARTIFACT_ROOT, runPublicId);
  const paths = artifactPaths(runDir);
  mkdirSync(runDir, { recursive: true });
  const emptySnapshot = {
    snapshot_version: "e2a4-protected-artifact-snapshot-v1",
    candidate_hash: E2A4_CANDIDATE_HASH,
    tracked_groups: {},
    environment_metadata: {},
    aggregate_sha256: "test-protected-snapshot"
  } as ReturnType<typeof e2a4ProtectedArtifactSnapshot>;
  const before = input.skipProtectedSnapshotForTest
    ? emptySnapshot
    : e2a4ProtectedArtifactSnapshot();
  const schemaAudit = buildE2A4AllRoleSchemaAudit();
  const requestCompilation = await compileE2A4CandidateRequestsNoNetwork(
    path.join(runDir, "request-compilation.json")
  );
  const sourceProtocol = e2a3EvaluationProtocolSnapshot();
  const protocol = {
    protocol_version: "e2a4-topic-dialogue-provider-evaluation-v1",
    source_protocol_hash: e2a3EvaluationProtocolHash(),
    source_protocol: sourceProtocol,
    corrected_output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
    case_count: allCases.length,
    tenth_turn_case_count: allCases.filter((entry) => entry.expectation.tenth_turn).length,
    baseline_or_boundary_case_count: allCases.filter((entry) => !entry.expectation.tenth_turn).length
  };
  const protocolHash = stableHash(protocol);
  writeJson(paths.protectedBefore, before);
  writeJson(paths.schemaAudit, schemaAudit);
  writeJson(paths.requestCompilation, requestCompilation.artifact);
  writeJson(paths.protocol, { ...protocol, evaluation_protocol_hash: protocolHash });
  writeJson(paths.candidateDelta, {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v3_hash: E2A4_FAILED_V3_HASH,
    exact_delta_paths_from_baseline: candidate.exact_delta_paths_from_baseline,
    exact_delta_from_baseline: candidate.exact_delta_from_baseline,
    exact_delta_from_failed_candidate: candidate.exact_delta_from_failed_candidate,
    role_config_hashes: candidate.role_config_hashes
  });
  for (const filePath of [
    paths.providerCases,
    paths.providerOutputs,
    paths.contextCoverage,
    paths.schemaValidation,
    paths.privacyResults,
    paths.deterministicRubric
  ]) writeFileSync(filePath, "", "utf8");
  const manifestBase = {
    manifest_version: "e2a4-topic-dialogue-candidate-evaluation-manifest-v1",
    run_public_id: runPublicId,
    evaluation_status: "running",
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v3_hash: E2A4_FAILED_V3_HASH,
    application_git_commit: buildInfo.info.application_git_commit,
    application_git_commit_source: buildInfo.info.application_git_commit_source,
    application_build_timestamp: buildInfo.info.application_build_timestamp,
    source_protocol_hash: E2A4_SOURCE_PROTOCOL_HASH,
    evaluation_protocol_hash: protocolHash,
    provider: input.live ? "openai" : "injected_no_live_provider",
    model: modelConfig.model_name,
    reasoning_effort: modelConfig.reasoning_effort,
    max_output_tokens: modelConfig.max_output_tokens,
    adapter_version: input.live ? OPENAI_RESPONSES_ADAPTER_VERSION : "injected-test-provider",
    prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
    prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
    input_schema_version: "topic-dialogue-input-v3",
    output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
    validator_version: TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3,
    fallback_version: "topic-dialogue-deterministic-fallback-v1",
    raw_provider_output_persisted: false,
    hidden_prompts_persisted: false,
    chain_of_thought_persisted: false,
    human_review_required: true,
    candidate_approved: false,
    candidate_activated: false,
    e2a_canary_executed: false,
    full_36_session_matrix_executed: false,
    dispatch_canary_budget: resolveE2A4CanaryBudget(),
    full_protocol_budget: resolveE2A4FullBudget(),
    started_at: new Date().toISOString()
  };
  writeJson(paths.manifest, manifestBase);
  const canaryResults = await executeCases({
    cases: canaryCases,
    phase: "dispatch_canary",
    provider,
    modelConfig,
    timeoutMs: candidate.full_candidate.runtime_policy.provider_timeout_ms,
    budget: resolveE2A4CanaryBudget(),
    priorResults: [],
    paths,
    runPublicId
  });
  const canary = dispatchCanarySummary(canaryResults, resolveE2A4CanaryBudget());
  writeJson(paths.dispatchCanary, canary);
  const remainingResults = canary.passed
    ? await executeCases({
        cases: remainingCases,
        phase: "full_protocol",
        provider,
        modelConfig,
        timeoutMs: candidate.full_candidate.runtime_policy.provider_timeout_ms,
        budget: {
          ...resolveE2A4FullBudget(),
          maximum_cases: 28
        },
        priorResults: canaryResults,
        paths,
        runPublicId
      })
    : [];
  const results = [...canaryResults, ...remainingResults];
  const after = input.skipProtectedSnapshotForTest
    ? before
    : e2a4ProtectedArtifactSnapshot();
  const summary = summarize({ results, canary, before, after });
  const packet = reviewPacket(results);
  const evidenceDraft = candidateEvidenceDraft({
    runPublicId,
    results,
    status: summary.final_evaluation_status,
    schemaAudit,
    preflight,
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
    generation_call_count: usage.generation_provider_calls,
    metadata_only_request_count: usage.metadata_only_requests,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    latency_ms: usage.latency_ms,
    retries: usage.retries,
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
  writeJson(path.join(input.artifactRoot ?? E2A4_ARTIFACT_ROOT, "latest-run.json"), {
    run_public_id: runPublicId,
    run_directory: relative(runDir),
    evaluation_status: summary.final_evaluation_status,
    updated_at: new Date().toISOString()
  });
  return { runPublicId, runDir, paths, manifest: finalManifest, summary, results, canary };
}

export async function executeLiveE2A4TopicDialogueEvaluation() {
  const credential = resolveOpenAICredentialFromEnv(process.env);
  if (!credential.ok) throw new Error(credential.code);
  return withResolvedOpenAICredential(
    credential.credential,
    () => executeE2A4TopicDialogueEvaluation({ live: true })
  );
}

export function loadLatestE2A4Evaluation(artifactRoot = E2A4_ARTIFACT_ROOT) {
  const latestPath = path.join(artifactRoot, "latest-run.json");
  if (!existsSync(latestPath)) throw new Error("e2a4_latest_run_missing");
  const latest = readJson<{ run_public_id: string; run_directory: string }>(latestPath);
  const runDir = path.isAbsolute(latest.run_directory)
    ? latest.run_directory
    : path.join(process.cwd(), latest.run_directory);
  return {
    latest,
    manifest: readJson(path.join(runDir, "evaluation-manifest.json")),
    summary: readJson(path.join(runDir, "evaluation-summary.json")),
    review_packet: readJson(path.join(runDir, "human-review-packet.json")),
    candidate_evidence_draft: readJson(path.join(runDir, "candidate-evidence-draft.json"))
  };
}

export function temporaryE2A4ArtifactRoot() {
  return path.join(os.tmpdir(), `e2a4-topic-dialogue-${randomBytes(5).toString("hex")}`);
}
