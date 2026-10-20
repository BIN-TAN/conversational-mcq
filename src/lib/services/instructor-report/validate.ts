import {
  interpretationTextProblem,
  normalizeForQuote,
  processReferenceProblem
} from "@/lib/services/student-assessment/interpretation-v8/validate";
import {
  ATTEMPT_SECTION_TITLES,
  type AttemptSection,
  type InstructorReportV8Input,
  type InstructorReportV8Output,
  type InstructorReportV8Quote,
  type ReportStudentEvidence
} from "./contract";

/**
 * Application checks on the report narrative before anyone sees it (redesign sections 3,
 * 3.1 and 9.7). Pure functions: no database or provider access.
 *
 * - Numbers: the counts come from the application. A number in the narrative must be one
 *   of the application's counts for that part of the report (for a finding, also the number
 *   of students and items it lists, which the application counts and shows itself).
 *   Percentages and proportions are never computed by the model.
 * - Quotes: an exact excerpt (spacing and quotation marks normalised) of that student's own
 *   words for that item or conversation in the finding's attempts section, at least three
 *   words, never the tutor's words. Quotation marks inside the narrative obey the same rule.
 * - Labels: every student and item label exists; the students covered by a finding have a
 *   record in its attempts section.
 * - Wording: third person, no misconduct, GenAI, independence or character words, and no
 *   reference to process data.
 */
export type InstructorReportIssue = { path: string; code: string; message: string };

export const MIN_REPORT_QUOTE_WORDS = 3;

