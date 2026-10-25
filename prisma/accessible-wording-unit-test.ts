/**
 * Accessible wording for the instructor's existing items (existing-mcq-import-v4, output v2).
 * - The import keeps the verbatim copy and adds, per item, a simpler version at a grade 8 to 10
 *   reading level that keeps key terms, numbers, formulas, tables, options and key.
 * - Code, not the model, decides whether that version may be used: same option count and letters,
 *   every key term and symbol verbatim, formulas, table lines and numbers unchanged, key unchanged,
 *   and the key not made the longest or the only hedged option. Otherwise the item keeps the
 *   instructor's wording and the teacher is told why.
 * - Each item starts with the simpler wording when it passed (unless the teacher turned the setting
 *   off), and the teacher switches each item on its own; the added item records which wording it used.
 * - Generation and revision write at the same reading level.
 * No database or provider calls. Run with: npx tsx prisma/accessible-wording-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  accessibleWordingProblems,
  containsTerm,
  detectedTerms,
  formulaSegments,
  numbersIn,
  readAccessibleWordingRecord,
  reviewAccessibleWording,
  tableLines,
  wordingProvenance,
  wordingVersionAfterChoice,
  type AccessibleWordingProposal,
  type ItemWording
} from "../src/lib/item-content/accessible-wording";
import {
  EXISTING_ITEMS_PROMPT_VERSION,
  EXISTING_ITEMS_SCHEMA_VERSION,
  existingItemDrafts,
  ExistingItemsOutputSchema,
  ITEM_DESIGN_BLUEPRINT_VERSION,
  ITEM_GENERATION_PROMPT_VERSION,
  ITEM_REVISION_PROMPT_VERSION,
  type ExistingItemsOutput,
  type ItemDesignBlueprint
} from "../src/lib/services/content/item-design-contract";
import {
  accessibleWordingOf,
  assistantCheckHeadline,
  assistantCheckOf,
  chooseWording,
  wordingEditedSinceChoice,
  wordingVersionOf
} from "../src/components/teacher-content/mcq-review";
import type { McqImportCandidate } from "../src/components/teacher-content/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${passed}. ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  assert(from >= 0, start);
  const to = text.indexOf(end, from);
  assert(to > from, end);
  return text.slice(from, to);
};

const original: ItemWording = {
  stem: "Under the Rasch model, a student's probability of a correct response is determined by the discrepancy between θ and the item's difficulty parameter b. If θ = 1.5 and b = 0.5, which statement is accurate?",
  options: [
    { label: "A", text: "The probability is below 0.5 because θ exceeds b." },
    { label: "B", text: "The probability is above 0.5 because θ exceeds b." },
    { label: "C", text: "The probability equals 0.5 because the logit is 1." },
    { label: "D", text: "The probability cannot be determined without the ICC." }
  ]
};
const simpler: AccessibleWordingProposal = {
  changed: true,
  stem: "In the Rasch model, the probability of a correct answer depends on the gap between θ and the item difficulty b. Suppose θ = 1.5 and b = 0.5. Which statement is true?",
  options: [
    { label: "A", text: "The probability is below 0.5 because θ is larger than b." },
    { label: "B", text: "The probability is above 0.5 because θ is larger than b." },
    { label: "C", text: "The probability equals 0.5 because the logit is 1." },
    { label: "D", text: "The probability cannot be found without the ICC." }
  ],
  key_terms: ["Rasch", "θ", "b", "logit", "ICC", "probability"],
  change_note: "Shorter sentences and more common words."
};
const review = (proposal: AccessibleWordingProposal | null, key: string | null = "B", requested = true) =>
  reviewAccessibleWording({ original, proposal, key, requested, prompt_version: EXISTING_ITEMS_PROMPT_VERSION });
const withOption = (label: string, text: string): AccessibleWordingProposal => ({
  ...simpler,
  options: simpler.options.map((option) => option.label === label ? { label, text } : option)
});

check("Term matching: whole words, one-character symbols exactly, a capital only at the first letter", () => {
  assert(containsTerm("the item difficulty b.", "b"));
  assert(!containsTerm("the item difficulty B.", "b"), "b and B are different parameters");
  assert(!containsTerm("a probable answer", "b"), "Not inside a word");
  assert(containsTerm("Reliability is high.", "reliability"), "Sentence-initial capital is the same term");
  assert(!containsTerm("RELIABILITY", "reliability"), "Only the first letter may differ in case");
  assert(containsTerm("under   local\nindependence", "local independence"), "Spacing is normalized");
  assert(containsTerm("θ = 1", "θ") && !containsTerm("Θ = 1", "θ"), "θ and Θ differ");
  assert(!containsTerm("Θ_j", "θ_j"), "A term starting with a Greek letter keeps its case");
  assert.deepEqual(detectedTerms("Use the ICC under the 3PL model with θ, but NOT $\\Theta$."), ["ICC", "3PL", "NOT", "θ"]);
  assert(!/\/\(\?<[!=]/.test(source("src/lib/item-content/accessible-wording.ts")),
    "No lookbehind regex literals in a module bundled for the review page");
});

check("Formulas, table lines and numbers are read the way the item renderer reads them", () => {
  assert.deepEqual(formulaSegments("If $P(\\theta) = 0.7$ and $$x^2$$, costs $5 and $10."), ["$P(\\theta) = 0.7$", "$$x^2$$"]);
  assert.deepEqual(tableLines("Scores:\n| Item | p |\n| --- | --- |\n| 1 | 0.4 |\nWhich item?"), ["| Item | p |", "| --- | --- |", "| 1 | 0.4 |"]);
  assert.deepEqual(tableLines("Absolute value $|x|$ is not a table."), []);
  assert.deepEqual(numbersIn("If θ = 1.5 and b = 0.5 (in $x_2$) with 1,000 students"), ["1.5", "0.5", "1,000"]);
});

check("A simpler version that keeps everything is used and is the default", () => {
  const record = review(simpler);
  assert.equal(record.status, "accessible");
  assert.equal(record.default_version, "accessible");
  assert.deepEqual(record.accessible?.options.map((option) => option.label), ["A", "B", "C", "D"]);
  assert.deepEqual(record.original, original, "The original wording is kept word for word");
  assert.deepEqual(record.fallback_reasons, []);
  assert.equal(record.teacher_note, null);
  assert.equal(record.change_note, "Shorter sentences and more common words.");
  assert.equal(JSON.stringify(record).includes("grade_level"), false, "No readability grade is stored");
});

check("Unchanged, identical and not requested versions keep the wording as written", () => {
  for (const record of [
    review({ changed: false, stem: null, options: [], key_terms: ["Rasch"], change_note: null }),
    review({ ...simpler, stem: `${original.stem}  `, options: original.options })
  ]) {
    assert.equal(record.status, "unchanged");
    assert.equal(record.default_version, "as_written");
    assert.equal(record.accessible, null);
  }
  const off = review(simpler, "B", false);
  assert.equal(off.status, "not_requested");
  assert.equal(off.default_version, "as_written");
  assert.equal(off.accessible, null, "The teacher kept the wording as written; no simpler version is offered");
  assert.equal(review(null).status, "unchanged", "A missing proposal is treated as unchanged");
});

check("Each failed check falls back to the original wording with a plain note for the teacher", () => {
  const cases: Array<[string, AccessibleWordingProposal, RegExp]> = [
    ["an option is missing", { ...simpler, options: simpler.options.slice(0, 3) }, /did not keep the same answer options/],
    ["letters changed", { ...simpler, options: simpler.options.map((option, index) => ({ ...option, label: "ABCE"[index]! })) }, /same answer options/],
    ["options reordered", { ...simpler, options: [simpler.options[1]!, simpler.options[0]!, ...simpler.options.slice(2)] }, /same answer options/],
    ["empty stem", { ...simpler, stem: null }, /it was incomplete/],
    ["a key term dropped", withOption("C", "The probability is 0.5 because the log-odds is 1."), /did not keep the term "logit" exactly as written/],
    ["a symbol dropped", { ...simpler, stem: simpler.stem!.replaceAll("θ", "ability") }, /term "θ"/],
    ["an unlisted abbreviation dropped", { ...withOption("D", "You need the item curve to find the probability."), key_terms: [] }, /term "ICC"/],
    ["a number changed", { ...simpler, stem: simpler.stem!.replace("θ = 1.5", "θ = 1.50") }, /it changed a number/],
    ["a number written as a word", withOption("C", "The probability is one half because the logit is 1."), /it changed a number/],
    ["the key made the longest", withOption("B", "The probability is above 0.5 because θ is larger than b, so the student is more likely to answer correctly."),
      /made the correct answer the longest option/],
    ["only the key hedged", withOption("B", "The probability is usually above 0.5 as θ > b."), /hedging word such as "usually"/]
  ];
  // Changes that reverse what an item asks or move an idea to another letter.
  const meaning: Array<[string, ItemWording, ItemWording, string[], RegExp]> = [
    ["not dropped", { ...original, stem: "Which statement is not true when θ = 1.5 and b = 0.5?" },
      { ...original, stem: "Which statement is true when θ = 1.5 and b = 0.5?" }, [], /the word "not"/],
    ["contraction kept", { ...original, stem: "Which statement does not hold when θ = 1.5 and b = 0.5?" },
      { ...original, stem: "Which statement doesn't hold when θ = 1.5 and b = 0.5?" }, [], /^$/],
    ["except dropped", { ...original, stem: "All describe θ = 1.5 and b = 0.5 except which?" },
      { ...original, stem: "All describe θ = 1.5 and b = 0.5. Which one?" }, [], /the word "except"/],
    ["at least to at most", { ...original, stem: "With at least 2 items, θ = 1.5 and b = 0.5. What follows?" },
      { ...original, stem: "With at most 2 items, θ = 1.5 and b = 0.5. What follows?" }, [], /the word "least"/],
    ["increases to decreases", { ...original, stem: "As θ increases from 1.5 with b = 0.5, what happens?" },
      { ...original, stem: "As θ decreases from 1.5 with b = 0.5, what happens?" }, [], /the word "increase"/],
    ["numbers swapped", original, { ...original, stem: original.stem.replace("θ = 1.5", "θ = X").replace("b = 0.5", "b = 1.5").replace("θ = X", "θ = 0.5") }, [], /order of the numbers/],
    ["sign dropped", { ...original, stem: "A student has θ = -1.5 and the item has b = 0.5. What is true?" },
      { ...original, stem: "A student has θ = 1.5 and the item has b = 0.5. What is true?" }, [], /it changed a number/],
    ["percent dropped", { ...original, stem: "With 95% of students, θ = 1.5 and b = 0.5. What is true?" },
      { ...original, stem: "With 95 of students, θ = 1.5 and b = 0.5. What is true?" }, [], /it changed a number/],
    ["option ideas swapped", original, { ...original, options: [
      { label: "A", text: original.options[1]!.text }, { label: "B", text: original.options[0]!.text }, ...original.options.slice(2)] }, [],
      /matched a different option's idea/],
    ["listed term in other case", { ...original, stem: "Under the Standard Error of Measurement, θ = 1.5 and b = 0.5. What is true?" },
      { ...original, stem: "Under the error, θ = 1.5 and b = 0.5. What is true?" }, ["standard error of measurement"], /term "standard error of measurement"/],
    ["listed term in plural", { ...original, stem: "The item parameters give θ = 1.5 and b = 0.5. What is true?" },
      { ...original, stem: "These values give θ = 1.5 and b = 0.5. What is true?" }, ["item parameter"], /term "item parameter"/],
    ["listed term in -ies plural", { ...original, stem: "Student abilities give θ = 1.5 and b = 0.5. What is true?" },
      { ...original, stem: "Students give θ = 1.5 and b = 0.5. What is true?" }, ["ability"], /term "ability"/],
    ["negative to positive", { ...original, stem: "An item with negative discrimination has θ = 1.5 and b = 0.5. What is true?" },
      { ...original, stem: "An item with positive discrimination has θ = 1.5 and b = 0.5. What is true?" }, [], /the word "negative"/],
    ["a range written with a hyphen", { ...original, stem: "For grades 8-10, θ = 1.5 and b = 0.5. What is true?" },
      { ...original, stem: "For grades 8 to 10, θ = 1.5 and b = 0.5. What is true?" }, [], /^$/],
    ["Item No. is not the word no", { ...original, stem: "In item No. 3, θ = 1.5 and b = 0.5. What is true?" },
      { ...original, stem: "In item 3, θ = 1.5 and b = 0.5. What is true?" }, [], /^$/]
  ];
  for (const [name, before, after, terms, reason] of meaning) {
    const problems = accessibleWordingProblems({ original: before, accessible: after, key_terms: terms, key: "B" });
    if (reason.source === "^$") assert.deepEqual(problems, [], name);
    else assert(problems.some((problem) => reason.test(problem)), `${name}: ${problems.join("; ")}`);
  }
  for (const [name, proposal, reason] of cases) {
    const record = review(proposal);
    assert.equal(record.status, "fallback", name);
    assert.equal(record.default_version, "as_written", name);
    assert.equal(record.accessible, null, name);
    assert(record.rejected_proposal, `${name}: the proposal is kept for the research record`);
    assert.match(record.teacher_note ?? "", /^The assistant suggested simpler wording for this item, but it was not used because /, name);
    assert.match(record.teacher_note ?? "", /\. The item keeps your wording\.$/, name);
    assert.match(record.teacher_note ?? "", reason, name);
    assert.doesNotMatch(record.teacher_note ?? "", /_/, `${name}: no internal names`);
  }
});

check("Formulas and tables must stay exactly as written", () => {
  const formula: ItemWording = { stem: "Given $P(\\theta) = \\frac{1}{1 + e^{-(\\theta - b)}}$, what happens when θ rises?", options: [
    { label: "A", text: "P rises." }, { label: "B", text: "P falls." }] };
  const table: ItemWording = { stem: "Which item is hardest?\n| Item | p |\n| --- | --- |\n| 1 | 0.4 |", options: [
    { label: "A", text: "Item 1" }, { label: "B", text: "Item 2" }] };
  const run = (wording: ItemWording, stem: string) => reviewAccessibleWording({ original: wording,
    proposal: { changed: true, stem, options: wording.options, key_terms: [], change_note: null }, key: "A", requested: true, prompt_version: "x" });
  assert.equal(run(formula, "Given $P(\\theta) = \\frac{1}{1 + e^{-(\\theta - b)}}$, what happens to P when θ rises?").status, "accessible");
  assert.match(run(formula, "Given $P(\\theta) = \\frac{1}{1 + e^{-(\\theta - b)}}$, what happens if θ goes up?").teacher_note ?? "", /the word "increase"/,
    "Losing \"rises\" is treated as a possible change of meaning");
  assert.match(run(formula, "Given $P(\\theta) = 1/(1 + e^{-(\\theta - b)})$, what happens if θ goes up?").teacher_note ?? "", /changed a formula/);
  assert.equal(run(table, "Which item is the hardest?\n| Item | p |\n| --- | --- |\n| 1 | 0.4 |").status, "accessible");
  assert.match(run(table, "Which item is the hardest?\n| Item | p value |\n| --- | --- |\n| 1 | 0.4 |").teacher_note ?? "", /changed a table/);
  assert.deepEqual(accessibleWordingProblems({ original: formula, accessible: formula, key_terms: [], key: "C" }),
    ["it did not keep the correct answer"], "A key that is not an option fails closed");
});

check("Stored records are read back safely; earlier batches have none", () => {
  const record = review(simpler);
  assert.deepEqual(readAccessibleWordingRecord(JSON.parse(JSON.stringify(record))), record);
  assert.equal(readAccessibleWordingRecord(undefined), null);
  assert.equal(readAccessibleWordingRecord({ schema_version: "something-else" }), null);
  assert.equal(readAccessibleWordingRecord({ ...record, accessible: null }), null, "An accessible record without its wording is rejected");
  assert.equal(readAccessibleWordingRecord({ ...record, status: "made_up" }), null);
});

check("Provenance records the wording the teacher used for the item and whether it was edited", () => {
  const record = review(simpler);
  const accessible = { stem: simpler.stem!, options: simpler.options };
  const used = wordingProvenance({ record, wording_version: "accessible", final: accessible });
  assert.equal(used?.wording_version, "accessible");
  assert.equal(used?.edited_by_teacher, false);
  assert.deepEqual(used?.original_wording, original);
  assert.equal(used?.prompt_version, "existing-mcq-import-v4");
  const back = wordingProvenance({ record, wording_version: "as_written", final: original });
  assert.equal(back?.wording_version, "as_written");
  assert.equal(back?.edited_by_teacher, false);
  assert.equal(wordingProvenance({ record, wording_version: "as_written", final: { ...original, stem: "Edited." } })?.edited_by_teacher, true);
  const fallback = review({ ...simpler, options: simpler.options.slice(0, 2) });
  assert.equal(wordingProvenance({ record: fallback, wording_version: "accessible", final: original })?.wording_version, "as_written",
    "There is no simpler version to use after a fallback");
  assert.equal(wordingProvenance({ record: null, wording_version: undefined, final: original }), null);
});

const blueprint: ItemDesignBlueprint = {
  schema_version: ITEM_DESIGN_BLUEPRINT_VERSION,
  section_topic: "Rasch model",
  section_summary: "Ability and difficulty on the logit scale.",
  objectives: [{ objective_id: "objective_1", statement: "Compare θ and b", evidence_requirements: ["Compares θ with b"] }],
  misconception_hypotheses: [],
  exemplar_items: [],
  generation_settings: { target_item_count: 4, option_count: 4, difficulty_mix: ["foundational"], context_notes: null }
};
const outputItem = (accessible: AccessibleWordingProposal): ExistingItemsOutput["items"][number] => ({
  source_label: "R1",
  source_topic: null,
  belongs_to_selected_topic: true,
  stem: original.stem,
  options: original.options,
  stated_key: "B",
  suggested_key: null,
  target_reasoning: "When θ is larger than b, the probability of a correct answer is above 0.5.",
  target_reasoning_from_source: false,
  essential_elements: ["Compares θ with b"],
  essential_elements_from_source: false,
  option_notes: [],
  objective_ids: ["objective_1"],
  note_for_teacher: null,
  accessible_version: accessible
});
const parsedOutput = (items: ExistingItemsOutput["items"]) =>
  ExistingItemsOutputSchema.parse({ schema_version: EXISTING_ITEMS_SCHEMA_VERSION, items, skipped: [] });

check("The output schema requires the accessible version on every item", () => {
  assert.equal(EXISTING_ITEMS_PROMPT_VERSION, "existing-mcq-import-v4");
  assert.equal(EXISTING_ITEMS_SCHEMA_VERSION, "existing-mcq-import-output-v2");
  const parsed = parsedOutput([outputItem(simpler)]);
  assert.equal(parsed.items[0]!.accessible_version.changed, true);
  const unchanged = parsedOutput([outputItem({ changed: false, stem: null, options: [], key_terms: [], change_note: null })]);
  assert.equal(unchanged.items[0]!.accessible_version.stem, null);
  const withoutVersion: Record<string, unknown> = { ...outputItem(simpler) };
  delete withoutVersion.accessible_version;
  assert.throws(() => parsedOutput([withoutVersion as never]), "accessible_version is required");
  assert.throws(() => parsedOutput([outputItem({ ...simpler, options: [{ label: "F", text: "x" }] })]), "Option letters are A to E");
  assert.throws(() => parsedOutput([outputItem({ ...simpler, extra: true } as never)]), "No unknown fields");
});

check("Drafts start with the checked simpler wording; the setting off or a failed check keeps the original", () => {
  const [accessibleDraft] = existingItemDrafts(parsedOutput([outputItem(simpler)]), blueprint).drafts;
  assert.equal(accessibleDraft!.wording_version, "accessible");
  assert.equal(accessibleDraft!.stem, simpler.stem);
  assert.deepEqual(accessibleDraft!.accessible_wording.original, original);
  assert(accessibleDraft!.suggested.includes("simpler wording"));
  assert.deepEqual(accessibleDraft!.from_source.slice(0, 2), ["stem", "options"], "The content still comes from the file");

  const [kept] = existingItemDrafts(parsedOutput([outputItem(simpler)]), blueprint, { accessible_wording: false }).drafts;
  assert.equal(kept!.wording_version, "as_written");
  assert.equal(kept!.stem, original.stem);
  assert.equal(kept!.accessible_wording.status, "not_requested");

  const [fallback] = existingItemDrafts(parsedOutput([outputItem({ ...simpler, stem: simpler.stem!.replace("Rasch", "simple") })]), blueprint).drafts;
  assert.equal(fallback!.wording_version, "as_written");
  assert.equal(fallback!.stem, original.stem);
  assert.deepEqual(fallback!.options, original.options);
  assert.match(fallback!.accessible_wording.teacher_note ?? "", /term "Rasch"/);
});

const candidate = (id: string, record: unknown, overrides: Partial<McqImportCandidate> = {}) => ({
  candidate_public_id: id, item_label: id, stem: simpler.stem!, options: simpler.options.map((option) => ({ ...option })),
  status: "needs_key", imported_key: "B", llm_suggested_key: null, teacher_confirmed_key: null, issue_flags: [],
  suggestion: { accessible_wording: record }, wording_version: "accessible", ...overrides
}) as unknown as McqImportCandidate;

check("The review page switches the wording of one item at a time", () => {
  const record = JSON.parse(JSON.stringify(review(simpler)));
  const items = [candidate("c1", record), candidate("c2", record)];
  assert.equal(wordingVersionOf(items[0]!), "accessible");
  const switched = items.map((entry) => entry.candidate_public_id === "c1" ? chooseWording(entry, "as_written") : entry);
  assert.equal(switched[0]!.wording_version, "as_written");
  assert.equal(switched[0]!.stem, original.stem);
  assert.deepEqual(switched[0]!.options, original.options);
  assert.equal(switched[1]!.wording_version, "accessible", "The other item keeps its own wording");
  assert.equal(switched[1]!.stem, simpler.stem);
  const back = chooseWording(switched[0]!, "accessible");
  assert.equal(back.stem, simpler.stem);
  assert.equal(wordingEditedSinceChoice(back), false);
  assert.equal(wordingEditedSinceChoice({ ...back, stem: "My own edit." }), true);
  assert.equal(wordingVersionOf(candidate("c3", record, { wording_version: undefined })), "accessible", "The default comes from the record");

  const fallback = JSON.parse(JSON.stringify(review({ ...simpler, options: simpler.options.slice(0, 3) })));
  const fallbackItem = candidate("c4", fallback, { stem: original.stem, options: original.options, wording_version: "as_written" });
  assert.equal(chooseWording(fallbackItem, "accessible"), fallbackItem, "There is no simpler wording to switch to");

  const earlier = candidate("c5", undefined, { wording_version: undefined, suggestion: { suggested_key: "B" } });
  assert.equal(accessibleWordingOf(earlier), null, "Batches from before this release have no wording record");
  assert.equal(wordingVersionOf(earlier), null);
  assert.equal(chooseWording(earlier, "as_written"), earlier);
  const imported = candidate("c6", record, { status: "imported" });
  assert.equal(chooseWording(imported, "as_written"), imported, "An added item is not changed");

  // Both wordings were checked: the result shown is the one for the wording the item now uses.
  const checkOf = (wording: ItemWording, answer: string) => ({ status: "checked", independent_answer: answer, agrees_with_key: answer === "B",
    revised: false, remaining_problems: [], checked_stem: wording.stem, checked_options: wording.options });
  const simplerWording = { stem: simpler.stem!, options: simpler.options };
  const checked = candidate("c7", record, { suggestion: { accessible_wording: record,
    assistant_check: checkOf(simplerWording, "B"), assistant_check_other_wording: checkOf(original, "A") } });
  assert.equal(assistantCheckOf(checked)?.agrees_with_key, true);
  assert.equal(assistantCheckOf(checked)?.current, true);
  const checkedOriginal = chooseWording(checked, "as_written");
  assert.equal(assistantCheckOf(checkedOriginal)?.independent_answer, "A", "Switching shows the check of the original wording");
  assert.equal(assistantCheckOf(checkedOriginal)?.current, true);
  assert.equal(assistantCheckOf({ ...checkedOriginal, stem: "My own edit." })?.current, false, "An edit makes both results earlier ones");
  assert.match(assistantCheckHeadline(assistantCheckOf({ ...checkedOriginal, stem: "My own edit." })!, "B"),
    /^The question or options have changed since the automatic check/);
});

check("The teacher's choice is saved per item and recorded when the item is added", () => {
  const service = source("src/lib/services/content/mcq-import.ts");
  const update = between(service, "const CandidateCommitUpdateSchema", ".strict();");
  assert(update.includes("wording_version: WordingVersionSchema.optional()"));
  assert(service.includes("wording_version: WordingVersionSchema.nullable().optional()"), "Kept in the stored candidate");
  assert(service.includes("wording_version: wordingVersionAfterUpdate(candidate, update.wording_version)"));
  assert(service.includes("return wordingVersionAfterChoice(accessibleWordingRecordOf(candidate), candidate.wording_version, requested);"));
  const passedRecord = review(simpler);
  const failedRecord = review({ ...simpler, options: simpler.options.slice(0, 3) });
  assert.equal(wordingVersionAfterChoice(failedRecord, "as_written", "accessible"), "as_written", "A client cannot choose a proposal that failed a check");
  assert.equal(wordingVersionAfterChoice(passedRecord, "as_written", "accessible"), "accessible");
  assert.equal(wordingVersionAfterChoice(passedRecord, "accessible", "as_written"), "as_written");
  assert.equal(wordingVersionAfterChoice(passedRecord, "accessible", undefined), "accessible", "No request keeps the choice");
  assert.equal(wordingVersionAfterChoice(null, null, "accessible"), null, "Items without a record ignore the request");
  const provenance = between(service, "function importProvenanceRules", "export async function commitMcqItemImport");
  assert(provenance.includes("wording: wordingProvenance({") && provenance.includes("wording_version: candidate.wording_version"));
  assert(provenance.includes("final: { stem: candidate.stem, options: candidate.options }"));
  const batch = between(service, "export async function createExistingItemsReviewBatch", "\n}\n");
  assert(batch.includes("wording_version: draft.wording_version") && batch.includes("accessible_wording: draft.accessible_wording"));
  const client = source("src/components/teacher-content/mcq-import-client.tsx");
  assert(client.includes("...(candidate.wording_version ? { wording_version: candidate.wording_version } : {})"));
  assert(client.includes("<WordingChoice candidate={candidate} onUpdate={updateCandidate} />"));
  const panel = between(client, "function WordingChoice(", "function SuggestionReview(");
  for (const text of ["Use my original wording", "Use the simpler wording", "Compare both versions", "Your original wording", "Simpler wording",
    "This item uses simpler wording.", "This item uses your original wording."]) assert(panel.includes(text), text);
  const sentences = [...panel.matchAll(/"([A-Z][^"]* [^"]*)"|>([A-Z][^<>{}]+)</g)].map((match) => (match[1] ?? match[2])!.trim());
  assert(sentences.length >= 8, "The panel's text was found");
  for (const sentence of sentences) {
    assert.doesNotMatch(sentence, /_|wording_version|accessible_wording/, `No internal names: ${sentence}`);
    assert.match(sentence, /[.?]$|^(Use|Compare|Hide|Your|Simpler|Wording)/, `Complete sentences or button labels: ${sentence}`);
  }
  assert(!/grade \$\{|reading_grade|fleschKincaid/i.test(client + service), "No readability grade is computed or shown");
});

check("The teacher setting is on by default and reaches the import call", () => {
  const route = source("src/app/api/teacher/assessments/[assessmentPublicId]/item-design/existing-items/route.ts");
  assert(route.includes('accessibleWording = form.get("accessible_wording") !== "false";'));
  assert(route.includes("accessible_wording: accessibleWording"));
  const builder = source("src/components/teacher-content/item-design-client.tsx");
  assert(builder.includes("const [accessibleWording, setAccessibleWording] = useState(true);"));
  assert(builder.includes('form.append("accessible_wording", accessibleWording ? "true" : "false");'));
  assert(builder.includes("Suggest simpler wording at a middle to high school reading level. "));
  assert(!/grades? \d/i.test(builder.slice(builder.indexOf("Suggest simpler wording"), builder.indexOf("Suggest simpler wording") + 600)), "No grade number is shown");
  assert(source("src/components/teacher-content/topic-preparation.ts").includes("accessible_wording: input.accessible_wording !== false"));
  const text = source("src/lib/services/content/item-design.ts");
  const service = between(text, "export async function importExistingItemsFromMaterials", "\n}\n");
  assert(service.includes("const accessibleWording = input.accessible_wording !== false;"));
  assert(service.includes("accessible_wording: accessibleWording,\n    attached_only: attachedOnly,\n    topic_id"), "A different setting is a different import, not a replay");
  assert(service.includes("existingItemDrafts(output, design.blueprint, {\n    accessible_wording: accessibleWording"));
});

check("The prompts set a grade 8 to 10 reading level and keep key terms", () => {
  const text = source("src/lib/services/content/item-design.ts");
  const prompt = between(text, "export const EXISTING_ITEMS_INSTRUCTIONS", "export const EXISTING_ITEMS_PROMPT_HASH");
  for (const part of [
    "Copy the stem and the options word for word. Do not correct, shorten, reorder or improve them.",
    "ACCESSIBLE WORDING", "grade 8 to 10 (middle to high school) reading level", "no idioms",
    "Keep every key term and symbol of the course exactly as written", "list in key_terms",
    "Keep every number, in the same order, every formula between $ signs and every Markdown table line exactly as written",
    "Keep the words that decide what is asked or claimed exactly as they are", "each option keeps its own idea under its own letter",
    "the specific incorrect idea that each wrong option rests on", "Never add hints or cues",
    "must not become the longest option", "When the item is already easy to read, set changed to false",
    "When required_output.accessible_wording is false", "keep its content and its key terms. When required_output.accessible_wording is true, simplify its wording",
    "when it is false, keep as much of its wording as reads naturally to a student"
  ]) assert(prompt.includes(part), part);
  const generation = between(text, "export const ITEM_GENERATION_INSTRUCTIONS", "const ITEM_GENERATION_RECOVERY_INSTRUCTIONS");
  assert(generation.includes("at a grade 8 to 10 (middle to high school) reading level"));
  assert(generation.includes("Keep the course's key terms and symbols exactly as the course materials write them"));
  assert(!/Rasch|3PL|ICC|logit/.test(generation), "The generation prompt does not name one course's terms");
  assert(generation.includes("Keep the reading load low"));
  const revision = between(text, "const ITEM_REVISION_INSTRUCTIONS", "export const ITEM_REVISION_PROMPT_HASH");
  assert(revision.includes("at the same grade 8 to 10 reading level and with the same key terms"));
  assert.equal(ITEM_GENERATION_PROMPT_VERSION, "evidence-centered-mcq-generation-v8");
  assert.equal(ITEM_REVISION_PROMPT_VERSION, "evidence-centered-mcq-revision-v4");
});

console.log(`${passed} accessible wording checks passed; no database or provider calls.`);
