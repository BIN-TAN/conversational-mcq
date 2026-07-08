import { asRecord } from "./serializers";

export type EngagementProcessItemResponse = {
  session_public_id: string;
  student_user_id: string;
  assessment_public_id: string;
  concept_unit_public_id: string | null;
  item_public_id: string | null;
  item_order: number | null;
  item_started_at: Date | string | null;
  item_submitted_at: Date | string | null;
  item_response_time_ms: number | null;
  revision_count: number | null;
};

export type EngagementProcessEvent = {
  session_public_id: string;
  concept_unit_public_id: string | null;
  item_public_id: string | null;
  item_order: number | null;
  event_type: string;
  event_category: string;
  event_source: string;
  visibility_duration_ms: number | null;
  pause_duration_ms: number | null;
  payload: unknown;
  occurred_at: Date | string | null;
  created_at: Date | string | null;
};

export type EngagementProcessFeatureRow = {
  session_public_id: string;
  student_user_id: string;
  assessment_public_id: string;
  concept_unit_public_id: string | null;
  item_public_id: string | null;
  item_order: number | null;
  feature_scope: "initial_item" | "activity" | "session";
  time_to_first_action_ms: number | null;
  first_action_to_submission_ms: number | null;
  last_action_to_submission_ms: number | null;
  prompt_to_final_submission_ms: number | null;
  active_interaction_time_ms: number | null;
  idle_time_ms: number | null;
  idle_ratio: number | null;
  focus_adjusted_time_ms: number | null;
  confidence_selection_latency_ms: number | null;
  reasoning_input_elapsed_time_ms: number | null;
  active_typing_time_ms: number | null;
  pre_submit_pause_ms: number | null;
  activity_prompt_to_first_action_ms: number | null;
  activity_response_elapsed_ms: number | null;
  activity_move_on_latency_ms: number | null;
  choose_another_activity_latency_ms: number | null;
  student_action_count: number;
  substantive_action_count: number;
  action_density_per_minute: number | null;
  option_revision_count: number;
  option_changed_after_reasoning: boolean | null;
  reasoning_revision_count: number;
  confidence_revision_count: number;
  copy_paste_event_count: number;
  typed_vs_paste_indicator:
    | "typed_only"
    | "paste_observed"
    | "typed_and_paste_observed"
    | "no_typing_or_paste_events"
    | "unavailable";
  limitations: string[];
};

const PROMPT_EVENT_TYPES = new Set([
  "agent_message_shown",
  "item_presented",
  "formative_activity_started",
  "formative_activity_prompt_shown",
  "activity_prompt_shown"
]);

const STUDENT_ACTION_EVENT_TYPES = new Set([
  "option_clicked",
  "option_selected",
  "answer_changed",
  "reasoning_started",
  "reasoning_entered",
  "reasoning_revised",
  "reasoning_submitted",
  "confidence_clicked",
  "confidence_selected",
  "tempting_option_submitted",
  "tempting_option_reason_submitted",
  "student_response_edit_started",
  "student_response_edit_submitted",
  "reasoning_edited",
  "confidence_changed",
  "tempting_option_changed",
  "idk_selected",
  "invalid_help_request",
  "procedural_clarification_request",
  "content_question_deferred",
  "formative_activity_response_submitted",
  "activity_response_submitted",
  "activity_choice_submitted",
  "activity_turn_submitted",
  "next_choice_submitted",
  "move_next_requested",
  "choose_another_activity",
  "activity_move_on_requested",
  "move_on_requested",
  "transfer_item_submitted",
  "revision_submitted",
  "followup_turn_completed"
]);

const SUBSTANTIVE_ACTION_EVENT_TYPES = new Set([
  "option_clicked",
  "option_selected",
  "answer_changed",
  "reasoning_entered",
  "reasoning_revised",
  "reasoning_submitted",
  "confidence_clicked",
  "confidence_selected",
  "tempting_option_submitted",
  "tempting_option_reason_submitted",
  "student_response_edit_submitted",
  "reasoning_edited",
  "confidence_changed",
  "tempting_option_changed",
  "idk_selected",
  "formative_activity_response_submitted",
  "activity_response_submitted",
  "activity_choice_submitted",
  "activity_turn_submitted",
  "next_choice_submitted",
  "move_next_requested",
  "activity_move_on_requested",
  "move_on_requested",
  "transfer_item_submitted",
  "revision_submitted"
]);

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestamp(value: Date | string | null | undefined) {
  const serialized = iso(value);
  return serialized ? new Date(serialized).getTime() : null;
}

