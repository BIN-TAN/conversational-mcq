import assert from "node:assert/strict";
import { containsInternalSystemInformation } from "../src/lib/student-visible-safety";
import { validateFormativeConversationStudentOutputFormat } from "../src/lib/services/student-assessment/formative-conversation/output-format";
import {
  validateStudentActivityRuntimeProjection,
  type StudentActivityRuntimeProjection
} from "../src/lib/student-assessment/activity-runtime-projection";
import {
  STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
  validateStudentCommunicationLanguage,
  type StudentCommunicationOutputV1
} from "../src/lib/services/student-assessment/student-communication-agent";
import {
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  validateTopicDialogueOutput,
  type TopicDialogueOutputV1
} from "../src/lib/services/student-assessment/topic-dialogue-agent";

function projectionWith(message: string): StudentActivityRuntimeProjection {
  return {
    available: true,
    activity_attempt_public_id: "activity_attempt_safe",
    ui_state: "activity_ready",
    status_message: "Try this next",
    focus_label: "Try this next",
    first_turn_message: message,
    response_prompt: "Write one short response.",
    helper_text: "Use the item review above if it helps.",
    allowed_actions: ["submit_response"],
    can_start: false,
    can_submit_response: true,
    can_choose_another_activity: false,
    can_move_on: false,
    can_continue: false,
    message_max_chars: 5000,
    feedback: null,
    first_turn_visible_in_transcript: true,
    latest_reply_visible_in_transcript: false,
    topic_dialogue: null,
    next_recommendation_label: null,
    alternative_activity_labels: []
  };
}

const safeProjection = validateStudentActivityRuntimeProjection(
  projectionWith("For Item 1, option A says that reliability alone proves validity.")
);
assert.equal(safeProjection.valid, true);

const rawIdProjection = validateStudentActivityRuntimeProjection(
  projectionWith("For Item item_20260710_dra4nk0, option A says this idea is enough.")
);
assert.equal(rawIdProjection.valid, false);
assert.ok(
  !rawIdProjection.valid &&
    rawIdProjection.issues.some((issue) => issue.rule_code === "raw_identifier_detected")
);

const communicationOutput: StudentCommunicationOutputV1 = {
  communication_schema_version: STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
  package_feedback_narrative: "You answered two of the first three items correctly.",
  item_review_introductions: [{
    item_number: 1,
    status_label: "Correct",
    student_answer_label: "C",
    correct_answer_label: "C",
    introduction: "Item 1 is ready for review."
  }],
  activity_transition: "Here is a different way to work on the same idea.",
  activity_prompt: "For Item 1, option A says reliability alone proves validity. Explain the flaw in one sentence.",
  post_activity_feedback: "Thanks. I can use that response to decide the next step.",
  ready_to_advance_message: "That response addresses the key distinction clearly.",
  topic_dialogue_transition: "Let us focus on the remaining part of this idea.",
  completion_message: "You can use this next response to make the idea clearer.",
  evidence_reference_map: [{
    item_number: 1,
    evidence_summary: "Item 1 used the answer choice, explanation, confidence, and tempting-option evidence when available."
  }]
};
assert.equal(validateStudentCommunicationLanguage(communicationOutput).valid, true);
assert.equal(
  validateStudentCommunicationLanguage({
    ...communicationOutput,
    activity_prompt: "For Item item_20260710_dra4nk0, option A says reliability alone proves validity."
  }).valid,
  false
);

const dialogueOutput: TopicDialogueOutputV1 = {
  dialogue_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
  schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  tutor_message: "Focus on Item 1 and explain why consistency alone is not enough.",
  student_message_function: "clarification_request",
  response_function: "clarification",
  evidence_update: "Student asked for clarification about the bounded task.",
  remaining_issue: "The reliability-validity boundary still needs a clearer explanation.",
  post_turn_understanding: "unclear",
  evidence_sufficiency: "needs_more_evidence",
  topic_relation: "current_assessment_content",
  topic_boundary: "inside_scope",
  system_question_answered: false,
  next_action: "await_topic_dialogue_response",
  next_runtime_state: "AWAIT_TOPIC_DIALOGUE_RESPONSE",
  progression_readiness: "student_choice",
  requires_student_response: true,
  expected_response_guidance: "Write one short response or ask one question about this topic.",
  safety_flags: [],
  student_safe_summary: "The dialogue remains focused on the current concept boundary."
};
assert.equal(validateTopicDialogueOutput(dialogueOutput).valid, true);
assert.equal(
  validateTopicDialogueOutput({
    ...dialogueOutput,
    tutor_message: "Focus on Item item_20260710_dra4nk0 and explain the boundary."
  }).valid,
  false
);

