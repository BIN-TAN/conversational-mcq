import type { V8ColumnDoc } from "./interpretation-v8-dictionary";

/**
 * Research export of instructor wording fixes (item_wording_corrections, release 19:
 * src/lib/services/content/item-wording-fix.ts). A wording fix corrects an item's wording in
 * place after students have started its mini test; the item keeps its public ID and version.
 * This module holds the file layout and the dictionary text; the rows are built in
 * item-wording-corrections-export.ts (like item_review_decisions.csv in interpretation-v8-export.ts)
 * and every column is documented in research_data_dictionary.csv through dictionary.ts.
 */
export const ITEM_WORDING_CORRECTIONS_TABLE = "item_wording_corrections" as const;
export const ITEM_WORDING_CORRECTIONS_FILE = "item_wording_corrections.csv" as const;
export const ITEM_WORDING_CORRECTIONS_TABLES = [ITEM_WORDING_CORRECTIONS_TABLE] as const;
export type ItemWordingCorrectionsTable = (typeof ITEM_WORDING_CORRECTIONS_TABLES)[number];

export const ITEM_WORDING_CORRECTIONS_COLUMNS = [
  "correction_public_id",
  "assessment_public_id",
  "item_public_id",
  "item_version",
  "changed_fields",
  "reason",
  "before_json",
  "after_json",
  "responses_before",
  "sessions_before",
  "corrected_at",
  "research_instructor_id",
  "research_pseudonym_version"
] as const;

/**
 * Restricted columns (present only in restricted exports, like assessment_content.csv's
 * correct_option, option_rationales_json and target_reasoning_note): the stored fields before
 * and after the fix include distractor rationales and the teacher's notes on the correct option.
 */
export const ITEM_WORDING_CORRECTIONS_RESTRICTED_COLUMNS = ["before_json", "after_json"] as const;

export const ITEM_WORDING_CORRECTIONS_TABLE_COLUMNS: Record<ItemWordingCorrectionsTable, readonly string[]> = {
  item_wording_corrections: ITEM_WORDING_CORRECTIONS_COLUMNS
};

export const ITEM_WORDING_CORRECTIONS_MEASUREMENT_LEVEL = "item_wording_correction" as const;
export const ITEM_WORDING_CORRECTIONS_ROW_FUNCTION = "itemWordingCorrectionRows" as const;
export const ITEM_WORDING_CORRECTIONS_SOURCE_FILE = "src/lib/services/teacher-research-data/item-wording-corrections-export.ts" as const;
export const ITEM_WORDING_CORRECTIONS_NOT_APPLICABLE =
  "Not applicable to items whose wording was never fixed after students started the mini test; they have no rows.";
export const ITEM_WORDING_CORRECTIONS_ATTEMPT_POLICY =
  "Not attempt-level: one row per wording fix of an item. Attempts join through assessment_public_id and item_public_id; compare an answer's time with corrected_at to know which wording the student saw.";

/** Lines for the bundle README (analysis-ready-export.ts). */
export const ITEM_WORDING_CORRECTIONS_README_LINES = [
  "item_wording_corrections.csv: one row per wording fix an instructor made to an item after students had started its mini test (changed fields, reason, answers and attempts that existed at the time, research_instructor_id pseudonymous); before_json and after_json (the stored fields before and after the fix, which include distractor rationales and notes on the correct option) are restricted columns, present only in restricted exports.",
  "A wording fix leaves the item's ID and version unchanged; each student's answer keeps the wording that student saw in assessment_content.csv (built from the answer's item snapshot), and item_wording_corrections.csv lists each fix with its time, so responses before corrected_at saw the earlier wording."
] as const;

const IDENTIFIER = { category: "Assessment design and content", research_category_id: "research_identifiers_and_joins" } as const;
const CONTEXT = { category: "Assessment design and content", research_category_id: "assessment_and_item_context" } as const;
const SOURCE = "item_wording_corrections (one row per fix, written by correctItemWording in src/lib/services/content/item-wording-fix.ts)";
const FIELDS = "item_stem; options; distractor_rationales; expected_reasoning_patterns; teacher_notes";

