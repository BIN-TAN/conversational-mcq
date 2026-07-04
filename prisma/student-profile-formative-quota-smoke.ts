import { readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const smokeRoot = path.join(root, ".data", "profile-formative-quota-smoke");
const liveDir = path.join(smokeRoot, "live-trials");
const reviewDir = path.join(smokeRoot, "trial-review");
const fixtureLiveDir = path.join(smokeRoot, "fixture-live-trials");
const fixtureReviewDir = path.join(smokeRoot, "fixture-review");

type QuotaSummary = {
  status?: string;
  provider_blocked?: boolean;
  provider_failure?: {
    typed_failure_reason?: string;
    provider_error_code?: string;
  };
  scenario_count?: number;
  live_scenarios_run?: number;
  provider_quota_block?: {
    provider_attempted_scenarios?: number;
    scenarios_completed_before_block?: number;
    scenarios_skipped_after_block?: number;
    model_quality_evaluable?: boolean;
  };
  final_live_qa_acceptance?: boolean;
  result_category_counts?: Record<string, number>;
};

type ScenarioArtifact = {
  provider_request_made?: boolean;
  skipped_reason?: string;
  provider_vs_effective_outcome?: {
    passed_as?: string;
  };
  failures?: string[];
};

type ReviewArtifact = {
  status?: string;
  provider_blocking_findings?: unknown[];
  infrastructure_findings?: unknown[];
  validator_findings?: unknown[];
  model_quality_findings?: unknown[];
  safety_findings?: unknown[];
  final_live_qa_acceptance?: boolean;
  rerun_required_after_quota_restored?: boolean;
  run_level_message?: string | null;
  openai_calls_made?: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNpm(args: string[], env: Record<string, string | undefined>, expectCode: number | null) {
  const result = spawnSync("npm", args, {
    cwd: root,
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });
  if (expectCode !== null && result.status !== expectCode) {
    throw new Error([
      `Command failed: npm ${args.join(" ")}`,
      `Expected exit ${expectCode}, got ${result.status}`,
      result.stdout,
      result.stderr
    ].join("\n"));
  }
  return result;
}

async function latestJsonFile(dir: string, prefix: string) {
  const files = (await readdir(dir)).filter((file) => file.startsWith(prefix) && file.endsWith(".json")).sort();
  assert(files.length > 0, `Expected ${prefix} JSON in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

async function latestRunDir(dir: string) {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
    .map((entry) => entry.name)
    .sort();
  assert(entries.length > 0, `Expected run directory under ${dir}`);
  return path.join(dir, entries[entries.length - 1]);
}

async function readJson<T extends Record<string, unknown> = Record<string, unknown>>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function quotaFailure() {
  return {
    category: "quota",
    message: "OpenAI quota was exhausted.",
    retryable: false,
    transport: {
      adapter_version: "openai-responses-adapter-v2",
      model_name: "gpt-5.4-mini",
      http_status: 429,
      typed_failure_reason: "openai_quota_exceeded",
      provider_error_code: "insufficient_quota"
    }
  };
}

async function writeFixtureRun() {
  const runId = "run-2026-07-04T00-00-00-000Z-live";
  const runDir = path.join(fixtureLiveDir, runId);
  await mkdir(runDir, { recursive: true });
  const baseScenario = {
    scenario_id: "fixture",
    title: "Fixture",
    trial_variant: "core"
  };

  const records = [
    {
      file: "quota.json",
      record: {
        artifact_type: "profile_formative_live_trial_record",
        scenario: { ...baseScenario, scenario_id: "quota_case" },
        failures: ["provider_quota_blocked"],
        provider_vs_effective_outcome: { passed_as: "blocked_provider_quota" },
        provider_diagnostics: { profile_integration: { provider_failure: quotaFailure() } }
      }
    },
    {
      file: "provider_timeout.json",
      record: {
        artifact_type: "profile_formative_live_trial_record",
        scenario: { ...baseScenario, scenario_id: "provider_timeout_case" },
        failures: ["profile_integration_live_failed_or_invalid"],
        provider_vs_effective_outcome: { passed_as: "failed_provider_request" },
        provider_diagnostics: {
          profile_integration: {
            provider_failure: {
              category: "timeout",
              message: "Provider request timed out.",
              retryable: true,
              transport: {
                adapter_version: "openai-responses-adapter-v2",
                model_name: "gpt-5.4-mini",
                http_status: 504,
                typed_failure_reason: "provider_timeout",
                provider_error_code: "timeout"
              }
            }
          }
        }
      }
    },
    {
      file: "validation.json",
      record: {
        artifact_type: "profile_formative_live_trial_record",
        scenario: { ...baseScenario, scenario_id: "validation_case" },
        failures: ["formative_validation_failed"],
        provider_vs_effective_outcome: { passed_as: "failed_validation" }
      }
    },
    {
      file: "outcome_mismatch.json",
      record: {
        artifact_type: "profile_formative_live_trial_record",
        scenario: { ...baseScenario, scenario_id: "outcome_mismatch_case" },
        failures: ["profile_outcome_mismatch"],
        provider_vs_effective_outcome: { passed_as: "failed_outcome_mismatch" }
      }
    },
    {
      file: "safety.json",
      record: {
        artifact_type: "profile_formative_live_trial_record",
        scenario: { ...baseScenario, scenario_id: "safety_case" },
        failures: ["student_facing_safety_violation"],
        provider_vs_effective_outcome: { passed_as: "failed_safety" },
        student_safe_text: "answer key reference"
      }
    }
  ];

  for (const entry of records) {
    await writeFile(path.join(runDir, entry.file), `${JSON.stringify(entry.record, null, 2)}\n`, "utf8");
  }
  await writeFile(
    path.join(runDir, "summary-2026-07-04T00-00-00-000Z.json"),
    `${JSON.stringify({
      run_id: runId,
      status: "failed",
      scenario_count: 35,
      live_scenarios_run: 35,
      scenario_ids_run: records.map((entry) => entry.record.scenario.scenario_id),
      failures: records.map((entry) => ({
        scenario_id: entry.record.scenario.scenario_id,
        result_category: entry.record.provider_vs_effective_outcome.passed_as,
        failures: entry.record.failures
      }))
    }, null, 2)}\n`,
    "utf8"
  );

  return runId;
}

async function main() {
  await rm(smokeRoot, { recursive: true, force: true });
  await mkdir(smokeRoot, { recursive: true });

  const liveResult = runNpm(
    ["run", "student:profile-formative-live-trials"],
    {
      PROFILE_FORMATIVE_TRIAL_ARTIFACT_DIR: ".data/profile-formative-quota-smoke/live-trials",
      PROFILE_FORMATIVE_TRIAL_SIMULATE_QUOTA: "true",
      MAX_LIVE_PROFILE_FORMATIVE_TRIALS: "35",
      PROFILE_FORMATIVE_TRIAL_BUDGET_USD: "10"
    },
    1
  );
  assert(!liveResult.stdout.includes("sk-"), "Live-trials output leaked a secret-shaped token.");
  assert(!liveResult.stderr.includes("sk-"), "Live-trials stderr leaked a secret-shaped token.");

  const simulatedRunDir = await latestRunDir(liveDir);
  const summary = await readJson<QuotaSummary>(await latestJsonFile(simulatedRunDir, "summary-"));
  assert(summary.status === "blocked_provider_quota", "Quota simulation did not produce blocked_provider_quota status.");
  assert(summary.provider_blocked === true, "Quota simulation did not mark provider_blocked.");
  assert(summary.provider_failure?.typed_failure_reason === "openai_quota_exceeded", "Quota typed reason missing.");
  assert(summary.provider_failure?.provider_error_code === "insufficient_quota", "Quota provider code missing.");
  assert(summary.scenario_count === 35, "Quota simulation did not preserve 35 planned scenarios.");
  assert(summary.live_scenarios_run === 35, "Quota simulation did not write 35 run records.");
  assert(summary.provider_quota_block?.provider_attempted_scenarios === 1, "Quota simulation did not stop after one attempted provider scenario.");
  assert(summary.provider_quota_block?.scenarios_completed_before_block === 0, "Quota completed-before-block count incorrect.");
  assert(summary.provider_quota_block?.scenarios_skipped_after_block === 34, "Quota skipped-after-block count incorrect.");
  assert(summary.provider_quota_block?.model_quality_evaluable === false, "Quota block should not be model-quality evaluable.");
  assert(summary.final_live_qa_acceptance === false, "Quota-blocked run must not be final live QA evidence.");
  assert(summary.result_category_counts?.blocked_provider_quota === 35, "Quota result category count incorrect.");
  assert(summary.result_category_counts?.failed_provider_request === 0, "Quota block should not be counted as failed_provider_request.");
  assert(summary.result_category_counts?.failed_outcome_mismatch === 0, "Quota block should not be counted as outcome mismatch.");

  const firstScenario = await readJson<ScenarioArtifact>(path.join(simulatedRunDir, "stable_understanding_engaged.json"));
  assert(firstScenario.provider_vs_effective_outcome?.passed_as === "blocked_provider_quota", "First quota scenario was not blocked_provider_quota.");
  assert(!firstScenario.failures?.includes("profile_outcome_mismatch"), "Quota scenario should not report profile mismatch.");
  assert(!firstScenario.failures?.includes("formative_value_mismatch"), "Quota scenario should not report formative mismatch.");

  const skippedScenario = await readJson<ScenarioArtifact>(path.join(simulatedRunDir, "developing_understanding_partial_reasoning.json"));
  assert(skippedScenario.provider_request_made === false, "Skipped quota scenario should not make provider request.");
  assert(skippedScenario.skipped_reason === "not_run_provider_quota_block", "Skipped quota scenario reason missing.");

  const reviewResult = runNpm(
    ["run", "student:profile-formative-trial-review", "--", "--latest-full-run"],
    {
      PROFILE_FORMATIVE_TRIAL_LIVE_DIR: ".data/profile-formative-quota-smoke/live-trials",
      PROFILE_FORMATIVE_TRIAL_REVIEW_OUTPUT_DIR: ".data/profile-formative-quota-smoke/trial-review"
    },
    0
  );
  assert(!reviewResult.stdout.includes("sk-"), "Review output leaked a secret-shaped token.");
  const review = await readJson<ReviewArtifact>(await latestJsonFile(reviewDir, "trial-review-"));
  assert(review.status === "provider_quota_blocked", "Reviewer did not classify quota run as provider_quota_blocked.");
  assert((review.provider_blocking_findings?.length ?? 0) > 0, "Reviewer did not report provider blocking findings.");
  assert((review.model_quality_findings?.length ?? 0) === 0, "Reviewer should suppress model-quality findings for quota blocks.");
  assert(review.final_live_qa_acceptance === false, "Reviewer must reject quota-blocked final evidence.");
  assert(review.rerun_required_after_quota_restored === true, "Reviewer did not request rerun after quota restored.");
  assert(String(review.run_level_message).includes("provider quota"), "Reviewer quota message missing.");

  const fixtureRunId = await writeFixtureRun();
  runNpm(
    ["run", "student:profile-formative-trial-review", "--", "--run-id", fixtureRunId],
    {
      PROFILE_FORMATIVE_TRIAL_LIVE_DIR: ".data/profile-formative-quota-smoke/fixture-live-trials",
      PROFILE_FORMATIVE_TRIAL_REVIEW_OUTPUT_DIR: ".data/profile-formative-quota-smoke/fixture-review"
    },
    0
  );
  const fixtureReview = await readJson<ReviewArtifact>(await latestJsonFile(fixtureReviewDir, "trial-review-"));
  assert((fixtureReview.provider_blocking_findings?.length ?? 0) >= 1, "Fixture quota finding missing.");
  assert((fixtureReview.infrastructure_findings?.length ?? 0) >= 1, "Fixture non-quota provider finding missing.");
  assert((fixtureReview.validator_findings?.length ?? 0) >= 1, "Fixture validation finding missing.");
  assert((fixtureReview.model_quality_findings?.length ?? 0) >= 1, "Fixture model-quality finding missing.");
  assert((fixtureReview.safety_findings?.length ?? 0) >= 1, "Fixture safety finding missing.");
  assert(fixtureReview.openai_calls_made === 0, "Quota smoke reviewer should make no OpenAI calls.");

  console.log(JSON.stringify({
    status: "passed",
    simulated_run_dir: simulatedRunDir,
    provider_attempted_scenarios: summary.provider_quota_block.provider_attempted_scenarios,
    scenarios_skipped_after_block: summary.provider_quota_block.scenarios_skipped_after_block,
    reviewer_status: review.status,
    openai_calls_made: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
