import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/db";
import { buildTeacherSessionDataAudit } from "../src/lib/services/teacher-review/session-data-audit";

const envLoadResult = loadEnvConfig(process.cwd());

function argValue(name: string) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const sessionPublicId = argValue("--session-public-id");
  const audit = await buildTeacherSessionDataAudit({
    session_public_id: sessionPublicId,
    write_artifact: true
  });

  console.log(JSON.stringify({
    status: "completed",
    session_public_id: audit.session_public_id,
    artifact_path: audit.artifact_path,
    item_attempt_count: audit.data_completeness.response_package.item_attempt_count,
    initial_package_count: audit.data_completeness.response_package.initial_package_count,
    process_event_count: audit.process_data_summary.process_event_count,
    observed_event_type_count: audit.process_data_summary.observed_event_type_count,
    engagement_packet_available:
      audit.engagement_evidence_summary.engagement_packet_available,
    activity_runtime_attempt_count: audit.activity_runtime_summary.attempt_count,
    post_activity_evidence_record_count:
      audit.misconception_evidence_summary.record_count,
    diagnostic_snapshot_count: audit.diagnostic_snapshot_summary.snapshot_count,
    agent_call_count: audit.agent_audit_summary.call_count,
    limitations: audit.limitations,
    no_live_provider_call_made: audit.no_live_provider_call_made,
    env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
