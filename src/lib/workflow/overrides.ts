import { Prisma, type WorkflowOverrideActionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { getWorkflowJobConfig } from "./config";

export class WorkflowOverrideError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "WorkflowOverrideError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function findSession(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: {
      id: true,
      session_public_id: true,
      workflow_mode_snapshot: true,
      current_phase: true,
      automation_paused_at: true
    }
  });

  if (!session) {
    throw new WorkflowOverrideError("session_not_found", "Session was not found.", 404, {
      session_public_id: sessionPublicId
    });
  }

  if (session.workflow_mode_snapshot !== "automatic") {
    throw new WorkflowOverrideError(
      "manual_session_has_no_automation",
      "This session uses manual review mode.",
      409,
      { session_public_id: sessionPublicId }
    );
  }

  return session;
}

async function conceptUnitSessionId(input: {
  session_db_id: string;
  concept_unit_public_id?: string;
}) {
  if (!input.concept_unit_public_id) {
    return null;
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findFirst({
    where: {
      assessment_session_db_id: input.session_db_id,
      concept_unit: {
        concept_unit_public_id: input.concept_unit_public_id
      }
    },
    select: { id: true }
  });

  if (!conceptUnitSession) {
    throw new WorkflowOverrideError(
      "concept_unit_session_not_found",
      "Concept-unit session was not found.",
      404,
      { concept_unit_public_id: input.concept_unit_public_id }
    );
  }

  return conceptUnitSession.id;
}

async function createOverride(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id?: string | null;
  created_by_user_db_id: string;
  action_type: WorkflowOverrideActionType;
  reason?: string | null;
}) {
  return prisma.workflowOverride.create({
    data: {
      override_public_id: generatePublicId("workflow_override"),
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id ?? null,
      created_by_user_db_id: input.created_by_user_db_id,
      action_type: input.action_type,
      reason: input.reason ?? null
    }
  });
}

async function logOverrideEvent(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id?: string | null;
  event_type:
    | "workflow_automation_paused"
    | "workflow_automation_resumed"
    | "workflow_retry_requested"
    | "workflow_followup_stop_requested";
  override_public_id: string;
  reason?: string | null;
}) {
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id ?? undefined,
    event_type: input.event_type,
    event_category: "workflow",
    event_source: "backend",
    payload: {
      override_public_id: input.override_public_id,
      reason: input.reason ?? null
    },
    occurred_at: new Date()
  });
}

export async function pauseWorkflowAutomation(input: {
  session_public_id: string;
  teacher_user_db_id: string;
  concept_unit_public_id?: string;
  reason?: string | null;
}) {
  const session = await findSession(input.session_public_id);
  const cusId = await conceptUnitSessionId({
    session_db_id: session.id,
    concept_unit_public_id: input.concept_unit_public_id
  });
  const override = await createOverride({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: cusId,
    created_by_user_db_id: input.teacher_user_db_id,
    action_type: "pause_automation",
    reason: input.reason
  });

  await prisma.assessmentSession.update({
    where: { id: session.id },
    data: {
      automation_paused_at: new Date(),
      last_activity_at: new Date()
    }
  });
  await logOverrideEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: cusId,
    event_type: "workflow_automation_paused",
    override_public_id: override.override_public_id,
    reason: input.reason
  });

  return { status: "automation_paused" as const, override_public_id: override.override_public_id };
}

export async function resumeWorkflowAutomation(input: {
  session_public_id: string;
  teacher_user_db_id: string;
  concept_unit_public_id?: string;
  reason?: string | null;
}) {
  const session = await findSession(input.session_public_id);
  const cusId = await conceptUnitSessionId({
    session_db_id: session.id,
    concept_unit_public_id: input.concept_unit_public_id
  });
  const override = await createOverride({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: cusId,
    created_by_user_db_id: input.teacher_user_db_id,
    action_type: "resume_automation",
    reason: input.reason
  });

  await prisma.$transaction([
    prisma.assessmentSession.update({
      where: { id: session.id },
      data: {
        automation_paused_at: null,
        automation_exception_reason: null,
        last_activity_at: new Date()
      }
    }),
    prisma.workflowJob.updateMany({
      where: {
        assessment_session_db_id: session.id,
        status: { in: ["pending", "retryable"] }
      },
      data: {
        run_after: new Date(),
        locked_at: null,
        locked_by: null
      }
    })
  ]);
  await logOverrideEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: cusId,
    event_type: "workflow_automation_resumed",
    override_public_id: override.override_public_id,
    reason: input.reason
  });

  return { status: "automation_resumed" as const, override_public_id: override.override_public_id };
}

