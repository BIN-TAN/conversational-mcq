import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyTopicDialogueReadinessGate,
  evaluateTopicDialogueReadinessGate
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
  TopicDialogueOutputV3Schema,
  topicDialogueOutputV3ToRuntimeV2,
  type TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import { e2a3TopicDialogueCases } from "@/lib/evaluation/formative/e2a3-topic-dialogue-protocol";
import { TopicDialogueInputV3Schema } from "@/lib/evaluation/formative/e2a-topic-dialogue-contract-candidate";
import {
  E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH,
  sha256
} from "@/lib/evaluation/formative/e2a4-topic-dialogue-contract";
import {
  E2A5_FAILED_V4_FILE_SHA256,
  E2A5_TOPIC_DIALOGUE_PROMPT_HASH,
  buildE2A5ProgressionAuthorization,
  detectUnauthorizedProgressionLanguage,
  evaluateE2A5Candidate,
  topicDialogueInputV3ToReadinessGateV2,
  toTopicDialogueInputV4,
  validateTopicDialogueOutputForE2A5
} from "@/lib/evaluation/formative/e2a5-topic-dialogue-progression-contract";
import {
  buildE2A5Adjudication,
  e2a5ProtectedArtifactSnapshot
} from "@/lib/evaluation/formative/e2a5-progression-adjudication";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("e2a5_no_network_allowed");
};

function output(overrides: Partial<TopicDialogueOutputV3> = {}) {
  return TopicDialogueOutputV3Schema.parse({
    dialogue_schema_version: "topic-dialogue-output-v2",
    schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3,
    tutor_message:
      "Option A confuses score consistency with evidence for a valid interpretation. What interpretation-specific evidence is still needed?",
    student_message_function: "substantive_answer",
    response_function: "focused_question",
    evidence_update: "The student identified that consistency and validity are different evidence claims.",
    remaining_issue: "The student should connect the distinction to interpretation-specific evidence.",
    post_turn_understanding: "partial",
    evidence_sufficiency: "needs_more_evidence",
    topic_relation: "current_assessment_content",
    topic_boundary: "inside_scope",
    system_question_answered: false,
    next_action: "await_topic_dialogue_response",
    next_runtime_state: "AWAIT_TOPIC_DIALOGUE_RESPONSE",
    progression_readiness: "not_ready",
    requires_student_response: true,
    expected_response_guidance: "Name one kind of evidence tied to the intended interpretation.",
    safety_flags: [],
    student_safe_summary:
      "Reliability supports consistency, while validity requires interpretation-specific evidence.",
    ...overrides
  });
}

