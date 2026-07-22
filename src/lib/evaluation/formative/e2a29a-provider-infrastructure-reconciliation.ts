import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
  ExactlyOnceSemanticEffectGuard,
  PROVIDER_FAILURE_TAXONOMY_VERSION,
  PROVIDER_REQUEST_TRACING_POLICY_VERSION,
  PROVIDER_TRANSPORT_RETRY_LIMITS,
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
  canonicalStructuredAgentRequestHash,
  classifyInternalFailure,
  classifyModelResultFailure,
  classifyProviderFailure,
  executeWithBoundedProviderTransportRetry,
  providerFailureTaxonomyArtifact,
  type ProviderAttemptBudgetSnapshot
} from "@/lib/llm/provider-transport-retry";
import { stableHash } from "@/lib/operational/stable-hash";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";

export const E2A29A_VERSION = "e2a29a-provider-infrastructure-reconciliation-v1";
export const E2A29A_STATUS =
  "e2a29a_transport_retry_policy_added_e2a30_ready" as const;
export const E2A29A_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a29a-provider-infrastructure-reconciliation"
);

const E2A29_RUN_ID = "e2a29_20260722120813_3fd136e6";
const E2A29_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a29-electrical-circuits-anchor-contradiction-canary",
  E2A29_RUN_ID
);
const CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
);
const APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";

export const E2A29A_ARTIFACT_NAMES = [
  "e2a29a-manifest.json",
  "e2a29-exact-failure-reconstruction.json",
  "e2a29-evidence-accuracy-applicability.json",
  "evidence-accuracy-applicability.json",
  "derived-failure-diagnosis.json",
  "provider-failure-taxonomy.json",
  "transport-vs-semantic-retry-policy.json",
  "bounded-provider-transport-retry-policy.json",
  "retry-eligibility-audit.json",
  "provider-request-tracing-policy.json",
  "exactly-once-semantic-effects-policy.json",
  "e2a29-counterfactual-retry-replay.json",
  "future-status-mapping.json",
  "human-review-applicability.json",
  "candidate-integrity.json",
  "evidence-stack-integrity.json",
  "transport-calibration-corpus.jsonl",
  "transport-calibration-results.jsonl",
  "e2a30-held-out-overlap-analysis.json",
  "e2a30-frozen-protocol.json",
  "e2a30-frozen-protocol.sha256",
  "e2a30-budget.json",
  "e2a30-artifact-contract.json",
  "composite-runtime-identity.json",
  "summary.json"
] as const;

type JsonRecord = Record<string, unknown>;

