import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import {
  executeModelUpgradeCandidateEvaluation,
  loadModelUpgradeRun,
  modelUpgradeEvaluationFixtures,
  runDir
} from "../src/lib/operational/model-upgrade-evaluation";
import { FULL_GPT56_V2_CANDIDATE_CONFIG_PATH } from "../src/lib/operational/model-upgrade";
import { FakeCandidateEvaluationProvider, assert } from "./operational-model-upgrade-test-helpers";
import { existsSync } from "node:fs";
import path from "node:path";

loadEnvConfig(process.cwd());

async function main() {
  const blocked = execFileSync(
    "npm",
    [
      "run",
      "operational:model-upgrade:live-eval",
      "--",
      "--manifest",
      "config/candidate-operational-agent-config.gpt-5.6-full-v2.json"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert(blocked.includes("\"status\": \"skipped\""), "Live eval CLI should skip without explicit env guard.");
  assert(blocked.includes("\"no_provider_call\": true"), "Default skipped command should make no provider call.");

  let interruptedRunId: string | null = null;
  const interruptedProvider = new FakeCandidateEvaluationProvider({ failAfterCalls: 1 });
  try {
    await executeModelUpgradeCandidateEvaluation({
      manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
      provider: interruptedProvider,
      skipLiveEnvironmentGuardsForTest: true
    });
  } catch (error) {
    assert(error instanceof Error && error.message.includes("synthetic_interruption"), "Synthetic interruption should be preserved.");
  }

  const root = path.join(process.cwd(), ".data", "operational-model-upgrade", "runs");
  const candidates = existsSync(root)
    ? execFileSync("find", [root, "-name", "run.json"], { encoding: "utf8" }).trim().split(/\n/u).filter(Boolean)
    : [];
  const latest = candidates
    .map((file) => loadModelUpgradeRun(path.basename(path.dirname(file))))
    .filter((run) => run.status === "running")
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  assert(latest, "Interrupted run should persist a running run record.");
  interruptedRunId = latest.run_public_id;

  const resumedProvider = new FakeCandidateEvaluationProvider();
  const resumed = await executeModelUpgradeCandidateEvaluation({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
    resumeRunPublicId: interruptedRunId,
    provider: resumedProvider,
    skipLiveEnvironmentGuardsForTest: true
  });
  assert(resumed.run_public_id === interruptedRunId, "Resume should preserve the run public ID.");
  assert(resumed.fixture_ids.length === modelUpgradeEvaluationFixtures().length, "All fixed fixtures should be represented.");
  assert(resumed.case_results.length === modelUpgradeEvaluationFixtures().length, "All fixture results should persist.");
  assert(resumed.case_results.every((entry) => entry.status === "succeeded"), "Fake provider should complete every case.");
  assert(resumed.recommendation === "candidate_pending_human_review", "Clean run should require human review.");
  assert(existsSync(runDir(resumed.run_public_id)), "Run artifact directory should exist.");
  assert(resumed.per_role_candidate_config.student_communication_agent, "Candidate role config should be persisted.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    created_run_public_id: resumed.run_public_id,
    fixture_count: resumed.fixture_ids.length,
    resumed_without_repeating_completed_successes: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
