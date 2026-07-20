import {
  loadE2A20Run
} from "@/lib/evaluation/formative/e2a20-evidence-driven-transition-adjudication";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const runId = argument("--run");
  if (!runId) throw new Error("e2a20_run_argument_required");
  const result = loadE2A20Run(runId);
  console.log(JSON.stringify({
    run_id: runId,
    run_directory: result.runDir,
    summary: result.summary,
    turn4_adjudication: result.turn4,
    tutor_output_review_packet: result.tutorReview,
    artifact_validation: result.artifactValidation
  }, null, 2));
  if (!result.artifactValidation.passed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "e2a20_report_failed");
  process.exitCode = 1;
}
