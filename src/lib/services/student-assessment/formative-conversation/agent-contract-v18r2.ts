import { z } from "zod";
import { AssistanceHistorySchema } from "./assistance-history";
import { ConversationContinuitySchema, ConversationReviewSchema } from "./conversation-continuity";
import { CanonicalEligibleEvidenceCatalogSchema } from "@/lib/domain/canonical-evidence-identity";
import { CanonicalMisconceptionClaimCatalogSchema } from "@/lib/domain/misconception-claim-identity";
import {
  FormativeConversationAdministeredItemSchema,
  FormativeConversationAssessmentProcessEvidenceSchema,
  FormativeConversationAssessmentResponseEvidenceSchema,
  FormativeConversationAssessmentSpecificationSchema,
  FormativeConversationInterventionSummarySchema,
  FormativeConversationMemorySchema,
  FormativeConversationSafetyBoundarySchema,
  FormativeConversationTranscriptTurnSchema
} from "./agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
  FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION,
  FormativeConversationV18EvidenceObservationSchema,
  FormativeConversationV18MisconceptionClaimDispositionSchema,
  FormativeConversationV18PersistedProfileSnapshotSchema,
  FormativeConversationV18ProfileEvidenceSchema,
  FormativeConversationV18ProfileFieldEvidenceSchema,
  FormativeConversationV18ProfileTransitionRecommendationSchema
} from "./agent-contract-v18";
import {
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
  FormativeConversationV18R2FormativeLifecycleSchema
} from "./lifecycle-contract-v18r2";

export const FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION =
  "formative-conversation-agent-contract-v4" as const;
export const FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION =
  "formative-conversation-context-v4" as const;
export const FORMATIVE_CONVERSATION_SCOPE_NARROWING_INSTRUCTIONS = `
In pre_reply_plan V2, retaining an existing preference uses exactly
{preference_id,decision:"retain"}. Do not include prior, current_source,
change_basis, kind or description in that branch. The application preserves the
stored preference's identity, status and source; a released preference stays released.
For example, a stop or recap request that leaves an existing deferral unchanged
needs only that retained ID and decision, not a new quote about uncertainty.
Activating or releasing a preference is a different, source-grounded transition.
A boundary recovered from visible history still uses its separate history-source
branch; it cannot masquerade as an existing stored preference.
When a student changes only part of a broad topic boundary, preserve the part that
still applies. Releasing a broad preference does not itself create its narrower
replacement. If the student's exact words reopen one subject but still defer
another, explicitly release the broad preference, activate a distinct narrower
preference from the supporting student source, and relink any still-deferred needs
to that active preference in the same candidate. Keep the stored broad preference's
identity and description unchanged. Author the narrower scope from the conversation;
do not infer consent from renewed uncertainty, from an identifier, or from validation
feedback. A deferred need must remain linked to an active defer_topic preference
after all updates, including needs you did not update. Do not mark a need addressed,
reopen it, drop its link, or reactivate a released preference just to pass a check.
When a boundary is genuinely withdrawn, change the affected need only as supported
by the student's request and the actual support in this reply. This bookkeeping
adds no student task, forced quiz, or obligation to discuss a deferred subject.
`.trim();
export const FORMATIVE_CONVERSATION_V18R2_PROFILE_RECOMMENDATION_VERSION =
  FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION;
export const FORMATIVE_CONVERSATION_V18R2_PROFILE_SNAPSHOT_VERSION =
  FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION;
export const FormativeConversationV18R2TerminalProfileTransitionRecommendationSchema =
  FormativeConversationV18ProfileTransitionRecommendationSchema.refine(
    (value) =>
      value.recommended && value.proposed_outcome !== "continue_conversation",
    {
      path: ["proposed_outcome"],
      message: "A profile transition recommendation must be terminal."
    }
  );

