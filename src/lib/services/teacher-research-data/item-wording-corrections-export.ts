import type { Prisma } from "@prisma/client";
import { interpretationV8Csv, type V8Row } from "./interpretation-v8-export";
import {
  ITEM_WORDING_CORRECTIONS_COLUMNS,
  ITEM_WORDING_CORRECTIONS_FILE,
  ITEM_WORDING_CORRECTIONS_RESTRICTED_COLUMNS
} from "./item-wording-corrections-dictionary";

/**
 * Rows of item_wording_corrections.csv (see item-wording-corrections-dictionary.ts for the layout
 * and definitions), built like item_review_decisions.csv: a pure row builder that can be tested
 * without a database and one loader that reads the table with SQL.
 */

export type ItemWordingCorrectionRecord = {
  correction_public_id: string;
  assessment_public_id: string;
  item_public_id: string;
  item_version: number | null;
  changed_fields: string[];
  reason: string;
  before_content: unknown;
  after_content: unknown;
  responses_before: number | null;
  sessions_before: number | null;
  corrected_at: Date;
  research_instructor_id: string | null;
  research_pseudonym_version: string | null;
};

const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));

/** One row per fix, ordered by item and then by time; before_json and after_json only when restricted fields are included. */
export function itemWordingCorrectionRows(records: ItemWordingCorrectionRecord[], options: { include_restricted: boolean }): V8Row[] {
  return [...records]
    .sort((a, b) => a.assessment_public_id.localeCompare(b.assessment_public_id) ||
      a.item_public_id.localeCompare(b.item_public_id) ||
      a.corrected_at.getTime() - b.corrected_at.getTime() ||
      a.correction_public_id.localeCompare(b.correction_public_id))
    .map((entry) => {
      const row: V8Row = {
        correction_public_id: entry.correction_public_id,
        assessment_public_id: entry.assessment_public_id,
        item_public_id: entry.item_public_id,
        item_version: entry.item_version,
        changed_fields: entry.changed_fields.length ? entry.changed_fields.join("|") : null,
        reason: entry.reason,
        responses_before: entry.responses_before,
        sessions_before: entry.sessions_before,
        corrected_at: entry.corrected_at.toISOString(),
        research_instructor_id: entry.research_instructor_id,
        research_pseudonym_version: entry.research_pseudonym_version
      };
      if (options.include_restricted) {
        row.before_json = json(entry.before_content);
        row.after_json = json(entry.after_content);
      }
      return row;
    });
}

export function itemWordingCorrectionColumns(includeRestricted: boolean): string[] {
  return includeRestricted
    ? [...ITEM_WORDING_CORRECTIONS_COLUMNS]
    : ITEM_WORDING_CORRECTIONS_COLUMNS.filter((column) => !(ITEM_WORDING_CORRECTIONS_RESTRICTED_COLUMNS as readonly string[]).includes(column));
}

export function itemWordingCorrectionFile(records: ItemWordingCorrectionRecord[], includeRestricted: boolean) {
  return {
    path: ITEM_WORDING_CORRECTIONS_FILE,
    data: interpretationV8Csv(itemWordingCorrectionColumns(includeRestricted), itemWordingCorrectionRows(records, { include_restricted: includeRestricted }))
  };
}

type CorrectionSqlRow = {
  correction_public_id: string;
  assessment_public_id: string;
  item_public_id: string;
  item_version: number | null;
  changed_fields: string[] | null;
  reason: string;
  before_content: unknown;
  after_content: unknown;
  responses_before: number | null;
  sessions_before: number | null;
  corrected_at: Date;
  corrected_by: string | null;
};

const count = (value: number | bigint | null) => (value === null || value === undefined ? null : Number(value));

/**
 * Every wording fix on the items of one mini-test. Read with SQL like item-wording-fix.ts because
 * the Prisma client may predate the table; an export from a database without the table (before
 * release 19's migration) returns no fixes instead of failing.
 */
export async function loadItemWordingCorrectionRecords(
  tx: Prisma.TransactionClient,
  assessmentPublicId: string,
  pseudonym: { instructor: (userId: string) => string; version: string }
): Promise<ItemWordingCorrectionRecord[]> {
  const [presence] = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('item_wording_corrections') IS NOT NULL AS present`;
  if (!presence?.present) return [];
  const rows = await tx.$queryRaw<CorrectionSqlRow[]>`
    SELECT c.correction_public_id, a.assessment_public_id, i.item_public_id, c.item_version, c.changed_fields,
      c.reason, c.before_content, c.after_content, c.responses_before, c.sessions_before, c.corrected_at,
      u.user_id AS corrected_by
    FROM item_wording_corrections c
    JOIN items i ON i.id = c.item_db_id
    JOIN concept_units cu ON cu.id = i.concept_unit_db_id
    JOIN assessments a ON a.id = cu.assessment_db_id
    LEFT JOIN users u ON u.id = c.corrected_by_user_db_id
    WHERE a.assessment_public_id = ${assessmentPublicId}
    ORDER BY i.item_public_id ASC, c.corrected_at ASC, c.correction_public_id ASC`;
  return rows.map((row) => ({
    correction_public_id: row.correction_public_id,
    assessment_public_id: row.assessment_public_id,
    item_public_id: row.item_public_id,
    item_version: count(row.item_version),
    changed_fields: row.changed_fields ?? [],
    reason: row.reason,
    before_content: row.before_content,
    after_content: row.after_content,
    responses_before: count(row.responses_before),
    sessions_before: count(row.sessions_before),
    corrected_at: new Date(row.corrected_at),
    research_instructor_id: row.corrected_by ? pseudonym.instructor(row.corrected_by) : null,
    research_pseudonym_version: pseudonym.version
  }));
}
