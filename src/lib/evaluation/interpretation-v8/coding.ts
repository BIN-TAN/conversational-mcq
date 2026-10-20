import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  ERROR_SOURCES,
  EXPLANATION_QUALITIES,
  NO_USABLE_REASONS
} from "@/lib/services/student-assessment/interpretation-v8/contract";
import { itemOf, topicOf, type EvaluationCaseFile, type ItemBank } from "./case-model";
import type { FeedbackCaseFile } from "./feedback-case-model";
import type { ReferenceCodingRow } from "./score";
import type { FeedbackRunRecord } from "./run";

/**
 * Human coding materials (design document, section 11.1, "Reference coding"). Coders see the
 * item specifications and the student's responses, never the situation codes, the expected
 * categories or any model output. Students appear in a shuffled order that is fixed by a seed.
 */
export const CODING_COLUMNS = [
  "explanation_quality",
  "beyond_option_text",
  "error_source",
  "no_usable_reason",
  "side_remark",
  "misconception",
  "considered_idea",
  "coder_notes"
] as const;

function seededOrder<T>(values: T[], seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 2 ** 32;
  };
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function processNote(response: EvaluationCaseFile["cases"][number]["responses"][number]) {
  const process = response.process ?? {};
  const notes: string[] = [];
  if (typeof process.first_selection_ms === "number" && process.first_selection_ms < 10_000) {
    notes.push(`first option selected after ${Math.round(process.first_selection_ms / 100) / 10} s`);
  }
  if (process.first_option && process.first_option !== response.selected_option) notes.push(`answer changed from ${process.first_option}`);
  if (process.first_explanation) notes.push(`first explanation: "${process.first_explanation}"`);
  if (process.first_confidence && process.first_confidence !== response.confidence) notes.push(`confidence changed from ${process.first_confidence}`);
  if (process.unfocused_seconds) notes.push(`away from the page ${process.unfocused_seconds} s`);
  if (process.blocked_paste_attempts) notes.push(`${process.blocked_paste_attempts} blocked paste attempt(s)`);
  return notes.join("; ");
}

/** One row per item response; coders fill the coding columns. */
export function buildCodingSheet(bank: ItemBank, cases: EvaluationCaseFile, seed = 507) {
  const rows: Array<Record<string, string>> = [];
  for (const evaluationCase of seededOrder(cases.cases, seed)) {
    const topic = topicOf(bank, evaluationCase.topic_id);
    evaluationCase.responses.forEach((response, index) => {
      const item = itemOf(bank, response.item_id);
      rows.push({
        case_id: evaluationCase.case_id,
        item_id: item.item_id,
        question_number: String(index + 1),
        topic: topic.title,
        stem: item.stem,
        options: item.options.map((option) => `${option.label}. ${option.text}`).join("\n"),
        key: item.key,
        target_reasoning: item.target_reasoning,
        essential_elements: item.essential_elements,
        option_rationales: Object.entries(item.rationales).map(([label, entry]) => `${label}: ${entry.rationale}`).join("\n"),
        known_ambiguity: item.known_ambiguity ?? "",
        selected_option: response.selected_option ?? "(none)",
        confidence: response.confidence ?? "",
        explanation: response.explanation ?? "",
        tempting_option: response.tempting_option ?? "",
        tempting_option_reason: response.tempting_option_reason ?? "",
        process_record: processNote(response),
        ...Object.fromEntries(CODING_COLUMNS.map((column) => [column, ""]))
      });
    });
  }
  return stringify(rows, { header: true, quoted_string: true });
}

export const CODING_INSTRUCTIONS = `Coding instructions (interpretation v8 evaluation)

Rate each response from the definitions in section 4.2 of the design document and the item
specification in the row. Do not look at any model output. Code each student's items in order;
the misconception and considered-idea columns may use the student's other answers as context.

explanation_quality: ${EXPLANATION_QUALITIES.join(" | ")}
  Judged against the essential elements, from the student's own words, in any language.
beyond_option_text: yes | no | na   (na when there is no usable explanation)
  "no" when the explanation only repeats or closely paraphrases option text.
error_source: ${ERROR_SOURCES.join(" | ")} | none
  For an incorrect answer, or an incorrect explanation; "none" when there is no error.
no_usable_reason: ${NO_USABLE_REASONS.join(" | ")}   (only when explanation_quality is no_usable_explanation)
side_remark: yes | no   (an incorrect statement beside otherwise adequate reasoning)
misconception: none | endorsed | tentative
  Only when the student states an incorrect idea in their own words and holds it. A choice
  alone, a quoted-and-rejected idea or a question is "none". A hedge on the idea itself is
  "tentative"; a hedge that frames the whole answer is not.
considered_idea: yes | no   (an incorrect idea the student names and rejects)
coder_notes: free text, especially for uncertain ratings.
`;

