import { prisma } from "@/lib/db";
import { resolveCanonicalAttemptLifecycle } from "@/lib/services/student-assessment/attempt-lifecycle";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

export async function getInitialPreparationStatus(session: {
  id: string; status: string; current_phase: string; completed_at: Date | null;
  automation_paused_at: Date | null; current_concept_unit_db_id: string | null;
}) {
  const job = await prisma.workflowJob.findFirst({ where: {
    assessment_session_db_id: session.id, job_type: "prepare_initial_conversation",
    concept_unit_session: { concept_unit_db_id: session.current_concept_unit_db_id ?? "00000000-0000-0000-0000-000000000000" }
  }, select: { id: true, status: true, last_error_category: true, concept_unit_session_db_id: true } });
  if (!job) return null;
  const terminal = resolveCanonicalAttemptLifecycle(session).terminal;
  const paused = session.status !== "active" || Boolean(session.automation_paused_at);
  const continued = await prisma.processEvent.findFirst({ where: {
    assessment_session_db_id: session.id, concept_unit_session_db_id: job.concept_unit_session_db_id,
    event_type: "initial_feedback_skipped", event_source: "backend"
  }, select: { id: true } });
  const failed = job.status === "failed" && !continued;
  const recoverable = failed && job.last_error_category !== "preparation_source_conflict";
  return {
    status: continued ? "skipped" as const : terminal ? "cancelled" as const : job.status === "completed" ? "ready" as const
      : paused ? "paused" as const : job.status === "pending" ? "queued" as const
      : job.status === "running" ? "preparing" as const : job.status === "retryable" ? "retrying" as const : job.status,
    can_retry: !terminal && !paused && recoverable,
    can_continue: !terminal && !paused && recoverable,
    failure_reason: failed ? job.last_error_category === "output_token_limit" ? "output_token_limit" as const
      : job.last_error_category === "preparation_source_conflict" ? "source_conflict" as const
      : "unavailable" as const : null
  };
}

export async function getOwnedInitialPreparationStatus(input: { student_user_db_id: string; session_public_id: string }) {
  const session = await prisma.assessmentSession.findFirst({ where: {
    session_public_id: input.session_public_id, user_db_id: input.student_user_db_id,
    user: { role: "student", account_status: "active" }
  } });
  if (!session) throw new StudentAssessmentServiceError("session_not_owned", "Session was not found for this student.", 403);
  return { preparation: await getInitialPreparationStatus(session) };
}
