import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { researchCsv } from "../src/lib/services/teacher-research-data/csv-contract";
import { researchCoverageFiles, ResearchCoverageAccumulator } from "../src/lib/services/teacher-research-data/coverage-report";
import { researchStudyTemplateFiles } from "../src/lib/services/teacher-research-data/study-templates";
import { buildAnalysisReadyDictionaryEntries, buildCoreResearchDictionaryEntries } from "../src/lib/services/teacher-research-data/dictionary";
import { profileRecordProvenance } from "../src/lib/services/student-assessment/profile-record";
import type { AttemptObservation } from "../src/lib/services/teacher-dashboard/attempt-comparison";

const read = (data: string) => parse(data, { columns: true }) as Record<string, string>[];
const fileRows = (files: { path: string; data: string }[], path: string) => read(files.find(f => f.path === path)!.data);
const cells = researchCsv([{ flag: true, value: 0, text: '=Not a formula\n"quoted"', at: new Date("2026-10-05Z") },
  { flag: false, value: null, text: "", at: null }, { flag: null, value: 2 }], ["flag", "value", "text", "at"]);
assert.deepEqual(read(cells).map(r => r.flag), ["true", "false", ""]);
assert.equal(read(cells)[0].value, "0");
assert.equal(read(cells)[0].text, "'=Not a formula\n\"quoted\"");
assert.equal(read(cells)[0].at, "2026-10-05T00:00:00.000Z");

const attempt: AttemptObservation = { student_key: "PRIVATE_LOGIN_MUST_NOT_EXPORT", session_public_id: "session-1",
  assessment_public_id: "assessment-1", assessment_title: "Synthetic", assessment_family_public_id: "assessment-1",
  attempt_number: 1, status: "completed", started_at: "2026-10-05T00:00:00Z", submitted_at: "2026-10-05T00:01:00Z",
  limitation: null, chance_policy: "test", chance_waived_at: null, items: [{ item_key: "item:v1:content", item_public_id: "item",
    item_version: 1, item_order: 1, stem: "PRIVATE_STEM", options: [{ label: "A", text: "PRIVATE_OPTION" }],
    objective: "Synthetic", selected_option: "A", confidence: "high", correctness: "correct", reasoning: "PRIVATE_RESPONSE",
    first_option: "A", first_confidence: "high", first_reasoning: "PRIVATE_RESPONSE", scoring_key: "SECRET_KEY",
    submitted_at: "2026-10-05T00:01:00Z", evidence_source: "sealed_initial_package" }] };
const templates = researchStudyTemplateFiles({ attempts: [attempt, { ...attempt, session_public_id: "session-2", items: [] }],
  snapshot_at: "2026-10-05T01:00:00Z", pseudonym: () => "research-anonymous" });
const cohort = fileRows(templates, "research_cohort_template.csv");
assert.equal(cohort.length, 1);
for (const field of ["consent_status", "cohort_role", "include_in_analysis"]) assert.equal(cohort[0][field], "");
const review = fileRows(templates, "human_review_template.csv");
assert.equal(review.length, 1);
assert.equal(review[0].review_status, "not_reviewed");
assert.equal(review[0].blinded_to_ai, "");
assert.equal(review[0].reasoning_rating, "");
assert.equal(fileRows(templates, "external_outcomes_template.csv").length, 0);
assert(!JSON.stringify(templates).includes("PRIVATE_"));
assert(!JSON.stringify(templates).includes("SECRET_KEY"));
const again = researchStudyTemplateFiles({ attempts: [attempt], snapshot_at: "2026-11-05Z", pseudonym: () => "research-anonymous" });
assert.equal(fileRows(again, "human_review_template.csv")[0].annotation_case_id, review[0].annotation_case_id);
const definitions = fileRows(templates, "study_template_dictionary.csv");
for (const template of templates.filter(f => f.path.endsWith("_template.csv"))) {
  for (const name of (parse(template.data) as string[][])[0]) {
    assert.equal(definitions.filter(d => d.dataset === template.path && d.variable_name === name && d.definition).length, 1);
  }
}
const files = [...templates, { path: "item_responses.csv", data: researchCsv([{ reasoning_active_typing_time_ms: null, selected_option: "A" }]) },
  { path: "response_stage_events.csv", data: cells }];
const coverage = fileRows(researchCoverageFiles(files), "data_coverage.csv");
assert(!coverage.some(r => r.dataset.endsWith("_template.csv")));
assert.equal(coverage.find(r => r.variable_name === "reasoning_active_typing_time_ms")?.collection_status, "not_collected_by_current_browser");
assert.equal(coverage.find(r => r.variable_name === "flag")?.false_count, "1");
assert.equal(coverage.find(r => r.variable_name === "flag")?.blank_count, "1");
const accumulator = new ResearchCoverageAccumulator();
files.forEach(f => accumulator.add(f));
assert.deepEqual(fileRows(accumulator.files(), "data_coverage.csv"), coverage);
const dictionary = buildAnalysisReadyDictionaryEntries();
const core = buildCoreResearchDictionaryEntries(dictionary);
assert(!core.some(r => r.variable_name === "reasoning_active_typing_time_ms"));
assert(!core.some(r => r.variable_name === "profile_valid_for_learning_analysis"));
assert(core.some(r => r.variable_name === "profile_provenance_eligible" && r.data_type === "boolean"));
const profile = profileRecordProvenance({ id: "synthetic-profile", profile_type: "initial", item_level_evidence: [],
  misconception_indicators: [], process_interpretation_cautions: [], confidence_alignment: "aligned",
  based_on_agent_call: { agent_name: "student_profiling_agent", call_status: "succeeded", output_validated: true } });
assert.equal(profile.profile_provenance_eligible, true);
assert.equal(profile.profile_provenance_eligible, profile.profile_valid_for_learning_analysis);
console.log("PASS research CSV tri-state, safe escaping, empty study worksheets, blinded-template boundaries, stable case identity, dictionary coverage, provenance aliases and streaming coverage parity; no database/provider calls.");
