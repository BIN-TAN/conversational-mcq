import {
  executeE2A9Adjudication
} from "@/lib/evaluation/formative/e2a9-remain-dialogue-adjudication";

async function main() {
  const result = await executeE2A9Adjudication();
  console.log(JSON.stringify({
    status: result.status,
    run_id: result.run_id,
    artifact_directory: result.run_directory,
    source_v6_status: result.manifest.source_v6_status,
    adjudicated_output_count: result.manifest.source_v6_output_count,
    calibrated_valid_output_count:
      result.reporting.calibrated_valid_output_count,
    genuine_failure_output_count:
      result.reporting.genuine_failure_output_count,
    false_positive_output_count:
      result.reporting.false_positive_output_count,
    v7_candidate_hash: result.manifest.v7_candidate_hash,
    provider_generation_call_count: 0,
    candidate_approved: false,
    candidate_activated: false,
    human_review_status: "pending"
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
