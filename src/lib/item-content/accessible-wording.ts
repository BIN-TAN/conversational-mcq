/**
 * Accessible wording for imported items. When an instructor's existing items are read from the
 * course materials, the assistant copies each item word for word and may also propose the same
 * item in simpler wording (a grade 8 to 10 reading level). This pure module decides, without the
 * model, whether that proposal may be offered: the proposal is used only when it keeps the option
 * count and letters, every key term and symbol, every formula, table line and number (in order),
 * the words that decide what is asked (not, except, at least, more, increases ...), each option's
 * idea under its own letter, and the key, and when it does not make the key stand out. Otherwise the item keeps the instructor's wording
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

/**
 * The numbers in the prose of a text, in order, with a leading sign and a trailing percent sign
 * (formulas and tables are compared on their own). Order matters: "a = 2, b = 3" and
 * "a = 3, b = 2" differ.
 */
export function numbersIn(text: string): string[] {
  // A sign counts only where it cannot be a range or a hyphen ("8-10" is 8 and 10; "-1.5" is -1.5).
  const number = new RegExp(String.raw`(?:(?<![\p{L}\p{N}])[-−+])?\d+(?:[.,]\d+)*%?`, "gu");
  return (prose(text).match(number) ?? []).map((value) => value.replace("\u2212", "-"));
}

/**
 * Words that decide what a question asks or what an option claims. In each field, a simpler
 * version must use every "exact" group (negation and scope: not, except, only, all ...) exactly
 * as often as the original, and may not use a "kept" group (one side of an opposite pair such as
 * least/most, increase/decrease or true/false) less often than the original. So dropping "not" or
 * "except", or turning "at least" into "at most" or "increases" into "decreases", is caught, while
 * "Which statement is accurate?" may become "Which statement is true?". Contractions such as
 * "doesn't" count as "not".
 */
const MEANING_WORD_GROUPS: Array<{ name: string; rule: "exact" | "kept"; pattern: string }> = [
  { name: "not", rule: "exact", pattern: String.raw`not|cannot|\p{L}+n['’]t` },
  { name: "no", rule: "exact", pattern: String.raw`no(?!\.\s*\d)` },
  { name: "never", rule: "exact", pattern: "never" },
  { name: "none", rule: "exact", pattern: "none" },
  { name: "neither", rule: "exact", pattern: "neither|nor" },
  { name: "except", rule: "exact", pattern: "except" },
  { name: "without", rule: "exact", pattern: "without" },
  { name: "only", rule: "exact", pattern: "only" },
  { name: "all", rule: "exact", pattern: "all|every|always" },
  { name: "unequal", rule: "exact", pattern: "unequal|unlike|dissimilar" },
  { name: "least", rule: "kept", pattern: "least" },
  { name: "most", rule: "kept", pattern: "most" },
  { name: "more", rule: "kept", pattern: "more" },
  { name: "less", rule: "kept", pattern: "less|fewer" },
  { name: "higher", rule: "kept", pattern: "higher|highest|greater|greatest|larger|largest|above|exceeds?|exceeded|exceeding" },
  { name: "lower", rule: "kept", pattern: "lower|lowest|smaller|smallest|below" },
  { name: "increase", rule: "kept", pattern: "increase|increases|increased|increasing|rise|rises|rising|rose|risen|raise|raises|raised|raising" },
  { name: "decrease", rule: "kept", pattern: "decrease|decreases|decreased|decreasing|reduce|reduces|reduced|reducing|fall|falls|falling|fell|fallen|drop|drops|dropped|dropping" },
  { name: "same", rule: "kept", pattern: "same|equal|equals|equally|identical" },
  { name: "different", rule: "kept", pattern: "different|differs?|differed" },
  { name: "true", rule: "kept", pattern: "true|correct" },
  { name: "false", rule: "kept", pattern: "false|incorrect|wrong" },
  { name: "best", rule: "kept", pattern: "best" },
  { name: "worst", rule: "kept", pattern: "worst" },
  { name: "before", rule: "kept", pattern: "before" },
  { name: "after", rule: "kept", pattern: "after" },
  { name: "first", rule: "kept", pattern: "first" },
  { name: "last", rule: "kept", pattern: "last" },
  { name: "positive", rule: "kept", pattern: "positive|positively" },
  { name: "negative", rule: "kept", pattern: "negative|negatively" },
  { name: "maximum", rule: "kept", pattern: "maximum|maximal|maximize[sd]?|maximizing" },
  { name: "minimum", rule: "kept", pattern: "minimum|minimal|minimize[sd]?|minimizing" },
  { name: "likely", rule: "kept", pattern: "likely" },
  { name: "unlikely", rule: "exact", pattern: "unlikely" },
  { name: "valid", rule: "kept", pattern: "valid|validly" },
  { name: "invalid", rule: "exact", pattern: "invalid|invalidly" },
  { name: "overestimate", rule: "kept", pattern: "overestimate[sd]?|overestimating|overestimation" },
  { name: "underestimate", rule: "kept", pattern: "underestimate[sd]?|underestimating|underestimation" },
  { name: "strong", rule: "kept", pattern: "strong|stronger|strongest|strongly" },
  { name: "weak", rule: "kept", pattern: "weak|weaker|weakest|weakly" },
  { name: "high", rule: "kept", pattern: "high" },
  { name: "low", rule: "kept", pattern: "low" }
];

