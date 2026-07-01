import { z } from "zod";
import { prisma } from "@/lib/db";

export const ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION =
  "engagement-evidence-packet-v1" as const;
export const ENGAGEMENT_EVIDENCE_REVIEW_ARTIFACT_VERSION =
  "engagement-evidence-review-v1" as const;

export const ENGAGEMENT_RULE_CONFIG_V1 = {
  config_version: "engagement-rule-config-v1",
  threshold_policy: "provisional_v1_not_empirically_calibrated",
  answer_selection_rapid_ms: 3_000,
  reasoning_response_rapid_ms: 5_000,
  full_item_completion_rapid_ms: 25_000,
  initial_package_ultra_rapid_ms: 8_000,
  initial_package_extreme_rapid_ms: 15_000,
  initial_package_rapid_warning_ms: 30_000,
  package_reasoning_typing_very_low_ms: 8_000,
  package_reasoning_typing_low_ms: 15_000,
  item_reasoning_typing_rapid_ms: 3_000,
  minimal_reasoning_character_threshold: 20,
  minimal_reasoning_token_threshold: 4,
  substantive_reasoning_character_threshold: 90,
  repeated_invalid_response_threshold: 2,
  disengaged_min_convergent_signal_count: 2,
  disengaged_min_item_count: 2,
  likely_ai_min_convergent_signal_count: 2,
  long_focus_loss_ms: 10_000,
  long_inactivity_ms: 60_000
} as const;

const EventCountSchema = z.record(z.number().int().nonnegative());
const EvidenceConfidenceSchema = z.enum(["high", "medium", "low"]);
const EngagementCategorySchema = z.enum([
  "engaged",
  "moderately_engaged",
  "disengaged",
  "insufficient_evidence"
]);
const AiAssistanceSignalSchema = z.enum([
  "none_indicated",
  "likely_external_assistance_pattern",
  "insufficient_evidence"
]);
const ThresholdValueSchema = z.union([z.number(), z.string(), z.boolean()]);
const ThresholdUsageSchema = z.object({
  threshold_name: z.string(),
  threshold_value: ThresholdValueSchema,
  observed_value: ThresholdValueSchema.optional(),
  observed_band: z.string().optional()
}).strict();
const PackageTimingBandSchema = z.enum([
  "package_ultra_rapid",
  "package_extreme_rapid",
  "package_rapid_warning",
  "package_typical_or_long",
  "package_timing_unavailable"
]);
const PackageTimingSourceSchema = z.enum([
  "focus_adjusted_task",
  "sum_item_focus_adjusted",
  "response_production",
  "wall_clock_fallback",
  "unavailable"
]);
const ReasoningTypingBandSchema = z.enum([
  "reasoning_typing_very_low",
  "reasoning_typing_low",
  "reasoning_typing_typical_or_high",
  "reasoning_typing_unavailable"
]);
const ReasoningTypingBasisSchema = z.enum([
  "typing_activity_summary",
  "unavailable",
  "pasted_response_context",
  "not_applicable"
]);
const SubstantiveReasoningBasisSchema = z.enum([
  "length_and_task_relevance",
  "response_quality_adequate",
  "key_idea_present",
  "not_substantive_low_information",
  "unavailable"
]);
const TimingEventSourceSchema = z.enum([
  "process_events",
  "item_responses",
  "conversation_turns",
  "response_packages",
  "unknown"
]);
const TimingReconstructionEventSchema = z.object({
  event_type: z.string(),
  occurred_at: z.string().nullable(),
  source: TimingEventSourceSchema
}).strict();
const ItemTimingReconstructionSchema = z.object({
  item_public_id: z.string(),
  first_student_action_event_type: z.string(),
  item_completed_event_type: z.string(),
  active_duration_band: z.string(),
  active_duration_ms: z.number().int().nonnegative().nullable(),
  timing_limitations: z.array(z.string())
}).strict();
const ItemEngagementTimingSchema = z.object({
  item_public_id: z.string(),
  wall_clock_band: PackageTimingBandSchema,
  focus_adjusted_task_band: PackageTimingBandSchema,
  response_production_band: PackageTimingBandSchema,
  reasoning_typing_band: ReasoningTypingBandSchema,
  reasoning_typing_basis: ReasoningTypingBasisSchema,
  timing_limitations: z.array(z.string())
}).strict();
const TimingReconstructionSchema = z.object({
  first_item_presented_event: TimingReconstructionEventSchema,
  first_student_action_event: TimingReconstructionEventSchema,
  package_submitted_event: TimingReconstructionEventSchema,
  wall_clock_duration_ms: z.number().int().nonnegative().nullable(),
  active_response_duration_ms: z.number().int().nonnegative().nullable(),
  sum_item_active_duration_ms: z.number().int().nonnegative().nullable(),
  focus_adjusted_duration_ms: z.number().int().nonnegative().nullable(),
  focus_adjusted_task_duration_ms: z.number().int().nonnegative().nullable(),
  sum_item_focus_adjusted_duration_ms: z.number().int().nonnegative().nullable(),
  response_production_duration_ms: z.number().int().nonnegative().nullable(),
  package_reasoning_typing_duration_ms: z.number().int().nonnegative().nullable(),
  wall_clock_band: PackageTimingBandSchema,
  active_response_band: PackageTimingBandSchema,
  sum_item_active_band: PackageTimingBandSchema,
  focus_adjusted_band: PackageTimingBandSchema,
  focus_adjusted_task_band: PackageTimingBandSchema,
  sum_item_focus_adjusted_band: PackageTimingBandSchema,
  response_production_band: PackageTimingBandSchema,
  reasoning_typing_band: ReasoningTypingBandSchema,
  timing_source_used_for_rapid_rule: PackageTimingSourceSchema,
  timing_limitations: z.array(z.string()),
  item_active_timing_reconstruction: z.array(ItemTimingReconstructionSchema)
}).strict();
const DecisionRuleTraceSchema = z.object({
  rule_id: z.string(),
  rule_label: z.string(),
  matched: z.boolean(),
  signal_types: z.array(z.string()),
  thresholds_used: z.array(ThresholdUsageSchema),
  contribution: z.enum([
    "supports_engagement",
    "supports_moderate_engagement",
    "supports_disengagement",
    "supports_insufficient_evidence",
    "supports_ai_signal",
    "supports_no_ai_signal",
    "counterevidence"
  ]),
  confidence: EvidenceConfidenceSchema
}).strict();
const WhyNotCategorySchema = z.object({
  category: z.string(),
  reason_code: z.string()
}).strict();
const EngagementDecisionTraceSchema = z.object({
  engagement_category: EngagementCategorySchema,
  category_confidence: EvidenceConfidenceSchema,
  matched_rules: z.array(DecisionRuleTraceSchema),
  non_matched_rules: z.array(DecisionRuleTraceSchema),
  why_not_other_categories: z.array(WhyNotCategorySchema),
  limitations: z.array(z.string())
}).strict();
const SessionEngagementDecisionTraceSchema = z.object({
  engagement_category: EngagementCategorySchema,
  category_confidence: EvidenceConfidenceSchema,
  item_category_counts: z.record(z.number().int().nonnegative()),
  dominant_signal_counts: z.record(z.number().int().nonnegative()),
  package_duration_band: PackageTimingBandSchema,
  package_duration_thresholds_used: z.array(ThresholdUsageSchema),
  package_timing: z.object({
    wall_clock_band: PackageTimingBandSchema,
    active_response_band: PackageTimingBandSchema,
    sum_item_active_band: PackageTimingBandSchema,
    focus_adjusted_band: PackageTimingBandSchema,
    focus_adjusted_task_band: PackageTimingBandSchema,
    sum_item_focus_adjusted_band: PackageTimingBandSchema,
    response_production_band: PackageTimingBandSchema,
    reasoning_typing_band: ReasoningTypingBandSchema,
    timing_source_used_for_rapid_rule: PackageTimingSourceSchema,
    ultra_rapid_threshold_ms: z.number(),
    extreme_rapid_threshold_ms: z.number(),
    rapid_warning_threshold_ms: z.number(),
    reasoning_typing_very_low_threshold_ms: z.number(),
    reasoning_typing_low_threshold_ms: z.number(),
    item_reasoning_typing_rapid_threshold_ms: z.number(),
    package_ultra_rapid_rule_matched: z.boolean(),
    package_extreme_rapid_rule_matched: z.boolean(),
    package_rapid_warning_rule_matched: z.boolean(),
    reasoning_typing_very_low_rule_matched: z.boolean(),
    timing_limitations: z.array(z.string())
  }).strict(),
  timing_reconstruction: TimingReconstructionSchema,
  package_rapid_rule_matched: z.boolean(),
  sparse_item_count: z.number().int().nonnegative(),
  substantive_item_count: z.number().int().nonnegative(),
  substantive_reasoning_basis_counts: z.record(z.number().int().nonnegative()),
  baseline_completion_observed: z.boolean(),
  data_quality_events_observed: z.boolean(),
  completed_three_items_counterevidence_explanation: z.string(),
  meaningful_reasoning_counterevidence_explanation: z.string(),
  process_events_counterevidence_explanation: z.string(),
  matched_session_rules: z.array(DecisionRuleTraceSchema),
  non_matched_session_rules: z.array(DecisionRuleTraceSchema),
  why_not_other_categories: z.array(WhyNotCategorySchema),
  top_counterevidence: z.array(z.string()),
  limitations: z.array(z.string())
}).strict();
const AiAssistanceDecisionTraceSchema = z.object({
  ai_assistance_signal: AiAssistanceSignalSchema,
  confidence: EvidenceConfidenceSchema,
  matched_rules: z.array(DecisionRuleTraceSchema),
  non_matched_rules: z.array(DecisionRuleTraceSchema),
  why_not_likely_external_assistance_pattern: z.array(WhyNotCategorySchema),
  limitations: z.array(z.string())
}).strict();

const ItemEngagementEvidenceSchema = z.object({
  item_public_id: z.string(),
  response_present: z.boolean(),
  response_time_band: z.string(),
  reasoning_length_band: z.string(),
  revision_count: z.number().int().nonnegative(),
  repair_prompt_count: z.number().int().nonnegative(),
  option_change_count: z.number().int().nonnegative(),
  idk_or_insufficient_knowledge_marked: z.boolean(),
  paste_event_count: z.number().int().nonnegative(),
  focus_loss_count: z.number().int().nonnegative(),
  long_pause_count: z.number().int().nonnegative(),
  inactivity_count: z.number().int().nonnegative(),
  typing_summary_count: z.number().int().nonnegative(),
  rapid_response_pattern: z.boolean(),
  repeated_invalid_response_count: z.number().int().nonnegative(),
  substantive_reasoning_basis: SubstantiveReasoningBasisSchema,
  item_timing: ItemEngagementTimingSchema,
  engagement_signal: EngagementCategorySchema,
  ai_assistance_signal: AiAssistanceSignalSchema,
  possible_interpretation: z.string(),
  interpretation_source: z.literal("deterministic_v1"),
  evidence_confidence: EvidenceConfidenceSchema,
  interpretation_cautions: z.array(z.string()),
  signal_notes: z.array(z.string()),
  decision_trace: EngagementDecisionTraceSchema,
  ai_assistance_decision_trace: AiAssistanceDecisionTraceSchema
});

