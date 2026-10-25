import type { McqImportCandidate, McqImportOptionRationale } from "./types";
import {
  readAccessibleWordingRecord,
  sameWording,
  wordingFor,
  type AccessibleWordingRecord,
  type WordingVersion
} from "../../lib/item-content/accessible-wording";

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

const STATUS_LABELS: Record<string, string> = {
  parsed: "Read from file",
  needs_review: "Needs a look",
  needs_key: "Key to confirm",
  needs_options: "Stem or options missing",
  key_conflict: "Key does not match an option",
  ready_as_draft: "Ready to add",
  imported: "Added",
  rejected: "Not added",
  blocked: "Blocked"
};

/** The review status in plain words. An item that is otherwise ready still waits for its key to be confirmed. */
export function candidateStatusLabel(status: string, options: { key_confirmed?: boolean } = {}) {
  if (status === "ready_as_draft" && options.key_confirmed === false) return "Confirm the key to add";
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

/** Where an item came from, in words: "items[0]" becomes "Item 1 in the file". */
export function sourceLocationLabel(location: string | null | undefined) {
  if (!location) return "";
  const json = location.match(/^items\[(\d+)\]$/) ?? location.match(/^json item (\d+)$/);
  if (json) return `Item ${Number(json[1]) + (location.startsWith("items[") ? 1 : 0)} in the file`;
  const row = location.match(/^row (\d+)$/);
  if (row) return `Row ${row[1]} of the file`;
  const lines = location.match(/^lines (\d+)-(\d+)$/);
  if (lines) return lines[1] === lines[2] ? `Line ${lines[1]} of the file` : `Lines ${lines[1]} to ${lines[2]} of the file`;
  return location;
}

const ISSUE_DESCRIPTIONS: Record<string, string | null> = {
  missing_stem: "The question text is missing.",
  too_few_options: "Fewer than two answer options were found.",
  key_missing: "No answer key was found. Enter the correct option below.",
  key_conflict: "The answer key in the file does not match any option.",
  possible_duplicate: "This looks like an item you already have; see the note below.",
  embedded_image_requires_review: "The source has an image. Check that the item still makes sense, or add the image to the item.",
  equation_or_object_requires_review: "The source has an equation or embedded object that may not have come through. Check the wording.",
  tracked_changes_require_review: "The Word file has tracked changes. Check that this is the final wording.",
  external_relationships_not_fetched: "The Word file links to outside content, which was not loaded.",
  table_formatting_needs_review: "The item came from a table. Check that the question and the options were split correctly.",
  formatting_possible_wording_change: "The layout repair may have changed some wording. Compare it with your original.",
  assistant_check_needs_attention: "The automatic check found something to look at; see the check below.",
  assistant_check_unavailable: "The automatic check could not run for this item, so review it as usual.",
  // The key area already asks for this on every generated draft.
  teacher_confirmed_key_required: null
};

/** Review flags as short sentences for the teacher. */
export function issueFlagDescriptions(flags: string[]) {
  return flags.flatMap((flag) => {
    const description = flag in ISSUE_DESCRIPTIONS ? ISSUE_DESCRIPTIONS[flag] : `${flag.replaceAll("_", " ")}.`;
    return description ? [description[0].toUpperCase() + description.slice(1)] : [];
  });
}

export type AssistantCheckView = {
  status: "checked" | "unavailable";
  independent_answer: string | null;
  agrees_with_key: boolean;
  revised: boolean;
  remaining_problems: string[];
  /** False once the teacher has edited the stem or options that were checked. */
  current: boolean;
};

function checkedWordingIsCurrent(check: Record<string, unknown>, candidate: McqImportCandidate) {
  if (typeof check.checked_stem !== "string" || !Array.isArray(check.checked_options)) return true;
  const options = candidate.options ?? [];
  // JSONB may reorder object fields; compare the checked values, preserving option order.
  return check.checked_stem === candidate.stem && check.checked_options.length === options.length &&
    check.checked_options.every((value: unknown, index: number) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const checkedOption = value as Record<string, unknown>;
      return checkedOption.label === options[index].label && checkedOption.text === options[index].text;
    });
}

