import type { StoredInterpretationV8 } from "./profile";
import { MINIMUM_INTERPRETABLE_ITEMS, type InstructorItemDecision } from "./rules";

/**
 * Instructor-facing summary of one attempt (release 29, 30 Oct 2026). It replaces the single
 * understanding label (Mostly understood / Still developing / Need more work) in instructor
 * views: that label folded answer accuracy and how much reasoning a student wrote into one
 * judgment, so students who answered every item correctly but wrote briefly were "Still
 * developing". The summary reports the two separately and names the follow-up the evidence
 * supports. It is computed by fixed rules from the stored item ratings; nothing is asked of a
 * model, and students never see it. The earlier label is still computed for comparison.
 */
export const ATTEMPT_SUMMARY_VERSION = "attempt-summary-v1" as const;

export const FOLLOW_UP_CATEGORIES = [
  "Address errors or misconceptions",
  "Check reasoning",
  "No follow-up needed",
  "Not enough evidence",
  "Pending item review"
] as const;
export type FollowUpCategory = (typeof FOLLOW_UP_CATEGORIES)[number];

export type FollowUpReason =
  | "no_valid_profile"
  | "no_counted_items"
  | "fewer_than_two_interpretable"
  | "fewer_than_half_interpretable"
  | "error_or_misconception"
  | "reasoning_shown_on_half_or_fewer"
  | "reasoning_shown_on_most"
  | "flagged_items_change_follow_up";

export const FOLLOW_UP_RULE_TEXT =
  "Not enough evidence: fewer than two counted items can be interpreted, or fewer than half. " +
  "Address errors or misconceptions: any counted item is not supported (a wrong answer, or reasoning that contradicts the item), or a possible misconception is listed. " +
  "Check reasoning: otherwise, when the reasoning was shown (item supported) on half of the counted items or fewer. " +
  "No follow-up needed: otherwise. Pending item review: an item the model flagged as possibly flawed awaits the instructor's decision and leaving it out would change the follow-up.";

export type AttemptSummary = {
  attempt_summary_version: typeof ATTEMPT_SUMMARY_VERSION;
  follow_up: FollowUpCategory;
  follow_up_reason: FollowUpReason;
  /** Follow-up without the items still awaiting review; null when none await review. */
  follow_up_without_pending: FollowUpCategory | null;
  administered_items: number;
  counted_items: number;
  answered_items: number;
  correct_items: number;
  /** Counted items by explanation rating. */
  reasoning_shown: number;
  reasoning_brief: number;
  reasoning_incorrect: number;
  no_explanation: number;
  /** Items (by the position the student saw) named in a possible misconception. */
  misconception_item_positions: number[];
  possible_misconception_count: number;
  /** One line for instructors, e.g. "3 of 4 correct · reasoning shown on 2, brief on 1, none on 1 · possible misconception on Item 3". */
  text: string;
};

type Counted = StoredInterpretationV8["items"][number];

