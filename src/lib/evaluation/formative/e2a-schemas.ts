import { z } from "zod";
import { StudentIntentSchema } from "./schemas";

export const E2A_ARTIFACT_SCHEMA_VERSION = "formative-evaluation-e2a-v1" as const;
export const E2A_SIMULATOR_PROMPT_VERSION = "llm-student-surface-realization-v1" as const;
export const E2A_SIMULATOR_SCHEMA_VERSION = "llm-student-simulator-output-v1" as const;

export const LlmStudentRenderedIntentSchema = z.enum([
  "task_confusion",
  "conceptual_confusion",
  "request_example",
  "misconception_persistence",
  "partial_explanation",
  "substantive_explanation",
  "unsupported_understanding_claim",
  "off_topic_response",
  "reengagement",
  "revision_evidence",
  "transfer_response",
  "direct_answer_request",
  "prompt_injection_attempt"
]);
export type LlmStudentRenderedIntent = z.infer<typeof LlmStudentRenderedIntentSchema>;

export const SimulatorEvidenceLevelSchema = z.enum([
  "none",
  "minimal",
  "partial",
  "substantive"
]);
export type SimulatorEvidenceLevel = z.infer<typeof SimulatorEvidenceLevelSchema>;

export const LlmStudentSimulatorInputSchema = z.object({
  scenario_id: z.string().min(1),
  scenario_version: z.string().min(1),
  expression_variant: z.number().int().min(1).max(3),
  student_persona: z.object({
    conceptual_state: z.string().min(1),
    task_understanding: z.string().min(1),
    engagement: z.string().min(1),
    confidence: z.string().min(1),
    communication_style: z.string().min(1)
  }).strict(),
  misconception_context: z.object({
    misconception_id: z.string().min(1),
    student_belief_description: z.string().min(1),
    focus_item_reference: z.string().min(1),
    focus_option_reference: z.string().min(1)
  }).strict(),
  permitted_response: z.object({
    intent: StudentIntentSchema,
    substantive_evidence_level: SimulatorEvidenceLevelSchema,
    may_show_task_improvement: z.boolean(),
    may_show_conceptual_improvement: z.boolean(),
    must_preserve_misconception: z.boolean(),
    must_remain_off_topic: z.boolean(),
    must_request_clarification: z.boolean(),
    must_avoid_claiming_resolution: z.boolean()
  }).strict(),
  visible_conversation: z.array(z.object({
    role: z.enum(["assistant", "student"]),
    content: z.string().min(1).max(5000),
    sequence_index: z.number().int().nonnegative()
  }).strict()).max(12),
  latest_assistant_message: z.string().min(1).max(5000),
  style_constraints: z.object({
    maximum_sentences: z.number().int().min(1).max(5),
    preferred_length: z.enum(["very_short", "short", "medium"]),
    avoid_expert_language: z.boolean(),
    allow_grammar_imperfection: z.boolean(),
    avoid_excessive_cooperation: z.boolean()
  }).strict()
}).strict();
export type LlmStudentSimulatorInput = z.infer<typeof LlmStudentSimulatorInputSchema>;

export const LlmStudentSimulatorOutputSchema = z.object({
  student_message: z.string().min(1).max(5000),
  rendered_intent: LlmStudentRenderedIntentSchema,
  expressed_evidence_level: SimulatorEvidenceLevelSchema,
  mentions_focus_option: z.boolean(),
  asks_for_clarification: z.boolean(),
  claims_understanding: z.boolean(),
  off_topic: z.boolean(),
  simulator_warnings: z.array(z.string().min(1).max(120)).max(10)
}).strict();
export type LlmStudentSimulatorOutput = z.infer<typeof LlmStudentSimulatorOutputSchema>;

export const E2ASimulatorValidationIssueSchema = z.object({
  rule_code: z.enum([
    "rendered_intent_mismatch",
    "provider_failure",
    "hidden_state_contradiction",
    "wrong_misconception",
    "evidence_level_exceeded",
    "required_clarification_missing",
    "prohibited_mastery_claim",
    "misconception_not_preserved",
    "off_topic_mismatch",
    "focus_option_mismatch",
    "unrelated_topic",
    "simulator_self_disclosure",
    "internal_system_terminology",
    "answer_key_leakage",
    "empty_message",
    "message_too_long",
    "sentence_limit_exceeded",
    "near_duplicate_expression"
  ]),
  field_path: z.string().min(1),
  safe_detail: z.string().min(1)
}).strict();
export type E2ASimulatorValidationIssue = z.infer<typeof E2ASimulatorValidationIssueSchema>;

export const E2ABudgetLimitsSchema = z.object({
  maximum_sessions: z.number().int().positive(),
  maximum_simulator_calls: z.number().int().positive(),
  maximum_total_provider_calls: z.number().int().positive(),
  maximum_total_input_tokens: z.number().int().positive(),
  maximum_total_output_tokens: z.number().int().positive(),
  maximum_cost_usd: z.number().positive()
}).strict();
export type E2ABudgetLimits = z.infer<typeof E2ABudgetLimitsSchema>;

export const E2ABudgetUsageSchema = z.object({
  sessions_attempted: z.number().int().nonnegative(),
  sessions_completed: z.number().int().nonnegative(),
  simulator_provider_calls: z.number().int().nonnegative(),
  operational_provider_calls: z.number().int().nonnegative(),
  total_provider_calls: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative().nullable(),
  estimated_cost_status: z.enum(["available", "unavailable"])
}).strict();
export type E2ABudgetUsage = z.infer<typeof E2ABudgetUsageSchema>;

export const E2ASimulatorConfigurationSchema = z.object({
  simulator_enabled: z.boolean(),
  model_name: z.string().min(1),
  max_output_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  max_regeneration_attempts: z.number().int().min(0).max(2),
  timeout_ms: z.number().int().min(1000),
  configuration_hash: z.string().length(64),
  prompt_version: z.literal(E2A_SIMULATOR_PROMPT_VERSION),
  schema_version: z.literal(E2A_SIMULATOR_SCHEMA_VERSION)
}).strict();
export type E2ASimulatorConfiguration = z.infer<typeof E2ASimulatorConfigurationSchema>;

export const E2ASimulatorTurnRecordSchema = z.object({
  turn_id: z.string().min(1),
  scenario_id: z.string().min(1),
  expression_variant: z.number().int().min(1).max(3),
  deterministic_intent: z.string().min(1),
  rendered_message: z.string().min(1),
  rendered_intent: LlmStudentRenderedIntentSchema,
  expressed_evidence_level: SimulatorEvidenceLevelSchema,
  provider: z.enum(["openai", "injected_no_live_test"]),
  simulator_call_ids: z.array(z.string().min(1)),
  input_token_count: z.number().int().nonnegative(),
  output_token_count: z.number().int().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  retry_count: z.number().int().nonnegative(),
  validation_failures: z.array(E2ASimulatorValidationIssueSchema),
  configuration_hash: z.string().length(64)
}).strict();
export type E2ASimulatorTurnRecord = z.infer<typeof E2ASimulatorTurnRecordSchema>;

export const HiddenTruthCompatibilitySchema = z.enum([
  "compatible",
  "partially_compatible",
  "incompatible",
  "insufficient_evidence"
]);
export type HiddenTruthCompatibility = z.infer<typeof HiddenTruthCompatibilitySchema>;
