import type { EvalPricingEntry } from "./pricing";
import { calculateEvalCostUsd, estimateEvalRequestUpperBoundUsd } from "./pricing";

export type EvalBudgetState = {
  hard_limit_usd: number;
  estimated_cost_usd: number;
  provider_request_count: number;
  max_provider_requests: number;
  pricing: EvalPricingEntry;
};

export type EvalBudgetReservation = {
  estimated_input_tokens: number;
  max_output_tokens: number;
  retry_allowance: number;
  reserved_cost_usd: number;
  reserved_provider_requests: number;
};

export function reserveEvalBudget(input: {
  state: EvalBudgetState;
  model_snapshot: string;
  instructions: string;
  payload: unknown;
  max_output_tokens: number;
  retry_allowance: number;
}) {
  const upperBound = estimateEvalRequestUpperBoundUsd({
    model_snapshot: input.model_snapshot,
    instructions: input.instructions,
    payload: input.payload,
    max_output_tokens: input.max_output_tokens,
    retry_allowance: input.retry_allowance
  });
  const reservedProviderRequests = 1 + input.retry_allowance;
  const projectedCost = input.state.estimated_cost_usd + upperBound.estimated_upper_bound_usd;
  const projectedRequests = input.state.provider_request_count + reservedProviderRequests;

  if (projectedCost > input.state.hard_limit_usd) {
    return {
      ok: false as const,
      reason: "cost_limit_exceeded",
      message: "The conservative projected request cost would exceed the evaluation hard limit.",
      projected_cost_usd: projectedCost,
      projected_provider_requests: projectedRequests,
      reservation: {
        estimated_input_tokens: upperBound.estimated_input_tokens,
        max_output_tokens: upperBound.max_output_tokens,
        retry_allowance: upperBound.retry_allowance,
        reserved_cost_usd: upperBound.estimated_upper_bound_usd,
        reserved_provider_requests: reservedProviderRequests
      } satisfies EvalBudgetReservation
    };
  }

  if (projectedRequests > input.state.max_provider_requests) {
    return {
      ok: false as const,
      reason: "provider_request_limit_exceeded",
      message: "The request plus retry allowance would exceed EVAL_MAX_PROVIDER_REQUESTS.",
      projected_cost_usd: projectedCost,
      projected_provider_requests: projectedRequests,
      reservation: {
        estimated_input_tokens: upperBound.estimated_input_tokens,
        max_output_tokens: upperBound.max_output_tokens,
        retry_allowance: upperBound.retry_allowance,
        reserved_cost_usd: upperBound.estimated_upper_bound_usd,
        reserved_provider_requests: reservedProviderRequests
      } satisfies EvalBudgetReservation
    };
  }

  return {
    ok: true as const,
    projected_cost_usd: projectedCost,
    projected_provider_requests: projectedRequests,
    reservation: {
      estimated_input_tokens: upperBound.estimated_input_tokens,
      max_output_tokens: upperBound.max_output_tokens,
      retry_allowance: upperBound.retry_allowance,
      reserved_cost_usd: upperBound.estimated_upper_bound_usd,
      reserved_provider_requests: reservedProviderRequests
    } satisfies EvalBudgetReservation
  };
}

export function costFromActualUsage(input: {
  model_snapshot: string;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
}) {
  if (
    typeof input.input_tokens !== "number" ||
    typeof input.output_tokens !== "number"
  ) {
    return {
      ok: false as const,
      reason: "usage_missing",
      message: "Provider usage was unavailable; budget cannot be verified."
    };
  }

  if (
    !Number.isFinite(input.input_tokens) ||
    !Number.isInteger(input.input_tokens) ||
    input.input_tokens < 0 ||
    !Number.isFinite(input.output_tokens) ||
    !Number.isInteger(input.output_tokens) ||
    input.output_tokens < 0 ||
    (input.cached_input_tokens !== null &&
      input.cached_input_tokens !== undefined &&
      (!Number.isFinite(input.cached_input_tokens) ||
        !Number.isInteger(input.cached_input_tokens) ||
        input.cached_input_tokens < 0))
  ) {
    return {
      ok: false as const,
      reason: "usage_malformed",
      message: "Provider usage contained invalid token counts; budget cannot be verified."
    };
  }

  return {
    ok: true as const,
    estimated_cost_usd: calculateEvalCostUsd(input)
  };
}
