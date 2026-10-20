import { FeedbackV8OutputSchema, type FeedbackV8Output } from "@/lib/services/student-assessment/feedback-v8/contract";
import { itemReferences } from "@/lib/services/student-assessment/interpretation-v8/input-builder";
import { readStoredInterpretationV8, type StoredInterpretationV8 } from "@/lib/services/student-assessment/interpretation-v8/profile";
import { topicSummary, type InstructorItemDecision } from "@/lib/services/student-assessment/interpretation-v8/rules";
import {
  ATTEMPT_SECTIONS,
  INSTRUCTOR_REPORT_LIMITS,
  INSTRUCTOR_REPORT_V8_COUNTS_VERSION,
  INSTRUCTOR_REPORT_V8_INPUT_VERSION,
  SUMMARY_DISTRIBUTION_LABELS,
  type AttemptSection,
  type GroupCount,
  type InstructorReportCounts,
  type InstructorReportV8EvidenceIndex,
  type InstructorReportV8Input,
  type ReportItemInput,
  type ReportRecordKind,
  type ReportStudentEvidence,
  type ReportTurnRecord,
  type SectionCounts
} from "./contract";

/**
 * Pure assembly of the instructor report (redesign section 9.7): every count, the model's
 * input and the label index, from records already loaded from the database. No database,
 * provider or clock access, so it is unit-tested directly.
 *
 * Attempts (section 4.6): a student's first attempt is the initial diagnosis; later attempts
 * show change after feedback. The two are counted and presented separately, never merged.
 * The later-attempt section uses each student's most recent later attempt, so every section
 * has one record per student; all later attempts appear in the attempt totals.
 *
 * Profiles saved by interpretation v8 carry item ratings. Fallback v8 profiles have none and
 * are left out of every rating count. Earlier-version records keep their responses and
 * conversations but take no part in the counts that need v8 ratings.
 *
 * The model input carries no process data (no timing, answer or confidence changes, first
 * versions of explanations, focus, pauses or paste attempts, and no process interpretations),
 * and no names, account, session or item identifiers.
 */

export type LoadedReportItem = {
  item_public_id: string;
  stem: string;
  options: Array<{ label: string; text: string }>;
  correct_option: string;
  /** From the item record; used only when no submitted package carries the item's specification. */
  expected_reasoning: string | null;
  distractor_rationales: Array<{ option: string; rationale: string }>;
};

export type LoadedConversation = {
  status: string | null;
  lifecycle_reason: string | null;
  turns: Array<{ turn_id: string; actor: "student" | "tutor"; text: string; agent_call_id: string | null }>;
  /** output_payload of succeeded feedback v8 calls (formative-feedback-v8) for this conversation. */
  feedback_v8_outputs: Array<{ agent_call_id: string; output: unknown }>;
  /** FormativeConversationReviewSignal rows with signal_type feedback_v8_instructor_review. */
  review_signals: Array<{ source_turn_id: string | null; flag: string }>;
};

export type LoadedReportAttempt = {
  /** Internal grouping key (the student's account row); never sent to the model. */
  student_key: string;
  session_public_id: string;
  attempt_number: number;
  created_at: string;
  /** The student finished the attempt. */
  finished: boolean;
  /** The instructor restored this attempt's chance after a technical problem; not used as a result. */
  restored: boolean;
  /** Sealed initial response packages; empty when the attempt was never submitted. */
  package_payloads: unknown[];
  profile_item_level_evidence: unknown;
  conversation: LoadedConversation | null;
};

export type LoadedReportRecords = {
  mini_test_title: string;
  topic: { title: string; learning_objective: string | null; description: string | null } | null;
  items: LoadedReportItem[];
  eligible_student_count: number;
  attempts: LoadedReportAttempt[];
  /** Instructor item decisions (section 4.4); none are recorded yet, so this is usually empty. */
  item_decisions?: ReadonlyMap<string, InstructorItemDecision>;
};

export type AssembledInstructorReport = {
  input: InstructorReportV8Input;
  counts: InstructorReportCounts;
  index: InstructorReportV8EvidenceIndex;
  application_notes: string[];
  /** Identifiers that must never reach the model (sessions, items, accounts, packages). */
  identifiers: string[];
};