function meaningWordCounts(text: string): Map<string, number> {
  const words = prose(text);
  const counts = new Map<string, number>();
  for (const group of MEANING_WORD_GROUPS) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${group.pattern})(?![\\p{L}\\p{N}])`, "giu");
    counts.set(group.name, (words.match(pattern) ?? []).length);
  }
  return counts;
}

/** The meaning-word groups a simpler version changed in a way that can change the meaning. */
export function changedMeaningWords(original: string, accessible: string): string[] {
  const before = meaningWordCounts(original);
  const after = meaningWordCounts(accessible);
  return MEANING_WORD_GROUPS.filter((group) => {
    const was = before.get(group.name) ?? 0;
    const now = after.get(group.name) ?? 0;
    return group.rule === "exact" ? was !== now : now < was;
  }).map((group) => group.name);
}

const COMMON_WORDS = new Set(["a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "were", "be",
  "it", "its", "this", "that", "these", "those", "with", "as", "by", "at", "from", "which", "what", "does", "do", "has", "have"]);

function contentWords(text: string): Set<string> {
  return new Set((normalizeSpace(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !COMMON_WORDS.has(word)));
}

function overlap(left: Set<string>, right: Set<string>) {
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Whether each rewritten option still corresponds to its own original option. A version in which
 * option B's new text shares more words with the original option A than with the original B has
 * moved an idea to another letter, so the key could point at a different answer.
 */
export function optionsKeptTheirPlace(original: WordingOption[], accessible: WordingOption[]): boolean {
  const before = original.map((option) => contentWords(option.text));
  return accessible.every((option, index) => {
    const words = contentWords(option.text);
    const own = overlap(words, before[index]!);
    return before.every((other, otherIndex) => otherIndex === index || overlap(words, other) <= own);
  });
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
 * Whether a term the assistant listed appears in a text. Like containsTerm, but a term of more
 * than one character that starts with a Latin letter matches in any case and also in its plural
 * ("Standard Error of Measurement" matches "standard error of measurement", and "item parameter"
 * matches "item parameters"), so that a term is not left unchecked because the list wrote it
 * differently from the item. Symbols and one-character terms must still match exactly.
 */
export function containsListedTerm(text: string, term: string): boolean {
  const wanted = normalizeSpace(term);
  if (!wanted) return true;
  if (wanted.length < 2 || !/^[A-Za-z]/.test(wanted)) return containsTerm(text, term);
  // "parameter" also matches "parameters", and "ability" also matches "abilities".
  const body = /[^aeiou]y$/i.test(wanted)
    ? `${escapeRegExp(wanted.slice(0, -1))}(?:y|ies)`
    : `${escapeRegExp(wanted)}${/\p{L}$/u.test(wanted) ? "(?:s|es)?" : ""}`;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "iu");
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
  const meaningWords = new Set<string>();
  let formulaChanged = false;
  let tableChanged = false;
  let numberChanged = false;
  for (const field of fields) {
    for (const term of terms) {
      if (containsListedTerm(field.original, term) && !containsListedTerm(field.accessible, term)) missing.add(term);
    }
    for (const term of detectedTerms(field.original)) {
      if (containsTerm(field.original, term) && !containsTerm(field.accessible, term)) missing.add(term);
    }
    for (const word of changedMeaningWords(field.original, field.accessible)) meaningWords.add(word);
    if (!sameMultiset(formulaSegments(field.original), formulaSegments(field.accessible))) formulaChanged = true;
    if (!sameSequence(tableLines(field.original), tableLines(field.accessible))) tableChanged = true;
    if (!sameSequence(numbersIn(field.original), numbersIn(field.accessible))) numberChanged = true;
  }
  if (missing.size > 0) {
    const names = [...missing].map((term) => `"${term}"`);
    problems.push(`it did not keep the ${missing.size === 1 ? "term" : "terms"} ${list(names)} exactly as written`);
  }
  if (meaningWords.size > 0) {
    const names = [...meaningWords].map((word) => `"${word}"`);
    problems.push(`it added or removed ${meaningWords.size === 1 ? "the word" : "the words"} ${list(names)} or a word like ${meaningWords.size === 1 ? "it" : "them"}, which can change what the question asks`);
  }
  if (formulaChanged) problems.push("it changed a formula");
  if (tableChanged) problems.push("it changed a table");
  if (numberChanged) problems.push("it changed a number or the order of the numbers");
  if (!optionsKeptTheirPlace(original.options, accessible.options)) {
    problems.push("an option's new wording matched a different option's idea, so the key could point to a different answer");
  }

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

/**
 * The wording version stored after a teacher's update of one item. A request applies only to an
 * item that has a wording record, and "accessible" only when a checked simpler version exists, so
 * a client cannot choose a proposal that failed a check.
 */
export function wordingVersionAfterChoice(
  record: AccessibleWordingRecord | null,
  current: WordingVersion | null | undefined,
  requested: WordingVersion | undefined
): WordingVersion | null | undefined {
  if (requested === undefined || !record) return current;
  return requested === "accessible" && !record.accessible ? "as_written" : requested;
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
    fallback_reasons: record.fallback_reasons,
    // Why the item started in the instructor's wording although a simpler version passed every check.
    teacher_note: record.teacher_note
  };
}
