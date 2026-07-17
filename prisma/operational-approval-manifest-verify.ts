import { loadEnvConfig } from "@next/env";
import { verifyApprovedOperationalAgentConfig } from "../src/lib/agents/operational/approved-config";

loadEnvConfig(process.cwd());

const verification = verifyApprovedOperationalAgentConfig();

console.log(
  JSON.stringify(
    {
      valid: verification.valid,
      approval_kind: verification.approval_kind,
      approval_bundle_path: verification.approval_bundle_path,
      manifest_hash: verification.manifest_hash,
      approved_active_configuration_hash:
        verification.runtime_candidate_hash,
      runtime_candidate_hash: verification.runtime_candidate_hash,
      evaluation_protocol_hash: verification.evaluation_protocol_hash,
      approval_evidence_hash: verification.approval_evidence_hash,
      active_configuration_hash: verification.active_configuration_hash,
      role_inventory: verification.role_inventory,
      runtime_policy: verification.runtime_policy,
      semantic_validator_version: verification.semantic_validator_version,
      safety_validator_version: verification.safety_validator_version,
      effective_result_version: verification.effective_result_version,
      effective_validator_version: verification.effective_validator_version,
      runtime_model_resolution: verification.runtime_model_resolution,
      issues: verification.issues
    },
    null,
    2
  )
);

if (!verification.valid) {
  process.exitCode = 1;
}
