import {
  buildCanonicalEvidenceCatalog,
  type CanonicalEvidenceCatalog
} from "../src/lib/domain/canonical-evidence-identity";
import {
  createCanonicalMisconceptionClaimCatalog,
  type CanonicalMisconceptionClaimCatalog
} from "../src/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationV18AgentInputSchema,
  FormativeConversationV18AgentOutputSchema,
  type FormativeConversationV18AgentInput,
  type FormativeConversationV18AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18";

export const V18_TEST_CONVERSATION_PUBLIC_ID =
  "fcv18_test_conversation" as const;
export const V18_TEST_ASSESSMENT_PUBLIC_ID =
  "fcv18_test_assessment" as const;
export const V18_TEST_CONCEPT_UNIT_PUBLIC_ID =
  "fcv18_test_measurement" as const;

export const V18_TEST_CLAIMS = [
  "High reliability automatically proves validity for the intended use.",
  "Standard error of measurement identifies an exact true score."
] as const;

export const V18_TEST_ASSESSMENT_RESPONSES = [
  {
    item_public_id: "measurement_reliability",
    selected_option: "B",
    correctness: "incorrect",
    written_reasoning:
      "The reliability coefficient proves the scores are valid for the intended use.",
    confidence: "high",
    tempting_option: "B",
    tempting_option_reason:
      "Consistency seems like proof that the interpretation is valid."
  },
  {
    item_public_id: "standard_error_measurement",
    selected_option: "B",
    correctness: "incorrect",
    written_reasoning: "SEM gives the exact true score.",
    confidence: "high",
    tempting_option: "B",
    tempting_option_reason: "The error adjustment seems exact."
  }
] as const;

export const V18_TEST_TRANSCRIPT = [
  {
    sequence_index: 1,
    actor: "tutor" as const,
    message_text:
      "How would you separate reliability evidence from validity evidence?",
    created_at: "2026-08-12T01:00:00.000Z"
  },
  {
    sequence_index: 2,
    actor: "student" as const,
    message_text:
      "Reliability only shows consistency. Validity still needs evidence for the intended interpretation and use.",
    created_at: "2026-08-12T01:00:10.000Z"
  },
  {
    sequence_index: 3,
    actor: "student" as const,
    message_text:
      "I can apply that distinction to a hiring test, but I have not explained SEM yet.",
    created_at: "2026-08-12T01:00:20.000Z"
  }
] as const;

export function v18TestEvidenceCatalog(input?: {
  conversation_public_id?: string;
  evidence_namespace_public_id?: string;
}): CanonicalEvidenceCatalog {
  const conversationPublicId =
    input?.conversation_public_id ?? V18_TEST_CONVERSATION_PUBLIC_ID;
  return buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id:
      input?.evidence_namespace_public_id ?? conversationPublicId,
    assessment_public_id: V18_TEST_ASSESSMENT_PUBLIC_ID,
    concept_unit_public_id: V18_TEST_CONCEPT_UNIT_PUBLIC_ID,
    conversation_public_id: conversationPublicId,
    assessment_responses: V18_TEST_ASSESSMENT_RESPONSES,
    assessment_process: [
      {
        source_public_id: "v18-test-process-package-submitted",
        event_type: "package_submitted",
        event_category: "assessment",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-12T00:59:00.000Z"
      }
    ],
    transcript: V18_TEST_TRANSCRIPT
  });
}

function evidenceId(input: {
  catalog: CanonicalEvidenceCatalog;
  kind: CanonicalEvidenceCatalog["evidence"][number]["evidence_kind"];
  item_public_id?: string;
  sequence_index?: number;
}) {
  const found = input.catalog.evidence.find(
    (entry) =>
      entry.evidence_kind === input.kind &&
      (input.item_public_id === undefined ||
        entry.item_public_id === input.item_public_id) &&
      (input.sequence_index === undefined ||
        entry.source_sequence_index === input.sequence_index)
  );
  if (!found) {
    throw new Error(`v18_test_evidence_missing:${input.kind}`);
  }
  return found.evidence_id;
}

