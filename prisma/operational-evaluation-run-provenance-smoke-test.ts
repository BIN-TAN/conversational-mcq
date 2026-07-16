import { loadEnvConfig } from "@next/env";
import {
  buildModelUpgradeEvaluationPlan,
  executeModelUpgradeCandidateEvaluation,
  modelUpgradeEvaluatorVersions
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
} from "../src/lib/operational/model-upgrade";
import { FakeCandidateEvaluationProvider, assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

async function main() {
  const plan = buildModelUpgradeEvaluationPlan({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
  });
  assert(plan.application_git_commit && /^[a-f0-9]{40}$/u.test(plan.application_git_commit), "Plan should record the application Git commit.");
  assert(plan.application_git_commit_source, "Plan should record the application Git commit source.");
  assert(plan.evaluator_versions.run_provenance === "eval-run-provenance-v2", "Plan should record unified build-provenance evaluator version.");
  assert(plan.evaluator_versions.proposition_analysis === "eval-proposition-analysis-v1", "Plan should record proposition evaluator version.");
  assert(plan.evaluator_versions.evidence_grounding === "eval-evidence-grounding-v1", "Plan should record grounding evaluator version.");
  assert(plan.artifact_persistence.persistence_verified === false, "Local artifact persistence should not be silently trusted.");
  assert(plan.artifact_persistence.warning, "Unverified local artifact persistence should include a warning.");

  const previousPersistence = process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED;
  process.env.OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED = "1";
  try {
    const run = await executeModelUpgradeCandidateEvaluation({
      manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
      provider: new FakeCandidateEvaluationProvider(),
      skipLiveEnvironmentGuardsForTest: true
    });
    assert(run.application_git_commit === plan.application_git_commit, "Run should persist the application Git commit.");
    assert(run.application_git_commit_source === plan.application_git_commit_source, "Run should persist the application Git commit source.");
    assert(run.evaluator_versions.pedagogical_quality === modelUpgradeEvaluatorVersions().pedagogical_quality, "Run should persist evaluator versions.");
    assert(run.evaluator_versions.run_provenance === "eval-run-provenance-v2", "Run should persist unified build-provenance evaluator version.");
    assert(run.artifact_persistence.persistence_verified === true, "Operator-attested persistence should be persisted on the run.");
    assert(run.case_results.length === plan.fixture_count, "Run should persist all planned cases.");
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
    application_git_commit_recorded: true,
    evaluator_versions_recorded: true,
    artifact_persistence_warning_recorded: true,
    operator_attestation_recorded_for_fake_run: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
