import { loadEnvConfig } from "@next/env";
import {
  buildOperationalModelUpgradeComparison,
  summarizeModelUpgradePreflight
} from "../src/lib/operational/model-upgrade";
import { candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const manifestPath = candidateManifestArg();
const comparison = buildOperationalModelUpgradeComparison({ manifestPath });
const preflight = summarizeModelUpgradePreflight({ manifestPath });

console.log(JSON.stringify({
  status: "candidate_report_ready",
  no_provider_call: true,
  preflight,
  baseline: comparison.baseline,
  candidate: comparison.candidate,
  metrics: comparison.metrics,
  fixtures: comparison.fixtures,
  role_inventory: comparison.role_comparisons,
  recommendation: "candidate_requires_live_evaluation_and_explicit_approval"
}, null, 2));
