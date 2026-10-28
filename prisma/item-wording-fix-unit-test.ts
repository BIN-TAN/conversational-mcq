/**
 * Wording fixes for items in a mini test that students have started (item-wording-fix-v1).
 * - The stem, the option texts and the teacher notes may change in place; the key, the option
 *   letters, their order and number, media and every other administration rule may not.
 * - Untouched text keeps its stored form, a fix with no change is refused, and a reason is required.
 * - The item version is not raised, so one item's answers stay together in dashboards and exports.
 * - The editor offers the fix only for locked items and sends notes only when one was edited.
 * No database or provider calls. Run with: npx tsx prisma/item-wording-fix-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ContentServiceError } from "../src/lib/services/content/errors";
import {
  ITEM_WORDING_FIX_VERSION,
  mergeWordingFixRules,
  planItemWordingFix,
  type ItemWordingFixSource
} from "../src/lib/services/content/item-wording-fix-plan";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${passed}. ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function refused(run: () => unknown, code: string, message?: RegExp) {
  try {
    run();
  } catch (error) {
    assert(error instanceof ContentServiceError, String(error));
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return;
  }
  assert.fail(`Expected ${code}`);
}

const item: ItemWordingFixSource = {
  item_stem: "Lily says the estimates differ. Which response best evaluates the TA's claim? ",
  options: [
    { label: "A", text: "Equal under Rasch, because every item has the same discrimination." },
    { label: "B", text: "Lily is right." },
    { label: "C", text: "Equal under every IRT model." },
    { label: "D", text: "Equal under Rasch; under 2PL Student 3 is higher." },
    { label: "E", text: "I don't know yet." }
  ],
  correct_option: "A",
  distractor_rationales: { B: "Weights harder items more.", C: "Overgeneralizes Rasch.", D: "Uses difficulty as weight." },
  expected_reasoning_patterns: ["Equal discrimination makes the raw score sufficient."],
  administration_rules: {
    item_role: "initial_diagnostic",
    no_feedback_during_initial_administration: true,
    import_provenance: { source_file_name: "D13.docx", imported_key: "A" },
    option_diagnostic_notes: { B: "Weights harder items more." },
    teacher_diagnostic_context: {
      item_label: "Rasch sufficiency",
      interpretation_caution: "Indirect evidence only.",
      correct_option_notes: { strong_reasoning_should_mention: "Same discrimination\nRaw score is sufficient" }
    }
  }
};
const options = (item.options as Array<{ label: string; text: string }>).map((option) => ({ ...option }));
const request = (patch: Record<string, unknown> = {}) => ({
  reason: "Use Lily's name in the question",
  item_stem: "Lily says the estimates differ. Which response best evaluates Lily's claim?",
  options,
  correct_option: "A",
  ...patch
});

check("a stem fix changes only the stem and keeps the rest as stored", () => {
  const plan = planItemWordingFix(item, request());
  assert.equal(ITEM_WORDING_FIX_VERSION, "item-wording-fix-v1");
  assert.deepEqual(plan.changed_fields, ["item_stem"]);
  assert.equal(plan.next.item_stem, "Lily says the estimates differ. Which response best evaluates Lily's claim?");
  assert.deepEqual(plan.next.options, item.options);
  assert.deepEqual(plan.next.distractor_rationales, item.distractor_rationales);
  assert.deepEqual(plan.next.expected_reasoning_patterns, item.expected_reasoning_patterns);
  assert.deepEqual(plan.next.administration_rules, item.administration_rules);
  assert.deepEqual(plan.before, { item_stem: item.item_stem });
  assert.deepEqual(plan.after, { item_stem: plan.next.item_stem });
  assert.equal(plan.reason, "Use Lily's name in the question");
});

check("untouched text keeps its stored form; trimming alone is not a change", () => {
  refused(() => planItemWordingFix(item, request({ item_stem: item.item_stem.trim() })), "validation_failed", /Nothing was changed/);
  const plan = planItemWordingFix(item, request({
    item_stem: item.item_stem.trim(),
    options: options.map((option) => option.label === "D" ? { ...option, text: "Equal under Rasch; under 2PL, Student 3 is higher." } : option)
  }));
  assert.deepEqual(plan.changed_fields, ["options"]);
  assert.equal(plan.next.item_stem, item.item_stem, "The stored stem with its trailing space is kept");
});

check("the answer key, option letters, order and number stay locked", () => {
  refused(() => planItemWordingFix(item, request({ correct_option: "D" })), "wording_fix_changes_locked_content", /cannot change the answer key/);
  refused(() => planItemWordingFix(item, request({ options: options.slice(0, 4) })), "wording_fix_changes_locked_content", /same options in the same order/);
  refused(() => planItemWordingFix(item, request({ options: [options[1], options[0], ...options.slice(2)] })), "wording_fix_changes_locked_content");
  refused(() => planItemWordingFix(item, request({ options: options.map((option, index) => index === 4 ? { ...option, label: "F" } : option) })), "wording_fix_changes_locked_content");
});

check("a reason is required and the request is strict", () => {
  refused(() => planItemWordingFix(item, request({ reason: "fix" })), "validation_failed", /at least 5 characters/);
  refused(() => planItemWordingFix(item, request({ media_assets: [] })), "validation_failed");
  refused(() => planItemWordingFix(item, request({ item_stem: "  " })), "validation_failed");
});

check("teacher notes may change; protected rules and context entries keep their stored values", () => {
  const plan = planItemWordingFix(item, request({
    item_stem: item.item_stem,
    administration_rules: {
      item_role: "changed_role",
      no_feedback_during_initial_administration: false,
      import_provenance: { source_file_name: "other.docx" },
      option_diagnostic_notes: { B: "Treats harder items as worth more." },
      teacher_diagnostic_context: {
        item_label: "Rasch raw-score sufficiency",
        interpretation_caution: "changed",
        correct_option_notes: { strong_reasoning_should_mention: "Same discrimination\nRaw score is sufficient" }
      }
    },
    distractor_rationales: { B: "Treats harder items as worth more.", C: "Overgeneralizes Rasch.", D: "Uses difficulty as weight." }
  }));
  assert.deepEqual(plan.changed_fields, ["distractor_rationales", "teacher_notes"]);
  const rules = plan.next.administration_rules as Record<string, Record<string, unknown> | unknown>;
  assert.equal(rules.item_role, "initial_diagnostic");
  assert.equal(rules.no_feedback_during_initial_administration, true);
  assert.deepEqual(rules.import_provenance, { source_file_name: "D13.docx", imported_key: "A" });
  assert.deepEqual(rules.option_diagnostic_notes, { B: "Treats harder items as worth more." });
  const context = rules.teacher_diagnostic_context as Record<string, unknown>;
  assert.equal(context.item_label, "Rasch raw-score sufficiency");
  assert.equal(context.interpretation_caution, "Indirect evidence only.");
});

check("mergeWordingFixRules removes a note the editor no longer sends and keeps everything else", () => {
  const merged = mergeWordingFixRules(item.administration_rules, { teacher_diagnostic_context: { item_label: "x" } });
  assert.equal("option_diagnostic_notes" in merged, false);
  const context = merged.teacher_diagnostic_context as Record<string, unknown>;
  assert.deepEqual(context, { item_label: "x", interpretation_caution: "Indirect evidence only." });
  assert.equal(merged.item_role, "initial_diagnostic");
});

check("essential elements stay within one to three; rationales only for incorrect options", () => {
  refused(() => planItemWordingFix(item, request({
    administration_rules: { teacher_diagnostic_context: { correct_option_notes: { strong_reasoning_should_mention: "" } } }
  })), "validation_failed", /one to three essential elements/);
  refused(() => planItemWordingFix(item, request({ distractor_rationales: { A: "The key." } })), "validation_failed", /not an incorrect option/);
  // Stored rationales are kept as they are when the request does not send any (older imports).
  const imported = { ...item, distractor_rationales: { A: "Why the key is right.", B: "Weights harder items more." } };
  assert.deepEqual(planItemWordingFix(imported, request()).next.distractor_rationales, imported.distractor_rationales);
});

check("the service keeps the version, records the fix and only works on locked items without a newer version", () => {
  const service = source("src/lib/services/content/item-wording-fix.ts");
  assert(!/version:\s*\{\s*increment/.test(service), "A wording fix must not raise the item version");
  assert(service.includes("INSERT INTO item_wording_corrections"));
  assert(service.includes("FOR UPDATE"));
  assert(service.includes("is_content_locked"));
  assert(service.includes("supersedes_assessment_public_id: assessment.assessment_public_id"), "A newer version draft takes the fix instead");
  const migration = source("prisma/migrations/20261028120000_item_wording_corrections/migration.sql");
  for (const column of ["reason", "changed_fields", "before_content", "after_content", "item_version", "responses_before", "sessions_before"]) {
    assert(migration.includes(`"${column}"`), column);
  }
  assert.match(source("prisma/schema.prisma"), /model ItemWordingCorrection \{[\s\S]*@@map\("item_wording_corrections"\)/);
  assert(source("src/app/api/teacher/items/[itemPublicId]/wording-fix/route.ts").includes("correctItemWording"));
});

check("the editor offers the fix for locked items and sends only the notes that were edited", () => {
  const editor = source("src/components/teacher-content/item-editor-client.tsx");
  assert(editor.includes("Fix wording only"));
  assert(editor.includes("item?.is_content_locked &&"));
  assert(editor.includes("/wording-fix`"));
  assert(editor.includes("wordingFixBaseline.current = buildItemPayload();"));
  assert(editor.includes("sameJson(payload.distractor_rationales, baseline.distractor_rationales)"));
  assert(editor.includes("rulesWithUntouchedKeysStored("));
  assert(editor.includes("const canEditWording = isEditable || wordingFixMode;"));
  // The key, option letters, adding or removing options, media and the published-set flag stay on isEditable.
  assert(editor.includes("disabled={!isEditable || options.length >= 5}"));
  assert(editor.includes("disabled={!isEditable || options.length <= 2}"));
  assert(/checked=\{correctOption === option\.label\}\s*className="h-4 w-4"\s*disabled=\{!isEditable\}/.test(editor));
  assert(/checked=\{includedInPublishedSet\}\s*className="mt-1 h-4 w-4"\s*disabled=\{!isEditable\}/.test(editor));
});

console.log(`${passed} item wording fix checks passed; no database or provider calls.`);
