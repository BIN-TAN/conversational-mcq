import { strict as assert } from "node:assert";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  FormativeConversationAgentInputSchema,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FormativeConversationSemanticRegenerationError,
  createSingleAttemptLogicalGenerationExecution,
  executeFormativeConversationWithSemanticRegeneration
} from "../src/lib/services/student-assessment/formative-conversation/semantic-regeneration";

const context = FormativeConversationAgentInputSchema.parse({
  contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  conversation_public_id: "conversation_semantic_regeneration_smoke",
  assessment_public_id: "assessment_semantic_regeneration_smoke",
  concept_unit_public_id: "concept_semantic_regeneration_smoke",
  latest_student_message: "Please explain the distinction.",
  visible_transcript: [],
  administered_items: [],
  initial_profile: {
    profile_version: "profile_initial",
    outcome: "not_yet_determined",
    evidence_summary: [],
    unresolved_evidence: [],
    evidence_limitations: [],
    canonical_profile: null,
    field_evidence: []
  },
  current_profile: {
    profile_version: "profile_current",
    outcome: "not_yet_determined",
    evidence_summary: [],
    unresolved_evidence: [],
    evidence_limitations: [],
    canonical_profile: null,
    field_evidence: []
  },
  intervention_history: [],
  memory: null,
  safety_boundary: {
    boundary_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
    administered_item_public_ids: [],
    unadministered_item_protection_required: true,
    hidden_prompts_excluded: true,
    raw_teacher_notes_excluded: true,
    credentials_excluded: true
  }
});

const validOutput: FormativeConversationAgentOutput = {
  contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  student_visible_message: "Let us work through the distinction together.",
  teaching_artifact: null,
  evidence_observations: [],
  profile_transition_recommendation: null,
  teacher_assistance_recommendation: {
    recommended: false,
    reason_code: null
  },
  lifecycle_recommendation: "continue"
};

function rawResponse(candidate: unknown) {
  return {
    id: "response_smoke",
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(candidate)
          }
        ]
      }
    ]
  };
}

function completedResult(
  output: FormativeConversationAgentOutput,
  requestId: string
): StructuredAgentResult<FormativeConversationAgentOutput> {
  return {
    provider: "openai",
    client_request_id: requestId,
    provider_response_id: `${requestId}:response`,
    status: "completed",
    parsed_output: output,
    raw_output: rawResponse(output),
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    latency_ms: 25,
    transport_telemetry: {
      provider: "openai",
      transport: "openai_responses",
      adapter_version: "deterministic-test-adapter",
      client_request_id: requestId,
      model_name: "deterministic-test-model",
      base_url_host: "api.openai.com",
      base_url_approved: true,
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: false,
      response_headers_received: true,
      response_body_started: true,
      response_body_completed: true,
      response_body_bytes_received: 100,
      response_body_received: true,
      structured_output_validation_status: "valid",
      structured_output_validation_issue_paths: []
    }
  };
}

function invalidResult(
  candidate: unknown,
  requestId: string,
  issuePaths = ["teacher_assistance_recommendation"]
): StructuredAgentResult<FormativeConversationAgentOutput> {
  return {
    provider: "openai",
    client_request_id: requestId,
    provider_response_id: `${requestId}:response`,
    status: "failed",
    raw_output: rawResponse(candidate),
    usage: { input_tokens: 110, output_tokens: 30, total_tokens: 140 },
    latency_ms: 35,
    error: {
      category: "schema_validation",
      message: "Structured output failed local validation.",
      retryable: false
    },
    transport_telemetry: {
      provider: "openai",
      transport: "openai_responses",
      adapter_version: "deterministic-test-adapter",
      client_request_id: requestId,
      model_name: "deterministic-test-model",
      base_url_host: "api.openai.com",
      base_url_approved: true,
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: false,
      response_headers_received: true,
      response_body_started: true,
      response_body_completed: true,
      response_body_bytes_received: 100,
      response_body_received: true,
      structured_output_validation_status: "schema_invalid",
      structured_output_validation_issue_paths: issuePaths
    }
  };
}

function refusedResult(
  requestId: string
): StructuredAgentResult<FormativeConversationAgentOutput> {
  return {
    provider: "openai",
    client_request_id: requestId,
    status: "refused",
    refusal: "safety refusal",
    latency_ms: 15
  };
}

