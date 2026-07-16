import { loadEnvConfig } from "@next/env";
import { confirmModelUpgradeHumanReview } from "../src/lib/operational/model-upgrade-evaluation";
import { argValue } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const candidateRun = argValue("--candidate-run");
const reviewArtifact = argValue("--review-artifact");
const confirm = argValue("--confirm");
const decision = argValue("--decision");
const reviewer = argValue("--reviewer");

if (
  !candidateRun ||
  !reviewArtifact ||
  !confirm ||
  (decision !== "approve" && decision !== "reject") ||
  !reviewer
) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_review_confirmation_arguments",
    required: [
      "--candidate-run <run_public_id>",
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
  const run = confirmModelUpgradeHumanReview({
    candidateRunPublicId: candidateRun,
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
