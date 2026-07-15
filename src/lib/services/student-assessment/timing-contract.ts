export const TIMING_CONTRACT_VERSION = "timing-contract-v2" as const;
export const TIMING_SOURCE_VERSION = "student-assessment-timing-source-v2" as const;

export type TimingQualityStatus =
  | "valid"
  | "partial"
  | "missing_start"
  | "missing_end"
  | "invalid_order"
  | "legacy_ambiguous"
  | "instrumentation_insufficient";

export type TimingEventLike = {
  event_type: string;
  event_category?: string | null;
  event_source?: string | null;
  occurred_at?: Date | string | null;
  created_at?: Date | string | null;
  visibility_duration_ms?: number | null;
  pause_duration_ms?: number | null;
  payload?: unknown;
};

export type DerivedItemTiming = {
  item_presented_at: Date | null;
  first_student_action_at: Date | null;
  first_option_selected_at: Date | null;
  reasoning_prompted_at: Date | null;
  reasoning_started_at: Date | null;
  reasoning_submitted_at: Date | null;
  confidence_prompted_at: Date | null;
  confidence_selected_at: Date | null;
  tempting_option_prompted_at: Date | null;
  tempting_option_submitted_at: Date | null;
  item_submitted_at: Date | null;
  last_student_action_at: Date | null;
  item_elapsed_response_time_ms: number | null;
  time_to_first_response_action_ms: number | null;
  time_to_first_option_selection_ms: number | null;
  post_option_completion_time_ms: number | null;
  reasoning_elapsed_time_ms: number | null;
  reasoning_active_typing_time_ms: number | null;
  reasoning_input_elapsed_time_ms: number | null;
  confidence_response_time_ms: number | null;
  tempting_option_response_time_ms: number | null;
  last_action_to_submission_ms: number | null;
  legacy_item_response_time_ms: number | null;
  timing_contract_version: typeof TIMING_CONTRACT_VERSION;
  timing_source_version: typeof TIMING_SOURCE_VERSION;
  timing_quality_status: TimingQualityStatus;
  timing_limitations: string[];
  instrumentation_complete: boolean;
};

export type VisibilityInterval = {
  start_at: Date;
  end_at: Date | null;
  duration_ms: number | null;
  quality_status: TimingQualityStatus;
  limitation: string | null;
};

export type DerivedSessionTiming = {
  session_wall_clock_elapsed_ms: number | null;
  session_resumable_active_window_ms: number | null;
  session_visible_window_ms: number | null;
  session_active_interaction_time_ms: number | null;
  session_idle_time_ms: number | null;
  total_page_hidden_ms: number | null;
  page_hidden_interval_count: number;
  page_hidden_timing_quality_status: TimingQualityStatus;
  visibility_intervals: VisibilityInterval[];
  timing_contract_version: typeof TIMING_CONTRACT_VERSION;
  timing_source_version: typeof TIMING_SOURCE_VERSION;
  timing_quality_status: TimingQualityStatus;
  timing_limitations: string[];
  instrumentation_complete: boolean;
};

const QUALIFYING_FIRST_ACTION_TYPES = [
  "option_selected",
  "option_clicked",
  "transfer_answer_selected",
  "reasoning_entered",
  "reasoning_submitted",
  "transfer_reasoning_submitted",
  "confidence_selected",
  "confidence_clicked",
  "transfer_confidence_clicked",
  "tempting_option_submitted",
  "transfer_tempting_option_submitted",
  "tempting_option_reason_submitted",
  "transfer_tempting_option_reason_submitted"
] as const;

