import { recordedEventTimestamp, type TimingEventLike } from "../student-assessment/timing-contract";

export const PARTICIPATION_OBSERVATION_VERSION = "participation-observation-v3";
export type ObservedConversation = {
  conversation_public_id: string;
  concept_unit_public_id?: string | null;
  started_at: Date;
  completed_at?: Date | null;
  ended_at?: Date | null;
  last_activity_at?: Date | null;
  conversation_turns: { actor_type: string; created_at: Date; sequence_index: number }[];
  lifecycle_events: TimingEventLike[];
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : null;
const conversationEnd = (conversation: ObservedConversation) => [conversation.completed_at, conversation.ended_at]
  .filter((date): date is Date => !!date && Number.isFinite(date.getTime()))
  .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

export function canonicalAssessmentLifecycleEvents<T extends TimingEventLike>(events: T[]): T[] {
  const aliases: Record<string, string> = { session_paused: "attempt_paused", session_resumed: "attempt_resumed" };
  const key = (event: T, type = event.event_type) => {
    const at = recordedEventTimestamp(event);
    return at ? `${type}:${at.getTime()}` : null;
  };
  const canonical = new Set(events.filter(event => ["attempt_paused", "attempt_resumed"].includes(event.event_type))
    .map(event => key(event)).filter(Boolean));
  // Canonical records carry richer context. Selection must not depend on the
  // database's arbitrary ordering of two rows from the same operation.
  return events.filter(event => !aliases[event.event_type] || !canonical.has(key(event, aliases[event.event_type])));
}

export function conversationActivityDates(conversations: ObservedConversation[]) {
  return conversations.flatMap(conversation => [conversation.started_at, conversation.last_activity_at ?? null,
    conversation.completed_at ?? null, conversation.ended_at ?? null,
    ...conversation.conversation_turns.map(turn => turn.created_at), ...conversation.lifecycle_events.map(recordedEventTimestamp)]);
}

export function displaySourceTurnIndex(value: unknown): number | null {
  const index = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(index) && index > 0 ? index : null;
}

function tutorDisplayReceipts(conversation: ObservedConversation, events: TimingEventLike[]) {
  const tutorTurns = new Map(conversation.conversation_turns.filter(turn => turn.actor_type === "agent")
    .map(turn => [turn.sequence_index, turn.created_at]));
  return events.flatMap(event => {
    const payload = record(event.payload);
    const index = displaySourceTurnIndex(payload.source_turn_sequence_index);
    const savedAt = index === null ? null : tutorTurns.get(index);
    const receivedAt = recordedEventTimestamp(event);
    return index !== null && savedAt && receivedAt && receivedAt >= savedAt && receivedAt >= conversation.started_at
      && event.event_type === "formative_feedback_shown" && payload.display_event_contract_version === "display-ack-v2"
      && payload.conversation_public_id === conversation.conversation_public_id
      ? [{ sequence_index: index, received_at: receivedAt }] : [];
  }).sort((a, b) => a.received_at.getTime() - b.received_at.getTime());
}

export function conversationParticipation(conversation: ObservedConversation, events: TimingEventLike[]) {
  const turns = conversation.conversation_turns;
  const displays = tutorDisplayReceipts(conversation, events);
  return {
    participation_observation_version: PARTICIPATION_OBSERVATION_VERSION,
    tutor_reply_count: turns.filter(turn => turn.actor_type === "agent").length,
    displayed_tutor_reply_count: new Set(displays.map(event => event.sequence_index)).size,
    first_tutor_display_received_at: displays[0]?.received_at.toISOString() ?? null,
    first_student_message_at: [...turns].filter(turn => turn.actor_type === "student")
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0]?.created_at.toISOString() ?? null
  };
}

function participationWindowStart(conversation: ObservedConversation, events: TimingEventLike[], before: Date) {
  // A receipt from a previous visit is still evidence of display, but cannot
  // measure this visit's display-to-pause interval.
  const boundaries = [conversation.started_at,
    ...events.filter(event => ["attempt_resumed", "session_resumed"].includes(event.event_type) ||
      event.event_type === "navigation_event" && record(event.payload).reason === "assessment_view_entered")
      .map(recordedEventTimestamp),
    ...conversation.lifecycle_events.filter(event => ["resumed", "reentered"].includes(event.event_type))
      .map(recordedEventTimestamp)
  ].filter((date): date is Date => !!date && date >= conversation.started_at && date <= before);
  return new Date(Math.max(...boundaries.map(date => date.getTime())));
}