export const EngagementEvidencePacketV1Schema = z.object({
  schema_version: z.literal(ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION),
  generated_at: z.string(),
  session_public_id: z.string(),
  student_public_id: z.string(),
  assessment_public_id: z.string(),
  concept_unit_id: z.string(),
  source_response_package_refs: z.array(
    z.object({
      package_type: z.string(),
      created_at: z.string()
    })
  ),
  item_engagement_evidence: z.array(ItemEngagementEvidenceSchema),
  session_engagement_summary: z.object({
    provisional_engagement_category: EngagementCategorySchema,
    category_confidence: EvidenceConfidenceSchema,
    ai_assistance_signal: AiAssistanceSignalSchema,
    item_count: z.number().int().nonnegative(),
    engaged_item_count: z.number().int().nonnegative(),
    disengaged_item_count: z.number().int().nonnegative(),
    process_data_interpretation_policy: z.string(),
    limitations: z.array(z.string()),
    session_decision_trace: SessionEngagementDecisionTraceSchema,
    ai_assistance_decision_trace: AiAssistanceDecisionTraceSchema,
    threshold_policy: z.literal(ENGAGEMENT_RULE_CONFIG_V1.threshold_policy)
  }),
  engagement_rule_config: z.object({
    config_version: z.literal(ENGAGEMENT_RULE_CONFIG_V1.config_version),
    threshold_policy: z.literal(ENGAGEMENT_RULE_CONFIG_V1.threshold_policy),
    answer_selection_rapid_ms: z.number(),
    reasoning_response_rapid_ms: z.number(),
    full_item_completion_rapid_ms: z.number(),
    initial_package_ultra_rapid_ms: z.number(),
    initial_package_extreme_rapid_ms: z.number(),
    initial_package_rapid_warning_ms: z.number(),
    package_reasoning_typing_very_low_ms: z.number(),
    package_reasoning_typing_low_ms: z.number(),
    item_reasoning_typing_rapid_ms: z.number(),
    minimal_reasoning_character_threshold: z.number(),
    minimal_reasoning_token_threshold: z.number(),
    substantive_reasoning_character_threshold: z.number(),
    repeated_invalid_response_threshold: z.number(),
    disengaged_min_convergent_signal_count: z.number(),
    disengaged_min_item_count: z.number(),
    likely_ai_min_convergent_signal_count: z.number(),
    long_focus_loss_ms: z.number(),
    long_inactivity_ms: z.number()
  }).strict(),
  process_data_inventory: z.object({
    observed_event_counts: EventCountSchema,
    supported_event_types: z.array(z.string()),
    missing_or_unobserved_event_types: z.array(z.string()),
    instrumentation_limitations: z.array(z.string())
  }),
  safety_check: z.object({
    no_misconduct_label: z.literal(true),
    no_confirmed_ai_use_label: z.literal(true),
    no_raw_reasoning: z.literal(true),
    no_raw_process_payloads: z.literal(true),
    no_answer_keys: z.literal(true)
  })
});

export type EngagementEvidencePacketV1 = z.infer<typeof EngagementEvidencePacketV1Schema>;
export type ItemEngagementEvidenceV1 = z.infer<typeof ItemEngagementEvidenceSchema>;
type EngagementCategory = z.infer<typeof EngagementCategorySchema>;
type AiAssistanceSignal = z.infer<typeof AiAssistanceSignalSchema>;
type EvidenceConfidence = z.infer<typeof EvidenceConfidenceSchema>;
type DecisionRuleTrace = z.infer<typeof DecisionRuleTraceSchema>;
type WhyNotCategory = z.infer<typeof WhyNotCategorySchema>;
type TimingEventSource = z.infer<typeof TimingEventSourceSchema>;
type TimingReconstructionEvent = z.infer<typeof TimingReconstructionEventSchema>;
type ItemTimingReconstruction = z.infer<typeof ItemTimingReconstructionSchema>;
type ItemEngagementTiming = z.infer<typeof ItemEngagementTimingSchema>;
type TimingReconstruction = z.infer<typeof TimingReconstructionSchema>;

type ProcessEventSummary = {
  item_db_id: string | null;
  event_type: string;
  visibility_duration_ms: number | null;
  pause_duration_ms: number | null;
  payload: unknown;
  occurred_at: Date;
};

type PackageTimingInput = {
  wall_clock_duration_ms: number | null;
  active_response_duration_ms: number | null;
  sum_item_active_duration_ms: number | null;
  focus_adjusted_duration_ms: number | null;
  focus_adjusted_task_duration_ms: number | null;
  sum_item_focus_adjusted_duration_ms: number | null;
  response_production_duration_ms: number | null;
  package_reasoning_typing_duration_ms: number | null;
  timing_source_used_for_rapid_rule: z.infer<typeof PackageTimingSourceSchema>;
  rapid_rule_duration_ms: number | null;
  rapid_rule_timing_approximate: boolean;
  baseline_completion_observed: boolean;
  data_quality_events_observed: boolean;
  timing_limitations: string[];
  timing_reconstruction: TimingReconstruction;
  item_timing_by_public_id: Record<string, ItemEngagementTiming>;
};

type BuildItemEngagementEvidenceInput = {
  item_public_id: string;
  response_present: boolean;
  reasoning_text?: string | null;
  item_response_time_ms?: number | null;
  item_timing?: ItemEngagementTiming | null;
  revision_count?: number | null;
  selected_option?: string | null;
  event_counts: Record<string, number>;
  process_instrumentation_available: boolean;
};

export const ENGAGEMENT_PROCESS_EVENT_TYPES = [
  "page_visibility_hidden",
  "page_visibility_visible",
  "window_blur",
  "window_focus",
  "paste_detected",
  "typing_activity_summary",
  "long_pause",
  "inactivity_detected",
  "answer_changed",
  "reasoning_revised",
  "response_quality_rejected",
  "repeated_invalid_response",
  "missing_evidence_repair_prompted",
  "insufficient_knowledge_marked",
  "idk_selected"
] as const;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function lengthBand(length: number): string {
  if (length === 0) return "missing";
  if (length < 30) return "very_short";
  if (length < 90) return "short";
  if (length < 220) return "medium";
  return "long";
}

function timeBand(milliseconds?: number | null): string {
  if (!milliseconds || milliseconds <= 0) return "missing";
  if (milliseconds < 3_000) return "under_3_sec";
  if (milliseconds < 15_000) return "3_15_sec";
  if (milliseconds < 60_000) return "15_60_sec";
  if (milliseconds < 180_000) return "1_3_min";
  return "over_3_min";
}

function packageDurationBand(milliseconds?: number | null) {
  if (!milliseconds || milliseconds <= 0) return "package_timing_unavailable" as const;
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_ultra_rapid_ms) {
    return "package_ultra_rapid" as const;
  }
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_extreme_rapid_ms) {
    return "package_extreme_rapid" as const;
  }
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_rapid_warning_ms) {
    return "package_rapid_warning" as const;
  }
  return "package_typical_or_long" as const;
}

function packageReasoningTypingBand(milliseconds?: number | null) {
  if (!milliseconds || milliseconds <= 0) return "reasoning_typing_unavailable" as const;
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_very_low_ms) {
    return "reasoning_typing_very_low" as const;
  }
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_low_ms) {
    return "reasoning_typing_low" as const;
  }
  return "reasoning_typing_typical_or_high" as const;
}

function itemReasoningTypingBand(milliseconds?: number | null) {
  if (!milliseconds || milliseconds <= 0) return "reasoning_typing_unavailable" as const;
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.item_reasoning_typing_rapid_ms) {
    return "reasoning_typing_very_low" as const;
  }
  if (milliseconds <= ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_low_ms) {
    return "reasoning_typing_low" as const;
  }
  return "reasoning_typing_typical_or_high" as const;
}

function countByType(events: Array<{ event_type: string }>) {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    return counts;
  }, {});
}

function countKeys(counts: Record<string, number>, keys: string[]) {
  return keys.reduce((total, key) => total + (counts[key] ?? 0), 0);
}

function countEngagementEventSignals(events: ProcessEventSummary[]) {
  const counts = countByType(events);

  for (const event of events) {
    if (event.event_type !== "response_quality_checked") continue;

    const payload = record(event.payload);
    const responseQuality = stringValue(payload.response_quality);
    const messageClassification = stringValue(payload.message_classification);
    const reasoningSignal = stringValue(payload.reasoning_signal);

    if (
      responseQuality === "adequate" ||
      messageClassification === "usable_reasoning" ||
      messageClassification === "weak_but_usable_reasoning" ||
      reasoningSignal === "usable" ||
      reasoningSignal === "weak_but_usable"
    ) {
      counts.response_quality_adequate_or_usable =
        (counts.response_quality_adequate_or_usable ?? 0) + 1;
    }

    if (
      responseQuality === "low_information" ||
      responseQuality === "insufficient_knowledge" ||
      messageClassification === "insufficient_knowledge"
    ) {
      counts.response_quality_low_information = (counts.response_quality_low_information ?? 0) + 1;
    }

    if (
      responseQuality === "not_usable" ||
      responseQuality === "gibberish" ||
      responseQuality === "off_topic" ||
      messageClassification === "off_topic" ||
      messageClassification === "not_usable"
    ) {
      counts.response_quality_not_usable = (counts.response_quality_not_usable ?? 0) + 1;
    }
  }

  return counts;
}

function tokenCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function ruleTrace(input: {
  rule_id: string;
  rule_label: string;
  matched: boolean;
  signal_types: string[];
  thresholds_used?: Array<z.infer<typeof ThresholdUsageSchema>>;
  contribution: DecisionRuleTrace["contribution"];
  confidence?: EvidenceConfidence;
}): DecisionRuleTrace {
  return {
    rule_id: input.rule_id,
    rule_label: input.rule_label,
    matched: input.matched,
    signal_types: input.signal_types,
    thresholds_used: input.thresholds_used ?? [],
    contribution: input.contribution,
    confidence: input.confidence ?? "medium"
  };
}

function splitRuleTraces(rules: DecisionRuleTrace[]) {
  return {
    matched: rules.filter((rule) => rule.matched),
    nonMatched: rules.filter((rule) => !rule.matched)
  };
}

function normalizeReasoningForSignal(text?: string | null) {
  return (text ?? "").trim().toLowerCase();
}

