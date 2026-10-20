import type { V8ColumnDoc } from "./interpretation-v8-dictionary";

/**
 * Study-design files of the research dataset (dissertation RQ3/RQ5): the catalog of mini-tests
 * in scope, the student roster (the denominator for participation, including students with no
 * attempts), one participation summary row per roster student and, in restricted exports only,
 * pseudonymized summative outcomes. This module holds the file layouts and the dictionary text;
 * the rows are built in study-participation-export.ts and every column is documented in
 * research_data_dictionary.csv through dictionary.ts.
 */
export const STUDY_PARTICIPATION_EXPORT_VERSION = "study-participation-export-v1" as const;

export const STUDY_PARTICIPATION_TABLES = [
  "mini_test_catalog",
  "student_roster",
  "student_participation_summary",
  "summative_outcomes"
] as const;
export type StudyParticipationTable = (typeof STUDY_PARTICIPATION_TABLES)[number];

/** Produced only in restricted exports (include_restricted_fields true). */
export const STUDY_PARTICIPATION_RESTRICTED_TABLES: readonly StudyParticipationTable[] = ["summative_outcomes"];
/** Restricted columns inside default study files (same policy as item_responses.correctness). */
export const STUDY_PARTICIPATION_RESTRICTED_COLUMNS = ["first_attempt_items_correct", "first_attempt_proportion_correct"] as const;

export const MINI_TEST_CATALOG_COLUMNS = [
  "assessment_public_id",
  "assessment_family_id",
  "revision_number",
  "supersedes_assessment_public_id",
  "title",
  "folder_week_module",
  "status",
  "published_at",
  "release_at",
  "close_at",
  "effective_release_at",
  "family_effective_release_at",
  "released_by_snapshot",
  "research_instructor_id",
  "topic_count",
  "published_item_count"
] as const;

export const STUDENT_ROSTER_COLUMNS = [
  "research_student_id",
  "study_code",
  "study_code_shared",
  "account_status",
  "account_created_date",
  "created_by_exporting_teacher",
  "research_instructor_id",
  "has_any_attempt",
  "has_submitted_attempt",
  "research_pseudonym_version"
] as const;

export const STUDENT_PARTICIPATION_SUMMARY_COLUMNS = [
  "research_student_id",
  "study_code",
  "mini_tests_released",
  "families_started",
  "families_submitted",
  "released_families_submitted",
  "released_completion_proportion",
  "attempts_total",
  "attempts_submitted",
  "first_submission_at",
  "last_submission_at",
  "release_to_first_submission_median_ms",
  "release_to_first_submission_family_count",
  "conversations_with_student_turns",
  "student_conversation_turns",
  "tutor_conversation_turns",
  "first_attempt_items_administered",
  "first_attempt_items_answered",
  "first_attempt_items_correct",
  "first_attempt_proportion_correct"
] as const;

export const SUMMATIVE_OUTCOMES_COLUMNS = [
  "research_student_id",
  "study_code",
  "outcome_public_id",
  "outcome_name",
  "assessment_date",
  "outcome_score",
  "max_score",
  "outcome_proportion",
  "record_status",
  "revision_number",
  "supersedes_outcome_public_id",
  "has_notes",
  "recorded_at"
] as const;

export const STUDY_PARTICIPATION_TABLE_COLUMNS: Record<StudyParticipationTable, readonly string[]> = {
  mini_test_catalog: MINI_TEST_CATALOG_COLUMNS,
  student_roster: STUDENT_ROSTER_COLUMNS,
  student_participation_summary: STUDENT_PARTICIPATION_SUMMARY_COLUMNS,
  summative_outcomes: SUMMATIVE_OUTCOMES_COLUMNS
};

export const STUDY_PARTICIPATION_MEASUREMENT_LEVELS: Record<StudyParticipationTable, string> = {
  mini_test_catalog: "assessment_version",
  student_roster: "student",
  student_participation_summary: "student",
  summative_outcomes: "summative_outcome_record"
};

export const STUDY_PARTICIPATION_ROW_FUNCTIONS: Record<StudyParticipationTable, string> = {
  mini_test_catalog: "miniTestCatalogRows",
  student_roster: "studentRosterRows",
  student_participation_summary: "studentParticipationSummaryRows",
  summative_outcomes: "summativeOutcomeRows"
};

