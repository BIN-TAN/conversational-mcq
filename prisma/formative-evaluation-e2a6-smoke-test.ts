import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  classifyTopicDialogueStudentMessage
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  applyCanonicalTopicDialogueActionGate,
  isTopicDialogueAuthorizationSummarySafe,
  normalizeTopicDialogueProgressionAction,
  topicDialogueAuthorizationAuditProjection,
  type TopicDialogueProgressionAuthorization
} from "@/lib/services/student-assessment/topic-dialogue-action-normalization";
import {
  TopicDialogueOutputV3Schema,
  topicDialogueOutputV3ToRuntimeV2,
  type TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  e2a3TopicDialogueCases
} from "@/lib/evaluation/formative/e2a3-topic-dialogue-protocol";
import {
  E2A5_TOPIC_DIALOGUE_PROMPT_HASH,
  TopicDialogueInputV4Schema,
  evaluateE2A5Candidate,
  topicDialogueInputV3ToReadinessGateV2,
  topicDialogueInputV4ToV3,
  toTopicDialogueInputV4,
  validateTopicDialogueOutputForE2A5,
  type TopicDialogueInputV4
} from "@/lib/evaluation/formative/e2a5-topic-dialogue-progression-contract";
import {
  E2A4_FAILED_RUN_DIR,
  e2a5ProtectedArtifactSnapshot
} from "@/lib/evaluation/formative/e2a5-progression-adjudication";
import {
  E2A6_CANDIDATE_FILE_SHA256,
  E2A6_CANDIDATE_HASH,
  executeE2A6V5TopicDialogueEvaluation,
  temporaryE2A6ArtifactRoot
} from "@/lib/evaluation/formative/e2a6-v5-topic-dialogue-evaluation";
import {
  buildE2A6AllRoleSchemaAudit,
  compileE2A6CandidateRequestsNoNetwork
} from "@/lib/evaluation/formative/e2a6-v5-request-compilation";
import {
  e2a6DispatchCanaryCases,
  e2a6FullProtocolCases
} from "@/lib/evaluation/formative/e2a6-v5-topic-dialogue-protocol";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("e2a6_no_network_allowed");
};

function authorization(
  authorizedAction: TopicDialogueProgressionAuthorization["authorized_action"]
): TopicDialogueProgressionAuthorization {
  return {
    authorization_version: "topic-dialogue-progression-authorization-v1",
    revision_authorized: authorizedAction === "request_revision",
    transfer_authorized: authorizedAction === "present_transfer",
    completion_authorized: authorizedAction === "complete_episode",
    authorized_action: authorizedAction,
    authorization_evidence_summary: authorizedAction === "remain_in_dialogue"
      ? "Server evidence requires continued topic dialogue."
      : "Server evidence permits the requested bounded progression action."
  };
}

