import path from "node:path";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

type RunSummary = {
  scenario_id: string;
  passed: boolean;
  critical_invariant_failure_count: number;
  major_invariant_failure_count: number;
  visible_assistant_reply_count: number;
  strategy_change_count: number;
  failed_expectations: string[];
  failed_hard_invariants: string[];
  premature_resolution_flag_count: number;
  revision_readiness_count: number;
  transfer_readiness_count: number;
  final_platform_state: string;
  provider_call_count: number;
};

function argValue(name: string) {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function runSummaries(root: string) {
  const found: RunSummary[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      if (entry.isFile() && entry.name === "run-summary.json") {
        found.push(JSON.parse(readFileSync(entryPath, "utf8")) as RunSummary);
      }
    }
  };
  visit(root);
  return new Map(found.map((summary) => [summary.scenario_id, summary]));
}

function countDistractorFindings(summary: RunSummary) {
  return [...summary.failed_expectations, ...summary.failed_hard_invariants]
    .filter((finding) => /distractor|anchor|generic_tutoring/i.test(finding)).length;
}

function totals(summaries: Map<string, RunSummary>) {
  const runs = [...summaries.values()];
  return {
    scenario_count: runs.length,
    pass_count: runs.filter((run) => run.passed).length,
    fail_count: runs.filter((run) => !run.passed).length,
    critical_invariant_failure_count: runs.reduce(
      (sum, run) => sum + run.critical_invariant_failure_count,
      0
    ),
    major_invariant_failure_count: runs.reduce(
      (sum, run) => sum + run.major_invariant_failure_count,
      0
    ),
    provider_call_count: runs.reduce((sum, run) => sum + run.provider_call_count, 0)
  };
}

function main() {
  const beforeRoot = path.resolve(argValue("before") ?? "artifacts/formative-evaluation");
  const afterRoot = path.resolve(
    argValue("after") ?? ".data/formative-evaluation-e1-1-final"
  );
  const outputPath = path.resolve(
    argValue("output") ?? ".data/formative-evaluation-e1-1-comparison.json"
  );
  const before = runSummaries(beforeRoot);
  const after = runSummaries(afterRoot);
  const scenarioIds = [...new Set([...before.keys(), ...after.keys()])].sort();
  const scenarios = scenarioIds.map((scenarioId) => {
    const prior = before.get(scenarioId);
    const current = after.get(scenarioId);
    if (!prior || !current) throw new Error(`comparison_run_missing:${scenarioId}`);
    return {
      scenario_id: scenarioId,
      scenario_result_before: prior.passed ? "pass" : "fail",
      scenario_result_after: current.passed ? "pass" : "fail",
      critical_failures_before: prior.critical_invariant_failure_count,
      critical_failures_after: current.critical_invariant_failure_count,
      major_failures_before: prior.major_invariant_failure_count,
      major_failures_after: current.major_invariant_failure_count,
      visible_reply_count_before: prior.visible_assistant_reply_count,
      visible_reply_count_after: current.visible_assistant_reply_count,
      strategy_changes_before: prior.strategy_change_count,
      strategy_changes_after: current.strategy_change_count,
      distractor_focus_findings_before: countDistractorFindings(prior),
      distractor_focus_findings_after: countDistractorFindings(current),
      premature_resolution_findings_before: prior.premature_resolution_flag_count,
      premature_resolution_findings_after: current.premature_resolution_flag_count,
      revision_readiness_before: prior.revision_readiness_count,
      revision_readiness_after: current.revision_readiness_count,
      transfer_readiness_before: prior.transfer_readiness_count,
      transfer_readiness_after: current.transfer_readiness_count,
      activity_completion_point_before: prior.final_platform_state,
      activity_completion_point_after: current.final_platform_state
    };
  });
  const report = {
    report_version: "formative-evaluation-e1.1-comparison-v1",
    generated_at: new Date().toISOString(),
    before_artifact_root: beforeRoot,
    after_artifact_root: afterRoot,
    before_totals: totals(before),
    after_totals: totals(after),
    scenarios
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "completed",
    output_path: outputPath,
    before_totals: report.before_totals,
    after_totals: report.after_totals
  }, null, 2));
}

main();
