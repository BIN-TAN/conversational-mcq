import { zodTextFormat } from "openai/helpers/zod";
import type {
  EasyInputMessage,
  ResponseInputContent
} from "openai/resources/responses/responses";
import { createOpenAIClient } from "@/lib/llm/openai-client";
import { sanitizeUnknownError } from "@/lib/llm/errors";
import { normalizeOpenAIResponsesResult } from "@/lib/llm/openai-responses-normalizer";
import { parseOpenAIResponsesStructuredOutput } from "@/lib/llm/providers/openai-responses-provider";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";

export type ItemDesignMultimodalAttachment = {
  material_id: string;
  kind: "pdf" | "image";
  file_name: string;
  media_type: string;
  bytes: Buffer;
};

function providerFileName(attachment: ItemDesignMultimodalAttachment) {
  const safeName = attachment.file_name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-160) || `${attachment.kind}_attachment`;
  return `${attachment.material_id}__${safeName}`;
}

export function compileItemDesignMultimodalRequestBody<TInput, TOutput>(input: {
  request: StructuredAgentRequest<TInput, TOutput>;
  attachments: ItemDesignMultimodalAttachment[];
}) {
  const request = input.request;
  const content: ResponseInputContent[] = [
    { type: "input_text", text: JSON.stringify(request.input) }
  ];

  for (const attachment of input.attachments) {
    content.push({
      type: "input_text",
      text: `Teacher course-material attachment ${attachment.material_id}: ${attachment.file_name}`
    });
    if (attachment.kind === "pdf") {
      content.push({
        type: "input_file",
        filename: providerFileName(attachment),
        file_data: `data:${attachment.media_type};base64,${attachment.bytes.toString("base64")}`
      });
    } else {
      content.push({
        type: "input_image",
        detail: "auto",
        image_url: `data:${attachment.media_type};base64,${attachment.bytes.toString("base64")}`
      });
    }
  }

  return {
    model: request.model_config.model_name,
    instructions: request.instructions,
    input: [{ role: "user", content } satisfies EasyInputMessage],
    text: {
      format: zodTextFormat(request.output_schema, request.schema_name),
      ...(request.model_config.verbosity
        ? { verbosity: request.model_config.verbosity }
        : {})
    },
    store: false,
    metadata: request.metadata,
    ...(request.model_config.temperature !== undefined
      ? { temperature: request.model_config.temperature }
      : {}),
    ...(request.model_config.max_output_tokens !== undefined
      ? { max_output_tokens: request.model_config.max_output_tokens }
      : {}),
    ...(request.model_config.reasoning_effort !== undefined
      ? { reasoning: { effort: request.model_config.reasoning_effort } }
      : {})
  } satisfies Record<string, unknown>;
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

function refusalFromResponse(response: Record<string, unknown>) {
  if (!Array.isArray(response.output)) return undefined;
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    const refusal = content.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as { type?: unknown }).type === "refusal"
    ) as { refusal?: unknown } | undefined;
    if (typeof refusal?.refusal === "string") return refusal.refusal;
  }
  return undefined;
}

export async function executeItemDesignMultimodalStructured<TInput, TOutput>(input: {
  request: StructuredAgentRequest<TInput, TOutput>;
  attachments: ItemDesignMultimodalAttachment[];
}): Promise<StructuredAgentResult<TOutput>> {
  const startedAt = Date.now();
  try {
    const client = createOpenAIClient();
    const body = compileItemDesignMultimodalRequestBody(input);
    const { data, request_id: requestId } = await client.responses
      .create(body as Parameters<typeof client.responses.create>[0], {
        timeout: input.request.timeout_ms,
        maxRetries: 0,
        idempotencyKey: input.request.client_request_id
      })
      .withResponse();
    const response = data as unknown as Record<string, unknown>;
    const normalized = normalizeOpenAIResponsesResult({
      sdkResponse: response,
      providerRequestId: requestId ?? null,
      responseBodyReceived: true,
      modelSnapshot: input.request.model_config.model_name
    });
    const usage = normalized.usage.status === "usage_verified"
      ? {
          input_tokens: normalized.usage.inputTokens ?? undefined,
          output_tokens: normalized.usage.outputTokens ?? undefined,
          total_tokens: normalized.usage.totalTokens ?? undefined,
          reasoning_tokens: normalized.usage.reasoningTokens ?? undefined,
          cached_input_tokens: normalized.usage.cachedInputTokens ?? undefined,
          raw: response.usage
        }
      : undefined;
    const providerResponseId = typeof response.id === "string" ? response.id : undefined;
    const status = String(response.status ?? "completed");
    const refusal = normalized.rawOutput.refusal ?? refusalFromResponse(response);

    if (refusal) {
      return {
        provider: "openai",
        provider_request_id: requestId ?? undefined,
        provider_response_id: providerResponseId,
        client_request_id: input.request.client_request_id,
        status: "refused",
        refusal,
        raw_output: rawAuditResponse(response),
        usage,
        latency_ms: Date.now() - startedAt
      };
    }

    if (status === "incomplete") {
      const incompleteDetails = response.incomplete_details;
      const reason = incompleteDetails && typeof incompleteDetails === "object"
        ? String((incompleteDetails as { reason?: unknown }).reason ?? "incomplete")
        : "incomplete";
      return {
        provider: "openai",
        provider_request_id: requestId ?? undefined,
        provider_response_id: providerResponseId,
        client_request_id: input.request.client_request_id,
        status: "incomplete",
        incomplete_reason: reason,
        raw_output: rawAuditResponse(response),
        usage,
        latency_ms: Date.now() - startedAt
      };
    }

    if (status !== "completed") {
      return {
        provider: "openai",
        provider_request_id: requestId ?? undefined,
        provider_response_id: providerResponseId,
        client_request_id: input.request.client_request_id,
        status: "failed",
        raw_output: rawAuditResponse(response),
        usage,
        latency_ms: Date.now() - startedAt,
        error: {
          category: "unexpected_provider_response",
          message: `OpenAI response ended with status ${status}.`,
          retryable: false
        }
      };
    }

    const parsed = parseOpenAIResponsesStructuredOutput(
      response,
      input.request.output_schema
    );
    if (!parsed.success) {
      return {
        provider: "openai",
        provider_request_id: requestId ?? undefined,
        provider_response_id: providerResponseId,
        client_request_id: input.request.client_request_id,
        status: "failed",
        raw_output: rawAuditResponse(response),
        usage,
        latency_ms: Date.now() - startedAt,
        error: {
          category: "schema_validation",
          message: "OpenAI structured output failed local schema validation.",
          retryable: false
        }
      };
    }

    return {
      provider: "openai",
      provider_request_id: requestId ?? undefined,
      provider_response_id: providerResponseId,
      client_request_id: input.request.client_request_id,
      status: "completed",
      parsed_output: parsed.data,
      raw_output: rawAuditResponse(response),
      usage,
      latency_ms: Date.now() - startedAt
    };
  } catch (error) {
    return {
      provider: "openai",
      client_request_id: input.request.client_request_id,
      status: "failed",
      latency_ms: Date.now() - startedAt,
      error: sanitizeUnknownError(error)
    };
  }
}
