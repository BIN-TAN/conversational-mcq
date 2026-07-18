export type E1NoLiveGuardSnapshot = {
  execution_mode: "deterministic_e1";
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

  return {
    execution_mode: "deterministic_e1",
    provider_access_enabled: false,
    live_student_simulator_enabled: false,
    live_rubric_evaluator_enabled: false,
    model_mode: "mock_safe"
  };
}
