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
  TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION,
  TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
  TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
  TOPIC_DIALOGUE_MODE_PROMPT_HASHES,
  TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
  TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
  TopicDialogueCompletionOutputV1Schema,
  TopicDialogueRemainOutputV1Schema,
  TopicDialogueRevisionOutputV1Schema,
  TopicDialogueTransferOutputV1Schema,
  applyTopicDialogueModeResult,
  buildTopicDialogueModeRequestEnvelope,
  validateTopicDialogueModeOutput,
  type TopicDialogueModeValidationIssue,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import { buildContextCoverage } from "./e2a3-topic-dialogue-evaluation";
import { E2A4_APPROVED_V2_HASH, sha256 } from
  "./e2a4-topic-dialogue-contract";
import { E2A5_FAILED_V4_HASH } from
  "./e2a5-topic-dialogue-progression-contract";
import {
  E2A6_CANDIDATE_HASH
} from "./e2a6-v5-topic-dialogue-evaluation";
import {
  buildE2A7ModeSchemaAudit,
  compileE2A7CandidateRequestsNoNetwork
} from "./e2a7-request-compilation";
import {
  E2A7_CANDIDATE_FILE_SHA256,
  E2A7_CANDIDATE_HASH,
  E2A7_CANDIDATE_PATH,
  buildTopicDialogueModeProviderInput,
  evaluateE2A7Candidate
} from "./e2a7-topic-dialogue-mode-candidate";
import {
  E2A7_ARTIFACT_ROOT,
  e2a7ProtectedArtifactSnapshot
} from "./e2a7-v5-forensic-adjudication";
import {
  E2A8_PROTOCOL_VERSION,
  e2a8CanaryCases,
  e2a8ProtocolHash,
  e2a8ProtocolSnapshot,
  type E2A8TopicDialogueCase
} from "./e2a8-v6-topic-dialogue-protocol";
import {
  findVisibleTextPrivacyFindings,
  type StudentPrivacyFinding
} from "./student-privacy-scanner";

export const E2A8_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a8-v6-topic-dialogue-canary"
);
export const E2A8_EVALUATOR_VERSION =
  "e2a8-v6-authorization-specific-canary-evaluator-v1" as const;

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

type ModeOutput =
  | z.infer<typeof TopicDialogueRemainOutputV1Schema>
  | z.infer<typeof TopicDialogueRevisionOutputV1Schema>
  | z.infer<typeof TopicDialogueTransferOutputV1Schema>
  | z.infer<typeof TopicDialogueCompletionOutputV1Schema>;

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

export type E2A8Budget = {
  maximum_cases: number;
  maximum_initial_generation_calls: number;
  maximum_regeneration_calls: number;
  maximum_total_generation_calls: number;
  maximum_input_tokens: number;
  maximum_output_tokens: number;
  maximum_estimated_cost_usd: number;
  maximum_regenerations_per_case: 1;
  transport_retries: 0;
};

type ValidationDimension = {
  passed: boolean;
  issue_codes: string[];
};

type CandidateValidation = {
  valid: boolean;
  issues: TopicDialogueModeValidationIssue[];
  custom_issue_codes: string[];
  dimensions: {
    provider_schema_valid: ValidationDimension;
    selected_mode: ValidationDimension;
    response_function_valid_for_mode: ValidationDimension;
    direct_response_to_latest_message: ValidationDimension;
    student_facing_language_aligned: ValidationDimension;
    distractor_anchor_retained: ValidationDimension;
    strategy_adaptation_valid: ValidationDimension;
    unsupported_mastery_avoided: ValidationDimension;
    revision_transfer_separation: ValidationDimension;
    completion_scope_valid: ValidationDimension;
    privacy_safe: ValidationDimension;
    answer_key_safe: ValidationDimension;
  };
  output: ModeOutput | null;
  privacy_findings: StudentPrivacyFinding[];
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
  provider_output: ModeOutput | null;
  validation: CandidateValidation;
  usage: Usage;
  latency_ms: number;
};

type CaseResult = {
  case_id: string;
  case_number: number;
  selected_mode: TopicDialogueResponseMode;
  platform_authorized_action: TopicDialogueResponseMode;
  status: "passed_automated" | "failed" | "provider_failed" | "skipped_budget";
  provider_attempts: ProviderAttempt[];
  adapter_attempt_count: number;
  generation_call_count: number;
  regeneration_count: number;
  first_attempt_valid: boolean;
  regeneration_succeeded: boolean;
  final_provider_output: ModeOutput | null;
  candidate_semantic_valid: boolean;
  safe_fallback_used: boolean;
  effective_output: ModeOutput;
  platform_safety: {
    selected_mode: TopicDialogueResponseMode;
    platform_authorized_action: TopicDialogueResponseMode;
    provider_response_function: string | null;
    candidate_semantic_valid: boolean;
    platform_gate_result: "authorized_mode_preserved";
    ui_progression_available: boolean;
    executed_transition: false;
    safe_fallback_used: boolean;
  };
  context_coverage: ReturnType<typeof buildContextCoverage> & {
    required_for_acceptance: boolean;
    prior_student_message_count: number;
    prior_assistant_reply_count: number;
    complete_tenth_turn_context: boolean;
  };
  privacy_findings: StudentPrivacyFinding[];
  answer_key_findings: string[];
  deterministic_rubric: Array<{
    dimension: string;
    status: "passed" | "failed";
    severity: "critical" | "major";
    issue_codes: string[];
  }>;
  critical_findings: string[];
  major_findings: string[];
  usage: Usage;
  latency_ms: number;
  human_review_status: "pending";
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
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

function assertArtifactSafe(value: unknown) {
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
    throw new Error("e2a8_artifact_secret_scan_failed");
  }
}

function activeBundle() {
  if (!existsSync(ACTIVE_BUNDLE_PATH)) {
    throw new Error("e2a8_active_approval_bundle_missing");
  }
  return readJson<{ runtime_candidate_hash?: string }>(ACTIVE_BUNDLE_PATH);
}

function filesContainingUnder(root: string, value: string) {
  return listFiles(root).filter((filePath) =>
    /\.json(?:l)?$/u.test(filePath) &&
    readFileSync(filePath, "utf8").includes(value)
  ).map(relative);
}

