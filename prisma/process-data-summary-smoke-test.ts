import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { processDataTimelineCsv } from "../src/lib/services/teacher-review/process-data-csv";
import { buildProcessDataSummary, processEventLabel } from "../src/lib/services/teacher-review/process-data-summary";
import { formativeConversationTurnLimit, formativeConversationV18R2LifecycleForTurnCount, FormativeConversationV18R2FormativeLifecycleSchema } from "../src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import { formativeConversationV18R2LifecycleFromTranscript } from "../src/lib/services/student-assessment/formative-conversation/context-v18r2";

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 15, 12, 0, seconds));
const base = { started_at: at(0), completed_at: at(400), last_activity_at: at(400), items: [], conversations: [] };
const event = (event_type: string, seconds: number, extra = {}) => ({ event_type, event_source: "frontend", occurred_at: at(seconds), payload: { browser_tab_id: "tab-one" }, ...extra });
const events = [event("item_presented", 0), event("option_clicked", 10), event("reasoning_submitted", 20), event("item_completed", 40),
  event("page_visibility_hidden", 50, { visibility_duration_ms: 50000 }), event("page_visibility_visible", 80),
  event("answer_changed", 90), event("reasoning_revised", 91), event("confidence_changed", 92),
  event("long_pause", 230, { pause_duration_ms: 120000 }), event("inactivity_detected", 400, { pause_duration_ms: 300000 }),
  event("typing_activity_summary", 95, { payload: { key_count: 20, backspace_count: 2, arbitrary_private_text: "SECRET" } })
].map((entry) => ({ ...entry, item_public_id: "item-one", item_order: 1, topic_title: "Topic" }));
const result = buildProcessDataSummary({ ...base, events, items: [{ item_public_id: "item-one", item_order: 1, topic_title: "Topic", revision_count: 1 }],
  conversations: [{ topic_title: "Topic", student_turn_count: 1, input_telemetry: [{ edit_count: 2, backspace_count: 1, paste_event_count: 1, final_message_length_chars: 20 }],
    lifecycle_events: [{ event_type: "page_hidden", occurred_at: at(50), event_source: "frontend" }, { event_type: "paused", occurred_at: at(300), event_source: "backend" }] }] });
