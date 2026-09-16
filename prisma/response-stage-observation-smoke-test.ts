import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createResponseStageRecorder } from "../src/components/student-assessment/response-stage-recorder";
import { deriveResponseStageVisits, summarizeItemStageVisits, type ResponseStageEvent } from "../src/lib/services/student-assessment/response-stage-data";
import { deriveItemTiming } from "../src/lib/services/student-assessment/timing-contract";
import { responseStageExportFiles } from "../src/lib/services/teacher-research-data/response-stage-export";
import { ResponseObservationPayloadSchema } from "../src/lib/student-assessment-ui/response-observation";

let time = 1000, wallOffset = 0;
const tab = randomUUID();
const events: ResponseStageEvent[] = [];
const recorder = createResponseStageRecorder({ now: () => time, wallNow: () => new Date(1800000000000 + time + wallOffset).toISOString(), newId: randomUUID,
  send: e => { events.push({ ...e, event_source: "frontend", occurred_at: e.client_occurred_at, payload: {
    ...e.payload, client_event_id: randomUUID(), browser_tab_id: tab, client_occurred_at: e.client_occurred_at
  } }); } });
const ready = (stage: "answer" | "reasoning" | "confidence" | "tempting_option", phase: "initial" | "review" = "initial") => recorder.ready({ item_public_id: "item-1", response_stage: stage, response_phase: phase });
const submit = (accepted = true) => {
  const action = recorder.submit()!;
  assert(action);
  events.push({ event_type: "response_stage_outcome", event_source: "backend", item_public_id: "item-1", occurred_at: new Date(1800000000000 + time + 500),
    payload: { ...action.link, accepted, validation_rejected: !accepted } });
  return action;
};
ready("answer"); ready("answer");
assert.equal(events.length, 1, "Repeated renders are not extra visits.");
time = 4000; const answer = submit();
const pendingCount = events.length;
recorder.controlsReady();
assert.equal(events.length, pendingCount, "A rapid UI event cannot finish an in-flight request.");
assert.equal(recorder.submit(), null, "Duplicate submission stays blocked until the request finishes.");
time = 5000; answer.finish(); time = 5500; recorder.controlsReady(); ready("reasoning");
const finishedCount = events.length;
answer.finish(true);
assert.equal(events.length, finishedCount, "Post-response refresh failures cannot duplicate request completion.");
time = 7500; recorder.input(1); recorder.input(8);
time = 8000; recorder.observe("hidden"); time = 9000; recorder.observe("visible");
time = 10000; const rejected = submit(false);
time = 11000; rejected.finish(); recorder.controlsReady();
time = 12000; recorder.input(40); const explanation = submit();
time = 12500; explanation.finish(); time = 13000; recorder.controlsReady(); ready("confidence");
time = 14000; const confidence = submit();
time = 15000; confidence.finish(); recorder.controlsReady(); ready("tempting_option");
time = 16000; const alternative = submit(); time = 16500; alternative.finish(); recorder.controlsReady(); recorder.close();

let visits = deriveResponseStageVisits(events);
assert.equal(visits.length, 4);
assert.equal(visits[0].response_elapsed_ms, 3000);
assert.equal(visits[0].request_wait_ms, 1000);
assert.equal(visits[0].system_wait_ms, 1500);
assert.equal(visits[1].input_start_latency_ms, 2000);
assert.equal(visits[1].input_elapsed_ms, 2500);
assert.equal(visits[1].hidden_duration_ms, 1000);
assert.equal(visits[1].submission_count, 2);
assert.equal(visits[1].accepted_submission_count, 1);
assert.equal(visits[1].validation_rejection_count, 1);
assert.equal(visits[1].input_change_count, 3);
assert(visits.every(v => v.timing_quality_status === "valid"));
assert.equal(deriveResponseStageVisits([...events, ...events]).length, 4, "Delivery duplicates do not duplicate visits.");
assert.equal(deriveResponseStageVisits([...events, ...events])[1].submission_count, 2);
assert.equal(deriveResponseStageVisits([...events, ...events])[1].validation_rejection_count, 1);
const summary = summarizeItemStageVisits(visits);
assert.equal(summary.confidence_time_ms, 1000);
const timing = deriveItemTiming({ events, item_submitted_at: new Date() });
assert.equal(timing.timing_contract_version, "timing-contract-v4");
assert.equal(timing.reasoning_start_latency_ms, 2000);
assert.equal(timing.item_elapsed_response_time_ms, 15000);
assert.equal(timing.reasoning_active_typing_time_ms, null);
assert.equal(timing.reasoning_elapsed_time_ms, 6500, "Accepted latency includes the rejected attempt and retry.");
assert.equal(timing.last_action_to_submission_ms, null, "No unobserved timing is fabricated as zero.");

