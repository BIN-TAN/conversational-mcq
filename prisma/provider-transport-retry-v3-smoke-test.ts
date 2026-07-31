import { z } from "zod";
import { instrumentOpenAIResponseBody } from "../src/lib/llm/openai-client";
import {
  ExactlyOnceSemanticEffectGuard,
  classifyInternalFailure,
  executeWithBoundedProviderTransportRetry
} from "../src/lib/llm/provider-transport-retry";
import type {
  LlmProvider,
  OpenAITransportMilestone,
  OpenAITransportTelemetry,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";

const OutputSchema = z.object({ value: z.string() }).strict();
type Output = z.infer<typeof OutputSchema>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function request(): StructuredAgentRequest<{ message: string }, Output> {
  return {
    agent_name: "formative_conversation_agent",
    model_config: {
      model_name: "deterministic-transport-smoke",
      max_output_tokens: 100
    },
    instructions: "Deterministic no-provider transport smoke.",
    input: { message: "test" },
    output_schema: OutputSchema,
    schema_name: "provider-transport-retry-v3-smoke",
    client_request_id: "initial-client-request",
    timeout_ms: 1_000
  };
}

function telemetry(input: {
  client_request_id: string;
  http_status: number | null;
  typed_failure_reason:
    | "unknown_transport_error"
    | "openai_request_timeout"
    | "openai_connection_failed";
  network_category: "unknown" | "timeout" | "socket";
  error_category: "network" | "timeout" | "unexpected_provider_response";
  milestones: OpenAITransportMilestone;
}): OpenAITransportTelemetry {
  return {
    provider: "openai",
    transport: "openai_responses",
    adapter_version: "openai-responses-adapter-v3",
    client_request_id: input.client_request_id,
    model_name: "deterministic-transport-smoke",
    base_url_host: "api.openai.com",
    base_url_approved: true,
    http_status: input.http_status ?? undefined,
    ...input.milestones,
    normalized_error: {
      typed_failure_reason: input.typed_failure_reason,
      error_class: "TypeError",
      error_name: "TypeError",
      error_type: null,
      http_status: input.http_status,
      provider_error_code: null,
      provider_error_type: null,
      provider_error_param: null,
      provider_request_id: null,
      provider_request_header_id:
        input.http_status === null ? null : "req_deterministic",
      retry_after_ms: null,
      node_cause_name: null,
      node_cause_code:
        input.network_category === "socket" ? "ECONNRESET" : null,
      network_category: input.network_category,
      sanitized_message: "Sanitized deterministic transport failure.",
      has_http_response: input.http_status !== null,
      before_request_serialization: false,
      fetch_invoked: input.milestones.fetch_invoked,
      response_headers_received:
        input.milestones.response_headers_received,
      response_body_started:
        input.milestones.response_body_started ?? false,
      response_body_completed:
        input.milestones.response_body_completed ?? false,
      response_body_bytes_received:
        input.milestones.response_body_bytes_received ?? 0,
      response_body_received:
        input.milestones.response_body_received
    },
    normalized_response: undefined
  };
}

function failedResult(input: {
  client_request_id: string;
  http_status: number | null;
  typed_failure_reason:
    | "unknown_transport_error"
    | "openai_request_timeout"
    | "openai_connection_failed";
  network_category: "unknown" | "timeout" | "socket";
  error_category: "network" | "timeout" | "unexpected_provider_response";
  milestones: OpenAITransportMilestone;
}): StructuredAgentResult<Output> {
  return {
    provider: "openai",
    client_request_id: input.client_request_id,
    status: "failed",
    latency_ms: 20,
    error: {
      category: input.error_category,
      message: "Sanitized deterministic transport failure.",
      retryable: true
    },
    transport_telemetry: telemetry(input)
  };
}

function preHeaderFailure(clientRequestId: string) {
  return failedResult({
    client_request_id: clientRequestId,
    http_status: null,
    typed_failure_reason: "unknown_transport_error",
    network_category: "unknown",
    error_category: "network",
    milestones: {
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: true,
      response_headers_received: false,
      response_body_started: false,
      response_body_completed: false,
      response_body_bytes_received: 0,
      response_body_received: false
    }
  });
}

function headersOnlyFailure(clientRequestId: string) {
  return failedResult({
    client_request_id: clientRequestId,
    http_status: 200,
    typed_failure_reason: "unknown_transport_error",
    network_category: "unknown",
    error_category: "network",
    milestones: {
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: true,
      response_headers_received: true,
      response_body_started: false,
      response_body_completed: false,
      response_body_bytes_received: 0,
      response_body_received: false
    }
  });
}

function bodyConsumptionFailure(
  clientRequestId: string,
  kind: "partial_socket" | "partial_timeout"
) {
  return failedResult({
    client_request_id: clientRequestId,
    http_status: 200,
    typed_failure_reason:
      kind === "partial_timeout"
        ? "openai_request_timeout"
        : "openai_connection_failed",
    network_category: kind === "partial_timeout" ? "timeout" : "socket",
    error_category: kind === "partial_timeout" ? "timeout" : "network",
    milestones: {
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: true,
      response_headers_received: true,
      response_body_started: true,
      response_body_completed: false,
      response_body_bytes_received: 19,
      response_body_received: false
    }
  });
}

function completedResult(clientRequestId: string): StructuredAgentResult<Output> {
  return {
    provider: "openai",
    client_request_id: clientRequestId,
    status: "completed",
    parsed_output: { value: "accepted" },
    latency_ms: 25,
    usage: {
      input_tokens: 20,
      output_tokens: 5,
      total_tokens: 25
    },
    transport_telemetry: {
      provider: "openai",
      transport: "openai_responses",
      adapter_version: "openai-responses-adapter-v3",
      client_request_id: clientRequestId,
      model_name: "deterministic-transport-smoke",
      base_url_host: "api.openai.com",
      base_url_approved: true,
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: true,
      response_headers_received: true,
      response_body_started: true,
      response_body_completed: true,
      response_body_bytes_received: 128,
      response_body_received: true
    }
  };
}

function sequenceProvider(
  results: Array<
    (
      request: StructuredAgentRequest<unknown, unknown>
    ) => StructuredAgentResult<Output>
  >
) {
  let callCount = 0;
  const provider: LlmProvider = {
    async executeStructured<TInput, TOutput>(
      value: StructuredAgentRequest<TInput, TOutput>
    ) {
      const result = results[Math.min(callCount, results.length - 1)](
        value as StructuredAgentRequest<unknown, unknown>
      );
      callCount += 1;
      return result as StructuredAgentResult<TOutput>;
    }
  };
  return { provider, call_count: () => callCount };
}

async function executeSequence(input: {
  logical_call_id: string;
  provider: LlmProvider;
  backoffs?: number[];
}) {
  return executeWithBoundedProviderTransportRetry({
    provider: input.provider,
    request: request(),
    logical_call_id: input.logical_call_id,
    source_binding_hash: `source:${input.logical_call_id}`,
    sleep: async (ms) => {
      input.backoffs?.push(ms);
    },
    create_attempt_id: (logicalCallId, attemptIndex) =>
      `${logicalCallId}:attempt:${attemptIndex}`,
    create_client_request_id: (logicalCallId, attemptIndex) =>
      `${logicalCallId}:request:${attemptIndex}`
  });
}

async function verifyResponseBodyInstrumentation() {
  const completeEvents: string[] = [];
  const complete = await instrumentOpenAIResponseBody(
    new Response("abc", { status: 200 }),
    "https://api.openai.com/v1/responses",
    {
      onResponseBodyStarted: ({ bytes_received }) => {
        completeEvents.push(`started:${bytes_received}`);
      },
      onResponseBodyProgress: ({ bytes_received }) => {
        completeEvents.push(`progress:${bytes_received}`);
      },
      onResponseBodyCompleted: ({ bytes_received }) => {
        completeEvents.push(`completed:${bytes_received}`);
      }
    }
  );
  assert((await complete.text()) === "abc", "Instrumented complete body changed.");
  assert(
    completeEvents.at(0)?.startsWith("started:") &&
      completeEvents.at(-1)?.startsWith("completed:"),
    "A complete response must record body start and completion."
  );

  const beforeFirstByteEvents: string[] = [];
  const beforeFirstByte = await instrumentOpenAIResponseBody(
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("zero_body_interruption"));
        }
      }),
      { status: 200 }
    ),
    "https://api.openai.com/v1/responses",
    {
      onResponseBodyStarted: () => {
        beforeFirstByteEvents.push("started");
      },
      onResponseBodyCompleted: () => {
        beforeFirstByteEvents.push("completed");
      }
    }
  );
  await beforeFirstByte.text().catch(() => null);
  assert(
    beforeFirstByteEvents.length === 0,
    "An interruption before the first byte must not report body start or completion."
  );

  const partialEvents: string[] = [];
  let partialPull = 0;
  const partial = await instrumentOpenAIResponseBody(
    new Response(
      new ReadableStream({
        pull(controller) {
          partialPull += 1;
          if (partialPull === 1) {
            controller.enqueue(new TextEncoder().encode("partial"));
            return;
          }
          controller.error(new Error("partial_body_interruption"));
        }
      }),
      { status: 200 }
    ),
    "https://api.openai.com/v1/responses",
    {
      onResponseBodyStarted: () => {
        partialEvents.push("started");
      },
      onResponseBodyProgress: () => {
        partialEvents.push("progress");
      },
      onResponseBodyCompleted: () => {
        partialEvents.push("completed");
      }
    }
  );
  await partial.text().catch(() => null);
  assert(
    partialEvents.includes("started") &&
      partialEvents.includes("progress") &&
      !partialEvents.includes("completed"),
    "A partial body must record bytes without recording completion."
  );
}

