import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createResponseStageRecorder } from "../src/components/student-assessment/response-stage-recorder";
import { createFormativeInputTiming, FORMATIVE_INPUT_TIMING_METHOD } from "../src/components/student-assessment/formative-input-timing";
import { deriveResponseSubmissions, type ResponseStageEvent } from "../src/lib/services/student-assessment/response-stage-data";
import { responseStageExportFiles } from "../src/lib/services/teacher-research-data/response-stage-export";
import { separateConversationTiming } from "../src/lib/services/teacher-research-data/conversation-timing";
import { FormativeConversationInputTelemetryInputSchema, FormativeConversationTurnTelemetryInputSchema } from "../src/lib/services/student-assessment/formative-conversation/telemetry-contract";

function sample(wait: number) {
  let now = 100;
  const events: ResponseStageEvent[] = [], tab = randomUUID();
  const recorder = createResponseStageRecorder({ now: () => now, wallNow: () => new Date(1800000000000 + now).toISOString(), newId: randomUUID,
    send: e => events.push({ ...e, event_source: "frontend", payload: { ...e.payload, client_event_id: randomUUID(), browser_tab_id: tab, client_occurred_at: e.client_occurred_at } }) });
  recorder.ready({ item_public_id: "synthetic-item", response_stage: "reasoning", response_phase: "initial" });
  now += 300; recorder.input(8);
  now += 200; recorder.observe("hidden");
  now += 100; recorder.observe("visible");
  now += 400;
  const first = recorder.submit()!;
  events.push({ event_type: "response_stage_outcome", event_source: "backend", item_public_id: "synthetic-item", payload: { ...first.link, accepted: false, validation_rejected: true } });
  now += wait; first.finish(); now += 50; recorder.controlsReady();
  now += 2000; const second = recorder.submit()!;
  events.push({ event_type: "response_stage_outcome", event_source: "backend", item_public_id: "synthetic-item", payload: { ...second.link, accepted: true, validation_rejected: false } });
  now += wait; second.finish(true); now += 50; recorder.controlsReady();
  recorder.close("pause_requested");
  return events;
}
const short = sample(100), long = sample(60000);
for (const events of [short, long]) {
  const rows = deriveResponseSubmissions(events);
  assert.deepEqual(rows.map(r => r.student_response_elapsed_ms), [1000, 2000], "System waits never inflate either student interval.");
  assert(rows.every(r => r.post_request_controls_wait_ms === 50));
  assert(rows.every(r => r.submission_system_wait_ms === r.submission_request_wait_ms! + r.post_request_controls_wait_ms!));
  assert.equal(rows[1].request_result, "request_failed");
  assert.equal(rows[1].accepted, true, "Delivery failure does not erase accepted server evidence.");
  assert(rows.every(r => r.timing_quality_status === "valid"));
  assert.deepEqual(deriveResponseSubmissions([...events, ...events]), rows, "Replay is idempotent.");
}
const payload = (e: ResponseStageEvent) => e.payload as Record<string, unknown>;
const firstControls = short.find(e => payload(e).observation_kind === "controls_ready")!;
const missing = short.filter(e => e !== firstControls);
assert(deriveResponseSubmissions(missing).every(r => r.student_response_elapsed_ms === null), "Sequence gaps cannot be silently bridged.");
const missingReady = short.filter(e => payload(e).observation_kind !== "ready");
assert.equal(deriveResponseSubmissions(missingReady)[0].student_response_elapsed_ms, null);
const conflict = short.map(e => ({ ...e, payload: { ...payload(e) } }));
payload(conflict.find(e => payload(e).observation_kind === "submitted")!).browser_tab_id = randomUUID();
assert(deriveResponseSubmissions(conflict).every(r => r.submission_system_wait_ms === null));
const reversed = short.map(e => ({ ...e, payload: { ...payload(e) } }));
payload(reversed.find(e => payload(e).observation_kind === "request_finished")!).monotonic_ms = 1;
assert(deriveResponseSubmissions(reversed).every(r => r.student_response_elapsed_ms === null));
const noLastControl = short.filter(e => payload(e).observation_kind !== "controls_ready" || e === firstControls).filter(e => payload(e).observation_kind !== "closed");
assert.equal(deriveResponseSubmissions(noLastControl)[1].student_response_elapsed_ms, 2000, "Missing later UI receipt does not erase earlier contiguous student timing.");
assert.equal(deriveResponseSubmissions(noLastControl)[1].submission_system_wait_ms, null);
assert.deepEqual(deriveResponseSubmissions([]), []);
const duplicatedEndpoint = short.map(e => ({ ...e, payload: { ...payload(e) } }));
const copied = { ...firstControls, payload: { ...payload(firstControls), client_event_id: randomUUID() } };
duplicatedEndpoint.push(copied);
assert(deriveResponseSubmissions(duplicatedEndpoint).every(r => r.submission_system_wait_ms === null));
const outcomeConflict = short.find(e => e.event_type === "response_stage_outcome")!;
assert.equal(deriveResponseSubmissions([...short, { ...outcomeConflict, payload: { ...payload(outcomeConflict), accepted: true } }])[0].accepted, null);
const otherDocument = sample(200);
assert.equal(deriveResponseSubmissions([...short, ...otherDocument]).length, 4, "Separate documents/visits remain separate response windows.");

