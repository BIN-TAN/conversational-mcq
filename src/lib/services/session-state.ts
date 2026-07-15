import { z } from "zod";
import { prisma } from "../db";
import { AssessmentPhaseSchema, type AssessmentPhase } from "../domain/enums";
import { generatePublicId } from "./ids";
import { logProcessEvent } from "./process-events";
import { validatePhaseTransition } from "./phase-transitions";

const stateSelect = {
  id: true,
  session_public_id: true,
  user_db_id: true,
  assessment_db_id: true,
  status: true,
  current_phase: true,
  current_concept_unit_db_id: true,
  needs_review: true,
  needs_review_reason: true,
  started_at: true,
  last_activity_at: true,
  completed_at: true,
  created_at: true,
  updated_at: true
} as const;

const getAssessmentSessionStateSchema = z
  .object({
    assessment_session_db_id: z.string().uuid().optional(),
    session_public_id: z.string().min(1).optional()
  })
  .refine((value) => value.assessment_session_db_id || value.session_public_id, {
    message: "assessment_session_db_id or session_public_id is required."
  });

export async function getAssessmentSessionState(
  input: z.input<typeof getAssessmentSessionStateSchema>
) {
  const parsed = getAssessmentSessionStateSchema.parse(input);

  return prisma.assessmentSession.findUnique({
    where: parsed.assessment_session_db_id
      ? { id: parsed.assessment_session_db_id }
      : { session_public_id: parsed.session_public_id },
    select: stateSelect
  });
}

const startAssessmentSessionSchema = z.object({
  user_db_id: z.string().uuid(),
  assessment_db_id: z.string().uuid(),
  session_public_id: z.string().min(1).optional()
});

export async function startAssessmentSession(input: z.input<typeof startAssessmentSessionSchema>) {
  const parsed = startAssessmentSessionSchema.parse(input);
  const now = new Date();
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: parsed.session_public_id ?? generatePublicId("session"),
      user_db_id: parsed.user_db_id,
      assessment_db_id: parsed.assessment_db_id,
      status: "active",
      current_phase: "session_started",
      started_at: now,
      last_activity_at: now
    },
    select: stateSelect
  });

  await logProcessEvent({
    assessment_session_db_id: session.id,
    event_type: "session_started",
    event_category: "session",
    event_source: "backend",
    payload: { phase: "session_started" },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    event_type: "phase_entered",
    event_category: "phase",
    event_source: "backend",
    payload: { phase: "session_started" },
    occurred_at: now
  });

  return session;
}

const updateAssessmentSessionPhaseSchema = z.object({
  assessment_session_db_id: z.string().uuid(),
  to_phase: AssessmentPhaseSchema,
  event_source: z.enum(["backend", "system"]).default("backend"),
  reason: z.string().optional(),
  payload: z.record(z.unknown()).optional()
});

export async function updateAssessmentSessionPhase(
  input: z.input<typeof updateAssessmentSessionPhaseSchema>
) {
  const parsed = updateAssessmentSessionPhaseSchema.parse(input);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: parsed.assessment_session_db_id },
    select: stateSelect
  });
  const fromPhase = AssessmentPhaseSchema.parse(session.current_phase);
  const transition = validatePhaseTransition(fromPhase, parsed.to_phase);
  const now = new Date();
  const transitionPayload = {
    ...(parsed.payload ?? {}),
    from_phase: fromPhase,
    to_phase: parsed.to_phase,
    reason: parsed.reason,
    validation_reason: transition.reason
  };

  if (fromPhase === parsed.to_phase) {
    const updated = await prisma.assessmentSession.update({
      where: { id: session.id },
      data: { last_activity_at: now },
      select: stateSelect
    });

    return { updated, transition, changed: false };
  }

  if (!transition.allowed) {
    await prisma.assessmentSession.update({
      where: { id: session.id },
      data: { last_activity_at: now }
    });
    await logProcessEvent({
      assessment_session_db_id: session.id,
      event_type: "transition_rejected",
      event_category: "phase",
      event_source: parsed.event_source,
      payload: transitionPayload,
      occurred_at: now
    });

    return { updated: session, transition, changed: false };
  }

  await logProcessEvent({
    assessment_session_db_id: session.id,
    event_type: "phase_exited",
    event_category: "phase",
    event_source: parsed.event_source,
    payload: { phase: fromPhase },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    event_type: "transition_validated",
    event_category: "phase",
    event_source: parsed.event_source,
    payload: transitionPayload,
    occurred_at: now
  });

  const updated = await prisma.assessmentSession.update({
    where: { id: session.id },
    data: {
      current_phase: parsed.to_phase,
      status:
        parsed.to_phase === "session_completed"
          ? "completed"
          : parsed.to_phase === "student_exited"
            ? "student_exited"
            : parsed.to_phase === "needs_review"
              ? "needs_review"
              : "active",
      needs_review: parsed.to_phase === "needs_review" ? true : session.needs_review,
      last_activity_at: now,
      completed_at: parsed.to_phase === "session_completed" ? now : session.completed_at
    },
    select: stateSelect
  });

  await logProcessEvent({
    assessment_session_db_id: session.id,
    event_type: "phase_entered",
    event_category: "phase",
    event_source: parsed.event_source,
    payload: { phase: parsed.to_phase },
    occurred_at: now
  });

  return { updated, transition, changed: true };
}

export async function markSessionNeedsReview(input: {
  assessment_session_db_id: string;
  reason: string;
}) {
  const result = await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: "needs_review",
    reason: input.reason,
    payload: { needs_review_reason: input.reason }
  });

  if (!result.transition.allowed) {
    return result;
  }

  const updated = await prisma.assessmentSession.update({
    where: { id: input.assessment_session_db_id },
    data: {
      status: "needs_review",
      needs_review: true,
      needs_review_reason: input.reason,
      last_activity_at: new Date()
    },
    select: stateSelect
  });

  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    event_type: "session_marked_needs_review",
    event_category: "session",
    event_source: "backend",
    payload: { reason: input.reason },
    occurred_at: new Date()
  });

  return { ...result, updated };
}

export async function markSessionExited(input: { assessment_session_db_id: string; reason?: string }) {
  const result = await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: "student_exited",
    reason: input.reason
  });

  if (result.transition.allowed && result.changed) {
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      event_type: "session_exited",
      event_category: "session",
      event_source: "backend",
      payload: { reason: input.reason },
      occurred_at: new Date()
    });
  }

  return result;
}

export async function markSessionCompleted(input: { assessment_session_db_id: string }) {
  const result = await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: "session_completed"
  });

  if (result.transition.allowed && result.changed) {
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      event_type: "session_completed",
      event_category: "session",
      event_source: "backend",
      occurred_at: new Date()
    });
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      event_type: "assessment_completion_summary_shown",
      event_category: "assessment_completion",
      event_source: "backend",
      payload: { reason: "session_completed" },
      occurred_at: new Date()
    });
  }

  return result;
}

export async function touchSessionActivity(input: { assessment_session_db_id: string }) {
  return prisma.assessmentSession.update({
    where: { id: input.assessment_session_db_id },
    data: { last_activity_at: new Date() },
    select: stateSelect
  });
}

export function assertAssessmentPhase(value: unknown): AssessmentPhase {
  return AssessmentPhaseSchema.parse(value);
}
