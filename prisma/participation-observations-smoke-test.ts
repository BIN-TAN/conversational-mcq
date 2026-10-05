import assert from "node:assert/strict";
import { deriveSessionTiming, type TimingEventLike } from "../src/lib/services/student-assessment/timing-contract";
import { conversationActivityDates } from "../src/lib/services/teacher-review/participation-observations";
import { conversationParticipation, derivePauseEpisodes, type ObservedConversation } from "../src/lib/services/teacher-review/participation-observations";
import { presentedItemPositions } from "../src/lib/services/teacher-review/presented-item-positions";
import { buildProcessDataSummary } from "../src/lib/services/teacher-review/process-data-summary";

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds));
const event = (type: string, seconds: number, payload = {}): TimingEventLike => ({ event_type: type, occurred_at: at(seconds), event_source: "backend", payload });
const conversation: ObservedConversation = {
  conversation_public_id: "conversation-demo", concept_unit_public_id: "topic-demo", started_at: at(50), last_activity_at: at(80),
  conversation_turns: [{ actor_type: "agent", created_at: at(60), sequence_index: 151 },
    { actor_type: "student", created_at: at(200), sequence_index: 155 }, { actor_type: "agent", created_at: at(220), sequence_index: 159 }],
  lifecycle_events: [event("paused", 180), event("resumed", 190), event("paused", 250)]
};
const display = event("formative_feedback_shown", 72, { display_event_contract_version: "display-ack-v2",
  conversation_public_id: conversation.conversation_public_id, source_turn_sequence_index: 151,
  client_occurred_at: at(65).toISOString(), server_received_at: at(72).toISOString() });
const events = [display, event("attempt_paused", 80, { preserved_phase: "planning_completed", reason: "student_requested_pause" }),
  event("session_paused", 80), event("attempt_resumed", 120), event("session_resumed", 120),
  event("page_visibility_hidden", 130), event("page_visibility_visible", 160)];