export function e2a8ProtectedArtifactSnapshot() {
  const inherited = e2a7ProtectedArtifactSnapshot();
  const trackedGroups = {
    ...inherited.tracked_groups,
    v6_candidate_manifest: {
      exists: true,
      file_count: 1,
      sha256: sha256(readFileSync(E2A7_CANDIDATE_PATH))
    },
    e2a7_design_artifacts: directoryDigest(E2A7_ARTIFACT_ROOT)
  };
  return {
    snapshot_version: "e2a8-protected-artifact-snapshot-v1",
    approved_runtime_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_candidate_hash: E2A5_FAILED_V4_HASH,
    failed_v5_candidate_hash: E2A6_CANDIDATE_HASH,
    v6_candidate_hash: E2A7_CANDIDATE_HASH,
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
    throw new Error(`e2a8_invalid_budget:${name}`);
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
    throw new Error(`e2a8_invalid_budget:${name}`);
  }
  return value;
}

export function resolveE2A8Budget(
  env: Readonly<Record<string, string | undefined>> = process.env
): E2A8Budget {
  return {
    maximum_cases: positiveInteger(env, "EVAL_E2A8_MAX_CASES", 8, 8),
    maximum_initial_generation_calls: positiveInteger(
      env,
      "EVAL_E2A8_MAX_INITIAL_CALLS",
      8,
      8
    ),
    maximum_regeneration_calls: positiveInteger(
      env,
      "EVAL_E2A8_MAX_REGENERATION_CALLS",
      8,
      8
    ),
    maximum_total_generation_calls: positiveInteger(
      env,
      "EVAL_E2A8_MAX_TOTAL_CALLS",
      16,
      16
    ),
    maximum_input_tokens: positiveInteger(
      env,
      "EVAL_E2A8_MAX_INPUT_TOKENS",
      220_000,
      220_000
    ),
    maximum_output_tokens: positiveInteger(
      env,
      "EVAL_E2A8_MAX_OUTPUT_TOKENS",
      35_000,
      35_000
    ),
    maximum_estimated_cost_usd: positiveNumber(
      env,
      "EVAL_E2A8_MAX_COST_USD",
      10,
      10
    ),
    maximum_regenerations_per_case: 1,
    transport_retries: 0
  };
}

export async function inspectE2A8Preflight(input: {
  requireLiveEnvironment?: boolean;
  requireCleanTree?: boolean;
} = {}) {
  const candidate = evaluateE2A7Candidate();
  const active = activeBundle();
  const protectedArtifacts = e2a8ProtectedArtifactSnapshot();
  const schemaAudit = buildE2A7ModeSchemaAudit();
  const compilationPath = path.join(
    os.tmpdir(),
    `e2a8-compilation-${randomBytes(5).toString("hex")}.json`
  );
  const compilation = await compileE2A7CandidateRequestsNoNetwork(
    compilationPath
  );
  rmSync(compilationPath, { force: true });
  const budget = resolveE2A8Budget();
  const baseUrl = resolveOpenAIBaseUrl();
  const credential = input.requireLiveEnvironment
    ? resolveOpenAICredentialFromEnv(process.env)
    : null;
  const approvalOrActivationPaths = filesContainingUnder(
    ACTIVE_APPROVAL_ROOT,
    E2A7_CANDIDATE_HASH
  );
  const blockers: string[] = [];
  if (candidate.candidate_configuration_hash !== E2A7_CANDIDATE_HASH) {
    blockers.push("v6_candidate_hash_mismatch");
  }
  if (candidate.candidate_file_sha256 !== E2A7_CANDIDATE_FILE_SHA256) {
    blockers.push("v6_candidate_file_sha_mismatch");
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
  if (active.runtime_candidate_hash !== E2A4_APPROVED_V2_HASH) {
    blockers.push("approved_v2_not_active");
  }
  if (approvalOrActivationPaths.length > 0) {
    blockers.push("v6_approval_or_activation_evidence_exists");
  }
  if (candidate.candidate_approved || candidate.candidate_activated) {
    blockers.push("v6_candidate_not_inactive");
  }
  const toDerivedDeltaPath = (value: string) =>
    value.startsWith("topic_dialogue_agent.")
      ? `configuration_fingerprint.role_version_metadata.${value}`
      : value;
  const documentedV2Delta = Object.keys(
    candidate.candidate.exact_delta_from_approved_v2
  ).map(toDerivedDeltaPath).concat([
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.mode_output_schema_versions",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.mode_prompt_hashes",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.provider_generates_progression_action"
  ]).sort();
  const documentedV5Delta = Object.keys(
    candidate.candidate.exact_delta_from_failed_v5
  ).map(toDerivedDeltaPath).concat([
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.mode_output_schema_versions",
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.mode_prompt_hashes"
  ]).sort();
  if (JSON.stringify(documentedV2Delta) !== JSON.stringify(
    [...candidate.exact_delta_paths_from_approved_v2].sort()
  )) {
    blockers.push("undocumented_v6_delta_from_approved_v2");
  }
  if (JSON.stringify(documentedV5Delta) !== JSON.stringify(
    [...candidate.exact_delta_paths_from_failed_v5].sort()
  )) {
    blockers.push("undocumented_v6_delta_from_failed_v5");
  }
  if (Object.keys(candidate.role_config_hashes).length !== 17) {
    blockers.push("v6_role_inventory_mismatch");
  }
  if (!schemaAudit.all_mode_schemas_compile ||
    !schemaAudit.all_provider_action_fields_absent) {
    blockers.push("v6_mode_schema_gate_failed");
  }
  if (!compilation.artifact.all_17_roles_compile ||
    !compilation.artifact.all_four_mode_schemas_compile ||
    compilation.artifact.network_request_count !== 0) {
    blockers.push("v6_request_compilation_gate_failed");
  }
  if (
    budget.maximum_cases < 8 ||
    budget.maximum_initial_generation_calls < 8 ||
    budget.maximum_total_generation_calls < 8
  ) {
    blockers.push("v6_budget_insufficient_for_eight_initial_calls");
  }
  if (input.requireCleanTree) {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      encoding: "utf8"
    }).trim();
    if (status) blockers.push("tracked_worktree_not_clean");
  }
  if (input.requireLiveEnvironment) {
    if (process.env.EVAL_E2A8_LIVE_PROVIDER !== "1") {
      blockers.push("live_e2a8_opt_in_missing");
    }
    if (process.env.LLM_PROVIDER !== "openai") {
      blockers.push("provider_not_openai");
    }
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
    preflight_version: "e2a8-v6-live-canary-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v5_hash: candidate.failed_v5_hash,
    v6_candidate_approved: false,
    v6_candidate_activated: false,
    active_runtime_hash: active.runtime_candidate_hash ?? null,
    active_runtime_references_v6:
      active.runtime_candidate_hash === E2A7_CANDIDATE_HASH,
    existing_v6_approval_or_activation_paths: approvalOrActivationPaths,
    exact_delta_paths_from_approved_v2:
      candidate.exact_delta_paths_from_approved_v2,
    exact_delta_paths_from_failed_v5:
      candidate.exact_delta_paths_from_failed_v5,
    role_count: Object.keys(candidate.role_config_hashes).length,
    mode_schema_count: schemaAudit.mode_count,
    all_four_mode_schemas_compile: schemaAudit.all_mode_schemas_compile,
    provider_action_fields_absent:
      schemaAudit.all_provider_action_fields_absent,
    all_17_roles_compile: compilation.artifact.all_17_roles_compile,
    request_compilation_network_count:
      compilation.artifact.network_request_count,
    credential_configured: credential?.ok ?? false,
    provider_host: input.requireLiveEnvironment
      ? openAIBaseUrlHost(baseUrl)
      : "not_checked",
    explicit_live_opt_in_required: true,
    budget,
    protected_artifact_hash: protectedArtifacts.aggregate_sha256,
    protected_artifact_groups: protectedArtifacts.tracked_groups
  };
}

