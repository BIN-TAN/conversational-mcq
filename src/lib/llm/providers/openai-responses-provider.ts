import { zodTextFormat } from "openai/helpers/zod";
import { createOpenAIClient } from "@/lib/llm/openai-client";
import { sanitizeUnknownError } from "@/lib/llm/errors";
import type {
  LlmProvider,
  LlmUsage,
  StructuredAgentRequest,
  StructuredAgentResult
} from "./types";

export const OPENAI_RESPONSES_ADAPTER_VERSION = "openai-responses-adapter-v1";

export type OpenAIResponsesTransportBoundaryEvent = {
  provider: "openai";
  transport: "openai_responses";
  adapter_version: typeof OPENAI_RESPONSES_ADAPTER_VERSION;
  network_dispatch_expected: true;
  network_dispatch_started: true;
  client_request_id: string;
  model_name: string;
  metadata?: Record<string, string>;
};

type OpenAIResponsesTransportBoundaryObserver = (
  event: OpenAIResponsesTransportBoundaryEvent
) => void | Promise<void>;

const transportBoundaryObservers = new Set<OpenAIResponsesTransportBoundaryObserver>();

export async function withOpenAIResponsesTransportBoundaryObserver<T>(
  observer: OpenAIResponsesTransportBoundaryObserver,
  callback: () => Promise<T>
): Promise<T> {
  transportBoundaryObservers.add(observer);
  try {
    return await callback();
  } finally {
    transportBoundaryObservers.delete(observer);
  }
}

async function emitTransportBoundary(event: OpenAIResponsesTransportBoundaryEvent) {
  for (const observer of transportBoundaryObservers) {
    await observer(event);
  }
}

function usageFromResponse(response: { usage?: unknown }): LlmUsage | undefined {
  const usage = response.usage as
    | {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
        output_tokens_details?: { reasoning_tokens?: number };
      }
    | undefined;

  if (!usage) {
    return undefined;
  }

  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
    cached_input_tokens: usage.input_tokens_details?.cached_tokens,
    raw: usage
  };
}

function refusalFromResponse(response: { output?: unknown[] }) {
  const output = Array.isArray(response.output) ? response.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    const refusal = content.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as { type?: unknown }).type === "refusal"
    ) as { refusal?: unknown } | undefined;

    if (typeof refusal?.refusal === "string") {
      return refusal.refusal;
    }
  }

  return undefined;
}

function rawAuditResponse(response: Record<string, unknown>) {
  return {
    id: response.id,
    status: response.status,
    output: response.output,
    output_parsed: response.output_parsed,
    incomplete_details: response.incomplete_details,
    error: response.error,
    usage: response.usage
  };
}

export class OpenAIResponsesProvider implements LlmProvider {
  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const startedAt = Date.now();
    const client = createOpenAIClient();

    try {
      const text = {
        format: zodTextFormat(request.output_schema, request.schema_name),
        ...(request.model_config.verbosity ? { verbosity: request.model_config.verbosity } : {})
      };
      const reasoning =
        request.model_config.reasoning_effort !== undefined
          ? { effort: request.model_config.reasoning_effort }
          : undefined;
      const body = {
        model: request.model_config.model_name,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        text,
        store: false,
        metadata: request.metadata,
        ...(request.model_config.temperature !== undefined
          ? { temperature: request.model_config.temperature }
          : {}),
        ...(request.model_config.max_output_tokens !== undefined
          ? { max_output_tokens: request.model_config.max_output_tokens }
          : {}),
        ...(reasoning ? { reasoning } : {})
      };
      await emitTransportBoundary({
        provider: "openai",
        transport: "openai_responses",
        adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
        network_dispatch_expected: true,
        network_dispatch_started: true,
        client_request_id: request.client_request_id,
        model_name: request.model_config.model_name,
        metadata: request.metadata
      });
      if (process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY === "true") {
        throw new Error("test_only_transport_boundary_abort_before_http_request");
      }
      const { data, request_id: requestId } = await client.responses
        .parse(body, {
          timeout: request.timeout_ms,
          maxRetries: 0,
          idempotencyKey: request.client_request_id
        })
        .withResponse();
      const response = data as unknown as Record<string, unknown>;
      const status = String(response.status ?? "completed");
      const refusal = refusalFromResponse(data);
      const incompleteReason =
        response.incomplete_details &&
        typeof response.incomplete_details === "object" &&
        "reason" in response.incomplete_details
          ? String((response.incomplete_details as { reason?: unknown }).reason ?? "")
          : undefined;

      if (refusal) {
        return {
          provider: "openai",
          client_request_id: request.client_request_id,
          provider_request_id: requestId ?? undefined,
          provider_response_id: typeof response.id === "string" ? response.id : undefined,
          status: "refused",
          refusal,
          raw_output: rawAuditResponse(response),
          usage: usageFromResponse(data),
          latency_ms: Date.now() - startedAt
        };
      }

      if (status === "incomplete") {
        return {
          provider: "openai",
          client_request_id: request.client_request_id,
          provider_request_id: requestId ?? undefined,
          provider_response_id: typeof response.id === "string" ? response.id : undefined,
          status: "incomplete",
          incomplete_reason: incompleteReason ?? "incomplete",
          raw_output: rawAuditResponse(response),
          usage: usageFromResponse(data),
          latency_ms: Date.now() - startedAt
        };
      }

      if (status !== "completed") {
        return {
          provider: "openai",
          client_request_id: request.client_request_id,
          provider_request_id: requestId ?? undefined,
          provider_response_id: typeof response.id === "string" ? response.id : undefined,
          status: "failed",
          raw_output: rawAuditResponse(response),
          usage: usageFromResponse(data),
          latency_ms: Date.now() - startedAt,
          error: {
            category: "unexpected_provider_response",
            message: `OpenAI response ended with status ${status}.`,
            retryable: false
          }
        };
      }

      return {
        provider: "openai",
        client_request_id: request.client_request_id,
        provider_request_id: requestId ?? undefined,
        provider_response_id: typeof response.id === "string" ? response.id : undefined,
        status: "completed",
        parsed_output: data.output_parsed as TOutput,
        raw_output: rawAuditResponse(response),
        usage: usageFromResponse(data),
        latency_ms: Date.now() - startedAt
      };
    } catch (error) {
      return {
        provider: "openai",
        client_request_id: request.client_request_id,
        status: "failed",
        raw_output: undefined,
        latency_ms: Date.now() - startedAt,
        error: sanitizeUnknownError(error)
      };
    }
  }
}
