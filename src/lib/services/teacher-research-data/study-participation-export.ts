import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AttemptObservation, SubmittedItem } from "../teacher-dashboard/attempt-comparison";
import { researchStudentId, studyCodeFromResearchStudentId } from "./pseudonymization";

/**
 * Study-design files of the research dataset (study-participation-dictionary.ts): the loaders
 * read the export scope's students and mini-tests inside the export transaction; the row
 * builders are pure so they can be tested without a database.
 */
type Cell = string | number | boolean | null;
export type StudyRow = Record<string, Cell>;

/** A student in the export scope. user_id and user_db_id are never exported. */
export type StudyScopeStudent = {
  user_db_id: string;
  user_id: string;
  research_student_id: string;
  study_code: string;
  account_status: string;
  created_at: Date;
  created_by_teacher_user_id: string | null;
  creator_user_id: string | null;
};

export type CatalogAssessment = {
  assessment_public_id: string;
  revision_family_public_id: string | null;
  revision_number: number;
  supersedes_assessment_public_id: string | null;
  title: string;
  folder_label: string | null;
  status: string;
  published_at: Date | null;
  release_at: Date | null;
  close_at: Date | null;
  creator_user_id: string;
  topic_count: number;
  published_item_count: number;
};

/** One exported attempt: its attempt_records observation and its conversation turn counts. */
export type ParticipationAttempt = {
  attempt: AttemptObservation;
  conversations: Array<{ student_turns: number; tutor_turns: number }>;
};

export type SummativeOutcomeRecord = {
  user_db_id: string;
  outcome_public_id: string;
  outcome_name: string;
  assessment_date: Date;
  outcome_score: string;
  max_score: string;
  record_status: string;
  revision_number: number;
  supersedes_outcome_public_id: string | null;
  notes: string | null;
  created_at: Date;
};

export type ParticipantFilter = {
  mode: "include_list" | "none";
  requested_count: number;
  matched_count: number;
  unmatched_count: number;
  matched_student_count: number | null;
  list_sha256: string | null;
};

const IDK_OPTION_LABEL = "E";

const iso = (value: Date | null) => value ? value.toISOString() : null;
const round4 = (value: number) => Number(value.toFixed(4));

export function assessmentFamilyId(assessment: { assessment_public_id: string; revision_family_public_id: string | null }) {
  return assessment.revision_family_public_id ?? assessment.assessment_public_id;
}

/** The later of the first publication and the scheduled release, or whichever is recorded. */
export function effectiveReleaseAt(publishedAt: Date | null, releaseAt: Date | null) {
  if (publishedAt && releaseAt) return publishedAt > releaseAt ? publishedAt : releaseAt;
  return publishedAt ?? releaseAt;
}

function releasedBySnapshot(assessment: CatalogAssessment, snapshotAt: Date) {
  if (assessment.status === "published" && (!assessment.release_at || assessment.release_at <= snapshotAt)) return true;
  const effective = effectiveReleaseAt(assessment.published_at, assessment.release_at);
  return assessment.status !== "draft" && effective !== null && effective <= snapshotAt;
}

/** SHA-256 of the distinct normalized codes, sorted and joined by newlines; identifies a list without storing it. */
export function studyCodeListSha256(codes: readonly string[]) {
  return createHash("sha256").update([...new Set(codes)].sort().join("\n")).digest("hex");
}

export function participantFilterSummary(codes: readonly string[] | null, candidates: readonly StudyScopeStudent[]): ParticipantFilter {
  if (!codes) return { mode: "none", requested_count: 0, matched_count: 0, unmatched_count: 0, matched_student_count: null, list_sha256: null };
  const requested = new Set(codes);
  const present = new Set(candidates.map((student) => student.study_code));
  const matched = [...requested].filter((code) => present.has(code)).length;
  return {
    mode: "include_list",
    requested_count: requested.size,
    matched_count: matched,
    unmatched_count: requested.size - matched,
    matched_student_count: candidates.filter((student) => requested.has(student.study_code)).length,
    list_sha256: studyCodeListSha256(codes)
  };
}

