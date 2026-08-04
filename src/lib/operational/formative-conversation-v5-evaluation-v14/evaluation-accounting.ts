export const FORMATIVE_CONVERSATION_V14_EVALUATION_ACCOUNTING_VERSION =
  "formative-conversation-v14-evaluation-accounting-v1";

type EvaluationAccountingBudget = {
  expected_logical_call_count: number;
  maximum_logical_call_count: number;
  maximum_provider_attempt_count: number;
  maximum_semantic_regeneration_count: number;
};

type EvaluationAccountingLedger = {
  logical_calls_used: number;
  adapter_attempts_used: number;
  base_calls_completed: number;
  semantic_regeneration_calls_completed: number;
};

export function summarizeFormativeConversationV14EvaluationAccounting(input: {
  budget: EvaluationAccountingBudget;
  ledger: EvaluationAccountingLedger;
}) {
  const semanticRegenerationCallsAllowed =
    input.budget.maximum_semantic_regeneration_count;
  const transportRetriesAllowed =
    input.budget.maximum_provider_attempt_count -
    input.budget.maximum_logical_call_count;
  const transportRetriesUsed = Math.max(
    0,
    input.ledger.adapter_attempts_used - input.ledger.logical_calls_used
  );
  const recoveryCallsAllowed =
    semanticRegenerationCallsAllowed + transportRetriesAllowed;
  const recoveryCallsUsed =
    input.ledger.semantic_regeneration_calls_completed +
    transportRetriesUsed;
  const baseCallGraphComplete =
    input.ledger.base_calls_completed ===
    input.budget.expected_logical_call_count;
  const recoveryWithinBudget =
    input.ledger.semantic_regeneration_calls_completed <=
      semanticRegenerationCallsAllowed &&
    transportRetriesUsed <= transportRetriesAllowed &&
    recoveryCallsUsed <= recoveryCallsAllowed;

  return {
    accounting_version:
      FORMATIVE_CONVERSATION_V14_EVALUATION_ACCOUNTING_VERSION,
    base_calls_expected: input.budget.expected_logical_call_count,
    base_calls_completed: input.ledger.base_calls_completed,
    recovery_calls_allowed: recoveryCallsAllowed,
    recovery_calls_used: recoveryCallsUsed,
    semantic_regeneration_calls_allowed:
      semanticRegenerationCallsAllowed,
    semantic_regeneration_calls_used:
      input.ledger.semantic_regeneration_calls_completed,
    transport_retries_allowed: transportRetriesAllowed,
    transport_retries_used: transportRetriesUsed,
    total_logical_calls: input.ledger.logical_calls_used,
    total_provider_attempts: input.ledger.adapter_attempts_used,
    base_call_graph_complete: baseCallGraphComplete,
    recovery_within_budget: recoveryWithinBudget,
    execution_accounting_complete:
      baseCallGraphComplete && recoveryWithinBudget
  };
}
