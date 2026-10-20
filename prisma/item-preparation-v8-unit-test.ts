/**
 * Database-free checks for item preparation v8 (docs/AI_MODULE_REDESIGN_2026-10-19.md,
 * sections 4.2, 5, 9.2 and 11 item 4): per-option rationales and idea labels, essential
 * elements, the publishing rule, import parsing of the new fields, the single item
 * preparation prompt and the protection of confirmed keys. Run with:
 *
 *   npx tsx prisma/item-preparation-v8-unit-test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/item_preparation_v8_unit";
process.env.SESSION_SECRET ??= "item-preparation-v8-unit-test-session-secret-000000000";
process.on("unhandledRejection", (error) => {
  if ((error as { name?: string })?.name === "PrismaClientInitializationError") return;
  console.error(error);
  process.exitCode = 1;
});

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

const option = (label: string, text = `Option ${label} text`) => ({ label, text });
const fourOptions = ["A", "B", "C", "D"].map((label) => option(label));

async function main() {
  const context = await import("../src/lib/services/content/teacher-diagnostic-context");
  const {
    buildDistractorRationalesFromTeacherNotes,
    buildItemAdministrationRulesFromTeacherMetadata,
    essentialElementsList,
    optionIdeaLabels,
    readOptionRationales,
    readTeacherItemMetadata,
    teacherDiagnosticContextForProvider
  } = context;

  const rules = buildItemAdministrationRulesFromTeacherMetadata({
    administration_rules: {},
    metadata: {
      item_label: "Internal consistency",
      correct_option_notes: {
        target_reasoning_note: "Consistency differs from validity.",
        strong_reasoning_should_mention: "Consistency is not validity\nA use needs its own evidence"
      },
      plain_language_distractor_diagnostic_notes: "Older note for all options.",
      option_notes: [
        { label: "A", misconception_reasoning_pattern: "Treats reliability as validity.", idea_label: "reliability = validity" },
        { label: "C", misconception_reasoning_pattern: "Treats scores as exact.", idea_label: "scores are exact" },
        { label: "D", misconception_reasoning_pattern: "Treats reliability as fixed." }
      ]
    }
  });

  await check("optionIdeaLabels reads administration_rules, the provider object and a stored response", () => {
    const expected = new Map([["A", "reliability = validity"], ["C", "scores are exact"]]);
    assert.deepEqual(optionIdeaLabels(rules), expected, "administration_rules");
    const provider = teacherDiagnosticContextForProvider({ administration_rules: rules });
    assert.deepEqual(optionIdeaLabels(provider), expected, "teacherDiagnosticContextForProvider output");
    assert.deepEqual(optionIdeaLabels({ teacher_diagnostic_context: provider }), expected, "a response holding the provider object");
    assert.deepEqual(optionIdeaLabels({ option_notes: [{ label: "b", idea_label: " shared idea " }] }), new Map([["B", "shared idea"]]));
    assert.deepEqual(optionIdeaLabels(null), new Map());
    assert.deepEqual(optionIdeaLabels({ teacher_diagnostic_context: { option_notes: [{ label: "B" }, { idea_label: "no label" }] } }), new Map());
    assert.equal(readTeacherItemMetadata(rules).option_notes.find((note) => note.label === "A")?.idea_label, "reliability = validity");
  });

  await check("essentialElementsList splits lines, semicolons and bullets, trimmed, empty removed", () => {
    assert.deepEqual(essentialElementsList("First point\nSecond point"), ["First point", "Second point"]);
    assert.deepEqual(essentialElementsList(" a point ; another point;; "), ["a point", "another point"]);
    assert.deepEqual(essentialElementsList("• one • two\n- three\n* four"), ["one", "two", "three", "four"]);
    assert.deepEqual(essentialElementsList("1. one\n2) two\n(a) three\nb. four"), ["one", "two", "three", "four"]);
    assert.deepEqual(essentialElementsList("\n\n  \n"), []);
    assert.deepEqual(essentialElementsList(""), []);
    assert.deepEqual(essentialElementsList("e.g. a score of 1.5 SD"), ["e.g. a score of 1.5 SD"], "Abbreviations and decimals are not bullets");
    assert.deepEqual(essentialElementsList("Reliability: consistency\r\nValidity: interpretation"), ["Reliability: consistency", "Validity: interpretation"]);
  });

  await check("Each incorrect option keeps its own rationale in Item.distractor_rationales", () => {
    const notes = readTeacherItemMetadata(rules).option_notes;
    const rationales = buildDistractorRationalesFromTeacherNotes({
      option_labels: ["A", "B", "C", "D"],
      correct_option: "B",
      existing_rationales: {},
      option_notes: notes,
      plain_language_distractor_diagnostic_notes: "Older note for all options."
    });
    assert.deepEqual(rationales, {
      A: "Treats reliability as validity.",
      C: "Treats scores as exact.",
      D: "Treats reliability as fixed."
    });
    const partial = buildDistractorRationalesFromTeacherNotes({
      option_labels: ["A", "B", "C"],
      correct_option: "A",
      existing_rationales: {},
      option_notes: [{ label: "B", misconception_reasoning_pattern: "Own idea for B." }],
      plain_language_distractor_diagnostic_notes: "Older note."
    });
    assert.deepEqual(partial, { B: "Own idea for B.", C: "Older note." }, "An option without its own rationale keeps the older behaviour");
    const existing = buildDistractorRationalesFromTeacherNotes({
      option_labels: ["A", "B"],
      correct_option: "A",
      existing_rationales: { B: "Existing" },
      option_notes: [{ label: "B", misconception_reasoning_pattern: "Own" }]
    });
    assert.deepEqual(existing, { B: "Existing" });
  });

  await check("Rationales read for the editor and checks: copies of a blanket note do not count", () => {
    const legacyRules = buildItemAdministrationRulesFromTeacherMetadata({
      administration_rules: {},
      metadata: { plain_language_distractor_diagnostic_notes: "One note for all.", correct_option_notes: {} }
    });
    const copied = readOptionRationales({
      administration_rules: legacyRules,
      distractor_rationales: { B: "One note for all.", C: "One note for all." },
      option_labels: ["A", "B", "C"],
      correct_option: "A"
    });
    assert.deepEqual(copied.map((entry) => entry.rationale), ["", ""]);
    const blanket = readOptionRationales({
      administration_rules: {},
      distractor_rationales: { B: "Same text", C: "Same text" },
      option_labels: ["A", "B", "C"],
      correct_option: "A"
    });
    assert.deepEqual(blanket.map((entry) => entry.rationale), ["", ""]);
    const distinct = readOptionRationales({
      administration_rules: {},
      distractor_rationales: { B: "Idea B", C: "Idea C" },
      option_labels: ["A", "B", "C"],
      correct_option: "A"
    });
    assert.deepEqual(distinct.map((entry) => [entry.label, entry.rationale]), [["B", "Idea B"], ["C", "Idea C"]]);
    const own = readOptionRationales({ administration_rules: rules, option_labels: ["A", "B", "C", "D"], correct_option: "B" });
    assert.deepEqual(own.map((entry) => [entry.label, entry.rationale, entry.idea_label]), [
      ["A", "Treats reliability as validity.", "reliability = validity"],
      ["C", "Treats scores as exact.", "scores are exact"],
      ["D", "Treats reliability as fixed.", ""]
    ]);
  });

  const publishing = await import("../src/lib/services/content/publishing");
  const publishable = (strong: string | null, optionNotes: Array<{ label: string; misconception_reasoning_pattern?: string }>, plain?: string) => {
    const itemRules = buildItemAdministrationRulesFromTeacherMetadata({
      administration_rules: {},
      metadata: {
        correct_option_notes: { target_reasoning_note: "Target.", strong_reasoning_should_mention: strong ?? undefined },
        option_notes: optionNotes,
        plain_language_distractor_diagnostic_notes: plain
      }
    });
    return {
      item_public_id: "item_1",
      item_order: 2,
      item_stem: "Which conclusion is supported?",
      options: fourOptions,
      correct_option: "B",
      distractor_rationales: buildDistractorRationalesFromTeacherNotes({
        option_labels: ["A", "B", "C", "D"],
        correct_option: "B",
        existing_rationales: {},
        option_notes: readTeacherItemMetadata(itemRules).option_notes,
        plain_language_distractor_diagnostic_notes: plain
      }),
      expected_reasoning_patterns: [],
      possible_misconception_indicators: [],
      administration_rules: itemRules,
      status: "draft" as const
    };
  };
  const allRationales = [
    { label: "A", misconception_reasoning_pattern: "Idea A" },
    { label: "C", misconception_reasoning_pattern: "Idea C" },
    { label: "D", misconception_reasoning_pattern: "Idea D" }
  ];

  await check("Publishing: 0 or 4+ essential elements block; 1 to 3 pass", () => {
    const codes = (strong: string | null) =>
      publishing.validatePublishableItem(publishable(strong, allRationales) as never, 0).map((issue) => issue.code);
    assert.deepEqual(codes(null), ["essential_elements_required"]);
    assert.deepEqual(codes("  \n ; "), ["essential_elements_required"]);
    assert.deepEqual(codes("One"), []);
    assert.deepEqual(codes("One\nTwo\nThree"), []);
    assert.deepEqual(codes("One; Two; Three"), []);
    assert.deepEqual(codes("One\nTwo\nThree\nFour"), ["essential_elements_too_many"]);
    const message = publishing.validatePublishableItem(publishable(null, allRationales) as never, 0)[0].message;
    assert.match(message, /^Item 2: list one to three essential elements/);
  });

  await check("Publishing: a missing per-option rationale is a warning, never blocking", () => {
    const missing = publishable("One", [{ label: "A", misconception_reasoning_pattern: "Idea A" }], "Older note for all options.");
    assert.deepEqual(publishing.validatePublishableItem(missing as never, 0), []);
    const warnings = publishing.validatePublishableItemWarnings(missing as never, 0);
    const warning = warnings.find((entry) => entry.code === "option_rationale_missing");
    assert.ok(warning);
    assert.match(warning.message, /options C, D\.$/);
    assert.equal(
      publishing.validatePublishableItemWarnings(publishable("One", allRationales) as never, 0).some((entry) => entry.code === "option_rationale_missing"),
      false
    );
  });

  const contract = await import("../src/lib/services/content/mini-test-json-contract");
  const notes = await import("../src/lib/services/content/item-notes-import");
  const sampleText = readFileSync(path.join(process.cwd(), "public/samples/mini-test-import.json"), "utf8");
  const sample = JSON.parse(sampleText);
  const jsonDocument = (item: Record<string, unknown>) =>
    JSON.stringify({ ...sample, items: [{ ...sample.items[0], ...item }] });
  const rejects = (item: Record<string, unknown>, pattern: RegExp) =>
    assert.throws(() => contract.parseMiniTestJson(jsonDocument(item)), pattern);

  await check("JSON import accepts essential_elements, distractor_rationales and idea_labels", () => {
    const parsed = contract.parseMiniTestJson(sampleText);
    for (const item of parsed.items) {
      const incorrect = item.options.map((entry) => entry.label).filter((label) => label !== item.key);
      assert.deepEqual(Object.keys(item.distractor_rationales ?? {}).sort(), incorrect, "The sample has one rationale per incorrect option");
      assert.ok((item.essential_elements ?? []).length >= 1 && (item.essential_elements ?? []).length <= 3);
    }
    const first = parsed.items[0];
    assert.deepEqual(notes.optionRationalesFromRecords(first), [
      { label: "A", rationale: first.distractor_rationales!.A, idea_label: "reliability = validity" },
      { label: "C", rationale: first.distractor_rationales!.C, idea_label: "scores are exact" },
      { label: "D", rationale: first.distractor_rationales!.D, idea_label: "reliability is fixed" }
    ]);
    assert.equal(notes.essentialElementsText(first.essential_elements), first.essential_elements!.join("\n"));
    // Older files without the new fields still parse unchanged.
    const older = { ...sample.items[0], strong_reasoning_should_mention: "Older text", distractor_diagnostic_notes: "Older note" };
    delete older.essential_elements; delete older.distractor_rationales; delete older.idea_labels;
    const olderDocument = contract.parseMiniTestJson(JSON.stringify({ ...sample, items: [older] }));
    assert.equal(olderDocument.items[0].strong_reasoning_should_mention, "Older text");
    assert.deepEqual(notes.optionRationalesFromRecords(olderDocument.items[0]), []);
    rejects({ strong_reasoning_should_mention: "Both" }, /essential_elements or strong_reasoning_should_mention, not both/);
    rejects({ distractor_rationales: { B: "The key" } }, /The key needs no distractor rationale/);
    rejects({ distractor_rationales: { F: "Missing option" } }, /Option F does not exist/);
    rejects({ essential_elements: ["1", "2", "3", "4"] }, /essential_elements/);
    rejects({ idea_labels: { A: "x".repeat(61) } }, /idea_labels/);
  });

  await check("Workbook and spreadsheet columns: rationale_x, idea_label_x and essential_elements", () => {
    const fields = notes.workbookItemNoteFields({
      essential_elements: "First; Second",
      rationale_b: " Idea B ",
      idea_label_b: "shared idea",
      why_c: "Idea C",
      idea_label_d: "label only"
    }, ["A", "B", "C", "D"]);
    assert.deepEqual(fields, {
      strong_reasoning_should_mention: "First; Second",
      distractor_rationales: { B: "Idea B", C: "Idea C" },
      idea_labels: { B: "shared idea", D: "label only" }
    });
    // A workbook without the new columns gives the same item fields as before.
    assert.deepEqual(notes.workbookItemNoteFields({ strong_reasoning_should_mention: "Older" }, ["A", "B"]), { strong_reasoning_should_mention: "Older" });
    assert.deepEqual(notes.workbookItemNoteFields({}, ["A", "B"]), { strong_reasoning_should_mention: null });
    for (const column of ["essential_elements", "rationale_a", "idea_label_f", "why_b"]) {
      assert.ok(notes.WORKBOOK_NOTE_COLUMNS.includes(column), column);
    }
    const row: Record<string, string> = { option_a_rationale: "Via the long header", idea_a: "short" };
    assert.deepEqual(
      notes.optionRationalesFromColumns((header) => row[header]?.trim() || null, ["A", "B"]),
      [{ label: "A", rationale: "Via the long header", idea_label: "short" }]
    );
    const document = contract.MiniTestJsonSchema.parse({
      schema_version: contract.MINI_TEST_JSON_VERSION,
      assessment: { title: "Sheet" },
      items: [{ stem: "Stem", options: fourOptions, key: "A", ...fields }]
    });
    assert.deepEqual(document.items[0].distractor_rationales, { B: "Idea B", C: "Idea C" });
  });

  await check("Imported notes become one option note per incorrect option at import", () => {
    const optionNotes = notes.teacherOptionNotesFromImport({
      option_labels: ["A", "B", "C", "D"],
      correct_option: "A",
      option_rationales: [
        { label: "A", rationale: "For the key, dropped", idea_label: null },
        { label: "b", rationale: "Idea B", idea_label: "shared" },
        { label: "Z", rationale: "Unknown option", idea_label: null }
      ],
      plain_language_note: "Older note"
    });
    assert.deepEqual(optionNotes, [
      { label: "B", misconception_reasoning_pattern: "Idea B", idea_label: "shared", distractor_diagnostic_value: undefined },
      { label: "C", misconception_reasoning_pattern: undefined, idea_label: undefined, distractor_diagnostic_value: "Older note" },
      { label: "D", misconception_reasoning_pattern: undefined, idea_label: undefined, distractor_diagnostic_value: "Older note" }
    ]);
    const importedRules = buildItemAdministrationRulesFromTeacherMetadata({ administration_rules: {}, metadata: { option_notes: optionNotes } });
    assert.deepEqual(optionIdeaLabels(importedRules), new Map([["B", "shared"]]));
  });

  await check("Shared idea labels from imported items form an answer pattern", async () => {
    const { answerPatterns } = await import("../src/lib/services/student-assessment/interpretation-v8/rules");
    const parsed = contract.parseMiniTestJson(sampleText);
    const tags = parsed.items.map((item, index) => {
      const itemRules = buildItemAdministrationRulesFromTeacherMetadata({
        administration_rules: {},
        metadata: {
          option_notes: notes.teacherOptionNotesFromImport({
            option_labels: item.options.map((entry) => entry.label),
            correct_option: item.key!,
            option_rationales: notes.optionRationalesFromRecords(item)
          })
        }
      });
      const chosen = ["A", "A", "B"][index];
      return { item_id: `q${index + 1}`, answer_correct: false, chosen_option_tag: optionIdeaLabels(itemRules).get(chosen) ?? null };
    });
    assert.deepEqual(answerPatterns(tags), [{ misconception_tag: "reliability = validity", item_ids: ["q1", "q2", "q3"] }]);
  });

  const prep = await import("../src/lib/services/content/item-preparation/contract");
  await check("The item preparation prompt is section 9.2 verbatim, with a stable hash", () => {
    // Line endings are normalised: a Windows checkout may turn the document into CRLF.
    const doc = readFileSync(path.join(process.cwd(), "docs/AI_MODULE_REDESIGN_2026-10-19.md"), "utf8").replace(/\r\n/g, "\n");
    const section = doc.slice(doc.indexOf("### 9.2 Item preparation"), doc.indexOf("### 9.3 Item administration"));
    const block = section.match(/```text\n([\s\S]*?)\n```/);
    assert.ok(block, "Section 9.2 has a text block");
    assert.equal(prep.ITEM_PREPARATION_INSTRUCTIONS, block[1]);
    const expectedHash = createHash("sha256")
      .update([prep.ITEM_PREPARATION_PROMPT_VERSION, prep.ITEM_PREPARATION_SCHEMA_VERSION, prep.ITEM_PREPARATION_INSTRUCTIONS].join("\n"))
      .digest("hex");
    assert.equal(prep.ITEM_PREPARATION_PROMPT_HASH, expectedHash);
    assert.deepEqual([...prep.ITEM_PREPARATION_TASKS], ["draft_or_adapt", "format_imported", "check"]);
  });

  await check("The output schema suits structured outputs (no optional or open fields) and has items and problems", async () => {
    const { z } = await import("zod");
    // Structured outputs need every property required (nullable instead of optional) and typed.
    const walk = (schema: unknown, at: string): string[] => {
      if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) return [`${at}: optional`];
      if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown || schema instanceof z.ZodRecord) return [`${at}: open`];
      if (schema instanceof z.ZodNullable) return walk(schema.unwrap(), at);
      if (schema instanceof z.ZodArray) return walk(schema.element, `${at}[]`);
      if (schema instanceof z.ZodObject) {
        return Object.entries(schema.shape as Record<string, unknown>).flatMap(([key, value]) => walk(value, `${at}.${key}`));
      }
      return [];
    };
    assert.deepEqual(walk(prep.ItemPreparationOutputSchema, "$"), []);
    assert.deepEqual(Object.keys(prep.ItemPreparationOutputSchema.shape), ["items", "problems"]);
    assert.deepEqual(
      Object.keys(prep.ItemPreparationOutputSchema.shape.items.element.shape),
      ["item_ref", "stem", "options", "proposed_key", "target_reasoning", "essential_elements", "distractor_rationales"]
    );
    assert.deepEqual(Object.keys(prep.ItemPreparationOutputSchema.shape.problems.element.shape), ["item_ref", "field", "option_label", "code", "message"]);
  });

  const rulesModule = await import("../src/lib/services/content/item-preparation/rules");
  const { applyItemPreparationRules, validateItemPreparationOutput, sourceStatesKey } = rulesModule;
  const baseItem = {
    item_ref: "item-1",
    item_label: null,
    stem: "Which conclusion is supported?",
    options: fourOptions,
    confirmed_key: null as string | null,
    source_key: null as string | null,
    target_reasoning: null,
    essential_elements: [] as string[],
    distractor_rationales: [],
    imported_text: null as string | null
  };
  const input = (task: "draft_or_adapt" | "format_imported" | "check", item: Partial<typeof baseItem> = {}, requested = 0) => ({
    schema_version: prep.ITEM_PREPARATION_INPUT_VERSION,
    task,
    topic: { title: "Reliability", learning_objective: "Interpret reliability", description: "Reliability and validity", diagnostic_focus: null },
    course_level: prep.ITEM_PREPARATION_DEFAULT_COURSE_LEVEL,
    items: [{ ...baseItem, ...item }],
    source_material: null,
    requested_new_items: requested
  });
  const outputItem = (overrides: Record<string, unknown> = {}) => ({
    item_ref: "item-1",
    stem: "Which conclusion is supported?",
    options: fourOptions,
    proposed_key: "A",
    target_reasoning: "Consistency differs from validity.",
    essential_elements: ["Consistency is not validity"],
    distractor_rationales: [
      { option_label: "B", rationale: "Idea B", idea_label: "shared" },
      { option_label: "C", rationale: "Idea C", idea_label: null },
      { option_label: "D", rationale: "Idea D", idea_label: null }
    ],
    ...overrides
  });
  const output = (item: Record<string, unknown> = {}, problems: unknown[] = []) =>
    ({ items: [outputItem(item)], problems }) as never;

  await check("Key protection: a confirmed key is never changed; a proposed change becomes a problem", () => {
    const result = applyItemPreparationRules(input("check", { confirmed_key: "B" }), output({ proposed_key: "A" }));
    assert.equal(result.items[0].key, "B");
    assert.equal(result.items[0].key_status, "confirmed");
    const keyProblem = result.problems.find((entry) => entry.code === "key_change_not_applied");
    assert.ok(keyProblem);
    assert.equal(keyProblem.field, "key");
    assert.equal(keyProblem.item_ref, "item-1");
    assert.equal(keyProblem.source, "application");
    assert.ok(!result.items[0].distractor_rationales.some((entry) => entry.option_label === "B"), "No rationale for the confirmed key");
    assert.ok(result.problems.some((entry) => entry.code === "rationale_for_correct_option" && entry.option_label === "B"));
    assert.ok(result.problems.some((entry) => entry.code === "missing_distractor_rationale" && entry.option_label === "A"));
    for (const task of ["draft_or_adapt", "format_imported"] as const) {
      const other = applyItemPreparationRules(input(task, { confirmed_key: "C", source_key: "A" }), output({ proposed_key: "A" }));
      assert.equal(other.items[0].key, "C", task);
    }
    const same = applyItemPreparationRules(input("check", { confirmed_key: "A" }), output());
    assert.equal(same.problems.some((entry) => entry.field === "key"), false);
  });

  await check("Format task: a key is recorded only when the source states it", () => {
    const none = applyItemPreparationRules(input("format_imported", { imported_text: "1. Stem\nA) one\nB) two" }), output());
    assert.equal(none.items[0].key, null);
    assert.ok(none.problems.some((entry) => entry.code === "key_not_stated_in_source"));
    const stated = applyItemPreparationRules(input("format_imported", { imported_text: "1. Stem\nA) one\nAnswer: A" }), output());
    assert.equal(stated.items[0].key, "A");
    assert.equal(stated.items[0].key_status, "stated_in_source");
    const differs = applyItemPreparationRules(input("format_imported", { source_key: "C" }), output({ proposed_key: "A" }));
    assert.equal(differs.items[0].key, "C");
    assert.ok(differs.problems.some((entry) => entry.code === "key_change_not_applied"));
    const reworded = applyItemPreparationRules(input("format_imported", { source_key: "A" }), output({ stem: "A different question?" }));
    assert.ok(reworded.problems.some((entry) => entry.code === "wording_changed"));
    assert.equal(sourceStatesKey("Correct answer is (B)", "B"), true);
    assert.equal(sourceStatesKey("Key - d", "D"), true);
    assert.equal(sourceStatesKey("Answer: Brand names", "B"), false);
    assert.equal(sourceStatesKey("B) an option", "B"), false);
  });

  await check("Draft or adapt: an unconfirmed proposal stays a suggestion; a different source key is reported", () => {
    const result = applyItemPreparationRules(input("draft_or_adapt", { source_key: "C" }), output({ proposed_key: "A" }));
    assert.equal(result.items[0].key, "A");
    assert.equal(result.items[0].key_status, "proposed");
    assert.ok(result.problems.some((entry) => entry.code === "proposed_key_differs_from_source"));
    assert.deepEqual(result.items[0].essential_elements, ["Consistency is not validity"]);
    assert.deepEqual(result.items[0].distractor_rationales.map((entry) => entry.option_label), ["B", "C", "D"]);
  });

  await check("Proposals the application cannot use are rejected for one regeneration", () => {
    const codes = (task: "draft_or_adapt" | "format_imported" | "check", out: unknown, item: Partial<typeof baseItem> = {}, requested = 0) =>
      validateItemPreparationOutput(input(task, item, requested), out as never).map((issue) => issue.code);
    assert.deepEqual(codes("check", output()), []);
    assert.deepEqual(codes("check", output({ item_ref: "item-9" })), ["unknown_item_ref", "missing_item"]);
    assert.deepEqual(codes("check", output({ proposed_key: "F" })), ["unknown_key"]);
    assert.deepEqual(codes("check", output({ essential_elements: [] })), ["essential_elements_count"]);
    assert.deepEqual(codes("check", output({ essential_elements: ["1", "2", "3", "4"] })), ["essential_elements_count"]);
    assert.deepEqual(codes("check", output({ options: fourOptions.slice(1) }), { confirmed_key: "A" }), ["unknown_key", "confirmed_key_option_missing"]);
    assert.deepEqual(codes("check", output({}, [{ item_ref: "item-1", field: "option", option_label: "F", code: "implausible_option", message: "x" }])), ["unknown_option"]);
    const drafted = { items: [outputItem(), outputItem({ item_ref: "new-1", options: ["A", "B", "C", "D", "E"].map((label) => option(label)) })], problems: [] };
    assert.deepEqual(codes("draft_or_adapt", drafted, {}, 1), ["option_count"]);
    assert.deepEqual(codes("check", drafted), ["unknown_item_ref", "option_count"]);
  });

  const call = await import("../src/lib/services/content/item-preparation/call");
  type Recorded = { start: unknown[]; finish: Array<{ id: string; status: string }> };
  const recorder = (log: Recorded) => ({
    async start(entry: unknown) {
      log.start.push(entry);
      return { id: `call-${log.start.length}`, public_id: `public-${log.start.length}` };
    },
    async finish(id: string, entry: { status: string }) {
      log.finish.push({ id, status: entry.status });
    }
  });
  const scriptedProvider = (outputs: unknown[], seen: unknown[]) => ({
    async executeStructured(request: { input: unknown; instructions: string }) {
      seen.push(request);
      const parsed = outputs.shift();
      return { provider: "mock" as const, client_request_id: "x", status: "completed" as const, parsed_output: parsed as never, latency_ms: 1 };
    }
  });

  await check("A rejected proposal is regenerated once; the confirmed key survives the accepted one", async () => {
    const log: Recorded = { start: [], finish: [] };
    const seen: Array<{ input: Record<string, unknown>; instructions: string }> = [];
    const plan = call.planTeacherItemPreparation({
      task: "draft_or_adapt",
      mode: "live",
      override: { provider: scriptedProvider([output({ essential_elements: [] }), output({ proposed_key: "C" })], seen) as never }
    });
    const result = await call.runItemPreparation({
      model_input: input("draft_or_adapt", { confirmed_key: "A" }),
      plan,
      invocation_key_base: "unit",
      recorder: recorder(log)
    });
    assert.equal(result.status, "succeeded");
    if (result.status !== "succeeded") return;
    assert.equal(result.repair_attempted, true);
    assert.equal(result.result.items[0].key, "A");
    assert.ok(result.result.problems.some((entry) => entry.code === "key_change_not_applied"));
    assert.equal(seen.length, 2);
    assert.equal(seen[0].instructions, prep.ITEM_PREPARATION_INSTRUCTIONS);
    assert.ok(Array.isArray(seen[1].input.previous_attempt_rejected_for));
    assert.deepEqual(log.finish.map((entry) => entry.status), ["invalid_output", "succeeded"]);
  });

  await check("Two rejected proposals fail; a blocked plan makes no call", async () => {
    const log: Recorded = { start: [], finish: [] };
    const seen: unknown[] = [];
    const failed = await call.runItemPreparation({
      model_input: input("check", { confirmed_key: "A" }),
      plan: call.planTeacherItemPreparation({ task: "draft_or_adapt", mode: "live", override: { provider: scriptedProvider([output({ proposed_key: "Q" }), output({ proposed_key: "Q" })], seen) as never } }),
      invocation_key_base: "unit",
      recorder: recorder(log)
    });
    assert.equal(failed.status, "failed");
    assert.equal(seen.length, call.ITEM_PREPARATION_MAX_ATTEMPTS);
    const blocked = await call.runItemPreparation({
      model_input: input("check"),
      plan: { mode: "blocked", reason: "item_preparation_v8_not_approved" },
      invocation_key_base: "unit",
      recorder: recorder(log)
    });
    assert.deepEqual(blocked, { status: "blocked", reason: "item_preparation_v8_not_approved", agent_call_id: null, agent_call_public_id: null });
  });

  await check("Gating: mock uses the stand-in; live needs live calls and the approved prompt hash", () => {
    assert.deepEqual(call.planTeacherItemPreparation({ task: "format_imported", mode: "mock" }), { mode: "local_test" });
    const live = call.planTeacherItemPreparation({ task: "format_imported", mode: "live" });
    assert.equal(live.mode, "blocked");
    assert.equal(live.mode === "blocked" ? live.reason : null, "live_calls_disabled");
    const savedMode = process.env.OPERATIONAL_AGENT_MODE;
    process.env.OPERATIONAL_AGENT_MODE = "disabled";
    assert.deepEqual(call.planItemCheck(), { mode: "blocked", reason: "operational_agent_mode_disabled" });
    process.env.OPERATIONAL_AGENT_MODE = "mock";
    assert.deepEqual(call.planItemCheck({ mock_mode: "item_verification_warning" }), { mode: "local_test", mock_mode: "item_verification_warning" });
    if (savedMode === undefined) delete process.env.OPERATIONAL_AGENT_MODE; else process.env.OPERATIONAL_AGENT_MODE = savedMode;
    const savedHash = process.env.ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH;
    process.env.ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH = "0".repeat(64);
    assert.equal(call.itemPreparationApprovalStatus().approved, false);
    process.env.ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH = prep.ITEM_PREPARATION_PROMPT_HASH;
    assert.equal(call.itemPreparationApprovalStatus().approved, true);
    if (savedHash === undefined) delete process.env.ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH; else process.env.ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH = savedHash;
    assert.deepEqual(call.ITEM_PREPARATION_ROLE_BY_TASK, {
      draft_or_adapt: "mcq_diagnostic_authoring_assistant_agent",
      format_imported: "mcq_import_formatting_assistant_agent",
      check: "item_verification_agent"
    });
  });

  const { buildLocalTestItemPreparation } = await import("../src/lib/services/content/item-preparation/local-test");
  const check8 = await import("../src/lib/services/content/item-preparation/check-adapter");
  const { validateItemVerificationOutputSemantics } = await import("../src/lib/agents/item-verification/semantic-validation");
  const { buildItemVerificationInput } = await import("../src/lib/agents/item-verification/input-builder");
  const { agentOutputSchemas } = await import("../src/lib/agents/contracts");

  await check("Check task: problems become verification findings; the stand-in passes the checks", () => {
    const items = [1, 2, 3].map((order) => ({
      item_public_id: `item_${order}`,
      item_order: order,
      item_stem: `Stem ${order}`,
      options: fourOptions,
      correct_option: "B",
      distractor_rationales: {},
      expected_reasoning_patterns: [],
      possible_misconception_indicators: [],
      administration_rules: rules,
      version: 1
    }));
    const conceptUnit = { concept_unit_public_id: "cu_1", title: "Reliability", learning_objective: "Interpret reliability", related_concept_description: "Reliability and validity", version: 1 };
    const providerInput = buildItemVerificationInput({ conceptUnit, items });
    const modelInput = check8.preparationInputForItemCheck({ concept_unit: conceptUnit, items });
    assert.equal(modelInput.items[0].confirmed_key, "B");
    assert.deepEqual(modelInput.items[0].essential_elements, ["Consistency is not validity", "A use needs its own evidence"]);
    assert.deepEqual(modelInput.items[0].distractor_rationales.map((entry) => entry.option_label), ["A", "C", "D"]);
    for (const mode of [null, "item_verification_warning", "item_verification_multiple_correct_answers", "item_verification_insufficient_information", "item_verification_answer_key_inconsistency"]) {
      const out = buildLocalTestItemPreparation(modelInput, mode);
      assert.deepEqual(validateItemPreparationOutput(modelInput, out), [], String(mode));
      const verification = check8.verificationOutputFromPreparation({ providerInput, result: applyItemPreparationRules(modelInput, out), generation_mode: "local_test" });
      assert.equal(agentOutputSchemas.item_verification_agent.safeParse(verification).success, true, String(mode));
      assert.deepEqual(validateItemVerificationOutputSemantics({ providerInput, output: verification, allowSuggestedWording: true }).errors, [], String(mode));
      assert.equal(verification.verification_status, mode ? "verified_with_warnings" : "verified_no_warnings");
    }
    const keyChange = applyItemPreparationRules(modelInput, {
      ...buildLocalTestItemPreparation(modelInput),
      items: buildLocalTestItemPreparation(modelInput).items.map((item, index) => index === 0 ? { ...item, proposed_key: "A" } : item)
    });
    const findings = check8.verificationOutputFromPreparation({ providerInput, result: keyChange, generation_mode: "live_model" }).item_results[0].findings;
    assert.deepEqual(findings.map((entry) => [entry.issue_code, entry.location]), [["possible_answer_key_inconsistency", "correct_option"]]);
    assert.equal(items[0].correct_option, "B", "The check never edits the item");
    const stand = buildLocalTestItemPreparation({ ...modelInput, task: "draft_or_adapt", requested_new_items: 2 });
    assert.deepEqual(validateItemPreparationOutput({ ...modelInput, task: "draft_or_adapt", requested_new_items: 2 }, stand), []);
  });

  const adapter = await import("../src/lib/services/content/item-preparation/import-adapter");
  await check("Import review: proposals stay suggestions; the key is suggested only when none is confirmed", () => {
    const candidate = {
      candidate_public_id: "c1",
      item_label: "Q1",
      stem: "Which conclusion is supported?",
      options: fourOptions,
      imported_key: null,
      teacher_confirmed_key: "A",
      target_reasoning_note: null,
      strong_reasoning_should_mention: "One; Two",
      option_rationales: [{ label: "A", rationale: "Key note", idea_label: null }, { label: "B", rationale: "Own B", idea_label: "shared" }],
      original_source_text: "1. Which conclusion is supported?\nA) ...\nAnswer: A",
      source_location: "row 1"
    };
    const modelInput = adapter.preparationInputFromCandidates({
      task: "format_imported",
      topic: { title: "Reliability", learning_objective: null, description: null, diagnostic_focus: null },
      candidates: [candidate]
    });
    assert.equal(modelInput.items[0].item_ref, adapter.candidateItemRef(0));
    assert.deepEqual(modelInput.items[0].essential_elements, ["One", "Two"]);
    assert.deepEqual(modelInput.items[0].distractor_rationales, [{ option_label: "B", rationale: "Own B", idea_label: "shared" }]);
    assert.ok(modelInput.items[0].imported_text?.includes("Answer: A"));
    const result = applyItemPreparationRules(modelInput, output({ proposed_key: "C" }));
    const suggestion = adapter.suggestionFromPreparedItem({ candidate, item: result.items[0], result, agent_name: "x" });
    assert.equal(suggestion.suggested_key, null, "No key suggestion when the key is confirmed");
    assert.deepEqual(suggestion.suggested_option_rationales.map((entry) => entry.label), ["B", "C", "D"]);
    assert.equal(suggestion.suggested_strong_reasoning_should_mention, "Consistency is not validity");
    assert.ok(suggestion.problems.some((entry) => entry.code === "key_change_not_applied"));
    const formatting = adapter.formattingSuggestionFromPreparedItem({ candidate, item: result.items[0], result, agent_name: "x" });
    assert.equal(formatting.proposed_imported_key, null, "A confirmed key is never proposed as an imported key");
    assert.equal(formatting.wording_change_indicator, "none");
    const unconfirmed = { ...candidate, teacher_confirmed_key: null };
    const draftInput = adapter.preparationInputFromCandidates({ task: "draft_or_adapt", topic: modelInput.topic, candidates: [unconfirmed] });
    const draft = applyItemPreparationRules(draftInput, output({ proposed_key: "A" }));
    assert.equal(adapter.suggestionFromPreparedItem({ candidate: unconfirmed, item: draft.items[0], result: draft, agent_name: "x" }).suggested_key, "A");
  });

  const review = await import("../src/components/teacher-content/mcq-review");
  await check("Import review page: per-option suggestions fill only blank rationales", () => {
    const candidate = {
      candidate_public_id: "c1", status: "needs_review", import_selected: true,
      options: fourOptions, teacher_confirmed_key: "A",
      target_reasoning_note: "Set", strong_reasoning_should_mention: "Set", distractor_diagnostic_notes: null,
      option_rationales: [{ label: "B", rationale: "Teacher B", idea_label: null }],
      suggestion: { suggested_option_rationales: [
        { label: "A", rationale: "For the key", idea_label: null },
        { label: "B", rationale: "Proposed B", idea_label: null },
        { label: "C", rationale: "Proposed C", idea_label: "shared" }
      ] },
      suggestion_decisions: {}, suggestion_status: "pending_teacher_review"
    } as never;
    assert.equal(review.needsNotes(candidate), true, "C and D lack rationales");
    const pending = review.blankNoteSuggestions(candidate);
    assert.deepEqual(pending.map((entry) => entry.suggestion), [review.optionRationaleSuggestionKey("C")]);
    const applied = review.applyNoteSuggestion(candidate, pending[0].suggestion, pending[0].value);
    assert.deepEqual(review.optionRationaleFor(applied, "C"), { label: "C", rationale: "Proposed C", idea_label: "shared" });
    assert.equal(review.optionRationaleFor(applied, "B").rationale, "Teacher B");
    assert.equal(review.blankNoteSuggestions(applied).length, 0);
    const complete = review.setOptionRationale(applied, "D", { rationale: "Teacher D" });
    assert.equal(review.needsNotes(complete), false);
  });

  console.log(`\n${passed} item preparation v8 checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
