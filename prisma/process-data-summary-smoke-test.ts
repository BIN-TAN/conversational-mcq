import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { processDataTimelineCsv } from "../src/lib/services/teacher-review/process-data-csv";
import { buildProcessDataSummary, processEventLabel } from "../src/lib/services/teacher-review/process-data-summary";
import { buildEngagementProcessFeatureRows } from "../src/lib/services/teacher-review/engagement-process-features";
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
const exposure = buildProcessDataSummary({ ...base, events: [
  event("formative_feedback_shown", 10, { payload: { display_event_contract_version: "display-ack-v2",
    client_occurred_at: at(9).toISOString(), server_received_at: at(10).toISOString(), source_turn_sequence_index: 3,
    secret: "DO_NOT_EXPORT", student_visible_message: "DO_NOT_EXPORT" } }),
  event("package_results_shown", 11, { payload: { display_event_contract_version: "display-ack-v1" } }),
  event("workflow_job_enqueued", 1), event("workflow_job_failed", 2)
] });
assert.equal(exposure.version, "process-data-summary-v5");
assert.equal(exposure.export_scope, "teacher_process_summary_not_full_research_dataset");
assert(exposure.definitions.display_observation.includes("legacy component mount"));
const display = exposure.timeline.find(entry => entry.event_type === "formative_feedback_shown")!;
assert.equal(display.category, "Feedback display");
assert.equal(display.source_turn_sequence_index, 3);
assert.equal(display.display_event_contract_version, "display-ack-v2");
assert.equal(display.client_occurred_at, at(9).toISOString());
assert.equal(display.server_received_at, at(10).toISOString());
assert.equal(exposure.timeline.filter(entry => entry.category === "System waiting").length, 2);
assert(exposure.timeline.find(entry => entry.event_type === "package_results_shown")!.action.includes("visibility unverified"));
assert(!JSON.stringify(exposure).includes("DO_NOT_EXPORT"));
assert.equal(result.items[0].timing_contract_version.length > 0, true);
assert(Array.isArray(result.items[0].timing_limitations));
assert(result.items[0].calculation_version);
const exposureCsv = parse<Record<string, string>>(processDataTimelineCsv(exposure, "synthetic"), { columns: true, bom: true });
assert.equal(exposureCsv.find(row => row.event_type === "formative_feedback_shown")!.source_turn_sequence_index, "3");
const mixedRevisions = buildProcessDataSummary({ ...base, events: [
  event("answer_changed", 5, { item_public_id: "new-item" }),
  event("option_selected", 5, { item_public_id: "new-item", payload: { revision: true } }),
  event("option_selected", 6, { item_public_id: "legacy-item", payload: { revision: true } })
] });
assert.equal(mixedRevisions.core.revision_fields.answers, 2, "Count legacy items without duplicating canonical revision aliases");
const reviewRevisions = buildProcessDataSummary({ ...base, events: [
  event("confidence_clicked", 5, { event_category: "initial_administration" }),
  event("tempting_option_submitted", 6, { event_category: "initial_administration" }),
  event("confidence_clicked", 7, { event_category: "package_review" }),
  event("tempting_option_submitted", 7, { event_category: "package_review" }),
  event("tempting_option_reason_submitted", 7, { event_category: "package_review" }),
  event("confidence_changed", 8, { event_category: "package_review" }),
  event("tempting_option_changed", 8, { event_category: "package_review" })
] });
assert.deepEqual(reviewRevisions.core.revision_fields, { answers: 0, explanations: 0, confidence: 2, alternatives: 2 });
assert.equal(reviewRevisions.timeline.filter(entry => entry.action === "Confidence revised").length, 2);
assert.equal(reviewRevisions.timeline.filter(entry => entry.action === "Alternative answer revised").length, 2);
assert.equal(reviewRevisions.timeline.filter(entry => entry.category === "Revisions").length, 4);
const featureRows = buildEngagementProcessFeatureRows({ itemResponses: [{ session_public_id: "synthetic", student_user_id: "synthetic", assessment_public_id: "synthetic",
  concept_unit_public_id: "synthetic", item_public_id: "synthetic", item_order: 1, item_started_at: at(0), item_submitted_at: at(60), item_response_time_ms: 60000, revision_count: 5 }],
  processEvents: ["confidence_clicked", "reasoning_revised"].map(event_type => ({ session_public_id: "synthetic", concept_unit_public_id: "synthetic", item_public_id: "synthetic",
    item_order: 1, event_type, event_category: "package_review", event_source: "frontend", occurred_at: at(50), created_at: at(50),
    visibility_duration_ms: null, pause_duration_ms: null, payload: {} })) });
assert.equal(featureRows[0].confidence_revision_count, 1, "Legacy package-review confidence changes also appear in research features");
assert.equal(featureRows[0].reasoning_revision_count, 1, "Generic response revisions must not inflate explanation revisions");
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
