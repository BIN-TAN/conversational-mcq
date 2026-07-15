import { z } from "zod";
import { ChatNativeAssessmentStateSchema } from "@/lib/student-assessment/state-machine";
import { StudentActivityRuntimeProjectionSchema } from "@/lib/student-assessment/activity-runtime-projection";

export { StudentActivityRuntimeProjectionSchema };
export type { StudentActivityRuntimeProjection } from "@/lib/student-assessment/activity-runtime-projection";

export const MissingEvidenceFieldSchema = z.enum(["answer", "reasoning", "confidence"]);
export type MissingEvidenceField = z.infer<typeof MissingEvidenceFieldSchema>;

export const ConfidenceRatingSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceRating = z.infer<typeof ConfidenceRatingSchema>;

export const StudentSafeOptionSchema = z.object({
  label: z.string(),
  text: z.string()
});
export type StudentSafeOption = z.infer<typeof StudentSafeOptionSchema>;

export const StudentSafeMediaAssetSchema = z.object({
  media_public_id: z.string(),
  placement: z.enum(["item_stem", "option"]),
  option_label: z.string().nullable(),
  media_type: z.enum(["image", "video", "reference_link"]),
  url: z.string().nullable(),
  title: z.string().nullable(),
  alt_text_or_description: z.string(),
  caption: z.string().nullable(),
  transcript_or_content_summary: z.string().nullable(),
  source_attribution: z.string().nullable()
});
export type StudentSafeMediaAsset = z.infer<typeof StudentSafeMediaAssetSchema>;

export const StudentSafeItemSchema = z.object({
  item_public_id: z.string(),
  item_order: z.number(),
  initial_item_position: z.number().nullable(),
  initial_item_total: z.number().nullable(),
  item_stem: z.string(),
  options: z.array(StudentSafeOptionSchema),
  media_assets: z.array(StudentSafeMediaAssetSchema).default([]),
  item_version: z.number(),
  existing_selected_option: z.string().nullable(),
  existing_reasoning_text: z.string().nullable(),
  existing_confidence_rating: ConfidenceRatingSchema.nullable(),
  no_tempting_option: z.boolean(),
  tempting_option: z.string().nullable(),
  tempting_option_reason: z.string().nullable(),
  submission_state: z.enum(["not_started", "draft", "missing_evidence_repair", "submitted"])
});
export type StudentSafeItem = z.infer<typeof StudentSafeItemSchema>;

export const StudentAssessmentSummarySchema = z.object({
  assessment_public_id: z.string(),
  title: z.string(),
  description: z.string().nullable()
});
export type StudentAssessmentSummary = z.infer<typeof StudentAssessmentSummarySchema>;

export const AvailableAssessmentSchema = StudentAssessmentSummarySchema.extend({
  availability_status: z.string(),
  availability_state: z.string(),
  release_at_course_time: z.string().nullable(),
  close_at_course_time: z.string().nullable(),
  course_timezone: z.string(),
  student_safe_availability_message: z.string(),
  existing_session_public_id: z.string().nullable(),
  existing_session_status: z.string().nullable(),
  existing_session_lifecycle_version: z.string().nullable().optional(),
  existing_session_canonical_status: z.string().nullable().optional(),
  existing_attempt_number: z.number().nullable().optional(),
  latest_completed_session_public_id: z.string().nullable().optional(),
  latest_completed_attempt_number: z.number().nullable().optional(),
  latest_terminal_session_public_id: z.string().nullable().optional(),
  latest_terminal_attempt_number: z.number().nullable().optional(),
  attempt_policy: z
    .object({
      policy_version: z.string(),
      maximum_attempts: z.number().nullable(),
      attempts_used: z.number(),
      remaining_attempts: z.number().nullable(),
      resumable_attempt_present: z.boolean(),
      student_may_end_attempt: z.boolean(),
      student_ended_attempt_counts_toward_limit: z.boolean(),
      completed_attempts_permit_new_attempt: z.boolean(),
      start_window_state: z.string(),
      resume_window_state: z.string(),
      teacher_override_state: z.string()
    })
    .optional(),
  can_start: z.boolean(),
  can_resume: z.boolean()
});
export type AvailableAssessment = z.infer<typeof AvailableAssessmentSchema>;

export const AvailableAssessmentsResponseSchema = z.object({
  assessments: z.array(AvailableAssessmentSchema)
});
export type AvailableAssessmentsResponse = z.infer<typeof AvailableAssessmentsResponseSchema>;

export const StudentConceptUnitSchema = z.object({
  concept_unit_public_id: z.string(),
  title: z.string(),
  learning_objective: z.string()
});
export type StudentConceptUnit = z.infer<typeof StudentConceptUnitSchema>;

