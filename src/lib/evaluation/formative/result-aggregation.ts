import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildHumanReviewQueueCsv } from "./human-review-queue";
import type { FormativeEvaluationRunSummary } from "./types";

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function groupBy(runs: FormativeEvaluationRunSummary[], key: (run: FormativeEvaluationRunSummary) => string) {
  return Object.fromEntries([...new Set(runs.map(key))].sort().map((value) => {
    const entries = runs.filter((run) => key(run) === value);
    return [value, { run_count: entries.length, pass_count: entries.filter((run) => run.passed).length, pass_rate: rate(entries.filter((run) => run.passed).length, entries.length) }];
  }));
}

export async function readFormativeEvaluationRunSummaries(artifactRoot: string) {
  await mkdir(artifactRoot, { recursive: true });
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  const runs: FormativeEvaluationRunSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      runs.push(JSON.parse(await readFile(path.join(artifactRoot, entry.name, "run-summary.json"), "utf8")) as FormativeEvaluationRunSummary);
    } catch {
      // Partial directories are ignored; artifact-integrity smoke reports them.
    }
  }
  return runs.sort((left, right) => left.run_id.localeCompare(right.run_id));
}

export function aggregateFormativeEvaluationRuns(runs: FormativeEvaluationRunSummary[]) {
  const runCount = runs.length;
  const sums = (key: keyof FormativeEvaluationRunSummary) => runs.reduce((sum, run) => sum + Number(run[key] ?? 0), 0);
  return {
    artifact_schema_version: "formative-evaluation-aggregate-v1",
    generated_at: new Date().toISOString(),
    run_count: runCount,
    scenario_pass_rate: rate(runs.filter((run) => run.passed).length, runCount),
    critical_invariant_failure_rate: rate(runs.filter((run) => run.critical_invariant_failure_count > 0).length, runCount),
    major_invariant_failure_rate: rate(runs.filter((run) => run.major_invariant_failure_count > 0).length, runCount),
    average_visible_replies_per_student_turn: rate(sums("visible_assistant_reply_count"), sums("visible_student_turn_count")),
    missing_reply_count: sums("missing_reply_count"),
    terminal_submission_rejected_count: sums("terminal_submission_rejected_count"),
    idempotent_replay_rejected_count: sums("idempotent_replay_rejected_count"),
    strategy_change_count: sums("strategy_change_count"),
    fallback_frequency: rate(sums("fallback_count"), runCount),
    recovery_turn_frequency: rate(sums("recovery_turn_count"), runCount),
    replacement_activity_frequency: rate(sums("replacement_activity_count"), runCount),
    refresh_mismatch_count: sums("refresh_mismatch_count"),
    answer_key_leak_count: sums("answer_key_leak_count"),
    internal_metadata_leak_count: sums("internal_metadata_leak_count"),
    premature_resolution_flag_count: sums("premature_resolution_flag_count"),
    revision_readiness_count: sums("revision_readiness_count"),
    transfer_readiness_count: sums("transfer_readiness_count"),
    manual_review_required_count: sums("manual_review_required_count"),
    provider_call_count: sums("provider_call_count"),
    groups: {
      scenario: groupBy(runs, (run) => run.scenario_id),
      simulator_mode: groupBy(runs, (run) => run.simulator_mode),
      seed: groupBy(runs, (run) => String(run.seed)),
      misconception_type: groupBy(runs, (run) => run.misconception_type),
      initial_conceptual_state: groupBy(runs, (run) => run.initial_conceptual_state),
      engagement_state: groupBy(runs, (run) => run.initial_engagement_state),
      confidence: groupBy(runs, (run) => run.initial_confidence),
      final_outcome: groupBy(runs, (run) => run.final_platform_state)
    }
  };
}

export async function writeFormativeEvaluationAggregate(artifactRoot: string) {
  const runs = await readFormativeEvaluationRunSummaries(artifactRoot);
  const summary = aggregateFormativeEvaluationRuns(runs);
  await Promise.all([
    writeFile(path.join(artifactRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
    writeFile(path.join(artifactRoot, "scenario-results.jsonl"), runs.map((run) => JSON.stringify(run)).join("\n") + (runs.length > 0 ? "\n" : ""), "utf8"),
    writeFile(path.join(artifactRoot, "human-review-queue.csv"), buildHumanReviewQueueCsv(runs), "utf8")
  ]);
  return { summary, runs };
}
