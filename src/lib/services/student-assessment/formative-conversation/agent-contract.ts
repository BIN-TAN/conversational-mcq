import { z } from "zod";
import { FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION } from "./misconception-evidence-closure";
import { validateFormativeConversationTransitionEvidenceClosure } from "./transition-evidence-closure";

export const FORMATIVE_CONVERSATION_AGENT_NAME = "formative_conversation_agent";
export const FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION =
  "formative-conversation-agent-contract-v1";
export const FORMATIVE_CONVERSATION_CONTEXT_VERSION =
  "formative-conversation-context-v1";
export const FORMATIVE_CONVERSATION_MEMORY_VERSION =
  "formative-conversation-memory-v1";
export const FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION =
  "formative-conversation-safety-boundary-v1";
export const FORMATIVE_CONVERSATION_ASSESSMENT_SPECIFICATION_VERSION =
  "formative-conversation-assessment-specification-v1";
export const FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION =
  "formative-conversation-learning-profile-v1";
export const FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION =
  "formative-conversation-profile-recommendation-v2";
export const FORMATIVE_CONVERSATION_DECISION_COHERENCE_VERSION =
  "formative-conversation-decision-coherence-v1";

export const FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS = [
  "ability_profile",
  "ability_pattern_flags",
  "engagement_profile",
  "engagement_pattern_flags",
  "integrated_diagnostic_profile",
  "integrated_profile_confidence",
  "integrated_profile_rationale",
  "evidence_sufficiency",
  "confidence_alignment",
  "independence_interpretability",
  "misconception_indicators",
  "item_level_evidence",
  "reasoning_quality_summary",
  "engagement_summary",
  "process_interpretation_cautions",
  "profile_confidence",
  "rationale",
  "recommended_next_evidence"
] as const;

const FormativeConversationCanonicalProfileFieldSchema = z.enum(
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS
);

const FormativeConversationProfileTextListSchema = z
  .array(z.string().min(1).max(1_200))
  .max(50);

export const FormativeConversationCanonicalProfileSchema = z
  .object({
    schema_version: z.literal(
      FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION
    ),
    ability_profile: z.enum([
      "insufficient_evidence",
      "minimal_or_no_demonstrated_understanding",
      "fragmented_or_limited_understanding",
      "partial_understanding",
      "misconception_based_understanding",
      "fragile_correct_understanding",
      "procedural_or_application_error",
      "mostly_correct_understanding",
      "robust_transfer_ready_understanding"
    ]),
    ability_pattern_flags:
      FormativeConversationProfileTextListSchema.max(20),
    engagement_profile: z.enum([
      "insufficient_process_evidence",
      "low_engagement",
      "variable_engagement",
      "adequate_engagement",
      "productive_engagement",
      "sustained_high_engagement"
    ]),
    engagement_pattern_flags:
      FormativeConversationProfileTextListSchema.max(20),
    integrated_diagnostic_profile: z.enum([
      "insufficient_evidence_for_formative_decision",
      "low_engagement_limits_interpretability",
      "conflicting_evidence_needs_clarification",
      "developing_understanding_with_productive_engagement",
      "misconception_with_sufficient_engagement",
      "correct_but_fragile_understanding",
      "correct_but_independence_uncertain",
      "underconfident_but_reasoning_supported",
      "robust_understanding_ready_for_transfer"
    ]),
    integrated_profile_confidence: z.enum(["low", "medium", "high"]),
    integrated_profile_rationale: z.string().min(1).max(4_000),
    evidence_sufficiency: z.enum([
      "insufficient",
      "limited",
      "adequate",
      "strong"
    ]),
    confidence_alignment: z.enum([
      "insufficient_evidence",
      "underconfident",
      "well_calibrated",
      "overconfident",
      "mixed"
    ]),
    independence_interpretability: z.enum([
      "not_applicable",
      "independent_understanding_likely",
      "independent_understanding_uncertain",
      "insufficient_evidence"
    ]),
    misconception_indicators:
      FormativeConversationProfileTextListSchema.max(20),
    item_level_evidence:
      FormativeConversationProfileTextListSchema.max(50),
    reasoning_quality_summary: z.string().min(1).max(4_000),
    engagement_summary: z.string().min(1).max(4_000),
    process_interpretation_cautions:
      FormativeConversationProfileTextListSchema.max(20),
    profile_confidence: z.enum(["low", "medium", "high"]),
    rationale: z.string().min(1).max(4_000),
    recommended_next_evidence:
      FormativeConversationProfileTextListSchema.max(20)
  })
  .strict();

