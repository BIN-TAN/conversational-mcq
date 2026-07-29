import { z } from "zod";

export const SYNTHETIC_STUDENT_VALIDATION_VERSION =
  "synthetic-student-research-validation-v1";

export const SyntheticStudentPersonaIdSchema = z.enum([
  "correct_shallow",
  "confident_misconception",
  "correct_low_confidence",
  "overconfident_incorrect",
  "disengaged",
  "high_performing_extension"
]);

export const SyntheticConversationIntentSchema = z.enum([
  "explanation_request",
  "clarification_request",
  "example_request",
  "direct_answer_request",
  "reflection",
  "extension_request"
]);

const SyntheticNavigationObservationSchema = z
  .object({
    event_type: z.enum([
      "page_hidden",
      "page_visible",
      "window_blur",
      "window_focus",
      "navigation_event"
    ]),
    offset_ms: z.number().int().nonnegative(),
    observed_interval_duration_ms: z.number().int().nonnegative().nullable()
  })
  .strict();

export const SyntheticAssessmentResponseBehaviorSchema = z
  .object({
    item_number: z.number().int().min(1).max(3),
    selected_option: z.enum(["A", "B", "C"]),
    prior_option_selections: z.array(z.enum(["A", "B", "C"])).max(4),
    reasoning_text: z.string().min(1).max(4_000),
    confidence_rating: z.enum(["low", "medium", "high"]),
    response_time_ms: z.number().int().positive(),
    time_to_first_action_ms: z.number().int().nonnegative(),
    reasoning_revision_count: z.number().int().nonnegative(),
    navigation_observations: z
      .array(SyntheticNavigationObservationSchema)
      .max(12)
  })
  .strict();

export const SyntheticConversationTurnBehaviorSchema = z
  .object({
    intent: SyntheticConversationIntentSchema,
    message_text: z.string().min(1).max(5_000),
    response_time_ms: z.number().int().positive(),
    typing_duration_ms: z.number().int().nonnegative(),
    edit_count: z.number().int().nonnegative(),
    backspace_count: z.number().int().nonnegative(),
    paste_event_count: z.number().int().nonnegative(),
    paste_character_count: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.paste_event_count === 0 &&
      value.paste_character_count !== 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paste_character_count"],
        message:
          "paste_character_count must be zero when no paste event was observed"
      });
    }
  });

export const SyntheticStudentPersonaSchema = z
  .object({
    validation_version: z.literal(SYNTHETIC_STUDENT_VALIDATION_VERSION),
    persona_id: SyntheticStudentPersonaIdSchema,
    display_name: z.string().min(1).max(120),
    description: z.string().min(1).max(1_000),
    assessment_response_behavior: z
      .array(SyntheticAssessmentResponseBehaviorSchema)
      .length(3),
    reasoning_style: z.string().min(1).max(1_000),
    confidence_pattern: z.string().min(1).max(1_000),
    process_behavior: z.string().min(1).max(1_000),
    conversation_behavior: z
      .array(SyntheticConversationTurnBehaviorSchema)
      .min(2)
      .max(10)
  })
  .strict()
  .superRefine((value, context) => {
    const itemNumbers = value.assessment_response_behavior.map(
      (entry) => entry.item_number
    );
    if (
      itemNumbers.length !== new Set(itemNumbers).size ||
      ![1, 2, 3].every((itemNumber) => itemNumbers.includes(itemNumber))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assessment_response_behavior"],
        message: "assessment behavior must define items 1, 2, and 3 once"
      });
    }
  });

export type SyntheticStudentPersona = z.infer<
  typeof SyntheticStudentPersonaSchema
>;
export type SyntheticStudentPersonaId = z.infer<
  typeof SyntheticStudentPersonaIdSchema
>;

export const SyntheticValidationModeSchema = z.enum([
  "plan_only",
  "contract_test",
  "live_llm"
]);
export type SyntheticValidationMode = z.infer<
  typeof SyntheticValidationModeSchema
>;

export const SyntheticResearchValidationReportSchema = z
  .object({
    report_version: z.literal(SYNTHETIC_STUDENT_VALIDATION_VERSION),
    run_public_id: z.string().min(1),
    mode: SyntheticValidationModeSchema,
    generated_at: z.string().datetime(),
    pedagogical_evaluation_valid: z.boolean(),
    provider_calls_authorized: z.boolean(),
    persona_count: z.number().int().positive(),
    estimated_logical_generation_calls: z.number().int().nonnegative(),
    students: z.array(
      z
        .object({
          persona_id: SyntheticStudentPersonaIdSchema,
          session_public_id: z.string().min(1),
          conversation_public_id: z.string().min(1),
          initial_profile: z.record(z.string(), z.unknown()).nullable(),
          conversation_length: z
            .object({
              total_turns: z.number().int().nonnegative(),
              student_turns: z.number().int().nonnegative(),
              tutor_turns: z.number().int().nonnegative()
            })
            .strict(),
          agent_calls: z
            .object({
              total: z.number().int().nonnegative(),
              succeeded: z.number().int().nonnegative(),
              failed: z.number().int().nonnegative(),
              public_ids: z.array(z.string())
            })
            .strict(),
          telemetry_summary: z
            .object({
              lifecycle_event_count: z.number().int().nonnegative(),
              turn_telemetry_count: z.number().int().nonnegative(),
              input_telemetry_count: z.number().int().nonnegative(),
              total_response_time_ms: z.number().int().nonnegative(),
              total_typing_duration_ms: z.number().int().nonnegative(),
              total_input_tokens: z.number().int().nonnegative(),
              total_output_tokens: z.number().int().nonnegative()
            })
            .strict(),
          final_profile_transition: z
            .record(z.string(), z.unknown())
            .nullable(),
          transition_evidence: z
            .object({
              supporting_turn_count: z.number().int().nonnegative(),
              evidence_reference_count: z.number().int().nonnegative(),
              source_agent_call_public_id: z.string().nullable()
            })
            .strict(),
          teacher_trajectory: z.record(z.string(), z.unknown()),
          execution_error: z.string().nullable()
        })
        .strict()
    ),
    export_validation: z
      .object({
        status: z.enum(["passed", "failed", "not_run"]),
        required_files_present: z.boolean(),
        timeline_reconstructable: z.boolean(),
        agent_call_joins_valid: z.boolean(),
        profile_provenance_valid: z.boolean(),
        reproducible: z.boolean(),
        file_row_counts: z.record(z.string(), z.number().int().nonnegative()),
        issue_codes: z.array(z.string())
      })
      .strict(),
    safeguards: z
      .object({
        expected_learning_outcomes_absent: z.literal(true),
        fixed_tutor_responses_absent: z.literal(true),
        deterministic_activity_routing_absent: z.literal(true),
        raw_provider_payloads_excluded: z.literal(true)
      })
      .strict(),
    limitations: z.array(z.string())
  })
  .strict();

export type SyntheticResearchValidationReport = z.infer<
  typeof SyntheticResearchValidationReportSchema
>;
