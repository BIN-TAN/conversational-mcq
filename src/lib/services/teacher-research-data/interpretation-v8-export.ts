import type { Prisma } from "@prisma/client";
import {
  decisionAdjustedTopicSummary,
  readStoredInterpretationV8,
  type StoredInterpretationV8
} from "@/lib/services/student-assessment/interpretation-v8/profile";
import { InterpretationOutputV8Schema, INTERPRETATION_V8_SCHEMA_VERSION } from "@/lib/services/student-assessment/interpretation-v8/contract";
import type { InstructorItemDecision, TopicSummary } from "@/lib/services/student-assessment/interpretation-v8/rules";
import {
  FEEDBACK_V8_CONTRACT_VERSION,
  FEEDBACK_V8_CONVERSATION_PROMPT_VERSION,
  FEEDBACK_V8_OPENING_PROMPT_VERSION,
  FeedbackV8OutputSchema
} from "@/lib/services/student-assessment/feedback-v8/contract";
import { researchCsv } from "./csv-contract";
import {
  FEEDBACK_TURN_RECORDS_COLUMNS,
  INTERPRETATION_CLAIMS_COLUMNS,
  INTERPRETATION_ITEM_RATINGS_COLUMNS,
  INTERPRETATION_PROCESS_AUDIT_COLUMNS,
  INTERPRETATION_SUMMARIES_COLUMNS,
  INTERPRETATION_V8_EXPORT_VERSION,
  INTERPRETATION_V8_NOTES_FILE,
  INTERPRETATION_V8_PROFILE_COLUMNS,
  INTERPRETATION_V8_RESTRICTED_COLUMNS,
  ITEM_ADMINISTRATION_V4_COLUMNS,
  ITEM_REVIEW_DECISIONS_COLUMNS,
  PROCESS_AUDIT_INDICATOR_COLUMNS,
  V8_BLANKED_LEGACY_COLUMNS,
  interpretationV8NotesText
} from "./interpretation-v8-dictionary";

/**
 * Row builders for the interpretation v8 research files (see interpretation-v8-dictionary.ts
 * for the layouts and definitions). Everything here except the two loaders at the end is a
 * pure function of already-loaded records, so it can be tested without a database.
 *
 * Audiences (section 3.1 of the redesign): item ratings, claims, summaries, turn records and
 * item decisions are instructor-facing records; process indicators and the models' process
 * interpretations are for the models only and appear here, in restricted exports, for audit.
 */

type Cell = string | number | boolean | null;
export type V8Row = Record<string, Cell>;

export type V8ExportItem = {
  item_public_id: string;
  item_snapshot_public_id: string | null;
  item_version: number | null;
  item_order: number | null;
};

export type V8ExportProfile = {
  profile_record_id: string;
  concept_unit_public_id: string | null;
  created_at: Date;
  item_level_evidence: unknown;
  /** Public id of StudentProfile.based_on_agent_call (the profiling call the profile rests on). */
  source_agent_call_public_id: string | null;
};

export type V8ProfilingCall = {
  agent_call_public_id: string;
  call_status: string;
  output_validated: boolean;
  provider: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  input_payload: unknown;
  output_payload: unknown;
};

export type V8FeedbackCall = {
  agent_call_public_id: string;
  conversation_public_id: string | null;
  call_status: string;
  output_validated: boolean;
  provider: string | null;
  model_name: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  prompt_hash: string | null;
  output_payload: unknown;
  created_at: Date;
  completed_at: Date | null;
};

export type V8TutorTurn = {
  conversation_public_id: string;
  agent_call_public_id: string;
  turn_sequence_index: number;
  conversation_local_turn_sequence_index: number | null;
  created_at: Date;
};

export type V8ReviewSignal = {
  signal_public_id: string;
  conversation_public_id: string;
  source_turn_sequence_index: number | null;
  reason_code: string;
  status: string;
};

export type V8ExportSession = {
  session_public_id: string;
  research_student_id: string;
  assessment_public_id: string;
  attempt_number: number;
  family_attempt_number: number | null;
  items: V8ExportItem[];
  profiles: V8ExportProfile[];
  profiling_calls: V8ProfilingCall[];
  conversations: Array<{ conversation_public_id: string; initial_item_level_evidence: unknown }>;
  tutor_turns: V8TutorTurn[];
  feedback_calls: V8FeedbackCall[];
  review_signals: V8ReviewSignal[];
};

