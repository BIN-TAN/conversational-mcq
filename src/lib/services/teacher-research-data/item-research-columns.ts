import { isBlockedPasteEvent } from "@/lib/services/student-assessment/blocked-paste";
import { studentSafeAnswerExplanationFromResponse } from "@/lib/services/student-assessment/evidence-integrated-profile";
import { itemReferences } from "@/lib/services/student-assessment/interpretation-v8/input-builder";
import { essentialElementsList, notDiagnosticOptions, optionIdeaLabels } from "@/lib/services/content/teacher-diagnostic-context";

/**
 * Item-level research columns derived from an item's own process events and its sealed
 * response package item (item_responses.csv and assessment_content.csv). Pure functions,
 * checked without a database in prisma/research-export-v8-unit-test.ts.
 */
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const words = new Intl.Segmenter("en", { granularity: "word" });

/** Unicode characters (code points) of the trimmed text, so each Chinese character counts once; null without text. */
export function textLengthChars(value: string | null | undefined) {
  return typeof value === "string" ? Array.from(value.trim()).length : null;
}

/** Words by Unicode word segmentation, which also splits Chinese text written without spaces; null without text. */
export function textWordCount(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  let count = 0;
  for (const segment of words.segment(value)) if (segment.isWordLike) count += 1;
  return count;
}

export type ItemProcessEvent = { event_type: string; payload?: unknown; pause_duration_ms?: number | null };

export function itemProcessColumns(input: {
  events: ItemProcessEvent[];
  first_explanation: string | null;
  final_explanation: string | null;
}) {
  const pauses = input.events
    .filter((event) => event.event_type === "long_pause" || event.event_type === "inactivity_detected")
    .map((event) => event.pause_duration_ms)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return {
    blocked_paste_count: input.events.filter(isBlockedPasteEvent).length,
    // As interpretation v8's longest_pause indicator: 0 when no pause was recorded.
    longest_pause_ms: pauses.length ? Math.max(...pauses) : 0,
    first_explanation_length_chars: textLengthChars(input.first_explanation),
    final_explanation_length_chars: textLengthChars(input.final_explanation),
    final_explanation_word_count: textWordCount(input.final_explanation)
  };
}

/** Restricted: the answer explanation shown in the student's answer review (it reveals the key). */
export function answerReviewExplanation(packageItem: Record<string, unknown> | undefined) {
  return packageItem ? studentSafeAnswerExplanationFromResponse(packageItem, { as_sealed: true }) : null;
}

/**
 * The item references interpretation v8 judged explanations against, rebuilt from the sealed
 * package item with the profiling input builder's own itemReferences(): the target reasoning
 * (<item>:target), the essential elements (<item>:elements) and one rationale per incorrect
 * option (<item>:option:<label>). Options without a rationale had no reference; an option marked
 * as not tied to an idea is listed with not_tied_to_an_idea and what rules it out.
 */
export function itemReferenceColumns(packageItem: Record<string, unknown> | undefined, itemPublicId: string) {
  if (!packageItem) return { target_reasoning_note: null, essential_elements: null, option_rationales_json: null };
  const snapshot = record(packageItem.item_snapshot);
  const labels = (Array.isArray(snapshot.options) ? snapshot.options : [])
    .map((option) => ({ label: text(record(option).label), text: text(record(option).text) }))
    .filter((option): option is { label: string; text: string } => Boolean(option.label && option.text))
    .map((option) => option.label);
  const correct = text(packageItem.correct_option_snapshot) ?? text(snapshot.correct_option) ?? "";
  const { target, essential, references } = itemReferences(itemPublicId, packageItem, labels, correct);
  const ideas = optionIdeaLabels(packageItem.teacher_diagnostic_context);
  const notTied = notDiagnosticOptions(packageItem.teacher_diagnostic_context);
  const options = labels.filter((label) => label.toUpperCase() !== correct.toUpperCase()).map((label) => {
    const reference = references.find((entry) => entry.kind === "distractor_rationale" && entry.option_label === label);
    const ruledOutBy = notTied.get(label.toUpperCase());
    return {
      label,
      reference_id: reference?.reference_id ?? null,
      rationale: reference?.text ?? null,
      idea_label: ideas.get(label.toUpperCase()) ?? null,
      // Release 22: an option the instructor marked as not tied to an idea (no rationale or reference).
      not_tied_to_an_idea: ruledOutBy !== undefined,
      what_rules_it_out: ruledOutBy || null
    };
  });
  return {
    target_reasoning_note: target,
    essential_elements: essential ? essentialElementsList(essential).join("|") : null,
    option_rationales_json: options.length ? JSON.stringify(options) : null
  };
}
