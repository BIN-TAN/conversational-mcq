import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

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
  candidate_hash: buildOperationalModelUpgradeComparison().candidate.candidate_configuration_hash
}, null, 2));
process.exit(1);
