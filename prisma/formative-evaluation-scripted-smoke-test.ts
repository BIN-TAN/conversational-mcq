import { loadEnvConfig } from "@next/env";
import { FORMATIVE_EVALUATION_SCENARIOS } from "../src/lib/evaluation/formative/scenario-catalog";
import { validateScenarioCatalog } from "../src/lib/evaluation/formative/scenario-loader";
import { FormativeEvaluationScenarioSchema } from "../src/lib/evaluation/formative/schemas";
import { buildScriptedStudentTurns } from "../src/lib/evaluation/formative/scripted-student";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectRejected(value: unknown, label: string) {
  assert(!FormativeEvaluationScenarioSchema.safeParse(value).success, `${label} should be rejected.`);
}

export async function runScriptedEvaluationSmoke() {
  loadEnvConfig(process.cwd());
  const catalog = validateScenarioCatalog();
  assert(catalog.length === 12, "E1 catalog should contain exactly 12 scenarios.");
  const base = structuredClone(catalog.find((entry) => entry.simulator_mode === "scripted")!);
  assert(buildScriptedStudentTurns({ scenario: base }).length > 0, "Scripted runner should produce turns.");

  const missingItem = structuredClone(base);
  missingItem.initial_responses.pop();
  expectRejected(missingItem, "missing item");
  const badCounts = structuredClone(base) as unknown as { assessment_fixture: { initial_item_count: number } };
  badCounts.assessment_fixture.initial_item_count = 2;
  expectRejected(badCounts, "invalid initial count");
  const badTransferCount = structuredClone(base) as unknown as { assessment_fixture: { transfer_item_count: number } };
  badTransferCount.assessment_fixture.transfer_item_count = 2;
  expectRejected(badTransferCount, "invalid transfer count");
  const nonexistentDistractor = structuredClone(base) as unknown as { distractor_target: { focus_item_public_id: string } };
  nonexistentDistractor.distractor_target.focus_item_public_id = "fixture_missing_item";
  expectRejected(nonexistentDistractor, "nonexistent distractor");
  const inconsistent = structuredClone(base);
  inconsistent.distractor_target.focus_option = inconsistent.distractor_target.focus_option === "B" ? "A" : "B";
  expectRejected(inconsistent, "inconsistent target");
  const badTransition = structuredClone(base) as unknown as { expected_behavior: { prohibited_transitions: string[] } };
  badTransition.expected_behavior.prohibited_transitions.push("agent_can_advance_anywhere");
  expectRejected(badTransition, "unknown prohibited transition");
  const missingTurns = structuredClone(base) as unknown as { scripted_turns?: unknown };
  delete missingTurns.scripted_turns;
  expectRejected(missingTurns, "scripted mode without turns");
  const branchingBase = structuredClone(catalog.find((entry) => entry.simulator_mode === "branching")!);
  delete branchingBase.branching_policy;
  expectRejected(branchingBase, "branching mode without policy");
  const unstableId = structuredClone(base);
  unstableId.scenario_id = "Unstable generated ID 123";
  expectRejected(unstableId, "unstable scenario ID");
  let duplicateRejected = false;
  try {
    validateScenarioCatalog([FORMATIVE_EVALUATION_SCENARIOS[0], FORMATIVE_EVALUATION_SCENARIOS[0]]);
  } catch {
    duplicateRejected = true;
  }
  assert(duplicateRejected, "Duplicate stable scenario IDs should be rejected.");

  const revisionScenario = catalog.find((entry) => entry.scenario_id === "revision_succeeds_transfer_fails")!;
  const revisionTurns = buildScriptedStudentTurns({ scenario: revisionScenario });
  assert(revisionTurns[0]?.resulting_state.misconception_status === "apparently_resolved", "Revision evidence should remain distinguishable from transfer evidence.");
  assert(revisionTurns.at(-1)?.resulting_state.misconception_status === "recurred", "Transfer failure should reopen the hidden misconception truth.");

  const { assertAndConfigureE1NoLiveGuard } = await import("../src/lib/evaluation/formative/no-live-guard");
  assertAndConfigureE1NoLiveGuard();
  const { prisma } = await import("../src/lib/db");
  const { runFormativeEvaluationScenario } = await import("../src/lib/evaluation/formative/runner");
  const scenario = catalog.find((entry) => entry.scenario_id === "confirmed_misconception_high_confidence")!;
  const result = await runFormativeEvaluationScenario({
    prisma,
    scenario,
    seed: 1101,
    artifact_dir: ".data/formative-evaluation-smoke/scripted"
  });
  assert(result.manifest.provider_call_count === 0, "Scripted smoke must make no provider call.");
  assert(result.manifest.cleanup_result.succeeded, "Scripted smoke fixture should be cleaned.");
  assert(result.artifacts.student_turns.length === 2, "Scripted scenario should preserve scripted turns.");
  return { status: "passed", scenario_id: scenario.scenario_id, provider_call_count: 0 };
}

if (process.argv[1]?.endsWith("formative-evaluation-scripted-smoke-test.ts")) {
  runScriptedEvaluationSmoke().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error instanceof Error ? error.message : "Scripted evaluation smoke failed.");
    process.exitCode = 1;
  });
}
