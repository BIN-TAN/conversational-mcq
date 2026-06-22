import {
  reserveEvalBudget,
  costFromActualUsage,
  type EvalBudgetState
} from "../src/lib/services/evals/budget-guard";
import { EVAL_CANARY_MODEL_SNAPSHOT } from "../src/lib/services/evals/canary-config";
import {
  calculateEvalCostUsd,
  getEvalPricingEntry,
  estimateEvalRequestUpperBoundUsd,
  EVAL_PRICING_REGISTRY_VERSION
} from "../src/lib/services/evals/pricing";
import { assert, liveCanarySmokeEnv, withCanaryEnv } from "./eval-live-canary-test-utils";

async function main() {
  await withCanaryEnv(liveCanarySmokeEnv, async () => {
    const pricing = getEvalPricingEntry(EVAL_CANARY_MODEL_SNAPSHOT);
    assert(pricing, "Exact snapshot pricing entry should resolve.");
    assert(pricing.pricing_registry_version === EVAL_PRICING_REGISTRY_VERSION, "Pricing registry should be versioned.");
    assert(Number(process.env.EVAL_COST_HARD_LIMIT_USD) === 50, "USD 50 hard limit should be loaded.");

    const upperBound = estimateEvalRequestUpperBoundUsd({
      model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
      instructions: "Synthetic instruction text.",
      payload: { synthetic: true, text: "short input" },
      max_output_tokens: 3000,
      retry_allowance: 1
    });
    assert(upperBound.estimated_upper_bound_usd > 0, "Upper-bound cost should be calculated.");

    const state: EvalBudgetState = {
      hard_limit_usd: 50,
      estimated_cost_usd: 49.999,
      provider_request_count: 0,
      max_provider_requests: 50,
      pricing
    };
    const blocked = reserveEvalBudget({
      state,
      model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
      instructions: "Synthetic instruction text.",
      payload: { synthetic: true },
      max_output_tokens: 3000,
      retry_allowance: 1
    });
    assert(!blocked.ok, "Request should be blocked when projected cost exceeds remaining budget.");

    const requestLimitBlocked = reserveEvalBudget({
      state: {
        hard_limit_usd: 50,
        estimated_cost_usd: 0,
        provider_request_count: 49,
        max_provider_requests: 50,
        pricing
      },
      model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
      instructions: "Synthetic instruction text.",
      payload: { synthetic: true },
      max_output_tokens: 10,
      retry_allowance: 1
    });
    assert(!requestLimitBlocked.ok, "Retries should count toward request limit.");

    const actual = costFromActualUsage({
      model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
      input_tokens: 1000,
      cached_input_tokens: 100,
      output_tokens: 500
    });
    assert(actual.ok && actual.estimated_cost_usd === calculateEvalCostUsd({
      model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
      input_tokens: 1000,
      cached_input_tokens: 100,
      output_tokens: 500
    }), "Actual usage should update estimated cost with registry pricing.");

    const missingUsage = costFromActualUsage({
      model_snapshot: EVAL_CANARY_MODEL_SNAPSHOT,
      input_tokens: null,
      output_tokens: null
    });
    assert(!missingUsage.ok && missingUsage.reason === "usage_missing", "Missing usage should pause budget verification.");

    assert(!String(actual.estimated_cost_usd).includes("billing"), "Mock token data should not be labeled actual billing.");
  });

  console.log("Evaluation budget smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
