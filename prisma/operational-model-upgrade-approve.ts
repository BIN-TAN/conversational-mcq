import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";
import { writeModelUpgradeApprovalArtifact } from "../src/lib/operational/model-upgrade-evaluation";
import { argValue, candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const candidateRun = argValue("--candidate-run");
const expectedRuntimeHash = argValue("--expected-runtime-hash");
const expectedProtocolHash = argValue("--expected-evaluation-protocol-hash");
const confirmation = argValue("--confirm");
const manifestPath = candidateManifestArg();
const comparison = buildOperationalModelUpgradeComparison({ manifestPath });
const actualManifestHash = comparison.candidate.candidate_configuration_hash;
const actualRuntimeHash = comparison.candidate.runtime_candidate_hash;
const requiredConfirmation = `approve ${comparison.candidate.profile_name}`;

if (!candidateRun || !expectedRuntimeHash || !expectedProtocolHash || confirmation !== requiredConfirmation) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_approval_arguments",
    required: [
      "--manifest <candidate_manifest_path>",
      "--candidate-run <run_public_id>",
      "--expected-runtime-hash <runtime_candidate_hash>",
      "--expected-evaluation-protocol-hash <evaluation_protocol_hash>",
      `--confirm "${requiredConfirmation}"`
    ],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

if (expectedRuntimeHash !== actualRuntimeHash) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "candidate_hash_mismatch",
    expected_runtime_hash: expectedRuntimeHash,
    actual_manifest_hash: actualManifestHash,
    actual_runtime_candidate_hash: actualRuntimeHash,
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

try {
  const result = writeModelUpgradeApprovalArtifact({
    manifestPath: manifestPath!,
    candidateRunPublicId: candidateRun,
    expectedRuntimeCandidateHash: expectedRuntimeHash,
    expectedEvaluationProtocolHash: expectedProtocolHash
  });
  if (result.status === "blocked") {
    console.error(JSON.stringify({
      ...result,
      candidate_run_public_id: candidateRun,
      candidate_manifest_path: comparison.candidate.manifest_path,
      candidate_manifest_hash: actualManifestHash,
      runtime_candidate_hash: actualRuntimeHash,
      evaluation_protocol_hash: expectedProtocolHash
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ...result,
    candidate_run_public_id: candidateRun,
    candidate_manifest_path: comparison.candidate.manifest_path,
    candidate_manifest_hash: actualManifestHash,
    runtime_candidate_hash: actualRuntimeHash,
    evaluation_protocol_hash: expectedProtocolHash,
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