export const StudentProgressionSchema = z.object({
  available: z.boolean(),
  status: z.string().nullable(),
  progression_public_id: z.string().nullable(),
  is_final_concept: z.boolean(),
  allowed_choices: z.array(z.string()),
  neutral_message: z.string().nullable(),
  processing: z.boolean()
});
export type StudentProgression = z.infer<typeof StudentProgressionSchema>;

export const StudentLearningProfileSchema = z.object({
  status: z.enum(["Mostly understood", "Still developing", "Needs more work"]),
  explanation: z.string(),
  next_focus: z.string(),
  updated_at: z.string(),
  initial_results: z.string().optional(),
  current_understanding: z
    .object({
      label: z.string(),
      value: z.string()
    })
    .optional(),
  reasoning: z
    .object({
      label: z.string(),
      value: z.string()
    })
    .optional(),
  confidence: z
    .object({
      label: z.string(),
      value: z.string()
    })
    .optional(),
  evidence_limitation: z.string().nullable().optional(),
  profile_schema_version: z.string().optional()
});
export type StudentLearningProfile = z.infer<typeof StudentLearningProfileSchema>;

export const PackageResultsSchema = z.object({
  result_summary: z.string(),
  answer_reveal_policy: z.string(),
  result_status_reveal_policy: z.string(),
  full_answer_revealed: z.boolean(),
  items: z.array(z.object({
    item_public_id: z.string(),
    item_position: z.number().nullable(),
    selected_option: z.string().nullable(),
    status_label: z.string(),
    answer_revealed: z.boolean(),
    revealed_answer: z.string().nullable(),
    student_answer: z.string().nullable(),
    answer_explanation_revealed: z.boolean(),
    answer_explanation: z.string().nullable(),
    distractor_boundary: z.string().nullable()
  }))
});
export type PackageResults = z.infer<typeof PackageResultsSchema>;

export const StudentSessionStateSchema = z.object({
  session_public_id: z.string(),
  session_status: z.string(),
  current_phase: z.string(),
  effective_phase: z.string(),
  assessment_state: ChatNativeAssessmentStateSchema,
  canonical_runtime_state: z.string().optional(),
  attempt_lifecycle: z
    .object({
      canonical_status: z.string(),
      canonical_runtime_state: z.string(),
      lifecycle_version: z.string(),
      terminal: z.boolean(),
      resumable: z.boolean(),
      can_resume: z.boolean(),
      can_pause: z.boolean(),
      can_end: z.boolean(),
      can_start_another: z.boolean(),
      blocking_reason: z.string().nullable(),
      consistency_issues: z.array(z.string())
    })
    .optional(),
  assessment: StudentAssessmentSummarySchema,
  progress: z.object({
    concept_unit_index: z.number(),
    concept_unit_count: z.number(),
    completed_item_count: z.number(),
    total_item_count: z.number(),
    completed_initial_item_count: z.number(),
    initial_item_count: z.number()
  }),
  current_concept_unit: StudentConceptUnitSchema.nullable(),
  next_step: z.enum([
    "concept_unit_intro",
    "present_item",
    "request_reasoning",
    "request_confidence",
    "request_tempting_option",
    "request_tempting_reason",
    "missing_evidence_repair",
    "item_complete",
    "package_review",
    "package_analysis",
    "initial_concept_unit_complete",
    "awaiting_profiling",
    "formative_activity",
    "formative_response_saved",
    "revision_requested",
    "transfer_item",
    "automatic_profiling_pending",
    "automatic_planning_pending",
    "automatic_followup_opening_pending",
    "automatic_workflow_failed",
    "followup_active",
    "followup_updating",
    "followup_stopped",
    "session_completed"
  ]),
  current_item: StudentSafeItemSchema.nullable(),
  missing_evidence: z.array(MissingEvidenceFieldSchema),
  can_exit: z.boolean(),
  can_resume: z.boolean(),
  can_end_attempt: z.boolean(),
  initial_chat: z.object({
    message_max_chars: z.number()
  }),
  followup: z
    .object({
      round_index: z.number(),
      status: z.string(),
      started_at: z.string().nullable(),
      completed_at: z.string().nullable(),
      can_send: z.boolean(),
      can_stop: z.boolean(),
      can_save_exit: z.boolean(),
      message_max_chars: z.number()
    })
    .nullable()
    .optional(),
  formative_activity: z
    .object({
      round_index: z.number(),
      status: z.string(),
      started_at: z.string().nullable(),
      completed_at: z.string().nullable(),
      can_send: z.boolean(),
      message_max_chars: z.number()
    })
    .nullable()
    .optional(),
  activity_runtime: StudentActivityRuntimeProjectionSchema.nullable().optional(),
  package_results: PackageResultsSchema.nullable().optional(),
  progression: StudentProgressionSchema.nullable().optional(),
  learning_profile: StudentLearningProfileSchema.nullable().optional(),
  session: z
    .object({
      session_public_id: z.string(),
      session_status: z.string(),
      current_phase: z.string(),
      attempt_number: z.number()
    })
    .optional()
});
export type StudentSessionState = z.infer<typeof StudentSessionStateSchema>;

