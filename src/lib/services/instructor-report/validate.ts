import type {
  InstructorReportInput,
  InstructorReportOutput
} from "./contract";

/**
 * Evidence checks applied to every generated instructor report before it is stored
 * as a successful report (D8, docs/DESIGN_ALIGNMENT_2026-10-17.md). They prevent
 * fabricated student statements, wrong-student or wrong-item attribution and
 * inflated counts. Pure function: no database or provider access.
 */
export type InstructorReportValidationIssue = {
  code:
    | "unknown_student_ref"
    | "unknown_item_ref"
    | "quote_not_found_in_student_text"
    | "quote_too_short"
    | "student_count_out_of_range"
    | "finding_without_evidence"
    | "too_many_findings";
  path: string;
  detail: string;
};

export function normalizeForQuoteMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,;:!?…-]+|[\s"'.,;:!?…-]+$/g, "")
    .trim();
}

function studentTexts(input: InstructorReportInput, studentRef: string) {
  const student = input.students.find((entry) => entry.student_ref === studentRef);
  if (!student) return null;
  return {
    initial_response: new Map(student.responses.map((response) => [response.item_ref, response.reasoning ?? ""])),
    alternative_reasoning: new Map(student.responses.map((response) => [response.item_ref, response.tempting_option_reason ?? ""])),
    conversation: (student.conversation?.turns ?? [])
      .filter((turn) => turn.speaker === "student")
      .map((turn) => turn.text)
  };
}

export function validateInstructorReport(
  input: InstructorReportInput,
  output: InstructorReportOutput
): InstructorReportValidationIssue[] {
  const issues: InstructorReportValidationIssue[] = [];
  const itemRefs = new Set(input.items.map((item) => item.item_ref));
  const totalStudents = input.students.length;

  if (output.findings.length > 8) {
    issues.push({ code: "too_many_findings", path: "findings", detail: `${output.findings.length} findings; maximum is 8.` });
  }

  output.findings.forEach((finding, findingIndex) => {
    const base = `findings[${findingIndex}]`;
    if (finding.evidence.length === 0) {
      issues.push({ code: "finding_without_evidence", path: base, detail: "Each finding needs at least one evidence entry." });
    }
    const supportingStudents = new Set<string>();
    finding.evidence.forEach((evidence, evidenceIndex) => {
      const path = `${base}.evidence[${evidenceIndex}]`;
      const texts = studentTexts(input, evidence.student_ref);
      if (!texts) {
        issues.push({ code: "unknown_student_ref", path, detail: `${evidence.student_ref} is not a student in this report.` });
        return;
      }
      supportingStudents.add(evidence.student_ref);
      if (evidence.item_ref !== null && !itemRefs.has(evidence.item_ref)) {
        issues.push({ code: "unknown_item_ref", path, detail: `${evidence.item_ref} is not an item in this mini-test.` });
        return;
      }
      const quote = normalizeForQuoteMatch(evidence.quote);
      if (!quote) {
        issues.push({ code: "quote_not_found_in_student_text", path, detail: "Quote is empty." });
        return;
      }
      const candidates = evidence.source === "conversation"
        ? texts.conversation
        : evidence.item_ref === null
          ? [...(evidence.source === "initial_response" ? texts.initial_response : texts.alternative_reasoning).values()]
          : [(evidence.source === "initial_response" ? texts.initial_response : texts.alternative_reasoning).get(evidence.item_ref) ?? ""];
      // A fragment such as "the" matches almost anything: require three words or
      // twelve characters unless the quote is the student's whole answer.
      const meaningful = quote.length >= 12 || quote.split(/\s+/).filter(Boolean).length >= 3 ||
        candidates.some((text) => normalizeForQuoteMatch(text) === quote);
      if (!meaningful) {
        issues.push({ code: "quote_too_short", path, detail: "Quote at least three consecutive words, or the student's whole answer when it is shorter." });
        return;
      }
      if (!candidates.some((text) => normalizeForQuoteMatch(text).includes(quote))) {
        issues.push({
          code: "quote_not_found_in_student_text",
          path,
          detail: `The quote does not appear in ${evidence.student_ref}'s ${evidence.source.replace(/_/g, " ")}${evidence.item_ref ? ` for ${evidence.item_ref}` : ""}.`
        });
      }
    });
    if (finding.student_count < supportingStudents.size || finding.student_count > totalStudents || finding.student_count < 0) {
      issues.push({
        code: "student_count_out_of_range",
        path: `${base}.student_count`,
        detail: `student_count ${finding.student_count} must be between the ${supportingStudents.size} cited students and the ${totalStudents} students in the input.`
      });
    }
  });

  output.item_notes.forEach((note, index) => {
    if (!itemRefs.has(note.item_ref)) {
      issues.push({ code: "unknown_item_ref", path: `item_notes[${index}]`, detail: `${note.item_ref} is not an item in this mini-test.` });
    }
  });

  return issues;
}
