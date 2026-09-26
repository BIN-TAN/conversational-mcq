import assert from "node:assert/strict";
import { zodTextFormat } from "openai/helpers/zod";
import {
  canonicalizeTutorOutput, ItemAdministrationTutorOutputSchema,
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
const proposed = (classification: ItemAdministrationTutorOutput["message_classification"]): ItemAdministrationTutorOutput => ({
  message_classification: classification, response_quality: "not_usable", should_advance: false,
  should_store_deferred_concern: false, deferred_concern_summary: null,
  student_facing_message: "Focus on the timing and whether the comparison uses other students or a predefined standard.",
  next_expected_action: "ask_repair"
});
for (const stage of ["reasoning", "tempting_reason"] as const) {
  for (const role of ["initial", "transfer"] as const) {
    const state = { ...packet, required_evidence_type: stage, item_role: role };
    check(`${role}/${stage}: one neutral clarification, then retain the student's limited response`, () => {
      const candidate = proposed("incomplete");
      const first = canonicalizeTutorOutput({ output: candidate, state_packet: state });
      assert.equal(first.should_advance, false);
      assert.doesNotMatch(first.student_facing_message, /timing|predefined|other students/);
      const second = canonicalizeTutorOutput({ output: candidate, state_packet: { ...state, prior_neutral_clarification_count: 1 } });
      assert.equal(second.should_advance, true);
      assert.equal(second.response_quality, "weak_but_usable");
      assert.equal(candidate.message_classification, "incomplete", "Do not mutate provider output");
      assert.deepEqual(canonicalizeTutorOutput({ output: second, state_packet: state }), second);
    });
    for (const classification of ["affective_expression", "weak_but_usable_reasoning", "insufficient_knowledge"] as const) {
      check(`${role}/${stage}: accept ${classification} without requiring rewritten reasoning`, () => {
        const output = canonicalizeTutorOutput({ output: proposed(classification), state_packet: state });
        assert.equal(output.should_advance, true);
        assert.doesNotMatch(output.student_facing_message, /timing|predefined|other students|correct/);
      });
    }
    for (const classification of ["content_question", "answer_request", "procedural_question", "edit_request", "gibberish", "off_topic"] as const) {
      check(`${role}/${stage}: repeated ${classification} is not a justification`, () => {
        const output = canonicalizeTutorOutput({ output: proposed(classification), state_packet: { ...state, prior_neutral_clarification_count: 8 } });
        assert.equal(output.should_advance, false);
        assert.doesNotMatch(output.student_facing_message, /timing|predefined|other students/);
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
console.log(`${passed} collection/summary checks passed. Synthetic only; no provider calls or database writes.`);