export function derivePauseEpisodes(events: TimingEventLike[], conversations: ObservedConversation[], completedAt: Date | null) {
  const terminalTypes = ["assessment_completed", "session_completed", "attempt_ended_by_student", "attempt_ended_by_teacher"];
  const cutoff = completedAt ?? events.filter(event => terminalTypes.includes(event.event_type)).map(recordedEventTimestamp)
    .filter((date): date is Date => date !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const rows = [
    ...canonicalAssessmentLifecycleEvents(events).map(event => ({ event, scope: "assessment" as const, conversation: null as ObservedConversation | null })),
    ...conversations.flatMap(conversation => conversation.lifecycle_events.map(event => ({ event, scope: "learning_conversation" as const, conversation })))
  ].flatMap(row => {
    const at = recordedEventTimestamp(row.event);
    const end = row.conversation ? conversationEnd(row.conversation) : null;
    return at && (!cutoff || at <= cutoff) && (!end || at <= end) ? [{ ...row, at }] : [];
  }).sort((a, b) => a.at.getTime() - b.at.getTime());
  const episodes: Array<{
    pause_scope: "assessment" | "learning_conversation";
    conversation_public_id: string | null;
    concept_unit_public_id: string | null;
    phase_at_pause: string | null;
    paused_at: string;
    resumed_at: string | null;
    pause_duration_ms: number | null;
    return_status: "resumed" | "ended_without_recorded_resume" | "no_resume_recorded";
    student_messages_before_pause: number | null;
    last_tutor_display_received_at: string | null;
    participation_window_started_at: string | null;
    display_receipt_scope: "current_participation_window" | "earlier_participation_window" | "not_recorded";
    display_receipt_to_pause_ms: number | null;
    pause_reason: string;
    participation_observation_version: string;
  }> = [];
  const open = new Map<string, typeof episodes[number]>();
  for (const row of rows) {
    const { event, at, scope } = row;
    const key = scope === "assessment" ? scope : row.conversation!.conversation_public_id;
    const pause = scope === "assessment" ? ["attempt_paused", "session_paused"].includes(event.event_type) : event.event_type === "paused";
    const resume = scope === "assessment" ? ["attempt_resumed", "session_resumed"].includes(event.event_type) : event.event_type === "resumed";
    const terminal = scope === "assessment" ? terminalTypes.includes(event.event_type)
      : ["completed", "conversation_ended"].includes(event.event_type);
    if (pause && !open.has(key)) {
      const payload = record(event.payload);
      const phase = scope === "learning_conversation" ? "learning_conversation" : text(payload.preserved_phase);
      // Historical assessment pauses may lack a topic. Link only a unique eligible
      // conversation, never a guessed topic or an earlier initial-administration pause.
      const candidates = conversations.filter(c => c.started_at <= at && (!c.completed_at || c.completed_at >= at)
        && (!c.ended_at || c.ended_at >= at) && (!payload.current_concept_unit_public_id || c.concept_unit_public_id === payload.current_concept_unit_public_id));
      const conversation = row.conversation ?? (["planning_completed", "formative_conversation", "learning_conversation"].includes(phase ?? "") && candidates.length === 1 ? candidates[0] : null);
      const display = conversation ? tutorDisplayReceipts(conversation, events)
        .filter(receipt => receipt.received_at <= at).at(-1)?.received_at : null;
      const windowStart = conversation ? participationWindowStart(conversation, events, at) : null;
      const displayInWindow = !!display && !!windowStart && display >= windowStart;
      const episode: typeof episodes[number] = {
        pause_scope: scope, conversation_public_id: conversation?.conversation_public_id ?? null,
        concept_unit_public_id: conversation?.concept_unit_public_id ?? text(payload.current_concept_unit_public_id),
        phase_at_pause: phase, paused_at: at.toISOString(), resumed_at: null, pause_duration_ms: null,
        return_status: "no_resume_recorded",
        student_messages_before_pause: conversation ? conversation.conversation_turns.filter(turn => turn.actor_type === "student" && turn.created_at <= at).length : null,
        last_tutor_display_received_at: display?.toISOString() ?? null,
        participation_window_started_at: windowStart?.toISOString() ?? null,
        display_receipt_scope: !display ? "not_recorded" : displayInWindow ? "current_participation_window" : "earlier_participation_window",
        display_receipt_to_pause_ms: displayInWindow ? at.getTime() - display!.getTime() : null,
        pause_reason: payload.reason === "student_requested_pause" || scope === "learning_conversation" && event.event_source === "backend" ? "student_requested_pause" : "not_recorded",
        participation_observation_version: PARTICIPATION_OBSERVATION_VERSION
      };
      episodes.push(episode);
      open.set(key, episode);
    }
    const episode = open.get(key);
    if (episode && (resume || terminal)) {
      if (resume) {
        episode.resumed_at = at.toISOString();
        episode.pause_duration_ms = at.getTime() - Date.parse(episode.paused_at);
        episode.return_status = "resumed";
      } else episode.return_status = "ended_without_recorded_resume";
      open.delete(key);
    }
    if (terminal && scope === "assessment") {
      for (const pending of open.values()) pending.return_status = "ended_without_recorded_resume";
      open.clear();
    }
  }
  for (const [key, episode] of open) {
    const conversation = episode.pause_scope === "learning_conversation"
      ? conversations.find(candidate => candidate.conversation_public_id === key) : null;
    if (cutoff || conversation && conversationEnd(conversation)) episode.return_status = "ended_without_recorded_resume";
  }
  return episodes;
}

export const PAUSE_EPISODE_DEFINITIONS: Record<string, string> = {
  pause_scope: "Explicit assessment or learning-conversation pause. Browser hidden/idle events are separate. Scopes may overlap: do not sum their durations.",
  conversation_public_id: "Public conversation join key; blank when pause context does not establish a unique conversation.",
  concept_unit_public_id: "Public topic join key from the recorded context, or the uniquely linked conversation.",
  phase_at_pause: "Recorded preserved assessment phase, or learning_conversation for conversation-only pauses; blank for unknown legacy context.",
  paused_at: "Server-recorded explicit pause time. Consecutive pauses/legacy aliases without a resume form one episode. Equal-time canonical records take precedence over aliases to preserve topic context independently of source ordering.",
  resumed_at: "First following explicit resume in the same scope before termination. Blank means no matching resume was recorded.",
  pause_duration_ms: "resumed_at minus paused_at in milliseconds using server timestamps. Unmatched or terminated episodes remain blank, not zero; not time away from the browser.",
  return_status: "resumed, ended_without_recorded_resume, or no_resume_recorded at export. The latter is right-censored, not permanent abandonment.",
  student_messages_before_pause: "Number of persisted student turns in the linked conversation with created_at <= paused_at. Blank if no unique conversation; zero is observed no messages.",
  last_tutor_display_received_at: "Latest server receipt of display-ack-v2 for a tutor turn in the linked conversation before pause. Its positive integer sequence reference must match a saved tutor turn and the receipt cannot precede the conversation or turn. Partial viewport display only, not reading/comprehension. Missing is unobserved, not unseen.",
  participation_window_started_at: "Latest conversation start, assessment resume/view-open, or this conversation's resume/reentry at or before pause, using server-recorded timestamps. Blank if no uniquely linked conversation. A recorded visit boundary, not active study time.",
  display_receipt_scope: "current_participation_window if the last matching display receipt is at or after participation_window_started_at; earlier_participation_window if older; not_recorded if absent. No inference of reading or satisfaction.",
  display_receipt_to_pause_ms: "Only for current_participation_window: paused_at minus last_tutor_display_received_at, server clock milliseconds. Otherwise blank, not zero. Prior-visit receipts are preserved but do not yield multi-day display-to-pause intervals. Network effects remain; not reading time or dislike.",
  pause_reason: "student_requested_pause identifies the recorded action only; not_recorded otherwise. Motivation, satisfaction and reasons for pausing are not inferred.",
  participation_observation_version: "Version of deterministic participation/pause projection; raw source records are preserved."
};
