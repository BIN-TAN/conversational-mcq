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
 * cannot change what the output claims about the student. Claims (possible misconceptions
 * and considered ideas) are never repaired beyond removing wrapping quotation marks: a claim
 * whose quote is not the student's exact words in the source it names fails and is dropped.
 * Evidence quotes for ratings are repaired only within the source the model named, never by
 * moving them into another of the student's texts. Every repair is recorded.
 *
 * Salvage: when the last attempt still fails, the failing parts are removed instead of the
 * whole output: a claim that fails is dropped (fewer claims, never a false one), an optional
 * note that fails is cleared, and an item whose rating fails is left unrated. An unrated
 * item is not counted in the summary label (a failed model check is not evidence about the
 * student). The fallback profile is used only when no item keeps a rating.
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
const NEGATIONS = new Set(["not", "no", "never", "nor", "cannot", "without", "neither", "none"]);

function sourceText(item: InterpretationItemInputV8, source: QuoteSource) {
  if (source === "explanation") return item.response.explanation;
  if (source === "explanation_first_version") return item.response.explanation_first_version;
  return item.response.tempting_option_reason;
}

const unwrap = (quote: string) => quote.trim().replace(/^["'“”‘’\s]+|["'“”‘’\s.,;:]+$/g, "");

/** The normalised form of a text and, for each normalised character, its index in the text. */
function normalizedWithMap(text: string) {
  let normalized = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char)) { pendingSpace = normalized.length > 0; continue; }
    if (pendingSpace) { normalized += " "; map.push(index); pendingSpace = false; }
    const replaced = /[‘’‚‛′]/.test(char) ? "'" : /[“”„‟″]/.test(char) ? '"' : /[–—]/.test(char) ? "-" : char;
    for (const lower of replaced.toLowerCase()) { normalized += lower; map.push(index); }
  }
  return { normalized, map };
}

/**
 * A quote written with an ellipsis ("A ... B"): when every part occurs, in order, in the named
 * source, the quote becomes the student's own continuous text from the first part to the
 * last. Parts that do not occur in order are never stitched together.
 */
function ellipsisSpan(item: InterpretationItemInputV8, source: QuoteSource, quote: string) {
  const parts = unwrap(quote).split(/\s*(?:\.\.\.|…|\[\.\.\.\]|\(\.\.\.\))\s*/).map((part) => unwrap(part)).filter(Boolean);
  if (parts.length < 2) return null;
  const text = sourceText(item, source);
  if (!text) return null;
  const { normalized, map } = normalizedWithMap(text);
  let cursor = 0;
  let start = -1;
  let end = -1;
  for (const part of parts) {
    const needle = normalizeForQuote(part);
    const found = normalized.indexOf(needle, cursor);
    if (found < 0) return null;
    if (start < 0) start = found;
    end = found + needle.length;
    cursor = end;
  }
  const span = text.slice(map[start], map[end - 1] + 1).trim();
  return quoteProblem(item, source, span) ? null : span;
}

/** The student's sentence that contains an exact but too-short quote (statements only, not questions). */
function containingSentence(item: InterpretationItemInputV8, source: QuoteSource, quote: string) {
  const text = sourceText(item, source);
  if (!text) return null;
  const needle = normalizeForQuote(quote);
  const sentence = text.split(/(?<=[.!?。！？])\s+|\n+/).find((part) => normalizeForQuote(part).includes(needle))?.trim();
  if (!sentence || /[?？]\s*$/.test(sentence)) return null;
  return quoteProblem(item, source, sentence) ? null : sentence;
}

