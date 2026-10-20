import assert from "node:assert/strict";
import { zodTextFormat } from "openai/helpers/zod";
import {
  itemAdministrationTutorResultFromModelOutput, ItemAdministrationTutorOutputSchema,
  type ItemAdministrationTutorOutput, type ItemAdministrationTutorStatePacket
} from "../src/lib/services/student-assessment/item-administration-tutor";
import { buildInitialAdminPrompt } from "../src/lib/student-assessment/initial-admin-prompts";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import { FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { learningSummaryEvidenceIssues } from "../src/lib/services/student-assessment/formative-conversation/learning-summary-policy";
import { v18r2TestContext } from "./formative-conversation-v18r2-test-fixtures";
import type { FormativeConversationV18R2AgentOutput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const packet: ItemAdministrationTutorStatePacket = {
  assessment_state: "AWAIT_REASON", item_public_id: "synthetic", item_order: 1,
  item_role: "initial", required_evidence_type: "reasoning", latest_student_message: "This seems simplest.",
  selected_option: "A", correctness_feedback_prohibited: true, prior_uncertainty: false
};
// Item administration v4: the model returns an action only; the student sees fixed neutral wording.
const proposed = (action: ItemAdministrationTutorOutput["action"]): ItemAdministrationTutorOutput => ({
  action, saved_question: action === "defer_question" ? "Asked how the comparison group is chosen." : null
});
const decide = (output: ItemAdministrationTutorOutput, state: ItemAdministrationTutorStatePacket) =>
  itemAdministrationTutorResultFromModelOutput({ output, state_packet: state, text: state.latest_student_message });
for (const stage of ["reasoning", "tempting_reason"] as const) {
  for (const role of ["initial", "transfer"] as const) {
    const state = { ...packet, required_evidence_type: stage, item_role: role };
    check(`${role}/${stage}: one neutral clarification, then retain the student's limited response`, () => {
      const candidate = proposed("clarify_once");
      const first = decide(candidate, state);
      assert.equal(first.should_advance, false);
      assert.doesNotMatch(first.student_facing_message, /timing|predefined|other students/);
      const second = decide(candidate, { ...state, prior_neutral_clarification_count: 1 });
      assert.equal(second.should_advance, true);
      assert.equal(second.collection_action, "accept");
      assert.equal(second.response_quality, "not_judged", "Collection is not a quality judgment");
      assert.equal(candidate.action, "clarify_once", "Do not mutate provider output");
      assert.deepEqual(decide(candidate, { ...state, prior_neutral_clarification_count: 1 }), second);
    });
    check(`${role}/${stage}: accept a limited or uncertain reply without requiring rewritten reasoning`, () => {
      const output = decide(proposed("accept"), state);
      assert.equal(output.should_advance, true);
      assert.doesNotMatch(output.student_facing_message, /timing|predefined|other students|correct/);
    });
    for (const action of ["defer_question", "procedural_help", "redirect"] as const) {
      check(`${role}/${stage}: one ${action} prompt does not yet advance; after the per-step limit the reply is accepted (never stuck)`, () => {
        const first = decide(proposed(action), { ...state, prior_neutral_prompt_count: 1, prior_neutral_clarification_count: 0 });
        assert.equal(first.should_advance, false);
        assert.doesNotMatch(first.student_facing_message, /timing|predefined|other students/);
        const limit = decide(proposed(action), { ...state, prior_neutral_prompt_count: 8, prior_neutral_clarification_count: 0 });
        assert.equal(limit.should_advance, true);
        assert.doesNotMatch(limit.student_facing_message, /timing|predefined|other students/);
      });
    }
  }
}
check("Neutral initial prompts and provider schema", () => {
  for (let i = 0; i < 30; i++) {
    assert.doesNotMatch(buildInitialAdminPrompt({ kind: "reasoning_prompt", assessmentState: "AWAIT_REASON", itemPublicId: `item_${i}`, selectedOption: "A" }).prompt_text, /as much detail|more detail/);
  }
  assert.doesNotThrow(() => zodTextFormat(ItemAdministrationTutorOutputSchema, "item_admin_v2"));
});

const context = v18r2TestContext({ student_turn_count: 2 });
const before = context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_kind === "assessment_reasoning")!;
const after = context.allowed_evidence_catalog.evidence.filter(entry => entry.evidence_kind === "formative_student_turn" && entry.eligibility === "student_understanding");
assert(before && after.length >= 2);
function summary(type = "learning_summary_progress", ids = [before.evidence_id, after[1].evidence_id]): FormativeConversationV18R2AgentOutput {
  return { contract_version: context.contract_version, outcome: "continue_conversation",
    student_visible_message: "**Progress supported this time**\nYour later explanation distinguishes consistency from validity.",
    teaching_artifact: null, evidence_observations: [{ evidence_type: type, observation: "Synthetic comparison of earlier and later reasoning.", evidence_ids: ids }],
    profile_transition_recommendation: null, teacher_assistance_recommendation: { recommended: false, reason_code: null }, lifecycle_recommendation: "continue" };
}
check("Evidence-linked progress can coexist with continuing teaching", () => {
  assert(validateFormativeInterpretation({ candidate: summary(), context }).valid);
  assert.equal(learningSummaryEvidenceIssues(summary("learning_summary_progress", after.map(entry => entry.evidence_id)), context).length, 0);
});
check("No invented progress from a single answer or baseline alone", () => {
  for (const ids of [[before.evidence_id], [after[0].evidence_id], [after[0].evidence_id, after[0].evidence_id]]) {
    assert(learningSummaryEvidenceIssues(summary("learning_summary_progress", ids), context).length > 0);
  }
  const option = context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_kind === "assessment_answer")!;
  assert(learningSummaryEvidenceIssues(summary("learning_summary_progress", [option.evidence_id, after[0].evidence_id]), context).length > 0);
});
check("Summary rejects missing, foreign, tutor, and explanation-request evidence", () => {
  const candidate = summary();
  candidate.evidence_observations = [];
  assert(!validateFormativeInterpretation({ candidate, context }).valid);
  for (const change of ["tutor", "request", "foreign"] as const) {
    const copy = structuredClone(context);
    const entry = copy.allowed_evidence_catalog.evidence.find(e => e.evidence_id === after[1].evidence_id)!;
    if (change === "tutor") entry.source_role = "tutor";
    if (change === "request") entry.eligibility = "evidence_quality_context";
    if (change === "foreign") entry.conversation_public_id = "another_conversation";
    assert(learningSummaryEvidenceIssues(summary(), copy).length > 0);
  }
});
check("No discussed-awaiting-confirmation section; no forced summary or question", () => {
  const candidate = summary();
  candidate.student_visible_message = "**Discussed, awaiting confirmation**";
  assert(!validateFormativeInterpretation({ candidate, context }).valid);
  candidate.student_visible_message = "**已讨论，尚待确认**";
  assert(!validateFormativeInterpretation({ candidate, context }).valid);
  candidate.student_visible_message = "Consistency alone does not establish validity for a particular use.";
  candidate.evidence_observations = [];
  assert(validateFormativeInterpretation({ candidate, context }).valid);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /Label invented numbers as illustrative/);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /A summary need not\nend the conversation/);
});
check("Teaching examples distinguish illustration from population-level evidence", () => {
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /single person's two similar\nscores illustrate individual agreement/);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /do not establish high reliability/);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /explicitly stipulate that an appropriate study/);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /not an empirical estimate, causal demonstration/);
});
console.log(`${passed} collection/summary checks passed. Synthetic only; no provider calls or database writes.`);
