import path from "node:path";
import {
  E2A14_ARTIFACT_ROOT
} from "@/lib/evaluation/formative/e2a14-protected-request-calibration";
import {
  compileE2A14CandidateRequestsNoNetwork
} from "@/lib/evaluation/formative/e2a14-request-compilation";

const outputPath = path.join(
  E2A14_ARTIFACT_ROOT,
  "request-compilation-preview.json"
);

compileE2A14CandidateRequestsNoNetwork(outputPath).then((result) => {
  console.log(JSON.stringify({
    status: result.artifact.all_17_roles_compile ? "passed" : "failed",
    output_path: outputPath,
    role_count: result.artifact.role_count,
    request_count: result.artifact.request_count,
    network_request_count: result.artifact.network_request_count
  }, null, 2));
}).catch((error) => {
  console.error(error instanceof Error
    ? error.message
    : "e2a14_request_compilation_failed");
  process.exitCode = 1;
});
