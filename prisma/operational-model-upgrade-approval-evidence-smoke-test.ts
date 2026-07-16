import { readFileSync, writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import {
  confirmModelUpgradeHumanReview,
  currentModelUpgradeEvaluationProtocolHash,
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
  const expectedRuntimeHash = comparison.candidate.runtime_candidate_hash;
  const expectedProtocolHash = currentModelUpgradeEvaluationProtocolHash();

  let nonexistentBlocked = false;
  try {
    evaluateModelUpgradeApprovalEvidence({
      manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
      candidateRunPublicId: "omur_missing",
      expectedRuntimeCandidateHash: expectedRuntimeHash,
      expectedEvaluationProtocolHash: expectedProtocolHash
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
    expectedRuntimeCandidateHash: "wrong",
    expectedEvaluationProtocolHash: expectedProtocolHash
  });
  assert(!wrongHash.eligible && wrongHash.blocking_reasons.includes("runtime_candidate_hash_mismatch"), "Wrong runtime hash should block approval.");

  const pending = evaluateModelUpgradeApprovalEvidence({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: run.run_public_id,
    expectedRuntimeCandidateHash: expectedRuntimeHash,
    expectedEvaluationProtocolHash: expectedProtocolHash
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
    expectedRuntimeCandidateHash: expectedRuntimeHash,
    expectedEvaluationProtocolHash: expectedProtocolHash
  });
  assert(approved.status === "approval_evidence_ready", "Accepted clean run should permit approval evidence.");
  assert(approved.artifact_path, "Approval evidence should include an artifact path.");
  assert(approved.runtime_candidate_hash === expectedRuntimeHash, "Approval evidence must bind the frozen runtime hash.");
  assert(approved.evaluation_protocol_hash === expectedProtocolHash, "Approval evidence must bind the frozen protocol hash.");
  assert(approved.approval_evidence_hash.length === 64, "Approval evidence must have a deterministic SHA-256 identity.");
  assert(
    approved.exact_operational_approved_config_hash === expectedRuntimeHash,
    "Approval evidence should output the exact candidate active hash."
  );
  assert(
    approved.rollback_hash === comparison.baseline.approved_active_configuration_hash,
    "Old approved baseline should remain available for rollback."
  );

  const reviewArtifactBeforeTamper = readFileSync(exportSummary.artifact_paths.review_records_jsonl, "utf8");
  writeFileSync(exportSummary.artifact_paths.review_records_jsonl, `${reviewArtifactBeforeTamper}\n`, "utf8");
  const tamperedReview = evaluateModelUpgradeApprovalEvidence({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: run.run_public_id,
    expectedRuntimeCandidateHash: expectedRuntimeHash,
    expectedEvaluationProtocolHash: expectedProtocolHash
  });
  assert(
    !tamperedReview.eligible && tamperedReview.blocking_reasons.includes("human_review_artifact_hash_mismatch"),
    "Approval must fail if the reviewed artifact changes after human confirmation."
  );
  writeFileSync(exportSummary.artifact_paths.review_records_jsonl, reviewArtifactBeforeTamper, "utf8");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    run_public_id: run.run_public_id,
    exact_operational_approved_config_hash: approved.exact_operational_approved_config_hash,
    evaluation_protocol_hash: expectedProtocolHash,
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