export type ItemReviewDecisionRecord = {
  decision_public_id: string;
  assessment_public_id: string;
  item_public_id: string;
  item_version: number | null;
  decision: InstructorItemDecision;
  note: string | null;
  decided_at: Date;
  superseded_at: Date | null;
  research_instructor_id: string | null;
  research_pseudonym_version: string | null;
};

export type CurrentItemDecisions = ReadonlyMap<string, { decision: InstructorItemDecision; decided_at: Date }>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const iso = (value: Date | string | null | undefined) =>
  value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
const pipe = (values: Array<string | number>) => (values.length ? values.join("|") : null);
const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));
const cell = (value: unknown): Cell =>
  value === null || value === undefined ? null
    : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value
      : JSON.stringify(value);

/** Decisions in force (no superseded_at), by item; the latest wins if the data hold more than one. */
export function currentItemDecisions(records: ItemReviewDecisionRecord[]): Map<string, { decision: InstructorItemDecision; decided_at: Date }> {
  const current = new Map<string, { decision: InstructorItemDecision; decided_at: Date }>();
  for (const entry of records) {
    if (entry.superseded_at) continue;
    const existing = current.get(entry.item_public_id);
    if (!existing || existing.decided_at.getTime() <= entry.decided_at.getTime()) {
      current.set(entry.item_public_id, { decision: entry.decision, decided_at: entry.decided_at });
    }
  }
  return current;
}

function decisionMap(decisions: CurrentItemDecisions): Map<string, InstructorItemDecision> {
  return new Map([...decisions.entries()].map(([itemId, entry]) => [itemId, entry.decision]));
}

function sortedItems(stored: StoredInterpretationV8) {
  return [...stored.items].sort((a, b) => a.position - b.position || a.item_id.localeCompare(b.item_id));
}

/** "Question N" numbering used by the feedback models and dashboards (feedback-v8/context.ts). */
export function v8ItemNumbers(stored: StoredInterpretationV8) {
  return new Map(sortedItems(stored).map((item, index) => [item.item_id, index + 1]));
}

function v8Profiles(session: V8ExportSession) {
  return session.profiles
    .flatMap((profile) => {
      const stored = readStoredInterpretationV8(profile.item_level_evidence);
      return stored ? [{ profile, stored }] : [];
    })
    .sort((a, b) => a.profile.created_at.getTime() - b.profile.created_at.getTime() ||
      a.profile.profile_record_id.localeCompare(b.profile.profile_record_id));
}

function attemptIdentity(session: V8ExportSession, profile: V8ExportProfile, stored: StoredInterpretationV8): V8Row {
  return {
    interpretation_export_version: INTERPRETATION_V8_EXPORT_VERSION,
    research_student_id: session.research_student_id,
    assessment_public_id: session.assessment_public_id,
    session_public_id: session.session_public_id,
    attempt_number: session.attempt_number,
    family_attempt_number: session.family_attempt_number,
    attempt_role: stored.attempt?.role ?? null,
    concept_unit_public_id: profile.concept_unit_public_id,
    profile_record_id: profile.profile_record_id
  };
}

function itemIdentity(session: V8ExportSession, stored: StoredInterpretationV8, itemId: string, position: number | null): V8Row {
  const item = session.items.find((entry) => entry.item_public_id === itemId);
  return {
    item_public_id: itemId,
    item_snapshot_public_id: item?.item_snapshot_public_id ?? null,
    item_version: item?.item_version ?? null,
    item_order: item?.item_order ?? null,
    item_position: position,
    item_number: v8ItemNumbers(stored).get(itemId) ?? null
  };
}

function versions(stored: StoredInterpretationV8): V8Row {
  return {
    generation_mode: stored.generation_mode,
    prompt_version: stored.prompt_version,
    schema_version: stored.schema_version,
    rules_version: stored.rules_version
  };
}

