import { FORMATIVE_EVALUATION_SCENARIOS } from "./scenario-catalog";
import {
  FormativeEvaluationScenarioSchema,
  type FormativeEvaluationScenario
} from "./schemas";

export function validateScenarioCatalog(
  scenarios: readonly unknown[] = FORMATIVE_EVALUATION_SCENARIOS
): FormativeEvaluationScenario[] {
  const parsed = scenarios.map((scenario) => FormativeEvaluationScenarioSchema.parse(scenario));
  const ids = parsed.map((scenario) => scenario.scenario_id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) {
    throw new Error(`duplicate_formative_evaluation_scenario_id:${duplicate}`);
  }
  return parsed;
}

export function loadFormativeEvaluationScenario(scenarioId: string) {
  const scenario = validateScenarioCatalog().find((entry) => entry.scenario_id === scenarioId);
  if (!scenario) {
    throw new Error(`unknown_formative_evaluation_scenario:${scenarioId}`);
  }
  return scenario;
}

export function listFormativeEvaluationScenarios(
  mode?: "scripted" | "branching"
) {
  return validateScenarioCatalog().filter(
    (scenario) => !mode || scenario.simulator_mode === mode
  );
}
