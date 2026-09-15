import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { observeAttempts, buildAttemptComparison, matchAttempts, selectSubmittedAttempts, type AttemptSource } from "../src/lib/services/teacher-dashboard/attempt-comparison";
import { attemptComparisonExportFiles } from "../src/lib/services/teacher-research-data/attempt-comparison-export";

function source(student: string, attempt: number, answer: string, options: { submitted?: boolean; version?: number; confidence?: string | null; assessment?: string } = {}): AttemptSource {
  const date = new Date(`2026-09-${String(10 + attempt).padStart(2, "0")}T10:00:00Z`);
  const assessment = options.assessment ?? "test";
  return { session_public_id: `${assessment}-${student}-${attempt}`, attempt_number: attempt, status: "active", started_at: date, created_at: date,
    user: { user_id: student }, assessment: { assessment_public_id: assessment, title: "Test", revision_family_public_id: null, concept_units: [{ id: "concept" }] },
    concept_unit_sessions: [{ concept_unit_db_id: "concept", response_packages: options.submitted === false ? [] : [{
      package_type: "initial_concept_unit_response_package", created_at: date, payload: { initial_item_count: 1,
        concept_unit: { learning_objective: "Reasoning" }, included_items: [{ item_public_id: "item" }], item_responses: [{
          item_public_id: "item", item_version_snapshot: options.version ?? 1, initial_item_position: 1,
          item_snapshot: { item_stem: "Which option?", options: [{ label: "A", text: "First" }, { label: "B", text: "Second" }] },
          selected_answer_initial: "B", selected_answer_final: answer, correctness: answer === "A" ? "correct" : "incorrect",
          correct_option_snapshot: "A", confidence_rating: options.confidence === undefined ? "high" : options.confidence,
          reasoning_text_final: "=Synthetic reasoning", reasoning_text_initial: "Original reason"
        }] }
    }] }] };
}
const inputs = [source("s1", 1, "B"), source("s1", 2, "A"), source("s1", 3, "A"),
  source("s2", 1, "A"), source("s2", 2, "B"), source("s2", 3, "A", { submitted: false }), source("s3", 1, "B")];
