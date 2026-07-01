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

type ProcessEventSummary = {
  item_db_id: string | null;
  event_type: string;
  visibility_duration_ms: number | null;
  pause_duration_ms: number | null;
};

type BuildItemEngagementEvidenceInput = {
  item_public_id: string;
  response_present: boolean;
  reasoning_text?: string | null;
  item_response_time_ms?: number | null;
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

function countByType(events: Array<{ event_type: string }>) {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    return counts;
  }, {});
}

function countKeys(counts: Record<string, number>, keys: string[]) {
  return keys.reduce((total, key) => total + (counts[key] ?? 0), 0);
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
    reasoningCharacterCount < ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_character_threshold ||
    reasoningTokenCount < ENGAGEMENT_RULE_CONFIG_V1.minimal_reasoning_token_threshold;
  const substantiveReasoningPattern =
    reasoningCharacterCount >= ENGAGEMENT_RULE_CONFIG_V1.substantive_reasoning_character_threshold ||
    reasoningLengthBand === "medium" ||
    reasoningLengthBand === "long";
  const rapidMinimalReasoningPattern = rapidResponsePattern && minimalReasoningPattern;
  const repeatedInvalidPattern =
    countKeys(eventCounts, ["repeated_invalid_response"]) > 0 ||
    countKeys(eventCounts, ["response_quality_rejected"]) >=
      ENGAGEMENT_RULE_CONFIG_V1.repeated_invalid_response_threshold;
  const weakEngagementSignalCount = [
    rapidMinimalReasoningPattern,
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
      signal_types: ["reasoning_length_band", "revision_count"],
      thresholds_used: [
        {
          threshold_name: "substantive_reasoning_character_threshold",
          threshold_value: ENGAGEMENT_RULE_CONFIG_V1.substantive_reasoning_character_threshold,
          observed_value: reasoningCharacterCount,
          observed_band: reasoningLengthBand
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

export function summarizeSessionEngagement(
  items: ItemEngagementEvidenceV1[]
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
  const category: EngagementCategory = items.length === 0
    ? "insufficient_evidence"
    : insufficientProcessCount === items.length
      ? "insufficient_evidence"
      : disengagedCount >= ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count ||
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

  const categoryConfidence: EvidenceConfidence = items.some((item) => item.evidence_confidence === "medium")
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
    return counts;
  }, {});
  const sessionRules = [
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
        disengagedCount < ENGAGEMENT_RULE_CONFIG_V1.disengaged_min_item_count,
      signal_types: ["item_engagement_signal"],
      contribution: "supports_moderate_engagement",
      confidence: "medium"
    })
  ];
  const sessionRuleSplit = splitRuleTraces(sessionRules);
  const topCounterevidence = [
    items.length > 0 && "completed_three_items",
    engagedCount > 0 && "meaningful_reasoning_evidence_present",
    moderatelyEngagedCount > 0 && "some_moderate_participation_evidence",
    Object.values(dominantSignalCounts).some((count) => count > 0) && "process_events_observed"
  ].filter((value): value is string => Boolean(value));
  const whyNotOtherCategories: WhyNotCategory[] =
    category === "disengaged"
      ? [
          { category: "engaged", reason_code: "multiple_items_lacked_meaningful_response_evidence" },
          { category: "moderately_engaged", reason_code: "disengagement_signals_repeated_across_items" }
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
      matched_session_rules: sessionRuleSplit.matched,
      non_matched_session_rules: sessionRuleSplit.nonMatched,
      why_not_other_categories: whyNotOtherCategories,
      top_counterevidence: topCounterevidence,
      limitations: ["thresholds_are_provisional_not_empirically_calibrated"]
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
          process_events: {
            select: {
              item_db_id: true,
              event_type: true,
              visibility_duration_ms: true,
              pause_duration_ms: true
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
  const itemEvidence = responses.map((response) => {
    const itemEvents = eventsForItem(conceptUnitSession.process_events, response.item_db_id);
    return buildItemEngagementEvidence({
      item_public_id: response.item.item_public_id,
      response_present: Boolean(response.item_submitted_at || response.selected_option || response.reasoning_text),
      selected_option: response.selected_option,
      reasoning_text: response.reasoning_text,
      item_response_time_ms: response.item_response_time_ms,
      revision_count: response.revision_count,
      event_counts: countByType(itemEvents),
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
    session_engagement_summary: summarizeSessionEngagement(itemEvidence),
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
