/**
 * Wording fixes for items in a mini test that students have already started (item-wording-fix-v1).
 *
 * Once a student starts a mini test its items are locked, and a bigger correction creates a new
 * mini-test version. A wording fix is the small exception: the instructor may correct the wording
 * of the stem and the option texts, and the teacher-only notes, in place. The item keeps its
 * public ID and version, so every student's data stays under one item. What cannot change here:
 * the answer key, the option letters and their order, the number of options, media, inclusion
 * in the published set, and every other administration rule.
 *
 * Answers already given keep their own item_snapshot (the wording that student saw), and each fix
 * is recorded in item_wording_corrections with the reason and the fields before and after.
 *
 * This module is pure (no database): it validates a request against the stored item and returns
 * the item fields to save and the record to keep. item-wording-fix.ts does the database work.
 */
import { z } from "zod";
import { ContentServiceError, validationIssue } from "./errors";
import { ItemOptionSchema } from "./validation";
import {
  ESSENTIAL_ELEMENTS_RANGE,
  essentialElementsList,
  readTeacherItemMetadata
} from "./teacher-diagnostic-context";

export const ITEM_WORDING_FIX_VERSION = "item-wording-fix-v1" as const;

const CONTEXT_KEY = "teacher_diagnostic_context";

/** Administration-rule keys that hold only the teacher's notes (rebuilt from them by the editor). */
export const WORDING_FIX_NOTE_RULE_KEYS = [
  "option_diagnostic_notes",
  "option_misconception_map",
  "expected_solution_actions"
] as const;

/** Notes inside teacher_diagnostic_context that a wording fix may change. */
export const WORDING_FIX_CONTEXT_KEYS = [
  "item_label",
  "expected_reasoning_note",
  "item_diagnostic_value_note",
  "plain_language_distractor_diagnostic_notes",
  "correct_option_notes",
  "option_notes"
] as const;

export const ItemWordingFixInputSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(5, "Briefly say what you are fixing (at least 5 characters).")
      .max(1000, "Keep the reason under 1,000 characters."),
    item_stem: z.string().trim().min(1, "The item wording cannot be empty."),
    options: z.array(ItemOptionSchema).min(2).max(6),
    correct_option: z.string().trim().min(1).optional(),
    distractor_rationales: z.record(z.string(), z.string().trim().min(1)).optional(),
    expected_reasoning_patterns: z.array(z.string().trim().min(1)).optional(),
    administration_rules: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type ItemWordingFixInput = z.infer<typeof ItemWordingFixInputSchema>;

export type ItemWordingFixSource = {
  item_stem: string;
  options: unknown;
  correct_option: string;
  distractor_rationales: unknown;
  expected_reasoning_patterns: unknown;
  administration_rules: unknown;
};

export type ItemWordingFixField =
  | "item_stem"
  | "options"
  | "distractor_rationales"
  | "expected_reasoning_patterns"
  | "teacher_notes";

export type ItemWordingFixPlan = {
  reason: string;
  changed_fields: ItemWordingFixField[];
  next: {
    item_stem: string;
    options: Array<{ label: string; text: string }>;
    distractor_rationales: Record<string, string>;
    expected_reasoning_patterns: string[];
    administration_rules: Record<string, unknown>;
  };
  before: Partial<Record<ItemWordingFixField, unknown>>;
  after: Partial<Record<ItemWordingFixField, unknown>>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left ?? null)) === JSON.stringify(canonical(right ?? null));
}

