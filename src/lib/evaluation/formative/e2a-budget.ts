import {
  E2ABudgetUsageSchema,
  type E2ABudgetLimits,
  type E2ABudgetUsage
} from "./e2a-schemas";

export class E2ABudgetExceededError extends Error {
  constructor(readonly reason_code: string) {
    super(reason_code);
    this.name = "E2ABudgetExceededError";
  }
}

export class E2ABudgetGuard {
  private usage: E2ABudgetUsage = {
    sessions_attempted: 0,
    sessions_completed: 0,
    simulator_provider_calls: 0,
    operational_provider_calls: 0,
    total_provider_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: null,
    estimated_cost_status: "unavailable"
  };

  constructor(
    readonly limits: E2ABudgetLimits,
    private readonly pricingAvailable = false
  ) {}

  snapshot() {
    return E2ABudgetUsageSchema.parse(structuredClone(this.usage));
  }

  assertCanStartSession(estimatedProviderCalls = 30) {
    if (this.usage.sessions_attempted + 1 > this.limits.maximum_sessions) {
      throw new E2ABudgetExceededError("e2a_session_cap_reached");
    }
    if (this.usage.total_provider_calls + estimatedProviderCalls > this.limits.maximum_total_provider_calls) {
      throw new E2ABudgetExceededError("e2a_remaining_provider_call_budget_insufficient_for_session");
    }
  }

  startSession(estimatedProviderCalls = 30) {
    this.assertCanStartSession(estimatedProviderCalls);
    this.usage.sessions_attempted += 1;
  }

  completeSession() {
    this.usage.sessions_completed += 1;
  }

  assertCanCallSimulator(input: { estimated_input_tokens: number; maximum_output_tokens: number }) {
    if (this.usage.simulator_provider_calls + 1 > this.limits.maximum_simulator_calls) {
      throw new E2ABudgetExceededError("e2a_simulator_call_cap_reached");
    }
    if (this.usage.total_provider_calls + 1 > this.limits.maximum_total_provider_calls) {
      throw new E2ABudgetExceededError("e2a_total_provider_call_cap_reached");
    }
    if (this.usage.input_tokens + input.estimated_input_tokens > this.limits.maximum_total_input_tokens) {
      throw new E2ABudgetExceededError("e2a_input_token_cap_reached");
    }
    if (this.usage.output_tokens + input.maximum_output_tokens > this.limits.maximum_total_output_tokens) {
      throw new E2ABudgetExceededError("e2a_output_token_cap_reached");
    }
    if (
      this.usage.estimated_cost_status === "available" &&
      (this.usage.estimated_cost_usd ?? 0) >= this.limits.maximum_cost_usd
    ) {
      throw new E2ABudgetExceededError("e2a_cost_cap_reached");
    }
  }

  recordSimulatorCall(input: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd?: number | null;
  }) {
    this.usage.simulator_provider_calls += 1;
    this.usage.total_provider_calls += 1;
    this.usage.input_tokens += Math.max(0, input.input_tokens);
    this.usage.output_tokens += Math.max(0, input.output_tokens);
    this.recordCost(input.estimated_cost_usd);
    this.assertActualUsageWithinLimits();
  }

  recordOperationalUsage(input: {
    provider_calls: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd?: number | null;
  }) {
    this.usage.operational_provider_calls += input.provider_calls;
    this.usage.total_provider_calls += input.provider_calls;
    this.usage.input_tokens += Math.max(0, input.input_tokens);
    this.usage.output_tokens += Math.max(0, input.output_tokens);
    this.recordCost(input.estimated_cost_usd);
    this.assertActualUsageWithinLimits();
  }

  private recordCost(value?: number | null) {
    if (!this.pricingAvailable || typeof value !== "number" || !Number.isFinite(value)) return;
    this.usage.estimated_cost_status = "available";
    this.usage.estimated_cost_usd = (this.usage.estimated_cost_usd ?? 0) + Math.max(0, value);
  }

  private assertActualUsageWithinLimits() {
    if (this.usage.total_provider_calls > this.limits.maximum_total_provider_calls) {
      throw new E2ABudgetExceededError("e2a_total_provider_call_cap_exceeded");
    }
    if (this.usage.input_tokens > this.limits.maximum_total_input_tokens) {
      throw new E2ABudgetExceededError("e2a_input_token_cap_exceeded");
    }
    if (this.usage.output_tokens > this.limits.maximum_total_output_tokens) {
      throw new E2ABudgetExceededError("e2a_output_token_cap_exceeded");
    }
    if (
      this.usage.estimated_cost_status === "available" &&
      (this.usage.estimated_cost_usd ?? 0) > this.limits.maximum_cost_usd
    ) {
      throw new E2ABudgetExceededError("e2a_cost_cap_exceeded");
    }
  }
}
