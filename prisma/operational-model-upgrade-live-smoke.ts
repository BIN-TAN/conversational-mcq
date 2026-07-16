import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";
import { candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const manifestPath = candidateManifestArg();

if (process.env.RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_SMOKE !== "1") {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_SMOKE is not 1",
    no_provider_call: true
  }, null, 2));
  process.exit(0);
}

console.error(JSON.stringify({
  status: "blocked",
  reason: "paid_live_model_upgrade_smoke_not_run_by_codex",
  no_provider_call: true,
  candidate_hash: buildOperationalModelUpgradeComparison({ manifestPath }).candidate.candidate_configuration_hash,
  candidate_active_configuration_hash:
    buildOperationalModelUpgradeComparison({ manifestPath }).candidate.candidate_active_configuration_hash
}, null, 2));
process.exit(1);
