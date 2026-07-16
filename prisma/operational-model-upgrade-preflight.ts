import { loadEnvConfig } from "@next/env";
import {
  buildOperationalModelUpgradeComparison,
  summarizeModelUpgradePreflight
} from "../src/lib/operational/model-upgrade";
import { buildModelUpgradeEvaluationPlan } from "../src/lib/operational/model-upgrade-evaluation";
import { candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const manifestPath = candidateManifestArg();
const preflight = summarizeModelUpgradePreflight({ manifestPath });
const plan = buildModelUpgradeEvaluationPlan({ manifestPath });
const comparison = buildOperationalModelUpgradeComparison({ manifestPath });

console.log(JSON.stringify({
  ...preflight,
  runtime_candidate_hash: plan.runtime_candidate_hash,
  evaluation_protocol_hash: plan.evaluation_protocol_hash,
  fixture_preflight: plan.fixture_preflight,
  semantic_calibration: plan.semantic_calibration,
  live_evaluation_command:
    `RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 npm run operational:model-upgrade:live-eval -- --manifest ${plan.candidate_manifest_path} --expected-runtime-hash ${plan.runtime_candidate_hash} --expected-evaluation-protocol-hash ${plan.evaluation_protocol_hash} --confirm-paid-api`,
  approval_command:
    `npm run operational:model-upgrade:approve -- --manifest ${plan.candidate_manifest_path} --candidate-run <run_public_id> --expected-runtime-hash ${plan.runtime_candidate_hash} --expected-evaluation-protocol-hash ${plan.evaluation_protocol_hash} --confirm \"approve ${comparison.candidate.profile_name}\"`
}, null, 2));
