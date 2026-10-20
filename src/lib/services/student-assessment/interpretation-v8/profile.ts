import type { Prisma } from "@prisma/client";
import { emptyCanonicalMisconceptionClaimCatalog } from "@/lib/domain/misconception-claim-identity";
import { toPrismaJson } from "@/lib/services/json";
import {
  INTERPRETATION_V8_PROMPT_VERSION,
  INTERPRETATION_V8_SCHEMA_VERSION,
  type InterpretationInputV8,
  type InterpretationOutputV8
} from "./contract";
import type { AttemptContext } from "./attempts";
import { indicatorValue, PROCESS_INDICATORS_VERSION } from "./indicators";
import {
  answerPatterns,
  INTERPRETATION_RULES_VERSION,
  itemStatus,
  PENDING_ITEM_REVIEW_LABEL,
  topicSummary,
  type ItemStatus,
  type TopicSummary
} from "./rules";

/**
 * Stored form of a v8 profile (StudentProfile.item_level_evidence), written once per
 * submission and never updated. Instructors see the item ratings, item-review flags,
 * possible misconceptions, considered ideas, answer patterns and the summary. The summary
 * stored here has no instructor item decisions; the label shown later is recomputed from
 * the stored statuses and those decisions (rules.topicSummary), leaving this record as is. Process indicators and the model's process interpretations are not stored
 * here: they stay in the profiling AgentCall (input and output), where the feedback models
 * and the research export read them.
 *
 * The legacy label columns (ability, engagement, integrated profile...) are required by
 * the database, so they hold fixed values marked "not produced"; ability_profile follows
 * the topic summary. Exports leave them blank for v8 profiles.
 */
export const INTERPRETATION_V8_PROFILE_SCHEMA = "student-interpretation-profile-v8" as const;
export const FALLBACK_PROFILE_CAUTION = "Fallback-derived profile";

export type StoredItemInterpretationV8 = {
  item_id: string;
  position: number;
  selected_option: string | null;
  answer_correct: boolean | null;
  reported_confidence: string | null;
  explanation_quality: string | null;
  no_usable_reason: string | null;
  adds_beyond_option_text: boolean | null;
  evidence_quote: string | null;
  evidence_source: string | null;
  reference_id: string | null;
  missing_elements: string | null;
  rationale: string | null;
  error_source: string | null;
  side_remark: string | null;
  uncertainty_note: string | null;
  status: ItemStatus | null;
  /** The model's possible item issue: a flag for the instructor, never a status change. */
  item_review_flag: boolean;
};

export type StoredInterpretationV8 = {
  profile_schema: typeof INTERPRETATION_V8_PROFILE_SCHEMA;
  prompt_version: typeof INTERPRETATION_V8_PROMPT_VERSION;
  schema_version: typeof INTERPRETATION_V8_SCHEMA_VERSION;
  rules_version: typeof INTERPRETATION_RULES_VERSION;
  indicators_version: typeof PROCESS_INDICATORS_VERSION;
  generation_mode: "live_model" | "local_test" | "fallback";
  fallback_reason: string | null;
  response_package_id: string;
  attempt: AttemptContext | null;
  items: StoredItemInterpretationV8[];
  possible_misconceptions: InterpretationOutputV8["possible_misconceptions"];
  considered_ideas: InterpretationOutputV8["considered_ideas"];
  answer_patterns: ReturnType<typeof answerPatterns>;
  topic_summary: TopicSummary;
  /** Deterministic answer review shown to the student (same builder as before v8). */
  answer_review_v2: unknown;
};

export function readStoredInterpretationV8(itemLevelEvidence: unknown): StoredInterpretationV8 | null {
  if (!itemLevelEvidence || typeof itemLevelEvidence !== "object" || Array.isArray(itemLevelEvidence)) return null;
  const value = itemLevelEvidence as Record<string, unknown>;
  return value.profile_schema === INTERPRETATION_V8_PROFILE_SCHEMA ? (value as unknown as StoredInterpretationV8) : null;
}

