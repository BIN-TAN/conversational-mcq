import {
  interpretationTextProblem,
  normalizeForQuote,
  processReferenceProblem
} from "@/lib/services/student-assessment/interpretation-v8/validate";
import type { FeedbackV8Input, FeedbackV8Output } from "./contract";

/**
 * Application checks on a feedback v8 output (docs/AI_MODULE_REDESIGN_2026-10-19.md,
 * section 3.1 "Checks" and sections 7 and 8). Student-facing text is scanned for internal
 * labels, process data and doubts about authorship; the turn record must quote the
 * student's own new words exactly. A rejected output is regenerated once.
 *
 * The phrase lists are specific on purpose: course content (for example measurement terms
 * such as score, rating or profile) must not be caught.
 */
export type FeedbackIssue = { path: string; code: string; message: string };

const withoutQuotations = (text: string) => text.replace(/"[^"]*"|“[^”]*”/g, " ");

// System labels and internal terms (section 3.1): field names, label phrases used as labels,
// and assessment nouns. Ordinary phrases such as "is not supported by the data" are allowed
// unless they label the student's work.
const LABEL_TOKENS =
  /\b(not_supported|partly_supported|not_interpretable|no_usable_explanation|possible_item_issue|execution_slip|adds_beyond_option_text|explanation_quality|error_source|focus_status|item_status|topic_summary|corrected_reasoning_expressed|difficulty_still_evident)\b/i;
const LABEL_PHRASES =
  /\b((your|this) (answer|explanation|reasoning|response|work|understanding) (is|was|were|has been|counts as|is rated|was rated|is marked|was marked)( as)? (not supported|partly supported|not interpretable|insufficient evidence))\b|\b(mostly understood|still developing|needs? more work|insufficient evidence)\b(?=[^.?!]*\b(label|summary|category|status|rating)\b)|\b(rated|labell?ed|marked|classified) (as )?(adequate|limited|incorrect|mostly understood|still developing|needs? more work|not supported)\b/i;
const INTERNAL_NOUNS =
  /\b(essential elements?|explanation quality|error source|execution slip|item status|topic summary|learning profile|your profile|student profile|no usable explanation|beyond the option text)\b/i;
// "A common misconception is that..." is ordinary teaching language; a misconception
// attributed to the student is a label about the student (rule 2: describe ideas, not the
// student).
const STUDENT_MISCONCEPTION =
  /\b(?:you|your|you've|you're)\b[^.?!]{0,40}\bmisconceptions?\b|\bmisconceptions? (?:you|in your|about your|that you)\b/i;

// Process data and anything inferred from them (section 3.1). Second-person phrasing keeps
// course content ("response time studies", "copy and paste a formula") out of the check.
const PROCESS_TERMS =
  /\b(changed your (answer|option|choice|mind|confidence)|switched (your )?(answer|option|choice)s?|switch(ed|ing)? (between )?(tabs?|windows?|pages?)|your first (answer|choice|selection|version|explanation|draft)|you (initially|originally|first) (chose|selected|picked|answered|wrote|said)|at first,? you (chose|selected|picked|wrote|said)|(time|how long) you (spent|took)|you spent (only )?(a few |\d+ )?(seconds|minutes)|your response time|answered (very |too |so )?(quickly|fast|rapidly)|(chose|selected|picked) (it |this |that )?(very |too |so )?(quickly|fast|rapidly)|you rushed|in a hurry|left the (page|tab|window)|away from the (page|tab|window)|you pasted|tried to paste|paste attempts?|you paused|you hesitated|revised your (answer|explanation)|edited your (answer|explanation)|your confidence (changed|went|rose|dropped|increased|decreased)|(raised|lowered) your confidence)\b/i;