try {
  const before = e2a5ProtectedArtifactSnapshot();
  const cases = e2a3TopicDialogueCases();
  const baseline = cases.find((entry) => entry.case_id === "e2a3_baseline_turn_3_v1");
  const repeated = cases.find((entry) => entry.case_id === "e2a3_repeated_conceptual_confusion_01");
  assert(baseline);
  assert(repeated);

  const baselineInput = toTopicDialogueInputV4({ dialogue_input: baseline.input });
  assert.equal(baselineInput.progression_authorization.authorized_action, "remain_in_dialogue");
  assert.equal(evaluateTopicDialogueReadinessGate(
    topicDialogueInputV3ToReadinessGateV2(baseline.input)
  ).ready, false);

  const blockedRevision = validateTopicDialogueOutputForE2A5({
    dialogue_input: baselineInput,
    output: output({
      tutor_message: "You are ready to continue to revision.",
      response_function: "readiness_confirmation",
      evidence_sufficiency: "sufficient_to_advance",
      next_action: "show_progression_choices",
      next_runtime_state: "SHOW_PROGRESSION_CHOICES",
      progression_readiness: "ready",
      requires_student_response: false,
      expected_response_guidance: null
    })
  });
  assert.equal(blockedRevision.valid, false);
  assert(blockedRevision.issues.some((issue) =>
    issue.rule_code === "recommendation_exceeds_authorization"
  ));
  assert(blockedRevision.issues.some((issue) =>
    issue.rule_code === "student_facing_progression_language"
  ));
  assert.equal(blockedRevision.regeneration_required, true);
  assert.equal(blockedRevision.maximum_regeneration_attempts, 1);

  for (const nextAction of ["continue_to_transfer", "end_assessment"] as const) {
    const validation = validateTopicDialogueOutputForE2A5({
      dialogue_input: baselineInput,
      output: output({
        next_action: nextAction,
        next_runtime_state: nextAction === "end_assessment"
          ? "SHOW_FINAL_SUPPORT_OPTIONS"
          : "SHOW_PROGRESSION_CHOICES",
        requires_student_response: false,
        expected_response_guidance: null
      })
    });
    assert.equal(validation.valid, false);
    assert(validation.issues.some((issue) =>
      issue.rule_code === "recommendation_exceeds_authorization"
    ));
  }

  const safeRemain = output();
  const safeRemainValidation = validateTopicDialogueOutputForE2A5({
    dialogue_input: baselineInput,
    output: safeRemain
  });
  assert.equal(safeRemainValidation.valid, true);
  assert.equal(safeRemain.next_action, "await_topic_dialogue_response");
  assert.equal(detectUnauthorizedProgressionLanguage(
    "When you are ready, explain which interpretation-specific claim remains unsupported.",
    baselineInput.progression_authorization
  ).length, 0);

  const existingGate = applyTopicDialogueReadinessGate({
    dialogue_input: topicDialogueInputV3ToReadinessGateV2(baseline.input),
    candidate_output: topicDialogueOutputV3ToRuntimeV2(blockedRevision.output ?? output())
  });
  assert.equal(existingGate.overridden, true);
  assert.equal(existingGate.output.next_action, "await_topic_dialogue_response");
  assert.equal(existingGate.output.next_runtime_state, "AWAIT_TOPIC_DIALOGUE_RESPONSE");
  assert.equal(existingGate.output.progression_readiness, "not_ready");
  assert.equal(existingGate.output.requires_student_response, true);
  assert(existingGate.output.tutor_message.length > 0);
  assert.equal(
    detectUnauthorizedProgressionLanguage(
      existingGate.output.tutor_message,
      baselineInput.progression_authorization
    ).length,
    0
  );

  const repeatedInput = toTopicDialogueInputV4({ dialogue_input: repeated.input });
  const repeatedDirect = validateTopicDialogueOutputForE2A5({
    dialogue_input: repeatedInput,
    output: output({
      tutor_message:
        "The missing evidence must connect the scores to the intended interpretation, not only show consistency. Which interpretation-specific claim would you test next?",
      student_message_function: "conceptual_question",
      response_function: "answer_student_question"
    })
  });
  assert.equal(repeatedDirect.valid, true);

  const unsupportedInputV3 = TopicDialogueInputV3Schema.parse({
    ...baseline.input,
    latest_student_message: "I understand."
  });
  const unsupportedInput = toTopicDialogueInputV4({ dialogue_input: unsupportedInputV3 });
  const unsupportedProgression = validateTopicDialogueOutputForE2A5({
    dialogue_input: unsupportedInput,
    output: output({
      tutor_message: "You are ready to continue.",
      response_function: "readiness_confirmation",
      evidence_sufficiency: "sufficient_to_advance",
      next_action: "show_progression_choices",
      next_runtime_state: "SHOW_PROGRESSION_CHOICES",
      progression_readiness: "ready",
      requires_student_response: false,
      expected_response_guidance: null
    })
  });
  assert.equal(unsupportedProgression.valid, false);
  assert(unsupportedProgression.issues.some((issue) =>
    issue.rule_code === "unsupported_understanding_treated_as_mastery"
  ));

  const readyV3 = TopicDialogueInputV3Schema.parse({
    ...baseline.input,
    post_activity_status: "ready_to_advance"
  });
  assert.equal(evaluateTopicDialogueReadinessGate(
    topicDialogueInputV3ToReadinessGateV2(readyV3)
  ).ready, true);
  const revisionInput = toTopicDialogueInputV4({
    dialogue_input: readyV3,
    requested_authorized_action: "request_revision"
  });
  assert.equal(revisionInput.progression_authorization.revision_authorized, true);
  assert.equal(validateTopicDialogueOutputForE2A5({
    dialogue_input: revisionInput,
    output: output({
      tutor_message:
        "Your explanation now separates consistency from validity. Revise the claim in option A so it states only what reliability supports.",
      response_function: "readiness_confirmation",
      evidence_sufficiency: "sufficient_to_advance",
      next_action: "show_progression_choices",
      next_runtime_state: "SHOW_PROGRESSION_CHOICES",
      progression_readiness: "ready",
      requires_student_response: false,
      expected_response_guidance: null
    })
  }).valid, true);

  const transferInput = toTopicDialogueInputV4({
    dialogue_input: readyV3,
    requested_authorized_action: "present_transfer"
  });
  assert.equal(transferInput.progression_authorization.transfer_authorized, true);
  assert.equal(validateTopicDialogueOutputForE2A5({
    dialogue_input: transferInput,
    output: output({
      tutor_message:
        "Use the same reliability-validity distinction in the transfer item.",
      response_function: "readiness_confirmation",
      evidence_sufficiency: "sufficient_to_advance",
      next_action: "continue_to_transfer",
      next_runtime_state: "SHOW_PROGRESSION_CHOICES",
      progression_readiness: "ready",
      requires_student_response: false,
      expected_response_guidance: null
    })
  }).valid, true);

  const authorization = buildE2A5ProgressionAuthorization({
    dialogue_input: baseline.input,
    requested_authorized_action: "complete_episode"
  });
  assert.equal(authorization.authorized_action, "remain_in_dialogue");
  assert.equal(authorization.completion_authorized, false);

  const adjudication = buildE2A5Adjudication();
  assert.equal(adjudication.caseEvidence.length, 2);
  assert.equal(adjudication.candidateDecision.selected_path,
    "path_c_model_output_or_student_facing_contract_defect");
  assert.equal(adjudication.candidateDecision.v5_required, true);
  assert(adjudication.caseEvidence.every((entry) =>
    entry.proposed_adjudication.platform_transition === "none_executed"
  ));
  const baselineEvidence = adjudication.caseEvidence.find((entry) =>
    entry.case_id === baseline.case_id
  );
  assert(baselineEvidence?.proposed_adjudication.classifications.includes(
    "student_facing_progression_language"
  ));
  const repeatedEvidence = adjudication.caseEvidence.find((entry) =>
    entry.case_id === repeated.case_id
  );
  assert.equal(repeatedEvidence?.proposed_adjudication.direct_response_function,
    "deterministic_check_false_positive");
  assert.equal(adjudication.humanReviewSummary.human_decisions, null);
  assert.equal(adjudication.humanReviewSummary.human_scores, null);

  const candidateFirst = evaluateE2A5Candidate();
  const candidateSecond = evaluateE2A5Candidate();
  assert.equal(candidateFirst.candidate_configuration_hash,
    candidateSecond.candidate_configuration_hash);
  assert.equal(Object.keys(candidateFirst.role_config_hashes).length, 17);
  assert.equal(candidateFirst.approved, false);
  assert.equal(candidateFirst.activated, false);
  assert.equal(candidateFirst.full_candidate.configuration_fingerprint
    .role_version_metadata.topic_dialogue_agent?.prompt_hash,
  E2A5_TOPIC_DIALOGUE_PROMPT_HASH);
  assert.equal(
    sha256(readFileSync(E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH)),
    E2A5_FAILED_V4_FILE_SHA256
  );
  assert.equal(
    sha256(readFileSync(path.join(process.cwd(), "config", "candidate-operational-agent-config.e2a2-topic-dialogue-contract-v1.json"))),
    "1c8ac4e1400fb68b22133a157ec856f6b2ce64a701cd50055e6a3c83d6306bde"
  );
  const after = e2a5ProtectedArtifactSnapshot();
  assert.equal(after.aggregate_sha256, before.aggregate_sha256);
  assert.equal(networkCalls, 0);

  console.log(JSON.stringify({
    status: "passed",
    candidate_hash: candidateFirst.candidate_configuration_hash,
    candidate_file_sha256: candidateFirst.candidate_file_sha256,
    case_count: adjudication.caseEvidence.length,
    selected_path: adjudication.candidateDecision.selected_path,
    original_v4_outputs_rejected_by_v5: true,
    direct_response_false_positive_corrected: true,
    protected_artifacts_unchanged: true,
    provider_calls: networkCalls
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
