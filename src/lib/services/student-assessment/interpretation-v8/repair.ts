import type {
  InterpretationInputV8,
  InterpretationItemInputV8,
  InterpretationOutputV8,
  QuoteSource
} from "./contract";
import {
  explanationIsOptionText,
  normalizeForQuote,
  quoteProblem,
  validateInterpretationOutputV8,
  type InterpretationIssue
} from "./validate";

/**
 * Keeping fallback profiles rare (docs/AI_MODULE_REDESIGN_2026-10-19.md, section 11.2).
 *
 * Repair: before an output is checked, mechanical slips are corrected by fixed rules that
 * cannot change what the output claims about the student (a quote with an ellipsis is cut
 * to the part that is the student's exact words, a missing "unclear" error source is filled,
 * a flag the application can compute is set). Every repair is recorded.
 *
 * Salvage: when the last attempt still fails, the failing parts are removed instead of the
 * whole output: a claim that fails is dropped (fewer claims, never a false one), an optional
 * note that fails is cleared, and an item whose rating fails is left unrated (it counts as
 * not interpretable). The fallback profile is used only when no item keeps a rating.
 */
export type InterpretationRepair = { path: string; code: string };

export type InterpretationSalvage = {
  unrated_item_ids: string[];
  dropped_misconceptions: number;
  dropped_considered_ideas: number;
  cleared_fields: string[];
  remaining_issue_codes: string[];
};

const FULL_EXPLANATION_QUOTE_MAX_WORDS = 80;
const DEFAULT_MISSING_ELEMENTS = "One or more essential elements are not stated.";
const wordCount = (value: string) => normalizeForQuote(value).split(" ").filter(Boolean).length;

function sourceText(item: InterpretationItemInputV8, source: QuoteSource) {
  if (source === "explanation") return item.response.explanation;
  if (source === "explanation_first_version") return item.response.explanation_first_version;
  return item.response.tempting_option_reason;
}

const QUOTE_SOURCES_IN_ORDER: QuoteSource[] = ["explanation", "tempting_option_reason", "explanation_first_version"];

/** Candidate exact excerpts of a quote: as given, without wrapping marks, and its ellipsis-separated parts. */
function quoteCandidates(quote: string) {
  const trimmed = quote.trim().replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "");
  const parts = trimmed.split(/\s*(?:\.\.\.|…|\[\.\.\.\]|\(\.\.\.\))\s*/).map((part) => part.trim().replace(/^[,;:\s]+|[,;:\s]+$/g, "")).filter(Boolean);
  return [quote, trimmed, ...parts.sort((a, b) => wordCount(b) - wordCount(a))];
}

/** The sentence of the source text that contains the (too short) quote, when it is long enough. */
function containingSentence(item: InterpretationItemInputV8, source: QuoteSource, quote: string) {
  const text = sourceText(item, source);
  if (!text) return null;
  const needle = normalizeForQuote(quote);
  const sentence = text.split(/(?<=[.!?。！？])\s+|\n+/).find((part) => normalizeForQuote(part).includes(needle));
  return sentence && !quoteProblem(item, source, sentence.trim()) ? sentence.trim() : null;
}

/** A valid (quote, source) for this item, preferring the named source; null when none is found. */
function repairQuote(item: InterpretationItemInputV8, source: QuoteSource | null, quote: string | null) {
  if (!quote) return null;
  const sources = source ? [source, ...QUOTE_SOURCES_IN_ORDER.filter((entry) => entry !== source)] : QUOTE_SOURCES_IN_ORDER;
  for (const candidate of quoteCandidates(quote)) {
    for (const candidateSource of sources) {
      const problem = quoteProblem(item, candidateSource, candidate);
      if (!problem) return { quote: candidate, source: candidateSource };
      // An exact but too-short excerpt grows to the student's sentence that contains it.
      if (problem === "quote_too_short") {
        const sentence = containingSentence(item, candidateSource, candidate);
        if (sentence) return { quote: sentence, source: candidateSource };
      }
    }
  }
  return null;
}

