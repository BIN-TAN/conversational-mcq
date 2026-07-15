import { loadEnvConfig } from "@next/env";
import { getResearchExportReadiness } from "../src/lib/services/teacher-research-data/readiness";
import { prisma } from "../src/lib/db";

loadEnvConfig(process.cwd());

async function main() {
  const readiness = await getResearchExportReadiness();
  const report = {
    status: readiness.ready ? "ready" : "blocked",
    environment: readiness.environment,
    pseudonymization_method: readiness.pseudonymization_method,
    pseudonymization_version: readiness.pseudonymization_version,
    key_configured: readiness.key_configured,
    safe_key_fingerprint: readiness.safe_key_fingerprint,
    required_configuration: readiness.required_configuration,
    blocking_reasons: readiness.blocking_reasons,
    warnings: readiness.warnings,
    export_schema_version: readiness.export_schema_version,
    artifact_path_writable: readiness.artifact_path_writable,
    database_ready: readiness.database_ready,
    dictionary_registry_ready: readiness.dictionary_registry_ready,
    restricted_export_authorization_supported: readiness.restricted_export_authorization_supported,
    no_openai_call_occurred: true
  };

  console.log(JSON.stringify(report, null, 2));
  if (!readiness.ready) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Research export preflight failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
