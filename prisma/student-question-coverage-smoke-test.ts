import assert from "node:assert/strict";
import { questionCoverageEvidenceIssues } from "../src/lib/services/student-assessment/formative-conversation/question-coverage-policy";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import { v18r2TestContext, v18r2TestTerminalOutput } from "./formative-conversation-v18r2-test-fixtures";

const context = v18r2TestContext({ student_turn_count: 1 });
const source = context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_kind === "formative_student_turn")!;
source.content = 'Please explain what "reliability" means. 为什么一致不代表有效？';
source.eligibility = "evidence_quality_context";
const output = v18r2TestTerminalOutput({ context, outcome: "sound_understanding" });
output.outcome = "continue_conversation";
output.profile_transition_recommendation = null;
output.lifecycle_recommendation = "continue";
output.teacher_assistance_recommendation = { recommended: false, reason_code: null };
const observation = (quote: string, type = "student_question_addressed") => ({
  evidence_type: type,
  observation: `Student question: ${JSON.stringify(quote)} The distinction is explained in the reply.`,
  evidence_ids: [source.evidence_id]
});
let checks = 0;
const check = (expected: boolean, candidate = output, candidateContext = context) => {
  assert.equal(questionCoverageEvidenceIssues(candidate, candidateContext).length === 0, expected);
  checks++;
};
output.evidence_observations = [];
check(true); // No question means no synthetic status row is needed.
output.evidence_observations = [observation('Please explain what "reliability" means.')];
check(true); // An indirect request and escaped quotes need no question mark.
assert(validateFormativeInterpretation({candidate: output, context}).valid);
checks++;
output.evidence_observations = [observation('为什么一致不代表有效？')];
check(true); // Source matching is not restricted to English question grammar.
output.evidence_observations = [observation('Which example would you try next?', 'student_question_pending')];
check(false); // Tutor-generated question is absent from cited student words.
for (const text of ['No explicit substantive student question is currently pending.',
  'The tutor has asked the student to distinguish alpha from validity.', 'Student question: "?" Pending.',
  'Student question: "" Pending.', 'Student question: "Please explain what reliability means." Pending.']) {
  output.evidence_observations = [{ evidence_type: 'student_question_pending', observation: text, evidence_ids: [source.evidence_id] }];
  check(false);
  assert(!validateFormativeInterpretation({candidate: output, context}).valid);
  checks++;
}
output.evidence_observations = [observation(source.content, 'student_question_pending'), observation(source.content)];
check(false); // Same question cannot be both answered and unanswered in one reply.
output.evidence_observations = [observation(source.content)];
const original = JSON.stringify(output);
for (const mutate of [
  () => { output.evidence_observations[0].evidence_ids = []; },
  () => { output.evidence_observations[0].evidence_ids = ['ev_' + 'f'.repeat(24)]; }
]) {
  mutate(); check(false); output.evidence_observations = [observation(source.content)];
}
for (const patch of [{ source_role: 'tutor' }, { conversation_public_id: 'unrelated' },
  { evidence_scope_id: 'es_' + 'f'.repeat(24) }, { eligibility: 'not_eligible' }]) {
  const changed = structuredClone(context);
  Object.assign(changed.allowed_evidence_catalog.evidence.find(entry => entry.evidence_id === source.evidence_id)!, patch);
  check(false, output, changed);
}
assert.equal(JSON.stringify(output), original, 'Validation never rewrites original observations or citations');
checks++;
console.log(`PASS student question source coverage: ${checks} checks; no provider calls`);