/** The check of a generated draft (answered without its key), when the batch has one. */
export function assistantCheckOf(candidate: McqImportCandidate): AssistantCheckView | null {
  const suggestion = candidate.suggestion && typeof candidate.suggestion === "object" && !Array.isArray(candidate.suggestion)
    ? (candidate.suggestion as Record<string, unknown>)
    : {};
  const value = suggestion.assistant_check;
  if (!value || typeof value !== "object") return null;
  const check = value as Record<string, unknown>;
  if (check.status !== "checked" && check.status !== "unavailable") return null;
  return {
    status: check.status,
    independent_answer: typeof check.independent_answer === "string" ? check.independent_answer : null,
    agrees_with_key: check.agrees_with_key === true,
    revised: check.revised === true,
    remaining_problems: Array.isArray(check.remaining_problems)
      ? check.remaining_problems.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      : [],
    current: checkedWordingIsCurrent(check, candidate)
  };
}

/** One or two plain sentences on the outcome of the check. */
export function assistantCheckHeadline(check: AssistantCheckView, proposedKey: string | null) {
  if (check.status === "unavailable") {
    return "The automatic check could not run for this item, so review it as usual.";
  }
  const answer = check.independent_answer ?? proposedKey;
  const passed = check.agrees_with_key && check.remaining_problems.length === 0;
  const result = passed
    ? check.revised
      ? `The first check found a problem, so the item was rewritten. On the rewritten item, the assistant answered without seeing the key, chose ${answer}, the proposed key, and found nothing else to fix.`
      : `The assistant answered this item without seeing the key, chose ${answer}, the proposed key, and found nothing to fix.`
    : check.revised
      ? "The item was rewritten once after the first check, and the second check still found something to look at:"
      : "The automatic check found something to look at:";
  return check.current
    ? result
    : `You have edited this item since the automatic check, so this result applies to the earlier wording. ${result}`;
}

/**
 * Drafts whose check chose the proposed key and found nothing to fix, with no key confirmed
 * yet. The teacher can confirm these keys together and still reads every item.
 */
export function keysTheCheckAgreedWith(candidates: McqImportCandidate[]) {
  return candidates.filter((candidate) => {
    // The key the source stated, or else the proposed key.
    const key = candidate.imported_key ?? candidate.llm_suggested_key;
    if (isImported(candidate) || candidate.teacher_confirmed_key || !key) return false;
    const check = assistantCheckOf(candidate);
    return Boolean(check && check.status === "checked" && check.current && check.agrees_with_key &&
      check.remaining_problems.length === 0 && check.independent_answer === key &&
      candidate.options.some((option) => option.label === key));
  });
}

/** The accessible-wording record of an item read from course materials; null for other items and earlier batches. */
export function accessibleWordingOf(candidate: McqImportCandidate): AccessibleWordingRecord | null {
  const suggestion = candidate.suggestion && typeof candidate.suggestion === "object" && !Array.isArray(candidate.suggestion)
    ? (candidate.suggestion as Record<string, unknown>)
    : {};
  return readAccessibleWordingRecord(suggestion.accessible_wording);
}

/** The wording this item uses: the teacher's choice for it, else the version it started with. */
export function wordingVersionOf(candidate: McqImportCandidate): WordingVersion | null {
  const record = accessibleWordingOf(candidate);
  if (!record) return null;
  const version = candidate.wording_version ?? record.default_version;
  return version === "accessible" && record.accessible ? "accessible" : "as_written";
}

/** True when the stem or options no longer match the wording chosen for this item (the teacher edited them). */
export function wordingEditedSinceChoice(candidate: McqImportCandidate) {
  const record = accessibleWordingOf(candidate);
  const version = wordingVersionOf(candidate);
  if (!record || !version) return false;
  return !sameWording({ stem: candidate.stem, options: candidate.options ?? [] }, wordingFor(record, version));
}

/**
 * Switches one item to its original or its simpler wording. Only this item changes; its stem
 * and options become that version, which is what the item contains when it is added.
 */
export function chooseWording(candidate: McqImportCandidate, version: WordingVersion): McqImportCandidate {
  const record = accessibleWordingOf(candidate);
  if (!record || isImported(candidate)) return candidate;
  if (version === "accessible" && !record.accessible) return candidate;
  const wording = wordingFor(record, version);
  return { ...candidate, wording_version: version, stem: wording.stem, options: wording.options };
}