assert.equal(result.core.page_hidden_count, 1);
assert.equal(result.core.matched_return_count, 1);
assert.equal(result.timing.observed_hidden_ms, 30000, "Do not misread prior visible duration as time hidden");
assert.equal(result.timing.observed_idle_ms, 300000, "Overlapping idle thresholds are not added");
assert.equal(result.core.recorded_response_revision_count, 1, "Multiple fields do not multiply response revision count");
assert.deepEqual(result.core.revision_fields, { answers: 1, explanations: 1, confidence: 1, alternatives: 0 });
assert.equal(result.typing.key_count, 20);
assert.equal(result.conversations[0].pause_count, 1);
assert.equal(result.core.assessment_pause_count, 0, "Conversation-only pauses are separate");
assert.equal(result.items[0].time_to_first_action_ms, 10000);
assert(!JSON.stringify(result).includes("SECRET"));
assert(!JSON.stringify(result).includes("browser_tab_id"));
assert.equal(result.timeline.filter((entry) => entry.action === "Assessment page hidden").length, 1, "No duplicate conversation visibility observation");
assert.equal(buildProcessDataSummary({ ...base, events: [] }).core.page_hidden_count, null);
assert.equal(buildProcessDataSummary({ ...base, events: [] }).typing.key_count, null);
const unpaired = buildProcessDataSummary({ ...base, events: [event("page_visibility_hidden", 50)] });
assert.equal(unpaired.timing.observed_hidden_ms, null);
assert(unpaired.limitations.some((entry) => entry.includes("lack a reliable")));
const tabs = buildProcessDataSummary({ ...base, events: [...events, event("page_visibility_hidden", 60, { payload: { browser_tab_id: "tab-two" } }), event("page_visibility_visible", 85, { payload: { browser_tab_id: "tab-two" } })] });
assert.equal(tabs.timing.observed_hidden_ms, null);
assert(tabs.limitations.some((entry) => entry.includes("Multiple browser")));
assert.equal(processEventLabel("navigation_event", { reason: "assessment_view_entered" }), "Assessment view opened");
const mixedRevisions = buildProcessDataSummary({ ...base, events: [
  event("answer_changed", 5, { item_public_id: "new-item" }),
  event("option_selected", 5, { item_public_id: "new-item", payload: { revision: true } }),
  event("option_selected", 6, { item_public_id: "legacy-item", payload: { revision: true } })
] });
assert.equal(mixedRevisions.core.revision_fields.answers, 2, "Count legacy items without duplicating canonical revision aliases");
const lifecycle = buildProcessDataSummary({ ...base, events: [
  event("attempt_paused", 10), event("session_paused", 10),
  event("attempt_resumed", 20), event("session_resumed", 20),
  event("session_paused", 30), event("session_resumed", 40)
] });
assert.equal(lifecycle.core.assessment_pause_count, 2, "Collapse aliases without dropping unmatched legacy operations");
assert.equal(lifecycle.core.assessment_resume_count, 2);
assert.equal(lifecycle.timeline.filter((entry) => entry.action === "Assessment paused").length, 2);
assert.equal(lifecycle.timeline.filter((entry) => entry.action === "Assessment resumed").length, 2);
const csvData = { ...result, timeline: [...result.timeline, { at: null, action: "Review", category: "Assessment activity", context: '=HYPERLINK("https://example.invalid")\nTopic, one', duration_ms: null }] };
const csvRows = parse<Record<string, string>>(processDataTimelineCsv(csvData, "session-one"), { columns: true, bom: true });
assert.equal(csvRows.length, csvData.timeline.length, "Download includes all pages and categories");
assert.equal(csvRows[0].recorded_at_utc, csvData.timeline[0].at);
assert.equal(csvRows.at(-1)!.context, "'" + csvData.timeline.at(-1)!.context, "Spreadsheet formulas are escaped without losing quoted/newline text");
assert.equal(csvRows.at(-1)!.duration_ms, "", "Unknown duration is blank, not zero");

for (let turn = 0; turn <= 30; turn++) {
  const lifecycle = formativeConversationV18R2LifecycleForTurnCount(turn, 30);
  assert.equal(lifecycle.final_allowed_turn, turn === 30);
  assert.equal(lifecycle.another_student_turn_available, turn < 30);
}
assert.throws(() => formativeConversationV18R2LifecycleForTurnCount(31, 30));
assert.throws(() => formativeConversationV18R2LifecycleForTurnCount(13, 12));
assert.equal(formativeConversationV18R2LifecycleForTurnCount(12).final_allowed_turn, true, "Historical contract defaults remain 12");
assert.equal(formativeConversationV18R2LifecycleFromTranscript([{ actor: "tutor" }], 30).student_turn_index, 0);
assert.equal(formativeConversationV18R2LifecycleFromTranscript([{ actor: "tutor" }, { actor: "student" }], 30).student_turn_index, 1);
assert(!FormativeConversationV18R2FormativeLifecycleSchema.safeParse({ student_turn_index: 31, max_student_turns: 30, final_allowed_turn: false, another_student_turn_available: true }).success);
assert.equal(formativeConversationTurnLimit({ status: "ended", conversation_turns: [] }), 12);
assert.equal(formativeConversationTurnLimit({ status: "ended", conversation_turns: [{ structured_payload: { max_formative_student_turns: 30 } }] }), 30);
assert.equal(formativeConversationTurnLimit({ status: "active", conversation_turns: [{ structured_payload: { max_formative_student_turns: 12 } }] }), 30);
console.log("Process summary, privacy, timing, 30-turn boundaries, and historical policy checks passed (no provider calls).");
