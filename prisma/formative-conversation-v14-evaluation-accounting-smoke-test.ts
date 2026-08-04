import assert from "node:assert/strict";
import {
  FORMATIVE_CONVERSATION_V14_EVALUATION_ACCOUNTING_VERSION,
  summarizeFormativeConversationV14EvaluationAccounting
} from "../src/lib/operational/formative-conversation-v5-evaluation-v14/evaluation-accounting";

const budget = {
  expected_logical_call_count: 21,
  maximum_logical_call_count: 29,
  maximum_provider_attempt_count: 87,
  maximum_semantic_regeneration_count: 8
};

function main() {
  const v13Observed =
    summarizeFormativeConversationV14EvaluationAccounting({
      budget,
      ledger: {
        logical_calls_used: 23,
        adapter_attempts_used: 24,
        base_calls_completed: 21,
        semantic_regeneration_calls_completed: 2
      }
    });
  assert.equal(v13Observed.base_calls_expected, 21);
  assert.equal(v13Observed.base_calls_completed, 21);
  assert.equal(v13Observed.semantic_regeneration_calls_used, 2);
  assert.equal(v13Observed.transport_retries_used, 1);
  assert.equal(v13Observed.recovery_calls_used, 3);
  assert.equal(v13Observed.recovery_calls_allowed, 66);
  assert.equal(v13Observed.total_provider_attempts, 24);
  assert.equal(v13Observed.base_call_graph_complete, true);
  assert.equal(v13Observed.execution_accounting_complete, true);

  const incompleteBase =
    summarizeFormativeConversationV14EvaluationAccounting({
      budget,
      ledger: {
        logical_calls_used: 22,
        adapter_attempts_used: 23,
        base_calls_completed: 20,
        semantic_regeneration_calls_completed: 2
      }
    });
  assert.equal(incompleteBase.base_call_graph_complete, false);
  assert.equal(incompleteBase.execution_accounting_complete, false);

  const exhaustedRecovery =
    summarizeFormativeConversationV14EvaluationAccounting({
      budget,
      ledger: {
        logical_calls_used: 30,
        adapter_attempts_used: 89,
        base_calls_completed: 21,
        semantic_regeneration_calls_completed: 9
      }
    });
  assert.equal(exhaustedRecovery.recovery_within_budget, false);
  assert.equal(exhaustedRecovery.execution_accounting_complete, false);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        accounting_version:
          FORMATIVE_CONVERSATION_V14_EVALUATION_ACCOUNTING_VERSION,
        base_calls_expected: v13Observed.base_calls_expected,
        base_calls_completed: v13Observed.base_calls_completed,
        recovery_calls_allowed: v13Observed.recovery_calls_allowed,
        recovery_calls_used: v13Observed.recovery_calls_used,
        total_provider_attempts: v13Observed.total_provider_attempts,
        authorized_recovery_preserves_base_completion: true,
        incomplete_base_rejected: true,
        recovery_overrun_rejected: true,
        provider_calls: 0,
        model_auth_requests: 0,
        network_requests: 0
      },
      null,
      2
    )
  );
}

main();