export function miniTestCatalog(input: {
  /** Every mini-test the exporting teacher can see (for family-level release times). */
  assessments: readonly CatalogAssessment[];
  /** assessment_public_ids in the export scope; null for whole-class scopes. */
  in_scope: ReadonlySet<string> | null;
  snapshot_at: Date;
  instructor: (userId: string) => string;
}) {
  const familyRelease = new Map<string, Date>();
  for (const assessment of input.assessments) {
    const effective = effectiveReleaseAt(assessment.published_at, assessment.release_at);
    const family = assessmentFamilyId(assessment);
    const current = familyRelease.get(family);
    if (effective && (!current || effective < current)) familyRelease.set(family, effective);
  }
  const releasedFamilies = new Set<string>();
  const rows = input.assessments
    .filter((assessment) => !input.in_scope || input.in_scope.has(assessment.assessment_public_id))
    .map((assessment): StudyRow => {
      const family = assessmentFamilyId(assessment);
      const released = releasedBySnapshot(assessment, input.snapshot_at);
      if (released) releasedFamilies.add(family);
      return {
        assessment_public_id: assessment.assessment_public_id,
        assessment_family_id: family,
        revision_number: assessment.revision_number,
        supersedes_assessment_public_id: assessment.supersedes_assessment_public_id,
        title: assessment.title,
        folder_week_module: assessment.folder_label,
        status: assessment.status,
        published_at: iso(assessment.published_at),
        release_at: iso(assessment.release_at),
        close_at: iso(assessment.close_at),
        effective_release_at: iso(effectiveReleaseAt(assessment.published_at, assessment.release_at)),
        family_effective_release_at: iso(familyRelease.get(family) ?? null),
        released_by_snapshot: released,
        research_instructor_id: input.instructor(assessment.creator_user_id),
        topic_count: assessment.topic_count,
        published_item_count: assessment.published_item_count
      };
    });
  return { rows, released_families: releasedFamilies, family_release: familyRelease };
}

export type MiniTestCatalog = ReturnType<typeof miniTestCatalog>;

const byResearchId = (left: StudyScopeStudent, right: StudyScopeStudent) =>
  left.research_student_id.localeCompare(right.research_student_id);

function attemptsByStudent(attempts: readonly ParticipationAttempt[]) {
  const result = new Map<string, ParticipationAttempt[]>();
  for (const entry of attempts) result.set(entry.attempt.student_key, [...(result.get(entry.attempt.student_key) ?? []), entry]);
  return result;
}

/** Study codes held by more than one of the given students (all students in scope, before the participant filter). */
export function sharedStudyCodes(students: readonly StudyScopeStudent[]) {
  const counts = new Map<string, number>();
  for (const student of students) counts.set(student.study_code, (counts.get(student.study_code) ?? 0) + 1);
  return new Set([...counts].filter(([, total]) => total > 1).map(([code]) => code));
}

export function studentRosterRows(input: {
  students: readonly StudyScopeStudent[];
  shared_codes: ReadonlySet<string>;
  teacher_user_db_id: string;
  attempts: readonly ParticipationAttempt[];
  instructor: (userId: string) => string;
  pseudonym_version: string;
}) {
  const attempts = attemptsByStudent(input.attempts);
  return [...input.students].sort(byResearchId).map((student): StudyRow => {
    const own = attempts.get(student.user_id) ?? [];
    return {
      research_student_id: student.research_student_id,
      study_code: student.study_code,
      study_code_shared: input.shared_codes.has(student.study_code),
      account_status: student.account_status,
      account_created_date: student.created_at.toISOString().slice(0, 10),
      created_by_exporting_teacher: student.created_by_teacher_user_id === input.teacher_user_db_id,
      research_instructor_id: student.creator_user_id ? input.instructor(student.creator_user_id) : null,
      has_any_attempt: own.length > 0,
      has_submitted_attempt: own.some((entry) => entry.attempt.submitted_at !== null),
      research_pseudonym_version: input.pseudonym_version
    };
  });
}