const IDK_OPTION_LABEL = "E";
const REVIEW_FLAGS = ["possible_item_issue", "persistent_difficulty", "student_requested_instructor"] as const;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const clip = (value: string | null, max: number = INSTRUCTOR_REPORT_LIMITS.max_text_chars) =>
  value && value.length > max ? `${value.slice(0, max)}…` : value;

type ParsedResponse = {
  item_id: string;
  position: number;
  selected_option: string | null;
  answer_correct: boolean | null;
  reported_confidence: "low" | "medium" | "high" | null;
  explanation: string | null;
  tempting_option: string | null;
  tempting_option_reason: string | null;
};

type ParsedSpec = { target_reasoning: string | null; essential_elements: string | null; distractor_rationales: Array<{ option: string; rationale: string }> };

/**
 * The student's recorded responses from a sealed package, with the same field fallbacks as
 * the v8 profiling input (final answer and final explanation). Process fields are not read.
 */
export function responsesFromPackage(payload: unknown) {
  const rows = (Array.isArray(record(payload).item_responses) ? (record(payload).item_responses as unknown[]) : []).map(record);
  const specs = new Map<string, ParsedSpec>();
  const responses = rows.flatMap((response, index): ParsedResponse[] => {
    const snapshot = record(response.item_snapshot);
    const itemId = str(response.item_public_id) ?? str(snapshot.item_public_id);
    if (!itemId) return [];
    const optionLabels = (Array.isArray(snapshot.options) ? snapshot.options : []).map((entry) => str(record(entry).label)).filter((label): label is string => Boolean(label));
    const correct = str(response.correct_option_snapshot) ?? str(snapshot.correct_option) ?? "";
    const { target, essential, references } = itemReferences(itemId, response, optionLabels, correct);
    specs.set(itemId, {
      target_reasoning: target,
      essential_elements: essential,
      distractor_rationales: references
        .filter((reference) => reference.kind === "distractor_rationale" && reference.option_label)
        .map((reference) => ({ option: reference.option_label!, rationale: reference.text }))
    });
    const confidence = response.confidence_final ?? response.confidence_rating;
    return [{
      item_id: itemId,
      position: typeof response.initial_item_position === "number" ? response.initial_item_position
        : typeof response.item_order === "number" ? response.item_order : index + 1,
      selected_option: str(response.selected_answer_final) ?? str(response.selected_option),
      answer_correct: response.correctness === "correct" ? true : response.correctness === "incorrect" ? false : null,
      reported_confidence: confidence === "low" || confidence === "medium" || confidence === "high" ? confidence : null,
      explanation: str(response.reasoning_text_final) ?? str(response.reasoning_text),
      tempting_option: str(response.tempting_option),
      tempting_option_reason: str(response.tempting_option_reason)
    }];
  });
  return { responses, specs, order: [...responses].sort((a, b) => a.position - b.position).map((entry) => entry.item_id) };
}

/** Reference IDs carry item IDs; the model and the instructor see labels instead. */
export function referenceLabel(referenceId: string | null, itemLabelById: ReadonlyMap<string, string>) {
  if (!referenceId) return null;
  if (referenceId === "topic:objective") return "the learning objective";
  if (referenceId === "topic:description") return "the topic description";
  const match = /^(.+?):(target|elements|option:(.+))$/.exec(referenceId);
  if (!match) return "an unlabelled reference";
  const item = itemLabelById.get(match[1]) ?? "an item no longer in the mini-test";
  if (match[2] === "target") return `${item} target reasoning`;
  if (match[2] === "elements") return `${item} essential elements`;
  return `${item} option ${match[3]} rationale`;
}

type PreparedConversation = {
  student_messages: number;
  ended_by_student: boolean;
  turns: Array<{ speaker: "student" | "tutor"; text: string; record: ReportTurnRecord | null; flag: string | null }>;
};

type PreparedRecord = {
  attempt: LoadedReportAttempt;
  responses: Map<string, ParsedResponse>;
  v8: StoredInterpretationV8 | null;
  kind: ReportRecordKind;
  role: "initial_diagnosis" | "after_feedback";
  conversation: PreparedConversation | null;
};

