import type {
  FormativeConversationV18R2AgentInput,
  FormativeConversationV18R2AgentOutput
} from "./agent-contract-v18r2";

export const QUESTION_COVERAGE_POLICY_VERSION = "student-question-source-quote-v1";

export const QUESTION_COVERAGE_SOURCE_INSTRUCTIONS = `
Question-coverage observations concern questions or requests from the STUDENT, never your own
teaching questions awaiting a student answer. If no student question is pending, omit
student_question_pending entirely; do not create a negative or empty-status observation.
For student_question_pending and student_question_addressed, start observation with
Student question: followed by a JSON double-quoted verbatim excerpt of the student's actual
question or request for help, then a short explanation of its current coverage.
Example format: Student question: "Why is that not enough?" The reply explains the missing condition.
Copy the excerpt exactly from the student evidence cited in this observation; do not quote your
own paraphrase or tutor prompt. Indirect requests and questions without a question mark are valid.
An uncertain belief or a difficulty the student has chosen to defer is not by itself a new request.
Keep deferred topics available for later without reopening them unless the student asks to return.
After answering the question in this reply, use addressed, not pending. For a partially answered
question, identify the still-unanswered part; do not mark the same quoted question both ways.
Keep this provenance syntax in evidence_observations only, never in student_visible_message.
`;

// Prospective source/consistency check only. It does not decide whether a question
// was answered well or whether the student learned; those meanings still need review.
export function questionCoverageEvidenceIssues(
  output: FormativeConversationV18R2AgentOutput,
  context: FormativeConversationV18R2AgentInput
) {
  const issues: string[] = [];
  const evidenceById = new Map(context.allowed_evidence_catalog.evidence.map(entry => [entry.evidence_id, entry]));
  const states = new Map<string, string>();
  for (const observation of output.evidence_observations) {
    if (!["student_question_pending", "student_question_addressed"].includes(observation.evidence_type)) continue;
    const match = /^Student question:\s*("(?:[^"\\]|\\.)*")\s+\S/u.exec(observation.observation);
    let quote: unknown;
    try { quote = match ? JSON.parse(match[1]) : null; } catch { quote = null; }
    if (typeof quote !== "string" || !quote.trim() || !/[\p{L}\p{N}]/u.test(quote)) {
      issues.push("instructional_coverage.verbatim_student_question_quote_required");
      continue;
    }
    const quotedText = quote;
    const sources = observation.evidence_ids.map(id => evidenceById.get(id));
    if (!sources.length || sources.some(entry => !entry || entry.source_role !== "student" ||
        entry.evidence_scope_id !== context.allowed_evidence_catalog.evidence_scope_id ||
        !["assessment_reasoning", "assessment_distractor_reasoning", "formative_student_turn"].includes(entry.evidence_kind) ||
        !["student_understanding", "evidence_quality_context"].includes(entry.eligibility) ||
        (entry.evidence_stage === "formative_conversation" && entry.conversation_public_id !== context.conversation_public_id)) ||
        !sources.some(entry => entry?.content.includes(quotedText))) {
      issues.push("instructional_coverage.question_quote_not_in_cited_student_evidence");
      continue;
    }
    for (const source of sources.filter(entry => entry?.content.includes(quotedText))) {
      const key = JSON.stringify([source!.evidence_id, quotedText]);
      const prior = states.get(key);
      if (prior && prior !== observation.evidence_type) issues.push("instructional_coverage.question_cannot_be_pending_and_addressed");
      states.set(key, observation.evidence_type);
    }
  }
  return [...new Set(issues)];
}
