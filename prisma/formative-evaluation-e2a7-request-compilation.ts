import {
  compileE2A7CandidateRequestsNoNetwork
} from "@/lib/evaluation/formative/e2a7-request-compilation";

async function main() {
  const result = await compileE2A7CandidateRequestsNoNetwork();
  console.log(JSON.stringify({
    status: "compiled_no_live",
    output_path: result.outputPath,
    candidate_hash: result.artifact.selected_candidate_hash,
    role_count: result.artifact.role_count,
    request_count: result.artifact.request_count,
    topic_dialogue_mode_request_count:
      result.artifact.topic_dialogue_mode_request_count,
    all_four_mode_schemas_compile:
      result.artifact.all_four_mode_schemas_compile,
    all_17_roles_compile: result.artifact.all_17_roles_compile,
    provider_generation_call_count: 0,
    network_request_count: result.artifact.network_request_count
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
