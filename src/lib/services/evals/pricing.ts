import { EVAL_CANARY_MODEL_SNAPSHOT } from "./canary-config";

export type EvalPricingEntry = {
  pricing_registry_version: string;
  model_snapshot: string;
  input_price_per_million_tokens: number;
  cached_input_price_per_million_tokens: number;
  output_price_per_million_tokens: number;
  effective_date: string;
  source_checked_at: string;
  source_url: string;
};

export const EVAL_PRICING_REGISTRY_VERSION = "openai-pricing-2026-06-22-v1";

const registry: EvalPricingEntry[] = [
  {
    pricing_registry_version: EVAL_PRICING_REGISTRY_VERSION,
    model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
    input_price_per_million_tokens: 0.75,
    cached_input_price_per_million_tokens: 0.075,
    output_price_per_million_tokens: 4.5,
    effective_date: "2026-06-22",
    source_checked_at: "2026-06-22",
    source_url: "https://developers.openai.com/api/docs/models/gpt-5.4-mini"
  }
];

export function getEvalPricingEntry(modelSnapshot: string) {
  return registry.find((entry) => entry.model_snapshot === modelSnapshot) ?? null;
}

export function calculateEvalCostUsd(input: {
  model_snapshot: string;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
}) {
  const pricing = getEvalPricingEntry(input.model_snapshot);

  if (!pricing) {
    throw new Error(`No evaluation pricing entry exists for ${input.model_snapshot}.`);
  }

  const inputTokens = Math.max(0, input.input_tokens ?? 0);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, input.cached_input_tokens ?? 0));
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = Math.max(0, input.output_tokens ?? 0);
  const inputCost =
    (uncachedInputTokens / 1_000_000) * pricing.input_price_per_million_tokens;
  const cachedInputCost =
    (cachedInputTokens / 1_000_000) * pricing.cached_input_price_per_million_tokens;
  const outputCost =
    (outputTokens / 1_000_000) * pricing.output_price_per_million_tokens;

  return inputCost + cachedInputCost + outputCost;
}

export function estimateTokensFromText(text: string) {
  return Math.max(1, Math.ceil(text.length / 3));
}

export function estimateEvalRequestUpperBoundUsd(input: {
  model_snapshot: string;
  instructions: string;
  payload: unknown;
  max_output_tokens: number;
  retry_allowance: number;
}) {
  const inputText = `${input.instructions}\n${JSON.stringify(input.payload)}`;
  const estimatedInputTokens = estimateTokensFromText(inputText);
  const singleAttempt = calculateEvalCostUsd({
    model_snapshot: input.model_snapshot,
    input_tokens: estimatedInputTokens,
    cached_input_tokens: 0,
    output_tokens: input.max_output_tokens
  });

  return {
    estimated_input_tokens: estimatedInputTokens,
    max_output_tokens: input.max_output_tokens,
    retry_allowance: input.retry_allowance,
    estimated_upper_bound_usd: singleAttempt * (1 + input.retry_allowance),
    pricing: getEvalPricingEntry(input.model_snapshot)
  };
}
