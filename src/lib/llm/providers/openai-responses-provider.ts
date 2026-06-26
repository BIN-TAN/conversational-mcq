import { zodTextFormat } from "openai/helpers/zod";
import { createOpenAIClient } from "@/lib/llm/openai-client";
import { sanitizeUnknownError } from "@/lib/llm/errors";
import {
  isApprovedOpenAIBaseUrl,
  normalizeOpenAITransportError,
  openAIBaseUrlHost,
  resolveOpenAIBaseUrl
} from "@/lib/llm/openai-transport-diagnostics";
import { normalizeOpenAIResponsesResult } from "@/lib/llm/openai-responses-normalizer";
import type {
  LlmProvider,
  OpenAITransportMilestone,
  StructuredAgentRequest,
  StructuredAgentResult
} from "./types";

export const OPENAI_RESPONSES_ADAPTER_VERSION = "openai-responses-adapter-v2";

export type OpenAIResponsesTransportBoundaryEvent = {
  provider: "openai";
  transport: "openai_responses";
  adapter_version: typeof OPENAI_RESPONSES_ADAPTER_VERSION;
  network_dispatch_expected: true;
  event_type:
    | "transport_adapter_entered"
    | "request_serialization_completed"
    | "fetch_invoked"
    | "response_headers_received"
    | "response_body_received";
  client_request_id: string;
  model_name: string;
  http_status?: number;
  provider_request_id?: string | null;
  retry_after_ms?: number | null;
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

function initialMilestones(): OpenAITransportMilestone {
  return {
    transport_adapter_entered: false,
    request_serialization_completed: false,
    fetch_invoked: false,
    response_headers_received: false,
    response_body_received: false
  };
}

export class OpenAIResponsesProvider implements LlmProvider {
  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const startedAt = Date.now();
    const milestones = initialMilestones();
    const baseURL = resolveOpenAIBaseUrl();
    const baseUrlHost = openAIBaseUrlHost(baseURL);
    const baseURLApproved = isApprovedOpenAIBaseUrl(baseURL);

    const transportTelemetry = () => ({
      provider: "openai" as const,
      transport: "openai_responses" as const,
      adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
      client_request_id: request.client_request_id,
      model_name: request.model_config.model_name,
      base_url_host: baseUrlHost,
      base_url_approved: baseURLApproved,
      ...milestones
    });

    const emit = async (
      event_type: OpenAIResponsesTransportBoundaryEvent["event_type"],
      extra?: Pick<OpenAIResponsesTransportBoundaryEvent, "http_status" | "provider_request_id" | "retry_after_ms">
    ) => emitTransportBoundary({
      provider: "openai",
      transport: "openai_responses",
      adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
      network_dispatch_expected: true,
      event_type,
      client_request_id: request.client_request_id,
      model_name: request.model_config.model_name,
      metadata: request.metadata,
      ...extra
    });

    const client = createOpenAIClient({
      onFetchInvoked: async () => {
        milestones.fetch_invoked = true;
        await emit("fetch_invoked");
      },
      onResponseHeadersReceived: async ({ status, request_id, retry_after_ms }) => {
        milestones.response_headers_received = true;
        await emit("response_headers_received", {
          http_status: status,
          provider_request_id: request_id,
          retry_after_ms
        });
      }
    });

    try {
      milestones.transport_adapter_entered = true;
      await emit("transport_adapter_entered");
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
      milestones.request_serialization_completed = true;
      await emit("request_serialization_completed");
      if (process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY === "true") {
        throw new Error("test_only_transport_hook_active_before_fetch");
      }
      const { data, request_id: requestId } = await client.responses
        .parse(body, {
          timeout: request.timeout_ms,
          maxRetries: 0,
          idempotencyKey: request.client_request_id
        })
        .withResponse();
      milestones.response_body_received = true;
      await emit("response_body_received", { provider_request_id: requestId ?? null });
      const response = data as unknown as Record<string, unknown>;
      const normalized = normalizeOpenAIResponsesResult({
        sdkResponse: response,
        providerRequestId: requestId ?? null,
        responseBodyReceived: true,
        modelSnapshot: request.model_config.model_name
      });
      const status = String(response.status ?? "completed");
      const refusal = normalized.rawOutput.refusal ?? refusalFromResponse(data);
      const telemetry = {
        ...transportTelemetry(),
        provider_request_id: requestId ?? undefined,
        provider_response_id: typeof response.id === "string" ? response.id : undefined,
        response_status: normalized.rawOutput.responseStatus,
        incomplete_details: normalized.rawOutput.incompleteDetails,
        normalized_response: normalized,
        transport_outcome: normalized.outcomes.transportOutcome,
        raw_output_outcome: normalized.outcomes.rawOutputOutcome,
        effective_system_outcome: normalized.outcomes.effectiveSystemOutcome,
        fallback_reason: normalized.outcomes.fallbackReason,
        usage_status: normalized.usage.status,
        usage_source_paths: normalized.usage.sourcePaths,
        raw_response_hash: normalized.rawOutput.rawResponseHash
      };
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
          usage: normalized.usage.status === "usage_verified"
            ? {
                input_tokens: normalized.usage.inputTokens ?? undefined,
                output_tokens: normalized.usage.outputTokens ?? undefined,
                total_tokens: normalized.usage.totalTokens ?? undefined,
                reasoning_tokens: normalized.usage.reasoningTokens ?? undefined,
                cached_input_tokens: normalized.usage.cachedInputTokens ?? undefined,
                raw: response.usage
              }
            : undefined,
          latency_ms: Date.now() - startedAt,
          transport_telemetry: telemetry
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
          usage: normalized.usage.status === "usage_verified"
            ? {
                input_tokens: normalized.usage.inputTokens ?? undefined,
                output_tokens: normalized.usage.outputTokens ?? undefined,
                total_tokens: normalized.usage.totalTokens ?? undefined,
                reasoning_tokens: normalized.usage.reasoningTokens ?? undefined,
                cached_input_tokens: normalized.usage.cachedInputTokens ?? undefined,
                raw: response.usage
              }
            : undefined,
          latency_ms: Date.now() - startedAt,
          transport_telemetry: telemetry
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
          usage: normalized.usage.status === "usage_verified"
            ? {
                input_tokens: normalized.usage.inputTokens ?? undefined,
                output_tokens: normalized.usage.outputTokens ?? undefined,
                total_tokens: normalized.usage.totalTokens ?? undefined,
                reasoning_tokens: normalized.usage.reasoningTokens ?? undefined,
                cached_input_tokens: normalized.usage.cachedInputTokens ?? undefined,
                raw: response.usage
              }
            : undefined,
          latency_ms: Date.now() - startedAt,
          transport_telemetry: telemetry,
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
        usage: normalized.usage.status === "usage_verified"
          ? {
              input_tokens: normalized.usage.inputTokens ?? undefined,
              output_tokens: normalized.usage.outputTokens ?? undefined,
              total_tokens: normalized.usage.totalTokens ?? undefined,
              reasoning_tokens: normalized.usage.reasoningTokens ?? undefined,
              cached_input_tokens: normalized.usage.cachedInputTokens ?? undefined,
              raw: response.usage
            }
          : undefined,
        latency_ms: Date.now() - startedAt,
        transport_telemetry: telemetry
      };
    } catch (error) {
      const normalized = normalizeOpenAITransportError(error, milestones);
      return {
        provider: "openai",
        client_request_id: request.client_request_id,
        provider_request_id: normalized.provider_request_id ?? normalized.provider_request_header_id ?? undefined,
        status: "failed",
        raw_output: undefined,
        latency_ms: Date.now() - startedAt,
        error: sanitizeUnknownError(error),
        transport_telemetry: {
          ...transportTelemetry(),
          provider_request_id: normalized.provider_request_id ?? normalized.provider_request_header_id ?? undefined,
          http_status: normalized.http_status ?? undefined,
          retry_after_ms: normalized.retry_after_ms,
          normalized_error: normalized
        }
      };
    }
  }
}