const FIRST_OPTION_TYPES = ["option_selected", "option_clicked", "transfer_answer_selected"] as const;
const REASONING_SUBMISSION_TYPES = ["reasoning_entered", "reasoning_submitted", "transfer_reasoning_submitted"] as const;
const CONFIDENCE_SELECTION_TYPES = ["confidence_selected", "confidence_clicked", "transfer_confidence_clicked"] as const;
const TEMPTING_SUBMISSION_TYPES = [
  "tempting_option_submitted",
  "transfer_tempting_option_submitted",
  "tempting_option_reason_submitted",
  "transfer_tempting_option_reason_submitted"
] as const;
const ITEM_PRESENTED_TYPES = ["item_presented", "transfer_item_presented"] as const;
const ITEM_SUBMITTED_TYPES = ["item_submitted", "item_completed", "transfer_item_completed"] as const;
const HIDDEN_TYPES = ["page_visibility_hidden", "page_hidden"] as const;
const VISIBLE_TYPES = ["page_visibility_visible", "page_visible"] as const;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function eventTimestamp(event: TimingEventLike | null | undefined): Date | null {
  if (!event) return null;
  const payload = recordValue(event.payload);
  const client = asDate(typeof payload.client_occurred_at === "string" ? payload.client_occurred_at : null);
  return client ?? asDate(event.occurred_at ?? null) ?? asDate(event.created_at ?? null);
}

function dateMs(value: Date | null | undefined): number | null {
  return value ? value.getTime() : null;
}

function diffMs(start: Date | null, end: Date | null): number | null {
  const startMs = dateMs(start);
  const endMs = dateMs(end);
  if (startMs === null || endMs === null) return null;
  if (endMs < startMs) return null;
  return endMs - startMs;
}

function firstEvent(events: TimingEventLike[], types: readonly string[]) {
  const typeSet = new Set(types);
  return events.find((event) => typeSet.has(event.event_type)) ?? null;
}

function lastEvent(events: TimingEventLike[], types: readonly string[]) {
  const typeSet = new Set(types);
  return [...events].reverse().find((event) => typeSet.has(event.event_type)) ?? null;
}

function firstPromptEvent(events: TimingEventLike[], promptType: string) {
  return (
    events.find((event) => {
      if (event.event_type !== "agent_message_shown") return false;
      const payload = recordValue(event.payload);
      return payload.prompt_type === promptType || payload.message_type === promptType;
    }) ?? null
  );
}

