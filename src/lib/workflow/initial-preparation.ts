import { createHash, randomUUID } from "node:crypto";
import { PREPARATION_FINISH_AFTER_MS } from "./initial-preparation-status";
import { z } from "zod";
import { Prisma, type WorkflowJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { resolveCanonicalAttemptLifecycle } from "@/lib/services/student-assessment/attempt-lifecycle";
import { FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID } from "@/lib/services/student-assessment/formative-conversation/opening-contract";
import { getWorkflowJobConfig, retryDelayMs } from "./config";

export const INITIAL_PREPARATION_JOB = "prepare_initial_conversation" as const;
const payloadSchema = z.object({
  session_public_id: z.string(), concept_unit_public_id: z.string(),
  response_package_id: z.string(), response_package_hash: z.string(),
  execution_mode: z.enum(["production", "deterministic_e1", "no_live_e2a_contract"]),
  // Set by the instructor's "retry step" control; without it that retry failed as a conflict.
  retry_of_job_public_id: z.string().optional(),
  requested_by_override_public_id: z.string().optional()
}).strict();

function leaseWhere(job: WorkflowJob) {
  return { id: job.id, status: "running" as const, locked_by: job.locked_by, attempt_count: job.attempt_count };
}

/**
 * Initial-preparation jobs have their own, shorter lease (INITIAL_PREPARATION_LEASE_TIMEOUT_MS),
 * renewed every third of it while the job runs, so a worker restart hands an interrupted job
 * to another worker within about that long instead of the legacy queue's lease.
 */
export function initialPreparationLeaseTimeoutMs() {
  return getWorkflowJobConfig().initial_preparation_lease_timeout_ms;
}

/**
 * The opening alone failed and the profile is already saved (the next attempt reuses it and
 * makes no new profiling call), so the job tries the opening again after a short wait
 * instead of the full backoff. A provider's retry-after still applies (see run_after).
 */
export const OPENING_ONLY_RETRY_DELAY_MS = 5_000;

export function initialPreparationRetryRunAfterMs(input: {
  now: number; attempt_count: number; opening_only_retry: boolean; retry_not_before: number;
}) {
  const delay = input.opening_only_retry ? OPENING_ONLY_RETRY_DELAY_MS : retryDelayMs(input.attempt_count);
  return Math.max(input.now + delay, input.retry_not_before);
}

export async function claimInitialPreparationJob(workerId: string) {
  const cutoff = new Date(Date.now() - initialPreparationLeaseTimeoutMs());
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
    assessment_session: { include: { user: { select: { account_status: true } } } },
    concept_unit_session: { select: { concept_unit_db_id: true } }
  } });
  if (!current) throw new PreparationInterrupted("lost_lease");
  const session = current.assessment_session;
  if (resolveCanonicalAttemptLifecycle(session).terminal) throw new PreparationInterrupted("cancelled");
  if (current.concept_unit_session?.concept_unit_db_id !== session.current_concept_unit_db_id) {
    throw new PreparationInterrupted("cancelled");
  }
  const continued = await prisma.processEvent.findFirst({ where: {
    assessment_session_db_id: session.id, concept_unit_session_db_id: current.concept_unit_session_db_id,
    event_type: "initial_feedback_skipped", event_source: "backend"
  }, select: { id: true } });
  if (continued) throw new PreparationInterrupted("cancelled");
  if (session.status !== "active" || session.automation_paused_at || session.user.account_status !== "active") {
    throw new PreparationInterrupted("paused");
  }
}

export async function renewInitialPreparationLease(job: WorkflowJob) {
  const updated = await prisma.workflowJob.updateMany({ where: leaseWhere(job), data: { locked_at: new Date() } });
  if (!updated.count) throw new PreparationInterrupted("lost_lease");
}

/** One full interpretation attempt at its worst: two provider calls at their timeout and the wait between them. */
const INTERPRETATION_ATTEMPT_WORST_CASE_MS = 2 * 180_000 + 30_000;

