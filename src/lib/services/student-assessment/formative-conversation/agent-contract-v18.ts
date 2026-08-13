import { z } from "zod";
import {
  CanonicalEligibleEvidenceCatalogSchema,
  CanonicalEvidenceIdSchema
} from "@/lib/domain/canonical-evidence-identity";
import {
  CanonicalMisconceptionClaimCatalogSchema,
  MISCONCEPTION_CLAIM_IDENTITY_VERSION
} from "@/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FormativeConversationAdministeredItemSchema,
  FormativeConversationAssessmentProcessEvidenceSchema,
  FormativeConversationAssessmentResponseEvidenceSchema,
  FormativeConversationAssessmentSpecificationSchema,
  FormativeConversationCanonicalProfileSchema,
  FormativeConversationInterventionSummarySchema,
  FormativeConversationMemorySchema,
  FormativeConversationSafetyBoundarySchema,
  FormativeConversationTranscriptTurnSchema
} from "./agent-contract";

export const FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION =
  "formative-conversation-agent-contract-v3" as const;
export const FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION =
  "formative-conversation-context-v3" as const;
export const FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION =
  "formative-conversation-profile-recommendation-v4" as const;
export const FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION =
  "formative-conversation-profile-snapshot-v2" as const;

const ProfileFieldSchema = z.enum(
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS
);

export const FormativeConversationV18ProfileEvidenceSchema = z
  .object({
    profile_version: z.string().min(1),
    evidence_cutoff_sequence_index: z.number().int().nonnegative(),
    outcome: z.enum([
      "not_yet_determined",
      "sound_understanding",
      "largely_improved_understanding",
      "teacher_assistance_recommended"
    ]),
    evidence_summary: z.array(z.string().min(1)).max(20),
    unresolved_evidence: z.array(z.string().min(1)).max(20),
    evidence_limitations: z.array(z.string().min(1)).max(20),
    canonical_profile: FormativeConversationCanonicalProfileSchema.nullable(),
    misconception_claim_catalog:
      CanonicalMisconceptionClaimCatalogSchema.nullable()
  })
  .strict();

export const FormativeConversationV18ProfileFieldEvidenceSchema = z
  .object({
    profile_fields: z
      .array(ProfileFieldSchema)
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
    evidence_ids: z.array(CanonicalEvidenceIdSchema).max(40)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.disposition === "updated_from_conversation_evidence" &&
      (value.evidence_basis === "prior_profile_evidence" ||
        value.evidence_ids.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence_ids"],
        message: "Updated fields require canonical current evidence IDs."
      });
    }
  });

export const FormativeConversationV18MisconceptionClaimDispositionSchema = z
  .object({
    identity_version: z.literal(MISCONCEPTION_CLAIM_IDENTITY_VERSION),
    indicator_id: z.string().regex(/^mi_[a-f0-9]{24}$/u),
    claim_id: z.string().regex(/^mc_[a-f0-9]{24}$/u),
    disposition: z.enum(["resolved", "retained"]),
    evidence_basis: z.enum([
      "prior_profile_evidence",
      "conversation_evidence",
      "combined"
    ]),
    evidence_summary: z.string().trim().min(1).max(1_200),
    evidence_ids: z.array(CanonicalEvidenceIdSchema).max(40)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.disposition === "resolved" &&
      (value.evidence_basis === "prior_profile_evidence" ||
        value.evidence_ids.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence_ids"],
        message:
          "A resolved misconception claim requires canonical current student evidence IDs."
      });
    }
  });

export const FormativeConversationV18ProfileTransitionRecommendationSchema = z
  .object({
    recommendation_version: z.literal(
      FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION
    ),
    recommended: z.boolean(),
    proposed_outcome: z.enum([
      "sound_understanding",
      "largely_improved_understanding",
      "teacher_assistance_recommended",
      "continue_conversation"
    ]),
    rationale: z.string().min(1).max(2_000),
    canonical_evidence_ids: z.array(CanonicalEvidenceIdSchema).max(100),
    updated_profile: FormativeConversationCanonicalProfileSchema.nullable(),
    field_evidence: z
      .array(FormativeConversationV18ProfileFieldEvidenceSchema)
      .max(20),
    misconception_claim_dispositions: z
      .array(FormativeConversationV18MisconceptionClaimDispositionSchema)
      .max(400)
  })
  .strict()
  .superRefine((value, context) => {
    const terminal = value.proposed_outcome !== "continue_conversation";
    if (value.recommended !== terminal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommended"],
        message: "recommended must be true only for a terminal transition."
      });
    }
    if (terminal && value.canonical_evidence_ids.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonical_evidence_ids"],
        message: "A terminal transition requires canonical evidence IDs."
      });
    }
    if (terminal && value.updated_profile === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updated_profile"],
        message: "A terminal transition requires a complete updated profile."
      });
    }
    if (
      !terminal &&
      (value.updated_profile !== null ||
        value.field_evidence.length > 0 ||
        value.misconception_claim_dispositions.length > 0 ||
        value.canonical_evidence_ids.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updated_profile"],
        message:
          "continue_conversation records observations without creating a profile transition."
      });
    }
    if (!terminal) {
      return;
    }

    const covered = new Map<string, number>();
    for (const entry of value.field_evidence) {
      for (const field of entry.profile_fields) {
        covered.set(field, (covered.get(field) ?? 0) + 1);
      }
    }
    for (const field of FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS) {
      if (covered.get(field) !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["field_evidence"],
          message: `Field evidence must cover ${field} exactly once.`
        });
      }
    }
  });

