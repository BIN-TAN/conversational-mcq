import { loadEnvConfig } from "@next/env";
import { exportModelUpgradeReviewArtifact } from "../src/lib/operational/model-upgrade-evaluation";
import { loadModelUpgradeDerivedEvaluation } from "../src/lib/operational/model-upgrade-reevaluation";
import { argValue } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const candidateRun = argValue("--candidate-run");
const derivedEvaluation = argValue("--derived-evaluation");

if (!candidateRun && !derivedEvaluation) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "candidate_run_required",
    required: ["--candidate-run <run_public_id> or --derived-evaluation <derived_evaluation_id>"],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

try {
  if (derivedEvaluation) {
    const record = loadModelUpgradeDerivedEvaluation(derivedEvaluation);
    console.log(JSON.stringify({
      status: "review_export_ready",
      no_provider_call: true,
      source_provider_run_id: record.source_provider_run_id,
      derived_evaluation_id: record.derived_evaluation_id,
      runtime_candidate_hash: record.runtime_candidate_hash,
      source_evaluation_protocol_hash: record.source_evaluation_protocol_hash,
      evaluation_protocol_hash: record.evaluation_protocol_hash,
      artifact_paths: record.review_artifact_paths,
      review_confirm_command:
        `npm run operational:model-upgrade:review-confirm -- --derived-evaluation ${derivedEvaluation} --review-artifact ${record.review_artifact_paths.review_records_jsonl} --confirm "I reviewed all required candidate outputs" --decision approve --reviewer <safe_identifier>`
    }, null, 2));
    process.exit(0);
  }
  const summary = exportModelUpgradeReviewArtifact(candidateRun!);
  console.log(JSON.stringify({
    status: "review_export_ready",
    no_provider_call: true,
    ...summary,
    review_confirm_command:
      `npm run operational:model-upgrade:review-confirm -- --candidate-run ${candidateRun!} --review-artifact ${summary.artifact_paths.review_records_jsonl} --confirm "I reviewed all required candidate outputs" --decision approve --reviewer <safe_identifier>`
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof Error ? error.message : "review_export_failed",
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}
