import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { sessionStatuses } from "@/lib/domain/enums";
import { generatePublicId } from "@/lib/services/ids";
import { stripInternalKeys } from "@/lib/services/teacher-review/serializers";
import { MasterExportServiceError } from "./errors";
import {
  MASTER_EXPORT_COLUMNS,
  MASTER_EXPORT_SCHEMA_VERSION,
  serializeMasterCsv,
  stableJson,
  type MasterExportColumn,
  type MasterExportRow
} from "./csv";
import {
  readExportFile,
  storageKeyForExport,
  writeExportFile
} from "./storage";

const masterExportOptionsSchema = z.object({
  assessment_public_id: z.string().trim().min(1).optional(),
  session_status: z.array(z.enum(sessionStatuses)).optional(),
  include_incomplete_sessions: z.boolean().default(true),
  primary_outcome_name: z.string().trim().min(1).optional(),
  include_raw_json_columns: z.boolean().default(true),
  spreadsheet_safe_text: z.boolean().default(true)
}).strict();

export type MasterExportOptions = z.infer<typeof masterExportOptionsSchema>;

function iso(value?: Date | null) {
  return value ? value.toISOString() : "";
}

function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function decimalString(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function numberValue(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function snapshotField(snapshot: unknown, key: string, fallback: unknown = "") {
  const record = asRecord(snapshot);
  return record[key] ?? fallback;
}

function countEvent(events: Array<{ event_type: string; payload: unknown }>, keys: string[]) {
  return events.filter((event) => keys.includes(event.event_type)).length;
}

function hasRevisionPayload(payload: unknown) {
  const record = asRecord(payload);
  return record.revision === true || Number(record.revision_count ?? 0) > 0;
}

function aggregateEvents(events: Array<{ event_type: string; payload: unknown }>, followupTurnCount: number) {
  return {
    page_switch_count: countEvent(events, ["page_hidden", "page_visible"]),
    long_pause_count: countEvent(events, ["long_pause"]),
    inactivity_count: countEvent(events, ["inactivity_detected"]),
    navigation_event_count: countEvent(events, ["navigation_event"]),
    invalid_help_request_count: countEvent(events, ["invalid_help_request"]),
    prompt_injection_attempt_count: countEvent(events, ["prompt_injection_attempt"]),
    procedural_clarification_count: countEvent(events, ["procedural_clarification_request"]),
    emotional_response_count: countEvent(events, ["emotional_or_frustration_response"]),
    reasoning_revision_count: countEvent(events, ["reasoning_revised"]),
    option_revision_count: events.filter(
      (event) => event.event_type === "option_selected" && hasRevisionPayload(event.payload)
    ).length,
    validation_failure_count: countEvent(events, ["schema_validation_failed"]),
    agent_retry_count: countEvent(events, ["agent_retry_scheduled"]),
    followup_turn_count: followupTurnCount,
    followup_update_trigger_count: countEvent(events, [
      "followup_update_triggered",
      "followup_update_cycle_started",
      "followup_evidence_trigger_candidate"
    ]),
    followup_update_failure_count: countEvent(events, [
      "followup_update_failed",
      "followup_update_cycle_failed"
    ]),
    concept_progression_request_count: countEvent(events, [
      "concept_progression_requested",
      "concept_progression_request_created"
    ]),
    unresolved_progression_confirmation_count: countEvent(events, [
      "unresolved_progression_confirmation",
      "concept_progression_unresolved_confirmed"
    ]),
    response_collection_agent_call_count: countEvent(events, [
      "response_collection_agent_invoked"
    ]),
    response_collection_fallback_count: countEvent(events, [
      "response_collection_fallback_used"
    ]),
    response_collection_reasoning_extraction_count: countEvent(events, [
      "response_collection_reasoning_extracted"
    ]),
    response_collection_reasoning_extraction_failure_count: countEvent(events, [
      "response_collection_reasoning_extraction_failed"
    ])
  };
}

function transcriptText(
  turns: Array<{ actor_type: string; agent_name: string | null; message_text: string | null; created_at: Date }>
) {
  return turns
    .map((turn) => {
      const actor = turn.agent_name ? `${turn.actor_type}:${turn.agent_name}` : turn.actor_type;
      return `[${turn.created_at.toISOString()}] ${actor}: ${turn.message_text ?? ""}`;
    })
    .join("\n");
}

function isFollowupPhase(phase: string) {
  return [
    "followup_active",
    "followup_profile_update_pending",
    "followup_planning_update_pending",
    "followup_stopped"
  ].includes(phase);
}

function dateMillis(value: unknown) {
  const millis = new Date(String(value)).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function isoValue(value: unknown) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function sortByCreatedAt<T extends Record<string, unknown>>(values: T[]) {
  return [...values].sort(
    (left, right) => dateMillis(left.created_at) - dateMillis(right.created_at)
  );
}

function safeAgentCall(call: Record<string, unknown> | null | undefined) {
  if (!call) {
    return null;
  }

  return stripInternalKeys({
    call_public_id: call.call_public_id,
    agent_name: call.agent_name,
    provider: call.provider,
    model_name: call.model_name,
    agent_version: call.agent_version,
    prompt_version: call.prompt_version,
    schema_version: call.schema_version,
    prompt_hash: call.prompt_hash,
    call_status: call.call_status,
    output_validated: call.output_validated,
    validation_error: call.validation_error,
    blocked_reason: call.blocked_reason,
    error_category: call.error_category,
    retry_count: call.retry_count,
    live_call_allowed: call.live_call_allowed,
    latency_ms: call.latency_ms,
    input_tokens: call.input_tokens,
    output_tokens: call.output_tokens,
    total_tokens: call.total_tokens,
    estimated_cost: call.estimated_cost,
    started_at: call.started_at,
    completed_at: call.completed_at,
    created_at: call.created_at
  });
}

function safeProfile(profile: Record<string, unknown>) {
  return stripInternalKeys({
    profile_public_id: profile.profile_public_id,
    profile_type: profile.profile_type,
    ability_profile: profile.ability_profile,
    ability_pattern_flags: profile.ability_pattern_flags,
    engagement_profile: profile.engagement_profile,
    engagement_pattern_flags: profile.engagement_pattern_flags,
    integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
    integrated_profile_confidence: profile.integrated_profile_confidence,
    integrated_profile_rationale: profile.integrated_profile_rationale,
    evidence_sufficiency: profile.evidence_sufficiency,
    confidence_alignment: profile.confidence_alignment,
    independence_interpretability: profile.independence_interpretability,
    misconception_indicators: profile.misconception_indicators,
    item_level_evidence: profile.item_level_evidence,
    reasoning_quality_summary: profile.reasoning_quality_summary,
    engagement_summary: profile.engagement_summary,
    process_interpretation_cautions: profile.process_interpretation_cautions,
    profile_confidence: profile.profile_confidence,
    rationale: profile.rationale,
    recommended_next_evidence: profile.recommended_next_evidence,
    based_on_agent_call: safeAgentCall(asRecord(profile.based_on_agent_call)),
    created_at: profile.created_at
  });
}

function profileFields(input: {
  profiles: Array<Record<string, unknown>>;
  latestProfileDbId?: string | null;
}) {
  const sorted = sortByCreatedAt(input.profiles);
  const initial = sorted.find((profile) => profile.profile_type === "initial") ?? sorted[0] ?? null;
  const latest =
    sorted.find((profile) => profile.id === input.latestProfileDbId) ?? sorted.at(-1) ?? null;
  const history = sorted.map(safeProfile);

  return {
    initial_ability_profile: String(initial?.ability_profile ?? ""),
    latest_ability_profile: String(latest?.ability_profile ?? ""),
    ability_pattern_flags_latest: latest ? stableJson(latest.ability_pattern_flags ?? []) : "[]",
    initial_engagement_profile: String(initial?.engagement_profile ?? ""),
    latest_engagement_profile: String(latest?.engagement_profile ?? ""),
    engagement_pattern_flags_latest: latest ? stableJson(latest.engagement_pattern_flags ?? []) : "[]",
    initial_integrated_diagnostic_profile: String(initial?.integrated_diagnostic_profile ?? ""),
    latest_integrated_diagnostic_profile: String(latest?.integrated_diagnostic_profile ?? ""),
    integrated_profile_confidence_latest: String(latest?.integrated_profile_confidence ?? ""),
    integrated_profile_rationale_latest: String(latest?.integrated_profile_rationale ?? ""),
    evidence_sufficiency_latest: String(latest?.evidence_sufficiency ?? ""),
    confidence_alignment_latest: String(latest?.confidence_alignment ?? ""),
    independence_interpretability_latest: String(latest?.independence_interpretability ?? ""),
    misconception_indicators_latest: latest ? stableJson(latest.misconception_indicators ?? []) : "[]",
    reasoning_quality_summary_latest: String(latest?.reasoning_quality_summary ?? ""),
    engagement_summary_latest: String(latest?.engagement_summary ?? ""),
    process_interpretation_cautions_latest: latest
      ? stableJson(latest.process_interpretation_cautions ?? [])
      : "[]",
    profile_confidence_latest: String(latest?.profile_confidence ?? ""),
    profile_rationale_latest: String(latest?.rationale ?? ""),
    recommended_next_evidence_latest: latest ? stableJson(latest.recommended_next_evidence ?? []) : "[]",
    initial_profile_created_at: isoValue(initial?.created_at),
    latest_profile_created_at: isoValue(latest?.created_at),
    profile_count: sorted.length,
    profile_change_count: Math.max(0, sorted.length - 1),
    profile_history_json: stableJson(history),
    integrated_profile_history_json: stableJson(
      sorted.map((profile) => ({
        profile_public_id: profile.profile_public_id,
        profile_type: profile.profile_type,
        created_at: profile.created_at,
        integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
        integrated_profile_confidence: profile.integrated_profile_confidence,
        integrated_profile_rationale: profile.integrated_profile_rationale,
        based_on_agent_call: safeAgentCall(asRecord(profile.based_on_agent_call))
      }))
    )
  };
}

function safeFormativeDecision(decision: Record<string, unknown>) {
  return stripInternalKeys({
    decision_public_id: decision.decision_public_id,
    formative_value: decision.formative_value,
    formative_action_plan: decision.formative_action_plan,
    target_evidence: decision.target_evidence,
    success_criteria: decision.success_criteria,
    followup_prompt_constraints: decision.followup_prompt_constraints,
    profile_update_triggers: decision.profile_update_triggers,
    rationale: decision.rationale,
    mapping_followed: decision.mapping_followed,
    mapping_deviation_reason: decision.mapping_deviation_reason,
    student_profile: stripInternalKeys({
      profile_public_id: asRecord(decision.student_profile).profile_public_id,
      profile_type: asRecord(decision.student_profile).profile_type,
      created_at: asRecord(decision.student_profile).created_at
    }),
    based_on_agent_call: safeAgentCall(asRecord(decision.based_on_agent_call)),
    created_at: decision.created_at
  });
}

function formativeFields(input: {
  decisions: Array<Record<string, unknown>>;
  latestDecisionDbId?: string | null;
}) {
  const sorted = sortByCreatedAt(input.decisions);
  const initial = sorted[0] ?? null;
  const latest =
    sorted.find((decision) => decision.id === input.latestDecisionDbId) ?? sorted.at(-1) ?? null;
  const changes = sorted.reduce((count, decision, index) => {
    if (index === 0) {
      return 0;
    }

    return decision.formative_value !== sorted[index - 1]?.formative_value ? count + 1 : count;
  }, 0);
  const history = sorted.map(safeFormativeDecision);

  return {
    initial_formative_value: String(initial?.formative_value ?? ""),
    latest_formative_value: String(latest?.formative_value ?? ""),
    latest_formative_decision_created_at: isoValue(latest?.created_at),
    formative_decision_count: sorted.length,
    formative_action_plan_latest: String(latest?.formative_action_plan ?? ""),
    target_evidence_latest: latest ? stableJson(latest.target_evidence ?? []) : "[]",
    success_criteria_latest: latest ? stableJson(latest.success_criteria ?? []) : "[]",
    followup_prompt_constraints_latest: latest
      ? stableJson(latest.followup_prompt_constraints ?? {})
      : "[]",
    profile_update_triggers_latest: latest ? stableJson(latest.profile_update_triggers ?? []) : "[]",
    formative_rationale_latest: String(latest?.rationale ?? ""),
    mapping_followed_latest:
      latest?.mapping_followed === undefined || latest?.mapping_followed === null
        ? ""
        : Boolean(latest.mapping_followed),
    mapping_deviation_reason_latest: String(latest?.mapping_deviation_reason ?? ""),
    formative_value_change_count: changes,
    formative_value_history_json: stableJson(
      sorted.map((decision) => ({
        decision_public_id: decision.decision_public_id,
        formative_value: decision.formative_value,
        created_at: decision.created_at,
        based_on_agent_call: safeAgentCall(asRecord(decision.based_on_agent_call))
      }))
    ),
    formative_decision_history_json: stableJson(history)
  };
}

function followupRoundFields(input: {
  rounds: Array<Record<string, unknown>>;
  turns: Array<{
    actor_type: string;
    message_text: string | null;
    phase: string;
    created_at: Date;
    followup_round_db_id?: string | null;
  }>;
  events: Array<{ event_type: string }>;
}) {
  const sorted = [...input.rounds].sort(
    (left, right) => Number(left.round_index ?? 0) - Number(right.round_index ?? 0)
  );
  const active = sorted.find((round) => round.status === "active") ?? null;
  const latest = sorted.at(-1) ?? null;
  const followupTurns = input.turns.filter((turn) => isFollowupPhase(turn.phase));
  const studentTurns = followupTurns.filter((turn) => turn.actor_type === "student");
  const agentTurns = followupTurns.filter((turn) => turn.actor_type === "agent");

  return {
    active_followup_round_index: active ? Number(active.round_index ?? "") : "",
    latest_followup_round_status: String(latest?.status ?? ""),
    latest_followup_round_started_at: isoValue(latest?.started_at),
    latest_followup_round_completed_at: isoValue(latest?.completed_at),
    followup_student_turn_count: studentTurns.length,
    followup_agent_turn_count: agentTurns.length,
    followup_substantive_student_turn_count: studentTurns.filter((turn) =>
      Boolean(turn.message_text?.trim())
    ).length,
    followup_evidence_trigger_candidate_count: countEvent(
      input.events.map((event) => ({ event_type: event.event_type, payload: null })),
      ["followup_evidence_trigger_candidate", "followup_update_triggered"]
    ),
    followup_move_on_offer_count: countEvent(
      input.events.map((event) => ({ event_type: event.event_type, payload: null })),
      ["move_on_offer", "followup_move_on_offer"]
    ),
    followup_rounds_json: stableJson(
      sorted.map((round) =>
        stripInternalKeys({
          followup_round_public_id: round.followup_round_public_id,
          round_index: round.round_index,
          status: round.status,
          evidence_trigger_type: round.evidence_trigger_type,
          started_at: round.started_at,
          completed_at: round.completed_at,
          updated_student_profile: stripInternalKeys({
            profile_public_id: asRecord(round.updated_student_profile).profile_public_id,
            profile_type: asRecord(round.updated_student_profile).profile_type,
            created_at: asRecord(round.updated_student_profile).created_at
          }),
          formative_decision: stripInternalKeys({
            decision_public_id: asRecord(round.formative_decision).decision_public_id,
            formative_value: asRecord(round.formative_decision).formative_value,
            created_at: asRecord(round.formative_decision).created_at
          }),
          created_at: round.created_at
        })
      )
    )
  };
}

function updateCycleFields(cycles: Array<Record<string, unknown>>) {
  const sorted = sortByCreatedAt(cycles);
  const latest = sorted.at(-1) ?? null;

  return {
    followup_update_cycle_count: sorted.length,
    followup_update_completed_count: sorted.filter((cycle) => cycle.status === "completed").length,
    followup_update_failed_count: sorted.filter((cycle) => cycle.status === "failed").length,
    latest_followup_update_cycle_status: String(latest?.status ?? ""),
    latest_followup_update_trigger_type: String(latest?.trigger_type ?? ""),
    latest_followup_update_final_update:
      latest?.final_update === undefined || latest?.final_update === null
        ? ""
        : Boolean(latest.final_update),
    latest_followup_update_failure_stage: String(latest?.failure_stage ?? ""),
    latest_followup_update_failure_category: String(latest?.failure_category ?? ""),
    followup_update_cycles_json: stableJson(
      sorted.map((cycle) =>
        stripInternalKeys({
          cycle_public_id: cycle.cycle_public_id,
          source_followup_round_index: asRecord(cycle.source_followup_round).round_index,
          trigger_type: cycle.trigger_type,
          trigger_details: cycle.trigger_details,
          status: cycle.status,
          final_update: cycle.final_update,
          create_next_round: cycle.create_next_round,
          stop_after_cycle: cycle.stop_after_cycle,
          post_cycle_action: cycle.post_cycle_action,
          evidence_cutoff_at: cycle.evidence_cutoff_at,
          staged_profile_output: cycle.staged_profile_output,
          staged_planning_output: cycle.staged_planning_output,
          failure_stage: cycle.failure_stage,
          failure_category: cycle.failure_category,
          failure_message: cycle.failure_message,
          profile_agent_call: safeAgentCall(asRecord(cycle.profile_agent_call)),
          planning_agent_call: safeAgentCall(asRecord(cycle.planning_agent_call)),
          opening_agent_call: safeAgentCall(asRecord(cycle.opening_agent_call)),
          completed_at: cycle.completed_at,
          created_at: cycle.created_at
        })
      )
    )
  };
}

function progressionFields(records: Array<Record<string, unknown>>) {
  const sorted = [...records].sort(
    (left, right) => dateMillis(left.requested_at) - dateMillis(right.requested_at)
  );
  const latest = sorted.at(-1) ?? null;

  return {
    progression_record_count: sorted.length,
    latest_progression_status: String(latest?.status ?? ""),
    latest_progression_type: String(latest?.progression_type ?? ""),
    latest_progression_trigger_type: String(latest?.trigger_type ?? ""),
    latest_progression_student_choice: String(latest?.student_choice ?? ""),
    latest_progression_resolution_status: String(latest?.resolution_status ?? ""),
    moved_on_with_unresolved_evidence:
      latest?.moved_on_with_unresolved_evidence === undefined ||
      latest?.moved_on_with_unresolved_evidence === null
        ? ""
        : Boolean(latest.moved_on_with_unresolved_evidence),
    completed_with_unresolved_evidence:
      latest?.completed_with_unresolved_evidence === undefined ||
      latest?.completed_with_unresolved_evidence === null
        ? ""
        : Boolean(latest.completed_with_unresolved_evidence),
    progression_requested_at: isoValue(latest?.requested_at),
    progression_confirmed_at: isoValue(latest?.confirmed_at),
    progression_completed_at: isoValue(latest?.completed_at),
    destination_concept_unit_id: String(
      asRecord(latest?.destination_concept_unit).concept_unit_public_id ?? ""
    ),
    concept_progression_history_json: stableJson(
      sorted.map((record) =>
        stripInternalKeys({
          progression_public_id: record.progression_public_id,
          progression_type: record.progression_type,
          trigger_type: record.trigger_type,
          student_choice: record.student_choice,
          status: record.status,
          resolution_status: record.resolution_status,
          moved_on_with_unresolved_evidence: record.moved_on_with_unresolved_evidence,
          completed_with_unresolved_evidence: record.completed_with_unresolved_evidence,
          destination_concept_unit_id: asRecord(record.destination_concept_unit).concept_unit_public_id,
          requested_at: record.requested_at,
          confirmed_at: record.confirmed_at,
          completed_at: record.completed_at
        })
      )
    )
  };
}

function workflowFields(input: {
  jobs: Array<Record<string, unknown>>;
  overrides: Array<Record<string, unknown>>;
  includeRawJson: boolean;
}) {
  const sortedJobs = sortByCreatedAt(input.jobs);
  const latest = sortedJobs.at(-1) ?? null;
  const overrideHistory = input.overrides.map((override) =>
    stripInternalKeys({
      override_public_id: override.override_public_id,
      action_type: override.action_type,
      reason: override.reason,
      created_at: override.created_at
    })
  );

  return {
    workflow_job_count: sortedJobs.length,
    workflow_job_completed_count: sortedJobs.filter((job) => job.status === "completed").length,
    workflow_job_failed_count: sortedJobs.filter((job) => job.status === "failed").length,
    workflow_job_retry_count: sortedJobs.reduce(
      (total, job) => total + Math.max(0, Number(job.attempt_count ?? 0) - 1),
      0
    ),
    latest_workflow_job_type: String(latest?.job_type ?? ""),
    latest_workflow_job_status: String(latest?.status ?? ""),
    latest_workflow_activity_at: isoValue(latest?.updated_at ?? latest?.created_at),
    workflow_exception_count: sortedJobs.filter(
      (job) => job.status === "failed" || Boolean(job.last_error_category)
    ).length,
    workflow_override_count: input.overrides.length,
    workflow_jobs_json: input.includeRawJson
      ? stableJson(
          sortedJobs.map((job) =>
            stripInternalKeys({
              job_public_id: job.job_public_id,
              job_type: job.job_type,
              status: job.status,
              payload: job.payload,
              attempt_count: job.attempt_count,
              max_attempts: job.max_attempts,
              run_after: job.run_after,
              last_error_category: job.last_error_category,
              last_error_message: job.last_error_message,
              created_at: job.created_at,
              updated_at: job.updated_at,
              completed_at: job.completed_at
            })
          )
        )
      : "",
    workflow_overrides_json: input.includeRawJson ? stableJson(overrideHistory) : ""
  };
}

function sessionCompletionFields(input: {
  session: Record<string, unknown>;
  conceptUnitSessions: Array<{ concept_unit: { concept_unit_public_id: string; order_index: number } }>;
  progressionRecords: Array<Record<string, unknown>>;
}) {
  const sortedProgressions = [...input.progressionRecords].sort(
    (left, right) => dateMillis(left.completed_at ?? left.requested_at) - dateMillis(right.completed_at ?? right.requested_at)
  );
  const completionProgression =
    sortedProgressions.find((record) => record.progression_type === "complete_assessment") ??
    sortedProgressions.at(-1) ??
    null;
  const finalConcept =
    [...input.conceptUnitSessions].sort(
      (left, right) => left.concept_unit.order_index - right.concept_unit.order_index
    ).at(-1)?.concept_unit ?? null;

  return {
    assessment_completed:
      input.session.status === "completed" || input.session.current_phase === "session_completed",
    assessment_completed_at: isoValue(input.session.completed_at),
    assessment_completed_with_unresolved_evidence:
      completionProgression?.completed_with_unresolved_evidence === undefined ||
      completionProgression?.completed_with_unresolved_evidence === null
        ? ""
        : Boolean(completionProgression.completed_with_unresolved_evidence),
    final_concept_unit_id: finalConcept?.concept_unit_public_id ?? "",
    final_concept_resolution_status: String(completionProgression?.resolution_status ?? "")
  };
}

function agentFields(input: {
  agentCalls: Array<Record<string, unknown>>;
  includeRawJson: boolean;
}) {
  const { agentCalls } = input;
  const stringSet = (key: string) =>
    [...new Set(agentCalls.map((call) => call[key]).filter((value) => typeof value === "string"))].join("|");

  return {
    agent_model_names: stringSet("model_name"),
    agent_versions: stringSet("agent_version"),
    prompt_versions: stringSet("prompt_version"),
    schema_versions: stringSet("schema_version"),
    prompt_hashes: stringSet("prompt_hash"),
    agent_providers: stringSet("provider"),
    agent_call_count: agentCalls.length,
    agent_blocked_call_count: agentCalls.filter((call) => Boolean(call.blocked_reason)).length,
    agent_failed_call_count: agentCalls.filter((call) =>
      ["failed", "invalid_output", "needs_review"].includes(String(call.call_status))
    ).length,
    agent_validation_failure_count: agentCalls.filter(
      (call) => call.output_validated === false && call.validation_error
    ).length,
    agent_calls_json: input.includeRawJson ? stableJson(agentCalls.map(safeAgentCall)) : ""
  };
}

const jsonArrayDefaultColumns = new Set<MasterExportColumn>([
  "conversation_turns_json",
  "process_events_json",
  "response_packages_json",
  "ability_pattern_flags_latest",
  "engagement_pattern_flags_latest",
  "misconception_indicators_latest",
  "process_interpretation_cautions_latest",
  "recommended_next_evidence_latest",
  "profile_history_json",
  "integrated_profile_history_json",
  "target_evidence_latest",
  "success_criteria_latest",
  "followup_prompt_constraints_latest",
  "profile_update_triggers_latest",
  "formative_value_history_json",
  "formative_decision_history_json",
  "followup_rounds_json",
  "followup_update_cycles_json",
  "concept_progression_history_json",
  "workflow_jobs_json",
  "workflow_overrides_json",
  "agent_calls_json",
  "summative_outcomes_json"
]);

function outcomeFields(input: {
  outcomes: Array<{
    outcome_name: string;
    outcome_score: Prisma.Decimal;
    max_score: Prisma.Decimal;
    assessment_date: Date;
    notes: string | null;
    outcome_public_id: string;
    revision_number: number;
  }>;
  primaryOutcomeName?: string;
}) {
  const primary = input.primaryOutcomeName
    ? input.outcomes.find((outcome) => outcome.outcome_name === input.primaryOutcomeName)
    : null;
  const score = numberValue(primary?.outcome_score);
  const max = numberValue(primary?.max_score);

  return {
    primary_summative_outcome_name: primary?.outcome_name ?? "",
    primary_summative_outcome_score: decimalString(primary?.outcome_score),
    primary_summative_outcome_max_score: decimalString(primary?.max_score),
    primary_summative_outcome_percent:
      score !== null && max !== null && max > 0 ? ((score / max) * 100).toFixed(4) : "",
    primary_summative_assessment_date: dateOnly(primary?.assessment_date),
    summative_outcomes_json: stableJson(
      input.outcomes.map((outcome) => ({
        outcome_public_id: outcome.outcome_public_id,
        outcome_name: outcome.outcome_name,
        outcome_score: decimalString(outcome.outcome_score),
        max_score: decimalString(outcome.max_score),
        assessment_date: dateOnly(outcome.assessment_date),
        notes: outcome.notes,
        revision_number: outcome.revision_number
      }))
    )
  };
}

function baseEmptyRow(): MasterExportRow {
  const row = Object.fromEntries(MASTER_EXPORT_COLUMNS.map((column) => [column, ""])) as MasterExportRow;

  for (const column of jsonArrayDefaultColumns) {
    row[column] = "[]";
  }

  return row;
}

async function buildMasterExportRows(options: MasterExportOptions) {
  const generatedAt = new Date().toISOString();
  const courseTimezone = getServerEnv().COURSE_TIMEZONE;
  const sessionWhere: Prisma.AssessmentSessionWhereInput = {
    ...(options.assessment_public_id
      ? { assessment: { assessment_public_id: options.assessment_public_id } }
      : {}),
    ...(options.session_status?.length ? { status: { in: options.session_status } } : {}),
    ...(!options.include_incomplete_sessions && !options.session_status?.length
      ? { status: "completed" }
      : {})
  };
  const sessions = await prisma.assessmentSession.findMany({
    where: sessionWhere,
    include: {
      user: {
        select: {
          id: true,
          user_id: true,
          display_name: true,
          account_status: true,
          created_at: true,
          last_login_at: true
        }
      },
      assessment: {
        select: {
          assessment_public_id: true,
          title: true,
          status: true,
          workflow_mode: true,
          response_collection_mode: true,
          release_at: true,
          close_at: true
        }
      },
      concept_unit_sessions: {
        include: {
          concept_unit: true,
          item_responses: {
            include: { item: true },
            orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }]
          },
          conversation_turns: {
            orderBy: { created_at: "asc" }
          },
          process_events: {
            orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }]
          },
          response_packages: {
            orderBy: { created_at: "asc" }
          },
          student_profiles: {
            include: {
              based_on_agent_call: true
            },
            orderBy: { created_at: "asc" }
          },
          formative_decisions: {
            include: {
              based_on_agent_call: true,
              student_profile: true
            },
            orderBy: { created_at: "asc" }
          },
          followup_rounds: {
            include: {
              formative_decision: true,
              updated_student_profile: true
            },
            orderBy: { round_index: "asc" }
          },
          followup_update_cycles: {
            include: {
              source_followup_round: true,
              profile_agent_call: true,
              planning_agent_call: true,
              opening_agent_call: true
            },
            orderBy: { created_at: "asc" }
          },
          concept_progression_records: {
            include: {
              destination_concept_unit: true
            },
            orderBy: { requested_at: "asc" }
          },
          workflow_jobs: {
            orderBy: { created_at: "asc" }
          },
          workflow_overrides: {
            orderBy: { created_at: "asc" }
          },
          agent_calls: {
            orderBy: { created_at: "asc" }
          }
        }
      },
      conversation_turns: {
        orderBy: { created_at: "asc" }
      },
      process_events: {
        orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }]
      },
      agent_calls: {
        orderBy: { created_at: "asc" }
      },
      workflow_jobs: {
        orderBy: { created_at: "asc" }
      },
      workflow_overrides: {
        orderBy: { created_at: "asc" }
      },
      concept_progression_records: {
        include: {
          destination_concept_unit: true
        },
        orderBy: { requested_at: "asc" }
      }
    }
  });
  const sortedSessions = sessions.sort((left, right) =>
    [
      left.user.user_id.localeCompare(right.user.user_id),
      left.assessment.assessment_public_id.localeCompare(right.assessment.assessment_public_id),
      left.session_public_id.localeCompare(right.session_public_id)
    ].find((result) => result !== 0) ?? 0
  );
  const userDbIds = [...new Set(sortedSessions.map((session) => session.user.id))];
  const outcomes = await prisma.summativeOutcome.findMany({
    where: {
      user_db_id: { in: userDbIds },
      record_status: "active"
    },
    orderBy: [{ outcome_name: "asc" }, { assessment_date: "asc" }],
    select: {
      outcome_public_id: true,
      user_db_id: true,
      outcome_name: true,
      outcome_score: true,
      max_score: true,
      assessment_date: true,
      notes: true,
      revision_number: true
    }
  });
  const outcomesByUser = new Map<string, typeof outcomes>();

  for (const outcome of outcomes) {
    const current = outcomesByUser.get(outcome.user_db_id) ?? [];
    current.push(outcome);
    outcomesByUser.set(outcome.user_db_id, current);
  }

  const rows: MasterExportRow[] = [];

  for (const session of sortedSessions) {
    const sessionOutcomes = outcomesByUser.get(session.user.id) ?? [];
    const sessionOutcomeFields = outcomeFields({
      outcomes: sessionOutcomes,
      primaryOutcomeName: options.primary_outcome_name
    });
    const sessionTurns = session.conversation_turns;
    const sessionFollowupTurns = sessionTurns.filter((turn) => isFollowupPhase(turn.phase));
    const sessionProcessEvents = session.process_events;
    const sessionFollowupTurnCount = sessionFollowupTurns.length;
    const sortedConceptUnitSessions = [...session.concept_unit_sessions].sort(
      (left, right) =>
        left.concept_unit.order_index - right.concept_unit.order_index ||
        left.created_at.getTime() - right.created_at.getTime()
    );
    const sessionWorkflowFields = workflowFields({
      jobs: session.workflow_jobs as unknown as Array<Record<string, unknown>>,
      overrides: session.workflow_overrides as unknown as Array<Record<string, unknown>>,
      includeRawJson: options.include_raw_json_columns
    });
    const sessionCompletion = sessionCompletionFields({
      session: session as unknown as Record<string, unknown>,
      conceptUnitSessions: sortedConceptUnitSessions,
      progressionRecords: session.concept_progression_records as unknown as Array<Record<string, unknown>>
    });

    const makeBaseRow = (
      rowType: MasterExportRow["row_type"],
      conceptUnitSession?: (typeof sortedConceptUnitSessions)[number]
    ) => {
      const row = baseEmptyRow();
      const turns = conceptUnitSession?.conversation_turns ?? sessionTurns;
      const initialTurns = turns.filter((turn) => !isFollowupPhase(turn.phase));
      const followupTurns = turns.filter((turn) => isFollowupPhase(turn.phase));
      const processEvents = conceptUnitSession?.process_events ?? sessionProcessEvents;
      const responsePackages = conceptUnitSession?.response_packages ?? [];
      const aggregates = aggregateEvents(
        processEvents.map((event) => ({ event_type: event.event_type, payload: event.payload })),
        conceptUnitSession ? followupTurns.length : sessionFollowupTurnCount
      );
      const conceptUnitEvents = processEvents.map((event) => ({ event_type: event.event_type }));
      const profiles = profileFields({
        profiles: (conceptUnitSession?.student_profiles ?? []) as unknown as Array<Record<string, unknown>>,
        latestProfileDbId: conceptUnitSession?.latest_student_profile_db_id
      });
      const formatives = formativeFields({
        decisions: (conceptUnitSession?.formative_decisions ?? []) as unknown as Array<Record<string, unknown>>,
        latestDecisionDbId: conceptUnitSession?.latest_formative_decision_db_id
      });
      const followupRounds = followupRoundFields({
        rounds: (conceptUnitSession?.followup_rounds ?? []) as unknown as Array<Record<string, unknown>>,
        turns,
        events: conceptUnitEvents
      });
      const updateCycles = updateCycleFields(
        (conceptUnitSession?.followup_update_cycles ?? []) as unknown as Array<Record<string, unknown>>
      );
      const progressions = progressionFields(
        (conceptUnitSession?.concept_progression_records ?? []) as unknown as Array<Record<string, unknown>>
      );
      const agents = agentFields({
        agentCalls: (conceptUnitSession?.agent_calls ?? session.agent_calls) as unknown as Array<Record<string, unknown>>,
        includeRawJson: options.include_raw_json_columns
      });

      row.export_generated_at = generatedAt;
      row.export_schema_version = MASTER_EXPORT_SCHEMA_VERSION;
      row.row_type = rowType;
      row.user_id = session.user.user_id;
      row.student_display_name = session.user.display_name ?? "";
      row.student_account_status = session.user.account_status;
      row.student_created_at = iso(session.user.created_at);
      row.student_last_login_at = iso(session.user.last_login_at);
      row.session_id = session.session_public_id;
      row.assessment_id = session.assessment.assessment_public_id;
      row.assessment_title = session.assessment.title;
      row.assessment_status = session.assessment.status;
      row.assessment_workflow_mode = session.assessment.workflow_mode;
      row.session_workflow_mode_snapshot = session.workflow_mode_snapshot;
      row.assessment_response_collection_mode = session.assessment.response_collection_mode;
      row.session_response_collection_mode_snapshot =
        session.response_collection_mode_snapshot;
      row.assessment_release_at_utc = iso(session.assessment.release_at);
      row.assessment_close_at_utc = iso(session.assessment.close_at);
      row.course_timezone = courseTimezone;
      row.attempt_number = session.attempt_number;
      row.session_status = session.status;
      row.current_phase = session.current_phase;
      row.automation_state = session.automation_exception_reason
        ? "exception"
        : session.workflow_mode_snapshot === "manual_review"
          ? "manual_review"
          : session.automation_paused_at
            ? "paused"
            : "active";
      row.automation_paused = Boolean(session.automation_paused_at);
      row.automation_exception_reason = session.automation_exception_reason ?? "";
      row.needs_review = session.needs_review;
      row.needs_review_reason = session.needs_review_reason ?? "";
      row.session_started_at = iso(session.started_at);
      row.session_last_activity_at = iso(session.last_activity_at);
      row.session_completed_at = iso(session.completed_at);
      row.student_chose_exit =
        session.status === "student_exited" || session.current_phase === "student_exited";

      if (conceptUnitSession) {
        row.concept_unit_id = conceptUnitSession.concept_unit.concept_unit_public_id;
        row.concept_unit_title = conceptUnitSession.concept_unit.title;
        row.concept_unit_order = conceptUnitSession.concept_unit.order_index;
        row.concept_unit_status = conceptUnitSession.status;
        row.concept_unit_version = conceptUnitSession.concept_unit.version;
        row.initial_started_at = iso(conceptUnitSession.initial_started_at);
        row.initial_completed_at = iso(conceptUnitSession.initial_completed_at);
        row.followup_started_at = iso(conceptUnitSession.followup_started_at);
        row.followup_completed_at = iso(conceptUnitSession.followup_completed_at);
        row.followup_status = conceptUnitSession.followup_status;
        row.followup_round_count = conceptUnitSession.followup_round_count;
        row.completed_initial_item_set = Boolean(conceptUnitSession.initial_completed_at);
        row.completed_followup =
          conceptUnitSession.followup_status === "completed" ||
          Boolean(conceptUnitSession.followup_completed_at);
      }

      Object.assign(row, aggregates);
      row.initial_free_text_student_message_count = initialTurns.filter((turn) => {
        const payload = asRecord(turn.structured_payload);
        return turn.actor_type === "student" && payload.source === "initial_free_text";
      }).length;
      Object.assign(row, sessionCompletion, sessionWorkflowFields);
      row.initial_conversation_transcript_text = transcriptText(initialTurns);
      row.followup_conversation_transcript_text = transcriptText(followupTurns);
      row.full_conversation_transcript_text = transcriptText(turns);
      row.conversation_turns_json = options.include_raw_json_columns
        ? stableJson(turns.map((turn) => stripInternalKeys(turn)))
        : "";
      row.process_events_json = options.include_raw_json_columns
        ? stableJson(processEvents.map((event) => stripInternalKeys(event)))
        : "";
      row.response_packages_json = options.include_raw_json_columns
        ? stableJson(responsePackages.map((responsePackage) => stripInternalKeys(responsePackage)))
        : "";
      Object.assign(
        row,
        profiles,
        formatives,
        followupRounds,
        updateCycles,
        progressions,
        agents,
        sessionOutcomeFields
      );

      return row;
    };

    if (sortedConceptUnitSessions.length === 0) {
      const row = makeBaseRow("session_without_item_response");
      row.record_key = [
        row.row_type,
        session.user.user_id,
        session.assessment.assessment_public_id,
        session.session_public_id,
        "no_concept_unit",
        "no_item"
      ].join(":");
      rows.push(row);
      continue;
    }

    for (const conceptUnitSession of sortedConceptUnitSessions) {
      const itemResponses = [...conceptUnitSession.item_responses].sort(
        (left, right) =>
          left.item.item_order - right.item.item_order ||
          left.created_at.getTime() - right.created_at.getTime()
      );

      if (itemResponses.length === 0) {
        const row = makeBaseRow("concept_unit_without_item_response", conceptUnitSession);
        row.record_key = [
          row.row_type,
          session.user.user_id,
          session.assessment.assessment_public_id,
          session.session_public_id,
          conceptUnitSession.concept_unit.concept_unit_public_id,
          "no_item"
        ].join(":");
        rows.push(row);
        continue;
      }

      for (const response of itemResponses) {
        const row = makeBaseRow("item_response", conceptUnitSession);
        const itemStem = snapshotField(response.item_snapshot, "item_stem", response.item.item_stem);
        const optionsSnapshot = snapshotField(response.item_snapshot, "options", response.item.options);

        row.record_key = [
          row.row_type,
          session.user.user_id,
          session.assessment.assessment_public_id,
          session.session_public_id,
          conceptUnitSession.concept_unit.concept_unit_public_id,
          response.item.item_public_id
        ].join(":");
        row.item_id = response.item.item_public_id;
        row.item_order = response.item.item_order;
        row.item_stem = typeof itemStem === "string" ? itemStem : String(itemStem ?? "");
        row.item_version_snapshot = response.item_version_snapshot;
        row.options_snapshot_json = stableJson(optionsSnapshot);
        row.selected_option = response.selected_option ?? "";
        row.correct_option = response.correct_option_snapshot;
        row.correctness = response.correctness;
        row.reasoning_text = response.reasoning_text ?? "";
        row.confidence_rating = response.confidence_rating ?? "";
        row.item_response_time_ms = response.item_response_time_ms ?? "";
        row.item_started_at = iso(response.item_started_at);
        row.item_submitted_at = iso(response.item_submitted_at);
        row.skipped_item = response.skipped_item;
        row.skipped_reasoning = response.skipped_reasoning;
        row.skipped_confidence = response.skipped_confidence;
        row.revision_count = response.revision_count;
        row.missing_evidence_repair_offered = response.missing_evidence_repair_offered;
        row.response_finalized = Boolean(response.item_submitted_at);
        rows.push(row);
      }
    }
  }

  return rows;
}

