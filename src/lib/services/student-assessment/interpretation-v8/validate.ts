import type {
  InterpretationInputV8,
  InterpretationItemInputV8,
  InterpretationOutputV8,
  QuoteSource
} from "./contract";

/**
 * Application checks on a v8 profiling output (docs/AI_MODULE_REDESIGN_2026-10-19.md,
 * section 5). A rejected output is regenerated once with the issue list; a second failure
 * saves no profile.
 */
export type InterpretationIssue = { path: string; code: string; message: string };

const MIN_QUOTE_WORDS = 4;

export function normalizeForQuote(value: string) {
  return value
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const words = (value: string) => normalizeForQuote(value).split(" ").filter(Boolean);

function sourceText(item: InterpretationItemInputV8, source: QuoteSource) {
  if (source === "explanation") return item.response.explanation;
  if (source === "explanation_first_version") return item.response.explanation_first_version;
  return item.response.tempting_option_reason;
}

/** The quote is an exact excerpt (spacing and quotation marks normalised) of the named source. */
export function quoteProblem(item: InterpretationItemInputV8 | undefined, source: QuoteSource | null, quote: string | null) {
  if (!item) return "unknown_item";
  if (!quote || !source) return "missing_quote";
  const text = sourceText(item, source);
  if (!text) return "empty_source";
  const normalizedQuote = normalizeForQuote(quote);
  const normalizedText = normalizeForQuote(text);
  if (!normalizedQuote || !normalizedText.includes(normalizedQuote)) return "quote_not_found";
  const sourceWords = words(text).length;
  if (words(quote).length < Math.min(MIN_QUOTE_WORDS, sourceWords)) return "quote_too_short";
  return null;
}

// Instructor-facing and internal text never uses misconduct, tool-use, independence or
// character words, and is never addressed to the student.
const FORBIDDEN_INTERPRETATION_WORDS =
  /\b(cheat\w*|dishonest\w*|plagiar\w*|copied|copying|misconduct|lazy|careless\w*|unmotivated|motivation|independen\w*|gen ?ai|chatgpt|artificial intelligence|ai tool\w*|ai assistance)\b/i;
const SECOND_PERSON = /\b(you|your|yours|yourself)\b/i;

/** Quoted student words are exempt: a student may write "you" or name a tool. */
function withoutQuotations(text: string) {
  return text.replace(/"[^"]*"|“[^”]*”/g, " ");
}

export function interpretationTextProblem(text: string | null | undefined) {
  if (!text) return null;
  const own = withoutQuotations(text);
  if (FORBIDDEN_INTERPRETATION_WORDS.test(own)) return "forbidden_wording";
  if (SECOND_PERSON.test(own)) return "addressed_to_student";
  return null;
}

// Process inferences belong only in process_interpretation (prompt rule 11). Instructor-
// facing fields describe what the student selected and wrote. The phrases are specific so
// that ordinary subject wording ("a rapid reaction", "seconds") is not caught.
const PROCESS_REFERENCE =
  /\b(rapid(ly)? (selection|selected|choice|chose|answer\w*|response)|(answered|selected|chose|responded) (too |very )?(quickly|fast|rapidly)|response time|time (spent|taken|on (the )?(item|task|page))|focus(ed)? (loss|time)|lost focus|left the page|(switched|switching) (tabs?|away|pages?)|(tab|page) switch\w*|paste attempt\w*|pasted|pasting|long pause\w*|paused|hesitat\w*|changed (the|their|his|her|its) (answer|option|choice|confidence)|answer changes?|confidence changes?|revised (the|their|his|her) (answer|explanation)|engagement|process (data|indicators?|evidence))\b/i;

export function processReferenceProblem(text: string | null | undefined) {
  if (!text) return null;
  return PROCESS_REFERENCE.test(withoutQuotations(text)) ? "process_reference_outside_process_interpretation" : null;
}

const stripEndPunctuation = (value: string) => value.replace(/^[\s"'.,;:!?-]+|[\s"'.,;:!?-]+$/g, "");

/** True when the whole explanation is an excerpt of one option's own text. */
export function explanationIsOptionText(item: InterpretationItemInputV8) {
  const explanation = stripEndPunctuation(normalizeForQuote(item.response.explanation ?? ""));
  if (!explanation) return false;
  return item.options.some((option) => stripEndPunctuation(normalizeForQuote(option.text)).includes(explanation));
}

export function validateInterpretationOutputV8(input: InterpretationInputV8, output: InterpretationOutputV8): InterpretationIssue[] {
  const issues: InterpretationIssue[] = [];
  const push = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const itemsById = new Map(input.items.map((item) => [item.item_id, item]));
  const referenceIds = new Set([
    ...input.topic.references.map((reference) => reference.reference_id),
    ...input.items.flatMap((item) => item.references.map((reference) => reference.reference_id))
  ]);
  const itemReferenceIds = (item: InterpretationItemInputV8) =>
    new Set([...input.topic.references, ...item.references].map((reference) => reference.reference_id));

  const seen = new Set<string>();
  output.items.forEach((entry, index) => {
    const path = `items[${index}]`;
    const item = itemsById.get(entry.item_id);
    if (!item) { push(path, "unknown_item", `Unknown item_id ${entry.item_id}.`); return; }
    if (seen.has(entry.item_id)) push(path, "duplicate_item", `Item ${entry.item_id} is rated more than once.`);
    seen.add(entry.item_id);

    const noUsable = entry.explanation_quality === "no_usable_explanation";
    if (noUsable !== (entry.no_usable_reason !== null)) {
      push(path, "no_usable_reason_mismatch", "no_usable_reason is required for no_usable_explanation and must be null otherwise.");
    }
    if (noUsable !== (entry.adds_beyond_option_text === null)) {
      push(path, "option_text_flag_mismatch", "adds_beyond_option_text is required unless the rating is no_usable_explanation, and null for it.");
    }
    if (entry.adds_beyond_option_text === true && explanationIsOptionText(item)) {
      push(path, "option_text_flag_contradicted", "The explanation is an excerpt of an option's text, so it adds nothing beyond the options.");
    }
    if (noUsable) {
      if (entry.evidence_quote !== null) push(path, "unexpected_quote", "No quote is given for no_usable_explanation.");
    } else {
      const problem = quoteProblem(item, entry.evidence_source, entry.evidence_quote);
      if (problem) push(path, `evidence_${problem}`, "The rating needs an exact quote of at least four words from this item's own student text.");
    }
    if (entry.explanation_quality === "incorrect" && (!entry.reference_id || !itemReferenceIds(item).has(entry.reference_id))) {
      push(path, "reference_required", "An incorrect rating names the reference it contradicts.");
    }
    if (entry.reference_id && !itemReferenceIds(item).has(entry.reference_id)) {
      push(path, "unknown_reference", `Unknown reference_id ${entry.reference_id} for this item.`);
    }
    if (entry.explanation_quality === "limited" && !entry.missing_elements?.trim()) {
      push(path, "missing_elements_required", "A limited rating names the missing essential element.");
    }
    const answerIncorrect = item.response.answer_correct === false;
    if ((answerIncorrect || entry.explanation_quality === "incorrect") && entry.error_source === null) {
      push(path, "error_source_required", "An incorrect answer or explanation needs an error source.");
    }
    if (entry.explanation_quality === "adequate" && entry.error_source === "conceptual") {
      push(path, "adequate_with_conceptual_error", "An adequate explanation cannot have a conceptual error source.");
    }
    for (const [field, text] of [["rationale", entry.rationale], ["uncertainty_note", entry.uncertainty_note], ["side_remark", entry.side_remark], ["missing_elements", entry.missing_elements]] as const) {
      const problem = interpretationTextProblem(text);
      if (problem) push(`${path}.${field}`, problem, "Use neutral, third-person assessment wording.");
      const processProblem = processReferenceProblem(text);
      if (processProblem) push(`${path}.${field}`, processProblem, "Write inferences from process indicators only in process_interpretation.");
    }

    const processEntry = entry.process_interpretation;
    if (processEntry) {
      const indicators = new Map(item.process_indicators.map((indicator) => [indicator.indicator_id, indicator]));
      const cited = processEntry.indicator_ids.map((id) => indicators.get(id));
      if (cited.some((indicator) => !indicator)) {
        push(`${path}.process_interpretation`, "unknown_indicator", "Cite only this item's indicator IDs.");
      } else if (processEntry.type === "possible_revision_of_reasoning") {
        const withContent = cited.filter((indicator) => indicator!.role === "with_content");
        const changed = withContent.some((indicator) => indicator!.value !== null && indicator!.value !== false && indicator!.value !== "none");
        if (!changed) push(`${path}.process_interpretation`, "revision_without_change", "A possible revision of reasoning cites an answer, explanation or confidence change that occurred.");
        const quoteIssue = quoteProblem(item, processEntry.content_source, processEntry.content_quote);
        if (quoteIssue) push(`${path}.process_interpretation`, `content_${quoteIssue}`, "A possible revision of reasoning quotes what the student wrote.");
      } else if (processEntry.type === "limited_engagement_evidence") {
        if (!cited.some((indicator) => indicator!.name === "rapid_selection" && indicator!.value === true)) {
          push(`${path}.process_interpretation`, "role_violation", "Limited evidence of engagement rests on a rapid selection.");
        }
      } else if (cited.some((indicator) => indicator!.role !== "context")) {
        push(`${path}.process_interpretation`, "role_violation", "context_noted cites context indicators only.");
      }
      for (const text of [processEntry.note, ...processEntry.alternatives]) {
        const problem = interpretationTextProblem(text);
        if (problem) { push(`${path}.process_interpretation`, problem, "Use neutral wording with no claims about tools, independence or character."); break; }
      }
    }
  });
  for (const item of input.items) {
    if (!seen.has(item.item_id)) push("items", "missing_item", `Item ${item.item_id} has no rating.`);
  }

  output.possible_misconceptions.forEach((entry, index) => {
    const path = `possible_misconceptions[${index}]`;
    if (entry.item_ids.some((id) => !itemsById.has(id))) push(path, "unknown_item", "Cite only input item IDs.");
    if (!entry.item_ids.includes(entry.quote_item_id)) push(path, "quote_item_not_listed", "The quoted item must be one of item_ids.");
    const problem = quoteProblem(itemsById.get(entry.quote_item_id), entry.quote_source, entry.student_quote);
    if (problem) push(path, `quote_${problem}`, "A possible misconception quotes the student's own words exactly.");
    if (!referenceIds.has(entry.contradicts_reference_id)) push(path, "unknown_reference", "Name the reference the idea contradicts.");
    if (entry.matching_distractor_reference_id && !referenceIds.has(entry.matching_distractor_reference_id)) {
      push(path, "unknown_reference", "Unknown matching distractor reference.");
    }
    for (const text of [entry.idea, entry.alternative_explanation]) {
      const issue = interpretationTextProblem(text) ?? processReferenceProblem(text);
      if (issue) { push(path, issue, "Use neutral, third-person assessment wording, with no process indicators."); break; }
    }
  });

  output.considered_ideas.forEach((entry, index) => {
    const path = `considered_ideas[${index}]`;
    const problem = quoteProblem(itemsById.get(entry.item_id), entry.quote_source, entry.student_quote);
    if (problem) push(path, `quote_${problem}`, "A considered idea quotes the student's own words exactly.");
    if (!referenceIds.has(entry.contradicts_reference_id)) push(path, "unknown_reference", "Name the reference the idea contradicts.");
    const issue = interpretationTextProblem(entry.idea) ?? processReferenceProblem(entry.idea);
    if (issue) push(path, issue, "Use neutral, third-person assessment wording, with no process indicators.");
  });

  return issues;
}