const withoutQuotations = (text: string) => text.replace(/"[^"]*"|“[^”]*”/g, " ");
const stripEdges = (value: string) => value.replace(/^[\s"'.,;:!?…-]+|[\s"'.,;:!?…-]+$/g, "");

export function normalizeReportQuote(value: string) {
  return stripEdges(normalizeForQuote(value));
}

const wordCount = (value: string) => normalizeReportQuote(value).split(" ").filter(Boolean).length;
const contains = (text: string | null | undefined, normalizedQuote: string) =>
  Boolean(text && normalizedQuote && normalizeForQuote(text).includes(normalizedQuote));

/** The student's own words for one item: explanation, tempting-option reason and the quotes in that item's records. */
export function studentItemTexts(student: ReportStudentEvidence, itemLabel: string) {
  const response = student.responses.find((entry) => entry.item_label === itemLabel);
  return [
    response?.explanation,
    response?.tempting_option_reason,
    response?.rating?.evidence_quote,
    ...student.possible_misconceptions.filter((entry) => entry.quote_item_label === itemLabel).map((entry) => entry.student_quote),
    ...student.considered_ideas.filter((entry) => entry.item_label === itemLabel).map((entry) => entry.student_quote)
  ].filter((text): text is string => Boolean(text));
}

function conversationTexts(student: ReportStudentEvidence) {
  const turns = student.conversation?.turns ?? [];
  return {
    student: turns.filter((turn) => turn.speaker === "student").map((turn) => turn.text),
    tutor: turns.filter((turn) => turn.speaker === "tutor").map((turn) => turn.text)
  };
}

/** Returns a problem code, or null when the quote is the student's own words. */
export function reportQuoteProblem(student: ReportStudentEvidence, quote: Pick<InstructorReportV8Quote, "item_label" | "source" | "quote">) {
  const normalized = normalizeReportQuote(quote.quote);
  if (wordCount(quote.quote) < MIN_REPORT_QUOTE_WORDS) return "quote_too_short";
  if (quote.source === "item_response") {
    if (!quote.item_label) return "quote_item_missing";
    const texts = studentItemTexts(student, quote.item_label);
    if (!texts.length) return "quote_item_has_no_student_text";
    return texts.some((text) => contains(text, normalized)) ? null : "quote_not_found";
  }
  const { student: own, tutor } = conversationTexts(student);
  const inTutor = tutor.some((text) => contains(text, normalized));
  if (!own.some((text) => contains(text, normalized))) return inTutor ? "quote_is_tutor_words" : "quote_not_found";
  // A student message that repeats the tutor's words is still the tutor's wording.
  return inTutor ? "quote_is_tutor_words" : null;
}

/** True when the text is that student's own words anywhere in the record (items or their own messages). */
function studentOwnWordsContain(student: ReportStudentEvidence, normalized: string) {
  const itemTexts = student.responses.flatMap((response) => studentItemTexts(student, response.item_label));
  if (itemTexts.some((text) => contains(text, normalized))) return true;
  const { student: own, tutor } = conversationTexts(student);
  return own.some((text) => contains(text, normalized)) && !tutor.some((text) => contains(text, normalized));
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50
};
const COUNTED_NOUN = "(?:students?|learners?|responses?|attempts?|items?|questions?|conversations?|explanations?|records?|profiles?|answers?|choices?)";
const NUMBER_WORD_COUNT = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b(?=(?:\\s+[a-z-]+){0,2}?\\s+${COUNTED_NOUN}\\b|\\s+(?:of|out of)\\b)`,
  "gi"
);

/** Labels and references such as S3, Q2, "question 2", "attempt 2" or "findings 1 and 3" are not counts. */
function withoutLabels(text: string) {
  return text
    .replace(/\b[SQ]\d+\b/g, " ")
    .replace(/\b(?:questions?|items?|attempts?|options?|turns?|findings?)\s+(?:numbers?\s+)?\d+(?:\s*(?:,|and|or|to|-)\s*\d+)*\b/gi, " ");
}

export function numberProblems(text: string, allowed: ReadonlySet<number>) {
  const plain = withoutLabels(withoutQuotations(text));
  const problems = new Set<string>();
  if (/\d\s*(?:%|percent\b|per cent\b)|\bpercent(?:age)?s?\b/i.test(plain)) problems.add("percentage_not_from_counts");
  if (/\b(?:half|a third|two thirds|a quarter|three quarters|one in \w+)\s+of\b/i.test(plain)) problems.add("proportion_not_from_counts");
  for (const match of plain.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    if (!allowed.has(Number(match[0]))) problems.add("number_not_from_counts");
  }
  for (const match of plain.matchAll(NUMBER_WORD_COUNT)) {
    if (!allowed.has(NUMBER_WORDS[match[1].toLowerCase()])) problems.add("number_not_from_counts");
  }
  return [...problems];
}

/** Every number in a counts object (or part of one). */
export function countNumbers(value: unknown, into = new Set<number>()) {
  if (typeof value === "number" && Number.isFinite(value)) into.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => countNumbers(entry, into));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => countNumbers(entry, into));
  return into;
}

const ISSUE_MESSAGES: Record<string, string> = {
  quote_too_short: "Quote at least three consecutive words of the student's own words.",
  quote_item_missing: "An item_response quote names its item label.",
  quote_item_has_no_student_text: "That student wrote nothing for that item in this attempts section.",
  quote_not_found: "Quote the student's own words exactly, from the named item or from their own conversation messages in the same attempts section.",
  quote_is_tutor_words: "Never quote the tutor, including student messages that repeat the tutor's words.",
  quote_student_not_covered: "Each quote's student must be listed in students_covered.",
  inline_quote_not_found: "Text in quotation marks must be the exact words of a student the passage covers (or the item's own text).",
  number_not_from_counts: "Take every number from the application's counts (for a finding, its own counts of students and items); never calculate or estimate one. Leave counts out when unsure; the application shows them.",
  percentage_not_from_counts: "Do not write percentages; the application shows the counts.",
  proportion_not_from_counts: "Do not write proportions such as half; the application shows the counts.",
  unknown_student_label: "Use only student labels from the input.",
  unknown_item_label: "Use only item labels from the input.",
  student_not_in_section: "List only students who have a record in the finding's attempts section; first and later attempts are reported separately.",
  no_students_covered: "List every student the finding covers.",
  quotes_required: "Support the finding with one to three exact quotes.",
  unknown_finding_number: "Tie each teaching action to findings by their numbers, counting from 1.",
  action_not_tied_to_findings: "Tie each teaching action to at least one finding.",
  forbidden_wording: "Use neutral assessment wording with no words about misconduct, GenAI or tool use, independence, motivation or character, not even to say that the report makes no such claim.",
  addressed_to_student: "Write in the third person for the instructor; do not use second-person address.",
  process_reference_outside_process_interpretation: "The report has no process data: describe only what students selected and wrote, without words about timing, changes, pauses, pasting or engagement (for a later attempt, state what it shows, for example 'in the later attempt S3 selected A')."
};

type TextScope = {
  allowed_numbers: ReadonlySet<number>;
  students: ReportStudentEvidence[];
  student_labels: ReadonlySet<string>;
  item_labels: ReadonlySet<string>;
  reference_texts: string[];
  limits?: boolean;
};

function textIssues(path: string, text: string, scope: TextScope): InstructorReportIssue[] {
  const codes: string[] = [];
  const wording = interpretationTextProblem(text);
  if (wording) codes.push(wording);
  const processText = scope.limits ? text.replace(/\bprocess (data|indicators?|evidence)\b/gi, " ") : text;
  const processProblem = processReferenceProblem(processText);
  if (processProblem) codes.push(processProblem);
  codes.push(...numberProblems(text, scope.allowed_numbers));
  const plain = withoutQuotations(text);
  if ([...plain.matchAll(/\bS\d+\b/g)].some((match) => !scope.student_labels.has(match[0]))) codes.push("unknown_student_label");
  if ([...plain.matchAll(/\bQ\d+\b/g)].some((match) => !scope.item_labels.has(match[0]))) codes.push("unknown_item_label");
  for (const match of text.matchAll(/"([^"]+)"|“([^”]+)”/g)) {
    const content = match[1] ?? match[2] ?? "";
    if (wordCount(content) < MIN_REPORT_QUOTE_WORDS) continue;
    const normalized = normalizeReportQuote(content);
    const found = scope.students.some((student) => studentOwnWordsContain(student, normalized)) ||
      scope.reference_texts.some((reference) => contains(reference, normalized));
    if (!found) { codes.push("inline_quote_not_found"); break; }
  }
  return [...new Set(codes)].map((code) => ({ path, code, message: ISSUE_MESSAGES[code] ?? "Follow the report rules." }));
}

export function validateInstructorReportV8(input: InstructorReportV8Input, output: InstructorReportV8Output): InstructorReportIssue[] {
  const issues: InstructorReportIssue[] = [];
  const push = (path: string, code: string, message = ISSUE_MESSAGES[code] ?? "Follow the report rules.") => issues.push({ path, code, message });
  const itemLabels = new Set(input.items.map((item) => item.item_label));
  const sections: Record<AttemptSection, Map<string, ReportStudentEvidence>> = {
    first_attempts: new Map(input.first_attempts.map((student) => [student.student_label, student])),
    later_attempts: new Map(input.later_attempts.map((student) => [student.student_label, student]))
  };
  const allStudents = [...input.first_attempts, ...input.later_attempts];
  const studentLabels = new Set(allStudents.map((student) => student.student_label));
  const referenceTexts = [
    input.mini_test.title, input.mini_test.topic, input.mini_test.learning_objective, input.mini_test.topic_description,
    ...input.items.flatMap((item) => [item.stem, item.target_reasoning, item.essential_elements,
      ...item.options.map((option) => option.text), ...item.distractor_rationales.map((entry) => entry.rationale)])
  ].filter((text): text is string => Boolean(text));
  const allNumbers = countNumbers(input.counts);
  const globalScope: TextScope = { allowed_numbers: allNumbers, students: allStudents, student_labels: studentLabels, item_labels: itemLabels, reference_texts: referenceTexts };

  output.findings.forEach((finding, index) => {
    const base = `findings[${index}]`;
    const students = sections[finding.attempts];
    const covered = [...new Set(finding.students_covered)];
    if (finding.type !== "item_review_needed" && covered.length === 0) push(`${base}.students_covered`, "no_students_covered");
    for (const label of covered) {
      if (!students.has(label)) {
        push(`${base}.students_covered`, studentLabels.has(label) ? "student_not_in_section" : "unknown_student_label",
          `${label} has no record in ${ATTEMPT_SECTION_TITLES[finding.attempts]}. ${ISSUE_MESSAGES[studentLabels.has(label) ? "student_not_in_section" : "unknown_student_label"]}`);
      }
    }
    finding.item_labels.forEach((label, itemIndex) => {
      if (!itemLabels.has(label)) push(`${base}.item_labels[${itemIndex}]`, "unknown_item_label");
    });
    if (finding.quotes.length < (finding.type === "item_review_needed" ? 0 : 1)) push(`${base}.quotes`, "quotes_required");
    finding.quotes.forEach((quote, quoteIndex) => {
      const path = `${base}.quotes[${quoteIndex}]`;
      const student = students.get(quote.student_label);
      if (!student) { push(path, studentLabels.has(quote.student_label) ? "student_not_in_section" : "unknown_student_label"); return; }
      if (!covered.includes(quote.student_label)) push(path, "quote_student_not_covered");
      if (quote.item_label !== null && !itemLabels.has(quote.item_label)) { push(path, "unknown_item_label"); return; }
      const problem = reportQuoteProblem(student, quote);
      if (problem) push(path, problem);
    });
    // The narrative may compare a student's later attempt with their first, so numbers may be
    // any of the application's counts and quotation marks may hold the covered students' words
    // from either section. The structured quotes above stay within the finding's section.
    const scope: TextScope = {
      ...globalScope,
      allowed_numbers: new Set([...allNumbers, covered.length, new Set(finding.item_labels).size]),
      students: covered.flatMap((label) => [sections.first_attempts.get(label), sections.later_attempts.get(label)].filter((entry): entry is ReportStudentEvidence => Boolean(entry)))
    };
    for (const field of ["title", "description", "caution"] as const) issues.push(...textIssues(`${base}.${field}`, finding[field], scope));
  });

  output.item_notes.forEach((note, index) => {
    if (!itemLabels.has(note.item_label)) push(`item_notes[${index}].item_label`, "unknown_item_label");
    issues.push(...textIssues(`item_notes[${index}].note`, note.note, globalScope));
  });

  output.suggested_teaching_actions.forEach((action, index) => {
    const base = `suggested_teaching_actions[${index}]`;
    if (action.finding_numbers.some((number) => number < 1 || number > output.findings.length)) push(`${base}.finding_numbers`, "unknown_finding_number");
    if (output.findings.length > 0 && action.finding_numbers.length === 0) push(`${base}.finding_numbers`, "action_not_tied_to_findings");
    issues.push(...textIssues(`${base}.action`, action.action, globalScope));
    issues.push(...textIssues(`${base}.addresses`, action.addresses, globalScope));
  });

  issues.push(...textIssues("overview", output.overview, globalScope));
  output.limits_of_evidence.forEach((limit, index) => issues.push(...textIssues(`limits_of_evidence[${index}]`, limit, { ...globalScope, limits: true })));
  return issues;
}
