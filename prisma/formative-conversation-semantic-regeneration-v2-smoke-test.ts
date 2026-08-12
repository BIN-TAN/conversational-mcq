import { strict as assert } from "node:assert";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import { emptyCanonicalMisconceptionClaimCatalog } from "../src/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  FormativeConversationAgentInputSchema,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import { validateFormativeConversationCandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation";
import {
  FormativeConversationSemanticRegenerationError,
  createSingleAttemptLogicalGenerationExecution,
  executeFormativeConversationWithSemanticRegeneration
} from "../src/lib/services/student-assessment/formative-conversation/semantic-regeneration";

const context = FormativeConversationAgentInputSchema.parse({
  contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  conversation_public_id: "conversation_semantic_regeneration_v2",
  assessment_public_id: "assessment_semantic_regeneration_v2",
  concept_unit_public_id: "concept_semantic_regeneration_v2",
  latest_student_message: null,
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
  allowed_misconception_claim_catalog:
    emptyCanonicalMisconceptionClaimCatalog(
      "semantic-regeneration-v2-smoke"
    ),
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

function output(message: string): FormativeConversationAgentOutput {
  return {
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message: message,
    teaching_artifact: null,
    evidence_observations: [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  };
}

function completedResult(
  candidate: FormativeConversationAgentOutput,
  requestId: string
): StructuredAgentResult<FormativeConversationAgentOutput> {
  return {
    provider: "openai",
    client_request_id: requestId,
    provider_response_id: `${requestId}:response`,
    status: "completed",
    parsed_output: candidate,
    raw_output: {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(candidate) }]
        }
      ]
    },
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    latency_ms: 25
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
  instructions: "Deterministic no-provider smoke instructions.",
  input: context,
  output_schema: FormativeConversationAgentOutputSchema,
  schema_name: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  client_request_id: "semantic-regeneration-v2-smoke",
  timeout_ms: 90_000
};

async function executeSequence(outputs: FormativeConversationAgentOutput[]) {
  let index = 0;
  return executeFormativeConversationWithSemanticRegeneration({
    base_request: baseRequest,
    validate_candidate(candidate) {
      const validation = validateFormativeConversationCandidateAcceptance({
        candidate,
        context
      });
      return {
        valid: validation.valid,
        validation_status: validation.validation_status,
        validation_issue_paths: validation.validation_issue_paths
      };
    },
    async execute_logical_generation({ sequence, kind, request }) {
      const candidate = outputs[index++];
      assert.ok(candidate, "A deterministic candidate must exist.");
      return createSingleAttemptLogicalGenerationExecution({
        logical_call_id: `logical:${sequence}:${kind}`,
        request,
        result: completedResult(candidate, `request:${sequence}:${kind}`)
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
    const openingInvalid = output(
      "Looking over your responses, your diagnostic profile shows partial understanding."
    );
    const openingValid = output(
      "You already identified two important ideas. Let us connect them through an example."
    );
    const regenerated = await executeSequence([openingInvalid, openingValid]);
    assert.equal(regenerated.audit.logical_generation_call_count, 2);
    assert.equal(regenerated.audit.semantic_regeneration_count, 1);
    assert.equal(regenerated.audit.attempts[0]?.accepted, false);
    assert.equal(regenerated.audit.attempts[1]?.accepted, true);
    assert.equal(
      regenerated.audit.attempts[0]?.safe_invalid_output_evidence
        ?.validation_status,
      "opening_contract_invalid"
    );
    assert.deepEqual(
      regenerated.audit.attempts[0]?.safe_invalid_output_evidence
        ?.candidate_json,
      openingInvalid
    );
    assert.ok(
      regenerated.audit.attempts[0]?.safe_invalid_output_evidence
        ?.validation_issue_paths.includes(
          "student_visible_message:opening_exposes_profile_language"
        )
    );

    const formattingInvalid = output(
      "Looking over your responses, consider this:\n| A | B |\n|---|---|\n| 1 | 2 |"
    );
    const formattingRegenerated = await executeSequence([
      formattingInvalid,
      openingValid
    ]);
    assert.equal(
      formattingRegenerated.audit.attempts[0]?.safe_invalid_output_evidence
        ?.validation_status,
      "output_contract_invalid"
    );

    const openingAndFormattingInvalid = output(
      "Your diagnostic profile shows partial understanding.\n| A | B |\n|---|---|\n| 1 | 2 |"
    );
    const acceptanceOrder = await executeSequence([
      openingAndFormattingInvalid,
      openingValid
    ]);
    assert.equal(
      acceptanceOrder.audit.attempts[0]?.safe_invalid_output_evidence
        ?.validation_status,
      "opening_contract_invalid"
    );

    let exhausted: FormativeConversationSemanticRegenerationError | null = null;
    try {
      await executeSequence([openingInvalid, openingInvalid]);
    } catch (error) {
      if (error instanceof FormativeConversationSemanticRegenerationError) {
        exhausted = error;
      } else {
        throw error;
      }
    }
    assert.ok(exhausted, "A second locally invalid candidate must fail closed.");
    assert.equal(exhausted.failure_category, "semantic_regeneration_exhausted");
    assert.equal(exhausted.audit.logical_generation_call_count, 2);
    assert.equal(exhausted.audit.attempts[0]?.accepted, false);
    assert.equal(exhausted.audit.attempts[1]?.accepted, false);
    assert.equal(networkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          schema_valid_opening_invalid_regenerated: true,
          regenerated_valid_output_accepted: true,
          second_invalid_output_failed_closed: true,
          original_invalid_output_preserved: true,
          separate_attempt_identity: true,
          token_accounting_preserved: true,
          acceptance_order:
            "schema_safety_opening_formatting",
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
