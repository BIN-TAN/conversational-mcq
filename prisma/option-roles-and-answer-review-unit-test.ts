/**
 * Release 22, checked without a database or provider calls:
 * - An incorrect option may be marked as plausible but not tied to a specific idea
 *   (diagnostic_role "not_diagnostic", with what rules it out). It has no rationale, idea label or
 *   misconception reference; the interpretation still reports an idea the student states in their
 *   own words (against the target reasoning), the dashboard lists such ideas, and the feedback
 *   input lists the option with what rules it out.
 * - Publishing warns when such an option has no note, and when most of an item's options are not
 *   tied to an idea.
 * - The answer review's "Why" is the target reasoning, never the essential elements.
 * - Students' mini tests follow the library order even when archived mini tests keep a stale order.
 * Run with: npx tsx prisma/option-roles-and-answer-review-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildDistractorRationalesFromTeacherNotes,
  buildItemAdministrationRulesFromTeacherMetadata,
  notDiagnosticOptions,
  optionIdeaLabels,
  readOptionRationales,
  readTeacherItemMetadata
} from "../src/lib/services/content/teacher-diagnostic-context";
import { optionRationaleWarnings } from "../src/lib/services/content/item-publication-rules";
import { teacherOptionNotesFromImport } from "../src/lib/services/content/item-notes-import";
import { itemReferences, notDiagnosticOptionsFromPackage } from "../src/lib/services/student-assessment/interpretation-v8/input-builder";
import { conciseStudentAnswerExplanation } from "../src/lib/services/response-packages";
import { studentSafeAnswerExplanationFromResponse } from "../src/lib/services/student-assessment/evidence-integrated-profile";
import { summarizeV8Group } from "../src/lib/services/teacher-dashboard/interpretation-v8-summary";
import { orderLikeAssessmentLibrary } from "../src/lib/assessment-library-order";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${passed}. ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const rules = buildItemAdministrationRulesFromTeacherMetadata({
  administration_rules: {},
  metadata: {
    correct_option_notes: {
      target_reasoning_note: "Under Rasch every item has the same discrimination, so the number correct decides theta.",
      strong_reasoning_should_mention: "States the Rasch property\nLinks it to equal discrimination"
    },
    option_notes: [
      { label: "B", misconception_reasoning_pattern: "Weights harder items more.", idea_label: "harder items count more" },
      // Not tied to an idea: stray idea text from an earlier note is dropped.
      { label: "C", diagnostic_role: "not_diagnostic", what_rules_it_out: "The stem says the items were calibrated under Rasch only.", misconception_reasoning_pattern: "stray", idea_label: "stray" },
      { label: "D", misconception_reasoning_pattern: "Uses difficulty as the weight under 2PL.", idea_label: "difficulty as weight" }
    ]
  }
});
const labels = ["A", "B", "C", "D"];

async function main() {
  await check("an option not tied to an idea keeps only its role and what rules it out", () => {
    const notes = readTeacherItemMetadata(rules).option_notes;
    assert.deepEqual(notes.find((note) => note.label === "C"),
      { label: "C", diagnostic_role: "not_diagnostic", what_rules_it_out: "The stem says the items were calibrated under Rasch only." });
    const rationales = buildDistractorRationalesFromTeacherNotes({
      option_labels: labels, correct_option: "A", existing_rationales: { C: "An older rationale" }, option_notes: notes
    });
    assert.deepEqual(Object.keys(rationales), ["B", "D"], "No rationale, so never a misconception reference");
    assert.deepEqual([...optionIdeaLabels(rules).keys()], ["B", "D"]);
    assert.deepEqual([...notDiagnosticOptions(rules).entries()], [["C", "The stem says the items were calibrated under Rasch only."]]);
    const entries = readOptionRationales({ administration_rules: rules, distractor_rationales: rationales, option_labels: labels, correct_option: "A" });
    assert.equal(entries.find((entry) => entry.label === "C")?.diagnostic_role, "not_diagnostic");
    assert.equal(entries.find((entry) => entry.label === "B")?.diagnostic_role, "linked_idea");
    assert.equal((rules.option_misconception_map as Record<string, unknown>).C, undefined);
  });

  await check("publishing warns about a missing rule-out note and about items with mostly untied options", () => {
    const item = (optionNotes: unknown[]) => ({
      options: labels.map((label) => ({ label, text: label })),
      correct_option: "A",
      distractor_rationales: {},
      administration_rules: buildItemAdministrationRulesFromTeacherMetadata({ administration_rules: {}, metadata: { option_notes: optionNotes as never } })
    });
    assert.deepEqual(optionRationaleWarnings({ ...item([]), administration_rules: rules,
      distractor_rationales: { B: "Weights harder items more.", D: "Uses difficulty as the weight under 2PL." } }, 0), []);
    const codes = (notes: unknown[]) => optionRationaleWarnings(item(notes), 0).map((issue) => issue.code);
    assert.deepEqual(codes([
      { label: "B", misconception_reasoning_pattern: "Idea B" },
      { label: "C", diagnostic_role: "not_diagnostic" },
      { label: "D", misconception_reasoning_pattern: "Idea D" }
    ]), ["option_rule_out_note_missing"]);
    assert.deepEqual(codes([
      { label: "B", diagnostic_role: "not_diagnostic", what_rules_it_out: "x" },
      { label: "C", diagnostic_role: "not_diagnostic", what_rules_it_out: "y" },
      { label: "D", misconception_reasoning_pattern: "Idea D" }
    ]), ["many_options_not_diagnostic"]);
  });

  await check("imported option notes carry the role", () => {
    const notes = teacherOptionNotesFromImport({
      option_labels: labels, correct_option: "A",
      option_rationales: [
        { label: "B", rationale: "Weights harder items more.", idea_label: "harder items count more" },
        { label: "C", rationale: "Only Rasch is given.", idea_label: "ignored", not_tied_to_an_idea: true }
      ]
    });
    assert.deepEqual(notes.find((note) => note.label === "C"), { label: "C", diagnostic_role: "not_diagnostic", what_rules_it_out: "Only Rasch is given." });
  });

  // A sealed package item, as response-packages.ts writes it.
  const packageItem = {
    item_public_id: "q3",
    item_snapshot: { item_public_id: "q3", item_stem: "Stem", options: labels.map((label) => ({ label, text: `Option ${label}` })) },
    correct_option_snapshot: "A",
    selected_answer_final: "C",
    teacher_diagnostic_context: {
      teacher_diagnostic_context: rules.teacher_diagnostic_context as Record<string, unknown>,
      distractor_rationales: { B: "Weights harder items more.", D: "Uses difficulty as the weight under 2PL." }
    },
    student_safe_answer_explanation: "States the Rasch property Links it to equal discrimination"
  };

  await check("the interpretation gets no reference for an untied option, and feedback lists it", () => {
    const { references } = itemReferences("q3", packageItem, labels, "A");
    assert.deepEqual(references.filter((entry) => entry.kind === "distractor_rationale").map((entry) => entry.option_label), ["B", "D"]);
    assert(references.some((entry) => entry.reference_id === "q3:target"), "A stated idea can still contradict the target reasoning");
    assert.deepEqual(notDiagnosticOptionsFromPackage({ item_responses: [packageItem] }).get("q3"),
      [{ option_label: "C", what_rules_it_out: "The stem says the items were calibrated under Rasch only." }]);
    const context = source("src/lib/services/student-assessment/feedback-v8/context.ts");
    assert(context.includes("options_not_tied_to_an_idea: notTiedByItem.get(item.item_id) ?? []"));
    const contract = source("src/lib/services/student-assessment/feedback-v8/contract.ts");
    assert.equal(contract.split("not tied to a specific idea").length - 1 >= 4, true, "Both prompts describe untied options");
    assert(contract.includes("Do not suggest that the student holds a misconception. When their words do show a specific idea, address that idea."));
  });

  await check("the dashboard lists ideas students stated on untied options", () => {
    const stored = (studentKey: string, chosen: string, idea: string) => ({
      student_key: studentKey,
      attempt_number: 1,
      submitted_at: new Date("2026-10-29T00:00:00Z"),
      stored: {
        generation_mode: "live_model",
        items: [{ item_id: "q3", position: 1, selected_option: chosen, status: "not_supported", item_review_flag: false, adds_beyond_option_text: true }],
        possible_misconceptions: [{ item_ids: ["q3"], idea, contradicts_reference_id: "q3:target", endorsement: "endorsed" }],
        considered_ideas: [],
        answer_patterns: [],
        topic_summary: { label: "Still developing" },
        attempt: null
      }
    });
    const summary = summarizeV8Group([
      stored("s1", "C", "Rasch and 2PL give the same estimates."),
      stored("s2", "C", "Rasch and 2PL give the same estimates."),
      stored("s3", "B", "Harder items count more.")
    ] as never, new Map(), new Map([["q3", new Set(["C"])]]));
    assert.deepEqual(summary.ideas_on_untied_options, [{ item_number: 1, option_label: "C", students: 2, example_ideas: ["Rasch and 2PL give the same estimates."] }]);
    assert.equal(summary.possible_misconceptions[0].students, 3, "The ideas are still counted with the other possible misconceptions");
  });

  await check("the answer review shows the target reasoning, never the essential elements", () => {
    assert.equal(conciseStudentAnswerExplanation({
      options: packageItem.item_snapshot.options, correct_option: "A",
      expected_reasoning_patterns: ["States the Rasch property\nLinks it to equal discrimination"], administration_rules: rules
    }), "Under Rasch every item has the same discrimination, so the number correct decides theta.");
    // An imported item without a target reasoning: its only pattern is the essential elements, which are not shown.
    const elementsOnly = buildItemAdministrationRulesFromTeacherMetadata({ administration_rules: {}, metadata: { correct_option_notes: { strong_reasoning_should_mention: "States the Rasch property" } } });
    assert.equal(conciseStudentAnswerExplanation({ options: packageItem.item_snapshot.options, correct_option: "A",
      expected_reasoning_patterns: ["States the Rasch property"], administration_rules: elementsOnly }),
      "The correct answer is A: Option A");
    // A package sealed before release 22 without a target reasoning: its sealed essential elements are not shown either.
    const oldPackage = { ...packageItem, teacher_diagnostic_context: { teacher_diagnostic_context: { correct_option_notes: { strong_reasoning_should_mention: "States the Rasch property\nLinks it to equal discrimination" } } } };
    assert.equal(studentSafeAnswerExplanationFromResponse(oldPackage as never), "The correct answer is A: Option A");
    assert.equal(studentSafeAnswerExplanationFromResponse(oldPackage as never, { as_sealed: true }), "States the Rasch property Links it to equal discrimination");
    // Packages sealed before release 22: the review page uses the sealed target reasoning; exports keep what was sealed.
    assert.equal(studentSafeAnswerExplanationFromResponse(packageItem as never), "Under Rasch every item has the same discrimination, so the number correct decides theta.");
    assert.equal(studentSafeAnswerExplanationFromResponse(packageItem as never, { as_sealed: true }), "States the Rasch property Links it to equal discrimination");
    assert(source("src/lib/services/teacher-research-data/item-research-columns.ts").includes("{ as_sealed: true }"));
  });

  await check("students' mini tests follow the library order when archived mini tests keep a stale order", () => {
    const row = (title: string, folder: string, folderIndex: number, index: number, status = "published") =>
      ({ title, folder_label: folder, folder_order_index: folderIndex, assessment_order_index: index, status });
    const ordered = orderLikeAssessmentLibrary([
      row("Test 1", "Lecture 1", 0, 0), row("Test 8", "Lecture 4", 3, 0), row("Test 4", "Lecture 2", 1, 0),
      row("Test 8 (earlier version)", "Lecture 4", 0, 0, "archived"), row("Test 6", "Lecture 3", 2, 0)
    ]).map((entry) => entry.title);
    assert.deepEqual(ordered, ["Test 1", "Test 4", "Test 6", "Test 8", "Test 8 (earlier version)"]);
    // The list is never served from a cache, and is read again when the page is shown again.
    assert(source("src/app/api/student/assessments/available/route.ts").includes('headers: { "Cache-Control": "no-store" }'));
    assert(source("src/components/student-assessment/api.ts").includes('cache: "no-store",'));
    const list = source("src/components/student-assessment/available-assessments-client.tsx");
    assert(list.includes('window.addEventListener("pageshow", reloadIfRestored);'));
    assert(list.includes('if (document.visibilityState === "visible") void loadAssessments({ quiet: true });'));
  });

  console.log(`${passed} option role and answer review checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
