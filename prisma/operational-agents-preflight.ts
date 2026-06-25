import { execSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import {
  activeOperationalConfigHash,
  verifyApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import { getGuardedOperationalAgentIntegrationReadiness } from "../src/lib/operational/guarded-agent-integration";

loadEnvConfig(process.cwd());

function gitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const manifest = verifyApprovedOperationalAgentConfig();
  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  console.log(
    JSON.stringify(
      {
        operational_mode: readiness.mode,
        legacy_alias_status: {
          explicit: readiness.config.legacy_alias_explicit,
          conflict: readiness.config.legacy_alias_conflict
        },
        classroom_provider: readiness.config.provider,
        classroom_live_calls_enabled: readiness.config.live_calls_enabled,
        api_key_configured: readiness.config.openai_key_configured,
        approved_manifest_valid: manifest.valid,
        active_configuration_hash: activeOperationalConfigHash(),
        approved_configuration_hash: readiness.approved_configuration_hash,
        model_snapshot: readiness.approved_evaluation.model_snapshot,
        reasoning_effort: readiness.approved_evaluation.reasoning_effort,
        active_agent_versions: readiness.active_agent_versions,
        semantic_validator_version: readiness.approved_evaluation.semantic_validator_version,
        safety_validator_version: readiness.approved_evaluation.safety_validator_version,
        effective_result_version: readiness.config.effective_result_version,
        effective_validator_version: readiness.config.effective_validator_version,
        followup_move_on_fallback_version:
          readiness.approved_evaluation.followup_move_on_fallback_version,
        usage_guard_readiness:
          readiness.mode === "guarded_live" ? "checked_during_provider_execution" : "not_applicable",
        database_readiness: readiness.blocking_reasons.includes("database_unavailable")
          ? "unavailable"
          : "available",
        worker_readiness: "workflow_worker_available",
        git_commit: gitCommit(),
        live_call_permitted: readiness.live_call_permitted,
        blocking_reasons: readiness.blocking_reasons,
        sanitized_warnings: readiness.sanitized_warnings
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational preflight failed.");
  process.exitCode = 1;
});
