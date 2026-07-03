import { PrismaClient } from "@prisma/client";
import {
  FORMATIVE_VALUE_AGENT_NAME,
  buildFormativeValueAgentInput,
  callFormativeValueDeterminationAgent,
  executeLiveFormativeValueDeterminationAgent,
  executeFormativeValueAgentWithProviderForTest,
  persistFormativeValueDeterminationSnapshot,
  presentFormativeValueChoice,
  recordStudentFormativeValueChoice,
  validateFormativeValueDeterminationOutput,
  writeFormativeValueReviewArtifact,
  type FormativeValue,
  type FormativeValueDeterminationPacketV1
} from "../src/lib/services/student-assessment/formative-value-determination";
import {
  PROFILE_INTEGRATION_AGENT_NAME,
  PROFILE_INTEGRATION_AGENT_VERSION,
  PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
  PROFILE_INTEGRATION_PROMPT_VERSION,
  ProfileIntegrationInterpretationPacketV1Schema,
  type ProfileIntegrationInterpretationPacketV1
} from "../src/lib/services/student-assessment/profile-integration";
import type { LlmProvider, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import {
  configureNoLiveFormativeValueRuntime,
  createFormativeValueSampleSession,
  restoreEnvValue
} from "./student-formative-value-helpers";
import { assert } from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

class FixedFormativeValueProvider implements LlmProvider {
  constructor(
    private readonly resultFactory: (
      request: StructuredAgentRequest<unknown, unknown>
    ) => StructuredAgentResult<unknown>
  ) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    return this.resultFactory(request as unknown as StructuredAgentRequest<unknown, unknown>) as StructuredAgentResult<TOutput>;
  }
}

function profilePacket(input: {
  integration_pattern: ProfileIntegrationInterpretationPacketV1["integration_pattern"];
  student_facing_status?: ProfileIntegrationInterpretationPacketV1["student_facing_status"];
  status_confidence?: ProfileIntegrationInterpretationPacketV1["status_confidence"];
  evidence_consistency?: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["evidence_consistency"];
  confidence_calibration_summary?: string;
  misconception_claim_strength?: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["misconception_claim_strength"];
  knowledge_gap_claim_strength?: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["knowledge_gap_claim_strength"];
  ai_effect?: ProfileIntegrationInterpretationPacketV1["engagement_context"]["ai_assistance_effect_on_interpretation"];
  output_status?: ProfileIntegrationInterpretationPacketV1["output_status"];
}): ProfileIntegrationInterpretationPacketV1 {
  const status = input.student_facing_status ??
    (input.integration_pattern === "stable_understanding"
      ? "Mostly understood"
      : input.integration_pattern === "likely_knowledge_gap"
        ? "Needs more work"
        : "Still developing");

  return ProfileIntegrationInterpretationPacketV1Schema.parse({
    agent_name: PROFILE_INTEGRATION_AGENT_NAME,
    agent_version: PROFILE_INTEGRATION_AGENT_VERSION,
    prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
    schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
    output_status: input.output_status ?? "ok",
    generation_mode: "deterministic_mock",
    session_public_id: "sess_formative_value_smoke",
    student_public_id: "student_formative_value_smoke",
    assessment_public_id: "assessment_formative_value_smoke",
    concept_unit_id: "concept_formative_value_smoke",
    generated_at: new Date().toISOString(),
    source_packets: {
      ability_evidence_packet_schema: "ability-evidence-packet-v1",
      engagement_evidence_packet_schema: "engagement-evidence-packet-v1"
    },
    internal_integrated_status:
      input.integration_pattern === "insufficient_evidence" ? "Insufficient evidence" : status,
    student_facing_status: status,
    status_confidence: input.status_confidence ?? "medium",
    integration_pattern: input.integration_pattern,
    ability_interpretation: {
      summary: "Synthetic profile integration evidence for formative value determination.",
      evidence_consistency: input.evidence_consistency ?? "mixed",
      main_conceptual_issue:
        input.integration_pattern === "likely_knowledge_gap"
          ? "The concept boundary is not yet clear in the current evidence."
          : null,
      misconception_claim_strength:
        input.misconception_claim_strength ??
        (input.integration_pattern === "likely_misconception" ? "moderate" : "insufficient_evidence"),
      knowledge_gap_claim_strength:
        input.knowledge_gap_claim_strength ??
        (input.integration_pattern === "likely_knowledge_gap" ? "moderate" : "insufficient_evidence"),
      confidence_calibration_summary:
        input.confidence_calibration_summary ??
        "Confidence and reasoning evidence are broadly aligned in the current evidence.",
      limitations: ["synthetic_profile_integration_packet"]
    },
    engagement_context: {
      summary: "Engagement evidence is retained only as interpretation context.",
      engagement_category: "engaged",
      engagement_effect_on_interpretation: "supports_interpretation",
      ai_assistance_signal:
        input.ai_effect === "contextualizes_reasoning_evidence"
          ? "likely_external_assistance_pattern"
          : "insufficient_evidence",
      ai_assistance_effect_on_interpretation: input.ai_effect ?? "insufficient_evidence",
      limitations: ["synthetic_engagement_context"]
    },
    evidence_rationale: [
      {
        claim_type: "ability",
        claim: "The synthetic evidence supports the selected integration pattern.",
        supports:
          input.integration_pattern === "likely_knowledge_gap"
            ? "knowledge_gap"
            : input.integration_pattern === "likely_misconception"
              ? "misconception"
              : input.integration_pattern === "mixed_or_conflicting_evidence"
                ? "mixed_evidence"
                : input.integration_pattern,
        strength: input.status_confidence ?? "medium"
      }
    ],
    uncertainty_and_limitations: ["synthetic_evidence_for_smoke_test"],
    student_safe_message: {
      status,
      message: "This summary uses current evidence only.",
      knowledge_focus: "Distinguishing person ability from item parameters."
    },
    teacher_research_summary: {
      safe_internal_summary: "Synthetic profile integration summary for formative value determination.",
      evidence_trace_summary: [`integration_pattern=${input.integration_pattern}`]
    },
    safety_check: {
      answer_key_exposed: false,
      correct_option_value_exposed: false,
      distractor_metadata_exposed: false,
      misconception_ids_exposed_to_student_projection: false,
      raw_reasoning_exposed: false,
      raw_process_payload_exposed: false,
      raw_llm_output_exposed: false,
      api_key_or_secret_exposed: false,
      unsupported_integrity_claim_present: false,
      instructional_direction_present: false,
      activity_recommendation_present: false,
      engagement_label_exposed_to_student_projection: false,
      ai_assistance_label_exposed_to_student_projection: false
    }
  });
}