export async function retryCurrentWorkflowStep(input: {
  session_public_id: string;
  teacher_user_db_id: string;
  reason?: string | null;
}) {
  const session = await findSession(input.session_public_id);
  const failedJob = await prisma.workflowJob.findFirst({
    where: {
      assessment_session_db_id: session.id,
      status: "failed"
    },
    orderBy: [{ updated_at: "desc" }]
  });

  if (!failedJob) {
    throw new WorkflowOverrideError(
      "failed_workflow_job_not_found",
      "No failed workflow job is available to retry.",
      409,
      { session_public_id: input.session_public_id }
    );
  }

  const override = await createOverride({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: failedJob.concept_unit_session_db_id,
    created_by_user_db_id: input.teacher_user_db_id,
    action_type: "retry_current_step",
    reason: input.reason
  });

  const retryJob = await prisma.workflowJob.create({
    data: {
      job_public_id: generatePublicId("workflow_job"),
      job_type: failedJob.job_type,
      status: "pending",
      assessment_session_db_id: failedJob.assessment_session_db_id,
      concept_unit_session_db_id: failedJob.concept_unit_session_db_id,
      idempotency_key: `${failedJob.idempotency_key}:retry:${override.override_public_id}`,
      payload:
        toPrismaJson({
          retry_of_job_public_id: failedJob.job_public_id,
          requested_by_override_public_id: override.override_public_id
        }) ?? Prisma.JsonNull,
      max_attempts: getWorkflowJobConfig().max_attempts,
      run_after: new Date()
    }
  });

  await prisma.assessmentSession.update({
    where: { id: session.id },
    data: {
      automation_exception_reason: null,
      last_activity_at: new Date()
    }
  });
  await logOverrideEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: failedJob.concept_unit_session_db_id,
    event_type: "workflow_retry_requested",
    override_public_id: override.override_public_id,
    reason: input.reason
  });

  return {
    status: "workflow_retry_created" as const,
    override_public_id: override.override_public_id,
    job_public_id: retryJob.job_public_id
  };
}

export async function stopWorkflowFollowup(input: {
  session_public_id: string;
  teacher_user_db_id: string;
  concept_unit_public_id?: string;
  reason?: string | null;
}) {
  const session = await findSession(input.session_public_id);
  const cusId = await conceptUnitSessionId({
    session_db_id: session.id,
    concept_unit_public_id: input.concept_unit_public_id
  });
  const override = await createOverride({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: cusId,
    created_by_user_db_id: input.teacher_user_db_id,
    action_type: "stop_followup",
    reason: input.reason
  });

  await prisma.workflowJob.updateMany({
    where: {
      assessment_session_db_id: session.id,
      ...(cusId ? { concept_unit_session_db_id: cusId } : {}),
      job_type: "start_initial_followup",
      status: { in: ["pending", "retryable"] }
    },
    data: {
      status: "cancelled",
      completed_at: new Date()
    }
  });

  if (session.current_phase === "followup_active" && cusId) {
    const activeRound = await prisma.followupRound.findFirst({
      where: {
        concept_unit_session_db_id: cusId,
        status: "active"
      },
      orderBy: [{ round_index: "desc" }]
    });

    if (activeRound) {
      await prisma.followupRound.update({
        where: { id: activeRound.id },
        data: {
          status: "stopped",
          completed_at: new Date()
        }
      });
      await prisma.conceptUnitSession.update({
        where: { id: cusId },
        data: {
          followup_status: "stopped",
          followup_completed_at: new Date()
        }
      });
      await updateAssessmentSessionPhase({
        assessment_session_db_id: session.id,
        to_phase: "followup_stopped",
        reason: "teacher_exception_stop_followup",
        payload: { override_public_id: override.override_public_id }
      });
    }
  }

  await logOverrideEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: cusId,
    event_type: "workflow_followup_stop_requested",
    override_public_id: override.override_public_id,
    reason: input.reason
  });

  return { status: "followup_stop_recorded" as const, override_public_id: override.override_public_id };
}
