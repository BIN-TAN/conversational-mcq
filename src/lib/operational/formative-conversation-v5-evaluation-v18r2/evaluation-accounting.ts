import type { FormativeConversationV18EvaluationLedger } from "./candidate-runner";
import type { FormativeConversationV18Budget } from "./contracts";

export function summarizeFormativeConversationV18EvaluationAccounting(input: {
  budget: FormativeConversationV18Budget;
  ledger: FormativeConversationV18EvaluationLedger;
}) {
  const baseProfilingComplete =
    input.ledger.base_profiling_calls_completed ===
    input.budget.base_profiling_call_count;
  const baseFormativeComplete =
    input.ledger.base_formative_calls_completed ===
    input.budget.base_formative_call_count;
  return {
    accounting_version: "formative-conversation-v18r2-evaluation-accounting-v1",
    base_calls_expected: input.budget.expected_logical_call_count,
    base_calls_completed:
      input.ledger.base_profiling_calls_completed +
      input.ledger.base_formative_calls_completed,
    base_profiling_calls_expected: input.budget.base_profiling_call_count,
    base_profiling_calls_completed:
      input.ledger.base_profiling_calls_completed,
    base_formative_calls_expected: input.budget.base_formative_call_count,
    base_formative_calls_completed:
      input.ledger.base_formative_calls_completed,
    recovery_calls_allowed:
      input.budget.maximum_semantic_regeneration_count,
    recovery_calls_used:
      input.ledger.semantic_regeneration_calls_completed,
    total_logical_calls: input.ledger.logical_calls_entered,
    total_provider_attempts: input.ledger.provider_attempts_used,
    pre_dispatch_request_rejections:
      input.ledger.pre_dispatch_request_rejections,
    http_requests_dispatched: input.ledger.http_requests_dispatched,
    provider_responses_completed:
      input.ledger.provider_responses_completed,
    incomplete_or_truncated_outputs:
      input.ledger.incomplete_or_truncated_outputs,
    parsed_candidates: input.ledger.parsed_candidates,
    semantically_accepted_candidates:
      input.ledger.semantically_accepted_candidates,
    persisted_transitions: input.ledger.persisted_transitions,
    transport_retries: input.ledger.attempts.reduce(
      (total, attempt) =>
        total + (attempt.adapter_attempt_index > 1 ? 1 : 0),
      0
    ),
    base_call_graph_complete:
      baseProfilingComplete && baseFormativeComplete,
    recovery_within_budget:
      input.ledger.semantic_regeneration_calls_completed <=
      input.budget.maximum_semantic_regeneration_count,
    execution_accounting_complete:
      baseProfilingComplete &&
      baseFormativeComplete &&
      input.ledger.active_calls === 0 &&
      input.ledger.logical_calls_entered <=
        input.budget.maximum_logical_call_count &&
      input.ledger.provider_attempts_used <=
        input.budget.maximum_provider_attempt_count
  } as const;
}
