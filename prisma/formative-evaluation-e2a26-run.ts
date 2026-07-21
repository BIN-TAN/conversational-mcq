import {
  executeE2A26
} from "@/lib/evaluation/formative/e2a26-failure-path-evidence";

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a26_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await executeE2A26({
      networkRequestCount: () => networkRequestCount
    });
    if (networkRequestCount !== 0) {
      throw new Error("e2a26_network_request_detected");
    }
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_directory: result.runDir,
      derived_diagnosis: result.summary.derived_diagnosis,
      genuine_false_sound_factually_valid:
        result.summary.genuine_false_sound_factually_valid,
      complete_human_review_packet_item_count:
        result.summary.complete_human_review_packet_item_count,
      calibration_case_count: result.summary.calibration_case_count,
      e2a27_protocol_hash: result.summary.e2a27_protocol_hash,
      candidate_configuration_hash:
        result.summary.candidate_configuration_hash,
      provider_call_count: result.summary.provider_call_count,
      network_request_count: result.summary.network_request_count,
      e2a27_live_execution_performed:
        result.summary.e2a27_live_execution_performed
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a26_run_failed");
  process.exitCode = 1;
});
