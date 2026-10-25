/**
 * Accessible wording for imported items. When an instructor's existing items are read from the
 * course materials, the assistant copies each item word for word and may also propose the same
 * item in simpler wording (a grade 8 to 10 reading level). This pure module decides, without the
 * model, whether that proposal may be offered: the proposal is used only when it keeps the option
 * count and letters, every key term and symbol, every formula, table line and number, and the key,
 * and when it does not make the key stand out. Otherwise the item keeps the instructor's wording
 * and the teacher is told why in a plain sentence.
 *
 * The record built here travels with the review draft (McqImportCandidate.suggestion) so that the
 * teacher can choose either wording for each item, and so that the item's provenance records the
 * original wording and the version the teacher used. No React, no database: it is shared by the
 * service, the review page and the unit tests.
 */
import { findMathSpans } from "./rich-text";

export const ACCESSIBLE_WORDING_RECORD_VERSION = "accessible-wording-v1" as const;

export type WordingVersion = "as_written" | "accessible";
export type WordingOption = { label: string; text: string };
export type ItemWording = { stem: string; options: WordingOption[] };

/** The model's proposal for one item (ExistingItemsOutputSchema items[].accessible_version). */
export type AccessibleWordingProposal = {
  changed: boolean;
  stem: string | null;
  options: WordingOption[];
  key_terms: string[];
  change_note: string | null;
};

/**
 * accessible: a simpler version passed every check and can be used.
 * unchanged: the assistant found the wording already easy to read.
 * fallback: a simpler version was proposed but failed a check; the original wording is kept.
 * not_requested: the teacher chose to keep the wording as written for this import.
 */
export type AccessibleWordingStatus = "accessible" | "unchanged" | "fallback" | "not_requested";

export type AccessibleWordingRecord = {
  schema_version: typeof ACCESSIBLE_WORDING_RECORD_VERSION;
  prompt_version: string;
  status: AccessibleWordingStatus;
  /** The version the draft starts with. */
  default_version: WordingVersion;
  original: ItemWording;
  /** Present only when status is "accessible". */
  accessible: ItemWording | null;
  /** A proposal that failed a check, kept for the research record; never shown to students. */
  rejected_proposal: ItemWording | null;
  key_terms: string[];
  change_note: string | null;
  /** Short reasons a proposal was not used (empty unless status is "fallback"). */
  fallback_reasons: string[];
  /** One plain sentence for the teacher when the proposal was not used. */
  teacher_note: string | null;
};

// Patterns with lookbehind are built at run time (new RegExp), never written as literals: this
// module is also bundled for the review page, where a literal would stop the whole script from
// parsing in a browser without lookbehind support.
function qualifierPattern() {
  return new RegExp(String.raw`(?<![\p{L}\p{N}])(?:usually|often|generally|typically|sometimes|may|might|can|could|likely|probably|mostly|tends? to|in most cases)(?![\p{L}\p{N}])`, "iu");
}

function normalizeSpace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The formulas in a text, each with its delimiters, as written. */
export function formulaSegments(text: string): string[] {
  return findMathSpans(text).map((span) => text.slice(span.start, span.end));
}

function withoutFormulas(text: string) {
  const spans = findMathSpans(text);
  let result = "";
  let index = 0;
  for (const span of spans) {
    result += `${text.slice(index, span.start)} `;
    index = span.end;
  }
  return result + text.slice(index);
}

/** Lines of a Markdown pipe table (any line with a | outside a formula), trimmed, in order. */
export function tableLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n")
    .filter((line) => withoutFormulas(line).includes("|"))
    .map((line) => line.trim());
}

function prose(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n")
    .filter((line) => !withoutFormulas(line).includes("|"))
    .map(withoutFormulas)
    .join("\n");
}

/** The numbers in the prose of a text (formulas and tables are compared on their own). */
export function numbersIn(text: string): string[] {
  return prose(text).match(/\d+(?:[.,]\d+)*/g) ?? [];
}

/**
 * Whether a term appears in a text as a whole word or symbol. Spacing is normalized; a term of
 * more than one character that starts with a Latin letter may differ in the case of that letter
 * (for example at the start of a sentence); symbols and one-character terms such as θ or b must
 * match exactly.
 */
