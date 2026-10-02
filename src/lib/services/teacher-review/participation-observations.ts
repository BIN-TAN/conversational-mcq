import { recordedEventTimestamp, type TimingEventLike } from "../student-assessment/timing-contract";

export const PARTICIPATION_OBSERVATION_VERSION = "participation-observation-v1";
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

export function conversationActivityDates(conversations: ObservedConversation[]) {
  return conversations.flatMap(conversation => [conversation.started_at, conversation.last_activity_at ?? null,
    conversation.completed_at ?? null, conversation.ended_at ?? null,
    ...conversation.conversation_turns.map(turn => turn.created_at), ...conversation.lifecycle_events.map(recordedEventTimestamp)]);
}

export function conversationParticipation(conversation: ObservedConversation, events: TimingEventLike[]) {
  const turns = conversation.conversation_turns;
  const agentIndexes = new Set(turns.filter(turn => turn.actor_type === "agent").map(turn => turn.sequence_index));
  const displays = events.filter(event => {
    const payload = record(event.payload);
    return event.event_type === "formative_feedback_shown" && payload.display_event_contract_version === "display-ack-v2"
      && payload.conversation_public_id === conversation.conversation_public_id
      && agentIndexes.has(Number(payload.source_turn_sequence_index));
  }).sort((a, b) => (recordedEventTimestamp(a)?.getTime() ?? 0) - (recordedEventTimestamp(b)?.getTime() ?? 0));
  return {
    participation_observation_version: PARTICIPATION_OBSERVATION_VERSION,
    tutor_reply_count: turns.filter(turn => turn.actor_type === "agent").length,
    displayed_tutor_reply_count: new Set(displays.map(event => Number(record(event.payload).source_turn_sequence_index))).size,
    first_tutor_display_received_at: displays.length ? recordedEventTimestamp(displays[0])?.toISOString() ?? null : null,
    first_student_message_at: [...turns].filter(turn => turn.actor_type === "student")
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0]?.created_at.toISOString() ?? null
  };
}

export function derivePauseEpisodes(events: TimingEventLike[], conversations: ObservedConversation[], completedAt: Date | null) {
  const terminalTypes = ["assessment_completed", "session_completed", "attempt_ended_by_student", "attempt_ended_by_teacher"];
  const cutoff = completedAt ?? events.filter(event => terminalTypes.includes(event.event_type)).map(recordedEventTimestamp)
    .filter((date): date is Date => date !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const rows = [
    ...events.map(event => ({ event, scope: "assessment" as const, conversation: null as ObservedConversation | null })),
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
      const tutorIndexes = new Set(conversation?.conversation_turns.filter(turn => turn.actor_type === "agent" && turn.created_at <= at).map(turn => turn.sequence_index));
      const display = conversation ? events.filter(e => {
        const p = record(e.payload), time = recordedEventTimestamp(e);
        return e.event_type === "formative_feedback_shown" && p.display_event_contract_version === "display-ack-v2"
          && p.conversation_public_id === conversation.conversation_public_id && tutorIndexes.has(Number(p.source_turn_sequence_index)) && time && time <= at;
      }).map(recordedEventTimestamp).filter((date): date is Date => date !== null).sort((a, b) => b.getTime() - a.getTime())[0] : null;
      const episode: typeof episodes[number] = {
        pause_scope: scope, conversation_public_id: conversation?.conversation_public_id ?? null,
        concept_unit_public_id: conversation?.concept_unit_public_id ?? text(payload.current_concept_unit_public_id),
        phase_at_pause: phase, paused_at: at.toISOString(), resumed_at: null, pause_duration_ms: null,
        return_status: "no_resume_recorded",
        student_messages_before_pause: conversation ? conversation.conversation_turns.filter(turn => turn.actor_type === "student" && turn.created_at <= at).length : null,
        last_tutor_display_received_at: display?.toISOString() ?? null,
        display_receipt_to_pause_ms: display ? at.getTime() - display.getTime() : null,
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
  paused_at: "Server-recorded explicit pause time. Consecutive pauses/legacy aliases without a resume form one episode.",
  resumed_at: "First following explicit resume in the same scope before termination. Blank means no matching resume was recorded.",
  pause_duration_ms: "resumed_at minus paused_at in milliseconds using server timestamps. Unmatched or terminated episodes remain blank, not zero; not time away from the browser.",
  return_status: "resumed, ended_without_recorded_resume, or no_resume_recorded at export. The latter is right-censored, not permanent abandonment.",
  student_messages_before_pause: "Number of persisted student turns in the linked conversation with created_at <= paused_at. Blank if no unique conversation; zero is observed no messages.",
  last_tutor_display_received_at: "Latest server receipt of display-ack-v2 for a tutor turn in the linked conversation before pause. Partial viewport display only, not reading/comprehension. Missing is unobserved, not unseen.",
  display_receipt_to_pause_ms: "paused_at minus last_tutor_display_received_at, server clock milliseconds. Network delay affects this interval; not reading time or a measure of dislike.",
  pause_reason: "student_requested_pause identifies the recorded action only; not_recorded otherwise. Motivation, satisfaction and reasons for pausing are not inferred.",
  participation_observation_version: "Version of deterministic participation/pause projection; raw source records are preserved."
};