function assertStudentMessageSafe(packet: FormativeValueDeterminationPacketV1) {
  const text = JSON.stringify({
    student_safe_message: packet.student_safe_message,
    alternatives: packet.alternative_values,
    student_safe_summary: packet.rationale.student_safe_summary
  }).toLowerCase();
  const forbidden = [
    "answer key",
    "correct option",
    "correctness",
    "distractor",
    "misconception",
    "raw reasoning",
    "raw process",
    "raw llm",
    "api key",
    "engagement",
    "process data",
    "ai assistance",
    "external assistance",
    "cheating",
    "misconduct",
    "integrity",
    "authenticity"
  ];

  for (const term of forbidden) {
    assert(!text.includes(term), `Student-facing formative value text leaked ${term}.`);
  }
}

async function packetFor(profile: ProfileIntegrationInterpretationPacketV1) {
  const input = buildFormativeValueAgentInput({ profile_integration_packet: profile });
  const packet = await callFormativeValueDeterminationAgent(input);
  const validation = validateFormativeValueDeterminationOutput(packet);

  assert(validation.valid, `Formative value packet should validate: ${JSON.stringify(validation.issues)}`);
  assert(packet.student_choice_policy.can_accept_recommendation, "Recommendation accept option must be allowed.");
  assert(packet.student_choice_policy.can_choose_alternative, "Alternative selection must be allowed.");
  assert(packet.student_choice_policy.can_move_on, "Move-on option must be allowed.");
  assert(packet.alternative_values.length >= 1, "Alternatives should be present.");
  assertStudentMessageSafe(packet);

  return packet;
}