export const FormativeConversationV18R2AgentInputSchema = z
  .object({
    contract_version: z.literal(
      FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION
    ),
    context_version: z.literal(FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION),
    conversation_public_id: z.string().min(1),
    assessment_public_id: z.string().min(1),
    concept_unit_public_id: z.string().min(1),
    latest_student_message: z.string().min(1).max(5_000).nullable(),
    visible_transcript: z.array(FormativeConversationTranscriptTurnSchema),
    assistance_history: AssistanceHistorySchema.optional(),
    conversation_continuity: ConversationContinuitySchema.optional(),
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
    formative_lifecycle: FormativeConversationV18R2FormativeLifecycleSchema,
    teacher_guidance: z.array(z.string().min(1).max(1_200)).max(12),
    intervention_history: z.array(
      FormativeConversationInterventionSummarySchema
    ),
    memory: FormativeConversationMemorySchema.nullable(),
    safety_boundary: FormativeConversationSafetyBoundarySchema
  })
  .strict()
  .superRefine((value, context) => {
    const transcriptStudentTurns = value.visible_transcript.filter(
      (turn) => turn.actor === "student"
    ).length;
    if (
      transcriptStudentTurns !== value.formative_lifecycle.student_turn_index
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formative_lifecycle", "student_turn_index"],
        message:
          "The formative turn index must equal persisted student messages in this conversation only."
      });
    }
    if (
      value.telemetry_summary.observable_student_turn_count !==
      transcriptStudentTurns
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["telemetry_summary", "observable_student_turn_count"],
        message:
          "Observable student turns must use the phase-local formative transcript."
      });
    }
  });

export const FormativeConversationV18R2AgentOutputSchema = z
  .object({
    contract_version: z.literal(
      FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION
    ),
    outcome: z.enum([
      "continue_conversation",
      "sound_understanding",
      "largely_improved_understanding",
      "teacher_assistance_recommended"
    ]),
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
    lifecycle_recommendation: z.enum(["continue", "pause", "complete"]),
    conversation_review: ConversationReviewSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const terminal = value.outcome !== "continue_conversation";
    const recommendation = value.profile_transition_recommendation;
    if (!terminal && recommendation !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile_transition_recommendation"],
        message:
          "continue_conversation must not contain a profile transition recommendation."
      });
    }
    if (terminal && recommendation === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile_transition_recommendation"],
        message: "A terminal outcome requires a profile transition recommendation."
      });
    }
    if (
      recommendation !== null &&
      (recommendation.proposed_outcome === "continue_conversation" ||
        recommendation.proposed_outcome !== value.outcome)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile_transition_recommendation", "proposed_outcome"],
        message: "The transition recommendation must match the terminal outcome."
      });
    }
    if (terminal && value.evidence_observations.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence_observations"],
        message:
          "A terminal profile transition requires an evidence-bearing observation."
      });
    }
    const teacherAssistance =
      value.outcome === "teacher_assistance_recommended";
    if (
      value.teacher_assistance_recommendation.recommended !== teacherAssistance
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teacher_assistance_recommendation", "recommended"],
        message:
          "Teacher assistance must mirror the authoritative terminal outcome."
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

export const FormativeConversationV18R2PersistedProfileSnapshotSchema =
  FormativeConversationV18PersistedProfileSnapshotSchema;

export {
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
  FormativeConversationV18R2FormativeLifecycleSchema,
  FormativeConversationV18EvidenceObservationSchema as FormativeConversationV18R2EvidenceObservationSchema,
  FormativeConversationV18MisconceptionClaimDispositionSchema as FormativeConversationV18R2MisconceptionClaimDispositionSchema,
  FormativeConversationV18ProfileEvidenceSchema as FormativeConversationV18R2ProfileEvidenceSchema,
  FormativeConversationV18ProfileFieldEvidenceSchema as FormativeConversationV18R2ProfileFieldEvidenceSchema
};

export type FormativeConversationV18R2AgentInput = z.infer<
  typeof FormativeConversationV18R2AgentInputSchema
>;
export type FormativeConversationV18R2AgentOutput = z.infer<
  typeof FormativeConversationV18R2AgentOutputSchema
>;
export type FormativeConversationV18R2ProfileEvidence = z.infer<
  typeof FormativeConversationV18ProfileEvidenceSchema
>;
export type FormativeConversationV18R2ProfileFieldEvidence = z.infer<
  typeof FormativeConversationV18ProfileFieldEvidenceSchema
>;
export type FormativeConversationV18R2PersistedProfileSnapshot = z.infer<
  typeof FormativeConversationV18PersistedProfileSnapshotSchema
>;