export const FormativeConversationProfileFieldEvidenceSchema = z
  .object({
    profile_fields: z
      .array(FormativeConversationCanonicalProfileFieldSchema)
      .min(1)
      .max(FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.length),
    disposition: z.enum([
      "updated_from_conversation_evidence",
      "retained_evidence_remains_valid"
    ]),
    evidence_basis: z.enum([
      "prior_profile_evidence",
      "conversation_evidence",
      "combined"
    ]),
    rationale: z.string().min(1).max(1_200),
    source_turn_sequence_indexes: z
      .array(z.number().int().positive())
      .max(40)
  })
  .strict();

const FormativeConversationMisconceptionAtomicClaimSchema = z
  .object({
    claim_text: z.string().trim().min(1).max(1_200),
    disposition: z.enum([
      "resolved_by_conversation_evidence",
      "retained_current_misconception"
    ]),
    evidence_basis: z.enum([
      "prior_profile_evidence",
      "conversation_evidence",
      "combined"
    ]),
    evidence_summary: z.string().trim().min(1).max(1_200),
    source_turn_sequence_indexes: z
      .array(z.number().int().positive())
      .max(40)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.disposition === "resolved_by_conversation_evidence" &&
      (value.evidence_basis === "prior_profile_evidence" ||
        value.source_turn_sequence_indexes.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_turn_sequence_indexes"],
        message:
          "A resolved misconception claim requires cited conversation evidence."
      });
    }
  });

export const FormativeConversationMisconceptionIndicatorClosureSchema = z
  .object({
    closure_version: z.literal(
      FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION
    ),
    prior_indicator: z.string().trim().min(1).max(1_200),
    coverage: z.literal("all_atomic_claims_represented"),
    atomic_claims: z
      .array(FormativeConversationMisconceptionAtomicClaimSchema)
      .min(1)
      .max(20)
  })
  .strict();

const FormativeConversationProfileTransitionRecommendationSchema = z
  .object({
    recommendation_version: z.literal(
      FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION
    ),
    recommended: z.boolean(),
    proposed_outcome: z.enum([
      "sound_understanding",
      "largely_improved_understanding",
      "teacher_assistance_recommended",
      "continue_conversation"
    ]),
    rationale: z.string().min(1).max(2_000),
    source_turn_sequence_indexes: z
      .array(z.number().int().positive())
      .max(40),
    updated_profile:
      FormativeConversationCanonicalProfileSchema.nullable(),
    field_evidence: z
      .array(FormativeConversationProfileFieldEvidenceSchema)
      .max(20),
    misconception_claim_closure: z
      .array(FormativeConversationMisconceptionIndicatorClosureSchema)
      .max(20)
      .default([])
  })
  .strict()
  .superRefine((value, context) => {
    const terminalRecommendation =
      value.proposed_outcome !== "continue_conversation";
    if (value.recommended !== terminalRecommendation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommended"],
        message:
          "recommended must be true only for a terminal profile transition"
      });
    }
    if (
      terminalRecommendation &&
      value.source_turn_sequence_indexes.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_turn_sequence_indexes"],
        message: "a terminal transition requires conversation evidence"
      });
    }
    if (terminalRecommendation && !value.updated_profile) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updated_profile"],
        message: "a terminal transition requires a complete updated profile"
      });
    }
    if (
      !terminalRecommendation &&
      (value.updated_profile !== null ||
        value.field_evidence.length > 0 ||
        (value.misconception_claim_closure?.length ?? 0) > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updated_profile"],
        message:
          "continue_conversation records evidence without creating a profile transition"
      });
    }
    if (!terminalRecommendation) {
      return;
    }

    const coveredFields = new Map<string, number>();
    for (const evidence of value.field_evidence) {
      for (const field of evidence.profile_fields) {
        coveredFields.set(field, (coveredFields.get(field) ?? 0) + 1);
      }
      if (
        evidence.disposition ===
          "updated_from_conversation_evidence" &&
        (evidence.evidence_basis === "prior_profile_evidence" ||
          evidence.source_turn_sequence_indexes.length === 0)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["field_evidence"],
          message:
            "updated fields require cited conversation evidence"
        });
      }
    }
    for (const field of FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS) {
      if (coveredFields.get(field) !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["field_evidence"],
          message: `field evidence must cover ${field} exactly once`
        });
      }
    }
  });