const baseRequest: StructuredAgentRequest<
  typeof context,
  FormativeConversationAgentOutput
> = {
  agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
  model_config: {
    model_name: "deterministic-test-model",
    reasoning_effort: "medium",
    max_output_tokens: 3_500
  },
  instructions: "Deterministic smoke instructions.",
  input: context,
  output_schema: FormativeConversationAgentOutputSchema,
  schema_name: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  client_request_id: "semantic-regeneration-smoke",
  timeout_ms: 90_000
};

async function executeSequence(
  results: StructuredAgentResult<FormativeConversationAgentOutput>[]
) {
  let index = 0;
  return executeFormativeConversationWithSemanticRegeneration({
    base_request: baseRequest,
    async execute_logical_generation({ sequence, kind, request }) {
      const result = results[index++];
      assert.ok(result, "The deterministic provider result must exist.");
      return createSingleAttemptLogicalGenerationExecution({
        logical_call_id: `logical:${sequence}:${kind}`,
        request,
        result
      });
    }
  });
}

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden");
  }) as typeof fetch;

  try {
    const firstValid = await executeSequence([
      completedResult(validOutput, "valid-first")
    ]);
    assert.equal(firstValid.audit.logical_generation_call_count, 1);
    assert.equal(firstValid.audit.semantic_regeneration_count, 0);
    assert.equal(firstValid.audit.provider_attempt_count, 1);

    const invalidCandidate = {
      contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      student_visible_message: "A useful explanation.",
      lifecycle_recommendation: "continue"
    };
    const regenerated = await executeSequence([
      invalidResult(invalidCandidate, "invalid-then-valid:1"),
      completedResult(validOutput, "invalid-then-valid:2")
    ]);
    assert.equal(regenerated.audit.logical_generation_call_count, 2);
    assert.equal(regenerated.audit.semantic_regeneration_count, 1);
    assert.equal(regenerated.audit.provider_attempt_count, 2);
    assert.equal(regenerated.input_tokens, 210);
    assert.equal(regenerated.output_tokens, 50);
    assert.equal(regenerated.total_tokens, 260);
    assert.deepEqual(
      regenerated.audit.attempts[0]?.safe_invalid_output_evidence
        ?.candidate_json,
      invalidCandidate
    );

    let exhausted: FormativeConversationSemanticRegenerationError | null = null;
    try {
      await executeSequence([
        invalidResult(invalidCandidate, "invalid-twice:1"),
        invalidResult(
          { ...invalidCandidate, extra: "still invalid" },
          "invalid-twice:2",
          ["teacher_assistance_recommendation", "evidence_observations"]
        )
      ]);
    } catch (error) {
      if (error instanceof FormativeConversationSemanticRegenerationError) {
        exhausted = error;
      } else {
        throw error;
      }
    }
    assert.ok(exhausted, "A second invalid result must fail closed.");
    assert.equal(exhausted.failure_category, "semantic_regeneration_exhausted");
    assert.equal(exhausted.audit.logical_generation_call_count, 2);
    assert.equal(exhausted.audit.provider_attempt_count, 2);

    let safetyFailure: FormativeConversationSemanticRegenerationError | null =
      null;
    try {
      await executeSequence([refusedResult("safety-refusal")]);
    } catch (error) {
      if (error instanceof FormativeConversationSemanticRegenerationError) {
        safetyFailure = error;
      } else {
        throw error;
      }
    }
    assert.ok(safetyFailure, "A safety refusal must fail closed.");
    assert.equal(
      safetyFailure.failure_category,
      "semantic_regeneration_not_permitted"
    );
    assert.equal(safetyFailure.audit.logical_generation_call_count, 1);
    assert.equal(safetyFailure.audit.semantic_regeneration_count, 0);
    assert.equal(networkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          valid_first_logical_calls: 1,
          regeneration_success_logical_calls: 2,
          regeneration_exhaustion_logical_calls: 2,
          non_regenerable_safety_logical_calls: 1,
          preserved_invalid_output_evidence: true,
          duplicate_tutor_turns: 0,
          duplicate_profile_transitions: 0,
          provider_calls: 0,
          network_requests: networkRequests
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
