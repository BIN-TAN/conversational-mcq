import type { SimulatedStudentState } from "./schemas";

export function advanceSimulatedStudentState(input: {
  state: SimulatedStudentState;
  patch?: Partial<Omit<SimulatedStudentState, "evidence_history" | "turn_index">>;
  reason: string;
}): SimulatedStudentState {
  const nextTurn = input.state.turn_index + 1;
  const patch = input.patch ?? {};
  const changed = Object.entries(patch).filter(
    ([key, value]) => input.state[key as keyof SimulatedStudentState] !== value
  );
  return {
    ...input.state,
    ...patch,
    turn_index: nextTurn,
    evidence_history: [
      ...input.state.evidence_history,
      ...changed.map(([key, value]) => ({
        turn_index: nextTurn,
        evidence_type: key,
        prior_value: String(input.state[key as keyof SimulatedStudentState] ?? ""),
        resulting_value: value === null || value === undefined ? null : String(value),
        reason: input.reason
      }))
    ]
  };
}