function hasLowInformationReasoningPattern(reasoning: string) {
  const normalized = reasoning.trim().toLowerCase();
  if (!normalized) return true;

  const compact = normalized.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "");
  if (!compact) return true;

  if (/^(because|idk|ok|okay|guess|no idea|not sure|unsure|i don't know|i do not know)$/i.test(normalized)) {
    return true;
  }

  if (/\b(i do not know|i don't know|no idea|not sure|unsure)\b/i.test(normalized) && normalized.length < 90) {
    return true;
  }

  const repeatedCharacterMatch = compact.match(/^(.)\1{8,}$/u);
  if (repeatedCharacterMatch) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const uniqueTokens = new Set(tokens);
  if (tokens.length >= 12 && uniqueTokens.size <= 3) return true;

  if (/\b(banana|bananas|asdf|lorem ipsum|random words|nothing to do with this)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function hasTaskRelevanceSignal(reasoning: string) {
  return /\b(theta|ability|item|difficulty|parameter|irt|invariance|scale|latent|discrimination|person|student|calibrat|estimate|model|compare|comparable)\b/i.test(reasoning);
}

function aiAssistanceDecisionFor(input: {
  processInstrumentationAvailable: boolean;
  pasteEventCount: number;
  focusLossCount: number;
  longPauseCount: number;
  inactivityCount: number;
  typingSummaryCount: number;
  reasoningLengthBand: string;
  responseTimeBand: string;
}): {
  signal: AiAssistanceSignal;
  trace: z.infer<typeof AiAssistanceDecisionTraceSchema>;
  convergentSignalCount: number;
} {
  if (!input.processInstrumentationAvailable) {
    const unavailableRule = ruleTrace({
      rule_id: "process_instrumentation_missing",
      rule_label: "Process instrumentation missing",
      matched: true,
      signal_types: ["process_instrumentation"],
      contribution: "supports_insufficient_evidence",
      confidence: "low"
    });
    return {
      signal: "insufficient_evidence",
      convergentSignalCount: 0,
      trace: {
        ai_assistance_signal: "insufficient_evidence",
        confidence: "low",
        matched_rules: [unavailableRule],
        non_matched_rules: [],
        why_not_likely_external_assistance_pattern: [
          { category: "likely_external_assistance_pattern", reason_code: "process_instrumentation_missing" }
        ],
        limitations: [
          "none_indicated_is_not_proof_of_no_ai_use",
          "ai_assistance_signal_should_be_compared_with_self_report"
        ]
      }
    };
  }

  const hasPaste = input.pasteEventCount > 0;
  const hasFocusLoss = input.focusLossCount > 0;
  const hasPauseOrInactivity = input.longPauseCount > 0 || input.inactivityCount > 0;
  const hasTypingMismatch =
    input.typingSummaryCount === 0 &&
    (input.reasoningLengthBand === "medium" || input.reasoningLengthBand === "long");
  const hasRapidNonmissing = input.responseTimeBand === "under_3_sec" && input.reasoningLengthBand !== "missing";
  const signalCount = [
    hasPaste,
    hasFocusLoss,
    hasPauseOrInactivity,
    hasTypingMismatch,
    hasRapidNonmissing
  ].filter(Boolean).length;
  const likelyMatched =
    signalCount >= ENGAGEMENT_RULE_CONFIG_V1.likely_ai_min_convergent_signal_count &&
    (hasPaste || hasFocusLoss);
  const singleWeakSignal = signalCount === 1 && (hasPaste || hasFocusLoss);
  const rules = [
    ruleTrace({
      rule_id: "convergent_paste_focus_context",
      rule_label: "Convergent paste/focus context",
      matched: likelyMatched,
      signal_types: ["paste_event_count", "focus_loss_count", "pause_or_inactivity", "typing_summary"],
      thresholds_used: [
        {
          threshold_name: "likely_ai_min_convergent_signal_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.likely_ai_min_convergent_signal_count,
          observed_value: signalCount
        }
      ],
      contribution: "supports_ai_signal",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "single_paste_or_focus_signal",
      rule_label: "Single paste or focus signal only",
      matched: singleWeakSignal,
      signal_types: ["paste_event_count", "focus_loss_count"],
      thresholds_used: [
        {
          threshold_name: "likely_ai_min_convergent_signal_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.likely_ai_min_convergent_signal_count,
          observed_value: signalCount
        }
      ],
      contribution: "supports_insufficient_evidence",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "no_convergent_focus_paste_typing_pattern",
      rule_label: "No convergent focus, paste, or typing pattern",
      matched: signalCount === 0,
      signal_types: ["paste_event_count", "focus_loss_count", "typing_summary"],
      thresholds_used: [
        {
          threshold_name: "likely_ai_min_convergent_signal_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.likely_ai_min_convergent_signal_count,
          observed_value: signalCount
        }
      ],
      contribution: "supports_no_ai_signal",
      confidence: "medium"
    })
  ];
  const split = splitRuleTraces(rules);
  const signal: AiAssistanceSignal = likelyMatched
    ? "likely_external_assistance_pattern"
    : singleWeakSignal
      ? "insufficient_evidence"
      : "none_indicated";

  return {
    signal,
    convergentSignalCount: signalCount,
    trace: {
      ai_assistance_signal: signal,
      confidence: likelyMatched ? "medium" : singleWeakSignal ? "low" : "medium",
      matched_rules: split.matched,
      non_matched_rules: split.nonMatched,
      why_not_likely_external_assistance_pattern: likelyMatched
        ? []
        : [
            {
              category: "likely_external_assistance_pattern",
              reason_code: singleWeakSignal
                ? "single_weak_signal_is_not_enough"
                : "no_convergent_focus_paste_typing_pattern"
            }
          ],
      limitations: [
        "none_indicated_is_not_proof_of_no_ai_use",
        "ai_assistance_signal_should_be_compared_with_self_report"
      ]
    }
  };
}

function possibleInterpretationFor(input: {
  responsePresent: boolean;
  engagementSignal: z.infer<typeof EngagementCategorySchema>;
  aiAssistanceSignal: z.infer<typeof AiAssistanceSignalSchema>;
  reasoningLengthBand: string;
  revisionCount: number;
  repairPromptCount: number;
  pasteEventCount: number;
  focusLossCount: number;
  longPauseCount: number;
  inactivityCount: number;
  idkMarked: boolean;
}) {
  if (!input.responsePresent) {
    return "No completed response was available, so participation evidence is insufficient for this item.";
  }

  if (input.aiAssistanceSignal === "likely_external_assistance_pattern") {
    return "Multiple contextual process signals occurred together; this behavioral pattern should be compared with any student self-report before interpretation.";
  }

  if (input.pasteEventCount > 0 || input.focusLossCount > 0) {
    return "One contextual process signal was observed, but a single weak signal is not enough for a stronger interpretation.";
  }

  if (input.engagementSignal === "engaged") {
    return input.revisionCount > 0
      ? "The response includes meaningful text and revision activity, suggesting active participation evidence for this item."
      : "The response includes meaningful text, suggesting active participation evidence for this item.";
  }

  if (input.engagementSignal === "disengaged") {
    return "Multiple weak participation signals occurred together, so the item-level engagement evidence is low.";
  }

  if (input.idkMarked) {
    return "The student marked uncertainty while still providing usable participation evidence.";
  }

  if (input.longPauseCount > 0 || input.inactivityCount > 0) {
    return "Pause or inactivity context was observed, so the participation evidence should be interpreted cautiously.";
  }

  if (input.repairPromptCount > 0) {
    return "The response needed repair prompting, so participation evidence is present but limited.";
  }

  return "Participation evidence is present but does not support a stronger item-level engagement interpretation.";
}

export function buildItemEngagementEvidence(
  input: BuildItemEngagementEvidenceInput
): ItemEngagementEvidenceV1 {
  const eventCounts = input.event_counts;
  const itemTiming: ItemEngagementTiming =
    input.item_timing ??
    {
      item_public_id: input.item_public_id,
      wall_clock_band: packageDurationBand(input.item_response_time_ms),
      focus_adjusted_task_band: "package_timing_unavailable",
      response_production_band: packageDurationBand(input.item_response_time_ms),
      reasoning_typing_band:
        countKeys(eventCounts, ["typing_activity_summary"]) > 0
          ? "reasoning_typing_typical_or_high"
          : "reasoning_typing_unavailable",
      reasoning_typing_basis:
        countKeys(eventCounts, ["typing_activity_summary"]) > 0
          ? "typing_activity_summary"
          : "unavailable",
      timing_limitations:
        countKeys(eventCounts, ["typing_activity_summary"]) > 0
          ? ["item_focus_adjusted_timing_unavailable"]
          : ["item_focus_adjusted_timing_unavailable", "reasoning_typing_timing_unavailable"]
    };
  const reasoning = normalizeReasoningForSignal(input.reasoning_text);
  const reasoningLengthBand = lengthBand(reasoning.length);
  const responseTimeBand = timeBand(input.item_response_time_ms);
  const revisionCount = Math.max(0, input.revision_count ?? 0);
  const repairPromptCount = countKeys(eventCounts, [
    "missing_evidence_repair_prompted",
    "response_quality_rejected"
  ]);
  const optionChangeCount = countKeys(eventCounts, ["answer_changed", "reasoning_revised"]);
  const pasteEventCount = countKeys(eventCounts, ["paste_detected"]);
  const focusLossCount = countKeys(eventCounts, ["page_visibility_hidden", "page_hidden", "window_blur"]);
  const longPauseCount = countKeys(eventCounts, ["long_pause"]);
  const inactivityCount = countKeys(eventCounts, ["inactivity_detected"]);
  const typingSummaryCount = countKeys(eventCounts, ["typing_activity_summary"]);
  const repeatedInvalidResponseCount = countKeys(eventCounts, [
    "repeated_invalid_response",
    "response_quality_rejected"
  ]);
  const idkMarked =
    input.selected_option === "E" ||
    /\b(i do not know|i don't know|not sure|unsure|no idea)\b/i.test(input.reasoning_text ?? "") ||
    countKeys(eventCounts, ["idk_selected", "insufficient_knowledge_marked"]) > 0;
  const reasoningCharacterCount = reasoning.length;
  const reasoningTokenCount = tokenCount(reasoning);
  const lowInformationReasoning = hasLowInformationReasoningPattern(reasoning);
  const taskRelevantReasoning = hasTaskRelevanceSignal(reasoning);
  const responseQualityAdequateOrUsable =
    countKeys(eventCounts, ["response_quality_adequate_or_usable"]) > 0;
  const responseQualityLowInformation =
    countKeys(eventCounts, ["response_quality_low_information", "response_quality_not_usable"]) > 0;
  const rapidResponsePattern =
    Boolean(input.response_present) &&
    typeof input.item_response_time_ms === "number" &&
    input.item_response_time_ms > 0 &&
    input.item_response_time_ms < ENGAGEMENT_RULE_CONFIG_V1.full_item_completion_rapid_ms;
  const interpretationCautions = [
    "ai_assistance_signal_is_behavioral_not_misconduct",
    "ai_assistance_signal_should_be_compared_with_self_report",
    "single_weak_signal_is_not_enough",
    "process_data_are_ambiguous"
  ];
  const signalNotes: string[] = [];

  if (!input.process_instrumentation_available) {
    signalNotes.push("minimal_frontend_process_instrumentation_observed");
  }
  if (pasteEventCount > 0) signalNotes.push("paste_event_observed_without_clipboard_content");
  if (focusLossCount > 0) signalNotes.push("focus_or_visibility_change_observed");
  if (longPauseCount > 0 || inactivityCount > 0) signalNotes.push("pause_or_inactivity_observed");
  if (revisionCount > 0 || optionChangeCount > 0) signalNotes.push("revision_or_change_observed");
  if (idkMarked) signalNotes.push("student_marked_uncertainty_or_insufficient_knowledge");

  const sparseReasoning = reasoningLengthBand === "missing" || reasoningLengthBand === "very_short";
  const minimalReasoningPattern =
    sparseReasoning ||
    lowInformationReasoning ||
    responseQualityLowInformation ||
    reasoningCharacterCount < ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_character_threshold ||
    reasoningTokenCount < ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_token_threshold;
  const veryLowReasoningTypingMinimalPattern =
    itemTiming.reasoning_typing_band === "reasoning_typing_very_low" && minimalReasoningPattern;
  const substantiveReasoningBasis: z.infer<typeof SubstantiveReasoningBasisSchema> =
    !input.response_present || reasoningCharacterCount === 0
      ? "unavailable"
      : responseQualityAdequateOrUsable && !lowInformationReasoning && !responseQualityLowInformation
        ? "response_quality_adequate"
        : taskRelevantReasoning &&
            reasoningCharacterCount >= ENGAGEMENT_RULE_CONFIG_V1.substantive_reasoning_character_threshold &&
            !lowInformationReasoning &&
            !responseQualityLowInformation
          ? "length_and_task_relevance"
          : taskRelevantReasoning &&
              reasoningCharacterCount >= ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_character_threshold &&
              !lowInformationReasoning &&
              !responseQualityLowInformation
            ? "key_idea_present"
            : "not_substantive_low_information";
  const substantiveReasoningPattern = [
    "length_and_task_relevance",
    "response_quality_adequate",
    "key_idea_present"
  ].includes(substantiveReasoningBasis);
  const rapidMinimalReasoningPattern = rapidResponsePattern && minimalReasoningPattern;
  const repeatedInvalidPattern =
    countKeys(eventCounts, ["repeated_invalid_response"]) > 0 ||
    countKeys(eventCounts, ["response_quality_rejected"]) >=
      ENGAGEMENT_RULE_CONFIG_V1.repeated_invalid_response_threshold;
  const weakEngagementSignalCount = [
    rapidMinimalReasoningPattern,
    veryLowReasoningTypingMinimalPattern,
    repeatedInvalidPattern,
    repairPromptCount >= 2,
    !input.process_instrumentation_available && sparseReasoning
  ].filter(Boolean).length;
  const engagementSignal: EngagementCategory = !input.response_present
    ? "insufficient_evidence"
    : weakEngagementSignalCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_convergent_signal_count
      ? "disengaged"
      : idkMarked && sparseReasoning
        ? "moderately_engaged"
        : substantiveReasoningPattern || revisionCount > 0
          ? "engaged"
          : "moderately_engaged";

  const aiAssistanceDecision = aiAssistanceDecisionFor({
    processInstrumentationAvailable: input.process_instrumentation_available,
    pasteEventCount,
    focusLossCount,
    longPauseCount,
    inactivityCount,
    typingSummaryCount,
    reasoningLengthBand,
    responseTimeBand
  });
  const aiAssistanceSignal = aiAssistanceDecision.signal;

  const evidenceConfidence: EvidenceConfidence = !input.process_instrumentation_available
    ? "low"
    : typingSummaryCount > 0 || focusLossCount > 0 || pasteEventCount > 0
      ? "medium"
      : "low";
  const possibleInterpretation = possibleInterpretationFor({
    responsePresent: input.response_present,
    engagementSignal,
    aiAssistanceSignal,
    reasoningLengthBand,
    revisionCount,
    repairPromptCount,
    pasteEventCount,
    focusLossCount,
    longPauseCount,
    inactivityCount,
    idkMarked
  });
  const itemRules = [
    ruleTrace({
      rule_id: "response_missing",
      rule_label: "No completed item response",
      matched: !input.response_present,
      signal_types: ["response_presence"],
      contribution: "supports_insufficient_evidence",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "completed_response_present",
      rule_label: "Completed item response present",
      matched: Boolean(input.response_present),
      signal_types: ["response_presence"],
      contribution: "supports_moderate_engagement",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "rapid_minimal_reasoning_combo",
      rule_label: "Rapid response combined with minimal reasoning",
      matched: rapidMinimalReasoningPattern,
      signal_types: ["full_item_package_completion_time", "reasoning_length_band"],
      thresholds_used: [
        {
          threshold_name: "full_item_completion_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.full_item_completion_rapid_ms,
          observed_value: input.item_response_time_ms ?? "missing",
          observed_band: responseTimeBand
        },
        {
          threshold_name: "minimal_reasoning_character_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_character_threshold,
          observed_value: reasoningCharacterCount,
          observed_band: reasoningLengthBand
        },
        {
          threshold_name: "minimal_reasoning_token_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_token_threshold,
          observed_value: reasoningTokenCount,
          observed_band: reasoningLengthBand
        }
      ],
      contribution: "supports_disengagement",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "minimal_reasoning_only",
      rule_label: "Minimal reasoning without other convergent signals",
      matched: minimalReasoningPattern && !rapidMinimalReasoningPattern && !repeatedInvalidPattern,
      signal_types: ["reasoning_length_band"],
      thresholds_used: [
        {
          threshold_name: "minimal_reasoning_character_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_character_threshold,
          observed_value: reasoningCharacterCount,
          observed_band: reasoningLengthBand
        },
        {
          threshold_name: "minimal_reasoning_token_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_token_threshold,
          observed_value: reasoningTokenCount,
          observed_band: reasoningLengthBand
        }
      ],
      contribution: idkMarked ? "supports_moderate_engagement" : "supports_moderate_engagement",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "very_low_item_reasoning_typing_sparse",
      rule_label: "Very low reasoning typing time with sparse reasoning",
      matched: veryLowReasoningTypingMinimalPattern,
      signal_types: ["reasoning_typing_duration", "reasoning_length_band"],
      thresholds_used: [
        {
          threshold_name: "item_reasoning_typing_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.item_reasoning_typing_rapid_ms,
          observed_value: itemTiming.reasoning_typing_band,
          observed_band: itemTiming.reasoning_typing_band
        },
        {
          threshold_name: "minimal_reasoning_character_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_character_threshold,
          observed_value: reasoningCharacterCount,
          observed_band: reasoningLengthBand
        }
      ],
      contribution: "supports_disengagement",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "repeated_invalid_or_unusable_response",
      rule_label: "Repeated unusable response pattern",
      matched: repeatedInvalidPattern,
      signal_types: ["response_quality_rejected", "repeated_invalid_response"],
      thresholds_used: [
        {
          threshold_name: "repeated_invalid_response_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.repeated_invalid_response_threshold,
          observed_value: repeatedInvalidResponseCount
        }
      ],
      contribution: "supports_disengagement",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "meaningful_reasoning_or_revision",
      rule_label: "Meaningful reasoning or revision evidence",
      matched: substantiveReasoningPattern || revisionCount > 0,
      signal_types: ["reasoning_length_band", "substantive_reasoning_basis", "revision_count"],
      thresholds_used: [
        {
          threshold_name: "substantive_reasoning_character_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.substantive_reasoning_character_threshold,
          observed_value: reasoningCharacterCount,
          observed_band: reasoningLengthBand
        },
        {
          threshold_name: "substantive_reasoning_basis",
          threshold_value: "length_and_task_relevance_or_response_quality_or_key_idea",
          observed_value: substantiveReasoningBasis
        }
      ],
      contribution: "supports_engagement",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "uncertainty_marker_present",
      rule_label: "Uncertainty or insufficient-knowledge marker",
      matched: idkMarked,
      signal_types: ["selected_option", "reasoning_length_band", "idk_event"],
      contribution: "supports_moderate_engagement",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "instrumentation_missing_sparse_response",
      rule_label: "Sparse response with missing process instrumentation",
      matched: !input.process_instrumentation_available && sparseReasoning,
      signal_types: ["process_instrumentation", "reasoning_length_band"],
      contribution: "supports_insufficient_evidence",
      confidence: "low"
    })
  ];
  const itemRuleSplit = splitRuleTraces(itemRules);
  const whyNotOtherCategories: WhyNotCategory[] =
    engagementSignal === "disengaged"
      ? [
          { category: "engaged", reason_code: "convergent_low_participation_signals" },
          { category: "moderately_engaged", reason_code: "disengagement_signals_converged_for_item" }
        ]
      : engagementSignal === "engaged"
        ? [
            { category: "disengaged", reason_code: "meaningful_response_or_revision_evidence_present" },
            { category: "insufficient_evidence", reason_code: "completed_response_available" }
          ]
        : engagementSignal === "insufficient_evidence"
          ? [
              { category: "engaged", reason_code: "missing_completed_response_or_instrumentation" },
              { category: "disengaged", reason_code: "insufficient_convergent_disengagement_signals" }
            ]
          : [
              { category: "engaged", reason_code: "meaningful_response_evidence_limited" },
              { category: "disengaged", reason_code: "single_or_ambiguous_signal_not_enough" }
            ];

  return ItemEngagementEvidenceSchema.parse({
    item_public_id: input.item_public_id,
    response_present: input.response_present,
    response_time_band: responseTimeBand,
    reasoning_length_band: reasoningLengthBand,
    revision_count: revisionCount,
    repair_prompt_count: repairPromptCount,
    option_change_count: optionChangeCount,
    idk_or_insufficient_knowledge_marked: idkMarked,
    paste_event_count: pasteEventCount,
    focus_loss_count: focusLossCount,
    long_pause_count: longPauseCount,
    inactivity_count: inactivityCount,
    typing_summary_count: typingSummaryCount,
    rapid_response_pattern: rapidResponsePattern,
    repeated_invalid_response_count: repeatedInvalidResponseCount,
    substantive_reasoning_basis: substantiveReasoningBasis,
    item_timing: itemTiming,
    engagement_signal: engagementSignal,
    ai_assistance_signal: aiAssistanceSignal,
    possible_interpretation: possibleInterpretation,
    interpretation_source: "deterministic_v1",
    evidence_confidence: evidenceConfidence,
    interpretation_cautions: interpretationCautions,
    signal_notes: signalNotes,
    decision_trace: {
      engagement_category: engagementSignal,
      category_confidence: evidenceConfidence,
      matched_rules: itemRuleSplit.matched,
      non_matched_rules: itemRuleSplit.nonMatched,
      why_not_other_categories: whyNotOtherCategories,
      limitations: [
        "thresholds_are_provisional_not_empirically_calibrated",
        "single_weak_signal_is_not_enough"
      ]
    },
    ai_assistance_decision_trace: aiAssistanceDecision.trace
  });
}

function itemRuleMatched(item: ItemEngagementEvidenceV1, ruleId: string) {
  return item.decision_trace.matched_rules.some((rule) => rule.rule_id === ruleId);
}

function itemHasSubstantiveReasoning(item: ItemEngagementEvidenceV1) {
  return [
    "length_and_task_relevance",
    "response_quality_adequate",
    "key_idea_present"
  ].includes(item.substantive_reasoning_basis);
}

function itemHasSparseOrLowInformationEvidence(item: ItemEngagementEvidenceV1) {
  const sparseReasoning =
    item.reasoning_length_band === "missing" ||
    item.reasoning_length_band === "very_short" ||
    item.reasoning_length_band === "short";
  const uncertaintyWithoutElaboration =
    item.idk_or_insufficient_knowledge_marked && !itemHasSubstantiveReasoning(item);

  return (
    itemRuleMatched(item, "rapid_minimal_reasoning_combo") ||
    itemRuleMatched(item, "minimal_reasoning_only") ||
    itemRuleMatched(item, "repeated_invalid_or_unusable_response") ||
    item.substantive_reasoning_basis === "not_substantive_low_information" ||
    item.repair_prompt_count > 0 ||
    uncertaintyWithoutElaboration ||
    (sparseReasoning && !itemHasSubstantiveReasoning(item))
  );
}

function defaultPackageTimingInput(items: ItemEngagementEvidenceV1[]): PackageTimingInput {
  const timingLimitations = ["active_package_timing_unavailable"];

  return {
    wall_clock_duration_ms: null,
    active_response_duration_ms: null,
    sum_item_active_duration_ms: null,
    focus_adjusted_duration_ms: null,
    focus_adjusted_task_duration_ms: null,
    sum_item_focus_adjusted_duration_ms: null,
    response_production_duration_ms: null,
    package_reasoning_typing_duration_ms: null,
    timing_source_used_for_rapid_rule: "unavailable",
    rapid_rule_duration_ms: null,
    rapid_rule_timing_approximate: true,
    baseline_completion_observed: items.length >= 3 && items.every((item) => item.response_present),
    data_quality_events_observed: items.some(
      (item) =>
        item.typing_summary_count > 0 ||
        item.paste_event_count > 0 ||
        item.focus_loss_count > 0 ||
        item.long_pause_count > 0 ||
        item.inactivity_count > 0 ||
        item.repair_prompt_count > 0 ||
        item.option_change_count > 0 ||
        item.repeated_invalid_response_count > 0
    ),
    timing_limitations: timingLimitations,
    item_timing_by_public_id: Object.fromEntries(
      items.map((item) => [
        item.item_public_id,
        {
          item_public_id: item.item_public_id,
          wall_clock_band: "package_timing_unavailable",
          focus_adjusted_task_band: "package_timing_unavailable",
          response_production_band: "package_timing_unavailable",
          reasoning_typing_band: "reasoning_typing_unavailable",
          reasoning_typing_basis: "unavailable",
          timing_limitations: ["item_active_timing_unavailable", "reasoning_typing_timing_unavailable"]
        } satisfies ItemEngagementTiming
      ])
    ),
    timing_reconstruction: {
      first_item_presented_event: safeTimingEvent(null),
      first_student_action_event: safeTimingEvent(null),
      package_submitted_event: safeTimingEvent(null),
      wall_clock_duration_ms: null,
      active_response_duration_ms: null,
      sum_item_active_duration_ms: null,
      focus_adjusted_duration_ms: null,
      focus_adjusted_task_duration_ms: null,
      sum_item_focus_adjusted_duration_ms: null,
      response_production_duration_ms: null,
      package_reasoning_typing_duration_ms: null,
      wall_clock_band: "package_timing_unavailable",
      active_response_band: "package_timing_unavailable",
      sum_item_active_band: "package_timing_unavailable",
      focus_adjusted_band: "package_timing_unavailable",
      focus_adjusted_task_band: "package_timing_unavailable",
      sum_item_focus_adjusted_band: "package_timing_unavailable",
      response_production_band: "package_timing_unavailable",
      reasoning_typing_band: "reasoning_typing_unavailable",
      timing_source_used_for_rapid_rule: "unavailable",
      timing_limitations: timingLimitations,
      item_active_timing_reconstruction: items.map((item) => unknownItemTiming(item.item_public_id))
    }
  };
}

export function summarizeSessionEngagement(
  items: ItemEngagementEvidenceV1[],
  packageTiming: PackageTimingInput = defaultPackageTimingInput(items)
): EngagementEvidencePacketV1["session_engagement_summary"] {
  const engagedCount = items.filter((item) => item.engagement_signal === "engaged").length;
  const moderatelyEngagedCount = items.filter((item) => item.engagement_signal === "moderately_engaged").length;
  const disengagedCount = items.filter((item) => item.engagement_signal === "disengaged").length;
  const insufficientProcessCount = items.filter(
    (item) => item.engagement_signal === "insufficient_evidence"
  ).length;
  const rapidMinimalItemCount = items.filter((item) =>
    item.decision_trace.matched_rules.some((rule) => rule.rule_id === "rapid_minimal_reasoning_combo")
  ).length;
  const sparseItemCount = items.filter(itemHasSparseOrLowInformationEvidence).length;
  const substantiveItemCount = items.filter(itemHasSubstantiveReasoning).length;
  const substantiveReasoningBasisCounts = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.substantive_reasoning_basis] = (counts[item.substantive_reasoning_basis] ?? 0) + 1;
    return counts;
  }, {});
  const wallClockBand = packageDurationBand(packageTiming.wall_clock_duration_ms);
  const activeResponseBand = packageDurationBand(packageTiming.active_response_duration_ms);
  const sumItemActiveBand = packageDurationBand(packageTiming.sum_item_active_duration_ms);
  const focusAdjustedBand = packageDurationBand(packageTiming.focus_adjusted_duration_ms);
  const focusAdjustedTaskBand = packageDurationBand(packageTiming.focus_adjusted_task_duration_ms);
  const sumItemFocusAdjustedBand = packageDurationBand(packageTiming.sum_item_focus_adjusted_duration_ms);
  const responseProductionBand = packageDurationBand(packageTiming.response_production_duration_ms);
  const reasoningTypingBand = packageReasoningTypingBand(packageTiming.package_reasoning_typing_duration_ms);
  const packageBand = packageDurationBand(packageTiming.rapid_rule_duration_ms);
  const rapidRuleDuration = packageTiming.rapid_rule_duration_ms;
  const hasInitialPackage = items.length >= 3;
  const hasRepeatedSparseEvidence =
    sparseItemCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count;
  const hasStrongSubstantiveCounterevidence = substantiveItemCount >= 2;
  const hasWeakOrNoSubstantiveCounterevidence = substantiveItemCount <= 1;
  const reliableActiveTiming =
    ["focus_adjusted_task", "sum_item_focus_adjusted", "response_production"].includes(
      packageTiming.timing_source_used_for_rapid_rule
    ) && !packageTiming.rapid_rule_timing_approximate;
  const rapidReasoningTypingItemCount = items.filter(
    (item) => item.item_timing.reasoning_typing_band === "reasoning_typing_very_low"
  ).length;
  const veryLowReasoningTypingRuleMatched =
    hasInitialPackage &&
    hasRepeatedSparseEvidence &&
    (reasoningTypingBand === "reasoning_typing_very_low" ||
      rapidReasoningTypingItemCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count);
  const packageUltraRapidRuleMatched =
    hasInitialPackage &&
    hasRepeatedSparseEvidence &&
    !hasStrongSubstantiveCounterevidence &&
    rapidRuleDuration !== null &&
    rapidRuleDuration <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_ultra_rapid_ms;
  const packageExtremeRapidRuleMatched =
    hasInitialPackage &&
    hasRepeatedSparseEvidence &&
    !hasStrongSubstantiveCounterevidence &&
    rapidRuleDuration !== null &&
    rapidRuleDuration <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_extreme_rapid_ms;
  const packageRapidWarningRuleMatched =
    hasInitialPackage &&
    hasWeakOrNoSubstantiveCounterevidence &&
    rapidRuleDuration !== null &&
    rapidRuleDuration <= ENGAGEMENT_RULE_CONFIG_V1.initial_package_rapid_warning_ms &&
    (hasRepeatedSparseEvidence || rapidMinimalItemCount + disengagedCount >= 2);
  const rapidWarningConvergesForDisengagement =
    packageRapidWarningRuleMatched &&
    !packageExtremeRapidRuleMatched &&
    hasRepeatedSparseEvidence &&
    (substantiveItemCount === 0 ||
      disengagedCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count ||
      veryLowReasoningTypingRuleMatched);
  const category: EngagementCategory = items.length === 0
    ? "insufficient_evidence"
    : insufficientProcessCount === items.length
      ? "insufficient_evidence"
      : packageUltraRapidRuleMatched ||
          packageExtremeRapidRuleMatched ||
          rapidWarningConvergesForDisengagement ||
          disengagedCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count ||
          rapidMinimalItemCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count
        ? "disengaged"
        : engagedCount >= Math.max(1, Math.ceil(items.length / 2))
          ? "engaged"
          : "moderately_engaged";
  const aiSignal: AiAssistanceSignal = items.length === 0
    ? "insufficient_evidence"
    : items.some((item) => item.ai_assistance_signal === "likely_external_assistance_pattern")
      ? "likely_external_assistance_pattern"
      : items.some((item) => item.ai_assistance_signal === "insufficient_evidence")
        ? "insufficient_evidence"
        : "none_indicated";
  const limitations = new Set<string>();

  if (items.some((item) => item.evidence_confidence === "low")) {
    limitations.add("engagement_evidence_confidence_low_for_some_items");
  }
  limitations.add("ai_assistance_signal_is_behavioral_not_misconduct");
  limitations.add("ai_assistance_signal_should_be_compared_with_self_report");
  limitations.add("single_weak_signal_is_not_enough");
  limitations.add("process_data_are_ambiguous");
  limitations.add("process_data_must_not_be_used_as_direct_ability_evidence");
  limitations.add("thresholds_are_provisional_not_empirically_calibrated");
  for (const limitation of packageTiming.timing_limitations) {
    limitations.add(limitation);
  }

  const categoryConfidence: EvidenceConfidence =
    packageUltraRapidRuleMatched || packageExtremeRapidRuleMatched
    ? reliableActiveTiming && sparseItemCount >= 2 && substantiveItemCount === 0
      ? "high"
      : "medium"
    : items.some((item) => item.evidence_confidence === "medium")
      ? "medium"
      : "low";
  const dominantSignalCounts = items.reduce<Record<string, number>>((counts, item) => {
    for (const rule of item.decision_trace.matched_rules) {
      if (rule.rule_id === "rapid_minimal_reasoning_combo") {
        counts.rapid_response_pattern = (counts.rapid_response_pattern ?? 0) + 1;
        counts.minimal_reasoning_pattern = (counts.minimal_reasoning_pattern ?? 0) + 1;
      }
      if (rule.rule_id === "minimal_reasoning_only") {
        counts.minimal_reasoning_pattern = (counts.minimal_reasoning_pattern ?? 0) + 1;
      }
      if (rule.rule_id === "very_low_item_reasoning_typing_sparse") {
        counts.very_low_reasoning_typing_sparse =
          (counts.very_low_reasoning_typing_sparse ?? 0) + 1;
      }
      if (rule.rule_id === "repeated_invalid_or_unusable_response") {
        counts.repeated_invalid_response = (counts.repeated_invalid_response ?? 0) + 1;
      }
      if (rule.rule_id === "meaningful_reasoning_or_revision") {
        counts.meaningful_reasoning_or_revision = (counts.meaningful_reasoning_or_revision ?? 0) + 1;
      }
      if (rule.rule_id === "uncertainty_marker_present") {
        counts.uncertainty_marker = (counts.uncertainty_marker ?? 0) + 1;
      }
    }
    if (item.response_present) {
      counts.completed_response = (counts.completed_response ?? 0) + 1;
    }
    if (item.paste_event_count > 0) {
      counts.paste_signal = (counts.paste_signal ?? 0) + 1;
    }
    if (item.focus_loss_count > 0) {
      counts.focus_loss_signal = (counts.focus_loss_signal ?? 0) + 1;
    }
    counts[`substantive_basis_${item.substantive_reasoning_basis}`] =
      (counts[`substantive_basis_${item.substantive_reasoning_basis}`] ?? 0) + 1;
    return counts;
  }, {});
  const sessionRules = [
    ruleTrace({
      rule_id: "initial_package_ultra_rapid_sparse",
      rule_label: "Initial three-item package active response time was ultra rapid with sparse evidence",
      matched: packageUltraRapidRuleMatched,
      signal_types: [
        "initial_package_active_duration",
        "sparse_or_low_information_item_count",
        "substantive_reasoning_item_count"
      ],
      thresholds_used: [
        {
          threshold_name: "initial_package_ultra_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.initial_package_ultra_rapid_ms,
          observed_value: rapidRuleDuration ?? "missing",
          observed_band: packageBand
        },
        {
          threshold_name: "disengaged_min_item_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count,
          observed_value: sparseItemCount,
          observed_band: "sparse_item_count"
        },
        {
          threshold_name: "strong_substantive_counterevidence_item_count",
          threshold_value: 2,
          observed_value: substantiveItemCount
        },
        {
          threshold_name: "timing_source_used_for_rapid_rule",
          threshold_value: packageTiming.timing_source_used_for_rapid_rule,
          observed_value: packageTiming.rapid_rule_timing_approximate ? "approximate" : "direct"
        }
      ],
      contribution: "supports_disengagement",
      confidence: packageUltraRapidRuleMatched && reliableActiveTiming ? "high" : "medium"
    }),
    ruleTrace({
      rule_id: "initial_package_extreme_rapid_sparse",
      rule_label: "Initial three-item package active response time was extreme rapid with sparse evidence",
      matched: packageExtremeRapidRuleMatched,
      signal_types: [
        "initial_package_active_duration",
        "sparse_or_low_information_item_count",
        "substantive_reasoning_item_count"
      ],
      thresholds_used: [
        {
          threshold_name: "initial_package_extreme_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.initial_package_extreme_rapid_ms,
          observed_value: rapidRuleDuration ?? "missing",
          observed_band: packageBand
        },
        {
          threshold_name: "disengaged_min_item_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count,
          observed_value: sparseItemCount,
          observed_band: "sparse_item_count"
        },
        {
          threshold_name: "strong_substantive_counterevidence_item_count",
          threshold_value: 2,
          observed_value: substantiveItemCount
        },
        {
          threshold_name: "timing_source_used_for_rapid_rule",
          threshold_value: packageTiming.timing_source_used_for_rapid_rule,
          observed_value: packageTiming.rapid_rule_timing_approximate ? "approximate" : "direct"
        }
      ],
      contribution: "supports_disengagement",
      confidence: packageExtremeRapidRuleMatched && reliableActiveTiming ? "high" : "medium"
    }),
    ruleTrace({
      rule_id: "initial_package_rapid_warning_sparse",
      rule_label: "Initial three-item package active response time was in the rapid-warning band with weak evidence",
      matched: packageRapidWarningRuleMatched,
      signal_types: [
        "initial_package_active_duration",
        "sparse_or_low_information_item_count",
        "substantive_reasoning_item_count"
      ],
      thresholds_used: [
        {
          threshold_name: "initial_package_rapid_warning_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.initial_package_rapid_warning_ms,
          observed_value: rapidRuleDuration ?? "missing",
          observed_band: packageBand
        },
        {
          threshold_name: "sparse_item_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count,
          observed_value: sparseItemCount
        },
        {
          threshold_name: "maximum_weak_substantive_counterevidence_item_count",
          threshold_value: 1,
          observed_value: substantiveItemCount
        },
        {
          threshold_name: "timing_source_used_for_rapid_rule",
          threshold_value: packageTiming.timing_source_used_for_rapid_rule,
          observed_value: packageTiming.rapid_rule_timing_approximate ? "approximate" : "direct"
        }
      ],
      contribution: rapidWarningConvergesForDisengagement
        ? "supports_disengagement"
        : "supports_moderate_engagement",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "very_low_reasoning_typing_sparse",
      rule_label: "Very low reasoning typing time with repeated sparse evidence",
      matched: veryLowReasoningTypingRuleMatched,
      signal_types: [
        "package_reasoning_typing_duration",
        "item_reasoning_typing_duration",
        "sparse_or_low_information_item_count"
      ],
      thresholds_used: [
        {
          threshold_name: "package_reasoning_typing_very_low_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_very_low_ms,
          observed_value: packageTiming.package_reasoning_typing_duration_ms ?? "missing",
          observed_band: reasoningTypingBand
        },
        {
          threshold_name: "item_reasoning_typing_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.item_reasoning_typing_rapid_ms,
          observed_value: rapidReasoningTypingItemCount,
          observed_band: "rapid_item_reasoning_typing_count"
        },
        {
          threshold_name: "sparse_item_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count,
          observed_value: sparseItemCount
        }
      ],
      contribution: "supports_disengagement",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "multiple_items_rapid_sparse",
      rule_label: "Multiple items with rapid or sparse participation evidence",
      matched:
        disengagedCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count ||
        rapidMinimalItemCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count,
      signal_types: ["item_engagement_signal", "full_item_package_completion_time", "reasoning_length_band"],
      thresholds_used: [
        {
          threshold_name: "disengaged_min_item_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count,
          observed_value: disengagedCount
        },
        {
          threshold_name: "full_item_completion_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.full_item_completion_rapid_ms,
          observed_value: rapidMinimalItemCount,
          observed_band: "rapid_minimal_item_count"
        }
      ],
      contribution: "supports_disengagement",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "majority_meaningful_engagement",
      rule_label: "Majority of items include meaningful response evidence",
      matched: engagedCount >= Math.max(1, Math.ceil(items.length / 2)),
      signal_types: ["item_engagement_signal"],
      thresholds_used: [
        {
          threshold_name: "engaged_majority_item_count",
          threshold_value: Math.max(1, Math.ceil(items.length / 2)),
          observed_value: engagedCount
        }
      ],
      contribution: "supports_engagement",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "all_items_insufficient_evidence",
      rule_label: "All items have insufficient evidence",
      matched: items.length === 0 || insufficientProcessCount === items.length,
      signal_types: ["item_engagement_signal"],
      thresholds_used: [
        {
          threshold_name: "item_count",
          threshold_value: items.length,
          observed_value: insufficientProcessCount
        }
      ],
      contribution: "supports_insufficient_evidence",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "mixed_item_signals",
      rule_label: "Mixed item-level engagement signals",
      matched:
        category === "moderately_engaged" &&
        engagedCount < Math.max(1, Math.ceil(items.length / 2)) &&
        disengagedCount < ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count &&
        !packageRapidWarningRuleMatched,
      signal_types: ["item_engagement_signal"],
      contribution: "supports_moderate_engagement",
      confidence: "medium"
    })
  ];
  const sessionRuleSplit = splitRuleTraces(sessionRules);
  const completionCounterevidenceExplanation =
    packageTiming.baseline_completion_observed &&
    (packageUltraRapidRuleMatched || packageExtremeRapidRuleMatched || packageRapidWarningRuleMatched)
      ? "completed_three_items_is_baseline_completion_not_counterevidence_when_package_is_active_rapid_sparse"
      : packageTiming.baseline_completion_observed
        ? "completed_three_items_is_baseline_completion_context_only"
        : "completed_three_items_not_observed";
  const meaningfulReasoningCounterevidenceExplanation = hasStrongSubstantiveCounterevidence
    ? "strong_substantive_reasoning_counterevidence_requires_multiple_task_relevant_or_quality_supported_items"
    : substantiveItemCount === 1
      ? "one_substantive_item_is_weak_counterevidence_against_repeated_sparse_evidence"
      : "meaningful_reasoning_counterevidence_not_counted_without_task_relevant_or_quality_supported_reasoning";
  const processEventsCounterevidenceExplanation = packageTiming.data_quality_events_observed
    ? "process_events_observed_indicate_data_quality_not_engagement_counterevidence"
    : "process_events_not_observed_or_not_available";
  const topCounterevidence = [
    hasStrongSubstantiveCounterevidence && "strong_substantive_reasoning_counterevidence_present",
    moderatelyEngagedCount > 0 && "some_moderate_participation_evidence",
    packageRapidWarningRuleMatched && !rapidWarningConvergesForDisengagement && "rapid_warning_with_mixed_evidence"
  ].filter((value): value is string => Boolean(value));
  const whyNotOtherCategories: WhyNotCategory[] =
    category === "disengaged"
      ? [
          { category: "engaged", reason_code: "multiple_items_lacked_substantive_response_evidence" },
          {
            category: "moderately_engaged",
            reason_code: packageUltraRapidRuleMatched
              ? "initial_package_ultra_rapid_sparse_rule_matched"
              : packageExtremeRapidRuleMatched
                ? "initial_package_extreme_rapid_sparse_rule_matched"
                : rapidWarningConvergesForDisengagement
                  ? "initial_package_rapid_warning_sparse_rule_converged"
              : "disengagement_signals_repeated_across_items"
          }
        ]
      : category === "engaged"
        ? [
            { category: "disengaged", reason_code: "majority_meaningful_response_evidence_present" },
            { category: "insufficient_evidence", reason_code: "completed_item_evidence_available" }
          ]
        : category === "insufficient_evidence"
          ? [
              { category: "engaged", reason_code: "usable_item_evidence_missing_or_ambiguous" },
              { category: "disengaged", reason_code: "insufficient_convergent_disengagement_signals" }
            ]
          : [
              { category: "engaged", reason_code: "majority_meaningful_response_evidence_not_observed" },
              { category: "disengaged", reason_code: "disengagement_item_threshold_not_met" }
            ];
  const aiSessionRules = [
    ruleTrace({
      rule_id: "at_least_one_item_likely_external_assistance_pattern",
      rule_label: "At least one item has convergent contextual assistance signals",
      matched: items.some((item) => item.ai_assistance_signal === "likely_external_assistance_pattern"),
      signal_types: ["item_ai_assistance_signal"],
      thresholds_used: [
        {
          threshold_name: "likely_ai_min_convergent_signal_count",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.likely_ai_min_convergent_signal_count,
          observed_value: items.filter((item) => item.ai_assistance_signal === "likely_external_assistance_pattern").length
        }
      ],
      contribution: "supports_ai_signal",
      confidence: "medium"
    }),
    ruleTrace({
      rule_id: "only_weak_or_single_assistance_signals",
      rule_label: "Only weak or single contextual assistance signals",
      matched:
        !items.some((item) => item.ai_assistance_signal === "likely_external_assistance_pattern") &&
        items.some((item) => item.ai_assistance_signal === "insufficient_evidence"),
      signal_types: ["item_ai_assistance_signal"],
      contribution: "supports_insufficient_evidence",
      confidence: "low"
    }),
    ruleTrace({
      rule_id: "no_relevant_assistance_pattern_observed",
      rule_label: "No relevant contextual assistance pattern observed",
      matched: aiSignal === "none_indicated",
      signal_types: ["item_ai_assistance_signal"],
      contribution: "supports_no_ai_signal",
      confidence: "medium"
    })
  ];
  const aiRuleSplit = splitRuleTraces(aiSessionRules);

  return {
    provisional_engagement_category: category,
    category_confidence: categoryConfidence,
    ai_assistance_signal: aiSignal,
    item_count: items.length,
    engaged_item_count: engagedCount,
    disengaged_item_count: disengagedCount,
    process_data_interpretation_policy:
      "Process data are contextual engagement and evidence-sufficiency signals. They are not misconduct evidence and do not directly determine ability.",
    limitations: [...limitations],
    session_decision_trace: {
      engagement_category: category,
      category_confidence: categoryConfidence,
      item_category_counts: {
        engaged: engagedCount,
        moderately_engaged: moderatelyEngagedCount,
        disengaged: disengagedCount,
        insufficient_evidence: insufficientProcessCount
      },
      dominant_signal_counts: dominantSignalCounts,
      package_duration_band: packageBand,
      package_duration_thresholds_used: [
        {
          threshold_name: "initial_package_ultra_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.initial_package_ultra_rapid_ms,
          observed_value: rapidRuleDuration ?? "missing",
          observed_band: packageBand
        },
        {
          threshold_name: "initial_package_extreme_rapid_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.initial_package_extreme_rapid_ms,
          observed_value: rapidRuleDuration ?? "missing",
          observed_band: packageBand
        },
        {
          threshold_name: "initial_package_rapid_warning_ms",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.initial_package_rapid_warning_ms,
          observed_value: rapidRuleDuration ?? "missing",
          observed_band: packageBand
        },
        {
          threshold_name: "timing_source_used_for_rapid_rule",
          threshold_value: packageTiming.timing_source_used_for_rapid_rule,
          observed_value: packageTiming.rapid_rule_timing_approximate ? "approximate" : "direct"
        }
      ],
      package_timing: {
        wall_clock_band: wallClockBand,
        active_response_band: activeResponseBand,
        sum_item_active_band: sumItemActiveBand,
        focus_adjusted_band: focusAdjustedBand,
        focus_adjusted_task_band: focusAdjustedTaskBand,
        sum_item_focus_adjusted_band: sumItemFocusAdjustedBand,
        response_production_band: responseProductionBand,
        reasoning_typing_band: reasoningTypingBand,
        timing_source_used_for_rapid_rule: packageTiming.timing_source_used_for_rapid_rule,
        ultra_rapid_threshold_ms: ENGAGEMENT_RULE_CONFIG_V1.initial_package_ultra_rapid_ms,
        extreme_rapid_threshold_ms: ENGAGEMENT_RULE_CONFIG_V1.initial_package_extreme_rapid_ms,
        rapid_warning_threshold_ms: ENGAGEMENT_RULE_CONFIG_V1.initial_package_rapid_warning_ms,
        reasoning_typing_very_low_threshold_ms:
          ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_very_low_ms,
        reasoning_typing_low_threshold_ms: ENGAGEMENT_RULE_CONFIG_V1.package_reasoning_typing_low_ms,
        item_reasoning_typing_rapid_threshold_ms: ENGAGEMENT_RULE_CONFIG_V1.item_reasoning_typing_rapid_ms,
        package_ultra_rapid_rule_matched: packageUltraRapidRuleMatched,
        package_extreme_rapid_rule_matched: packageExtremeRapidRuleMatched,
        package_rapid_warning_rule_matched: packageRapidWarningRuleMatched,
        reasoning_typing_very_low_rule_matched: veryLowReasoningTypingRuleMatched,
        timing_limitations: packageTiming.timing_limitations
      },
      timing_reconstruction: packageTiming.timing_reconstruction,
      package_rapid_rule_matched:
        packageUltraRapidRuleMatched ||
        packageExtremeRapidRuleMatched ||
        packageRapidWarningRuleMatched,
      sparse_item_count: sparseItemCount,
      substantive_item_count: substantiveItemCount,
      substantive_reasoning_basis_counts: substantiveReasoningBasisCounts,
      baseline_completion_observed: packageTiming.baseline_completion_observed,
      data_quality_events_observed: packageTiming.data_quality_events_observed,
      completed_three_items_counterevidence_explanation: completionCounterevidenceExplanation,
      meaningful_reasoning_counterevidence_explanation: meaningfulReasoningCounterevidenceExplanation,
      process_events_counterevidence_explanation: processEventsCounterevidenceExplanation,
      matched_session_rules: sessionRuleSplit.matched,
      non_matched_session_rules: sessionRuleSplit.nonMatched,
      why_not_other_categories: whyNotOtherCategories,
      top_counterevidence: topCounterevidence,
      limitations: ["thresholds_are_provisional_not_empirically_calibrated", ...packageTiming.timing_limitations]
    },
    ai_assistance_decision_trace: {
      ai_assistance_signal: aiSignal,
      confidence:
        aiSignal === "likely_external_assistance_pattern"
          ? "medium"
          : aiSignal === "insufficient_evidence"
            ? "low"
            : "medium",
      matched_rules: aiRuleSplit.matched,
      non_matched_rules: aiRuleSplit.nonMatched,
      why_not_likely_external_assistance_pattern:
        aiSignal === "likely_external_assistance_pattern"
          ? []
          : [
              {
                category: "likely_external_assistance_pattern",
                reason_code:
                  aiSignal === "insufficient_evidence"
                    ? "only_single_or_ambiguous_contextual_signal"
                    : "no_convergent_focus_paste_typing_pattern"
              }
            ],
      limitations: [
        "none_indicated_is_not_proof_of_no_ai_use",
        "ai_assistance_signal_should_be_compared_with_self_report"
      ]
    },
    threshold_policy: ENGAGEMENT_RULE_CONFIG_V1.threshold_policy
  };
}

function eventsForItem(events: ProcessEventSummary[], itemDbId: string) {
  return events.filter((event) => event.item_db_id === itemDbId);
}

function packageItemPublicIds(payload: unknown) {
  const itemResponses = Array.isArray(record(payload).item_responses)
    ? (record(payload).item_responses as unknown[])
    : [];
  return new Set(
    itemResponses
      .map((entry) => stringValue(record(entry).item_public_id))
      .filter((value): value is string => Boolean(value))
  );
}

function processInstrumentationAvailable(eventCounts: Record<string, number>) {
  return ENGAGEMENT_PROCESS_EVENT_TYPES.some((eventType) => (eventCounts[eventType] ?? 0) > 0);
}

function millisecondsBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return null;

  const duration = end.getTime() - start.getTime();
  return duration > 0 && Number.isFinite(duration) ? duration : null;
}