export function interpretationItemRatingRows(
  session: V8ExportSession,
  decisions: CurrentItemDecisions,
  options: { include_restricted: boolean }
): V8Row[] {
  return v8Profiles(session).flatMap(({ profile, stored }) =>
    sortedItems(stored).map((item) => {
      const decision = decisions.get(item.item_id) ?? null;
      const row: V8Row = {
        ...attemptIdentity(session, profile, stored),
        ...itemIdentity(session, stored, item.item_id, item.position),
        selected_option: item.selected_option,
        reported_confidence: item.reported_confidence,
        explanation_quality: item.explanation_quality,
        no_usable_reason: item.no_usable_reason,
        adds_beyond_option_text: item.adds_beyond_option_text,
        evidence_quote: item.evidence_quote,
        evidence_source: item.evidence_source,
        reference_id: item.reference_id,
        missing_elements: item.missing_elements,
        rationale: item.rationale,
        error_source: item.error_source,
        side_remark: item.side_remark,
        uncertainty_note: item.uncertainty_note,
        item_status: item.status,
        item_review_flag: item.item_review_flag,
        rating_unavailable: item.rating_unavailable ?? (stored.generation_mode === "fallback" ? null : false),
        instructor_item_decision: decision?.decision ?? null,
        instructor_item_decision_at: iso(decision?.decided_at),
        item_counted_with_decisions: decision?.decision !== "excluded",
        ...versions(stored),
        fallback_reason: stored.fallback_reason,
        profile_created_at: iso(profile.created_at)
      };
      if (options.include_restricted) row.answer_correct = item.answer_correct;
      return row;
    })
  );
}

export function interpretationClaimRows(session: V8ExportSession): V8Row[] {
  return v8Profiles(session).flatMap(({ profile, stored }) => {
    const numbers = v8ItemNumbers(stored);
    const numbered = (ids: string[]) => pipe(ids.map((id) => numbers.get(id)).filter((value): value is number => typeof value === "number"));
    const base = { ...attemptIdentity(session, profile, stored), ...versions(stored) };
    const misconceptions = stored.possible_misconceptions.map((claim, index): V8Row => ({
      ...base,
      claim_id: `${profile.profile_record_id}:possible_misconception:${index + 1}`,
      claim_type: "possible_misconception",
      claim_index: index + 1,
      claim_item_public_ids: pipe(claim.item_ids),
      claim_item_numbers: numbered(claim.item_ids),
      quote_item_public_id: claim.quote_item_id,
      idea: claim.idea,
      student_quote: claim.student_quote,
      quote_source: claim.quote_source,
      endorsement: claim.endorsement,
      contradicts_reference_id: claim.contradicts_reference_id,
      matching_distractor_reference_id: claim.matching_distractor_reference_id,
      alternative_explanation: claim.alternative_explanation
    }));
    const considered = stored.considered_ideas.map((idea, index): V8Row => ({
      ...base,
      claim_id: `${profile.profile_record_id}:considered_idea:${index + 1}`,
      claim_type: "considered_idea",
      claim_index: index + 1,
      claim_item_public_ids: idea.item_id,
      claim_item_numbers: numbered([idea.item_id]),
      quote_item_public_id: idea.item_id,
      idea: idea.idea,
      student_quote: idea.student_quote,
      quote_source: idea.quote_source,
      endorsement: null,
      contradicts_reference_id: idea.contradicts_reference_id,
      matching_distractor_reference_id: null,
      alternative_explanation: null
    }));
    return [...misconceptions, ...considered];
  });
}

/** Label shown with the instructor's current decisions; the stored profile is not changed. */
export function v8SummaryWithDecisions(stored: StoredInterpretationV8, decisions: CurrentItemDecisions): TopicSummary {
  return decisionAdjustedTopicSummary(stored, decisionMap(decisions));
}

