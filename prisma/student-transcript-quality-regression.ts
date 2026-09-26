import assert from "node:assert/strict";
import { zodTextFormat } from "openai/helpers/zod";
import { buildEvidenceIntegratedProfileBundle } from "../src/lib/services/student-assessment/evidence-integrated-profile";
import { CurrentSemanticItemReviewSchema, validateSemanticItemReviews, type SemanticItemReview } from "../src/lib/services/student-assessment/semantic-item-review";
import { buildInitialAdminPrompt } from "../src/lib/student-assessment/initial-admin-prompts";
import { reconstructReadableStudentAction } from "../src/lib/services/teacher-review/readable-transcript";
import { validateFormativeConversationStudentOutputFormat } from "../src/lib/services/student-assessment/formative-conversation/output-format";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";
import { buildTurnResponseLatencyRows, type LatencyConversationTurn } from "../src/lib/services/teacher-review/turn-response-latencies";
import { z } from "zod";

const reason = "A reliable test must have normally distributed scores, so when the distribution is not normal the scores cannot be internally consistent regardless of item relationships.";
const payload = {
  assessment_session: { session_public_id: "synthetic_quality_session" },
  assessment: { assessment_public_id: "synthetic_quality_assessment", title: "Synthetic test" },
  concept_unit: { title: "Reliability", administration_rules: {} },
  included_items: [{ item_public_id: "synthetic_item", item_stem: "Does everyone answering correctly establish internal consistency?", options: [{ label: "A", text: "Yes" }, { label: "B", text: "No" }] }],
  item_responses: [{ item_public_id: "synthetic_item", selected_answer_final: "B", correct_option_snapshot: "B", correctness: "correct", reasoning_text_final: reason, confidence_final: "medium", tempting_option_reason: "A larger sample always makes a test valid.", no_tempting_option: false }]
};
const review: SemanticItemReview = {
  item_public_id: "synthetic_item", reasoning_judgment: "contradictory", reasoning_quote: reason,
  explanation: "The selected answer is supported, but the explanation incorrectly requires normally distributed scores.",
  misconceptions: [
    { proposition: "Reliability requires normally distributed scores.", source_field: "reasoning", evidence_quote: reason },
    { proposition: "Increasing sample size establishes validity.", source_field: "tempting_option_reason", evidence_quote: payload.item_responses[0].tempting_option_reason }
  ]
};
for (const text of [reason, "It must be normal.", "Reliability does not mean validity.", "same thing", "weather and scores are unrelated"]) {
  const packageValue = structuredClone(payload);
  packageValue.item_responses[0].reasoning_text_final = text;
  const bundle = buildEvidenceIntegratedProfileBundle({ response_package_payload: packageValue });
  assert.equal(bundle.profile.reasoning_quality.value, "insufficient_reasoning_evidence");
  assert.equal(bundle.profile.assessment_specific_understanding.value, "indeterminate_due_to_insufficient_evidence");
  assert.equal(bundle.profile.item_evidence[0].possible_misconception.present, false);
  assert.equal(bundle.profile.semantic_review_audit?.status, "unavailable");
}
const reviewed = buildEvidenceIntegratedProfileBundle({ response_package_payload: payload, semantic_item_reviews: [review], source_agent_call_public_id: "synthetic_call" });
assert.equal(reviewed.profile.outcome_summary.items_correct, 1);
assert.equal(reviewed.profile.reasoning_quality.value, "misconception_based");
assert.equal(reviewed.profile.item_evidence[0].semantic_review?.misconceptions.length, 2);
assert.equal(reviewed.profile.semantic_review_audit?.source_agent_call_id, "synthetic_call");
assert.equal(reviewed.profile.item_evidence[0].confidence, "medium");
assert.equal(reviewed.profile.assessment_specific_understanding.value, "specific_misconception");
assert.equal(reviewed.validators.profile_coherence.valid, true);
assert.equal(reviewed.student_communication.fact_validation.valid, true);
assert.equal((reviewed.feedback.result_summary.match(/1 of 1 correct/g) ?? []).length, 1);
assert.doesNotMatch(reviewed.feedback.result_summary, /clear support|Try this next:/);
assert.equal(validateSemanticItemReviews(payload, [review, review]).valid, false);
assert.equal(validateSemanticItemReviews(payload, [{ ...review, item_public_id: "other" }]).valid, false);
assert.equal(validateSemanticItemReviews(payload, [{ ...review, reasoning_quote: "invented evidence" }]).valid, false);
assert.equal(validateSemanticItemReviews(payload, [{ ...review, misconceptions: [{ ...review.misconceptions[1], source_field: "reasoning" }] }]).valid, false);
const supportedPayload = structuredClone(payload);
supportedPayload.item_responses[0].reasoning_text_final = "Items must covary; correctness alone is insufficient.";
const supported = buildEvidenceIntegratedProfileBundle({ response_package_payload: supportedPayload, semantic_item_reviews: [{ ...review, reasoning_judgment: "supported_concise", reasoning_quote: supportedPayload.item_responses[0].reasoning_text_final, explanation: "The reason distinguishes co-variation from common correct responses.", misconceptions: [] }] });
assert.equal(supported.profile.reasoning_quality.value, "accurate_but_concise");
assert.equal(supported.profile.assessment_specific_understanding.value, "sound_understanding");
assert.doesNotThrow(() => zodTextFormat(z.object({ semantic_item_reviews: z.array(CurrentSemanticItemReviewSchema) }).strict(), "semantic_review_test"));

