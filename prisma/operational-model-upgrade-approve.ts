import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";
import { argValue, candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const candidateRun = argValue("--candidate-run");
const expectedHash = argValue("--expected-hash");
const confirmation = argValue("--confirm");
const manifestPath = candidateManifestArg();
const comparison = buildOperationalModelUpgradeComparison({ manifestPath });
const actualManifestHash = comparison.candidate.candidate_configuration_hash;
const actualActiveHash = comparison.candidate.candidate_active_configuration_hash;
const requiredConfirmation = `approve ${comparison.candidate.profile_name}`;

if (!candidateRun || !expectedHash || confirmation !== requiredConfirmation) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_approval_arguments",
    required: [
      "--manifest <candidate_manifest_path>",
      "--candidate-run <run_public_id>",
      "--expected-hash <candidate_active_configuration_hash>",
      `--confirm "${requiredConfirmation}"`
    ],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

if (expectedHash !== actualActiveHash && expectedHash !== actualManifestHash) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "candidate_hash_mismatch",
    expected_hash: expectedHash,
    actual_manifest_hash: actualManifestHash,
    actual_active_configuration_hash: actualActiveHash,
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

console.error(JSON.stringify({
  status: "blocked",
  reason: "candidate_evaluation_and_human_review_evidence_required",
  candidate_run_public_id: candidateRun,
  candidate_manifest_path: comparison.candidate.manifest_path,
  candidate_manifest_hash: actualManifestHash,
  candidate_active_configuration_hash: actualActiveHash,
  no_provider_call: true,
  message: "Approval must verify a completed live candidate evaluation and required human review before updating the approved manifest."
}, null, 2));
process.exit(1);
