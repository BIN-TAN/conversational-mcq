import assert from "node:assert/strict";
import { containsChineseText } from "../src/lib/student-visible-safety";
import { serializeStudentAssessment, serializeStudentConceptUnit, serializeStudentSafeItem } from "../src/lib/services/student-assessment/serializers";
import { validateFormativeConversationStudentOutputFormat } from "../src/lib/services/student-assessment/formative-conversation/output-format";
import { canonicalizeTutorOutput, validateTutorOutput, type ItemAdministrationTutorOutput, type ItemAdministrationTutorStatePacket } from "../src/lib/services/student-assessment/item-administration-tutor";
import { FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { profileRecordProvenance } from "../src/lib/services/student-assessment/profile-record";
import { normalizeChoiceOnlyAnnotations, validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const chinese = "\u4e2d\u6587";
check("Student metadata projection uses English without changing the saved record", () => {
  const topic = { concept_unit_public_id: "synthetic", title: `Test: ${chinese}`, learning_objective: chinese };
  assert.deepEqual(serializeStudentConceptUnit(topic), { concept_unit_public_id: "synthetic", title: "Assessment topic", learning_objective: "" });
  assert.equal(topic.title, `Test: ${chinese}`);
  const assessment = { assessment_public_id: "synthetic", title: "Test 7", description: chinese };
  assert.equal(serializeStudentAssessment(assessment).title, "Test 7");
  assert.equal(serializeStudentAssessment(assessment).description, null);
  assert.equal(serializeStudentAssessment({ ...assessment, title: chinese }).title, "Assessment");
  assert.equal(serializeStudentAssessment({ ...assessment, description: null }).description, null);
});
check("English and mathematical symbols are unchanged; Chinese replies and artifacts are rejected", () => {
  const math = "Use \u03b1 = .80 and \u03b8 = 1.2; X = T + E.";
  assert.equal(containsChineseText(math), false);
  assert.equal(validateFormativeConversationStudentOutputFormat(math).length, 0);
  assert.equal(serializeStudentConceptUnit({ concept_unit_public_id: "synthetic", title: math, learning_objective: math }).title, math);
  for (const field of ["student_visible_message", "teaching_artifact.student_visible_content"]) {
    assert(validateFormativeConversationStudentOutputFormat(`Let us discuss ${chinese}.`, field)
      .some(issue => issue.code === "student_output_language" && issue.field_path === field));
  }
});
check("Student-authored responses remain verbatim, including non-English input", () => {
  const item = { item_public_id: "synthetic", item_order: 1, item_stem: "Synthetic item", options: [{ label: "A", text: "An option" }], version: 1 };
  assert.equal(serializeStudentSafeItem(item, { selected_option: "A", reasoning_text: chinese,
    confidence_rating: "low", item_submitted_at: null, missing_evidence_repair_offered: false }).existing_reasoning_text, chinese);
});

const packet: ItemAdministrationTutorStatePacket = {
  assessment_state: "AWAIT_REASON", item_public_id: "synthetic", item_order: 1,
  item_role: "initial", required_evidence_type: "reasoning", selected_option: "A",
  latest_student_message: "Alpha summarizes item consistency, not validity. Could you explain unidimensionality later?",
  correctness_feedback_prohibited: true, prior_uncertainty: false
};
const proposal: ItemAdministrationTutorOutput = {
  message_classification: "usable_reasoning", response_quality: "adequate", should_advance: true,
  should_store_deferred_concern: true, deferred_concern_summary: "Asked how to assess unidimensionality in later feedback.",
  student_facing_message: "An untrusted model explanation that must not be shown here.", next_expected_action: "advance"
};
for (const role of ["initial", "transfer"] as const) {
  for (const stage of ["reasoning", "tempting_reason"] as const) {
    check(`${role}/${stage}: accept interpreted mixed reasoning and preserve the deferred question`, () => {
      const state = { ...packet, item_role: role, required_evidence_type: stage };
      for (const classification of ["usable_reasoning", "weak_but_usable_reasoning"] as const) {
        const output = canonicalizeTutorOutput({ output: { ...proposal, message_classification: classification }, state_packet: state });
        assert.equal(output.should_advance, true);
        assert.equal(output.deferred_concern_summary, proposal.deferred_concern_summary);
        assert.equal(output.should_store_deferred_concern, true);
        assert.equal(output.student_facing_message, "Thank you for sharing your current thinking.");
        assert(validateTutorOutput({ output, state_packet: state }).ok);
        assert(!validateTutorOutput({ output: { ...output, deferred_concern_summary: null }, state_packet: state }).ok);
      }
      assert.equal(state.latest_student_message, packet.latest_student_message);
    });
  }
}
for (const classification of ["content_question", "answer_request", "gibberish", "off_topic"] as const) {
  check(`${classification} alone never advances, even after repeated submissions`, () => {
    const state = { ...packet, latest_student_message: "Could you explain this concept?", prior_neutral_clarification_count: 9 };
    const output = canonicalizeTutorOutput({ output: { ...proposal, message_classification: classification }, state_packet: state });
    assert.equal(output.should_advance, false);
    assert(validateTutorOutput({ output, state_packet: state }).ok);
  });
}
check("Teaching instructions distinguish selection from explanation and preserve provenance", () => {
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /Write all student-facing messages, headings, and teaching material in English/);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /an option selection is not a student-written explanation/);
  assert.equal(profileRecordProvenance({ id: "synthetic", profile_type: "updated", item_level_evidence: [],
    misconception_indicators: [], process_interpretation_cautions: [], confidence_alignment: "overconfident",
    based_on_agent_call: { agent_name: "formative_conversation_agent", prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
      call_status: "succeeded", output_validated: true } }).profile_confidence_alignment_scope, "carried_forward_not_reassessed");
});
console.log(`${passed} English/mixed-intent checks passed. Synthetic only; no provider calls or database writes.`);