function prepareConversation(
  conversation: LoadedConversation,
  packageOrder: string[],
  itemLabelById: ReadonlyMap<string, string>
): PreparedConversation {
  const outputs = new Map<string, FeedbackV8Output>();
  for (const entry of conversation.feedback_v8_outputs) {
    const parsed = FeedbackV8OutputSchema.safeParse(entry.output);
    if (parsed.success) outputs.set(entry.agent_call_id, parsed.data);
  }
  const signals = new Map(conversation.review_signals.flatMap((signal) => (signal.source_turn_id ? [[signal.source_turn_id, signal.flag] as const] : [])));
  const turns = conversation.turns.filter((turn) => turn.text.trim()).map((turn) => {
    const output = turn.actor === "tutor" && turn.agent_call_id ? outputs.get(turn.agent_call_id) ?? null : null;
    const turnRecord: ReportTurnRecord | null = output
      ? {
          // Feedback v8 numbers questions in the package's order; the report uses item labels.
          focus_items: output.focus.item_numbers.flatMap((number) => {
            const label = itemLabelById.get(packageOrder[number - 1] ?? "");
            return label ? [label] : [];
          }),
          focus_type: output.focus.focus_type,
          concept: output.focus.concept,
          strategy: output.strategy,
          student_evidence: output.student_evidence.map((entry) => ({ quote: entry.quote, note: entry.note })),
          focus_status: output.focus_status,
          instructor_review: { flag: output.instructor_review.flag, reason: output.instructor_review.reason }
        }
      : null;
    const recordFlag = turnRecord && turnRecord.instructor_review.flag !== "none" ? turnRecord.instructor_review.flag : null;
    return {
      speaker: turn.actor,
      text: turn.text.trim(),
      record: turnRecord,
      flag: turn.actor === "tutor" ? recordFlag ?? signals.get(turn.turn_id) ?? null : null
    };
  });
  return {
    student_messages: turns.filter((turn) => turn.speaker === "student").length,
    ended_by_student: conversation.lifecycle_reason === "student_ended_conversation",
    turns
  };
}

function summaryLabel(v8: StoredInterpretationV8, decisions: ReadonlyMap<string, InstructorItemDecision>) {
  return topicSummary(
    v8.items.flatMap((item) => (item.status ? [{ item_id: item.item_id, status: item.status, flagged_for_review: item.item_review_flag }] : [])),
    decisions
  );
}

type SectionEntry = { label: string; record: PreparedRecord };

type ItemContext = LoadedReportItem & { label: string; own_option_e: boolean };

function groupCounts<T>(
  entries: SectionEntry[],
  extract: (entry: SectionEntry) => T[],
  key: (value: T) => string,
  items: (value: T) => string[],
  idea: (value: T) => string | null
) {
  const groups = new Map<string, { items: Set<string>; students: Set<string>; ideas: string[]; values: Array<{ label: string; value: T }> }>();
  for (const entry of entries) {
    for (const value of extract(entry)) {
      const group = groups.get(key(value)) ?? { items: new Set<string>(), students: new Set<string>(), ideas: [], values: [] };
      items(value).forEach((label) => group.items.add(label));
      group.students.add(entry.label);
      const text = idea(value);
      if (text && group.ideas.length < 3 && !group.ideas.includes(text)) group.ideas.push(text);
      group.values.push({ label: entry.label, value });
      groups.set(key(value), group);
    }
  }
  return groups;
}

const byItemOrder = (labels: Iterable<string>) =>
  [...labels].sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));

