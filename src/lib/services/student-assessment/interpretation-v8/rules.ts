import type { ExplanationQuality } from "./contract";

/**
 * Application rules of interpretation v8 (docs/AI_MODULE_REDESIGN_2026-10-19.md, sections
 * 4.3, 4.4 and 6.2). They are deterministic: the model never assigns an item status or a
 * topic summary, and its "possible item issue" flag never changes either. Only an
 * instructor's decision removes an item from the count.
 */
export const INTERPRETATION_RULES_VERSION = "interpretation-rules-v8.1" as const;

/** A first answer choice less than this many milliseconds after the item appears. */
export const RAPID_SELECTION_THRESHOLD_MS = 10_000;

/** A label needs at least this many interpretable items. */
export const MINIMUM_INTERPRETABLE_ITEMS = 2;

export const ITEM_STATUSES = ["supported", "partly_supported", "not_supported", "not_interpretable"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type ItemStatusInput = {
  /** null when no option was selected or correctness could not be determined. */
  answer_correct: boolean | null;
  /** No option selected (the student skipped the item). */
  skipped: boolean;
  explanation_quality: ExplanationQuality;
  rapid_selection: boolean | null;
};

/** Section 4.3, applied in this order. The error source plays no part. */
export function itemStatus(input: ItemStatusInput): ItemStatus {
  // No answer selected is its own state: never counted as incorrect, never interpretable.
  if (input.skipped || input.answer_correct === null) return "not_interpretable";
  if (input.explanation_quality === "no_usable_explanation") {
    // A correct answer alone, or a rapid choice with nothing written, says little about
    // understanding. An unhurried wrong answer with nothing written is not supported.
    if (input.answer_correct || input.rapid_selection === true) return "not_interpretable";
    return "not_supported";
  }
  if (input.explanation_quality === "incorrect") return "not_supported";
  if (input.explanation_quality === "adequate") return input.answer_correct ? "supported" : "partly_supported";
  // limited
  return input.answer_correct ? "partly_supported" : "not_supported";
}

export const TOPIC_SUMMARY_LABELS = [
  "Mostly understood",
  "Still developing",
  "Need more work",
  "Unavailable / insufficient evidence"
] as const;
export type TopicSummaryLabel = (typeof TOPIC_SUMMARY_LABELS)[number];
export const PENDING_ITEM_REVIEW_LABEL = "Pending item review" as const;

export type SummaryReason =
  | "no_valid_profile"
  | "no_counted_items"
  | "fewer_than_two_interpretable"
  | "fewer_than_half_interpretable"
  | "half_or_more_not_supported"
  | "supported_majority_none_unsupported"
  | "mixed";

export type StatusCounts = {
  counted_items: number;
  interpretable_items: number;
  supported: number;
  partly_supported: number;
  not_supported: number;
  not_interpretable: number;
};

export type RuleResult = StatusCounts & { label: TopicSummaryLabel; reason: SummaryReason };

function counts(statuses: ItemStatus[]): StatusCounts {
  const count = (status: ItemStatus) => statuses.filter((entry) => entry === status).length;
  const notInterpretable = count("not_interpretable");
  return {
    counted_items: statuses.length,
    interpretable_items: statuses.length - notInterpretable,
    supported: count("supported"),
    partly_supported: count("partly_supported"),
    not_supported: count("not_supported"),
    not_interpretable: notInterpretable
  };
}

/** The label rules of section 4.4 over the counted items, applied in order. */
export function summaryRule(statuses: ItemStatus[]): RuleResult {
  const c = counts(statuses);
  const n = c.counted_items;
  const k = c.interpretable_items;
  if (n === 0) return { ...c, label: "Unavailable / insufficient evidence", reason: "no_counted_items" };
  if (k < MINIMUM_INTERPRETABLE_ITEMS) return { ...c, label: "Unavailable / insufficient evidence", reason: "fewer_than_two_interpretable" };
  if (2 * k < n) return { ...c, label: "Unavailable / insufficient evidence", reason: "fewer_than_half_interpretable" };
  if (2 * c.not_supported >= k) return { ...c, label: "Need more work", reason: "half_or_more_not_supported" };
  if (c.not_supported === 0 && c.partly_supported <= 1 && 2 * c.supported > n) {
    return { ...c, label: "Mostly understood", reason: "supported_majority_none_unsupported" };
  }
  return { ...c, label: "Still developing", reason: "mixed" };
}

export type SummaryItem = { item_id: string; status: ItemStatus; flagged_for_review: boolean };
export type InstructorItemDecision = "kept" | "excluded";

export type TopicSummary = StatusCounts & {
  /** The label to show: a rule label, or "Pending item review" when a flag could change it. */
  label: TopicSummaryLabel | typeof PENDING_ITEM_REVIEW_LABEL;
  reason: SummaryReason | "flagged_items_change_label";
  /** The rule label with every counted item (flagged items included). */
  rule_label: TopicSummaryLabel;
  rule_reason: SummaryReason;
  /** The rule label without items still awaiting review; null when none await review. */
  label_without_pending: TopicSummaryLabel | null;
  administered_items: number;
  excluded_item_ids: string[];
  pending_review_item_ids: string[];
  /** "based on k of n items": k = interpretable counted items, n = items administered. */
  based_on: { interpretable_items: number; administered_items: number };
};

/**
 * Section 4.4. Counted items are the items administered minus the instructor's
 * exclusions. A flagged item stays counted; when leaving out the items still awaiting
 * review would change the label, the label is withheld as "Pending item review".
 */
export function topicSummary(
  items: SummaryItem[] | null,
  decisions: ReadonlyMap<string, InstructorItemDecision> = new Map()
): TopicSummary {
  const administered = items?.length ?? 0;
  const counted = (items ?? []).filter((item) => decisions.get(item.item_id) !== "excluded");
  const excludedIds = (items ?? []).filter((item) => decisions.get(item.item_id) === "excluded").map((item) => item.item_id);
  const rule = summaryRule(counted.map((item) => item.status));
  const base = {
    counted_items: rule.counted_items,
    interpretable_items: rule.interpretable_items,
    supported: rule.supported,
    partly_supported: rule.partly_supported,
    not_supported: rule.not_supported,
    not_interpretable: rule.not_interpretable,
    rule_label: rule.label,
    rule_reason: rule.reason,
    administered_items: administered,
    excluded_item_ids: excludedIds,
    based_on: { interpretable_items: rule.interpretable_items, administered_items: administered }
  };
  if (!items) {
    return {
      ...base,
      label: "Unavailable / insufficient evidence",
      reason: "no_valid_profile",
      rule_label: "Unavailable / insufficient evidence",
      rule_reason: "no_valid_profile",
      label_without_pending: null,
      pending_review_item_ids: []
    };
  }
  const pending = counted.filter((item) => item.flagged_for_review && decisions.get(item.item_id) !== "kept");
  if (!pending.length) return { ...base, label: rule.label, reason: rule.reason, label_without_pending: null, pending_review_item_ids: [] };
  const pendingIds = new Set(pending.map((item) => item.item_id));
  const without = summaryRule(counted.filter((item) => !pendingIds.has(item.item_id)).map((item) => item.status));
  const pendingReviewItemIds = [...pendingIds];
  if (without.label === rule.label) {
    return { ...base, label: rule.label, reason: rule.reason, label_without_pending: without.label, pending_review_item_ids: pendingReviewItemIds };
  }
  return {
    ...base,
    label: PENDING_ITEM_REVIEW_LABEL,
    reason: "flagged_items_change_label",
    label_without_pending: without.label,
    pending_review_item_ids: pendingReviewItemIds
  };
}

export type AnswerPattern = { misconception_tag: string; item_ids: string[] };

/**
 * An answer pattern: two or more chosen incorrect options whose rationales share a
 * misconception tag. Answer choices only; never a confirmed misconception.
 */
export function answerPatterns(choices: Array<{ item_id: string; answer_correct: boolean | null; chosen_option_tag: string | null }>): AnswerPattern[] {
  const byTag = new Map<string, string[]>();
  for (const choice of choices) {
    if (choice.answer_correct !== false || !choice.chosen_option_tag) continue;
    const tag = choice.chosen_option_tag.trim().toLowerCase();
    if (!tag) continue;
    byTag.set(tag, [...(byTag.get(tag) ?? []), choice.item_id]);
  }
  return [...byTag.entries()]
    .filter(([, items]) => new Set(items).size >= 2)
    .map(([tag, items]) => ({ misconception_tag: tag, item_ids: [...new Set(items)] }));
}