type TimingCandidate = {
  event_type: string;
  occurred_at: Date | null;
  source: TimingEventSource;
};

function earliestTimingCandidate(candidates: Array<TimingCandidate | null | undefined>) {
  const available = candidates.filter(
    (candidate): candidate is TimingCandidate => Boolean(candidate?.occurred_at)
  );

  if (available.length === 0) return null;

  return available.reduce((earliest, candidate) => {
    if (!earliest.occurred_at) return candidate;
    if (!candidate.occurred_at) return earliest;
    return candidate.occurred_at.getTime() < earliest.occurred_at.getTime() ? candidate : earliest;
  });
}

function safeTimingEvent(candidate: TimingCandidate | null, fallbackType = "unknown"): TimingReconstructionEvent {
  return {
    event_type: candidate?.event_type ?? fallbackType,
    occurred_at: candidate?.occurred_at ? candidate.occurred_at.toISOString() : null,
    source: candidate?.source ?? "unknown"
  };
}

function processTimingCandidate(event: ProcessEventSummary): TimingCandidate {
  return {
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    source: "process_events"
  };
}

function unknownItemTiming(itemPublicId: string): ItemTimingReconstruction {
  return {
    item_public_id: itemPublicId,
    first_student_action_event_type: "unknown",
    item_completed_event_type: "unknown",
    active_duration_band: "missing",
    active_duration_ms: null,
    timing_limitations: ["item_active_timing_unavailable"]
  };
}