check("Misplaced choice-only annotations do not block insufficient reasoning or invent evidence", () => {
  const payload = { item_responses: [{ item_public_id: "synthetic", selected_answer_final: "B", reasoning_text_final: "." }] };
  const review = { item_public_id: "synthetic", reasoning_judgment: "insufficient", reasoning_quote: "",
    explanation: "No interpretable explanation was supplied.", misconceptions: [], interpretation_version: "semantic-item-review-v3",
    interpretations: [{ interpretation_id: "choice", source_field: "reasoning", student_quote: "B", proposition: "Selected option B.",
      stance: "endorsed", basis: "answer_only", correctness: "supported", scope: "specific_proposition", option_reference: null,
      rationale: "Choice only, not reasoning." }] };
  assert.equal(validateSemanticItemReviews(payload, [review], true).valid, false);
  const fixed = normalizeChoiceOnlyAnnotations(payload, [review]);
  assert.equal(fixed.removed.length, 1);
  assert.equal(review.interpretations.length, 1, "Original provider result remains intact");
  assert(validateSemanticItemReviews(payload, fixed.reviews, true).valid);
  assert.equal(normalizeChoiceOnlyAnnotations(payload, fixed.reviews).removed.length, 0);
  const unsupported = { ...review, reasoning_judgment: "supported_concise", reasoning_quote: "." };
  assert.equal(validateSemanticItemReviews(payload, normalizeChoiceOnlyAnnotations(payload, [unsupported]).reviews, true).valid, false);
  const linked = { ...review, misconceptions: [{ interpretation_id: "choice", proposition: "Selected option B.", source_field: "reasoning", evidence_quote: "B" }] };
  assert.equal(normalizeChoiceOnlyAnnotations(payload, [linked]).removed.length, 0);
  for (const basis of ["student_explanation", "supplied_explanation", "fact_restatement"]) {
    const invented = { ...review, interpretations: [{ ...review.interpretations[0], basis }] };
    assert.equal(normalizeChoiceOnlyAnnotations(payload, [invented]).removed.length, 0);
    assert.equal(validateSemanticItemReviews(payload, [invented], true).valid, false);
  }
  const actual = { item_responses: [{ ...payload.item_responses[0], reasoning_text_final: "B" }] };
  assert.equal(normalizeChoiceOnlyAnnotations(actual, [review]).removed.length, 0);
});
console.log(`${passed} total checks passed, including preparation quote provenance.`);