async function runPureFormativeValueAssertions() {
  const stable = await packetFor(profilePacket({
    integration_pattern: "stable_understanding",
    status_confidence: "high",
    evidence_consistency: "consistent"
  }));
  assert(stable.primary_value === "consolidation_and_transfer", "Stable understanding should map to consolidation and transfer.");

  const developing = await packetFor(profilePacket({
    integration_pattern: "developing_understanding",
    evidence_consistency: "mixed"
  }));
  assert(developing.primary_value === "reasoning_refinement", "Developing understanding should map to reasoning refinement.");

  const gap = await packetFor(profilePacket({
    integration_pattern: "likely_knowledge_gap",
    student_facing_status: "Needs more work",
    status_confidence: "low",
    confidence_calibration_summary: "Confidence alignment in the ability packet is mixed."
  }));
  assert(gap.primary_value === "diagnostic_clarification", "Likely knowledge gap should map to diagnostic clarification.");

  const appropriateLowConfidenceGap = await packetFor(profilePacket({
    integration_pattern: "likely_knowledge_gap",
    student_facing_status: "Needs more work",
    status_confidence: "low",
    confidence_calibration_summary:
      "Low confidence appears appropriate because the current evidence indicates a knowledge gap and uncertainty."
  }));
  assert(
    appropriateLowConfidenceGap.primary_value === "diagnostic_clarification",
    "Likely knowledge gap with calibrated low confidence should not map to confidence calibration."
  );

  const misconception = await packetFor(profilePacket({
    integration_pattern: "likely_misconception",
    evidence_consistency: "consistent"
  }));
  assert(misconception.primary_value === "diagnostic_clarification", "Consistent misconception evidence should map to diagnostic clarification.");

  const overconfidentMisconception = await packetFor(profilePacket({
    integration_pattern: "likely_misconception",
    evidence_consistency: "consistent",
    misconception_claim_strength: "strong",
    confidence_calibration_summary:
      "The student showed high confidence with diagnostic misconception evidence."
  }));
  assert(
    overconfidentMisconception.primary_value === "diagnostic_clarification",
    "High confidence with likely misconception evidence should prioritize diagnostic clarification, not confidence calibration."
  );
  assert(
    overconfidentMisconception.secondary_considerations.some((consideration) =>
      consideration.reason_code === "overconfident_wrong_or_weak_evidence" &&
      consideration.type === "confidence_note" &&
      !consideration.student_visible
    ),
    "Overconfident misconception evidence should be captured as a non-student-visible secondary consideration."
  );

  const mixed = await packetFor(profilePacket({
    integration_pattern: "mixed_or_conflicting_evidence",
    confidence_calibration_summary: "Confidence alignment in the ability packet is mixed."
  }));
  assert(mixed.primary_value === "independent_understanding_verification", "Mixed evidence should map to independent understanding verification.");

  const insufficient = await packetFor(profilePacket({
    integration_pattern: "insufficient_evidence",
    output_status: "needs_review"
  }));
  assert(insufficient.primary_value === "independent_understanding_verification", "Insufficient evidence should prefer independent understanding verification.");

  const confidenceMismatch = await packetFor(profilePacket({
    integration_pattern: "developing_understanding",
    confidence_calibration_summary: "The student appears overconfident with weak reasoning evidence."
  }));
  assert(
    confidenceMismatch.primary_value === "reasoning_refinement",
    "High confidence with weak reasoning should prioritize reasoning refinement, not confidence calibration."
  );
  assert(
    confidenceMismatch.secondary_considerations.some((consideration) =>
      consideration.reason_code === "overconfident_wrong_or_weak_evidence"
    ),
    "Overconfident weak reasoning should remain present as a secondary confidence note."
  );
  assert(
    !confidenceMismatch.student_safe_message.why_this_focus.toLowerCase().includes("confidence"),
    "Student-facing rationale should not overemphasize confidence when the primary need is conceptual reasoning."
  );

  const overconfidentKnowledgeGap = await packetFor(profilePacket({
    integration_pattern: "likely_knowledge_gap",
    student_facing_status: "Needs more work",
    status_confidence: "medium",
    confidence_calibration_summary:
      "The student showed high confidence with wrong or weak evidence for the concept boundary."
  }));
  assert(
    overconfidentKnowledgeGap.primary_value === "diagnostic_clarification",
    "High confidence with wrong or weak knowledge-gap evidence should map to diagnostic clarification."
  );
  assert(
    overconfidentKnowledgeGap.secondary_considerations.some((consideration) =>
      consideration.reason_code === "overconfident_wrong_or_weak_evidence"
    ),
    "Overconfident wrong or weak evidence should be captured as a secondary consideration."
  );

  const underconfidentStrong = await packetFor(profilePacket({
    integration_pattern: "stable_understanding",
    student_facing_status: "Mostly understood",
    status_confidence: "high",
    evidence_consistency: "consistent",
    confidence_calibration_summary:
      "The student showed low confidence despite strong, well supported evidence."
  }));
  assert(
    underconfidentStrong.primary_value === "confidence_calibration",
    "Low confidence with strong evidence should map to confidence calibration."
  );
  assert(underconfidentStrong.student_choice_policy.can_choose_alternative, "Confidence calibration must still allow alternatives.");
  assert(underconfidentStrong.student_choice_policy.can_move_on, "Confidence calibration must still allow move-on.");
  assert(
    underconfidentStrong.rationale.evidence_basis.some((basis) =>
      basis.reason_code === "underconfident_strong_understanding"
    ),
    "Underconfident strong evidence should use an allowed primary calibration reason."
  );

  const underconfidentAdequate = await packetFor(profilePacket({
    integration_pattern: "developing_understanding",
    student_facing_status: "Still developing",
    status_confidence: "medium",
    evidence_consistency: "consistent",
    misconception_claim_strength: "none",
    knowledge_gap_claim_strength: "none",
    confidence_calibration_summary:
      "The student showed low confidence despite adequate, supported reasoning evidence."
  }));
  assert(
    underconfidentAdequate.primary_value === "confidence_calibration",
    "Low confidence with adequate reasoning evidence should map to confidence calibration."
  );
  assert(
    underconfidentAdequate.rationale.evidence_basis.some((basis) =>
      basis.reason_code === "underconfident_adequate_reasoning"
    ),
    "Underconfident adequate reasoning should use an allowed primary calibration reason."
  );

  const externalContext = await packetFor(profilePacket({
    integration_pattern: "stable_understanding",
    status_confidence: "medium",
    ai_effect: "contextualizes_reasoning_evidence"
  }));
  assert(
    externalContext.primary_value === "independent_understanding_verification",
    "Response-production context should map to independent understanding verification without student-facing AI labels."
  );
  assertStudentMessageSafe(externalContext);
}

