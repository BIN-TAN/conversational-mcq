import {
  loadLatestE2A3Evaluation
} from "../src/lib/evaluation/formative/e2a3-topic-dialogue-evaluation";

function main() {
  const result = loadLatestE2A3Evaluation();
  console.log(JSON.stringify({
    latest: result.latest,
    manifest: result.manifest,
    summary: result.summary,
    review_packet_status: (result.review_packet as { review_status?: unknown }).review_status ?? null,
    approval_draft: result.approval_evidence_draft
  }, null, 2));
}

main();

