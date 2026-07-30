import { z } from "zod";

export const SYNTHETIC_STUDENT_VALIDATION_VERSION =
  "synthetic-student-research-validation-v2";

export const SyntheticStudentPersonaIdSchema = z.enum([
  "correct_shallow",
  "confident_misconception",
  "correct_low_confidence",
  "overconfident_incorrect",
  "disengaged",
  "high_performing_extension",
  "fragmented_inconsistent",
  "strategic_answerer",
  "help_seeking_confused",
  "resistant_challenging",
  "sudden_improvement",
  "persistent_non_improvement"
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
    tempting_option: z.enum(["A", "B", "C"]).nullable().optional(),
    tempting_option_reason: z.string().min(1).max(2_000).nullable().optional(),
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
    initial_knowledge_state: z.string().min(1).max(1_000),
    response_behavior: z.string().min(1).max(1_000),
    assessment_response_behavior: z
      .array(SyntheticAssessmentResponseBehaviorSchema)
      .length(3),
    reasoning_style: z.string().min(1).max(1_000),
    confidence_pattern: z.string().min(1).max(1_000),
    interaction_behavior: z.string().min(1).max(1_000),
    process_behavior: z.string().min(1).max(1_000),
    validation_purpose: z.string().min(1).max(1_000),
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

const InitialEvidenceSummarySchema = z
  .object({
    selected_options: z.array(z.string()),
    correct_response_count: z.number().int().nonnegative(),
    confidence_counts: z
      .object({
        low: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        high: z.number().int().nonnegative()
      })
      .strict(),
    total_response_time_ms: z.number().int().nonnegative(),
    total_time_to_first_action_ms: z.number().int().nonnegative(),
    total_reasoning_character_count: z.number().int().nonnegative(),
    total_reasoning_revision_count: z.number().int().nonnegative(),
    navigation_event_count: z.number().int().nonnegative()
  })
  .strict();

const ConversationLengthSchema = z
  .object({
    total_turns: z.number().int().nonnegative(),
    student_turns: z.number().int().nonnegative(),
    tutor_turns: z.number().int().nonnegative()
  })
  .strict();

const MessageExecutionSummarySchema = z
  .object({
    planned_student_messages: z.number().int().nonnegative(),
    submission_attempts: z.number().int().nonnegative(),
    persisted_student_messages: z.number().int().nonnegative(),
    completed_student_exchanges: z.number().int().nonnegative()
  })
  .strict();

const AgentCallSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    retry_count: z.number().int().nonnegative(),
    public_ids: z.array(z.string())
  })
  .strict();

const TutorResponseBehaviorSchema = z
  .object({
    visible_tutor_turn_count: z.number().int().nonnegative(),
    average_message_length_chars: z.number().nonnegative(),
    minimum_message_length_chars: z.number().int().nonnegative(),
    maximum_message_length_chars: z.number().int().nonnegative(),
    generation_sources: z.array(z.string()),
    fallback_count: z.number().int().nonnegative(),
    sample_student_messages: z.array(z.string()),
    sample_tutor_messages: z.array(z.string())
  })
  .strict();

const TransitionEvidenceSummarySchema = z
  .object({
    supporting_turn_count: z.number().int().nonnegative(),
    evidence_reference_count: z.number().int().nonnegative(),
    source_agent_call_public_id: z.string().nullable()
  })
  .strict();

const SyntheticQualitativeExampleSchema = z
  .object({
    persona_id: SyntheticStudentPersonaIdSchema,
    session_public_id: z.string().min(1),
    selection_basis: z.string().min(1),
    student_message_excerpt: z.string().nullable(),
    tutor_message_excerpt: z.string().nullable(),
    observation: z.string().min(1)
  })
  .strict();

