import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "@/lib/services/content/errors";
import {
  decisionAdjustedTopicSummary,
  readStoredInterpretationV8
} from "@/lib/services/student-assessment/interpretation-v8/profile";
import type { InstructorItemDecision } from "@/lib/services/student-assessment/interpretation-v8/rules";

/**
 * Instructor item review (docs/AI_MODULE_REDESIGN_2026-10-19.md, sections 4.3 and 4.4).
 * The profiling model may flag a possible item issue; only the instructor decides whether
 * the item is kept or excluded, and the decision applies to every student who took it.
 * Decisions are append-only (a new one supersedes the last). Stored profiles never change;
 * labels shown to instructors are recomputed from stored item statuses and decisions.
 *
 * The table is read and written with SQL so the module works before the Prisma client is
 * regenerated (prisma/migrations/20261020090000_item_review_decisions).
 */
export const ITEM_REVIEW_VERSION = "item-review-decisions-v1" as const;

type DecisionRow = {
  item_public_id: string;
  decision: InstructorItemDecision;
  note: string | null;
  decided_at: Date;
  decided_by: string | null;
};

export async function loadItemReviewDecisionRowsForAssessment(assessmentDbId: string): Promise<DecisionRow[]> {
  return prisma.$queryRaw<DecisionRow[]>`
    SELECT i.item_public_id, d.decision::text AS decision, d.note, d.decided_at, u.user_id AS decided_by
    FROM item_review_decisions d
    JOIN items i ON i.id = d.item_db_id
    JOIN concept_units cu ON cu.id = i.concept_unit_db_id
    LEFT JOIN users u ON u.id = d.decided_by_user_db_id
    WHERE d.superseded_at IS NULL AND cu.assessment_db_id = ${assessmentDbId}::uuid`;
}

export async function loadItemReviewDecisionsForAssessment(assessmentDbId: string) {
  const rows = await loadItemReviewDecisionRowsForAssessment(assessmentDbId);
  return new Map(rows.map((row) => [row.item_public_id, row.decision]));
}

async function ownedAssessment(teacherUserDbId: string, assessmentPublicId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { assessment_public_id: assessmentPublicId, created_by_user_db_id: teacherUserDbId },
    select: { id: true, assessment_public_id: true, title: true }
  });
  if (!assessment) throw new ContentServiceError("not_found", "Mini test was not found.", 404);
  return assessment;
}

