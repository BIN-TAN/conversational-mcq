import { loadEnvConfig } from "@next/env";
import {
  executeLiveE2A8Canary,
  inspectE2A8Preflight,
  resolveE2A8Budget,
  type E2A8Budget
} from "@/lib/evaluation/formative/e2a8-v6-topic-dialogue-canary";
import { E2A7_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a7-topic-dialogue-mode-candidate";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string) {
  if (argument(name) !== expected) {
    throw new Error(`e2a8_confirmation_mismatch:${name}`);
  }
}

function requireBudgetArguments(budget: E2A8Budget) {
  requireArgument("--max-cases", String(budget.maximum_cases));
  requireArgument(
    "--max-initial-calls",
    String(budget.maximum_initial_generation_calls)
  );
  requireArgument(
    "--max-regeneration-calls",
    String(budget.maximum_regeneration_calls)
  );
  requireArgument(
    "--max-total-calls",
    String(budget.maximum_total_generation_calls)
  );
  requireArgument("--max-input-tokens", String(budget.maximum_input_tokens));
  requireArgument("--max-output-tokens", String(budget.maximum_output_tokens));
  requireArgument(
    "--max-cost-usd",
    String(budget.maximum_estimated_cost_usd)
  );
}

async function main() {
  if (!process.argv.includes("--confirm-paid-provider-canary")) {
    throw new Error("e2a8_paid_provider_confirmation_missing");
  }
  requireArgument("--candidate-hash", E2A7_CANDIDATE_HASH);
  requireBudgetArguments(resolveE2A8Budget());
  const preflight = await inspectE2A8Preflight({
    requireLiveEnvironment: true,
    requireCleanTree: true
  });
  if (!preflight.passed) {
    throw new Error(`e2a8_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const result = await executeLiveE2A8Canary();
  console.log(JSON.stringify({
    status: result.summary.final_status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: E2A7_CANDIDATE_HASH,
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
    estimated_cost_usd:
      result.summary.provider_usage.estimated_cost_usd,
    human_review_status: result.summary.human_review_status,
    candidate_approved: false,
    candidate_activated: false,
    thirty_case_evaluation_executed: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a8_live_canary_failed");
  process.exitCode = 1;
});