function eventTime(event: EngagementProcessEvent) {
  return timestamp(event.occurred_at) ?? timestamp(event.created_at);
}

function nonnegativeDiff(start: number | null, end: number | null) {
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
}

function sumNullable(values: Array<number | null | undefined>) {
  const available = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return available.length > 0 ? available.reduce((total, value) => total + value, 0) : null;
}

function eventPayloadNumber(event: EngagementProcessEvent, keys: string[]) {
  const payload = asRecord(event.payload);
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.round(value);
    }
  }
  return null;
}

function sortedEvents(events: EngagementProcessEvent[]) {
  return [...events].sort((left, right) => (eventTime(left) ?? 0) - (eventTime(right) ?? 0));
}

function isStudentAction(event: EngagementProcessEvent) {
  return (
    STUDENT_ACTION_EVENT_TYPES.has(event.event_type) ||
    event.event_category === "student_response"
  );
}

function isSubstantiveAction(event: EngagementProcessEvent) {
  return SUBSTANTIVE_ACTION_EVENT_TYPES.has(event.event_type);
}

function firstEventTime(events: EngagementProcessEvent[], predicate: (event: EngagementProcessEvent) => boolean) {
  const event = events.find(predicate);
  return event ? eventTime(event) : null;
}

function lastEventTime(events: EngagementProcessEvent[], predicate: (event: EngagementProcessEvent) => boolean) {
  const event = [...events].reverse().find(predicate);
  return event ? eventTime(event) : null;
}

function actionDensity(count: number, durationMs: number | null) {
  if (durationMs === null || durationMs <= 0) return null;
  return Number((count / (durationMs / 60_000)).toFixed(3));
}

function idleRatio(idleMs: number | null, totalMs: number | null) {
  if (idleMs === null || totalMs === null || totalMs <= 0) return null;
  return Number(Math.min(1, idleMs / totalMs).toFixed(4));
}

function typedVsPaste(input: { typingCount: number; pasteCount: number }) {
  if (input.typingCount > 0 && input.pasteCount > 0) return "typed_and_paste_observed" as const;
  if (input.typingCount > 0) return "typed_only" as const;
  if (input.pasteCount > 0) return "paste_observed" as const;
  return "no_typing_or_paste_events" as const;
}

function safeCount(events: EngagementProcessEvent[], types: string[]) {
  const set = new Set(types);
  return events.filter((event) => set.has(event.event_type)).length;
}

