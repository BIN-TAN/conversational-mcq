import {
  executeE2A23A
} from "@/lib/evaluation/formative/e2a23a-turn-profile-reconciliation";

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a23a_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await executeE2A23A();
    if (networkRequestCount !== 0) {
      throw new Error("e2a23a_network_request_detected");
    }
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_directory: result.runDir,
      earliest_revision_ready_turn:
        result.summary.earliest_revision_ready_turn,
      first_route_divergence: result.summary.first_route_divergence,
      calibration_case_count: result.summary.calibration_case_count,
      calibration_pass_count: result.summary.calibration_pass_count,
      provider_call_count: result.summary.provider_call_count,
      network_request_count: networkRequestCount,
      e2a24_executed: result.summary.e2a24_executed,
      candidate_approved: result.summary.candidate_approved,
      candidate_activated: result.summary.candidate_activated
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a23a_run_failed");
  process.exitCode = 1;
});