/** A selected answer option; the "I don't know yet" choice (E on an item without its own E) is not an answer. */
function answered(item: SubmittedItem) {
  if (!item.selected_option) return false;
  return !(item.selected_option === IDK_OPTION_LABEL && !item.options.some((option) => option.label === IDK_OPTION_LABEL));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

/** The family's attempt with the earliest initial submission (any version); waived chances count. */
function firstSubmittedByFamily(attempts: readonly ParticipationAttempt[]) {
  const first = new Map<string, AttemptObservation>();
  for (const { attempt } of attempts) {
    if (!attempt.submitted_at) continue;
    const current = first.get(attempt.assessment_family_public_id);
    const earlier = !current || attempt.submitted_at < current.submitted_at! ||
      (attempt.submitted_at === current.submitted_at && (attempt.started_at < current.started_at ||
        (attempt.started_at === current.started_at && attempt.session_public_id < current.session_public_id)));
    if (earlier) first.set(attempt.assessment_family_public_id, attempt);
  }
  return first;
}

export function studentParticipationSummaryRows(input: {
  students: readonly StudyScopeStudent[];
  attempts: readonly ParticipationAttempt[];
  catalog: Pick<MiniTestCatalog, "released_families" | "family_release">;
  include_restricted: boolean;
}) {
  const attempts = attemptsByStudent(input.attempts);
  const released = input.catalog.released_families;
  return [...input.students].sort(byResearchId).map((student): StudyRow => {
    const own = attempts.get(student.user_id) ?? [];
    const submitted = own.filter((entry) => entry.attempt.submitted_at !== null);
    const submissionTimes = submitted.map((entry) => entry.attempt.submitted_at!).sort();
    const firstByFamily = firstSubmittedByFamily(own);
    const firstItems = [...firstByFamily.values()].flatMap((attempt) => attempt.items);
    const administered = firstItems.length;
    const correct = firstItems.filter((item) => item.correctness === "correct").length;
    // Families whose first submission precedes the recorded release (a release time edited later) are left out.
    const releaseIntervals = [...firstByFamily].flatMap(([family, attempt]) => {
      const release = input.catalog.family_release.get(family);
      const interval = release ? new Date(attempt.submitted_at!).getTime() - release.getTime() : null;
      return interval !== null && interval >= 0 ? [interval] : [];
    });
    const conversations = own.flatMap((entry) => entry.conversations);
    return {
      research_student_id: student.research_student_id,
      study_code: student.study_code,
      mini_tests_released: released.size,
      families_started: new Set(own.map((entry) => entry.attempt.assessment_family_public_id)).size,
      families_submitted: firstByFamily.size,
      released_families_submitted: [...firstByFamily.keys()].filter((family) => released.has(family)).length,
      released_completion_proportion: released.size
        ? round4([...firstByFamily.keys()].filter((family) => released.has(family)).length / released.size) : null,
      attempts_total: own.length,
      attempts_submitted: submitted.length,
      first_submission_at: submissionTimes[0] ?? null,
      last_submission_at: submissionTimes.at(-1) ?? null,
      release_to_first_submission_median_ms: median(releaseIntervals),
      release_to_first_submission_family_count: releaseIntervals.length,
      conversations_with_student_turns: conversations.filter((conversation) => conversation.student_turns > 0).length,
      student_conversation_turns: conversations.reduce((total, conversation) => total + conversation.student_turns, 0),
      tutor_conversation_turns: conversations.reduce((total, conversation) => total + conversation.tutor_turns, 0),
      first_attempt_items_administered: administered,
      first_attempt_items_answered: firstItems.filter(answered).length,
      ...(input.include_restricted ? {
        first_attempt_items_correct: correct,
        first_attempt_proportion_correct: administered ? round4(correct / administered) : null
      } : {})
    };
  });
}

export function summativeOutcomeRows(records: readonly SummativeOutcomeRecord[], students: readonly StudyScopeStudent[]) {
  const studentByDbId = new Map(students.map((student) => [student.user_db_id, student]));
  return records.flatMap((record) => {
    const student = studentByDbId.get(record.user_db_id);
    if (!student) return [];
    const score = Number(record.outcome_score);
    const maximum = Number(record.max_score);
    return [{
      research_student_id: student.research_student_id,
      study_code: student.study_code,
      outcome_public_id: record.outcome_public_id,
      outcome_name: record.outcome_name,
      assessment_date: record.assessment_date.toISOString().slice(0, 10),
      outcome_score: record.outcome_score,
      max_score: record.max_score,
      outcome_proportion: maximum ? round4(score / maximum) : null,
      record_status: record.record_status,
      revision_number: record.revision_number,
      supersedes_outcome_public_id: record.supersedes_outcome_public_id,
      has_notes: Boolean(record.notes?.trim()),
      recorded_at: iso(record.created_at)
    } satisfies StudyRow];
  }).sort((left, right) => left.research_student_id.localeCompare(right.research_student_id) ||
    left.outcome_name.localeCompare(right.outcome_name) || left.assessment_date.localeCompare(right.assessment_date) ||
    left.revision_number - right.revision_number || left.outcome_public_id.localeCompare(right.outcome_public_id));
}

/**
 * Students and mini-tests of the export scope, read inside the export transaction. The roster is
 * the exporting teacher's students (users.created_by_teacher_user_id) plus any student with an
 * attempt in scope; selected-student and selected-session scopes keep only that student. The
 * participant filter (study codes) is applied here, before any session is loaded.
 */
export async function loadStudyScope(db: Prisma.TransactionClient, input: {
  teacher_user_db_id: string;
  scope: "all_authorized" | "selected_assessment" | "selected_student" | "selected_session";
  assessment_public_id?: string;
  student_user_id?: string;
  /** The export's session filter without the participant filter. */
  scope_session_where: Prisma.AssessmentSessionWhereInput;
  /** Every session the teacher may export, in any scope. */
  authorized_session_where: Prisma.AssessmentSessionWhereInput;
  include_study_codes: readonly string[] | null;
}) {
  const users = await db.user.findMany({
    where: {
      role: "student",
      user_id: input.student_user_id,
      OR: [
        ...(input.scope === "selected_session" ? [] : [{ created_by_teacher_user_id: input.teacher_user_db_id }]),
        { assessment_sessions: { some: input.scope_session_where } }
      ]
    },
    select: { id: true, user_id: true, account_status: true, created_at: true, created_by_teacher_user_id: true }
  });
  const creatorIds = [...new Set(users.flatMap((user) => user.created_by_teacher_user_id ? [user.created_by_teacher_user_id] : []))];
  const creators = new Map((creatorIds.length
    ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, user_id: true } })
    : []).map((creator) => [creator.id, creator.user_id]));
  const candidates = users.map((user): StudyScopeStudent => {
    const research = researchStudentId(user.user_id);
    return {
      user_db_id: user.id,
      user_id: user.user_id,
      research_student_id: research,
      study_code: studyCodeFromResearchStudentId(research),
      account_status: user.account_status,
      created_at: user.created_at,
      created_by_teacher_user_id: user.created_by_teacher_user_id,
      creator_user_id: user.created_by_teacher_user_id ? creators.get(user.created_by_teacher_user_id) ?? null : null
    };
  });
  const included = input.include_study_codes ? new Set(input.include_study_codes) : null;
  const students = included ? candidates.filter((student) => included.has(student.study_code)) : candidates;

  const assessments = await db.assessment.findMany({
    where: { OR: [{ created_by_user_db_id: input.teacher_user_db_id }, { assessment_sessions: { some: input.authorized_session_where } }] },
    orderBy: [{ folder_order_index: "asc" }, { assessment_order_index: "asc" }, { created_at: "asc" }, { assessment_public_id: "asc" }],
    select: {
      assessment_public_id: true, revision_family_public_id: true, revision_number: true, supersedes_assessment_public_id: true,
      title: true, folder_label: true, status: true, published_at: true, release_at: true, close_at: true,
      created_by: { select: { user_id: true } },
      concept_units: {
        where: { status: "published" },
        select: { items: { where: { status: "published", included_in_published_set: true }, select: { id: true } } }
      }
    }
  });
  const inScope = input.scope === "selected_assessment" && input.assessment_public_id
    ? new Set([input.assessment_public_id])
    : input.scope === "selected_session"
      ? new Set((await db.assessmentSession.findMany({
          where: input.scope_session_where, select: { assessment: { select: { assessment_public_id: true } } }
        })).map((session) => session.assessment.assessment_public_id))
      : null;
  return {
    candidates,
    students,
    participant_filter: participantFilterSummary(input.include_study_codes, candidates),
    in_scope: inScope,
    assessments: assessments.map((assessment): CatalogAssessment => ({
      assessment_public_id: assessment.assessment_public_id,
      revision_family_public_id: assessment.revision_family_public_id,
      revision_number: assessment.revision_number,
      supersedes_assessment_public_id: assessment.supersedes_assessment_public_id,
      title: assessment.title,
      folder_label: assessment.folder_label,
      status: assessment.status,
      published_at: assessment.published_at,
      release_at: assessment.release_at,
      close_at: assessment.close_at,
      creator_user_id: assessment.created_by.user_id,
      topic_count: assessment.concept_units.length,
      published_item_count: assessment.concept_units.reduce((total, unit) => total + unit.items.length, 0)
    }))
  };
}

/** Imported summative outcomes (active and superseded) of the given students; restricted exports only. */
export async function loadSummativeOutcomeRecords(db: Prisma.TransactionClient, students: readonly StudyScopeStudent[]) {
  if (!students.length) return [];
  const records = await db.summativeOutcome.findMany({
    where: { user_db_id: { in: students.map((student) => student.user_db_id) } },
    select: {
      user_db_id: true, outcome_public_id: true, outcome_name: true, assessment_date: true, outcome_score: true,
      max_score: true, record_status: true, revision_number: true, notes: true, created_at: true,
      supersedes_outcome: { select: { outcome_public_id: true } }
    }
  });
  return records.map((record): SummativeOutcomeRecord => ({
    user_db_id: record.user_db_id,
    outcome_public_id: record.outcome_public_id,
    outcome_name: record.outcome_name,
    assessment_date: record.assessment_date,
    outcome_score: String(record.outcome_score),
    max_score: String(record.max_score),
    record_status: record.record_status,
    revision_number: record.revision_number,
    supersedes_outcome_public_id: record.supersedes_outcome?.outcome_public_id ?? null,
    notes: record.notes,
    created_at: record.created_at
  }));
}
