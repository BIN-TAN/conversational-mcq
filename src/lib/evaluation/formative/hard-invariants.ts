import { createHash } from "node:crypto";
import {
  ALL_HARD_INVARIANT_IDS,
  APPROVED_OPERATIONAL_RUNTIME_HASH,
  type HardInvariantId,
  type HardInvariantResult
} from "./schemas";
import type { InvariantEvaluationInput, VisibleTurnRecord } from "./types";

const CRITICAL_INVARIANTS = new Set<HardInvariantId>([
  "accepted_student_turn_has_later_visible_assistant_turn",
  "assistant_sequence_index_greater_than_student_sequence_index",
  "visible_sequence_index_strictly_increasing",
  "no_answer_key_leak",
  "no_internal_profile_leak",
  "no_internal_plan_leak",
  "no_agent_metadata_leak",
  "refresh_projection_matches_original",
  "approved_runtime_hash_unchanged",
  "no_live_provider_call",
  "no_invalid_state_transition",
  "visible_turns_are_immutable"
]);

const MINOR_INVARIANTS = new Set<HardInvariantId>([
  "recovery_turn_is_typed",
  "fallback_metadata_is_internal_only"
]);

function severity(invariantId: HardInvariantId) {
  if (CRITICAL_INVARIANTS.has(invariantId)) return "critical" as const;
  if (MINOR_INVARIANTS.has(invariantId)) return "minor" as const;
  return "major" as const;
}

function evidence(invariantId: HardInvariantId, detail: string) {
  return [{ artifact: "hard-invariants.json", record_key: invariantId, detail }];
}

function result(
  invariantId: HardInvariantId,
  passed: boolean,
  message: string,
  detail: string
): HardInvariantResult {
  return {
    invariant_id: invariantId,
    passed,
    severity: severity(invariantId),
    evidence: evidence(invariantId, detail),
    message
  };
}

function dialogueStudentTurns(turns: VisibleTurnRecord[]) {
  return turns.filter(
    (turn) => turn.actor_type === "student" && Boolean(turn.client_operation_id)
  );
}

function laterAssistantFor(turn: VisibleTurnRecord, turns: VisibleTurnRecord[]) {
  return turns.find(
    (candidate) =>
      candidate.actor_type === "agent" &&
      candidate.sequence_index > turn.sequence_index &&
      candidate.client_operation_id === turn.client_operation_id
  );
}

const leakPatterns = {
  answer_key: /\b(answer_key|correct_option|correctness|unadministered answer|hidden answer key)\b/i,
  profile: /\b(ability_profile|engagement_profile|integrated_diagnostic_profile|response profile)\b/i,
  plan: /\b(formative_value|mapping_deviation_reason|diagnostic purpose|selection rationale)\b/i,
  agent: /\b(agent_name|prompt_version|schema_version|operational_config_hash|raw_output|failure_agent_call_id)\b/i,
  fallback: /\b(fallback_source_version|failure_agent_call_id|deterministic fallback|stale_profile_used|stale_plan_used)\b/i
};