export const FormativeConversationTranscriptTurnSchema = z
  .object({
    sequence_index: z.number().int().positive(),
    actor: z.enum(["student", "tutor"]),
    message_text: z.string().min(1).max(12_000),
    created_at: z.string().datetime()
  })
  .strict();

export const FormativeConversationAdministeredItemSchema = z
  .object({
    item_public_id: z.string().min(1),
    item_number: z.number().int().positive(),
    item_stem: z.string().min(1),
    options: z
      .array(
        z
          .object({
            label: z.string().min(1).max(8),
            text: z.string().min(1)
          })
          .strict()
      )
      .min(2),
    student_answer: z.string().min(1).nullable(),
    correct_answer: z.string().min(1),
    concise_explanation: z.string().min(1),
    administered: z.literal(true)
  })
  .strict();

export const FormativeConversationAssessmentSpecificationSchema = z
  .object({
    schema_version: z.literal(
      FORMATIVE_CONVERSATION_ASSESSMENT_SPECIFICATION_VERSION
    ),
    assessment_title: z.string().min(1).nullable(),
    diagnostic_focus: z.string().min(1).nullable(),
    concept_unit_title: z.string().min(1).nullable(),
    learning_objective: z.string().min(1).nullable(),
    related_concept_description: z.string().min(1).nullable(),
    administered_item_guidance: z.array(
      z
        .object({
          item_public_id: z.string().min(1),
          target_reasoning_note: z.string().min(1).nullable(),
          strong_reasoning_should_mention: z.string().min(1).nullable(),
          plain_language_distractor_diagnostic_notes: z
            .string()
            .min(1)
            .nullable(),
          interpretation_caution: z.string().min(1).nullable()
        })
        .strict()
    ),
    boundaries: z
      .object({
        administered_items_only: z.literal(true),
        unadministered_item_content_protected: z.literal(true),
        administered_answer_discussion_allowed: z.literal(true),
        raw_teacher_notes_must_not_be_quoted: z.literal(true),
        pedagogy_owner: z.literal(FORMATIVE_CONVERSATION_AGENT_NAME),
        legacy_activity_routing_authoritative: z.literal(false)
      })
      .strict()
  })
  .strict();

export const FormativeConversationAssessmentResponseEvidenceSchema = z
  .object({
    item_public_id: z.string().min(1),
    selected_option: z.string().min(1).nullable(),
    correctness: z.enum(["correct", "incorrect", "not_scored", "unanswered"]),
    written_reasoning: z.string().min(1).nullable(),
    confidence: z.string().min(1).nullable(),
    revision_summary: z.string().min(1).nullable(),
    tempting_option: z.string().min(1).nullable(),
    tempting_option_reason: z.string().min(1).nullable(),
    safe_timing_summary: z
      .object({
        total_item_time_ms: z.number().int().nonnegative().nullable(),
        response_time_answer_ms: z.number().int().nonnegative().nullable(),
        response_time_reasoning_ms: z.number().int().nonnegative().nullable(),
        response_time_confidence_ms: z.number().int().nonnegative().nullable()
      })
      .strict()
  })
  .strict();

