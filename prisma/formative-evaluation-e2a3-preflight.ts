import { loadEnvConfig } from "@next/env";
import {
  inspectE2A3CandidatePreflight,
  protectedArtifactSnapshot,
  resolveE2A3Budget
} from "../src/lib/evaluation/formative/e2a3-topic-dialogue-evaluation";
import {
  e2a3EvaluationProtocolHash,
  e2a3EvaluationProtocolSnapshot
} from "../src/lib/evaluation/formative/e2a3-topic-dialogue-protocol";

loadEnvConfig(process.cwd());

function main() {
  const preflight = inspectE2A3CandidatePreflight({
    requireCleanTree: process.argv.includes("--require-clean-tree"),
    requireLiveEnvironment: process.argv.includes("--require-live-environment")
  });
  const output = {
    status: preflight.passed ? "passed" : "blocked",
    no_provider_call: true,
    preflight,
    budget: resolveE2A3Budget(),
    evaluation_protocol: e2a3EvaluationProtocolSnapshot(),
    evaluation_protocol_hash: e2a3EvaluationProtocolHash(),
    protected_artifacts: protectedArtifactSnapshot()
  };
  console.log(JSON.stringify(output, null, 2));
  if (!preflight.passed) process.exitCode = 1;
}

main();

