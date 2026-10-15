import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { resolveCanonicalAttemptLifecycle } from "../attempt-lifecycle";
import { StudentAssessmentServiceError } from "../errors";
import { FormativeConversationV18R2AgentInputSchema } from "./agent-contract-v18r2";

const closed = ["ended", "completed", "teacher_assistance_recommended"];
const successfulTurnLimitReason = "platform_turn_limit_after_tutor_reply:final_allowed_turn_reply_recorded";

export async function canFinishConversationAssessment(sessionId: string, assessmentId: string, db: Prisma.TransactionClient = prisma) {
  const topics = await db.conceptUnit.findMany({
    where: { assessment_db_id: assessmentId, status: "published", items: { some: { status: "published", included_in_published_set: true } } },
    select: { id: true }
  });
  const units = await db.conceptUnitSession.findMany({
    where: { assessment_session_db_id: sessionId, concept_unit_db_id: { in: topics.map(topic => topic.id) } },
    include: { formative_conversation_session: { include: {
      message_receipts: { select: { id: true, status: true, student_turn_db_id: true,
        assistant_turn_db_id: true, assistant_response_status: true } },
      conversation_turns: { where: { actor_type: "agent", message_text: { not: null } }, select: { id: true } }
    } }, response_packages: { where: { package_type: "initial_concept_unit_response_package" }, select: { id: true } } }
  });
  const allTopicsClosed = topics.length > 0 && units.length === topics.length && units.every(unit => {
    const conversation = unit.formative_conversation_session;
    return unit.initial_completed_at && unit.response_packages.length > 0 && conversation && closed.includes(conversation.status) &&
      conversation.conversation_turns.length > 0 && conversation.message_receipts.length > 0 &&
      (!conversation.lifecycle_reason?.startsWith("platform_") || conversation.lifecycle_reason === successfulTurnLimitReason) &&
      conversation.message_receipts.every(receipt => receipt.assistant_turn_db_id && receipt.assistant_response_status === "completed");
  });
  if (!allTopicsClosed) return false;
  for (const unit of units) {
    const conversation = unit.formative_conversation_session!;
    if (conversation.lifecycle_reason !== successfulTurnLimitReason) continue;
    // A successful final reply is a workflow boundary, not a platform failure
    // or a learning outcome. The reason string alone is not sufficient proof.
    // Ordinary active/closed checks retain the lightweight ID-only projection.
    // Fetch only the final pair for this rare successful-boundary exception.
    const [lastTurn, lastStudentTurn] = await db.conversationTurn.findMany({ where: {
      formative_conversation_session_db_id: conversation.id,
      actor_type: { in: ["agent", "student"] }, message_text: { not: null }
    }, orderBy: { sequence_index: "desc" }, take: 2,
    select: { id: true, actor_type: true, sequence_index: true, message_text: true } });
    const receipt = conversation.message_receipts.find(entry => entry.assistant_turn_db_id === lastTurn?.id);
    if (!lastTurn || lastTurn.actor_type !== "agent" || !lastStudentTurn || lastStudentTurn.actor_type !== "student" ||
        lastTurn.sequence_index !== conversation.last_processed_turn_sequence ||
        !receipt || receipt.status !== "assistant_turn_persisted" ||
        receipt.student_turn_db_id !== lastStudentTurn.id) return false;
    const call = await db.agentCall.findFirst({ where: {
      formative_conversation_session_db_id: conversation.id,
      formative_conversation_message_receipt_db_id: receipt.id,
      agent_name: "formative_conversation_agent", call_status: "succeeded", output_validated: true
    }, orderBy: { created_at: "desc" }, select: { input_payload: true, output_payload: true } });
    const context = FormativeConversationV18R2AgentInputSchema.safeParse(call?.input_payload);
    const sourceStudentTurn = context.success ? context.data.visible_transcript.filter(turn => turn.actor === "student").at(-1) : null;
    const output = call?.output_payload;
    if (!context.success || !context.data.formative_lifecycle.final_allowed_turn ||
        context.data.conversation_public_id !== conversation.conversation_public_id ||
        sourceStudentTurn?.sequence_index !== lastStudentTurn.sequence_index ||
        sourceStudentTurn.message_text !== lastStudentTurn.message_text ||
        !output || typeof output !== "object" || Array.isArray(output) ||
        output.student_visible_message !== lastTurn.message_text) return false;
  }
  return true;
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