time = 20000; ready("reasoning", "review"); time = 21000; recorder.input(10); time = 22000; const edit = submit();
time = 23000; edit.finish(); recorder.controlsReady(); recorder.close();
assert.equal(summarizeItemStageVisits(deriveResponseStageVisits(events)).reasoning_time_ms, 4500, "Review does not replace initial timing.");

time = 24000; ready("answer"); wallOffset = -999999;
time = 25000; const clock = submit(); time = 26000; clock.finish(); recorder.controlsReady(); recorder.close("pause_requested");
visits = deriveResponseStageVisits(events);
assert.equal(visits.find(v => v.ready_monotonic_ms === 24000)?.response_elapsed_ms, 1000, "Wall-clock adjustments do not change within-document durations.");
const missingReady = events.filter(e => (e.payload as Record<string, unknown>).observation_kind !== "ready");
assert.equal(deriveResponseStageVisits(missingReady)[0].response_elapsed_ms, null);
const missingReturn = events.filter(e => (e.payload as Record<string, unknown>).observation_kind !== "visible");
assert.equal(deriveResponseStageVisits(missingReturn).find(v => v.response_stage === "reasoning")?.hidden_duration_ms, null);
const damaged = events.map(e => ({ ...e, payload: { ...(e.payload as object) } }));
(damaged[1].payload as Record<string, unknown>).monotonic_ms = -1;
assert.notEqual(deriveResponseStageVisits(damaged)[0].timing_quality_status, "valid");
assert.equal(summarizeItemStageVisits([]).system_wait_ms, null);
assert.equal(deriveItemTiming({ events: [] }).timing_contract_version, "timing-contract-v3");
assert(!ResponseObservationPayloadSchema.safeParse({ ...(events[0].payload as object), raw_text: "never collect" }).success);

const files = responseStageExportFiles([{ session_public_id: "session-1", research_student_id: "research-1", assessment_public_id: "assessment-1", attempt_number: 1,
  events, items: [{ item_public_id: "item-1", item_snapshot_public_id: "snapshot-1", item_version: 1 }],
  turns: [{ sequence_index: 8, created_at: new Date(), item_public_id: "item-1", structured_payload: {
    source: "student_response_in_flow_edit", changed_fields: ["reasoning"], revision_phase: "before_initial_submission",
    previous_response: { reasoning_text: "Earlier reasoning" }, reasoning_text: "=Updated reasoning"
  } }] }]);
const csv = (name: string) => parse(files.find(f => f.path === name)!.data, { columns: true }) as Record<string, string>[];
assert.equal(csv("response_revision_history.csv")[0].previous_value, "Earlier reasoning");
assert.equal(csv("response_revision_history.csv")[0].new_value, "'=Updated reasoning", "Spreadsheet formulas must be escaped.");
assert.equal(csv("response_stage_visits.csv")[0].research_student_id, "research-1");
assert(csv("response_stage_data_dictionary.csv").some(r => r.variable_name === "system_wait_ms"));
assert(!files.find(f => f.path === "response_stage_events.csv")!.data.includes("Earlier reasoning"));
console.log("PASS response-stage timing, retries, revisions, clocks, visibility, missing data, exports and privacy; provider calls: 0");
