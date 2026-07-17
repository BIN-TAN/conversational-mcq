import { z } from "zod";

export const FORMATIVE_EVALUATION_ARTIFACT_SCHEMA_VERSION =
  "formative-evaluation-artifact-v1" as const;
export const APPROVED_OPERATIONAL_RUNTIME_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993" as const;

export const HardInvariantIdSchema = z.enum([
  "accepted_student_turn_has_later_visible_assistant_turn",
  "assistant_sequence_index_greater_than_student_sequence_index",
  "visible_sequence_index_strictly_increasing",
  "profile_updated_or_stale_fallback_recorded",
  "plan_updated_or_stale_fallback_recorded",
  "distractor_anchor_present",
  "no_answer_key_leak",
  "no_internal_profile_leak",
  "no_internal_plan_leak",
  "no_agent_metadata_leak",
  "no_duplicate_active_activity",
  "replacement_preserves_prior_activity",
  "refresh_projection_matches_original",
  "approved_runtime_hash_unchanged",
  "no_live_provider_call",
  "no_invalid_state_transition",
  "idempotent_duplicate_creates_no_extra_cycle",
  "recovery_turn_is_typed",
  "fallback_metadata_is_internal_only",
  "visible_turns_are_immutable"
]);
export type HardInvariantId = z.infer<typeof HardInvariantIdSchema>;

export const ALL_HARD_INVARIANT_IDS = HardInvariantIdSchema.options;

export const PedagogicalRubricDimensionSchema = z.enum([
  "direct_response_to_latest_message",
  "continuity_with_visible_history",
  "distractor_focus",
  "misconception_targeting",
  "distinguishes_task_and_concept_confusion",
  "strategy_adaptation",
  "avoids_failed_strategy_repetition",
  "explains_distractor_plausibility",
  "identifies_reasoning_failure",
  "supports_target_concept_distinction",
  "avoids_generic_tutoring",
  "avoids_answer_dumping",
  "elicits_substantive_student_evidence",
  "profile_change_supported_by_evidence",
  "plan_change_supported_by_evidence",
  "revision_readiness_supported",
  "transfer_readiness_supported",
  "avoids_premature_misconception_resolution",
  "student_facing_naturalness"
]);
export type PedagogicalRubricDimension = z.infer<
  typeof PedagogicalRubricDimensionSchema
>;

export const StrategySchema = z.enum([
  "abstract_explanation",
  "task_clarification",
  "concrete_example",
  "contrast_case",
  "worked_example",
  "narrowed_question",
  "student_explanation_request",
  "distractor_comparison",
  "counterexample",
  "revision_request",
  "transfer_task",
  "off_topic_redirect",
  "safe_recovery"
]);
export type FormativeEvaluationStrategy = z.infer<typeof StrategySchema>;

const SimulatedEvidenceChangeSchema = z.object({
  turn_index: z.number().int().nonnegative(),
  evidence_type: z.string().min(1),
  prior_value: z.string().nullable(),
  resulting_value: z.string().nullable(),
  reason: z.string().min(1)
}).strict();

export const SimulatedStudentStateSchema = z.object({
  conceptual_state: z.enum([
    "minimal_understanding",
    "fragmented_understanding",
    "partial_understanding",
    "misconception_based_understanding",
    "fragile_correct_understanding",
    "mostly_correct_understanding",
    "robust_transfer_ready_understanding"
  ]),
  misconception_status: z.enum([
    "not_present",
    "present",
    "partially_addressed",
    "apparently_resolved",
    "resolved",
    "recurred"
  ]),
  task_understanding: z.enum(["clear", "partially_clear", "confused"]),
  engagement: z.enum(["low", "variable", "adequate", "productive"]),
  confidence: z.enum(["low", "medium", "high"]),
  communication_style: z.enum([
    "brief",
    "elaborate",
    "uncertain",
    "direct",
    "off_topic_prone"
  ]),
  independence_interpretability: z.enum([
    "likely_independent",
    "uncertain",
    "insufficient_evidence"
  ]),
  evidence_history: z.array(SimulatedEvidenceChangeSchema),
  turn_index: z.number().int().nonnegative()
}).strict();
export type SimulatedStudentState = z.infer<typeof SimulatedStudentStateSchema>;

