import type { FormativeEvaluationScenario, SimulatedStudentState } from "./schemas";
import { advanceSimulatedStudentState } from "./simulated-student-state";
import type { SeededStudentTurn } from "./types";

export function buildScriptedStudentTurns(input: {
  scenario: FormativeEvaluationScenario;
  initial_state?: SimulatedStudentState;
}): SeededStudentTurn[] {
  if (input.scenario.simulator_mode !== "scripted" || !input.scenario.scripted_turns) {
    throw new Error("scripted_runner_requires_scripted_scenario");
  }

  let state = input.initial_state ?? structuredClone(input.scenario.initial_student_state);
  return input.scenario.scripted_turns.map((turn) => {
    const priorState = structuredClone(state);
    state = advanceSimulatedStudentState({
      state,
      patch: turn.state_patch,
      reason: turn.state_change_reason ?? `Scripted intent ${turn.intent}.`
    });
    return {
      turn_id: turn.turn_id,
      intent: turn.intent,
      message: turn.message,
      prior_state: priorState,
      resulting_state: structuredClone(state)
    };
  });
}
