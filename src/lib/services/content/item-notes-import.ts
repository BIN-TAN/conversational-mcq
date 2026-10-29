import type { TeacherDiagnosticOptionNote } from "./teacher-diagnostic-context";

/**
 * Per-option rationales, idea labels and essential elements in import formats
 * (docs/AI_MODULE_REDESIGN_2026-10-19.md, sections 4.2 and 5). Database-free so the
 * parsing can be tested without the spreadsheet and Word libraries.
 *
 * Formats:
 * - JSON (mini-test-import-v1 items): optional "essential_elements" (one to three
 *   strings), "distractor_rationales" ({ "B": "..." }) and "idea_labels" ({ "B": "..." }).
 * - Workbook, CSV, XLSX and Word tables: optional columns essential_elements (one per
 *   line or separated by semicolons), rationale_a ... rationale_f and
 *   idea_label_a ... idea_label_f.
 */
export const IDEA_LABEL_MAX_LENGTH = 60;
export const OPTION_NOTE_LABELS = ["A", "B", "C", "D", "E", "F"] as const;

export type ImportedOptionRationale = {
  label: string;
  /** The idea that leads to the option; for an option not tied to an idea, what rules it out. */
  rationale: string | null;
  idea_label: string | null;
  /** Release 22: the option is plausible but not tied to a specific idea (use sparingly). */
  not_tied_to_an_idea?: boolean;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function rationaleColumnNames(label: string) {
  const lower = label.toLowerCase();
  return {
    rationale: [`rationale_${lower}`, `option_${lower}_rationale`, `distractor_rationale_${lower}`, `why_${lower}`],
    idea_label: [`idea_label_${lower}`, `option_${lower}_idea_label`, `idea_${lower}`]
  };
}

/** Every header name the importers map to a rationale or idea label. */
export function rationaleColumnHeaders(labels: readonly string[] = OPTION_NOTE_LABELS): string[] {
  return labels.flatMap((label) => {
    const names = rationaleColumnNames(label);
    return [...names.rationale, ...names.idea_label];
  });
}

/**
 * Reads rationale and idea-label columns for the given option labels. `read` returns the
 * trimmed cell for a normalized header name, or null.
 */
export function optionRationalesFromColumns(
  read: (header: string) => string | null,
  labels: readonly string[]
): ImportedOptionRationale[] {
  return labels.flatMap((label) => {
    const names = rationaleColumnNames(label);
    const rationale = names.rationale.map(read).find((value): value is string => Boolean(value)) ?? null;
    const ideaLabel = names.idea_label.map(read).find((value): value is string => Boolean(value)) ?? null;
    return rationale || ideaLabel
      ? [{ label, rationale, idea_label: ideaLabel ? ideaLabel.slice(0, IDEA_LABEL_MAX_LENGTH) : null }]
      : [];
  });
}

/** JSON item fields: { distractor_rationales: { B: "..." }, idea_labels: { B: "..." } }. */
export function optionRationalesFromRecords(input: {
  distractor_rationales?: Record<string, string> | null;
  idea_labels?: Record<string, string> | null;
}): ImportedOptionRationale[] {
  const rationales = input.distractor_rationales ?? {};
  const ideas = input.idea_labels ?? {};
  const labels = [...new Set([...Object.keys(rationales), ...Object.keys(ideas)].map((label) => label.trim().toUpperCase()))]
    .filter(Boolean)
    .sort();
  return labels.flatMap((label) => {
    const rationale = text(rationales[label]);
    const ideaLabel = text(ideas[label]);
    return rationale || ideaLabel
      ? [{ label, rationale, idea_label: ideaLabel ? ideaLabel.slice(0, IDEA_LABEL_MAX_LENGTH) : null }]
      : [];
  });
}

export function optionRationaleRecords(entries: ImportedOptionRationale[] | null | undefined) {
  const distractor_rationales: Record<string, string> = {};
  const idea_labels: Record<string, string> = {};
  for (const entry of entries ?? []) {
    if (entry.rationale) distractor_rationales[entry.label] = entry.rationale;
    if (entry.idea_label) idea_labels[entry.label] = entry.idea_label;
  }
  return { distractor_rationales, idea_labels };
}

/**
 * Essential elements as stored in strong_reasoning_should_mention: a list becomes one
 * element per line; text is kept as the instructor wrote it (essentialElementsList counts
 * lines, semicolons and bullets).
 */
export function essentialElementsText(value: string[] | string | null | undefined): string | null {
  if (Array.isArray(value)) {
    const list = value.map((entry) => text(entry)).filter((entry): entry is string => Boolean(entry));
    return list.length ? list.join("\n") : null;
  }
  return text(value);
}

/**
 * Workbook row values (normalized headers) to the optional JSON item fields. Empty fields
 * are omitted, so a workbook without the new columns yields the same document as before.
 */
export function workbookItemNoteFields(values: Record<string, string>, optionLabels: string[]) {
  const read = (header: string) => text(values[header]);
  const { distractor_rationales, idea_labels } = optionRationaleRecords(
    optionRationalesFromColumns(read, optionLabels)
  );
  return {
    strong_reasoning_should_mention: read("essential_elements") ?? read("strong_reasoning_should_mention"),
    ...(Object.keys(distractor_rationales).length ? { distractor_rationales } : {}),
    ...(Object.keys(idea_labels).length ? { idea_labels } : {})
  };
}

/** Workbook column headers for the item notes, beyond the original columns. */
export const WORKBOOK_NOTE_COLUMNS = ["essential_elements", ...rationaleColumnHeaders()];

/** Keeps entries for existing labels only, one per label (the last value wins). */
export function normalizeImportedOptionRationales(
  entries: ImportedOptionRationale[] | null | undefined,
  optionLabels: string[]
): ImportedOptionRationale[] {
  const allowed = new Set(optionLabels.map((label) => label.trim().toUpperCase()));
  const byLabel = new Map<string, ImportedOptionRationale>();
  for (const entry of entries ?? []) {
    const label = entry.label.trim().toUpperCase();
    if (!allowed.has(label)) continue;
    const rationale = text(entry.rationale);
    const notTied = entry.not_tied_to_an_idea === true;
    const ideaLabel = notTied ? null : text(entry.idea_label);
    if (rationale || ideaLabel || notTied) {
      byLabel.set(label, {
        label,
        rationale,
        idea_label: ideaLabel ? ideaLabel.slice(0, IDEA_LABEL_MAX_LENGTH) : null,
        ...(notTied ? { not_tied_to_an_idea: true } : {})
      });
    }
  }
  return optionLabels.map((label) => byLabel.get(label.trim().toUpperCase())).filter((entry): entry is ImportedOptionRationale => Boolean(entry));
}

/**
 * Option notes for an imported item: each incorrect option gets its own rationale and idea
 * label. An item that brings only the older single note keeps that note on every incorrect
 * option as before, so nothing is lost; an option with its own rationale does not repeat it.
 */
export function teacherOptionNotesFromImport(input: {
  option_labels: string[];
  correct_option: string;
  option_rationales?: ImportedOptionRationale[] | null;
  plain_language_note?: string | null;
}): TeacherDiagnosticOptionNote[] {
  const entries = normalizeImportedOptionRationales(input.option_rationales, input.option_labels);
  const plain = text(input.plain_language_note) ?? undefined;
  return input.option_labels
    .filter((label) => label !== input.correct_option)
    .map((label) => {
      const entry = entries.find((candidate) => candidate.label === label.trim().toUpperCase());
      if (entry?.not_tied_to_an_idea) {
        return { label, diagnostic_role: "not_diagnostic" as const, what_rules_it_out: entry.rationale ?? undefined };
      }
      return {
        label,
        misconception_reasoning_pattern: entry?.rationale ?? undefined,
        idea_label: entry?.idea_label ?? undefined,
        distractor_diagnostic_value: entry?.rationale ? undefined : plain
      };
    });
}
