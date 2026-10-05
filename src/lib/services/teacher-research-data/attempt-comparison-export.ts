import { createHash } from "node:crypto";
import { researchCsv } from "./csv-contract";
import { ATTEMPT_COMPARISON_VERSION, ATTEMPT_VIEWS, buildAttemptComparison, responseMetrics, selectSubmittedAttempts,
  type AttemptObservation, type AttemptPair } from "@/lib/services/teacher-dashboard/attempt-comparison";

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;
const attemptColumns = ["research_student_id", "assessment_public_id", "assessment_family_public_id", "session_public_id",
  "attempt_number", "session_status", "started_at", "initial_submitted_at", "comparison_eligible", "limitation",
  "chance_policy_version", "chance_waived_at", "response_count"];
const itemColumns = ["research_student_id", "assessment_public_id", "session_public_id", "attempt_number", "item_public_id",
  "item_snapshot_key", "item_version", "learning_objective", "initial_submitted_at", "first_selected_option", "selected_option",
  "first_confidence", "confidence", "first_reasoning", "reasoning", "no_tempting_option", "tempting_option", "tempting_option_reason", "evidence_source"];
const pairColumns = ["item_pair_id", "research_student_id", "assessment_public_id", "comparison", "from_session_public_id", "to_session_public_id",
  "from_attempt_number", "to_attempt_number", "item_snapshot_key", "from_selected_option", "to_selected_option",
  "from_confidence", "to_confidence", "from_reasoning", "to_reasoning", "elapsed_between_submissions_ms"];
const summaryColumns = ["assessment_public_id", "view", "student_count", "missing_student_count", "incomplete_attempt_count",
  "response_count", "option_counts_json", "confidence_counts_json"];
const restrictedMetrics = ["correct_count", "scored_response_count", "correct_percentage", "high_confidence_incorrect_count", "confidence_scored_count"];
const metadata = ["calculation_version", "snapshot_at", "cohort_scope"];

