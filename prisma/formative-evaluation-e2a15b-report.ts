import { loadE2A15BRun } from
  "@/lib/evaluation/formative/e2a15b-protected-request-supplement";

const runIndex = process.argv.indexOf("--run");
const runId = runIndex >= 0 ? process.argv[runIndex + 1] : undefined;
if (!runId) throw new Error("e2a15b_report_run_required");

const result = loadE2A15BRun(runId);
console.log(JSON.stringify({
  run_directory: result.runDir,
  final_summary: result.finalSummary,
  supplement_summary: result.supplementSummary,
  provider_usage: result.providerUsage,
  review_packet: {
    packet_version: result.reviewPacket.packet_version,
    review_item_count: result.reviewPacket.review_item_count,
    composition: result.reviewPacket.composition,
    human_review_completed: result.reviewPacket.human_review_completed
  },
  sampling_plan: result.samplingPlan,
  artifact_validation: result.artifactValidation
}, null, 2));
if (!result.artifactValidation.passed) process.exitCode = 1;
