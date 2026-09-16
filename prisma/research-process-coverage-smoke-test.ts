import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { researchCoverageFiles } from "../src/lib/services/teacher-research-data/coverage-report";
import { responseStageDictionaryRows } from "../src/lib/services/teacher-research-data/response-stage-dictionary";
import { responseStageExportFiles } from "../src/lib/services/teacher-research-data/response-stage-export";
import { createResponseStageRecorder } from "../src/components/student-assessment/response-stage-recorder";
import { deriveResponseStageVisits, type ResponseStageEvent } from "../src/lib/services/student-assessment/response-stage-data";
import { responseStages } from "../src/lib/student-assessment-ui/response-observation";

const rows = (files: { path: string; data: string }[], path: string) => parse(files.find(f => f.path === path)!.data, { columns: true }) as Record<string, string>[];
let time = 1000;
const events: ResponseStageEvent[] = [];
const recorder = createResponseStageRecorder({ now: () => time, wallNow: () => new Date(1800000000000 + time).toISOString(), newId: randomUUID,
  send: e => events.push({ ...e, event_source: "frontend", occurred_at: e.client_occurred_at, payload: { ...e.payload,
    browser_tab_id: "document-1", client_event_id: randomUUID(), client_occurred_at: e.client_occurred_at, server_received_at: new Date(1800000001000 + time).toISOString() } }) });
for (const stage of responseStages.filter(stage => stage !== "package_review")) {
  const response_phase = stage === "revision" ? "review" : stage === "tempting_reason" ? "transfer" : "initial";
  recorder.ready({ item_public_id: "item-1", response_stage: stage, response_phase });
  time += 100; recorder.observe("blur"); recorder.observe("hidden"); recorder.observe("offline");
  time += 200; recorder.observe("visible"); recorder.observe("online"); recorder.observe("focus");
  if (!["answer", "confidence", "tempting_option"].includes(stage)) { time += 100; recorder.input(8); }
  time += 500; const submission = recorder.submit()!;
  events.push({ event_type: "response_stage_outcome", event_source: "backend", item_public_id: "item-1", occurred_at: new Date(1800000000500 + time),
    payload: { ...submission.link, observation_version: "response-stage-observation-v1", accepted: true, validation_rejected: false, action_status: "saved", phase: "initial_item_administration", client_action_id: randomUUID() } });
  time += 120; submission.finish(); time += 80; recorder.controlsReady(); recorder.close(); time += 100;
}
recorder.ready({ item_public_id: "item-1", response_stage: "reasoning", response_phase: "initial" });
time += 100; recorder.input(3); time += 500;
const failed = recorder.submit()!; time += 50; failed.finish(true); recorder.controlsReady(); recorder.close();
const visits = deriveResponseStageVisits(events);
assert.equal(visits.length, 7);
for (const visit of visits.slice(0, 6)) {
  assert.equal(visit.hidden_duration_ms, 200);
  assert.equal(visit.offline_duration_ms, 200);
  assert.equal(visit.focus_loss_count, 1);
  assert.equal(visit.return_count, 1);
  assert.equal(visit.request_wait_ms, 120);
  assert.equal(visit.system_wait_ms, 200);
  assert.equal(visit.accepted_submission_count, 1);
}
assert.equal(visits.at(-1)?.request_failure_count, 1);
assert.equal(visits.at(-1)?.time_to_accepted_submission_ms, null);
assert(visits.at(-1)?.timing_limitations.includes("server_outcome_missing"));
const lost = events.filter(e => !["hidden", "visible"].includes(String((e.payload as Record<string, unknown>).observation_kind)));
const damaged = deriveResponseStageVisits(lost)[0];
assert.equal(damaged.hidden_duration_ms, null, "Missing both endpoints must not turn an unknown hidden span into zero.");
assert.equal(damaged.offline_duration_ms, null);
assert.equal(damaged.request_wait_ms, null, "Sequence gaps cannot prove cumulative totals are complete.");

const files = responseStageExportFiles([{ session_public_id: "session-1", assessment_public_id: "assessment-1", research_student_id: "research-1", attempt_number: 2,
  events, items: [{ item_public_id: "item-1", item_snapshot_public_id: "snapshot-1", item_version: 1 }], turns: [] }]);
const dictionary = rows(files, "response_stage_data_dictionary.csv");
for (const file of files.filter(f => f.path.endsWith(".csv") && !f.path.includes("dictionary"))) {
  const header = (parse(file.data) as string[][])[0];
  for (const variable of header) {
    const matches = dictionary.filter(d => d.dataset === file.path && d.variable_name === variable);
    assert.equal(matches.length, 1, `${file.path}.${variable} must have one definition.`);
    const entry = matches[0];
    for (const key of ["definition", "source", "calculation", "unit", "applicability", "missing_values", "calculation_version"]) assert(entry[key], `${variable}: ${key}`);
    assert.notEqual(entry.definition, variable.replaceAll("_", " "));
  }
}
assert.throws(() => responseStageDictionaryRows([{ path: "test.csv", columns: ["undocumented_variable"] }]), /Undocumented/);
assert(dictionary.find(d => d.dataset === "item_behavior_summary.csv" && d.variable_name === "system_wait_ms")?.calculation.includes("initial/transfer"));
assert(rows(files, "response_stage_visits.csv").every(row => row.calculation_version === "response-stage-derivation-v2"));
const report = rows(researchCoverageFiles([...files,
  { path: "formative_conversation_turns.csv", data: 'actor_type,response_time_ms,message_text,flag\nstudent,0,"Multiline\nanswer",false\nagent,20,tutor,true\nstudent,,"=Private content",\n' },
  { path: "empty.csv", data: "conditional\n" }
]), "data_coverage.csv");
const student = report.find(r => r.dataset === "formative_conversation_turns.csv" && r.group_value === "student" && r.variable_name === "response_time_ms")!;
assert.equal(student.row_count, "2"); assert.equal(student.populated_count, "1"); assert.equal(student.zero_count, "1"); assert.equal(student.populated_percent, "50");
assert.equal(report.find(r => r.dataset === "empty.csv")?.coverage_status, "no_rows");
assert.equal(report.find(r => r.dataset === "empty.csv")?.populated_percent, "");
assert(report.some(r => r.dataset === "response_stage_visits.csv" && r.group_value === "reasoning" && r.variable_name === "input_start_latency_ms" && Number(r.populated_count) > 0));
assert(report.some(r => r.dataset === "response_stage_visits.csv" && r.group_value === "confidence" && r.variable_name === "input_start_latency_ms" && r.coverage_status === "all_blank"));
assert(!JSON.stringify(report).includes("Private content"));
console.log(`PASS: ${dictionary.length} explicit dictionary entries; stage clocks, interruption totals, conditional missingness and actor-separated coverage verified without provider calls.`);
