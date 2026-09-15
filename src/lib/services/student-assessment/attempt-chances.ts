import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StudentAssessmentServiceError } from "./errors";
import { resolveCanonicalAttemptLifecycle } from "./attempt-lifecycle";

export const ASSESSMENT_ATTEMPT_LIMIT = 3;
export const ASSESSMENT_ATTEMPT_POLICY_VERSION = "assessment-attempt-policy-v2";

export function assessmentFamily(assessment: { assessment_public_id: string; revision_family_public_id: string | null }) {
  return assessment.revision_family_public_id ?? assessment.assessment_public_id;
}

export function summarizeAttemptChances(chances: Array<{ waived_at: Date | null }>) {
  const used = chances.filter((chance) => !chance.waived_at).length;
  return { maximum_attempts: ASSESSMENT_ATTEMPT_LIMIT, attempts_used: used,
    remaining_attempts: Math.max(0, ASSESSMENT_ATTEMPT_LIMIT - used),
    restored_attempts: chances.length - used };
}

export async function readAttemptChances(studentId: string, family: string, db: Prisma.TransactionClient = prisma) {
  const chances = await db.assessmentAttemptChance.findMany({
    where: { student_db_id: studentId, assessment_family_public_id: family }, select: { session_public_id: true, waived_at: true }
  });
  const sessions = await db.assessmentSession.findMany({ where: { user_db_id: studentId,
    assessment: { OR: [{ assessment_public_id: family }, { revision_family_public_id: family }] } },
    select: { session_public_id: true, status: true, current_phase: true, completed_at: true } });
  const recorded = new Set(chances.map(chance => chance.session_public_id));
  return { ...summarizeAttemptChances([...chances, ...sessions.filter(session => !recorded.has(session.session_public_id)).map(() => ({ waived_at: null }))]),
    family_resumable_session_public_id: sessions.find(session => resolveCanonicalAttemptLifecycle(session).resumable)?.session_public_id ?? null };
}

export async function assertAttemptChanceAvailable(studentId: string, family: string, db: Prisma.TransactionClient) {
  const policy = await readAttemptChances(studentId, family, db);
  if (!policy.remaining_attempts) {
    throw new StudentAssessmentServiceError("assessment_attempt_limit_reached",
      "You have used all three attempts. You can still review your previous attempts.", 409);
  }
  return policy;
}

export async function restoreAttemptChance(input: { teacher_user_db_id: string; session_public_id: string; reason: string }) {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 1000) {
    throw new StudentAssessmentServiceError("validation_failed", "Describe the technical problem (10-1000 characters).", 400);
  }
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findFirst({ where: { id: input.teacher_user_db_id, role: "teacher_researcher", account_status: "active" }, select: { id: true } });
    const session = await tx.assessmentSession.findFirst({
      where: { session_public_id: input.session_public_id, assessment: { created_by_user_db_id: input.teacher_user_db_id } },
      select: { user_db_id: true, status: true, current_phase: true, completed_at: true }
    });
    if (!actor || !session) throw new StudentAssessmentServiceError("not_found", "Session was not found.", 404);
    if (!resolveCanonicalAttemptLifecycle(session).terminal) {
      throw new StudentAssessmentServiceError("attempt_still_open", "Close the interrupted attempt before restoring its chance.", 409);
    }
    const chance = await tx.assessmentAttemptChance.findUnique({ where: { session_public_id: input.session_public_id } });
    if (!chance) throw new StudentAssessmentServiceError("not_found", "No chance record exists for this attempt. Ask the administrator to check its migration history.", 404);
    const updated = await tx.assessmentAttemptChance.updateMany({
      where: { session_public_id: input.session_public_id, student_db_id: session.user_db_id, waived_at: null },
      data: { waived_at: new Date(), waived_by_user_db_id: actor.id, waiver_reason: reason }
    });
    const allowance = await readAttemptChances(session.user_db_id, chance.assessment_family_public_id, tx);
    return { status: updated.count ? "chance_restored" : "chance_already_restored", remaining_attempts: allowance.remaining_attempts };
  });
}