const neutral = ["A", "E"].flatMap(selectedOption => ["", "I am unsure what intervals mean.", "I know the reason."].map(latestStudentResponse =>
  buildInitialAdminPrompt({ kind: "confidence_prompt", assessmentState: "AWAIT_CONFIDENCE", selectedOption, latestStudentResponse }).prompt_text));
assert.equal(new Set(neutral).size, 1);
assert.doesNotMatch(neutral[0], /reasonable|should|unsure/i);

assert.equal(reconstructReadableStudentAction({ message_text: null, structured_payload: { source: "initial_answer", selected_option: "B", correct_option: "A" } }), "[Recorded action] Selected B.");
assert.match(reconstructReadableStudentAction({ message_text: null, structured_payload: { source: "transfer_confidence", confidence_rating: "low", revised: true } }) ?? "", /Changed confidence to Low/);
assert.equal(reconstructReadableStudentAction({ message_text: null, structured_payload: { source: "unknown", selected_option: "B" } }), null);
assert.match(reconstructReadableStudentAction({ message_text: "Edited my response.", structured_payload: { source: "student_response_in_flow_edit", changed_fields: ["reasoning"] } }) ?? "", /historical wording unavailable/);
assert.match(reconstructReadableStudentAction({ message_text: "Edited my response.", structured_payload: { source: "student_response_in_flow_edit", changed_fields: ["reasoning"], reasoning_text: "My original edited reason" } }) ?? "", /My original edited reason/);

for (const message of ["You can respond in a compact form such as **1B, 2C**.", "Reply with 2:A, 3:D.", "Enter answers, for example 7-C.", "回复格式例如：1A，2B"]) {
  assert.ok(validateFormativeConversationStudentOutputFormat(message).some(issue => issue.code === "student_output_concrete_answer_example"), message);
}
assert.equal(validateFormativeConversationStudentOutputFormat("Reply with the question number and chosen letter.").length, 0);
assert.equal(validateFormativeConversationStudentOutputFormat("Your responses 1B and 2C were correct. Here is why.").length, 0);

const copied = "Create a study guide with examples about score interpretation and uncertainty, including comparisons between reference groups and scales.";
const catalog = buildCanonicalEvidenceCatalog({ evidence_namespace_public_id: "synthetic_quality", assessment_public_id: "synthetic_assessment", concept_unit_public_id: "synthetic_unit", conversation_public_id: "synthetic_conversation", assessment_responses: [], transcript: [
  { sequence_index: 1, actor: "tutor", message_text: copied },
  { sequence_index: 2, actor: "student", message_text: copied },
  { sequence_index: 3, actor: "student", message_text: "Could you talk about question 2 next?" },
  { sequence_index: 4, actor: "student", message_text: "I think the same score can have different ranks because the comparison group changes." }
] });
assert.deepEqual(catalog.evidence.map(entry => entry.eligibility), ["evidence_quality_context", "evidence_quality_context", "student_understanding"]);

const base: LatencyConversationTurn = { session_public_id: "synthetic", student_user_id: "synthetic", assessment_public_id: "synthetic", turn_index: 1, actor_type: "agent", phase: "profiling_completed", agent_name: "tutor", message_text: "Explain your reasoning.", structured_payload: {}, created_at: "2026-01-01T00:00:00Z", concept_unit_public_id: null, item_public_id: null, item_order: null };
const rows = buildTurnResponseLatencyRows({ turns: [base, { ...base, turn_index: 2, created_at: "2026-01-01T00:00:05Z" }, { ...base, turn_index: 3, actor_type: "student", created_at: "2026-01-01T00:00:10Z" }], processEvents: [{ session_public_id: "synthetic", concept_unit_public_id: null, item_public_id: null, item_order: null, event_type: "reasoning_submitted", event_category: "initial_administration", event_source: "frontend", occurred_at: "2026-01-01T00:00:12Z", created_at: "2026-01-01T00:00:12Z" }] });
assert.equal(rows[0].response_latency_ms, 10000);
assert.ok(rows[0].limitations.includes("overlapping_prompt_intervals_do_not_sum"));
assert.ok(rows[0].limitations.includes("elapsed_time_not_active_work_time"));
assert.equal(rows[0].next_student_event_type, "student_conversation_turn");
assert.equal(rows[0].latency_source, "conversation_turns");
const isolated = buildTurnResponseLatencyRows({ turns: [base, { ...base, session_public_id: "different_student_session", turn_index: 2, actor_type: "student", created_at: "2026-01-01T00:00:02Z" }], processEvents: [] });
assert.equal(isolated[0].response_latency_ms, null, "Never link events from another student's session");
const interrupted = buildTurnResponseLatencyRows({ turns: [base, { ...base, turn_index: 2, actor_type: "student", created_at: "2026-01-01T00:00:10Z" }], processEvents: [{ session_public_id: "synthetic", concept_unit_public_id: null, item_public_id: null, item_order: null, event_type: "page_hidden", event_category: "navigation", event_source: "frontend", occurred_at: "2026-01-01T00:00:03Z", created_at: "2026-01-01T00:00:03Z" }] });
assert.ok(interrupted[0].limitations.includes("interval_contains_navigation_or_pause"));
console.log("Transcript quality regression passed: semantic evidence, neutral confidence, action replay, practice disclosure, provenance, latency. No live calls or data writes.");
