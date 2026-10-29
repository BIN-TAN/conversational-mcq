import { prisma } from "@/lib/db";
import {
  decisionAdjustedTopicSummary,
  type StoredInterpretationV8
} from "@/lib/services/student-assessment/interpretation-v8/profile";
import type { InstructorItemDecision, TopicSummary } from "@/lib/services/student-assessment/interpretation-v8/rules";
import { FeedbackV8OutputSchema, FEEDBACK_V8_CONTRACT_VERSION } from "@/lib/services/student-assessment/feedback-v8/contract";

/**
 * Class view of interpretation v8 for the dashboard (docs/AI_MODULE_REDESIGN_2026-10-19.md,
 * sections 4.4, 4.6 and 10). First attempts (initial diagnosis) and later attempts (change
 * after feedback) are summarised separately, never merged. Labels use the instructor's
 * current item decisions. No process interpretations appear here.
 */
export const INTERPRETATION_V8_DASHBOARD_VERSION = "interpretation-v8-dashboard-v1" as const;

export const V8_SUMMARY_LABELS = [
  "Mostly understood",
  "Still developing",
  "Need more work",
  "Pending item review",
  "Unavailable / insufficient evidence"
] as const;

export type V8StudentEntry = {
  student_key: string;
  attempt_number: number;
  submitted_at: Date;
  stored: StoredInterpretationV8;
};

