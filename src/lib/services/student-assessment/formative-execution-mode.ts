export type FormativeExecutionMode =
  | "deterministic_e1"
  | "no_live_e2a_contract"
  | "e2a_readiness"
  | "live_e2a_canary"
  | "production";

export type TopicDialogueExecutionPlan = {
  mode: FormativeExecutionMode;
  adapter: "deterministic_mock_safe" | "configured_live_runtime" | "no_generation";
  provider_generation_allowed: boolean;
  configured_runtime_policy_used: boolean;
  safe_recovery_eligible: boolean;
};

export function resolveTopicDialogueExecutionPlan(
  mode: FormativeExecutionMode
): TopicDialogueExecutionPlan {
  switch (mode) {
    case "deterministic_e1":
    case "no_live_e2a_contract":
      return {
        mode,
        adapter: "deterministic_mock_safe",
        provider_generation_allowed: false,
        configured_runtime_policy_used: false,
        safe_recovery_eligible: false
      };
    case "e2a_readiness":
      return {
        mode,
        adapter: "no_generation",
        provider_generation_allowed: false,
        configured_runtime_policy_used: true,
        safe_recovery_eligible: false
      };
    case "live_e2a_canary":
    case "production":
      return {
        mode,
        adapter: "configured_live_runtime",
        provider_generation_allowed: true,
        configured_runtime_policy_used: true,
        safe_recovery_eligible: true
      };
  }
}

export function formativeExecutionModeForEvaluation(input: {
  e2a_mode?: "e2a_live_operational" | "e2a_injected_no_live_test";
}): FormativeExecutionMode {
  if (input.e2a_mode === "e2a_live_operational") return "live_e2a_canary";
  if (input.e2a_mode === "e2a_injected_no_live_test") return "no_live_e2a_contract";
  return "deterministic_e1";
}