const stale = deriveSessionTiming({ session_started_at: at(0), last_activity_at: at(120), events });
assert.equal(stale.session_wall_clock_elapsed_ms, 160_000);
assert.equal(stale.total_page_hidden_ms, 30_000, "Later conversation visibility must not be clipped by stale last_activity_at");
assert.equal(stale.session_resumable_active_window_ms, 120_000);
assert.equal(stale.session_observation_end_source, "latest_recorded_activity");
const completed = deriveSessionTiming({ session_started_at: at(0), session_completed_at: at(140), events });
assert.equal(completed.session_wall_clock_elapsed_ms, 140_000, "Late acknowledgements must not extend completion");
assert.equal(completed.total_page_hidden_ms, 10_000);
const terminal = deriveSessionTiming({ session_started_at: at(0), events: [...events, event("attempt_ended_by_student", 140)] });
assert.equal(terminal.session_wall_clock_elapsed_ms, 140_000, "Unsorted terminal records must be honored");
const skew = deriveSessionTiming({ session_started_at: at(0), events: [event("window_focus", 20, { client_occurred_at: at(9000).toISOString(), server_received_at: at(20).toISOString() })] });
assert.equal(skew.session_wall_clock_elapsed_ms, 20_000, "Client clock must not extend endpoint");
const clientLifecycle = { ...conversation, lifecycle_events: [{ ...event("page_hidden", 9000), event_source: "frontend", created_at: at(260) }] };
const clientLifecycleTiming = deriveSessionTiming({session_started_at:at(0), events:[], additional_activity_at:conversationActivityDates([clientLifecycle])});
assert.equal(clientLifecycleTiming.session_wall_clock_elapsed_ms, 260_000, "Lifecycle browser clocks must use the stored server receipt even without payload metadata");
const episodes = derivePauseEpisodes(events, [conversation], null);
assert.equal(episodes.length, 3, "Legacy alias must not duplicate an episode; scopes remain separate");
assert.equal(episodes[0].student_messages_before_pause, 0);
assert.equal(episodes[0].pause_duration_ms, 40_000);
assert.equal(episodes[0].display_receipt_to_pause_ms, 8000, "Use server receipt, not mixed browser/server clocks");
assert.equal(episodes[0].display_receipt_scope, "current_participation_window");
assert.equal(episodes[1].display_receipt_scope, "earlier_participation_window");
assert.equal(episodes[1].display_receipt_to_pause_ms, null, "An earlier visit's receipt is not current-visit latency");
assert.equal(episodes[1].pause_duration_ms, 10_000);
assert.equal(episodes[2].student_messages_before_pause, 1);
assert.equal(episodes[2].return_status, "no_resume_recorded");
assert.equal(episodes[2].pause_duration_ms, null);
const endedConversation = { ...conversation, ended_at: at(260), lifecycle_events: [...conversation.lifecycle_events, event("resumed", 270), event("paused", 280)] };
const endedConversationEpisodes = derivePauseEpisodes(events, [endedConversation], null);
assert.equal(endedConversationEpisodes.length, 3, "Ignore lifecycle records after the authoritative conversation end");
assert.equal(endedConversationEpisodes[2].return_status, "ended_without_recorded_resume", "Conversation end closes an unmatched pause even if its lifecycle event is missing");
assert.equal(endedConversationEpisodes[2].resumed_at, null);
assert.equal(endedConversationEpisodes[2].pause_duration_ms, null, "Never invent a return interval at completion");
assert.equal(derivePauseEpisodes(events, [{ ...conversation, completed_at: at(260) }], null)[2].return_status, "ended_without_recorded_resume");
assert.equal(derivePauseEpisodes(events, [conversation], at(260))[2].return_status, "ended_without_recorded_resume");
const initialPause = derivePauseEpisodes([event("attempt_paused", 90, { preserved_phase: "initial_item_administration" })], [conversation], null)[0];
assert.equal(initialPause.conversation_public_id, null, "Do not attach initial administration to a learning conversation");
assert.equal(initialPause.student_messages_before_pause, null);
const legacy = derivePauseEpisodes([event("attempt_paused", 90)], [], null)[0];
assert.equal(legacy.phase_at_pause, null);
assert.equal(legacy.display_receipt_to_pause_ms, null);
assert.equal(legacy.pause_reason, "not_recorded");
const duplicate = derivePauseEpisodes([event("attempt_paused", 10), event("attempt_paused", 11), event("attempt_resumed", 20), event("attempt_resumed", 21)], [], null);
assert.equal(duplicate.length, 1);
assert.equal(duplicate[0].pause_duration_ms, 10000);
const ended = derivePauseEpisodes([event("attempt_paused", 10), event("attempt_ended_by_teacher", 15), event("attempt_resumed", 20)], [], null);
assert.equal(ended[0].return_status, "ended_without_recorded_resume");
assert.equal(ended[0].resumed_at, null);
assert.equal(derivePauseEpisodes([event("attempt_ended_by_teacher", 15), event("attempt_paused", 20)], [], null).length, 0, "Ignore late pause observations after termination");
const participation = conversationParticipation(conversation, [display, display,
  event("formative_feedback_shown", 90, { display_event_contract_version: "display-ack-v2", conversation_public_id: "conversation-demo", source_turn_sequence_index: "151" }),
  event("formative_feedback_shown", 90, { display_event_contract_version: "display-ack-v1", conversation_public_id: "conversation-demo", source_turn_sequence_index: 159 }),
  event("formative_feedback_shown", 90, { display_event_contract_version: "display-ack-v2", conversation_public_id: "other", source_turn_sequence_index: 159 }),
  event("formative_feedback_shown", 90, { display_event_contract_version: "display-ack-v2", conversation_public_id: "conversation-demo", source_turn_sequence_index: 555 })]);
assert.equal(participation.displayed_tutor_reply_count, 1, "Only matched current display contract; deduplicate by source turn");
assert.equal(participation.tutor_reply_count, 2);
assert.equal(participation.first_student_message_at, at(200).toISOString());
const positions = presentedItemPositions([{ ...event("item_presented", 0, { item_position: 3 }), item_public_id: "item-4" },
  { ...event("item_presented", 0, { item_position: 4 }), item_public_id: "item-5" }]);
