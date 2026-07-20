import { executeE2A20A } from
  "@/lib/evaluation/formative/e2a20a-turn4-classification-adjudication";

async function main() {
  const result = await executeE2A20A();
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    turn4_classification: result.summary.turn4_classification,
    revision_eligible: result.summary.revision_eligible,
    calibration_pass_count: result.summary.calibration_pass_count,
    historical_regression_pass_count:
      result.summary.historical_regression_pass_count,
    final_classifier_version: result.summary.final_classifier_version,
    final_classifier_file_sha256:
      result.summary.final_classifier_file_sha256,
    provider_calls_made: result.summary.provider_calls_made,
    candidate_approved: result.summary.candidate_approved,
    candidate_activated: result.summary.candidate_activated
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a20a_run_failed");
  process.exitCode = 1;
});
