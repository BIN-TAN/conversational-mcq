import {
  compileTopicDialogueCandidateRequestsNoNetwork
} from "./e2a9-request-compilation";
import { evaluateE2A14Candidate } from
  "./e2a14-protected-request-validator-candidate";

export const E2A14_REQUEST_COMPILATION_VERSION =
  "e2a14-protected-request-production-request-compilation-v1" as const;

export async function compileE2A14CandidateRequestsNoNetwork(
  outputPath: string
) {
  return compileTopicDialogueCandidateRequestsNoNetwork({
    candidate: evaluateE2A14Candidate(),
    output_path: outputPath,
    compilation_version: E2A14_REQUEST_COMPILATION_VERSION,
    purpose_prefix: "e2a14"
  });
}