export function stableEvaluationHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function evaluateHardInvariants(
  input: InvariantEvaluationInput,
  requested: readonly HardInvariantId[] = ALL_HARD_INVARIANT_IDS
) {
  const students = dialogueStudentTurns(input.visible_turns);
  const missingReplies = students.filter((turn) => !laterAssistantFor(turn, input.visible_turns));
  const invertedReplies = students.filter((turn) => {
    const assistant = laterAssistantFor(turn, input.visible_turns);
    return !assistant || assistant.sequence_index <= turn.sequence_index;
  });
  const ordered = input.visible_turns.every(
    (turn, index) => index === 0 || turn.sequence_index > input.visible_turns[index - 1]!.sequence_index
  );
  const visibleText = input.visible_turns.map((turn) => turn.message_text).join("\n");
  const stagePass = (stage: "profile" | "planning", historyLength: number) =>
    historyLength > 1 || input.response_package_stage_audits.some(
      (audit) =>
        audit.stage === stage &&
        audit.update_failed &&
        audit.stale_version_used &&
        audit.fallback_source_version_present
    );
  const replacementAttempts = input.activity_attempts.filter(
    (attempt) => Boolean(attempt.replaced_activity_attempt_public_id)
  );

  const evaluations: Record<HardInvariantId, HardInvariantResult> = {
    accepted_student_turn_has_later_visible_assistant_turn: result(
      "accepted_student_turn_has_later_visible_assistant_turn",
      missingReplies.length === 0,
      missingReplies.length === 0 ? "Every accepted dialogue turn has a later visible assistant turn." : `${missingReplies.length} accepted turn(s) lack a later assistant reply.`,
      `accepted=${students.length};missing=${missingReplies.length}`
    ),
    assistant_sequence_index_greater_than_student_sequence_index: result(
      "assistant_sequence_index_greater_than_student_sequence_index",
      invertedReplies.length === 0,
      invertedReplies.length === 0 ? "Assistant replies follow their student turns in sequence order." : "At least one assistant reply does not follow its student turn.",
      `invalid_pairs=${invertedReplies.length}`
    ),
    visible_sequence_index_strictly_increasing: result(
      "visible_sequence_index_strictly_increasing",
      ordered,
      ordered ? "Visible sequence indexes are strictly increasing." : "Visible sequence indexes are not strictly increasing.",
      `turn_count=${input.visible_turns.length}`
    ),
    profile_updated_or_stale_fallback_recorded: result(
      "profile_updated_or_stale_fallback_recorded",
      stagePass("profile", input.profile_history.length),
      stagePass("profile", input.profile_history.length) ? "Profile update or explicit stale-profile fallback is recorded." : "No profile update or explicit stale fallback was found.",
      `profile_versions=${input.profile_history.length}`
    ),
    plan_updated_or_stale_fallback_recorded: result(
      "plan_updated_or_stale_fallback_recorded",
      stagePass("planning", input.plan_history.length),
      stagePass("planning", input.plan_history.length) ? "Plan update or explicit stale-plan fallback is recorded." : "No plan update or explicit stale fallback was found.",
      `plan_versions=${input.plan_history.length}`
    ),
    distractor_anchor_present: result(
      "distractor_anchor_present",
      input.activity_attempts.length > 0 && input.activity_attempts.every((attempt) => attempt.distractor_anchor_present),
      input.activity_attempts.every((attempt) => attempt.distractor_anchor_present) ? "Every activity attempt retains a distractor anchor." : "An activity attempt lacks its distractor anchor.",
      `attempts=${input.activity_attempts.length}`
    ),
    no_answer_key_leak: result("no_answer_key_leak", !leakPatterns.answer_key.test(visibleText), !leakPatterns.answer_key.test(visibleText) ? "Student-visible text does not expose raw answer-key structures." : "Student-visible text contains an answer-key structure label.", "student-visible message scan"),
    no_internal_profile_leak: result("no_internal_profile_leak", !leakPatterns.profile.test(visibleText), !leakPatterns.profile.test(visibleText) ? "Student-visible text does not expose internal profile fields." : "Student-visible text contains an internal profile label.", "student-visible message scan"),
    no_internal_plan_leak: result("no_internal_plan_leak", !leakPatterns.plan.test(visibleText), !leakPatterns.plan.test(visibleText) ? "Student-visible text does not expose internal planning fields." : "Student-visible text contains an internal planning label.", "student-visible message scan"),
    no_agent_metadata_leak: result("no_agent_metadata_leak", !leakPatterns.agent.test(visibleText), !leakPatterns.agent.test(visibleText) ? "Student-visible text does not expose agent metadata." : "Student-visible text contains an agent metadata label.", "student-visible message scan"),
    no_duplicate_active_activity: result("no_duplicate_active_activity", input.active_activity_count <= 1, input.active_activity_count <= 1 ? "At most one activity is active." : "Multiple activity attempts are active.", `active=${input.active_activity_count}`),
    replacement_preserves_prior_activity: result("replacement_preserves_prior_activity", replacementAttempts.length === 0 || input.replacement_history_preserved, replacementAttempts.length === 0 || input.replacement_history_preserved ? "Replacement activity history is preserved or no replacement occurred." : "A replacement removed prior visible activity history.", `replacements=${replacementAttempts.length}`),
    refresh_projection_matches_original: result("refresh_projection_matches_original", input.refresh_projection_hash_before === input.refresh_projection_hash_after, "Repeated refresh returns the same student-safe projection.", `${input.refresh_projection_hash_before}:${input.refresh_projection_hash_after}`),
    approved_runtime_hash_unchanged: result("approved_runtime_hash_unchanged", input.runtime_hash === APPROVED_OPERATIONAL_RUNTIME_HASH, input.runtime_hash === APPROVED_OPERATIONAL_RUNTIME_HASH ? "Approved runtime hash is unchanged." : "Approved runtime hash differs from the E1 lock.", input.runtime_hash),
    no_live_provider_call: result("no_live_provider_call", input.provider_call_count === 0, input.provider_call_count === 0 ? "No live provider call occurred." : "A live provider call was detected.", `provider_calls=${input.provider_call_count}`),
    no_invalid_state_transition: result("no_invalid_state_transition", input.state_transitions.every((transition) => transition.valid), input.state_transitions.every((transition) => transition.valid) ? "All captured platform transitions are valid." : "An invalid platform transition was captured.", `transitions=${input.state_transitions.length}`),
    idempotent_duplicate_creates_no_extra_cycle: result(
      "idempotent_duplicate_creates_no_extra_cycle",
      input.duplicate_cycle_extra_count === 0 && input.idempotent_replay_rejected_count === 0,
      input.duplicate_cycle_extra_count === 0 && input.idempotent_replay_rejected_count === 0
        ? "Idempotent replay reused the operation without creating an extra cycle."
        : "Idempotent replay was rejected or created extra records.",
      `extra=${input.duplicate_cycle_extra_count};rejected=${input.idempotent_replay_rejected_count}`
    ),
    recovery_turn_is_typed: result("recovery_turn_is_typed", input.recovery_turn_count === input.typed_recovery_turn_count, input.recovery_turn_count === input.typed_recovery_turn_count ? "Every recovery turn is explicitly typed." : "An untyped recovery turn was found.", `recovery=${input.recovery_turn_count};typed=${input.typed_recovery_turn_count}`),
    fallback_metadata_is_internal_only: result("fallback_metadata_is_internal_only", input.fallback_student_visible_leak_count === 0 && !leakPatterns.fallback.test(visibleText), "Fallback metadata remains internal.", `visible_fallback_leaks=${input.fallback_student_visible_leak_count}`),
    visible_turns_are_immutable: result("visible_turns_are_immutable", input.visible_turn_hash_before === input.visible_turn_hash_after, "Visible turn snapshots remain immutable across refresh.", `${input.visible_turn_hash_before}:${input.visible_turn_hash_after}`)
  };

  return requested.map((invariantId) => evaluations[invariantId]);
}

