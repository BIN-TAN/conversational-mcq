import { loadEnvConfig } from "@next/env";
import {
  confirmModelUpgradeHumanReview,
  executeModelUpgradeCandidateEvaluation,
  exportModelUpgradeReviewArtifact
} from "../src/lib/operational/model-upgrade-evaluation";
import { FULL_GPT56_V2_CANDIDATE_CONFIG_PATH } from "../src/lib/operational/model-upgrade";
import { FakeCandidateEvaluationProvider, assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

async function main() {
  const cleanRun = await executeModelUpgradeCandidateEvaluation({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    provider: new FakeCandidateEvaluationProvider(),
    skipLiveEnvironmentGuardsForTest: true
  });
  const exportSummary = exportModelUpgradeReviewArtifact(cleanRun.run_public_id);
  assert(exportSummary.all_required_cases_represented, "Review export should include all required cases.");
  assert(exportSummary.review_record_count === cleanRun.fixture_ids.length, "Review record count should match fixture count.");
  assert(exportSummary.application_git_commit === cleanRun.application_git_commit, "Review summary should preserve build provenance.");

  let missingBlocked = false;
  try {
    confirmModelUpgradeHumanReview({
      candidateRunPublicId: cleanRun.run_public_id,
      reviewArtifactPath: exportSummary.artifact_paths.review_records_jsonl,
      confirmPhrase: "wrong phrase",
      decision: "approve",
      reviewer: "smoke_reviewer"
    });
  } catch {
    missingBlocked = true;
  }
  assert(missingBlocked, "Review confirmation should require exact human confirmation phrase.");

  const rejected = confirmModelUpgradeHumanReview({
    candidateRunPublicId: cleanRun.run_public_id,
    reviewArtifactPath: exportSummary.artifact_paths.review_records_jsonl,
    confirmPhrase: "I reviewed all required candidate outputs",
    decision: "reject",
    reviewer: "smoke_reviewer"
  });
  assert(rejected.human_review_status === "rejected", "Rejected review should be recorded.");
  assert(rejected.recommendation === "candidate_rejected_by_human_review", "Rejected review should block recommendation.");
  assert(rejected.human_review?.application_git_commit === cleanRun.application_git_commit, "Human review record should preserve build provenance.");

  const criticalRun = await executeModelUpgradeCandidateEvaluation({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    provider: new FakeCandidateEvaluationProvider({ forbiddenText: "The answer key says the correct answer is C." }),
    skipLiveEnvironmentGuardsForTest: true
  });
  const criticalExport = exportModelUpgradeReviewArtifact(criticalRun.run_public_id);
  let criticalBlocked = false;
  try {
    confirmModelUpgradeHumanReview({
      candidateRunPublicId: criticalRun.run_public_id,
      reviewArtifactPath: criticalExport.artifact_paths.review_records_jsonl,
      confirmPhrase: "I reviewed all required candidate outputs",
      decision: "approve",
      reviewer: "smoke_reviewer"
    });
  } catch {
    criticalBlocked = true;
  }
  assert(criticalBlocked, "Critical automated failure must block human approval.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    clean_run_public_id: cleanRun.run_public_id,
    rejected_review_blocks_approval: true,
    critical_failure_blocks_approval: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