function outputForInput(input: TopicDialogueInputV4): TopicDialogueOutputV3 {
  const classification = classifyTopicDialogueStudentMessage(
    input.latest_student_message
  );
  const action = input.progression_authorization.authorized_action;
  const nextAction = action === "request_revision"
    ? "show_progression_choices"
    : action === "present_transfer"
      ? "continue_to_transfer"
      : action === "complete_episode"
        ? "end_assessment"
        : "await_topic_dialogue_response";
  const responseFunction = action !== "remain_in_dialogue"
    ? "readiness_confirmation"
    : classification.student_message_function === "conceptual_question" ||
        classification.student_message_function === "assessment_system_question"
      ? "answer_student_question"
      : classification.student_message_function === "off_topic"
        ? "topic_redirect"
        : classification.student_message_function === "clarification_request" ||
            classification.student_message_function === "prompt_instruction_question" ||
            classification.student_message_function === "unclear_but_valid"
          ? "clarification"
          : "focused_question";
  const tutorMessage = action === "request_revision"
    ? "Revise option A so it states that reliability supports score consistency without claiming that validity is proved."
    : action === "present_transfer"
      ? "Use the same reliability-validity distinction in the transfer item; transfer evidence is a separate check."
      : action === "complete_episode"
        ? "This assessment episode is complete under the platform's current authorization."
        : classification.student_message_function === "conceptual_question"
          ? "Reliability shows score consistency, while validity needs evidence for the intended interpretation. Which interpretation-specific claim remains unsupported by option A?"
          : "Option A still overreaches from reliability to validity. What interpretation-specific evidence would be needed beyond score consistency?";
  return TopicDialogueOutputV3Schema.parse({
    dialogue_schema_version: "topic-dialogue-output-v2",
    schema_version: "topic-dialogue-output-v3",
    tutor_message: tutorMessage,
    student_message_function: classification.student_message_function,
    response_function: responseFunction,
    evidence_update: "The response remains anchored to the reliability-validity distinction in option A.",
    remaining_issue: action === "remain_in_dialogue"
      ? "The student should provide interpretation-specific evidence."
      : "The authorized platform action is now available.",
    post_turn_understanding: action === "remain_in_dialogue"
      ? "partial"
      : "sound_or_strong",
    evidence_sufficiency: action === "remain_in_dialogue"
      ? "needs_more_evidence"
      : "sufficient_to_advance",
    topic_relation: classification.topic_relation,
    topic_boundary: classification.student_message_function === "off_topic"
      ? "redirected_to_topic"
      : "inside_scope",
    system_question_answered:
      classification.student_message_function === "assessment_system_question",
    next_action: nextAction,
    next_runtime_state: nextAction === "await_topic_dialogue_response"
      ? "AWAIT_TOPIC_DIALOGUE_RESPONSE"
      : nextAction === "end_assessment"
        ? "SHOW_FINAL_SUPPORT_OPTIONS"
        : "SHOW_PROGRESSION_CHOICES",
    progression_readiness: action === "remain_in_dialogue" ? "not_ready" : "ready",
    requires_student_response: action === "remain_in_dialogue",
    expected_response_guidance: action === "remain_in_dialogue"
      ? "Explain the interpretation-specific evidence still needed."
      : null,
    safety_flags: [],
    student_safe_summary:
      "Reliability concerns consistency; validity requires evidence for an intended interpretation."
  });
}