function sectionCounts(
  section: AttemptSection,
  entries: SectionEntry[],
  sectionAttempts: PreparedRecord[],
  items: ItemContext[],
  itemLabelById: ReadonlyMap<string, string>,
  decisions: ReadonlyMap<string, InstructorItemDecision>
): SectionCounts {
  const current = entries.filter((entry) => entry.record.kind === "current_version");
  const withV8 = entries.filter((entry) => entry.record.v8);
  const labels = (ids: string[]) => byItemOrder(new Set(ids.flatMap((id) => itemLabelById.get(id) ?? [])));

  const option_distribution = items.map((item) => {
    const counts = new Map(item.options.map((option) => [option.label, 0]));
    let responses = 0;
    let iDontKnow = 0;
    let noAnswer = 0;
    for (const entry of entries) {
      const response = entry.record.responses.get(item.item_public_id);
      if (!response) continue;
      responses += 1;
      const selected = response.selected_option;
      if (!selected) noAnswer += 1;
      else if (selected.toUpperCase() === IDK_OPTION_LABEL && !item.own_option_e) iDontKnow += 1;
      else counts.set(selected, (counts.get(selected) ?? 0) + 1);
    }
    return {
      item_label: item.label,
      responses,
      options: [...counts.entries()].map(([option, count]) => ({
        option,
        count,
        correct: option.toUpperCase() === item.correct_option.toUpperCase()
      })),
      i_dont_know: iDontKnow,
      no_answer: noAnswer
    };
  });

  const item_status = items.map((item) => {
    const row = { item_label: item.label, rated: 0, supported: 0, partly_supported: 0, not_supported: 0, not_interpretable: 0, possible_item_issue_flags: 0 };
    for (const entry of current) {
      const rated = entry.record.v8!.items.find((candidate) => candidate.item_id === item.item_public_id);
      if (!rated?.status) continue;
      row.rated += 1;
      row[rated.status] += 1;
      if (rated.item_review_flag) row.possible_item_issue_flags += 1;
    }
    return row;
  });

  const labelCounts = new Map<string, number>(SUMMARY_DISTRIBUTION_LABELS.map((label) => [label, 0]));
  let fallbackProfiles = 0;
  let earlierVersion = 0;
  for (const entry of entries) {
    if (entry.record.kind === "current_version") {
      const label = summaryLabel(entry.record.v8!, decisions).label;
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    } else if (entry.record.kind === "current_version_fallback") {
      fallbackProfiles += 1;
      labelCounts.set("Unavailable / insufficient evidence", (labelCounts.get("Unavailable / insufficient evidence") ?? 0) + 1);
    } else {
      earlierVersion += 1;
    }
  }

  const misconceptionGroups = groupCounts(
    current,
    (entry) => entry.record.v8!.possible_misconceptions,
    (value) => value.matching_distractor_reference_id ?? value.contradicts_reference_id,
    (value) => labels(value.item_ids),
    (value) => value.idea
  );
  const possible_misconceptions = [...misconceptionGroups.entries()].map(([key, group]) => {
    const endorsed = new Set(group.values.filter((entry) => entry.value.endorsement === "endorsed").map((entry) => entry.label));
    return {
      grouped_by: referenceLabel(key, itemLabelById)!,
      item_labels: byItemOrder(group.items),
      students: group.students.size,
      endorsed_students: endorsed.size,
      tentative_students: group.students.size - endorsed.size,
      example_ideas: group.ideas
    };
  }).sort((a, b) => b.students - a.students || a.grouped_by.localeCompare(b.grouped_by));

  const ideaGroups = groupCounts(
    current,
    (entry) => entry.record.v8!.considered_ideas,
    (value) => value.contradicts_reference_id,
    (value) => labels([value.item_id]),
    (value) => value.idea
  );
  const considered_ideas: GroupCount[] = [...ideaGroups.entries()].map(([key, group]) => ({
    grouped_by: referenceLabel(key, itemLabelById)!,
    item_labels: byItemOrder(group.items),
    students: group.students.size,
    example_ideas: group.ideas
  })).sort((a, b) => b.students - a.students || a.grouped_by.localeCompare(b.grouped_by));

  // Answer patterns come from the student's choices (an application rule), so fallback
  // profiles keep theirs; they are never confirmed misconceptions.
  const patternGroups = groupCounts(
    withV8,
    (entry) => entry.record.v8!.answer_patterns ?? [],
    (value) => value.misconception_tag.trim().toLowerCase(),
    (value) => labels(value.item_ids),
    () => null
  );
  const answer_patterns = [...patternGroups.entries()].map(([tag, group]) => ({
    shared_tag: tag,
    item_labels: byItemOrder(group.items),
    students: group.students.size
  })).sort((a, b) => b.students - a.students || a.shared_tag.localeCompare(b.shared_tag));

  const conversations = entries.map((entry) => entry.record.conversation).filter((entry): entry is PreparedConversation => Boolean(entry));
  const records = conversations.map((conversation) => conversation.turns.flatMap((turn) => (turn.record ? [turn.record] : [])));
  const attemptsByNumber = new Map<number, number>();
  for (const attempt of sectionAttempts) attemptsByNumber.set(attempt.attempt.attempt_number, (attemptsByNumber.get(attempt.attempt.attempt_number) ?? 0) + 1);

  return {
    attempts: section,
    students: entries.length,
    attempts_submitted: sectionAttempts.length,
    attempts_by_number: [...attemptsByNumber.entries()].sort((a, b) => a[0] - b[0]).map(([attempt_number, attempts]) => ({ attempt_number, attempts })),
    attempts_finished: entries.filter((entry) => entry.record.attempt.finished).length,
    records: {
      current_version: current.length,
      current_version_fallback: entries.filter((entry) => entry.record.kind === "current_version_fallback").length,
      earlier_version: entries.filter((entry) => entry.record.kind === "earlier_version").length
    },
    option_distribution,
    item_status,
    summary_distribution: {
      labels: SUMMARY_DISTRIBUTION_LABELS.map((label) => ({ label, students: labelCounts.get(label) ?? 0 })),
      fallback_profiles: fallbackProfiles,
      earlier_version_records: earlierVersion
    },
    possible_misconceptions,
    considered_ideas,
    answer_patterns,
    conversations: {
      held: conversations.filter((conversation) => conversation.student_messages > 0).length,
      ended_by_student: conversations.filter((conversation) => conversation.ended_by_student).length,
      students_with_turn_records: records.filter((list) => list.length > 0).length,
      corrected_reasoning_expressed_after_support: records.filter((list) => list.some((entry) => entry.focus_status === "corrected_reasoning_expressed")).length,
      difficulty_still_evident: records.filter((list) => list.some((entry) => entry.focus_status === "difficulty_still_evident")).length,
      instructor_review_flags: REVIEW_FLAGS.map((flag) => ({
        flag,
        students: conversations.filter((conversation) => conversation.turns.some((turn) => turn.flag === flag)).length
      }))
    }
  };
}