export type V8AttemptGroupSummary = {
  students: number;
  interpreted_students: number;
  fallback_students: number;
  summary_distribution: Array<{ label: (typeof V8_SUMMARY_LABELS)[number]; count: number }>;
  based_on_median: { interpretable_items: number | null; administered_items: number | null };
  possible_misconceptions: Array<{
    reference_id: string;
    item_numbers: number[];
    example_idea: string;
    students: number;
    endorsed: number;
    tentative: number;
  }>;
  considered_ideas: Array<{ reference_id: string; item_number: number | null; example_idea: string; students: number }>;
  answer_patterns: Array<{ shared_idea: string; students: number }>;
  /**
   * Ideas students stated in their own words on options the instructor marked as not tied to a
   * specific idea (release 22): one entry per item and option, with how many students chose it and
   * stated an idea there, and up to three example ideas. Several students stating the same idea
   * suggests linking the option to that idea.
   */
  ideas_on_untied_options: Array<{ item_number: number; option_label: string; students: number; example_ideas: string[] }>;
  item_status: Array<{
    item_id: string;
    item_number: number;
    supported: number;
    partly_supported: number;
    not_supported: number;
    not_interpretable: number;
    beyond_option_text_no: number;
    flagged_for_review: number;
  }>;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

export function summarizeV8Group(
  entries: V8StudentEntry[],
  decisions: ReadonlyMap<string, InstructorItemDecision>,
  /** Options marked as not tied to an idea, by item public ID (upper-case labels). */
  untiedOptions: ReadonlyMap<string, ReadonlySet<string>> = new Map()
): V8AttemptGroupSummary {
  const summaries: TopicSummary[] = entries.map((entry) => decisionAdjustedTopicSummary(entry.stored, decisions));
  const interpreted = entries.filter((entry) => entry.stored.generation_mode !== "fallback");
  const itemNumber = (entry: V8StudentEntry, itemId: string) =>
    [...entry.stored.items].sort((a, b) => a.position - b.position).findIndex((item) => item.item_id === itemId) + 1;

  const misconceptions = new Map<string, V8AttemptGroupSummary["possible_misconceptions"][number] & { keys: Set<string> }>();
  const considered = new Map<string, V8AttemptGroupSummary["considered_ideas"][number] & { keys: Set<string> }>();
  const patterns = new Map<string, Set<string>>();
  const untiedIdeas = new Map<string, { item_number: number; option_label: string; keys: Set<string>; example_ideas: string[] }>();
  const items = new Map<string, V8AttemptGroupSummary["item_status"][number]>();
  for (const entry of interpreted) {
    for (const claim of entry.stored.possible_misconceptions) {
      const current = misconceptions.get(claim.contradicts_reference_id) ?? {
        reference_id: claim.contradicts_reference_id,
        item_numbers: [],
        example_idea: claim.idea,
        students: 0,
        endorsed: 0,
        tentative: 0,
        keys: new Set<string>()
      };
      if (!current.keys.has(entry.student_key)) {
        current.keys.add(entry.student_key);
        current.students += 1;
        if (claim.endorsement === "tentative") current.tentative += 1; else current.endorsed += 1;
      }
      for (const id of claim.item_ids) {
        const number = itemNumber(entry, id);
        if (number > 0 && !current.item_numbers.includes(number)) current.item_numbers.push(number);
      }
      misconceptions.set(claim.contradicts_reference_id, current);
      for (const id of claim.item_ids) {
        const chosen = entry.stored.items.find((item) => item.item_id === id)?.selected_option?.toUpperCase();
        if (!chosen || !untiedOptions.get(id)?.has(chosen)) continue;
        const key = `${id}:${chosen}`;
        const ideas = untiedIdeas.get(key) ?? { item_number: itemNumber(entry, id), option_label: chosen, keys: new Set<string>(), example_ideas: [] };
        ideas.keys.add(entry.student_key);
        if (ideas.example_ideas.length < 3 && !ideas.example_ideas.includes(claim.idea)) ideas.example_ideas.push(claim.idea);
        untiedIdeas.set(key, ideas);
      }
    }
    for (const idea of entry.stored.considered_ideas) {
      const current = considered.get(idea.contradicts_reference_id) ?? {
        reference_id: idea.contradicts_reference_id,
        item_number: itemNumber(entry, idea.item_id) || null,
        example_idea: idea.idea,
        students: 0,
        keys: new Set<string>()
      };
      if (!current.keys.has(entry.student_key)) { current.keys.add(entry.student_key); current.students += 1; }
      considered.set(idea.contradicts_reference_id, current);
    }
    for (const pattern of entry.stored.answer_patterns) {
      patterns.set(pattern.misconception_tag, (patterns.get(pattern.misconception_tag) ?? new Set()).add(entry.student_key));
    }
    for (const item of entry.stored.items) {
      if (decisions.get(item.item_id) === "excluded") continue;
      const current = items.get(item.item_id) ?? {
        item_id: item.item_id,
        item_number: itemNumber(entry, item.item_id),
        supported: 0,
        partly_supported: 0,
        not_supported: 0,
        not_interpretable: 0,
        beyond_option_text_no: 0,
        flagged_for_review: 0
      };
      if (item.status) current[item.status] += 1;
      if (item.adds_beyond_option_text === false) current.beyond_option_text_no += 1;
      if (item.item_review_flag) current.flagged_for_review += 1;
      items.set(item.item_id, current);
    }
  }
  const strip = <T extends { keys: Set<string> }>(value: T) => {
    const { keys: _keys, ...rest } = value;
    return rest;
  };
  return {
    students: entries.length,
    interpreted_students: interpreted.length,
    fallback_students: entries.length - interpreted.length,
    summary_distribution: V8_SUMMARY_LABELS.map((label) => ({
      label,
      count: summaries.filter((summary) => summary.label === label).length
    })),
    based_on_median: {
      interpretable_items: median(summaries.map((summary) => summary.based_on.interpretable_items)),
      administered_items: median(summaries.map((summary) => summary.based_on.administered_items))
    },
    possible_misconceptions: [...misconceptions.values()].map(strip).sort((a, b) => b.students - a.students),
    considered_ideas: [...considered.values()].map(strip).sort((a, b) => b.students - a.students),
    answer_patterns: [...patterns.entries()].map(([shared_idea, keys]) => ({ shared_idea, students: keys.size }))
      .sort((a, b) => b.students - a.students),
    ideas_on_untied_options: [...untiedIdeas.values()]
      .map(({ keys, ...rest }) => ({ ...rest, students: keys.size }))
      .sort((a, b) => b.students - a.students || a.item_number - b.item_number),
    item_status: [...items.values()].sort((a, b) => a.item_number - b.item_number)
  };
}

/**
 * One entry per student for each group: the earliest attempt whose profile is the initial
 * diagnosis, and the latest attempt submitted after feedback.
 */
export function splitFirstAndLaterAttempts(entries: V8StudentEntry[]) {
  const byStudent = new Map<string, V8StudentEntry[]>();
  for (const entry of entries) byStudent.set(entry.student_key, [...(byStudent.get(entry.student_key) ?? []), entry]);
  const first: V8StudentEntry[] = [];
  const later: V8StudentEntry[] = [];
  for (const list of byStudent.values()) {
    const ordered = [...list].sort((a, b) => a.attempt_number - b.attempt_number || a.submitted_at.getTime() - b.submitted_at.getTime());
    const initial = ordered.find((entry) => entry.stored.attempt?.role !== "after_feedback") ?? null;
    const after = [...ordered].reverse().find((entry) => entry.stored.attempt?.role === "after_feedback") ?? null;
    if (initial) first.push(initial);
    if (after) later.push(after);
  }
  return { first, later };
}

export type FeedbackV8ConversationStats = {
  conversations_held: number;
  student_turns: number;
  foci_with_corrected_reasoning: number;
  foci_with_difficulty_still_evident: number;
  instructor_review_flags: Array<{ flag: string; count: number }>;
};

/** Turn records of feedback v8 conversations for the given attempts. */
export async function loadFeedbackV8ConversationStats(assessmentSessionDbIds: string[]): Promise<FeedbackV8ConversationStats> {
  if (!assessmentSessionDbIds.length) {
    return { conversations_held: 0, student_turns: 0, foci_with_corrected_reasoning: 0, foci_with_difficulty_still_evident: 0, instructor_review_flags: [] };
  }
  const [calls, signals] = await Promise.all([
    prisma.agentCall.findMany({
      where: {
        assessment_session_db_id: { in: assessmentSessionDbIds },
        schema_version: FEEDBACK_V8_CONTRACT_VERSION,
        call_status: "succeeded",
        output_validated: true
      },
      select: { formative_conversation_session_db_id: true, output_payload: true }
    }),
    prisma.formativeConversationReviewSignal.findMany({
      where: {
        signal_type: "feedback_v8_instructor_review",
        formative_conversation_session: { assessment_session_db_id: { in: assessmentSessionDbIds } }
      },
      select: { reason_code: true }
    })
  ]);
  const records = calls.flatMap((call) => {
    const parsed = FeedbackV8OutputSchema.safeParse(call.output_payload);
    return parsed.success ? [{ conversation: call.formative_conversation_session_db_id, output: parsed.data }] : [];
  });
  const replies = records.filter((record) => record.output.focus_status !== null);
  const flagCounts = new Map<string, number>();
  for (const signal of signals) flagCounts.set(signal.reason_code, (flagCounts.get(signal.reason_code) ?? 0) + 1);
  return {
    conversations_held: new Set(replies.map((record) => record.conversation).filter(Boolean)).size,
    student_turns: replies.length,
    foci_with_corrected_reasoning: replies.filter((record) => record.output.focus_status === "corrected_reasoning_expressed").length,
    foci_with_difficulty_still_evident: replies.filter((record) => record.output.focus_status === "difficulty_still_evident").length,
    instructor_review_flags: [...flagCounts.entries()].map(([flag, count]) => ({ flag, count }))
  };
}
