import { randomUUID } from "node:crypto";
import { stableHash } from "@/lib/operational/stable-hash";
import type {
  LlmProvider,
  OpenAITransportMilestone,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";

export const PROVIDER_FAILURE_TAXONOMY_VERSION = "provider-failure-taxonomy-v2";
export const PROVIDER_TRANSPORT_RETRY_POLICY_VERSION =
  "bounded-provider-transport-retry-v1";
export const PROVIDER_REQUEST_TRACING_POLICY_VERSION =
  "provider-request-tracing-policy-v2";
export const EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION =
  "exactly-once-semantic-effects-policy-v1";

export const PROVIDER_TRANSPORT_RETRY_LIMITS = Object.freeze({
  maximum_adapter_attempts_per_logical_call: 3,
  maximum_transport_retries_per_logical_call: 2,
  provider_concurrency: 1,
  backoff_ms: [2_000, 8_000] as const,
  jitter: false,
  sdk_managed_retries: 0
});

export type ProviderFailureCategory =
  | "provider_500"
  | "provider_502"
  | "provider_503"
  | "provider_504"
  | "provider_520"
  | "provider_5xx_transient"
  | "network_timeout"
  | "upstream_timeout"
  | "connection_reset"
  | "connection_interrupted_before_response"
  | "temporary_dns_failure"
  | "tls_failure"
  | "retryable_rate_limit"
  | "rate_limit_without_retry_timing"
  | "quota_exceeded_nonretryable"
  | "invalid_request"
  | "authentication_failure"
  | "authorization_failure"
  | "unsupported_model"
  | "invalid_schema_request"
  | "context_limit_exceeded"
  | "policy_rejection"
  | "malformed_endpoint"
  | "response_missing_required_fields"
  | "response_schema_invalid"
  | "response_safety_invalid"
  | "response_evidence_invalid"
  | "hard_validator_rejection"
  | "semantic_regeneration_required"
  | "model_result_invalid"
  | "request_constructor_failure"
  | "serialization_failure"
  | "parser_failure"
  | "persistence_failure"
  | "artifact_write_failure"
  | "budget_accounting_failure"
  | "orchestration_failure"
  | "unknown_provider_failure";

export type ProviderFailureDomain =
  | "provider_infrastructure_transport"
  | "request_contract"
  | "model_result"
  | "internal_system";

export type ProviderFailureClassification = {
  taxonomy_version: typeof PROVIDER_FAILURE_TAXONOMY_VERSION;
  category: ProviderFailureCategory;
  domain: ProviderFailureDomain;
  retryable_transport_failure: boolean;
  semantic_regeneration_eligible: boolean;
  http_status: number | null;
  typed_failure_reason: string | null;
  normalized_error_category: string | null;
  rationale: string;
};

const retryableHttpCategories: Record<number, ProviderFailureCategory> = {
  500: "provider_500",
  502: "provider_502",
  503: "provider_503",
  504: "provider_504",
  520: "provider_520"
};

function classification(
  input: Omit<ProviderFailureClassification, "taxonomy_version">
): ProviderFailureClassification {
  return { taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION, ...input };
}

export function classifyProviderFailure<TOutput>(
  result: StructuredAgentResult<TOutput>
): ProviderFailureClassification {
  const normalized = result.transport_telemetry?.normalized_error;
  const httpStatus = normalized?.http_status ?? result.transport_telemetry?.http_status ?? null;
  const typedReason = normalized?.typed_failure_reason ?? null;
  const errorCategory = result.error?.category ?? null;

  if (httpStatus !== null && retryableHttpCategories[httpStatus]) {
    return classification({
      category: retryableHttpCategories[httpStatus],
      domain: "provider_infrastructure_transport",
      retryable_transport_failure: true,
      semantic_regeneration_eligible: false,
      http_status: httpStatus,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale:
        httpStatus === 520
          ? "HTTP 520 is treated as retryable provider infrastructure unless immutable evidence proves a request defect."
          : `HTTP ${httpStatus} is a retryable provider infrastructure response.`
    });
  }

  if (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599) {
    return classification({
      category: "provider_5xx_transient",
      domain: "provider_infrastructure_transport",
      retryable_transport_failure: true,
      semantic_regeneration_eligible: false,
      http_status: httpStatus,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale: `HTTP ${httpStatus} is an unenumerated retryable provider 5xx response.`
    });
  }

  const interruptedBeforeResponse =
    typedReason === "unknown_transport_error" &&
    (errorCategory === "network" ||
      errorCategory === "unexpected_provider_response") &&
    normalized?.before_request_serialization === false &&
    normalized.fetch_invoked &&
    !normalized.response_headers_received &&
    !normalized.response_body_received &&
    !normalized.has_http_response &&
    httpStatus === null;
  if (interruptedBeforeResponse) {
    return classification({
      category: "connection_interrupted_before_response",
      domain: "provider_infrastructure_transport",
      retryable_transport_failure: true,
      semantic_regeneration_eligible: false,
      http_status: null,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale:
        "The serialized request reached fetch, but no response headers, body, HTTP status, or provider acknowledgement were received."
    });
  }

  const transportCategory = (() => {
    if (typedReason === "openai_request_timeout" || errorCategory === "timeout") {
      return normalized?.has_http_response
        ? "upstream_timeout" as const
        : "network_timeout" as const;
    }
    if (typedReason === "openai_dns_failed" || normalized?.network_category === "dns") {
      return "temporary_dns_failure" as const;
    }
    if (typedReason === "openai_tls_failed" || normalized?.network_category === "tls") {
      return "tls_failure" as const;
    }
    if (
      normalized?.node_cause_code === "ECONNRESET" ||
      normalized?.network_category === "socket"
    ) {
      return "connection_reset" as const;
    }
    if (
      typedReason === "openai_rate_limited" &&
      errorCategory !== "quota" &&
      normalized?.retry_after_ms !== null &&
      normalized?.retry_after_ms !== undefined
    ) {
      return "retryable_rate_limit" as const;
    }
    return null;
  })();

  if (transportCategory) {
    return classification({
      category: transportCategory,
      domain: "provider_infrastructure_transport",
      retryable_transport_failure: true,
      semantic_regeneration_eligible: false,
      http_status: httpStatus,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale: `${transportCategory} is retryable under the bounded transport policy.`
    });
  }

  const nonretryable = (() => {
    if (typedReason === "openai_quota_exceeded" || errorCategory === "quota") {
      return "quota_exceeded_nonretryable" as const;
    }
    if (typedReason === "openai_authentication_failed" || errorCategory === "authentication") {
      return "authentication_failure" as const;
    }
    if (typedReason === "openai_permission_denied" || errorCategory === "permission") {
      return "authorization_failure" as const;
    }
    if (typedReason === "openai_model_not_found") {
      return "unsupported_model" as const;
    }
    if (httpStatus === 404) {
      return "malformed_endpoint" as const;
    }
    if (typedReason === "openai_rate_limited") {
      return "rate_limit_without_retry_timing" as const;
    }
    if (
      errorCategory === "provider_request_schema_invalid" ||
      errorCategory === "structured_output_schema_incompatible"
    ) {
      return "invalid_schema_request" as const;
    }
    if (typedReason === "openai_bad_request" || errorCategory === "invalid_request") {
      return "invalid_request" as const;
    }
    return null;
  })();

  if (nonretryable) {
    return classification({
      category: nonretryable,
      domain: "request_contract",
      retryable_transport_failure: false,
      semantic_regeneration_eligible: false,
      http_status: httpStatus,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale: `${nonretryable} must fail closed without a transport retry.`
    });
  }

  if (errorCategory === "schema_validation") {
    return classification({
      category: "response_schema_invalid",
      domain: "model_result",
      retryable_transport_failure: false,
      semantic_regeneration_eligible: true,
      http_status: httpStatus,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale: "A received but schema-invalid model result is eligible only for bounded semantic regeneration."
    });
  }

  if (result.status === "completed" && result.parsed_output === undefined) {
    return classification({
      category: "response_missing_required_fields",
      domain: "model_result",
      retryable_transport_failure: false,
      semantic_regeneration_eligible: true,
      http_status: httpStatus,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale: "The provider returned a response but required parsed output is absent."
    });
  }

  if (result.status === "refused" || result.status === "incomplete") {
    return classification({
      category: "model_result_invalid",
      domain: "model_result",
      retryable_transport_failure: false,
      semantic_regeneration_eligible: true,
      http_status: httpStatus,
      typed_failure_reason: typedReason,
      normalized_error_category: errorCategory,
      rationale: `Provider status ${result.status} is a model-result outcome, not a transport failure.`
    });
  }

  return classification({
    category: "unknown_provider_failure",
    domain: "provider_infrastructure_transport",
    retryable_transport_failure: false,
    semantic_regeneration_eligible: false,
    http_status: httpStatus,
    typed_failure_reason: typedReason,
    normalized_error_category: errorCategory,
    rationale: "The failure is not safely retryable without a more specific classification."
  });
}

export function classifyModelResultFailure(
  category:
    | "response_schema_invalid"
    | "response_safety_invalid"
    | "response_evidence_invalid"
    | "model_result_invalid"
): ProviderFailureClassification {
  return classification({
    category,
    domain: "model_result",
    retryable_transport_failure: false,
    semantic_regeneration_eligible: true,
    http_status: null,
    typed_failure_reason: null,
    normalized_error_category: null,
    rationale: `${category} is handled by bounded semantic regeneration, never by a transport retry.`
  });
}

export function classifyInternalFailure(
  category:
    | "request_constructor_failure"
    | "serialization_failure"
    | "parser_failure"
    | "persistence_failure"
    | "artifact_write_failure"
    | "budget_accounting_failure"
    | "orchestration_failure"
): ProviderFailureClassification {
  return classification({
    category,
    domain: "internal_system",
    retryable_transport_failure: false,
    semantic_regeneration_eligible: false,
    http_status: null,
    typed_failure_reason: null,
    normalized_error_category: null,
    rationale: `${category} must fail closed and cannot dispatch another provider attempt.`
  });
}

export type ProviderAttemptBudgetSnapshot = {
  logical_generation_calls_used: number;
  logical_generation_calls_limit: number;
  adapter_attempts_used: number;
  adapter_attempts_limit: number;
  input_tokens_used: number;
  input_tokens_limit: number;
  output_tokens_used: number;
  output_tokens_limit: number;
  total_tokens_used: number;
  total_tokens_limit: number;
  estimated_cost_usd: number | null;
  cost_limit_usd: number | null;
};

export type ProviderTransportAttemptTrace = {
  tracing_policy_version: typeof PROVIDER_REQUEST_TRACING_POLICY_VERSION;
  logical_call_id: string;
  canonical_request_hash: string;
  source_binding_hash: string;
  adapter_attempt_id: string;
  adapter_attempt_index: number;
  x_client_request_id: string;
  logical_idempotency_key: string;
  started_at: string;
  completed_at: string;
  latency_ms: number;
  provider_request_id: string | null;
  provider_response_id: string | null;
  http_status: number | null;
  transport_milestones: OpenAITransportMilestone | null;
  normalized_failure_evidence: {
    typed_failure_reason: string | null;
    network_category: string | null;
    node_cause_code: string | null;
    has_http_response: boolean;
    before_request_serialization: boolean;
  } | null;
  result_status: StructuredAgentResult<unknown>["status"];
  classification: ProviderFailureClassification | null;
  retry_decision: "accepted" | "retry" | "do_not_retry";
  retry_reason: string;
  backoff_ms_before_next_attempt: number | null;
  budget_before: ProviderAttemptBudgetSnapshot;
  budget_after: ProviderAttemptBudgetSnapshot;
};

export type ProviderTransportExecutionStatus =
  | "accepted"
  | "transport_failure_retry_exhausted"
  | "transport_failure_nonretryable"
  | "model_result_requires_semantic_regeneration"
  | "blocked_budget_before_retry"
  | "blocked_stale_source_before_retry"
  | "blocked_request_identity_mismatch";

export type ProviderTransportExecutionResult<TOutput> = {
  policy_version: typeof PROVIDER_TRANSPORT_RETRY_POLICY_VERSION;
  status: ProviderTransportExecutionStatus;
  logical_call_id: string;
  canonical_request_hash: string;
  source_binding_hash: string;
  accepted_result: StructuredAgentResult<TOutput> | null;
  last_result: StructuredAgentResult<TOutput> | null;
  attempt_traces: ProviderTransportAttemptTrace[];
  adapter_attempt_count: number;
  transport_retry_count: number;
  semantic_regeneration_count: 0;
  final_classification: ProviderFailureClassification | null;
};

export function canonicalStructuredAgentRequestHash<TInput, TOutput>(
  request: StructuredAgentRequest<TInput, TOutput>
) {
  return stableHash({
    agent_name: request.agent_name,
    model_config: request.model_config,
    instructions: request.instructions,
    input: request.input,
    schema_name: request.schema_name,
    timeout_ms: request.timeout_ms,
    metadata: request.metadata ?? {}
  });
}

export function providerTransportBackoffMs(retryIndex: number) {
  return PROVIDER_TRANSPORT_RETRY_LIMITS.backoff_ms[retryIndex] ?? null;
}

function defaultBudget(): ProviderAttemptBudgetSnapshot {
  return {
    logical_generation_calls_used: 0,
    logical_generation_calls_limit: Number.MAX_SAFE_INTEGER,
    adapter_attempts_used: 0,
    adapter_attempts_limit: Number.MAX_SAFE_INTEGER,
    input_tokens_used: 0,
    input_tokens_limit: Number.MAX_SAFE_INTEGER,
    output_tokens_used: 0,
    output_tokens_limit: Number.MAX_SAFE_INTEGER,
    total_tokens_used: 0,
    total_tokens_limit: Number.MAX_SAFE_INTEGER,
    estimated_cost_usd: null,
    cost_limit_usd: null
  };
}

function cloneBudget(value: ProviderAttemptBudgetSnapshot) {
  return { ...value };
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function executeWithBoundedProviderTransportRetry<TInput, TOutput>(input: {
  provider: LlmProvider;
  request: StructuredAgentRequest<TInput, TOutput>;
  logical_call_id: string;
  source_binding_hash: string;
  expected_canonical_request_hash?: string;
  logical_idempotency_key?: string;
  read_budget?: () => ProviderAttemptBudgetSnapshot;
  reserve_adapter_attempt?: (attemptIndex: number) => boolean;
  source_is_current?: () => boolean;
  accept_result?: (result: StructuredAgentResult<TOutput>) => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  create_attempt_id?: (logicalCallId: string, attemptIndex: number) => string;
  create_client_request_id?: (logicalCallId: string, attemptIndex: number) => string;
}): Promise<ProviderTransportExecutionResult<TOutput>> {
  const canonicalRequestHash = canonicalStructuredAgentRequestHash(input.request);
  const baseResult = {
    policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION as typeof PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    logical_call_id: input.logical_call_id,
    canonical_request_hash: canonicalRequestHash,
    source_binding_hash: input.source_binding_hash,
    semantic_regeneration_count: 0 as const
  };

  if (
    input.expected_canonical_request_hash &&
    input.expected_canonical_request_hash !== canonicalRequestHash
  ) {
    return {
      ...baseResult,
      status: "blocked_request_identity_mismatch",
      accepted_result: null,
      last_result: null,
      attempt_traces: [],
      adapter_attempt_count: 0,
      transport_retry_count: 0,
      final_classification: null
    };
  }

  const readBudget = input.read_budget ?? defaultBudget;
  const sourceIsCurrent = input.source_is_current ?? (() => true);
  const reserveAttempt = input.reserve_adapter_attempt ?? (() => true);
  const acceptResult = input.accept_result ?? ((result) => (
    result.status === "completed" && result.parsed_output !== undefined
  ));
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? (() => new Date());
  const traces: ProviderTransportAttemptTrace[] = [];
  let lastResult: StructuredAgentResult<TOutput> | null = null;
  let finalClassification: ProviderFailureClassification | null = null;
  const idempotencyKey = input.logical_idempotency_key ?? `logical:${input.logical_call_id}`;

  for (
    let attemptIndex = 1;
    attemptIndex <= PROVIDER_TRANSPORT_RETRY_LIMITS.maximum_adapter_attempts_per_logical_call;
    attemptIndex += 1
  ) {
    if (attemptIndex > 1 && !sourceIsCurrent()) {
      return {
        ...baseResult,
        status: "blocked_stale_source_before_retry",
        accepted_result: null,
        last_result: lastResult,
        attempt_traces: traces,
        adapter_attempt_count: traces.length,
        transport_retry_count: Math.max(0, traces.length - 1),
        final_classification: finalClassification
      };
    }

    const budgetBefore = cloneBudget(readBudget());
    if (!reserveAttempt(attemptIndex)) {
      return {
        ...baseResult,
        status: "blocked_budget_before_retry",
        accepted_result: null,
        last_result: lastResult,
        attempt_traces: traces,
        adapter_attempt_count: traces.length,
        transport_retry_count: Math.max(0, traces.length - 1),
        final_classification: finalClassification
      };
    }

    const adapterAttemptId = input.create_attempt_id?.(input.logical_call_id, attemptIndex) ??
      `${input.logical_call_id}:adapter:${attemptIndex}:${randomUUID()}`;
    const clientRequestId = input.create_client_request_id?.(
      input.logical_call_id,
      attemptIndex
    ) ?? `${input.logical_call_id}:request:${attemptIndex}:${randomUUID()}`;
    const startedAt = now();
    const attemptRequest: StructuredAgentRequest<TInput, TOutput> = {
      ...input.request,
      client_request_id: clientRequestId,
      transport_attempt: {
        logical_call_id: input.logical_call_id,
        adapter_attempt_id: adapterAttemptId,
        adapter_attempt_index: attemptIndex,
        canonical_request_hash: canonicalRequestHash,
        x_client_request_id: clientRequestId,
        logical_idempotency_key: idempotencyKey
      }
    };
    const result = await input.provider.executeStructured(attemptRequest);
    const completedAt = now();
    lastResult = result;
    const accepted = acceptResult(result);
    const classificationValue = accepted ? null : classifyProviderFailure(result);
    finalClassification = classificationValue;
    const canRetry = Boolean(
      classificationValue?.retryable_transport_failure &&
      attemptIndex < PROVIDER_TRANSPORT_RETRY_LIMITS.maximum_adapter_attempts_per_logical_call
    );
    const backoffMs = canRetry ? providerTransportBackoffMs(attemptIndex - 1) : null;
    traces.push({
      tracing_policy_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
      logical_call_id: input.logical_call_id,
      canonical_request_hash: canonicalRequestHash,
      source_binding_hash: input.source_binding_hash,
      adapter_attempt_id: adapterAttemptId,
      adapter_attempt_index: attemptIndex,
      x_client_request_id: clientRequestId,
      logical_idempotency_key: idempotencyKey,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      latency_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      provider_request_id:
        result.provider_request_id ?? result.transport_telemetry?.provider_request_id ?? null,
      provider_response_id:
        result.provider_response_id ?? result.transport_telemetry?.provider_response_id ?? null,
      http_status:
        result.transport_telemetry?.normalized_error?.http_status ??
        result.transport_telemetry?.http_status ??
        null,
      transport_milestones: result.transport_telemetry
        ? {
            transport_adapter_entered:
              result.transport_telemetry.transport_adapter_entered,
            request_serialization_completed:
              result.transport_telemetry.request_serialization_completed,
            fetch_invoked: result.transport_telemetry.fetch_invoked,
            response_headers_received:
              result.transport_telemetry.response_headers_received,
            response_body_received:
              result.transport_telemetry.response_body_received
          }
        : null,
      normalized_failure_evidence:
        result.transport_telemetry?.normalized_error
          ? {
              typed_failure_reason:
                result.transport_telemetry.normalized_error
                  .typed_failure_reason,
              network_category:
                result.transport_telemetry.normalized_error
                  .network_category,
              node_cause_code:
                result.transport_telemetry.normalized_error
                  .node_cause_code,
              has_http_response:
                result.transport_telemetry.normalized_error
                  .has_http_response,
              before_request_serialization:
                result.transport_telemetry.normalized_error
                  .before_request_serialization
            }
          : null,
      result_status: result.status,
      classification: classificationValue,
      retry_decision: accepted ? "accepted" : canRetry ? "retry" : "do_not_retry",
      retry_reason: accepted
        ? "valid_result_accepted"
        : canRetry
          ? `retryable_${classificationValue?.category ?? "unknown"}`
          : `nonretryable_or_exhausted_${classificationValue?.category ?? "unknown"}`,
      backoff_ms_before_next_attempt: backoffMs,
      budget_before: budgetBefore,
      budget_after: cloneBudget(readBudget())
    });

    if (accepted) {
      return {
        ...baseResult,
        status: "accepted",
        accepted_result: result,
        last_result: result,
        attempt_traces: traces,
        adapter_attempt_count: traces.length,
        transport_retry_count: Math.max(0, traces.length - 1),
        final_classification: null
      };
    }

    if (!classificationValue) {
      throw new Error("provider_failure_classification_missing");
    }

    if (!classificationValue.retryable_transport_failure) {
      return {
        ...baseResult,
        status: classificationValue.semantic_regeneration_eligible
          ? "model_result_requires_semantic_regeneration"
          : "transport_failure_nonretryable",
        accepted_result: null,
        last_result: result,
        attempt_traces: traces,
        adapter_attempt_count: traces.length,
        transport_retry_count: Math.max(0, traces.length - 1),
        final_classification: classificationValue
      };
    }

    if (!canRetry) {
      return {
        ...baseResult,
        status: "transport_failure_retry_exhausted",
        accepted_result: null,
        last_result: result,
        attempt_traces: traces,
        adapter_attempt_count: traces.length,
        transport_retry_count: Math.max(0, traces.length - 1),
        final_classification: classificationValue
      };
    }

    if (backoffMs !== null) {
      await sleep(backoffMs);
    }
  }

  throw new Error("provider_transport_retry_loop_unreachable");
}

export type ExactlyOnceSemanticEffectReceipt = {
  policy_version: typeof EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION;
  logical_call_id: string;
  canonical_request_hash: string;
  accepted_adapter_attempt_id: string;
  accepted_result_hash: string;
  committed_at: string;
};

export class ExactlyOnceSemanticEffectGuard {
  private readonly receipts = new Map<string, ExactlyOnceSemanticEffectReceipt>();
  private readonly inFlight = new Map<
    string,
    Promise<ExactlyOnceSemanticEffectReceipt>
  >();

  async commit<T>(input: {
    logical_call_id: string;
    canonical_request_hash: string;
    accepted_adapter_attempt_id: string;
    accepted_result_hash: string;
    commit_effect: () => Promise<T> | T;
    now?: () => Date;
  }): Promise<
    | { status: "committed"; receipt: ExactlyOnceSemanticEffectReceipt; value: T }
    | { status: "reused"; receipt: ExactlyOnceSemanticEffectReceipt; value: null }
    | { status: "duplicate_success_conflict"; receipt: ExactlyOnceSemanticEffectReceipt; value: null }
  > {
    const existing = this.receipts.get(input.logical_call_id);
    if (existing) {
      const same =
        existing.canonical_request_hash === input.canonical_request_hash &&
        existing.accepted_result_hash === input.accepted_result_hash;
      return {
        status: same ? "reused" : "duplicate_success_conflict",
        receipt: existing,
        value: null
      };
    }

    const pending = this.inFlight.get(input.logical_call_id);
    if (pending) {
      const settled = await pending;
      const same =
        settled.canonical_request_hash === input.canonical_request_hash &&
        settled.accepted_result_hash === input.accepted_result_hash;
      return {
        status: same ? "reused" : "duplicate_success_conflict",
        receipt: settled,
        value: null
      };
    }

    const operation = (async () => {
      const value = await input.commit_effect();
      const receipt: ExactlyOnceSemanticEffectReceipt = {
        policy_version: EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
        logical_call_id: input.logical_call_id,
        canonical_request_hash: input.canonical_request_hash,
        accepted_adapter_attempt_id: input.accepted_adapter_attempt_id,
        accepted_result_hash: input.accepted_result_hash,
        committed_at: (input.now?.() ?? new Date()).toISOString()
      };
      this.receipts.set(input.logical_call_id, receipt);
      return { receipt, value };
    })();
    this.inFlight.set(
      input.logical_call_id,
      operation.then((settled) => settled.receipt)
    );
    try {
      const settled = await operation;
      return { status: "committed", ...settled };
    } finally {
      this.inFlight.delete(input.logical_call_id);
    }
  }

  receipt(logicalCallId: string) {
    return this.receipts.get(logicalCallId) ?? null;
  }
}

export function providerFailureTaxonomyArtifact() {
  const categories: ProviderFailureCategory[] = [
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
    "retryable_rate_limit",
    "rate_limit_without_retry_timing",
    "quota_exceeded_nonretryable",
    "invalid_request",
    "authentication_failure",
    "authorization_failure",
    "unsupported_model",
    "invalid_schema_request",
    "context_limit_exceeded",
    "policy_rejection",
    "malformed_endpoint",
    "response_missing_required_fields",
    "response_schema_invalid",
    "response_safety_invalid",
    "response_evidence_invalid",
    "hard_validator_rejection",
    "semantic_regeneration_required",
    "model_result_invalid",
    "request_constructor_failure",
    "serialization_failure",
    "parser_failure",
    "persistence_failure",
    "artifact_write_failure",
    "budget_accounting_failure",
    "orchestration_failure",
    "unknown_provider_failure"
  ];
  return {
    taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION,
    categories,
    retry_boundary:
      "Only provider_infrastructure_transport categories explicitly marked retryable may use transport retries.",
    semantic_boundary:
      "Response schema, safety, and evidence failures use bounded semantic regeneration and never transport retry.",
    provider_520_rule:
      "HTTP 520 is retryable unless immutable evidence proves the request itself was defective."
  };
}