const TABLE_DOCS: Record<string, V8ColumnDoc> = {
  correction_public_id: {
    definition: "Public identifier of the wording fix (iwc_ prefix, the date and a random suffix); one row per fix.",
    method: `Copied from correction_public_id of ${SOURCE}.`,
    source_nature: "directly_recorded", ...IDENTIFIER
  },
  assessment_public_id: {
    definition: "Public identifier of the mini-test (assessment version) holding the corrected item; join key to sessions.csv, assessment_content.csv and item_review_decisions.csv.",
    method: "Copied from Assessment.assessment_public_id of the corrected item's topic (items -> concept_units -> assessments).",
    source_nature: "directly_recorded", ...IDENTIFIER
  },
  item_public_id: {
    definition: "Public identifier of the corrected item; join with assessment_public_id to assessment_content.csv and with session_public_id to item_responses.csv. A wording fix never changes it.",
    method: `Copied from Item.item_public_id of the item named by item_db_id in ${SOURCE}.`,
    source_nature: "directly_recorded", ...IDENTIFIER
  },
  item_version: {
    definition: "Version of the item when the fix was saved. A wording fix never changes the version, so answers given before and after the fix share this item_version in item_responses.csv; use corrected_at to tell them apart.",
    method: `Copied from item_version of ${SOURCE} (Item.version at the time of the fix).`,
    source_nature: "directly_recorded", data_type: "integer", unit: "version number", ...CONTEXT
  },
  changed_fields: {
    definition: "Pipe-separated fields the fix changed: item_stem (the question wording), options (option texts; letters, order and the key never change), distractor_rationales, expected_reasoning_patterns or teacher_notes (the teacher's diagnostic notes).",
    method: `Copied from changed_fields of ${SOURCE} (computed by planItemWordingFix by comparing the stored and requested fields), joined with |.`,
    source_nature: "deterministic_derived", allowed_values: FIELDS, ...CONTEXT
  },
  reason: {
    definition: "The instructor's reason for the fix, as typed when saving it (5 to 1,000 characters); free text that may need review before sharing.",
    method: `Copied from reason of ${SOURCE}, unedited.`,
    source_nature: "teacher_authored", privacy: "research_sensitive_text", ...CONTEXT
  },
  before_json: {
    definition: "Restricted. Compact JSON object of the changed fields as stored before the fix, keyed by the names in changed_fields (teacher_notes holds the teacher's diagnostic notes, including notes on the correct option). Distractor rationales and notes can reveal the answer key, so the column is present only in restricted exports.",
    method: `Copied from before_content (jsonb) of ${SOURCE}, written as compact JSON text by item-wording-corrections-export.ts. Omitted from default exports, like assessment_content.option_rationales_json.`,
    source_nature: "teacher_authored", data_type: "json string", ...CONTEXT,
    caution: "Restricted teacher-only item content: with the options it can reveal the answer key."
  },
  after_json: {
    definition: "Restricted. Compact JSON object of the changed fields as saved by the fix, keyed like before_json. This is the wording students saw for answers given after corrected_at (until a later fix). Present only in restricted exports.",
    method: `Copied from after_content (jsonb) of ${SOURCE}, written as compact JSON text by item-wording-corrections-export.ts. Omitted from default exports, like assessment_content.option_rationales_json.`,
    source_nature: "teacher_authored", data_type: "json string", ...CONTEXT,
    caution: "Restricted teacher-only item content: with the options it can reveal the answer key."
  },
  responses_before: {
    definition: "Number of item responses (answers to this item, in every attempt) that existed when the fix was saved; those answers were given with the earlier wording.",
    method: `Copied from responses_before of ${SOURCE} (a count of ItemResponse rows for the item, taken in the same transaction as the fix).`,
    source_nature: "aggregate_derived", data_type: "integer", unit: "count", ...CONTEXT
  },
  sessions_before: {
    definition: "Number of attempts (assessment sessions) on the mini-test that existed when the fix was saved, started or submitted.",
    method: `Copied from sessions_before of ${SOURCE} (a count of AssessmentSession rows for the mini-test, taken in the same transaction as the fix).`,
    source_nature: "aggregate_derived", data_type: "integer", unit: "count", ...CONTEXT
  },
  corrected_at: {
    definition: "When the wording fix was saved (server time). Answers to this item given before this time saw the earlier wording; later answers saw the corrected wording.",
    method: `Copied from corrected_at of ${SOURCE}.`,
    source_nature: "timestamp_derived", data_type: "datetime", unit: "ISO 8601 UTC timestamp", ...CONTEXT,
    timing: {
      construct: "point_in_time_record_timestamp",
      start: "not applicable: point-in-time timestamp",
      end: "not applicable: point-in-time timestamp",
      formula: "Copy the stored wording-fix timestamp; not a duration.",
      idle: "Not applicable: a point-in-time timestamp has no interval.",
      hidden: "Not applicable: a point-in-time timestamp has no interval."
    }
  },
  research_instructor_id: {
    definition: "Pseudonymous identifier of the instructor who saved the fix (ri_ prefix); not the username or email. Same key and version as research_student_id, separate namespace.",
    method: "Computed by researchInstructorId() with versioned HMAC-SHA-256 over the instructor's operational user identifier using RESEARCH_PSEUDONYMIZATION_KEY.",
    source_nature: "deterministic_derived", privacy: "pseudonymous_research_id",
    category: "Export, provenance, and versioning data", research_category_id: "research_identifiers_and_joins"
  }
};

export function isItemWordingCorrectionsTable(table: string): table is ItemWordingCorrectionsTable {
  return (ITEM_WORDING_CORRECTIONS_TABLES as readonly string[]).includes(table);
}

/**
 * The documentation of one item_wording_corrections column, or null outside this file
 * (research_pseudonym_version keeps the standard dictionary text).
 */
export function itemWordingCorrectionColumnDoc(table: string, variable: string): V8ColumnDoc | null {
  if (!isItemWordingCorrectionsTable(table)) return null;
  const doc = TABLE_DOCS[variable];
  if (!doc) return null;
  return (ITEM_WORDING_CORRECTIONS_RESTRICTED_COLUMNS as readonly string[]).includes(variable)
    ? { ...doc, export_policy: "restricted_research_dataset_only", audience: "restricted_researcher" }
    : doc;
}