export const FormativeConversationV18EvidenceObservationSchema = z
  .object({
    evidence_type: z.string().min(1),
    observation: z.string().min(1),
    evidence_ids: z.array(CanonicalEvidenceIdSchema).min(1).max(40)
  })
  .strict();

export const FormativeConversationV18AgentInputSchema = z
  .object({
    contract_version: z.literal(
      FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION
    ),
    context_version: z.literal(FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION),
    conversation_public_id: z.string().min(1),
    assessment_public_id: z.string().min(1),
    concept_unit_public_id: z.string().min(1),
    latest_student_message: z.string().min(1).max(5_000).nullable(),
    visible_transcript: z.array(FormativeConversationTranscriptTurnSchema),
    administered_items: z.array(FormativeConversationAdministeredItemSchema),
    assessment_specification:
      FormativeConversationAssessmentSpecificationSchema.nullable(),
    assessment_response_evidence: z.array(
      FormativeConversationAssessmentResponseEvidenceSchema
    ),
    assessment_process_evidence: z
      .array(FormativeConversationAssessmentProcessEvidenceSchema)
      .max(500),
    initial_profile: FormativeConversationV18ProfileEvidenceSchema,
    current_profile: FormativeConversationV18ProfileEvidenceSchema,
    allowed_misconception_claim_catalog:
      CanonicalMisconceptionClaimCatalogSchema,
    allowed_evidence_catalog: CanonicalEligibleEvidenceCatalogSchema,
    profile_history: z.array(
      z
        .object({
          profile_version: z.string().min(1),
          outcome: FormativeConversationV18ProfileEvidenceSchema.shape.outcome,
          created_at: z.string().datetime(),
          evidence_source: z.string().min(1)
        })
        .strict()
    ),
    telemetry_summary: z
      .object({
        observable_student_turn_count: z.number().int().nonnegative(),
        observable_tutor_turn_count: z.number().int().nonnegative(),
        lifecycle_event_count: z.number().int().nonnegative(),
        latest_activity_at: z.string().datetime().nullable(),
        total_input_tokens: z.number().int().nonnegative(),
        total_output_tokens: z.number().int().nonnegative()
      })
      .strict(),
    teacher_guidance: z.array(z.string().min(1).max(1_200)).max(12),
    intervention_history: z.array(
      FormativeConversationInterventionSummarySchema
    ),
    memory: FormativeConversationMemorySchema.nullable(),
    safety_boundary: FormativeConversationSafetyBoundarySchema
  })
  .strict();

export const FormativeConversationV18AgentOutputSchema = z
  .object({
    contract_version: z.literal(
      FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION
    ),
    student_visible_message: z.string().min(1).max(12_000),
    teaching_artifact: z
      .object({
        artifact_type: z.string().min(1),
        student_visible_content: z.string().min(1).max(12_000)
      })
      .strict()
      .nullable(),
    evidence_observations: z.array(
      FormativeConversationV18EvidenceObservationSchema
    ),
    profile_transition_recommendation:
      FormativeConversationV18ProfileTransitionRecommendationSchema.nullable(),
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
    const terminalRecommendation =
      value.profile_transition_recommendation?.proposed_outcome !== undefined &&
      value.profile_transition_recommendation.proposed_outcome !==
        "continue_conversation";
    if (terminalRecommendation && value.evidence_observations.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence_observations"],
        message:
          "A terminal profile transition requires an evidence-bearing observation."
      });
    }
    const teacherAssistance =
      value.profile_transition_recommendation?.proposed_outcome ===
      "teacher_assistance_recommended";
    if (
      value.teacher_assistance_recommendation.recommended !== teacherAssistance
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teacher_assistance_recommendation", "recommended"],
        message:
          "Teacher assistance must mirror the authoritative transition outcome."
      });
    }
    if (
      teacherAssistance !==
      (value.teacher_assistance_recommendation.reason_code !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teacher_assistance_recommendation", "reason_code"],
        message:
          "Teacher assistance reason code must be present only for that outcome."
      });
    }
  });

export const FormativeConversationV18PersistedProfileSnapshotSchema = z
  .object({
    snapshot_version: z.literal(
      FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION
    ),
    prior_profile_evidence_cutoff_sequence_index: z
      .number()
      .int()
      .nonnegative(),
    profile: FormativeConversationV18ProfileEvidenceSchema,
    field_evidence: z
      .array(FormativeConversationV18ProfileFieldEvidenceSchema)
      .max(20),
    misconception_claim_dispositions: z
      .array(FormativeConversationV18MisconceptionClaimDispositionSchema)
      .max(400),
    canonical_evidence_catalog: CanonicalEligibleEvidenceCatalogSchema,
    canonical_evidence_ids: z.array(CanonicalEvidenceIdSchema).min(1).max(100),
    evidence_observations: z.array(
      FormativeConversationV18EvidenceObservationSchema
    ),
    rationale: z.string().min(1).max(2_000),
    derived_source_turn_sequence_indexes: z
      .array(z.number().int().positive())
      .max(100)
  })
  .strict();

export type FormativeConversationV18AgentInput = z.infer<
  typeof FormativeConversationV18AgentInputSchema
>;
export type FormativeConversationV18AgentOutput = z.infer<
  typeof FormativeConversationV18AgentOutputSchema
>;
export type FormativeConversationV18ProfileEvidence = z.infer<
  typeof FormativeConversationV18ProfileEvidenceSchema
>;
export type FormativeConversationV18ProfileFieldEvidence = z.infer<
  typeof FormativeConversationV18ProfileFieldEvidenceSchema
>;
export type FormativeConversationV18PersistedProfileSnapshot = z.infer<
  typeof FormativeConversationV18PersistedProfileSnapshotSchema
>;