/**
 * Asked at the moment of a transient interpretation failure: defer to the job's next attempt
 * only when one is left and it would still end, at its worst, before the student may finish
 * without learning support. Otherwise the usable parts are salvaged or a fallback is saved now.
 */
export function canDeferInterpretationFailure(job: Pick<WorkflowJob, "attempt_count" | "max_attempts" | "created_at">,
  now = Date.now()) {
  if (job.attempt_count >= job.max_attempts) return false;
  const config = getWorkflowJobConfig();
  const nextDelayAtMost = Math.min(config.max_retry_ms, config.base_retry_ms * 2 ** Math.max(0, job.attempt_count - 1) * 1.2);
  return now - job.created_at.getTime() + nextDelayAtMost + INTERPRETATION_ATTEMPT_WORST_CASE_MS < PREPARATION_FINISH_AFTER_MS;
}

export async function processInitialPreparationJob(job: WorkflowJob, options: {
  prepare?: (assertActive: () => Promise<void>) => Promise<void>;
} = {}) {
  let heartbeatFailure = false;
  let heartbeat: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = renewInitialPreparationLease(job).catch(() => { heartbeatFailure = true; }).finally(() => { heartbeat = null; });
  }, Math.max(100, Math.floor(initialPreparationLeaseTimeoutMs() / 3)));
  timer.unref();
  const assertActive = async () => {
    if (heartbeatFailure) throw new PreparationInterrupted("lost_lease");
    await assertInitialPreparationActive(job);
  };
  let status: "completed" | "retryable" | "failed" | "cancelled" = "completed";
  let errorCategory: string | null = null;
  let retryNotBefore = 0;
  let paused = false;
  // Set only when the profile and conversation are saved and just the opening is not ready.
  let openingOnlyRetry = false;
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
        assert_preparation_active: assertActive,
        // A transient model failure waits for the next job attempt (with backoff) rather than
        // saving a fallback profile; the last attempt always saves a profile. Waiting is
        // allowed only while another full attempt still ends before the student may finish
        // without learning support, so a profile always exists by then.
        defer_transient_interpretation_failures: () => canDeferInterpretationFailure(job)
      });
      const conversation = result.state.formative_conversation;
      // A failed opening is retried automatically. When retrying cannot help (the opening is
      // unavailable, for example its prompt is not approved) or on the last automatic
      // attempt, preparation completes anyway if the profile and conversation exist: the
      // student then sees the answer review, a retry for the opening when one can work, and
      // the End button, instead of "learning support could not be prepared".
      // (While this job runs the projection reports the opening as "preparing", so the stored
      // opening receipt is read directly to see whether a retry can help.)
      const openingReceipt = conversation && conversation.opening_status !== "ready"
        ? await prisma.formativeConversationMessageReceipt.findFirst({
            where: {
              formative_conversation_session: { conversation_public_id: conversation.conversation_public_id },
              client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID
            },
            select: { status: true, response_payload: true }
          })
        : null;
      const openingPayload = openingReceipt?.response_payload;
      const retryCannotHelp = openingReceipt?.status === "failed" && Boolean(openingPayload) &&
        typeof openingPayload === "object" && !Array.isArray(openingPayload) &&
        (openingPayload as Record<string, unknown>).retryable === false;
      const handOverToConversation = Boolean(conversation) &&
        (job.attempt_count >= job.max_attempts || retryCannotHelp);
      if (conversation?.opening_status !== "ready" && !handOverToConversation) {
        openingOnlyRetry = Boolean(conversation);
        throw new Error("preparation_opening_not_ready");
      }
    }
    await assertActive();
  } catch (error) {
    if (error instanceof PreparationInterrupted && error.disposition === "lost_lease") return "lost_lease";
    if (!(error instanceof Error && error.message === "preparation_opening_not_ready")) openingOnlyRetry = false;
    paused = error instanceof PreparationInterrupted && error.disposition === "paused";
    status = error instanceof PreparationInterrupted && error.disposition === "cancelled" ? "cancelled"
      : paused || job.attempt_count < job.max_attempts ? "retryable" : "failed";
    // Do not copy provider payloads or credentials into the public workflow error surface.
    errorCategory = error instanceof PreparationInterrupted ? error.disposition : "preparation_failed";
    if (error instanceof z.ZodError || (error instanceof Error && error.message === "preparation_source_conflict")) {
      status = "failed";
      errorCategory = "preparation_source_conflict";
    } else if (!(error instanceof PreparationInterrupted)) {
      // Capacity and account failures will not improve by silently repeating requests.
      // Only inspect calls from this job attempt, not failures from an earlier retry.
      const nonretryableCall = await prisma.agentCall.findFirst({ where: {
        assessment_session_db_id: job.assessment_session_db_id,
        concept_unit_session_db_id: job.concept_unit_session_db_id,
        created_at: { gte: job.locked_at ?? job.updated_at },
        call_status: "failed", OR: [
          { incomplete_reason: "max_output_tokens" }, { error_category: "quota" }
        ]
      }, orderBy: { created_at: "desc" }, select: { error_category: true } });
      if (nonretryableCall) {
        status = "failed";
        errorCategory = nonretryableCall.error_category === "quota"
          ? "provider_account_unavailable" : "output_token_limit";
      } else if (status === "retryable") {
        const failedCall = await prisma.agentCall.findFirst({ where: {
          assessment_session_db_id: job.assessment_session_db_id,
          concept_unit_session_db_id: job.concept_unit_session_db_id,
          created_at: { gte: job.locked_at ?? job.updated_at }, call_status: "failed"
        }, orderBy: { created_at: "desc" }, select: { raw_output: true, completed_at: true, created_at: true } });
        const raw = failedCall?.raw_output;
        const failure = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.provider_failure : null;
        const delay = failure && typeof failure === "object" && !Array.isArray(failure) ? failure.retry_after_ms : null;
        if (typeof delay === "number" && Number.isFinite(delay) && delay > 0) {
          const candidate = (failedCall!.completed_at ?? failedCall!.created_at).getTime() + delay;
          if (Number.isFinite(new Date(candidate).getTime())) retryNotBefore = candidate;
        }
      }
    }
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
  // Students are never left at a dead end. When preparation has failed for good, the
  // student is handed to the conversation panel (answer review, opening retry, End and
  // Finish): an existing conversation is used as it is; otherwise a no-claims fallback
  // profile and its conversation are saved without any model call. A source conflict is
  // not salvaged (the sealed responses do not match); the student can still finish.
  if (status === "failed" && errorCategory !== "preparation_source_conflict" && !options.prepare) {
    const handedOver = await handOverAfterFailedPreparation(job, errorCategory).catch(() => false);
    if (handedOver) {
      errorCategory = `handed_over_after_${errorCategory ?? "preparation_failed"}`;
      status = "completed";
    }
  }
  const outcome = status;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.workflowJob.updateMany({ where: leaseWhere(job), data: {
      status: outcome, locked_by: null, locked_at: null,
      ...(paused ? { max_attempts: { increment: 1 } } : {}),
      run_after: new Date(initialPreparationRetryRunAfterMs({
        now: Date.now(), attempt_count: job.attempt_count,
        opening_only_retry: openingOnlyRetry && outcome === "retryable" && !paused, retry_not_before: retryNotBefore
      })),
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

async function handOverAfterFailedPreparation(job: WorkflowJob, errorCategory: string | null) {
  if (!job.concept_unit_session_db_id) return false;
  const existing = await prisma.formativeConversationSession.findUnique({
    where: { concept_unit_session_db_id: job.concept_unit_session_db_id },
    select: { id: true }
  });
  if (existing) return true;
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) return false;
  const { prepareInitialInterpretationV8 } = await import("@/lib/services/student-assessment/interpretation-v8/prepare");
  await prepareInitialInterpretationV8({
    concept_unit_session_db_id: job.concept_unit_session_db_id,
    response_package_id: payload.data.response_package_id,
    execution_mode: payload.data.execution_mode,
    mode: "fallback_only",
    fallback_reason: `preparation_failed:${errorCategory ?? "unknown"}`
  });
  return true;
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