export const FIXTURE_ITEM_PUBLIC_IDS = [
  "fixture_initial_item_1",
  "fixture_initial_item_2",
  "fixture_initial_item_3",
  "fixture_transfer_item_1"
] as const;
export const FixtureItemPublicIdSchema = z.enum(FIXTURE_ITEM_PUBLIC_IDS);

const InitialItemScenarioResponseSchema = z.object({
  item_public_id: z.enum([
    "fixture_initial_item_1",
    "fixture_initial_item_2",
    "fixture_initial_item_3"
  ]),
  selected_option: z.enum(["A", "B", "C", "D"]),
  reasoning_text: z.string().min(1).max(2500),
  confidence: z.enum(["low", "medium", "high"]),
  no_tempting_option: z.boolean(),
  tempting_option: z.enum(["A", "B", "C", "D"]).nullable(),
  tempting_option_reason: z.string().min(1).max(1200).nullable()
}).strict().superRefine((value, context) => {
  if (value.no_tempting_option && (value.tempting_option || value.tempting_option_reason)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "No-tempting-option response cannot include tempting-option evidence." });
  }
  if (!value.no_tempting_option && !value.tempting_option) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Tempting option is required when no_tempting_option is false." });
  }
  if (value.tempting_option && value.tempting_option === value.selected_option) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Tempting option must differ from selected option." });
  }
});

export const StudentIntentSchema = z.enum([
  "confusion_task",
  "confusion_concept",
  "request_example",
  "partial_explanation",
  "misconception_persistence",
  "off_topic_response",
  "unsupported_understanding_claim",
  "revision_evidence",
  "transfer_failure",
  "direct_answer_request",
  "prompt_injection_attempt",
  "assessment_system_question",
  "robust_explanation"
]);
export type StudentIntent = z.infer<typeof StudentIntentSchema>;

const StatePatchSchema = SimulatedStudentStateSchema.partial().omit({
  evidence_history: true,
  turn_index: true
});

const ScriptedStudentTurnSchema = z.object({
  turn_id: z.string().min(1),
  intent: StudentIntentSchema,
  message: z.string().min(1).max(5000),
  state_patch: StatePatchSchema.optional(),
  state_change_reason: z.string().min(1).optional()
}).strict();

const BranchingStudentPolicySchema = z.object({
  policy_id: z.string().min(1),
  max_turns: z.number().int().min(1).max(10),
  intent_sequence: z.array(StudentIntentSchema).min(1).max(10),
  improve_on_concrete_example: z.boolean(),
  preserve_misconception_on_unsupported_claim: z.boolean(),
  recur_on_final_turn: z.boolean().default(false)
}).strict();

const PedagogicalExpectationSchema = z.object({
  expectation_id: z.string().min(1),
  description: z.string().min(1),
  evaluation_mode: z.enum(["deterministic", "manual_review"]),
  rubric_dimension: PedagogicalRubricDimensionSchema
}).strict();

const FinalPlatformStateSchema = z.enum([
  "formative_activity",
  "waiting_for_your_response",
  "feedback_ready",
  "alternative_requested",
  "moved_on",
  "could_not_review_response_safely",
  "transfer_item",
  "session_complete"
]);

const ProhibitedTransitionSchema = z.enum([
  "agent_controls_assessment_state",
  "activity_to_unadministered_answer_reveal",
  "misconception_claim_to_transfer_ready",
  "off_topic_to_misconduct_label",
  "failed_validation_to_success",
  "review_only_packet_to_student_runtime"
]);

