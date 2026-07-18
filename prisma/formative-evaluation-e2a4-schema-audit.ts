import { loadEnvConfig } from "@next/env";
import { writeE2A4AllRoleSchemaAudit } from "@/lib/evaluation/formative/e2a4-structured-output-audit";

loadEnvConfig(process.cwd());

const result = writeE2A4AllRoleSchemaAudit();
console.log(JSON.stringify({
  status: result.audit.all_candidate_role_schemas_compile ? "passed" : "failed",
  artifact_path: result.outputPath,
  candidate_hash: result.audit.candidate_hash,
  role_count: result.audit.role_count,
  all_candidate_role_schemas_compile: result.audit.all_candidate_role_schemas_compile,
  candidate_blocking_incompatibilities: result.audit.candidate_blocking_incompatibilities,
  approved_runtime_latent_incompatibility_count:
    result.audit.approved_runtime_latent_incompatibilities.length,
  network_request_count: result.audit.network_request_count
}, null, 2));

if (!result.audit.all_candidate_role_schemas_compile) process.exitCode = 1;
