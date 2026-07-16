import { loadEnvConfig } from "@next/env";
import {
  buildModelUpgradeEvaluationPlan,
  executeModelUpgradeCandidateEvaluation,
  resolveModelUpgradeBudget
} from "../src/lib/operational/model-upgrade-evaluation";
import { summarizeModelUpgradePreflight } from "../src/lib/operational/model-upgrade";
import { argValue, candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const manifestPath = candidateManifestArg();
const resumeRun = argValue("--resume-run");

async function main() {
  if (process.env.RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL is not 1",
      no_provider_call: true,
      preflight: summarizeModelUpgradePreflight({ manifestPath })
    }, null, 2));
    return;
  }

  if (!process.argv.includes("--confirm-paid-api")) {
    console.error(JSON.stringify({
      status: "blocked",
      reason: "missing_confirm_paid_api",
      no_provider_call: true
    }, null, 2));
    process.exit(1);
  }

  if (!manifestPath) {
    console.error(JSON.stringify({
      status: "blocked",
      reason: "explicit_candidate_manifest_required",
      no_provider_call: true
    }, null, 2));
    process.exit(1);
  }

  for (const disallowed of ["--session", "--session-public-id", "--student", "--student-id", "--assessment", "--assessment-id"]) {
    if (process.argv.includes(disallowed)) {
      console.error(JSON.stringify({
        status: "blocked",
        reason: "real_session_scope_not_allowed",
        disallowed_argument: disallowed,
        no_provider_call: true
      }, null, 2));
      process.exit(1);
    }
  }

  try {
    const budget = resolveModelUpgradeBudget(process.env);
    const plan = buildModelUpgradeEvaluationPlan({ manifestPath, budget });
    console.log(JSON.stringify({
      status: "execution_plan_ready",
      no_provider_call_yet: true,
      preflight: summarizeModelUpgradePreflight({ manifestPath }),
      execution_plan: plan
    }, null, 2));

    if (plan.maximum_possible_calls > budget.large_plan_call_threshold) {
      const required = `run ${plan.fixture_count} candidate fixtures`;
      if (argValue("--confirm-large-plan") !== required) {
        console.error(JSON.stringify({
          status: "blocked",
          reason: "large_plan_requires_exact_confirmation",
          required_argument: `--confirm-large-plan "${required}"`,
          no_provider_call: true
        }, null, 2));
        process.exit(1);
      }
    }

    const run = await executeModelUpgradeCandidateEvaluation({
      manifestPath,
      resumeRunPublicId: resumeRun
    });
    console.log(JSON.stringify({
      status: run.status,
      run_public_id: run.run_public_id,
      candidate_manifest_hash: run.candidate_manifest_hash,
      candidate_active_configuration_hash: run.candidate_active_configuration_hash,
      application_git_commit: run.application_git_commit,
      artifact_persistence: run.artifact_persistence,
      backup_command:
        run.artifact_persistence.backup_command_template?.replaceAll("<run_public_id>", run.run_public_id) ?? null,
      review_command:
        `npm run operational:model-upgrade:review-export -- --candidate-run ${run.run_public_id}`,
      recommendation: run.recommendation,
      approval_eligibility: run.approval_eligibility
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      status: "infrastructure_failed",
      reason: error instanceof Error ? error.message : "unknown_model_upgrade_live_eval_failure",
      no_secret_values_printed: true
    }, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