function itemReferenceIds(input: InterpretationInputV8, item: InterpretationItemInputV8) {
  return new Set([...input.topic.references, ...item.references].map((reference) => reference.reference_id));
}

function defaultContradictedReference(input: InterpretationInputV8, item: InterpretationItemInputV8 | undefined) {
  const ids = item ? itemReferenceIds(input, item) : new Set(input.topic.references.map((reference) => reference.reference_id));
  for (const candidate of [item && `${item.item_id}:target`, item && `${item.item_id}:elements`, "topic:objective", "topic:description"]) {
    if (candidate && ids.has(candidate)) return candidate;
  }
  return null;
}

/** True when most of the quote's content words occur in the text (a paraphrase, not an invention). */
function paraphrasesText(quote: string | null, text: string) {
  if (!quote) return false;
  const content = (value: string) => normalizeForQuote(value).replace(/[^\p{L}\p{N}\s]/gu, " ").split(" ").filter((word) => word.length > 2);
  const quoteWords = content(quote);
  if (!quoteWords.length) return false;
  const textWords = new Set(content(text));
  return quoteWords.filter((word) => textWords.has(word)).length / quoteWords.length >= 0.8;
}

/** "copied"/"copying" describing a response that repeats option wording reads as a misconduct word. */
function neutralCopyWording(text: string | null) {
  if (!text) return text;
  return text.replace(/\bcopied\b/gi, (word) => (word[0] === "C" ? "Repeated" : "repeated"))
    .replace(/\bcopying\b/gi, (word) => (word[0] === "C" ? "Repeating" : "repeating"));
}

