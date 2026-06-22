import { z } from "zod";
import {
  AbilityPatternFlagSchema,
  AbilityProfileSchema,
  AssessmentPhaseSchema,
  ConfidenceAlignmentSchema,
  ConfidenceLevelSchema,
  EngagementPatternFlagSchema,
  EngagementProfileSchema,
  EvidenceSufficiencySchema,
  EventSourceSchema,
  FormativeValueSchema,
  IndependenceInterpretabilitySchema,
  IntegratedDiagnosticProfileSchema,
  ProcessEventTypeSchema,
  ProfileTypeSchema
} from "@/lib/domain/enums";
import { AgentName } from "./names";

export const AgentOutputBase = z.object({
  agent_name: AgentName,
  agent_version: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  output_status: z.enum(["ok", "blocked", "needs_review"]),
  warnings: z.array(z.string())
});

export const InterventionType = z.enum([
  "none",
  "procedural_clarification",
  "missing_evidence_request",
  "boundary_redirect",
  "save_and_exit_confirmation",
  "technical_error_recovery"
]);

export const FollowupActionType = z.enum([
  "explanation",
  "hint",
  "clarification_prompt",
  "reasoning_refinement_prompt",
  "misconception_correction",
  "transfer_task",
  "confidence_calibration_prompt",
  "independent_verification_prompt",
  "off_topic_redirect",
  "move_on_offer"
]);

export type InterventionType = z.infer<typeof InterventionType>;
export type FollowupActionType = z.infer<typeof FollowupActionType>;

export const ResponseCollectionIntent = z.enum([
  "reasoning_submission",
  "reasoning_revision",
  "procedural_clarification",
  "content_clarification_request",
  "hint_request",
  "correctness_request",
  "explanation_request",
  "invalid_help_request",
  "frustration_or_uncertainty",
  "skip_request",
  "save_exit_request",
  "prompt_injection_attempt",
  "off_topic",
  "unclear"
]);
export type ResponseCollectionIntent = z.infer<typeof ResponseCollectionIntent>;

export const ResponseCollectionReasoningCaptureStatus = z.enum([
  "none",
  "new_reasoning",
  "reasoning_revision"
]);
export type ResponseCollectionReasoningCaptureStatus = z.infer<
  typeof ResponseCollectionReasoningCaptureStatus
>;

export const ResponseCollectionRequestedControlAction = z.enum([
  "none",
  "skip_reasoning",
  "skip_confidence",
  "skip_item",
  "save_and_exit"
]);
export type ResponseCollectionRequestedControlAction = z.infer<
  typeof ResponseCollectionRequestedControlAction
>;

export const ResponseCollectionRecommendedInteractionOutcome = z.enum([
  "stay_current_step",
  "advance_if_backend_allows",
  "offer_skip",
  "offer_save_and_exit"
]);
export type ResponseCollectionRecommendedInteractionOutcome = z.infer<
  typeof ResponseCollectionRecommendedInteractionOutcome
>;

export const FollowupEvidenceTriggerReason = z.enum([
  "substantive_explanation",
  "reasoning_revision",
  "task_completion",
  "transfer_application",
  "understanding_claim",
  "move_on_request",
  "other_relevant_evidence"
]);

export type FollowupEvidenceTriggerReason = z.infer<typeof FollowupEvidenceTriggerReason>;

export const ItemVerificationIssueCode = z.enum([
  "possible_concept_misalignment",
  "possible_learning_objective_misalignment",
  "possible_ambiguity",
  "possible_multiple_correct_answers",
  "possible_answer_key_inconsistency",
  "weak_or_implausible_distractor",
  "overlapping_or_indistinguishable_options",
  "possible_answer_cue",
  "substantially_duplicate_item",
  "insufficient_information_to_verify"
]);
export type ItemVerificationIssueCode = z.infer<typeof ItemVerificationIssueCode>;

export const ItemVerificationFindingLocation = z.enum([
  "concept_unit",
  "item_stem",
  "correct_option",
  "option",
  "distractor_rationale",
  "item_set"
]);
export type ItemVerificationFindingLocation = z.infer<typeof ItemVerificationFindingLocation>;

export const ItemVerificationFinding = z.object({
  issue_code: ItemVerificationIssueCode,
  item_public_id: z.string().optional(),
  location: ItemVerificationFindingLocation,
  option_label: z.string().optional(),
  brief_explanation: z.string().min(1).max(600)
}).strict();
export type ItemVerificationFinding = z.infer<typeof ItemVerificationFinding>;

