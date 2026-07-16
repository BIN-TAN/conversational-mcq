import { loadEnvConfig } from "@next/env";
import { exportModelUpgradeReviewArtifact } from "../src/lib/operational/model-upgrade-evaluation";
import { argValue } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const candidateRun = argValue("--candidate-run");

if (!candidateRun) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "candidate_run_required",
    required: ["--candidate-run <run_public_id>"],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

try {
  const summary = exportModelUpgradeReviewArtifact(candidateRun);
  console.log(JSON.stringify({
    status: "review_export_ready",
    no_provider_call: true,
    ...summary,
    review_confirm_command:
      `npm run operational:model-upgrade:review-confirm -- --candidate-run ${candidateRun} --review-artifact ${summary.artifact_paths.review_records_jsonl} --confirm "I reviewed all required candidate outputs" --decision approve --reviewer <safe_identifier>`
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof Error ? error.message : "review_export_failed",
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}
