import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { resolveCanonicalAttemptLifecycle } from "../attempt-lifecycle";
import { StudentAssessmentServiceError } from "../errors";

const closed = ["ended", "completed", "teacher_assistance_recommended"];

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
    } }, response_packages: { where: { package_type: "initial_concept_unit_response_package" }, select: { id: true } } }
  });
  return topics.length > 0 && units.length === topics.length && units.every(unit => {
    const conversation = unit.formative_conversation_session;
    return unit.initial_completed_at && unit.response_packages.length > 0 && conversation && closed.includes(conversation.status) &&
      conversation.conversation_turns.length > 0 && conversation.message_receipts.length > 0 &&
      !conversation.lifecycle_reason?.startsWith("platform_") &&
      conversation.message_receipts.every(receipt => receipt.assistant_turn_db_id && receipt.assistant_response_status === "completed");
  });
}

// Explicit workflow completion only. This never creates a learning outcome/profile.
export async function finishConversationAssessment(input: { student_user_db_id: string; session_public_id: string }) {
  const owned = await prisma.assessmentSession.findFirst({ where: {
    session_public_id: input.session_public_id, user_db_id: input.student_user_db_id
  }, select: { id: true } });
  if (!owned) throw new StudentAssessmentServiceError("not_found", "Assessment attempt not found.", 404);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM assessment_sessions WHERE id = ${owned.id}::uuid FOR UPDATE`;
    const session = await tx.assessmentSession.findUniqueOrThrow({ where: { id: owned.id } });
    const lifecycle = resolveCanonicalAttemptLifecycle(session);
    if (lifecycle.canonical_status === "completed") return;
    if (lifecycle.canonical_status !== "active" ||
        !await canFinishConversationAssessment(session.id, session.assessment_db_id, tx)) {
      throw new StudentAssessmentServiceError("invalid_phase_for_action", "Finish is available after all questions and learning conversations are closed. Resume this attempt or contact your teacher if feedback is unavailable.", 409);
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
    await logProcessEvent({ assessment_session_db_id: session.id, event_type: "session_completed",
      event_category: "session", event_source: "backend", occurred_at: now, payload: {
        reason: "student_confirmed_finish_after_learning_conversation", completion_contract_version: "conversation-finish-v1",
        from_phase: session.current_phase, to_phase: "session_completed", learning_outcome_generated: false
      } }, tx);
  });
}