const JsonRecord = z.record(z.unknown());
const JsonArray = z.array(z.unknown());
const SafeProcessEvent = z.object({
  event_type: ProcessEventTypeSchema,
  event_category: z.string(),
  event_source: EventSourceSchema,
  payload: JsonRecord.optional()
}).strict();
const SafeResponseCollectionEvent = SafeProcessEvent.extend({
  event_type: z.enum([
    "invalid_help_request",
    "prompt_injection_attempt",
    "procedural_clarification_request",
    "emotional_or_frustration_response",
    "response_collection_agent_invoked",
    "response_collection_agent_succeeded",
    "response_collection_agent_failed",
    "response_collection_fallback_used",
    "response_collection_reasoning_extracted",
    "response_collection_reasoning_extraction_failed",
    "schema_validation_succeeded",
    "schema_validation_failed"
  ])
}).strict();

export const ItemVerificationInput = z.object({
  concept_unit: z.object({
    concept_unit_public_id: z.string(),
    title: z.string(),
    learning_objective: z.string(),
    related_concept_description: z.string(),
    version: z.number().int().nonnegative()
  }).strict(),
  items: z.array(z.object({
    item_public_id: z.string(),
    item_order: z.number().int(),
    item_stem: z.string(),
    options: z.array(z.object({
      label: z.string(),
      text: z.string()
    }).strict()),
    correct_option: z.string(),
    distractor_rationales: JsonRecord,
    expected_reasoning_patterns: z.array(z.string()),
    possible_misconception_indicators: z.array(z.string()),
    version: z.number().int().nonnegative()
  }).strict()),
  verification_constraints: z.object({
    advisory_only: z.literal(true),
    teacher_final_authority: z.literal(true),
    do_not_generate_or_rewrite_content: z.literal(true),
    deterministic_validation_already_passed: z.literal(true),
    no_student_data_in_input: z.literal(true)
  }).strict()
}).strict();

export const ItemVerificationOutput = AgentOutputBase.extend({
  agent_name: z.literal("item_verification_agent"),
  verification_status: z.enum([
    "verified_no_warnings",
    "verified_with_warnings",
    "unable_to_verify"
  ]),
  set_level_findings: z.array(ItemVerificationFinding),
  item_results: z.array(z.object({
    item_public_id: z.string(),
    findings: z.array(ItemVerificationFinding),
    teacher_review_required: z.boolean()
  }).strict()),
  teacher_review_required: z.boolean()
}).strict();

export const ResponseCollectionInput = z.object({
  current_phase: AssessmentPhaseSchema,
  allowed_interaction_type: z.enum([
    "reasoning_text",
    "procedural_message",
    "initial_free_text"
  ]),
  current_item_student_safe: JsonRecord,
  student_message: z.string().min(1),
  collected_response_state: JsonRecord,
  missing_evidence_state: JsonRecord,
  recent_student_safe_transcript: z.array(JsonRecord),
  orchestration_constraints: JsonRecord,
  procedural_policy: JsonRecord,
  allowed_student_controls: z.array(z.enum([
    "option_buttons",
    "confidence_controls",
    "free_text_message",
    "skip_reasoning_button",
    "skip_confidence_button",
    "skip_item_button",
    "save_exit_button",
    "submit_button"
  ]))
}).strict();

export const ResponseCollectionOutput = AgentOutputBase.extend({
  agent_name: z.literal("response_collection_agent"),
  assistant_message: z.string().min(1),
  intervention_type: InterventionType,
  should_advance: z.boolean(),
  blocked_content_help: z.boolean(),
  missing_evidence_status: z.enum([
    "not_applicable",
    "complete",
    "missing_answer",
    "missing_reasoning",
    "missing_confidence",
    "multiple_missing_fields"
  ]),
  recognized_intents: z.array(ResponseCollectionIntent),
  reasoning_capture_status: ResponseCollectionReasoningCaptureStatus,
  reasoning_evidence_segments: z.array(z.string().min(1)),
  requires_option_button: z.boolean(),
  requires_confidence_control: z.boolean(),
  requested_control_action: ResponseCollectionRequestedControlAction,
  recommended_interaction_outcome: ResponseCollectionRecommendedInteractionOutcome,
  events_to_log: z.array(SafeResponseCollectionEvent)
}).strict();

export const StudentProfilingInput = z.object({
  concept_unit_metadata: JsonRecord,
  initial_response_package: JsonRecord,
  previous_profile: JsonRecord.nullable().optional(),
  followup_evidence_package: JsonRecord.nullable().optional(),
  profile_type: ProfileTypeSchema,
  profiling_constraints: JsonRecord
}).strict();