const yesNo = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return null;
};

/** Parse a filled coding sheet. Rows without an explanation_quality are reported, not guessed. */
export function parseCodingSheet(csv: string): { rows: ReferenceCodingRow[]; problems: string[] } {
  const records = parse(csv.replace(/^﻿/, ""), { columns: true, skip_empty_lines: true, relax_column_count: true }) as Array<Record<string, string>>;
  const rows: ReferenceCodingRow[] = [];
  const problems: string[] = [];
  for (const record of records) {
    const where = `${record.case_id}/${record.item_id}`;
    const quality = (record.explanation_quality ?? "").trim().toLowerCase();
    if (!(EXPLANATION_QUALITIES as readonly string[]).includes(quality)) { problems.push(`${where}: explanation_quality "${quality}" is not a category`); continue; }
    const errorSource = (record.error_source ?? "").trim().toLowerCase();
    if (errorSource && errorSource !== "none" && !(ERROR_SOURCES as readonly string[]).includes(errorSource)) problems.push(`${where}: error_source "${errorSource}" is not a category`);
    const reason = (record.no_usable_reason ?? "").trim().toLowerCase();
    if (reason && !(NO_USABLE_REASONS as readonly string[]).includes(reason)) problems.push(`${where}: no_usable_reason "${reason}" is not a category`);
    if (quality === "no_usable_explanation" && !reason) problems.push(`${where}: no_usable_reason is missing`);
    const misconception = ((record.misconception ?? "").trim().toLowerCase() || "none") as ReferenceCodingRow["misconception"];
    if (!["none", "endorsed", "tentative"].includes(misconception)) problems.push(`${where}: misconception "${misconception}" is not a category`);
    rows.push({
      case_id: record.case_id,
      item_id: record.item_id,
      explanation_quality: quality,
      beyond_option_text: quality === "no_usable_explanation" ? null : yesNo(record.beyond_option_text),
      error_source: errorSource && errorSource !== "none" ? errorSource : null,
      no_usable_reason: quality === "no_usable_explanation" ? reason || null : null,
      side_remark: yesNo(record.side_remark) === true,
      misconception: ["endorsed", "tentative"].includes(misconception) ? misconception : "none",
      considered_idea: yesNo(record.considered_idea) === true
    });
  }
  return { rows, problems };
}

/** A sheet for reading delivered feedback messages (accuracy and tone), 20 by default. */
export function buildFeedbackReadingSheet(cases: FeedbackCaseFile, records: FeedbackRunRecord[], count = 20) {
  const delivered = records.filter((record) => record.output).sort((a, b) => a.run - b.run || a.feedback_case_id.localeCompare(b.feedback_case_id));
  const firstRun = delivered.filter((record) => record.run === Math.min(...delivered.map((entry) => entry.run)));
  const rest = delivered.filter((record) => !firstRun.includes(record));
  const chosen = [...firstRun, ...rest].slice(0, count);
  const byId = new Map(cases.cases.map((entry) => [entry.feedback_case_id, entry]));
  return stringify(chosen.map((record) => {
    const feedbackCase = byId.get(record.feedback_case_id);
    return {
      feedback_case_id: record.feedback_case_id,
      run: String(record.run),
      situation: feedbackCase?.situation ?? "",
      base_case_id: feedbackCase?.base_case_id ?? "",
      latest_student_message: feedbackCase?.transcript.at(-1)?.actor === "student" ? feedbackCase.transcript.at(-1)!.text : "",
      message: record.output!.student_visible_message,
      accurate_about_content: "",
      accurate_about_what_student_wrote: "",
      tone_appropriate: "",
      mentions_process_or_labels: "",
      reader_notes: ""
    };
  }), { header: true, quoted_string: true });
}
