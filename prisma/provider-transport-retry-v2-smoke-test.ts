import { z } from "zod";
import {
  ExactlyOnceSemanticEffectGuard,
  executeWithBoundedProviderTransportRetry
} from "../src/lib/llm/provider-transport-retry";
import type {
  LlmProvider,
  OpenAITransportTelemetry,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";

const OutputSchema = z.object({ value: z.string() }).strict();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function request(): StructuredAgentRequest<
  { message: string },
  z.infer<typeof OutputSchema>
> {
  return {
    agent_name: "formative_conversation_agent",
    model_config: {
      model_name: "deterministic-transport-smoke",
      max_output_tokens: 100
    },
    instructions: "Deterministic no-provider transport smoke.",
    input: { message: "test" },
    output_schema: OutputSchema,
    schema_name: "provider-transport-retry-v2-smoke",
    client_request_id: "initial-client-request",
    timeout_ms: 1_000
  };
}

function interruptedTelemetry(
  clientRequestId: string
): OpenAITransportTelemetry {
  return {
    provider: "openai",
    transport: "openai_responses",
    adapter_version: "deterministic-smoke",
    client_request_id: clientRequestId,
    model_name: "deterministic-transport-smoke",
    base_url_host: "api.openai.com",
    base_url_approved: true,
    transport_adapter_entered: true,
    request_serialization_completed: true,
    fetch_invoked: true,
    response_headers_received: false,
    response_body_received: false,
    normalized_error: {
      typed_failure_reason: "unknown_transport_error",
      error_class: "TypeError",
      error_name: "TypeError",
      error_type: null,
      http_status: null,
      provider_error_code: null,
      provider_error_type: null,
      provider_error_param: null,
      provider_request_id: null,
      provider_request_header_id: null,
      retry_after_ms: null,
      node_cause_name: null,
      node_cause_code: null,
      network_category: "unknown",
      sanitized_message:
        "Connection ended before a response was received.",
      has_http_response: false,
      before_request_serialization: false,
      fetch_invoked: true,
      response_headers_received: false,
      response_body_received: false
    }
  };
}

function interruptedResult(
  clientRequestId: string
): StructuredAgentResult<z.infer<typeof OutputSchema>> {
  return {
    provider: "openai",
    client_request_id: clientRequestId,
    status: "failed",
    latency_ms: 20,
    error: {
      category: "unexpected_provider_response",
      message: "Connection ended before a response was received.",
      retryable: false
    },
    transport_telemetry: interruptedTelemetry(clientRequestId)
  };
}

function completedResult(
  clientRequestId: string
): StructuredAgentResult<z.infer<typeof OutputSchema>> {
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
    }
  };
}