export const FormativeConversationAssessmentProcessEvidenceSchema = z
  .object({
    event_type: z.string().min(1),
    event_category: z.string().min(1),
    event_source: z.string().min(1),
    item_public_id: z.string().min(1).nullable(),
    occurred_at: z.string().datetime(),
    visibility_duration_ms: z.number().int().nonnegative().nullable(),
    pause_duration_ms: z.number().int().nonnegative().nullable()
  })
  .strict();

export const FormativeConversationProfileEvidenceSchema = z
  .object({
    profile_version: z.string().min(1),
    outcome: z.enum([
      "not_yet_determined",
      "sound_understanding",
      "largely_improved_understanding",
      "teacher_assistance_recommended"
    ]),
    evidence_summary: z.array(z.string().min(1)).max(20),
    unresolved_evidence: z.array(z.string().min(1)).max(20),
    evidence_limitations: z.array(z.string().min(1)).max(20),
    canonical_profile:
      FormativeConversationCanonicalProfileSchema.nullable().default(null),
    field_evidence: z
      .array(FormativeConversationProfileFieldEvidenceSchema)
      .max(20)
      .default([]),
    misconception_claim_closure: z
      .array(FormativeConversationMisconceptionIndicatorClosureSchema)
      .max(20)
      .optional()
  })
  .strict();

export const FormativeConversationInterventionSummarySchema = z
  .object({
    intervention_public_id: z.string().min(1),
    strategy_type: z.string().min(1),
    targeted_evidence_gap: z.string().min(1),
    status: z.enum(["active", "completed", "abandoned"]),
    outcome_summary: z.array(z.string().min(1)).max(20)
  })
  .strict();

export const FormativeConversationMemorySchema = z
  .object({
    snapshot_public_id: z.string().min(1),
    snapshot_index: z.number().int().positive(),
    schema_version: z.string().min(1),
    source_transcript_hash: z.string().regex(/^[a-f0-9]{64}$/),
    summary: z.record(z.string(), z.unknown())
  })
  .strict();

export const FormativeConversationSafetyBoundarySchema = z
  .object({
    boundary_version: z.literal(FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION),
    administered_item_public_ids: z.array(z.string().min(1)),
    unadministered_item_protection_required: z.literal(true),
    hidden_prompts_excluded: z.literal(true),
    raw_teacher_notes_excluded: z.literal(true),
    credentials_excluded: z.literal(true)
  })
  .strict();