export const SyntheticResearchValidationReportSchema = z
  .object({
    report_version: z.literal(SYNTHETIC_STUDENT_VALIDATION_VERSION),
    run_public_id: z.string().min(1),
    mode: SyntheticValidationModeSchema,
    generated_at: z.string().datetime(),
    validation_scope: z.literal(
      "system_validation_not_learning_effectiveness"
    ),
    live_execution_evidence_valid: z.boolean(),
    provider_calls_authorized: z.boolean(),
    persona_count: z.number().int().positive(),
    estimated_logical_generation_calls: z.number().int().nonnegative(),
    students: z.array(
      z
        .object({
          persona_id: SyntheticStudentPersonaIdSchema,
          session_public_id: z.string().min(1),
          conversation_public_id: z.string().min(1).nullable(),
          initial_evidence_summary: InitialEvidenceSummarySchema,
          initial_profile: z.record(z.string(), z.unknown()).nullable(),
          conversation_length: ConversationLengthSchema,
          message_execution: MessageExecutionSummarySchema,
          agent_calls: AgentCallSummarySchema,
          tutor_response_behavior: TutorResponseBehaviorSchema,
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
          profile_transition_occurred: z.boolean(),
          transition_evidence: TransitionEvidenceSummarySchema,
          teacher_trajectory: z.record(z.string(), z.unknown()),
          unresolved_issue_codes: z.array(z.string()),
          execution_error: z.string().nullable()
        })
        .strict()
    ),
    technical_reliability_report: z
      .object({
        total_sessions: z.number().int().nonnegative(),
        successful_sessions: z.number().int().nonnegative(),
        failed_sessions: z.number().int().nonnegative(),
        successful_session_public_ids: z.array(z.string()),
        failed_session_public_ids: z.array(z.string()),
        total_agent_calls: z.number().int().nonnegative(),
        agent_failure_count: z.number().int().nonnegative(),
        retry_event_count: z.number().int().nonnegative(),
        missing_telemetry_count: z.number().int().nonnegative(),
        missing_telemetry_issue_codes: z.array(z.string()),
        export_issue_count: z.number().int().nonnegative(),
        export_issue_codes: z.array(z.string()),
        join_failure_count: z.number().int().nonnegative()
      })
      .strict(),
    behavioral_coverage_report: z.array(
      z
        .object({
          persona_id: SyntheticStudentPersonaIdSchema,
          initial_evidence_summary: InitialEvidenceSummarySchema,
          conversation_length: ConversationLengthSchema,
          tutor_response_behavior: TutorResponseBehaviorSchema,
          profile_transition_occurred: z.boolean(),
          transition_evidence: TransitionEvidenceSummarySchema,
          unresolved_issue_codes: z.array(z.string())
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
        agent_call_join_failure_count: z.number().int().nonnegative(),
        profile_provenance_failure_count: z.number().int().nonnegative(),
        file_row_counts: z.record(z.string(), z.number().int().nonnegative()),
        issue_codes: z.array(z.string())
      })
      .strict(),
    architecture_review: z
      .object({
        deterministic_pedagogy_leakage_detected: z.boolean(),
        activity_runtime_contamination_count: z.number().int().nonnegative(),
        topic_dialogue_contamination_count: z.number().int().nonnegative(),
        profile_heuristic_behavior_detected: z.boolean(),
        research_data_loss_detected: z.boolean(),
        issue_codes: z.array(z.string())
      })
      .strict(),
    qualitative_examples: z
      .object({
        strongest_successful_interaction:
          SyntheticQualitativeExampleSchema.nullable(),
        most_challenging_interaction:
          SyntheticQualitativeExampleSchema.nullable(),
        unexpected_behavior: SyntheticQualitativeExampleSchema.nullable(),
        selection_note: z.string().min(1)
      })
      .strict(),
    safeguards: z
      .object({
        expected_learning_outcomes_absent: z.literal(true),
        fixed_tutor_responses_absent: z.literal(true),
        deterministic_activity_routing_absent: z.literal(true),
        raw_provider_payloads_excluded: z.literal(true),
        profile_outcomes_not_forced: z.literal(true)
      })
      .strict(),
    limitations: z.array(z.string())
  })
  .strict();

export type SyntheticResearchValidationReport = z.infer<
  typeof SyntheticResearchValidationReportSchema
>;
