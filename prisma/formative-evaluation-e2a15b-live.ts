import { loadEnvConfig } from "@next/env";
import {
  E2A15B_PROTOCOL_HASH,
  executeLiveE2A15BSupplement,
  resolveE2A15BBudget,
  type E2A15BBudget
} from "@/lib/evaluation/formative/e2a15b-protected-request-supplement";
import { E2A14_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a14-protected-request-validator-candidate";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string | number) {
  if (argument(name) !== String(expected)) {
    throw new Error(`e2a15b_confirmation_mismatch:${name}`);
  }
}

function requireBudget(budget: E2A15BBudget) {
  requireArgument("--max-cases", budget.maximum_cases);
  requireArgument("--max-initial-calls", budget.maximum_initial_generation_calls);
  requireArgument("--max-regeneration-calls", budget.maximum_regeneration_calls);
  requireArgument("--max-total-calls", budget.maximum_total_generation_calls);
  requireArgument("--max-provider-adapter-attempts",
    budget.maximum_provider_adapter_attempts);
  requireArgument("--max-input-tokens", budget.maximum_input_tokens);
  requireArgument("--max-output-tokens", budget.maximum_output_tokens);
  requireArgument("--max-cost-usd", budget.maximum_estimated_cost_usd);
}

async function main() {
  const requiredFlags = [
    "--confirm-paid-provider-evaluation",
    "--confirm-frozen-supplement-only",
    "--confirm-no-prior-case-rerun",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-stop-after-supplement"
  ];
  for (const flag of requiredFlags) {
    if (!process.argv.includes(flag)) {
      throw new Error(`e2a15b_confirmation_missing:${flag}`);
    }
  }
  requireArgument("--candidate-hash", E2A14_CANDIDATE_HASH);
  requireArgument("--protocol-hash", E2A15B_PROTOCOL_HASH);
  requireBudget(resolveE2A15BBudget());
  const checkpointCommit = argument("--checkpoint-commit");
  if (!checkpointCommit || !/^[a-f0-9]{40}$/u.test(checkpointCommit)) {
    throw new Error("e2a15b_checkpoint_commit_invalid");
  }
  const result = await executeLiveE2A15BSupplement({ checkpointCommit });
  console.log(JSON.stringify({
    status: result.finalSummary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: E2A14_CANDIDATE_HASH,
    protocol_hash: E2A15B_PROTOCOL_HASH,
    checkpoint_commit: checkpointCommit,
    provider_usage: result.finalSummary.provider_usage,
    review_item_count: result.reviewValidation.review_item_count,
    human_review_completed: false,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a15b_live_evaluation_failed");
  process.exitCode = 1;
});
