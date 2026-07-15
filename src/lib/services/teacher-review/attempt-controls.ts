import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { generatePublicId } from "@/lib/services/ids";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

function isTerminalSession(session: {
  status: string;
  current_phase: string;
  completed_at: Date | null;
}) {
  return (
    session.status === "completed" ||
    session.current_phase === "session_completed" ||
    Boolean(session.completed_at) ||
    session.status === "student_exited" ||
    session.current_phase === "student_exited"
  );
}

export async function closeAttemptAndAllowAnother(input: {
  session_public_id: string;
  teacher_user_db_id: string;
  reason?: string | null;
}) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: input.session_public_id },
    select: {
      id: true,
      session_public_id: true,
      status: true,
      current_phase: true,
      completed_at: true,
      user: { select: { user_id: true } },
      assessment: { select: { assessment_public_id: true } }
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError("not_found", "Session was not found.", 404);
  }

  if (isTerminalSession(session)) {
    return {
      status: "already_terminal" as const,
      request_id: generatePublicId("attempt_control"),
      override_applied: false
    };
  }

  const actor = await prisma.user.findUnique({
    where: { id: input.teacher_user_db_id },
    select: { user_id: true, role: true }
  });

  if (!actor || actor.role !== "teacher_researcher") {
    throw new StudentAssessmentServiceError(
      "forbidden",
      "Only authorized teacher researchers can close attempts.",
      403
    );
  }

  const requestId = generatePublicId("attempt_control");
  const now = new Date();
  const reason = input.reason?.trim() || "teacher_closed_stuck_or_test_attempt";

  await prisma.assessmentSession.update({
    where: { id: session.id },
    data: {
      status: "student_exited",
      current_phase: "student_exited",
      resume_phase: null,
      resume_context: Prisma.JsonNull,
      last_activity_at: now
    }
  });

  await logProcessEvent({
    assessment_session_db_id: session.id,
    event_type: "attempt_ended_by_teacher",
    event_category: "attempt_lifecycle",
    event_source: "backend",
    payload: {
      request_id: requestId,
      teacher_user_id: actor.user_id,
      session_public_id: session.session_public_id,
      assessment_public_id: session.assessment.assessment_public_id,
      student_user_id: session.user.user_id,
      prior_status: session.status,
      prior_phase: session.current_phase,
      new_status: "student_exited",
      new_phase: "student_exited",
      terminal_status: "ended_by_teacher",
      override_applied: false,
      reason
    },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    event_type: "new_attempt_available",
    event_category: "attempt_lifecycle",
    event_source: "backend",
    payload: {
      request_id: requestId,
      assessment_public_id: session.assessment.assessment_public_id,
      reason: "previous_attempt_closed_by_teacher"
    },
    occurred_at: now
  });

  return {
    status: "attempt_ended_by_teacher" as const,
    request_id: requestId,
    override_applied: false
  };
}
