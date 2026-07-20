import { loadEnvConfig } from "@next/env";
import {
  executeLiveE2A15Evaluation,
  resolveE2A15Budget,
  type E2A15Budget
} from "@/lib/evaluation/formative/e2a15-protected-request-subset";
import { E2A15_PROTOCOL_HASH } from
  "@/lib/evaluation/formative/e2a15-protected-request-subset-protocol";
import { E2A14_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a14-protected-request-validator-candidate";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string | number) {
  if (argument(name) !== String(expected)) {
    throw new Error(`e2a15_confirmation_mismatch:${name}`);
  }
}

function requireBudgetArguments(budget: E2A15Budget) {
  requireArgument("--max-cases", budget.maximum_cases);
  requireArgument("--max-initial-calls", budget.maximum_initial_generation_calls);
  requireArgument("--max-regeneration-calls", budget.maximum_regeneration_calls);
  requireArgument("--max-total-calls", budget.maximum_total_generation_calls);
  requireArgument("--max-input-tokens", budget.maximum_input_tokens);
  requireArgument("--max-output-tokens", budget.maximum_output_tokens);
  requireArgument("--max-cost-usd", budget.maximum_estimated_cost_usd);
  requireArgument(
    "--max-provider-adapter-attempts",
    budget.maximum_provider_adapter_attempts
  );
}

async function main() {
  const requiredConfirmations = [
    "--confirm-paid-provider-evaluation",
    "--confirm-protected-request-subset-only",
    "--confirm-immutable-e2a13-replay",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-stop-after-subset"
  ];
  for (const flag of requiredConfirmations) {
    if (!process.argv.includes(flag)) {
      throw new Error(`e2a15_confirmation_missing:${flag}`);
    }
  }
  requireArgument("--candidate-hash", E2A14_CANDIDATE_HASH);
  requireArgument("--protocol-hash", E2A15_PROTOCOL_HASH);
  requireBudgetArguments(resolveE2A15Budget());
  const result = await executeLiveE2A15Evaluation();
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: result.summary.candidate_hash,
    protocol_hash: result.summary.protocol_hash,
    protected_subset_case_count:
      result.summary.fresh_protected_request_case_count,
    provider_generation_calls:
      result.summary.provider_usage.generation_provider_calls,
    regeneration_count: result.summary.fresh_regeneration_count,
    fallback_count: result.summary.fresh_fallback_count,
    e2a13_replayed_attempt_count:
      result.summary.e2a13_replayed_attempt_count,
    e2a13_recomputed_case_count:
      result.summary.e2a13_recomputed_case_count,
    human_review_item_count: result.summary.human_review_item_count,
    human_review_status: result.summary.human_review_status,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error
    ? error.message
    : "e2a15_live_evaluation_failed");
  process.exitCode = 1;
});
