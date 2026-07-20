import path from "node:path";
import { compileE2A15BRequests } from
  "@/lib/evaluation/formative/e2a15b-protected-request-supplement";

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? process.argv[outputIndex + 1]
  : path.join(
      process.cwd(),
      ".data",
      "e2a15b-request-compilation",
      "all-role-request-compilation.json"
    );
if (!outputPath) throw new Error("e2a15b_compilation_output_missing");

compileE2A15BRequests(outputPath).then((result) => {
  console.log(JSON.stringify({
    status: result.artifact.all_17_roles_compile ? "passed" : "failed",
    output_path: outputPath,
    role_count: result.artifact.role_count,
    request_count: result.artifact.request_count,
    network_request_count: result.artifact.network_request_count
  }, null, 2));
  if (!result.artifact.all_17_roles_compile ||
    result.artifact.network_request_count !== 0) process.exitCode = 1;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
