import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
import { LiveModelRole, type AgentModelConfig } from "@/lib/llm/config";
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
  TopicDialogueOutputV1Schema,
  validateTopicDialogueOutput,
  type TopicDialogueOutputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  findVisibleTextPrivacyFindings,
  type StudentPrivacyFinding
} from "./student-privacy-scanner";
import {
  E2A2_TOPIC_DIALOGUE_CANDIDATE_PATH,
  evaluateE2A2TopicDialogueCandidate,
  readE2A2TopicDialogueCandidate
} from "./e2a-contract-reconciliation";
import {
  e2a3EvaluationProtocolHash,
  e2a3EvaluationProtocolSnapshot,
  e2a3TopicDialogueCases,
  type E2A3TopicDialogueCase
} from "./e2a3-topic-dialogue-protocol";

export const E2A3_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a3-topic-dialogue-candidate-evaluation"
);
export const E2A3_CANDIDATE_HASH =
  "681ab5f96c9c18dfdd9aa17f335d3594a37cd7696bee6cbfe7c2e010c6943404";
export const E2A3_CANDIDATE_FILE_SHA256 =
  "1c8ac4e1400fb68b22133a157ec856f6b2ce64a701cd50055e6a3c83d6306bde";
export const E2A3_APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
export const E2A3_EVALUATOR_VERSION = "e2a3-topic-dialogue-evaluator-v1";
export const E2A3_BUDGET_VERSION = "e2a3-topic-dialogue-budget-v1";
export const E2A3_PROTECTED_SNAPSHOT_VERSION = "e2a3-protected-artifact-snapshot-v1";

const BASELINE_MANIFEST_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.gpt-5.6-full-v2.json"
);
const ACTIVE_BUNDLE_PATH = path.join(
  process.cwd(),
  ".data",
  "operational-model-upgrade",
  "active-approval",
  "active-approval-bundle.json"
);
const ACTIVE_APPROVAL_ROOT = path.join(
  process.cwd(),
  ".data",
  "operational-model-upgrade",
  "active-approval"
);

type JsonRecord = Record<string, unknown>;
type BaselineManifest = {
  manifest_version: string;
  roles: Record<string, AgentModelConfig>;
  runtime_policy: {
    provider_timeout_ms: number;
    provider_max_retries: number;
    role_live_toggles: Record<string, boolean>;
    topic_dialogue_policy: {
      maximum_student_turns: number;
      recent_raw_turn_window: number;
      maximum_student_message_characters: number;
      assessment_system_questions_allowed: boolean;
    };
  };
  configuration_fingerprint: {
    role_version_metadata: Record<string, Record<string, unknown>>;
  };
};

export type E2A3Budget = {
  budget_version: typeof E2A3_BUDGET_VERSION;
  maximum_generation_cases: number;
  maximum_generation_provider_calls: number;
  maximum_input_tokens: number;
  maximum_output_tokens: number;
  maximum_estimated_cost_usd: number;
  maximum_retries_per_generation: number;
  cost_enforcement: "enforced_when_complete_pricing_available";
};

export type E2A3ContextCoverage = {
  case_id: string;
  student_turn_count: number;
  expected_visible_turn_ids: string[];
  serialized_visible_turn_ids: string[];
  missing_visible_turn_ids: string[];
  duplicated_visible_turn_ids: string[];
  order_matches: boolean;
  exact_content_matches: boolean;
  latest_student_message_separate: boolean;
  initial_activity_present: boolean;
  invisible_history_excluded: boolean;
  context_sections_used: string[];
};

export type RubricDimension = {
  dimension: string;
  status: "passed" | "failed" | "manual_review_required" | "not_applicable";
  score: 0 | 1 | 2 | null;
  severity: "critical" | "major" | "minor" | "manual" | "none";
  evidence: string;
};

type E2A3CaseResult = {
  case_id: string;
  category: string;
  repetition_index: number;
  student_turn_count: number;
  tenth_turn: boolean;
  status: "passed_automated" | "failed" | "skipped_budget" | "provider_failed";
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
    fetch_invoked: boolean;
    response_headers_received: boolean;
  } | null;
  parsed_output: TopicDialogueOutputV1 | null;
  schema_valid: boolean;
  validator_issues: Array<{ field_path: string; rule_code: string; blocked_pattern_label?: string }>;
  privacy_findings: StudentPrivacyFinding[];
  context_coverage: E2A3ContextCoverage;
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

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function relative(filePath: string) {
  return path.relative(process.cwd(), filePath) || ".";
}

