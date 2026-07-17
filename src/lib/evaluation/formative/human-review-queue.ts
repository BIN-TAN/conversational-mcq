import type { FormativeEvaluationRunSummary } from "./types";

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function humanReviewReasons(run: FormativeEvaluationRunSummary) {
  const reasons = [
    ...(!run.passed ? ["scenario_failed"] : []),
    ...(run.critical_invariant_failure_count > 0 ? ["critical_invariant_failure"] : []),
    ...(run.major_invariant_failure_count > 0 ? ["major_invariant_failure"] : []),
    ...(run.final_hidden_state.misconception_status === "resolved" ? ["misconception_resolved"] : []),
    ...(run.transfer_readiness_count > 0 ? ["moved_to_transfer"] : []),
    ...(run.recovery_turn_count > 0 ? ["recovery_turn"] : []),
    ...(run.answer_key_leak_count > 0 || run.internal_metadata_leak_count > 0 ? ["safety_or_privacy_finding"] : []),
    ...(run.manual_review_required_count > 0 ? ["manual_pedagogical_review"] : [])
  ];
  if (reasons.length === 0) {
    const bucket = Number.parseInt(run.run_id.slice(-2), 16);
    if (Number.isFinite(bucket) && bucket % 4 === 0) reasons.push("deterministic_passing_sample");
  }
  return reasons;
}

export function buildHumanReviewQueueCsv(runs: FormativeEvaluationRunSummary[]) {
  const header = [
    "run_id",
    "scenario_id",
    "reason_selected",
    "artifact_path",
    "critical_findings",
    "rubric_dimensions_needing_review",
    "final_profile_status",
    "final_plan_action",
    "final_platform_state"
  ];
  const rows = runs.flatMap((run) => {
    const reasons = humanReviewReasons(run);
    if (reasons.length === 0) return [];
    return [[
      run.run_id,
      run.scenario_id,
      reasons,
      run.artifact_path,
      run.critical_findings,
      run.rubric_dimensions_needing_review,
      run.final_profile_status,
      run.final_plan_action,
      run.final_platform_state
    ]];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
