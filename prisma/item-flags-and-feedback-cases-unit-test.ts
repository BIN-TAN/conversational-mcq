/**
 * Release 21 additions, checked without a database or provider calls:
 * - Feedback evaluation cases (feedback-v8-eval-cases-3): a case may change the simulated
 *   student's responses (response_overrides), F19 covers a correct answer the student doubted,
 *   F20 an inaccurate idea in a tempting-option reason under a correct answer, and F01/F05 expect
 *   an opening that begins with an overview of several points.
 * - Item review v2: tutor flags in feedback conversations name items by their position in the
 *   student's response package; they join the item review, a decision answers them, and the
 *   instructor home page lists mini tests with items awaiting a decision.
 * Run with: npx tsx prisma/item-flags-and-feedback-cases-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEvaluationFixtures } from "../src/lib/evaluation/interpretation-v8/case-model";
import {
  buildFeedbackCaseInput,
  checkFeedbackFixtures,
  FEEDBACK_EVALUATION_CASES_VERSION,
  FeedbackCaseFileSchema,
  feedbackCaseStudent
} from "../src/lib/evaluation/interpretation-v8/feedback-case-model";
import { acknowledgesAllCorrect, itemNumbersNamed, overviewNamesEveryPoint, readability, scoreFeedback } from "../src/lib/evaluation/interpretation-v8/score";
import { FEEDBACK_V8_CONTRACT_VERSION, type FeedbackV8Output } from "../src/lib/services/student-assessment/feedback-v8/contract";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${passed}. ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const fixture = (file: string) => JSON.parse(source(`src/lib/evaluation/interpretation-v8/fixtures/${file}`));

async function main() {
  const { bank, cases } = parseEvaluationFixtures(fixture("item-bank.json"), fixture("cases.json"));
  const feedback = FeedbackCaseFileSchema.parse(fixture("feedback-cases.json"));
  const caseById = new Map(cases.cases.map((entry) => [entry.case_id, entry]));
  const feedbackById = new Map(feedback.cases.map((entry) => [entry.feedback_case_id, entry]));

  await check("the feedback cases (version 4 since release 22) pass their structural checks", () => {
    assert.equal(feedback.feedback_cases_version, FEEDBACK_EVALUATION_CASES_VERSION);
    assert.equal(FEEDBACK_EVALUATION_CASES_VERSION, "feedback-v8-eval-cases-6");
    assert.deepEqual(checkFeedbackFixtures(caseById, feedback, bank), []);
    for (const id of ["F19", "F20", "F21", "F22", "F23"]) assert(feedbackById.has(id), id);
    // Release 22: an option treated as not tied to an idea loses its rationale and is listed with what rules it out.
    const f21 = buildFeedbackCaseInput(bank, caseById.get("S-05")!, feedbackById.get("F21")!);
    const item1 = f21.items.find((item) => item.item_id === "S1")!;
    assert(!item1.distractor_rationales.some((entry) => entry.option_label === "A"));
    assert.deepEqual(item1.options_not_tied_to_an_idea.map((entry) => entry.option_label), ["A"]);
    assert.deepEqual(checkFeedbackFixtures(caseById, { ...feedback, cases: [{ ...feedbackById.get("F21")!, option_role_overrides: [{ item_id: "S1", option_label: "B", what_rules_it_out: "x" }] }] }, bank),
      ["F21: option role override names B, which is not an incorrect option of S1"]);
    assert.equal(feedbackById.get("F01")!.expected.expects_overview, true);
    assert.equal(feedbackById.get("F05")!.expected.expects_overview, true);
    assert.equal(feedbackById.get("F02")!.expected.expects_overview, false);
    assert.deepEqual(feedbackById.get("F01")!.expected.overview_points, [[1, 4], [2]]);
    assert.deepEqual(feedbackById.get("F05")!.expected.overview_points, [[1], [2]]);
    assert.deepEqual(feedbackById.get("F19")!.expected.strategies, ["explain", "clarify"], "A doubted answer is explained, not extended");
    const f01 = feedbackById.get("F01")!;
    assert.deepEqual(checkFeedbackFixtures(caseById, { ...feedback, cases: [{ ...f01, expected: { ...f01.expected, overview_points: [[1, 4]] } }] }),
      ["F01: an expected overview needs at least two overview points"]);
  });

  await check("response overrides change only the feedback case's student, not the base case", () => {
    const base = caseById.get("R-10")!;
    const f19 = feedbackById.get("F19")!;
    const student = feedbackCaseStudent(base, f19);
    const r3 = student.responses.find((response) => response.item_id === "R3")!;
    assert.equal(r3.confidence, "low");
    assert.match(r3.explanation ?? "", /not sure/);
    assert.equal(base.responses.find((response) => response.item_id === "R3")!.confidence, "high", "The base case is unchanged");
    const input = buildFeedbackCaseInput(bank, base, f19);
    const item3 = input.items.find((item) => item.item_id === "R3")!;
    assert.equal(item3.student_response.reported_confidence, "low");
    assert.match(item3.student_response.explanation ?? "", /not sure/);
    assert.equal(item3.interpretation?.explanation_quality, "adequate", "The reference quality still applies");
    const f20 = buildFeedbackCaseInput(bank, base, feedbackById.get("F20")!);
    assert.equal(f20.items.find((item) => item.item_id === "R4")!.student_response.tempting_option, "D");
    assert.deepEqual(checkFeedbackFixtures(caseById, { ...feedback, cases: [{ ...feedbackById.get("F19")!, response_overrides: [{ item_id: "R9", confidence: "low" }] }] }),
      ["F19: response override for unknown item R9"]);
  });

  await check("an overview is scored by the items the opening names", () => {
    assert.deepEqual(itemNumbersNamed("Two ideas are worth a look: Items 1 and 4 treat reliability as validity, and Item 2 subtracts the SEM."), [1, 2, 4]);
    assert.deepEqual(itemNumbersNamed("Items 1, 2 and 4 share one idea."), [1, 2, 4]);
    assert.deepEqual(itemNumbersNamed("Items 1, 2, and 4 share one idea."), [1, 2, 4]);
    assert.deepEqual(itemNumbersNamed("Your explanation for Item 3 is right."), [3]);
    assert.equal(overviewNamesEveryPoint("Items 1 and 4 treat consistent scores as valid, and Item 2 subtracts the SEM.", [[1, 4], [2]]), true);
    assert.equal(overviewNamesEveryPoint("Items 1 and 4 both treat consistent scores as valid.", [[1, 4], [2]]), false,
      "Discussing only the focus is not an overview");
    const output = (message: string): FeedbackV8Output => ({
      contract_version: FEEDBACK_V8_CONTRACT_VERSION,
      student_visible_message: message,
      focus: { item_numbers: [1, 4], focus_type: "possible_misconception", concept: "Reliability is not validity" },
      strategy: "explain",
      student_evidence: [],
      focus_status: null,
      instructor_review: { flag: "none", reason: null }
    });
    const runRecord = (message: string) => ({
      kind: "feedback" as const, feedback_case_id: "F01", run: 1, engine: "local" as const, model_name: "test", prompt_hash: "x",
      status: "validated" as const, reason: null, attempts: [], output: output(message), started_at: "", completed_at: ""
    });
    const withOverview = scoreFeedback({ cases: feedback, records: [runRecord("There are two points here: Items 1 and 4 treat consistent scores as valid, and Item 2 subtracts the SEM. Let us start with the first. You can continue with it, choose the other point, ask about anything else, or stop here.")] });
    const withoutOverview = scoreFeedback({ cases: feedback, records: [runRecord("Your explanations for Items 1 and 4 treat consistent scores as valid. You can ask about this or anything else, or stop here.")] });
    const criterion = (report: ReturnType<typeof scoreFeedback>) => report.criteria.find((entry) => entry.name.startsWith("Openings with several points"))!;
    assert.equal(criterion(withOverview).pass, true);
    assert.equal(criterion(withoutOverview).pass, false);
  });

  await check("an all-correct opening says every answer was correct (opening v8.8, cases-6)", () => {
    const expecting = feedback.cases.filter((entry) => entry.expected.expects_all_correct_acknowledgement).map((entry) => entry.feedback_case_id);
    assert.deepEqual(expecting, ["F02", "F04", "F07", "F10", "F19", "F20"], "Every opening whose student answered every item correctly");
    const f07 = feedbackById.get("F07")!;
    assert.deepEqual(checkFeedbackFixtures(caseById, { ...feedback, cases: [{ ...f07, expected: { ...f07.expected, expects_all_correct_acknowledgement: false } }] }, bank),
      ["F07: expects_all_correct_acknowledgement must be true (every answer is correct)"]);
    const f01 = feedbackById.get("F01")!;
    assert.deepEqual(checkFeedbackFixtures(caseById, { ...feedback, cases: [{ ...f01, expected: { ...f01.expected, expects_all_correct_acknowledgement: true } }] }, bank),
      ["F01: expects_all_correct_acknowledgement must be false (every answer is not correct)"]);
    assert.equal(acknowledgesAllCorrect("You chose the correct option on every item, and your explanation for Item 1 clearly separates reliability from validity. Two points could make your reasoning more complete."), true);
    assert.equal(acknowledgesAllCorrect("All of your answers were right. Your reasoning on Item 2 was especially clear."), true);
    // Release 33: "correctly" also counts (two release 32 openings said "You answered every item correctly").
    assert.equal(acknowledgesAllCorrect("This mini-test checked reliability. You answered every item correctly, and Item 1 was clear."), true);
    assert.equal(acknowledgesAllCorrect("This mini-test checked reliability. You chose correctly on every item."), true);
    assert.equal(acknowledgesAllCorrect("Your explanation for Item 3 is right about the group. There are two points to look at."), false);
    assert.equal(acknowledgesAllCorrect("This mini-test checked how item parameters shape an ICC. You chose the correct option on every item. Two points could make your reasoning more complete."), true,
      "What the mini-test checked may come first");
    assert.equal(acknowledgesAllCorrect("This mini-test checked ICCs. There are two points. Item 1 concerns steepness. Item 2 concerns the lower tail. Start with Item 1. You chose the correct option on every item."), false,
      "Saying so only at the end of the message does not count");
    const output = (message: string): FeedbackV8Output => ({
      contract_version: FEEDBACK_V8_CONTRACT_VERSION, student_visible_message: message,
      focus: { item_numbers: [1], focus_type: "single_item", concept: "Limited reasoning" }, strategy: "clarify",
      student_evidence: [], focus_status: null, instructor_review: { flag: "none", reason: null }
    });
    const runRecord = (id: string, message: string) => ({
      kind: "feedback" as const, feedback_case_id: id, run: 1, engine: "local" as const, model_name: "test", prompt_hash: "x",
      status: "validated" as const, reason: null, attempts: [], output: output(message), started_at: "", completed_at: ""
    });
    const praise = "You chose the correct option on every item, and your explanation for Item 1 names the key idea. How would you connect it to Item 2?";
    const report = scoreFeedback({ cases: feedback, records: [runRecord("F07", praise), runRecord("F01", praise), runRecord("F02", "Your explanation for Item 1 is clear. Would you like to try a new case?")] });
    const named = (start: string) => report.criteria.find((entry) => entry.name.startsWith(start))!;
    assert.equal(named("All-correct openings").value, 0.5, "F07 says so, F02 does not");
    assert.equal(named("Openings that say every answer was correct").value, 1, "F01's student did not answer every item correctly");
    assert.equal(named("Openings that say every answer was correct").pass, false);
  });

  await check("openings report readability: words per sentence and long sentences (opening v8.9)", () => {
    const short = readability("This mini-test checked item information. You chose the right option on every item.\n\nTwo points could make your reasoning clearer.");
    assert.deepEqual(short, { words: 20, sentences: 3, words_per_sentence: 6.667, long_sentences: 0 });
    const long = readability("This mini-test checked how item characteristics affect measurement precision at a particular ability level, how information connects to measurement error, and how to choose items for a test's purpose.");
    assert.equal(long.sentences, 1);
    assert.equal(long.long_sentences, 1);
    assert.equal(readability("").words_per_sentence, null);
    const output = (message: string): FeedbackV8Output => ({
      contract_version: FEEDBACK_V8_CONTRACT_VERSION, student_visible_message: message,
      focus: { item_numbers: [1], focus_type: "single_item", concept: "Limited reasoning" }, strategy: "clarify",
      student_evidence: [], focus_status: null, instructor_review: { flag: "none", reason: null }
    });
    const record = (id: string, message: string) => ({
      kind: "feedback" as const, feedback_case_id: id, run: 1, engine: "local" as const, model_name: "test", prompt_hash: "x",
      status: "validated" as const, reason: null, attempts: [], output: output(message), started_at: "", completed_at: ""
    });
    const report = scoreFeedback({ cases: feedback, records: [record("F02", "Short and clear. One idea each."), record("F07", Array(260).fill("word").join(" ") + ".")] });
    const named = (start: string) => report.criteria.find((entry) => entry.name.startsWith(start))!;
    assert.equal(report.criteria.some((entry) => entry.name.includes("250 words")), false, "Length is not limited");
    assert.equal(named("Opening sentences over 25 words").value, 0.333);
  });

  await check("tutor flags are tied to the items they name, by the student's item numbers", async () => {
    const { itemNumbersInText, itemPublicIdsForTutorFlag, tutorFlagItemNumbers } = await import("../src/lib/services/item-review/service");
    assert.deepEqual(itemNumbersInText("Item 3: options B and C overlap."), [3]);
    assert.deepEqual(itemNumbersInText("Items 1 and 4, and Question 2; also Q5."), [1, 2, 4, 5]);
    assert.deepEqual(itemNumbersInText("The 2PL model needs discriminations."), []);
    assert.deepEqual(itemNumbersInText("Items 1, 2, and 4 overlap; Items 5 or 6 too."), [1, 2, 4, 5, 6]);
    // The reason names the item; the focus may be about something else (F05: focus 1 and 2, flag on 4).
    assert.deepEqual(tutorFlagItemNumbers({ reason: "Item 4 may allow two readings.", focus: { item_numbers: [1, 2] } }, []), [4]);
    assert.deepEqual(tutorFlagItemNumbers({ reason: "The reading may be defensible.", focus: { item_numbers: [1, 2] } }, [2, 3]), [2]);
    assert.deepEqual(tutorFlagItemNumbers({ reason: "The reading may be defensible.", focus: { item_numbers: [1] } }, [3]), [3]);
    assert.deepEqual(tutorFlagItemNumbers({ reason: "The reading may be defensible.", focus: { item_numbers: [2] } }, []), [2]);
    assert.deepEqual(tutorFlagItemNumbers({ reason: "Something is off.", focus: { item_numbers: [1, 2] } }, []), [], "Untied rather than guessed");
    const payload = {
      concept_unit: { learning_objective: "Objective", related_concept_description: "Topic" },
      item_responses: [
        { item_public_id: "item_b", initial_item_position: 2, item_snapshot: { item_public_id: "item_b", item_stem: "B?", options: [] } },
        { item_public_id: "item_a", initial_item_position: 1, item_snapshot: { item_public_id: "item_a", item_stem: "A?", options: [] } },
        { item_public_id: "item_c", initial_item_position: 3, item_snapshot: { item_public_id: "item_c", item_stem: "C?", options: [] } }
      ]
    };
    assert.deepEqual(itemPublicIdsForTutorFlag({ reason: "Item 3 is unclear.", focus: { item_numbers: [1] } }, payload),
      { item_public_ids: ["item_c"], item_numbers: [3] }, "Number n is the n-th item by position");
    assert.deepEqual(itemPublicIdsForTutorFlag({ reason: "Items 1, 2 and 9 overlap." }, payload).item_public_ids, ["item_a", "item_b"]);
    assert.deepEqual(itemPublicIdsForTutorFlag({ reason: "Unclear.", focus: { item_numbers: [1, 3] } }, payload, new Set(["item_c"])).item_public_ids, ["item_c"]);
    assert.deepEqual(itemPublicIdsForTutorFlag({ focus: {} }, payload).item_public_ids, []);
    assert.deepEqual(itemPublicIdsForTutorFlag({ reason: "Item 1." }, null).item_public_ids, []);
  });

  await check("tutor flags join the item review, a decision answers them, and the home page lists items awaiting review", () => {
    const service = source("src/lib/services/item-review/service.ts");
    assert(service.includes('reason_code: "possible_item_issue"'));
    assert(service.includes('data: { status: "resolved", resolved_at: new Date() }'));
    assert(service.includes("answeredByDecisions(signal, decidedAt)"), "A flag naming several items waits for a decision on each");
    assert(service.includes("signal.created_at.getTime() > decidedAt"), "Only a flag after the decision asks for attention again");
    assert(service.includes("array_contains: [{ item_review_flag: true }]"), "The home page pre-query reads only mini tests with flags");
    assert(service.includes("export async function listItemsAwaitingReview("));
    assert(service.includes("awaiting_decision:"));
    const home = source("src/app/teacher/page.tsx");
    assert(home.includes("listItemsAwaitingReview({ teacher_user_db_id: user.user_db_id })"));
    assert(home.includes("Items flagged for your review"));
    assert(home.includes("&view=items"));
    const dashboardPage = source("src/app/teacher/dashboard/page.tsx");
    assert(dashboardPage.includes('initialView={view === "items" ? "items" : "overview"}'));
    assert(dashboardPage.includes('error.code === "not_found"'), "An unknown or foreign mini test in the link falls back to the default");
    const panel = source("src/components/teacher-dashboard/item-review-panel.tsx");
    assert(panel.includes("item.tutor_flags.map"));
    assert(panel.includes("New flag since your decision"));
    assert(panel.includes("Tutor flags that do not name an item"));
    assert(!panel.includes("answered by your decision"));
    const contract = source("src/lib/services/student-assessment/feedback-v8/contract.ts");
    assert.equal(contract.split("the reason names the item as the student saw it (Item 3)").length - 1, 2, "Both prompts ask the tutor to name the item");
  });

  console.log(`${passed} item flag and feedback case checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
