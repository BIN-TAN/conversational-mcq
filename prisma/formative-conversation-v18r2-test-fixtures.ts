import {
  buildCanonicalEvidenceCatalog,
  type CanonicalEvidenceCatalog
} from "../src/lib/domain/canonical-evidence-identity";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationV18AgentInputSchema,
  type FormativeConversationV18AgentInput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
  FormativeConversationV18R2AgentInputSchema,
  FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { formativeConversationV18R2LifecycleForTurnCount } from "../src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import {
  V18_TEST_ASSESSMENT_PUBLIC_ID,
  V18_TEST_ASSESSMENT_RESPONSES,
  V18_TEST_CLAIMS,
  V18_TEST_CONCEPT_UNIT_PUBLIC_ID,
  V18_TEST_CONVERSATION_PUBLIC_ID,
  v18TestClaimCatalog,
  v18TestProfile,
  v18TestTerminalOutput
} from "./formative-conversation-v18-test-fixtures";

const TEST_STARTED_AT = Date.parse("2026-08-14T00:00:00.000Z");

function timestamp(sequenceIndex: number) {
  return new Date(TEST_STARTED_AT + sequenceIndex * 1_000).toISOString();
}

function defaultStudentMessage(turnIndex: number, turnCount: number) {
  if (turnIndex === turnCount) {
    return "Reliability describes consistency, while validity needs separate evidence for the intended interpretation and use. SEM represents uncertainty around an observed score rather than an exact true score.";
  }
  return `I am still working through the distinction in formative turn ${turnIndex}.`;
}

export function v18r2TestTranscript(input: {
  student_turn_count: number;
  student_messages?: readonly string[];
}) {
  if (!Number.isInteger(input.student_turn_count) || input.student_turn_count < 0) {
    throw new Error("v18r2_test_student_turn_count_invalid");
  }
  if (input.student_turn_count === 0) return [];

  const transcript: Array<{
    sequence_index: number;
    actor: "student" | "tutor";
    message_text: string;
    created_at: string;
  }> = [
    {
      sequence_index: 1,
      actor: "tutor",
      message_text:
        "Let us use your assessment reasoning to examine reliability, validity, and score uncertainty.",
      created_at: timestamp(1)
    }
  ];
  for (let turnIndex = 1; turnIndex <= input.student_turn_count; turnIndex += 1) {
    const studentSequence = turnIndex * 2;
    transcript.push({
      sequence_index: studentSequence,
      actor: "student",
      message_text:
        input.student_messages?.[turnIndex - 1] ??
        defaultStudentMessage(turnIndex, input.student_turn_count),
      created_at: timestamp(studentSequence)
    });
    if (turnIndex < input.student_turn_count) {
      const tutorSequence = studentSequence + 1;
      transcript.push({
        sequence_index: tutorSequence,
        actor: "tutor",
        message_text: `Tutor response after formative student turn ${turnIndex}.`,
        created_at: timestamp(tutorSequence)
      });
    }
  }
  return transcript;
}

function evidenceCatalog(input: {
  conversation_public_id: string;
  transcript: ReturnType<typeof v18r2TestTranscript>;
}) {
  return buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: input.conversation_public_id,
    assessment_public_id: V18_TEST_ASSESSMENT_PUBLIC_ID,
    concept_unit_public_id: V18_TEST_CONCEPT_UNIT_PUBLIC_ID,
    conversation_public_id: input.conversation_public_id,
    assessment_responses: V18_TEST_ASSESSMENT_RESPONSES,
    assessment_process: [
      {
        source_public_id: "v18r2-test-process-package-submitted",
        event_type: "package_submitted",
        event_category: "assessment",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-13T23:59:00.000Z"
      }
    ],
    transcript: input.transcript
  });
}