export function containsTerm(text: string, term: string): boolean {
  const wanted = normalizeSpace(term);
  if (!wanted) return true;
  const first = wanted[0]!;
  const head = wanted.length > 1 && /[A-Za-z]/.test(first)
    ? `[${first.toLowerCase()}${first.toUpperCase()}]`
    : escapeRegExp(first);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${head}${escapeRegExp(wanted.slice(1))}(?![\\p{L}\\p{N}_])`, "u");
  return pattern.test(normalizeSpace(text));
}

/**
 * Terms and symbols that must survive even if the model did not list them: Greek letters and
 * abbreviations written in capitals, with or without digits (IRT, ICC, 3PL, NOT).
 */
export function detectedTerms(text: string): string[] {
  const abbreviation = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:\p{N}*\p{Lu}{2,}[\p{L}\p{N}]*|\p{N}+\p{Lu}+[\p{L}\p{N}]*)(?![\p{L}\p{N}])`, "gu");
  const abbreviations = prose(text).match(abbreviation) ?? [];
  const greek = prose(text).match(/[Α-Ωα-ω]/g) ?? [];
  return [...new Set([...abbreviations, ...greek])];
}

function sameMultiset(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameSequence(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameWording(left: ItemWording, right: ItemWording) {
  return normalizeSpace(left.stem) === normalizeSpace(right.stem) &&
    left.options.length === right.options.length &&
    left.options.every((option, index) => option.label === right.options[index]!.label &&
      normalizeSpace(option.text) === normalizeSpace(right.options[index]!.text));
}

function list(values: string[]) {
  return values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function longestLabel(options: WordingOption[]) {
  const lengths = options.map((option) => normalizeSpace(option.text).length);
  const max = Math.max(...lengths);
  const longest = options.filter((_option, index) => lengths[index] === max);
  return longest.length === 1 ? longest[0]!.label : null;
}

function onlyQualifiedLabel(options: WordingOption[]) {
  const qualifier = qualifierPattern();
  const qualified = options.filter((option) => qualifier.test(option.text));
  return qualified.length === 1 ? qualified[0]!.label : null;
}

/**
 * The checks a simpler version must pass. Each failure is a short reason in plain words that
 * completes the sentence "The simpler wording was not used because ...".
 */
export function accessibleWordingProblems(input: {
  original: ItemWording;
  accessible: ItemWording;
  key_terms: string[];
  key: string | null;
}): string[] {
  const { original, accessible } = input;
  const problems: string[] = [];
  const labelsKept = accessible.options.length === original.options.length &&
    accessible.options.every((option, index) => option.label === original.options[index]!.label);
  if (!labelsKept) return ["it did not keep the same answer options"];
  if (!accessible.stem.trim() || accessible.options.some((option) => !option.text.trim())) {
    return ["it was incomplete"];
  }
  if (input.key && !accessible.options.some((option) => option.label === input.key)) {
    return ["it did not keep the correct answer"];
  }

  const fields = [
    { original: original.stem, accessible: accessible.stem },
    ...original.options.map((option, index) => ({ original: option.text, accessible: accessible.options[index]!.text }))
  ];
  const terms = [...new Set([...input.key_terms.map(normalizeSpace).filter(Boolean)])];
  const missing = new Set<string>();
  let formulaChanged = false;
  let tableChanged = false;
  let numberChanged = false;
  for (const field of fields) {
    for (const term of [...terms, ...detectedTerms(field.original)]) {
      if (containsTerm(field.original, term) && !containsTerm(field.accessible, term)) missing.add(term);
    }
    if (!sameMultiset(formulaSegments(field.original), formulaSegments(field.accessible))) formulaChanged = true;
    if (!sameSequence(tableLines(field.original), tableLines(field.accessible))) tableChanged = true;
    if (!sameMultiset(numbersIn(field.original), numbersIn(field.accessible))) numberChanged = true;
  }
  if (missing.size > 0) {
    const names = [...missing].map((term) => `"${term}"`);
    problems.push(`it did not keep the ${missing.size === 1 ? "term" : "terms"} ${list(names)} exactly as written`);
  }
  if (formulaChanged) problems.push("it changed a formula");
  if (tableChanged) problems.push("it changed a table");
  if (numberChanged) problems.push("it changed a number");

  if (input.key && original.options.length >= 2) {
    if (longestLabel(accessible.options) === input.key && longestLabel(original.options) !== input.key) {
      problems.push("it made the correct answer the longest option, which could point students to it");
    }
    if (onlyQualifiedLabel(accessible.options) === input.key && onlyQualifiedLabel(original.options) !== input.key) {
      problems.push("only the correct answer had a hedging word such as \"usually\", which could point students to it");
    }
  }
  return problems;
}

function copyWording(wording: ItemWording): ItemWording {
  return { stem: wording.stem, options: wording.options.map(({ label, text }) => ({ label, text })) };
}

/**
 * Decides which wording a draft starts with. The original wording is always kept; the simpler
 * version is offered only when it passed every check, and it is the default only when the
 * teacher asked for accessible wording for this import.
 */
export function reviewAccessibleWording(input: {
  original: ItemWording;
  proposal: AccessibleWordingProposal | null | undefined;
  key: string | null;
  requested: boolean;
  prompt_version: string;
}): AccessibleWordingRecord {
  const original = copyWording(input.original);
  const proposal = input.proposal ?? null;
  const keyTerms = [...new Set((proposal?.key_terms ?? []).map(normalizeSpace).filter(Boolean))];
  const base = {
    schema_version: ACCESSIBLE_WORDING_RECORD_VERSION,
    prompt_version: input.prompt_version,
    original,
    key_terms: keyTerms,
    change_note: null,
    accessible: null,
    rejected_proposal: null,
    fallback_reasons: [],
    teacher_note: null,
    default_version: "as_written" as const
  };
  if (!input.requested) return { ...base, key_terms: [], status: "not_requested" };
  if (!proposal || !proposal.changed) return { ...base, status: "unchanged" };

  const accessible: ItemWording = {
    stem: proposal.stem ?? "",
    options: proposal.options.map(({ label, text }) => ({ label, text }))
  };
  if (sameWording(original, accessible)) return { ...base, status: "unchanged" };
  const problems = accessibleWordingProblems({ original, accessible, key_terms: keyTerms, key: input.key });
  if (problems.length > 0) {
    return {
      ...base,
      status: "fallback",
      rejected_proposal: accessible,
      change_note: proposal.change_note,
      fallback_reasons: problems,
      teacher_note: `The assistant suggested simpler wording for this item, but it was not used because ${list(problems)}. The item keeps your wording.`
    };
  }
  return {
    ...base,
    status: "accessible",
    default_version: "accessible",
    accessible,
    change_note: proposal.change_note
  };
}

/** The wording a draft uses for a version; the original when no simpler version is available. */
export function wordingFor(record: AccessibleWordingRecord, version: WordingVersion): ItemWording {
  return copyWording(version === "accessible" && record.accessible ? record.accessible : record.original);
}

function readWording(value: unknown): ItemWording | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.stem !== "string" || !Array.isArray(record.options)) return null;
  const options = record.options.flatMap((entry) => {
    const option = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return typeof option.label === "string" && typeof option.text === "string" ? [{ label: option.label, text: option.text }] : [];
  });
  return options.length === record.options.length ? { stem: record.stem, options } : null;
}

const STATUSES: AccessibleWordingStatus[] = ["accessible", "unchanged", "fallback", "not_requested"];

/**
 * Reads a stored record (from JSON). Earlier review batches have none and give null, so their
 * items show no wording choice and keep the wording they have.
 */
export function readAccessibleWordingRecord(value: unknown): AccessibleWordingRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schema_version !== ACCESSIBLE_WORDING_RECORD_VERSION) return null;
  const status = STATUSES.find((entry) => entry === record.status);
  const original = readWording(record.original);
  if (!status || !original) return null;
  const accessible = status === "accessible" ? readWording(record.accessible) : null;
  if (status === "accessible" && !accessible) return null;
  const strings = (entry: unknown) => Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [];
  return {
    schema_version: ACCESSIBLE_WORDING_RECORD_VERSION,
    prompt_version: typeof record.prompt_version === "string" ? record.prompt_version : "",
    status,
    default_version: accessible && record.default_version === "accessible" ? "accessible" : "as_written",
    original,
    accessible,
    rejected_proposal: readWording(record.rejected_proposal),
    key_terms: strings(record.key_terms),
    change_note: typeof record.change_note === "string" && record.change_note.trim() ? record.change_note : null,
    fallback_reasons: strings(record.fallback_reasons),
    teacher_note: typeof record.teacher_note === "string" && record.teacher_note.trim() ? record.teacher_note : null
  };
}

/**
 * What the item's provenance records about its wording when it is added: the version the
 * teacher used for this item, whether the teacher edited it afterwards, and both wordings.
 */
export function wordingProvenance(input: {
  record: AccessibleWordingRecord | null;
  wording_version: WordingVersion | null | undefined;
  final: ItemWording;
}) {
  const record = input.record;
  if (!record) return null;
  const version: WordingVersion = input.wording_version === "accessible" && record.accessible ? "accessible" : "as_written";
  return {
    schema_version: record.schema_version,
    prompt_version: record.prompt_version,
    status: record.status,
    wording_version: version,
    default_version: record.default_version,
    edited_by_teacher: !sameWording(input.final, wordingFor(record, version)),
    original_wording: record.original,
    accessible_wording: record.accessible,
    rejected_proposal: record.rejected_proposal,
    key_terms: record.key_terms,
    change_note: record.change_note,
    fallback_reasons: record.fallback_reasons
  };
}