async function runValidationAssertions() {
  const base = await packetFor(profilePacket({
    integration_pattern: "developing_understanding"
  }));

  const unsafeCases: Array<{
    label: string;
    output: FormativeValueDeterminationPacketV1 | Record<string, unknown>;
    expected_rule: string;
  }> = [
    {
      label: "activity recommendation",
      output: {
        ...base,
        student_safe_message: {
          ...base.student_safe_message,
          why_this_focus: "The recommended activity is to compare examples."
        }
      },
      expected_rule: "activity_recommendation_present"
    },
    {
      label: "specific task",
      output: {
        ...base,
        rationale: {
          ...base.rationale,
          teacher_research_summary: "Ask the student to solve this specific task next."
        }
      },
      expected_rule: "specific_task_generated"
    },
    {
      label: "answer key",
      output: {
        ...base,
        student_safe_message: {
          ...base.student_safe_message,
          why_this_focus: "The answer key says the correct option is C."
        }
      },
      expected_rule: "answer_key_leak_detected"
    },
    {
      label: "engagement label",
      output: {
        ...base,
        student_safe_message: {
          ...base.student_safe_message,
          why_this_focus: "Low engagement and AI assistance shaped this focus."
        }
      },
      expected_rule: "engagement_or_ai_label_exposed_to_student"
    },
    {
      label: "integrity language",
      output: {
        ...base,
        student_safe_message: {
          ...base.student_safe_message,
          why_this_focus: "This checks academic integrity and authentic work."
        }
      },
      expected_rule: "unsupported_integrity_language_detected"
    },
    {
      label: "no move-on policy",
      output: {
        ...base,
        student_choice_policy: {
          ...base.student_choice_policy,
          can_move_on: false
        }
      },
      expected_rule: "schema_invalid"
    },
    {
      label: "confidence calibration without explicit mismatch",
      output: {
        ...base,
        primary_value: "confidence_calibration",
        primary_value_label: "Confidence calibration",
        rationale: {
          ...base.rationale,
          evidence_basis: [{
            source: "profile_integration",
            reason_code: "confidence_mismatch",
            strength: "medium"
          }]
        },
        student_safe_message: {
          ...base.student_safe_message,
          recommended_value_label: "Confidence calibration"
        }
      },
      expected_rule: "confidence_calibration_without_adequate_understanding_mismatch"
    },
    {
      label: "confidence calibration with overconfident wrong or weak evidence",
      output: {
        ...base,
        primary_value: "confidence_calibration",
        primary_value_label: "Confidence calibration",
        rationale: {
          ...base.rationale,
          evidence_basis: [{
            source: "profile_integration",
            reason_code: "overconfident_wrong_or_weak_evidence",
            strength: "medium"
          }]
        },
        student_safe_message: {
          ...base.student_safe_message,
          recommended_value_label: "Confidence calibration"
        },
        secondary_considerations: [{
          type: "confidence_note",
          label: "confidence concern is secondary to conceptual evidence",
          student_visible: false,
          reason_code: "overconfident_wrong_or_weak_evidence",
          strength: "medium"
        }]
      },
      expected_rule: "confidence_calibration_without_adequate_understanding_mismatch"
    }
  ];

  for (const unsafe of unsafeCases) {
    const validation = validateFormativeValueDeterminationOutput(unsafe.output);
    assert(!validation.valid, `${unsafe.label} should be rejected.`);
    assert(
      validation.issues.some((issue) => issue.rule_code === unsafe.expected_rule),
      `${unsafe.label} should report ${unsafe.expected_rule}; got ${JSON.stringify(validation.issues)}`
    );
  }
}

