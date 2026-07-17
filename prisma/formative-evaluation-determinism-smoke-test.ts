import { BranchingStudentSimulator } from "../src/lib/evaluation/formative/branching-student";
import { loadFormativeEvaluationScenario } from "../src/lib/evaluation/formative/scenario-loader";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runFormativeEvaluationDeterminismSmoke() {
  const scenario = loadFormativeEvaluationScenario("partial_understanding_improves");
  const assistantMessages = [
    "Explain the target boundary.",
    "Here is a concrete contrast example.",
    "Now explain the distinction in your own words."
  ];
  const run = () => {
    const simulator = new BranchingStudentSimulator(scenario, 4404);
    return assistantMessages.map((message) => simulator.next(message));
  };
  const first = run();
  const second = run();
  assert(JSON.stringify(first) === JSON.stringify(second), "Same scenario and seed must produce identical branching output.");
  const different = new BranchingStudentSimulator(scenario, 4405);
  const differentTurns = assistantMessages.map((message) => different.next(message));
  assert(
    JSON.stringify(first.map((turn) => turn?.message)) !== JSON.stringify(differentTurns.map((turn) => turn?.message)),
    "A different seed should be able to select different authored phrase variants."
  );
  return { status: "passed", scenario_id: scenario.scenario_id, deterministic_turn_count: first.length };
}

if (process.argv[1]?.endsWith("formative-evaluation-determinism-smoke-test.ts")) {
  runFormativeEvaluationDeterminismSmoke().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error instanceof Error ? error.message : "Determinism smoke failed.");
    process.exitCode = 1;
  });
}