export function v18TestClaimCatalog(
  catalog = v18TestEvidenceCatalog()
): CanonicalMisconceptionClaimCatalog {
  return createCanonicalMisconceptionClaimCatalog({
    identity_scope: "v18-test-profile",
    indicators: [
      {
        indicator:
          "Measurement statistics are treated as definitive proof.",
        evidence_reference: evidenceId({
          catalog,
          kind: "assessment_reasoning",
          item_public_id: "measurement_reliability"
        }),
        confidence: "high",
        rationale:
          "The submitted assessment reasoning supports two atomic claims.",
        atomic_claims: V18_TEST_CLAIMS.map((claimText, index) => ({
          claim_text: claimText,
          source_evidence_references: [
            evidenceId({
              catalog,
              kind: "assessment_reasoning",
              item_public_id:
                V18_TEST_ASSESSMENT_RESPONSES[index].item_public_id
            })
          ]
        }))
      }
    ]
  });
}

export function v18TestProfile(
  misconceptionIndicators: readonly string[] = V18_TEST_CLAIMS
): FormativeConversationCanonicalProfile {
  return {
    schema_version: FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
    ability_profile: "misconception_based_understanding",
    ability_pattern_flags: ["misconception_indicator_present"],
    engagement_profile: "adequate_engagement",
    engagement_pattern_flags: ["complete_response_package"],
    integrated_diagnostic_profile:
      "misconception_with_sufficient_engagement",
    integrated_profile_confidence: "high",
    integrated_profile_rationale:
      "The assessment evidence supports two distinct misconception claims.",
    evidence_sufficiency: "strong",
    confidence_alignment: "overconfident",
    independence_interpretability: "independent_understanding_likely",
    misconception_indicators: [...misconceptionIndicators],
    item_level_evidence: [
      "Assessment reasoning conflates reliability with validity.",
      "Assessment reasoning treats SEM as exact."
    ],
    reasoning_quality_summary:
      "The reasoning clearly states the two initial misconceptions.",
    engagement_summary:
      "The student supplied answers, reasoning, and confidence.",
    process_interpretation_cautions: [
      "Process observations are descriptive and not learner traits."
    ],
    profile_confidence: "high",
    rationale: "The initial profile is grounded in submitted assessment evidence.",
    recommended_next_evidence: [
      "Seek an independent application of the reliability-validity distinction.",
      "Ask the student to explain what SEM does and does not establish."
    ]
  };
}

export function v18TestContext(): FormativeConversationV18AgentInput {
  const evidenceCatalog = v18TestEvidenceCatalog();
  const claimCatalog = v18TestClaimCatalog(evidenceCatalog);
  const profile = v18TestProfile();
  const profileEvidence = {
    profile_version: "v18-test-profile-initial",
    evidence_cutoff_sequence_index: 0,
    outcome: "not_yet_determined" as const,
    evidence_summary: ["Submitted assessment evidence."],
    unresolved_evidence: [...V18_TEST_CLAIMS],
    evidence_limitations: ["Current SEM understanding has not been revisited."],
    canonical_profile: profile,
    misconception_claim_catalog: claimCatalog
  };
  return FormativeConversationV18AgentInputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION,
    conversation_public_id: V18_TEST_CONVERSATION_PUBLIC_ID,
    assessment_public_id: V18_TEST_ASSESSMENT_PUBLIC_ID,
    concept_unit_public_id: V18_TEST_CONCEPT_UNIT_PUBLIC_ID,
    latest_student_message: V18_TEST_TRANSCRIPT.at(-1)?.message_text ?? null,
    visible_transcript: V18_TEST_TRANSCRIPT,
    administered_items: [],
    assessment_specification: null,
    assessment_response_evidence: V18_TEST_ASSESSMENT_RESPONSES.map(
      (response) => ({
        ...response,
        revision_summary: null,
        safe_timing_summary: {
          total_item_time_ms: null,
          response_time_answer_ms: null,
          response_time_reasoning_ms: null,
          response_time_confidence_ms: null
        }
      })
    ),
    assessment_process_evidence: [
      {
        event_type: "package_submitted",
        event_category: "assessment",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-12T00:59:00.000Z",
        visibility_duration_ms: null,
        pause_duration_ms: null
      }
    ],
    initial_profile: profileEvidence,
    current_profile: profileEvidence,
    allowed_misconception_claim_catalog: claimCatalog,
    allowed_evidence_catalog: evidenceCatalog,
    profile_history: [],
    telemetry_summary: {
      observable_student_turn_count: 2,
      observable_tutor_turn_count: 1,
      lifecycle_event_count: 3,
      latest_activity_at: "2026-08-12T01:00:20.000Z",
      total_input_tokens: 0,
      total_output_tokens: 0
    },
    teacher_guidance: [],
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
}

