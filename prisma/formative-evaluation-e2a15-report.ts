import { loadE2A15Evaluation } from
  "@/lib/evaluation/formative/e2a15-protected-request-subset";

const index = process.argv.indexOf("--run");
const runId = index >= 0 ? process.argv[index + 1] : undefined;
if (!runId) throw new Error("e2a15_report_run_required");

const result = loadE2A15Evaluation(runId);
console.log(JSON.stringify({
  run_directory: result.runDir,
  summary: result.summary,
  provider_usage: result.providerUsage,
  human_review_summary: result.humanReviewSummary,
  human_review_packet: {
    packet_version: result.humanReviewPacket.packet_version,
    review_target: result.humanReviewPacket.review_target,
    review_item_count: result.humanReviewPacket.review_item_count,
    human_review_completed: result.humanReviewPacket.human_review_completed,
    no_human_review_fabricated:
      result.humanReviewPacket.no_human_review_fabricated
  },
  artifact_count: result.artifact_count
}, null, 2));
