import { Prisma, type WorkflowJob, type WorkflowJobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
import { getWorkflowJobConfig, retryDelayMs } from "./config";

export type WorkflowJobSummary = {
  job_public_id: string;
  job_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  last_error_category: string | null;
  last_error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type EnqueueWorkflowJobInput = {
  job_type: WorkflowJobType;
  assessment_session_db_id: string;
  concept_unit_session_db_id?: string | null;
  idempotency_key: string;
  payload: Record<string, unknown>;
  run_after?: Date;
  max_attempts?: number;
};

function safeErrorMessage(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted_api_key]")
    .slice(0, 1200);
}

export function serializeWorkflowJob(job: WorkflowJob): WorkflowJobSummary {
  return {
    job_public_id: job.job_public_id,
    job_type: job.job_type,
    status: job.status,
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    run_after: job.run_after.toISOString(),
    last_error_category: job.last_error_category,
    last_error_message: job.last_error_message,
    created_at: job.created_at.toISOString(),
    completed_at: job.completed_at?.toISOString() ?? null
  };
}

export async function enqueueWorkflowJob(input: EnqueueWorkflowJobInput) {
  const existing = await prisma.workflowJob.findUnique({
    where: { idempotency_key: input.idempotency_key }
  });

  if (existing) {
    return { job: existing, created: false };
  }

  try {
    const job = await prisma.workflowJob.create({
      data: {
        job_public_id: generatePublicId("workflow_job"),
        job_type: input.job_type,
        status: "pending",
        assessment_session_db_id: input.assessment_session_db_id,
        concept_unit_session_db_id: input.concept_unit_session_db_id ?? null,
        idempotency_key: input.idempotency_key,
        payload: toPrismaJson(input.payload) ?? Prisma.JsonNull,
        max_attempts: input.max_attempts ?? getWorkflowJobConfig().max_attempts,
        run_after: input.run_after ?? new Date()
      }
    });

    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id ?? undefined,
      event_type: "workflow_job_enqueued",
      event_category: "workflow",
      event_source: "backend",
      payload: {
        job_public_id: job.job_public_id,
        job_type: job.job_type
      },
      occurred_at: new Date()
    });

    return { job, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const job = await prisma.workflowJob.findUniqueOrThrow({
        where: { idempotency_key: input.idempotency_key }
      });

      return { job, created: false };
    }

    throw error;
  }
}

export async function releaseAbandonedWorkflowJobs() {
  const cutoff = new Date(Date.now() - getWorkflowJobConfig().lease_timeout_ms);

  return prisma.workflowJob.updateMany({
    where: {
      status: "running",
      locked_at: { lt: cutoff }
    },
    data: {
      status: "retryable",
      locked_at: null,
      locked_by: null,
      run_after: new Date(),
      last_error_category: "lease_timeout",
      last_error_message: "Workflow job lease expired before completion."
    }
  });
}