export const StudentProfileOutput = AgentOutputBase.extend({
  agent_name: z.literal("student_profiling_agent"),
  profile_type: ProfileTypeSchema,
  ability_profile: AbilityProfileSchema,
  ability_pattern_flags: z.array(AbilityPatternFlagSchema),
  engagement_profile: EngagementProfileSchema,
  engagement_pattern_flags: z.array(EngagementPatternFlagSchema),
  integrated_diagnostic_profile: IntegratedDiagnosticProfileSchema,
  integrated_profile_confidence: ConfidenceLevelSchema,
  integrated_profile_rationale: z.string(),
  evidence_sufficiency: EvidenceSufficiencySchema,
  confidence_alignment: ConfidenceAlignmentSchema,
  independence_interpretability: IndependenceInterpretabilitySchema,
  misconception_indicators: JsonArray,
  item_level_evidence: JsonArray,
  reasoning_quality_summary: z.string(),
  engagement_summary: z.string(),
  process_interpretation_cautions: z.array(z.string()),
  profile_confidence: ConfidenceLevelSchema,
  rationale: z.string(),
  recommended_next_evidence: JsonArray
}).strict();

export const FormativePlanningInput = z.object({
  latest_student_profile: JsonRecord,
  response_package: JsonRecord,
  concept_unit_metadata: JsonRecord,
  previous_formative_decisions: z.array(JsonRecord),
  allowed_formative_values: z.array(FormativeValueSchema),
  planning_constraints: JsonRecord
}).strict();

export const FormativePlanningOutput = AgentOutputBase.extend({
  agent_name: z.literal("formative_value_and_planning_agent"),
  formative_value: FormativeValueSchema,
  formative_action_plan: z.string(),
  target_evidence: z.array(z.string()),
  success_criteria: z.array(z.string()),
  followup_prompt_constraints: z.array(z.string()),
  profile_update_triggers: z.array(z.string()),
  rationale: z.string(),
  mapping_followed: z.boolean(),
  mapping_deviation_reason: z.string().nullable()
}).strict();

export const FollowupInput = z.object({
  turn_type: z.enum(["opening", "student_reply"]),
  latest_student_profile: JsonRecord,
  latest_formative_decision: JsonRecord,
  formative_action_plan: z.string(),
  target_evidence: z.array(z.string()),
  success_criteria: z.array(z.string()),
  followup_prompt_constraints: z.array(z.string()),
  current_followup_round: JsonRecord,
  recent_followup_transcript: z.array(JsonRecord),
  student_message: z.string().nullable(),
  concept_unit_metadata: JsonRecord,
  relevant_item_evidence: JsonArray,
  process_context: JsonRecord,
  followup_constraints: JsonRecord
}).strict();

export const FollowupOutput = AgentOutputBase.extend({
  agent_name: z.literal("followup_agent"),
  assistant_message: z.string(),
  followup_action_type: FollowupActionType,
  target_formative_value: FormativeValueSchema,
  evidence_request: z.string().optional(),
  expects_student_response: z.boolean(),
  evidence_trigger_candidate: z.boolean(),
  student_turn_substantive: z.boolean(),
  evidence_trigger_reasons: z.array(FollowupEvidenceTriggerReason),
  should_offer_move_on: z.boolean(),
  off_topic_detected: z.boolean(),
  events_to_log: z.array(SafeProcessEvent)
}).strict();

export const agentInputSchemas = {
  item_verification_agent: ItemVerificationInput,
  response_collection_agent: ResponseCollectionInput,
  student_profiling_agent: StudentProfilingInput,
  formative_value_and_planning_agent: FormativePlanningInput,
  followup_agent: FollowupInput
} as const;

export const agentOutputSchemas = {
  item_verification_agent: ItemVerificationOutput,
  response_collection_agent: ResponseCollectionOutput,
  student_profiling_agent: StudentProfileOutput,
  formative_value_and_planning_agent: FormativePlanningOutput,
  followup_agent: FollowupOutput
} as const;

export type AgentInputByName = {
  [K in keyof typeof agentInputSchemas]: z.infer<(typeof agentInputSchemas)[K]>;
};

export type AgentOutputByName = {
  [K in keyof typeof agentOutputSchemas]: z.infer<(typeof agentOutputSchemas)[K]>;
};

export type AnyAgentOutput = AgentOutputByName[keyof AgentOutputByName];