async function runProviderAssertions() {
  const cleanupStartedAt = new Date();
  try {
    const agentInput = buildFormativeValueAgentInput({
      profile_integration_packet: profilePacket({
        integration_pattern: "developing_understanding"
      })
    });
    const validOutput = await callFormativeValueDeterminationAgent(agentInput);
    const provider = new FixedFormativeValueProvider((request) => ({
      provider: "mock",
      provider_request_id: "mock_formative_value_request",
      provider_response_id: "mock_formative_value_response",
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: validOutput,
      raw_output: { id: "mock_formative_value_response", output: validOutput },
      usage: {
        input_tokens: 18,
        output_tokens: 24,
        total_tokens: 42,
        raw: { source: "mock_formative_value_usage" }
      },
      latency_ms: 2
    }));
    const result = await executeFormativeValueAgentWithProviderForTest({
      agent_input: agentInput,
      provider
    });

    assert(result.status === "succeeded", "Valid provider output should be accepted.");
    assert(result.agent_call_id, "Provider path should return an audited agent call ID.");

    const agentCall = await prisma.agentCall.findUniqueOrThrow({
      where: { id: result.agent_call_id },
      select: {
        agent_name: true,
        schema_version: true,
        provider_request_id: true,
        provider_response_id: true,
        output_validated: true,
        call_status: true,
        token_usage: true
      }
    });

    assert(agentCall.agent_name === FORMATIVE_VALUE_AGENT_NAME, "Agent call should use formative value agent name.");
    assert(agentCall.schema_version === "formative-value-determination-v1", "Agent call should store formative value schema version.");
    assert(agentCall.provider_request_id === "mock_formative_value_request", "Provider request ID should be audited.");
    assert(agentCall.provider_response_id === "mock_formative_value_response", "Provider response ID should be audited.");
    assert(agentCall.output_validated, "Valid provider output should validate.");
    assert(agentCall.call_status === "succeeded", "Valid provider output should mark call succeeded.");
    assert(Boolean(agentCall.token_usage), "Provider token usage metadata should be stored.");

    const underconfidentAgentInput = buildFormativeValueAgentInput({
      profile_integration_packet: profilePacket({
        integration_pattern: "stable_understanding",
        student_facing_status: "Mostly understood",
        status_confidence: "medium",
        evidence_consistency: "consistent",
        confidence_calibration_summary:
          "The student showed low confidence despite adequate, supported reasoning evidence."
      })
    });
    const underconfidentCanonicalOutput = await callFormativeValueDeterminationAgent(underconfidentAgentInput);
    const wrongPrimaryProvider = new FixedFormativeValueProvider((request) => ({
      provider: "mock",
      provider_request_id: "mock_formative_value_wrong_primary_request",
      provider_response_id: "mock_formative_value_wrong_primary_response",
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: {
        ...underconfidentCanonicalOutput,
        primary_value: "independent_understanding_verification",
        primary_value_label: "Independent understanding verification",
        student_safe_message: {
          ...underconfidentCanonicalOutput.student_safe_message,
          recommended_value_label: "Independent understanding verification"
        }
      },
      raw_output: { id: "mock_formative_value_wrong_primary_response", output: "redacted" },
      usage: { input_tokens: 9, output_tokens: 11, total_tokens: 20 },
      latency_ms: 2
    }));
    const wrongPrimaryResult = await executeFormativeValueAgentWithProviderForTest({
      agent_input: underconfidentAgentInput,
      provider: wrongPrimaryProvider
    });

    assert(
      wrongPrimaryResult.status === "succeeded",
      "Underconfident adequate-understanding primary value should be canonicalized to backend precedence."
    );
    assert(
      wrongPrimaryResult.packet.primary_value === "confidence_calibration",
      "Canonicalized underconfident output should use confidence calibration."
    );
    assert(
      wrongPrimaryResult.packet.rationale.limitations.includes(
        "primary_value_canonicalized_to_backend_confidence_calibration_precedence"
      ),
      "Canonicalized underconfident output should record the backend precedence correction."
    );

    const invalidProvider = new FixedFormativeValueProvider((request) => ({
      provider: "mock",
      provider_request_id: "mock_formative_value_bad_request",
      provider_response_id: "mock_formative_value_bad_response",
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: {
        ...validOutput,
        student_safe_message: {
          ...validOutput.student_safe_message,
          why_this_focus: "The answer key gives the correct option."
        }
      },
      raw_output: { id: "mock_formative_value_bad_response", output: "redacted" },
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      latency_ms: 2
    }));
    const invalidResult = await executeFormativeValueAgentWithProviderForTest({
      agent_input: agentInput,
      provider: invalidProvider
    });

    assert(invalidResult.status === "invalid_output", "Unsafe provider output should be rejected.");
    assert(invalidResult.agent_call_id, "Rejected provider output should still be audited.");

    const invalidAgentCall = await prisma.agentCall.findUniqueOrThrow({
      where: { id: invalidResult.agent_call_id },
      select: { output_validated: true, call_status: true, validation_error: true }
    });
    assert(!invalidAgentCall.output_validated, "Rejected provider output should not validate.");
    assert(invalidAgentCall.call_status === "invalid_output", "Rejected output should mark invalid_output.");
    assert(
      invalidAgentCall.validation_error?.includes("answer_key_leak_detected"),
      "Rejected output should store safe validation issue details."
    );
  } finally {
    await prisma.agentCall.deleteMany({
      where: {
        agent_name: FORMATIVE_VALUE_AGENT_NAME,
        created_at: { gte: cleanupStartedAt }
      }
    });
  }
}

