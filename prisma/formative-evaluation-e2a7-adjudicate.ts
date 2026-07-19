import {
  executeE2A7Adjudication
} from "@/lib/evaluation/formative/e2a7-v5-forensic-adjudication";

async function main() {
  const result = await executeE2A7Adjudication();
  console.log(JSON.stringify({
    status: "completed_no_live",
    run_id: result.runId,
    artifact_directory: result.runDir,
    source_v5_status: result.manifest.source_v5_status,
    candidate_hash: result.manifest.candidate_hash,
    case_count: result.manifest.case_count,
    provider_output_replay_count: result.manifest.provider_output_replay_count,
    accounting: result.manifest.accounting,
    provider_generation_call_count: 0,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