export function interpretationSummaryRows(session: V8ExportSession, decisions: CurrentItemDecisions): V8Row[] {
  return v8Profiles(session).map(({ profile, stored }) => {
    const summary = stored.topic_summary;
    const adjusted = v8SummaryWithDecisions(stored, decisions);
    const earlier = stored.attempt?.feedback_seen_before ?? [];
    return {
      ...attemptIdentity(session, profile, stored),
      generation_mode: stored.generation_mode,
      fallback_reason: stored.fallback_reason,
      stored_label: summary.label,
      stored_reason: summary.reason,
      stored_rule_label: summary.rule_label,
      stored_rule_reason: summary.rule_reason,
      stored_label_without_pending: summary.label_without_pending,
      stored_pending_review_item_ids: pipe(summary.pending_review_item_ids),
      label_with_decisions: adjusted.label,
      reason_with_decisions: adjusted.reason,
      rule_label_with_decisions: adjusted.rule_label,
      label_without_pending_with_decisions: adjusted.label_without_pending,
      pending_review_item_ids_with_decisions: pipe(adjusted.pending_review_item_ids),
      excluded_item_ids_with_decisions: pipe(adjusted.excluded_item_ids),
      administered_item_count: summary.administered_items,
      counted_item_count: summary.counted_items,
      interpretable_item_count: summary.interpretable_items,
      supported_item_count: summary.supported,
      partly_supported_item_count: summary.partly_supported,
      not_supported_item_count: summary.not_supported,
      not_interpretable_item_count: summary.not_interpretable,
      counted_item_count_with_decisions: adjusted.counted_items,
      interpretable_item_count_with_decisions: adjusted.interpretable_items,
      possible_misconception_count: stored.possible_misconceptions.length,
      considered_idea_count: stored.considered_ideas.length,
      answer_patterns: stored.answer_patterns.length ? json(stored.answer_patterns) : null,
      output_repair_codes: stored.output_adjustments?.repairs.length ? pipe(stored.output_adjustments.repairs.map((repair) => repair.code)) : null,
      output_salvaged: stored.output_adjustments ? Boolean(stored.output_adjustments.salvage) : stored.generation_mode === "fallback" ? null : false,
      salvage_unrated_item_ids: stored.output_adjustments?.salvage ? pipe(stored.output_adjustments.salvage.unrated_item_ids) : null,
      salvage_dropped_claim_count: stored.output_adjustments?.salvage
        ? stored.output_adjustments.salvage.dropped_misconceptions + stored.output_adjustments.salvage.dropped_considered_ideas : null,
      attempt_context_version: stored.attempt?.attempt_context_version ?? null,
      earlier_attempt_count: stored.attempt ? earlier.length : null,
      feedback_seen_attempt_numbers: pipe(earlier.filter((entry) => entry.answer_review_shown).map((entry) => entry.attempt_number)),
      answer_review_seen_before: stored.attempt ? earlier.some((entry) => entry.answer_review_shown) : null,
      opening_message_seen_before: stored.attempt ? earlier.some((entry) => Boolean(entry.opening_message_at)) : null,
      student_turns_seen_before: stored.attempt ? earlier.reduce((total, entry) => total + entry.student_turns, 0) : null,
      tutor_turns_seen_before: stored.attempt ? earlier.reduce((total, entry) => total + entry.tutor_turns, 0) : null,
      feedback_seen_before_json: stored.attempt ? json(earlier) : null,
      rules_version: stored.rules_version,
      prompt_version: stored.prompt_version,
      schema_version: stored.schema_version,
      indicators_version: stored.indicators_version,
      profile_created_at: iso(profile.created_at)
    };
  });
}

function validatedProfilingOutput(call: V8ProfilingCall) {
  if (!call.output_validated || call.call_status !== "succeeded") return null;
  const parsed = InterpretationOutputV8Schema.safeParse(call.output_payload);
  return parsed.success ? parsed.data : null;
}

/**
 * Audit rows: the indicators the profiling model received and its process interpretation,
 * one row per item. No rows when no model call received the input (a blocked call or a
 * fallback saved without a call).
 */
export function interpretationProcessAuditRows(session: V8ExportSession): V8Row[] {
  return v8Profiles(session).flatMap(({ profile, stored }) => {
    const call = session.profiling_calls.find((entry) => entry.agent_call_public_id === profile.source_agent_call_public_id);
    if (!call) return [];
    const inputItems = (Array.isArray(record(call.input_payload).items) ? record(call.input_payload).items as unknown[] : []).map(record);
    if (!inputItems.length) return [];
    const output = validatedProfilingOutput(call);
    const interpretations = new Map((output?.items ?? []).map((entry) => [entry.item_id, entry.process_interpretation]));
    const storedPosition = new Map(stored.items.map((item) => [item.item_id, item.position]));
    return inputItems.flatMap((inputItem) => {
      const itemId = typeof inputItem.item_id === "string" ? inputItem.item_id : null;
      if (!itemId) return [];
      const indicators = (Array.isArray(inputItem.process_indicators) ? inputItem.process_indicators : []).map(record);
      const value = (name: string) => cell(indicators.find((indicator) => indicator.name === name)?.value);
      const interpretation = interpretations.get(itemId) ?? null;
      const position = storedPosition.get(itemId) ?? (typeof inputItem.position === "number" ? inputItem.position : null);
      return [{
        ...attemptIdentity(session, profile, stored),
        ...itemIdentity(session, stored, itemId, position),
        audience: "audit_only_never_shown",
        profiling_agent_call_public_id: call.agent_call_public_id,
        profiling_call_status: call.call_status,
        profiling_output_validated: call.output_validated,
        profiling_provider: call.provider,
        generation_mode: stored.generation_mode,
        ...Object.fromEntries(Object.entries(PROCESS_AUDIT_INDICATOR_COLUMNS).map(([name, column]) => [column, value(name)])),
        process_indicators_json: json(indicators.map((indicator) => ({
          indicator_id: indicator.indicator_id ?? null,
          name: indicator.name ?? null,
          value: indicator.value ?? null,
          unit: indicator.unit ?? null,
          role: indicator.role ?? null
        }))),
        process_interpretation_status: !output ? "no_validated_output" : interpretation ? "present" : "none",
        process_interpretation_type: interpretation?.type ?? null,
        process_interpretation_indicator_ids: interpretation ? pipe(interpretation.indicator_ids) : null,
        process_interpretation_content_quote: interpretation?.content_quote ?? null,
        process_interpretation_content_source: interpretation?.content_source ?? null,
        process_interpretation_note: interpretation?.note ?? null,
        process_interpretation_alternatives: interpretation ? json(interpretation.alternatives) : null,
        indicators_version: stored.indicators_version,
        prompt_version: call.prompt_version ?? stored.prompt_version,
        schema_version: call.schema_version ?? stored.schema_version
      } satisfies V8Row];
    });
  });
}