// Authorship, independence, tools and character (section 3.1).
const AUTHORSHIP_TERMS =
  /\b(cheat\w*|plagiar\w*|you copied|copied (it|this|that|from)|copying from|dishonest\w*|misconduct|(you|you've|you have) used (chatgpt|gen ?ai|an ai|ai)|worked independently|work independently|did (this|it) independently|your own work|wrote (this|it) yourself|lazy|careless\w*|unmotivated|didn'?t (really )?try)\b/i;

// Scores and correctness counts (opening rule 1).
const SCORE_TERMS =
  /\b(you (got|scored) \d+|\d+ (out of|of) \d+ (questions?|items?|correct)|(questions?|items?) (you got )?correct: \d+|your (total )?score (was|is) \d+|\d+ ?% correct)\b/i;

export function studentFacingTextProblems(text: string) {
  const own = withoutQuotations(text);
  const problems: string[] = [];
  if (LABEL_TOKENS.test(own) || LABEL_PHRASES.test(own) || INTERNAL_NOUNS.test(own) || STUDENT_MISCONCEPTION.test(own)) problems.push("internal_term");
  if (PROCESS_TERMS.test(own)) problems.push("process_reference");
  if (AUTHORSHIP_TERMS.test(own)) problems.push("authorship_or_character");
  if (SCORE_TERMS.test(own)) problems.push("score_repeated");
  return problems;
}

const words = (value: string) => normalizeForQuote(value).split(" ").filter(Boolean);

export function validateFeedbackV8Output(input: FeedbackV8Input, output: FeedbackV8Output): FeedbackIssue[] {
  const issues: FeedbackIssue[] = [];
  const push = (path: string, code: string, message: string) => issues.push({ path, code, message });

  for (const code of studentFacingTextProblems(output.student_visible_message)) {
    const message = {
      internal_term: "Use no internal labels or assessment terms in the student's message.",
      process_reference: "Never mention time, answer or confidence changes, leaving the page, pauses or paste attempts.",
      authorship_or_character: "Never suggest doubt about who wrote a response, or comment on character.",
      score_repeated: "Do not repeat scores or counts of correct answers."
    }[code] ?? "Student-facing wording rule.";
    push("student_visible_message", code, message);
  }

  const itemCount = input.items.length;
  output.focus.item_numbers.forEach((number, index) => {
    if (number > itemCount) push(`focus.item_numbers[${index}]`, "unknown_item_number", `There are ${itemCount} questions.`);
  });

  if (input.mode === "opening") {
    if (output.student_evidence.length) push("student_evidence", "opening_has_no_student_evidence", "The opening message has no new student words to record.");
    if (output.focus_status !== null) push("focus_status", "opening_has_no_focus_status", "focus_status is null for the opening message.");
  } else {
    if (output.focus_status === null) push("focus_status", "focus_status_required", "Every reply records a focus status.");
    const latest = input.latest_student_message?.text ?? "";
    const normalizedLatest = normalizeForQuote(latest);
    const previousTutor = [...input.visible_transcript].reverse().find((turn) => turn.actor === "tutor")?.text ?? input.opening_message ?? "";
    const normalizedTutor = normalizeForQuote(previousTutor);
    output.student_evidence.forEach((entry, index) => {
      const quote = normalizeForQuote(entry.quote);
      if (!quote || !normalizedLatest.includes(quote)) {
        push(`student_evidence[${index}].quote`, "quote_not_found", "Quote only the student's new message, exactly.");
      } else if (words(entry.quote).length < Math.min(3, words(latest).length)) {
        push(`student_evidence[${index}].quote`, "quote_too_short", "Quote at least three words unless the message is shorter.");
      }
      if (output.focus_status === "corrected_reasoning_expressed" && quote && normalizedTutor.includes(quote)) {
        push(`student_evidence[${index}].quote`, "echo_is_not_evidence", "Words that repeat the tutor's previous message are not new evidence.");
      }
      const noteProblem = interpretationTextProblem(entry.note) ?? processReferenceProblem(entry.note);
      if (noteProblem) push(`student_evidence[${index}].note`, noteProblem, "Instructor-facing notes use neutral third-person wording with no process data.");
    });
    if (output.focus_status === "corrected_reasoning_expressed" && output.student_evidence.length === 0) {
      push("focus_status", "corrected_reasoning_needs_quote", "Corrected reasoning must be shown by the student's own new words.");
    }
  }

  if (output.instructor_review.flag !== "none" && !output.instructor_review.reason?.trim()) {
    push("instructor_review.reason", "reason_required", "Give the reason for an instructor-review flag.");
  }
  for (const [path, text] of [["instructor_review.reason", output.instructor_review.reason], ["focus.concept", output.focus.concept]] as const) {
    const problem = interpretationTextProblem(text) ?? processReferenceProblem(text);
    if (problem) push(path, problem, "Instructor-facing text uses neutral third-person wording with no process data.");
  }
  return issues;
}
