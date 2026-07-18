import { E2ABudgetExceededError, E2ABudgetGuard } from "../src/lib/evaluation/formative/e2a-budget";

function expectBudgetBlock(action: () => void, reason: string) {
  try {
    action();
  } catch (error) {
    if (error instanceof E2ABudgetExceededError && error.reason_code === reason) return;
    throw error;
  }
  throw new Error(`expected_budget_block:${reason}`);
}

const limits = {
  maximum_sessions: 1,
  maximum_simulator_calls: 1,
  maximum_total_provider_calls: 2,
  maximum_total_input_tokens: 10,
  maximum_total_output_tokens: 10,
  maximum_cost_usd: 1
};

function main() {
  const sessions = new E2ABudgetGuard(limits);
  sessions.startSession(1);
  expectBudgetBlock(() => sessions.startSession(1), "e2a_session_cap_reached");

  const calls = new E2ABudgetGuard(limits);
  calls.recordSimulatorCall({ input_tokens: 1, output_tokens: 1 });
  expectBudgetBlock(() => calls.assertCanCallSimulator({ estimated_input_tokens: 1, maximum_output_tokens: 1 }), "e2a_simulator_call_cap_reached");

  const total = new E2ABudgetGuard({ ...limits, maximum_simulator_calls: 3 });
  total.recordOperationalUsage({ provider_calls: 2, input_tokens: 1, output_tokens: 1 });
  expectBudgetBlock(() => total.assertCanCallSimulator({ estimated_input_tokens: 1, maximum_output_tokens: 1 }), "e2a_total_provider_call_cap_reached");

  const inputTokens = new E2ABudgetGuard({ ...limits, maximum_simulator_calls: 3, maximum_total_provider_calls: 3 });
  inputTokens.recordOperationalUsage({ provider_calls: 1, input_tokens: 10, output_tokens: 0 });
  expectBudgetBlock(() => inputTokens.assertCanCallSimulator({ estimated_input_tokens: 1, maximum_output_tokens: 1 }), "e2a_input_token_cap_reached");

  const outputTokens = new E2ABudgetGuard({ ...limits, maximum_simulator_calls: 3, maximum_total_provider_calls: 3 });
  outputTokens.recordOperationalUsage({ provider_calls: 1, input_tokens: 0, output_tokens: 10 });
  expectBudgetBlock(() => outputTokens.assertCanCallSimulator({ estimated_input_tokens: 1, maximum_output_tokens: 1 }), "e2a_output_token_cap_reached");

  const cost = new E2ABudgetGuard({ ...limits, maximum_simulator_calls: 3, maximum_total_provider_calls: 3 }, true);
  expectBudgetBlock(() => cost.recordOperationalUsage({ provider_calls: 1, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 1.01 }), "e2a_cost_cap_exceeded");

  const unavailable = new E2ABudgetGuard(limits);
  unavailable.recordOperationalUsage({ provider_calls: 1, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0.5 });
  if (unavailable.snapshot().estimated_cost_status !== "unavailable") throw new Error("partial_pricing_must_remain_unavailable");

  console.log(JSON.stringify({ status: "passed", session_cap: true, simulator_call_cap: true, total_call_cap: true, token_caps: true, cost_cap_when_priced: true, unavailable_cost_not_fabricated: true, provider_calls: 0 }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "E2A budget smoke failed.");
  process.exitCode = 1;
}
