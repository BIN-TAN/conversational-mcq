import { createHash } from "node:crypto";
import { researchCsv } from "./csv-contract";
import { ATTEMPT_COMPARISON_VERSION, ATTEMPT_VIEWS, buildAttemptComparison, responseMetrics, selectSubmittedAttempts,
  type AttemptObservation, type AttemptPair } from "@/lib/services/teacher-dashboard/attempt-comparison";

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;
const attemptColumns = ["research_student_id", "assessment_public_id", "assessment_family_public_id", "session_public_id",
  "attempt_number", "family_attempt_number", "session_status", "started_at", "initial_submitted_at", "comparison_eligible", "limitation",
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
  pseudonym: (student: string) => string; include_restricted: boolean; scope: string;
  family_attempt_numbers?: ReadonlyMap<string, number> }) {
  const attempts: Row[] = [], items: Row[] = [], pairs: Row[] = [], summaries: Row[] = [];
  for (const attempt of input.attempts) {
    const identity = { research_student_id: input.pseudonym(attempt.student_key), assessment_public_id: attempt.assessment_public_id,
      session_public_id: attempt.session_public_id, attempt_number: attempt.attempt_number };
    attempts.push({ ...identity, assessment_family_public_id: attempt.assessment_family_public_id,
      family_attempt_number: input.family_attempt_numbers?.get(attempt.session_public_id) ?? null, session_status: attempt.status,
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
    attempt_number: "Original attempt number for this assessment version; never renumbered after a technical waiver. A corrected version (new assessment_public_id in the same assessment_family_public_id) starts again at 1, although the three-attempt limit counts the whole family; use family_attempt_number for the student's attempt order across versions.",
    family_attempt_number: "Order of this attempt among all of the student's attempts in the assessment family (every version), by attempt creation time, starting at 1. Waived (restored) chances are still counted; see chance_waived_at. Comparison labels (1-2, 2-3, 1-3, first-latest) use attempt_number within one version because items must be identical.",
    assessment_family_public_id: "Revision family of the assessment: the original version's assessment_public_id, shared by its corrected versions. The three-attempt limit applies per family.",
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
    calculation_version: "Versioned deterministic attempt comparison rules shared with the dashboard.",
    assessment_public_id: "Public identifier of the mini-test version; comparisons never cross versions.",
    session_public_id: "Public identifier of the attempt; joins sessions.csv.",
    session_status: "Stored attempt status at the snapshot: not_started, active, paused, completed, student_exited or needs_review. Comparison eligibility depends on initial_submitted_at, not on this status.",
    started_at: "When the attempt started (its creation time when no start was recorded).",
    chance_policy_version: "Attempt-chance policy recorded for the attempt; blank when the attempt has no chance record.",
    "attempt_records.csv:response_count": "Number of item rows of this attempt in attempt_submission_items.csv: items of the first sealed initial package of each topic (transfer items excluded); also counted for incomplete attempts.",
    "attempt_class_summaries.csv:response_count": "Number of submitted item responses across the attempts selected for this view; denominator of option_counts_json and confidence_counts_json.",
    item_public_id: "Public identifier of the item; the same across item versions (see item_version and item_snapshot_key).",
    item_version: "Item version recorded in the sealed package; blank when not recorded (such items are never paired).",
    learning_objective: "Objective of the item as sealed: the item's knowledge component, else the topic's learning objective, else the topic title, else Unspecified objective.",
    first_reasoning: "First explanation the student submitted for the item, as recorded in the sealed package (reasoning_text_initial), before later edits; blank if not recorded.",
    reasoning: "Explanation at initial submission from the sealed package (final review edits included), before feedback; later tutoring revisions are not included.",
    evidence_source: "Always sealed_initial_package: values come from the first sealed initial response package of each topic, never from current editable responses.",
    from_session_public_id: "Attempt at the start of the pair (attempt 1 for 1-2, 1-3 and first-latest; attempt 2 for 2-3).",
    to_session_public_id: "Attempt at the end of the pair (attempt 2, 3, or the latest eligible attempt for first-latest).",
    from_attempt_number: "attempt_number of from_session_public_id.",
    to_attempt_number: "attempt_number of to_session_public_id.",
    from_selected_option: "Option selected at initial submission in the earlier attempt for this item_snapshot_key.",
    to_selected_option: "Option selected at initial submission in the later attempt for this item_snapshot_key.",
    from_confidence: "Confidence at initial submission in the earlier attempt.",
    to_confidence: "Confidence at initial submission in the later attempt.",
    from_reasoning: "Explanation at initial submission in the earlier attempt.",
    to_reasoning: "Explanation at initial submission in the later attempt.",
    elapsed_between_submissions_ms: "Milliseconds from the earlier attempt's initial_submitted_at to the later attempt's (attempt-level submission times). Includes all time between attempts; not time on task.",
    view: "Attempt selection: 1, 2 or 3 is each student's eligible attempt with that attempt_number; latest is each student's latest eligible attempt (full initial submission, not waived), so one attempt can appear in several views.",
    student_count: "Students with an eligible attempt in this view (one attempt per student).",
    incomplete_attempt_count: "Attempts on this mini-test version in the export scope without a full sealed initial submission; the same on every view row.",
    confidence_counts_json: "Counts of confidence at initial submission (low, medium, high, or Not recorded) across the responses in this view.",
    correctness: "correct or incorrect as sealed in the package (selected option compared with the attempt's correct-option snapshot); blank when not scored. Restricted field.",
    correctness_change: "Earlier-to-later correctness for the pair (for example incorrect_to_correct); unscored when either side has no correctness. Restricted field.",
    correct_count: "Responses scored correct in this view. Restricted field.",
    scored_response_count: "Responses scored correct or incorrect in this view; denominator of correct_percentage. Restricted field.",
    confidence_scored_count: "Scored responses with low, medium or high confidence; denominator for high_confidence_incorrect_count. Restricted field."
  };
  const describe = (path: string, column: string) => {
    const definition = descriptions[`${path}:${column}`] ?? descriptions[column];
    if (!definition) throw new Error(`Undocumented attempt comparison variable: ${path}.${column}`);
    return definition;
  };
  return [...tables.map(table => ({ path: table.path, data: researchCsv(table.rows.map(row => ({ ...row,
    calculation_version: ATTEMPT_COMPARISON_VERSION, snapshot_at: input.snapshot_at, cohort_scope: input.scope })),
    [...table.columns, ...metadata]) })),
    { path: "attempt_data_dictionary.csv", data: researchCsv(tables.flatMap(table => [...table.columns, ...metadata].map(column => ({
      dataset: table.path, column, definition: describe(table.path, column),
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
