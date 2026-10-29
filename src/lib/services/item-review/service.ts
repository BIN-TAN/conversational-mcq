import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "@/lib/services/content/errors";
import {
  decisionAdjustedTopicSummary,
  readStoredInterpretationV8
} from "@/lib/services/student-assessment/interpretation-v8/profile";
import type { InstructorItemDecision } from "@/lib/services/student-assessment/interpretation-v8/rules";
import { orderLikeAssessmentLibrary } from "@/lib/assessment-library-order";
import { buildInterpretationInputV8FromPackage } from "@/lib/services/student-assessment/interpretation-v8/input-builder";

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
export const ITEM_REVIEW_VERSION = "item-review-decisions-v2" as const;

/**
 * v2: items the feedback tutor flagged as a possible item issue in a student's conversation
 * (FormativeConversationReviewSignal, signal_type feedback_v8_instructor_review, reason_code
 * possible_item_issue) are listed with the profiling flags. The tutor's record has no item field
 * of its own, so a flag is tied to items by tutorFlagItemNumbers. A decision resolves a tutor
 * flag once every item the flag names has a decision made after it; a tutor flag that arrives
 * after the decision on its item asks for the instructor's attention again.
 */
export type TutorItemFlag = {
  signal_public_id: string;
  student_label: string;
  attempt_number: number;
  /** The item numbers the flag names, as the student saw them; empty when it names none. */
  student_item_numbers: number[];
  reason: string | null;
  status: string;
  created_at: string;
  /** Raised with no decision on the item yet, or after its current decision. */
  after_decision: boolean;
};