export const LifecycleCommandResultSchema = z.object({
  result_version: z.literal("assessment-lifecycle-operation-result-v1"),
  operation_public_id: z.string(),
  command_type: z.enum([
    "start_attempt",
    "resume_attempt",
    "pause_attempt",
    "end_attempt",
    "teacher_end_attempt"
  ]),
  command_succeeded: z.boolean(),
  mutation_committed: z.boolean(),
  already_satisfied: z.boolean(),
  recovered: z.boolean(),
  session_public_id: z.string().nullable(),
  attempt_number: z.number().nullable(),
  canonical_status: z.string().nullable(),
  canonical_destination: z.enum(["session", "assessment_list", "none"]),
  presenter_ready: z.boolean(),
  recovery_required: z.boolean(),
  safe_warning: z.string().nullable(),
  safe_response_code: z.string()
});
export type LifecycleCommandResult = z.infer<typeof LifecycleCommandResultSchema>;

const StartSessionBaseResponseSchema = z.object({
  session: z.object({
    session_public_id: z.string(),
    session_status: z.string(),
    current_phase: z.string(),
    attempt_number: z.number()
  }),
  command_result: LifecycleCommandResultSchema.optional()
});

export const StartSessionCommandResponseSchema = StartSessionBaseResponseSchema.extend({
  state: StudentSessionStateSchema.nullable()
});
export type StartSessionCommandResponse = z.infer<typeof StartSessionCommandResponseSchema>;

export const StartSessionResponseSchema = StartSessionBaseResponseSchema.extend({
  state: StudentSessionStateSchema
});
export type StartSessionResponse = z.infer<typeof StartSessionResponseSchema>;

export const StudentConversationFrameSchema = z.object({
  assistant_message: z.string(),
  interaction_type: z.enum([
    "assessment_intro",
    "concept_unit_intro",
    "present_item",
    "request_reasoning",
    "request_confidence",
    "request_tempting_option",
    "request_tempting_reason",
    "missing_evidence_repair",
    "confirm_skip",
    "item_completed",
    "package_review",
    "package_analysis",
    "concept_unit_completed",
    "awaiting_profiling",
    "formative_activity",
    "formative_response_saved",
    "revision_requested",
    "transfer_item",
    "automatic_processing",
    "automatic_failed",
    "followup_active",
    "followup_updating",
    "followup_stopped",
    "progression_decision",
    "progression_processing",
    "session_completed",
    "session_paused",
    "error"
  ]),
  allowed_actions: z.array(z.string()),
  current_item: StudentSafeItemSchema.nullable(),
  missing_fields: z.array(MissingEvidenceFieldSchema),
  can_review_responses: z.boolean(),
  can_exit: z.boolean(),
  can_continue: z.boolean()
});
export type StudentConversationFrame = z.infer<typeof StudentConversationFrameSchema>;

export const StudentReviewItemSchema = StudentSafeItemSchema.extend({
  missing_fields: z.array(MissingEvidenceFieldSchema),
  can_edit: z.boolean(),
  is_current: z.boolean()
});
export type StudentReviewItem = z.infer<typeof StudentReviewItemSchema>;

export const StudentReviewResponseSchema = z.object({
  session_public_id: z.string(),
  locked: z.boolean(),
  current_concept_unit: StudentConceptUnitSchema,
  items: z.array(StudentReviewItemSchema)
});
export type StudentReviewResponse = z.infer<typeof StudentReviewResponseSchema>;

export const StudentTranscriptEntrySchema = z.object({
  actor: z.enum(["student", "assistant"]),
  message_text: z.string(),
  created_at: z.string(),
  interaction_type: z.string(),
  phase: z.string().optional(),
  followup_round_index: z.number().nullable().optional(),
  item_public_id: z.string().nullable()
});
export type StudentTranscriptEntry = z.infer<typeof StudentTranscriptEntrySchema>;

export const StudentTranscriptResponseSchema = z.object({
  session_public_id: z.string(),
  transcript: z.array(StudentTranscriptEntrySchema)
});
export type StudentTranscriptResponse = z.infer<typeof StudentTranscriptResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional()
    })
  ])
});
export type StructuredStudentApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  status: number;
};