async function withTemporaryProcessEnv<T>(
  values: Record<string, string | undefined>,
  callback: () => Promise<T>
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      restoreEnvValue(key, value);
    }

    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      restoreEnvValue(key, value);
    }
  }
}

async function runLivePolicyAssertions() {
  const agentInput = buildFormativeValueAgentInput({
    profile_integration_packet: profilePacket({
      integration_pattern: "developing_understanding"
    })
  });
  const beforeCount = await prisma.agentCall.count({
    where: { agent_name: FORMATIVE_VALUE_AGENT_NAME }
  });

  await withTemporaryProcessEnv(
    {
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: undefined,
      OPENAI_API_KEY_FILE: undefined
    },
    async () => {
      const result = await executeLiveFormativeValueDeterminationAgent({
        agent_input: agentInput
      });

      assert(result.status === "configuration_blocked", "Blocked live configuration should not count as live success.");
      assert(!result.agent_call_id, "Blocked live configuration should not create an agent call.");
      assert(result.fallback_packet.primary_value, "Blocked live configuration may return a deterministic fallback packet.");
    }
  );

  const afterCount = await prisma.agentCall.count({
    where: { agent_name: FORMATIVE_VALUE_AGENT_NAME }
  });
  assert(afterCount === beforeCount, "Configuration-blocked live path should not create provider audit rows.");
}

