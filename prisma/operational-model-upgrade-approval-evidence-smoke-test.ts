import { loadEnvConfig } from "@next/env";
import {
  confirmModelUpgradeHumanReview,
  evaluateModelUpgradeApprovalEvidence,
  executeModelUpgradeCandidateEvaluation,
  exportModelUpgradeReviewArtifact,
  writeModelUpgradeApprovalArtifact
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  buildOperationalModelUpgradeComparison,
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
} from "../src/lib/operational/model-upgrade";
import { FakeCandidateEvaluationProvider, assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

async function main() {
  const previousPersistence = process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED = "1";
  const comparison = buildOperationalModelUpgradeComparison({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
  });
  const expectedHash = comparison.candidate.candidate_active_configuration_hash;

  let nonexistentBlocked = false;
  try {
    evaluateModelUpgradeApprovalEvidence({
      manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
      candidateRunPublicId: "omur_missing",
      expectedHash
    });
  } catch {
    nonexistentBlocked = true;
  }
  assert(nonexistentBlocked, "Nonexistent run should block approval evidence.");

  const run = await executeModelUpgradeCandidateEvaluation({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    provider: new FakeCandidateEvaluationProvider(),
    skipLiveEnvironmentGuardsForTest: true
  });

  const wrongHash = evaluateModelUpgradeApprovalEvidence({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: run.run_public_id,
    expectedHash: "wrong"
  });
  assert(!wrongHash.eligible && wrongHash.blocking_reasons.includes("candidate_hash_mismatch"), "Wrong hash should block approval.");

  const pending = evaluateModelUpgradeApprovalEvidence({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: run.run_public_id,
    expectedHash
  });
  assert(!pending.eligible && pending.blocking_reasons.includes("human_review_not_approved"), "Pending human review should block approval.");

  const exportSummary = exportModelUpgradeReviewArtifact(run.run_public_id);
  confirmModelUpgradeHumanReview({
    candidateRunPublicId: run.run_public_id,
    reviewArtifactPath: exportSummary.artifact_paths.review_records_jsonl,
    confirmPhrase: "I reviewed all required candidate outputs",
    decision: "approve",
    reviewer: "smoke_reviewer"
  });

  const approved = writeModelUpgradeApprovalArtifact({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: run.run_public_id,
    expectedHash
  });
  assert(approved.status === "approval_evidence_ready", "Accepted clean run should permit approval evidence.");
  assert(approved.artifact_path, "Approval evidence should include an artifact path.");
  assert(
    approved.exact_operational_approved_config_hash === expectedHash,
    "Approval evidence should output the exact candidate active hash."
  );
  assert(
    approved.rollback_hash === comparison.baseline.approved_active_configuration_hash,
    "Old approved baseline should remain available for rollback."
  );

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    run_public_id: run.run_public_id,
    exact_operational_approved_config_hash: approved.exact_operational_approved_config_hash,
    rollback_hash: approved.rollback_hash
  }, null, 2));

  if (previousPersistence === undefined) {
    delete process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  } else {
    process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED = previousPersistence;
  }
}

main().catch((error) => {
  delete process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  console.error(error);
  process.exit(1);
});
