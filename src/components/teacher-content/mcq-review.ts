import type { McqImportCandidate } from "./types";

export const noteFields = [
  { suggestion: "suggested_target_reasoning_note", field: "target_reasoning_note", label: "Target reasoning" },
  { suggestion: "suggested_strong_reasoning_should_mention", field: "strong_reasoning_should_mention", label: "Evidence of strong reasoning" },
  { suggestion: "suggested_plain_language_distractor_notes", field: "distractor_diagnostic_notes", label: "Distractor notes" }
] as const;

export function isImported(candidate: McqImportCandidate) {
  return candidate.status === "imported" || Boolean(candidate.imported_item_public_id);
}

export function needsNotes(candidate: McqImportCandidate) {
  return !isImported(candidate) && noteFields.some(({ field }) => !candidate[field]?.trim());
}

export function blankNoteSuggestions(candidate: McqImportCandidate) {
  if (isImported(candidate) || candidate.suggestion_status === "failed") return [];
  const suggestions = candidate.suggestion as Record<string, unknown> | null;
  return noteFields.flatMap(({ suggestion, field, label }) => {
    const value = suggestions?.[suggestion];
    const decision = candidate.suggestion_decisions?.[suggestion]?.decision;
    return !candidate[field]?.trim() && typeof value === "string" && value.trim() && !decision
      ? [{ suggestion, field, label, value }] : [];
  });
}

export function applyNoteSuggestion(candidate: McqImportCandidate, suggestion: string, value: string) {
  const mapping = noteFields.find((entry) => entry.suggestion === suggestion);
  if (!mapping || isImported(candidate)) return candidate;
  return {
    ...candidate,
    [mapping.field]: value,
    suggestion_decisions: {
      ...candidate.suggestion_decisions,
      [suggestion]: { decision: "edit_accept", edited_value: value }
    }
  };
}
