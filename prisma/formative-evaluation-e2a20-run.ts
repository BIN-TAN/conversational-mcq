import {
  executeE2A20
} from "@/lib/evaluation/formative/e2a20-evidence-driven-transition-adjudication";

async function main() {
  const result = await executeE2A20();
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    source_e2a19_status: result.summary.source_e2a19_status,
    root_cause_categories: result.summary.root_cause_categories,
    turn4_observed_evidence: result.summary.turn4_observed_evidence,
    turn4_should_persist: result.summary.turn4_should_persist,
    turn4_should_continue: result.summary.turn4_should_continue,
    corrected_orchestration_version:
      result.summary.corrected_orchestration_version,
    provider_calls_made: result.summary.provider_calls_made,
    candidate_approved: result.summary.candidate_approved,
    candidate_activated: result.summary.candidate_activated,
    artifact_validation_passed: result.artifactValidation.passed
  }, null, 2));
  if (result.summary.status !==
    "e2a20_orchestration_corrected_e2a21_ready" ||
    !result.artifactValidation.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a20_run_failed");
  process.exitCode = 1;
});
