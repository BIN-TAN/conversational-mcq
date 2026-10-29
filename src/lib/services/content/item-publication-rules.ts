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
 *   this option"). A misconception claim can cite only an option-specific rationale. An option
 *   marked as not tied to an idea needs a note on what rules it out instead.
 * - Warning: more than half of an item's incorrect options are not tied to an idea. Such
 *   options are for the occasional filler; the item's diagnostic value comes from the others.
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

function optionEntries(item: PublishableItemNotes) {
  return readOptionRationales({
    administration_rules: item.administration_rules,
    distractor_rationales: item.distractor_rationales,
    option_labels: optionLabels(item.options),
    correct_option: item.correct_option
  });
}

export function missingOptionRationaleLabels(item: PublishableItemNotes): string[] {
  return optionEntries(item)
    .filter((entry) => entry.diagnostic_role === "linked_idea" && !entry.rationale)
    .map((entry) => entry.label);
}

const plural = (labels: string[]) => `option${labels.length === 1 ? "" : "s"} ${labels.join(", ")}`;

export function optionRationaleWarnings(item: PublishableItemNotes, itemIndex: number): ContentValidationIssue[] {
  const path = `items.${itemIndex}.teacher_diagnostic_context.option_notes`;
  const entries = optionEntries(item);
  const missing = missingOptionRationaleLabels(item);
  const notDiagnostic = entries.filter((entry) => entry.diagnostic_role === "not_diagnostic");
  const withoutNote = notDiagnostic.filter((entry) => !entry.what_rules_it_out).map((entry) => entry.label);
  const issues: ContentValidationIssue[] = [];
  if (missing.length) {
    issues.push(validationIssue(path, "option_rationale_missing",
      `${itemName(item, itemIndex)}: add "Why a student might choose this option" for ${plural(missing)}.`));
  }
  if (withoutNote.length) {
    issues.push(validationIssue(path, "option_rule_out_note_missing",
      `${itemName(item, itemIndex)}: add "What rules this option out" for ${plural(withoutNote)}, which ${withoutNote.length === 1 ? "is" : "are"} not tied to an idea.`));
  }
  if (entries.length && notDiagnostic.length * 2 > entries.length) {
    issues.push(validationIssue(path, "many_options_not_diagnostic", entries.length === 1
      ? `${itemName(item, itemIndex)}: its only incorrect option is not tied to an idea, so the item cannot show which idea led a student astray.`
      : `${itemName(item, itemIndex)}: ${notDiagnostic.length} of its ${entries.length} incorrect options are not tied to an idea. Keep this for the occasional option; the item shows students' ideas only through options that rest on one.`));
  }
  return issues;
}
