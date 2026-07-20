import {
  loadE2A17Run
} from "@/lib/evaluation/formative/e2a17-bounded-student-simulator-canary";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runId = argument("--run");
if (!runId) throw new Error("e2a17_report_run_required");
const result = loadE2A17Run(runId);
console.log(JSON.stringify({
  run_id: runId,
  run_directory: result.runDir,
  summary: result.summary,
  provider_usage: result.usage,
  human_review_packet: {
    review_item_count: result.reviewPacket.review_item_count,
    human_review_required: result.reviewPacket.human_review_required,
    human_review_completed: result.reviewPacket.human_review_completed
  },
  artifact_validation: result.artifactValidation
}, null, 2));
if (!result.artifactValidation.passed) process.exitCode = 1;