export const STUDY_PARTICIPATION_NOT_APPLICABLE: Record<StudyParticipationTable, string> = {
  mini_test_catalog: "Every mini-test version in scope has a row; a value is blank when the version does not have it (for example no release time or no corrected predecessor).",
  student_roster: "Every student in scope has a row, including students with no attempts; a value is blank only when the account does not record it.",
  student_participation_summary: "Every roster student has a row, including students with no attempts (counts 0, times blank).",
  summative_outcomes: "Restricted exports only; students without imported outcomes have no rows."
};

export const STUDY_PARTICIPATION_ATTEMPT_POLICY: Record<StudyParticipationTable, string> = {
  mini_test_catalog: "Not attempt-level: one row per mini-test version; attempts join through assessment_public_id or assessment_family_id.",
  student_roster: "Not attempt-level: one row per student.",
  student_participation_summary: "Student-level aggregate of the attempts in this export (include_incomplete_sessions and the participant filter apply). First-attempt columns use the first submitted attempt in each family only; later attempts are never merged into them.",
  summative_outcomes: "Not attempt-level: one row per imported outcome record (active and superseded revisions)."
};

/** Lines for the bundle README (analysis-ready-export.ts). */
export const STUDY_PARTICIPATION_README_LINES = [
  "Study design files (" + STUDY_PARTICIPATION_EXPORT_VERSION + "): mini_test_catalog.csv lists every mini-test version in scope (whole-class exports: all of the teacher's mini-tests, including archived and superseded versions, with status, publication, release and close times and effective_release_at); student_roster.csv lists every student in scope, including students with no attempts, with study_code (XXXX-XXXX, the code students enter in the consent form and the course-end questionnaire); student_participation_summary.csv has one row per roster student (released mini-tests, families started and submitted, completion proportion, attempts, submission times, release-to-submission time, conversation turns and first-attempt item counts). Every column is in research_data_dictionary.csv.",
  "Restricted exports only: summative_outcomes.csv (imported exam scores and grades by research_student_id and study_code; no names, user IDs or note text) and the first_attempt_items_correct and first_attempt_proportion_correct columns of student_participation_summary.csv.",
  "Join study files to attempt files by research_student_id, and mini-tests by assessment_public_id or assessment_family_id (= assessment_family_public_id elsewhere). Questionnaire and consent records join by study_code; check student_roster.study_code_shared first, because two students can share a code."
] as const;

export type StudyColumnDoc = V8ColumnDoc & { aggregation?: string; zero?: string; missing?: string };

const PARTICIPATION = { category: "Session and participation variables", research_category_id: "session_and_participation" } as const;
const CONTEXT = { category: "Assessment design and content", research_category_id: "assessment_and_item_context" } as const;
const IDENTIFIER = { category: "Session and participation variables", research_category_id: "research_identifiers_and_joins" } as const;
const OUTCOME = { category: "Outcome and scoring data", research_category_id: "transfer_and_outcomes" } as const;
const COUNT = { data_type: "integer", unit: "count", source_nature: "aggregate_derived" } as const;
const SUMMARY_ATTEMPTS = "Computed by studentParticipationSummaryRows from the exported attempts (the same AttemptObservation records as attempt_records.csv)";
const SUMMARY_CONVERSATIONS = "Computed by studentParticipationSummaryRows from the same conversation turns as formative_conversation_turns.csv (student and tutor turns with message text)";

function pointTimestamp(what: string) {
  return {
    construct: "point_in_time_record_timestamp",
    start: "not applicable: point-in-time timestamp",
    end: "not applicable: point-in-time timestamp",
    formula: `Copy the stored ${what} timestamp; not a duration.`,
    idle: "Not applicable: a point-in-time timestamp has no interval.",
    hidden: "Not applicable: a point-in-time timestamp has no interval."
  };
}

const recorded = (definition: string, method: string, extra: Partial<StudyColumnDoc> = {}): StudyColumnDoc => ({
  definition, method, source_nature: "directly_recorded", ...extra
});
const derived = (definition: string, method: string, extra: Partial<StudyColumnDoc> = {}): StudyColumnDoc => ({
  definition, method, source_nature: "deterministic_derived", ...extra
});
const count = (definition: string, method: string, extra: Partial<StudyColumnDoc> = {}): StudyColumnDoc => ({
  definition, method, ...COUNT, ...PARTICIPATION,
  zero: "Zero is an observed value: the student had none of the counted records in this export.", ...extra
});