function rule(items: Counted[], misconceptionItemIds: ReadonlySet<string>): { follow_up: Exclude<FollowUpCategory, "Pending item review">; reason: FollowUpReason } {
  const n = items.length;
  const interpretable = items.filter((item) => item.status !== "not_interpretable").length;
  if (n === 0) return { follow_up: "Not enough evidence", reason: "no_counted_items" };
  if (interpretable < MINIMUM_INTERPRETABLE_ITEMS) return { follow_up: "Not enough evidence", reason: "fewer_than_two_interpretable" };
  if (2 * interpretable < n) return { follow_up: "Not enough evidence", reason: "fewer_than_half_interpretable" };
  const error = items.some((item) => item.status === "not_supported" || misconceptionItemIds.has(item.item_id));
  if (error) return { follow_up: "Address errors or misconceptions", reason: "error_or_misconception" };
  const supported = items.filter((item) => item.status === "supported").length;
  if (2 * supported <= n) return { follow_up: "Check reasoning", reason: "reasoning_shown_on_half_or_fewer" };
  return { follow_up: "No follow-up needed", reason: "reasoning_shown_on_most" };
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function summaryText(summary: Omit<AttemptSummary, "text">) {
  if (summary.follow_up_reason === "no_valid_profile") return "No interpretation saved";
  const parts = [`${summary.correct_items} of ${summary.counted_items} correct`];
  const reasoning = [
    summary.reasoning_shown ? `shown on ${summary.reasoning_shown}` : null,
    summary.reasoning_brief ? `brief on ${summary.reasoning_brief}` : null,
    summary.reasoning_incorrect ? `incorrect on ${summary.reasoning_incorrect}` : null,
    summary.no_explanation ? `none on ${summary.no_explanation}` : null
  ].filter(Boolean);
  if (reasoning.length) parts.push(`reasoning ${reasoning.join(", ")}`);
  if (summary.misconception_item_positions.length) {
    const items = summary.misconception_item_positions.map((position) => `Item ${position}`).join(", ");
    parts.push(`possible misconception on ${items}`);
  }
  if (summary.counted_items < summary.administered_items) {
    parts.push(`${plural(summary.administered_items - summary.counted_items, "item")} not counted`);
  }
  return parts.join(" · ");
}

/**
 * The summary over the counted items: administered items minus the instructor's exclusions and
 * minus items left without a rating. A fallback profile has no ratings: Not enough evidence.
 */
export function attemptSummary(
  stored: StoredInterpretationV8 | null,
  decisions: ReadonlyMap<string, InstructorItemDecision> = new Map()
): AttemptSummary {
  const administered = stored?.items.length ?? 0;
  const empty = {
    attempt_summary_version: ATTEMPT_SUMMARY_VERSION,
    follow_up_without_pending: null,
    administered_items: administered,
    counted_items: 0,
    answered_items: 0,
    correct_items: 0,
    reasoning_shown: 0,
    reasoning_brief: 0,
    reasoning_incorrect: 0,
    no_explanation: 0,
    misconception_item_positions: [],
    possible_misconception_count: 0
  };
  if (!stored || stored.generation_mode === "fallback") {
    const summary = { ...empty, follow_up: "Not enough evidence" as const, follow_up_reason: "no_valid_profile" as const };
    return { ...summary, text: stored ? "Interpretation unavailable for this attempt" : summaryText(summary) };
  }
  const counted = stored.items.filter((item) => item.status && !item.rating_unavailable && decisions.get(item.item_id) !== "excluded");
  const countedIds = new Set(counted.map((item) => item.item_id));
  const misconceptions = stored.possible_misconceptions.filter((claim) => claim.item_ids.some((id) => countedIds.has(id)));
  const misconceptionItemIds = new Set(misconceptions.flatMap((claim) => claim.item_ids).filter((id) => countedIds.has(id)));
  const result = rule(counted, misconceptionItemIds);
  const quality = (value: string) => counted.filter((item) => item.explanation_quality === value).length;
  let followUp: FollowUpCategory = result.follow_up;
  let reason: FollowUpReason = result.reason;
  let withoutPending: FollowUpCategory | null = null;
  const pending = counted.filter((item) => item.item_review_flag && decisions.get(item.item_id) !== "kept");
  if (pending.length) {
    const pendingIds = new Set(pending.map((item) => item.item_id));
    const without = rule(counted.filter((item) => !pendingIds.has(item.item_id)),
      new Set([...misconceptionItemIds].filter((id) => !pendingIds.has(id))));
    withoutPending = without.follow_up;
    if (without.follow_up !== result.follow_up) {
      followUp = "Pending item review";
      reason = "flagged_items_change_follow_up";
    }
  }
  const summary = {
    ...empty,
    follow_up: followUp,
    follow_up_reason: reason,
    follow_up_without_pending: withoutPending,
    counted_items: counted.length,
    answered_items: counted.filter((item) => item.answer_correct !== null).length,
    correct_items: counted.filter((item) => item.answer_correct === true).length,
    reasoning_shown: quality("adequate"),
    reasoning_brief: quality("limited"),
    reasoning_incorrect: quality("incorrect"),
    no_explanation: quality("no_usable_explanation"),
    misconception_item_positions: counted.filter((item) => misconceptionItemIds.has(item.item_id)).map((item) => item.position).sort((a, b) => a - b),
    possible_misconception_count: misconceptions.length
  };
  return { ...summary, text: summaryText(summary) };
}

export const ATTEMPT_SUMMARY_DEFINITIONS = {
  attempt_summary_version: "Version of the instructor-facing attempt summary rules (attempt-summary-v1 from release 29, 30 Oct 2026). Computed from the stored item ratings by fixed rules; never shown to students.",
  follow_up: `What the evidence suggests an instructor do with the attempt. ${FOLLOW_UP_RULE_TEXT} Replaces understanding_label in instructor views; understanding_label is kept for comparison.`,
  follow_up_reason: "Which rule decided follow_up: no_valid_profile, no_counted_items, fewer_than_two_interpretable, fewer_than_half_interpretable, error_or_misconception, reasoning_shown_on_half_or_fewer, reasoning_shown_on_most or flagged_items_change_follow_up.",
  follow_up_without_pending: "follow_up computed without the items the model flagged as possibly flawed that still await the instructor's decision; blank when none await review.",
  counted_items: "Items counted: administered items minus items the instructor excluded and items left without a rating.",
  correct_items: "Counted items answered with the keyed option.",
  reasoning_shown: "Counted items whose explanation was rated adequate (the key reason stated or clearly implied).",
  reasoning_brief: "Counted items whose explanation was rated limited (relevant, but the key reason missing or only gestured at).",
  reasoning_incorrect: "Counted items whose explanation was rated incorrect.",
  no_explanation: "Counted items with no usable explanation (none written, off task, or a stated guess).",
  possible_misconception_count: "Possible misconceptions listed on counted items.",
  attempt_summary_text: "The summary line instructors see, for example \"3 of 4 correct · reasoning shown on 2, brief on 1, none on 1 · possible misconception on Item 3\"."
} as const;
export const ATTEMPT_SUMMARY_COLUMNS = Object.keys(ATTEMPT_SUMMARY_DEFINITIONS) as Array<keyof typeof ATTEMPT_SUMMARY_DEFINITIONS>;

/** Export columns for one stored profile; blank for a profile that is not interpretation v8. */
export function attemptSummaryColumns(stored: StoredInterpretationV8 | null, decisions: ReadonlyMap<string, InstructorItemDecision>) {
  if (!stored) return Object.fromEntries(ATTEMPT_SUMMARY_COLUMNS.map((column) => [column, null])) as Record<(typeof ATTEMPT_SUMMARY_COLUMNS)[number], string | number | null>;
  const summary = attemptSummary(stored, decisions);
  return {
    attempt_summary_version: summary.attempt_summary_version,
    follow_up: summary.follow_up,
    follow_up_reason: summary.follow_up_reason,
    follow_up_without_pending: summary.follow_up_without_pending,
    counted_items: summary.counted_items,
    correct_items: summary.correct_items,
    reasoning_shown: summary.reasoning_shown,
    reasoning_brief: summary.reasoning_brief,
    reasoning_incorrect: summary.reasoning_incorrect,
    no_explanation: summary.no_explanation,
    possible_misconception_count: summary.possible_misconception_count,
    attempt_summary_text: summary.text
  } satisfies Record<(typeof ATTEMPT_SUMMARY_COLUMNS)[number], string | number | null>;
}