const tokens = (value: string) => normalizeForQuote(value).replace(/[^\p{L}\p{N}'\s]/gu, " ").split(" ").filter(Boolean);
const negated = (list: string[]) => list.some((token) => NEGATIONS.has(token) || token.endsWith("n't"));

/** Longest common subsequence length of two token lists (order-preserving overlap). */
function lcs(a: string[], b: string[]) {
  const row: number[] = new Array(b.length + 1).fill(0);
  for (const token of a) {
    let previous = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = token === b[j - 1] ? previous + 1 : Math.max(row[j], row[j - 1]);
      previous = saved;
    }
  }
  return row[b.length];
}

/**
 * True when the quote is a close, same-meaning rendering of the text: at least 80% of the
 * quote's words occur in the text in the same order, and both or neither contain a negation.
 */
export function closeParaphrase(quote: string, text: string) {
  const quoteTokens = tokens(quote);
  const textTokens = tokens(text);
  if (quoteTokens.length < 3) return false;
  if (negated(quoteTokens) !== negated(textTokens)) return false;
  return lcs(quoteTokens, textTokens) / quoteTokens.length >= 0.8;
}

/**
 * Repairs a rating's evidence quote within the source the model named. For an adequate or
 * limited rating it may also grow a short quote to its sentence, or replace a close
 * paraphrase of a short explanation with the explanation itself. An incorrect rating's
 * evidence is only unwrapped or re-joined across an ellipsis, so it is always the student's
 * own words as the model cited them.
 */
function repairEvidenceQuote(item: InterpretationItemInputV8, quality: string, source: QuoteSource | null, quote: string | null) {
  if (!quote || !source) return null;
  const unwrapped = unwrap(quote);
  if (unwrapped !== quote && !quoteProblem(item, source, unwrapped)) return { quote: unwrapped, source, code: "evidence_quote_unwrapped" };
  const span = ellipsisSpan(item, source, quote);
  if (span) return { quote: span, source, code: "evidence_quote_ellipsis_joined" };
  if (quality !== "adequate" && quality !== "limited") return null;
  if (quoteProblem(item, source, unwrapped) === "quote_too_short") {
    const sentence = containingSentence(item, source, unwrapped);
    if (sentence) return { quote: sentence, source, code: "evidence_quote_grown_to_sentence" };
  }
  const explanation = item.response.explanation?.trim();
  if (source === "explanation" && explanation && tokens(explanation).length <= FULL_EXPLANATION_QUOTE_MAX_WORDS
    && closeParaphrase(unwrapped, explanation)) {
    return { quote: explanation, source: "explanation" as const, code: "evidence_quote_set_to_full_explanation" };
  }
  return null;
}

/** "copied the option text" describes a response, but "copied" alone can read as misconduct. */
function neutralCopyWording(text: string | null) {
  if (!text) return text;
  return text.replace(/\b(cop(?:ied|ies|ying)) (the |its |an |one )?(option|options|wording|text|answer choice|choice)\b/gi,
    (_match, verb: string, article: string | undefined, noun: string) => {
      const replacement = /ied$/i.test(verb) ? "repeated" : /ies$/i.test(verb) ? "repeats" : "repeating";
      const cased = verb[0] === verb[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
      return `${cased} ${article ?? ""}${noun}`;
    });
}

export function repairInterpretationOutputV8(input: InterpretationInputV8, original: InterpretationOutputV8): {
  output: InterpretationOutputV8;
  repairs: InterpretationRepair[];
} {
  const repairs: InterpretationRepair[] = [];
  const itemsById = new Map(input.items.map((item) => [item.item_id, item]));
  // Two ratings of one item that disagree: neither is kept (the item goes to the
  // regeneration, then stays unrated). Identical duplicates keep the first.
  const conflicting = new Set<string>();
  const firstQuality = new Map<string, string>();
  for (const entry of original.items) {
    const earlier = firstQuality.get(entry.item_id);
    if (earlier === undefined) firstQuality.set(entry.item_id, entry.explanation_quality);
    else if (earlier !== entry.explanation_quality) conflicting.add(entry.item_id);
  }
  const seen = new Set<string>();
  const items: InterpretationOutputV8["items"] = [];

  original.items.forEach((source, index) => {
    const path = `items[${index}]`;
    const item = itemsById.get(source.item_id);
    if (!item) { repairs.push({ path, code: "dropped_unknown_item" }); return; }
    if (conflicting.has(source.item_id)) { repairs.push({ path, code: "dropped_conflicting_duplicate_rating" }); return; }
    if (seen.has(source.item_id)) { repairs.push({ path, code: "dropped_duplicate_item" }); return; }
    seen.add(source.item_id);
    const entry = { ...source };
    const noUsable = entry.explanation_quality === "no_usable_explanation";

    if (noUsable && entry.no_usable_reason === null && !item.response.explanation?.trim()) {
      entry.no_usable_reason = "not_provided";
      repairs.push({ path, code: "no_usable_reason_not_provided" });
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
      const fixed = repairEvidenceQuote(item, entry.explanation_quality, entry.evidence_source, entry.evidence_quote);
      if (fixed) {
        entry.evidence_quote = fixed.quote;
        entry.evidence_source = fixed.source;
        repairs.push({ path, code: fixed.code });
      }
    }
    const references = new Set([...input.topic.references, ...item.references].map((reference) => reference.reference_id));
    if (entry.reference_id && !references.has(entry.reference_id) && entry.explanation_quality !== "incorrect") {
      entry.reference_id = null;
      repairs.push({ path, code: "unknown_reference_cleared" });
    }
    if (entry.explanation_quality === "incorrect" && (!entry.reference_id || !references.has(entry.reference_id))) {
      // An incorrect explanation contradicts the item's target reasoning by definition.
      const target = [`${item.item_id}:target`, `${item.item_id}:elements`].find((id) => references.has(id));
      if (target) {
        entry.reference_id = target;
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

  // Claims: only wrapping quotation marks are removed, in the source the model named.
  const possible_misconceptions = original.possible_misconceptions.map((source, index) => {
    const entry = { ...source, item_ids: [...new Set(source.item_ids)] };
    const quoteItem = itemsById.get(entry.quote_item_id);
    const unwrapped = unwrap(entry.student_quote);
    if (quoteItem && unwrapped !== entry.student_quote && quoteProblem(quoteItem, entry.quote_source, entry.student_quote)
      && !quoteProblem(quoteItem, entry.quote_source, unwrapped)) {
      entry.student_quote = unwrapped;
      repairs.push({ path: `possible_misconceptions[${index}]`, code: "claim_quote_unwrapped" });
    }
    return entry;
  });
  const considered_ideas = original.considered_ideas.map((source, index) => {
    const entry = { ...source };
    const item = itemsById.get(entry.item_id);
    const unwrapped = unwrap(entry.student_quote);
    if (item && unwrapped !== entry.student_quote && quoteProblem(item, entry.quote_source, entry.student_quote)
      && !quoteProblem(item, entry.quote_source, unwrapped)) {
      entry.student_quote = unwrapped;
      repairs.push({ path: `considered_ideas[${index}]`, code: "claim_quote_unwrapped" });
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
 * saved. Claims quoting an item left unrated are dropped too.
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
  const rated = new Set(items.map((entry) => entry.item_id));
  const unrated = input.items.map((item) => item.item_id).filter((id) => !rated.has(id));
  const unratedSet = new Set(unrated);
  output.possible_misconceptions.forEach((entry, index) => {
    if (unratedSet.has(entry.quote_item_id)) droppedMisconceptions.add(index);
  });
  output.considered_ideas.forEach((entry, index) => {
    if (unratedSet.has(entry.item_id)) droppedConsidered.add(index);
  });
  const salvaged: InterpretationOutputV8 = {
    items,
    possible_misconceptions: output.possible_misconceptions.filter((_, index) => !droppedMisconceptions.has(index)),
    considered_ideas: output.considered_ideas.filter((_, index) => !droppedConsidered.has(index))
  };
  // Whatever is kept must pass every check except the ratings deliberately left out.
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