export function buildStoredInterpretationV8(input: {
  model_input: InterpretationInputV8;
  output: InterpretationOutputV8 | null;
  generation_mode: StoredInterpretationV8["generation_mode"];
  fallback_reason: string | null;
  response_package_id: string;
  answer_review_v2: unknown;
  attempt?: AttemptContext | null;
  chosen_option_tags?: Map<string, string | null>;
}): StoredInterpretationV8 {
  const ratings = new Map((input.output?.items ?? []).map((entry) => [entry.item_id, entry]));
  const items: StoredItemInterpretationV8[] = input.model_input.items.map((item) => {
    const rating = ratings.get(item.item_id) ?? null;
    const rapid = indicatorValue(item.process_indicators, "rapid_selection");
    return {
      item_id: item.item_id,
      position: item.position,
      selected_option: item.response.selected_option,
      answer_correct: item.response.answer_correct,
      reported_confidence: item.response.reported_confidence,
      explanation_quality: rating?.explanation_quality ?? null,
      no_usable_reason: rating?.no_usable_reason ?? null,
      adds_beyond_option_text: rating?.adds_beyond_option_text ?? null,
      evidence_quote: rating?.evidence_quote ?? null,
      evidence_source: rating?.evidence_source ?? null,
      reference_id: rating?.reference_id ?? null,
      missing_elements: rating?.missing_elements ?? null,
      rationale: rating?.rationale ?? null,
      error_source: rating?.error_source ?? null,
      side_remark: rating?.side_remark ?? null,
      uncertainty_note: rating?.uncertainty_note ?? null,
      status: rating
        ? itemStatus({
            answer_correct: item.response.answer_correct,
            skipped: item.response.skipped,
            explanation_quality: rating.explanation_quality,
            rapid_selection: typeof rapid === "boolean" ? rapid : null
          })
        : null,
      item_review_flag: rating?.error_source === "possible_item_issue"
    };
  });
  // A validated output rates every item, so every status is set when there is an output.
  const summaryItems = input.output
    ? items.flatMap((item) => (item.status ? [{ item_id: item.item_id, status: item.status, flagged_for_review: item.item_review_flag }] : []))
    : null;
  return {
    profile_schema: INTERPRETATION_V8_PROFILE_SCHEMA,
    prompt_version: INTERPRETATION_V8_PROMPT_VERSION,
    schema_version: INTERPRETATION_V8_SCHEMA_VERSION,
    rules_version: INTERPRETATION_RULES_VERSION,
    indicators_version: PROCESS_INDICATORS_VERSION,
    generation_mode: input.generation_mode,
    fallback_reason: input.fallback_reason,
    response_package_id: input.response_package_id,
    attempt: input.attempt ?? null,
    items,
    possible_misconceptions: input.output?.possible_misconceptions ?? [],
    considered_ideas: input.output?.considered_ideas ?? [],
    answer_patterns: answerPatterns(input.model_input.items.map((item) => ({
      item_id: item.item_id,
      answer_correct: item.response.answer_correct,
      chosen_option_tag: input.chosen_option_tags?.get(item.item_id) ?? null
    }))),
    topic_summary: topicSummary(summaryItems),
    answer_review_v2: input.answer_review_v2
  };
}

function legacyAbilityProfile(stored: StoredInterpretationV8) {
  // A withheld label ("Pending item review") is not carried into the legacy column.
  switch (stored.topic_summary.label) {
    case "Mostly understood":
      return "mostly_correct_understanding" as const;
    case "Still developing":
      return "partial_understanding" as const;
    case "Need more work":
      return stored.possible_misconceptions.length ? ("misconception_based_understanding" as const) : ("fragmented_or_limited_understanding" as const);
    default:
      return "insufficient_evidence" as const;
  }
}

function explanationSummary(stored: StoredInterpretationV8) {
  if (stored.generation_mode === "fallback") return "No interpretation was produced (fallback profile).";
  const count = (quality: string) => stored.items.filter((item) => item.explanation_quality === quality).length;
  return `Explanations: ${count("adequate")} adequate, ${count("limited")} limited, ${count("incorrect")} incorrect, ${count("no_usable_explanation")} with no usable explanation.`;
}

const NOT_PRODUCED = "Not produced by interpretation v8; see the item interpretations.";

/** Instructor-facing reason for a fallback profile. */
export function fallbackReasonText(reason: string | null) {
  if (reason === "validation_failed") return "The interpretation did not pass the application's checks after one regeneration.";
  if (reason && /^(provider_generation_not_allowed|operational_agent_mode_disabled|live_calls_disabled|interpretation_v8_not_approved|configuration_)/.test(reason)) {
    return `No model call was allowed (${reason}).`;
  }
  return `The model could not be reached (${reason ?? "unknown"}).`;
}

export function studentProfileDataV8(input: {
  concept_unit_session_db_id: string;
  based_on_agent_call_db_id: string | null;
  stored: StoredInterpretationV8;
}) {
  const fallback = input.stored.generation_mode === "fallback";
  return {
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    profile_type: "initial" as const,
    ability_profile: legacyAbilityProfile(input.stored),
    ability_pattern_flags: ["no_clear_pattern"],
    engagement_profile: "insufficient_process_evidence" as const,
    engagement_pattern_flags: ["no_clear_pattern"],
    integrated_diagnostic_profile: "insufficient_evidence_for_formative_decision" as const,
    integrated_profile_confidence: "low" as const,
    integrated_profile_rationale: NOT_PRODUCED,
    evidence_sufficiency: input.stored.topic_summary.label === "Unavailable / insufficient evidence"
      ? ("insufficient" as const)
      : input.stored.topic_summary.label === PENDING_ITEM_REVIEW_LABEL ? ("limited" as const) : ("adequate" as const),
    confidence_alignment: "insufficient_evidence" as const,
    independence_interpretability: "not_applicable" as const,
    // Empty canonical catalog: the conversation reads possible misconceptions from the v8
    // record, and an empty catalog marks the profile as conversation-compatible.
    misconception_indicators: toPrismaJson(emptyCanonicalMisconceptionClaimCatalog(
      `${input.concept_unit_session_db_id}:${input.stored.response_package_id}:interpretation-v8`
    )) as Prisma.InputJsonValue,
    item_level_evidence: toPrismaJson(input.stored) as Prisma.InputJsonValue,
    reasoning_quality_summary: explanationSummary(input.stored),
    engagement_summary: NOT_PRODUCED,
    process_interpretation_cautions: (fallback ? [FALLBACK_PROFILE_CAUTION] : []) as Prisma.InputJsonValue,
    profile_confidence: "low" as const,
    rationale: fallback ? `Fallback profile, no diagnostic claims. ${fallbackReasonText(input.stored.fallback_reason)}` : NOT_PRODUCED,
    recommended_next_evidence: [] as Prisma.InputJsonValue,
    based_on_agent_call_db_id: input.based_on_agent_call_db_id
  } satisfies Prisma.StudentProfileUncheckedCreateInput;
}