assert.equal(positions.get("item-4"), 3);
assert.equal(positions.get("item-5"), 4);
assert.equal(presentedItemPositions([1, 2].map(i => ({ ...event("item_presented", i, { item_position: i }), item_public_id: "conflict" }))).size, 0);
const summary = buildProcessDataSummary({ started_at: at(0), completed_at: null, last_activity_at: at(80), events, items: [],
  conversations: [{ observation: conversation, topic_title: "Example topic", student_turn_count: 1,
    lifecycle_events: conversation.lifecycle_events.map(e => ({ event_type: e.event_type, occurred_at: e.occurred_at as Date, event_source: "backend" })), input_telemetry: [] }] });
assert.equal(summary.timing.elapsed_ms, 250_000, "Latest conversation lifecycle must extend the open observation window");
assert.equal(summary.timing.observed_hidden_ms, 30_000);
assert.deepEqual(summary.pause_episodes, episodes, "Teacher and research share the same pause projection");
assert.equal(summary.conversations[0].assessment_pause_count, 1);
assert.equal(summary.conversations[0].assessment_resume_count, 1);
assert.equal(summary.conversations[0].pause_count, 2, "Conversation-only counts remain separate");
assert.equal(summary.conversations[0].conversation_public_id, conversation.conversation_public_id);
assert(!JSON.stringify(summary.pause_episodes).includes("dislike"), "No inferred affect in pause rows");

const resumedDaysLater = [display, event("attempt_paused", 80, { preserved_phase: "planning_completed" }),
  event("attempt_resumed", 300000), event("attempt_paused", 300180, { preserved_phase: "planning_completed" })];
const historical = { ...conversation, conversation_turns: conversation.conversation_turns.slice(0, 1), lifecycle_events: [] };
const repeatedVisit = derivePauseEpisodes(resumedDaysLater, [historical], null)[1];
assert.equal(repeatedVisit.last_tutor_display_received_at, at(72).toISOString(), "Keep earlier display provenance");
assert.equal(repeatedVisit.participation_window_started_at, at(300000).toISOString());
assert.equal(repeatedVisit.display_receipt_to_pause_ms, null, "Do not report days away as this visit's interval");
const reopened = derivePauseEpisodes([...resumedDaysLater,
  event("navigation_event", 300010, { reason: "assessment_view_entered" }),
  event("formative_feedback_shown", 300020, { ...display.payload as object, server_received_at: at(300020).toISOString() })
], [historical], null)[1];
assert.equal(reopened.participation_window_started_at, at(300010).toISOString());
assert.equal(reopened.display_receipt_to_pause_ms, 160000, "Use the current visit's display even for an old tutor reply");
assert.equal(reopened.display_receipt_scope, "current_participation_window");
const unrelated = { ...historical, conversation_public_id: "another", started_at: at(300030), lifecycle_events: [event("resumed", 300100)] };
assert.equal(derivePauseEpisodes([...resumedDaysLater, event("formative_feedback_shown", 300020,
  { ...display.payload as object, server_received_at: at(300020).toISOString() })], [historical, unrelated], null)[1].conversation_public_id, null,
  "An ambiguous assessment pause must not invent a topic link");
const closed = buildProcessDataSummary({ started_at: at(0), completed_at: at(300), last_activity_at: at(300), events: [], items: [],
  conversations: [{ topic_title: "Synthetic", observation: { ...historical, ended_at: at(290) }, student_turn_count: 0, lifecycle_events: [], input_telemetry: [] }] });
assert.equal(closed.conversations[0].conversation_ended_at, at(290).toISOString());
assert.equal(closed.conversations[0].student_turn_count, 0, "Closing an attempt does not invent student dialogue");
assert.equal(closed.conversations[0].edits, null);
console.log("Participation, timing, pause/resume/termination, numbering, clock and privacy regression checks passed. No AI or database calls.");