/** One row per validated feedback v8 output (opening or reply), in transcript order. */
export function feedbackTurnRecordRows(session: V8ExportSession): V8Row[] {
  const numbering = new Map(session.conversations.map((conversation) => {
    const stored = readStoredInterpretationV8(conversation.initial_item_level_evidence);
    const byNumber = new Map<number, string>();
    if (stored) for (const [itemId, number] of v8ItemNumbers(stored)) byNumber.set(number, itemId);
    return [conversation.conversation_public_id, byNumber] as const;
  }));
  const rows = session.feedback_calls.flatMap((call) => {
    if (call.schema_version !== FEEDBACK_V8_CONTRACT_VERSION || call.call_status !== "succeeded" || !call.output_validated) return [];
    const parsed = FeedbackV8OutputSchema.safeParse(call.output_payload);
    if (!parsed.success) return [];
    const output = parsed.data;
    const turn = session.tutor_turns.find((entry) => entry.agent_call_public_id === call.agent_call_public_id) ?? null;
    const conversationId = call.conversation_public_id ?? turn?.conversation_public_id ?? null;
    const signal = turn
      ? session.review_signals.find((entry) => entry.conversation_public_id === conversationId &&
          entry.source_turn_sequence_index === turn.turn_sequence_index) ?? null
      : null;
    const mode = output.focus_status === null ? "opening" : "reply";
    const byNumber = conversationId ? numbering.get(conversationId) : undefined;
    return [{
      sort_conversation: conversationId ?? "",
      sort_turn: turn?.turn_sequence_index ?? Number.MAX_SAFE_INTEGER,
      sort_created: call.created_at.getTime(),
      row: {
        interpretation_export_version: INTERPRETATION_V8_EXPORT_VERSION,
        research_student_id: session.research_student_id,
        assessment_public_id: session.assessment_public_id,
        session_public_id: session.session_public_id,
        attempt_number: session.attempt_number,
        family_attempt_number: session.family_attempt_number,
        conversation_public_id: conversationId,
        agent_call_public_id: call.agent_call_public_id,
        turn_sequence_index: turn?.turn_sequence_index ?? null,
        conversation_local_turn_sequence_index: turn?.conversation_local_turn_sequence_index ?? null,
        turn_created_at: iso(turn?.created_at),
        feedback_mode: mode,
        focus_item_numbers: pipe(output.focus.item_numbers),
        focus_item_public_ids: byNumber
          ? pipe(output.focus.item_numbers.map((number) => byNumber.get(number)).filter((id): id is string => Boolean(id)))
          : null,
        focus_type: output.focus.focus_type,
        focus_concept: output.focus.concept,
        strategy: output.strategy,
        focus_status: output.focus_status,
        student_evidence_count: output.student_evidence.length,
        student_evidence_quotes: json(output.student_evidence.map((entry) => entry.quote)),
        student_evidence_notes: json(output.student_evidence.map((entry) => entry.note)),
        instructor_review_flag: output.instructor_review.flag,
        instructor_review_reason: output.instructor_review.reason,
        review_signal_public_id: signal?.signal_public_id ?? null,
        review_signal_status: signal?.status ?? null,
        provider: call.provider,
        model_name: call.model_name,
        prompt_version: call.prompt_version,
        mode_prompt_version: mode === "opening" ? FEEDBACK_V8_OPENING_PROMPT_VERSION : FEEDBACK_V8_CONVERSATION_PROMPT_VERSION,
        schema_version: call.schema_version,
        prompt_hash: call.prompt_hash,
        call_completed_at: iso(call.completed_at)
      } satisfies V8Row
    }];
  });
  return rows
    .sort((a, b) => a.sort_conversation.localeCompare(b.sort_conversation) || a.sort_turn - b.sort_turn || a.sort_created - b.sort_created)
    .map((entry) => entry.row);
}