async function runPersistenceAssertions() {
  const sample = await createFormativeValueSampleSession(prisma);

  try {
    const input = buildFormativeValueAgentInput({
      profile_integration_packet: {
        ...profilePacket({
          integration_pattern: "developing_understanding"
        }),
        session_public_id: sample.session_public_id
      }
    });
    const packet = await callFormativeValueDeterminationAgent(input);
    const persisted = await persistFormativeValueDeterminationSnapshot({ packet });
    const presented = await presentFormativeValueChoice(packet);
    const accepted = await recordStudentFormativeValueChoice({
      packet,
      choice: "accepted_recommendation"
    });
    const alternative = packet.alternative_values[0]?.value as FormativeValue | undefined;
    assert(alternative, "Formative value packet should include at least one alternative.");
    const overridden = await recordStudentFormativeValueChoice({
      packet,
      choice: "chose_alternative",
      selected_value: alternative
    });
    const movedOn = await recordStudentFormativeValueChoice({
      packet,
      choice: "moved_on"
    });
    const artifactPath = await writeFormativeValueReviewArtifact({ packet });

    assert(persisted.status === "persisted", "Determination snapshot should persist.");
    assert(presented.status === "presented", "Choice presentation should be logged.");
    assert(accepted.status === "recorded", "Accept choice should record successfully.");
    assert(overridden.status === "recorded", "Alternative choice should record successfully.");
    assert(movedOn.status === "recorded", "Move-on choice should record successfully.");
    assert(accepted.student_choice_state.student_choice === "accepted_recommendation", "Accept choice should be recorded.");
    assert(overridden.student_choice_state.student_override, "Alternative choice should be recorded as override.");
    assert(movedOn.student_choice_state.selected_value === "move_on", "Move-on choice should be recorded.");
    assert(artifactPath.includes(".data/formative-value-review"), "Review artifact should be written under ignored data path.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: sample.session_public_id },
      select: { id: true }
    });
    const events = await prisma.processEvent.findMany({
      where: {
        assessment_session_db_id: session.id,
        event_type: {
          in: [
            "formative_value_determined",
            "formative_value_presented",
            "formative_value_choice_recorded",
            "formative_value_overridden",
            "formative_value_moved_on"
          ]
        }
      },
      select: { event_type: true, payload: true }
    });
    const eventTypes = events.map((event) => event.event_type);
    for (const expected of [
      "formative_value_determined",
      "formative_value_presented",
      "formative_value_choice_recorded",
      "formative_value_overridden",
      "formative_value_moved_on"
    ]) {
      assert(eventTypes.includes(expected), `${expected} process event should be recorded.`);
    }
    const serialized = JSON.stringify(events).toLowerCase();
    assert(!serialized.includes("answer key"), "Process-event payload should not expose answer keys.");
    assert(!serialized.includes("correct option"), "Process-event payload should not expose correct options.");
    assert(!serialized.includes("distractor"), "Process-event payload should not expose distractor metadata.");
  } finally {
    await sample.cleanup();
  }
}

async function main() {
  configureNoLiveFormativeValueRuntime();
  const smokeStartedAt = new Date();
  const agentCallCountBefore = await prisma.agentCall.count();

  await runPureFormativeValueAssertions();
  await runValidationAssertions();
  await runProviderAssertions();
  await runLivePolicyAssertions();
  await runPersistenceAssertions();

  const openAiCalls = await prisma.agentCall.count({
    where: {
      provider: "openai",
      created_at: { gt: smokeStartedAt },
      agent_name: FORMATIVE_VALUE_AGENT_NAME
    }
  });
  assert(openAiCalls === 0, "Formative value smoke must not create OpenAI calls.");
  const agentCallCountAfter = await prisma.agentCall.count();

  console.log(JSON.stringify({
    status: "passed",
    agent_call_count_before: agentCallCountBefore,
    agent_call_count_after: agentCallCountAfter,
    agent_call_count_delta: agentCallCountAfter - agentCallCountBefore,
    existing_formative_value_agent_call_count: await prisma.agentCall.count({
      where: { agent_name: FORMATIVE_VALUE_AGENT_NAME }
    }),
    openai_calls_created: openAiCalls,
    validated_values: [
      "diagnostic_clarification",
      "reasoning_refinement",
      "confidence_calibration",
      "independent_understanding_verification",
      "consolidation_and_transfer"
    ],
    live_smoke_default_behavior: "separate student:formative-value-live-smoke skips unless RUN_LIVE_FORMATIVE_VALUE_SMOKE=1"
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
