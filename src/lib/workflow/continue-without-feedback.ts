import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { resolveCanonicalAttemptLifecycle } from "@/lib/services/student-assessment/attempt-lifecycle";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const sourceSchema = z.object({ response_package_id: z.string(), response_package_hash: z.string() });
const unavailable = () => new StudentAssessmentServiceError("invalid_phase_for_action",
  "Learning support is not available to skip. Refresh to see the current state.", 409);

// This is a student-authorized technical exit, not a successful AI result or a
// learning-profile transition. The job and every failed call remain unchanged.
export async function continueWithoutInitialFeedback(input: {
  student_user_db_id: string; session_public_id: string; concept_unit_public_id: string;
}) {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.assessmentSession.findFirst({ where: {
      session_public_id: input.session_public_id, user_db_id: input.student_user_db_id,
      user: { role: "student", account_status: "active" }
    }, select: { id: true } });
    if (!owned) throw new StudentAssessmentServiceError("session_not_owned", "Session was not found for this student.", 403);
    // Serialize with submission/retry and make a repeated click idempotent.
    await tx.$queryRaw`SELECT id FROM assessment_sessions WHERE id = ${owned.id}::uuid FOR UPDATE`;
    const session = await tx.assessmentSession.findUniqueOrThrow({ where: { id: owned.id } });
    const unit = await tx.conceptUnitSession.findFirst({ where: {
      assessment_session_db_id: owned.id, concept_unit: { concept_unit_public_id: input.concept_unit_public_id }
    } });
    if (!unit) throw unavailable();
    const previous = await tx.processEvent.findFirst({ where: {
      assessment_session_db_id: owned.id, concept_unit_session_db_id: unit.id,
      event_type: "initial_feedback_skipped", event_source: "backend"
    }, select: { id: true } });
    if (previous) return { already_continued: true };
    if (resolveCanonicalAttemptLifecycle(session).terminal || session.status !== "active" ||
        session.automation_paused_at || session.current_concept_unit_db_id !== unit.concept_unit_db_id || !unit.initial_completed_at) {
      throw unavailable();
    }
    await tx.$queryRaw`SELECT id FROM workflow_jobs WHERE concept_unit_session_db_id = ${unit.id}::uuid
      AND job_type = 'prepare_initial_conversation'::"WorkflowJobType" FOR UPDATE`;
    if (await tx.workflowJob.count({ where: { concept_unit_session_db_id: unit.id,
      job_type: "prepare_initial_conversation", status: { in: ["pending", "running", "retryable"] } } })) throw unavailable();
    const job = await tx.workflowJob.findFirst({ where: {
      assessment_session_db_id: session.id, concept_unit_session_db_id: unit.id, job_type: "prepare_initial_conversation"
    } });
    if (!job || job.status !== "failed" || job.last_error_category === "preparation_source_conflict") throw unavailable();
    const source = sourceSchema.safeParse(job.payload);
    const responsePackage = source.success ? await tx.responsePackage.findFirst({ where: {
      id: source.data.response_package_id, concept_unit_session_db_id: unit.id,
      package_type: "initial_concept_unit_response_package"
    } }) : null;
    if (!source.success || !responsePackage ||
        createHash("sha256").update(JSON.stringify(responsePackage.payload)).digest("hex") !== source.data.response_package_hash) {
      throw new StudentAssessmentServiceError("package_completion_conflict", "Your saved responses need teacher review before continuing.", 409);
    }
    const concepts = await tx.conceptUnit.findMany({ where: { assessment_db_id: session.assessment_db_id, status: "published" },
      orderBy: [{ order_index: "asc" }, { created_at: "asc" }], select: { id: true } });
    const index = concepts.findIndex((concept) => concept.id === unit.concept_unit_db_id);
    if (index < 0) throw unavailable();
    const next = concepts[index + 1];
    const now = new Date();
    // Never manufacture a follow-up completion time or profile outcome.
    await tx.conceptUnitSession.update({ where: { id: unit.id }, data: { followup_status: "incomplete" } });
    await tx.formativeConversationSession.updateMany({ where: { concept_unit_session_db_id: unit.id, status: { in: ["active", "paused"] } },
      data: { status: "ended", ended_at: now, lifecycle_reason: "initial_feedback_unavailable", concurrency_version: { increment: 1 } } });
    if (next) await tx.conceptUnitSession.upsert({ where: { assessment_session_db_id_concept_unit_db_id: {
      assessment_session_db_id: session.id, concept_unit_db_id: next.id
    } }, update: {}, create: { assessment_session_db_id: session.id, concept_unit_db_id: next.id, status: "not_started" } });
    const toPhase = next ? "concept_unit_intro" : "session_completed";
    const reviewReason = "Initial AI feedback unavailable; student continued without learning support.";
    await tx.assessmentSession.update({ where: { id: session.id }, data: {
      current_phase: toPhase, status: next ? "active" : "completed",
      current_concept_unit_db_id: next?.id ?? session.current_concept_unit_db_id,
      completed_at: next ? null : now, last_activity_at: now, resume_phase: null, resume_context: Prisma.JsonNull,
      needs_review: true, needs_review_reason: session.needs_review_reason
        ? session.needs_review_reason.includes(reviewReason) ? session.needs_review_reason : `${session.needs_review_reason}\n${reviewReason}` : reviewReason
    } });
    const payload = { policy_version: "initial-feedback-continuation-v1", job_public_id: job.job_public_id,
      response_package_hash: source.data.response_package_hash, failure_reason: job.last_error_category,
      actor_type: "student", destination: next ? "next_concept" : "assessment_complete",
      learning_support_completed: false, from_phase: session.current_phase, to_phase: toPhase };
    await logProcessEvent({ assessment_session_db_id: session.id, concept_unit_session_db_id: unit.id,
      event_type: "initial_feedback_skipped", event_category: "workflow", event_source: "backend", payload, occurred_at: now }, tx);
    await logProcessEvent({ assessment_session_db_id: session.id, event_type: "phase_exited", event_category: "phase",
      event_source: "backend", payload: { phase: session.current_phase, reason: "initial_feedback_unavailable" }, occurred_at: now }, tx);
    await logProcessEvent({ assessment_session_db_id: session.id, event_type: "phase_entered", event_category: "phase",
      event_source: "backend", payload: { phase: toPhase, reason: "initial_feedback_unavailable" }, occurred_at: now }, tx);
    if (!next) await logProcessEvent({ assessment_session_db_id: session.id, event_type: "session_completed",
      event_category: "session", event_source: "backend", payload: { reason: "initial_feedback_unavailable", learning_support_completed: false }, occurred_at: now }, tx);
    return { already_continued: false };
  }, { timeout: 15_000 });
}