function fileSha(filePath: string) {
  return sha256(readFileSync(filePath));
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function directoryHash(root: string) {
  const files = listFiles(root);
  return {
    exists: existsSync(root),
    file_count: files.length,
    sha256: sha256(files.map((filePath) => `${relative(filePath)}:${fileSha(filePath)}`).join("\n"))
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

export function protectedArtifactSnapshot() {
  const trackedGroups = {
    approved_v2_configuration: directoryHash(
      path.join(process.cwd(), "config", "approved-operational-agent-config.json")
    ),
    approved_full_candidate: directoryHash(BASELINE_MANIFEST_PATH),
    approved_active_bundle: directoryHash(ACTIVE_APPROVAL_ROOT),
    approved_prompts_and_provider_contracts: directoryHash(
      path.join(process.cwd(), "src", "lib", "agents")
    ),
    topic_dialogue_schema_and_validator: directoryHash(
      path.join(
        process.cwd(),
        "src",
        "lib",
        "services",
        "student-assessment",
        "topic-dialogue-agent.ts"
      )
    ),
    prior_provider_runs: directoryHash(
      path.join(process.cwd(), ".data", "operational-model-upgrade", "runs")
    ),
    prior_derived_evaluations: directoryHash(
      path.join(process.cwd(), ".data", "operational-model-upgrade", "derived-evaluations")
    ),
    prior_e2a_runs: directoryHash(
      path.join(process.cwd(), ".data", "formative-evaluation-e2a")
    )
  };
  const environment_metadata = {
    env: envMetadata(path.join(process.cwd(), ".env")),
    env_local: envMetadata(path.join(process.cwd(), ".env.local"))
  };
  return {
    snapshot_version: E2A3_PROTECTED_SNAPSHOT_VERSION,
    tracked_groups: trackedGroups,
    environment_metadata,
    aggregate_sha256: stableHash({ trackedGroups, environment_metadata })
  };
}

function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (Object.is(before, after)) return [];
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    return [prefix || "root"];
  }
  const beforeRecord = before as JsonRecord;
  const afterRecord = after as JsonRecord;
  return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
    .sort()
    .flatMap((key) => changedPaths(
      beforeRecord[key],
      afterRecord[key],
      prefix ? `${prefix}.${key}` : key
    ));
}

function deriveFullCandidate(baseline: BaselineManifest) {
  const derived = structuredClone(baseline);
  derived.runtime_policy.topic_dialogue_policy.recent_raw_turn_window = 18;
  const topicMetadata = derived.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  if (!topicMetadata) throw new Error("e2a3_topic_dialogue_role_metadata_missing");
  topicMetadata.input_schema_version = "topic-dialogue-input-v3";
  return derived;
}

function activeApprovalBundle() {
  if (!existsSync(ACTIVE_BUNDLE_PATH)) throw new Error("e2a3_active_approval_bundle_missing");
  return readJson<{
    runtime_candidate_hash?: string;
    source_provider_run_id?: string;
    derived_evaluation_id?: string;
    evaluation_protocol_hash?: string;
    approval_evidence?: { path?: string; sha256?: string };
    approved_manifest?: { path?: string; sha256?: string };
  }>(ACTIVE_BUNDLE_PATH);
}

function containsCandidateApprovalEvidence(candidateHash: string) {
  const roots = [
    path.join(process.cwd(), ".data", "operational-model-upgrade", "active-approval"),
    path.join(process.cwd(), ".data", "operational-model-upgrade", "derived-evaluations"),
    path.join(process.cwd(), ".data", "operational-model-upgrade", "runs")
  ];
  const matchingFiles: string[] = [];
  for (const root of roots) {
    for (const filePath of listFiles(root)) {
      if (!/\.json(?:l)?$/u.test(filePath)) continue;
      if (readFileSync(filePath, "utf8").includes(candidateHash)) {
        matchingFiles.push(relative(filePath));
      }
    }
  }
  return matchingFiles;
}

export function resolveE2A3Budget(env: NodeJS.ProcessEnv = process.env): E2A3Budget {
  const intValue = (key: string, defaultValue: number, maximum: number) => {
    const raw = env[key];
    if (raw === undefined || raw === "") return defaultValue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
      throw new Error(`${key.toLowerCase()}_invalid`);
    }
    return parsed;
  };
  const numberValue = (key: string, defaultValue: number, maximum: number) => {
    const raw = env[key];
    if (raw === undefined || raw === "") return defaultValue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
      throw new Error(`${key.toLowerCase()}_invalid`);
    }
    return parsed;
  };
  return {
    budget_version: E2A3_BUDGET_VERSION,
    maximum_generation_cases: intValue("EVAL_E2A3_MAX_CASES", 30, 36),
    maximum_generation_provider_calls: intValue("EVAL_E2A3_MAX_CALLS", 90, 120),
    maximum_input_tokens: intValue("EVAL_E2A3_MAX_INPUT_TOKENS", 600_000, 600_000),
    maximum_output_tokens: intValue("EVAL_E2A3_MAX_OUTPUT_TOKENS", 120_000, 120_000),
    maximum_estimated_cost_usd: numberValue("EVAL_E2A3_MAX_COST_USD", 25, 25),
    maximum_retries_per_generation: intValue("EVAL_E2A3_MAX_RETRIES", 2, 2),
    cost_enforcement: "enforced_when_complete_pricing_available"
  };
}