function studentEvidence(
  entry: SectionEntry,
  items: ItemContext[],
  itemLabelById: ReadonlyMap<string, string>,
  decisions: ReadonlyMap<string, InstructorItemDecision>,
  truncationNotes: string[],
  section: AttemptSection
): ReportStudentEvidence {
  const { record: prepared } = entry;
  const current = prepared.kind === "current_version" ? prepared.v8 : null;
  const label = (id: string | null) => (id ? itemLabelById.get(id) ?? null : null);
  const ratings = new Map((current?.items ?? []).map((item) => [item.item_id, item]));
  const summary = current ? summaryLabel(current, decisions) : null;
  const conversation = prepared.conversation;
  if (conversation && conversation.turns.length > INSTRUCTOR_REPORT_LIMITS.max_conversation_turns_per_student) {
    truncationNotes.push(`${entry.label} (${section === "first_attempts" ? "first attempt" : "later attempt"}): only the first ${INSTRUCTOR_REPORT_LIMITS.max_conversation_turns_per_student} conversation messages were given to the model.`);
  }
  return {
    student_label: entry.label,
    attempt_number: prepared.attempt.attempt_number,
    record: prepared.kind,
    topic_summary: summary
      ? { label: summary.label, based_on_interpretable_items: summary.based_on.interpretable_items, items_administered: summary.based_on.administered_items }
      : prepared.kind === "current_version_fallback" ? { label: "Unavailable / insufficient evidence", based_on_interpretable_items: 0, items_administered: prepared.v8?.items.length ?? 0 } : null,
    responses: items.flatMap((item) => {
      const response = prepared.responses.get(item.item_public_id);
      if (!response) return [];
      const rating = ratings.get(item.item_public_id);
      return [{
        item_label: item.label,
        selected_option: response.selected_option,
        i_dont_know: response.selected_option?.toUpperCase() === IDK_OPTION_LABEL && !item.own_option_e,
        answer_correct: response.answer_correct,
        reported_confidence: response.reported_confidence,
        explanation: clip(response.explanation),
        tempting_option: response.tempting_option,
        tempting_option_reason: clip(response.tempting_option_reason),
        rating: rating && rating.status
          ? {
              explanation_quality: rating.explanation_quality,
              adds_beyond_option_text: rating.adds_beyond_option_text,
              evidence_quote: rating.evidence_quote,
              missing_elements: rating.missing_elements,
              rationale: rating.rationale,
              error_source: rating.error_source,
              uncertainty_note: rating.uncertainty_note,
              item_status: rating.status,
              possible_item_issue: rating.item_review_flag
            }
          : null
      }];
    }),
    possible_misconceptions: (current?.possible_misconceptions ?? []).map((entry) => ({
      item_labels: byItemOrder(new Set(entry.item_ids.flatMap((id) => label(id) ?? []))),
      idea: entry.idea,
      student_quote: entry.student_quote,
      quote_item_label: label(entry.quote_item_id),
      endorsement: entry.endorsement,
      contradicts: referenceLabel(entry.contradicts_reference_id, itemLabelById)!,
      matching_rationale: referenceLabel(entry.matching_distractor_reference_id, itemLabelById),
      alternative_explanation: entry.alternative_explanation
    })),
    considered_ideas: (current?.considered_ideas ?? []).map((entry) => ({
      item_label: label(entry.item_id),
      idea: entry.idea,
      student_quote: entry.student_quote,
      contradicts: referenceLabel(entry.contradicts_reference_id, itemLabelById)!
    })),
    answer_patterns: (prepared.v8?.answer_patterns ?? []).map((pattern) => ({
      shared_tag: pattern.misconception_tag,
      item_labels: byItemOrder(new Set(pattern.item_ids.flatMap((id) => label(id) ?? [])))
    })),
    conversation: conversation
      ? {
          student_messages: conversation.student_messages,
          ended_by_student: conversation.ended_by_student,
          turns: conversation.turns.slice(0, INSTRUCTOR_REPORT_LIMITS.max_conversation_turns_per_student).map((turn, index) => ({
            turn: index + 1,
            speaker: turn.speaker,
            text: clip(turn.text)!,
            turn_record: turn.record,
            instructor_review_flag: turn.flag
          }))
        }
      : null
  };
}

