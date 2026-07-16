import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";
import { writeModelUpgradeApprovalArtifact } from "../src/lib/operational/model-upgrade-evaluation";
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

if (expectedHash !== actualActiveHash) {
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

try {
  const result = writeModelUpgradeApprovalArtifact({
    manifestPath: manifestPath!,
    candidateRunPublicId: candidateRun,
    expectedHash
  });
  if (result.status === "blocked") {
    console.error(JSON.stringify({
      ...result,
      candidate_run_public_id: candidateRun,
      candidate_manifest_path: comparison.candidate.manifest_path,
      candidate_manifest_hash: actualManifestHash,
      candidate_active_configuration_hash: actualActiveHash
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ...result,
    candidate_run_public_id: candidateRun,
    candidate_manifest_path: comparison.candidate.manifest_path,
    candidate_manifest_hash: actualManifestHash,
    candidate_active_configuration_hash: actualActiveHash,
    exact_render_variable: `OPERATIONAL_APPROVED_CONFIG_HASH=${result.exact_operational_approved_config_hash}`,
    message:
      "Approval evidence is ready. Apply OPERATIONAL_APPROVED_CONFIG_HASH manually only after operator approval and deployment planning."
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof Error ? error.message : "approval_evidence_check_failed",
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}
