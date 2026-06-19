import { randomUUID } from "node:crypto";
import { mockOutputForAgent } from "@/lib/agents/mock-fixtures";
import type {
  LlmProvider,
  SanitizedAgentError,
  StructuredAgentRequest,
  StructuredAgentResult
} from "./types";

export type MockProviderMode =
  | "success"
  | "refusal"
  | "incomplete"
  | "transient_error"
  | "permanent_error"
  | "invalid_output"
  | "timeout";

const attemptsByRequest = new Map<string, number>();

function failedResult<TOutput>(
  request: StructuredAgentRequest<unknown, TOutput>,
  error: SanitizedAgentError,
  startedAt: number
): StructuredAgentResult<TOutput> {
  return {
    provider: "mock",
    client_request_id: request.client_request_id,
    provider_request_id: `mock_req_${randomUUID()}`,
    provider_response_id: `mock_resp_${randomUUID()}`,
    status: "failed",
    raw_output: { mock_error: error.category },
    latency_ms: Date.now() - startedAt,
    error
  };
}

export class MockLlmProvider implements LlmProvider {
  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const startedAt = Date.now();
    const mode = (request.metadata?.mock_mode ?? "success") as MockProviderMode;
    const attempt = (attemptsByRequest.get(request.client_request_id) ?? 0) + 1;
    attemptsByRequest.set(request.client_request_id, attempt);

    if (mode === "refusal") {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "refused",
        refusal: "Mock refusal.",
        raw_output: { refusal: "Mock refusal." },
        latency_ms: Date.now() - startedAt
      };
    }

    if (mode === "incomplete") {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "incomplete",
        incomplete_reason: "mock_incomplete",
        raw_output: { incomplete_reason: "mock_incomplete" },
        latency_ms: Date.now() - startedAt
      };
    }

    if (mode === "permanent_error") {
      return failedResult(
        request,
        {
          category: "invalid_request",
          message: "Mock permanent provider error.",
          retryable: false
        },
        startedAt
      );
    }

    if (mode === "timeout") {
      return failedResult(
        request,
        {
          category: "timeout",
          message: "Mock timeout.",
          retryable: true
        },
        startedAt
      );
    }

    if (mode === "transient_error") {
      const failuresBeforeSuccess = Number(
        request.metadata?.mock_transient_failures_before_success ?? 1
      );

      if (attempt <= failuresBeforeSuccess) {
        return failedResult(
          request,
          {
            category: "rate_limit",
            message: "Mock transient provider error.",
            retryable: true
          },
          startedAt
        );
      }
    }

    if (mode === "invalid_output") {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "completed",
        parsed_output: {
          agent_name: request.agent_name,
          status: "old_field_should_not_validate"
        } as unknown as TOutput,
        raw_output: {
          agent_name: request.agent_name,
          status: "old_field_should_not_validate"
        },
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          raw: { mock: true }
        },
        latency_ms: Date.now() - startedAt
      };
    }

    const output = mockOutputForAgent(request.agent_name) as unknown as TOutput;

    return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `mock_req_${randomUUID()}`,
      provider_response_id: `mock_resp_${randomUUID()}`,
      status: "completed",
      parsed_output: output,
      raw_output: output,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        raw: { mock: true }
      },
      latency_ms: Date.now() - startedAt
    };
  }
}
