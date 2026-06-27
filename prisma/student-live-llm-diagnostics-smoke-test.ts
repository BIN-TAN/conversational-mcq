import {
  ChatNativeFormativeProfileOutputSchema
} from "../src/lib/services/student-assessment/formative-profile";
import {
  assertLiveAgentCallIsAudited,
  sanitizedAuditSummary,
  type LiveAuditCall
} from "./student-live-llm-diagnostics";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const validProfileOutput = {
  provisional_learning_state: "The student is distinguishing person ability from item difficulty.",
  main_issue: "The explanation needs one more precise contrast.",
  formative_need: "diagnosis_and_feedback",
  matched_activity: "key_distractor_contrast",
  evidence_used: ["Synthetic response package"],
  confidence_calibration_flag: false,
  answer_reasoning_alignment: "The answer and reasoning are mostly aligned.",
  student_facing_pattern_statement: "You have the main contrast partly in place.",
  student_facing_followup_prompt: "Explain which value describes the person and which describes the item.",
  should_reveal_correct_answer: false,
  next_expected_action: "respond_to_formative_activity"
};

function baseCall(overrides: Partial<LiveAuditCall> = {}): LiveAuditCall {
  return {
    id: "synthetic_agent_call",
    agent_name: "formative_value_and_planning_agent",
    schema_version: "chat-native-formative-profile-output-v1",
    provider: "openai",
    model_name: "synthetic-model",
    live_call_allowed: true,
    output_payload: validProfileOutput,
    output_validated: true,
    validation_error: null,
    error_category: null,
    call_status: "succeeded",
    provider_request_id: "req_synthetic",
    provider_response_id: null,
    client_request_id: "chat_native_profile_synthetic",
    prompt_version: "chat-native-formative-profile-v1",
    raw_output: {
      id: "resp_synthetic",
      status: "completed"
    },
    token_usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2
    },
    created_at: new Date("2026-06-27T00:00:00.000Z"),
    completed_at: new Date("2026-06-27T00:00:01.000Z"),
    ...overrides
  };
}

function expectFailureMessage(callback: () => void) {
  try {
    callback();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected assertion to fail.");
}

function main() {
  const failedCall = baseCall({
    call_status: "failed",
    output_validated: false,
    validation_error:
      "Phase 5 formative profile provider request failed before usable structured output; deterministic fallback used.",
    error_category: "provider_request_schema_invalid",
    provider_request_id: null,
    provider_response_id: null,
    raw_output: {
      prompt: "sk-test-secret-value-that-must-not-print",
      provider_failure: {
        provider: "openai",
        status: "failed",
        error: {
          category: "provider_request_schema_invalid",
          type: "BadRequestError",
          code: "invalid_request_error",
          message: "Provider-facing Structured Outputs schema is invalid.",
          retryable: false
        },
        transport: {
          provider: "openai",
          transport: "openai_responses",
          adapter_version: "synthetic",
          model_name: "synthetic-model",
          base_url_host: "api.openai.com",
          base_url_approved: true,
          http_status: 400,
          typed_failure_reason: "openai_bad_request",
          provider_error_code: "invalid_request_error",
          provider_error_type: "invalid_request_error",
          provider_error_param: null,
          network_category: "http_error"
        }
      }
    },
    token_usage: null
  });
  const failedContext = [sanitizedAuditSummary(failedCall)];
  const providerFailureMessage = expectFailureMessage(() =>
    assertLiveAgentCallIsAudited({
      label: "formative profile",
      call: failedCall,
      schema: ChatNativeFormativeProfileOutputSchema,
      audit_context: failedContext
    })
  );
  assert(
    providerFailureMessage.includes("live provider call failed before usable structured output"),
    "Failed provider call should report provider failure before metadata assertion."
  );
  assert(
    !providerFailureMessage.includes("provider request/response ID metadata was not stored"),
    "Failed provider call should not be misreported as a metadata failure."
  );
  assert(
    !providerFailureMessage.includes("sk-test-secret-value-that-must-not-print"),
    "Diagnostics must not print raw secret-like values."
  );

  const successfulMissingMetadataCall = baseCall({
    provider_request_id: null,
    provider_response_id: null
  });
  const metadataFailureMessage = expectFailureMessage(() =>
    assertLiveAgentCallIsAudited({
      label: "formative profile",
      call: successfulMissingMetadataCall,
      schema: ChatNativeFormativeProfileOutputSchema,
      audit_context: [sanitizedAuditSummary(successfulMissingMetadataCall)]
    })
  );
  assert(
    metadataFailureMessage.includes("provider request/response ID metadata was not stored"),
    "Successful live call should still require provider metadata."
  );

  assertLiveAgentCallIsAudited({
    label: "formative profile",
    call: baseCall(),
    schema: ChatNativeFormativeProfileOutputSchema,
    audit_context: [sanitizedAuditSummary(baseCall())]
  });

  console.log("Live LLM diagnostics smoke test passed. No OpenAI call was made.");
}

main();