export const FormativeConversationAgentInputSchema = z
  .object({
    contract_version: z.literal(FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION),
    context_version: z.literal(FORMATIVE_CONVERSATION_CONTEXT_VERSION),
    conversation_public_id: z.string().min(1),
    assessment_public_id: z.string().min(1),
    concept_unit_public_id: z.string().min(1),
    latest_student_message: z.string().min(1).max(5_000).nullable(),
    visible_transcript: z.array(FormativeConversationTranscriptTurnSchema),
    administered_items: z.array(FormativeConversationAdministeredItemSchema),
    assessment_specification:
      FormativeConversationAssessmentSpecificationSchema.nullable().default(
        null
      ),
    assessment_response_evidence: z
      .array(FormativeConversationAssessmentResponseEvidenceSchema)
      .default([]),
    assessment_process_evidence: z
      .array(FormativeConversationAssessmentProcessEvidenceSchema)
      .max(500)
      .default([]),
    initial_profile: FormativeConversationProfileEvidenceSchema,
    current_profile: FormativeConversationProfileEvidenceSchema,
    profile_history: z
      .array(
        z
          .object({
            profile_version: z.string().min(1),
            outcome: FormativeConversationProfileEvidenceSchema.shape.outcome,
            created_at: z.string().datetime(),
            evidence_source: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    telemetry_summary: z
      .object({
        observable_student_turn_count: z.number().int().nonnegative(),
        observable_tutor_turn_count: z.number().int().nonnegative(),
        lifecycle_event_count: z.number().int().nonnegative(),
        latest_activity_at: z.string().datetime().nullable(),
        total_input_tokens: z.number().int().nonnegative(),
        total_output_tokens: z.number().int().nonnegative()
      })
      .strict()
      .default({
        observable_student_turn_count: 0,
        observable_tutor_turn_count: 0,
        lifecycle_event_count: 0,
        latest_activity_at: null,
        total_input_tokens: 0,
        total_output_tokens: 0
      }),
    teacher_guidance: z.array(z.string().min(1).max(1_200)).max(12).default([]),
    intervention_history: z.array(FormativeConversationInterventionSummarySchema),
    memory: FormativeConversationMemorySchema.nullable(),
    safety_boundary: FormativeConversationSafetyBoundarySchema
  })
  .strict();

export const FormativeConversationAgentOutputSchema = z
  .object({
    contract_version: z.literal(FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION),
    student_visible_message: z.string().min(1).max(12_000),
    teaching_artifact: z
      .object({
        artifact_type: z.string().min(1),
        student_visible_content: z.string().min(1).max(12_000)
      })
      .strict()
      .nullable(),
    evidence_observations: z.array(
      z
        .object({
          evidence_type: z.string().min(1),
          observation: z.string().min(1),
          source_turn_sequence_indexes: z.array(z.number().int().positive())
        })
        .strict()
    ),
    profile_transition_recommendation:
      FormativeConversationProfileTransitionRecommendationSchema
      .nullable()
      .default(null),
    teacher_assistance_recommendation: z
      .object({
        recommended: z.boolean(),
        reason_code: z.string().min(1).nullable()
      })
      .strict(),
    lifecycle_recommendation: z.enum(["continue", "pause", "complete"])
  })
  .strict()
  .superRefine((value, context) => {
    const evidenceClosure =
      validateFormativeConversationTransitionEvidenceClosure({
        recommendation: value.profile_transition_recommendation,
        evidence_observations: value.evidence_observations
      });
    for (const closureIssue of evidenceClosure.issues) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          ...closureIssue.field_path.split("."),
          closureIssue.code
        ],
        message: `${closureIssue.code}: ${closureIssue.message}`
      });
    }

    const teacherAssistanceIsAuthoritativeOutcome =
      value.profile_transition_recommendation?.proposed_outcome ===
      "teacher_assistance_recommended";
    if (
      value.teacher_assistance_recommendation.recommended !==
      teacherAssistanceIsAuthoritativeOutcome
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teacher_assistance_recommendation", "recommended"],
        message:
          "teacher assistance must mirror the authoritative profile transition outcome"
      });
    }
    if (
      teacherAssistanceIsAuthoritativeOutcome &&
      value.teacher_assistance_recommendation.reason_code === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teacher_assistance_recommendation", "reason_code"],
        message:
          "teacher assistance requires a reason code when it is the proposed profile outcome"
      });
    }
    if (
      !teacherAssistanceIsAuthoritativeOutcome &&
      value.teacher_assistance_recommendation.reason_code !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teacher_assistance_recommendation", "reason_code"],
        message:
          "teacher assistance reason code must be null when assistance is not the proposed profile outcome"
      });
    }
  });

export type FormativeConversationAgentInput = z.infer<
  typeof FormativeConversationAgentInputSchema
>;
export type FormativeConversationAgentOutput = z.infer<
  typeof FormativeConversationAgentOutputSchema
>;
export type FormativeConversationProfileEvidence = z.infer<
  typeof FormativeConversationProfileEvidenceSchema
>;
export type FormativeConversationCanonicalProfile = z.infer<
  typeof FormativeConversationCanonicalProfileSchema
>;
export type FormativeConversationProfileFieldEvidence = z.infer<
  typeof FormativeConversationProfileFieldEvidenceSchema
>;
export type FormativeConversationAdministeredItem = z.infer<
  typeof FormativeConversationAdministeredItemSchema
>;
export type FormativeConversationAssessmentSpecification = z.infer<
  typeof FormativeConversationAssessmentSpecificationSchema
>;
export type FormativeConversationAssessmentResponseEvidence = z.infer<
  typeof FormativeConversationAssessmentResponseEvidenceSchema
>;
export type FormativeConversationAssessmentProcessEvidence = z.infer<
  typeof FormativeConversationAssessmentProcessEvidenceSchema
>;