export function assembleInstructorReportV8(records: LoadedReportRecords): AssembledInstructorReport {
  const decisions = records.item_decisions ?? new Map<string, InstructorItemDecision>();
  const itemLabelById = new Map(records.items.map((item, index) => [item.item_public_id, `Q${index + 1}`]));
  const items: ItemContext[] = records.items.map((item, index) => ({
    ...item,
    label: `Q${index + 1}`,
    own_option_e: item.options.some((option) => option.label.toUpperCase() === IDK_OPTION_LABEL)
  }));
  const specs = new Map<string, ParsedSpec>();
  const identifiers = new Set<string>(records.items.map((item) => item.item_public_id));
  let responsesToUnpublishedItems = 0;

  const prepared: PreparedRecord[] = records.attempts
    .filter((attempt) => attempt.package_payloads.length > 0)
    .map((attempt) => {
      identifiers.add(attempt.session_public_id);
      identifiers.add(attempt.student_key);
      const responses = new Map<string, ParsedResponse>();
      let order: string[] = [];
      for (const payload of attempt.package_payloads) {
        const parsed = responsesFromPackage(payload);
        if (!order.length) order = parsed.order;
        for (const [itemId, spec] of parsed.specs) if (!specs.has(itemId)) specs.set(itemId, spec);
        for (const response of parsed.responses) {
          if (!itemLabelById.has(response.item_id)) {
            responsesToUnpublishedItems += attempt.restored ? 0 : 1;
            continue;
          }
          responses.set(response.item_id, response);
        }
      }
      const v8 = readStoredInterpretationV8(attempt.profile_item_level_evidence);
      if (v8?.response_package_id) identifiers.add(v8.response_package_id);
      return {
        attempt,
        responses,
        v8,
        kind: !v8 ? "earlier_version" : v8.generation_mode === "fallback" ? "current_version_fallback" : "current_version",
        role: v8?.attempt?.role ?? "initial_diagnosis",
        conversation: attempt.conversation ? prepareConversation(attempt.conversation, order, itemLabelById) : null
      };
    });

  // Each student's attempts in order. The stored v8 attempt role wins; otherwise the
  // first submitted attempt (restored ones included, since their feedback was seen) is the
  // initial diagnosis and every later one comes after feedback.
  const byStudent = new Map<string, PreparedRecord[]>();
  for (const entry of prepared) byStudent.set(entry.attempt.student_key, [...(byStudent.get(entry.attempt.student_key) ?? []), entry]);
  type StudentRecords = { first: PreparedRecord | null; later: PreparedRecord[]; kept: PreparedRecord[] };
  const students: StudentRecords[] = [];
  let restoredAttempts = 0;
  for (const list of byStudent.values()) {
    list.sort((a, b) => a.attempt.attempt_number - b.attempt.attempt_number || a.attempt.created_at.localeCompare(b.attempt.created_at));
    list.forEach((entry, index) => {
      if (!entry.v8?.attempt?.role) entry.role = index === 0 ? "initial_diagnosis" : "after_feedback";
    });
    restoredAttempts += list.filter((entry) => entry.attempt.restored).length;
    const kept = list.filter((entry) => !entry.attempt.restored);
    if (!kept.length) continue;
    const first = kept.find((entry) => entry.role === "initial_diagnosis") ?? null;
    students.push({ first, later: kept.filter((entry) => entry !== first), kept });
  }
  // Labels follow a stable order unrelated to attempt counts or results.
  students.sort((a, b) => a.kept[0].attempt.session_public_id.localeCompare(b.kept[0].attempt.session_public_id));
  const labelled = students.map((entry, index) => ({ ...entry, label: `S${index + 1}` }));

  const sections: Record<AttemptSection, SectionEntry[]> = {
    first_attempts: labelled.flatMap((entry) => (entry.first ? [{ label: entry.label, record: entry.first }] : [])),
    later_attempts: labelled.flatMap((entry) => (entry.later.length ? [{ label: entry.label, record: entry.later.at(-1)! }] : []))
  };
  const sectionAttempts: Record<AttemptSection, PreparedRecord[]> = {
    first_attempts: sections.first_attempts.map((entry) => entry.record),
    later_attempts: labelled.flatMap((entry) => entry.later)
  };

  const counts: InstructorReportCounts = {
    counts_version: INSTRUCTOR_REPORT_V8_COUNTS_VERSION,
    items: items.length,
    eligible_students: records.eligible_student_count,
    students_with_submitted_attempt: labelled.length,
    students_with_first_attempt: sections.first_attempts.length,
    students_with_later_attempt: sections.later_attempts.length,
    attempts_submitted: labelled.reduce((sum, entry) => sum + entry.kept.length, 0),
    students_by_submitted_attempts: [...labelled.reduce((map, entry) => map.set(entry.kept.length, (map.get(entry.kept.length) ?? 0) + 1), new Map<number, number>())]
      .sort((a, b) => a[0] - b[0])
      .map(([submitted_attempts, studentCount]) => ({ submitted_attempts, students: studentCount })),
    first_attempts: sectionCounts("first_attempts", sections.first_attempts, sectionAttempts.first_attempts, items, itemLabelById, decisions),
    later_attempts: sectionCounts("later_attempts", sections.later_attempts, sectionAttempts.later_attempts, items, itemLabelById, decisions),
    left_out: { restored_attempts: restoredAttempts, responses_to_unpublished_items: responsesToUnpublishedItems }
  };

  const notes = applicationNotes(counts);
  const truncationNotes: string[] = [];
  const evidence = Object.fromEntries(ATTEMPT_SECTIONS.map((section) => {
    const entries = sections[section];
    if (entries.length > INSTRUCTOR_REPORT_LIMITS.max_students) {
      truncationNotes.push(`${section === "first_attempts" ? "First attempts" : "Later attempts"}: only the first ${INSTRUCTOR_REPORT_LIMITS.max_students} of ${entries.length} students were given to the model; the counts include every student.`);
    }
    return [section, entries.slice(0, INSTRUCTOR_REPORT_LIMITS.max_students).map((entry) => studentEvidence(entry, items, itemLabelById, decisions, truncationNotes, section))];
  })) as Record<AttemptSection, ReportStudentEvidence[]>;
  const allNotes = [...notes, ...truncationNotes];

  const itemInputs: ReportItemInput[] = items.map((item) => {
    const spec = specs.get(item.item_public_id);
    return {
      item_label: item.label,
      stem: item.stem,
      options: item.options,
      correct_option: item.correct_option,
      target_reasoning: spec?.target_reasoning ?? item.expected_reasoning,
      essential_elements: spec?.essential_elements ?? null,
      distractor_rationales: spec?.distractor_rationales.length ? spec.distractor_rationales : item.distractor_rationales
    };
  });

  const index: InstructorReportV8EvidenceIndex = {
    students: Object.fromEntries(labelled.map((entry) => [entry.label, {
      ...(entry.first ? { first_attempts: { session_public_id: entry.first.attempt.session_public_id, attempt_number: entry.first.attempt.attempt_number } } : {}),
      ...(entry.later.length ? { later_attempts: { session_public_id: entry.later.at(-1)!.attempt.session_public_id, attempt_number: entry.later.at(-1)!.attempt.attempt_number } } : {})
    }])),
    items: Object.fromEntries(items.map((item) => [item.label, { item_public_id: item.item_public_id }]))
  };

  return {
    input: {
      input_version: INSTRUCTOR_REPORT_V8_INPUT_VERSION,
      mini_test: {
        title: records.mini_test_title,
        topic: records.topic?.title ?? null,
        learning_objective: records.topic?.learning_objective ?? null,
        topic_description: records.topic?.description ?? null
      },
      items: itemInputs,
      counts,
      first_attempts: evidence.first_attempts,
      later_attempts: evidence.later_attempts,
      notes: allNotes
    },
    counts,
    index,
    application_notes: allNotes,
    identifiers: [...identifiers].filter(Boolean)
  };
}

