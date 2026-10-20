import { validationIssue, type ContentValidationIssue } from "./errors";
import {
  ESSENTIAL_ELEMENTS_RANGE,
  essentialElementsList,
  readOptionRationales,
  readTeacherItemMetadata
} from "./teacher-diagnostic-context";

/**
 * Item preparation rules checked when a topic or mini-test is published
 * (docs/AI_MODULE_REDESIGN_2026-10-19.md, sections 4.2 and 11, item 4).
 *
 * - Blocking: every published item lists one to three essential elements, the points the
 *   model and human reviewers judge an explanation against.
 * - Warning: an incorrect option without its own rationale ("Why a student might choose
 *   this option"). A misconception claim can cite only an option-specific rationale.
 *
 * Validation runs only when content is published, so items already published are not
 * affected until they are published again.
 */
export type PublishableItemNotes = {
  item_order?: number | null;
  options: unknown;
  correct_option: string;
  distractor_rationales?: unknown;
  administration_rules: unknown;
};

function optionLabels(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) =>
      entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).label === "string"
        ? ((entry as Record<string, unknown>).label as string).trim()
        : ""
    )
    .filter(Boolean);
}

function itemName(item: PublishableItemNotes, itemIndex: number) {
  return `Item ${typeof item.item_order === "number" ? item.item_order : itemIndex + 1}`;
}

export function essentialElementsCount(administrationRules: unknown): number {
  return essentialElementsList(
    readTeacherItemMetadata(administrationRules).correct_option_notes.strong_reasoning_should_mention ?? ""
  ).length;
}

export function essentialElementsIssues(item: PublishableItemNotes, itemIndex: number): ContentValidationIssue[] {
  const count = essentialElementsCount(item.administration_rules);
  const path = `items.${itemIndex}.teacher_diagnostic_context.correct_option_notes.strong_reasoning_should_mention`;
  if (count < ESSENTIAL_ELEMENTS_RANGE.min) {
    return [validationIssue(
      path,
      "essential_elements_required",
      `${itemName(item, itemIndex)}: list one to three essential elements, one per line, before publishing.`
    )];
  }
  if (count > ESSENTIAL_ELEMENTS_RANGE.max) {
    return [validationIssue(
      path,
      "essential_elements_too_many",
      `${itemName(item, itemIndex)}: list at most three essential elements (now ${count}).`
    )];
  }
  return [];
}

export function missingOptionRationaleLabels(item: PublishableItemNotes): string[] {
  return readOptionRationales({
    administration_rules: item.administration_rules,
    distractor_rationales: item.distractor_rationales,
    option_labels: optionLabels(item.options),
    correct_option: item.correct_option
  })
    .filter((entry) => !entry.rationale)
    .map((entry) => entry.label);
}

export function optionRationaleWarnings(item: PublishableItemNotes, itemIndex: number): ContentValidationIssue[] {
  const missing = missingOptionRationaleLabels(item);
  if (missing.length === 0) return [];
  return [validationIssue(
    `items.${itemIndex}.teacher_diagnostic_context.option_notes`,
    "option_rationale_missing",
    `${itemName(item, itemIndex)}: add "Why a student might choose this option" for option${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`
  )];
}
