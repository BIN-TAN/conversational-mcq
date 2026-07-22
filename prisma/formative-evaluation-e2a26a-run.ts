import {
  executeE2A26A
} from "@/lib/evaluation/formative/e2a26a-anchor-conclusion-consistency";

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a26a_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await executeE2A26A({
      networkRequestCount: () => networkRequestCount
    });
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_directory: result.runDir,
      calibration_case_count: result.summary.calibration_case_count,
      calibration_pass_count: result.summary.calibration_pass_count,
      e2a27_protocol_hash: result.summary.e2a27_protocol_hash,
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
  console.error(error instanceof Error ? error.message : "e2a26a_run_failed");
  process.exitCode = 1;
});