export async function recordItemReviewDecision(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  item_public_id: string;
  decision: InstructorItemDecision;
  note?: string | null;
}) {
  const assessment = await ownedAssessment(input.teacher_user_db_id, input.assessment_public_id);
  const item = await prisma.item.findFirst({
    where: { item_public_id: input.item_public_id, concept_unit: { assessment_db_id: assessment.id } },
    select: { id: true }
  });
  if (!item) throw new ContentServiceError("not_found", "Item was not found in this mini test.", 404);
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;
  const decisionPublicId = `ird_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(5).toString("base64url").toLowerCase()}`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE item_review_decisions SET superseded_at = NOW()
      WHERE item_db_id = ${item.id}::uuid AND superseded_at IS NULL`;
    await tx.$executeRaw`
      INSERT INTO item_review_decisions (id, decision_public_id, item_db_id, decision, note, decided_by_user_db_id, decided_at)
      VALUES (${randomUUID()}::uuid, ${decisionPublicId}, ${item.id}::uuid, ${input.decision}::"ItemReviewDecisionType",
        ${note}, ${input.teacher_user_db_id}::uuid, NOW())`;
  });
  return { decision_public_id: decisionPublicId, item_public_id: input.item_public_id, decision: input.decision, note };
}

export type FlaggedItemReview = {
  item_public_id: string;
  item_number: number;
  item_stem: string;
  options: Array<{ label: string; text: string }>;
  correct_option: string;
  decision: InstructorItemDecision | null;
  decision_note: string | null;
  decided_at: string | null;
  flagged_by: Array<{
    student_label: string;
    attempt_number: number;
    selected_option: string | null;
    student_quote: string | null;
    model_rationale: string | null;
  }>;
  students_with_item: number;
  labels_pending_review: number;
  labels_that_change_if_excluded: number;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function optionsOf(value: unknown) {
  return (Array.isArray(value) ? value : []).map(record).flatMap((entry) =>
    typeof entry.label === "string" && typeof entry.text === "string" ? [{ label: entry.label, text: entry.text }] : []
  );
}

/** Items flagged by the profiling model in this mini test, with what a decision would change. */
export async function listItemReviews(input: { teacher_user_db_id: string; assessment_public_id: string }) {
  const assessment = await ownedAssessment(input.teacher_user_db_id, input.assessment_public_id);
  const [items, profiles, decisionRows] = await Promise.all([
    prisma.item.findMany({
      where: { concept_unit: { assessment_db_id: assessment.id }, status: { not: "archived" } },
      orderBy: [{ item_order: "asc" }],
      select: { item_public_id: true, item_order: true, item_stem: true, options: true, correct_option: true }
    }),
    prisma.studentProfile.findMany({
      where: { profile_type: "initial", concept_unit_session: { assessment_session: { assessment_db_id: assessment.id } } },
      select: {
        item_level_evidence: true,
        concept_unit_session: { select: { assessment_session: { select: { attempt_number: true, user: { select: { user_id: true } } } } } }
      }
    }),
    loadItemReviewDecisionRowsForAssessment(assessment.id)
  ]);
  const decisions = new Map(decisionRows.map((row) => [row.item_public_id, row.decision]));
  const decisionById = new Map(decisionRows.map((row) => [row.item_public_id, row]));
  const stored = profiles.flatMap((profile) => {
    const value = readStoredInterpretationV8(profile.item_level_evidence);
    return value && value.generation_mode !== "fallback"
      ? [{ value, student: profile.concept_unit_session.assessment_session.user.user_id, attempt: profile.concept_unit_session.assessment_session.attempt_number }]
      : [];
  });

  const reviews: FlaggedItemReview[] = [];
  items.forEach((item, index) => {
    const flagged = stored.flatMap((entry) => {
      const rated = entry.value.items.find((candidate) => candidate.item_id === item.item_public_id);
      return rated?.item_review_flag
        ? [{
            student_label: entry.student,
            attempt_number: entry.attempt,
            selected_option: rated.selected_option,
            student_quote: rated.evidence_quote,
            model_rationale: rated.rationale
          }]
        : [];
    });
    if (!flagged.length && !decisions.has(item.item_public_id)) return;
    const withItem = stored.filter((entry) => entry.value.items.some((candidate) => candidate.item_id === item.item_public_id));
    const excluded = new Map(decisions);
    excluded.set(item.item_public_id, "excluded");
    const kept = new Map(decisions);
    kept.set(item.item_public_id, "kept");
    const row = decisionById.get(item.item_public_id) ?? null;
    reviews.push({
      item_public_id: item.item_public_id,
      item_number: index + 1,
      item_stem: item.item_stem,
      options: optionsOf(item.options),
      correct_option: item.correct_option,
      decision: row?.decision ?? null,
      decision_note: row?.note ?? null,
      decided_at: row?.decided_at ? new Date(row.decided_at).toISOString() : null,
      flagged_by: flagged,
      students_with_item: withItem.length,
      labels_pending_review: withItem.filter((entry) =>
        decisionAdjustedTopicSummary(entry.value, decisions).pending_review_item_ids.includes(item.item_public_id) &&
        decisionAdjustedTopicSummary(entry.value, decisions).label === "Pending item review").length,
      labels_that_change_if_excluded: withItem.filter((entry) =>
        decisionAdjustedTopicSummary(entry.value, excluded).label !== decisionAdjustedTopicSummary(entry.value, kept).label).length
    });
  });
  return {
    item_review_version: ITEM_REVIEW_VERSION,
    assessment_public_id: assessment.assessment_public_id,
    assessment_title: assessment.title,
    items: reviews
  };
}
