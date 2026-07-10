import { loadEnvConfig } from "@next/env";
import { writeLlmFirstCbaSystemAuditArtifact } from "../src/lib/services/llm-first-cba-system-audit";

const envLoadResult = loadEnvConfig(process.cwd());

async function main() {
  process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = process.env.LLM_LIVE_CALLS_ENABLED ?? "false";

  const { artifact, file_path } = await writeLlmFirstCbaSystemAuditArtifact();
  console.log(JSON.stringify({
    status: "passed",
    audit_version: artifact.audit_version,
    artifact_path: file_path,
    artifact_hash: artifact.artifact_hash,
    files_inspected_count: artifact.files_inspected.length,
    agent_inventory_count: artifact.agent_inventory.length,
    p0_finding_ids: artifact.p0_finding_ids,
    p1_finding_ids: artifact.p1_finding_ids,
    finding_counts: artifact.finding_counts,
    openai_calls_made: artifact.openai_calls_made,
    production_rows_modified: artifact.production_rows_modified,
    env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