const SHARED: Record<string, StudyColumnDoc> = {
  research_student_id: derived(
    "Pseudonymous student join key, the same value as research_student_id in sessions.csv, attempt_records.csv and every other student-level file; not the login name, email or database ID.",
    "Computed by researchStudentId() (pseudonymization.ts) from the student's account user_id with the server-side HMAC key.",
    { ...IDENTIFIER, privacy: "pseudonymous_research_id" }
  ),
  study_code: derived(
    "Short study code the student sees and enters in the consent form and the course-end questionnaire: the first eight hexadecimal characters of research_student_id (after rs_), upper-cased, as XXXX-XXXX. Links consent and questionnaire records to export rows without names. Codes are short (32 bits), so two students can share one: check student_roster.study_code_shared.",
    "Computed by studyCodeFromResearchStudentId(research_student_id) in pseudonymization.ts.",
    { ...IDENTIFIER, privacy: "pseudonymous_research_id", allowed_values: "XXXX-XXXX with hexadecimal digits 0-9 and A-F" }
  ),
  research_instructor_id: derived(
    "Pseudonymous teacher identifier (ri_ prefix): same key and version as research_student_id, separate namespace, so a teacher and a student never share a pseudonym.",
    "Computed by researchInstructorId() (pseudonymization.ts) from the teacher's account user_id.",
    { ...IDENTIFIER, privacy: "pseudonymous_research_id" }
  )
};