export function v18CurrentStudentEvidenceIds(
  context = v18TestContext()
) {
  return context.allowed_evidence_catalog.evidence
    .filter((entry) => entry.evidence_kind === "formative_student_turn")
    .map((entry) => entry.evidence_id);
}

export function v18AssessmentReasoningEvidenceId(
  context = v18TestContext()
) {
  return evidenceId({
    catalog: context.allowed_evidence_catalog,
    kind: "assessment_reasoning",
    item_public_id: "measurement_reliability"
  });
}

export function v18TestTerminalOutput(input?: {
  context?: FormativeConversationV18AgentInput;
  current_student_evidence_ids?: string[];
}): FormativeConversationV18AgentOutput {
  const context = input?.context ?? v18TestContext();
  const currentEvidenceIds =
    input?.current_student_evidence_ids ??
    v18CurrentStudentEvidenceIds(context).slice(0, 1);
  const prior = context.current_profile.canonical_profile;
  if (!prior) {
    throw new Error("v18_test_prior_profile_missing");
  }
  const [resolvedClaim, retainedClaim] =
    context.allowed_misconception_claim_catalog.indicators[0]?.claims ?? [];
  if (!resolvedClaim || !retainedClaim || currentEvidenceIds.length === 0) {
    throw new Error("v18_test_claim_or_evidence_missing");
  }
  const updated: FormativeConversationCanonicalProfile = {
    ...structuredClone(prior),
    ability_profile: "mostly_correct_understanding",
    ability_pattern_flags: ["incorrect_answer_strong_partial_reasoning"],
    integrated_diagnostic_profile:
      "developing_understanding_with_productive_engagement",
    integrated_profile_confidence: "medium",
    integrated_profile_rationale:
      "Current student evidence resolves the reliability-validity claim while the SEM claim remains current.",
    evidence_sufficiency: "adequate",
    confidence_alignment: "mixed",
    misconception_indicators: [retainedClaim.claim_text],
    reasoning_quality_summary:
      "The student independently applies the reliability-validity distinction; SEM remains untested.",
    profile_confidence: "medium",
    rationale:
      "The conversation supports meaningful partial improvement without erasing the unresolved SEM claim.",
    recommended_next_evidence: [
      "Ask the student to explain what SEM represents around an observed score."
    ]
  };
  const changedFields = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => JSON.stringify(prior[field]) !== JSON.stringify(updated[field])
  );
  const retainedFields = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changedFields.includes(field)
  );

  return FormativeConversationV18AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "You have separated reliability from validity in a new context. SEM is the remaining distinction to examine.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "conceptual_application",
        observation:
          "The student independently applies the reliability-validity distinction.",
        evidence_ids: currentEvidenceIds
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: "largely_improved_understanding",
      rationale:
        "One atomic misconception is resolved by current student evidence and one remains supported by prior evidence.",
      canonical_evidence_ids: currentEvidenceIds,
      updated_profile: updated,
      field_evidence: [
        {
          profile_fields: changedFields,
          disposition: "updated_from_conversation_evidence",
          evidence_basis: "combined",
          rationale: "Current student evidence supports these changes.",
          evidence_ids: currentEvidenceIds
        },
        {
          profile_fields: retainedFields,
          disposition: "retained_evidence_remains_valid",
          evidence_basis: "prior_profile_evidence",
          rationale: "Prior evidence remains valid for these unchanged fields.",
          evidence_ids: []
        }
      ],
      misconception_claim_dispositions: [
        {
          identity_version:
            context.allowed_misconception_claim_catalog.identity_version,
          indicator_id:
            context.allowed_misconception_claim_catalog.indicators[0].indicator_id,
          claim_id: resolvedClaim.claim_id,
          disposition: "resolved",
          evidence_basis: "conversation_evidence",
          evidence_summary:
            "Current student evidence directly rejects and applies the claim.",
          evidence_ids: currentEvidenceIds
        },
        {
          identity_version:
            context.allowed_misconception_claim_catalog.identity_version,
          indicator_id:
            context.allowed_misconception_claim_catalog.indicators[0].indicator_id,
          claim_id: retainedClaim.claim_id,
          disposition: "retained",
          evidence_basis: "prior_profile_evidence",
          evidence_summary:
            "The prior SEM evidence remains current and no resolution is inferred from absence.",
          evidence_ids: []
        }
      ]
    },
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

export function v18TestContinueOutput(): FormativeConversationV18AgentOutput {
  return FormativeConversationV18AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Let us keep examining how reliability and validity answer different questions.",
    teaching_artifact: null,
    evidence_observations: [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}
