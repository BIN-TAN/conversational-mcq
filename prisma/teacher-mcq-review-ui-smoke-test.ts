import assert from "node:assert/strict";
import { applyNoteSuggestion, assistantCheckOf, blankNoteSuggestions, isImported, keysTheCheckAgreedWith, needsNotes } from "../src/components/teacher-content/mcq-review";
import type { McqImportCandidate } from "../src/components/teacher-content/types";

const candidate = {
  candidate_public_id: "synthetic", status: "needs_review", import_selected: true,
  target_reasoning_note: null, strong_reasoning_should_mention: "Teacher's existing note",
  distractor_diagnostic_notes: null, teacher_confirmed_key: null,
  suggestion: { suggested_target_reasoning_note: "Explain the distinction.", suggested_strong_reasoning_should_mention: "Do not replace existing note", suggested_plain_language_distractor_notes: "Check the alternative interpretation." },
  suggestion_decisions: {}, suggestion_status: "pending_teacher_review"
} as unknown as McqImportCandidate;
assert(needsNotes(candidate));
assert.equal(blankNoteSuggestions(candidate).length, 2);
const applied = blankNoteSuggestions(candidate).reduce((entry, note) => applyNoteSuggestion(entry, note.suggestion, note.value), candidate);
assert.equal(applied.target_reasoning_note, "Explain the distinction.");
assert.equal(applied.strong_reasoning_should_mention, "Teacher's existing note");
assert.equal(applied.teacher_confirmed_key, null);
assert.equal(blankNoteSuggestions(applied).length, 0);
assert(!needsNotes(applied));
assert.equal(applied.suggestion_decisions?.suggested_target_reasoning_note.edited_value, applied.target_reasoning_note);
assert.equal(blankNoteSuggestions({ ...candidate, suggestion_decisions: { suggested_target_reasoning_note: { decision: "reject" } } }).length, 1);
assert.equal(blankNoteSuggestions({ ...candidate, suggestion_status: "failed" }).length, 0);
const imported = { ...candidate, imported_item_public_id: "already-added" };
assert(isImported(imported));
assert.equal(blankNoteSuggestions(imported).length, 0);
assert.equal(applyNoteSuggestion(imported, "suggested_target_reasoning_note", "changed"), imported);
console.log("MCQ review UI: immediate application, preserved notes/keys, rejected and imported exclusions passed. Provider calls: 0.");

// PostgreSQL JSONB can return object fields in a different order from the input.
const checkedDraft = {
  ...candidate, status: "needs_key", stem: "Which explanation fits?", llm_suggested_key: "A",
  options: [{ label: "A", text: "First explanation." }, { label: "B", text: "Second explanation." }],
  suggestion: { assistant_check: {
    status: "checked", independent_answer: "A", agrees_with_key: true, revised: false,
    remaining_problems: [], checked_stem: "Which explanation fits?",
    checked_options: [{ text: "First explanation.", label: "A" }, { text: "Second explanation.", label: "B" }]
  } }
} as unknown as McqImportCandidate;
assert.equal(assistantCheckOf(checkedDraft)?.current, true, "JSONB object field order is not an edit");
assert.deepEqual(keysTheCheckAgreedWith([checkedDraft]), [checkedDraft]);
const changedDrafts = [
  { ...checkedDraft, stem: "An edited question?" },
  { ...checkedDraft, options: [{ label: "A", text: "Edited explanation." }, checkedDraft.options[1]] },
  { ...checkedDraft, options: [{ label: "C", text: "First explanation." }, checkedDraft.options[1]] },
  { ...checkedDraft, options: [...checkedDraft.options].reverse() },
  { ...checkedDraft, options: checkedDraft.options.slice(0, 1) }
];
for (const changed of changedDrafts) {
  assert.equal(assistantCheckOf(changed)?.current, false, "Real wording, label, order or count changes invalidate the check");
  assert.equal(keysTheCheckAgreedWith([changed]).length, 0);
}
const checkedSuggestion = checkedDraft.suggestion as Record<string, unknown>;
const checkedResult = checkedSuggestion.assistant_check as Record<string, unknown>;
for (const patch of [
  { status: "unavailable" }, { remaining_problems: ["Another answer is defensible."] },
  { agrees_with_key: false }, { independent_answer: "B" }
]) {
  assert.equal(keysTheCheckAgreedWith([{ ...checkedDraft, suggestion: {
    ...checkedSuggestion, assistant_check: { ...checkedResult, ...patch }
  } }]).length, 0);
}
assert.equal(keysTheCheckAgreedWith([{ ...checkedDraft, teacher_confirmed_key: "A" }]).length, 0);
assert.equal(keysTheCheckAgreedWith([{ ...checkedDraft, imported_item_public_id: "already-added" }]).length, 0);
console.log("MCQ checked-draft review: stored field order, real edits and key-confirmation exclusions passed. Provider calls: 0.");