export function repairInterpretationOutputV8(input: InterpretationInputV8, original: InterpretationOutputV8): {
  output: InterpretationOutputV8;
  repairs: InterpretationRepair[];
} {
  const repairs: InterpretationRepair[] = [];
  const itemsById = new Map(input.items.map((item) => [item.item_id, item]));
  const seen = new Set<string>();
  const items: InterpretationOutputV8["items"] = [];

  original.items.forEach((source, index) => {
    const path = `items[${index}]`;
    const item = itemsById.get(source.item_id);
    if (!item) { repairs.push({ path, code: "dropped_unknown_item" }); return; }
    if (seen.has(source.item_id)) { repairs.push({ path, code: "dropped_duplicate_item" }); return; }
    seen.add(source.item_id);
    const entry = { ...source };
    const noUsable = entry.explanation_quality === "no_usable_explanation";

    if (noUsable && entry.no_usable_reason === null && !item.response.explanation?.trim()) {
      entry.no_usable_reason = "not_provided";
      repairs.push({ path, code: "no_usable_reason_not_provided" });
    }
    if (!noUsable && entry.no_usable_reason !== null) {
      entry.no_usable_reason = null;
      repairs.push({ path, code: "no_usable_reason_cleared" });
    }
    if (noUsable && entry.adds_beyond_option_text !== null) {
      entry.adds_beyond_option_text = null;
      repairs.push({ path, code: "option_text_flag_cleared" });
    }
    const optionText = explanationIsOptionText(item);
    if (!noUsable && optionText && entry.adds_beyond_option_text !== false) {
      entry.adds_beyond_option_text = false;
      repairs.push({ path, code: "option_text_flag_computed" });
    }
    if (noUsable && (entry.evidence_quote !== null || entry.evidence_source !== null)) {
      entry.evidence_quote = null;
      entry.evidence_source = null;
      repairs.push({ path, code: "quote_cleared_for_no_usable" });
    }
    if (!noUsable && quoteProblem(item, entry.evidence_source, entry.evidence_quote)) {
      const fixed = repairQuote(item, entry.evidence_source, entry.evidence_quote);
      if (fixed) {
        entry.evidence_quote = fixed.quote;
        entry.evidence_source = fixed.source;
        repairs.push({ path, code: "evidence_quote_trimmed_to_exact_words" });
      } else if (item.response.explanation?.trim() && wordCount(item.response.explanation) <= FULL_EXPLANATION_QUOTE_MAX_WORDS &&
        paraphrasesText(entry.evidence_quote, item.response.explanation)) {
        // A close paraphrase of a short explanation: the rating judges the whole explanation,
        // so the whole explanation is faithful evidence for it. A quote that is not in the
        // student's words at all is not repaired (the rating may rest on invented content).
        entry.evidence_quote = item.response.explanation.trim();
        entry.evidence_source = "explanation";
        repairs.push({ path, code: "evidence_quote_set_to_full_explanation" });
      }
    }
    const references = itemReferenceIds(input, item);
    if (entry.reference_id && !references.has(entry.reference_id) && entry.explanation_quality !== "incorrect") {
      entry.reference_id = null;
      repairs.push({ path, code: "unknown_reference_cleared" });
    }
    if (entry.explanation_quality === "incorrect" && (!entry.reference_id || !references.has(entry.reference_id))) {
      const fallbackReference = defaultContradictedReference(input, item);
      if (fallbackReference) {
        entry.reference_id = fallbackReference;
        repairs.push({ path, code: "reference_set_to_target_reasoning" });
      }
    }
    if (entry.explanation_quality === "limited" && !entry.missing_elements?.trim()) {
      entry.missing_elements = DEFAULT_MISSING_ELEMENTS;
      repairs.push({ path, code: "missing_elements_default" });
    }
    if ((item.response.answer_correct === false || entry.explanation_quality === "incorrect") && entry.error_source === null) {
      entry.error_source = "unclear";
      repairs.push({ path, code: "error_source_unclear" });
    }
    if (optionText || entry.adds_beyond_option_text === false) {
      for (const field of ["rationale", "missing_elements", "uncertainty_note"] as const) {
        const before = entry[field];
        const after = neutralCopyWording(before);
        if (after !== before) {
          (entry as Record<string, unknown>)[field] = after;
          repairs.push({ path: `${path}.${field}`, code: "copy_wording_neutralised" });
        }
      }
    }
    items.push(entry);
  });

  const possible_misconceptions = original.possible_misconceptions.map((source, index) => {
    const path = `possible_misconceptions[${index}]`;
    const entry = { ...source, item_ids: [...new Set(source.item_ids)] };
    const quoteItem = itemsById.get(entry.quote_item_id);
    if (quoteItem && quoteProblem(quoteItem, entry.quote_source, entry.student_quote)) {
      const fixed = repairQuote(quoteItem, entry.quote_source, entry.student_quote);
      if (fixed) {
        entry.student_quote = fixed.quote;
        entry.quote_source = fixed.source;
        repairs.push({ path, code: "claim_quote_trimmed_to_exact_words" });
      }
    }
    if (quoteItem && !entry.item_ids.includes(entry.quote_item_id)) {
      entry.item_ids = [entry.quote_item_id, ...entry.item_ids];
      repairs.push({ path, code: "quote_item_added_to_item_ids" });
    }
    const allReferences = new Set([...input.topic.references, ...input.items.flatMap((item) => item.references)].map((reference) => reference.reference_id));
    if (!allReferences.has(entry.contradicts_reference_id)) {
      const fallbackReference = defaultContradictedReference(input, quoteItem ?? itemsById.get(entry.item_ids[0] ?? ""));
      if (fallbackReference) {
        entry.contradicts_reference_id = fallbackReference;
        repairs.push({ path, code: "contradicted_reference_set_to_target_reasoning" });
      }
    }
    if (entry.matching_distractor_reference_id && !allReferences.has(entry.matching_distractor_reference_id)) {
      entry.matching_distractor_reference_id = null;
      repairs.push({ path, code: "unknown_distractor_reference_cleared" });
    }
    return entry;
  });

  const considered_ideas = original.considered_ideas.map((source, index) => {
    const path = `considered_ideas[${index}]`;
    const entry = { ...source };
    const item = itemsById.get(entry.item_id);
    if (item && quoteProblem(item, entry.quote_source, entry.student_quote)) {
      const fixed = repairQuote(item, entry.quote_source, entry.student_quote);
      if (fixed) {
        entry.student_quote = fixed.quote;
        entry.quote_source = fixed.source;
        repairs.push({ path, code: "claim_quote_trimmed_to_exact_words" });
      }
    }
    if (item && !itemReferenceIds(input, item).has(entry.contradicts_reference_id)) {
      const fallbackReference = defaultContradictedReference(input, item);
      if (fallbackReference) {
        entry.contradicts_reference_id = fallbackReference;
        repairs.push({ path, code: "contradicted_reference_set_to_target_reasoning" });
      }
    }
    return entry;
  });

  return { output: { items, possible_misconceptions, considered_ideas }, repairs };
}

