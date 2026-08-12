import type { FormativeConversationV17EvaluationLedger } from "./candidate-runner";
import type { FormativeConversationV17Budget } from "./contracts";

export function summarizeFormativeConversationV17EvaluationAccounting(input: {
  budget: FormativeConversationV17Budget;
  ledger: FormativeConversationV17EvaluationLedger;
}) {
  const baseProfilingComplete =
    input.ledger.base_profiling_calls_completed ===
    input.budget.base_profiling_call_count;
  const baseFormativeComplete =
    input.ledger.base_formative_calls_completed ===
    input.budget.base_formative_call_count;
  return {
    accounting_version: "formative-conversation-v17-evaluation-accounting-v1",
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
    total_logical_calls: input.ledger.logical_calls_used,
    total_provider_attempts: input.ledger.adapter_attempts_used,
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
      input.ledger.logical_calls_used <=
        input.budget.maximum_logical_call_count &&
      input.ledger.adapter_attempts_used <=
        input.budget.maximum_provider_attempt_count
  } as const;
}