export function buildPassingInvariantFixture(): InvariantEvaluationInput {
  const turns: VisibleTurnRecord[] = [
    { turn_key: "s1", sequence_index: 1, actor_type: "student", message_text: "I am not sure.", phase: "planning_completed", client_operation_id: "op1", message_type: "topic_dialogue_student", agent_name: null },
    { turn_key: "a1", sequence_index: 2, actor_type: "agent", message_text: "Compare theta with item difficulty.", phase: "planning_completed", client_operation_id: "op1", message_type: "topic_dialogue_agent", agent_name: "topic_dialogue_agent" }
  ];
  const hash = stableEvaluationHash(turns);
  return {
    visible_turns: turns,
    profile_history: [{ version_index: 1, ability_profile: "partial_understanding", engagement_profile: "engaged", integrated_diagnostic_profile: "mixed_evidence", evidence_sufficiency: "partial", created_at: "2026-01-01T00:00:00.000Z" }],
    plan_history: [{ version_index: 1, formative_value: "diagnostic_clarification", mapping_followed: true, mapping_deviation_present: false, created_at: "2026-01-01T00:00:00.000Z" }],
    activity_attempts: [{ activity_attempt_public_id: "attempt_fixture", activity_family: "distractor_contrast", diagnostic_purpose: "distractor_probe", generation_source: "mock_safe", status: "awaiting_student_activity_response", distractor_anchor_present: true, replaced_activity_attempt_public_id: null, recovery_used: false }],
    state_transitions: [{ transition_key: "t1", from_state: "FORMATIVE_ACTIVITY", to_state: "FOLLOWUP_RESPONSE", reason: "student_response", valid: true }],
    response_package_stage_audits: [
      { stage: "profile", update_failed: true, stale_version_used: true, fallback_source_version_present: true },
      { stage: "planning", update_failed: true, stale_version_used: true, fallback_source_version_present: true }
    ],
    refresh_projection_hash_before: hash,
    refresh_projection_hash_after: hash,
    visible_turn_hash_before: hash,
    visible_turn_hash_after: hash,
    runtime_hash: APPROVED_OPERATIONAL_RUNTIME_HASH,
    provider_call_count: 0,
    duplicate_cycle_extra_count: 0,
    idempotent_replay_rejected_count: 0,
    active_activity_count: 1,
    recovery_turn_count: 0,
    typed_recovery_turn_count: 0,
    fallback_student_visible_leak_count: 0,
    replacement_history_preserved: true
  };
}
