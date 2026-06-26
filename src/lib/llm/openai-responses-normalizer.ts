import { createHash } from "node:crypto";
import { calculateEvalCostUsd, getEvalPricingEntry } from "@/lib/services/evals/pricing";

export type OpenAIResponsesUsageStatus =
  | "usage_verified"
  | "usage_missing_after_response"
  | "usage_malformed";

export type OpenAIResponsesRawOutputOutcome =
  | "valid"
  | "schema_invalid"
  | "semantic_invalid"
  | "safety_invalid"
  | "refused"
  | "incomplete"
  | "missing"
  | "unknown";

export type OpenAIResponsesTransportOutcome =
  | "live_provider_success"
  | "live_provider_error"
  | "no_dispatch"
  | "unknown";

export type OpenAIResponsesEffectiveOutcome =
  | "provider_output_used"
  | "canonicalized_provider_output_used"
  | "deterministic_fallback_used"
  | "blocked"
  | "unusable";

export type OpenAIResponsesFallbackReason =
  | "provider_output_schema_invalid"
  | "provider_output_semantic_invalid"
  | "provider_output_safety_invalid"
  | "provider_output_refused"
  | "provider_output_incomplete"
  | "provider_output_missing"
  | "provider_usage_unverified"
  | "operational_canonicalization_failed"
  | "unexpected_post_response_error";

type JsonPathValue = {
  path: string;
  value: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function valueAtPath(root: unknown, path: string): JsonPathValue | null {
  const parts = path.split(".");
  let current = root;
  for (const part of parts) {
    const currentRecord = record(current);
    if (!currentRecord || !(part in currentRecord)) {
      return null;
    }
    current = currentRecord[part];
  }
  return { path, value: current };
}

function firstFinite(root: unknown, paths: string[]) {
  for (const path of paths) {
    const found = valueAtPath(root, path);
    const value = finiteInteger(found?.value);
    if (found && value !== null) {
      return { value, path };
    }
  }
  return { value: null, path: null };
}

function firstExistingPath(root: unknown, paths: string[]) {
  return paths.find((path) => valueAtPath(root, path) !== null) ?? null;
}

function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      return nested;
    }
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    );
  });
}

export function hashOpenAIResponseEvidence(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function outputTextFromResponse(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") {
    return {
      outputText: response.output_text,
      outputTextPath: "output_text"
    };
  }

  for (const [outputIndex, item] of array(response.output).entries()) {
    const itemRecord = record(item);
    for (const [contentIndex, content] of array(itemRecord?.content).entries()) {
      const contentRecord = record(content);
      const type = contentRecord?.type;
      if ((type === "output_text" || type === "text") && typeof contentRecord?.text === "string") {
        return {
          outputText: contentRecord.text,
          outputTextPath: `output.${outputIndex}.content.${contentIndex}.text`
        };
      }
    }
  }

  return {
    outputText: null,
    outputTextPath: null
  };
}

function refusalFromResponse(response: Record<string, unknown>) {
  for (const [outputIndex, item] of array(response.output).entries()) {
    const itemRecord = record(item);
    for (const [contentIndex, content] of array(itemRecord?.content).entries()) {
      const contentRecord = record(content);
      if (contentRecord?.type === "refusal" && typeof contentRecord.refusal === "string") {
        return {
          refusal: contentRecord.refusal,
          refusalPath: `output.${outputIndex}.content.${contentIndex}.refusal`
        };
      }
    }
  }
  return {
    refusal: null,
    refusalPath: null
  };
}

const usagePathAttempts = {
  inputTokens: ["usage.input_tokens", "usage.inputTokens"],
  cachedInputTokens: [
    "usage.input_tokens_details.cached_tokens",
    "usage.input_token_details.cached_tokens",
    "usage.cached_input_tokens",
    "usage.cachedInputTokens"
  ],
  outputTokens: ["usage.output_tokens", "usage.outputTokens"],
  reasoningTokens: [
    "usage.output_tokens_details.reasoning_tokens",
    "usage.output_token_details.reasoning_tokens",
    "usage.reasoning_tokens",
    "usage.reasoningTokens"
  ],
  totalTokens: ["usage.total_tokens", "usage.totalTokens"]
} as const;

