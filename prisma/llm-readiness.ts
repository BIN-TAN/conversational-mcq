import { loadEnvConfig } from "@next/env";
import { getAssessmentTutorRuntimeStatus } from "../src/lib/llm/assessment-tutor-readiness";

loadEnvConfig(process.cwd());

async function main() {
  const status = await getAssessmentTutorRuntimeStatus();

  const report = {
    readiness_version: status.readiness_version,
    ready: status.ready,
    runtime_source: status.runtime_source,
    configured_mode: status.configured_mode,
    provider: status.provider,
    live_calls_enabled: status.live_calls_enabled,
    key_present: status.key_present,
    key_fingerprint_prefix: status.key_fingerprint_prefix,
    key_source: status.key_source,
    auth_status: status.auth_status,
    auth_checked_at: status.auth_checked_at,
    auth_check_error_code: status.auth_check_error_code,
    auth_cache_status: status.auth_cache_status,
    config_conflict_detected: status.config_conflict_detected,
    public_key_configured: status.public_key_configured,
    model_names: status.model_names,
    local_mock_allowed: status.local_mock_allowed,
    reason_codes: status.reason_codes,
    warning_codes: status.warning_codes,
    env_file_sources: status.env_file_sources,
    env_file_key_fingerprints: status.env_file_key_fingerprints,
    last_checked_at: status.last_checked_at,
    live_call_permitted: status.runtime_source === "live_llm"
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
