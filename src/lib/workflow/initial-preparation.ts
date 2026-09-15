import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type WorkflowJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { resolveCanonicalAttemptLifecycle } from "@/lib/services/student-assessment/attempt-lifecycle";
import { getWorkflowJobConfig, retryDelayMs } from "./config";

export const INITIAL_PREPARATION_JOB = "prepare_initial_conversation" as const;
const payloadSchema = z.object({
  session_public_id: z.string(), concept_unit_public_id: z.string(),
  response_package_id: z.string(), response_package_hash: z.string(),
  execution_mode: z.enum(["production", "deterministic_e1", "no_live_e2a_contract"])
}).strict();

function leaseWhere(job: WorkflowJob) {
  return { id: job.id, status: "running" as const, locked_by: job.locked_by, attempt_count: job.attempt_count };
}

export async function claimInitialPreparationJob(workerId: string) {
  const cutoff = new Date(Date.now() - getWorkflowJobConfig().lease_timeout_ms);
  return prisma.$transaction(async (tx) => {
    await tx.workflowJob.updateMany({
      where: { job_type: INITIAL_PREPARATION_JOB, status: { in: ["pending", "retryable", "running"] }, assessment_session: { OR: [
        { status: { in: ["completed", "student_exited"] } },
        { current_phase: { in: ["session_completed", "student_exited"] } },
        { completed_at: { not: null } }
      ] } },
      data: { status: "cancelled", locked_at: null, locked_by: null, completed_at: new Date() }
    });
    await tx.$executeRaw`
      UPDATE workflow_jobs SET status = CASE WHEN attempt_count < max_attempts
        THEN 'retryable'::"WorkflowJobStatus" ELSE 'failed'::"WorkflowJobStatus" END,
        locked_at = NULL, locked_by = NULL, run_after = NOW(), updated_at = NOW(),
        last_error_category = 'lease_timeout', last_error_message = 'Preparation worker interrupted.'
      WHERE job_type = 'prepare_initial_conversation'::"WorkflowJobType"
        AND status = 'running'::"WorkflowJobStatus" AND locked_at < ${cutoff}`;
    const rows = await tx.$queryRaw<WorkflowJob[]>`
      UPDATE workflow_jobs AS job SET status = 'running'::"WorkflowJobStatus", locked_at = NOW(),
        locked_by = ${workerId}, attempt_count = job.attempt_count + 1, updated_at = NOW()
      WHERE job.id = (
        SELECT candidate.id FROM workflow_jobs candidate
        JOIN assessment_sessions session ON session.id = candidate.assessment_session_db_id
        JOIN users student ON student.id = session.user_db_id
        WHERE candidate.job_type = 'prepare_initial_conversation'::"WorkflowJobType"
          AND candidate.status IN ('pending'::"WorkflowJobStatus", 'retryable'::"WorkflowJobStatus")
          AND candidate.attempt_count < candidate.max_attempts AND candidate.run_after <= NOW()
          AND session.status = 'active'::"SessionStatus"
          AND session.current_phase NOT IN ('session_completed'::"AssessmentPhase", 'student_exited'::"AssessmentPhase")
          AND session.completed_at IS NULL AND session.automation_paused_at IS NULL
          AND student.account_status = 'active'::"UserAccountStatus"
        ORDER BY candidate.run_after, candidate.created_at
        FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
      ) RETURNING job.*`;
    const job = rows[0] ?? null;
    if (job) await logProcessEvent({
      assessment_session_db_id: job.assessment_session_db_id,
      concept_unit_session_db_id: job.concept_unit_session_db_id ?? undefined,
      event_type: "workflow_job_claimed", event_category: "workflow", event_source: "system",
      payload: { job_public_id: job.job_public_id, job_type: job.job_type, attempt_count: job.attempt_count }
    }, tx);
    return job;
  });
}

class PreparationInterrupted extends Error {
  constructor(readonly disposition: "cancelled" | "paused" | "lost_lease") { super(disposition); }
}

export async function assertInitialPreparationActive(job: WorkflowJob) {
  const current = await prisma.workflowJob.findFirst({ where: leaseWhere(job), include: {
    assessment_session: { include: { user: { select: { account_status: true } } } }
  } });
  if (!current) throw new PreparationInterrupted("lost_lease");
  const session = current.assessment_session;
  if (resolveCanonicalAttemptLifecycle(session).terminal) throw new PreparationInterrupted("cancelled");
  if (session.status !== "active" || session.automation_paused_at || session.user.account_status !== "active") {
    throw new PreparationInterrupted("paused");
  }
}

