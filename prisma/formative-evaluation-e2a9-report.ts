import path from "node:path";
import {
  E2A9_ARTIFACT_ROOT,
  latestE2A9RunDirectory,
  loadE2A9Adjudication
} from "@/lib/evaluation/formative/e2a9-remain-dialogue-adjudication";

function requestedRunDirectory() {
  const index = process.argv.indexOf("--run");
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value ? path.join(E2A9_ARTIFACT_ROOT, value) : null;
}

function main() {
  const runDirectory = requestedRunDirectory() ?? latestE2A9RunDirectory();
  if (!runDirectory) throw new Error("e2a9_adjudication_run_not_found");
  const result = loadE2A9Adjudication(runDirectory);
  console.log(JSON.stringify({
    status: "read_only_report",
    run_id: path.basename(runDirectory),
    artifact_directory: runDirectory,
    manifest: result.manifest,
    reporting_correction: result.reporting,
    regeneration_analysis: result.regeneration_analysis,
    candidate_delta: result.candidate_delta,
    human_review_summary: result.human_review_summary,
    adjudication_row_count: result.adjudication_rows.length,
    replay_row_count: result.replay_rows.length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
