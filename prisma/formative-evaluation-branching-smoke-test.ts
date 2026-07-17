import { loadEnvConfig } from "@next/env";
import { BranchingStudentSimulator } from "../src/lib/evaluation/formative/branching-student";
import { loadFormativeEvaluationScenario } from "../src/lib/evaluation/formative/scenario-loader";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runBranchingEvaluationSmoke() {
  loadEnvConfig(process.cwd());
  const repeated = loadFormativeEvaluationScenario("repeated_conceptual_confusion");
  const simulator = new BranchingStudentSimulator(repeated, 1201);
  const first = simulator.next("Focus on this boundary: theta and item difficulty.")!;
  assert(first.resulting_state.misconception_status === "present", "Repeated abstract explanation should preserve confusion.");
  const second = simulator.next("Compare two linked forms in a concrete example.")!;
  assert(second.intent === "request_example", "Branch policy should remain explicit and ordered.");
  const third = simulator.next("Here is a concrete contrast example: theta describes the person and difficulty describes the item.")!;
  assert(third.resulting_state.task_understanding === "clear", "Concept confusion should not corrupt clear task understanding.");

  const taskScenario = loadFormativeEvaluationScenario("task_language_confusion");
  const taskClarification = new BranchingStudentSimulator(taskScenario, 44).next(
    "Compare a concrete example of person theta with item difficulty."
  )!;
  assert(taskClarification.resulting_state.task_understanding === "partially_clear", "A concrete contrast should improve confused task understanding by one level.");

  const unsupportedScenario = structuredClone(repeated);
  unsupportedScenario.branching_policy!.intent_sequence = ["unsupported_understanding_claim"];
  unsupportedScenario.branching_policy!.max_turns = 1;
  const unsupported = new BranchingStudentSimulator(unsupportedScenario, 2).next("Explain the idea.")!;
  assert(unsupported.resulting_state.misconception_status === "present", "Unsupported understanding claim must not alter misconception truth.");

  const dumping = new BranchingStudentSimulator(unsupportedScenario, 2).next("The correct answer is C.")!;
  assert(dumping.policy_violation === "answer_dumping", "Direct answer dumping should create a policy violation.");
  assert(dumping.resulting_state.misconception_status === "present", "Answer dumping must not simulate genuine learning.");

  const recurrenceScenario = loadFormativeEvaluationScenario("misconception_recurs_after_improvement");
  const recurrence = new BranchingStudentSimulator(recurrenceScenario, 33);
  recurrence.next("Use an example.");
  recurrence.next("Here is a concrete comparison example.");
  const recurred = recurrence.next("Now apply the distinction to another linked form.")!;
  assert(recurred.resulting_state.misconception_status === "recurred", "Recurrence should reopen hidden misconception truth.");

  const { assertAndConfigureE1NoLiveGuard } = await import("../src/lib/evaluation/formative/no-live-guard");
  assertAndConfigureE1NoLiveGuard();
  const { prisma } = await import("../src/lib/db");
  const { runFormativeEvaluationScenario } = await import("../src/lib/evaluation/formative/runner");
  const result = await runFormativeEvaluationScenario({
    prisma,
    scenario: repeated,
    seed: 1201,
    artifact_dir: ".data/formative-evaluation-smoke/branching"
  });
  assert(result.manifest.provider_call_count === 0, "Branching smoke must make no provider call.");
  assert(result.manifest.cleanup_result.succeeded, "Branching smoke fixture should be cleaned.");
  assert(result.artifacts.branch_decisions.length === 3, "Branch decisions should be persisted for each policy turn.");
  return { status: "passed", scenario_id: repeated.scenario_id, provider_call_count: 0 };
}

if (process.argv[1]?.endsWith("formative-evaluation-branching-smoke-test.ts")) {
  runBranchingEvaluationSmoke().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error instanceof Error ? error.message : "Branching evaluation smoke failed.");
    process.exitCode = 1;
  });
}