export function v18r2TestContext(input: {
  student_turn_count: number;
  student_messages?: readonly string[];
  current_profile_evidence_cutoff_sequence_index?: number;
  conversation_public_id?: string;
}): FormativeConversationV18R2AgentInput {
  const conversationPublicId =
    input.conversation_public_id ?? V18_TEST_CONVERSATION_PUBLIC_ID;
  const transcript = v18r2TestTranscript(input);
  const catalog = evidenceCatalog({
    conversation_public_id: conversationPublicId,
    transcript
  });
  const claimCatalog = v18TestClaimCatalog(catalog);
  const profile = v18TestProfile();
  const profileEvidence = {
    profile_version: "v18r2-test-profile-initial",
    evidence_cutoff_sequence_index:
      input.current_profile_evidence_cutoff_sequence_index ?? 0,
    outcome: "not_yet_determined" as const,
    evidence_summary: ["Submitted assessment evidence."],
    unresolved_evidence: [...V18_TEST_CLAIMS],
    evidence_limitations: [
      "Formative understanding must be established from student-authored conversation evidence."
    ],
    canonical_profile: profile,
    misconception_claim_catalog: claimCatalog
  };
  const studentTurns = transcript.filter((turn) => turn.actor === "student");
  const tutorTurns = transcript.filter((turn) => turn.actor === "tutor");
  return FormativeConversationV18R2AgentInputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
    conversation_public_id: conversationPublicId,
    assessment_public_id: V18_TEST_ASSESSMENT_PUBLIC_ID,
    concept_unit_public_id: V18_TEST_CONCEPT_UNIT_PUBLIC_ID,
    latest_student_message: studentTurns.at(-1)?.message_text ?? null,
    visible_transcript: transcript,
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
        occurred_at: "2026-08-13T23:59:00.000Z",
        visibility_duration_ms: null,
        pause_duration_ms: null
      }
    ],
    initial_profile: {
      ...profileEvidence,
      evidence_cutoff_sequence_index: 0
    },
    current_profile: profileEvidence,
    allowed_misconception_claim_catalog: claimCatalog,
    allowed_evidence_catalog: catalog,
    profile_history: [],
    telemetry_summary: {
      observable_student_turn_count: studentTurns.length,
      observable_tutor_turn_count: tutorTurns.length,
      lifecycle_event_count: transcript.length,
      latest_activity_at: transcript.at(-1)?.created_at ?? null,
      total_input_tokens: 0,
      total_output_tokens: 0
    },
    formative_lifecycle: formativeConversationV18R2LifecycleForTurnCount(
      studentTurns.length
    ),
    teacher_guidance: [],
    intervention_history: [],
    memory: null,
    safety_boundary: {
      boundary_version: "formative-conversation-safety-boundary-v1",
      administered_item_public_ids: [],
      unadministered_item_protection_required: true,
      hidden_prompts_excluded: true,
      raw_teacher_notes_excluded: true,
      credentials_excluded: true
    }
  });
}

function asV18Context(
  context: FormativeConversationV18R2AgentInput
): FormativeConversationV18AgentInput {
  const { formative_lifecycle: ignored, ...source } = structuredClone(context);
  void ignored;
  return FormativeConversationV18AgentInputSchema.parse({
    ...source,
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION
  });
}

export function v18r2CurrentStudentEvidenceIds(
  context: FormativeConversationV18R2AgentInput
) {
  return context.allowed_evidence_catalog.evidence
    .filter((entry) => entry.evidence_kind === "formative_student_turn")
    .map((entry) => entry.evidence_id);
}

function profileFieldEvidence(input: {
  prior: FormativeConversationCanonicalProfile;
  updated: FormativeConversationCanonicalProfile;
  evidence_ids: string[];
}) {
  const changed = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) =>
      JSON.stringify(input.prior[field]) !== JSON.stringify(input.updated[field])
  );
  const retained = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changed.includes(field)
  );
  return [
    {
      profile_fields: changed,
      disposition: "updated_from_conversation_evidence" as const,
      evidence_basis: "combined" as const,
      rationale: "Current student evidence supports these profile changes.",
      evidence_ids: input.evidence_ids
    },
    {
      profile_fields: retained,
      disposition: "retained_evidence_remains_valid" as const,
      evidence_basis: "prior_profile_evidence" as const,
      rationale: "Prior evidence remains valid for these unchanged fields.",
      evidence_ids: []
    }
  ].filter((entry) => entry.profile_fields.length > 0);
}

