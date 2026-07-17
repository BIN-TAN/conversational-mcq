import type {
  FormativeEvaluationScenario,
  FormativeEvaluationStrategy,
  HardInvariantResult,
  HardInvariantId,
  PedagogicalRubricDimension,
  PedagogicalRubricRecord,
  SimulatedStudentState,
  StudentIntent
} from "./schemas";

export type SeededStudentTurn = {
  turn_id: string;
  intent: StudentIntent;
  message: string;
  prior_state: SimulatedStudentState;
  resulting_state: SimulatedStudentState;
};

export type BranchDecision = SeededStudentTurn & {
  rule_id: string;
  observed_condition: string;
  state_change_reason: string;
  policy_violation?: "answer_dumping";
};

export type VisibleTurnRecord = {
  turn_key: string;
  sequence_index: number;
  actor_type: "student" | "agent" | "system" | "orchestrator" | "teacher_researcher";
  message_text: string;
  phase: string;
  client_operation_id: string | null;
  message_type: string | null;
  agent_name: string | null;
  response_function?: string | null;
  progression_readiness?: string | null;
  readiness_gate_reason?: string | null;
};

export type ProfileHistoryRecord = {
  version_index: number;
  ability_profile: string;
  engagement_profile: string;
  integrated_diagnostic_profile: string;
  evidence_sufficiency: string;
  created_at: string;
};

export type PlanHistoryRecord = {
  version_index: number;
  formative_value: string;
  mapping_followed: boolean;
  mapping_deviation_present: boolean;
  created_at: string;
};

export type ActivityAttemptRecord = {
  activity_attempt_public_id: string;
  activity_family: string;
  diagnostic_purpose: string;
  generation_source: string;
  status: string;
  distractor_anchor_present: boolean;
  replaced_activity_attempt_public_id: string | null;
  recovery_used: boolean;
};

export type InternalEvaluationRecord = {
  evaluation_public_id: string;
  activity_attempt_public_id: string;
  status: string;
  evidence_quality: string;
  evaluation_source: string;
};

export type StateTransitionRecord = {
  transition_key: string;
  from_state: string | null;
  to_state: string | null;
  reason: string | null;
  valid: boolean;
};

export type SafetyFinding = {
  finding_id: string;
  passed: boolean;
  severity: "critical" | "major" | "minor";
  detail: string;
};

export type InvariantEvaluationInput = {
  visible_turns: VisibleTurnRecord[];
  profile_history: ProfileHistoryRecord[];
  plan_history: PlanHistoryRecord[];
  activity_attempts: ActivityAttemptRecord[];
  state_transitions: StateTransitionRecord[];
  response_package_stage_audits: Array<{
    stage: "profile" | "planning";
    update_failed: boolean;
    stale_version_used: boolean;
    fallback_source_version_present: boolean;
  }>;
  refresh_projection_hash_before: string;
  refresh_projection_hash_after: string;
  visible_turn_hash_before: string;
  visible_turn_hash_after: string;
  runtime_hash: string;
  provider_call_count: number;
  duplicate_cycle_extra_count: number;
  idempotent_replay_rejected_count: number;
  active_activity_count: number;
  recovery_turn_count: number;
  typed_recovery_turn_count: number;
  fallback_student_visible_leak_count: number;
  replacement_history_preserved: boolean;
};

export type FormativeEvaluationRunSummary = {
  artifact_schema_version: string;
  run_id: string;
  scenario_id: string;
  scenario_version: string;
  simulator_mode: "scripted" | "branching";
  seed: number;
  passed: boolean;
  critical_invariant_failure_count: number;
  major_invariant_failure_count: number;
  minor_invariant_failure_count: number;
  visible_student_turn_count: number;
  visible_assistant_reply_count: number;
  missing_reply_count: number;
  terminal_submission_rejected_count: number;
  idempotent_replay_rejected_count: number;
  strategy_change_count: number;
  strategies: FormativeEvaluationStrategy[];
  fallback_count: number;
  recovery_turn_count: number;
  replacement_activity_count: number;
  refresh_mismatch_count: number;
  answer_key_leak_count: number;
  internal_metadata_leak_count: number;
  premature_resolution_flag_count: number;
  revision_readiness_count: number;
  transfer_readiness_count: number;
  manual_review_required_count: number;
  failed_expectations: string[];
  failed_hard_invariants: HardInvariantId[];
  critical_findings: string[];
  rubric_dimensions_needing_review: PedagogicalRubricDimension[];
  final_profile_status: string | null;
  final_plan_action: string | null;
  final_platform_state: string;
  final_hidden_state: SimulatedStudentState;
  misconception_type: string;
  initial_conceptual_state: string;
  initial_engagement_state: string;
  initial_confidence: string;
  provider_call_count: number;
  fixture_cleaned: boolean;
  artifact_path: string;
};

export type FormativeEvaluationRunArtifacts = {
  scenario: FormativeEvaluationScenario;
  initial_student_state: SimulatedStudentState;
  final_student_state: SimulatedStudentState;
  student_turns: SeededStudentTurn[];
  visible_assistant_turns: VisibleTurnRecord[];
  visible_turns: VisibleTurnRecord[];
  profile_history: ProfileHistoryRecord[];
  plan_history: PlanHistoryRecord[];
  activity_attempts: ActivityAttemptRecord[];
  internal_evaluations: InternalEvaluationRecord[];
  state_transitions: StateTransitionRecord[];
  hard_invariants: HardInvariantResult[];
  pedagogical_rubric: PedagogicalRubricRecord[];
  branch_decisions: BranchDecision[];
  safety_findings: SafetyFinding[];
  run_summary: FormativeEvaluationRunSummary;
};
