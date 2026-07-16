import { loadEnvConfig } from "@next/env";
import {
  buildOperationalModelUpgradeComparison,
  summarizeModelUpgradePreflight
} from "../src/lib/operational/model-upgrade";
import { candidateManifestArg } from "./operational-model-upgrade-cli-args";
import { buildModelUpgradeEvaluationPlan } from "../src/lib/operational/model-upgrade-evaluation";

loadEnvConfig(process.cwd());

const manifestPath = candidateManifestArg();
const comparison = buildOperationalModelUpgradeComparison({ manifestPath });
const preflight = summarizeModelUpgradePreflight({ manifestPath });
const evaluationPlan = buildModelUpgradeEvaluationPlan({ manifestPath });

console.log(JSON.stringify({
  status: "candidate_report_ready",
  no_provider_call: true,
  preflight,
  baseline: comparison.baseline,
  candidate: comparison.candidate,
  approval_identities: {
    runtime_candidate_hash: evaluationPlan.runtime_candidate_hash,
    evaluation_protocol_hash: evaluationPlan.evaluation_protocol_hash,
    current_active_configuration_hash: evaluationPlan.current_active_configuration_hash,
    old_approved_hash: evaluationPlan.old_approved_hash
  },
  fixture_preflight: evaluationPlan.fixture_preflight,
  semantic_calibration: evaluationPlan.semantic_calibration,
  metrics: comparison.metrics,
  fixtures: comparison.fixtures,
  role_inventory: comparison.role_comparisons,
  recommendation: "candidate_requires_live_evaluation_and_explicit_approval"
}, null, 2));