const indexOf = (path: string, collection: string) => {
  const match = new RegExp(`^${collection}\\[(\\d+)\\]`).exec(path);
  return match ? Number(match[1]) : null;
};

/**
 * Removes the parts of an output that still fail after the last attempt. Returns null when
 * nothing usable is left (no item keeps a rating), in which case the fallback profile is
 * saved.
 */
export function salvageInterpretationOutputV8(
  input: InterpretationInputV8,
  output: InterpretationOutputV8,
  issues: InterpretationIssue[]
): { output: InterpretationOutputV8; salvage: InterpretationSalvage } | null {
  const unratedIndexes = new Set<number>();
  const droppedMisconceptions = new Set<number>();
  const droppedConsidered = new Set<number>();
  const cleared: Array<{ index: number; field: "side_remark" | "uncertainty_note" | "process_interpretation" }> = [];
  for (const issue of issues) {
    const misconception = indexOf(issue.path, "possible_misconceptions");
    if (misconception !== null) { droppedMisconceptions.add(misconception); continue; }
    const considered = indexOf(issue.path, "considered_ideas");
    if (considered !== null) { droppedConsidered.add(considered); continue; }
    const item = indexOf(issue.path, "items");
    if (item === null) continue; // "items" (missing_item): the item simply stays unrated.
    const field = issue.path.slice(`items[${item}]`.length);
    if (field === ".side_remark" || field === ".uncertainty_note" || field === ".process_interpretation") {
      cleared.push({ index: item, field: field.slice(1) as "side_remark" | "uncertainty_note" | "process_interpretation" });
    } else {
      unratedIndexes.add(item);
    }
  }
  const items = output.items
    .map((entry, index) => {
      if (unratedIndexes.has(index)) return null;
      const fields = cleared.filter((entry) => entry.index === index).map((entry) => entry.field);
      return fields.length ? { ...entry, ...Object.fromEntries(fields.map((field) => [field, null])) } : entry;
    })
    .filter((entry): entry is InterpretationOutputV8["items"][number] => entry !== null);
  if (!items.length) return null;
  const salvaged: InterpretationOutputV8 = {
    items,
    possible_misconceptions: output.possible_misconceptions.filter((_, index) => !droppedMisconceptions.has(index)),
    considered_ideas: output.considered_ideas.filter((_, index) => !droppedConsidered.has(index))
  };
  const rated = new Set(items.map((entry) => entry.item_id));
  const unrated = input.items.map((item) => item.item_id).filter((id) => !rated.has(id));
  // Whatever is kept must pass every check except the ratings deliberately left out.
  const unratedSet = new Set(unrated);
  const remaining = validateInterpretationOutputV8(input, salvaged).filter((issue) => {
    const missing = issue.code === "missing_item" ? /^Item (.+) has no rating\.$/.exec(issue.message)?.[1] : undefined;
    return !(missing !== undefined && unratedSet.has(missing));
  });
  if (remaining.length) return null;
  return {
    output: salvaged,
    salvage: {
      unrated_item_ids: unrated,
      dropped_misconceptions: droppedMisconceptions.size,
      dropped_considered_ideas: droppedConsidered.size,
      cleared_fields: cleared.map((entry) => `${output.items[entry.index]?.item_id ?? entry.index}.${entry.field}`),
      remaining_issue_codes: [...new Set(issues.map((issue) => issue.code))]
    }
  };
}
