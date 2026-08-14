import assert from "node:assert/strict";
import { FormativeConversationV18BudgetSchema } from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/contracts";
import type { FormativeConversationV18EvaluationLedger } from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/candidate-runner";
import { summarizeFormativeConversationV18EvaluationAccounting } from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/evaluation-accounting";

const budget = FormativeConversationV18BudgetSchema.parse({
  profiling_contract_base_call_count: 3,
  formative_comparability_base_call_count: 21,
  end_to_end_profiling_base_call_count: 1,
  end_to_end_formative_base_call_count: 3,
  end_to_end_base_call_count: 4,
  base_profiling_call_count: 4,
  base_formative_call_count: 24,
  expected_logical_call_count: 28,
  maximum_semantic_regeneration_count: 28,
  maximum_logical_call_count: 56,
  expected_provider_attempt_count: 28,
  maximum_provider_attempt_count: 168,
  maximum_transport_retries_per_logical_call: 2,
  maximum_input_token_count: 1_800_000,
  maximum_output_token_count: 368_000,
  maximum_total_token_count: 2_168_000,
  maximum_wall_clock_duration_ms: 7_200_000,
  maximum_concurrency: 1,
  maximum_cost_usd: 60,
  pricing_metadata_status: "unavailable",
  cost_enforcement:
    "operator_ceiling_required_actual_estimate_recorded_when_available",
  maximum_semantic_regenerations_per_agent_call: 1
});

const ledger: FormativeConversationV18EvaluationLedger = {
  ledger_version: "formative-conversation-v18r2-evaluation-ledger-v1",
  evaluation_id: "v18r2-accounting-no-provider",
  started_at: new Date(0).toISOString(),
  completed_at: new Date(1).toISOString(),
  planned_base_logical_calls: 28,
  logical_calls_entered: 30,
  base_profiling_calls_started: 4,
  base_profiling_calls_completed: 4,
  base_formative_calls_started: 24,
  base_formative_calls_completed: 24,
  pre_dispatch_request_rejections: 0,
  http_requests_dispatched: 0,
  provider_responses_completed: 30,
  transport_retries: 0,
  incomplete_or_truncated_outputs: 0,
  parsed_candidates: 30,
  semantic_regeneration_calls_started: 2,
  semantic_regeneration_calls_completed: 2,
  semantically_accepted_candidates: 28,
  persisted_transitions: 3,
  provider_attempts_used: 30,
  reserved_input_tokens: 100_000,
  reserved_output_tokens: 210_000,
  actual_input_tokens: 80_000,
  actual_output_tokens: 60_000,
  actual_total_tokens: 140_000,
  estimated_cost_usd: null,
  maximum_concurrency_observed: 1,
  active_calls: 0,
  attempts: []
};

const summary = summarizeFormativeConversationV18EvaluationAccounting({
  budget,
  ledger
});

assert.equal(summary.base_calls_expected, 28);
assert.equal(summary.base_calls_completed, 28);
assert.equal(summary.recovery_calls_allowed, 28);
assert.equal(summary.recovery_calls_used, 2);
assert.equal(summary.total_logical_calls, 30);
assert.equal(summary.total_provider_attempts, 30);
assert.equal(summary.persisted_transitions, 3);
assert.equal(summary.base_call_graph_complete, true);
assert.equal(summary.recovery_within_budget, true);
assert.equal(summary.execution_accounting_complete, true);

const continueOnly = summarizeFormativeConversationV18EvaluationAccounting({
  budget,
  ledger: {
    ...ledger,
    logical_calls_entered: 28,
    provider_responses_completed: 28,
    parsed_candidates: 28,
    semantic_regeneration_calls_started: 0,
    semantic_regeneration_calls_completed: 0,
    semantically_accepted_candidates: 28,
    persisted_transitions: 0,
    provider_attempts_used: 28
  }
});

assert.equal(continueOnly.base_call_graph_complete, true);
assert.equal(continueOnly.persisted_transitions, 0);
assert.equal(continueOnly.execution_accounting_complete, true);

console.log(
  JSON.stringify({
    status: "passed",
    base_calls_reported_separately: true,
    recovery_calls_reported_separately: true,
    valid_continue_counts_as_accepted_without_transition: true,
    provider_calls: 0,
    model_auth_requests: 0,
    network_requests: 0,
    dispatch_checkpoints: 0
  })
);
