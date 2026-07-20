import {
  executeE2A14Calibration
} from "@/lib/evaluation/formative/e2a14-protected-request-calibration";

executeE2A14Calibration().then((result) => {
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    candidate_hash: result.summary.candidate_hash,
    candidate_file_sha256: result.summary.candidate_file_sha256,
    provider_call_count: result.summary.provider_call_count,
    protected_artifacts_unchanged:
      result.summary.protected_artifacts_unchanged
  }, null, 2));
}).catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a14_calibration_failed");
  process.exitCode = 1;
});
