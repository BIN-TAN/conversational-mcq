import { loadEnvConfig } from "@next/env";
import { compileE2A6CandidateRequestsNoNetwork } from
  "@/lib/evaluation/formative/e2a6-v5-request-compilation";

loadEnvConfig(process.cwd());

async function main() {
  const result = await compileE2A6CandidateRequestsNoNetwork();
  console.log(JSON.stringify({
    status: result.artifact.all_requests_ready_for_dispatch ? "passed" : "failed",
    artifact_path: result.outputPath,
    candidate_hash: result.artifact.selected_candidate_hash,
    role_count: result.artifact.role_count,
    input_schema_version: result.artifact.selected_input_schema_version,
    output_schema_version: result.artifact.selected_output_schema_version,
    validator_version: result.artifact.selected_validator_version,
    all_requests_ready_for_dispatch: result.artifact.all_requests_ready_for_dispatch,
    legacy_fallback_selected: result.artifact.legacy_fallback_selected,
    provider_generation_call_count: result.artifact.provider_generation_call_count,
    network_request_count: result.artifact.network_request_count
  }, null, 2));
  if (!result.artifact.all_requests_ready_for_dispatch ||
    result.artifact.network_request_count !== 0 ||
    result.artifact.role_count !== 17) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "e2a6_request_compilation_failed"
  );
  process.exitCode = 1;
});
