import path from "node:path";
import { compileE2A9CandidateRequestsNoNetwork } from
  "@/lib/evaluation/formative/e2a9-request-compilation";
import { E2A9_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a9-topic-dialogue-operation-candidate";

async function main() {
  const result = await compileE2A9CandidateRequestsNoNetwork(path.join(
    process.cwd(),
    ".data",
    "e2a10-v7-topic-dialogue-canary",
    "request-compilation-preflight.json"
  ));
  console.log(JSON.stringify({
    status: "compiled_no_live",
    output_path: result.outputPath,
    candidate_hash: E2A9_CANDIDATE_HASH,
    role_count: result.artifact.role_count,
    request_count: result.artifact.request_count,
    operation_request_count: result.artifact.operation_request_count,
    retained_progression_request_count:
      result.artifact.retained_progression_request_count,
    all_operation_schemas_compile:
      result.artifact.all_operation_schemas_compile,
    all_retained_progression_schemas_compile:
      result.artifact.all_retained_progression_schemas_compile,
    all_17_roles_compile: result.artifact.all_17_roles_compile,
    provider_generation_call_count:
      result.artifact.provider_generation_call_count,
    network_request_count: result.artifact.network_request_count
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error
    ? error.message
    : "e2a10_request_compilation_failed");
  process.exitCode = 1;
});
