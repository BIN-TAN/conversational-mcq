import { deriveItemTiming, deriveSessionTiming, type TimingEventLike } from "../student-assessment/timing-contract";
import { deriveResponseStageVisits, summarizeItemStageVisits } from "../student-assessment/response-stage-data";
import { RESPONSE_STAGE_CALCULATION_VERSION } from "../teacher-research-data/response-stage-dictionary";
import { conversationActivityDates, conversationParticipation, derivePauseEpisodes, type ObservedConversation } from "./participation-observations";
import { presentedItemPositions } from "./presented-item-positions";
import { isConfidenceRevisionEvent, isAlternativeRevisionEvent } from "../student-assessment/response-revision-events";

export const PROCESS_DATA_SUMMARY_VERSION = "process-data-summary-v6";

const eventLabels: Record<string, string> = {
  page_visibility_hidden: "Assessment page hidden",
  page_hidden: "Assessment page hidden",
  page_visibility_visible: "Assessment page visible again",
  page_visible: "Assessment page visible again",
  window_blur: "Assessment window lost focus",
  window_focus: "Assessment window regained focus",
  long_pause: "Idle interval detected",
  inactivity_detected: "Extended idle interval detected",
  refresh_recovery: "Assessment page reloaded",
  answer_changed: "Answer revised",
  reasoning_revised: "Explanation revised",
  reasoning_edited: "Explanation revised",
  confidence_changed: "Confidence revised",
  tempting_option_changed: "Alternative answer revised",
  typing_activity_summary: "Typing activity recorded",
  paste_detected: "Paste action recorded",
  package_review_opened: "Responses opened for review",
  package_submitted: "Response package submitted",
  initial_feedback_skipped: "Student continued after AI feedback was unavailable",
  initial_feedback_terminated: "Student ended the attempt after AI feedback failed",
  attempt_paused: "Assessment paused",
  session_paused: "Assessment paused",
  attempt_resumed: "Assessment resumed",
  session_resumed: "Assessment resumed",
  attempt_ended_by_student: "Student ended the assessment",
  attempt_ended_by_teacher: "Teacher ended the assessment",
  session_exited: "Assessment exited",
  session_completed: "Assessment completed",
  item_presented: "Item made available",
  option_clicked: "Answer selected",
  reasoning_submitted: "Explanation submitted",
  confidence_clicked: "Confidence selected",
  item_completed: "Item responses completed",
  package_results_shown: "Answer review partly displayed",
  item_correctness_status_shown: "Item explanation partly displayed",
  formative_feedback_shown: "Tutor reply partly displayed",
  workflow_job_enqueued: "Background preparation queued",
  workflow_job_claimed: "Background preparation started",
  workflow_job_succeeded: "Background preparation finished",
  workflow_job_failed: "Background preparation failed",
  workflow_job_retry_scheduled: "Background preparation retry scheduled"
};

