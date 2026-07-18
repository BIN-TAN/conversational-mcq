import { loadEnvConfig } from "@next/env";
import { compileE2A4CandidateRequestsNoNetwork } from "@/lib/evaluation/formative/e2a4-structured-output-audit";

loadEnvConfig(process.cwd());

async function main() {
  const result = await compileE2A4CandidateRequestsNoNetwork();
  console.log(JSON.stringify({
    status: result.artifact.all_requests_ready_for_dispatch ? "passed" : "failed",
    artifact_path: result.outputPath,
    selected_candidate_hash: result.artifact.selected_candidate_hash,
    role_count: result.artifact.role_count,
    all_requests_ready_for_dispatch: result.artifact.all_requests_ready_for_dispatch,
    provider_generation_call_count: result.artifact.provider_generation_call_count,
    network_request_count: result.artifact.network_request_count,
    legacy_fallback_selected: result.artifact.legacy_fallback_selected
  }, null, 2));

  if (!result.artifact.all_requests_ready_for_dispatch || result.artifact.network_request_count !== 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a4_request_compilation_failed");
  process.exitCode = 1;
});