const STUDENT_RESPONSE_ACTION_EVENTS = new Set([
  "option_clicked",
  "option_selected",
  "answer_changed",
  "reasoning_started",
  "reasoning_entered",
  "reasoning_submitted",
  "reasoning_revised",
  "confidence_clicked",
  "confidence_selected",
  "confidence_changed",
  "tempting_option_submitted",
  "tempting_option_reason_submitted",
  "tempting_option_changed",
  "student_response_edit_submitted"
]);

const FOCUS_OR_IDLE_INTERVAL_EVENTS = new Set([
  "page_visibility_hidden",
  "page_hidden",
  "window_blur",
  "long_pause",
  "inactivity_detected"
]);

function inactiveIntervalDurationMs(event: ProcessEventSummary) {
  const payload = record(event.payload);
  const duration =
    event.event_type === "long_pause" || event.event_type === "inactivity_detected"
      ? event.pause_duration_ms ??
        numberValue(payload.pause_duration_ms) ??
        numberValue(payload.duration_ms)
      : event.event_type === "page_visibility_hidden" || event.event_type === "page_hidden"
        ? numberValue(payload.hidden_duration_ms)
        : event.event_type === "window_blur"
          ? numberValue(payload.blur_duration_ms)
          : null;

  return duration !== null && duration > 0 && Number.isFinite(duration) ? duration : null;
}

