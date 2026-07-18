import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION,
  AbilityEvidencePacketV1Schema,
  buildAbilityEvidencePacketForSession,
  buildItemAbilityEvidence,
  diagnosticMetadataForItem,
  projectStudentSafeAbilityStatus,
  summarizeConceptAbilityEvidence
} from "../src/lib/services/student-assessment/ability-evidence";
import {
  ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION,
  EngagementEvidencePacketV1Schema,
  ENGAGEMENT_RULE_CONFIG_V1,
  buildEngagementEvidencePacketForSession,
  buildItemEngagementEvidence,
  summarizeSessionEngagement
} from "../src/lib/services/student-assessment/engagement-evidence";
import {
  PROFILE_INTEGRATION_AGENT_NAME,
  ProfileIntegrationInterpretationPacketV1Schema,
  buildConservativeIntegrationFallback,
  buildProfileIntegrationAgentInput,
  buildProfileIntegrationInterpretationPacketForSession,
  callProfileIntegrationAgent,
  executeLiveProfileIntegrationAgent,
  executeProfileIntegrationAgentWithProviderForTest,
  studentStatusForIntegrationPattern,
  validateProfileIntegrationOutput,
  withProfileIntegrationProviderForTest,
  writeProfileIntegrationReviewArtifact
} from "../src/lib/services/student-assessment/profile-integration";
import type { LlmProvider, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import { approvedRoleEnvironmentAssertions } from "../src/lib/llm/config";
import { resolveActiveOperationalApproval } from "../src/lib/operational/active-approval-bundle";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { logProcessEvent } from "../src/lib/services/process-events";
import {
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

function configureNoLiveRuntime() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
}

function fakeOpenAIKey(label: string) {
  return `sk-${label.replace(/[^A-Za-z0-9_-]/g, "")}-000000000000000000000000`;
}

function activeApprovalEnvironmentForTest(): Record<string, string> {
  const active = resolveActiveOperationalApproval();
  if (active?.kind !== "derived_approval") return {};
  return {
    ...approvedRoleEnvironmentAssertions(active.manifest),
    OPERATIONAL_APPROVED_CONFIG_HASH: active.record.runtime_candidate_hash
  };
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
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function serialized(value: unknown) {
  return JSON.stringify(value).toLowerCase();
}

function assertNoForbiddenStudentText(value: unknown) {
  const text = serialized(value);
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
    "disengaged",
    "low task participation",
    "ai assistance",
    "external assistance",
    "process data",
    "cheating",
    "misconduct",
    "integrity",
    "authenticity",
    "independent work",
    "suspicious",
    "formative value",
    "activity recommendation",
    "guessing risk",
    "unsupported correct response",
    "correctness support level",
    "you guessed"
  ];

  for (const term of forbidden) {
    assert(!text.includes(term), `Student-safe integration text leaked ${term}.`);
  }
}

const metadata = diagnosticMetadataForItem({
  item_public_id: "profile_integration_smoke_item",
  concept_id: "theta_invariance",
  options: [
    { label: "A", text: "Item difficulty determines person ability." },
    { label: "B", text: "Theta changes because the test form is harder." },
    { label: "C", text: "Theta is the person location on a linked latent trait scale." },
    { label: "D", text: "Discrimination changes the meaning of theta." }
  ],
  correct_option: "C",
  distractor_rationales: {
    A: "Confuses item difficulty with person ability.",
    B: "Claims theta changes because the form is harder.",
    D: "Claims discrimination changes the meaning of theta."
  },
  expected_reasoning_patterns: [
    "Theta is the person ability location on the latent trait scale.",
    "Item difficulty and discrimination describe item behavior rather than person ability."
  ],
  possible_misconception_indicators: [
    "Confuses item difficulty with person ability.",
    "Claims theta changes because the form is harder."
  ],
  administration_rules: {
    concept_id: "theta_invariance",
    cognitive_level: "understand",
    subskills: ["distinguish_person_ability_from_item_difficulty"],
    difficulty_label: "medium"
  }
});

type AbilityEvidenceInput = Omit<Parameters<typeof buildItemAbilityEvidence>[0], "item_public_id" | "metadata">;
type EngagementEvidenceInput = Omit<Parameters<typeof buildItemEngagementEvidence>[0], "item_public_id">;

class FixedProfileIntegrationProvider implements LlmProvider {
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

function abilityItem(index: number, input: AbilityEvidenceInput) {
  return buildItemAbilityEvidence({
    item_public_id: `profile_integration_smoke_item_${index}`,
    metadata,
    total_item_time_ms: 45_000,
    ...input
  });
}

function engagementItem(index: number, input: EngagementEvidenceInput) {
  return buildItemEngagementEvidence({
    item_public_id: `profile_integration_smoke_item_${index}`,
    ...input
  });
}

function inputFromEvidence(input: {
  abilities: ReturnType<typeof buildItemAbilityEvidence>[];
  engagements: ReturnType<typeof buildItemEngagementEvidence>[];
}) {
  const abilitySummary = summarizeConceptAbilityEvidence(input.abilities);
  const abilityPacket = AbilityEvidencePacketV1Schema.parse({
    schema_version: ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION,
    session_public_id: "sess_profile_integration_smoke",
    student_public_id: "student_profile_integration_smoke",
    assessment_public_id: "assessment_profile_integration_smoke",
    concept_unit_id: "concept_profile_integration_smoke",
    generated_at: new Date().toISOString(),
    source_response_package_ids: [],
    item_evidence: input.abilities,
    concept_level_summary: abilitySummary,
    student_safe_projection: projectStudentSafeAbilityStatus(abilitySummary),
    teacher_research_summary: {
      safe_internal_summary: "Synthetic ability packet for profile integration smoke.",
      evidence_trace: input.abilities.map((item) => `${item.item_public_id}:${item.ability_signal_category}`)
    }
  });
  const engagementPacket = EngagementEvidencePacketV1Schema.parse({
    schema_version: ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    session_public_id: abilityPacket.session_public_id,
    student_public_id: abilityPacket.student_public_id,
    assessment_public_id: abilityPacket.assessment_public_id,
    concept_unit_id: abilityPacket.concept_unit_id,
    source_response_package_refs: [],
    item_engagement_evidence: input.engagements,
    session_engagement_summary: summarizeSessionEngagement(input.engagements),
    engagement_rule_config: ENGAGEMENT_RULE_CONFIG_V1,
    process_data_inventory: {
      observed_event_counts: {},
      supported_event_types: [],
      missing_or_unobserved_event_types: [],
      instrumentation_limitations: []
    },
    safety_check: {
      no_misconduct_label: true,
      no_confirmed_ai_use_label: true,
      no_raw_reasoning: true,
      no_raw_process_payloads: true,
      no_answer_keys: true
    }
  });

  return buildProfileIntegrationAgentInput({
    ability_packet: abilityPacket,
    engagement_packet: engagementPacket
  });
}

function strongAbility(index: number) {
  return abilityItem(index, {
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text:
      "Theta is the person's location on the latent trait scale, while item difficulty describes item behavior.",
    no_tempting_option: true
  });
}

function engagedEvidence(index: number) {
  return engagementItem(index, {
    response_present: true,
    selected_option: "C",
    reasoning_text:
      "I separated the person ability estimate from item parameters and explained why linked forms should remain comparable.",
    item_response_time_ms: 48_000,
    revision_count: 1,
    event_counts: { typing_activity_summary: 1 },
    process_instrumentation_available: true
  });
}

async function packetFor(input: ReturnType<typeof inputFromEvidence>) {
  const packet = await callProfileIntegrationAgent(input);
  const validation = validateProfileIntegrationOutput(packet);

  assert(validation.valid, `Profile integration output should validate: ${JSON.stringify(validation.issues)}`);
  assertNoForbiddenStudentText(packet.student_safe_message);
  assert(
    ["Mostly understood", "Still developing", "Needs more work"].includes(packet.student_facing_status),
    "Student-facing integration status used an unsupported label."
  );

  return packet;
}

async function runPureIntegrationAssertions() {
  const stable = await packetFor(inputFromEvidence({
    abilities: [strongAbility(1), strongAbility(2), strongAbility(3)],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  }));
  assert(stable.integration_pattern === "stable_understanding", "Stable evidence should integrate as stable understanding.");
  assert(stable.student_facing_status === "Mostly understood", "Stable evidence should map to Mostly understood.");

  const developing = await packetFor(inputFromEvidence({
    abilities: [
      strongAbility(1),
      abilityItem(2, {
        selected_option: "C",
        correctness: "correct",
        confidence: "Low",
        reasoning_text: "Theta is about the person on the scale.",
        no_tempting_option: true
      }),
      abilityItem(3, {
        selected_option: "C",
        correctness: "correct",
        confidence: "High",
        reasoning_text: "Because it seems right.",
        no_tempting_option: true
      })
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  }));
  assert(
    developing.integration_pattern === "likely_knowledge_gap",
    "Correct answers with weak reasoning, low confidence, and uncertainty markers should not be treated as stable or merely developing."
  );
  assert(
    developing.student_facing_status === "Needs more work",
    "Unsupported correct evidence should map to a conservative student status."
  );
  assert(
    developing.teacher_research_summary.evidence_trace_summary.some((entry) =>
      entry.includes("unsupported_correct_response_count=2")
    ),
    "Unsupported correct response count should be visible to teacher/research review."
  );

  const gap = await packetFor(inputFromEvidence({
    abilities: [
      abilityItem(1, { selected_option: "E", correctness: "not_scored", confidence: "Low", reasoning_text: "I don't know the reason yet.", no_tempting_option: true }),
      abilityItem(2, { selected_option: "A", correctness: "incorrect", confidence: "Low", reasoning_text: "I am not sure.", no_tempting_option: true }),
      strongAbility(3)
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  }));
  assert(
    ["likely_knowledge_gap", "insufficient_evidence"].includes(gap.integration_pattern),
    "Low-information evidence should be a gap or insufficient evidence."
  );
  assert(
    ["Needs more work", "Still developing"].includes(gap.student_facing_status),
    "Low-information evidence should map to a safe student status."
  );

  const misconception = await packetFor(inputFromEvidence({
    abilities: [
      abilityItem(1, { selected_option: "A", correctness: "incorrect", confidence: "High", reasoning_text: "Item difficulty directly determines person ability, so harder forms lower theta.", no_tempting_option: true }),
      abilityItem(2, { selected_option: "B", correctness: "incorrect", confidence: "High", reasoning_text: "Theta changes because the form is harder.", no_tempting_option: true }),
      strongAbility(3)
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  }));
  assert(misconception.integration_pattern === "likely_misconception", "Aligned diagnostic evidence should integrate as likely misconception.");
  assert(
    ["Still developing", "Needs more work"].includes(misconception.student_facing_status),
    "Misconception evidence should map to one of the safe non-internal labels."
  );

  const correctButVague = await packetFor(inputFromEvidence({
    abilities: [
      abilityItem(1, { selected_option: "C", correctness: "correct", confidence: "High", reasoning_text: "It seems right.", no_tempting_option: true }),
      strongAbility(2),
      strongAbility(3)
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  }));
  assert(
    correctButVague.integration_pattern !== "stable_understanding",
    "Correct but vague evidence should not become stable understanding."
  );

  const mixed = await packetFor(inputFromEvidence({
    abilities: [
      strongAbility(1),
      abilityItem(2, { selected_option: "E", correctness: "not_scored", confidence: "Low", reasoning_text: "I don't know.", no_tempting_option: true }),
      abilityItem(3, { selected_option: "C", correctness: "correct", confidence: "High", reasoning_text: "Maybe because it says theta.", tempting_option: "A" })
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  }));
  assert(
    mixed.integration_pattern !== "stable_understanding" &&
      mixed.student_facing_status !== "Mostly understood",
    "Mixed weak/unsupported evidence should not be treated as stable understanding."
  );

  const disengagedContext = await packetFor(inputFromEvidence({
    abilities: [strongAbility(1), strongAbility(2), strongAbility(3)],
    engagements: [
      engagementItem(1, { response_present: true, selected_option: "C", reasoning_text: "idk", item_response_time_ms: 900, revision_count: 0, event_counts: { repeated_invalid_response: 1 }, process_instrumentation_available: true }),
      engagementItem(2, { response_present: true, selected_option: "C", reasoning_text: "idk", item_response_time_ms: 900, revision_count: 0, event_counts: { repeated_invalid_response: 1 }, process_instrumentation_available: true }),
      engagedEvidence(3)
    ]
  }));
  assert(disengagedContext.integration_pattern === "stable_understanding", "Engagement context should not directly recode ability.");
  assert(disengagedContext.status_confidence !== "high", "Low reliability context should lower interpretation confidence.");
  assertNoForbiddenStudentText(disengagedContext.student_safe_message);

  const externalContext = await packetFor(inputFromEvidence({
    abilities: [strongAbility(1), strongAbility(2), strongAbility(3)],
    engagements: [
      engagementItem(1, { response_present: true, selected_option: "C", reasoning_text: "This is a moderate explanation.", item_response_time_ms: 40_000, revision_count: 0, event_counts: { paste_detected: 1, window_blur: 1 }, process_instrumentation_available: true }),
      engagedEvidence(2),
      engagedEvidence(3)
    ]
  }));
  assert(externalContext.integration_pattern === "stable_understanding", "External-assistance context should not directly change ability pattern.");
  assert(
    externalContext.engagement_context.ai_assistance_effect_on_interpretation === "contextualizes_reasoning_evidence",
    "External-assistance context should be recorded as interpretation context."
  );
  assertNoForbiddenStudentText(externalContext.student_safe_message);

  const insufficientFallback = buildConservativeIntegrationFallback(inputFromEvidence({
    abilities: [],
    engagements: []
  }));
  assert(insufficientFallback.internal_integrated_status === "Insufficient evidence", "Fallback may use internal insufficient evidence.");
  assert(insufficientFallback.student_facing_status === "Still developing", "Internal insufficient evidence should default to Still developing.");
  assert(studentStatusForIntegrationPattern({
    pattern: "insufficient_evidence",
    misconception_strength: "insufficient_evidence",
    low_information_item_count: 0
  }) === "Still developing", "Insufficient pattern should default to Still developing.");

  const validPacket = stable;
  const currentEvidenceOnlyOutput = {
    ...validPacket,
    teacher_research_summary: {
      ...validPacket.teacher_research_summary,
      safe_internal_summary:
        "The evidence is mixed: the student provided some reasoning, but uncertainty and conflicting answer evidence limit the strength of the interpretation."
    },
    student_safe_message: {
      ...validPacket.student_safe_message,
      knowledge_focus: "Separating theta as person ability from item difficulty."
    }
  };
  assert(
    validateProfileIntegrationOutput(currentEvidenceOnlyOutput).valid,
    "Current-evidence-only teacher summary and knowledge focus should be accepted."
  );
  const formativeValueOutput = { ...validPacket, formative_value_direction: "diagnostic_clarification" };
  assert(!validateProfileIntegrationOutput(formativeValueOutput).valid, "Formative value direction should be rejected.");
  const teacherFormativeDirectionOutput = {
    ...validPacket,
    teacher_research_summary: {
      ...validPacket.teacher_research_summary,
      safe_internal_summary: "The next formative value should be misconception contrast."
    }
  };
  assert(
    !validateProfileIntegrationOutput(teacherFormativeDirectionOutput).valid,
    "Formative value direction in teacher summary should be rejected."
  );
  const teacherActivityOutput = {
    ...validPacket,
    teacher_research_summary: {
      ...validPacket.teacher_research_summary,
      safe_internal_summary: "The tutor should provide a clarification activity."
    }
  };
  assert(
    !validateProfileIntegrationOutput(teacherActivityOutput).valid,
    "Activity recommendation in teacher summary should be rejected."
  );
  const nextActivityOutput = {
    ...validPacket,
    ability_interpretation: {
      ...validPacket.ability_interpretation,
      summary: "The next activity should focus on contrasting theta and item difficulty."
    }
  };
  assert(
    !validateProfileIntegrationOutput(nextActivityOutput).valid,
    "Next-activity language in any field should be rejected."
  );
  const activityOutput = {
    ...validPacket,
    student_safe_message: {
      ...validPacket.student_safe_message,
      message: "The next activity recommendation is to compare distractors."
    }
  };
  assert(!validateProfileIntegrationOutput(activityOutput).valid, "Activity recommendation should be rejected.");
  const studentFormativeDirectionOutput = {
    ...validPacket,
    student_safe_message: {
      ...validPacket.student_safe_message,
      message: "Your formative value is diagnostic clarification."
    }
  };
  assert(
    !validateProfileIntegrationOutput(studentFormativeDirectionOutput).valid,
    "Formative value direction in student-facing text should be rejected."
  );
  const protectedOutput = {
    ...validPacket,
    student_safe_message: {
      ...validPacket.student_safe_message,
      message: "The answer key says the correct option is C."
    }
  };
  const protectedValidation = validateProfileIntegrationOutput(protectedOutput);
  assert(!protectedValidation.valid, "Protected answer-key language should be rejected.");
  assert(
    protectedValidation.issues.some((issue) => issue.rule_code === "answer_key_leak_detected"),
    "Protected answer-key language should report a safe rule code."
  );
  const rawOutput = {
    ...validPacket,
    student_safe_message: {
      ...validPacket.student_safe_message,
      message: "This message includes raw reasoning from a response."
    }
  };
  assert(!validateProfileIntegrationOutput(rawOutput).valid, "Raw reasoning exposure should be rejected.");
  const engagementLabelOutput = {
    ...validPacket,
    student_safe_message: {
      ...validPacket.student_safe_message,
      message: "Low engagement, process data, and AI assistance affected this profile."
    }
  };
  assert(
    !validateProfileIntegrationOutput(engagementLabelOutput).valid,
    "Student-facing engagement and external-assistance labels should be rejected."
  );

  const insufficientSignalInput = inputFromEvidence({
    abilities: [strongAbility(1), strongAbility(2), strongAbility(3)],
    engagements: [
      engagementItem(1, {
        response_present: true,
        selected_option: "C",
        reasoning_text:
          "Theta is the person location on the latent trait scale, while item parameters describe item behavior.",
        item_response_time_ms: 35_000,
        revision_count: 0,
        event_counts: { paste_detected: 1, typing_activity_summary: 1 },
        process_instrumentation_available: true
      }),
      engagedEvidence(2),
      engagedEvidence(3)
    ]
  });
  assert(
    insufficientSignalInput.engagement_summary.ai_assistance_signal === "insufficient_evidence",
    "Single weak process context should remain insufficient evidence."
  );
  const insufficientSignalPacket = await callProfileIntegrationAgent(insufficientSignalInput);
  const insufficientAiMentionOutput = {
    ...insufficientSignalPacket,
    evidence_rationale: [
      ...insufficientSignalPacket.evidence_rationale,
      {
        claim_type: "engagement" as const,
        claim: "AI assistance may have shaped the polished reasoning evidence.",
        supports: "reliability_context" as const,
        strength: "low" as const
      }
    ]
  };
  const insufficientAiMentionValidation = validateProfileIntegrationOutput(
    insufficientAiMentionOutput,
    insufficientSignalInput
  );
  assert(
    !insufficientAiMentionValidation.valid,
    "Insufficient external-assistance evidence should not permit an assistance claim."
  );
  assert(
    insufficientAiMentionValidation.issues.some((issue) =>
      issue.rule_code === "unsupported_integrity_claim_detected" &&
      issue.blocked_pattern_label === "ai_use_claim_without_likely_signal"
    ),
    "Insufficient assistance evidence should report a safe unsupported-claim rule."
  );

  const insufficientAuthenticityOutput = {
    ...insufficientSignalPacket,
    evidence_rationale: [
      ...insufficientSignalPacket.evidence_rationale,
      {
        claim_type: "engagement" as const,
        claim: "The response has an authenticity concern.",
        supports: "reliability_context" as const,
        strength: "low" as const
      }
    ]
  };
  const insufficientAuthenticityValidation = validateProfileIntegrationOutput(
    insufficientAuthenticityOutput,
    insufficientSignalInput
  );
  assert(
    !insufficientAuthenticityValidation.valid,
    "Authenticity claims should be rejected when process context is insufficient."
  );
  assert(
    insufficientAuthenticityValidation.issues.some((issue) =>
      issue.rule_code === "unsupported_integrity_claim_detected" &&
      issue.blocked_pattern_label === "authenticity_claim"
    ),
    "Authenticity claims should report a safe blocked label."
  );

  const noneSignalAiMentionOutput = {
    ...validPacket,
    teacher_research_summary: {
      ...validPacket.teacher_research_summary,
      safe_internal_summary: "No AI assistance was indicated in the current evidence."
    }
  };
  const noneSignalAiMentionValidation = validateProfileIntegrationOutput(
    noneSignalAiMentionOutput,
    inputFromEvidence({
      abilities: [strongAbility(1), strongAbility(2), strongAbility(3)],
      engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
    })
  );
  assert(
    !noneSignalAiMentionValidation.valid,
    "No-signal evidence should not mention AI or external assistance."
  );

  const likelySignalInput = inputFromEvidence({
    abilities: [strongAbility(1), strongAbility(2), strongAbility(3)],
    engagements: [
      engagementItem(1, {
        response_present: true,
        selected_option: "C",
        reasoning_text:
          "Theta is the person location on a common latent scale, so item parameters describe item behavior rather than changing the construct.",
        item_response_time_ms: 45_000,
        revision_count: 0,
        event_counts: { paste_detected: 1, window_blur: 1 },
        process_instrumentation_available: true
      }),
      engagedEvidence(2),
      engagedEvidence(3)
    ]
  });
  assert(
    likelySignalInput.engagement_summary.ai_assistance_signal === "likely_external_assistance_pattern",
    "Convergent process context should produce the stronger contextual signal."
  );
  const likelySignalPacket = await callProfileIntegrationAgent(likelySignalInput);
  const neutralEvidenceContextOutput = {
    ...likelySignalPacket,
    evidence_rationale: [
      ...likelySignalPacket.evidence_rationale,
      {
        claim_type: "engagement" as const,
        claim:
          "The response-production context may affect how much weight to give polished reasoning evidence.",
        supports: "reliability_context" as const,
        strength: "low" as const
      }
    ]
  };
  assert(
    validateProfileIntegrationOutput(neutralEvidenceContextOutput, likelySignalInput).valid,
    "Likely contextual signal should allow only the neutral internal response-production wording."
  );
  const likelyUnsupportedOutput = {
    ...likelySignalPacket,
    evidence_rationale: [
      ...likelySignalPacket.evidence_rationale,
      {
        claim_type: "engagement" as const,
        claim: "The student used AI to produce the response.",
        supports: "reliability_context" as const,
        strength: "low" as const
      }
    ]
  };
  const likelyUnsupportedValidation = validateProfileIntegrationOutput(
    likelyUnsupportedOutput,
    likelySignalInput
  );
  assert(
    !likelyUnsupportedValidation.valid,
    "Likely contextual signal should not allow a direct AI-use claim."
  );
  assert(
    likelyUnsupportedValidation.issues.some((issue) =>
      issue.rule_code === "unsupported_integrity_claim_detected" &&
      issue.blocked_pattern_label === "unsupported_external_assistance_claim"
    ),
    "Unsupported direct external-assistance claims should report a safe blocked label."
  );
  const likelyIntegrityOutput = {
    ...likelySignalPacket,
    teacher_research_summary: {
      ...likelySignalPacket.teacher_research_summary,
      safe_internal_summary: "The response raises an integrity concern."
    }
  };
  assert(
    !validateProfileIntegrationOutput(likelyIntegrityOutput, likelySignalInput).valid,
    "Integrity language should remain rejected even with stronger contextual process evidence."
  );

  const mixedInput = inputFromEvidence({
    abilities: [
      strongAbility(1),
      abilityItem(2, { selected_option: "E", correctness: "not_scored", confidence: "Low", reasoning_text: "I don't know.", no_tempting_option: true }),
      abilityItem(3, { selected_option: "A", correctness: "incorrect", confidence: "High", reasoning_text: "Maybe harder items lower theta.", no_tempting_option: true })
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  });
  const mixedPacket = await callProfileIntegrationAgent(mixedInput);
  const overconfidentMixedOutput = {
    ...mixedPacket,
    status_confidence: "high" as const,
    ability_interpretation: {
      ...mixedPacket.ability_interpretation,
      evidence_consistency: "mixed" as const
    }
  };
  const overconfidentValidation = validateProfileIntegrationOutput(overconfidentMixedOutput, mixedInput);
  assert(!overconfidentValidation.valid, "High confidence should be rejected for mixed or low-information evidence.");
  assert(
    overconfidentValidation.issues.some((issue) => issue.rule_code === "high_confidence_overclaim"),
    "High-confidence overclaim should report a specific rule."
  );

  const singleMisconceptionInput = inputFromEvidence({
    abilities: [
      abilityItem(1, { selected_option: "A", correctness: "incorrect", confidence: "High", reasoning_text: "Item difficulty directly determines ability.", no_tempting_option: true }),
      strongAbility(2),
      strongAbility(3)
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  });
  const unsupportedMisconceptionOutput = {
    ...(await callProfileIntegrationAgent(singleMisconceptionInput)),
    integration_pattern: "likely_misconception" as const
  };
  const unsupportedMisconceptionValidation = validateProfileIntegrationOutput(
    unsupportedMisconceptionOutput,
    singleMisconceptionInput
  );
  assert(
    !unsupportedMisconceptionValidation.valid,
    "Likely misconception should require at least two aligned sources."
  );
  assert(
    unsupportedMisconceptionValidation.issues.some((issue) =>
      issue.rule_code === "insufficient_misconception_alignment"
    ),
    "Unsupported misconception claim should report a specific rule."
  );

  const alignedMisconceptionInput = inputFromEvidence({
    abilities: [
      abilityItem(1, { selected_option: "A", correctness: "incorrect", confidence: "High", reasoning_text: "Item difficulty directly determines person ability.", no_tempting_option: true }),
      abilityItem(2, { selected_option: "B", correctness: "incorrect", confidence: "High", reasoning_text: "Theta changes because a harder form changes the person location.", no_tempting_option: true }),
      strongAbility(3)
    ],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  });
  const alignedMisconceptionPacket = await packetFor(alignedMisconceptionInput);
  assert(
    alignedMisconceptionPacket.integration_pattern === "likely_misconception",
    "Two aligned misconception sources should be allowed."
  );
}

async function runProviderPathAssertions() {
  configureNoLiveRuntime();
  const cleanupStartedAt = new Date();
  const input = inputFromEvidence({
    abilities: [strongAbility(1), strongAbility(2), strongAbility(3)],
    engagements: [engagedEvidence(1), engagedEvidence(2), engagedEvidence(3)]
  });
  const validOutput = await callProfileIntegrationAgent(input);
  const validProvider = new FixedProfileIntegrationProvider((request) => ({
    provider: "mock",
    provider_request_id: "mock_profile_integration_request",
    provider_response_id: "mock_profile_integration_response",
    client_request_id: request.client_request_id,
    status: "completed",
    parsed_output: validOutput,
    raw_output: { id: "mock_profile_integration_response", output: validOutput },
    usage: {
      input_tokens: 20,
      output_tokens: 30,
      total_tokens: 50,
      raw: { source: "mock_profile_integration_usage" }
    },
    latency_ms: 2
  }));
  const validResult = await executeProfileIntegrationAgentWithProviderForTest({
    agent_input: input,
    provider: validProvider
  });

  assert(validResult.status === "succeeded", "Valid provider output should be accepted.");
  assert(validResult.agent_call_id, "Provider path should return an audited agent call ID.");

  const validAgentCall = await prisma.agentCall.findUniqueOrThrow({
    where: { id: validResult.agent_call_id },
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

  assert(validAgentCall.agent_name === PROFILE_INTEGRATION_AGENT_NAME, "Agent call should use profile integration name.");
  assert(validAgentCall.schema_version === "profile-integration-interpretation-v1", "Agent call should store profile integration schema version.");
  assert(validAgentCall.provider_request_id === "mock_profile_integration_request", "Provider request ID should be audited.");
  assert(validAgentCall.provider_response_id === "mock_profile_integration_response", "Provider response ID should be audited.");
  assert(validAgentCall.output_validated, "Valid provider output should be marked validated.");
  assert(validAgentCall.call_status === "succeeded", "Valid provider output should mark call succeeded.");
  assert(Boolean(validAgentCall.token_usage), "Provider token usage metadata should be stored when available.");

  const invalidProvider = new FixedProfileIntegrationProvider((request) => ({
    provider: "mock",
    provider_request_id: "mock_profile_integration_bad_request",
    provider_response_id: "mock_profile_integration_bad_response",
    client_request_id: request.client_request_id,
    status: "completed",
    parsed_output: {
      ...validOutput,
      formative_value_direction: "diagnostic_clarification"
    },
    raw_output: { id: "mock_profile_integration_bad_response", output: "invalid extra field" },
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    latency_ms: 2
  }));
  const invalidResult = await executeProfileIntegrationAgentWithProviderForTest({
    agent_input: input,
    provider: invalidProvider
  });

  assert(invalidResult.status === "invalid_output", "Invalid provider output should be rejected.");
  assert(invalidResult.agent_call_id, "Rejected provider output should still be audited.");

  const invalidAgentCall = await prisma.agentCall.findUniqueOrThrow({
    where: { id: invalidResult.agent_call_id },
    select: { output_validated: true, call_status: true, validation_error: true }
  });
  assert(!invalidAgentCall.output_validated, "Rejected provider output should not validate.");
  assert(invalidAgentCall.call_status === "invalid_output", "Rejected provider output should mark invalid_output.");
  assert(
    invalidAgentCall.validation_error?.includes("schema_invalid"),
    "Rejected provider output should store safe validation issue details."
  );

  let repairCallCount = 0;
  const repairedProvider = new FixedProfileIntegrationProvider((request) => {
    repairCallCount += 1;
    const repairedOutput = repairCallCount === 1
      ? {
          ...validOutput,
          teacher_research_summary: {
            ...validOutput.teacher_research_summary,
            safe_internal_summary: "The next formative value should be misconception contrast."
          }
        }
      : {
          ...validOutput,
          teacher_research_summary: {
            ...validOutput.teacher_research_summary,
            safe_internal_summary:
              "The current evidence supports a developing understanding pattern with medium confidence."
          },
          status_confidence: "medium" as const
        };

    return {
      provider: "mock",
      provider_request_id: `mock_profile_integration_repair_request_${repairCallCount}`,
      provider_response_id: `mock_profile_integration_repair_response_${repairCallCount}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: repairedOutput,
      raw_output: { id: `mock_profile_integration_repair_response_${repairCallCount}`, output: "redacted" },
      usage: { input_tokens: 10, output_tokens: 12, total_tokens: 22 },
      latency_ms: 2
    };
  });
  const repairedResult = await executeProfileIntegrationAgentWithProviderForTest({
    agent_input: input,
    provider: repairedProvider
  });

  assert(repairedResult.status === "succeeded", "Repairable provider output should be accepted after a safe rewrite.");
  assert(repairCallCount === 2, "Repairable output should use exactly one repair attempt.");
  assert(repairedResult.agent_call_id, "Repaired provider output should return the repair agent call.");

  const repairedAgentCall = await prisma.agentCall.findUniqueOrThrow({
    where: { id: repairedResult.agent_call_id },
    select: { output_validated: true, call_status: true, provider_request_id: true }
  });
  assert(repairedAgentCall.call_status === "succeeded", "Repaired output should mark the repair call succeeded.");
  assert(repairedAgentCall.output_validated, "Repaired output should validate.");
  assert(
    repairedAgentCall.provider_request_id === "mock_profile_integration_repair_request_2",
    "Repaired output should audit the repair provider request."
  );

  let unsupportedClaimRepairCallCount = 0;
  const unsupportedClaimRepairProvider = new FixedProfileIntegrationProvider((request) => {
    unsupportedClaimRepairCallCount += 1;
    const repairedOutput = unsupportedClaimRepairCallCount === 1
      ? {
          ...validOutput,
          evidence_rationale: [
            ...validOutput.evidence_rationale,
            {
              claim_type: "engagement" as const,
              claim: "The response raises an authenticity concern.",
              supports: "reliability_context" as const,
              strength: "low" as const
            }
          ]
        }
      : {
          ...validOutput,
          evidence_rationale: [
            ...validOutput.evidence_rationale,
            {
              claim_type: "engagement" as const,
              claim: "Engagement evidence is used only as context for confidence in the current interpretation.",
              supports: "reliability_context" as const,
              strength: "low" as const
            }
          ],
          status_confidence: "medium" as const
        };

    return {
      provider: "mock",
      provider_request_id: `mock_profile_integration_unsupported_repair_request_${unsupportedClaimRepairCallCount}`,
      provider_response_id: `mock_profile_integration_unsupported_repair_response_${unsupportedClaimRepairCallCount}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: repairedOutput,
      raw_output: {
        id: `mock_profile_integration_unsupported_repair_response_${unsupportedClaimRepairCallCount}`,
        output: "redacted"
      },
      usage: { input_tokens: 10, output_tokens: 12, total_tokens: 22 },
      latency_ms: 2
    };
  });
  const unsupportedClaimRepairResult = await executeProfileIntegrationAgentWithProviderForTest({
    agent_input: input,
    provider: unsupportedClaimRepairProvider
  });

  assert(
    unsupportedClaimRepairResult.status === "succeeded",
    "Unsupported integrity/authenticity claim should be repairable once."
  );
  assert(
    unsupportedClaimRepairCallCount === 2,
    "Unsupported claim repair should use exactly one repair attempt."
  );
  assert(
    unsupportedClaimRepairResult.agent_call_id,
    "Unsupported claim repair should return the repair agent call."
  );

  const unsupportedRepairAgentCall = await prisma.agentCall.findUniqueOrThrow({
    where: { id: unsupportedClaimRepairResult.agent_call_id },
    select: { output_validated: true, call_status: true, provider_request_id: true }
  });
  assert(unsupportedRepairAgentCall.call_status === "succeeded", "Unsupported claim repair should mark repair call succeeded.");
  assert(unsupportedRepairAgentCall.output_validated, "Unsupported claim repair output should validate.");
  assert(
    unsupportedRepairAgentCall.provider_request_id === "mock_profile_integration_unsupported_repair_request_2",
    "Unsupported claim repair should audit the repair provider request."
  );

  let unsupportedClaimFailedRepairCallCount = 0;
  const unsupportedClaimFailedRepairProvider = new FixedProfileIntegrationProvider((request) => {
    unsupportedClaimFailedRepairCallCount += 1;
    const output = {
      ...validOutput,
      teacher_research_summary: {
        ...validOutput.teacher_research_summary,
        safe_internal_summary:
          unsupportedClaimFailedRepairCallCount === 1
            ? "The response raises an authenticity concern."
            : "The response raises an integrity concern."
      }
    };

    return {
      provider: "mock",
      provider_request_id: `mock_profile_integration_unsupported_failed_repair_request_${unsupportedClaimFailedRepairCallCount}`,
      provider_response_id: `mock_profile_integration_unsupported_failed_repair_response_${unsupportedClaimFailedRepairCallCount}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: output,
      raw_output: {
        id: `mock_profile_integration_unsupported_failed_repair_response_${unsupportedClaimFailedRepairCallCount}`,
        output: "redacted"
      },
      usage: { input_tokens: 8, output_tokens: 8, total_tokens: 16 },
      latency_ms: 2
    };
  });
  const unsupportedClaimFailedRepairResult = await executeProfileIntegrationAgentWithProviderForTest({
    agent_input: input,
    provider: unsupportedClaimFailedRepairProvider
  });

  assert(
    unsupportedClaimFailedRepairResult.status === "succeeded",
    "Unsupported internal integrity/authenticity wording should be canonicalized during the single repair pass."
  );
  assert(
    unsupportedClaimFailedRepairCallCount === 2,
    "Unsupported claim failed repair should still use only one repair attempt."
  );
  assert(
    unsupportedClaimFailedRepairResult.agent_call_id,
    "Canonicalized unsupported-claim repair should return the repair agent call."
  );

  const canonicalizedUnsupportedRepairCall = await prisma.agentCall.findUniqueOrThrow({
    where: { id: unsupportedClaimFailedRepairResult.agent_call_id },
    select: { output_validated: true, call_status: true, output_payload: true }
  });
  assert(
    canonicalizedUnsupportedRepairCall.call_status === "succeeded",
    "Canonicalized unsupported-claim repair should mark the repair call succeeded."
  );
  assert(
    canonicalizedUnsupportedRepairCall.output_validated,
    "Canonicalized unsupported-claim repair output should validate."
  );
  assert(
    !serialized(canonicalizedUnsupportedRepairCall.output_payload).includes("integrity concern") &&
      !serialized(canonicalizedUnsupportedRepairCall.output_payload).includes("authenticity concern"),
    "Canonicalized unsupported-claim repair output should remove unsupported integrity/authenticity wording."
  );

  let failedRepairCallCount = 0;
  const failedRepairProvider = new FixedProfileIntegrationProvider((request) => {
    failedRepairCallCount += 1;
    const output = {
      ...validOutput,
      teacher_research_summary: {
        ...validOutput.teacher_research_summary,
        safe_internal_summary:
          failedRepairCallCount === 1
            ? "The tutor should provide a clarification activity."
            : "Recommended activity: assign a transfer challenge."
      }
    };

    return {
      provider: "mock",
      provider_request_id: `mock_profile_integration_failed_repair_request_${failedRepairCallCount}`,
      provider_response_id: `mock_profile_integration_failed_repair_response_${failedRepairCallCount}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: output,
      raw_output: { id: `mock_profile_integration_failed_repair_response_${failedRepairCallCount}`, output: "redacted" },
      usage: { input_tokens: 8, output_tokens: 8, total_tokens: 16 },
      latency_ms: 2
    };
  });
  const failedRepairResult = await executeProfileIntegrationAgentWithProviderForTest({
    agent_input: input,
    provider: failedRepairProvider
  });

  assert(failedRepairResult.status === "invalid_output", "Repair path should fail closed when repair output is still unsafe.");
  assert(failedRepairCallCount === 2, "Failed repair should use only one repair attempt.");

  const liveProviderWithoutMockFlag = new FixedProfileIntegrationProvider((request) => ({
    provider: "mock",
    provider_request_id: "mock_profile_integration_live_missing_allow_request",
    provider_response_id: "mock_profile_integration_live_missing_allow_response",
    client_request_id: request.client_request_id,
    status: "completed",
    parsed_output: validOutput,
    raw_output: { id: "mock_profile_integration_live_missing_allow_response", output: validOutput },
    usage: { input_tokens: 11, output_tokens: 13, total_tokens: 24 },
    latency_ms: 2
  }));
  const activeApprovalEnv = activeApprovalEnvironmentForTest();
  await withTemporaryProcessEnv(
    {
      ...activeApprovalEnv,
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: fakeOpenAIKey("profile-integration-live-missing-allow"),
      OPENAI_API_KEY_FILE: "",
      OPENAI_MODEL_PROFILE_INTEGRATION:
        activeApprovalEnv.OPENAI_MODEL_PROFILE_INTEGRATION ?? "gpt-test-profile-integration",
      OPENAI_MODEL_PLANNING: "",
      OPENAI_MODEL_FOLLOWUP: "",
      ALLOW_LOCAL_MOCK_RUNTIME: undefined,
      ITEM_ADMIN_TUTOR_MODE: "auto"
    },
    async () => {
      await withProfileIntegrationProviderForTest(
        liveProviderWithoutMockFlag,
        async () => {
          const liveResult = await executeLiveProfileIntegrationAgent({
            agent_input: input
          });

          assert(
            liveResult.status === "succeeded",
            "Live profile integration executor should pass env parsing when ALLOW_LOCAL_MOCK_RUNTIME is missing."
          );
        }
      );
    }
  );

  await prisma.agentCall.deleteMany({
    where: {
      agent_name: PROFILE_INTEGRATION_AGENT_NAME,
      created_at: { gte: cleanupStartedAt }
    }
  });
}

async function addSyntheticProcessContext(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });
  const responses = await prisma.itemResponse.findMany({
    where: { concept_unit_session_db_id: conceptUnitSession.id },
    orderBy: [{ item: { item_order: "asc" } }],
    select: { item_db_id: true }
  });

  for (const [index, response] of responses.entries()) {
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: response.item_db_id,
      event_type: index === 1 ? "paste_detected" : "typing_activity_summary",
      event_category: "student_process",
      event_source: "frontend",
      payload:
        index === 1
          ? {
              target_kind: "textarea",
              pasted_text_length_band: "21_100",
              clipboard_type_count: 1,
              includes_plain_text: true
            }
          : {
              key_count: 40 + index,
              backspace_count: index,
              enter_key_count: 1,
              duration_ms: 30_000
            }
    });
  }
}

async function runDbPacketAssertion() {
  configureNoLiveRuntime();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const prefix = `profile_integration_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  try {
    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    sessionPublicIds.push(started.session.session_public_id);

    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
    });

    for (const itemIndex of [1, 2, 3]) {
      state = await completeInitialItem({
        studentDbId: student.id,
        sessionPublicId: started.session.session_public_id,
        prefix,
        state,
        itemIndex,
        withTemptingReason: itemIndex === 2
      });
    }
    assert(state.assessment_state === "PACKAGE_REVIEW", "Three initial items should reach package review.");
    await addSyntheticProcessContext(started.session.session_public_id);

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    await createResponsePackage({ concept_unit_session_db_id: conceptUnitSession.id });

    const abilityPacket = await buildAbilityEvidencePacketForSession(started.session.session_public_id);
    const engagementPacket = await buildEngagementEvidencePacketForSession(started.session.session_public_id);
    const packet = await buildProfileIntegrationInterpretationPacketForSession(started.session.session_public_id);
    const parsed = ProfileIntegrationInterpretationPacketV1Schema.parse(packet);
    const artifactPath = await writeProfileIntegrationReviewArtifact({
      packet: parsed,
      file_name: `profile-integration-smoke-${Date.now()}.json`
    });
    const validation = validateProfileIntegrationOutput(parsed);

    assert(abilityPacket.item_evidence.length === 3, "Ability packet should include three initial items.");
    assert(engagementPacket.item_engagement_evidence.length === 3, "Engagement packet should include three initial items.");
    assert(validation.valid, `Profile integration packet should be valid: ${JSON.stringify(validation.issues)}`);
    assert(parsed.source_packets.ability_evidence_packet_schema === "ability-evidence-packet-v1", "Profile integration should trace ability packet schema.");
    assert(parsed.source_packets.engagement_evidence_packet_schema === "engagement-evidence-packet-v1", "Profile integration should trace engagement packet schema.");
    assertNoForbiddenStudentText(parsed.student_safe_message);
    assert(!serialized(parsed).includes("formative_value_direction"), "Integration packet should not include formative value direction.");
    assert(!serialized(parsed).includes("activity_recommendation_present\":true"), "Integration packet should not include activity recommendation.");
    assert(artifactPath.includes(".data/profile-integration-review"), "Review artifact should be ignored local output.");
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function main() {
  configureNoLiveRuntime();
  await runPureIntegrationAssertions();
  await runProviderPathAssertions();
  await runDbPacketAssertion();
  console.log("Student profile-integration smoke passed. No OpenAI calls are made by this script.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