export function itemReviewDecisionRows(records: ItemReviewDecisionRecord[]): V8Row[] {
  return [...records]
    .sort((a, b) => a.assessment_public_id.localeCompare(b.assessment_public_id) ||
      a.item_public_id.localeCompare(b.item_public_id) ||
      a.decided_at.getTime() - b.decided_at.getTime() ||
      a.decision_public_id.localeCompare(b.decision_public_id))
    .map((entry) => ({
      interpretation_export_version: INTERPRETATION_V8_EXPORT_VERSION,
      decision_public_id: entry.decision_public_id,
      assessment_public_id: entry.assessment_public_id,
      item_public_id: entry.item_public_id,
      item_version: entry.item_version,
      decision: entry.decision,
      note: entry.note,
      decided_at: iso(entry.decided_at),
      superseded_at: iso(entry.superseded_at),
      decision_current: entry.superseded_at === null,
      research_instructor_id: entry.research_instructor_id,
      research_pseudonym_version: entry.research_pseudonym_version
    }));
}

function columnsFor(columns: readonly string[], includeRestricted: boolean) {
  return includeRestricted ? [...columns] : columns.filter((column) => !(INTERPRETATION_V8_RESTRICTED_COLUMNS as readonly string[]).includes(column));
}

function csvSafe(value: Cell | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value;
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function interpretationV8Csv(columns: readonly string[], rows: V8Row[]) {
  return researchCsv(rows.map((row) => Object.fromEntries(columns.map((column) => [column, csvSafe(row[column])]))), columns);
}

/**
 * The per-session v8 files. The process audit file is produced only in restricted exports:
 * like ai_call_audit.csv it holds model input and output for audit, and its answer-change
 * indicator reveals answer correctness, which default exports withhold.
 */
export function interpretationV8SessionFiles(session: V8ExportSession, decisions: CurrentItemDecisions, includeRestricted: boolean) {
  const files = [
    { path: "interpretation_item_ratings.csv", data: interpretationV8Csv(columnsFor(INTERPRETATION_ITEM_RATINGS_COLUMNS, includeRestricted), interpretationItemRatingRows(session, decisions, { include_restricted: includeRestricted })) },
    { path: "interpretation_claims.csv", data: interpretationV8Csv(INTERPRETATION_CLAIMS_COLUMNS, interpretationClaimRows(session)) },
    { path: "interpretation_summaries.csv", data: interpretationV8Csv(INTERPRETATION_SUMMARIES_COLUMNS, interpretationSummaryRows(session, decisions)) },
    { path: "feedback_turn_records.csv", data: interpretationV8Csv(FEEDBACK_TURN_RECORDS_COLUMNS, feedbackTurnRecordRows(session)) },
    { path: INTERPRETATION_V8_NOTES_FILE, data: interpretationV8NotesText() }
  ];
  if (includeRestricted) {
    files.push({ path: "interpretation_process_audit.csv", data: interpretationV8Csv(INTERPRETATION_PROCESS_AUDIT_COLUMNS, interpretationProcessAuditRows(session)) });
  }
  return files;
}

export function itemReviewDecisionFile(records: ItemReviewDecisionRecord[]) {
  return { path: "item_review_decisions.csv", data: interpretationV8Csv(ITEM_REVIEW_DECISIONS_COLUMNS, itemReviewDecisionRows(records)) };
}

type ProfileColumnKey = (typeof INTERPRETATION_V8_PROFILE_COLUMNS)[number];

/** The v8 columns added to existing rows; all blank for earlier profiles. */
export function interpretationV8ProfileColumns(itemLevelEvidence: unknown, decisions: CurrentItemDecisions): Record<ProfileColumnKey, Cell> & { is_v8: boolean } {
  const stored = readStoredInterpretationV8(itemLevelEvidence);
  if (!stored) {
    return {
      is_v8: false,
      interpretation_profile_schema: null,
      interpretation_generation_mode: null,
      interpretation_summary_label: null,
      interpretation_summary_label_with_decisions: null,
      interpretation_rules_version: null
    };
  }
  return {
    is_v8: true,
    interpretation_profile_schema: stored.profile_schema,
    interpretation_generation_mode: stored.generation_mode,
    interpretation_summary_label: stored.topic_summary.label,
    interpretation_summary_label_with_decisions: v8SummaryWithDecisions(stored, decisions).label,
    interpretation_rules_version: stored.rules_version
  };
}

/**
 * Leaves the legacy profile columns blank for a v8 profile (they hold placeholders the v8
 * path writes only because the database requires them) and adds the v8 columns. Rows for
 * earlier profiles keep every value and get blank v8 columns.
 */
export function withInterpretationV8ProfileColumns<T extends Record<string, unknown>>(
  table: keyof typeof V8_BLANKED_LEGACY_COLUMNS,
  row: T,
  itemLevelEvidence: unknown,
  decisions: CurrentItemDecisions
): T & Record<ProfileColumnKey, Cell> {
  const { is_v8: isV8, ...columns } = interpretationV8ProfileColumns(itemLevelEvidence, decisions);
  const blanked = isV8 ? Object.fromEntries(V8_BLANKED_LEGACY_COLUMNS[table].filter((column) => column in row).map((column) => [column, null])) : {};
  return { ...row, ...blanked, ...columns };
}

type ItemAdminEvent = { event_type: string; payload: unknown };
const V4_ACTIONS = {
  accept: "item_admin_v4_accept_count",
  clarify_once: "item_admin_v4_clarify_count",
  defer_question: "item_admin_v4_deferred_question_count",
  procedural_help: "item_admin_v4_procedural_help_count",
  redirect: "item_admin_v4_redirect_count"
} as const;

/**
 * Item administration v4 summary for one item, from its response_quality_checked events.
 * v4 records carry collection_action in payload.item_administration_tutor; earlier records
 * carry quality levels instead. v4_only is true when every recorded check is a v4 record.
 */
export function itemAdministrationV4Fields(events: ItemAdminEvent[]): { columns: Record<(typeof ITEM_ADMINISTRATION_V4_COLUMNS)[number], Cell>; v4_only: boolean } {
  const tutors = events.filter((event) => event.event_type === "response_quality_checked")
    .map((event) => ({ tutor: record(record(event.payload).item_administration_tutor), payload: record(event.payload) }));
  const versionsSeen = [...new Set(tutors.map(({ tutor }) => tutor.tutor_version).filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const v4 = tutors.filter(({ tutor }) => typeof tutor.collection_action === "string");
  const blank = Object.fromEntries(ITEM_ADMINISTRATION_V4_COLUMNS.map((column) => [column, null])) as Record<(typeof ITEM_ADMINISTRATION_V4_COLUMNS)[number], Cell>;
  if (!v4.length) return { columns: { ...blank, item_admin_tutor_versions: pipe(versionsSeen) }, v4_only: false };
  const count = (predicate: (tutor: Record<string, unknown>) => boolean) => v4.filter(({ tutor }) => predicate(tutor)).length;
  return {
    columns: {
      ...blank,
      item_admin_tutor_versions: pipe(versionsSeen),
      item_admin_v4_decision_count: v4.length,
      ...Object.fromEntries(Object.entries(V4_ACTIONS).map(([action, column]) => [column, count((tutor) => tutor.collection_action === action)])),
      item_admin_v4_model_decision_count: count((tutor) => tutor.collection_decision_source === "model"),
      item_admin_v4_fallback_count: count((tutor) => tutor.collection_fallback_used === true),
      item_admin_v4_application_override_count: count((tutor) =>
        typeof tutor.collection_application_override === "string" && tutor.collection_application_override !== "none"),
      item_admin_v4_saved_question_count: count((tutor) =>
        typeof tutor.deferred_concern_summary === "string" && tutor.deferred_concern_summary.trim().length > 0)
    },
    v4_only: v4.length === tutors.length
  };
}

// Loaders (database). They read inside the export's snapshot transaction.

export async function loadInterpretationV8CallRecords(tx: Prisma.TransactionClient, assessmentSessionDbId: string) {
  const [profilingCalls, feedbackCalls, signals] = await Promise.all([
    tx.agentCall.findMany({
      where: { assessment_session_db_id: assessmentSessionDbId, schema_version: INTERPRETATION_V8_SCHEMA_VERSION },
      orderBy: [{ created_at: "asc" }],
      select: {
        agent_call_public_id: true, call_status: true, output_validated: true, provider: true,
        prompt_version: true, schema_version: true, input_payload: true, output_payload: true
      }
    }),
    tx.agentCall.findMany({
      where: {
        assessment_session_db_id: assessmentSessionDbId,
        schema_version: FEEDBACK_V8_CONTRACT_VERSION,
        call_status: "succeeded",
        output_validated: true
      },
      orderBy: [{ created_at: "asc" }],
      select: {
        agent_call_public_id: true, call_status: true, output_validated: true, provider: true, model_name: true,
        prompt_version: true, schema_version: true, prompt_hash: true, output_payload: true, created_at: true, completed_at: true,
        formative_conversation_session: { select: { conversation_public_id: true } }
      }
    }),
    tx.formativeConversationReviewSignal.findMany({
      where: { signal_type: "feedback_v8_instructor_review", formative_conversation_session: { assessment_session_db_id: assessmentSessionDbId } },
      orderBy: [{ created_at: "asc" }],
      select: {
        signal_public_id: true, reason_code: true, status: true,
        source_turn: { select: { sequence_index: true } },
        formative_conversation_session: { select: { conversation_public_id: true } }
      }
    })
  ]);
  return {
    profiling_calls: profilingCalls.map((call): V8ProfilingCall => ({ ...call, call_status: String(call.call_status) })),
    feedback_calls: feedbackCalls.map(({ formative_conversation_session: conversation, ...call }): V8FeedbackCall => ({
      ...call,
      call_status: String(call.call_status),
      conversation_public_id: conversation?.conversation_public_id ?? null
    })),
    review_signals: signals.map((signal): V8ReviewSignal => ({
      signal_public_id: signal.signal_public_id,
      conversation_public_id: signal.formative_conversation_session.conversation_public_id,
      source_turn_sequence_index: signal.source_turn?.sequence_index ?? null,
      reason_code: signal.reason_code,
      status: String(signal.status)
    }))
  };
}

type DecisionSqlRow = {
  decision_public_id: string;
  assessment_public_id: string;
  item_public_id: string;
  item_version: number | null;
  decision: string;
  note: string | null;
  decided_at: Date;
  superseded_at: Date | null;
  decided_by: string | null;
};

/**
 * Every instructor decision (current and superseded) on the items of one mini-test. Read with
 * SQL like item-review/service.ts because the Prisma client may predate the table; an
 * export from a database without the table returns no decisions instead of failing.
 */
export async function loadItemReviewDecisionRecords(
  tx: Prisma.TransactionClient,
  assessmentPublicId: string,
  pseudonym: { instructor: (userId: string) => string; version: string }
): Promise<ItemReviewDecisionRecord[]> {
  const [presence] = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('item_review_decisions') IS NOT NULL AS present`;
  if (!presence?.present) return [];
  const rows = await tx.$queryRaw<DecisionSqlRow[]>`
    SELECT d.decision_public_id, a.assessment_public_id, i.item_public_id, i.version AS item_version,
      d.decision::text AS decision, d.note, d.decided_at, d.superseded_at, u.user_id AS decided_by
    FROM item_review_decisions d
    JOIN items i ON i.id = d.item_db_id
    JOIN concept_units cu ON cu.id = i.concept_unit_db_id
    JOIN assessments a ON a.id = cu.assessment_db_id
    LEFT JOIN users u ON u.id = d.decided_by_user_db_id
    WHERE a.assessment_public_id = ${assessmentPublicId}
    ORDER BY i.item_public_id ASC, d.decided_at ASC, d.decision_public_id ASC`;
  return rows.flatMap((row) => row.decision === "kept" || row.decision === "excluded"
    ? [{
        decision_public_id: row.decision_public_id,
        assessment_public_id: row.assessment_public_id,
        item_public_id: row.item_public_id,
        item_version: row.item_version === null ? null : Number(row.item_version),
        decision: row.decision,
        note: row.note,
        decided_at: new Date(row.decided_at),
        superseded_at: row.superseded_at ? new Date(row.superseded_at) : null,
        research_instructor_id: row.decided_by ? pseudonym.instructor(row.decided_by) : null,
        research_pseudonym_version: pseudonym.version
      }]
    : []);
}
