import {
  executeE2A24A
} from "@/lib/evaluation/formative/e2a24a-autonomous-dialogue-live-readiness";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const e1ArtifactRoot = argument("--e1-artifact-root");
  if (!e1ArtifactRoot) {
    throw new Error("e2a24a_e1_artifact_root_required");
  }
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a24a_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await executeE2A24A({ e1ArtifactRoot });
    if (networkRequestCount !== 0) {
      throw new Error("e2a24a_network_request_detected");
    }
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_directory: result.runDir,
      e1_positive_scenarios_passed:
        result.summary.e1_positive_scenarios_passed,
      e1_unexpected_failure_count:
        result.summary.e1_unexpected_failure_count,
      held_out_overlap_passed: result.summary.held_out_overlap_passed,
      candidate_configuration_hash:
        result.summary.candidate_configuration_hash,
      candidate_file_sha256: result.summary.candidate_file_sha256,
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
  console.error(error instanceof Error ? error.message : "e2a24a_run_failed");
  process.exitCode = 1;
});