const attempts = observeAttempts(inputs);
const snapshot = "2026-09-15T10:00:00Z";
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
check("full submission does not require ending tutoring", () => assert(attempts[0].submitted_at));
check("latest submitted ignores newer unfinished attempts", () => assert.deepEqual(selectSubmittedAttempts(attempts, "latest").map(row => row.attempt_number), [3, 2, 1]));
check("all participant denominators", () => {
  const result = buildAttemptComparison(attempts, { snapshot_at: snapshot, eligible_student_count: 4 });
  assert.deepEqual(result.columns.map(column => column.student_count), [3, 2, 1, 3]);
  assert.deepEqual(result.columns.map(column => column.missing_student_count), [1, 2, 3, 1]);
  assert.equal(result.incomplete_attempt_count, 1);
});
check("matched students are paired before comparing", () => {
  const result = buildAttemptComparison(attempts, { snapshot_at: snapshot, mode: "matched", pair: "1-2" });
  assert.deepEqual(result.columns.map(column => column.student_count), [2, 2, 1, 2]);
  assert.equal(result.transition_summary.incorrect_to_correct, 1);
  assert.equal(result.transition_summary.correct_to_incorrect, 1);
});
check("all three filter fixes denominator", () => {
  const result = buildAttemptComparison(attempts, { snapshot_at: snapshot, all_three: true, eligible_student_count: 4 });
  assert.deepEqual(result.columns.map(column => column.student_count), [1, 1, 1, 1]);
  assert.deepEqual(result.columns.map(column => column.missing_student_count), [0, 0, 0, 0]);
  assert.equal(result.cohort_student_count, 1);
});
check("each comparison endpoint is explicit", () => {
  assert.equal(matchAttempts(attempts, "2-3").length, 1);
  assert.equal(matchAttempts(attempts, "1-3").length, 1);
  assert.equal(matchAttempts(attempts, "first-latest").length, 2);
});
check("single attempts do not become artificial no-change pairs", () => assert.equal(matchAttempts(observeAttempts([source("s1", 1, "A")]), "first-latest").length, 0));
check("changed item versions are never paired", () => {
  const result = buildAttemptComparison(observeAttempts([source("s1", 1, "B"), source("s1", 2, "A", { version: 2 })]), { snapshot_at: snapshot });
  assert.equal(result.items.length, 2); assert.equal(result.comparable_item_pairs, 0); assert.equal(result.unmatched_item_pairs, 1);
});
check("changed content with same version is never paired", () => {
  const changed = source("s1", 2, "A");
  const payload = changed.concept_unit_sessions[0].response_packages[0].payload as { item_responses: Array<{ item_snapshot: { item_stem: string } }> };
  payload.item_responses[0].item_snapshot.item_stem = "Different question";
  assert.equal(buildAttemptComparison(observeAttempts([source("s1", 1, "A"), changed]), { snapshot_at: snapshot }).comparable_item_pairs, 0);
});
check("historical attempts over three remain available as latest", () => assert.equal(selectSubmittedAttempts(observeAttempts([source("s1", 1, "B"), source("s1", 5, "A")]), "latest")[0].attempt_number, 5));
check("technical waivers retain evidence but exclude comparisons", () => {
  const observed = observeAttempts(inputs, [{ session_public_id: "test-s1-3", policy_version: "v2", waived_at: new Date(snapshot) }]);
  assert.equal(observed.length, 7); assert.equal(selectSubmittedAttempts(observed, "latest")[0].attempt_number, 2);
});
check("missing confidence is distinct from low confidence", () => {
  const result = buildAttemptComparison(observeAttempts([source("s1", 1, "A", { confidence: null })]), { snapshot_at: snapshot });
  assert.equal(result.columns[0].confidence_counts["Not recorded"], 1);
  assert.equal(result.columns[0].high_confidence_incorrect_percentage, null);
});
check("empty groups have null percentages, not zero performance", () => assert.equal(buildAttemptComparison([], { snapshot_at: snapshot }).columns[0].correct_percentage, null));
check("duplicate later packages cannot rewrite initial evidence", () => {
  const input = source("s1", 1, "B");
  const later = source("s1", 2, "A").concept_unit_sessions[0].response_packages[0];
  input.concept_unit_sessions[0].response_packages.push(later);
  assert.equal(observeAttempts([input])[0].items[0].selected_option, "B");
});
check("incomplete package cannot count as submitted", () => {
  const input = source("s1", 1, "B");
  (input.concept_unit_sessions[0].response_packages[0].payload as Record<string, unknown>).initial_item_count = 3;
  assert.equal(observeAttempts([input])[0].submitted_at, null);
});
check("assessments do not cross-pair", () => assert.equal(matchAttempts(observeAttempts([source("s1", 1, "A"), source("s1", 2, "A", { assessment: "other" })]), "1-2").length, 0));
check("original choice and submitted choice remain separate", () => { assert.equal(attempts[1].items[0].first_option, "B"); assert.equal(attempts[1].items[0].selected_option, "A"); });
check("unknown snapshots never cross-match even at identical timestamps", () => {
  const first = source("s1", 1, "A");
  const second = source("s1", 2, "A");
  for (const row of [first, second]) {
    const pkg = row.concept_unit_sessions[0].response_packages[0];
    pkg.created_at = new Date(snapshot);
    (pkg.payload as { item_responses: Array<Record<string, unknown>> }).item_responses[0].item_snapshot = {};
  }
  assert.equal(buildAttemptComparison(observeAttempts([first, second]), { snapshot_at: snapshot }).comparable_item_pairs, 0);
});
check("changed scoring key is excluded without encoding keys in public fingerprints", () => {
  const first = source("s1", 1, "A");
  const second = source("s1", 2, "A");
  (second.concept_unit_sessions[0].response_packages[0].payload as { item_responses: Array<Record<string, unknown>> }).item_responses[0].correct_option_snapshot = "B";
  const observed = observeAttempts([first, second]);
  assert.equal(observed[0].items[0].item_key, observed[1].items[0].item_key);
  assert.equal(buildAttemptComparison(observed, { snapshot_at: snapshot }).comparable_item_pairs, 0);
});
check("partial sealed package cannot count just because response rows exist", () => {
  const input = source("s1", 1, "B");
  (input.concept_unit_sessions[0].response_packages[0].payload as Record<string, unknown>).completed_initial_item_count = 0;
  assert.equal(observeAttempts([input])[0].submitted_at, null);
});
for (const restricted of [false, true]) check(`research export restricted=${restricted}`, () => {
  const files = attemptComparisonExportFiles({ attempts, snapshot_at: snapshot, pseudonym: id => `anon-${id}`, include_restricted: restricted, scope: "selected_assessment" });
  const itemFile = files.find(file => file.path === "attempt_submission_items.csv")!;
  const rows = parse(itemFile.data, { columns: true }) as Array<Record<string, string>>;
  assert.equal(rows.length, 6); assert.equal(rows[0].research_student_id, "anon-s1");
  assert.equal(rows[0].reasoning, "'=Synthetic reasoning");
  assert.equal(Object.hasOwn(rows[0], "correctness"), restricted);
  const pairs = parse(files.find(file => file.path === "attempt_paired_changes.csv")!.data, { columns: true }) as Array<Record<string, string>>;
  assert.equal(Object.hasOwn(pairs[0], "correctness_change"), restricted);
  const summaries = parse(files.find(file => file.path === "attempt_class_summaries.csv")!.data, { columns: true }) as Array<Record<string, string>>;
  assert.equal(Object.hasOwn(summaries[0], "correct_percentage"), restricted);
  assert.equal(summaries[0].snapshot_at, snapshot);
});
console.log(`${passed} attempt comparison checks passed; no database or provider calls.`);