for (const label of ["conversation_review", "conversation_continuity", "pre_reply_plan",
  "post_reply_review", "preference_comparisons", "bootstrap_preference_origins",
  "delivery_review_feedback", "pre_delivery_review", "conversation-delivery-review-v1", "conversation-delivery-review-v2", "conversation-delivery-review-v3", "conversation-delivery-review-v4", "conversation-delivery-review-v5", "conversation-delivery-review-v6", "unsupported_learning_claim", "teaching_accuracy_error",
  "teaching_block_audit", "draft_blocks", "draft_block_id", "conversation-delivery-review-v7", "conversation-delivery-review-v8",
  "private_learning_audit", "proposed_learning_claims", "private_learning_review_version",
  "formative_private_learning_review", "conversation-private-learning-review-v1",
  "teaching_claim_audit", "premise_assumption_check", "conclusion_check", "material_claims_checked", "no_teaching_claims",
  "conversation-pre-reply-plan-v1", "conversation-pre-reply-plan-v2", "stored_preference_retention_version", "formative_stored_preference_retention", "conversation-stored-preference-retention-v1", "preference_updates",
  "need_updates", "recap_claims", "quote_binding_feedback", "changed_fields", "prior_profile_version"]) {
  assert(containsInternalSystemInformation(`I am updating ${label} now.`), label);
}
assert.equal(containsInternalSystemInformation("We can leave SEM for another day and return to your question."), false);
assert.equal(containsInternalSystemInformation("We can check the premise and conclusion of this explanation."), false);

for (const marker of ["current_reply", "prior_tutor", "source_binding", "reply_sha256",
  "current_reply_source_version", "current_reply_bindings", "quote_source", "tutor_turn", "conversation-current-reply-source-v1"]) {
  assert(containsInternalSystemInformation(`Internal reference: ${marker}.`), marker);
  assert(validateFormativeConversationStudentOutputFormat(`Internal reference: ${marker}.`)
    .some(issue => issue.code === "student_output_internal_information"), marker);
}
assert(containsInternalSystemInformation('{"source":{"kind":"current_reply"}}'));
assert(containsInternalSystemInformation("source_\u200Bbinding"));
const ordinaryReplyDescription = "The current reply contrasts consistency with correctness. We can return to the prior tutor example and the last tutor turn.";
assert.equal(containsInternalSystemInformation(ordinaryReplyDescription), false);
assert.deepEqual(validateFormativeConversationStudentOutputFormat(ordinaryReplyDescription), []);

for (const marker of ["current_source_activation_projection_version", "current_source_activation_bindings",
  "original_preference_comparison_sha256", "projected_preference_comparison_sha256",
  "conversation-current-source-activation-projection-v1", "deferred_need_link_version",
  "formative_deferred_need_link", "conversation-deferred-need-link-v1", "deferred_need_link_feedback",
  "conversation-resulting-state-feedback-v1"]) {
  assert(containsInternalSystemInformation(`Internal reference: ${marker}.`), marker);
  assert(validateFormativeConversationStudentOutputFormat(`Internal reference: ${marker}.`)
    .some(issue => issue.code === "student_output_internal_information"), marker);
}
assert(containsInternalSystemInformation('{"current_source_activation_bindings":[]}'));
assert(containsInternalSystemInformation("current_source_\u200Bactivation_projection_version"));
const ordinaryPreferenceDescription = "Your current preference is to leave this topic for another day. We can compare the original source with the projected result.";
assert.equal(containsInternalSystemInformation(ordinaryPreferenceDescription), false);
assert.deepEqual(validateFormativeConversationStudentOutputFormat(ordinaryPreferenceDescription), []);

for (const marker of ["preference_links", "preference_linkage", "honored_constraint", "topic_of_support",
  "support_preference_link_version", "support_preference_link_bindings", "conversation-support-preference-links-v1",
  "strong_partial_reasoning_support", "source_evidence_id", "source_quote", "correct_component", "remaining_error",
  "student-profile-output-v6", "student-profiling-v9", "student-profiling-v10", "student-profile-fact-binding-v3",
  "student-profile-request-schema-v3", "student-profile-request-schema-v4", "evidence-id-request-enum-v1", "evidence_id_request_schema_version", "student-profile-semantic-repair-v2", "rejected_field_diagnostics", "rejected_reasoning_assessments"]) {
  assert(containsInternalSystemInformation(`Internal reference: ${marker}.`), marker);
  assert(validateFormativeConversationStudentOutputFormat(`Internal reference: ${marker}.`)
    .some(issue => issue.code === "student_output_internal_information"), marker);
}
assert(containsInternalSystemInformation('{"preference_links":[{"relationship":"honored_constraint"}]}'));
assert(containsInternalSystemInformation("strong_partial_\u200Breasoning_support"));
const ordinarySupportDescription = "Your preference links these ideas. This topic of support can wait. The correct component of your reasoning is useful, and we can examine the remaining error using a source quote.";
assert.equal(containsInternalSystemInformation(ordinarySupportDescription), false);
assert.deepEqual(validateFormativeConversationStudentOutputFormat(ordinarySupportDescription), []);

console.log(JSON.stringify({
  status: "passed",
  smoke: "student:student-visible-id-leakage-smoke",
  openai_call_made: false
}));