function typingDurationMs(event: ProcessEventSummary) {
  if (event.event_type !== "typing_activity_summary") return null;
  const duration = numberValue(record(event.payload).duration_ms);
  return duration !== null && duration > 0 && Number.isFinite(duration) ? duration : null;
}

function sumDurations(durations: Array<number | null>) {
  const available = durations.filter((duration): duration is number => duration !== null);
  return available.length > 0 ? available.reduce((total, duration) => total + duration, 0) : null;
}

function chooseRapidRuleTiming(input: {
  focusAdjustedTaskDuration: number | null;
  sumItemFocusAdjustedDuration: number | null;
  responseProductionDuration: number | null;
  wallClockDuration: number | null;
}): Pick<
  PackageTimingInput,
  "timing_source_used_for_rapid_rule" | "rapid_rule_duration_ms" | "rapid_rule_timing_approximate"
> {
  if (input.focusAdjustedTaskDuration !== null) {
    return {
      timing_source_used_for_rapid_rule: "focus_adjusted_task",
      rapid_rule_duration_ms: input.focusAdjustedTaskDuration,
      rapid_rule_timing_approximate: false
    };
  }

  if (input.sumItemFocusAdjustedDuration !== null) {
    return {
      timing_source_used_for_rapid_rule: "sum_item_focus_adjusted",
      rapid_rule_duration_ms: input.sumItemFocusAdjustedDuration,
      rapid_rule_timing_approximate: false
    };
  }

  if (input.responseProductionDuration !== null) {
    return {
      timing_source_used_for_rapid_rule: "response_production",
      rapid_rule_duration_ms: input.responseProductionDuration,
      rapid_rule_timing_approximate: false
    };
  }

  if (input.wallClockDuration !== null) {
    return {
      timing_source_used_for_rapid_rule: "wall_clock_fallback",
      rapid_rule_duration_ms: input.wallClockDuration,
      rapid_rule_timing_approximate: true
    };
  }

  return {
    timing_source_used_for_rapid_rule: "unavailable",
    rapid_rule_duration_ms: null,
    rapid_rule_timing_approximate: true
  };
}