const files = responseStageExportFiles([{ session_public_id: "synthetic-session", research_student_id: "synthetic-research", assessment_public_id: "synthetic-assessment", attempt_number: 1, events: short,
  items: [{ item_public_id: "synthetic-item", item_snapshot_public_id: "synthetic-snapshot", item_version: 1 }], turns: [] }]);
const csv = (path: string) => parse(files.find(f => f.path === path)!.data, { columns: true }) as Record<string, string>[];
const rows = csv("response_submission_timing.csv"), dictionary = csv("response_stage_data_dictionary.csv");
assert.equal(rows.length, 2);
assert.equal(rows[0].accepted, "false");
assert.equal(rows[1].item_snapshot_public_id, "synthetic-snapshot");
for (const key of Object.keys(rows[0])) assert(dictionary.some(r => r.dataset === "response_submission_timing.csv" && r.variable_name === key && r.calculation), `Missing definition: ${key}`);

let now = 0, utc = 1800000000000;
const input = createFormativeInputTiming(() => now, () => new Date(utc).toISOString());
assert.equal(input.submit("restored-draft").response_time_ms, null);
input.reset(); input.input(0); now = 100; input.input(1); now = 5100; utc += 5000;
const first = input.submit("message-1");
assert.equal(first.response_time_ms, 5000);
assert.equal(first.typing_duration_method, FORMATIVE_INPUT_TIMING_METHOD);
now += 120000; utc += 120000;
assert.deepEqual(input.submit("message-1"), first, "Retry retains first Send, excluding failed requests.");
input.reset(); input.input(5); now += 3000; utc -= 100000;
const adjusted = input.submit("message-2");
assert.equal(adjusted.response_time_ms, 3000);
assert.equal(adjusted.turn_started_at, null, "Do not fabricate a UTC start after a backwards device-clock adjustment.");
assert(adjusted.typing_started_at! > adjusted.typing_ended_at);
const base = { conversation_public_id: "synthetic-conversation", conversation_turn_db_id: randomUUID() };
assert(FormativeConversationInputTelemetryInputSchema.safeParse({ ...base, client_message_id: "message-2", typing_started_at: adjusted.typing_started_at,
  typing_ended_at: adjusted.typing_ended_at, typing_duration_ms: adjusted.typing_duration_ms, typing_duration_method: adjusted.typing_duration_method,
  edit_count: 0, backspace_count: 0, paste_event_count: 0, final_message_length_chars: 5, submitted_at: adjusted.submitted_at }).success);
assert(FormativeConversationTurnTelemetryInputSchema.safeParse({ ...base, turn_started_at: adjusted.turn_started_at, turn_submitted_at: adjusted.submitted_at, response_time_ms: adjusted.response_time_ms, message_length_chars: 5 }).success);
const student = separateConversationTiming("student", first, 40000);
assert.equal(student.student_input_elapsed_ms, 5000); assert.equal(student.model_call_latency_ms, null);
assert.equal(student.student_timing_status, "monotonic_first_submission");
const agent = separateConversationTiming("agent", first, 40000);
assert.equal(agent.student_input_elapsed_ms, null); assert.equal(agent.model_call_latency_ms, 40000);
assert.equal(separateConversationTiming("student", { typing_duration_method: "active_intervals", typing_duration_ms: 5 }, null).student_input_elapsed_ms, null);
assert.equal(separateConversationTiming("student", { typing_duration_method: "elapsed_first_input_to_submit", typing_duration_ms: 5 }, null).student_timing_status, "legacy_wall_clock_retry_unverified");
input.reset(); input.input(1); now -= 1; utc -= 1;
assert.equal(input.submit("invalid-clock").response_time_ms, null);
console.log("PASS separated submission timing, waits, retries, missingness, clocks, dictionary coverage and actor-specific chat measurements; no provider calls");