const TABLE_DOCS: Record<StudyParticipationTable, Record<string, StudyColumnDoc>> = {
  mini_test_catalog: {
    assessment_public_id: recorded(
      "Public identifier of the mini-test version (one Assessment row); join key to sessions.csv, attempt_records.csv, assessment_content.csv and item_review_decisions.csv.",
      "Copied from Assessment.assessment_public_id.", IDENTIFIER),
    assessment_family_id: derived(
      "Revision family of the mini-test: the original version's assessment_public_id, shared by its corrected versions. Equals assessment_family_public_id in sessions.csv and attempt_records.csv; the three-attempt limit and the families_* counts of student_participation_summary.csv use this key.",
      "Computed as Assessment.revision_family_public_id when set, otherwise Assessment.assessment_public_id (the same rule as attempt-chances.ts assessmentFamily).", IDENTIFIER),
    revision_number: recorded(
      "Version number within the family: 1 for the original version; each corrected version adds 1.",
      "Copied from Assessment.revision_number.", { ...CONTEXT, data_type: "integer", unit: "version number" }),
    supersedes_assessment_public_id: recorded(
      "assessment_public_id of the version this corrected version replaced; blank for an original version.",
      "Copied from Assessment.supersedes_assessment_public_id.", IDENTIFIER),
    title: recorded(
      "Teacher-authored mini-test title at the export snapshot. A corrected version can keep its predecessor's title: join by assessment_public_id, never by title.",
      "Copied from Assessment.title.", CONTEXT),
    folder_week_module: recorded(
      "Teacher-entered folder label (week or module) under which the mini-test is listed; blank when none was entered.",
      "Copied from Assessment.folder_label.", CONTEXT),
    status: recorded(
      "Publication status at the export snapshot: draft (never offered to students), published (offered to students within its release window) or archived (withdrawn or superseded by a corrected version; attempts and evidence are kept).",
      "Copied from Assessment.status.", { ...CONTEXT, allowed_values: "draft; published; archived" }),
    published_at: recorded(
      "First time this mini-test version was published. Blank for drafts and for versions published before the research-data release (CMCQ-20261020-02), when publication time was not recorded; record those release dates by hand.",
      "Copied from Assessment.published_at, set once by the publishing service at the first publication and never changed by later edits.",
      { research_category_id: CONTEXT.research_category_id, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: pointTimestamp("first publication") }),
    release_at: recorded(
      "Teacher-scheduled release time (start of availability) at the export snapshot; blank when no release time was set (available as soon as published). A later edit replaces an earlier schedule.",
      "Copied from Assessment.release_at.",
      { research_category_id: CONTEXT.research_category_id, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: pointTimestamp("scheduled release") }),
    close_at: recorded(
      "Teacher-scheduled close time (end of availability) at the export snapshot; blank when the mini-test has no closing time.",
      "Copied from Assessment.close_at.",
      { research_category_id: CONTEXT.research_category_id, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: pointTimestamp("scheduled close") }),
    effective_release_at: derived(
      "Time this version became available to students: the later of published_at and release_at when both exist, otherwise whichever exists; blank when neither is recorded (a version published before the research-data release CMCQ-20261020-02 without a scheduled release time).",
      "Computed by miniTestCatalogRows from published_at and release_at of the same row.",
      { research_category_id: CONTEXT.research_category_id, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: {
        construct: "effective_release_timestamp", start: "not applicable: point-in-time timestamp", end: "not applicable: point-in-time timestamp",
        formula: "The later of published_at and release_at when both are present; otherwise the one present; blank when neither.",
        idle: "Not applicable: a point-in-time timestamp has no interval.", hidden: "Not applicable: a point-in-time timestamp has no interval."
      } }),
    family_effective_release_at: derived(
      "Earliest effective_release_at among all versions of the family (assessment_family_id) that the exporting teacher can see, in or out of this export's scope: when the mini-test was first available in any version. Blank when no version has one. Used for release_to_first_submission_median_ms.",
      "Computed by miniTestCatalogRows as the minimum effective_release_at over the family's versions.",
      { research_category_id: CONTEXT.research_category_id, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: {
        construct: "family_first_availability_timestamp", start: "not applicable: point-in-time timestamp", end: "not applicable: point-in-time timestamp",
        formula: "Minimum effective_release_at over the versions of the same assessment_family_id; blank when none is present.",
        idle: "Not applicable: a point-in-time timestamp has no interval.", hidden: "Not applicable: a point-in-time timestamp has no interval."
      } }),
    released_by_snapshot: derived(
      "true when this version had been released to students by the export snapshot: status published with no release time or a release time at or before the snapshot, or status published or archived with effective_release_at at or before the snapshot. false for drafts, releases scheduled after the snapshot and archived versions with no recorded release time. A family counts as released (mini_tests_released) when any of its versions is.",
      "Computed by miniTestCatalogRows from status, release_at and effective_release_at against the database snapshot time.",
      { ...CONTEXT, data_type: "boolean", allowed_values: "true; false" }),
    research_instructor_id: { ...SHARED.research_instructor_id, definition: `${SHARED.research_instructor_id.definition} Here: the teacher who created the mini-test.`, method: "Computed by researchInstructorId() from the user_id of Assessment.created_by." },
    topic_count: count(
      "Number of published topics (concept units with status published) in this version. The design administers one topic per mini-test; a version with another count is not offered for new attempts.",
      "Count of the version's ConceptUnit rows with status published, the topics assessment-availability/availability.ts administers.",
      { ...CONTEXT, zero: "Zero means the version has no published topic (for example a draft)." }),
    published_item_count: count(
      "Number of items the version administers: items with status published that are in the published set, across its published topics.",
      "Count of Item rows with status published and included_in_published_set true in the version's published concept units (as in availability.ts).",
      { ...CONTEXT, zero: "Zero means the version has no administrable item (for example a draft)." })
  },
  student_roster: {
    study_code_shared: derived(
      "true when another student in this export's scope (before the participant filter) has the same study_code. Such a code cannot identify one student in consent or questionnaire records, and an include list containing it includes every student with that code; resolve these cases before analysis. false otherwise.",
      "Computed by studentRosterRows by counting study codes over every student in scope before the participant filter is applied.",
      { ...IDENTIFIER, data_type: "boolean", allowed_values: "true; false" }),
    account_status: recorded(
      "Account status at the export snapshot: active, or inactive (deactivated by the teacher). Inactive accounts keep their attempts and stay on the roster.",
      "Copied from User.account_status.", { ...PARTICIPATION, allowed_values: "active; inactive" }),
    account_created_date: derived(
      "UTC date (YYYY-MM-DD) on which the student account was created. Date only, so the time of day cannot help re-identify a student. A student whose account was created after a mini-test's release could not attempt it before that date.",
      "Date part (UTC) of User.created_at, computed by studentRosterRows.",
      { ...PARTICIPATION, data_type: "date", unit: "ISO 8601 date (UTC)" }),
    created_by_exporting_teacher: derived(
      "true when the exporting teacher created the account (the class roster, used as the participation denominator); false for a student created by someone else who appears only through attempts on the exporting teacher's mini-tests.",
      "Computed by studentRosterRows: User.created_by_teacher_user_id equals the exporting teacher.",
      { ...PARTICIPATION, data_type: "boolean", allowed_values: "true; false" }),
    research_instructor_id: { ...SHARED.research_instructor_id, definition: `${SHARED.research_instructor_id.definition} Here: the teacher who created the student account; blank when the account records none.`, method: "Computed by researchInstructorId() from the user_id of the account in User.created_by_teacher_user_id." },
    has_any_attempt: derived(
      "true when at least one of the student's attempts is in this export (rows in sessions.csv); false for students who never started a mini-test in scope.",
      "Computed by studentRosterRows from the exported attempts (include_incomplete_sessions applies).",
      { ...PARTICIPATION, data_type: "boolean", allowed_values: "true; false" }),
    has_submitted_attempt: derived(
      "true when at least one exported attempt has a full sealed initial submission (initial_submitted_at present in attempt_records.csv), whether or not the student chose Finish.",
      "Computed by studentRosterRows from the same AttemptObservation records as attempt_records.csv.",
      { ...PARTICIPATION, data_type: "boolean", allowed_values: "true; false" }),
    research_pseudonym_version: {
      definition: "Version of the pseudonymization algorithm that produced research_student_id and study_code in this export.",
      method: "Copied from researchPseudonymizationMetadata() at export time.",
      source_nature: "system_configuration", category: "Export, provenance, and versioning data", research_category_id: "research_identifiers_and_joins",
      allowed_values: "hmac_sha256_v1; legacy_sha256_v1"
    }
  },
  student_participation_summary: {
    mini_tests_released: count(
      "Number of distinct mini-test families (assessment_family_id) in mini_test_catalog.csv with at least one version released by the export snapshot (released_by_snapshot true): the denominator of released_completion_proportion. The same for every student; it does not consider when the account was created (see student_roster.account_created_date).",
      "Computed by studentParticipationSummaryRows from the catalog rows of this export.",
      { zero: "Zero means no mini-test in scope had been released by the snapshot." }),
    families_started: count(
      "Number of distinct mini-test families in which the student has at least one exported attempt, on any version, submitted or not.",
      `${SUMMARY_ATTEMPTS}: distinct assessment_family_public_id.`),
    families_submitted: count(
      "Number of distinct mini-test families in which at least one exported attempt has a full sealed initial submission (initial_submitted_at present in attempt_records.csv), whether or not the student chose Finish.",
      `${SUMMARY_ATTEMPTS}: distinct families with a submitted attempt.`),
    released_families_submitted: count(
      "families_submitted counted over released families only (those counted in mini_tests_released): the numerator of released_completion_proportion.",
      `${SUMMARY_ATTEMPTS}, restricted to families with a released version in mini_test_catalog.csv.`),
    released_completion_proportion: derived(
      "Completion proportion of released mini-tests: released_families_submitted divided by mini_tests_released, rounded to 4 decimals; blank when mini_tests_released is 0.",
      "Computed by studentParticipationSummaryRows from the two counts of the same row.",
      { ...PARTICIPATION, data_type: "decimal", unit: "proportion (0 to 1)", formula: "released_families_submitted divided by mini_tests_released; blank when the denominator is 0.",
        zero: "Zero means no released mini-test was submitted." }),
    attempts_total: count(
      "Number of the student's attempts in this export (rows in sessions.csv); repeated attempts on a mini-test are counted separately.",
      `${SUMMARY_ATTEMPTS}.`),
    attempts_submitted: count(
      "Number of exported attempts with a full sealed initial submission (initial_submitted_at present in attempt_records.csv).",
      `${SUMMARY_ATTEMPTS}.`),
    first_submission_at: derived(
      "Earliest initial submission time across the student's exported attempts (attempt_records.csv initial_submitted_at); blank when no attempt was submitted.",
      `${SUMMARY_ATTEMPTS}: minimum submission time.`,
      { ...PARTICIPATION, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: pointTimestamp("initial package submission") }),
    last_submission_at: derived(
      "Latest initial submission time across the student's exported attempts (attempt_records.csv initial_submitted_at); blank when no attempt was submitted.",
      `${SUMMARY_ATTEMPTS}: maximum submission time.`,
      { ...PARTICIPATION, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: pointTimestamp("initial package submission") }),
    release_to_first_submission_median_ms: derived(
      "Median, across the student's families with a submitted attempt and a known family_effective_release_at, of the time from the family's first availability to the student's first initial submission in that family (any version). Negative when a release time was changed after the student submitted. Blank when no family qualifies.",
      `${SUMMARY_ATTEMPTS} and mini_test_catalog.csv family_effective_release_at.`,
      { ...PARTICIPATION, research_category_id: "timing_and_interaction", category: "Timing and interaction data", data_type: "integer", unit: "milliseconds",
        aggregation: "Median over qualifying families (mean of the two middle values for an even count).",
        zero: "Zero means the first submission was recorded at the release time.",
        caution: "A calendar interval that includes all time before the student opened the mini-test; not time on task, effort or procrastination by itself.",
        timing: {
          construct: "release_to_first_submission_latency",
          start: "mini_test_catalog family_effective_release_at",
          end: "the student's first initial submission in the family",
          formula: "Median over qualifying families of the first submission time minus family_effective_release_at, in milliseconds.",
          idle: "Includes all time before and between the student's visits; not active time.",
          hidden: "Not applicable: a calendar interval, not an on-page duration."
        } }),
    release_to_first_submission_family_count: count(
      "Number of families contributing to release_to_first_submission_median_ms (a submitted attempt and a known family_effective_release_at).",
      `${SUMMARY_ATTEMPTS}.`),
    conversations_with_student_turns: count(
      "Number of the student's learning conversations with at least one student message (rows of formative_conversation_sessions.csv with student_formative_turn_count above 0).",
      `${SUMMARY_CONVERSATIONS}.`),
    student_conversation_turns: count(
      "Number of student messages across the student's learning conversations: the sum of student_formative_turn_count in formative_conversation_sessions.csv (rows of formative_conversation_turns.csv with actor_type student).",
      `${SUMMARY_CONVERSATIONS}.`),
    tutor_conversation_turns: count(
      "Number of tutor messages across the student's learning conversations, opening messages included (rows of formative_conversation_turns.csv with actor_type agent).",
      `${SUMMARY_CONVERSATIONS}.`),
    first_attempt_items_administered: count(
      "Items in the sealed initial packages of the student's first submitted attempt in each family, summed across families. The first submitted attempt is the family's attempt with the earliest initial submission, on any version; waived chances are counted. Later attempts are never added.",
      `${SUMMARY_ATTEMPTS}: response_count of attempt_records.csv for each family's first submitted attempt.`),
    first_attempt_items_answered: count(
      "Items among first_attempt_items_administered with a selected answer option in the sealed initial package. The \"I don't know yet\" choice (option E on an item without its own option E) and items with no selection are not counted.",
      `${SUMMARY_ATTEMPTS}: the selected options of attempt_submission_items.csv for those attempts.`),
    first_attempt_items_correct: count(
      "Restricted. Items among first_attempt_items_administered whose sealed initial correctness is correct (the selected option matches the session-bound key).",
      `${SUMMARY_ATTEMPTS}: the correctness of attempt_submission_items.csv for those attempts. Omitted from default exports, like item_responses.correctness.`,
      { ...OUTCOME, caution: "Restricted scoring context: a single first-attempt score on a few items, not a stable ability estimate." }),
    first_attempt_proportion_correct: derived(
      "Restricted. first_attempt_items_correct divided by first_attempt_items_administered, rounded to 4 decimals; blank when no item was administered. \"I don't know yet\" and unanswered items count as not correct.",
      "Computed by studentParticipationSummaryRows. Omitted from default exports, like item_responses.correctness.",
      { ...OUTCOME, data_type: "decimal", unit: "proportion (0 to 1)",
        formula: "first_attempt_items_correct divided by first_attempt_items_administered; blank when the denominator is 0.",
        zero: "Zero means no first-attempt item was answered correctly.",
        caution: "Restricted scoring context: a single first-attempt score on a few items, not a stable ability estimate." })
  },
  summative_outcomes: {
    outcome_public_id: recorded(
      "Public identifier of the summative outcome record: one row per student, outcome name, date and revision.",
      "Copied from SummativeOutcome.outcome_public_id.", IDENTIFIER),
    outcome_name: recorded(
      "Teacher-entered name of the summative outcome as imported (for example a midterm, the final exam or the final grade).",
      "Copied from SummativeOutcome.outcome_name.", { ...OUTCOME, source_nature: "teacher_authored" }),
    assessment_date: recorded(
      "Date of the summative assessment as imported (YYYY-MM-DD).",
      "Copied from SummativeOutcome.assessment_date (a date without time).", { ...OUTCOME, source_nature: "externally_imported", data_type: "date", unit: "ISO 8601 date" }),
    outcome_score: recorded(
      "Score obtained, as imported (up to two decimal places).",
      "Copied from SummativeOutcome.outcome_score.", { ...OUTCOME, source_nature: "externally_imported", data_type: "decimal", unit: "points on the outcome's own scale (see max_score)",
        zero: "Zero is an imported score of zero, not a missing score." }),
    max_score: recorded(
      "Maximum possible score of the outcome, as imported.",
      "Copied from SummativeOutcome.max_score (Decimal with two places).", { ...OUTCOME, source_nature: "externally_imported", data_type: "decimal", unit: "points" }),
    outcome_proportion: derived(
      "outcome_score divided by max_score, rounded to 4 decimals; blank when max_score is 0.",
      "Computed by summativeOutcomeRows from outcome_score and max_score of the same record.",
      { ...OUTCOME, data_type: "decimal", unit: "proportion of the maximum score", formula: "outcome_score divided by max_score; blank when the denominator is 0.",
        zero: "Zero means a score of zero." }),
    record_status: recorded(
      "active for the current record; superseded for an earlier value replaced by a correction (kept for audit). Analyse active rows.",
      "Copied from SummativeOutcome.record_status.", { ...OUTCOME, source_nature: "system_configuration", allowed_values: "active; superseded" }),
    revision_number: recorded(
      "1 for the first import of the outcome; each replacement adds 1.",
      "Copied from SummativeOutcome.revision_number.", { ...OUTCOME, source_nature: "system_configuration", data_type: "integer", unit: "version number" }),
    supersedes_outcome_public_id: recorded(
      "outcome_public_id of the record this one replaced; blank for a first import.",
      "Copied from outcome_public_id of SummativeOutcome.supersedes_outcome.", IDENTIFIER),
    has_notes: derived(
      "true when the teacher recorded a note with the outcome. The note text is not exported because it may identify the student; review it in the application when needed.",
      "Computed by summativeOutcomeRows: SummativeOutcome.notes is not blank.", { ...OUTCOME, data_type: "boolean", allowed_values: "true; false" }),
    recorded_at: recorded(
      "Time the record was created in the application (import or replacement); not the assessment date.",
      "Copied from SummativeOutcome.created_at.",
      { ...OUTCOME, data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: pointTimestamp("outcome record creation") })
  }
};

function isStudyParticipationTable(table: string): table is StudyParticipationTable {
  return (STUDY_PARTICIPATION_TABLES as readonly string[]).includes(table);
}

/** The documentation of one study-design column, or null outside these files. */
export function studyParticipationColumnDoc(table: string, variable: string): StudyColumnDoc | null {
  if (!isStudyParticipationTable(table)) return null;
  const doc = TABLE_DOCS[table][variable] ?? SHARED[variable];
  if (!doc) return null;
  const restricted = STUDY_PARTICIPATION_RESTRICTED_TABLES.includes(table) ||
    (STUDY_PARTICIPATION_RESTRICTED_COLUMNS as readonly string[]).includes(variable);
  return restricted
    ? { ...doc, export_policy: "restricted_research_dataset_only", audience: "restricted_researcher",
        privacy: table === "summative_outcomes" ? "restricted_summative_outcome" : "restricted_scoring" }
    : doc;
}
