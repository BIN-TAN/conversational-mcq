import {
  executeE2A18Adjudication
} from "@/lib/evaluation/formative/e2a18-simulator-contract-adjudication";

async function main() {
  const result = await executeE2A18Adjudication();
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    root_cause_classification: result.summary.root_cause_classification,
    original_observed_level: result.summary.original_observed_level,
    independently_adjudicated_level:
      result.summary.independently_adjudicated_level,
    same_exact_output_now_accepted:
      result.summary.same_exact_output_now_accepted,
    calibration_corpus_size: result.summary.calibration_corpus_size,
    calibration_pass_count: result.summary.calibration_pass_count,
    mutation_count: result.summary.mutation_count,
    mutation_pass_count: result.summary.mutation_pass_count,
    abort_aware_integrity_result:
      result.summary.abort_aware_integrity_result,
    e2a19_protocol_hash: result.summary.e2a19_protocol_hash,
    provider_calls_made: 0,
    candidate_approved: false,
    candidate_activated: false,
    e2a19_dispatch_authorized: false,
    artifact_validation_passed: result.artifactValidation.passed
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a18_execution_failed");
  process.exitCode = 1;
});
