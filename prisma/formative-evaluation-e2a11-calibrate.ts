import { executeE2A11Calibration } from
  "@/lib/evaluation/formative/e2a11-validator-calibration";

async function main() {
  const result = await executeE2A11Calibration();
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    v7_output_count: result.summary.v7_output_count,
    accepted_count: result.summary.v8_fully_accepted_count,
    accepted_with_review_flags_count:
      result.summary.v8_accepted_with_review_flags_count,
    hard_rejected_count: result.summary.v8_hard_rejected_count,
    hard_negative_pass_count: result.summary.hard_negative_pass_count,
    borderline_false_hard_rejection_count:
      result.summary.borderline_false_hard_rejection_count,
    mutation_pass_count: result.summary.mutation_pass_count,
    provider_call_count: 0,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a11_calibration_failed");
  process.exitCode = 1;
});
