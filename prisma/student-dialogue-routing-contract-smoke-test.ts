import assert from "node:assert/strict";
import {
  FORMATIVE_DIALOGUE_CONTEXT_REQUIREMENTS,
  FORMATIVE_DIALOGUE_ROUTING_CONTRACT,
  FORMATIVE_DIALOGUE_ROUTING_CONTRACT_VERSION,
  STUDENT_COMMUNICATION_ROUTING_SCOPE,
  formativeDialogueRoute
} from "../src/lib/services/student-assessment/dialogue-routing-contract";
import { FORMATIVE_ACTIVITY_AGENT_NAME } from "../src/lib/services/student-assessment/formative-activity-design";
import { STUDENT_COMMUNICATION_AGENT_NAME } from "../src/lib/services/student-assessment/student-communication-agent";
import {
  TOPIC_DIALOGUE_AGENT_NAME,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
  buildDeterministicTopicDialogueResponse,
  type TopicDialogueInputV1
} from "../src/lib/services/student-assessment/topic-dialogue-agent";

assert.equal(FORMATIVE_DIALOGUE_ROUTING_CONTRACT_VERSION, "formative-dialogue-routing-v1");
assert.equal(formativeDialogueRoute("initial_activity_generation").role, FORMATIVE_ACTIVITY_AGENT_NAME);
assert.equal(formativeDialogueRoute("replacement_activity_generation").role, FORMATIVE_ACTIVITY_AGENT_NAME);

for (const routeCase of [
  "first_activity_response",
  "repeated_student_confusion",
  "activity_instruction_clarification",
  "off_topic_response",
  "revision_readiness",
  "transfer_readiness",
  "provider_failure_recovery"
] as const) {
  const route = formativeDialogueRoute(routeCase);
  assert.equal(route.role, TOPIC_DIALOGUE_AGENT_NAME, `${routeCase} must use bounded topic dialogue.`);
  assert.equal(route.platform_owns_transition, true, `${routeCase} must preserve platform authority.`);
}

assert.equal(STUDENT_COMMUNICATION_ROUTING_SCOPE.role, STUDENT_COMMUNICATION_AGENT_NAME);
assert.match(STUDENT_COMMUNICATION_ROUTING_SCOPE.responsibility, /does not implement iterative/i);
assert.deepEqual(FORMATIVE_DIALOGUE_CONTEXT_REQUIREMENTS, [
  "distractor_anchor",
  "current_learning_target",
  "visible_transcript",
  "internal_evidence_history",
  "current_profile",
  "current_formative_plan",
  "latest_student_message",
  "strategies_already_attempted",
  "strategies_not_to_repeat"
]);

function dialogueInput(message: string): TopicDialogueInputV1 {
  return {
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
    dialogue_public_id: "dialogue_routing_smoke",
    session_public_id: "session_routing_smoke",
    assessment_public_id: "assessment_routing_smoke",
    concept_public_id: "concept_routing_smoke",
    assessment_topic: "theta invariance across linked IRT forms",
    concept_definition: "Theta is a person parameter and item difficulty is an item parameter.",
    allowed_topic_scope: ["theta invariance", "item difficulty", "Option A"],
    prohibited_scope: ["unrelated tutoring", "unadministered answers"],
    frozen_growth_target:
      "For Item 2, explain the exact flaw in Option A: it treats item difficulty as if it determines person ability theta.",
    remaining_issue: "The distinction between item difficulty and person ability remains unclear.",
    post_activity_status: "specific_misconception_remaining",
    activity_contract: {
      activity_attempt_public_id: "activity_routing_smoke",
      activity_family: "distractor_contrast",
      diagnostic_purpose: "distractor_misconception_probe",
      safe_activity_prompt: "Compare Option A with the known correct distinction.",
      expected_student_action_prompt: "Explain the exact flaw in Option A."
    },
    student_activity_response: {
      response_kind: "confused",
      safe_summary: "The student asked for clarification."
    },
    safe_item_context: [{ item_number: 2, option_label: "A", option_text: "Difficulty determines theta." }],
    latest_student_message: message,
    latest_student_message_classification: "clarification_request",
    recent_relevant_dialogue_turns: [],
    dialogue_turn_number: 2,
    maximum_dialogue_turns: 8,
    answer_reveal_state: {
      administered_answers_revealed: true,
      unadministered_answers_protected: true
    },
    available_progression_destinations: ["transfer_item", "end_assessment", "ask_question"],
    source_profile_version: "profile-v1",
    source_activity_evaluation_version: "activity-evidence-v1",
    current_topic: "theta invariance",
    assessment_system_question_scope: ["what to do next"],
    dialogue_summary: "The student is working on why Option A is tempting but incorrect.",
    progression_options: ["continue with this topic", "choose another activity"],
    source_versions: { routing_contract: FORMATIVE_DIALOGUE_ROUTING_CONTRACT_VERSION }
  };
}

for (const message of [
  "I don't understand.",
  "I still don't know what you mean.",
  "Can you explain the question?"
]) {
  const output = buildDeterministicTopicDialogueResponse(dialogueInput(message));
  assert.match(output.tutor_message, /Item 2/i);
  assert.match(output.tutor_message, /Option A/i);
  assert.match(output.tutor_message, /item difficulty|person ability|theta/i);
  assert.doesNotMatch(output.tutor_message, /ask me anything|whatever you want|general tutoring/i);
}

assert.equal(Object.keys(FORMATIVE_DIALOGUE_ROUTING_CONTRACT).length, 9);
console.log(JSON.stringify({
  status: "passed",
  routing_contract_version: FORMATIVE_DIALOGUE_ROUTING_CONTRACT_VERSION,
  routes_verified: 9,
  repeated_confusion_remains_distractor_focused: true,
  openai_calls: 0
}, null, 2));
