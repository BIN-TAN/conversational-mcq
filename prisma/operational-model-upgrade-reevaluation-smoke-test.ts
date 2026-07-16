import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  currentModelUpgradeEvaluationProtocolHash,
  executeModelUpgradeCandidateEvaluation,
  runDir,
  type EvaluationCaseRecord,
  type ModelUpgradeRunRecord
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  confirmModelUpgradeDerivedHumanReview,
  evaluateModelUpgradeDerivedApprovalEvidence,
  hashModelUpgradeSourceArtifacts,
  loadModelUpgradeDerivedCase,
  reevaluateModelUpgradeRunOffline,
  writeModelUpgradeDerivedApprovalArtifact
} from "../src/lib/operational/model-upgrade-reevaluation";
import {
  buildOperationalModelUpgradeComparison,
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
} from "../src/lib/operational/model-upgrade";
import { FakeCandidateEvaluationProvider, assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

function json<T>(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const previousPersistence = process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED = "1";
  const provider = new FakeCandidateEvaluationProvider();
  const source = await executeModelUpgradeCandidateEvaluation({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    provider,
    skipLiveEnvironmentGuardsForTest: true
  });
  const callsAfterSource = provider.calls;
  const sourceProtocolHash = createHash("sha256").update("synthetic-pre-contract-protocol").digest("hex");
  const sourceRunPath = path.join(runDir(source.run_public_id), "run.json");
  const sourceRun = json<ModelUpgradeRunRecord>(sourceRunPath);
  writeJson(sourceRunPath, {
    ...sourceRun,
    evaluation_protocol_hash: sourceProtocolHash,
    status: "completed_failed",
    recommendation: "candidate_blocked_by_critical_failures",
    approval_eligibility: { eligible: false, blocking_reasons: ["critical_automated_failure"] }
  });

  const legacyFailures = [
    "student_profiling_specific_misconception",
    "formative_value_and_planning_distractor_first_selection",
    "formative_activity_distractor_probe"
  ];
  for (const fixtureId of legacyFailures) {
    const casePath = path.join(runDir(source.run_public_id), "cases", `${fixtureId}.json`);
    const sourceCase = json<EvaluationCaseRecord>(casePath);
    const legacyIssue = fixtureId === "formative_activity_distractor_probe"
      ? "required_correctness_summary_missing"
      : "required_student_facing_output_missing";
    writeJson(casePath, {
      ...sourceCase,
      validator_results: {
        ...sourceCase.validator_results,
        output_completeness: { status: "failed", issue_codes: [legacyIssue], critical: true }
      },
      automated_review_status: "pedagogical_quality_failure",
      critical_failure: true,
      critical_failure_reasons: [`required_production_output_missing:${legacyIssue}`]
    });
  }

  const sourceHashBefore = hashModelUpgradeSourceArtifacts(source.run_public_id);
  const comparison = buildOperationalModelUpgradeComparison({ manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH });
  const derived = reevaluateModelUpgradeRunOffline({
    candidateRunPublicId: source.run_public_id,
    expectedRuntimeCandidateHash: comparison.candidate.runtime_candidate_hash,
    expectedSourceEvaluationProtocolHash: sourceProtocolHash
  });
  const sourceHashAfter = hashModelUpgradeSourceArtifacts(source.run_public_id);

  assert(provider.calls === callsAfterSource, "Offline re-evaluation must make zero provider calls.");
  assert(sourceHashAfter.artifact_sha256 === sourceHashBefore.artifact_sha256, "Source run artifacts must remain byte-stable.");
  assert(derived.source_artifact_sha256 === sourceHashBefore.artifact_sha256, "Derived evaluation must bind source artifacts.");
  assert(derived.source_provider_run_id === source.run_public_id, "Derived evaluation must preserve source linkage.");
  assert(derived.runtime_candidate_hash === source.runtime_candidate_hash, "Re-evaluation must not alter the runtime hash.");
  assert(derived.evaluation_protocol_hash === currentModelUpgradeEvaluationProtocolHash(), "Derived evaluation must use the current protocol.");
  assert(derived.evaluation_protocol_hash !== sourceProtocolHash, "Evaluator correction must produce a separate protocol hash.");
  assert(derived.provider_calls_made === 0, "Derived record must record zero provider calls.");
  assert(derived.case_results.filter((entry) => entry.original_critical_failure).length === 3, "Original false failures must remain visible.");
  assert(derived.case_results.every((entry) => !entry.critical_failure), "Corrected contracts should remove the synthetic false failures.");
  for (const fixtureId of legacyFailures) {
    const derivedCase = loadModelUpgradeDerivedCase(derived.derived_evaluation_id, fixtureId);
    assert(derivedCase.original_findings.critical_failure, `Original findings must remain visible for ${fixtureId}.`);
    assert(!derivedCase.derived_findings.critical_failure, `Derived findings should be clean for ${fixtureId}.`);
  }

  const pending = evaluateModelUpgradeDerivedApprovalEvidence({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: source.run_public_id,
    derivedEvaluationId: derived.derived_evaluation_id,
    expectedRuntimeCandidateHash: comparison.candidate.runtime_candidate_hash,
    expectedEvaluationProtocolHash: derived.evaluation_protocol_hash
  });
  assert(!pending.eligible && pending.blocking_reasons.includes("derived_human_review_not_approved"), "Human review must remain mandatory.");

  confirmModelUpgradeDerivedHumanReview({
    derivedEvaluationId: derived.derived_evaluation_id,
    reviewArtifactPath: derived.review_artifact_paths.review_records_jsonl,
    confirmPhrase: "I reviewed all required candidate outputs",
    decision: "approve",
    reviewer: "offline_reevaluation_smoke_reviewer"
  });

  const mixedHash = evaluateModelUpgradeDerivedApprovalEvidence({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: source.run_public_id,
    derivedEvaluationId: derived.derived_evaluation_id,
    expectedRuntimeCandidateHash: "unrelated-runtime-hash",
    expectedEvaluationProtocolHash: derived.evaluation_protocol_hash
  });
  assert(!mixedHash.eligible, "Approval must reject unrelated runtime and evaluation identities.");

  const approval = writeModelUpgradeDerivedApprovalArtifact({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    candidateRunPublicId: source.run_public_id,
    derivedEvaluationId: derived.derived_evaluation_id,
    expectedRuntimeCandidateHash: comparison.candidate.runtime_candidate_hash,
    expectedEvaluationProtocolHash: derived.evaluation_protocol_hash
  });
  assert(approval.status === "approval_evidence_ready", "Clean reviewed derived evidence should permit approval evidence.");
  assert(approval.source_provider_run_id === source.run_public_id, "Approval must reference the provider run.");
  assert(approval.derived_evaluation_id === derived.derived_evaluation_id, "Approval must reference the derived evaluation.");
  assert(provider.calls === callsAfterSource, "Review and approval must not make provider calls.");
  assert(hashModelUpgradeSourceArtifacts(source.run_public_id).artifact_sha256 === sourceHashBefore.artifact_sha256, "Approval must preserve source artifacts.");

  console.log(JSON.stringify({
    status: "passed",
    source_provider_run_id: source.run_public_id,
    derived_evaluation_id: derived.derived_evaluation_id,
    runtime_candidate_hash: derived.runtime_candidate_hash,
    source_evaluation_protocol_hash: derived.source_evaluation_protocol_hash,
    evaluation_protocol_hash: derived.evaluation_protocol_hash,
    original_failures_preserved: 3,
    derived_failures: 0,
    provider_calls_during_reevaluation: 0,
    no_openai_call: true
  }, null, 2));

  if (previousPersistence === undefined) delete process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  else process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED = previousPersistence;
}

main().catch((error) => {
  delete process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  console.error(error);
  process.exit(1);
});