function sequenceProvider(
  results: Array<
    (
      request: StructuredAgentRequest<unknown, unknown>
    ) => StructuredAgentResult<z.infer<typeof OutputSchema>>
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

async function main() {
  const backoffs: number[] = [];
  const transientThenSuccess = sequenceProvider([
    (value) => interruptedResult(value.client_request_id),
    (value) => completedResult(value.client_request_id)
  ]);
  const recovered = await executeWithBoundedProviderTransportRetry({
    provider: transientThenSuccess.provider,
    request: request(),
    logical_call_id: "logical-transient-success",
    source_binding_hash: "source-transient-success",
    sleep: async (ms) => {
      backoffs.push(ms);
    },
    create_attempt_id: (logicalCallId, attemptIndex) =>
      `${logicalCallId}:attempt:${attemptIndex}`,
    create_client_request_id: (logicalCallId, attemptIndex) =>
      `${logicalCallId}:request:${attemptIndex}`
  });
  assert(
    recovered.status === "accepted" &&
      recovered.adapter_attempt_count === 2 &&
      recovered.transport_retry_count === 1 &&
      transientThenSuccess.call_count() === 2,
    "A pre-response transport interruption must retry once and accept the valid result."
  );
  assert(
    JSON.stringify(backoffs) === JSON.stringify([2_000]),
    "The first bounded retry must use the frozen 2-second backoff."
  );
  assert(
    recovered.attempt_traces[0].classification?.category ===
      "connection_interrupted_before_response" &&
      recovered.attempt_traces[0].transport_milestones
        ?.fetch_invoked === true &&
      recovered.attempt_traces[0].transport_milestones
        ?.response_headers_received === false,
    "The retry trace must preserve the safe evidence supporting transient classification."
  );
  assert(
    recovered.attempt_traces[0].canonical_request_hash ===
      recovered.attempt_traces[1].canonical_request_hash &&
      recovered.attempt_traces[0].adapter_attempt_id !==
        recovered.attempt_traces[1].adapter_attempt_id &&
      recovered.attempt_traces[0].x_client_request_id !==
        recovered.attempt_traces[1].x_client_request_id,
    "Retries must preserve logical request identity while using distinct adapter attempts."
  );

  const exhaustedBackoffs: number[] = [];
  const alwaysInterrupted = sequenceProvider([
    (value) => interruptedResult(value.client_request_id)
  ]);
  const exhausted = await executeWithBoundedProviderTransportRetry({
    provider: alwaysInterrupted.provider,
    request: request(),
    logical_call_id: "logical-transient-exhausted",
    source_binding_hash: "source-transient-exhausted",
    sleep: async (ms) => {
      exhaustedBackoffs.push(ms);
    }
  });
  assert(
    exhausted.status === "transport_failure_retry_exhausted" &&
      exhausted.adapter_attempt_count === 3 &&
      exhausted.transport_retry_count === 2 &&
      alwaysInterrupted.call_count() === 3,
    "A persistent transient interruption must stop after the bounded third attempt."
  );
  assert(
    JSON.stringify(exhaustedBackoffs) ===
      JSON.stringify([2_000, 8_000]),
    "Exhausted retries must use only the frozen 2-second and 8-second backoffs."
  );

  const schemaInvalid = sequenceProvider([
    (value) => ({
      provider: "openai",
      client_request_id: value.client_request_id,
      status: "failed",
      latency_ms: 10,
      error: {
        category: "schema_validation",
        message: "Structured output failed validation.",
        retryable: false
      }
    })
  ]);
  const schemaFailure = await executeWithBoundedProviderTransportRetry({
    provider: schemaInvalid.provider,
    request: request(),
    logical_call_id: "logical-schema-invalid",
    source_binding_hash: "source-schema-invalid",
    sleep: async () => {
      throw new Error("nonretryable_failure_must_not_sleep");
    }
  });
  assert(
    schemaFailure.status ===
      "model_result_requires_semantic_regeneration" &&
      schemaFailure.adapter_attempt_count === 1 &&
      schemaFailure.transport_retry_count === 0 &&
      schemaInvalid.call_count() === 1,
    "A schema-validation failure must not be transport-retried."
  );

  const configurationInvalid = sequenceProvider([
    (value) => ({
      provider: "openai",
      client_request_id: value.client_request_id,
      status: "failed",
      latency_ms: 5,
      error: {
        category: "configuration",
        message: "Operational configuration unavailable.",
        retryable: false
      }
    })
  ]);
  const configurationFailure =
    await executeWithBoundedProviderTransportRetry({
      provider: configurationInvalid.provider,
      request: request(),
      logical_call_id: "logical-configuration-invalid",
      source_binding_hash: "source-configuration-invalid",
      sleep: async () => {
        throw new Error("configuration_failure_must_not_sleep");
      }
    });
  assert(
    configurationFailure.status ===
      "transport_failure_nonretryable" &&
      configurationFailure.adapter_attempt_count === 1 &&
      configurationFailure.transport_retry_count === 0 &&
      configurationInvalid.call_count() === 1,
    "An unclassified configuration failure must remain fail-closed and non-retryable."
  );

  let committedTutorEffects = 0;
  const guard = new ExactlyOnceSemanticEffectGuard();
  const acceptedAttempt =
    recovered.attempt_traces.at(-1);
  assert(acceptedAttempt, "The recovered call must have an accepted attempt.");
  const semanticEffect = {
    logical_call_id: recovered.logical_call_id,
    canonical_request_hash: recovered.canonical_request_hash,
    accepted_adapter_attempt_id:
      acceptedAttempt.adapter_attempt_id,
    accepted_result_hash: "accepted-result-hash",
    commit_effect: () => {
      committedTutorEffects += 1;
      return "tutor-turn";
    }
  };
  const firstCommit = await guard.commit(semanticEffect);
  const replayedCommit = await guard.commit(semanticEffect);
  assert(
    firstCommit.status === "committed" &&
      replayedCommit.status === "reused" &&
      committedTutorEffects === 1,
    "A recovered logical call must commit its tutor effect exactly once."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        provider_calls: 0,
        network_requests: 0,
        transient_success_attempts:
          recovered.adapter_attempt_count,
        exhausted_attempts:
          exhausted.adapter_attempt_count,
        nonretryable_attempts:
          schemaFailure.adapter_attempt_count +
          configurationFailure.adapter_attempt_count,
        duplicate_tutor_effects: committedTutorEffects - 1
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
          : "provider_transport_retry_v2_smoke_failed",
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
});
