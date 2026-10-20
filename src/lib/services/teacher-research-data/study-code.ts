/**
 * Study codes (XXXX-XXXX), the short form of research_student_id
 * (pseudonymization.ts: studyCodeFromResearchStudentId). Pure and browser-safe, so a page and
 * the API can apply the same rules to a list of consenting participants.
 */
export const MAX_INCLUDED_STUDY_CODES = 5000;

const STUDY_CODE_PATTERN = /^([0-9A-F]{4})-?([0-9A-F]{4})$/;

/** Trimmed and upper-cased, with or without the hyphen; null when it is not a study code. */
export function normalizeStudyCode(value: string) {
  const match = STUDY_CODE_PATTERN.exec(value.trim().toUpperCase());
  return match ? `${match[1]}-${match[2]}` : null;
}

/** Entries of a pasted list: one code per line (commas and semicolons also separate entries). */
export function splitStudyCodeText(text: string) {
  return text.split(/[\r\n,;]+/).map((value) => value.trim()).filter(Boolean);
}

/** Distinct normalized codes (sorted) and the entries that are not study codes. */
export function parseStudyCodeList(values: readonly string[]) {
  const codes = new Set<string>();
  const invalid: string[] = [];
  for (const value of values) {
    if (!value.trim()) continue;
    const code = normalizeStudyCode(value);
    if (code) codes.add(code);
    else invalid.push(value.trim());
  }
  return { codes: [...codes].sort(), invalid };
}