export function v18r2TestContinueOutput(input?: {
  context?: FormativeConversationV18R2AgentInput;
  include_observation?: boolean;
}): FormativeConversationV18R2AgentOutput {
  const context = input?.context ?? v18r2TestContext({ student_turn_count: 1 });
  const evidenceIds = v18r2CurrentStudentEvidenceIds(context).slice(-1);
  return FormativeConversationV18R2AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "continue_conversation",
    student_visible_message:
      "Let us keep examining how reliability, validity, and score uncertainty answer different questions.",
    teaching_artifact: null,
    evidence_observations:
      input?.include_observation === false || evidenceIds.length === 0
        ? []
        : [
            {
              evidence_type: "current_student_reasoning",
              observation:
                "The current student message is relevant evidence but does not yet support a profile transition.",
              evidence_ids: evidenceIds
            }
          ],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function largelyImprovedOutput(
  context: FormativeConversationV18R2AgentInput,
  evidenceIds: string[]
) {
  const v18 = v18TestTerminalOutput({
    context: asV18Context(context),
    current_student_evidence_ids: evidenceIds
  });
  return FormativeConversationV18R2AgentOutputSchema.parse({
    ...v18,
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "largely_improved_understanding"
  });
}

function soundOutput(
  context: FormativeConversationV18R2AgentInput,
  evidenceIds: string[]
) {
  const prior = context.current_profile.canonical_profile;
  if (!prior) throw new Error("v18r2_test_prior_profile_missing");
  const claims = context.allowed_misconception_claim_catalog.indicators.flatMap(
    (indicator) =>
      indicator.claims.map((claim) => ({ indicator_id: indicator.indicator_id, claim }))
  );
  const updated: FormativeConversationCanonicalProfile = {
    ...structuredClone(prior),
    ability_profile: "robust_transfer_ready_understanding",
    ability_pattern_flags: ["independent_reasoning_and_transfer"],
    integrated_diagnostic_profile: "robust_understanding_ready_for_transfer",
    integrated_profile_confidence: "high",
    integrated_profile_rationale:
      "Current student evidence independently distinguishes reliability, validity, and SEM.",
    evidence_sufficiency: "strong",
    confidence_alignment: "well_calibrated",
    misconception_indicators: [],
    reasoning_quality_summary:
      "The student gives a coherent distinction and applies the limitation of SEM.",
    profile_confidence: "high",
    rationale:
      "Eligible current student evidence supports a sound understanding judgment.",
    recommended_next_evidence: [
      "Invite transfer to a new measurement interpretation context."
    ]
  };
  return FormativeConversationV18R2AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "sound_understanding",
    student_visible_message:
      "You have now separated consistency, validity evidence, and score uncertainty clearly and applied the distinctions together.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "independent_conceptual_application",
        observation:
          "The student independently distinguishes reliability, validity, and SEM.",
        evidence_ids: evidenceIds
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: "sound_understanding",
      rationale:
        "Current eligible student evidence addresses both canonical misconception claims.",
      canonical_evidence_ids: evidenceIds,
      updated_profile: updated,
      field_evidence: profileFieldEvidence({ prior, updated, evidence_ids: evidenceIds }),
      misconception_claim_dispositions: claims.map(({ indicator_id, claim }) => ({
        identity_version:
          context.allowed_misconception_claim_catalog.identity_version,
        indicator_id,
        claim_id: claim.claim_id,
        disposition: "resolved" as const,
        evidence_basis: "conversation_evidence" as const,
        evidence_summary:
          "The current student explanation directly addresses this claim.",
        evidence_ids: evidenceIds
      }))
    },
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function teacherAssistanceOutput(
  context: FormativeConversationV18R2AgentInput,
  evidenceIds: string[]
) {
  const prior = context.current_profile.canonical_profile;
  if (!prior) throw new Error("v18r2_test_prior_profile_missing");
  const claims = context.allowed_misconception_claim_catalog.indicators.flatMap(
    (indicator) =>
      indicator.claims.map((claim) => ({ indicator_id: indicator.indicator_id, claim }))
  );
  const updated: FormativeConversationCanonicalProfile = {
    ...structuredClone(prior),
    integrated_profile_rationale:
      "Current student evidence continues to show the original conceptual barrier after supportive dialogue.",
    evidence_sufficiency: "strong",
    reasoning_quality_summary:
      "The current explanation still treats consistency as proof of validity.",
    rationale:
      "The persistent barrier is supported by current student-authored evidence.",
    recommended_next_evidence: [
      "A teacher can offer a different explanation and observe the student's application."
    ]
  };
  return FormativeConversationV18R2AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "teacher_assistance_recommended",
    student_visible_message:
      "A different explanation from your instructor may help here, especially if you work through one example together.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "persistent_conceptual_barrier",
        observation:
          "The current student reasoning continues to endorse the canonical misconception.",
        evidence_ids: evidenceIds
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: "teacher_assistance_recommended",
      rationale:
        "Current student evidence supports retaining the barrier and recommending human support.",
      canonical_evidence_ids: evidenceIds,
      updated_profile: updated,
      field_evidence: profileFieldEvidence({ prior, updated, evidence_ids: evidenceIds }),
      misconception_claim_dispositions: claims.map(({ indicator_id, claim }) => ({
        identity_version:
          context.allowed_misconception_claim_catalog.identity_version,
        indicator_id,
        claim_id: claim.claim_id,
        disposition: "retained" as const,
        evidence_basis: "combined" as const,
        evidence_summary:
          "Prior evidence remains valid and current student evidence reconfirms the claim.",
        evidence_ids: evidenceIds
      }))
    },
    teacher_assistance_recommendation: {
      recommended: true,
      reason_code: "persistent_conceptual_barrier"
    },
    lifecycle_recommendation: "continue"
  });
}