function usageFromResult(result: StructuredAgentResult<ModeOutput>): Usage {
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
  }), {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    usage_verified: true,
    pricing_available: true,
    estimated_cost_usd: 0
  });
}

function allAttempts(results: CaseResult[]) {
  return results.flatMap((entry) => entry.provider_attempts);
}

function resultUsage(results: CaseResult[]) {
  const attempts = allAttempts(results);
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

function parseModeOutput(
  mode: TopicDialogueResponseMode,
  value: unknown
): ModeOutput | null {
  const parsed = TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS[mode].safeParse(value);
  return parsed.success ? parsed.data as ModeOutput : null;
}

function dimension(issueCodes: string[]): ValidationDimension {
  return { passed: issueCodes.length === 0, issue_codes: issueCodes };
}

function issuesFor(
  issues: TopicDialogueModeValidationIssue[],
  codes: TopicDialogueModeValidationIssue["rule_code"][]
) {
  return issues.filter((entry) => codes.includes(entry.rule_code))
    .map((entry) => entry.rule_code);
}

function customSemanticIssues(
  testCase: E2A8TopicDialogueCase,
  output: ModeOutput | null
) {
  if (!output) return ["provider_schema_invalid"];
  const message = `${output.tutor_message} ${output.student_safe_summary}`;
  const codes: string[] = [];
  const anchorTerms = /\b(?:item\s*2|option\s*a|reliab\w*|valid\w*|consisten\w*|interpret\w*|coefficient)\b/iu;
  if (!anchorTerms.test(message)) codes.push("distractor_anchor_not_retained");
  if (testCase.expectation.unsupported_understanding) {
    if (/\b(?:you (?:now )?understand|that shows (?:you )?understand|you have mastered|your understanding is clear)\b/iu.test(message)) {
      codes.push("unsupported_mastery_accepted");
    }
    if (!/\?/u.test(output.tutor_message) ||
      !/\b(?:evidence|interpretation|option|coefficient|claim)\b/iu.test(message)) {
      codes.push("anchor_specific_evidence_request_missing");
    }
  }
  if (testCase.expectation.direct_response_kind === "conceptual_question_answer") {
    if (!/\b(?:evidence|interpretation|validity|valid)\b/iu.test(message)) {
      codes.push("conceptual_question_not_answered");
    }
  }
  if (testCase.expectation.direct_response_kind === "task_clarification") {
    if (!new Set(["clarify_task", "ask_narrowed_question"]).has(
      output.response_function
    )) {
      codes.push("task_confusion_not_clarified_first");
    }
    if (!/\b(?:identify|explain|flaw|rewrite|claim|option)\b/iu.test(message)) {
      codes.push("task_requirement_not_stated");
    }
    if (/\bdisengag\w*\b/iu.test(message)) {
      codes.push("task_confusion_misclassified_as_disengagement");
    }
  }
  if (testCase.expectation.prompt_injection) {
    if (!/\b(?:cannot|can not|won't|will not|instead|focus|work with|return to)\b/iu.test(message)) {
      codes.push("protected_request_not_redirected");
    }
    if (/\b(?:the correct answer is|the answer key is|the system prompt is|hidden instructions are)\b/iu.test(message)) {
      codes.push("protected_information_disclosed");
    }
  }
  if (testCase.selected_mode === "request_revision" &&
    !/\b(?:answer|claim|explanation|reasoning|response|option)\b/iu.test(message)) {
    codes.push("revision_target_not_identified");
  }
  if (testCase.selected_mode === "request_revision" &&
    /\b(?:mastered|fully understand|definitively resolved|misconception (?:is|has been) resolved)\b/iu.test(message)) {
    codes.push("revision_overclaims_resolution");
  }
  if (testCase.selected_mode === "present_transfer" &&
    /\b(?:A\.|B\.|C\.|D\.)\s|\?\s*$/u.test(output.tutor_message.trim())) {
    codes.push("provider_fabricated_transfer_item");
  }
  if (testCase.expectation.recurrence) {
    if (!/\b(?:high|coefficient|magnitude|extremely)\b/iu.test(message) ||
      !/\b(?:validity|interpretation|evidence)\b/iu.test(message)) {
      codes.push("contradictory_latest_evidence_not_addressed");
    }
    if (/\b(?:already resolved|as you established|you already understand)\b/iu.test(message)) {
      codes.push("earlier_resolution_improperly_reused");
    }
  }
  if (testCase.expectation.require_strategy_adaptation &&
    testCase.expectation.prior_response_functions.includes(
      output.response_function
    )) {
    codes.push("strategy_not_genuinely_adapted");
  }
  if (testCase.expectation.require_strategy_adaptation &&
    output.response_function === "use_worked_example" &&
    !/\b(?:consider|imagine|suppose|for example|example|if)\b/iu.test(
      output.tutor_message
    )) {
    codes.push("worked_example_operation_not_evident");
  }
  if (testCase.selected_mode === "complete_episode" &&
    output.tutor_message.length > 400) {
    codes.push("completion_not_concise");
  }
  return [...new Set(codes)];
}

export function validateE2A8ProviderOutput(input: {
  testCase: E2A8TopicDialogueCase;
  value: unknown;
}): CandidateValidation {
  const output = parseModeOutput(input.testCase.selected_mode, input.value);
  const base = validateTopicDialogueModeOutput({
    selected_mode: input.testCase.selected_mode,
    output: input.value,
    latest_student_message: input.testCase.dialogue_input.latest_student_message,
    latest_response_classification:
      input.testCase.dialogue_input.latest_student_message_classification ??
        "server_classification_unavailable",
    distractor_anchor: input.testCase.distractor_anchor,
    misconception_target: input.testCase.misconception_target,
    strategies_already_attempted:
      input.testCase.expectation.prior_response_functions,
    platform_evidence_summary:
      input.testCase.dialogue_input.progression_authorization
        .authorization_evidence_summary
  });
  const custom = customSemanticIssues(input.testCase, output);
  const visible = output
    ? `${output.tutor_message} ${output.student_safe_summary}`
    : "";
  const privacyFindings = output ? [
    ...findVisibleTextPrivacyFindings(output.tutor_message, "tutor_message"),
    ...findVisibleTextPrivacyFindings(
      output.student_safe_summary,
      "student_safe_summary"
    )
  ] : [];
  const answerKeyFindings = output &&
    /\b(?:the correct answer is|correct option is|answer key|unadministered answer)\b/iu
      .test(visible)
    ? ["answer_key_language_detected"]
    : [];
  const schemaIssues = output ? [] : ["schema_does_not_match_selected_mode"];
  const modeIssues = output &&
    output.schema_version !==
      TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[input.testCase.selected_mode]
    ? ["selected_mode_schema_version_mismatch"]
    : [];
  const responseFunctionIssues = issuesFor(base.issues, [
    "response_function_not_permitted",
    "schema_does_not_match_selected_mode"
  ]);
  const useCaseSpecificDirectResponse = [
    "task_clarification",
    "protected_redirect"
  ].includes(input.testCase.expectation.direct_response_kind);
  const directIssues = [
    ...(useCaseSpecificDirectResponse
      ? []
      : issuesFor(base.issues, ["latest_message_not_answered"])),
    ...custom.filter((code) => [
      "anchor_specific_evidence_request_missing",
      "conceptual_question_not_answered",
      "task_confusion_not_clarified_first",
      "task_requirement_not_stated",
      "protected_request_not_redirected",
      "contradictory_latest_evidence_not_addressed"
    ].includes(code))
  ];
  const languageIssues = [
    ...issuesFor(base.issues, [
      "progression_language_forbidden",
      "revision_language_required",
      "transfer_language_required",
      "completion_language_required",
      "internal_authorization_language_exposed"
    ]),
    ...custom.filter((code) => [
      "task_confusion_misclassified_as_disengagement",
      "protected_information_disclosed"
    ].includes(code))
  ];
  const anchorIssues = [
    ...issuesFor(base.issues, ["distractor_anchor_lost"]),
    ...custom.filter((code) => code === "distractor_anchor_not_retained")
  ];
  const strategyIssues = [
    ...issuesFor(base.issues, ["strategy_not_adapted"]),
    ...custom.filter((code) => [
      "strategy_not_genuinely_adapted",
      "worked_example_operation_not_evident",
      "earlier_resolution_improperly_reused"
    ].includes(code))
  ];
  const masteryIssues = custom.filter((code) =>
    code === "unsupported_mastery_accepted"
  );
  const revisionTransferIssues = [
    ...issuesFor(base.issues, ["revision_transfer_conflation"]),
    ...custom.filter((code) => [
      "revision_target_not_identified",
      "revision_overclaims_resolution",
      "provider_fabricated_transfer_item"
    ].includes(code))
  ];
  const completionIssues: string[] = [
    ...issuesFor(base.issues, [
      "completion_overclaim",
      "new_task_after_completion",
      "transfer_task_presented_by_provider"
    ]),
    ...custom.filter((code) => code === "completion_not_concise")
  ];
  const dimensions = {
    provider_schema_valid: dimension(schemaIssues),
    selected_mode: dimension(modeIssues),
    response_function_valid_for_mode: dimension(responseFunctionIssues),
    direct_response_to_latest_message: dimension(directIssues),
    student_facing_language_aligned: dimension(languageIssues),
    distractor_anchor_retained: dimension(anchorIssues),
    strategy_adaptation_valid: dimension(strategyIssues),
    unsupported_mastery_avoided: dimension(masteryIssues),
    revision_transfer_separation: dimension(revisionTransferIssues),
    completion_scope_valid: dimension(completionIssues),
    privacy_safe: dimension(privacyFindings.map((entry) => entry.matched_label)),
    answer_key_safe: dimension(answerKeyFindings)
  };
  return {
    valid: Object.values(dimensions).every((entry) => entry.passed),
    issues: base.issues,
    custom_issue_codes: custom,
    dimensions,
    output,
    privacy_findings: privacyFindings,
    answer_key_findings: answerKeyFindings
  };
}

function providerError(result: StructuredAgentResult<ModeOutput>) {
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
  testCase: E2A8TopicDialogueCase;
  result: StructuredAgentResult<ModeOutput>;
  attemptIndex: number;
}): ProviderAttempt {
  const validation = validateE2A8ProviderOutput({
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
    provider_output: validation.output,
    validation,
    usage: usageFromResult(input.result),
    latency_ms: input.result.latency_ms
  };
}

function contextCoverage(testCase: E2A8TopicDialogueCase) {
  const coverage = buildContextCoverage(testCase.context_case);
  const priorStudents = testCase.dialogue_input.visible_dialogue_history
    .filter((entry) => entry.actor_type === "student").length;
  const priorAssistants = testCase.dialogue_input.visible_dialogue_history
    .filter((entry) => entry.actor_type === "agent").length;
  const complete = !testCase.expectation.require_tenth_turn_context || (
    testCase.dialogue_input.dialogue_turn_number === 10 &&
    priorStudents === 9 &&
    priorAssistants === 9 &&
    coverage.missing_visible_turn_ids.length === 0 &&
    coverage.duplicated_visible_turn_ids.length === 0 &&
    coverage.order_matches &&
    coverage.exact_content_matches &&
    coverage.latest_student_message_separate &&
    coverage.initial_activity_present &&
    coverage.invisible_history_excluded
  );
  return {
    ...coverage,
    required_for_acceptance:
      testCase.expectation.require_tenth_turn_context,
    prior_student_message_count: priorStudents,
    prior_assistant_reply_count: priorAssistants,
    complete_tenth_turn_context: complete
  };
}

function deterministicRubric(
  validation: CandidateValidation,
  coverage: ReturnType<typeof contextCoverage>
) {
  const dimensions = Object.entries(validation.dimensions).map(
    ([name, result]) => ({
      dimension: name,
      status: result.passed ? "passed" as const : "failed" as const,
      severity: [
        "provider_schema_valid",
        "selected_mode",
        "privacy_safe",
        "answer_key_safe"
      ].includes(name) ? "critical" as const : "major" as const,
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

function finalizeCase(
  testCase: E2A8TopicDialogueCase,
  attempts: ProviderAttempt[]
): CaseResult {
  const finalAttempt = attempts.at(-1);
  const finalValidation = finalAttempt?.validation ??
    validateE2A8ProviderOutput({ testCase, value: undefined });
  const candidateValid = finalAttempt?.provider_request_status === "completed" &&
    finalValidation.valid;
  const providerOutput = candidateValid ? finalValidation.output : null;
  const providerInput = buildTopicDialogueModeProviderInput({
    dialogue_input: testCase.dialogue_input,
    selected_mode: testCase.selected_mode
  });
  const envelope = buildTopicDialogueModeRequestEnvelope({
    authorization: testCase.dialogue_input.progression_authorization,
    provider_input: providerInput
  });
  const applied = applyTopicDialogueModeResult({
    envelope,
    validation: candidateValid
      ? validateTopicDialogueModeOutput({
          selected_mode: testCase.selected_mode,
          output: providerOutput,
          latest_student_message: testCase.dialogue_input.latest_student_message,
          latest_response_classification:
            testCase.dialogue_input.latest_student_message_classification ??
              "server_classification_unavailable",
          distractor_anchor: testCase.distractor_anchor,
          misconception_target: testCase.misconception_target,
          strategies_already_attempted:
            testCase.expectation.prior_response_functions,
          platform_evidence_summary:
            testCase.dialogue_input.progression_authorization
              .authorization_evidence_summary
        })
      : { valid: false as const, issues: finalValidation.issues, output: null },
    fallback_input: {
      distractor_anchor: testCase.distractor_anchor,
      misconception_target: testCase.misconception_target,
      platform_evidence_summary:
        testCase.dialogue_input.progression_authorization
          .authorization_evidence_summary
    }
  });
  const coverage = contextCoverage(testCase);
  const rubric = deterministicRubric(finalValidation, coverage);
  const critical = rubric.filter((entry) =>
    entry.status === "failed" && entry.severity === "critical"
  ).map((entry) => entry.dimension);
  const major = rubric.filter((entry) =>
    entry.status === "failed" && entry.severity === "major"
  ).map((entry) => entry.dimension);
  const providerFailed = attempts.length > 0 &&
    attempts.every((entry) => entry.provider_request_status !== "completed");
  return {
    case_id: testCase.case_id,
    case_number: testCase.case_number,
    selected_mode: testCase.selected_mode,
    platform_authorized_action: testCase.platform_authorized_action,
    status: candidateValid && coverage.complete_tenth_turn_context &&
      critical.length === 0 && major.length === 0
      ? "passed_automated"
      : providerFailed
        ? "provider_failed"
        : "failed",
    provider_attempts: attempts,
    adapter_attempt_count: attempts.length,
    generation_call_count: attempts.filter((entry) =>
      entry.generation_dispatched
    ).length,
    regeneration_count: attempts.filter((entry) => entry.regeneration).length,
    first_attempt_valid: attempts[0]?.validation.valid === true,
    regeneration_succeeded:
      attempts.length === 2 && attempts[1]?.validation.valid === true,
    final_provider_output: providerOutput,
    candidate_semantic_valid: candidateValid,
    safe_fallback_used: !candidateValid,
    effective_output: applied.effective_output as ModeOutput,
    platform_safety: {
      selected_mode: testCase.selected_mode,
      platform_authorized_action: testCase.platform_authorized_action,
      provider_response_function:
        finalValidation.output?.response_function ?? null,
      candidate_semantic_valid: candidateValid,
      platform_gate_result: "authorized_mode_preserved",
      ui_progression_available: testCase.selected_mode !== "remain_in_dialogue",
      executed_transition: false,
      safe_fallback_used: !candidateValid
    },
    context_coverage: coverage,
    privacy_findings: finalValidation.privacy_findings,
    answer_key_findings: finalValidation.answer_key_findings,
    deterministic_rubric: rubric,
    critical_findings: critical,
    major_findings: major,
    usage: aggregateUsage(attempts),
    latency_ms: attempts.reduce((sum, entry) => sum + entry.latency_ms, 0),
    human_review_status: "pending"
  };
}

function skippedCase(testCase: E2A8TopicDialogueCase, reason: string): CaseResult {
  const result = finalizeCase(testCase, []);
  return {
    ...result,
    status: "skipped_budget",
    major_findings: [...new Set([...result.major_findings, reason])]
  };
}

function inputTokenReserve(testCase: E2A8TopicDialogueCase) {
  const providerInput = buildTopicDialogueModeProviderInput({
    dialogue_input: testCase.dialogue_input,
    selected_mode: testCase.selected_mode
  });
  const envelope = buildTopicDialogueModeRequestEnvelope({
    authorization: testCase.dialogue_input.progression_authorization,
    provider_input: providerInput
  });
  return Math.ceil(
    `${envelope.instructions}\n${JSON.stringify(envelope.provider_input)}`.length / 3
  );
}

function assertBudgetBeforeDispatch(input: {
  budget: E2A8Budget;
  completedResults: CaseResult[];
  currentAttempts: ProviderAttempt[];
  testCase: E2A8TopicDialogueCase;
  modelConfig: AgentModelConfig;
  regeneration: boolean;
}) {
  const prior = resultUsage(input.completedResults);
  const current = aggregateUsage(input.currentAttempts);
  const currentGenerationCalls = input.currentAttempts.filter((entry) =>
    entry.generation_dispatched
  ).length;
  if (!input.regeneration && input.completedResults.length >= input.budget.maximum_cases) {
    throw new Error("e2a8_case_budget_exceeded");
  }
  if (!input.regeneration && prior.initial_generation_calls + 1 >
    input.budget.maximum_initial_generation_calls) {
    throw new Error("e2a8_initial_call_budget_exceeded");
  }
  if (input.regeneration && prior.regeneration_generation_calls +
    input.currentAttempts.filter((entry) => entry.regeneration &&
      entry.generation_dispatched).length + 1 >
      input.budget.maximum_regeneration_calls) {
    throw new Error("e2a8_regeneration_call_budget_exceeded");
  }
  if (prior.generation_provider_calls + currentGenerationCalls + 1 >
    input.budget.maximum_total_generation_calls) {
    throw new Error("e2a8_total_call_budget_exceeded");
  }
  if (prior.input_tokens + current.input_tokens + inputTokenReserve(input.testCase) >
    input.budget.maximum_input_tokens) {
    throw new Error("e2a8_input_token_budget_insufficient");
  }
  if (prior.output_tokens + current.output_tokens +
    (input.modelConfig.max_output_tokens ?? 3500) >
    input.budget.maximum_output_tokens) {
    throw new Error("e2a8_output_token_budget_insufficient");
  }
  const priced = [
    ...allAttempts(input.completedResults),
    ...input.currentAttempts
  ].filter((entry) => entry.usage.estimated_cost_usd !== null);
  const costReserve = priced.length === 0 ? 0 : priced.reduce(
    (sum, entry) => sum + (entry.usage.estimated_cost_usd ?? 0),
    0
  ) / priced.length;
  const priorCost = prior.estimated_cost_usd;
  if (prior.pricing_available && current.pricing_available &&
    priorCost !== null && current.estimated_cost_usd !== null &&
    priorCost + current.estimated_cost_usd + costReserve >
      input.budget.maximum_estimated_cost_usd) {
    throw new Error("e2a8_cost_budget_insufficient");
  }
}

function repairInstructions(
  mode: TopicDialogueResponseMode,
  validation: CandidateValidation,
  originalInstructions: string
) {
  const codes = [...new Set([
    ...validation.issues.map((entry) => entry.rule_code),
    ...validation.custom_issue_codes,
    ...Object.values(validation.dimensions)
      .flatMap((entry) => entry.issue_codes)
  ])].join(", ");
  return `${originalInstructions}\n\n` +
    "The previous structured response was rejected by the candidate validator. " +
    `The platform-selected response mode remains exactly ${mode}. ` +
    "Do not choose or recommend another action. " +
    `Correct these safe rule codes: ${codes || "schema_or_mode_alignment"}. ` +
    "Return a fresh complete object for the same mode-specific schema.";
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "canary-manifest.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    responseModeContract: path.join(runDir, "response-mode-contract.json"),
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

function writeCaseArtifacts(
  paths: ReturnType<typeof artifactPaths>,
  testCase: E2A8TopicDialogueCase,
  result: CaseResult
) {
  const providerInput = buildTopicDialogueModeProviderInput({
    dialogue_input: testCase.dialogue_input,
    selected_mode: testCase.selected_mode
  });
  appendJsonl(paths.providerCases, {
    case_id: testCase.case_id,
    case_number: testCase.case_number,
    selected_mode: testCase.selected_mode,
    platform_authorized_action: testCase.platform_authorized_action,
    scenario_truth_summary: testCase.scenario_truth_summary,
    latest_student_message: testCase.dialogue_input.latest_student_message,
    distractor_anchor: testCase.distractor_anchor,
    provider_input: providerInput
  });
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
      provider_output: attempt.provider_output,
      usage: attempt.usage,
      latency_ms: attempt.latency_ms
    });
    appendJsonl(paths.candidateValidation, {
      case_id: result.case_id,
      attempt_index: attempt.attempt_index,
      regeneration: attempt.regeneration,
      valid: attempt.validation.valid,
      selected_mode: result.selected_mode,
      dimensions: attempt.validation.dimensions,
      issues: attempt.validation.issues,
      custom_issue_codes: attempt.validation.custom_issue_codes
    });
  }
  appendJsonl(paths.platformSafety, {
    case_id: result.case_id,
    ...result.platform_safety
  });
  appendJsonl(paths.contextCoverage, {
    ...result.context_coverage
  });
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
  cases: E2A8TopicDialogueCase[];
  provider: LlmProvider;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
  budget: E2A8Budget;
  paths: ReturnType<typeof artifactPaths>;
  runId: string;
}) {
  const results: CaseResult[] = [];
  for (const testCase of input.cases) {
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
        const providerInput = buildTopicDialogueModeProviderInput({
          dialogue_input: testCase.dialogue_input,
          selected_mode: testCase.selected_mode
        });
        const envelope = buildTopicDialogueModeRequestEnvelope({
          authorization: testCase.dialogue_input.progression_authorization,
          provider_input: providerInput
        });
        const priorValidation = attempts.at(-1)?.validation;
        const providerResult = await input.provider.executeStructured<
          typeof providerInput,
          ModeOutput
        >({
          agent_name: "topic_dialogue_agent",
          model_config: input.modelConfig,
          instructions: attemptIndex === 1 || !priorValidation
            ? envelope.instructions
            : repairInstructions(
                testCase.selected_mode,
                priorValidation,
                envelope.instructions
              ),
          input: envelope.provider_input,
          output_schema: envelope.output_schema as z.ZodType<ModeOutput>,
          schema_name: envelope.schema_name,
          client_request_id:
            `${input.runId}_${testCase.case_id}_${attemptIndex}`,
          timeout_ms: input.timeoutMs,
          metadata: {
            evaluation: "e2a8_v6_topic_dialogue_canary",
            case_id: testCase.case_id,
            selected_response_mode: testCase.selected_mode,
            candidate_hash_prefix: E2A7_CANDIDATE_HASH.slice(0, 12)
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
      writeCaseArtifacts(input.paths, testCase, result);
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "e2a8_budget_or_dispatch_block";
      const result = attempts.length > 0
        ? finalizeCase(testCase, attempts)
        : skippedCase(testCase, reason);
      if (!result.major_findings.includes(reason)) {
        result.major_findings.push(reason);
      }
      results.push(result);
      writeCaseArtifacts(input.paths, testCase, result);
    }
  }
  return results;
}

function buildSummary(
  results: CaseResult[],
  budget: E2A8Budget,
  protectedBefore: ReturnType<typeof e2a8ProtectedArtifactSnapshot>,
  protectedAfter: ReturnType<typeof e2a8ProtectedArtifactSnapshot>
) {
  const usage = resultUsage(results);
  const attempts = allAttempts(results);
  const contextRequired = results.filter((entry) =>
    entry.context_coverage.required_for_acceptance
  );
  const protectedUnchanged =
    protectedBefore.aggregate_sha256 === protectedAfter.aggregate_sha256;
  const allDispatched = results.length === 8 && results.every((entry) =>
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
  const automatedPass = allDispatched &&
    results.every((entry) =>
      entry.status === "passed_automated" &&
      entry.candidate_semantic_valid &&
      !entry.safe_fallback_used &&
      entry.critical_findings.length === 0 &&
      entry.major_findings.length === 0
    ) &&
    contextRequired.length === 2 &&
    contextRequired.every((entry) =>
      entry.context_coverage.complete_tenth_turn_context
    ) &&
    budgetWithinLimits &&
    protectedUnchanged;
  const incomplete = !allDispatched || results.some((entry) =>
    entry.status === "skipped_budget"
  );
  const finalStatus = automatedPass
    ? "v6_canary_passed_pending_human_review" as const
    : incomplete
      ? "v6_canary_incomplete" as const
      : "v6_canary_failed" as const;
  return {
    summary_version: "e2a8-v6-live-canary-summary-v1",
    final_status: finalStatus,
    automated_canary_passed: automatedPass,
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
    regeneration_count: results.reduce((sum, entry) =>
      sum + entry.regeneration_count, 0
    ),
    regeneration_success_count: results.filter((entry) =>
      entry.regeneration_succeeded
    ).length,
    fallback_count: results.filter((entry) =>
      entry.safe_fallback_used
    ).length,
    regeneration_human_review_flag: results.reduce((sum, entry) =>
      sum + entry.regeneration_count, 0
    ) > 2,
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
    unauthorized_language_finding_count: attempts.reduce((sum, attempt) =>
      sum + attempt.validation.dimensions.student_facing_language_aligned
        .issue_codes.length, 0
    ),
    direct_response_failure_count: attempts.filter((attempt) =>
      !attempt.validation.dimensions.direct_response_to_latest_message.passed
    ).length,
    strategy_adaptation_failure_count: attempts.filter((attempt) =>
      !attempt.validation.dimensions.strategy_adaptation_valid.passed
    ).length,
    distractor_focus_failure_count: attempts.filter((attempt) =>
      !attempt.validation.dimensions.distractor_anchor_retained.passed
    ).length,
    unsupported_understanding_failure_count: attempts.filter((attempt) =>
      !attempt.validation.dimensions.unsupported_mastery_avoided.passed
    ).length,
    revision_transfer_failure_count: attempts.filter((attempt) =>
      !attempt.validation.dimensions.revision_transfer_separation.passed
    ).length,
    completion_scope_failure_count: attempts.filter((attempt) =>
      !attempt.validation.dimensions.completion_scope_valid.passed
    ).length,
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
    case_results: results.map((entry) => ({
      case_id: entry.case_id,
      case_number: entry.case_number,
      selected_mode: entry.selected_mode,
      status: entry.status,
      candidate_semantic_valid: entry.candidate_semantic_valid,
      platform_safe: entry.platform_safety.platform_gate_result ===
        "authorized_mode_preserved",
      first_attempt_valid: entry.first_attempt_valid,
      regeneration_count: entry.regeneration_count,
      safe_fallback_used: entry.safe_fallback_used,
      critical_findings: entry.critical_findings,
      major_findings: entry.major_findings
    }))
  };
}

function humanReviewPacket(
  cases: E2A8TopicDialogueCase[],
  results: CaseResult[]
) {
  return {
    packet_version: "e2a8-v6-human-review-packet-v1",
    review_target: "v6_topic_dialogue_provider_outputs",
    review_status: "pending",
    human_review_required: true,
    human_review_completed: false,
    human_reviewer: null,
    human_decision: null,
    human_scores: null,
    no_human_review_fabricated: true,
    provider_output_count: results.reduce((sum, entry) =>
      sum + entry.provider_attempts.filter((attempt) =>
        attempt.provider_output !== null
      ).length, 0
    ),
    cases: cases.map((testCase) => {
      const result = results.find((entry) =>
        entry.case_id === testCase.case_id
      );
      if (!result) throw new Error(`e2a8_review_case_missing:${testCase.case_id}`);
      return {
        case_id: testCase.case_id,
        selected_mode: testCase.selected_mode,
        scenario_truth_summary: testCase.scenario_truth_summary,
        latest_student_message: testCase.dialogue_input.latest_student_message,
        safe_visible_history_excerpt:
          testCase.dialogue_input.visible_dialogue_history.slice(-4).map(
            (turn) => ({
              visible_turn_id: turn.visible_turn_id,
              actor_type: turn.actor_type,
              message_text: turn.message_text
            })
          ),
        distractor_anchor: testCase.distractor_anchor,
        provider_attempts: result.provider_attempts.map((attempt) => ({
          attempt_index: attempt.attempt_index,
          regeneration: attempt.regeneration,
          provider_response_function:
            attempt.provider_output?.response_function ?? null,
          student_facing_message:
            attempt.provider_output?.tutor_message ?? null,
          validator_findings: {
            valid: attempt.validation.valid,
            dimensions: attempt.validation.dimensions,
            issues: attempt.validation.issues,
            custom_issue_codes: attempt.validation.custom_issue_codes
          }
        })),
        platform_safety_result: result.platform_safety,
        context_coverage: result.context_coverage.required_for_acceptance
          ? result.context_coverage
          : null,
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
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `e2a8_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export async function executeE2A8Canary(input: {
  live: boolean;
  provider?: LlmProvider;
  artifactRoot?: string;
  runId?: string;
  skipCleanTreeForTest?: boolean;
} ) {
  const candidate = evaluateE2A7Candidate();
  const budget = resolveE2A8Budget();
  const cases = e2a8CanaryCases();
  const runId = input.runId ?? newRunId();
  const root = input.artifactRoot ?? E2A8_ARTIFACT_ROOT;
  const runDir = path.join(root, runId);
  if (existsSync(runDir)) throw new Error("e2a8_run_already_exists");
  mkdirSync(runDir, { recursive: true });
  const paths = artifactPaths(runDir);
  const protectedBefore = e2a8ProtectedArtifactSnapshot();
  const preflight = await inspectE2A8Preflight({
    requireLiveEnvironment: input.live,
    requireCleanTree: input.live && !input.skipCleanTreeForTest
  });
  if (!preflight.passed) {
    throw new Error(`e2a8_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const buildInfo = resolveApplicationBuildInfo(input.live ? {} : {
    artifactPath: path.join(
      os.tmpdir(),
      `e2a8-no-live-build-info-${randomBytes(4).toString("hex")}.json`
    ),
    allowGitFallback: true
  });
  if (!buildInfo.ok) throw new Error(buildInfo.code);
  const compilation = await compileE2A7CandidateRequestsNoNetwork(
    paths.requestCompilation
  );
  const modeAudit = buildE2A7ModeSchemaAudit();
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  const provider = input.provider ?? new OpenAIResponsesProvider();
  const manifestBase = {
    manifest_version: "e2a8-v6-live-canary-manifest-v1",
    run_id: runId,
    canary_status: "running",
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v5_hash: candidate.failed_v5_hash,
    candidate_approved: false,
    candidate_activated: false,
    application_git_commit: buildInfo.info.application_git_commit,
    application_git_commit_source:
      buildInfo.info.application_git_commit_source,
    protocol_version: E2A8_PROTOCOL_VERSION,
    protocol_hash: e2a8ProtocolHash(),
    evaluator_version: E2A8_EVALUATOR_VERSION,
    provider: input.live ? "openai" : "injected_no_live_provider",
    model: modelConfig.model_name,
    reasoning_effort: modelConfig.reasoning_effort,
    max_output_tokens: modelConfig.max_output_tokens,
    provider_timeout_ms:
      candidate.full_candidate.runtime_policy.provider_timeout_ms,
    adapter_version: input.live
      ? OPENAI_RESPONSES_ADAPTER_VERSION
      : "injected-test-provider",
    transport_retries: 0,
    prompt_family_version: TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
    prompt_family_hash: TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
    input_schema_version: TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION,
    output_contract_family_version:
      TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION,
    output_schema_versions: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
    validator_version: TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
    server_envelope_version: TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
    fallback_version: TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
    budget,
    preflight,
    protected_artifacts_before: protectedBefore,
    human_review_required: true,
    human_review_status: "pending",
    thirty_case_evaluation_executed: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false,
    started_at: new Date().toISOString()
  };
  writeJson(paths.manifest, manifestBase);
  writeJson(paths.candidateDelta, {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v5_hash: candidate.failed_v5_hash,
    exact_delta_paths_from_approved_v2:
      candidate.exact_delta_paths_from_approved_v2,
    exact_delta_paths_from_failed_v5:
      candidate.exact_delta_paths_from_failed_v5,
    role_config_hashes: candidate.role_config_hashes,
    unrelated_role_configuration_changed: false
  });
  writeJson(paths.responseModeContract, {
    contract_family_version: TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION,
    input_schema_version: TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION,
    prompt_family_version: TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
    prompt_family_hash: TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
    prompt_hashes: TOPIC_DIALOGUE_MODE_PROMPT_HASHES,
    output_schema_versions: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
    validator_version: TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
    server_envelope_version: TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
    fallback_version: TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
    platform_selects_mode_before_request: true,
    provider_action_fields_absent:
      modeAudit.all_provider_action_fields_absent,
    all_mode_schemas_compile: modeAudit.all_mode_schemas_compile
  });
  writeJson(paths.protocol, e2a8ProtocolSnapshot());
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
    throw new Error("e2a8_request_compilation_gate_failed");
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
  const protectedAfter = e2a8ProtectedArtifactSnapshot();
  const summary = buildSummary(
    results,
    budget,
    protectedBefore,
    protectedAfter
  );
  const usage = summary.provider_usage;
  const review = humanReviewPacket(cases, results);
  writeJson(paths.providerUsage, usage);
  writeJson(paths.humanReviewPacket, review);
  writeJson(paths.summary, summary);
  writeJson(paths.manifest, {
    ...manifestBase,
    canary_status: summary.final_status,
    completed_at: new Date().toISOString(),
    protected_artifacts_after: protectedAfter,
    protected_artifacts_unchanged:
      summary.protected_artifacts_unchanged,
    provider_adapter_attempt_count: usage.provider_adapter_attempts,
    generation_call_count: usage.generation_provider_calls,
    metadata_only_request_count: usage.metadata_only_requests,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    estimated_cost_usd: usage.estimated_cost_usd,
    cost_status: usage.pricing_available
      ? "complete_pricing_available"
      : "pricing_unavailable_or_incomplete",
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

export async function executeLiveE2A8Canary() {
  const credential = resolveOpenAICredentialFromEnv(process.env);
  if (!credential.ok) throw new Error(credential.code);
  return withResolvedOpenAICredential(
    credential.credential,
    () => executeE2A8Canary({ live: true })
  );
}

export function loadE2A8Canary(
  runId?: string,
  artifactRoot = E2A8_ARTIFACT_ROOT
) {
  const latestPath = path.join(artifactRoot, "latest-run.json");
  if (!runId && !existsSync(latestPath)) {
    throw new Error("e2a8_latest_run_missing");
  }
  const latest = runId ? {
    run_id: runId,
    run_directory: path.join(artifactRoot, runId)
  } : readJson<{ run_id: string; run_directory: string }>(latestPath);
  const runDir = path.isAbsolute(latest.run_directory)
    ? latest.run_directory
    : path.join(process.cwd(), latest.run_directory);
  if (!existsSync(runDir)) throw new Error("e2a8_run_missing");
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

export function temporaryE2A8ArtifactRoot() {
  return path.join(
    os.tmpdir(),
    `e2a8-v6-canary-${randomBytes(5).toString("hex")}`
  );
}