export function normalizeOpenAIResponsesResult(input: {
  sdkResponse: unknown;
  providerRequestId?: string | null;
  httpStatus?: number | null;
  responseBodyReceived?: boolean;
  modelSnapshot?: string | null;
}) {
  const response = record(input.sdkResponse) ?? {};
  const responseId = typeof response.id === "string" ? response.id : null;
  const responseStatus = typeof response.status === "string" ? response.status : null;
  const incompleteDetails = response.incomplete_details ?? null;
  const providerError = response.error ?? null;
  const { outputText, outputTextPath } = outputTextFromResponse(response);
  const parsedOutput = response.output_parsed ?? null;
  const parsedOutputPath = "output_parsed" in response ? "output_parsed" : null;
  const { refusal, refusalPath } = refusalFromResponse(response);

  const inputTokens = firstFinite(response, [...usagePathAttempts.inputTokens]);
  const cachedInputTokens = firstFinite(response, [...usagePathAttempts.cachedInputTokens]);
  const outputTokens = firstFinite(response, [...usagePathAttempts.outputTokens]);
  const reasoningTokens = firstFinite(response, [...usagePathAttempts.reasoningTokens]);
  const totalTokens = firstFinite(response, [...usagePathAttempts.totalTokens]);
  const usageRootPath = record(response.usage) ? firstExistingPath(response, ["usage"]) : null;
  const usageSourcePaths = [
    usageRootPath,
    inputTokens.path,
    cachedInputTokens.path,
    outputTokens.path,
    reasoningTokens.path,
    totalTokens.path
  ].filter((value): value is string => Boolean(value));
  const usageExists = Boolean(usageRootPath);
  const usageMalformed =
    usageExists &&
    (
      inputTokens.value === null ||
      outputTokens.value === null ||
      totalTokens.value === null ||
      totalTokens.value !== inputTokens.value + outputTokens.value ||
      (cachedInputTokens.value !== null && cachedInputTokens.value > inputTokens.value) ||
      (reasoningTokens.value !== null && reasoningTokens.value > outputTokens.value)
    );
  const usageStatus: OpenAIResponsesUsageStatus = usageMalformed
    ? "usage_malformed"
    : usageExists && inputTokens.value !== null && outputTokens.value !== null && totalTokens.value !== null
      ? "usage_verified"
      : "usage_missing_after_response";
  const pricing = input.modelSnapshot ? getEvalPricingEntry(input.modelSnapshot) : null;
  const estimatedCostUsd =
    usageStatus === "usage_verified" && input.modelSnapshot && pricing
      ? calculateEvalCostUsd({
          model_snapshot: input.modelSnapshot,
          input_tokens: inputTokens.value,
          cached_input_tokens: cachedInputTokens.value,
          output_tokens: outputTokens.value
        })
      : null;

  const rawOutputOutcome: OpenAIResponsesRawOutputOutcome = refusal
    ? "refused"
    : responseStatus === "incomplete"
      ? "incomplete"
      : parsedOutput !== null || outputText
        ? "valid"
        : providerError
          ? "unknown"
          : "missing";
  const transportOutcome: OpenAIResponsesTransportOutcome = providerError
    ? "live_provider_error"
    : responseId || input.providerRequestId || input.responseBodyReceived
      ? "live_provider_success"
      : "unknown";

  return {
    transport: {
      provider: "openai" as const,
      transport: "openai_responses" as const,
      requestId: input.providerRequestId ?? null,
      responseId,
      responseStatus,
      acknowledged: Boolean(input.providerRequestId || responseId || input.responseBodyReceived),
      responseBodyReceived: Boolean(input.responseBodyReceived)
    },
    rawOutput: {
      exists: parsedOutput !== null || Boolean(outputText) || Boolean(refusal) || Boolean(providerError),
      outputText,
      outputTextPath,
      parsedOutput,
      parsedOutputPath,
      refusal,
      refusalPath,
      providerError,
      responseStatus,
      incompleteDetails,
      outcome: rawOutputOutcome,
      rawResponseHash: hashOpenAIResponseEvidence(input.sdkResponse)
    },
    usage: {
      status: usageStatus,
      inputTokens: inputTokens.value,
      cachedInputTokens: cachedInputTokens.value,
      outputTokens: outputTokens.value,
      reasoningTokens: reasoningTokens.value,
      totalTokens: totalTokens.value,
      sourcePaths: usageSourcePaths,
      attemptedPaths: usagePathAttempts,
      internallyConsistent: usageStatus === "usage_verified",
      pricingRegistryVersion: pricing?.pricing_registry_version ?? null,
      pricingFound: Boolean(pricing),
      calculatedCostUsd: estimatedCostUsd
    },
    outcomes: {
      transportOutcome,
      rawOutputOutcome,
      effectiveSystemOutcome: "provider_output_used" as OpenAIResponsesEffectiveOutcome,
      fallbackReason: null as OpenAIResponsesFallbackReason | null
    },
    sanitizedResponseMetadata: {
      id_present: Boolean(responseId),
      status: responseStatus,
      model: typeof response.model === "string" ? response.model : null,
      output_count: array(response.output).length,
      output_text_present: Boolean(outputText),
      output_parsed_present: parsedOutput !== null,
      refusal_present: Boolean(refusal),
      provider_error_present: Boolean(providerError),
      usage_present: usageExists,
      incomplete_details_present: Boolean(incompleteDetails)
    }
  };
}
