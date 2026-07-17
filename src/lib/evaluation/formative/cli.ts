import path from "node:path";
import { listFormativeEvaluationScenarios, loadFormativeEvaluationScenario } from "./scenario-loader";
import { writeFormativeEvaluationAggregate } from "./result-aggregation";

export type FormativeEvaluationCliCommand =
  | "scripted"
  | "branching"
  | "scenario"
  | "all"
  | "report";

function argValue(args: string[], name: string) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function positiveInteger(value: string | null, fallback: number, name: string) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`invalid_${name}`);
  return parsed;
}

export async function runFormativeEvaluationCli(input: {
  command: FormativeEvaluationCliCommand;
  args: string[];
}) {
  const artifactRoot = path.resolve(
    argValue(input.args, "artifact-dir") ?? "artifacts/formative-evaluation"
  );
  if (input.command === "report") {
    const report = await writeFormativeEvaluationAggregate(artifactRoot);
    return {
      command: input.command,
      artifact_root: artifactRoot,
      run_count: report.runs.length,
      scenario_pass_rate: report.summary.scenario_pass_rate
    };
  }

  const requestedScenario = argValue(input.args, "scenario");
  const seed = positiveInteger(argValue(input.args, "seed"), 1001, "seed");
  const runs = positiveInteger(argValue(input.args, "runs"), 1, "runs");
  const keepFixtureOnFailure = input.args.includes("--keep-fixture-on-failure");
  const failOnMajor = input.args.includes("--fail-on-major");
  let scenarios = input.command === "scenario"
    ? [loadFormativeEvaluationScenario(requestedScenario ?? "")]
    : listFormativeEvaluationScenarios(
        input.command === "scripted" || input.command === "branching"
          ? input.command
          : undefined
      );
  if (requestedScenario) {
    scenarios = scenarios.filter((scenario) => scenario.scenario_id === requestedScenario);
    if (scenarios.length === 0) throw new Error(`scenario_not_available_for_command:${requestedScenario}`);
  }

  const { prisma } = await import("@/lib/db");
  const { runFormativeEvaluationScenario } = await import("./runner");
  const completed = [];
  for (const scenario of scenarios) {
    for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
      const result = await runFormativeEvaluationScenario({
        prisma,
        scenario,
        seed,
        run_index: runIndex,
        artifact_dir: artifactRoot,
        keep_fixture_on_failure: keepFixtureOnFailure,
        fail_on_major: failOnMajor
      });
      completed.push(result.artifacts.run_summary);
    }
  }
  const report = await writeFormativeEvaluationAggregate(artifactRoot);
  if (failOnMajor && completed.some((run) => run.major_invariant_failure_count > 0)) {
    process.exitCode = 1;
  }
  return {
    command: input.command,
    artifact_root: artifactRoot,
    executed_run_count: completed.length,
    pass_count: completed.filter((run) => run.passed).length,
    fail_count: completed.filter((run) => !run.passed).length,
    provider_call_count: completed.reduce((sum, run) => sum + run.provider_call_count, 0),
    aggregate_run_count: report.runs.length
  };
}