function derivePackageTiming(input: {
  events: ProcessEventSummary[];
  responses: Array<{
    item_db_id: string;
    item_public_id: string;
    item_started_at: Date | null;
    item_submitted_at: Date | null;
    created_at: Date;
  }>;
  conversationTurns: Array<{
    item_db_id: string | null;
    actor_type: string;
    created_at: Date;
  }>;
  packageCreatedAt: Date;
  baselineCompletionObserved: boolean;
  dataQualityEventsObserved: boolean;
}): PackageTimingInput {
  const packageSubmittedCandidate = earliestTimingCandidate([
    ...input.events
      .filter((event) => event.event_type === "package_submitted")
      .map(processTimingCandidate),
    {
      event_type: "initial_response_package_created",
      occurred_at: input.packageCreatedAt,
      source: "response_packages" as const
    }
  ]);
  const packageSubmittedAt = packageSubmittedCandidate?.occurred_at ?? input.packageCreatedAt;
  const firstItemPresentedCandidate = earliestTimingCandidate(
    input.events
      .filter((event) => event.event_type === "item_presented")
      .map(processTimingCandidate)
  );
  const firstItemPresentedAt = firstItemPresentedCandidate?.occurred_at ?? null;
  const firstStudentActionCandidate = earliestTimingCandidate([
    ...input.events
      .filter((event) => STUDENT_RESPONSE_ACTION_EVENTS.has(event.event_type))
      .map(processTimingCandidate),
    ...input.responses.map((response) => ({
      event_type: "item_response_created",
      occurred_at: response.created_at,
      source: "item_responses" as const
    })),
    ...input.conversationTurns
      .filter((turn) => turn.actor_type === "student")
      .map((turn) => ({
        event_type: "student_conversation_turn",
        occurred_at: turn.created_at,
        source: "conversation_turns" as const
      }))
  ]);
  const firstStudentActionAt = firstStudentActionCandidate?.occurred_at ?? null;
  const wallClockDuration = millisecondsBetween(firstItemPresentedAt, packageSubmittedAt);
  const responseProductionDuration = millisecondsBetween(firstStudentActionAt, packageSubmittedAt);
  const itemTimingEntries = input.responses.map((response) => {
      const itemEvents = input.events.filter((event) => event.item_db_id === response.item_db_id);
      const itemConversationTurns = input.conversationTurns.filter(
        (turn) => turn.item_db_id === response.item_db_id && turn.actor_type === "student"
      );
      const itemPresentedCandidate = earliestTimingCandidate([
        ...itemEvents
          .filter((event) => event.event_type === "item_presented")
          .map(processTimingCandidate),
        response.item_started_at
          ? {
              event_type: "item_started_at",
              occurred_at: response.item_started_at,
              source: "item_responses" as const
            }
          : null
      ]);
      const firstItemStudentActionCandidate = earliestTimingCandidate([
        ...itemEvents
          .filter((event) => STUDENT_RESPONSE_ACTION_EVENTS.has(event.event_type))
          .map(processTimingCandidate),
        {
          event_type: "item_response_created",
          occurred_at: response.created_at,
          source: "item_responses" as const
        },
        ...itemConversationTurns.map((turn) => ({
          event_type: "student_conversation_turn",
          occurred_at: turn.created_at,
          source: "conversation_turns" as const
        }))
      ]);
      const itemCompletedCandidate = earliestTimingCandidate([
        ...itemEvents
          .filter((event) => event.event_type === "item_completed")
          .map(processTimingCandidate),
        response.item_submitted_at
          ? {
              event_type: "item_submitted_at",
              occurred_at: response.item_submitted_at,
              source: "item_responses" as const
            }
          : null
      ]);
      const responseProductionItemDuration = millisecondsBetween(
        firstItemStudentActionCandidate?.occurred_at ?? null,
        itemCompletedCandidate?.occurred_at ?? null
      );
      const itemWallClockDuration = millisecondsBetween(
        itemPresentedCandidate?.occurred_at ?? null,
        itemCompletedCandidate?.occurred_at ?? null
      );
      const itemInactiveDuration = itemEvents
        .filter((event) => {
          if (!FOCUS_OR_IDLE_INTERVAL_EVENTS.has(event.event_type)) return false;
          if (itemPresentedCandidate?.occurred_at && event.occurred_at < itemPresentedCandidate.occurred_at) {
            return false;
          }
          if (itemCompletedCandidate?.occurred_at && event.occurred_at > itemCompletedCandidate.occurred_at) {
            return false;
          }
          return true;
        })
        .map(inactiveIntervalDurationMs)
        .filter((duration): duration is number => duration !== null)
        .reduce((total, duration) => total + duration, 0);
      const itemFocusAdjustedDuration =
        itemWallClockDuration !== null && itemInactiveDuration > 0
          ? Math.max(1, itemWallClockDuration - itemInactiveDuration)
          : null;
      const itemReasoningTypingDuration = sumDurations(itemEvents.map(typingDurationMs));
      const pasteObserved = itemEvents.some((event) => event.event_type === "paste_detected");
      const reasoningTypingBasis: z.infer<typeof ReasoningTypingBasisSchema> =
        itemReasoningTypingDuration !== null
          ? "typing_activity_summary"
          : pasteObserved
            ? "pasted_response_context"
            : "unavailable";
      const timingLimitations = [
        !itemPresentedCandidate && "item_presented_timing_unavailable",
        !firstItemStudentActionCandidate && "item_first_student_action_unavailable",
        !itemCompletedCandidate && "item_completion_timing_unavailable",
        itemFocusAdjustedDuration === null && "item_focus_adjusted_timing_unavailable",
        itemReasoningTypingDuration === null && "item_reasoning_typing_timing_unavailable",
        firstItemStudentActionCandidate?.source === "item_responses" && "item_response_created_at_used_as_action_fallback",
        itemCompletedCandidate?.source === "item_responses" && "item_submitted_at_used_as_completion_fallback"
      ].filter((value): value is string => Boolean(value));

      return {
        item_public_id: response.item_public_id,
        response_production_duration: responseProductionItemDuration,
        focus_adjusted_duration: itemFocusAdjustedDuration,
        reasoning_typing_duration: itemReasoningTypingDuration,
        item_timing: {
          item_public_id: response.item_public_id,
          wall_clock_band: packageDurationBand(itemWallClockDuration),
          focus_adjusted_task_band: packageDurationBand(itemFocusAdjustedDuration),
          response_production_band: packageDurationBand(responseProductionItemDuration),
          reasoning_typing_band: itemReasoningTypingBand(itemReasoningTypingDuration),
          reasoning_typing_basis: reasoningTypingBasis,
          timing_limitations: timingLimitations
        } satisfies ItemEngagementTiming,
        reconstruction: {
          item_public_id: response.item_public_id,
          first_student_action_event_type:
            firstItemStudentActionCandidate?.event_type ?? "unknown",
          item_completed_event_type: itemCompletedCandidate?.event_type ?? "unknown",
          active_duration_band: timeBand(responseProductionItemDuration),
          active_duration_ms: responseProductionItemDuration,
          timing_limitations: timingLimitations
        } satisfies ItemTimingReconstruction
      };
    });
  const sumItemResponseProductionDuration = sumDurations(
    itemTimingEntries.map((entry) => entry.response_production_duration)
  );
  const sumItemFocusAdjustedDuration = sumDurations(
    itemTimingEntries.map((entry) => entry.focus_adjusted_duration)
  );
  const idleOrHiddenDuration = input.events
    .filter((event) => {
      if (!FOCUS_OR_IDLE_INTERVAL_EVENTS.has(event.event_type)) return false;
      if (firstItemPresentedAt && event.occurred_at < firstItemPresentedAt) return false;
      if (event.occurred_at > packageSubmittedAt) return false;
      return true;
    })
    .map(inactiveIntervalDurationMs)
    .filter((duration): duration is number => duration !== null)
    .reduce((total, duration) => total + duration, 0);
  const focusAdjustedTaskDuration =
    wallClockDuration !== null && idleOrHiddenDuration > 0
      ? Math.max(1, wallClockDuration - idleOrHiddenDuration)
      : null;
  const packageReasoningTypingDuration = sumDurations(
    input.events
      .filter((event) => {
        if (event.event_type !== "typing_activity_summary") return false;
        if (firstItemPresentedAt && event.occurred_at < firstItemPresentedAt) return false;
        if (event.occurred_at > packageSubmittedAt) return false;
        return true;
      })
      .map(typingDurationMs)
  );
  const rapidRuleTiming = chooseRapidRuleTiming({
    focusAdjustedTaskDuration,
    sumItemFocusAdjustedDuration,
    responseProductionDuration,
    wallClockDuration
  });
  const timingLimitations = new Set<string>();

  if (
    focusAdjustedTaskDuration === null &&
    sumItemFocusAdjustedDuration === null &&
    responseProductionDuration === null
  ) {
    timingLimitations.add("active_package_timing_unavailable");
  }
  if (rapidRuleTiming.timing_source_used_for_rapid_rule === "wall_clock_fallback") {
    timingLimitations.add("wall_clock_timing_used_for_rapid_rule_fallback");
  }
  if (focusAdjustedTaskDuration === null) {
    timingLimitations.add("focus_adjusted_task_timing_unavailable");
  }
  if (sumItemFocusAdjustedDuration === null) {
    timingLimitations.add("sum_item_focus_adjusted_timing_unavailable");
  }
  if (responseProductionDuration === null) {
    timingLimitations.add("response_production_timing_unavailable");
  }
  if (packageReasoningTypingDuration === null) {
    timingLimitations.add("reasoning_typing_timing_unavailable");
  }
  if (rapidRuleTiming.timing_source_used_for_rapid_rule === "unavailable") {
    timingLimitations.add("package_timing_unavailable");
  }
  if (firstStudentActionCandidate?.source === "item_responses") {
    timingLimitations.add("item_response_created_at_used_as_first_student_action_fallback");
  }
  if (firstStudentActionCandidate?.source === "conversation_turns") {
    timingLimitations.add("conversation_turn_used_as_first_student_action_fallback");
  }
  if (packageSubmittedCandidate?.source === "response_packages") {
    timingLimitations.add("response_package_created_at_used_as_package_submitted_marker");
  }

  return {
    wall_clock_duration_ms: wallClockDuration,
    active_response_duration_ms: responseProductionDuration,
    sum_item_active_duration_ms: sumItemResponseProductionDuration,
    focus_adjusted_duration_ms: focusAdjustedTaskDuration,
    focus_adjusted_task_duration_ms: focusAdjustedTaskDuration,
    sum_item_focus_adjusted_duration_ms: sumItemFocusAdjustedDuration,
    response_production_duration_ms: responseProductionDuration,
    package_reasoning_typing_duration_ms: packageReasoningTypingDuration,
    ...rapidRuleTiming,
    baseline_completion_observed: input.baselineCompletionObserved,
    data_quality_events_observed: input.dataQualityEventsObserved,
    timing_limitations: [...timingLimitations],
    item_timing_by_public_id: Object.fromEntries(
      itemTimingEntries.map((entry) => [entry.item_public_id, entry.item_timing])
    ),
    timing_reconstruction: {
      first_item_presented_event: safeTimingEvent(firstItemPresentedCandidate),
      first_student_action_event: safeTimingEvent(firstStudentActionCandidate),
      package_submitted_event: safeTimingEvent(packageSubmittedCandidate, "package_submitted"),
      wall_clock_duration_ms: wallClockDuration,
      active_response_duration_ms: responseProductionDuration,
      sum_item_active_duration_ms: sumItemResponseProductionDuration,
      focus_adjusted_duration_ms: focusAdjustedTaskDuration,
      focus_adjusted_task_duration_ms: focusAdjustedTaskDuration,
      sum_item_focus_adjusted_duration_ms: sumItemFocusAdjustedDuration,
      response_production_duration_ms: responseProductionDuration,
      package_reasoning_typing_duration_ms: packageReasoningTypingDuration,
      wall_clock_band: packageDurationBand(wallClockDuration),
      active_response_band: packageDurationBand(responseProductionDuration),
      sum_item_active_band: packageDurationBand(sumItemResponseProductionDuration),
      focus_adjusted_band: packageDurationBand(focusAdjustedTaskDuration),
      focus_adjusted_task_band: packageDurationBand(focusAdjustedTaskDuration),
      sum_item_focus_adjusted_band: packageDurationBand(sumItemFocusAdjustedDuration),
      response_production_band: packageDurationBand(responseProductionDuration),
      reasoning_typing_band: packageReasoningTypingBand(packageReasoningTypingDuration),
      timing_source_used_for_rapid_rule: rapidRuleTiming.timing_source_used_for_rapid_rule,
      timing_limitations: [...timingLimitations],
      item_active_timing_reconstruction: itemTimingEntries.map((entry) => entry.reconstruction)
    }
  };
}

