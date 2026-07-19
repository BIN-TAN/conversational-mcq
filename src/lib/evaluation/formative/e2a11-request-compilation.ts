import path from "node:path";
import {
  compileTopicDialogueCandidateRequestsNoNetwork
} from "./e2a9-request-compilation";
import { evaluateE2A11Candidate } from "./e2a11-v8-validator-candidate";

export const E2A11_REQUEST_COMPILATION_VERSION =
  "e2a11-v8-production-request-compilation-v1" as const;

export async function compileE2A11CandidateRequestsNoNetwork(outputPath: string) {
  return compileTopicDialogueCandidateRequestsNoNetwork({
    candidate: evaluateE2A11Candidate(),
    output_path: outputPath,
    compilation_version: E2A11_REQUEST_COMPILATION_VERSION,
    purpose_prefix: "e2a11"
  });
}

export function defaultE2A11RequestCompilationPath(root: string) {
  return path.join(root, "request-compilation.json");
}
