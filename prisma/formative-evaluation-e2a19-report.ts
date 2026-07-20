import {
  loadE2A19Run
} from "@/lib/evaluation/formative/e2a19-single-session-micro-canary";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const runId = argument("--run");
  if (!runId) throw new Error("e2a19_run_argument_required");
  const result = loadE2A19Run(runId);
  console.log(JSON.stringify({
    run_id: runId,
    run_directory: result.runDir,
    summary: result.summary,
    usage: result.usage,
    human_review_packet: result.reviewPacket,
    artifact_validation: result.artifactValidation
  }, null, 2));
  if (!result.artifactValidation.passed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message :
    "e2a19_report_failed");
  process.exitCode = 1;
}