type ProcessTimelineEntry = {
  at: string | null; action: string; context: string; category: string; duration_ms: number | null;
  event_type?: string; event_source?: string | null; recorded_at_field?: string;
  client_occurred_at?: string | null; server_received_at?: string | null;
  source_turn_sequence_index?: number | null; display_event_contract_version?: string | null;
};
const exposureTypes = ["package_results_shown", "item_correctness_status_shown", "formative_feedback_shown"];
const iso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function processEventLabel(type: string, payload?: unknown, eventCategory?: string | null) {
  const event = { event_type: type, payload, event_category: eventCategory };
  if (isConfidenceRevisionEvent(event)) return "Confidence revised";
  if (isAlternativeRevisionEvent(event)) return "Alternative answer revised";
  if (exposureTypes.includes(type) && record(payload).display_event_contract_version !== "display-ack-v2") {
    return record(payload).display_event_contract_version === "display-ack-v1"
      ? "Feedback component loaded (legacy; visibility unverified)"
      : "Feedback acknowledgement (visibility unverified)";
  }
  if (type === "response_stage_observation") {
    const p = record(payload);
    const stage = String(p.response_stage ?? "response").replaceAll("_", " ");
    const labels: Record<string, string> = { ready: "ready", first_input: "input started", submitted: "submitted", offline: "connection lost", online: "connection restored" };
    return `${stage.charAt(0).toUpperCase() + stage.slice(1)}: ${labels[String(p.observation_kind)] ?? String(p.observation_kind).replaceAll("_", " ")}`;
  }
  if (type === "response_stage_outcome") return record(payload).accepted === true ? "Response accepted" : record(payload).validation_rejected === true ? "Response needs clarification" : "Response result recorded";
  if (type === "typing_activity_summary" && typeof record(payload).key_count === "number") {
    return `Typing recorded: ${finiteCount(record(payload).key_count)} keys, ${finiteCount(record(payload).backspace_count)} deletions`;
  }
  if (type === "confidence_selected" && record(payload).revised === true) return "Confidence revised";
  if (type === "navigation_event") {
    const reason = record(payload).reason;
    if (reason === "assessment_view_entered") return "Assessment view opened";
    if (reason === "assessment_view_left") return "Assessment view closed";
    if (reason === "beforeunload") return "Browser navigation or close requested";
    if (reason === "pagehide") return "Browser document left";
    if (reason === "pageshow_return") return "Browser document restored";
    return "Navigation recorded";
  }
  return eventLabels[type] ?? type.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

type ProcessDataEvent = TimingEventLike & {
  item_db_id?: string | null;
  item_public_id?: string | null;
  item_order?: number | null;
  topic_title?: string | null;
};
type ConversationObservation = {
  observation?: ObservedConversation;
  topic_title: string;
  student_turn_count: number;
  lifecycle_events: { event_type: string; occurred_at: Date; event_source: string }[];
  input_telemetry: { edit_count: number; backspace_count: number; paste_event_count: number; final_message_length_chars: number }[];
};

function finiteCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function countResponseRevisionEvents(events: Pick<ProcessDataEvent, "event_type" | "event_category" | "payload" | "item_public_id" | "item_db_id">[]) {
  const count = (...types: string[]) => events.filter((event) => types.includes(event.event_type)).length;
  const itemKey = (event: typeof events[number]) => event.item_public_id ?? event.item_db_id ?? "unknown";
  const canonicalAnswerItems = new Set(events.filter((event) => event.event_type === "answer_changed").map(itemKey));
  const legacyOptionRevisions = events.filter((event) => !canonicalAnswerItems.has(itemKey(event)) && event.event_type === "option_selected" &&
    (record(event.payload).revision === true || finiteCount(record(event.payload).revision_count) > 0)).length;
  return {
    answers: count("answer_changed") + legacyOptionRevisions,
    explanations: count("reasoning_revised", "reasoning_edited"),
    confidence: events.filter(isConfidenceRevisionEvent).length,
    alternatives: events.filter(isAlternativeRevisionEvent).length
  };
}

export function buildProcessDataSummary(input: {
  started_at: Date | null;
  completed_at: Date | null;
  last_activity_at: Date | null;
  events: ProcessDataEvent[];
  items: { item_public_id: string; item_order: number; topic_title: string; revision_count: number }[];
  conversations: ConversationObservation[];
}) {
  const count = (...types: string[]) => input.events.filter((event) => types.includes(event.event_type)).length;
  const conversations = input.conversations.flatMap(c => c.observation ? [c.observation] : []);
  const positions = presentedItemPositions(input.events);
  const timing = deriveSessionTiming({ session_started_at: input.started_at,
    session_completed_at: input.completed_at, last_activity_at: input.last_activity_at, events: input.events,
    additional_activity_at: [...conversationActivityDates(conversations), ...input.conversations.flatMap(c => c.lifecycle_events.map(e => e.occurred_at))] });
  const browserTypes = ["navigation_event", "page_hidden", "page_visible", "page_visibility_hidden", "page_visibility_visible",
    "window_blur", "window_focus", "long_pause", "inactivity_detected", "typing_activity_summary", "paste_detected", "refresh_recovery"];
  const browserEvents = input.events.filter((event) => browserTypes.includes(event.event_type) && event.event_source === "frontend");
  const observed = browserEvents.length > 0;
  const typingEvents = input.events.filter((event) => event.event_type === "typing_activity_summary");
  const entries = input.events.filter((event) => event.event_type === "navigation_event" && record(event.payload).reason === "assessment_view_entered").length;
  const changes = countResponseRevisionEvents(input.events);
  const aliases: Record<string, string> = { session_paused: "attempt_paused", session_resumed: "attempt_resumed" };
  const lifecycleKey = (event: ProcessDataEvent, type = event.event_type) => {
    const at = event.occurred_at ?? event.created_at;
    return at ? `${type}:${new Date(at).getTime()}` : null;
  };
  const canonicalLifecycle = new Set(input.events.filter((event) => ["attempt_paused", "attempt_resumed"].includes(event.event_type)).map((event) => lifecycleKey(event)).filter(Boolean));
  // Legacy and canonical records can describe the same operation. Collapse only
  // matched timestamps in the readable view; retain unmatched historical events.
  const readableEvents = input.events.filter((event) => !aliases[event.event_type] || !canonicalLifecycle.has(lifecycleKey(event, aliases[event.event_type])));
  const timeline: ProcessTimelineEntry[] = readableEvents.filter((event) => eventLabels[event.event_type] || event.event_type === "navigation_event" ||
    isConfidenceRevisionEvent(event) || isAlternativeRevisionEvent(event) ||
    (event.event_type === "response_stage_observation" && ["ready", "first_input", "offline", "online"].includes(String(record(event.payload).observation_kind))) ||
    (event.event_type === "response_stage_outcome" && record(event.payload).validation_rejected === true)).map((event) => {
    const at = event.occurred_at ?? event.created_at;
    const payload = record(event.payload);
    const exposure = exposureTypes.includes(event.event_type);
    return {
      at: at ? new Date(at).toISOString() : null,
      action: processEventLabel(event.event_type, event.payload, event.event_category),
      context: [event.topic_title, event.item_public_id && positions.has(event.item_public_id) ? `Item ${positions.get(event.item_public_id)}` : event.item_order != null ? `Authoring item ${event.item_order}` : null].filter(Boolean).join(" / ") || "Assessment",
      event_type: event.event_type, event_source: event.event_source ?? null,
      recorded_at_field: event.occurred_at ? "occurred_at" : event.created_at ? "created_at_fallback" : "unavailable",
      client_occurred_at: iso(payload.client_occurred_at), server_received_at: iso(payload.server_received_at),
      source_turn_sequence_index: exposure && Number.isInteger(payload.source_turn_sequence_index) && Number(payload.source_turn_sequence_index) > 0 ? Number(payload.source_turn_sequence_index) : null,
      display_event_contract_version: exposure && ["display-ack-v1", "display-ack-v2"].includes(String(payload.display_event_contract_version)) ? String(payload.display_event_contract_version) : null,
      category: exposure ? "Feedback display" : event.event_type.startsWith("workflow_job_") ? "System waiting" : event.event_type === "typing_activity_summary" ? "Typing" : ["window_blur", "window_focus"].includes(event.event_type) ? "Window focus" :
        browserTypes.includes(event.event_type) ? "Browser activity" : isConfidenceRevisionEvent(event) || isAlternativeRevisionEvent(event) || ["answer_changed", "reasoning_revised", "reasoning_edited"].includes(event.event_type) ? "Revisions" : "Assessment activity",
      duration_ms: ["long_pause", "inactivity_detected"].includes(event.event_type) ? event.pause_duration_ms ?? null : null
    };
  });
  // Generic browser events span the whole assessment. Do not add the overlapping
  // conversation visibility events to their counts or hidden-duration estimates.
  for (const conversation of input.conversations) {
    for (const event of conversation.lifecycle_events) {
      const names: Record<string, string> = { paused: "Learning conversation paused", resumed: "Learning conversation resumed",
        left: "Learning conversation left", reentered: "Learning conversation re-entered", disconnected: "Connection lost",
        reconnected: "Connection restored", conversation_ended: "Learning conversation ended", completed: "Learning conversation completed",
        student_message_persisted: "Student message received", agent_call_started: "Tutor reply generation started",
        agent_call_completed: "Tutor reply generation finished", agent_call_failed: "Tutor reply generation failed",
        assistant_response_failed: "Tutor reply unavailable", tutor_message_persisted: "Tutor reply saved" };
      if (names[event.event_type]) timeline.push({ at: event.occurred_at.toISOString(), action: names[event.event_type],
        event_type: event.event_type, event_source: event.event_source, recorded_at_field: "occurred_at",
        context: conversation.topic_title, category: "Learning conversation", duration_ms: null });
    }
  }
  timeline.sort((left, right) => (left.at ?? "").localeCompare(right.at ?? ""));
  const incompleteVisibility = timing.visibility_intervals.filter((interval) => interval.quality_status !== "valid").length;
  const stageVisits = deriveResponseStageVisits(input.events);
  const observedItems = new Map(input.items.map(item => [item.item_public_id, item]));
  for (const event of input.events) {
    if (event.event_type !== "response_stage_observation" || !event.item_public_id || observedItems.has(event.item_public_id)) continue;
    observedItems.set(event.item_public_id, { item_public_id: event.item_public_id,
      item_order: event.item_order ?? 0, topic_title: event.topic_title ?? "Observed item", revision_count: 0 });
  }
  const deliveryGaps = input.events.reduce((sum, event) => sum + finiteCount(record(event.payload).delivery_gap_count), 0);
  return {
    version: PROCESS_DATA_SUMMARY_VERSION,
    export_scope: "teacher_process_summary_not_full_research_dataset",
    definitions: {
      elapsed_ms: "Elapsed interval, not active work. Item: first answer-ready to final accepted submission using one browser document's monotonic clock; legacy items use their stated timing contract.",
      time_to_first_action_ms: "Answer-stage ready to first input or submission, not pointer movement or focus.",
      explanation_elapsed_ms: "Reasoning-stage ready to last accepted submission; includes pre-input time and pauses, not pure typing.",
      system_wait_ms: "Sum of observed submission-to-usable-controls intervals. Overlaps stage/item elapsed time; do not add to it. Initial AI preparation and free-text generation are separate timeline events.",
      conversation_edits: "Counts sum the recorded input telemetry for submitted messages, not answer revisions or changes of belief. Edits, backspaces and pastes are null when no messages have input telemetry; recorded zeros remain zero. Partial coverage totals describe only observed messages. These overlap whole-page typing observations.",
      item_presentation: "Item made available is a server presentation event, not proof of browser display, reading or understanding.",
      pause_episodes: "Explicit pauses paired with the next same-scope resume before termination; duplicates collapse. pause_duration_ms = resumed_at - paused_at on server timestamps. Unmatched durations are null; no_resume_recorded is censored at export, not abandonment. Overlapping assessment/conversation scopes are not additive.",
      display_receipt_to_pause_ms: "Pause server timestamp minus latest matching display-ack-v2 tutor receipt timestamp. Includes network effects; not reading time or satisfaction. Student messages before pause count only persisted turns in the uniquely linked conversation; unknown context is null.",
      presented_item_position: "Student-facing initial position from persisted item_presented metadata. Null when unknown/conflicting; item_order remains authoring order.",
      display_observation: "display-ack-v2: partial viewport display for at least 500 ms, not proof of reading, full exposure or understanding. display-ack-v1: legacy component mount, not verified visibility. Missing version is unknown. No event means unobserved, not necessarily unseen.",
      timeline_clocks: "at uses the named recorded_at_field. Client occurrence and server receipt are separate clocks; missing provenance is unknown. Saved/generated replies do not establish display."
    },
    browser_observations_available: observed,
    timing: {
      elapsed_ms: timing.session_wall_clock_elapsed_ms,
      resumable_window_ms: timing.session_resumable_active_window_ms,
      observation_end_at: timing.session_observation_end_at?.toISOString() ?? null,
      observation_end_source: timing.session_observation_end_source,
      observed_hidden_ms: timing.total_page_hidden_ms,
      observed_idle_ms: timing.session_idle_time_ms,
      quality: timing.timing_quality_status,
      contract_version: timing.timing_contract_version,
      limitations: timing.timing_limitations
    },
    core: {
      page_hidden_count: observed ? count("page_visibility_hidden", "page_hidden") : null,
      matched_return_count: observed ? timing.page_hidden_interval_count : null,
      idle_interval_count: observed ? count("long_pause") : null,
      extended_idle_interval_count: observed ? count("inactivity_detected") : null,
      assessment_pause_count: readableEvents.filter((event) => ["attempt_paused", "session_paused"].includes(event.event_type)).length,
      assessment_resume_count: readableEvents.filter((event) => ["attempt_resumed", "session_resumed"].includes(event.event_type)).length,
      recorded_response_revision_count: input.items.reduce((sum, item) => sum + item.revision_count, 0),
      revision_fields: changes,
      page_reload_count: observed ? count("refresh_recovery") : null,
      assessment_view_open_count: observed ? entries : null,
      paste_action_count: observed ? count("paste_detected") : null
    },
    typing: {
      summary_count: typingEvents.length,
      key_count: typingEvents.length ? typingEvents.reduce((sum, event) => sum + finiteCount(record(event.payload).key_count), 0) : null,
      backspace_count: typingEvents.length ? typingEvents.reduce((sum, event) => sum + finiteCount(record(event.payload).backspace_count), 0) : null
    },
    items: [...observedItems.values()].map((item) => {
      const events = input.events.filter((event) => event.item_public_id === item.item_public_id);
      const itemTiming = deriveItemTiming({ events });
      return { ...item, presented_item_position: positions.get(item.item_public_id) ?? null, elapsed_ms: itemTiming.item_elapsed_response_time_ms,
        time_to_first_action_ms: itemTiming.time_to_first_response_action_ms,
        explanation_elapsed_ms: itemTiming.reasoning_elapsed_time_ms,
        stage_summary: summarizeItemStageVisits(stageVisits.filter(v => v.item_public_id === item.item_public_id)),
        stage_visits: stageVisits.filter(v => v.item_public_id === item.item_public_id),
        calculation_version: RESPONSE_STAGE_CALCULATION_VERSION,
        timing_contract_version: itemTiming.timing_contract_version,
        timing_source_version: itemTiming.timing_source_version,
        timing_limitations: itemTiming.timing_limitations,
        timing_quality: itemTiming.timing_quality_status };
    }),
    conversations: input.conversations.map((conversation) => ({
      topic_title: conversation.topic_title,
      participation: conversation.observation ? conversationParticipation(conversation.observation, input.events) : null,
      student_turn_count: conversation.student_turn_count,
      messages_with_input_telemetry: conversation.input_telemetry.length,
      input_telemetry_coverage: conversation.input_telemetry.length === 0 ? "not_recorded" :
        conversation.input_telemetry.length < conversation.student_turn_count ? "partial" : "complete",
      edits: conversation.input_telemetry.length ? conversation.input_telemetry.reduce((sum, entry) => sum + entry.edit_count, 0) : null,
      backspaces: conversation.input_telemetry.length ? conversation.input_telemetry.reduce((sum, entry) => sum + entry.backspace_count, 0) : null,
      paste_actions: conversation.input_telemetry.length ? conversation.input_telemetry.reduce((sum, entry) => sum + entry.paste_event_count, 0) : null,
      pause_count: conversation.lifecycle_events.filter((event) => event.event_type === "paused").length,
      resume_count: conversation.lifecycle_events.filter((event) => event.event_type === "resumed").length
    })),
    pause_episodes: derivePauseEpisodes(input.events, conversations, input.completed_at),
    timeline,
    limitations: [
      "Page visibility and idle intervals do not establish attention, learning, or misconduct. The system cannot see what happens on other pages.",
      "Explicit pauses, page-hidden intervals and unanswered tutor messages are separate facts. They do not establish dissatisfaction. No recorded return means none observed by export, not permanent withdrawal.",
      "Idle thresholds can overlap and include reading or waiting for feedback; they are not separate pauses to add together.",
      "Browser close, device shutdown, and offline events are best-effort observations. Missing events are not proof that an action did not occur.",
      "Typing summaries contain counts, not keystroke text or a full draft history. Conversation input edits are not additional submitted responses.",
      "This is a teacher process summary, not the complete research dataset. Use the research export for response products, profile changes, source calls and full event evidence.",
      "Feedback saved, feedback partly displayed and student understanding are separate observations. Historical missing display evidence is not backfilled.",
      ...(!observed ? ["No browser activity was recorded for this attempt; browser counts are unavailable, not zero."] : []),
      ...(incompleteVisibility ? [`${incompleteVisibility} visibility interval(s) lack a reliable start or return; their duration is not estimated.`] : []),
      ...(timing.timing_limitations.includes("multiple_browser_documents_visibility_ambiguous") ? ["Multiple browser documents were observed. A single total time away cannot be determined reliably."] : []),
      ...(deliveryGaps ? [`The browser reported ${deliveryGaps} event(s) dropped from its bounded delivery queue.`] : [])
    ]
  };
}

export type ProcessDataSummary = ReturnType<typeof buildProcessDataSummary>;