function buildItemRow(input: {
  response: EngagementProcessItemResponse;
  events: EngagementProcessEvent[];
}): EngagementProcessFeatureRow {
  const events = sortedEvents(input.events);
  const promptTime =
    firstEventTime(events, (event) => PROMPT_EVENT_TYPES.has(event.event_type)) ??
    timestamp(input.response.item_started_at);
  const finalSubmissionTime =
    lastEventTime(events, (event) => event.event_type === "item_completed" || event.event_type === "item_submitted") ??
    timestamp(input.response.item_submitted_at);
  const firstActionTime = firstEventTime(events, isStudentAction);
  const lastActionTime = lastEventTime(events, isSubstantiveAction);
  const totalMs =
    nonnegativeDiff(promptTime, finalSubmissionTime) ??
    (typeof input.response.item_response_time_ms === "number" ? input.response.item_response_time_ms : null);
  const idleMs = sumNullable(events.map((event) => event.pause_duration_ms));
  const hiddenMs = sumNullable(events.map((event) => event.visibility_duration_ms));
  const focusAdjustedMs =
    totalMs !== null && (idleMs !== null || hiddenMs !== null)
      ? Math.max(0, totalMs - (idleMs ?? 0) - (hiddenMs ?? 0))
      : null;
  const reasoningElapsedMs = sumNullable(
    events
      .filter((event) => event.event_type === "typing_activity_summary")
      .map((event) =>
        eventPayloadNumber(event, [
          "reasoning_input_elapsed_time_ms",
          "typing_duration_ms",
          "duration_ms"
        ])
      )
  );
  const confidenceEventTime = firstEventTime(events, (event) =>
    event.event_type === "confidence_selected" || event.event_type === "confidence_clicked"
  );
  const studentActionCount = events.filter(isStudentAction).length;
  const substantiveActionCount = events.filter(isSubstantiveAction).length;
  const typingCount = safeCount(events, ["typing_activity_summary"]);
  const pasteCount = safeCount(events, ["paste_detected"]);
  const reasoningFirstTime = firstEventTime(events, (event) =>
    event.event_type === "reasoning_entered" ||
    event.event_type === "reasoning_started" ||
    event.event_type === "reasoning_submitted"
  );
  const optionRevisionEvents = events.filter((event) =>
    event.event_type === "answer_changed" || event.event_type === "option_revision"
  );
  const limitations = [
    promptTime === null && "item_prompt_timestamp_unavailable",
    finalSubmissionTime === null && "item_final_submission_timestamp_unavailable",
    firstActionTime === null && "first_student_action_timestamp_unavailable",
    idleMs === null && "idle_time_events_unavailable",
    focusAdjustedMs === null && "focus_adjusted_time_unavailable",
    reasoningElapsedMs === null && "reasoning_input_elapsed_time_unavailable",
    "active_interaction_time_requires_active-interval_instrumentation",
    "process_features_are_evidence_quality_context_not_ability_or_misconduct_labels"
  ].filter((value): value is string => Boolean(value));

  return {
    session_public_id: input.response.session_public_id,
    student_user_id: input.response.student_user_id,
    assessment_public_id: input.response.assessment_public_id,
    concept_unit_public_id: input.response.concept_unit_public_id,
    item_public_id: input.response.item_public_id,
    item_order: input.response.item_order,
    feature_scope: "initial_item",
    time_to_first_action_ms: nonnegativeDiff(promptTime, firstActionTime),
    first_action_to_submission_ms: nonnegativeDiff(firstActionTime, finalSubmissionTime),
    last_action_to_submission_ms: nonnegativeDiff(lastActionTime, finalSubmissionTime),
    prompt_to_final_submission_ms: totalMs,
    active_interaction_time_ms: null,
    idle_time_ms: idleMs,
    idle_ratio: idleRatio(idleMs, totalMs),
    focus_adjusted_time_ms: focusAdjustedMs,
    confidence_selection_latency_ms: nonnegativeDiff(promptTime, confidenceEventTime),
    reasoning_input_elapsed_time_ms: reasoningElapsedMs,
    active_typing_time_ms: null,
    pre_submit_pause_ms: nonnegativeDiff(lastActionTime, finalSubmissionTime),
    activity_prompt_to_first_action_ms: null,
    activity_response_elapsed_ms: null,
    activity_move_on_latency_ms: null,
    choose_another_activity_latency_ms: null,
    student_action_count: studentActionCount,
    substantive_action_count: substantiveActionCount,
    action_density_per_minute: actionDensity(substantiveActionCount, totalMs),
    option_revision_count: optionRevisionEvents.length,
    option_changed_after_reasoning:
      optionRevisionEvents.length === 0 || reasoningFirstTime === null
        ? optionRevisionEvents.length === 0 ? false : null
        : optionRevisionEvents.some((event) => {
            const time = eventTime(event);
            return time !== null && time > reasoningFirstTime;
          }),
    reasoning_revision_count:
      safeCount(events, ["reasoning_revised", "reasoning_edited"]) +
      Math.max(0, (input.response.revision_count ?? 0) - 1),
    confidence_revision_count: safeCount(events, ["confidence_changed"]),
    copy_paste_event_count: pasteCount,
    typed_vs_paste_indicator: typedVsPaste({ typingCount, pasteCount }),
    limitations
  };
}

