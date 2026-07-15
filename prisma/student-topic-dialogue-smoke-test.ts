import assert from "node:assert/strict";
import {
  buildDeterministicTopicDialogueResponse,
  buildPostActivityLearningDecision,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
  TopicDialogueInputV1Schema,
  topicDialoguePublicId,
  validateTopicDialogueOutput
} from "../src/lib/services/student-assessment/topic-dialogue-agent";
import {
  buildNoLiveActivityMisconceptionEvidenceFixture,
  type MisconceptionUpdateStatus
} from "../src/lib/services/student-assessment/activity-misconception-evidence";

function packet(status: MisconceptionUpdateStatus, responseSummary = "The response partially explains the boundary.") {
  return buildNoLiveActivityMisconceptionEvidenceFixture({
    case_id: `topic_${status}`,
    activity_family: "distractor_contrast",
    selected_formative_value: "reasoning_refinement",
    profile_condition: "topic_dialogue_fixture",
    source_diagnostic_purpose: "distractor_misconception_probe",
    response_kind: responseSummary.length < 20 ? "low_information" : "partial",
    response_length_band: responseSummary.length < 20 ? "very_short" : "medium",
    response_summary: responseSummary,
    primary_target: "target_boundary",
    evidence_types: status === "insufficient_new_evidence" ? ["none"] : ["target_boundary_explained"],
    update_status: status,
    evidence_quality: status === "insufficient_new_evidence" ? "insufficient" : "medium",
    safe_internal_rationale: "Reliability and validity still need a clearer boundary."
  });
}

function dialogueInput(input: {
  status: MisconceptionUpdateStatus;
  latestMessage: string;
  turnNumber?: number;
}) {
  const evidencePacket = packet(input.status, input.latestMessage);
  const dialoguePublicId = topicDialoguePublicId({
    session_public_id: "sess_topic_dialogue",
    activity_attempt_public_id: "act_attempt_topic_dialogue"
  });
  const decision = buildPostActivityLearningDecision({
    activity_public_id: "act_attempt_topic_dialogue",
    growth_target: "explain why consistency alone is not enough for validity",
    evidence_packet: evidencePacket,
    maximum_dialogue_turns: 3
  });

  return TopicDialogueInputV1Schema.parse({
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
    dialogue_public_id: dialoguePublicId,
    session_public_id: "sess_topic_dialogue",
    assessment_public_id: "assessment_fixed_irt",
    concept_public_id: "concept_reliability_validity",
    assessment_topic: "Reliability and validity",
    concept_definition: "Reliability concerns consistency; validity concerns evidence for interpretation.",
    allowed_topic_scope: [
      "Reliability and validity",
      "Reliability concerns consistency; validity concerns evidence for interpretation.",
      decision.growth_target
    ],
    prohibited_scope: ["unrelated topics", "unadministered answers", "teacher notes"],
    frozen_growth_target: decision.growth_target,
    remaining_issue: decision.remaining_issue,
    post_activity_status: decision.post_activity_status,
    activity_contract: {
      activity_attempt_public_id: "act_attempt_topic_dialogue",
      activity_family: "distractor_contrast",
      diagnostic_purpose: "distractor_misconception_probe",
      safe_activity_prompt: "For Item 2, explain why reliability alone does not prove validity.",
      expected_student_action_prompt: "Write one or two sentences."
    },
    student_activity_response: {
      response_kind: evidencePacket.student_activity_response.response_kind,
      safe_summary: evidencePacket.student_activity_response.student_response_text_redacted_or_safe_summary
    },
    safe_item_context: [{
      item_number: 2,
      option_label: "A",
      option_text: "Reliability alone proves validity."
    }],
    latest_student_message: input.latestMessage,
    recent_relevant_dialogue_turns: [],
    dialogue_turn_number: input.turnNumber ?? 1,
    maximum_dialogue_turns: 3,
    answer_reveal_state: {
      administered_answers_revealed: true,
      unadministered_answers_protected: true
    },
    available_progression_destinations: ["transfer_item", "next_topic", "end_assessment", "ask_question"],
    source_profile_version: "evidence-integrated-profile-v2",
    source_activity_evaluation_version: evidencePacket.schema_version
  });
}

const readyDecision = buildPostActivityLearningDecision({
  activity_public_id: "act_ready",
  growth_target: "explain the reliability-validity boundary",
  evidence_packet: packet("independent_evidence_supported"),
  maximum_dialogue_turns: 3
});
assert.equal(readyDecision.post_activity_status, "ready_to_advance");
assert.equal(readyDecision.recommended_route, "show_progression_choices");

for (const status of [
  "conceptual_entry_gap_remains",
  "misconception_persisted",
  "misconception_weakened",
  "insufficient_new_evidence"
] as const) {
  const decision = buildPostActivityLearningDecision({
    activity_public_id: `act_${status}`,
    growth_target: "explain why consistency alone is not enough for validity",
    evidence_packet: packet(status),
    maximum_dialogue_turns: 3
  });
  assert.notEqual(decision.post_activity_status, "ready_to_advance", `${status}: should not skip support.`);
}

const focused = buildDeterministicTopicDialogueResponse(dialogueInput({
  status: "misconception_persisted",
  latestMessage: "I think reliability proves validity because the score is consistent."
}));
assert.equal(focused.next_action, "await_topic_dialogue_response");
assert.equal(focused.topic_boundary, "inside_scope");
assert.equal(validateTopicDialogueOutput(focused).valid, true);

const resolved = buildDeterministicTopicDialogueResponse(dialogueInput({
  status: "misconception_weakened",
  latestMessage: "Now I understand that reliability is consistency, but validity needs evidence for interpretation."
}));
assert.equal(resolved.next_action, "show_progression_choices");
assert.equal(resolved.progression_readiness, "ready");

const offTopic = buildDeterministicTopicDialogueResponse(dialogueInput({
  status: "insufficient_new_evidence",
  latestMessage: "What movie should I watch tonight?"
}));
assert.equal(offTopic.response_function, "topic_redirect");
assert.equal(offTopic.topic_boundary, "redirected_to_topic");
assert.doesNotMatch(offTopic.tutor_message, /movie/i);

const atLimit = buildDeterministicTopicDialogueResponse(dialogueInput({
  status: "reasoning_boundary_still_blurred",
  latestMessage: "I am still not sure.",
  turnNumber: 3
}));
assert.equal(atLimit.next_action, "show_final_support_options");

assert.equal(
  topicDialoguePublicId({
    session_public_id: "sess_topic_dialogue",
    activity_attempt_public_id: "act_attempt_topic_dialogue"
  }),
  topicDialoguePublicId({
    session_public_id: "sess_topic_dialogue",
    activity_attempt_public_id: "act_attempt_topic_dialogue"
  }),
  "dialogue public ID should be stable for idempotent recovery"
);

for (const output of [focused, resolved, offTopic, atLimit]) {
  const text = JSON.stringify(output);
  assert.doesNotMatch(text, /\b(answer key|system prompt|raw model output|api key|cheating|misconduct)\b/i);
}

console.log(JSON.stringify({
  status: "passed",
  smoke: "student-topic-dialogue",
  openai_calls: 0
}, null, 2));