function gitStatus() {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

export function inspectE2A3CandidatePreflight(input: {
  requireCleanTree?: boolean;
  requireLiveEnvironment?: boolean;
  scanExistingEvidence?: boolean;
} = {}) {
  const candidateText = readFileSync(E2A2_TOPIC_DIALOGUE_CANDIDATE_PATH, "utf8");
  const candidate = readE2A2TopicDialogueCandidate();
  const candidateEvaluation = evaluateE2A2TopicDialogueCandidate(candidate);
  const baselineText = readFileSync(BASELINE_MANIFEST_PATH, "utf8");
  const baseline = JSON.parse(baselineText) as BaselineManifest;
  const derived = deriveFullCandidate(baseline);
  const deltaPaths = changedPaths(baseline, derived);
  const roles = Object.keys(baseline.roles).sort();
  const active = activeApprovalBundle();
  const roleInventory = [...LiveModelRole.options].sort();
  const existingEvidence = input.scanExistingEvidence === false
    ? []
    : containsCandidateApprovalEvidence(E2A3_CANDIDATE_HASH);
  const baseUrl = resolveOpenAIBaseUrl();
  const credential = input.requireLiveEnvironment
    ? resolveOpenAICredentialFromEnv(process.env)
    : null;
  const blockers: string[] = [];

  if (sha256(candidateText) !== E2A3_CANDIDATE_FILE_SHA256) blockers.push("candidate_file_sha_mismatch");
  if (candidateEvaluation.candidate_configuration_hash !== E2A3_CANDIDATE_HASH) blockers.push("candidate_hash_mismatch");
  if (!candidateEvaluation.compatible) blockers.push("candidate_contract_incompatible");
  if (candidate.baseline_approved_runtime_hash !== E2A3_APPROVED_V2_HASH) blockers.push("approved_v2_hash_mismatch");
  if (sha256(baselineText) !== candidate.baseline_candidate_manifest_sha256) blockers.push("baseline_manifest_sha_mismatch");
  if (active.runtime_candidate_hash !== E2A3_APPROVED_V2_HASH) blockers.push("approved_v2_not_active");
  if (roles.length !== 17 || JSON.stringify(roles) !== JSON.stringify(roleInventory)) blockers.push("role_inventory_mismatch");
  const expectedDelta = [
    "configuration_fingerprint.role_version_metadata.topic_dialogue_agent.input_schema_version",
    "runtime_policy.topic_dialogue_policy.recent_raw_turn_window"
  ].sort();
  if (JSON.stringify(deltaPaths) !== JSON.stringify(expectedDelta)) blockers.push("undocumented_candidate_delta");
  if (baseline.roles.topic_dialogue_agent?.model_name !== "gpt-5.6-sol") blockers.push("topic_dialogue_model_mismatch");
  if (baseline.roles.topic_dialogue_agent?.reasoning_effort !== "medium") blockers.push("topic_dialogue_reasoning_mismatch");
  if (baseline.roles.topic_dialogue_agent?.max_output_tokens !== 3500) blockers.push("topic_dialogue_token_limit_mismatch");
  if (baseline.configuration_fingerprint.role_version_metadata.topic_dialogue_agent?.prompt_hash !== TOPIC_DIALOGUE_PROMPT_HASH) blockers.push("topic_dialogue_prompt_hash_mismatch");
  if (baseline.configuration_fingerprint.role_version_metadata.topic_dialogue_agent?.prompt_version !== TOPIC_DIALOGUE_PROMPT_VERSION) blockers.push("topic_dialogue_prompt_version_mismatch");
  if (existingEvidence.length > 0) blockers.push("candidate_approval_or_activation_evidence_already_exists");
  if (input.requireCleanTree && gitStatus()) blockers.push("tracked_worktree_not_clean");
  if (input.requireLiveEnvironment) {
    if (process.env.EVAL_E2A3_LIVE_PROVIDER !== "1") blockers.push("live_e2a3_opt_in_missing");
    if (process.env.LLM_PROVIDER !== "openai") blockers.push("provider_not_openai");
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") blockers.push("live_calls_not_enabled");
    if (process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== active.runtime_candidate_hash) {
      blockers.push("approved_config_hash_mismatch");
    }
    if (!baseline.runtime_policy.role_live_toggles.topic_dialogue_agent) blockers.push("topic_dialogue_role_toggle_disabled");
    if (!isApprovedOpenAIBaseUrl(baseUrl)) blockers.push("openai_base_url_not_approved");
    if (!credential?.ok) blockers.push(credential?.code ?? "credential_missing");
  }

  return {
    preflight_version: "e2a3-candidate-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    candidate_hash: candidateEvaluation.candidate_configuration_hash,
    candidate_file_sha256: sha256(candidateText),
    approved_v2_hash: active.runtime_candidate_hash ?? null,
    candidate_approved: false,
    candidate_activated: false,
    role_count: roles.length,
    role_inventory: roles,
    exact_delta_paths: deltaPaths,
    exact_delta: candidate.exact_delta_from_baseline,
    protocol_hash: e2a3EvaluationProtocolHash(),
    provider: input.requireLiveEnvironment ? "openai" : "not_checked",
    provider_host: input.requireLiveEnvironment ? openAIBaseUrlHost(baseUrl) : "not_checked",
    credential_configured: credential?.ok ?? false,
    credential_fingerprint_prefix: credential?.ok
      ? credential.credential.fingerprint_prefix
      : null,
    existing_candidate_evidence_paths: existingEvidence,
    active_evidence_inheritance: {
      source_provider_run_id: active.source_provider_run_id ?? null,
      source_derived_evaluation_id: active.derived_evaluation_id ?? null,
      source_evaluation_protocol_hash: active.evaluation_protocol_hash ?? null,
      approval_evidence_path: active.approval_evidence?.path ?? null,
      approval_evidence_sha256: active.approval_evidence?.sha256 ?? null,
      approved_manifest_path: active.approved_manifest?.path ?? null,
      approved_manifest_sha256: active.approved_manifest?.sha256 ?? null,
      inherited_role_count: roles.filter((role) => role !== "topic_dialogue_agent").length,
      newly_evaluated_roles: ["topic_dialogue_agent"],
      inheritance_semantics: "immutable_reference_only",
      approval_cli_supports_role_scoped_inheritance: false
    }
  };
}

export function buildContextCoverage(testCase: E2A3TopicDialogueCase): E2A3ContextCoverage {
  const expectedTurns: Array<{ id: string; text: string }> = [];
  const studentMessages = testCase.input.visible_dialogue_history
    .filter((turn) => turn.actor_type === "student");
  const assistantMessages = testCase.input.visible_dialogue_history
    .filter((turn) => turn.actor_type === "agent");
  for (let index = 0; index < Math.max(studentMessages.length, assistantMessages.length); index += 1) {
    const student = studentMessages[index];
    const assistant = assistantMessages[index];
    if (student) expectedTurns.push({ id: student.visible_turn_id, text: student.message_text });
    if (assistant) expectedTurns.push({ id: assistant.visible_turn_id, text: assistant.message_text });
  }
  const serialized = testCase.input.visible_dialogue_history.map((turn) => ({
    id: turn.visible_turn_id,
    text: turn.message_text
  }));
  const expectedIds = expectedTurns.map((turn) => turn.id);
  const serializedIds = serialized.map((turn) => turn.id);
  const counts = new Map<string, number>();
  for (const id of serializedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return {
    case_id: testCase.case_id,
    student_turn_count: testCase.student_turn_count,
    expected_visible_turn_ids: expectedIds,
    serialized_visible_turn_ids: serializedIds,
    missing_visible_turn_ids: expectedIds.filter((id) => !serializedIds.includes(id)),
    duplicated_visible_turn_ids: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
    order_matches: JSON.stringify(expectedIds) === JSON.stringify(serializedIds),
    exact_content_matches: JSON.stringify(expectedTurns) === JSON.stringify(serialized),
    latest_student_message_separate:
      !serializedIds.includes(testCase.input.latest_student_turn_id) &&
      Boolean(testCase.input.latest_student_message.trim()),
    initial_activity_present:
      testCase.input.activity_contract.safe_activity_prompt === testCase.initial_activity_text,
    invisible_history_excluded:
      !serializedIds.some((id) => id.includes("hidden_draft")) &&
      !serialized.some((turn) => turn.text.includes("invisible draft")),
    context_sections_used: [
      "activity_contract.safe_activity_prompt",
      "visible_dialogue_history",
      "latest_student_message",
      "safe_item_context",
      "frozen_growth_target",
      "remaining_issue"
    ]
  };
}

function responseMentionsDistractorAnchor(output: TopicDialogueOutputV1) {
  const text = `${output.tutor_message} ${output.student_safe_summary}`;
  return /\b(reliab|valid|consisten|interpret|item\s*2|option\s*a|coefficient)\w*/iu.test(text);
}

function outputTransitionConsistent(output: TopicDialogueOutputV1) {
  if (output.next_action === "show_progression_choices") {
    return output.next_runtime_state === "SHOW_PROGRESSION_CHOICES";
  }
  if (output.next_action === "show_final_support_options") {
    return output.next_runtime_state === "SHOW_FINAL_SUPPORT_OPTIONS";
  }
  return output.next_runtime_state === "AWAIT_TOPIC_DIALOGUE_RESPONSE";
}

export function deterministicRubric(
  testCase: E2A3TopicDialogueCase,
  output: TopicDialogueOutputV1,
  context: E2A3ContextCoverage
): RubricDimension[] {
  const dimensions: RubricDimension[] = [];
  const add = (
    dimension: string,
    passed: boolean,
    evidence: string,
    severity: "critical" | "major" | "minor" = "major"
  ) => dimensions.push({
    dimension,
    status: passed ? "passed" : "failed",
    score: passed ? 2 : 0,
    severity: passed ? "none" : severity,
    evidence
  });
  add(
    "visible_history_continuity",
    context.missing_visible_turn_ids.length === 0 &&
      context.duplicated_visible_turn_ids.length === 0 &&
      context.order_matches &&
      context.exact_content_matches &&
      context.latest_student_message_separate &&
      context.initial_activity_present &&
      context.invisible_history_excluded,
    "Exact context-coverage record for serialized V3 input.",
    "critical"
  );
  add(
    "direct_response_function",
    testCase.expectation.expected_response_functions.includes(output.response_function),
    `response_function=${output.response_function}`
  );
  if (testCase.expectation.require_distractor_anchor) {
    add(
      "distractor_anchor_continuity",
      responseMentionsDistractorAnchor(output),
      "Tutor message or safe summary references the reliability-validity distractor anchor."
    );
  }
  if (testCase.expectation.prior_strategy_functions.length >= 2) {
    const lastStrategy = testCase.expectation.prior_strategy_functions.at(-1);
    add(
      "strategy_adaptation_after_failed_explanation",
      new Set(testCase.expectation.prior_strategy_functions).size >= 2 &&
        output.response_function !== lastStrategy,
      `prior=${testCase.expectation.prior_strategy_functions.join("->")}; current=${output.response_function}`
    );
  }
  if (testCase.expectation.forbid_progression) {
    add(
      "no_premature_progression",
      output.next_action === "await_topic_dialogue_response" &&
        output.evidence_sufficiency !== "sufficient_to_advance",
      `next_action=${output.next_action}; evidence_sufficiency=${output.evidence_sufficiency}`,
      "critical"
    );
  }
  if (testCase.expectation.unsupported_understanding) {
    add(
      "unsupported_understanding_not_resolved",
      output.response_function !== "readiness_confirmation" &&
        output.progression_readiness !== "ready" &&
        output.next_action === "await_topic_dialogue_response",
      "Unsupported understanding claim must elicit anchor-specific evidence.",
      "critical"
    );
  }
  if (testCase.expectation.recurrence) {
    add(
      "recurrence_acknowledged_without_resolution",
      output.progression_readiness !== "ready" &&
        output.evidence_sufficiency !== "sufficient_to_advance",
      "Contradictory later evidence keeps formative work active.",
      "critical"
    );
  }
  if (testCase.expectation.revision_transfer_boundary) {
    add(
      "revision_transfer_boundary_preserved",
      output.next_action === "await_topic_dialogue_response",
      "Revision or failed transfer does not become transfer-ready mastery.",
      "critical"
    );
  }
  add(
    "state_transition_consistency",
    outputTransitionConsistent(output),
    `next_action=${output.next_action}; next_runtime_state=${output.next_runtime_state}`,
    "critical"
  );
  dimensions.push(
    {
      dimension: "targets_active_misconception_or_partial_understanding",
      status: "manual_review_required",
      score: null,
      severity: "manual",
      evidence: "Review tutor_message against frozen growth target and latest student message."
    },
    {
      dimension: "student_facing_naturalness",
      status: "manual_review_required",
      score: null,
      severity: "manual",
      evidence: "Human judgment is required; no LLM judge is used."
    }
  );
  return dimensions;
}

function resultUsage(result: StructuredAgentResult<TopicDialogueOutputV1>) {
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

function aggregateUsage(results: E2A3CaseResult[]) {
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
  budget: E2A3Budget;
  completed: E2A3CaseResult[];
  currentCaseAttempts: number;
  testCase: E2A3TopicDialogueCase;
  modelConfig: AgentModelConfig;
}) {
  const usage = aggregateUsage(input.completed);
  const inputReserve = requestInputEstimate(input.testCase);
  const outputReserve = input.modelConfig.max_output_tokens ?? 3500;
  if (usage.generation_provider_calls + input.currentCaseAttempts + 1 > input.budget.maximum_generation_provider_calls) {
    throw new Error("e2a3_generation_call_budget_exceeded");
  }
  if (usage.input_tokens + inputReserve > input.budget.maximum_input_tokens) {
    throw new Error("e2a3_input_token_budget_insufficient");
  }
  if (usage.output_tokens + outputReserve > input.budget.maximum_output_tokens) {
    throw new Error("e2a3_output_token_budget_insufficient");
  }
  if (
    usage.complete_pricing_available &&
    usage.estimated_cost_usd !== null &&
    usage.estimated_cost_usd >= input.budget.maximum_estimated_cost_usd
  ) {
    throw new Error("e2a3_cost_budget_exceeded");
  }
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
    throw new Error("e2a3_artifact_secret_scan_failed");
  }
}

function runId() {
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "").slice(0, 14);
  return `e2a3_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function requiredArtifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "evaluation-manifest.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    protocol: path.join(runDir, "evaluation-protocol.json"),
    providerCases: path.join(runDir, "provider-cases.jsonl"),
    providerOutputs: path.join(runDir, "provider-outputs.jsonl"),
    contextCoverage: path.join(runDir, "context-coverage.jsonl"),
    schemaValidation: path.join(runDir, "schema-validation.jsonl"),
    privacyResults: path.join(runDir, "privacy-results.jsonl"),
    deterministicRubric: path.join(runDir, "deterministic-rubric.jsonl"),
    humanReviewPacket: path.join(runDir, "human-review-packet.json"),
    providerUsage: path.join(runDir, "provider-usage.json"),
    summary: path.join(runDir, "evaluation-summary.json"),
    approvalDraft: path.join(runDir, "approval-evidence-draft.json"),
    protectedBefore: path.join(runDir, "protected-artifacts-before.json"),
    protectedAfter: path.join(runDir, "protected-artifacts-after.json")
  };
}

function makeCaseResult(input: {
  testCase: E2A3TopicDialogueCase;
  result: StructuredAgentResult<TopicDialogueOutputV1>;
  attempts: number;
  networkDispatchCount: number;
  context: E2A3ContextCoverage;
}): E2A3CaseResult {
  const output = input.result.parsed_output ?? null;
  const transportError = input.result.transport_telemetry?.normalized_error;
  const providerError = input.result.error
    ? {
        category: input.result.error.category,
        message: input.result.error.message,
        retryable: input.result.error.retryable,
        typed_failure_reason: transportError?.typed_failure_reason ?? null,
        http_status: transportError?.http_status ?? null,
        fetch_invoked: input.result.transport_telemetry?.fetch_invoked ?? false,
        response_headers_received: input.result.transport_telemetry?.response_headers_received ?? false
      }
    : null;
  const validation = output
    ? validateTopicDialogueOutput(output)
    : {
        valid: false as const,
        issues: [{
          field_path: "output",
          rule_code: providerError?.category ?? "schema_invalid"
        }]
      };
  const privacyFindings = output
    ? [
        ...findVisibleTextPrivacyFindings(output.tutor_message, "tutor_message"),
        ...findVisibleTextPrivacyFindings(output.student_safe_summary, "student_safe_summary")
      ]
    : [];
  const rubric = output ? deterministicRubric(input.testCase, output, input.context) : [];
  const contextFailed = !input.context.order_matches ||
    !input.context.exact_content_matches ||
    input.context.missing_visible_turn_ids.length > 0 ||
    input.context.duplicated_visible_turn_ids.length > 0 ||
    !input.context.latest_student_message_separate ||
    !input.context.initial_activity_present ||
    !input.context.invisible_history_excluded;
  const critical = [
    ...(contextFailed ? ["context_coverage_failed"] : []),
    ...rubric.filter((entry) => entry.status === "failed" && entry.severity === "critical")
      .map((entry) => entry.dimension),
    ...validation.issues.filter((entry) => entry.rule_code === "answer_key_leak" || entry.rule_code === "hidden_content_leak")
      .map((entry) => entry.rule_code),
    ...privacyFindings.map((entry) => entry.matched_label)
  ];
  const major = [
    ...rubric.filter((entry) => entry.status === "failed" && entry.severity === "major")
      .map((entry) => entry.dimension),
    ...validation.issues.filter((entry) => entry.rule_code !== "answer_key_leak" && entry.rule_code !== "hidden_content_leak")
      .map((entry) => entry.rule_code)
  ];
  const completed = input.result.status === "completed" && output !== null;
  return {
    case_id: input.testCase.case_id,
    category: input.testCase.category,
    repetition_index: input.testCase.repetition_index,
    student_turn_count: input.testCase.student_turn_count,
    tenth_turn: input.testCase.expectation.tenth_turn,
    status: completed && validation.valid && critical.length === 0 && major.length === 0
      ? "passed_automated"
      : completed
        ? "failed"
        : "provider_failed",
    attempts: input.attempts,
    retries: Math.max(0, input.attempts - 1),
    network_dispatch_count: input.networkDispatchCount,
    provider_request_status: input.result.status,
    provider_request_id:
      input.result.provider_request_id ??
      input.result.transport_telemetry?.provider_request_id ??
      null,
    provider_response_id:
      input.result.provider_response_id ??
      input.result.transport_telemetry?.provider_response_id ??
      null,
    provider_error: providerError,
    parsed_output: output,
    schema_valid: validation.valid,
    validator_issues: validation.issues,
    privacy_findings: privacyFindings,
    context_coverage: input.context,
    deterministic_rubric: rubric,
    critical_findings: [...new Set(critical)],
    major_findings: [...new Set(major)],
    usage: resultUsage(input.result),
    latency_ms: input.result.latency_ms,
    human_review_required: true
  };
}

function skippedBudgetResult(
  testCase: E2A3TopicDialogueCase,
  context: E2A3ContextCoverage,
  reason: string
): E2A3CaseResult {
  return {
    case_id: testCase.case_id,
    category: testCase.category,
    repetition_index: testCase.repetition_index,
    student_turn_count: testCase.student_turn_count,
    tenth_turn: testCase.expectation.tenth_turn,
    status: "skipped_budget",
    attempts: 0,
    retries: 0,
    network_dispatch_count: 0,
    provider_request_status: "not_dispatched",
    provider_request_id: null,
    provider_response_id: null,
    provider_error: null,
    parsed_output: null,
    schema_valid: false,
    validator_issues: [{ field_path: "request", rule_code: reason }],
    privacy_findings: [],
    context_coverage: context,
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

function writeIncrementalArtifacts(
  paths: ReturnType<typeof requiredArtifactPaths>,
  testCase: E2A3TopicDialogueCase,
  result: E2A3CaseResult
) {
  const providerCase = {
    case_id: testCase.case_id,
    category: testCase.category,
    repetition_index: testCase.repetition_index,
    student_turn_count: testCase.student_turn_count,
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
    provider_request_status: result.provider_request_status,
    provider_request_id: result.provider_request_id,
    provider_response_id: result.provider_response_id,
    provider_error: result.provider_error,
    network_dispatch_count: result.network_dispatch_count,
    parsed_validated_output: result.parsed_output,
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
    provider_status: result.provider_request_status,
    schema_valid: result.schema_valid,
    issues: result.validator_issues,
    provider_error: result.provider_error,
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

function reviewPacket(results: E2A3CaseResult[]) {
  return {
    packet_version: "e2a3-topic-dialogue-human-review-packet-v1",
    review_status: "pending_human_review",
    reviewer_type_required: "human",
    llm_judge_used: false,
    required_case_policy: "every_tenth_turn_case_and_every_flagged_case",
    included_case_policy: "all_provider_cases_included_for_transparency",
    required_dimensions: [
      "directly responds to latest student message",
      "maintains visible-history continuity",
      "remains distractor-focused",
      "targets the active misconception or partial understanding",
      "changes strategy after failed explanation",
      "avoids generic tutoring",
      "does not expose answer key or internal metadata",
      "does not prematurely resolve misconception",
      "requests substantive evidence when required",
      "preserves revision and transfer distinctions",
      "student-facing language is natural and understandable"
    ],
    cases: results.map((result) => ({
      case_id: result.case_id,
      category: result.category,
      repetition_index: result.repetition_index,
      student_turn_count: result.student_turn_count,
      tenth_turn: result.tenth_turn,
      automated_status: result.status,
      tutor_message: result.parsed_output?.tutor_message ?? null,
      response_function: result.parsed_output?.response_function ?? null,
      evidence_sufficiency: result.parsed_output?.evidence_sufficiency ?? null,
      next_action: result.parsed_output?.next_action ?? null,
      context_coverage: result.context_coverage,
      automated_findings: [...result.critical_findings, ...result.major_findings],
      human_scores: Object.fromEntries([
        "direct_response",
        "visible_history_continuity",
        "distractor_focus",
        "misconception_targeting",
        "strategy_adaptation",
        "generic_tutoring_avoidance",
        "privacy_and_answer_key_safety",
        "non_resolution",
        "substantive_evidence_request",
        "revision_transfer_boundary",
        "natural_language_quality"
      ].map((dimension) => [dimension, null])),
      human_decision: null,
      human_notes: null
    }))
  };
}

function summarizeEvaluation(input: {
  results: E2A3CaseResult[];
  preflight: ReturnType<typeof inspectE2A3CandidatePreflight>;
  before: ReturnType<typeof protectedArtifactSnapshot>;
  after: ReturnType<typeof protectedArtifactSnapshot>;
  budget: E2A3Budget;
}) {
  const usage = aggregateUsage(input.results);
  const automatedFailures = input.results.filter((entry) => entry.status !== "passed_automated");
  const tenthTurnFailures = input.results.filter((entry) =>
    entry.tenth_turn && (
      entry.context_coverage.missing_visible_turn_ids.length > 0 ||
      entry.context_coverage.duplicated_visible_turn_ids.length > 0 ||
      !entry.context_coverage.order_matches ||
      !entry.context_coverage.exact_content_matches ||
      !entry.context_coverage.latest_student_message_separate ||
      !entry.context_coverage.initial_activity_present ||
      !entry.context_coverage.invisible_history_excluded
    )
  );
  const protectedUnchanged = input.before.aggregate_sha256 === input.after.aggregate_sha256;
  const critical = input.results.flatMap((entry) => entry.critical_findings.map((finding) => ({
    case_id: entry.case_id,
    finding
  })));
  const major = input.results.flatMap((entry) => entry.major_findings.map((finding) => ({
    case_id: entry.case_id,
    finding
  })));
  const automatedPass = automatedFailures.length === 0 &&
    tenthTurnFailures.length === 0 &&
    critical.length === 0 &&
    major.length === 0 &&
    protectedUnchanged &&
    usage.generation_provider_calls <= input.budget.maximum_generation_provider_calls &&
    usage.input_tokens <= input.budget.maximum_input_tokens &&
    usage.output_tokens <= input.budget.maximum_output_tokens &&
    (
      !usage.complete_pricing_available ||
      (usage.estimated_cost_usd ?? Number.POSITIVE_INFINITY) <= input.budget.maximum_estimated_cost_usd
    );
  return {
    summary_version: "e2a3-topic-dialogue-evaluation-summary-v1",
    final_evaluation_status: automatedPass
      ? "candidate_evaluation_incomplete"
      : "candidate_evaluation_failed",
    automated_evaluation_passed: automatedPass,
    human_review_status: "pending",
    approval_evidence_ready: false,
    approval_blockers: automatedPass
      ? [
          "human_review_pending",
          "role_scoped_evidence_inheritance_not_supported_by_current_approval_cli"
        ]
      : ["automated_candidate_evaluation_failed", "human_review_pending"],
    candidate_hash: input.preflight.candidate_hash,
    candidate_file_sha256: input.preflight.candidate_file_sha256,
    approved_v2_hash: input.preflight.approved_v2_hash,
    exact_delta_paths: input.preflight.exact_delta_paths,
    inherited_evidence: input.preflight.active_evidence_inheritance,
    case_counts: {
      planned: e2a3TopicDialogueCases().length,
      completed: input.results.filter((entry) => entry.attempts > 0).length,
      passed_automated: input.results.filter((entry) => entry.status === "passed_automated").length,
      failed: automatedFailures.length,
      skipped: input.results.filter((entry) => entry.status === "skipped_budget").length,
      tenth_turn: input.results.filter((entry) => entry.tenth_turn).length,
      baseline_or_boundary: input.results.filter((entry) => !entry.tenth_turn).length
    },
    context_coverage: {
      tenth_turn_passed: input.results.filter((entry) => entry.tenth_turn).length - tenthTurnFailures.length,
      tenth_turn_failed: tenthTurnFailures.length
    },
    schema_validation_failure_count: input.results.filter((entry) => !entry.schema_valid).length,
    privacy_finding_count: input.results.reduce((sum, entry) => sum + entry.privacy_findings.length, 0),
    answer_key_finding_count: input.results.reduce(
      (sum, entry) => sum + entry.validator_issues.filter((issue) => issue.rule_code === "answer_key_leak").length,
      0
    ),
    critical_findings: critical,
    major_findings: major,
    provider_usage: {
      ...usage,
      average_latency_ms: input.results.length > 0
        ? Math.round(usage.latency_ms / input.results.length)
        : 0,
      cost_status: usage.complete_pricing_available ? "available" : "unavailable"
    },
    budget: input.budget,
    protected_artifacts_unchanged: protectedUnchanged,
    protected_artifacts_before_sha256: input.before.aggregate_sha256,
    protected_artifacts_after_sha256: input.after.aggregate_sha256,
    candidate_approved: false,
    candidate_activated: false,
    e2a_canary_executed: false,
    full_36_session_matrix_executed: false
  };
}

function approvalDraft(input: {
  summary: ReturnType<typeof summarizeEvaluation>;
  preflight: ReturnType<typeof inspectE2A3CandidatePreflight>;
  protocolHash: string;
  runPublicId: string;
}) {
  return {
    draft_version: "e2a3-approval-evidence-draft-v1",
    record_type: "draft_for_human_review_only",
    final_approval_evidence: false,
    approval_state: "not_approved",
    activation_state: "not_activated",
    activation_permitted: false,
    candidate_hash: input.preflight.candidate_hash,
    candidate_file_sha256: input.preflight.candidate_file_sha256,
    baseline_approved_runtime_hash: E2A3_APPROVED_V2_HASH,
    evaluation_protocol_hash: input.protocolHash,
    evaluation_run_public_id: input.runPublicId,
    evaluation_status: input.summary.final_evaluation_status,
    automated_evaluation_passed: input.summary.automated_evaluation_passed,
    human_review_required: true,
    human_review_completed: false,
    evidence_inheritance: input.preflight.active_evidence_inheritance,
    evidence_scope: {
      inherited_roles: input.preflight.role_inventory.filter((role) => role !== "topic_dialogue_agent"),
      newly_evaluated_roles: ["topic_dialogue_agent"],
      full_candidate_approval_asserted: false
    },
    blockers: input.summary.approval_blockers,
    next_step:
      "A human reviewer must adjudicate every tenth-turn and flagged output. A later approval-architecture phase must explicitly support and validate inherited role evidence before approval."
  };
}

export async function executeE2A3TopicDialogueEvaluation(input: {
  provider?: LlmProvider;
  artifactRoot?: string;
  live: boolean;
  skipProtectedSnapshotForTest?: boolean;
}) {
  const preflight = inspectE2A3CandidatePreflight({
    requireCleanTree: input.live,
    requireLiveEnvironment: input.live,
    scanExistingEvidence: input.live
  });
  if (!preflight.passed) {
    throw new Error(`e2a3_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const buildInfo = resolveApplicationBuildInfo({
    artifactPath: path.join(E2A3_ARTIFACT_ROOT, "nonexistent-build-info.json")
  });
  if (!buildInfo.ok) throw new Error(buildInfo.code);
  const budget = resolveE2A3Budget();
  const allCases = e2a3TopicDialogueCases();
  const cases = allCases.slice(0, budget.maximum_generation_cases);
  if (cases.length < 24 && input.live) throw new Error("e2a3_case_budget_below_minimum_protocol");
  const baseline = readJson<BaselineManifest>(BASELINE_MANIFEST_PATH);
  const modelConfig = baseline.roles.topic_dialogue_agent;
  if (!modelConfig) throw new Error("e2a3_topic_dialogue_model_config_missing");
  const provider = input.provider ?? new OpenAIResponsesProvider();
  const runPublicId = runId();
  const artifactRoot = input.artifactRoot ?? E2A3_ARTIFACT_ROOT;
  const runDir = path.join(artifactRoot, runPublicId);
  const paths = requiredArtifactPaths(runDir);
  mkdirSync(runDir, { recursive: true });
  const before = input.skipProtectedSnapshotForTest
    ? {
        snapshot_version: E2A3_PROTECTED_SNAPSHOT_VERSION,
        tracked_groups: {},
        environment_metadata: {},
        aggregate_sha256: "test-protected-snapshot"
      } as ReturnType<typeof protectedArtifactSnapshot>
    : protectedArtifactSnapshot();
  writeJson(paths.protectedBefore, before);
  const protocol = e2a3EvaluationProtocolSnapshot();
  const protocolHash = e2a3EvaluationProtocolHash();
  writeJson(paths.protocol, { ...protocol, evaluation_protocol_hash: protocolHash });
  writeJson(paths.candidateDelta, {
    candidate_hash: preflight.candidate_hash,
    candidate_file_sha256: preflight.candidate_file_sha256,
    approved_v2_hash: preflight.approved_v2_hash,
    exact_delta_paths: preflight.exact_delta_paths,
    exact_delta: preflight.exact_delta,
    role_count: preflight.role_count,
    role_inventory: preflight.role_inventory,
    evidence_inheritance: preflight.active_evidence_inheritance
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
    manifest_version: "e2a3-topic-dialogue-candidate-evaluation-manifest-v1",
    run_public_id: runPublicId,
    evaluation_status: "running",
    candidate_hash: preflight.candidate_hash,
    candidate_file_sha256: preflight.candidate_file_sha256,
    approved_v2_hash: preflight.approved_v2_hash,
    application_git_commit: buildInfo.info.application_git_commit,
    application_git_commit_source: buildInfo.info.application_git_commit_source,
    application_build_timestamp: buildInfo.info.application_build_timestamp,
    evaluation_protocol_hash: protocolHash,
    provider: input.live ? "openai" : "injected_no_live_provider",
    model: modelConfig.model_name,
    reasoning_effort: modelConfig.reasoning_effort,
    max_output_tokens: modelConfig.max_output_tokens,
    adapter_version: input.live ? OPENAI_RESPONSES_ADAPTER_VERSION : "injected-test-provider",
    prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
    prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
    input_schema_version: "topic-dialogue-input-v3",
    output_schema_version: "topic-dialogue-output-v2",
    validator_version: "eval-topic-boundary-v2",
    fallback_version: "topic-dialogue-deterministic-fallback-v1",
    raw_provider_output_persisted: false,
    hidden_prompts_persisted: false,
    chain_of_thought_persisted: false,
    candidate_approved: false,
    candidate_activated: false,
    e2a_canary_executed: false,
    full_36_session_matrix_executed: false,
    budget,
    started_at: new Date().toISOString()
  };
  writeJson(paths.manifest, manifestBase);

  const results: E2A3CaseResult[] = [];
  for (const testCase of cases) {
    const context = buildContextCoverage(testCase);
    let attempts = 0;
    let networkDispatchCount = 0;
    let finalResult: StructuredAgentResult<TopicDialogueOutputV1> | null = null;
    try {
      for (let retry = 0; retry <= budget.maximum_retries_per_generation; retry += 1) {
        assertBudgetBeforeCall({
          budget,
          completed: results,
          currentCaseAttempts: attempts,
          testCase,
          modelConfig
        });
        attempts += 1;
        finalResult = await provider.executeStructured({
          agent_name: "topic_dialogue_agent",
          model_config: modelConfig,
          instructions: TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
          input: testCase.input,
          output_schema: TopicDialogueOutputV1Schema,
          schema_name: "topic_dialogue_output_v2",
          client_request_id: `${runPublicId}_${testCase.case_id}_${attempts}`,
          timeout_ms: baseline.runtime_policy.provider_timeout_ms,
          metadata: {
            evaluation: "e2a3_topic_dialogue_candidate",
            case_id: testCase.case_id,
            candidate_hash_prefix: E2A3_CANDIDATE_HASH.slice(0, 12)
          }
        });
        if (finalResult.transport_telemetry?.fetch_invoked) networkDispatchCount += 1;
        const validation = finalResult.parsed_output
          ? validateTopicDialogueOutput(finalResult.parsed_output)
          : { valid: false };
        if (finalResult.status === "completed" && validation.valid) break;
        if (finalResult.status === "failed" && finalResult.error?.retryable !== true) break;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "e2a3_budget_or_dispatch_block";
      const skipped = skippedBudgetResult(testCase, context, reason);
      results.push(skipped);
      writeIncrementalArtifacts(paths, testCase, skipped);
      continue;
    }
    if (!finalResult) throw new Error("e2a3_provider_result_missing");
    const caseResult = makeCaseResult({
      testCase,
      result: finalResult,
      attempts,
      networkDispatchCount,
      context
    });
    results.push(caseResult);
    writeIncrementalArtifacts(paths, testCase, caseResult);
    writeJson(paths.manifest, {
      ...manifestBase,
      evaluation_status: "running",
      completed_case_count: results.length,
      provider_usage: aggregateUsage(results)
    });
  }

  const after = input.skipProtectedSnapshotForTest
    ? before
    : protectedArtifactSnapshot();
  writeJson(paths.protectedAfter, after);
  const summary = summarizeEvaluation({ results, preflight, before, after, budget });
  const packet = reviewPacket(results);
  const draft = approvalDraft({ summary, preflight, protocolHash, runPublicId });
  const usage = summary.provider_usage;
  artifactSecretScan([summary, packet, draft, usage]);
  writeJson(paths.providerUsage, usage);
  writeJson(paths.humanReviewPacket, packet);
  writeJson(paths.summary, summary);
  writeJson(paths.approvalDraft, draft);
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
  writeJson(path.join(artifactRoot, "latest-run.json"), {
    run_public_id: runPublicId,
    run_directory: relative(runDir),
    evaluation_status: summary.final_evaluation_status,
    updated_at: new Date().toISOString()
  });
  return { runPublicId, runDir, paths, manifest: finalManifest, summary, results };
}

export async function executeLiveE2A3TopicDialogueEvaluation() {
  const credential = resolveOpenAICredentialFromEnv(process.env);
  if (!credential.ok) throw new Error(credential.code);
  return withResolvedOpenAICredential(
    credential.credential,
    () => executeE2A3TopicDialogueEvaluation({ live: true })
  );
}

export function loadLatestE2A3Evaluation(artifactRoot = E2A3_ARTIFACT_ROOT) {
  const latestPath = path.join(artifactRoot, "latest-run.json");
  if (!existsSync(latestPath)) throw new Error("e2a3_latest_run_missing");
  const latest = readJson<{ run_public_id: string; run_directory: string }>(latestPath);
  const runDir = path.isAbsolute(latest.run_directory)
    ? latest.run_directory
    : path.join(process.cwd(), latest.run_directory);
  return {
    latest,
    manifest: readJson(path.join(runDir, "evaluation-manifest.json")),
    summary: readJson(path.join(runDir, "evaluation-summary.json")),
    review_packet: readJson(path.join(runDir, "human-review-packet.json")),
    approval_evidence_draft: readJson(path.join(runDir, "approval-evidence-draft.json"))
  };
}

export function temporaryE2A3ArtifactRoot() {
  return path.join(os.tmpdir(), `e2a3-topic-dialogue-${randomBytes(5).toString("hex")}`);
}