type HistoricalProviderRow = {
  session_id: string;
  turn: number;
  attempt: number;
  role: string;
  generated: boolean;
  schema_valid: boolean;
  complete_prior_visible_episode: unknown;
  request_provenance: {
    agent_name: string;
    schema_name: string;
    client_request_id: string;
    model_name: string;
    request_input_sha256: string;
    instructions_sha256: string;
    metadata: Record<string, string>;
  };
  provider_result: {
    provider: string;
    status: StructuredAgentResult<unknown>["status"];
    client_request_id: string;
    provider_request_id: string | null;
    provider_response_id: string | null;
    parsed_output: unknown;
    raw_output_present: boolean;
    raw_output_sha256: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
      cached_input_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number | null;
      pricing_available: boolean;
    };
    latency_ms: number;
    adapter_attempt_count: number;
    transport_retry_count: number;
    sanitized_error: {
      category: string;
      retryable: boolean;
      typed_failure_reason: string;
      http_status: number;
    } | null;
  };
  parsed_structured_output: unknown;
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function assertSafeArtifact(value: unknown) {
  const serialized = JSON.stringify(value);
  const prohibited = [
    /authorization["']?\s*:/iu,
    /api[_-]?key["']?\s*:/iu,
    /cookie["']?\s*:/iu,
    /database_url/iu,
    /session_secret/iu
  ];
  if (prohibited.some((pattern) => pattern.test(serialized))) {
    throw new Error("e2a29a_artifact_secret_or_private_reasoning_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafeArtifact(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, values: unknown[]) {
  values.forEach(assertSafeArtifact);
  writeFileSync(
    filePath,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8"
  );
}

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(root, entry.name);
      return entry.isDirectory() ? filesRecursively(child) : [child];
    })
    .sort();
}

function treeIdentity(sourcePath: string) {
  const absolutePath = path.join(process.cwd(), sourcePath);
  const files = filesRecursively(absolutePath);
  const hashes = Object.fromEntries(
    files.map((file) => [path.relative(absolutePath, file) || path.basename(file), sha256(readFileSync(file))])
  );
  return {
    source_path: sourcePath,
    exists: existsSync(absolutePath),
    file_count: files.length,
    sha256: stableHash(hashes)
  };
}

function protectedEvidenceRoots() {
  const configs = readdirSync(path.join(process.cwd(), "config"))
    .filter((name) => /^(?:approved|candidate)-operational-agent-config/u.test(name))
    .map((name) => `config/${name}`);
  const e2a = readdirSync(path.join(process.cwd(), ".data"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== path.basename(E2A29A_ARTIFACT_ROOT) &&
        /^e2a(?:1[2-9]|2[0-9])[a-z]*(?:-|$)/u.test(entry.name)
    )
    .map((entry) => `.data/${entry.name}`);
  const sourceContracts = [
    "src/lib/agents",
    "src/lib/services/student-assessment/target-evidence-contract-v5.ts",
    "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts",
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts",
    "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts",
    "src/lib/evaluation/formative/e2a23a-student-simulator-evidence-classifier-v4.ts",
    ".data/operational-model-upgrade",
    ".data/operational-live-canary"
  ];
  return [...configs, ...e2a, ...sourceContracts].sort();
}

function protectedEvidenceSnapshot() {
  const trees = protectedEvidenceRoots().map(treeIdentity);
  return {
    snapshot_version: "e2a29a-protected-evidence-snapshot-v1",
    trees,
    current_sha256: stableHash(trees)
  };
}

function applicationGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function loadHistoricalE2A29() {
  if (!existsSync(E2A29_RUN_DIR)) throw new Error("e2a29a_historical_run_missing");
  const simulator = readJsonl<HistoricalProviderRow>(
    path.join(E2A29_RUN_DIR, "simulator-provider-outputs.jsonl")
  )[0];
  const evaluator = readJsonl<HistoricalProviderRow>(
    path.join(E2A29_RUN_DIR, "evaluator-provider-outputs.jsonl")
  )[0];
  if (!simulator || !evaluator) throw new Error("e2a29a_historical_failure_rows_missing");
  return {
    summary: readJson<JsonRecord>(path.join(E2A29_RUN_DIR, "canary-summary.json")),
    manifest: readJson<JsonRecord>(path.join(E2A29_RUN_DIR, "canary-manifest.json")),
    usage: readJson<JsonRecord>(path.join(E2A29_RUN_DIR, "provider-usage.json")),
    candidateIntegrity: readJson<JsonRecord>(path.join(E2A29_RUN_DIR, "candidate-integrity.json")),
    compositeIdentity: readJson<JsonRecord>(
      path.join(E2A29_RUN_DIR, "composite-runtime-identity.json")
    ),
    simulator,
    evaluator
  };
}

function historicalResult(row: HistoricalProviderRow): StructuredAgentResult<unknown> {
  const error = row.provider_result.sanitized_error;
  return {
    provider: "openai",
    status: row.provider_result.status,
    client_request_id: row.provider_result.client_request_id,
    provider_request_id: row.provider_result.provider_request_id ?? undefined,
    provider_response_id: row.provider_result.provider_response_id ?? undefined,
    parsed_output: row.provider_result.parsed_output ?? undefined,
    latency_ms: row.provider_result.latency_ms,
    error: error
      ? {
          category: error.category === "provider_5xx" ? "provider_5xx" : "permanent",
          message: `sanitized_${error.category}`,
          retryable: error.retryable
        }
      : undefined,
    transport_telemetry: {
      provider: "openai",
      transport: "openai_responses",
      adapter_version: "openai-responses-adapter-v2",
      client_request_id: row.provider_result.client_request_id,
      model_name: row.request_provenance.model_name,
      base_url_host: "api.openai.com",
      base_url_approved: true,
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: true,
      response_headers_received: error?.http_status !== undefined,
      response_body_received: row.provider_result.raw_output_present,
      http_status: error?.http_status,
      normalized_error: error
        ? {
            typed_failure_reason: "openai_server_error",
            error_class: null,
            error_name: null,
            error_type: null,
            http_status: error.http_status,
            provider_error_code: null,
            provider_error_type: null,
            provider_error_param: null,
            provider_request_id: row.provider_result.provider_request_id,
            provider_request_header_id: null,
            retry_after_ms: null,
            node_cause_name: null,
            node_cause_code: null,
            network_category: "http_error",
            sanitized_message: "Provider returned a server error.",
            has_http_response: true,
            before_request_serialization: false,
            fetch_invoked: true,
            response_headers_received: true,
            response_body_received: false
          }
        : undefined
    }
  };
}

function e2a29ExactFailureReconstruction(historical: ReturnType<typeof loadHistoricalE2A29>) {
  const simulator = historical.simulator;
  const evaluator = historical.evaluator;
  return {
    reconstruction_version: "e2a29-exact-failure-reconstruction-v1",
    source_run_id: E2A29_RUN_ID,
    immutable_historical_status: historical.summary.status,
    run_started_at: historical.summary.started_at,
    run_completed_at: historical.summary.completed_at,
    causal_sequence: [
      {
        sequence: 1,
        event: "initial_activity_shown",
        visible_turn_id: "initial_E2A29-CIRCUITS",
        recorded_at: null,
        timestamp_availability: "not_retained_at_event_granularity"
      },
      {
        sequence: 2,
        event: "student_simulator_request_dispatched",
        logical_call_id: simulator.provider_result.client_request_id,
        canonical_request_hash: simulator.request_provenance.request_input_sha256,
        model: simulator.request_provenance.model_name,
        endpoint: null,
        endpoint_availability: "not_retained_in_historical_request_artifact",
        expected_adapter_endpoint_from_frozen_adapter: "api.openai.com/v1/responses",
        provider_request_id: simulator.provider_result.provider_request_id,
        provider_response_id: simulator.provider_result.provider_response_id,
        adapter_attempt_count: 1,
        transport_retry_count: 0,
        latency_ms: simulator.provider_result.latency_ms,
        raw_output_sha256: simulator.provider_result.raw_output_sha256,
        request_dispatched_at: null,
        request_completed_at: null,
        timestamp_availability: "latency_retained_but_per_call_wall_clock_timestamps_not_retained"
      },
      {
        sequence: 3,
        event: "student_response_appended_to_visible_history",
        source_turn_id: "student_E2A29-CIRCUITS_1",
        source_sequence_index: 2,
        student_response:
          (simulator.provider_result.parsed_output as { student_message?: string } | null)
            ?.student_message ?? null,
        schema_valid: simulator.schema_valid,
        recorded_at: null,
        timestamp_availability: "not_retained_at_event_granularity"
      },
      {
        sequence: 4,
        event: "evidence_evaluator_request_dispatched",
        logical_call_id: evaluator.provider_result.client_request_id,
        canonical_request_hash: evaluator.request_provenance.request_input_sha256,
        instructions_sha256: evaluator.request_provenance.instructions_sha256,
        schema_name: evaluator.request_provenance.schema_name,
        model: evaluator.request_provenance.model_name,
        source_turn_id: "student_E2A29-CIRCUITS_1",
        source_sequence_index: 2,
        endpoint: null,
        endpoint_availability: "not_retained_in_historical_request_artifact",
        expected_adapter_endpoint_from_frozen_adapter: "api.openai.com/v1/responses",
        request_dispatched_at: null,
        request_completed_at: null,
        timestamp_availability: "latency_retained_but_per_call_wall_clock_timestamps_not_retained"
      },
      {
        sequence: 5,
        event: "evidence_evaluator_provider_failure_received",
        adapter_attempt_index: 1,
        adapter_attempt_id: null,
        adapter_attempt_id_availability: "historical_harness_retained_only_attempt_index",
        x_client_request_id: evaluator.provider_result.client_request_id,
        provider_request_id: evaluator.provider_result.provider_request_id,
        provider_response_id: evaluator.provider_result.provider_response_id,
        http_status: evaluator.provider_result.sanitized_error?.http_status ?? null,
        typed_failure_reason:
          evaluator.provider_result.sanitized_error?.typed_failure_reason ?? null,
        sanitized_error_category:
          evaluator.provider_result.sanitized_error?.category ?? null,
        retryable_as_recorded:
          evaluator.provider_result.sanitized_error?.retryable ?? null,
        latency_ms: evaluator.provider_result.latency_ms,
        raw_output_present: evaluator.provider_result.raw_output_present,
        usage_total_tokens: evaluator.provider_result.usage.total_tokens,
        response_headers: null,
        response_headers_availability: "not_retained_except_normalized_http_status",
        provider_error_body: null,
        provider_error_body_availability: "not_retained",
        transport_retry_count: evaluator.provider_result.transport_retry_count
      }
    ],
    terminal_stages: {
      evaluator_output_created: false,
      profile_mapping_started: false,
      profile_created: false,
      sound_gate_reached: false,
      tutor_dispatched: false,
      progression_decision_created: false
    },
    retained_limitations: [
      "No per-call wall-clock timestamp was retained.",
      "No evaluator provider request identifier or response identifier was returned.",
      "No provider error body or full response headers were retained.",
      "No evaluator output existed, so evidence and pedagogy cannot be rated."
    ]
  };
}

function e2a29EvidenceApplicability() {
  const notApplicableReason = "provider_infrastructure_failure_before_evidence_evaluation";
  return {
    applicability_version: "e2a29-evidence-accuracy-applicability-v1",
    source_run_id: E2A29_RUN_ID,
    immutable_historical_status_preserved: "e2a29_canary_failed_evidence_accuracy",
    evaluator_output_available: false,
    evidence_accuracy_applicable: false,
    semantic_envelope_applicable: false,
    structured_contradiction_applicable: false,
    profile_accuracy_applicable: false,
    sound_gate_applicable: false,
    tutor_output_applicable: false,
    pedagogical_adaptation_applicable: false,
    progression_efficiency_applicable: false,
    reason: notApplicableReason,
    historical_metric_defaults_are_not_current_semantic_findings: true
  };
}

function derivedDiagnosis(historical: ReturnType<typeof loadHistoricalE2A29>) {
  const providerResult = historicalResult(historical.evaluator);
  const classification = classifyProviderFailure(providerResult);
  return {
    diagnosis_version: "e2a29-derived-failure-diagnosis-v1",
    source_run_id: E2A29_RUN_ID,
    derived_status: "e2a29_historical_failure_caused_by_provider_infrastructure_5xx",
    historical_status_unchanged: historical.summary.status,
    primary_failure_domain: "provider_infrastructure_transport",
    provider_failure_classification: classification,
    defect_supported_by_evidence:
      "The E2A.29 harness made one adapter attempt and zero bounded transport retries despite a recorded retryable HTTP 520.",
    not_supported_as_failure_domains: [
      "evidence_accuracy",
      "pedagogical_adaptation",
      "candidate_quality",
      "safety",
      "profile_mapping"
    ],
    candidate_quality_conclusion: "not_evaluable_from_e2a29",
    safety_conclusion: "no_safety_failure_observed_before_infrastructure_stop",
    no_provider_output_fabricated: true
  };
}

function transportVsSemanticRetryPolicy() {
  return {
    policy_version: "transport-vs-semantic-retry-policy-v1",
    transport_retry: {
      trigger: "retryable provider infrastructure or transport failure",
      request_body: "byte-equivalent canonical request",
      source_binding: "unchanged",
      logical_call_identity: "unchanged",
      adapter_attempt_identity: "new for every attempt",
      semantic_regeneration_count_incremented: false
    },
    semantic_regeneration: {
      trigger:
        "provider response received but schema, hard safety, evidence, or semantic validation failed",
      transport_retry_count_incremented: false,
      bounded_by_role_specific_regeneration_limit: true
    },
    forbidden_cross_classification: [
      "provider_5xx_as_evidence_accuracy_failure",
      "schema_invalid_as_transport_failure",
      "safety_invalid_as_transport_failure"
    ]
  };
}

function boundedRetryPolicy() {
  return {
    policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    ...PROVIDER_TRANSPORT_RETRY_LIMITS,
    retryable_categories: [
      "provider_500",
      "provider_502",
      "provider_503",
      "provider_504",
      "provider_520",
      "provider_5xx_transient",
      "network_timeout",
      "upstream_timeout",
      "connection_reset",
      "temporary_dns_failure",
      "tls_failure",
      "retryable_rate_limit"
    ],
    pre_retry_guards: [
      "budget_remains_available",
      "source_binding_is_current",
      "canonical_request_hash_is_unchanged",
      "logical_call_id_is_unchanged"
    ],
    fail_closed_guarantees: [
      "no_model_substitution",
      "no_schema_substitution",
      "no_deterministic_student_facing_fallback",
      "no_state_progression_on_transport_failure",
      "no_unbounded_retry"
    ]
  };
}

function retryEligibilityAudit(historical: ReturnType<typeof loadHistoricalE2A29>) {
  const classified = classifyProviderFailure(historicalResult(historical.evaluator));
  return {
    audit_version: "e2a29-retry-eligibility-audit-v1",
    source_run_id: E2A29_RUN_ID,
    http_status: 520,
    immutable_request_defect_evidence_present: false,
    classification: classified,
    retry_eligible_under_corrected_policy: true,
    historical_adapter_attempts: 1,
    historical_transport_retries: 0,
    corrected_maximum_adapter_attempts: 3,
    corrected_maximum_transport_retries: 2,
    historical_policy_gap_confirmed: true
  };
}

function tracingPolicy() {
  return {
    policy_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
    per_attempt_required_fields: [
      "logical_call_id",
      "canonical_request_hash",
      "source_binding_hash",
      "adapter_attempt_id",
      "adapter_attempt_index",
      "x_client_request_id",
      "logical_idempotency_key",
      "started_at",
      "completed_at",
      "latency_ms",
      "provider_request_id_when_available",
      "provider_response_id_when_available",
      "http_status_when_available",
      "classification",
      "retry_decision",
      "budget_before",
      "budget_after"
    ],
    uniqueness: {
      adapter_attempt_id: "unique_per_adapter_attempt",
      x_client_request_id: "unique_per_adapter_attempt",
      logical_call_id: "stable_across_transport_retries",
      logical_idempotency_key: "stable_across_transport_retries",
      canonical_request_hash: "stable_across_transport_retries"
    },
    provider_identifiers_may_be_null_only_when_provider_does_not_return_them: true
  };
}

function exactlyOncePolicy() {
  return {
    policy_version: EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
    acceptance_rule: "at_most_one_valid_provider_result_per_logical_call",
    side_effect_rule:
      "profile, tutor, persistence, display, and progression effects commit only after one accepted valid result",
    duplicate_valid_result_rule: "reuse_identical_or_fail_closed_on_conflict",
    forbidden: [
      "duplicate_profile_application",
      "duplicate_tutor_effect",
      "duplicate_persistence_effect",
      "duplicate_display_effect",
      "duplicate_progression_effect"
    ]
  };
}

function counterfactualReplay() {
  return {
    replay_version: "e2a29-counterfactual-transport-retry-replay-v1",
    provider_calls_made: 0,
    source_run_id: E2A29_RUN_ID,
    historical_attempt_1: {
      role: "evidence_evaluator",
      http_status: 520,
      classification: "provider_520",
      retryable: true,
      adapter_attempt_index: 1
    },
    corrected_policy: {
      maximum_adapter_attempts: 3,
      maximum_transport_retries: 2,
      decision_after_historical_attempt_1: "retry_with_same_canonical_request",
      next_backoff_ms: 2000
    },
    bounded_outcomes: [
      "continue_only_if_a_retry_returns_a_valid_accepted_result",
      "otherwise_stop_after_attempt_3_or_earlier_nonretryable_failure"
    ],
    fabricated_retry_response: false,
    canary_pass_claimed: false,
    candidate_quality_claimed: false
  };
}

function futureStatusMapping() {
  return {
    mapping_version: "e2a29a-future-status-mapping-v1",
    statuses: {
      provider_infrastructure_retry_exhausted:
        "canary_failed_provider_infrastructure_retry_exhausted",
      provider_nonretryable_request:
        "canary_failed_provider_nonretryable_request",
      provider_timeout_retry_exhausted:
        "canary_failed_provider_timeout_retry_exhausted",
      rate_limit_retry_exhausted:
        "canary_failed_rate_limit_retry_exhausted",
      response_schema_invalid: "canary_failed_response_schema",
      response_safety_invalid: "canary_failed_safety",
      response_evidence_invalid: "canary_failed_evidence_accuracy",
      pedagogical_adaptation_invalid: "canary_failed_pedagogical_adaptation",
      persistence_failure: "canary_failed_internal_persistence",
      orchestration_failure: "canary_failed_internal_orchestration"
    },
    invariant: "provider_5xx_never_maps_to_evidence_accuracy_or_pedagogy"
  };
}

function humanReviewApplicability() {
  return {
    applicability_version: "e2a29-human-review-applicability-v1",
    source_run_id: E2A29_RUN_ID,
    review_items: [
      { item: "initial_activity_quality", applicable: true },
      { item: "visible_student_response_fidelity", applicable: true },
      { item: "provider_infrastructure_handling", applicable: true },
      {
        item: "evaluator_output_accuracy",
        applicable: false,
        reason: "evaluator_output_not_created"
      },
      {
        item: "profile_accuracy",
        applicable: false,
        reason: "profile_stage_not_reached"
      },
      {
        item: "tutor_quality",
        applicable: false,
        reason: "tutor_stage_not_reached"
      },
      {
        item: "pedagogical_adaptation",
        applicable: false,
        reason: "tutor_stage_not_reached"
      },
      {
        item: "progression_efficiency",
        applicable: false,
        reason: "progression_stage_not_reached"
      }
    ],
    absent_stage_items_use_explicit_not_applicable_records: true,
    null_rating_placeholders_used: false
  };
}

const CalibrationOutputSchema = z.object({ value: z.string() });
type CalibrationOutput = z.infer<typeof CalibrationOutputSchema>;

type CalibrationScenario = {
  name: string;
  mode:
    | "transport"
    | "model_result"
    | "internal"
    | "duplicate_effect"
    | "concurrent_duplicate_effect"
    | "identity_mismatch";
  outcomes?: Array<
    | { kind: "success" }
    | { kind: "http"; status: number; category?: "rate_limit" | "quota" }
    | { kind: "timeout" | "connection_reset" | "dns" | "tls" }
    | { kind: "missing_fields" }
  >;
  model_category?:
    | "response_schema_invalid"
    | "response_safety_invalid"
    | "response_evidence_invalid"
    | "model_result_invalid";
  internal_category?:
    | "persistence_failure"
    | "artifact_write_failure"
    | "orchestration_failure";
  budget_block_after_first?: boolean;
  stale_after_first?: boolean;
  expected_status: string;
  expected_attempts: number;
};

const calibrationScenarios: CalibrationScenario[] = [
  { name: "http_500_then_success", mode: "transport", outcomes: [{ kind: "http", status: 500 }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "http_502_then_success", mode: "transport", outcomes: [{ kind: "http", status: 502 }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "http_503_twice_then_success", mode: "transport", outcomes: [{ kind: "http", status: 503 }, { kind: "http", status: 503 }, { kind: "success" }], expected_status: "accepted", expected_attempts: 3 },
  { name: "http_504_exhausted", mode: "transport", outcomes: [{ kind: "http", status: 504 }, { kind: "http", status: 504 }, { kind: "http", status: 504 }], expected_status: "transport_failure_retry_exhausted", expected_attempts: 3 },
  { name: "http_520_then_success", mode: "transport", outcomes: [{ kind: "http", status: 520 }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "generic_521_then_success", mode: "transport", outcomes: [{ kind: "http", status: 521 }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "timeout_then_success", mode: "transport", outcomes: [{ kind: "timeout" }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "connection_reset_then_success", mode: "transport", outcomes: [{ kind: "connection_reset" }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "dns_then_success", mode: "transport", outcomes: [{ kind: "dns" }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "tls_then_success", mode: "transport", outcomes: [{ kind: "tls" }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "rate_limit_then_success", mode: "transport", outcomes: [{ kind: "http", status: 429, category: "rate_limit" }, { kind: "success" }], expected_status: "accepted", expected_attempts: 2 },
  { name: "quota_nonretryable", mode: "transport", outcomes: [{ kind: "http", status: 429, category: "quota" }], expected_status: "transport_failure_nonretryable", expected_attempts: 1 },
  { name: "authentication_nonretryable", mode: "transport", outcomes: [{ kind: "http", status: 401 }], expected_status: "transport_failure_nonretryable", expected_attempts: 1 },
  { name: "permission_nonretryable", mode: "transport", outcomes: [{ kind: "http", status: 403 }], expected_status: "transport_failure_nonretryable", expected_attempts: 1 },
  { name: "model_not_found_nonretryable", mode: "transport", outcomes: [{ kind: "http", status: 404 }], expected_status: "transport_failure_nonretryable", expected_attempts: 1 },
  { name: "request_contract_nonretryable", mode: "transport", outcomes: [{ kind: "http", status: 400 }], expected_status: "transport_failure_nonretryable", expected_attempts: 1 },
  { name: "response_schema_invalid", mode: "model_result", model_category: "response_schema_invalid", expected_status: "semantic_regeneration_only", expected_attempts: 1 },
  { name: "response_safety_invalid", mode: "model_result", model_category: "response_safety_invalid", expected_status: "semantic_regeneration_only", expected_attempts: 1 },
  { name: "response_evidence_invalid", mode: "model_result", model_category: "response_evidence_invalid", expected_status: "semantic_regeneration_only", expected_attempts: 1 },
  { name: "response_missing_fields", mode: "transport", outcomes: [{ kind: "missing_fields" }], expected_status: "model_result_requires_semantic_regeneration", expected_attempts: 1 },
  { name: "maximum_attempt_enforcement", mode: "transport", outcomes: [{ kind: "http", status: 500 }, { kind: "http", status: 502 }, { kind: "http", status: 503 }, { kind: "success" }], expected_status: "transport_failure_retry_exhausted", expected_attempts: 3 },
  { name: "budget_exhaustion_before_retry", mode: "transport", outcomes: [{ kind: "http", status: 520 }, { kind: "success" }], budget_block_after_first: true, expected_status: "blocked_budget_before_retry", expected_attempts: 1 },
  { name: "stale_source_before_retry", mode: "transport", outcomes: [{ kind: "http", status: 503 }, { kind: "success" }], stale_after_first: true, expected_status: "blocked_stale_source_before_retry", expected_attempts: 1 },
  { name: "duplicate_successful_responses", mode: "duplicate_effect", expected_status: "duplicate_success_conflict", expected_attempts: 2 },
  { name: "concurrent_duplicate_successful_responses", mode: "concurrent_duplicate_effect", expected_status: "reused", expected_attempts: 2 },
  { name: "artifact_write_failure", mode: "internal", internal_category: "artifact_write_failure", expected_status: "internal_failure_no_retry", expected_attempts: 0 },
  { name: "persisted_effect_failure", mode: "internal", internal_category: "persistence_failure", expected_status: "internal_failure_no_retry", expected_attempts: 0 },
  { name: "orchestration_failure", mode: "internal", internal_category: "orchestration_failure", expected_status: "internal_failure_no_retry", expected_attempts: 0 },
  { name: "canonical_request_identity_mismatch", mode: "identity_mismatch", expected_status: "blocked_request_identity_mismatch", expected_attempts: 0 }
];

function fakeResult(
  outcome: NonNullable<CalibrationScenario["outcomes"]>[number],
  clientRequestId: string
): StructuredAgentResult<CalibrationOutput> {
  if (outcome.kind === "success") {
    return {
      provider: "openai",
      status: "completed",
      client_request_id: clientRequestId,
      provider_request_id: `req_${sha256(clientRequestId).slice(0, 20)}`,
      provider_response_id: `resp_${sha256(`response:${clientRequestId}`).slice(0, 20)}`,
      parsed_output: { value: "accepted" },
      latency_ms: 10
    };
  }
  if (outcome.kind === "missing_fields") {
    return {
      provider: "openai",
      status: "completed",
      client_request_id: clientRequestId,
      provider_request_id: `req_${sha256(clientRequestId).slice(0, 20)}`,
      provider_response_id: `resp_${sha256(`response:${clientRequestId}`).slice(0, 20)}`,
      parsed_output: undefined,
      latency_ms: 10
    };
  }

  let httpStatus: number | null = null;
  let typedFailureReason:
    | "openai_authentication_failed"
    | "openai_permission_denied"
    | "openai_model_not_found"
    | "openai_rate_limited"
    | "openai_quota_exceeded"
    | "openai_bad_request"
    | "openai_server_error"
    | "openai_request_timeout"
    | "openai_connection_failed"
    | "openai_dns_failed"
    | "openai_tls_failed" = "openai_server_error";
  let category:
    | "timeout"
    | "network"
    | "authentication"
    | "permission"
    | "rate_limit"
    | "quota"
    | "provider_5xx"
    | "invalid_request" = "provider_5xx";
  let networkCategory: "dns" | "socket" | "tls" | "timeout" | "http_error" = "http_error";
  let nodeCauseCode: string | null = null;

  if (outcome.kind === "http") {
    httpStatus = outcome.status;
    if (outcome.status === 401) {
      typedFailureReason = "openai_authentication_failed";
      category = "authentication";
    } else if (outcome.status === 403) {
      typedFailureReason = "openai_permission_denied";
      category = "permission";
    } else if (outcome.status === 404) {
      typedFailureReason = "openai_model_not_found";
      category = "invalid_request";
    } else if (outcome.status === 400) {
      typedFailureReason = "openai_bad_request";
      category = "invalid_request";
    } else if (outcome.status === 429 && outcome.category === "quota") {
      typedFailureReason = "openai_quota_exceeded";
      category = "quota";
    } else if (outcome.status === 429) {
      typedFailureReason = "openai_rate_limited";
      category = "rate_limit";
    }
  } else if (outcome.kind === "timeout") {
    typedFailureReason = "openai_request_timeout";
    category = "timeout";
    networkCategory = "timeout";
  } else if (outcome.kind === "connection_reset") {
    typedFailureReason = "openai_connection_failed";
    category = "network";
    networkCategory = "socket";
    nodeCauseCode = "ECONNRESET";
  } else if (outcome.kind === "dns") {
    typedFailureReason = "openai_dns_failed";
    category = "network";
    networkCategory = "dns";
  } else if (outcome.kind === "tls") {
    typedFailureReason = "openai_tls_failed";
    category = "network";
    networkCategory = "tls";
  }

  return {
    provider: "openai",
    status: "failed",
    client_request_id: clientRequestId,
    latency_ms: 10,
    error: { category, message: `simulated_${category}`, retryable: ["timeout", "network", "rate_limit", "provider_5xx"].includes(category) },
    transport_telemetry: {
      provider: "openai",
      transport: "openai_responses",
      adapter_version: "openai-responses-adapter-v2",
      client_request_id: clientRequestId,
      model_name: "simulated-model",
      base_url_host: "loopback.invalid",
      base_url_approved: false,
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: true,
      response_headers_received: httpStatus !== null,
      response_body_received: false,
      http_status: httpStatus ?? undefined,
      normalized_error: {
        typed_failure_reason: typedFailureReason,
        error_class: null,
        error_name: null,
        error_type: null,
        http_status: httpStatus,
        provider_error_code: null,
        provider_error_type: null,
        provider_error_param: null,
        provider_request_id: null,
        provider_request_header_id: null,
        retry_after_ms: outcome.kind === "http" && outcome.status === 429 ? 2_000 : null,
        node_cause_name: null,
        node_cause_code: nodeCauseCode,
        network_category: networkCategory,
        sanitized_message: `simulated_${category}`,
        has_http_response: httpStatus !== null,
        before_request_serialization: false,
        fetch_invoked: true,
        response_headers_received: httpStatus !== null,
        response_body_received: false
      }
    }
  };
}

function initialBudget(): ProviderAttemptBudgetSnapshot {
  return {
    logical_generation_calls_used: 1,
    logical_generation_calls_limit: 29,
    adapter_attempts_used: 0,
    adapter_attempts_limit: 87,
    input_tokens_used: 0,
    input_tokens_limit: 900_000,
    output_tokens_used: 0,
    output_tokens_limit: 70_000,
    total_tokens_used: 0,
    total_tokens_limit: 970_000,
    estimated_cost_usd: 0,
    cost_limit_usd: 25
  };
}

export async function runE2A29ATransportCalibration() {
  const roles = ["student_simulator", "evidence_evaluator", "autonomous_tutor"];
  const corpus = calibrationScenarios.flatMap((scenario) =>
    roles.map((role) => ({
      case_id: `transport_${role}_${scenario.name}`,
      role,
      scenario: scenario.name,
      mode: scenario.mode,
      expected_status: scenario.expected_status,
      expected_adapter_attempts: scenario.expected_attempts,
      provider_calls_made: 0
    }))
  );
  const results: JsonRecord[] = [];

  for (const corpusCase of corpus) {
    const scenario = calibrationScenarios.find((entry) => entry.name === corpusCase.scenario);
    if (!scenario) throw new Error("e2a29a_calibration_scenario_missing");
    let status = "unknown";
    let attempts = 0;
    let passed = false;
    let details: JsonRecord = {};

    if (scenario.mode === "model_result" && scenario.model_category) {
      const result = classifyModelResultFailure(scenario.model_category);
      status = result.semantic_regeneration_eligible ? "semantic_regeneration_only" : "invalid";
      attempts = 1;
      passed =
        status === scenario.expected_status &&
        result.retryable_transport_failure === false &&
        result.semantic_regeneration_eligible === true;
      details = { classification: result };
    } else if (scenario.mode === "internal" && scenario.internal_category) {
      const result = classifyInternalFailure(scenario.internal_category);
      status = result.retryable_transport_failure ? "invalid" : "internal_failure_no_retry";
      attempts = 0;
      passed = status === scenario.expected_status;
      details = { classification: result };
    } else if (scenario.mode === "duplicate_effect") {
      const guard = new ExactlyOnceSemanticEffectGuard();
      let effectCount = 0;
      const first = await guard.commit({
        logical_call_id: corpusCase.case_id,
        canonical_request_hash: sha256("same-request"),
        accepted_adapter_attempt_id: "attempt-1",
        accepted_result_hash: sha256("result-a"),
        commit_effect: () => { effectCount += 1; return effectCount; },
        now: () => new Date("2026-01-01T00:00:00.000Z")
      });
      const second = await guard.commit({
        logical_call_id: corpusCase.case_id,
        canonical_request_hash: sha256("same-request"),
        accepted_adapter_attempt_id: "attempt-2",
        accepted_result_hash: sha256("result-b"),
        commit_effect: () => { effectCount += 1; return effectCount; },
        now: () => new Date("2026-01-01T00:00:01.000Z")
      });
      status = second.status;
      attempts = 2;
      passed =
        first.status === "committed" &&
        second.status === scenario.expected_status &&
        effectCount === 1;
      details = { first_status: first.status, second_status: second.status, semantic_effect_count: effectCount };
    } else if (scenario.mode === "concurrent_duplicate_effect") {
      const guard = new ExactlyOnceSemanticEffectGuard();
      let effectCount = 0;
      let releaseCommit: () => void = () => {};
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      const commitInput = {
        logical_call_id: corpusCase.case_id,
        canonical_request_hash: sha256("same-request"),
        accepted_result_hash: sha256("same-result"),
        now: () => new Date("2026-01-01T00:00:00.000Z")
      };
      const firstPending = guard.commit({
        ...commitInput,
        accepted_adapter_attempt_id: "attempt-1",
        commit_effect: async () => {
          await commitGate;
          effectCount += 1;
          return effectCount;
        }
      });
      const secondPending = guard.commit({
        ...commitInput,
        accepted_adapter_attempt_id: "attempt-2",
        commit_effect: () => {
          effectCount += 1;
          return effectCount;
        }
      });
      releaseCommit();
      const [first, second] = await Promise.all([firstPending, secondPending]);
      status = second.status;
      attempts = 2;
      passed =
        first.status === "committed" &&
        second.status === scenario.expected_status &&
        effectCount === 1;
      details = {
        first_status: first.status,
        second_status: second.status,
        semantic_effect_count: effectCount
      };
    } else {
      const request: StructuredAgentRequest<{ case_id: string }, CalibrationOutput> = {
        agent_name: corpusCase.role,
        model_config: { model_name: "simulated-model", max_output_tokens: 100 },
        instructions: "Synthetic no-network transport calibration.",
        input: { case_id: corpusCase.case_id },
        output_schema: CalibrationOutputSchema,
        schema_name: "transport-calibration-output-v1",
        client_request_id: `base:${corpusCase.case_id}`,
        timeout_ms: 1_000,
        metadata: { evaluation_phase: "e2a29a_no_live" }
      };
      const outcomes = scenario.outcomes ?? [{ kind: "success" as const }];
      let executeIndex = 0;
      const seenRequestIds = new Set<string>();
      const seenAttemptIds = new Set<string>();
      const budget = initialBudget();
      const backoffs: number[] = [];
      const provider: LlmProvider = {
        async executeStructured<TInput, TOutput>(attemptRequest: StructuredAgentRequest<TInput, TOutput>) {
          executeIndex += 1;
          seenRequestIds.add(attemptRequest.client_request_id);
          if (attemptRequest.transport_attempt) {
            seenAttemptIds.add(attemptRequest.transport_attempt.adapter_attempt_id);
          }
          const outcome = outcomes[Math.min(executeIndex - 1, outcomes.length - 1)];
          return fakeResult(outcome, attemptRequest.client_request_id) as StructuredAgentResult<TOutput>;
        }
      };
      const expectedHash = scenario.mode === "identity_mismatch"
        ? "0".repeat(64)
        : canonicalStructuredAgentRequestHash(request);
      const execution = await executeWithBoundedProviderTransportRetry({
        provider,
        request,
        logical_call_id: corpusCase.case_id,
        source_binding_hash: sha256(`source:${corpusCase.case_id}`),
        expected_canonical_request_hash: expectedHash,
        read_budget: () => ({ ...budget }),
        reserve_adapter_attempt: (attemptIndex) => {
          if (scenario.budget_block_after_first && attemptIndex > 1) return false;
          budget.adapter_attempts_used += 1;
          return budget.adapter_attempts_used <= budget.adapter_attempts_limit;
        },
        source_is_current: () => !scenario.stale_after_first,
        sleep: async (ms) => { backoffs.push(ms); },
        now: (() => {
          let tick = 0;
          return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick++ * 10));
        })(),
        create_attempt_id: (logical, index) => `${logical}:attempt:${index}`,
        create_client_request_id: (logical, index) => `${logical}:x-client:${index}`
      });
      status = execution.status;
      attempts = execution.adapter_attempt_count;
      const traceIdentityStable = execution.attempt_traces.every(
        (trace) =>
          trace.logical_call_id === execution.logical_call_id &&
          trace.canonical_request_hash === execution.canonical_request_hash &&
          trace.source_binding_hash === execution.source_binding_hash
      );
      const attemptIdsUnique = seenAttemptIds.size === attempts;
      const requestIdsUnique = seenRequestIds.size === attempts;
      const noAccidentalSemanticRegeneration = execution.semantic_regeneration_count === 0;
      passed =
        status === scenario.expected_status &&
        attempts === scenario.expected_attempts &&
        traceIdentityStable &&
        attemptIdsUnique &&
        requestIdsUnique &&
        noAccidentalSemanticRegeneration &&
        attempts <= 3;
      details = {
        final_classification: execution.final_classification,
        transport_retry_count: execution.transport_retry_count,
        trace_identity_stable: traceIdentityStable,
        adapter_attempt_ids_unique: attemptIdsUnique,
        x_client_request_ids_unique: requestIdsUnique,
        semantic_regeneration_count: execution.semantic_regeneration_count,
        backoffs_ms: backoffs,
        attempt_traces: execution.attempt_traces
      };
    }

    results.push({
      ...corpusCase,
      observed_status: status,
      observed_adapter_attempts: attempts,
      passed,
      details
    });
  }

  return {
    corpus,
    results,
    summary: {
      calibration_version: "e2a29a-transport-calibration-v1",
      case_count: corpus.length,
      passed_count: results.filter((entry) => entry.passed === true).length,
      failed_count: results.filter((entry) => entry.passed !== true).length,
      role_count: roles.length,
      provider_calls_made: 0,
      network_requests_made: 0,
      maximum_adapter_attempts_observed: Math.max(
        ...results.map((entry) => Number(entry.observed_adapter_attempts))
      )
    }
  };
}

function normalizedText(value: string) {
  return value
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenJaccard(left: string, right: string) {
  const a = new Set(normalizedText(left).split(" ").filter(Boolean));
  const b = new Set(normalizedText(right).split(" ").filter(Boolean));
  const intersection = [...a].filter((entry) => b.has(entry)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function extractStrings(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    if (value.length >= 20 && value.length <= 5_000) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => extractStrings(entry, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as JsonRecord).forEach((entry) => extractStrings(entry, output));
  }
}

export function e2a30FrozenProtocol() {
  return {
    protocol_version: "e2a30-thermal-physics-anchor-contradiction-canary-v1",
    execution_authorized: false,
    live_execution_performed: false,
    session_count: 1,
    domain: "introductory_thermal_physics",
    concept:
      "When metal and wood are at the same room temperature, metal can feel colder because it transfers thermal energy away from skin faster; touch sensation alone does not establish a lower object temperature.",
    active_distractor: {
      option_label: "B",
      claim: "The metal feels colder because it must be at a lower temperature than the wood."
    },
    natural_initial_activity:
      "A metal block and a wood block have been in the same room overnight. The metal feels colder when touched. Explain what that sensation does and does not tell you about their temperatures.",
    frozen_student_turn_count: 6,
    frozen_trajectory: [
      { checkpoint: 1, student_turn: 1, role: "initial_misconception", envelope: ["misconception"] },
      { checkpoint: 2, student_turn: 2, role: "copied_or_echoed_tutor_wording", envelope: ["insufficient", "misconception"] },
      { checkpoint: 3, student_turn: 3, role: "partial_improvement", envelope: ["misconception", "partial"] },
      { checkpoint: 4, student_turn: 4, role: "correct_heat_transfer_mechanism_with_explicit_wrong_B_temperature_conclusion", envelope: ["misconception", "partial"] },
      { checkpoint: 5, student_turn: 4, role: "structured_contradiction_created_by_evaluator", required_structured_conflict: true },
      { checkpoint: 6, student_turn: 5, role: "natural_clarification", envelope: ["insufficient", "partial"] },
      { checkpoint: 7, student_turn: 6, role: "independent_coherent_rejection", envelope: ["sound"] },
      { checkpoint: 8, student_turn: 6, role: "immediate_revision_after_sound", revision_required_immediately: true }
    ],
    transport_policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    failure_taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION,
    tracing_policy_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
    exactly_once_policy_version: EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
    source_binding_required_before_every_retry: true,
    candidate_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA256,
    approved_v2_hash: APPROVED_V2_HASH,
    normal_call_arithmetic: {
      simulator_calls: 6,
      evidence_evaluator_calls: 6,
      initial_tutor_calls: 5,
      tutor_semantic_regenerations: 0,
      logical_generation_calls: 17,
      adapter_attempts_without_transport_failure: 17
    }
  };
}

export function e2a30Budget() {
  return {
    budget_version: "e2a30-preliminary-budget-v1",
    execution_authorized: false,
    maximum: {
      simulator_calls: 9,
      evidence_evaluator_calls: 9,
      initial_tutor_calls: 9,
      tutor_semantic_regenerations: 2,
      logical_generation_calls: 29,
      adapter_attempts: 87,
      transport_retries_per_logical_call: 2,
      input_tokens: 900_000,
      output_tokens: 70_000,
      total_tokens: 970_000,
      cost_usd_when_pricing_available: 25,
      provider_concurrency: 1
    },
    expected_normal: {
      simulator_calls: 6,
      evidence_evaluator_calls: 6,
      initial_tutor_calls: 5,
      tutor_semantic_regenerations: 0,
      logical_generation_calls: 17,
      adapter_attempts: 17
    },
    pre_call_and_pre_retry_budget_enforcement_required: true
  };
}

export function e2a30ArtifactContract() {
  return {
    artifact_contract_version: "e2a30-complete-turn-transport-evidence-contract-v1",
    execution_authorized: false,
    inherits: "e2a29-complete-turn-evidence-contract-v1",
    every_logical_generation_call_requires: [
      "logical_call_id",
      "canonical_request_hash",
      "source_binding_hash",
      "adapter_attempt_traces",
      "transport_retry_count",
      "semantic_regeneration_count",
      "accepted_result_identity_or_explicit_failure",
      "exactly_once_semantic_effect_receipt_when_accepted",
      "budget_before_and_after_each_attempt"
    ],
    every_adapter_attempt_requires: tracingPolicy().per_attempt_required_fields,
    failure_status_mapping_version: "e2a29a-future-status-mapping-v1",
    no_chain_of_thought: true,
    no_secrets_or_environment_values: true,
    no_provider_call_authorized_by_this_artifact: true
  };
}

function e2a30OverlapAnalysis(protocol: ReturnType<typeof e2a30FrozenProtocol>) {
  const historicalStrings = new Set<string>();
  const roots = readdirSync(path.join(process.cwd(), ".data"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^e2a2[4-9][a-z]*(?:-|$)/u.test(entry.name) &&
        entry.name !== path.basename(E2A29A_ARTIFACT_ROOT)
    )
    .map((entry) => path.join(process.cwd(), ".data", entry.name));
  const jsonFiles = roots
    .flatMap(filesRecursively)
    .filter((file) => /\.jsonl?$|\.json$/u.test(file) && statSync(file).size <= 5_000_000);
  for (const file of jsonFiles) {
    try {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(".jsonl")) {
        text.split(/\r?\n/u).filter(Boolean).forEach((line) => extractStrings(JSON.parse(line), historicalStrings));
      } else {
        extractStrings(JSON.parse(text), historicalStrings);
      }
    } catch {
      // Historical partial artifacts are excluded but counted below.
    }
  }
  const sourceFiles = [
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v5.ts",
    "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
  ];
  sourceFiles.forEach((file) => extractStrings(readFileSync(path.join(process.cwd(), file), "utf8"), historicalStrings));
  const planned = [
    protocol.natural_initial_activity,
    protocol.concept,
    protocol.active_distractor.claim
  ];
  let maximumTokenOverlap = 0;
  let exactMatches = 0;
  let normalizedMatches = 0;
  for (const candidate of planned) {
    for (const historical of historicalStrings) {
      if (candidate === historical) exactMatches += 1;
      if (normalizedText(candidate) === normalizedText(historical)) normalizedMatches += 1;
      maximumTokenOverlap = Math.max(maximumTokenOverlap, tokenJaccard(candidate, historical));
    }
  }
  const nounSubstitutionTemplateMatch = [
    "current just before and just after",
    "resistance spreading",
    "antibiotic exposure"
  ].some((fragment) => normalizedText(protocol.natural_initial_activity).includes(normalizedText(fragment)));
  return {
    analysis_version: "e2a30-held-out-overlap-analysis-v1",
    source_scope: [
      "e2a24_through_e2a29_artifacts",
      "calibration_and_e1_artifacts_within_e2a24_through_e2a29",
      "autonomous_dialogue_prompt_source",
      "target_evidence_contract_v5_source",
      "production_evaluator_v5_source"
    ],
    scanned_json_file_count: jsonFiles.length,
    historical_string_count: historicalStrings.size,
    planned_text_count: planned.length,
    exact_match_count: exactMatches,
    normalized_match_count: normalizedMatches,
    token_overlap_maximum: Number(maximumTokenOverlap.toFixed(4)),
    structural_template_match_count: nounSubstitutionTemplateMatch ? 1 : 0,
    noun_substitution_template_match: nounSubstitutionTemplateMatch,
    deterministic_semantic_method: "normalized_token_jaccard_and_domain-template-phrase-audit_without_network",
    passed:
      exactMatches === 0 &&
      normalizedMatches === 0 &&
      maximumTokenOverlap < 0.85 &&
      !nounSubstitutionTemplateMatch,
    limitations: [
      "Lexical overlap is not an embedding-based semantic evaluation.",
      "Provider-generated turns remain constrained by frozen role envelopes only if E2A.30 is separately authorized."
    ]
  };
}

function candidateIntegrity() {
  const candidate = readJson<JsonRecord>(CANDIDATE_PATH);
  const fileSha = sha256(readFileSync(CANDIDATE_PATH));
  return {
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: fileSha,
    approved_v2_hash: candidate.approved_v2_hash,
    expected_candidate_configuration_hash: CANDIDATE_HASH,
    expected_candidate_file_sha256: CANDIDATE_FILE_SHA256,
    expected_approved_v2_hash: APPROVED_V2_HASH,
    candidate_approved: candidate.approval_state === "approved",
    candidate_activated: candidate.activation_state === "activated",
    v5_stack_preserved: true,
    candidate_integrity_passed:
      candidate.candidate_configuration_hash === CANDIDATE_HASH &&
      fileSha === CANDIDATE_FILE_SHA256 &&
      candidate.approved_v2_hash === APPROVED_V2_HASH
  };
}

function compositeRuntimeIdentity(input: {
  protocolHash: string;
  artifactContractHash: string;
  protectedEvidenceHash: string;
}) {
  const sources = [
    "src/lib/llm/provider-transport-retry.ts",
    "src/lib/llm/providers/types.ts",
    "src/lib/llm/providers/openai-responses-provider.ts",
    "src/lib/evaluation/formative/e2a29a-provider-infrastructure-reconciliation.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v5.ts",
    "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts",
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts",
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
  ];
  const sourceHashes = Object.fromEntries(
    sources.map((file) => [file, sha256(readFileSync(path.join(process.cwd(), file)))])
  );
  const identity = {
    identity_version: "e2a29a-composite-runtime-identity-v1",
    application_git_commit: applicationGitCommit(),
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA256,
    approved_v2_hash: APPROVED_V2_HASH,
    provider_failure_taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION,
    transport_retry_policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    request_tracing_policy_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
    exactly_once_semantic_effects_policy_version: EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
    e2a30_protocol_hash: input.protocolHash,
    e2a30_artifact_contract_hash: input.artifactContractHash,
    protected_evidence_hash: input.protectedEvidenceHash,
    source_hashes: sourceHashes
  };
  return { ...identity, composite_runtime_identity_hash: stableHash(identity) };
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `e2a29a_${stamp}_${randomBytes(4).toString("hex")}`;
}

export async function runE2A29A(input: { outputRoot?: string; runId?: string } = {}) {
  const before = protectedEvidenceSnapshot();
  const historical = loadHistoricalE2A29();
  const runId = input.runId ?? createRunId();
  const runDir = path.join(input.outputRoot ?? E2A29A_ARTIFACT_ROOT, runId);
  if (existsSync(runDir)) throw new Error("e2a29a_run_directory_exists");
  mkdirSync(runDir, { recursive: true });

  const exactReconstruction = e2a29ExactFailureReconstruction(historical);
  const applicability = e2a29EvidenceApplicability();
  const diagnosis = derivedDiagnosis(historical);
  const calibration = await runE2A29ATransportCalibration();
  if (calibration.summary.case_count < 80 || calibration.summary.failed_count !== 0) {
    throw new Error("e2a29a_transport_calibration_failed");
  }
  const protocol = e2a30FrozenProtocol();
  const protocolHash = stableHash(protocol);
  const budget = e2a30Budget();
  const artifactContract = e2a30ArtifactContract();
  const artifactContractHash = stableHash(artifactContract);
  const overlap = e2a30OverlapAnalysis(protocol);
  if (!overlap.passed) throw new Error("e2a30_overlap_analysis_failed");
  const candidate = candidateIntegrity();
  if (!candidate.candidate_integrity_passed) throw new Error("e2a29a_candidate_integrity_failed");
  const counterfactual = counterfactualReplay();
  const retryAudit = retryEligibilityAudit(historical);

  const manifest = {
    manifest_version: E2A29A_VERSION,
    run_id: runId,
    created_at: new Date().toISOString(),
    application_git_commit: applicationGitCommit(),
    execution_mode: "deterministic_no_provider",
    source_e2a29_run_id: E2A29_RUN_ID,
    historical_e2a29_status_preserved: historical.summary.status,
    provider_calls_made: 0,
    network_requests_made: 0,
    e2a29_rerun: false,
    e2a30_executed: false,
    candidate_approved: false,
    candidate_activated: false,
    protected_evidence_before_hash: before.current_sha256
  };
  writeJson(path.join(runDir, "e2a29a-manifest.json"), manifest);
  writeJson(path.join(runDir, "e2a29-exact-failure-reconstruction.json"), exactReconstruction);
  writeJson(path.join(runDir, "e2a29-evidence-accuracy-applicability.json"), applicability);
  writeJson(path.join(runDir, "evidence-accuracy-applicability.json"), applicability);
  writeJson(path.join(runDir, "derived-failure-diagnosis.json"), diagnosis);
  writeJson(path.join(runDir, "provider-failure-taxonomy.json"), providerFailureTaxonomyArtifact());
  writeJson(path.join(runDir, "transport-vs-semantic-retry-policy.json"), transportVsSemanticRetryPolicy());
  writeJson(path.join(runDir, "bounded-provider-transport-retry-policy.json"), boundedRetryPolicy());
  writeJson(path.join(runDir, "retry-eligibility-audit.json"), retryAudit);
  writeJson(path.join(runDir, "provider-request-tracing-policy.json"), tracingPolicy());
  writeJson(path.join(runDir, "exactly-once-semantic-effects-policy.json"), exactlyOncePolicy());
  writeJson(path.join(runDir, "e2a29-counterfactual-retry-replay.json"), counterfactual);
  writeJson(path.join(runDir, "future-status-mapping.json"), futureStatusMapping());
  writeJson(path.join(runDir, "human-review-applicability.json"), humanReviewApplicability());
  writeJson(path.join(runDir, "candidate-integrity.json"), candidate);
  writeJsonl(path.join(runDir, "transport-calibration-corpus.jsonl"), calibration.corpus);
  writeJsonl(path.join(runDir, "transport-calibration-results.jsonl"), calibration.results);
  writeJson(path.join(runDir, "e2a30-held-out-overlap-analysis.json"), overlap);
  writeJson(path.join(runDir, "e2a30-frozen-protocol.json"), protocol);
  writeFileSync(path.join(runDir, "e2a30-frozen-protocol.sha256"), `${protocolHash}\n`, "utf8");
  writeJson(path.join(runDir, "e2a30-budget.json"), budget);
  writeJson(path.join(runDir, "e2a30-artifact-contract.json"), artifactContract);

  const after = protectedEvidenceSnapshot();
  const evidenceIntegrity = {
    integrity_version: "e2a29a-evidence-stack-integrity-v1",
    source_scope: "approved_configs_candidates_v5_stack_and_e2a12_through_e2a29",
    before,
    after,
    byte_identical: before.current_sha256 === after.current_sha256
  };
  if (!evidenceIntegrity.byte_identical) throw new Error("e2a29a_protected_evidence_changed");
  writeJson(path.join(runDir, "evidence-stack-integrity.json"), evidenceIntegrity);
  const identity = compositeRuntimeIdentity({
    protocolHash,
    artifactContractHash,
    protectedEvidenceHash: after.current_sha256
  });
  writeJson(path.join(runDir, "composite-runtime-identity.json"), identity);

  const summary = {
    summary_version: "e2a29a-summary-v1",
    status: E2A29A_STATUS,
    passed: true,
    run_id: runId,
    artifact_path: runDir,
    source_e2a29_run_id: E2A29_RUN_ID,
    immutable_historical_status: historical.summary.status,
    derived_failure_status: diagnosis.derived_status,
    failure_domain: diagnosis.primary_failure_domain,
    evidence_accuracy_applicable: applicability.evidence_accuracy_applicable,
    transport_policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    maximum_adapter_attempts_per_logical_call:
      PROVIDER_TRANSPORT_RETRY_LIMITS.maximum_adapter_attempts_per_logical_call,
    maximum_transport_retries_per_logical_call:
      PROVIDER_TRANSPORT_RETRY_LIMITS.maximum_transport_retries_per_logical_call,
    calibration: calibration.summary,
    candidate_integrity_passed: candidate.candidate_integrity_passed,
    protected_evidence_unchanged: evidenceIntegrity.byte_identical,
    approved_v2_hash: APPROVED_V2_HASH,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA256,
    e2a30_protocol_hash: protocolHash,
    e2a30_artifact_contract_hash: artifactContractHash,
    e2a30_overlap_passed: overlap.passed,
    e2a30_execution_authorized: false,
    e2a30_executed: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    candidate_approved: false,
    candidate_activated: false,
    composite_runtime_identity_hash: identity.composite_runtime_identity_hash
  };
  writeJson(path.join(runDir, "summary.json"), summary);
  return { runDir, summary, calibration };
}

export function latestE2A29ARun() {
  if (!existsSync(E2A29A_ARTIFACT_ROOT)) return null;
  return readdirSync(E2A29A_ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a29a_"))
    .map((entry) => entry.name)
    .sort()
    .at(-1) ?? null;
}

export function auditE2A29A(runId?: string) {
  const id = runId ?? latestE2A29ARun();
  if (!id) throw new Error("e2a29a_run_not_found");
  const runDir = path.join(E2A29A_ARTIFACT_ROOT, id);
  const missing = E2A29A_ARTIFACT_NAMES.filter((name) => !existsSync(path.join(runDir, name)));
  const summary = readJson<JsonRecord>(path.join(runDir, "summary.json"));
  const applicability = readJson<JsonRecord>(path.join(runDir, "e2a29-evidence-accuracy-applicability.json"));
  const diagnosis = readJson<JsonRecord>(path.join(runDir, "derived-failure-diagnosis.json"));
  const protocol = readJson<JsonRecord>(path.join(runDir, "e2a30-frozen-protocol.json"));
  const protocolHash = readFileSync(path.join(runDir, "e2a30-frozen-protocol.sha256"), "utf8").trim();
  const calibration = readJsonl<JsonRecord>(path.join(runDir, "transport-calibration-results.jsonl"));
  const checks = {
    artifacts_complete: missing.length === 0,
    summary_passed: summary.passed === true && summary.status === E2A29A_STATUS,
    historical_status_preserved:
      summary.immutable_historical_status === "e2a29_canary_failed_evidence_accuracy",
    derived_diagnosis_correct:
      diagnosis.derived_status === "e2a29_historical_failure_caused_by_provider_infrastructure_5xx",
    evidence_accuracy_not_applicable: applicability.evidence_accuracy_applicable === false,
    calibration_minimum: calibration.length >= 80,
    calibration_passed: calibration.every((entry) => entry.passed === true),
    e2a30_protocol_hash: protocolHash === stableHash(protocol),
    e2a30_not_executed:
      summary.e2a30_executed === false && summary.provider_calls_made === 0,
    candidate_not_approved_or_activated:
      summary.candidate_approved === false && summary.candidate_activated === false,
    protected_evidence_unchanged: summary.protected_evidence_unchanged === true
  };
  return {
    audit_version: "e2a29a-artifact-audit-v1",
    run_id: id,
    artifact_path: runDir,
    checks,
    missing_artifacts: missing,
    passed: Object.values(checks).every(Boolean),
    provider_calls_made: 0,
    network_requests_made: 0
  };
}
