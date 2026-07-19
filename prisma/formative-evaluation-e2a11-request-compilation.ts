import path from "node:path";
import { E2A11_ARTIFACT_ROOT } from
  "@/lib/evaluation/formative/e2a11-validator-calibration";
import { compileE2A11CandidateRequestsNoNetwork } from
  "@/lib/evaluation/formative/e2a11-request-compilation";

async function main() {
  const result = await compileE2A11CandidateRequestsNoNetwork(path.join(
    E2A11_ARTIFACT_ROOT,
    "request-compilation-preflight.json"
  ));
  console.log(JSON.stringify({
    status: result.artifact.all_17_roles_compile &&
      result.artifact.network_request_count === 0 ? "passed" : "failed",
    output_path: result.outputPath,
    candidate_hash: result.artifact.selected_candidate_hash,
    role_count: result.artifact.role_count,
    request_count: result.artifact.request_count,
    operation_schema_count: result.artifact.operation_request_count,
    progression_schema_count:
      result.artifact.retained_progression_request_count,
    network_request_count: result.artifact.network_request_count
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a11_request_compilation_failed");
  process.exitCode = 1;
});
