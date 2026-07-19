import { loadEnvConfig } from "@next/env";
import {
  executeLiveE2A12Canary,
  inspectE2A12Preflight,
  resolveE2A12Budget,
  type E2A12Budget
} from "@/lib/evaluation/formative/e2a12-v8-runtime-canary";
import { E2A11_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a11-v8-validator-candidate";
import { E2A12_PROTOCOL_HASH } from
  "@/lib/evaluation/formative/e2a12-v8-held-out-protocol";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name: string, expected: string | number) {
  if (argument(name) !== String(expected)) {
    throw new Error(`e2a12_confirmation_mismatch:${name}`);
  }
}

function requireBudgetArguments(budget: E2A12Budget) {
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
    throw new Error("e2a12_paid_provider_confirmation_missing");
  }
  if (!process.argv.includes("--confirm-sequential-concurrency-one")) {
    throw new Error("e2a12_sequential_execution_confirmation_missing");
  }
  if (!process.argv.includes("--confirm-stop-after-canary")) {
    throw new Error("e2a12_stop_boundary_confirmation_missing");
  }
  requireArgument("--candidate-hash", E2A11_CANDIDATE_HASH);
  requireArgument("--protocol-hash", E2A12_PROTOCOL_HASH);
  requireBudgetArguments(resolveE2A12Budget());
  const preflight = await inspectE2A12Preflight({
    requireLiveEnvironment: true,
    requireCleanTrackedTree: true
  });
  if (!preflight.passed) {
    throw new Error(`e2a12_preflight_failed:${preflight.blockers.join(",")}`);
  }
  const result = await executeLiveE2A12Canary();
  console.log(JSON.stringify({
    status: result.summary.final_status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: E2A11_CANDIDATE_HASH,
    protocol_hash: E2A12_PROTOCOL_HASH,
    cases_dispatched: result.summary.initial_cases_dispatched,
    initial_schema_valid_count: result.summary.initial_schema_valid_count,
    runtime_accepted_count: result.summary.runtime_accepted_count,
    accepted_with_review_flags_count:
      result.summary.accepted_with_review_flags_count,
    hard_rejected_attempt_count:
      result.summary.hard_rejected_attempt_count,
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
  console.error(error instanceof Error ? error.message : "e2a12_live_canary_failed");
  process.exitCode = 1;
});