const FEEDBACK_REVIEW_SIGNAL = "feedback_v8_instructor_review";
const OPEN_SIGNAL_STATUSES: readonly string[] = ["open", "acknowledged"];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Item numbers a text names: "Item 3", "Items 1 and 4", "Question 2", "Q4". */
export function itemNumbersInText(text: string) {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/\b(?:items?|questions?|q)\s*#?\s*(\d+(?:\s*(?:,\s*(?:and|or|&)?|and|or|&)\s*\d+)*)\b/gi)) {
    for (const digits of match[1].match(/\d+/g) ?? []) {
      const number = Number(digits);
      if (number >= 1) numbers.add(number);
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

/**
 * The item numbers (as the student saw them) a tutor flag is about. The prompts ask the tutor to
 * name the item in the reason (from formative-opening-v8.4, formative-conversation-v8.5), so items named
 * there come first. Otherwise: the focus items the student's interpretation also flagged, then
 * the single item that interpretation flagged, then a focus on one item. A flag that fits none of
 * these stays untied to an item rather than being guessed.
 */
export function tutorFlagItemNumbers(evidenceSummary: unknown, interpretationFlaggedNumbers: readonly number[] = []) {
  const summary = asRecord(evidenceSummary);
  const named = itemNumbersInText(typeof summary.reason === "string" ? summary.reason : "");
  if (named.length) return named;
  const focusNumbers = asRecord(summary.focus).item_numbers;
  const focus = [...new Set((Array.isArray(focusNumbers) ? focusNumbers : [])
    .filter((number): number is number => typeof number === "number" && Number.isInteger(number) && number >= 1))]
    .sort((left, right) => left - right);
  const focusFlagged = focus.filter((number) => interpretationFlaggedNumbers.includes(number));
  if (focusFlagged.length) return focusFlagged;
  if (interpretationFlaggedNumbers.length === 1) return [...interpretationFlaggedNumbers];
  if (focus.length === 1) return focus;
  return [];
}

/**
 * The items a tutor flag is about, as item public IDs and as the student's item numbers. The
 * tutor numbers items as the feedback context does (feedback-v8/context.ts): in the order
 * buildInterpretationInputV8FromPackage gives the student's response package, so number n is
 * that list's n-th item. Numbers beyond the package are dropped.
 */
export function itemPublicIdsForTutorFlag(
  evidenceSummary: unknown,
  packagePayload: unknown,
  interpretationFlaggedIds: ReadonlySet<string> = new Set()
) {
  if (!packagePayload) return { item_public_ids: [] as string[], item_numbers: [] as number[] };
  const itemIds = buildInterpretationInputV8FromPackage(packagePayload, new Map()).items.map((item) => item.item_id);
  const flaggedNumbers = itemIds.flatMap((id, index) => interpretationFlaggedIds.has(id) ? [index + 1] : []);
  const numbers = tutorFlagItemNumbers(evidenceSummary, flaggedNumbers).filter((number) => number <= itemIds.length);
  return { item_public_ids: [...new Set(numbers.map((number) => itemIds[number - 1]))], item_numbers: numbers };
}

type TutorFlagSignal = {
  id: string;
  created_at: Date;
  item_public_ids: string[];
  flag: Omit<TutorItemFlag, "after_decision">;
};

/** Tutor flags for possible item issues in one mini test, each with the items it is about. */
async function loadTutorFlagSignals(assessmentDbId: string): Promise<TutorFlagSignal[]> {
  const signals = await prisma.formativeConversationReviewSignal.findMany({
    where: {
      signal_type: FEEDBACK_REVIEW_SIGNAL,
      reason_code: "possible_item_issue",
      formative_conversation_session: { assessment_session: { assessment_db_id: assessmentDbId } }
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      id: true,
      signal_public_id: true,
      status: true,
      created_at: true,
      evidence_summary: true,
      formative_conversation_session: {
        select: {
          initial_student_profile: { select: { item_level_evidence: true } },
          assessment_session: { select: { attempt_number: true, user: { select: { user_id: true } } } }
        }
      }
    }
  });
  const packageIds = [...new Set(signals.flatMap((signal) => {
    const stored = readStoredInterpretationV8(signal.formative_conversation_session.initial_student_profile?.item_level_evidence);
    return stored ? [stored.response_package_id] : [];
  }))];
  const packages = packageIds.length
    ? await prisma.responsePackage.findMany({ where: { id: { in: packageIds } }, select: { id: true, payload: true } })
    : [];
  const payloadByPackage = new Map(packages.map((entry) => [entry.id, entry.payload]));
  return signals.map((signal) => {
    const session = signal.formative_conversation_session;
    const stored = readStoredInterpretationV8(session.initial_student_profile?.item_level_evidence);
    const flaggedIds = new Set((stored?.items ?? []).filter((item) => item.item_review_flag).map((item) => item.item_id));
    const items = stored
      ? itemPublicIdsForTutorFlag(signal.evidence_summary, payloadByPackage.get(stored.response_package_id), flaggedIds)
      : { item_public_ids: [], item_numbers: [] };
    const evidence = asRecord(signal.evidence_summary);
    return {
      id: signal.id,
      created_at: signal.created_at,
      item_public_ids: items.item_public_ids,
      flag: {
        signal_public_id: signal.signal_public_id,
        student_label: session.assessment_session.user.user_id,
        attempt_number: session.assessment_session.attempt_number,
        student_item_numbers: items.item_numbers,
        reason: typeof evidence.reason === "string" ? evidence.reason : null,
        status: signal.status,
        created_at: signal.created_at.toISOString()
      }
    };
  });
}

/** A tutor flag is answered once every item it names has a decision made after the flag. */
function answeredByDecisions(signal: TutorFlagSignal, decidedAt: ReadonlyMap<string, Date>) {
  return signal.item_public_ids.length > 0 &&
    signal.item_public_ids.every((itemId) => (decidedAt.get(itemId)?.getTime() ?? -Infinity) >= signal.created_at.getTime());
}

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
  const [signals, decisionRows] = await Promise.all([
    loadTutorFlagSignals(assessment.id),
    loadItemReviewDecisionRowsForAssessment(assessment.id)
  ]);
  const decidedAt = new Map(decisionRows.map((row) => [row.item_public_id, new Date(row.decided_at)]));
  decidedAt.set(input.item_public_id, new Date());
  // The decision answers the tutor's open flags on this item, unless a flag also names an item
  // that has no decision made after it.
  const answeredSignalIds = signals
    .filter((signal) => OPEN_SIGNAL_STATUSES.includes(signal.flag.status) &&
      signal.item_public_ids.includes(input.item_public_id) && answeredByDecisions(signal, decidedAt))
    .map((signal) => signal.id);
  await prisma.$transaction(async (tx) => {
    if (answeredSignalIds.length) {
      await tx.formativeConversationReviewSignal.updateMany({
        where: { id: { in: answeredSignalIds }, status: { in: ["open", "acknowledged"] } },
        data: { status: "resolved", resolved_at: new Date() }
      });
    }
    await tx.$executeRaw`
      UPDATE item_review_decisions SET superseded_at = NOW()
      WHERE item_db_id = ${item.id}::uuid AND superseded_at IS NULL`;
    await tx.$executeRaw`
      INSERT INTO item_review_decisions (id, decision_public_id, item_db_id, decision, note, decided_by_user_db_id, decided_at)
      VALUES (${randomUUID()}::uuid, ${decisionPublicId}, ${item.id}::uuid, ${input.decision}::"ItemReviewDecisionType",
        ${note}, ${input.teacher_user_db_id}::uuid, NOW())`;
  });
  awaitingReviewCache.delete(input.teacher_user_db_id);
  return { decision_public_id: decisionPublicId, item_public_id: input.item_public_id, decision: input.decision, note };
}

export type FlaggedItemReview = {
  item_public_id: string;
  /** The item's number in the published set, as students saw it; null when it is not in that set. */
  item_number: number | null;
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
  /** Flags from the feedback tutor in students' conversations (v2). */
  tutor_flags: TutorItemFlag[];
  /** No decision yet on a flagged item, or an open tutor flag arrived after the decision. */
  awaiting_decision: boolean;
  students_with_item: number;
  labels_pending_review: number;
  labels_that_change_if_excluded: number;
};

const record = asRecord;

function optionsOf(value: unknown) {
  return (Array.isArray(value) ? value : []).map(record).flatMap((entry) =>
    typeof entry.label === "string" && typeof entry.text === "string" ? [{ label: entry.label, text: entry.text }] : []
  );
}

/** Items flagged by the profiling model in this mini test, with what a decision would change. */
export async function listItemReviews(input: { teacher_user_db_id: string; assessment_public_id: string }) {
  const assessment = await ownedAssessment(input.teacher_user_db_id, input.assessment_public_id);
  const [items, profiles, decisionRows, tutorSignals] = await Promise.all([
    prisma.item.findMany({
      where: { concept_unit: { assessment_db_id: assessment.id }, status: { not: "archived" } },
      orderBy: [{ item_order: "asc" }],
      select: { item_public_id: true, item_order: true, item_stem: true, options: true, correct_option: true, included_in_published_set: true }
    }),
    prisma.studentProfile.findMany({
      where: { profile_type: "initial", concept_unit_session: { assessment_session: { assessment_db_id: assessment.id } } },
      select: {
        item_level_evidence: true,
        concept_unit_session: { select: { assessment_session: { select: { attempt_number: true, user: { select: { user_id: true } } } } } }
      }
    }),
    loadItemReviewDecisionRowsForAssessment(assessment.id),
    loadTutorFlagSignals(assessment.id)
  ]);
  const decisions = new Map(decisionRows.map((row) => [row.item_public_id, row.decision]));
  const decisionById = new Map(decisionRows.map((row) => [row.item_public_id, row]));
  // Students see the items in the published set, numbered in item order.
  const publishedNumber = new Map(items.filter((item) => item.included_in_published_set)
    .map((item, index) => [item.item_public_id, index + 1]));
  const signalsByItem = new Map<string, TutorFlagSignal[]>();
  for (const signal of tutorSignals) {
    for (const itemId of signal.item_public_ids) signalsByItem.set(itemId, [...(signalsByItem.get(itemId) ?? []), signal]);
  }
  const stored = profiles.flatMap((profile) => {
    const value = readStoredInterpretationV8(profile.item_level_evidence);
    return value && value.generation_mode !== "fallback"
      ? [{ value, student: profile.concept_unit_session.assessment_session.user.user_id, attempt: profile.concept_unit_session.assessment_session.attempt_number }]
      : [];
  });

  const reviews: FlaggedItemReview[] = [];
  items.forEach((item) => {
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
    const row = decisionById.get(item.item_public_id) ?? null;
    const decidedAt = row ? new Date(row.decided_at).getTime() : null;
    const tutorFlags: TutorItemFlag[] = (signalsByItem.get(item.item_public_id) ?? []).map((signal) => ({
      ...signal.flag,
      after_decision: decidedAt === null || signal.created_at.getTime() > decidedAt
    }));
    if (!flagged.length && !tutorFlags.length && !decisions.has(item.item_public_id)) return;
    const withItem = stored.filter((entry) => entry.value.items.some((candidate) => candidate.item_id === item.item_public_id));
    const excluded = new Map(decisions);
    excluded.set(item.item_public_id, "excluded");
    const kept = new Map(decisions);
    kept.set(item.item_public_id, "kept");
    reviews.push({
      item_public_id: item.item_public_id,
      item_number: publishedNumber.get(item.item_public_id) ?? null,
      item_stem: item.item_stem,
      options: optionsOf(item.options),
      correct_option: item.correct_option,
      decision: row?.decision ?? null,
      decision_note: row?.note ?? null,
      decided_at: row?.decided_at ? new Date(row.decided_at).toISOString() : null,
      flagged_by: flagged,
      tutor_flags: tutorFlags,
      awaiting_decision: (!row && (flagged.length > 0 || tutorFlags.length > 0)) ||
        (row !== null && tutorFlags.some((flag) => flag.after_decision && OPEN_SIGNAL_STATUSES.includes(flag.status))),
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
    items: reviews,
    /** Tutor flags that name no item of this mini test; shown for reading, not decided. */
    untied_tutor_flags: tutorSignals.filter((signal) => !signal.item_public_ids.length)
      .map((signal): TutorItemFlag => ({ ...signal.flag, after_decision: true }))
  };
}

/**
 * Mini tests of this instructor with items awaiting a review decision (profiling or tutor
 * flags), for the instructor home page. Only mini tests where a profile flags an item or the
 * tutor flagged a possible item issue are reviewed in full, and the result is kept for a
 * minute per instructor (cleared by a decision) so the home page stays light.
 */
type AwaitingReview = Array<{ assessment_public_id: string; title: string; items_awaiting: number }>;
const AWAITING_REVIEW_TTL_MS = 60_000;
const awaitingReviewCache = new Map<string, { at: number; value: AwaitingReview }>();

export async function listItemsAwaitingReview(input: { teacher_user_db_id: string }): Promise<AwaitingReview> {
  const cached = awaitingReviewCache.get(input.teacher_user_db_id);
  if (cached && Date.now() - cached.at < AWAITING_REVIEW_TTL_MS) return cached.value;
  const owned = { created_by_user_db_id: input.teacher_user_db_id, status: { not: "archived" as const } };
  const [profileFlags, tutorFlags] = await Promise.all([
    prisma.studentProfile.findMany({
      where: {
        profile_type: "initial",
        item_level_evidence: { path: ["items"], array_contains: [{ item_review_flag: true }] },
        concept_unit_session: { assessment_session: { assessment: owned } }
      },
      select: { concept_unit_session: { select: { assessment_session: { select: { assessment_db_id: true } } } } }
    }),
    prisma.formativeConversationReviewSignal.findMany({
      where: {
        signal_type: FEEDBACK_REVIEW_SIGNAL,
        reason_code: "possible_item_issue",
        formative_conversation_session: { assessment_session: { assessment: owned } }
      },
      select: { formative_conversation_session: { select: { assessment_session: { select: { assessment_db_id: true } } } } }
    })
  ]);
  const candidateIds = [...new Set([
    ...profileFlags.map((entry) => entry.concept_unit_session.assessment_session.assessment_db_id),
    ...tutorFlags.map((entry) => entry.formative_conversation_session.assessment_session.assessment_db_id)
  ])];
  const assessments = candidateIds.length
    ? await prisma.assessment.findMany({
        where: { id: { in: candidateIds }, ...owned },
        select: { assessment_public_id: true, title: true, folder_label: true, folder_order_index: true, assessment_order_index: true, status: true }
      })
    : [];
  const results: AwaitingReview = [];
  for (const assessment of orderLikeAssessmentLibrary(assessments)) {
    const review = await listItemReviews({ teacher_user_db_id: input.teacher_user_db_id, assessment_public_id: assessment.assessment_public_id });
    const awaiting = review.items.filter((item) => item.awaiting_decision).length;
    if (awaiting) results.push({ assessment_public_id: assessment.assessment_public_id, title: assessment.title, items_awaiting: awaiting });
  }
  awaitingReviewCache.set(input.teacher_user_db_id, { at: Date.now(), value: results });
  return results;
}