function serializeExportJob(job: {
  export_public_id: string;
  status: string;
  file_name: string | null;
  row_count: number | null;
  options: unknown;
  export_schema_version: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  error_message: string | null;
}) {
  return {
    export_public_id: job.export_public_id,
    status: job.status,
    file_name: job.file_name,
    row_count: job.row_count,
    options: stripInternalKeys(job.options),
    export_schema_version: job.export_schema_version,
    created_at: iso(job.created_at),
    completed_at: iso(job.completed_at),
    expires_at: iso(job.expires_at),
    error_message: job.error_message,
    download_url:
      job.status === "completed"
        ? `/api/teacher/export/${job.export_public_id}/download`
        : null
  };
}

export async function createMasterCsvExport(input: {
  teacher_user_db_id: string;
  data: unknown;
}) {
  const options = masterExportOptionsSchema.parse(input.data ?? {});
  const exportPublicId = generatePublicId("export");
  const fileName = "master_assessment_export.csv";
  const storageKey = storageKeyForExport(exportPublicId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const job = await prisma.exportJob.create({
    data: {
      id: crypto.randomUUID(),
      export_public_id: exportPublicId,
      requested_by_user_db_id: input.teacher_user_db_id,
      status: "pending",
      file_name: fileName,
      storage_key: storageKey,
      row_count: 0,
      options: options as Prisma.InputJsonObject,
      export_schema_version: MASTER_EXPORT_SCHEMA_VERSION,
      expires_at: expiresAt
    }
  });

  try {
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: "processing" }
    });

    const rows = await buildMasterExportRows(options);
    const csv = serializeMasterCsv(rows, {
      spreadsheet_safe_text: options.spreadsheet_safe_text
    });

    await writeExportFile(storageKey, csv);

    const completed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        row_count: rows.length,
        completed_at: new Date()
      }
    });

    return serializeExportJob(completed);
  } catch (error) {
    const failed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date()
      }
    });

    return serializeExportJob(failed);
  }
}

export async function listExportJobs() {
  const jobs = await prisma.exportJob.findMany({
    orderBy: { created_at: "desc" },
    take: 100
  });

  return {
    export_jobs: jobs.map(serializeExportJob)
  };
}

export async function getExportJob(exportPublicId: string) {
  const job = await prisma.exportJob.findUnique({
    where: { export_public_id: exportPublicId }
  });

  if (!job) {
    throw new MasterExportServiceError("not_found", "Export job was not found.", 404, {
      export_public_id: exportPublicId
    });
  }

  return serializeExportJob(job);
}

export async function getExportDownload(exportPublicId: string) {
  const job = await prisma.exportJob.findUnique({
    where: { export_public_id: exportPublicId }
  });

  if (!job) {
    throw new MasterExportServiceError("not_found", "Export job was not found.", 404, {
      export_public_id: exportPublicId
    });
  }

  if (job.status !== "completed" || !job.storage_key || !job.file_name) {
    throw new MasterExportServiceError(
      "export_not_available",
      "Export file is not available for download.",
      409,
      { status: job.status }
    );
  }

  return {
    file_name: job.file_name,
    bytes: await readExportFile(job.storage_key)
  };
}