function payloadNumber(payload: unknown, keys: string[]) {
  const record = recordValue(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function qualityForRequiredDiff(start: Date | null, end: Date | null, value: number | null): TimingQualityStatus {
  if (!start && !end) return "partial";
  if (!start) return "missing_start";
  if (!end) return "missing_end";
  return value === null ? "invalid_order" : "valid";
}

function mergeQuality(statuses: TimingQualityStatus[]): TimingQualityStatus {
  if (statuses.includes("invalid_order")) return "invalid_order";
  if (statuses.includes("missing_start") || statuses.includes("missing_end")) return "partial";
  if (statuses.includes("instrumentation_insufficient")) return "partial";
  return statuses.every((status) => status === "valid") ? "valid" : "partial";
}

function pushMissing(limitations: string[], condition: boolean, code: string) {
  if (condition && !limitations.includes(code)) limitations.push(code);
}

export function deriveItemTiming(input: {
  events: TimingEventLike[];
  item_started_at?: Date | null;
  item_submitted_at?: Date | null;
  persisted_item_response_time_ms?: number | null;
  derived_at?: Date;
}): DerivedItemTiming {
  const events = [...input.events].sort((a, b) => {
    const left = eventTimestamp(a)?.getTime() ?? 0;
    const right = eventTimestamp(b)?.getTime() ?? 0;
    return left - right;
  });
  const itemPresented = firstEvent(events, ITEM_PRESENTED_TYPES);
  const itemSubmittedEvent = lastEvent(events, ITEM_SUBMITTED_TYPES);
  const firstAction = firstEvent(events, QUALIFYING_FIRST_ACTION_TYPES);
  const firstOption = firstEvent(events, FIRST_OPTION_TYPES);
  const reasoningPrompt = firstPromptEvent(events, "request_reasoning") ?? firstPromptEvent(events, "reasoning_prompt");
  const confidencePrompt = firstPromptEvent(events, "request_confidence") ?? firstPromptEvent(events, "confidence_prompt");
  const temptingPrompt =
    firstPromptEvent(events, "request_tempting_option") ??
    firstPromptEvent(events, "request_tempting_reason") ??
    firstPromptEvent(events, "tempting_option_prompt");
  const reasoningSubmitted = firstEvent(events, REASONING_SUBMISSION_TYPES);
  const confidenceSelected = firstEvent(events, CONFIDENCE_SELECTION_TYPES);
  const temptingSubmitted = firstEvent(events, TEMPTING_SUBMISSION_TYPES);
  const lastAction = lastEvent(events, QUALIFYING_FIRST_ACTION_TYPES);
  const typingSummary = firstEvent(events, ["typing_activity_summary"]);

  const item_presented_at = eventTimestamp(itemPresented) ?? null;
  const item_submitted_at = input.item_submitted_at ?? eventTimestamp(itemSubmittedEvent) ?? null;
  const first_student_action_at = eventTimestamp(firstAction);
  const first_option_selected_at = eventTimestamp(firstOption);
  const reasoning_prompted_at = eventTimestamp(reasoningPrompt);
  const reasoning_started_at = eventTimestamp(firstEvent(events, ["reasoning_started", "reasoning_entered"]));
  const reasoning_submitted_at = eventTimestamp(reasoningSubmitted);
  const confidence_prompted_at = eventTimestamp(confidencePrompt);
  const confidence_selected_at = eventTimestamp(confidenceSelected);
  const tempting_option_prompted_at = eventTimestamp(temptingPrompt);
  const tempting_option_submitted_at = eventTimestamp(temptingSubmitted);
  const last_student_action_at = eventTimestamp(lastAction);

  const item_elapsed_response_time_ms = diffMs(item_presented_at, item_submitted_at);
  const time_to_first_response_action_ms = diffMs(item_presented_at, first_student_action_at);
  const time_to_first_option_selection_ms = diffMs(item_presented_at, first_option_selected_at);
  const post_option_completion_time_ms = diffMs(first_option_selected_at, item_submitted_at);
  const reasoning_elapsed_time_ms = diffMs(reasoning_prompted_at, reasoning_submitted_at);
  const confidence_response_time_ms = diffMs(confidence_prompted_at, confidence_selected_at);
  const tempting_option_response_time_ms = diffMs(tempting_option_prompted_at, tempting_option_submitted_at);
  const last_action_to_submission_ms = diffMs(last_student_action_at, item_submitted_at);
  const reasoning_active_typing_time_ms = payloadNumber(typingSummary?.payload, ["active_typing_time_ms"]);
  const reasoning_input_elapsed_time_ms = payloadNumber(typingSummary?.payload, [
    "reasoning_input_elapsed_time_ms",
    "typing_duration_ms"
  ]);

  const limitations: string[] = [];
  pushMissing(limitations, !item_presented_at, "item_presented_event_missing");
  pushMissing(limitations, !item_submitted_at, "item_submitted_timestamp_missing");
  pushMissing(limitations, !first_student_action_at, "first_student_action_missing");
  pushMissing(limitations, !first_option_selected_at, "first_option_selection_missing");
  pushMissing(limitations, !reasoning_prompted_at || !reasoning_submitted_at, "reasoning_prompt_or_submission_missing");
  pushMissing(limitations, reasoning_active_typing_time_ms === null, "active_typing_time_unavailable");
  if (
    item_elapsed_response_time_ms === null ||
    time_to_first_response_action_ms === null ||
    time_to_first_option_selection_ms === null ||
    reasoning_elapsed_time_ms === null
  ) {
    pushMissing(limitations, true, "one_or_more_core_timing_intervals_unavailable");
  }

  const timing_quality_status = mergeQuality([
    qualityForRequiredDiff(item_presented_at, item_submitted_at, item_elapsed_response_time_ms),
    qualityForRequiredDiff(item_presented_at, first_student_action_at, time_to_first_response_action_ms),
    qualityForRequiredDiff(item_presented_at, first_option_selected_at, time_to_first_option_selection_ms),
    reasoning_active_typing_time_ms === null ? "instrumentation_insufficient" : "valid"
  ]);

  return {
    item_presented_at,
    first_student_action_at,
    first_option_selected_at,
    reasoning_prompted_at,
    reasoning_started_at,
    reasoning_submitted_at,
    confidence_prompted_at,
    confidence_selected_at,
    tempting_option_prompted_at,
    tempting_option_submitted_at,
    item_submitted_at,
    last_student_action_at,
    item_elapsed_response_time_ms,
    time_to_first_response_action_ms,
    time_to_first_option_selection_ms,
    post_option_completion_time_ms,
    reasoning_elapsed_time_ms,
    reasoning_active_typing_time_ms,
    reasoning_input_elapsed_time_ms,
    confidence_response_time_ms,
    tempting_option_response_time_ms,
    last_action_to_submission_ms,
    legacy_item_response_time_ms: input.persisted_item_response_time_ms ?? null,
    timing_contract_version: TIMING_CONTRACT_VERSION,
    timing_source_version: TIMING_SOURCE_VERSION,
    timing_quality_status,
    timing_limitations: limitations,
    instrumentation_complete: timing_quality_status === "valid"
  };
}

export function deriveVisibilityIntervals(events: TimingEventLike[]): VisibilityInterval[] {
  const sorted = [...events].sort((a, b) => {
    const left = eventTimestamp(a)?.getTime() ?? 0;
    const right = eventTimestamp(b)?.getTime() ?? 0;
    return left - right;
  });
  const intervals: VisibilityInterval[] = [];
  let open: Date | null = null;

  for (const event of sorted) {
    const timestamp = eventTimestamp(event);
    if (!timestamp) continue;
    if (HIDDEN_TYPES.includes(event.event_type as (typeof HIDDEN_TYPES)[number])) {
      if (open) {
        intervals.push({
          start_at: open,
          end_at: null,
          duration_ms: null,
          quality_status: "invalid_order",
          limitation: "duplicate_hidden_without_visible"
        });
      }
      open = timestamp;
    } else if (VISIBLE_TYPES.includes(event.event_type as (typeof VISIBLE_TYPES)[number])) {
      if (!open) {
        intervals.push({
          start_at: timestamp,
          end_at: timestamp,
          duration_ms: null,
          quality_status: "missing_start",
          limitation: "visible_without_hidden"
        });
        continue;
      }
      const duration = diffMs(open, timestamp);
      intervals.push({
        start_at: open,
        end_at: timestamp,
        duration_ms: duration,
        quality_status: duration === null ? "invalid_order" : "valid",
        limitation: duration === null ? "visible_before_hidden" : null
      });
      open = null;
    }
  }

  if (open) {
    intervals.push({
      start_at: open,
      end_at: null,
      duration_ms: null,
      quality_status: "missing_end",
      limitation: "hidden_without_visible"
    });
  }

  return intervals;
}

function sumDurations(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numeric.length ? numeric.reduce((total, value) => total + value, 0) : null;
}

export function deriveSessionTiming(input: {
  session_started_at?: Date | null;
  session_completed_at?: Date | null;
  last_activity_at?: Date | null;
  updated_at?: Date | null;
  events: TimingEventLike[];
}): DerivedSessionTiming {
  const start = input.session_started_at ?? eventTimestamp(firstEvent(input.events, ["attempt_started", "session_started"]));
  const end =
    input.session_completed_at ??
    eventTimestamp(lastEvent(input.events, ["assessment_completed", "session_completed", "attempt_ended_by_student", "attempt_ended_by_teacher"])) ??
    input.last_activity_at ??
    input.updated_at ??
    null;
  const session_wall_clock_elapsed_ms = diffMs(start ?? null, end ?? null);
  const events = [...input.events].sort((a, b) => {
    const left = eventTimestamp(a)?.getTime() ?? 0;
    const right = eventTimestamp(b)?.getTime() ?? 0;
    return left - right;
  });
  const activeIntervals: Array<{ start: Date; end: Date }> = [];
  let activeStart = start ?? null;

  for (const event of events) {
    const timestamp = eventTimestamp(event);
    if (!timestamp) continue;
    if (["attempt_started", "session_started", "attempt_resumed", "session_resumed"].includes(event.event_type)) {
      if (!activeStart) activeStart = timestamp;
    }
    if (["attempt_paused", "session_paused", "session_exited"].includes(event.event_type)) {
      if (activeStart && timestamp >= activeStart) activeIntervals.push({ start: activeStart, end: timestamp });
      activeStart = null;
    }
    if (["attempt_ended_by_student", "attempt_ended_by_teacher", "assessment_completed", "session_completed"].includes(event.event_type)) {
      if (activeStart && timestamp >= activeStart) activeIntervals.push({ start: activeStart, end: timestamp });
      activeStart = null;
    }
  }
  if (activeStart && end && end >= activeStart) {
    activeIntervals.push({ start: activeStart, end });
  }
  const activeDurations = activeIntervals.map((interval) => diffMs(interval.start, interval.end));
  const session_resumable_active_window_ms = sumDurations(activeDurations) ?? session_wall_clock_elapsed_ms;
  const visibility_intervals = deriveVisibilityIntervals(events);
  const total_page_hidden_ms = sumDurations(visibility_intervals.map((interval) => interval.duration_ms));
  const session_visible_window_ms =
    session_resumable_active_window_ms === null
      ? null
      : Math.max(0, session_resumable_active_window_ms - (total_page_hidden_ms ?? 0));
  const idleEvents = events.filter((event) => ["long_pause", "inactivity_detected"].includes(event.event_type));
  const session_idle_time_ms = sumDurations(
    idleEvents.map((event) => event.pause_duration_ms ?? payloadNumber(event.payload, ["pause_duration_ms", "duration_ms"]))
  );
  const session_active_interaction_time_ms = null;
  const limitations: string[] = [];
  pushMissing(limitations, !start, "session_start_missing");
  pushMissing(limitations, !end, "session_end_or_latest_activity_missing");
  pushMissing(limitations, visibility_intervals.some((interval) => interval.quality_status !== "valid"), "visibility_interval_pairing_incomplete");
  pushMissing(limitations, session_active_interaction_time_ms === null, "active_interaction_interval_instrumentation_unavailable");
  const timing_quality_status = mergeQuality([
    qualityForRequiredDiff(start ?? null, end ?? null, session_wall_clock_elapsed_ms),
    visibility_intervals.some((interval) => interval.quality_status === "invalid_order")
      ? "invalid_order"
      : visibility_intervals.some((interval) => interval.quality_status !== "valid")
        ? "partial"
        : "valid"
  ]);

  return {
    session_wall_clock_elapsed_ms,
    session_resumable_active_window_ms,
    session_visible_window_ms,
    session_active_interaction_time_ms,
    session_idle_time_ms,
    total_page_hidden_ms,
    page_hidden_interval_count: visibility_intervals.filter((interval) => interval.quality_status === "valid").length,
    page_hidden_timing_quality_status:
      visibility_intervals.length === 0
        ? "partial"
        : visibility_intervals.every((interval) => interval.quality_status === "valid")
          ? "valid"
          : "partial",
    visibility_intervals,
    timing_contract_version: TIMING_CONTRACT_VERSION,
    timing_source_version: TIMING_SOURCE_VERSION,
    timing_quality_status,
    timing_limitations: limitations,
    instrumentation_complete: timing_quality_status === "valid" && session_active_interaction_time_ms !== null
  };
}

export function timingLimitationsText(limitations: string[]) {
  return limitations.length ? limitations.join("|") : "";
}
