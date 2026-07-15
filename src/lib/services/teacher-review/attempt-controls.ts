import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";
import { resolveCanonicalAttemptLifecycle } from "@/lib/services/student-assessment/attempt-lifecycle";
import { createCommittedLifecycleOperation } from "@/lib/services/student-assessment/lifecycle-operations";

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
      attempt_number: true,
      status: true,
      current_phase: true,
      completed_at: true,
      resume_phase: true,
      resume_context: true,
      updated_at: true,
      user: { select: { user_id: true } },
      assessment: { select: { assessment_public_id: true } }
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError("not_found", "Session was not found.", 404);
  }

  const lifecycle = resolveCanonicalAttemptLifecycle(session);
  if (lifecycle.terminal) {
    const commandResult = await prisma.$transaction((tx) =>
      createCommittedLifecycleOperation(tx, {
        command_type: "teacher_end_attempt",
        actor_type: "teacher",
        target_assessment_public_id: session.assessment.assessment_public_id,
        target_session_public_id: session.session_public_id,
        prior_lifecycle: lifecycle,
        resulting_lifecycle: lifecycle,
        resulting_session_public_id: session.session_public_id,
        resulting_attempt_number: session.attempt_number,
        assessment_session_db_id: session.id,
        mutation_committed: false,
        already_satisfied: true,
        recovered: true,
        canonical_destination: "assessment_list",
        safe_response_code: "already_terminal"
      })
    );

    return {
      status: "already_terminal" as const,
      request_id: generatePublicId("attempt_control"),
      override_applied: false,
      terminal_status: lifecycle.terminal_status,
      lifecycle_version: lifecycle.lifecycle_version,
      command_result: commandResult
    };
  }

  if (lifecycle.blocking_reason) {
    throw new StudentAssessmentServiceError(
      lifecycle.blocking_reason === "attempt_needs_review"
        ? "attempt_needs_review"
        : "attempt_state_inconsistent",
      "This attempt needs review before it can be closed.",
      409,
      {
        session_public_id: session.session_public_id,
        consistency_issues: lifecycle.consistency_issues,
        lifecycle_version: lifecycle.lifecycle_version
      }
    );
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

  const commandResult = await prisma.$transaction(async (tx) => {
    const updated = await tx.assessmentSession.update({
      where: { id: session.id },
      data: {
        status: "student_exited",
        current_phase: "student_exited",
        resume_phase: null,
        resume_context: Prisma.JsonNull,
        last_activity_at: now
      },
      select: {
        id: true,
        session_public_id: true,
        attempt_number: true,
        status: true,
        current_phase: true,
        completed_at: true,
        resume_phase: true,
        resume_context: true,
        updated_at: true
      }
    });

    await tx.processEvent.create({
      data: {
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
          reason,
          operation_identity: `teacher_end_attempt:${session.session_public_id}`
        },
        occurred_at: now
      }
    });
    await tx.processEvent.create({
      data: {
        assessment_session_db_id: session.id,
        event_type: "new_attempt_available",
        event_category: "attempt_lifecycle",
        event_source: "backend",
        payload: {
          request_id: requestId,
          assessment_public_id: session.assessment.assessment_public_id,
          operation_identity: `teacher_end_attempt:${session.session_public_id}`,
          reason: "previous_attempt_closed_by_teacher"
        },
        occurred_at: now
      }
    });

    return createCommittedLifecycleOperation(tx, {
      command_type: "teacher_end_attempt",
      actor_type: "teacher",
      target_assessment_public_id: session.assessment.assessment_public_id,
      target_session_public_id: session.session_public_id,
      request_id: requestId,
      prior_lifecycle: lifecycle,
      resulting_lifecycle: resolveCanonicalAttemptLifecycle(updated),
      resulting_session_public_id: updated.session_public_id,
      resulting_attempt_number: updated.attempt_number,
      assessment_session_db_id: updated.id,
      mutation_committed: true,
      already_satisfied: false,
      recovered: false,
      canonical_destination: "assessment_list",
      safe_response_code: "attempt_ended_by_teacher"
    });
  });

  return {
    status: "attempt_ended_by_teacher" as const,
    request_id: requestId,
    override_applied: false,
    command_result: commandResult
  };
}