class NoNetworkPassingProvider implements LlmProvider {
  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const input = TopicDialogueInputV4Schema.parse(request.input);
    const firstBoundedRepairAttempt =
      request.client_request_id.includes(
        "e2a6_canary_remain_unsupported_understanding"
      ) && request.client_request_id.endsWith("_1");
    const output = outputForInput(input);
    const parsed = request.output_schema.parse(firstBoundedRepairAttempt
      ? {
          ...output,
          tutor_message:
            "You are ready to revise option A and continue to the next step.",
          response_function: "readiness_confirmation",
          evidence_sufficiency: "sufficient_to_advance",
          next_action: "show_progression_choices",
          next_runtime_state: "SHOW_PROGRESSION_CHOICES",
          progression_readiness: "ready",
          requires_student_response: false,
          expected_response_guidance: null
        }
      : output);
    return {
      provider: "openai",
      provider_request_id: `test_req_${request.client_request_id}`,
      provider_response_id: `test_resp_${request.client_request_id}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: parsed,
      usage: {
        input_tokens: 100,
        output_tokens: 80,
        reasoning_tokens: 20,
        total_tokens: 200
      },
      latency_ms: 10,
      transport_telemetry: {
        provider: "openai",
        transport: "openai_responses",
        adapter_version: "injected-no-network-provider",
        client_request_id: request.client_request_id,
        model_name: request.model_config.model_name,
        base_url_host: "loopback.test",
        base_url_approved: true,
        transport_adapter_entered: true,
        request_serialization_completed: true,
        fetch_invoked: true,
        response_headers_received: true,
        response_body_received: true
      }
    };
  }
}

function readV4Outputs() {
  return readFileSync(path.join(E2A4_FAILED_RUN_DIR, "provider-outputs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as {
      case_id: string;
      parsed_validated_output: TopicDialogueOutputV3;
    });
}

async function main() {
  const tempRoot = temporaryE2A6ArtifactRoot();

  try {
  const protectedBefore = e2a5ProtectedArtifactSnapshot();
  const candidate = evaluateE2A5Candidate();
  assert.equal(candidate.candidate_configuration_hash, E2A6_CANDIDATE_HASH);
  assert.equal(candidate.candidate_file_sha256, E2A6_CANDIDATE_FILE_SHA256);
  assert.equal(candidate.full_candidate.configuration_fingerprint
    .role_version_metadata.topic_dialogue_agent?.prompt_hash,
  E2A5_TOPIC_DIALOGUE_PROMPT_HASH);

  assert.equal(normalizeTopicDialogueProgressionAction({
    provider_action: "show_progression_choices",
    authorization: authorization("remain_in_dialogue")
  }).status, "rejected_unauthorized");
  assert.equal(normalizeTopicDialogueProgressionAction({
    provider_action: "show_final_support_options",
    authorization: authorization("remain_in_dialogue")
  }).status, "rejected_obsolete");
  assert.equal(normalizeTopicDialogueProgressionAction({
    provider_action: "unknown_action",
    authorization: authorization("remain_in_dialogue")
  }).status, "rejected_unknown");
  assert.equal(normalizeTopicDialogueProgressionAction({
    provider_action: "continue_to_transfer",
    authorization: authorization("request_revision")
  }).effective_action, "remain_in_dialogue");
  assert.equal(normalizeTopicDialogueProgressionAction({
    provider_action: "show_progression_choices",
    authorization: authorization("request_revision")
  }).effective_action, "request_revision");
  assert.equal(normalizeTopicDialogueProgressionAction({
    provider_action: "continue_to_transfer",
    authorization: authorization("present_transfer")
  }).effective_action, "present_transfer");
  assert.equal(normalizeTopicDialogueProgressionAction({
    provider_action: "end_assessment",
    authorization: authorization("complete_episode")
  }).effective_action, "complete_episode");
  assert.equal(isTopicDialogueAuthorizationSummarySafe(
    "Profile status ready_to_advance from provider metadata."
  ), false);

  for (const value of [
    authorization("remain_in_dialogue"),
    authorization("request_revision"),
    authorization("present_transfer"),
    authorization("complete_episode")
  ]) {
    assert.equal(isTopicDialogueAuthorizationSummarySafe(
      value.authorization_evidence_summary
    ), true);
  }

  const sourceCases = e2a3TopicDialogueCases();
  const strictOutput = outputForInput(e2a6DispatchCanaryCases()[0]!.input);
  assert.equal(TopicDialogueOutputV3Schema.safeParse({
    ...strictOutput,
    progression_authorization: authorization("complete_episode")
  }).success, false);
  for (const record of readV4Outputs()) {
    const source = sourceCases.find((entry) => entry.case_id === record.case_id);
    assert(source);
    const input = toTopicDialogueInputV4({ dialogue_input: source.input });
    const candidateResult = validateTopicDialogueOutputForE2A5({
      output: record.parsed_validated_output,
      dialogue_input: input
    });
    const platformResult = applyCanonicalTopicDialogueActionGate({
      dialogue_input: topicDialogueInputV3ToReadinessGateV2(
        topicDialogueInputV4ToV3(input)
      ),
      candidate_output: topicDialogueOutputV3ToRuntimeV2(
        record.parsed_validated_output
      ),
      authorization: input.progression_authorization
    });
    assert.equal(candidateResult.valid, false);
    assert.equal(platformResult.rejected, true);
    assert.equal(platformResult.activity_active, true);
    assert.equal(platformResult.output.next_action, "await_topic_dialogue_response");
    assert(platformResult.output.tutor_message.length > 0);
    assert(!JSON.stringify(platformResult.output).includes("authorization_version"));
    assert.equal(topicDialogueAuthorizationAuditProjection(
      input.progression_authorization
    ).authorization_version, "topic-dialogue-progression-authorization-v1");
  }

  const schemaAudit = buildE2A6AllRoleSchemaAudit();
  assert.equal(schemaAudit.role_count, 17);
  assert.equal(schemaAudit.all_candidate_role_schemas_compile, true);
  const compilation = await compileE2A6CandidateRequestsNoNetwork(
    path.join(tempRoot, "compilation.json")
  );
  assert.equal(compilation.artifact.role_count, 17);
  assert.equal(compilation.artifact.all_requests_ready_for_dispatch, true);
  assert.equal(compilation.artifact.network_request_count, 0);
  assert.equal(compilation.artifact.selected_input_schema_version,
    "topic-dialogue-input-v4");
  assert.equal(compilation.artifact.selected_output_schema_version,
    "topic-dialogue-output-v3");
  assert.equal(compilation.artifact.selected_validator_version,
    "eval-topic-boundary-v4");

  assert.equal(e2a6DispatchCanaryCases().length, 5);
  assert.equal(e2a6FullProtocolCases().length, 30);
  assert.equal(e2a6FullProtocolCases().filter((entry) => entry.tenth_turn).length, 18);

  const evaluation = await executeE2A6V5TopicDialogueEvaluation({
    provider: new NoNetworkPassingProvider(),
    live: false,
    artifactRoot: tempRoot,
    skipProtectedSnapshotForTest: true
  });
  assert.equal(
    evaluation.canary.passed,
    true,
    JSON.stringify(evaluation.canary, null, 2)
  );
  assert.equal(evaluation.summary.full_protocol_executed, true);
  assert.equal(evaluation.summary.case_counts.dispatch_canary_completed, 5);
  assert.equal(evaluation.summary.case_counts.full_protocol_completed, 30);
  assert.equal(evaluation.summary.context_coverage.tenth_turn_passed, 18);
  assert.equal(evaluation.summary.candidate_regeneration_count, 1);
  assert.equal(evaluation.summary.candidate_validation_failure_count, 1);
  assert.equal(evaluation.summary.provider_usage.generation_provider_calls, 36);
  assert.equal(evaluation.manifest.generation_call_count, 36);
  assert.equal(evaluation.summary.human_review_completed, false);
  const reviewPacket = JSON.parse(
    readFileSync(evaluation.paths.humanReviewPacket, "utf8")
  ) as {
    provider_output_count: number;
    review_item_count: number;
    every_provider_output_included: boolean;
  };
  assert.equal(reviewPacket.provider_output_count, 36);
  assert.equal(reviewPacket.review_item_count, 36);
  assert.equal(reviewPacket.every_provider_output_included, true);
  assert.equal(evaluation.summary.final_evaluation_status,
    "provider_evidence_ready_for_human_review");
  assert.equal(evaluation.summary.candidate_approved, false);
  assert.equal(evaluation.summary.candidate_activated, false);
  assert.equal(networkCalls, 0);

  const protectedAfter = e2a5ProtectedArtifactSnapshot();
  assert.equal(protectedAfter.aggregate_sha256, protectedBefore.aggregate_sha256);
  console.log(JSON.stringify({
    status: "passed",
    candidate_hash: candidate.candidate_configuration_hash,
    role_request_compilation_count: compilation.artifact.role_count,
    dispatch_canary_case_count: evaluation.summary.case_counts.dispatch_canary_completed,
    full_protocol_case_count: evaluation.summary.case_counts.full_protocol_completed,
    tenth_turn_context_pass_count: evaluation.summary.context_coverage.tenth_turn_passed,
    original_v4_outputs_rejected_by_candidate_and_platform: true,
    protected_artifacts_unchanged: true,
    actual_network_calls: networkCalls
  }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    if (process.env.KEEP_E2A6_SMOKE_ARTIFACTS !== "1") {
      rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.error(`e2a6_smoke_artifacts=${tempRoot}`);
    }
  }
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
