import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/db";
import { buildClassroomPilotWorkflowReview } from "../src/lib/services/classroom-pilot-readiness";

const envLoadResult = loadEnvConfig(process.cwd());

async function main() {
  process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = process.env.LLM_LIVE_CALLS_ENABLED ?? "false";

  const review = await buildClassroomPilotWorkflowReview({ write_artifact: true });
  console.log(JSON.stringify({
    status: review.status,
    student_session_flow_available: review.student_session_flow_available,
    activity_runtime_available: review.activity_runtime_available,
    teacher_review_available: review.teacher_review_available,
    session_evidence_audit_available: review.session_evidence_audit_available,
    readable_transcript_available: review.readable_transcript_available,
    structured_event_log_available: review.structured_event_log_available,
    bulk_export_available: review.bulk_export_available,
    data_integrity_review_available: review.data_integrity_review_available,
    student_safety_projection_passed: review.student_safety_projection_passed,
    teacher_export_safety_passed: review.teacher_export_safety_passed,
    target_session_public_id: review.target_session_public_id,
    target_session_data_counts: review.target_session_data_counts,
    export_summary: review.export_summary,
    known_limitations: review.known_limitations,
    artifact_path: review.artifact_path,
    no_openai_call_made: review.no_openai_call_made,
    classroom_validity: review.classroom_validity,
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