async function main() {
  await verifyResponseBodyInstrumentation();

  const preHeader = sequenceProvider([
    (value) => preHeaderFailure(value.client_request_id),
    (value) => completedResult(value.client_request_id)
  ]);
  const preHeaderRecovered = await executeSequence({
    logical_call_id: "pre-header",
    provider: preHeader.provider
  });
  assert(
    preHeaderRecovered.status === "accepted" &&
      preHeaderRecovered.adapter_attempt_count === 2,
    "A transient pre-header interruption must recover once."
  );

  const headersOnlyBackoffs: number[] = [];
  const headersOnly = sequenceProvider([
    (value) => headersOnlyFailure(value.client_request_id),
    (value) => completedResult(value.client_request_id)
  ]);
  const headersOnlyRecovered = await executeSequence({
    logical_call_id: "headers-zero-body",
    provider: headersOnly.provider,
    backoffs: headersOnlyBackoffs
  });
  assert(
    headersOnlyRecovered.status === "accepted" &&
      headersOnlyRecovered.adapter_attempt_count === 2 &&
      headersOnlyRecovered.transport_retry_count === 1 &&
      headersOnlyRecovered.attempt_traces[0].classification?.category ===
        "connection_interrupted_after_headers_before_body",
    "A transient 2xx headers-only, zero-byte response must use the bounded retry."
  );
  assert(
    headersOnlyRecovered.attempt_traces[0].logical_idempotency_key ===
      headersOnlyRecovered.attempt_traces[1].logical_idempotency_key &&
      headersOnlyRecovered.attempt_traces[0].adapter_attempt_id !==
        headersOnlyRecovered.attempt_traces[1].adapter_attempt_id &&
      headersOnlyRecovered.attempt_traces[0].x_client_request_id !==
        headersOnlyRecovered.attempt_traces[1].x_client_request_id &&
      JSON.stringify(headersOnlyBackoffs) === JSON.stringify([2_000]),
    "The zero-body retry must preserve logical identity and use a distinct attempt."
  );

  for (const kind of ["partial_socket", "partial_timeout"] as const) {
    const partial = sequenceProvider([
      (value) => bodyConsumptionFailure(value.client_request_id, kind)
    ]);
    const result = await executeSequence({
      logical_call_id: kind,
      provider: partial.provider
    });
    assert(
      result.status === "transport_failure_nonretryable" &&
        result.adapter_attempt_count === 1 &&
        result.transport_retry_count === 0 &&
        partial.call_count() === 1,
      `${kind} must fail closed after response body consumption begins.`
    );
  }

  const exhaustedBackoffs: number[] = [];
  const alwaysHeadersOnly = sequenceProvider([
    (value) => headersOnlyFailure(value.client_request_id)
  ]);
  const exhausted = await executeSequence({
    logical_call_id: "headers-zero-body-exhausted",
    provider: alwaysHeadersOnly.provider,
    backoffs: exhaustedBackoffs
  });
  assert(
    exhausted.status === "transport_failure_retry_exhausted" &&
      exhausted.adapter_attempt_count === 3 &&
      exhausted.transport_retry_count === 2 &&
      JSON.stringify(exhaustedBackoffs) === JSON.stringify([2_000, 8_000]),
    "A persistent headers-only interruption must stop after the bounded retries."
  );

  const complete = sequenceProvider([
    (value) => completedResult(value.client_request_id)
  ]);
  const accepted = await executeSequence({
    logical_call_id: "complete-before-persistence",
    provider: complete.provider
  });
  assert(
    accepted.status === "accepted" && complete.call_count() === 1,
    "A complete provider result must be accepted exactly once."
  );
  const persistenceClassification = classifyInternalFailure(
    "persistence_failure"
  );
  assert(
    !persistenceClassification.retryable_transport_failure,
    "Persistence failure must never authorize another provider attempt."
  );
  let tutorTurns = 0;
  let transitions = 0;
  const effectGuard = new ExactlyOnceSemanticEffectGuard();
  const acceptedAttempt = accepted.attempt_traces.at(-1);
  assert(acceptedAttempt, "Accepted attempt trace is required.");
  await effectGuard
    .commit({
      logical_call_id: accepted.logical_call_id,
      canonical_request_hash: accepted.canonical_request_hash,
      accepted_adapter_attempt_id: acceptedAttempt.adapter_attempt_id,
      accepted_result_hash: "accepted-result",
      commit_effect: () => {
        tutorTurns += 1;
        throw new Error("deterministic_persistence_failure");
      }
    })
    .catch(() => null);
  assert(
    tutorTurns === 1 && transitions === 0 && complete.call_count() === 1,
    "A persistence failure must not dispatch again or create duplicate semantic effects."
  );

  const guard = new ExactlyOnceSemanticEffectGuard();
  const semanticEffect = {
    logical_call_id: headersOnlyRecovered.logical_call_id,
    canonical_request_hash: headersOnlyRecovered.canonical_request_hash,
    accepted_adapter_attempt_id:
      headersOnlyRecovered.attempt_traces.at(-1)?.adapter_attempt_id ??
      "missing",
    accepted_result_hash: "headers-only-recovered-result",
    commit_effect: () => {
      tutorTurns += 1;
      transitions += 1;
      return "committed";
    }
  };
  const firstCommit = await guard.commit(semanticEffect);
  const replayCommit = await guard.commit(semanticEffect);
  assert(
    firstCommit.status === "committed" &&
      replayCommit.status === "reused" &&
      Number(tutorTurns) === 2 &&
      Number(transitions) === 1,
    "Retry recovery and replay must commit one tutor turn and one transition."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        provider_calls: 0,
        network_requests: 0,
        pre_header_attempts: preHeaderRecovered.adapter_attempt_count,
        zero_body_attempts: headersOnlyRecovered.adapter_attempt_count,
        retry_exhaustion_attempts: exhausted.adapter_attempt_count,
        partial_body_retries: 0,
        completed_body_persistence_provider_retries: 0,
        duplicate_tutor_turns: 0,
        duplicate_profile_transitions: 0
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "provider_transport_retry_v3_smoke_failed",
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
});