function buildActivityRows(input: {
  session_public_id: string;
  student_user_id: string;
  assessment_public_id: string;
  events: EngagementProcessEvent[];
}): EngagementProcessFeatureRow[] {
  const activityEvents = sortedEvents(input.events.filter((event) =>
    /activity|followup|move_on|choose_another/i.test(event.event_type)
  ));
  if (activityEvents.length === 0) return [];

  const promptTime = firstEventTime(activityEvents, (event) => PROMPT_EVENT_TYPES.has(event.event_type) || /prompt/i.test(event.event_type));
  const firstActionTime = firstEventTime(activityEvents, isStudentAction);
  const responseEndTime = lastEventTime(activityEvents, isSubstantiveAction);
  const moveOnTime = firstEventTime(activityEvents, (event) => /move_on|move_next/i.test(event.event_type));
  const chooseAnotherTime = firstEventTime(activityEvents, (event) => /choose_another/i.test(event.event_type));
  const totalMs = nonnegativeDiff(promptTime, responseEndTime);
  const studentActionCount = activityEvents.filter(isStudentAction).length;
  const substantiveActionCount = activityEvents.filter(isSubstantiveAction).length;
  const pasteCount = safeCount(activityEvents, ["paste_detected"]);
  const typingCount = safeCount(activityEvents, ["typing_activity_summary"]);

  return [{
    session_public_id: input.session_public_id,
    student_user_id: input.student_user_id,
    assessment_public_id: input.assessment_public_id,
    concept_unit_public_id: null,
    item_public_id: null,
    item_order: null,
    feature_scope: "activity",
    time_to_first_action_ms: null,
    first_action_to_submission_ms: null,
    last_action_to_submission_ms: null,
    prompt_to_final_submission_ms: null,
    active_interaction_time_ms: null,
    idle_time_ms: sumNullable(activityEvents.map((event) => event.pause_duration_ms)),
    idle_ratio: idleRatio(sumNullable(activityEvents.map((event) => event.pause_duration_ms)), totalMs),
    focus_adjusted_time_ms: null,
    confidence_selection_latency_ms: null,
    reasoning_input_elapsed_time_ms: null,
    active_typing_time_ms: null,
    pre_submit_pause_ms: null,
    activity_prompt_to_first_action_ms: nonnegativeDiff(promptTime, firstActionTime),
    activity_response_elapsed_ms: totalMs,
    activity_move_on_latency_ms: nonnegativeDiff(promptTime, moveOnTime),
    choose_another_activity_latency_ms: nonnegativeDiff(promptTime, chooseAnotherTime),
    student_action_count: studentActionCount,
    substantive_action_count: substantiveActionCount,
    action_density_per_minute: actionDensity(substantiveActionCount, totalMs),
    option_revision_count: 0,
    option_changed_after_reasoning: null,
    reasoning_revision_count: safeCount(activityEvents, ["reasoning_revised", "reasoning_edited"]),
    confidence_revision_count: safeCount(activityEvents, ["confidence_changed"]),
    copy_paste_event_count: pasteCount,
    typed_vs_paste_indicator: typedVsPaste({ typingCount, pasteCount }),
    limitations: [
      promptTime === null && "activity_prompt_timestamp_unavailable",
      firstActionTime === null && "activity_first_action_timestamp_unavailable",
      "activity_features_are_derived_from_safe_process_event_labels_only",
      "process_features_are_evidence_quality_context_not_ability_or_misconduct_labels"
    ].filter((value): value is string => Boolean(value))
  }];
}

export function buildEngagementProcessFeatureRows(input: {
  itemResponses: EngagementProcessItemResponse[];
  processEvents: EngagementProcessEvent[];
}): EngagementProcessFeatureRow[] {
  const itemRows = input.itemResponses.map((response) =>
    buildItemRow({
      response,
      events: input.processEvents.filter((event) =>
        response.item_public_id
          ? event.item_public_id === response.item_public_id
          : false
      )
    })
  );
  const firstResponse = input.itemResponses[0];
  const activityRows = firstResponse
    ? buildActivityRows({
        session_public_id: firstResponse.session_public_id,
        student_user_id: firstResponse.student_user_id,
        assessment_public_id: firstResponse.assessment_public_id,
        events: input.processEvents
      })
    : [];

  return [...itemRows, ...activityRows];
}
