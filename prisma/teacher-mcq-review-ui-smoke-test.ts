import assert from "node:assert/strict";
import { applyNoteSuggestion, blankNoteSuggestions, isImported, needsNotes } from "../src/components/teacher-content/mcq-review";
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