export async function renewInitialPreparationLease(job: WorkflowJob) {
  const updated = await prisma.workflowJob.updateMany({ where: leaseWhere(job), data: { locked_at: new Date() } });
  if (!updated.count) throw new PreparationInterrupted("lost_lease");
}

export async function processInitialPreparationJob(job: WorkflowJob, options: {
  prepare?: (assertActive: () => Promise<void>) => Promise<void>;
} = {}) {
  let heartbeatFailure = false;
  let heartbeat: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = renewInitialPreparationLease(job).catch(() => { heartbeatFailure = true; }).finally(() => { heartbeat = null; });
  }, Math.max(100, Math.floor(getWorkflowJobConfig().lease_timeout_ms / 3)));
  timer.unref();
  const assertActive = async () => {
    if (heartbeatFailure) throw new PreparationInterrupted("lost_lease");
    await assertInitialPreparationActive(job);
  };
  let status: "completed" | "retryable" | "failed" | "cancelled" = "completed";
  let errorCategory: string | null = null;
  let paused = false;
  try {
    await assertActive();
    const payload = payloadSchema.parse(job.payload);
    const source = await prisma.responsePackage.findFirst({ where: {
      id: payload.response_package_id, concept_unit_session_db_id: job.concept_unit_session_db_id ?? "",
      package_type: "initial_concept_unit_response_package"
    } });
    if (!source || createHash("sha256").update(JSON.stringify(source.payload)).digest("hex") !== payload.response_package_hash) {
      throw new Error("preparation_source_conflict");
    }
    if (options.prepare) {
      await options.prepare(assertActive);
    } else {
      const session = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: job.assessment_session_db_id } });
      const { completeInitialConceptUnitAdministration } = await import("@/lib/services/student-assessment/service");
      const result = await completeInitialConceptUnitAdministration({
        student_user_db_id: session.user_db_id, session_public_id: payload.session_public_id,
        concept_unit_public_id: payload.concept_unit_public_id, execution_mode: payload.execution_mode,
        assert_preparation_active: assertActive
      });
      if (result.state.formative_conversation?.opening_status !== "ready") {
        throw new Error("preparation_opening_not_ready");
      }
    }
    await assertActive();
  } catch (error) {
    if (error instanceof PreparationInterrupted && error.disposition === "lost_lease") return "lost_lease";
    paused = error instanceof PreparationInterrupted && error.disposition === "paused";
    status = error instanceof PreparationInterrupted && error.disposition === "cancelled" ? "cancelled"
      : paused || job.attempt_count < job.max_attempts ? "retryable" : "failed";
    // Do not copy provider payloads or credentials into the public workflow error surface.
    errorCategory = error instanceof PreparationInterrupted ? error.disposition : "preparation_failed";
    if (error instanceof z.ZodError || (error instanceof Error && error.message === "preparation_source_conflict")) {
      status = "failed";
      errorCategory = "preparation_source_conflict";
    }
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
  const outcome = status;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.workflowJob.updateMany({ where: leaseWhere(job), data: {
      status: outcome, locked_by: null, locked_at: null,
      ...(paused ? { max_attempts: { increment: 1 } } : {}),
      run_after: new Date(Date.now() + retryDelayMs(job.attempt_count)),
      completed_at: outcome === "completed" || outcome === "cancelled" ? new Date() : null,
      last_error_category: errorCategory,
      last_error_message: errorCategory ? "Learning support preparation did not finish. Saved responses are unchanged." : null
    } });
    if (!updated.count) return;
    await logProcessEvent({
      assessment_session_db_id: job.assessment_session_db_id,
      concept_unit_session_db_id: job.concept_unit_session_db_id ?? undefined,
      event_type: outcome === "completed" ? "workflow_job_succeeded" : outcome === "retryable" ? "workflow_job_retry_scheduled" : "workflow_job_failed",
      event_category: "workflow", event_source: "system",
      payload: { job_public_id: job.job_public_id, job_type: job.job_type, attempt_count: job.attempt_count, outcome, error_category: errorCategory }
    }, tx);
  });
  return outcome;
}

export async function runInitialPreparationWorker(signal: AbortSignal) {
  const workerId = `initial-preparation-${randomUUID()}`;
  while (!signal.aborted) {
    try {
      const job = await claimInitialPreparationJob(workerId);
      if (job) {
        await processInitialPreparationJob(job);
        continue;
      }
    } catch (error) {
      // Database outages must not permanently stop polling or print connection secrets.
      console.error("Initial preparation worker temporarily unavailable", error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "worker_error");
    }
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, getWorkflowJobConfig().poll_interval_ms);
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
  }
}
