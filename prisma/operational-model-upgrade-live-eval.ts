import { loadEnvConfig } from "@next/env";
import { summarizeModelUpgradePreflight } from "../src/lib/operational/model-upgrade";
import { candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const manifestPath = candidateManifestArg();

if (process.env.RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL !== "1") {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL is not 1",
    no_provider_call: true,
    preflight: summarizeModelUpgradePreflight({ manifestPath })
  }, null, 2));
  process.exit(0);
}

if (!process.argv.includes("--confirm-paid-api")) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_confirm_paid_api",
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

console.error(JSON.stringify({
  status: "blocked",
  reason: "live_candidate_evaluation_runner_not_enabled_in_phase31ad",
  no_provider_call: true,
  preflight: summarizeModelUpgradePreflight({ manifestPath }),
  message: "Phase 31ad added guarded configuration and no-live comparison. Paid candidate evaluation must be implemented/run only under explicit operator approval."
}, null, 2));
process.exit(1);
