import assert from "node:assert/strict";
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
    status_message: "Recommended activity",
    focus_label: "Recommended activity",
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

console.log(JSON.stringify({
  status: "passed",
  smoke: "student:student-visible-id-leakage-smoke",
  openai_call_made: false
}));