function storedOptions(value: unknown): Array<{ label: string; text: string }> {
  return (Array.isArray(value) ? value : []).map(record).map((option) => ({
    label: typeof option.label === "string" ? option.label : "",
    text: typeof option.text === "string" ? option.text : ""
  }));
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function lockedChange(message: string, details: Record<string, unknown> = {}) {
  return new ContentServiceError("wording_fix_changes_locked_content", message, 409, details);
}

/**
 * The stored rules with only the teacher notes taken from the request: every other key (import
 * provenance, item role, administration settings, other context entries) stays as stored, so a
 * wording fix cannot change how the item is given or what its record says about its origin.
 */
export function mergeWordingFixRules(stored: unknown, requested: Record<string, unknown>) {
  const storedRules = record(stored);
  const next: Record<string, unknown> = { ...storedRules };
  for (const key of WORDING_FIX_NOTE_RULE_KEYS) {
    if (requested[key] === undefined) delete next[key];
    else next[key] = requested[key];
  }
  const storedContext = record(storedRules[CONTEXT_KEY]);
  const requestedContext = record(requested[CONTEXT_KEY]);
  const context: Record<string, unknown> = { ...storedContext };
  for (const key of WORDING_FIX_CONTEXT_KEYS) {
    if (requestedContext[key] === undefined) delete context[key];
    else context[key] = requestedContext[key];
  }
  if (Object.keys(context).length > 0) next[CONTEXT_KEY] = context;
  else delete next[CONTEXT_KEY];
  return next;
}

function teacherNotes(rules: Record<string, unknown>) {
  const context = record(rules[CONTEXT_KEY]);
  return {
    ...Object.fromEntries(WORDING_FIX_NOTE_RULE_KEYS.map((key) => [key, rules[key] ?? null])),
    [CONTEXT_KEY]: Object.fromEntries(WORDING_FIX_CONTEXT_KEYS.map((key) => [key, context[key] ?? null]))
  };
}

export function planItemWordingFix(source: ItemWordingFixSource, rawInput: unknown): ItemWordingFixPlan {
  const parsed = ItemWordingFixInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ContentServiceError(
      "validation_failed",
      parsed.error.issues[0]?.message ?? "The wording fix could not be read.",
      400,
      { issues: parsed.error.issues.map((issue) => validationIssue(issue.path.join("."), issue.code, issue.message)) }
    );
  }
  const input = parsed.data;

  if (input.correct_option !== undefined && input.correct_option !== source.correct_option) {
    throw lockedChange(
      "A wording fix cannot change the answer key. To change the key, create a new version of the mini test.",
      { field: "correct_option" }
    );
  }

  const beforeOptions = storedOptions(source.options);
  const beforeLabels = beforeOptions.map((option) => option.label);
  const requestedLabels = input.options.map((option) => option.label);
  if (beforeLabels.join("\u0000") !== requestedLabels.join("\u0000")) {
    throw lockedChange(
      "A wording fix keeps the same options in the same order. To add, remove, or reorder options, create a new version of the mini test.",
      { field: "options", stored_labels: beforeLabels, requested_labels: requestedLabels }
    );
  }

  const incorrectLabels = new Set(beforeLabels.filter((label) => label !== source.correct_option));
  const beforeRationales = stringRecord(source.distractor_rationales);
  const nextRationales = input.distractor_rationales ?? beforeRationales;
  // Checked only when the request sends rationales: stored rationales are kept as they are.
  const strayRationale = input.distractor_rationales
    ? Object.keys(input.distractor_rationales).find((label) => !incorrectLabels.has(label))
    : undefined;
  if (strayRationale) {
    throw new ContentServiceError(
      "validation_failed",
      `Option ${strayRationale} is not an incorrect option of this item, so it cannot have a rationale.`,
      400,
      { field: "distractor_rationales", label: strayRationale }
    );
  }

  const beforePatterns = stringList(source.expected_reasoning_patterns);
  const nextPatterns = input.expected_reasoning_patterns ?? beforePatterns;
  const beforeRules = record(source.administration_rules);
  const nextRules = input.administration_rules ? mergeWordingFixRules(beforeRules, input.administration_rules) : beforeRules;

  const elementsBefore = essentialElementsList(
    readTeacherItemMetadata(beforeRules).correct_option_notes.strong_reasoning_should_mention ?? ""
  ).length;
  const elementsAfter = essentialElementsList(
    readTeacherItemMetadata(nextRules).correct_option_notes.strong_reasoning_should_mention ?? ""
  ).length;
  const inRange = (count: number) => count >= ESSENTIAL_ELEMENTS_RANGE.min && count <= ESSENTIAL_ELEMENTS_RANGE.max;
  if (inRange(elementsBefore) && !inRange(elementsAfter)) {
    throw new ContentServiceError(
      "validation_failed",
      "Keep one to three essential elements. Feedback for this item relies on them.",
      400,
      { field: "essential_elements", count: elementsAfter }
    );
  }

  // Text the request leaves as it was (apart from the surrounding spaces the form trims) keeps its
  // stored form, so an untouched stem or option is never counted or saved as changed.
  const nextStem = input.item_stem === source.item_stem.trim() ? source.item_stem : input.item_stem;
  const nextOptions = input.options.map((option, index) => ({
    label: option.label,
    text: option.text === beforeOptions[index].text.trim() ? beforeOptions[index].text : option.text
  }));
  const comparisons: Array<[ItemWordingFixField, unknown, unknown]> = [
    ["item_stem", source.item_stem, nextStem],
    ["options", beforeOptions, nextOptions],
    ["distractor_rationales", beforeRationales, nextRationales],
    ["expected_reasoning_patterns", beforePatterns, nextPatterns],
    ["teacher_notes", teacherNotes(beforeRules), teacherNotes(nextRules)]
  ];
  const changed = comparisons.filter(([, before, after]) => !same(before, after));
  if (changed.length === 0) {
    throw new ContentServiceError("validation_failed", "Nothing was changed, so there is no wording fix to save.", 400, {
      field: "item_stem"
    });
  }

  return {
    reason: input.reason,
    changed_fields: changed.map(([field]) => field),
    next: {
      item_stem: nextStem,
      options: nextOptions,
      distractor_rationales: nextRationales,
      expected_reasoning_patterns: nextPatterns,
      administration_rules: nextRules
    },
    before: Object.fromEntries(changed.map(([field, before]) => [field, before])),
    after: Object.fromEntries(changed.map(([field, , after]) => [field, after]))
  };
}
