import { z } from "zod";
import { AgentName } from "@/lib/agents/names";

export const EvalCaseSourceSchema = z.enum(["synthetic", "teacher_authored", "deidentified"]);
export const EvalRunModeSchema = z.enum(["mock", "imported_output", "live_provider"]);
export const EvalRecordStatusSchema = z.enum(["active", "archived"]);
export const EvalRunStatusSchema = z.enum(["pending", "running", "completed", "failed"]);

export type EvalCaseSource = z.infer<typeof EvalCaseSourceSchema>;
export type EvalRunMode = z.infer<typeof EvalRunModeSchema>;

export const EvaluationCriticalFailureFlag = z.enum([
  "schema_invalid",
  "wrong_agent_name",
  "unknown_enum_label",
  "hidden_prompt_disclosure",
  "secret_disclosure",
  "answer_leak_in_initial_administration",
  "hint_or_explanation_in_initial_administration",
  "student_misconduct_accusation",
  "genai_use_accusation",
  "profile_label_exposed_to_student",
  "formative_value_exposed_to_student",
  "incorrect_top_level_formative_value",
  "item_generation_or_rewrite",
  "teacher_content_override",
  "unsafe_internal_metadata_exposure",
  "unsupported_claim_of_certainty"
]);

export type EvaluationCriticalFailureFlag = z.infer<typeof EvaluationCriticalFailureFlag>;

export const EvaluationRubricCriterion = z.enum([
  "schema_adherence",
  "task_relevance",
  "policy_compliance",
  "safety",
  "evidence_use",
  "calibration_or_uncertainty",
  "student_facing_appropriateness",
  "teacher_review_appropriateness"
]);

export const rubricScoreSchema = z.coerce.number().int().min(0).max(3);

export const evalCaseFixtureSchema = z.object({
  case_id: z.string().min(1),
  agent_name: AgentName,
  title: z.string().min(1),
  description: z.string().min(1),
  input_payload: z.record(z.unknown()),
  expected_output_shape: z.record(z.unknown()).optional(),
  gold_labels: z.record(z.unknown()).optional(),
  rubric_expectations: z.record(z.unknown()).optional(),
  safety_expectations: z.record(z.unknown()).optional(),
  notes: z.string().optional()
}).strict();

export type EvalCaseFixture = z.infer<typeof evalCaseFixtureSchema>;

export const createEvalSuiteSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  agent_name: AgentName
}).strict();

export const createMockEvalRunSchema = z.object({
  suite_public_id: z.string().min(1).optional(),
  agent_name: AgentName.optional(),
  repetition_count: z.coerce.number().int().positive().max(10).optional()
}).strict();

export const listEvalRunsQuerySchema = z.object({
  agent_name: AgentName.optional(),
  run_mode: EvalRunModeSchema.optional(),
  status: EvalRunStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25)
}).strict();

export const listEvalRunItemsQuerySchema = z.object({
  agent_name: AgentName.optional(),
  execution_status: z.string().optional(),
  failures_only: z.coerce.boolean().optional(),
  critical_failure: EvaluationCriticalFailureFlag.optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25)
}).strict();

export const upsertEvalAnnotationSchema = z.object({
  blind_review: z.boolean().default(true),
  overall_rating: rubricScoreSchema.nullable().optional(),
  pass_fail: z.enum(["pass", "fail", "needs_review"]).nullable().optional(),
  rubric_scores: z.object({
    schema_adherence: rubricScoreSchema.optional(),
    task_relevance: rubricScoreSchema.optional(),
    policy_compliance: rubricScoreSchema.optional(),
    safety: rubricScoreSchema.optional(),
    evidence_use: rubricScoreSchema.optional(),
    calibration_or_uncertainty: rubricScoreSchema.optional(),
    student_facing_appropriateness: rubricScoreSchema.optional(),
    teacher_review_appropriateness: rubricScoreSchema.optional()
  }).strict().optional(),
  safety_flags: z.array(EvaluationCriticalFailureFlag).default([]),
  notes: z.string().max(5000).nullable().optional()
}).strict();

export type UpsertEvalAnnotationInput = z.infer<typeof upsertEvalAnnotationSchema>;

export const evaluationCriticalFailureFlags = EvaluationCriticalFailureFlag.options;

export const rubricCriteria = EvaluationRubricCriterion.options;
