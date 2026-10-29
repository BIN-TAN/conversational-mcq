import {
  ATTEMPT_SECTIONS,
  INSTRUCTOR_REPORT_V8_RECORD_VERSION,
  INSTRUCTOR_REPORT_V8_SCHEMA_VERSION,
  type FindingCount,
  type InstructorReportGenerationMode,
  type InstructorReportV8Input,
  type InstructorReportV8Output,
  type InstructorReportV8Record
} from "./contract";
import type { AssembledInstructorReport } from "./assemble";
import { MIN_REPORT_QUOTE_WORDS, normalizeReportQuote } from "./validate";

/**
 * Parts of the report the application writes itself: the counts shown next to each finding,
 * the counts-only report used whenever there is no checked narrative, and the clearly
 * labelled local test narrative used with the mock provider. Pure functions.
 */

/** Instructor-facing reasons why the narrative is missing. */
// Plain words for the instructor; the reason code itself is kept in the stored report.
export const NARRATIVE_UNAVAILABLE_REASONS: Record<string, string> = {
  live_calls_disabled: "AI calls are switched off on this site.",
  model_not_configured: "no AI model is set up for instructor reports.",
  prompt_not_approved: "the AI instructions for the report have not been approved for use yet.",
  daily_limit_reached: "today's limit for written reports on this mini test has been reached. Try again tomorrow.",
  validation_failed: "the written summary did not pass the quality checks, even after a second try.",
  provider_failure: "the AI service could not be reached. Try again in a few minutes.",
  input_check_failed: "the students' records could not be prepared for the written summary.",
  local_test_rejected: "the test summary did not pass the quality checks."
};

export function narrativeUnavailableReason(code: string) {
  if (code.startsWith("configuration_")) return "the AI setup for reports is incomplete.";
  return NARRATIVE_UNAVAILABLE_REASONS[code] ?? "the written summary could not be produced.";
}

export function countsOnlyNote(reasonCode: string) {
  return `The written summary could not be generated: ${narrativeUnavailableReason(reasonCode)} The counts below come from the students' saved answers; this report has no findings, quotes or teaching actions.`;
}

/** Counts the students each finding lists, from the application's own records. */
export function findingCounts(input: InstructorReportV8Input, output: InstructorReportV8Output): FindingCount[] {
  return output.findings.map((finding) => {
    const students = new Map(input[finding.attempts].map((student) => [student.student_label, student]));
    const labels = [...new Set(finding.students_covered)].filter((label) => students.has(label));
    const covered = labels.map((label) => students.get(label)!);
    let profileMisconceptions: FindingCount["profile_misconceptions"] = null;
    if (finding.type === "possible_misconception") {
      const items = new Set(finding.item_labels);
      const matching = (student: (typeof covered)[number]) => student.possible_misconceptions
        .filter((entry) => items.size === 0 || entry.item_labels.some((label) => items.has(label)));
      const endorsed = covered.filter((student) => matching(student).some((entry) => entry.endorsement === "endorsed")).length;
      const tentative = covered.filter((student) => {
        const found = matching(student);
        return found.length > 0 && found.every((entry) => entry.endorsement !== "endorsed");
      }).length;
      profileMisconceptions = { endorsed, tentative, none_recorded: covered.length - endorsed - tentative };
    }
    return {
      students_covered: labels.length,
      student_labels: labels,
      earlier_version_students: covered.filter((student) => student.record === "earlier_version").length,
      profile_misconceptions: profileMisconceptions
    };
  });
}

export const LOCAL_TEST_REPORT_NOTE = "Local test report generated without an AI model; not an AI judgment.";

function firstWords(text: string, count: number) {
  return text.replace(/\s+/g, " ").trim().split(" ").slice(0, count).join(" ");
}

/**
 * Deterministic stand-in used only with the mock provider. It lists, per item and attempts
 * section, the students whose answer is incorrect, quoting the start of their explanations.
 * It judges no reasoning and claims no misconception.
 */
export function buildLocalTestNarrative(input: InstructorReportV8Input): InstructorReportV8Output {
  const findings: InstructorReportV8Output["findings"] = [];
  for (const section of ATTEMPT_SECTIONS) {
    for (const item of input.items) {
      if (findings.length >= 6) break;
      const students = input[section].filter((student) =>
        student.responses.some((response) => response.item_label === item.item_label && response.answer_correct === false));
      const quotes = students.flatMap((student) => {
        const explanation = student.responses.find((response) => response.item_label === item.item_label)?.explanation ?? "";
        const excerpt = firstWords(explanation, 6);
        return normalizeReportQuote(excerpt).split(" ").filter(Boolean).length >= MIN_REPORT_QUOTE_WORDS
          ? [{ student_label: student.student_label, item_label: item.item_label, source: "item_response" as const, quote: excerpt }]
          : [];
      }).slice(0, 3);
      if (!quotes.length) continue;
      findings.push({
        title: `Local test: incorrect answers on ${item.item_label}`,
        type: "shared_difficulty",
        attempts: section,
        item_labels: [item.item_label],
        description: "Local test entry listing the students whose answer to this item is incorrect. No judgment of their reasoning is made.",
        students_covered: students.map((student) => student.student_label),
        quotes,
        caution: LOCAL_TEST_REPORT_NOTE
      });
    }
  }
  return {
    schema_version: INSTRUCTOR_REPORT_V8_SCHEMA_VERSION,
    overview: `${LOCAL_TEST_REPORT_NOTE} The counts are computed by the application; the findings only list incorrect answers.`,
    findings,
    item_notes: [],
    suggested_teaching_actions: findings.length
      ? [{ action: "Local test entry: no teaching action is suggested.", addresses: "The report layout only.", finding_numbers: [1] }]
      : [],
    limits_of_evidence: ["Local test report: no AI model reviewed the responses or conversations."]
  };
}

/** The stored report (AgentCall.output_payload). The counts are always present. */
export function buildReportRecord(
  assembled: AssembledInstructorReport,
  result:
    | { generation_mode: Exclude<InstructorReportGenerationMode, "counts_only">; narrative: InstructorReportV8Output }
    | { generation_mode: "counts_only"; reason_code: string }
): InstructorReportV8Record {
  const narrative = result.generation_mode === "counts_only" ? null : result.narrative;
  return {
    record_version: INSTRUCTOR_REPORT_V8_RECORD_VERSION,
    generation_mode: result.generation_mode,
    narrative,
    narrative_note: result.generation_mode === "counts_only" ? countsOnlyNote(result.reason_code) : null,
    narrative_reason_code: result.generation_mode === "counts_only" ? result.reason_code : null,
    counts: assembled.counts,
    finding_counts: narrative ? findingCounts(assembled.input, narrative) : [],
    application_notes: assembled.application_notes,
    evidence_index: assembled.index,
    student_count: assembled.counts.students_with_submitted_attempt,
    item_count: assembled.counts.items
  };
}