export function v18r2TestTerminalOutput(input: {
  context: FormativeConversationV18R2AgentInput;
  outcome:
    | "sound_understanding"
    | "largely_improved_understanding"
    | "teacher_assistance_recommended";
}): FormativeConversationV18R2AgentOutput {
  const evidenceIds = v18r2CurrentStudentEvidenceIds(input.context).slice(-1);
  if (evidenceIds.length === 0) {
    throw new Error("v18r2_test_current_student_evidence_missing");
  }
  if (input.outcome === "sound_understanding") {
    return soundOutput(input.context, evidenceIds);
  }
  if (input.outcome === "teacher_assistance_recommended") {
    return teacherAssistanceOutput(input.context, evidenceIds);
  }
  return largelyImprovedOutput(input.context, evidenceIds);
}

export function v18r2CatalogWithEvidenceId(input: {
  context: FormativeConversationV18R2AgentInput;
  evidence_id: string;
}): CanonicalEvidenceCatalog {
  const latestStudentEvidence = [...input.context.allowed_evidence_catalog.evidence]
    .reverse()
    .find((entry) => entry.evidence_kind === "formative_student_turn");
  if (!latestStudentEvidence) {
    throw new Error("v18r2_test_current_student_evidence_missing");
  }
  return {
    ...input.context.allowed_evidence_catalog,
    evidence: input.context.allowed_evidence_catalog.evidence.map((entry) =>
      entry.evidence_id === latestStudentEvidence.evidence_id
        ? { ...entry, evidence_id: input.evidence_id }
        : entry
    )
  };
}
