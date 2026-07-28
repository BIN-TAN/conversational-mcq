import { z } from "zod";

export const FORMATIVE_CONVERSATION_AGENT_NAME = "formative_conversation_agent";
export const FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION =
  "formative-conversation-agent-contract-v1";
export const FORMATIVE_CONVERSATION_CONTEXT_VERSION =
  "formative-conversation-context-v1";
export const FORMATIVE_CONVERSATION_MEMORY_VERSION =
  "formative-conversation-memory-v1";
export const FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION =
  "formative-conversation-safety-boundary-v1";

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
    evidence_limitations: z.array(z.string().min(1)).max(20)
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
    profile_transition_recommendation: z
      .object({
        recommended: z.boolean(),
        proposed_outcome: z.enum([
          "sound_understanding",
          "largely_improved_understanding",
          "teacher_assistance_recommended",
          "continue_conversation"
        ]),
        rationale: z.string().min(1).max(2_000),
        source_turn_sequence_indexes: z.array(z.number().int().positive()).max(40)
      })
      .strict()
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
  .strict();

export type FormativeConversationAgentInput = z.infer<
  typeof FormativeConversationAgentInputSchema
>;
export type FormativeConversationAgentOutput = z.infer<
  typeof FormativeConversationAgentOutputSchema
>;
export type FormativeConversationProfileEvidence = z.infer<
  typeof FormativeConversationProfileEvidenceSchema
>;
export type FormativeConversationAdministeredItem = z.infer<
  typeof FormativeConversationAdministeredItemSchema
>;
