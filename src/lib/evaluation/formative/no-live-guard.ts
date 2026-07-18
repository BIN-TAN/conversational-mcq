export type E1NoLiveGuardSnapshot = {
  provider_access_enabled: false;
  live_student_simulator_enabled: false;
  live_rubric_evaluator_enabled: false;
  model_mode: "mock_safe";
};

const E1_LIVE_OPT_IN_VARIABLES = [
  "RUN_LIVE_FORMATIVE_EVALUATION",
  "RUN_LIVE_LLM_STUDENT_SIMULATOR",
  "RUN_LIVE_LLM_RUBRIC_EVALUATOR"
] as const;

export function assertAndConfigureE1NoLiveGuard(
  env: NodeJS.ProcessEnv = process.env
): E1NoLiveGuardSnapshot {
  const enabled = E1_LIVE_OPT_IN_VARIABLES.filter((name) => env[name] === "1");
  if (enabled.length > 0) {
    throw new Error(`e1_live_mode_not_implemented:${enabled.join(",")}`);
  }

  env.OPERATIONAL_AGENT_MODE = "disabled";
  env.OPERATIONAL_AGENT_INTEGRATION_ENABLED = "false";
  env.LLM_PROVIDER = "mock";
  env.LLM_LIVE_CALLS_ENABLED = "false";
  env.ITEM_ADMIN_TUTOR_MODE = "mock";
  env.ALLOW_LOCAL_MOCK_RUNTIME = "true";

  // Role toggles are approved configuration assertions. Global disabled/mock
  // gates are sufficient to prevent dispatch and must not rewrite those
  // assertions while a derived approval bundle is active.

  if (
    env.OPERATIONAL_AGENT_MODE !== "disabled" ||
    env.LLM_PROVIDER !== "mock" ||
    env.LLM_LIVE_CALLS_ENABLED !== "false"
  ) {
    throw new Error("e1_no_live_guard_configuration_failed");
  }

  return {
    provider_access_enabled: false,
    live_student_simulator_enabled: false,
    live_rubric_evaluator_enabled: false,
    model_mode: "mock_safe"
  };
}
