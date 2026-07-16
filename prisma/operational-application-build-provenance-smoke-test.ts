import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  resolveApplicationBuildInfo
} from "../src/lib/provenance/application-build-info";
import {
  buildModelUpgradeEvaluationPlan,
  confirmModelUpgradeHumanReview,
  currentModelUpgradeEvaluationProtocolHash,
  executeModelUpgradeCandidateEvaluation,
  exportModelUpgradeReviewArtifact,
  loadModelUpgradeRun,
  runDir,
  writeModelUpgradeApprovalArtifact
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  buildOperationalModelUpgradeComparison,
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
} from "../src/lib/operational/model-upgrade";
import { FakeCandidateEvaluationProvider, assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeArtifact(dir: string, commit: string, timestamp = "2026-07-16T00:00:00.000Z") {
  const filePath = path.join(dir, "application-build-info.json");
  writeFileSync(filePath, `${JSON.stringify({
    application_git_commit: commit,
    application_git_commit_source: "git_fallback",
    application_build_timestamp: timestamp,
    resolver_version: "application-build-provenance-v1"
  })}\n`, "utf8");
  return filePath;
}

async function main() {
  const appInfoOutput = execFileSync("npm", ["run", "app:build-info", "--silent"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const appInfo = JSON.parse(appInfoOutput) as {
    application_git_commit?: string;
    application_git_commit_source?: string;
    application_build_timestamp?: string | null;
  };
  const plan = buildModelUpgradeEvaluationPlan({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
  });
  assert(appInfo.application_git_commit === plan.application_git_commit, "app:build-info and evaluation plan should report the same commit.");
  assert(/^[a-f0-9]{40}$/u.test(String(plan.application_git_commit)), "Evaluation plan commit should be a valid normalized SHA-1.");
  assert(plan.application_git_commit_source === appInfo.application_git_commit_source, "Evaluation plan should report the same commit source as app:build-info.");

  const validCommit = "a".repeat(40);
  const otherValidCommit = "b".repeat(40);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "app-build-provenance-"));
  const validArtifact = writeArtifact(tmp, validCommit);
  const validResolution = resolveApplicationBuildInfo({
    cwd: tmp,
    artifactPath: validArtifact,
    env: {},
    allowGitFallback: false
  });
  assert(validResolution.ok && validResolution.info.application_git_commit === validCommit, "Valid artifact commit should resolve.");

  const malformedArtifact = writeArtifact(tmp, "not-a-commit");
  const malformedResolution = resolveApplicationBuildInfo({
    cwd: tmp,
    artifactPath: malformedArtifact,
    env: {},
    allowGitFallback: false
  });
  assert(!malformedResolution.ok && malformedResolution.code === "application_git_commit_malformed", "Malformed commit should be rejected.");

  const conflictArtifact = writeArtifact(tmp, validCommit);
  const conflictResolution = resolveApplicationBuildInfo({
    cwd: tmp,
    artifactPath: conflictArtifact,
    env: { APPLICATION_GIT_COMMIT: otherValidCommit },
    allowGitFallback: false
  });
  assert(!conflictResolution.ok && conflictResolution.code === "application_build_provenance_conflict", "Conflicting provenance sources should fail closed.");

  const missingResolution = resolveApplicationBuildInfo({
    cwd: tmp,
    artifactPath: path.join(tmp, "missing.json"),
    env: {},
    allowGitFallback: false
  });
  assert(!missingResolution.ok && missingResolution.code === "application_git_commit_unavailable", "Missing provenance should block before provider dispatch.");

  const previousPersistence = process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED = "1";
  try {
    const run = await executeModelUpgradeCandidateEvaluation({
      manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
      provider: new FakeCandidateEvaluationProvider(),
      skipLiveEnvironmentGuardsForTest: true
    });
    const persistedRun = loadModelUpgradeRun(run.run_public_id);
    assert(persistedRun.application_git_commit === appInfo.application_git_commit, "Run JSON should persist the app build commit.");
    assert(persistedRun.application_git_commit_source === appInfo.application_git_commit_source, "Run JSON should persist the app build commit source.");

    const firstFixtureId = persistedRun.fixture_ids[0];
    const caseRecord = readJson<{
      application_git_commit?: string;
      application_git_commit_source?: string;
      application_build_timestamp?: string | null;
    }>(path.join(runDir(run.run_public_id), "cases", `${firstFixtureId}.json`));
    assert(caseRecord.application_git_commit === persistedRun.application_git_commit, "Case evidence should persist the app build commit.");
    assert(caseRecord.application_git_commit_source === persistedRun.application_git_commit_source, "Case evidence should persist the app build source.");

    const exportSummary = exportModelUpgradeReviewArtifact(run.run_public_id);
    const reviewSummary = readJson<{
      application_git_commit?: string;
      application_git_commit_source?: string;
    }>(exportSummary.artifact_paths.review_records_jsonl.replace("review_records.jsonl", "review_summary.json"));
    assert(reviewSummary.application_git_commit === persistedRun.application_git_commit, "Review summary should persist the app build commit.");
    const reviewRecord = JSON.parse(readFileSync(exportSummary.artifact_paths.review_records_jsonl, "utf8").trim().split(/\n/u)[0]) as {
      application_git_commit?: string;
      application_git_commit_source?: string;
    };
    assert(reviewRecord.application_git_commit === persistedRun.application_git_commit, "Review record should persist the app build commit.");

    confirmModelUpgradeHumanReview({
      candidateRunPublicId: run.run_public_id,
      reviewArtifactPath: exportSummary.artifact_paths.review_records_jsonl,
      confirmPhrase: "I reviewed all required candidate outputs",
      decision: "approve",
      reviewer: "smoke_reviewer"
    });
    const comparison = buildOperationalModelUpgradeComparison({
      manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
    });
    const approval = writeModelUpgradeApprovalArtifact({
      manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
      candidateRunPublicId: run.run_public_id,
      expectedRuntimeCandidateHash: comparison.candidate.runtime_candidate_hash,
      expectedEvaluationProtocolHash: currentModelUpgradeEvaluationProtocolHash()
    });
    assert(approval.status === "approval_evidence_ready", "Approved fake run should write approval evidence.");
    const approvalArtifact = readJson<{
      application_git_commit?: string;
      application_git_commit_source?: string;
    }>(approval.artifact_path);
    assert(approvalArtifact.application_git_commit === persistedRun.application_git_commit, "Approval evidence should persist the app build commit.");
    assert(approvalArtifact.application_git_commit_source === persistedRun.application_git_commit_source, "Approval evidence should persist the app build source.");
  } finally {
    if (previousPersistence === undefined) {
      delete process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
    } else {
      process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED = previousPersistence;
    }
  }

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    application_git_commit: plan.application_git_commit,
    application_git_commit_source: plan.application_git_commit_source,
    artifacts_checked: ["run.json", "case.json", "review_summary.json", "review_records.jsonl", "approval_evidence.json"],
    malformed_commit_rejected: true,
    conflicting_sources_blocked: true,
    missing_commit_blocks_before_provider_call: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
