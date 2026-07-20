import { executeE2A24 } from
  "@/lib/evaluation/formative/e2a24-autonomous-formative-dialogue";

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a24_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await executeE2A24();
    if (networkRequestCount !== 0) {
      throw new Error("e2a24_network_request_detected");
    }
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_directory: result.runDir,
      candidate_configuration_hash:
        result.summary.candidate_configuration_hash,
      candidate_file_sha256: result.summary.candidate_file_sha256,
      cross_domain_contract_count:
        result.summary.cross_domain_contract_count,
      heterogeneous_specimen_count:
        result.summary.heterogeneous_specimen_count,
      no_live_integration_pass_count:
        result.summary.no_live_integration_pass_count,
      provider_call_count: result.summary.provider_call_count,
      network_request_count: networkRequestCount,
      e2a25_executed: result.summary.e2a25_executed,
      candidate_approved: result.summary.candidate_approved,
      candidate_activated: result.summary.candidate_activated
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a24_run_failed");
  process.exitCode = 1;
});
