import { loadEnvConfig } from "@next/env";
import { verifyApprovedOperationalAgentConfig } from "../src/lib/agents/operational/approved-config";

loadEnvConfig(process.cwd());

const verification = verifyApprovedOperationalAgentConfig();

console.log(
  JSON.stringify(
    {
      valid: verification.valid,
      manifest_hash: verification.manifest_hash,
      approved_active_configuration_hash:
        verification.manifest.approved_active_configuration_hash,
      active_configuration_hash: verification.active_configuration_hash,
      model_snapshot: verification.manifest.model_snapshot,
      reasoning_effort: verification.manifest.reasoning_effort,
      effective_result_version: verification.manifest.effective_result_version,
      effective_validator_version: verification.manifest.effective_validator_version,
      issues: verification.issues
    },
    null,
    2
  )
);

if (!verification.valid) {
  process.exitCode = 1;
}
