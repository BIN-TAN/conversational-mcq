import type { McqImportCandidate, McqImportOptionRationale } from "./types";

export const noteFields = [
  { suggestion: "suggested_target_reasoning_note", field: "target_reasoning_note", label: "Target reasoning" },
  { suggestion: "suggested_strong_reasoning_should_mention", field: "strong_reasoning_should_mention", label: "Essential elements" },
  // Older suggestions proposed one note for all options; it is still offered when present.
  { suggestion: "suggested_plain_language_distractor_notes", field: "distractor_diagnostic_notes", label: "Note for all options" }
] as const;

const OPTION_RATIONALE_PREFIX = "suggested_option_rationale:";

export function optionRationaleSuggestionKey(label: string) {
  return `${OPTION_RATIONALE_PREFIX}${label}`;
}

export function isImported(candidate: McqImportCandidate) {
  return candidate.status === "imported" || Boolean(candidate.imported_item_public_id);
}

/** Incorrect options for the confirmed key; every option until a key is confirmed. */
export function incorrectOptionLabels(candidate: McqImportCandidate) {
  return (candidate.options ?? [])
    .map((option) => option.label)
    .filter((label) => label && label !== candidate.teacher_confirmed_key);
}

export function optionRationaleFor(candidate: McqImportCandidate, label: string): McqImportOptionRationale {
  return (
    (candidate.option_rationales ?? []).find((entry) => entry.label === label) ?? {
      label,
      rationale: null,
      idea_label: null
    }
  );
}

export function setOptionRationale(
  candidate: McqImportCandidate,
  label: string,
  patch: Partial<Omit<McqImportOptionRationale, "label">>
): McqImportCandidate {
  const current = optionRationaleFor(candidate, label);
  const next = { ...current, ...patch, label };
  const others = (candidate.option_rationales ?? []).filter((entry) => entry.label !== label);
  const order = (candidate.options ?? []).map((option) => option.label);
  return {
    ...candidate,
    option_rationales: [...others, next].sort((left, right) => order.indexOf(left.label) - order.indexOf(right.label))
  };
}

function missingRationaleLabels(candidate: McqImportCandidate) {
  const labels = incorrectOptionLabels(candidate);
  // Until a key is confirmed one option is presumably correct, so one may stay blank.
  const needed = candidate.teacher_confirmed_key ? labels.length : Math.max(0, labels.length - 1);
  const missing = labels.filter((label) => !optionRationaleFor(candidate, label).rationale?.trim());
  return labels.length - missing.length < needed ? missing : [];
}

export function needsNotes(candidate: McqImportCandidate) {
  if (isImported(candidate)) return false;
  return (
    !candidate.target_reasoning_note?.trim() ||
    !candidate.strong_reasoning_should_mention?.trim() ||
    missingRationaleLabels(candidate).length > 0
  );
}

type SuggestedOptionRationale = { label: string; rationale: string; idea_label: string | null };

export function suggestedOptionRationales(candidate: McqImportCandidate): SuggestedOptionRationale[] {
  const value = (candidate.suggestion as Record<string, unknown> | null)?.suggested_option_rationales;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const label = typeof record.label === "string" ? record.label : "";
    const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
    const ideaLabel = typeof record.idea_label === "string" && record.idea_label.trim() ? record.idea_label.trim() : null;
    return label && rationale ? [{ label, rationale, idea_label: ideaLabel }] : [];
  });
}

export function blankNoteSuggestions(candidate: McqImportCandidate) {
  if (isImported(candidate) || candidate.suggestion_status === "failed") return [];
  const suggestions = candidate.suggestion as Record<string, unknown> | null;
  const notes = noteFields.flatMap(({ suggestion, field, label }) => {
    const value = suggestions?.[suggestion];
    const decision = candidate.suggestion_decisions?.[suggestion]?.decision;
    return !candidate[field]?.trim() && typeof value === "string" && value.trim() && !decision
      ? [{ suggestion: suggestion as string, field: field as string, label: label as string, value }] : [];
  });
  const incorrect = new Set(incorrectOptionLabels(candidate));
  const rationales = suggestedOptionRationales(candidate).flatMap((entry) => {
    const suggestion = optionRationaleSuggestionKey(entry.label);
    const decision = candidate.suggestion_decisions?.[suggestion]?.decision;
    return incorrect.has(entry.label) && !optionRationaleFor(candidate, entry.label).rationale?.trim() && !decision
      ? [{
          suggestion,
          field: "option_rationales",
          label: `Why a student might choose option ${entry.label}${entry.idea_label ? ` (idea: ${entry.idea_label})` : ""}`,
          value: entry.rationale
        }]
      : [];
  });
  return [...notes, ...rationales];
}

export function applyNoteSuggestion(candidate: McqImportCandidate, suggestion: string, value: string) {
  if (isImported(candidate)) return candidate;
  const decisions = {
    ...candidate.suggestion_decisions,
    [suggestion]: { decision: "edit_accept", edited_value: value }
  };
  if (suggestion.startsWith(OPTION_RATIONALE_PREFIX)) {
    const label = suggestion.slice(OPTION_RATIONALE_PREFIX.length);
    const proposed = suggestedOptionRationales(candidate).find((entry) => entry.label === label);
    const current = optionRationaleFor(candidate, label);
    return {
      ...setOptionRationale(candidate, label, {
        rationale: value,
        idea_label: current.idea_label?.trim() ? current.idea_label : proposed?.idea_label ?? null
      }),
      suggestion_decisions: decisions
    };
  }
  const mapping = noteFields.find((entry) => entry.suggestion === suggestion);
  if (!mapping) return candidate;
  return {
    ...candidate,
    [mapping.field]: value,
    suggestion_decisions: decisions
  };
}

export type PreparationProblemView = { field: string; option_label: string | null; code: string; message: string };

/** Problems the item preparation assistant reported for a candidate (suggestion or formatting record). */
export function preparationProblems(record: unknown): PreparationProblemView[] {
  const problems = record && typeof record === "object" ? (record as Record<string, unknown>).problems : null;
  if (!Array.isArray(problems)) return [];
  return problems.flatMap((entry) => {
    const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return typeof value.message === "string" && value.message.trim()
      ? [{
          field: typeof value.field === "string" ? value.field : "item",
          option_label: typeof value.option_label === "string" ? value.option_label : null,
          code: typeof value.code === "string" ? value.code : "other",
          message: value.message
        }]
      : [];
  });
}
