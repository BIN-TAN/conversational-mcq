import { loadEnvConfig } from "@next/env";
import { confirmModelUpgradeHumanReview } from "../src/lib/operational/model-upgrade-evaluation";
import { confirmModelUpgradeDerivedHumanReview } from "../src/lib/operational/model-upgrade-reevaluation";
import { argValue } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const candidateRun = argValue("--candidate-run");
const derivedEvaluation = argValue("--derived-evaluation");
const reviewArtifact = argValue("--review-artifact");
const confirm = argValue("--confirm");
const decision = argValue("--decision");
const reviewer = argValue("--reviewer");

if (
  (!candidateRun && !derivedEvaluation) ||
  !reviewArtifact ||
  !confirm ||
  (decision !== "approve" && decision !== "reject") ||
  !reviewer
) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_review_confirmation_arguments",
    required: [
      "--candidate-run <run_public_id> or --derived-evaluation <derived_evaluation_id>",
      "--review-artifact <path_or_id>",
      "--confirm \"I reviewed all required candidate outputs\"",
      "--decision approve|reject",
      "--reviewer <safe_identifier>"
    ],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

try {
  if (derivedEvaluation) {
    const record = confirmModelUpgradeDerivedHumanReview({
      derivedEvaluationId: derivedEvaluation,
      reviewArtifactPath: reviewArtifact,
      confirmPhrase: confirm,
      decision,
      reviewer
    });
    console.log(JSON.stringify({
      status: "review_recorded",
      no_provider_call: true,
      source_provider_run_id: record.source_provider_run_id,
      derived_evaluation_id: record.derived_evaluation_id,
      human_review_status: record.human_review_status,
      recommendation: record.recommendation
    }, null, 2));
    process.exit(0);
  }
  const run = confirmModelUpgradeHumanReview({
    candidateRunPublicId: candidateRun!,
    reviewArtifactPath: reviewArtifact,
    confirmPhrase: confirm,
    decision,
    reviewer
  });
  console.log(JSON.stringify({
    status: "review_recorded",
    no_provider_call: true,
    candidate_run_public_id: run.run_public_id,
    human_review_status: run.human_review_status,
    recommendation: run.recommendation,
    approval_eligibility: run.approval_eligibility
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof Error ? error.message : "review_confirmation_failed",
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}