export const FormativeEvaluationScenarioSchema = z.object({
  scenario_id: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  scenario_version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  assessment_fixture: z.object({
    fixture_id: z.literal("fixed_irt_e1_v1"),
    concept_unit_public_id: z.string().min(1).optional(),
    initial_item_count: z.literal(3),
    transfer_item_count: z.literal(1)
  }).strict(),
  simulator_mode: z.enum(["scripted", "branching"]),
  initial_student_state: SimulatedStudentStateSchema,
  initial_responses: z.array(InitialItemScenarioResponseSchema).length(3),
  distractor_target: z.object({
    focus_item_public_id: FixtureItemPublicIdSchema,
    focus_option: z.enum(["A", "B", "C", "D"]),
    evidence_source: z.enum(["selected_answer", "tempting_option"]),
    misconception_id: z.string().min(1),
    misconception_description: z.string().min(1)
  }).strict(),
  scripted_turns: z.array(ScriptedStudentTurnSchema).min(1).optional(),
  branching_policy: BranchingStudentPolicySchema.optional(),
  expected_behavior: z.object({
    minimum_visible_assistant_replies: z.number().int().nonnegative(),
    minimum_strategy_changes: z.number().int().nonnegative().optional(),
    misconception_must_not_resolve_before_turn: z.number().int().positive().optional(),
    permitted_final_states: z.array(FinalPlatformStateSchema).min(1),
    prohibited_transitions: z.array(ProhibitedTransitionSchema),
    expected_distractor_focus: z.boolean(),
    revision_expected: z.boolean().optional(),
    transfer_expected: z.boolean().optional()
  }).strict(),
  hard_invariants: z.array(HardInvariantIdSchema).min(1),
  pedagogical_expectations: z.array(PedagogicalExpectationSchema).min(1),
  tags: z.array(z.string().min(1)).min(1)
}).strict().superRefine((scenario, context) => {
  const responseIds = scenario.initial_responses.map((response) => response.item_public_id);
  if (new Set(responseIds).size !== 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["initial_responses"], message: "Initial responses must cover three distinct fixture items." });
  }
  if (!responseIds.includes(scenario.distractor_target.focus_item_public_id as typeof responseIds[number])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["distractor_target", "focus_item_public_id"], message: "Distractor target must reference an administered initial item." });
  }
  const focusResponse = scenario.initial_responses.find(
    (response) => response.item_public_id === scenario.distractor_target.focus_item_public_id
  );
  const observedOption = scenario.distractor_target.evidence_source === "selected_answer"
    ? focusResponse?.selected_option
    : focusResponse?.tempting_option;
  if (observedOption !== scenario.distractor_target.focus_option) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["distractor_target", "focus_option"], message: "Distractor target is inconsistent with its declared response evidence." });
  }
  if (scenario.simulator_mode === "scripted" && !scenario.scripted_turns) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scripted_turns"], message: "Scripted scenarios require scripted_turns." });
  }
  if (scenario.simulator_mode === "branching" && !scenario.branching_policy) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["branching_policy"], message: "Branching scenarios require branching_policy." });
  }
  if (scenario.simulator_mode === "scripted" && scenario.branching_policy) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["branching_policy"], message: "Scripted scenarios cannot define a branching policy." });
  }
  if (scenario.simulator_mode === "branching" && scenario.scripted_turns) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scripted_turns"], message: "Branching scenarios cannot define scripted turns." });
  }
});

export type FormativeEvaluationScenario = z.infer<
  typeof FormativeEvaluationScenarioSchema
>;

export const EvaluationEvidenceReferenceSchema = z.object({
  artifact: z.string().min(1),
  record_key: z.string().min(1),
  detail: z.string().min(1)
}).strict();

export const HardInvariantResultSchema = z.object({
  invariant_id: HardInvariantIdSchema,
  passed: z.boolean(),
  severity: z.enum(["critical", "major", "minor"]),
  evidence: z.array(EvaluationEvidenceReferenceSchema),
  message: z.string().min(1)
}).strict();
export type HardInvariantResult = z.infer<typeof HardInvariantResultSchema>;

export const PedagogicalRubricRecordSchema = z.object({
  dimension: PedagogicalRubricDimensionSchema,
  status: z.enum(["scored", "manual_review_required", "not_applicable"]),
  score: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
  evidence: z.array(EvaluationEvidenceReferenceSchema),
  rationale: z.string().min(1)
}).strict();
export type PedagogicalRubricRecord = z.infer<
  typeof PedagogicalRubricRecordSchema
>;
