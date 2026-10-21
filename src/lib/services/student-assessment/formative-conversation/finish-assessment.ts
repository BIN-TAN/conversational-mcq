import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { resolveCanonicalAttemptLifecycle } from "../attempt-lifecycle";
import { StudentAssessmentServiceError } from "../errors";
import { preparationOverdue } from "@/lib/workflow/initial-preparation-status";

const closed = ["ended", "completed", "teacher_assistance_recommended"];
const studentEndedReason = "student_ended_conversation";

export async function canFinishConversationAssessment(sessionId: string, assessmentId: string, db: Prisma.TransactionClient = prisma) {
  const topics = await db.conceptUnit.findMany({
    where: { assessment_db_id: assessmentId, status: "published", items: { some: { status: "published", included_in_published_set: true } } },
    select: { id: true }
  });
  const units = await db.conceptUnitSession.findMany({
    where: { assessment_session_db_id: sessionId, concept_unit_db_id: { in: topics.map(topic => topic.id) } },
    include: { formative_conversation_session: { include: {
      message_receipts: { select: { assistant_turn_db_id: true, assistant_response_status: true } },
      conversation_turns: { where: { actor_type: "agent", message_text: { not: null } }, select: { id: true } }
    } }, response_packages: { where: { package_type: "initial_concept_unit_response_package" }, select: { id: true } },
    workflow_jobs: { where: { job_type: "prepare_initial_conversation" }, select: { status: true, created_at: true } } }
  });
  const session = await db.assessmentSession.findUnique({ where: { id: sessionId }, select: { automation_paused_at: true } });
  const now = new Date();
  return topics.length > 0 && units.length === topics.length && units.every(unit => {
    const conversation = unit.formative_conversation_session;
    if (!unit.initial_completed_at || unit.response_packages.length === 0) return false;
    // Never a dead end: when learning support could not be prepared at all, the
    // student may still finish; the attempt is flagged for the instructor.
    // The same holds when preparation is paused by the instructor or has taken too long.
    if (!conversation) {
      return unit.workflow_jobs.some(job => job.status === "failed" || preparationOverdue(job, now)
        || (Boolean(session?.automation_paused_at) && job.status !== "completed"));
    }
    if (!closed.includes(conversation.status)) return false;
    // D2 (DESIGN_ALIGNMENT_2026-10-17.md): an explicit student stop is a valid end
    // of the optional conversation even when the opening or a tutor reply was
    // still pending or failed. The submitted initial record is already sealed.
    if (conversation.lifecycle_reason === studentEndedReason) return true;
    // A platform close (for example the turn limit reached while the final reply could
    // not be produced) is also a valid end: the student did everything asked of them.
    if (conversation.lifecycle_reason?.startsWith("platform_")) return true;
    return conversation.conversation_turns.length > 0 && conversation.message_receipts.length > 0 &&
      conversation.message_receipts.every(receipt => receipt.assistant_turn_db_id && receipt.assistant_response_status === "completed");
  });
}

// Explicit workflow completion only. This never creates a learning outcome/profile.
export async function finishConversationAssessment(input: { student_user_db_id: string; session_public_id: string }) {
  const owned = await prisma.assessmentSession.findFirst({ where: {
    session_public_id: input.session_public_id, user_db_id: input.student_user_db_id
  }, select: { id: true } });
  if (!owned) throw new StudentAssessmentServiceError("not_found", "We could not find this attempt.", 404);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM assessment_sessions WHERE id = ${owned.id}::uuid FOR UPDATE`;
    const session = await tx.assessmentSession.findUniqueOrThrow({ where: { id: owned.id } });
    const lifecycle = resolveCanonicalAttemptLifecycle(session);
    if (lifecycle.canonical_status === "completed") return;
    if (lifecycle.canonical_status !== "active" ||
        !await canFinishConversationAssessment(session.id, session.assessment_db_id, tx)) {
      throw new StudentAssessmentServiceError("invalid_phase_for_action", "You can finish once the conversation with the tutor has ended. If feedback is not available, contact your instructor.", 409);
    }
    const now = new Date();
    await tx.assessmentSession.update({ where: { id: session.id }, data: {
      status: "completed", current_phase: "session_completed", completed_at: now, last_activity_at: now,
      resume_phase: null, resume_context: Prisma.DbNull
    } });
    await tx.conceptUnitSession.updateMany({ where: { assessment_session_db_id: session.id,
      initial_completed_at: { not: null }, formative_conversation_session: { status: { in: ["ended", "completed", "teacher_assistance_recommended"] } }
    }, data: {
      status: "completed", followup_status: "stopped", followup_completed_at: now
    } });
    // Topics whose learning support could not be prepared: finished, marked incomplete.
    const unsupported = await tx.conceptUnitSession.findMany({ where: { assessment_session_db_id: session.id,
      initial_completed_at: { not: null }, formative_conversation_session: null }, select: { id: true } });
    if (unsupported.length) {
      await tx.conceptUnitSession.updateMany({ where: { id: { in: unsupported.map(unit => unit.id) } },
        data: { status: "completed", followup_status: "incomplete", followup_completed_at: now } });
      await tx.assessmentSession.update({ where: { id: session.id }, data: { needs_review: true,
        needs_review_reason: [session.needs_review_reason,
          "Learning support could not be prepared; the student finished the assessment without it."].filter(Boolean).join("\n") } });
    }
    await logProcessEvent({ assessment_session_db_id: session.id, event_type: "session_completed",
      event_category: "session", event_source: "backend", occurred_at: now, payload: {
        reason: unsupported.length ? "student_finished_without_learning_support" : "student_confirmed_finish_after_learning_conversation",
        completion_contract_version: "conversation-finish-v2",
        from_phase: session.current_phase, to_phase: "session_completed", learning_outcome_generated: false
      } }, tx);
  });
}