export async function claimNextWorkflowJob(workerId: string) {
  await releaseAbandonedWorkflowJobs();

  const rows = await prisma.$queryRaw<WorkflowJob[]>`
    UPDATE "workflow_jobs" AS job
    SET
      "status" = 'running'::"WorkflowJobStatus",
      "locked_at" = NOW(),
      "locked_by" = ${workerId},
      "attempt_count" = job."attempt_count" + 1,
      "updated_at" = NOW()
    WHERE job."id" = (
      SELECT candidate."id"
      FROM "workflow_jobs" AS candidate
      INNER JOIN "assessment_sessions" AS session
        ON session."id" = candidate."assessment_session_db_id"
      WHERE candidate."status" IN ('pending'::"WorkflowJobStatus", 'retryable'::"WorkflowJobStatus")
        AND candidate."run_after" <= NOW()
        AND session."automation_paused_at" IS NULL
      ORDER BY candidate."run_after" ASC, candidate."created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;

  const job = rows[0] ?? null;

  if (job) {
    await logProcessEvent({
      assessment_session_db_id: job.assessment_session_db_id,
      concept_unit_session_db_id: job.concept_unit_session_db_id ?? undefined,
      event_type: "workflow_job_claimed",
      event_category: "workflow",
      event_source: "system",
      payload: {
        job_public_id: job.job_public_id,
        job_type: job.job_type,
        attempt_count: job.attempt_count
      },
      occurred_at: new Date()
    });
  }

  return job;
}

export async function completeWorkflowJob(job: WorkflowJob) {
  const completed = await prisma.workflowJob.update({
    where: { id: job.id },
    data: {
      status: "completed",
      locked_at: null,
      locked_by: null,
      completed_at: new Date(),
      last_error_category: null,
      last_error_message: null
    }
  });

  await logProcessEvent({
    assessment_session_db_id: job.assessment_session_db_id,
    concept_unit_session_db_id: job.concept_unit_session_db_id ?? undefined,
    event_type: "workflow_job_succeeded",
    event_category: "workflow",
    event_source: "system",
    payload: {
      job_public_id: job.job_public_id,
      job_type: job.job_type,
      attempt_count: job.attempt_count
    },
    occurred_at: new Date()
  });

  return completed;
}

export async function failOrRetryWorkflowJob(input: {
  job: WorkflowJob;
  retryable: boolean;
  error_category: string;
  error_message: string;
}) {
  const message = safeErrorMessage(input.error_message);
  const shouldRetry = input.retryable && input.job.attempt_count < input.job.max_attempts;
  const runAfter = new Date(Date.now() + retryDelayMs(input.job.attempt_count));
  const updated = await prisma.workflowJob.update({
    where: { id: input.job.id },
    data: shouldRetry
      ? {
          status: "retryable",
          locked_at: null,
          locked_by: null,
          run_after: runAfter,
          last_error_category: input.error_category,
          last_error_message: message
        }
      : {
          status: "failed",
          locked_at: null,
          locked_by: null,
          last_error_category: input.error_category,
          last_error_message: message
        }
  });

  await logProcessEvent({
    assessment_session_db_id: input.job.assessment_session_db_id,
    concept_unit_session_db_id: input.job.concept_unit_session_db_id ?? undefined,
    event_type: shouldRetry ? "workflow_job_retry_scheduled" : "workflow_job_failed",
    event_category: "workflow",
    event_source: "system",
    payload: {
      job_public_id: input.job.job_public_id,
      job_type: input.job.job_type,
      attempt_count: input.job.attempt_count,
      retryable: shouldRetry,
      error_category: input.error_category
    },
    occurred_at: new Date()
  });

  if (shouldRetry) {
    await logProcessEvent({
      assessment_session_db_id: input.job.assessment_session_db_id,
      concept_unit_session_db_id: input.job.concept_unit_session_db_id ?? undefined,
      event_type: "agent_retry_scheduled",
      event_category: "agent",
      event_source: "system",
      payload: {
        job_public_id: input.job.job_public_id,
        job_type: input.job.job_type,
        run_after: runAfter.toISOString()
      },
      occurred_at: new Date()
    });
  }

  return { job: updated, retry_scheduled: shouldRetry };
}

export async function markSessionAutomationException(input: {
  assessment_session_db_id: string;
  reason: string;
}) {
  await prisma.assessmentSession.update({
    where: { id: input.assessment_session_db_id },
    data: {
      needs_review: true,
      needs_review_reason: input.reason,
      automation_exception_reason: input.reason,
      last_activity_at: new Date()
    }
  });
}

export async function listWorkflowJobsForSession(assessmentSessionDbId: string) {
  const jobs = await prisma.workflowJob.findMany({
    where: { assessment_session_db_id: assessmentSessionDbId },
    orderBy: [{ created_at: "desc" }]
  });

  return jobs.map(serializeWorkflowJob);
}