export function attemptComparisonExportFiles(input: { attempts: AttemptObservation[]; snapshot_at: string;
  pseudonym: (student: string) => string; include_restricted: boolean; scope: string }) {
  const attempts: Row[] = [], items: Row[] = [], pairs: Row[] = [], summaries: Row[] = [];
  for (const attempt of input.attempts) {
    const identity = { research_student_id: input.pseudonym(attempt.student_key), assessment_public_id: attempt.assessment_public_id,
      session_public_id: attempt.session_public_id, attempt_number: attempt.attempt_number };
    attempts.push({ ...identity, assessment_family_public_id: attempt.assessment_family_public_id, session_status: attempt.status,
      started_at: attempt.started_at, initial_submitted_at: attempt.submitted_at,
      comparison_eligible: Boolean(attempt.submitted_at && !attempt.chance_waived_at), limitation: attempt.limitation,
      chance_policy_version: attempt.chance_policy, chance_waived_at: attempt.chance_waived_at, response_count: attempt.items.length });
    for (const item of attempt.items) items.push({ ...identity, item_public_id: item.item_public_id,
      item_snapshot_key: item.item_key, item_version: item.item_version, learning_objective: item.objective,
      initial_submitted_at: item.submitted_at, first_selected_option: item.first_option, selected_option: item.selected_option,
      first_confidence: item.first_confidence, confidence: item.confidence, first_reasoning: item.first_reasoning,
      reasoning: item.reasoning, evidence_source: item.evidence_source,
      no_tempting_option: item.no_tempting_option ?? null, tempting_option: item.tempting_option ?? null,
      tempting_option_reason: item.tempting_option_reason ?? null,
      ...(input.include_restricted ? { correctness: item.correctness } : {}) });
  }
  for (const assessmentId of new Set(input.attempts.map(attempt => attempt.assessment_public_id))) {
    const group = input.attempts.filter(attempt => attempt.assessment_public_id === assessmentId);
    const students = new Set(group.map(attempt => attempt.student_key)).size;
    for (const view of ATTEMPT_VIEWS) {
      const selected = selectSubmittedAttempts(group, view);
      const metrics = responseMetrics(selected.flatMap(attempt => attempt.items));
      summaries.push({ assessment_public_id: assessmentId, view, student_count: selected.length,
        missing_student_count: students - selected.length, incomplete_attempt_count: group.filter(attempt => !attempt.submitted_at).length,
        response_count: metrics.response_count, option_counts_json: JSON.stringify(metrics.option_counts),
        confidence_counts_json: JSON.stringify(metrics.confidence_counts),
        ...(input.include_restricted ? Object.fromEntries(restrictedMetrics.map(key => [key, metrics[key as keyof typeof metrics] as Cell])) : {}) });
    }
    for (const comparison of ["1-2", "2-3", "1-3", "first-latest"] as AttemptPair[]) {
      const result = buildAttemptComparison(group, { pair: comparison, snapshot_at: input.snapshot_at });
      for (const change of result.transitions) pairs.push({
        item_pair_id: `pair_${createHash("sha256").update(JSON.stringify([input.pseudonym(change.student_key), assessmentId,
          change.from_session, change.to_session, change.item_key])).digest("hex")}`,
        research_student_id: input.pseudonym(change.student_key),
        assessment_public_id: assessmentId, comparison, from_session_public_id: change.from_session, to_session_public_id: change.to_session,
        from_attempt_number: change.from_attempt, to_attempt_number: change.to_attempt, item_snapshot_key: change.item_key,
        from_selected_option: change.before.selected_option, to_selected_option: change.after.selected_option,
        from_confidence: change.before.confidence, to_confidence: change.after.confidence,
        from_reasoning: change.before.reasoning, to_reasoning: change.after.reasoning,
        elapsed_between_submissions_ms: change.elapsed_between_submissions_ms,
        ...(input.include_restricted ? { correctness_change: change.correctness_change } : {}) });
    }
  }
  const tables = [
    { path: "attempt_records.csv", columns: attemptColumns, rows: attempts },
    { path: "attempt_submission_items.csv", columns: [...itemColumns, ...(input.include_restricted ? ["correctness"] : [])], rows: items },
    { path: "attempt_paired_changes.csv", columns: [...pairColumns, ...(input.include_restricted ? ["correctness_change"] : [])], rows: pairs },
    { path: "attempt_class_summaries.csv", columns: [...summaryColumns, ...(input.include_restricted ? restrictedMetrics : [])], rows: summaries }
  ];
  const descriptions: Record<string, string> = {
    research_student_id: "Pseudonymous research student join key; never a login identifier.",
    item_pair_id: "Stable pair_ plus SHA-256 of JSON [research_student_id, assessment_public_id, from_session_public_id, to_session_public_id, item_snapshot_key]. Excludes comparison label: overlapping 1-2/1-3/first-latest views share this ID. Select one comparison or deduplicate by this ID; rows are not independent participants.",
    attempt_number: "Original attempt number for this assessment version; never renumbered after a technical waiver.",
    initial_submitted_at: "Timestamp of the first sealed initial package (last required package for attempt rows), before feedback within this attempt.",
    comparison_eligible: "True only for a full initial submission not waived for a technical problem.",
    limitation: "Unavailable or incomplete sealed evidence; never substituted with current mutable responses.",
    item_snapshot_key: "Item ID, version and stable content fingerprint. Only identical keys can form an item comparison.",
    first_selected_option: "First recorded choice in the sealed package; null if not recorded.",
    selected_option: "Final submitted choice from the sealed initial package, not post-feedback revision.",
    first_confidence: "First confidence recorded in the sealed package; null if not recorded.",
    confidence: "Confidence at initial submission within this attempt; not an emotion or mastery estimate.",
    no_tempting_option: "Explicit no-alternative flag in the first sealed initial package: true for No, false for a named alternative or reset, blank when unavailable. Never inferred from an empty option.",
    tempting_option: "Alternative option retained at initial submission, before feedback; not the current editable response. Blank when absent or unavailable; consult no_tempting_option.",
    tempting_option_reason: "Student's explanation of the alternative in the first sealed initial package. Not an endorsed belief or a human diagnosis.",
    comparison: "Pair 1-2, 2-3, 1-3 or first-latest. First-latest requires attempt 1 and a distinct later submission.",
    correct_percentage: "100 * correct_count / scored_response_count; blank if denominator is zero. Restricted field.",
    high_confidence_incorrect_count: "Incorrect responses with high confidence; confidence_scored_count is the denominator. Restricted field.",
    missing_student_count: "Students with at least one session in this export scope but no eligible submission for this view. Not the enrolled class size.",
    cohort_scope: "Export selection, not necessarily the current active teacher roster. Partial exports may not contain both comparison endpoints.",
    chance_waived_at: "Logged technical restoration timestamp. Source attempt and evidence remain retained.",
    snapshot_at: "Repeatable-read database snapshot time. Latest refers to this snapshot, not a permanent final result.",
    option_counts_json: "Choice label counts across submitted responses; use item rows for diagnostic interpretation because labels differ across items.",
    calculation_version: "Versioned deterministic attempt comparison rules shared with the dashboard."
  };
  return [...tables.map(table => ({ path: table.path, data: researchCsv(table.rows.map(row => ({ ...row,
    calculation_version: ATTEMPT_COMPARISON_VERSION, snapshot_at: input.snapshot_at, cohort_scope: input.scope })),
    [...table.columns, ...metadata]) })),
    { path: "attempt_data_dictionary.csv", data: researchCsv(tables.flatMap(table => [...table.columns, ...metadata].map(column => ({
      dataset: table.path, column, definition: descriptions[column] ?? column.replaceAll("_", " "),
      missing_values: "Blank means unavailable or not applicable; never automatically zero.",
      restriction: [...restrictedMetrics, "correctness", "correctness_change"].includes(column) ? "restricted_research_only" : "standard_research"
    })))) },
    { path: "attempt_comparison_notes.txt", data: [
      `Calculation: ${ATTEMPT_COMPARISON_VERSION}. Snapshot: ${input.snapshot_at}.`,
      "Attempts are optional chances, not scheduled checkpoints. Preserve original attempt numbers, including legacy histories beyond three.",
      "All-attempt summaries describe each participating group. Paired rows compare the same student and identical administered item version.",
      "item_pair_id identifies an actual item comparison across overlapping views. Filter comparison before modelling, or deduplicate on item_pair_id; never sum all four views as independent observations.",
      "Boolean fields use true/false; empty is missing or not applicable. Older archives used 1/empty for some supplementary fields: re-export from retained sources rather than guessing whether an old blank meant false.",
      "First means attempt 1. Latest means latest fully submitted, non-waived attempt in the export selection. A partial selection cannot establish a student's full history.",
      "Class-summary denominators are students with sessions in this export scope; the teacher dashboard may instead use the active roster. Non-starters are not fabricated as session rows.",
      "First recorded choices and final initial submissions are distinct. Later tutoring revisions remain in the existing response/event/transition datasets.",
      "Reasoning and confidence are recorded evidence; no new AI interpretation is performed. Missing snapshots and changed item versions are not imputed or paired.",
      "Correctness-derived columns require restricted research export confirmation. The standard export does not reveal keys or correctness through derived metrics.",
      "Retesting is self-selected and occurs after different amounts of practice and feedback. Differences do not by themselves establish learning transfer or a causal tutor effect."
    ].join("\n") }
  ];
}
