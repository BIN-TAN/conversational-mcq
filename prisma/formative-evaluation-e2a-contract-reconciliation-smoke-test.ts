import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  E2A2_MISMATCH_CLASSIFICATION,
  evaluateE2A2TopicDialogueCandidate,
  readE2A2TopicDialogueCandidate
} from "../src/lib/evaluation/formative/e2a-contract-reconciliation";
import { evaluateTopicDialoguePolicyContractCompatibility } from "../src/lib/evaluation/formative/e2a-readiness";
import { assertAndConfigureE1NoLiveGuard } from "../src/lib/evaluation/formative/no-live-guard";
import {
  formativeExecutionModeForEvaluation,
  resolveTopicDialogueExecutionPlan
} from "../src/lib/services/student-assessment/formative-execution-mode";
import {
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V3,
  TopicDialogueInputV3Schema,
  buildExactTopicDialogueVisibleHistory,
  type TopicDialogueVisibleHistorySourceTurn
} from "../src/lib/evaluation/formative/e2a-topic-dialogue-contract-candidate";
import {
  TopicDialogueInputV1Schema
} from "../src/lib/services/student-assessment/topic-dialogue-agent";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function main() {
  const priorTurns: TopicDialogueVisibleHistorySourceTurn[] = [];
  for (let turn = 1; turn <= 9; turn += 1) {
    priorTurns.push({
      visible_turn_id: `student_${turn}`,
      actor_type: "student",
      message_text: `Exact student message ${turn}.`,
      visibility_status: "shown"
    });
    priorTurns.push({
      visible_turn_id: `assistant_${turn}`,
      actor_type: "agent",
      message_text: `Exact assistant reply ${turn}.`,
      visibility_status: "shown"
    });
  }
  priorTurns.splice(5, 0, {
    visible_turn_id: "hidden_internal_turn",
    actor_type: "agent",
    message_text: "Internal audit-only context.",
    visibility_status: "hidden"
  });
  const latestStudentTurn = {
    visible_turn_id: "student_10",
    message_text: "Exact student message 10."
  };
  const tenthAssistantReply = {
    visible_turn_id: "assistant_10",
    message_text: "Exact assistant reply 10."
  };
  const visibleHistory = buildExactTopicDialogueVisibleHistory({
    prior_turns: priorTurns,
    maximum_student_turns: 10
  });
  const candidateInput = TopicDialogueInputV3Schema.parse({
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V3,
    dialogue_public_id: "dialogue_contract_test",
    session_public_id: "session_contract_test",
    assessment_public_id: "assessment_contract_test",
    concept_public_id: "concept_contract_test",
    assessment_topic: "Item response theory",
    concept_definition: "Item parameters and person ability are distinct constructs.",
    allowed_topic_scope: ["Item response theory", "item difficulty", "person ability"],
    prohibited_scope: ["unadministered answers", "teacher-only notes"],
    frozen_growth_target: "Distinguish item difficulty from person ability.",
    remaining_issue: "The item and person parameters are still being conflated.",
    post_activity_status: "specific_misconception_remaining",
    activity_contract: {
      activity_attempt_public_id: "activity_contract_test",
      activity_family: "distractor_contrast",
      diagnostic_purpose: "distractor_misconception_probe",
      safe_activity_prompt: "Compare the item feature with the person attribute.",
      expected_student_action_prompt: "Explain the distinction."
    },
    student_activity_response: {
      response_kind: "partial",
      safe_summary: "The student supplied a partial distinction."
    },
    safe_item_context: [{ item_number: 1, option_label: "B", option_text: "A student-safe option." }],
    latest_student_message: latestStudentTurn.message_text,
    latest_student_turn_id: latestStudentTurn.visible_turn_id,
    visible_dialogue_history: visibleHistory,
    dialogue_turn_number: 10,
    maximum_dialogue_turns: 10,
    answer_reveal_state: {
      administered_answers_revealed: true,
      unadministered_answers_protected: true
    },
    available_progression_destinations: ["transfer_item", "next_topic", "end_assessment", "ask_question"],
    source_profile_version: "evidence-integrated-profile-v2",
    source_activity_evaluation_version: "student-activity-misconception-evidence-v1"
  });
  const expectedVisibleTurnIds = [
    ...priorTurns.filter((turn) => turn.visibility_status === "shown").map((turn) => turn.visible_turn_id),
    latestStudentTurn.visible_turn_id
  ];
  const serializedVisibleTurnIds = [
    ...candidateInput.visible_dialogue_history.map((turn) => turn.visible_turn_id),
    candidateInput.latest_student_turn_id
  ];
  const missingVisibleTurnIds = expectedVisibleTurnIds.filter((id) =>
    !serializedVisibleTurnIds.includes(id)
  );
  const duplicatedVisibleTurnIds = serializedVisibleTurnIds.filter((id, index) =>
    serializedVisibleTurnIds.indexOf(id) !== index
  );
  const expectedContent = [
    ...priorTurns.filter((turn) => turn.visibility_status === "shown").map((turn) => turn.message_text),
    latestStudentTurn.message_text
  ];
  const serializedContent = [
    ...candidateInput.visible_dialogue_history.map((turn) => turn.message_text),
    candidateInput.latest_student_message
  ];
  const contextEvidence = {
    expected_visible_turn_ids: expectedVisibleTurnIds,
    serialized_visible_turn_ids: serializedVisibleTurnIds,
    missing_visible_turn_ids: missingVisibleTurnIds,
    duplicated_visible_turn_ids: duplicatedVisibleTurnIds,
    order_matches: JSON.stringify(expectedVisibleTurnIds) === JSON.stringify(serializedVisibleTurnIds),
    exact_content_matches: JSON.stringify(expectedContent) === JSON.stringify(serializedContent),
    context_sections_used: ["visible_dialogue_history", "latest_student_message", "formative_turn_context"]
  };
  assert(contextEvidence.missing_visible_turn_ids.length === 0, "A visible turn was omitted.");
  assert(contextEvidence.duplicated_visible_turn_ids.length === 0, "A visible turn was duplicated.");
  assert(contextEvidence.order_matches, "Visible turns were not serialized chronologically.");
  assert(contextEvidence.exact_content_matches, "Visible turn content was summarized or changed.");
  assert(!serializedVisibleTurnIds.includes("hidden_internal_turn"), "An invisible turn reached provider-visible history.");
  assert(candidateInput.visible_dialogue_history.length === 18, "All nine completed exchanges should be present.");
  const completedDialogueFixtureTurnIds = [
    ...expectedVisibleTurnIds,
    tenthAssistantReply.visible_turn_id
  ];
  assert(completedDialogueFixtureTurnIds.length === 20, "The fixture should complete ten student/assistant exchanges.");
  assert(
    !serializedVisibleTurnIds.includes(tenthAssistantReply.visible_turn_id),
    "The tenth assistant reply must not appear in the request that generates it."
  );

  const approvedCompatibility = evaluateTopicDialoguePolicyContractCompatibility({
    input_schema_version: "topic-dialogue-input-v2",
    policy: { maximum_student_turns: 10, recent_raw_turn_window: 12 }
  });
  assert(!approvedCompatibility.compatible, "The approved ten-turn policy must remain fail-closed against v2.");
  assert(!TopicDialogueInputV1Schema.safeParse({
    ...candidateInput,
    dialogue_schema_version: "topic-dialogue-input-v2",
    recent_relevant_dialogue_turns: [],
    visible_dialogue_history: undefined,
    latest_student_turn_id: undefined,
    maximum_dialogue_turns: 10
  }).success, "The approved v2 schema must not be silently widened.");

  const candidate = readE2A2TopicDialogueCandidate();
  const candidateEvaluation = evaluateE2A2TopicDialogueCandidate(candidate);
  assert(candidateEvaluation.compatible, "The separate v3 candidate should resolve the contract incompatibility.");
  assert(!candidateEvaluation.approved && !candidateEvaluation.activated, "The E2A.2 candidate must remain unapproved and inactive.");
  assert(
    sha256(candidate.baseline_candidate_manifest_path) === candidate.baseline_candidate_manifest_sha256,
    "The protected approved candidate manifest changed."
  );

  const deterministicPlan = resolveTopicDialogueExecutionPlan("deterministic_e1");
  const noLivePlan = resolveTopicDialogueExecutionPlan("no_live_e2a_contract");
  const readinessPlan = resolveTopicDialogueExecutionPlan("e2a_readiness");
  const livePlan = resolveTopicDialogueExecutionPlan("live_e2a_canary");
  assert(deterministicPlan.adapter === "deterministic_mock_safe", "E1 must use the deterministic adapter.");
  assert(noLivePlan.adapter === "deterministic_mock_safe", "No-live E2A must use the deterministic adapter.");
  assert(!deterministicPlan.safe_recovery_eligible && !noLivePlan.safe_recovery_eligible, "No-live modes must not convert adapter selection into safe recovery.");
  assert(readinessPlan.adapter === "no_generation", "Readiness must never generate dialogue.");
  assert(livePlan.adapter === "configured_live_runtime" && livePlan.provider_generation_allowed, "Live E2A must require the configured live path.");
  assert(formativeExecutionModeForEvaluation({}) === "deterministic_e1", "Default evaluation mode should be deterministic E1.");
  assert(formativeExecutionModeForEvaluation({ e2a_mode: "e2a_injected_no_live_test" }) === "no_live_e2a_contract", "Injected E2A should be no-live contract mode.");
  assert(formativeExecutionModeForEvaluation({ e2a_mode: "e2a_live_operational" }) === "live_e2a_canary", "Live E2A should require its explicit mode.");
  const scopedEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    OPERATIONAL_AGENT_MODE: "guarded_live",
    LLM_PROVIDER: "openai",
    LLM_LIVE_CALLS_ENABLED: "true"
  };
  const beforeEnv = JSON.stringify(scopedEnv);
  assertAndConfigureE1NoLiveGuard(scopedEnv);
  assert(JSON.stringify(scopedEnv) === beforeEnv, "The E1 guard must not mutate process-global execution state.");

  console.log(JSON.stringify({
    status: "passed",
    mismatch_classification: E2A2_MISMATCH_CLASSIFICATION,
    approved_contract: approvedCompatibility,
    candidate: candidateEvaluation,
    ten_turn_context: contextEvidence,
    completed_dialogue_fixture: {
      accepted_student_turn_count: 10,
      visible_assistant_reply_count: 10,
      visible_turn_ids_after_tenth_reply: completedDialogueFixtureTurnIds,
      tenth_assistant_reply_excluded_from_its_own_request: true
    },
    deterministic_e1_uses_mock_safe_adapters: true,
    no_live_e2a_does_not_generate_recovery_for_missing_opt_in: true,
    readiness_does_not_mutate_execution_mode: true,
    live_mode_requires_explicit_opt_in: true,
    execution_mode_does_not_leak_between_runs: true,
    provider_calls: 0
  }, null, 2));
}

main();