export async function buildEngagementEvidencePacketForSession(
  sessionPublicId: string
): Promise<EngagementEvidencePacketV1> {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    include: {
      user: { select: { user_id: true } },
      assessment: { select: { assessment_public_id: true } },
      concept_unit_sessions: {
        orderBy: [{ created_at: "desc" }],
        include: {
          concept_unit: true,
          response_packages: {
            where: { package_type: "initial_concept_unit_response_package" },
            orderBy: [{ created_at: "desc" }]
          },
          item_responses: {
            orderBy: [{ created_at: "asc" }],
            include: { item: true }
          },
          conversation_turns: {
            select: {
              item_db_id: true,
              actor_type: true,
              created_at: true
            }
          },
          process_events: {
            select: {
              item_db_id: true,
              event_type: true,
              visibility_duration_ms: true,
              pause_duration_ms: true,
              payload: true,
              occurred_at: true
            }
          }
        }
      }
    }
  });
  const conceptUnitSession = session.concept_unit_sessions.find(
    (entry) => entry.response_packages.length > 0
  );

  if (!conceptUnitSession) {
    throw new Error(`No initial response package exists for session ${sessionPublicId}.`);
  }

  const sourcePackages = conceptUnitSession.response_packages;
  const sourcePackage = sourcePackages[0];
  const sourceItemPublicIds = packageItemPublicIds(sourcePackage?.payload);
  const responses = conceptUnitSession.item_responses.filter((response) =>
    sourceItemPublicIds.size === 0
      ? response.item.included_in_published_set
      : sourceItemPublicIds.has(response.item.item_public_id)
  );
  const observedEventCounts = countByType(conceptUnitSession.process_events);
  const instrumentationAvailable = processInstrumentationAvailable(observedEventCounts);
  const packageTiming = derivePackageTiming({
    events: conceptUnitSession.process_events,
    responses: responses.map((response) => ({
      item_db_id: response.item_db_id,
      item_public_id: response.item.item_public_id,
      item_started_at: response.item_started_at,
      item_submitted_at: response.item_submitted_at,
      created_at: response.created_at
    })),
    conversationTurns: conceptUnitSession.conversation_turns,
    packageCreatedAt: sourcePackage.created_at,
    baselineCompletionObserved: responses.length >= 3 && responses.every((response) =>
      Boolean(response.item_submitted_at || response.selected_option || response.reasoning_text)
    ),
    dataQualityEventsObserved: conceptUnitSession.process_events.length > 0
  });
  const itemEvidence = responses.map((response) => {
    const itemEvents = eventsForItem(conceptUnitSession.process_events, response.item_db_id);
    return buildItemEngagementEvidence({
      item_public_id: response.item.item_public_id,
      response_present: Boolean(response.item_submitted_at || response.selected_option || response.reasoning_text),
      selected_option: response.selected_option,
      reasoning_text: response.reasoning_text,
      item_response_time_ms: response.item_response_time_ms,
      item_timing: packageTiming.item_timing_by_public_id[response.item.item_public_id],
      revision_count: response.revision_count,
      event_counts: countEngagementEventSignals(itemEvents),
      process_instrumentation_available: instrumentationAvailable
    });
  });
  const missingOrUnobserved = ENGAGEMENT_PROCESS_EVENT_TYPES.filter(
    (eventType) => (observedEventCounts[eventType] ?? 0) === 0
  );
  const packet = {
    schema_version: ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    session_public_id: session.session_public_id,
    student_public_id: session.user.user_id,
    assessment_public_id: session.assessment.assessment_public_id,
    concept_unit_id: conceptUnitSession.concept_unit.concept_unit_public_id,
    source_response_package_refs: sourcePackages.map((pkg) => ({
      package_type: pkg.package_type,
      created_at: pkg.created_at.toISOString()
    })),
    item_engagement_evidence: itemEvidence,
    session_engagement_summary: summarizeSessionEngagement(itemEvidence, packageTiming),
    engagement_rule_config: ENGAGEMENT_RULE_CONFIG_V1,
    process_data_inventory: {
      observed_event_counts: observedEventCounts,
      supported_event_types: [...ENGAGEMENT_PROCESS_EVENT_TYPES],
      missing_or_unobserved_event_types: missingOrUnobserved,
      instrumentation_limitations: [
        "typing_activity_summary contains only aggregate key counts and durations, not typed text.",
        "paste_detected contains only clipboard type and length bands, not pasted content.",
        "Focus, visibility, paste, and pause signals are contextual engagement evidence only."
      ]
    },
    safety_check: {
      no_misconduct_label: true,
      no_confirmed_ai_use_label: true,
      no_raw_reasoning: true,
      no_raw_process_payloads: true,
      no_answer_keys: true
    }
  };

  return EngagementEvidencePacketV1Schema.parse(packet);
}

export function redactEngagementEvidencePacketForReview(packet: EngagementEvidencePacketV1) {
  return {
    artifact_type: "engagement_evidence_review",
    artifact_version: ENGAGEMENT_EVIDENCE_REVIEW_ARTIFACT_VERSION,
    redaction_policy: "bands_counts_and_safe_labels_only",
    ...packet
  };
}

function collectForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectForbiddenKeys(entry, `${path}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const forbiddenKeys = new Set([
    "reasoning_text",
    "message_text",
    "correct_option",
    "correct_option_snapshot",
    "distractor_rationales",
    "option_diagnostic_notes",
    "raw_output",
    "payload",
    "process_events",
    "conversation_turns",
    "item_stem",
    "typed_text",
    "clipboard_text",
    "clipboard_content",
    "raw_url",
    "browser_url",
    "current_url"
  ]);
  const issues: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      issues.push(`${path}.${key}`);
    }
    issues.push(...collectForbiddenKeys(entry, `${path}.${key}`));
  }

  return issues;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => collectStringValues(entry));
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((entry) => collectStringValues(entry));
}

export function validateRedactedEngagementReviewArtifactSafety(value: unknown) {
  const issues = collectForbiddenKeys(value);
  const serializedText = collectStringValues(value).join("\n").toLowerCase();
  const forbiddenTerms = [
    "confirmed genai use",
    "student used genai",
    "student committed misconduct",
    "answer key",
    "correct option",
    "distractor metadata",
    "raw reasoning",
    "clipboard content",
    "raw browser url"
  ];

  for (const term of forbiddenTerms) {
    if (serializedText.includes(term)) {
      issues.push(`forbidden_term:${term}`);
    }
  }

  return {
    passed: issues.length === 0,
    issues
  };
}
