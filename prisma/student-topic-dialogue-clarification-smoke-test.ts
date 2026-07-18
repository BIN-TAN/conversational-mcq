import { strict as assert } from "node:assert";
import {
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
  buildDeterministicTopicDialogueResponse,
  classifyTopicDialogueStudentMessage,
  type TopicDialogueInputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";

function inputFor(message: string, turn = 1): TopicDialogueInputV1 {
  return {
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
    dialogue_public_id: "td_test",
    session_public_id: "sess_test",
    assessment_public_id: "asmt_test",
    concept_public_id: "cu_test",
    assessment_topic: "Reliability and validity",
    concept_definition: "Reliability concerns consistency; validity concerns the supported interpretation.",
    allowed_topic_scope: ["Reliability", "Validity", "Consistency is not enough"],
    prohibited_scope: ["unadministered item answers", "teacher-only notes"],
    frozen_growth_target: "Explain why consistency alone does not prove validity.",
    remaining_issue: "Reliability and validity are still being blended.",
    post_activity_status: "improving_but_incomplete",
    activity_contract: {
      activity_attempt_public_id: "act_test",
      activity_family: "distractor_focused_activity",
      diagnostic_purpose: "distractor_misconception_probe",
      safe_activity_prompt: "For Item 2, compare option A with the correct answer.",
      expected_student_action_prompt: "Write one comparison."
    },
    student_activity_response: {
      response_kind: "partial",
      safe_summary: "The prior response was short."
    },
    safe_item_context: [{
      item_number: 2,
      option_label: "A",
      option_text: "Reliability proves validity."
    }],
    latest_student_message: message,
    recent_relevant_dialogue_turns: [],
    dialogue_turn_number: turn,
    maximum_dialogue_turns: 8,
    answer_reveal_state: {
      administered_answers_revealed: true,
      unadministered_answers_protected: true
    },
    available_progression_destinations: ["transfer_item", "next_topic", "end_assessment"],
    source_profile_version: "evidence-integrated-profile-v2",
    source_activity_evaluation_version: "student-activity-misconception-evidence-v1",
    current_topic: "Reliability and validity",
    assessment_system_question_scope: ["what to do next"],
    latest_student_message_classification: classifyTopicDialogueStudentMessage(message).student_message_function,
    source_versions: {
      topic_dialogue_input_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2
    }
  };
}

for (const message of ["what", "about what", "what should I write"]) {
  const classification = classifyTopicDialogueStudentMessage(message);
  assert.equal(classification.student_message_function, "clarification_request");
  const output = buildDeterministicTopicDialogueResponse(inputFor(message));
  assert.equal(output.student_message_function, "clarification_request");
  assert.equal(output.topic_relation, "current_assessment_content");
  assert.equal(output.next_action, "await_topic_dialogue_response");
  assert.match(output.tutor_message, /The question is asking you to explain this boundary/);
  assert.match(output.tutor_message, /Reliability proves validity/);
}

const systemOutput = buildDeterministicTopicDialogueResponse(inputFor("what happens next"));
assert.equal(systemOutput.student_message_function, "assessment_system_question");
assert.equal(systemOutput.system_question_answered, true);

const limitOutput = buildDeterministicTopicDialogueResponse(inputFor("still not sure", 8));
assert.equal(limitOutput.next_action, "show_final_support_options");

console.log(JSON.stringify({
  status: "passed",
  smoke: "student:topic-dialogue-clarification-smoke",
  openai_call_made: false
}));
