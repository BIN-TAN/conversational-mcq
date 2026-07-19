import { loadEnvConfig } from "@next/env";
import {
  executeLiveE2A10Canary,
  inspectE2A10Preflight,
  resolveE2A10Budget,
  type E2A10Budget
} from "@/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary";
import { E2A9_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a9-topic-dialogue-operation-candidate";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string | number) {
  if (argument(name) !== String(expected)) {
    throw new Error(`e2a10_confirmation_mismatch:${name}`);
  }
}

function requireBudgetArguments(budget: E2A10Budget) {
  requireArgument("--max-cases", budget.maximum_cases);
  requireArgument("--max-initial-calls", budget.maximum_initial_generation_calls);
  requireArgument(
    "--max-regeneration-calls",
    budget.maximum_regeneration_calls
  );
  requireArgument("--max-total-calls", budget.maximum_total_generation_calls);
  requireArgument("--max-input-tokens", budget.maximum_input_tokens);
  requireArgument("--max-output-tokens", budget.maximum_output_tokens);
  requireArgument("--max-cost-usd", budget.maximum_estimated_cost_usd);
}

async function main() {
  if (!process.argv.includes("--confirm-paid-provider-canary")) {
    throw new Error("e2a10_paid_provider_confirmation_missing");
  }
  if (!process.argv.includes("--confirm-sequential-concurrency-one")) {
    throw new Error("e2a10_sequential_execution_confirmation_missing");
  }
  if (!process.argv.includes("--confirm-stop-after-canary")) {
    throw new Error("e2a10_stop_boundary_confirmation_missing");
  }
  requireArgument("--candidate-hash", E2A9_CANDIDATE_HASH);
  requireBudgetArguments(resolveE2A10Budget());
  const preflight = await inspectE2A10Preflight({
    requireLiveEnvironment: true,
    requireCleanTree: true
  });
  if (!preflight.passed) {
    throw new Error(`e2a10_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const result = await executeLiveE2A10Canary();
  console.log(JSON.stringify({
    status: result.summary.final_status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: E2A9_CANDIDATE_HASH,
    cases_dispatched: result.summary.initial_cases_dispatched,
    case_pass_count: result.summary.automated_case_pass_count,
    first_attempt_valid_count: result.summary.first_attempt_valid_count,
    candidate_validation_failure_count:
      result.summary.candidate_validation_failure_count,
    regeneration_count: result.summary.regeneration_count,
    regeneration_success_count: result.summary.regeneration_success_count,
    fallback_count: result.summary.fallback_count,
    generation_provider_calls:
      result.summary.provider_usage.generation_provider_calls,
    provider_adapter_attempts:
      result.summary.provider_usage.provider_adapter_attempts,
    metadata_only_requests:
      result.summary.provider_usage.metadata_only_requests,
    input_tokens: result.summary.provider_usage.input_tokens,
    output_tokens: result.summary.provider_usage.output_tokens,
    reasoning_tokens: result.summary.provider_usage.reasoning_tokens,
    estimated_cost_usd: result.summary.provider_usage.estimated_cost_usd,
    human_review_status: result.summary.human_review_status,
    candidate_approved: false,
    candidate_activated: false,
    thirty_case_evaluation_executed: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a10_live_canary_failed");
  process.exitCode = 1;
});