/** Instructor-facing notes on what the counts include; written by the application. */
export function applicationNotes(counts: InstructorReportCounts) {
  const notes: string[] = [];
  const sum = (pick: (section: SectionCounts) => number) => pick(counts.first_attempts) + pick(counts.later_attempts);
  const earlier = sum((section) => section.records.earlier_version);
  if (earlier > 0) {
    notes.push(`${earlier} records (first attempts: ${counts.first_attempts.records.earlier_version}; later attempts: ${counts.later_attempts.records.earlier_version}) are earlier-version records, saved before the current interpretation. Their responses and conversations are included; they have no item ratings under the current rules and are left out of the item status, summary, misconception and idea counts.`);
  }
  const fallback = sum((section) => section.records.current_version_fallback);
  if (fallback > 0) {
    notes.push(`${fallback} profiles are fallback profiles: no checked interpretation was available. They have no item ratings, are left out of the item status counts and count as Unavailable / insufficient evidence in the summary distribution.`);
  }
  const intermediate = counts.later_attempts.attempts_submitted - counts.later_attempts.students;
  if (intermediate > 0) {
    notes.push(`Later-attempt counts use each student's most recent later attempt; ${intermediate} other later attempts appear only in the attempt totals.`);
  }
  if (counts.left_out.restored_attempts > 0) {
    notes.push(`${counts.left_out.restored_attempts} attempts whose chance was restored after a technical problem are left out.`);
  }
  if (counts.left_out.responses_to_unpublished_items > 0) {
    notes.push(`${counts.left_out.responses_to_unpublished_items} recorded responses are left out because their items are no longer in the published mini-test.`);
  }
  const flagged = sum((section) => section.item_status.reduce((total, item) => total + item.possible_item_issue_flags, 0));
  if (flagged > 0) {
    notes.push("Items flagged as a possible item issue stay counted until the instructor decides; a label that the flag could change is shown as Pending item review.");
  }
  return notes;
}

/* ------------------------------------------------- input check (no process data) */

const PROCESS_KEY = /(process|indicator|response_time|time_ms|elapsed|latency|duration|rapid|paste|pause|focus_loss|focused_time|answer_change|confidence_change|first_version|revised|initial$|typing|keystroke|telemetry|event|timestamp|_at$)/i;

/**
 * The model input must hold no process data and no identifiers (section 6: process data are
 * never given to the report). Returns the problems found; an empty list means the input may
 * be sent.
 */
export function reportInputProblems(input: unknown, identifiers: string[]) {
  const problems: Array<{ path: string; code: "process_data_field" | "identifier_value" }> = [];
  const ids = identifiers.filter((value) => value.length >= 6);
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) { value.forEach((entry, index) => walk(entry, `${path}[${index}]`)); return; }
    if (typeof value === "string") {
      if (ids.some((id) => value.includes(id))) problems.push({ path, code: "identifier_value" });
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (PROCESS_KEY.test(key)) problems.push({ path: `${path}.${key}`, code: "process_data_field" });
      walk(entry, `${path}.${key}`);
    }
  };
  walk(input, "input");
  return problems;
}
