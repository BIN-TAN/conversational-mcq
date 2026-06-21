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

const JsonRecord = z.record(z.unknown());
const JsonArray = z.array(z.unknown());
const SafeProcessEvent = z.object({
  event_type: ProcessEventTypeSchema,
  event_category: z.string(),
  event_source: EventSourceSchema,
  payload: JsonRecord.optional()
}).strict();

export const ItemPreparationInput = z.object({
  teacher_draft: JsonRecord,
  learning_objective: z.string(),
  related_concept_description: z.string(),
  items: z.array(JsonRecord),
  teacher_constraints: JsonRecord.optional(),
  administration_rules: JsonRecord.optional()
}).strict();

export const ItemPreparationOutput = AgentOutputBase.extend({
  agent_name: z.literal("item_preparation_agent"),
  normalized_concept_unit: JsonRecord,
  normalized_items: z.array(JsonRecord),
  item_quality_flags: z.array(z.string()),
  ambiguity_warnings: z.array(z.string()),
  missing_required_fields: z.array(z.string()),
  teacher_review_required: z.boolean()
}).strict();

export const ResponseCollectionInput = z.object({
  current_phase: AssessmentPhaseSchema,
  allowed_interaction_type: z.enum([
    "mcq_option",
    "reasoning_text",
    "confidence_rating",
    "procedural_message",
    "skip_confirmation"
  ]),
  current_item_student_safe: JsonRecord,
  student_message_or_action: JsonRecord,
  collected_response_state: JsonRecord,
  missing_evidence_state: JsonRecord,
  recent_student_safe_transcript: z.array(JsonRecord),
  orchestration_constraints: JsonRecord
}).strict();

export const ResponseCollectionOutput = AgentOutputBase.extend({
  agent_name: z.literal("response_collection_agent"),
  assistant_message: z.string(),
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
  events_to_log: z.array(SafeProcessEvent)
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
  should_offer_move_on: z.boolean(),
  off_topic_detected: z.boolean(),
  events_to_log: z.array(SafeProcessEvent)
}).strict();

export const agentInputSchemas = {
  item_preparation_agent: ItemPreparationInput,
  response_collection_agent: ResponseCollectionInput,
  student_profiling_agent: StudentProfilingInput,
  formative_value_and_planning_agent: FormativePlanningInput,
  followup_agent: FollowupInput
} as const;

export const agentOutputSchemas = {
  item_preparation_agent: ItemPreparationOutput,
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
