import { z } from "zod";
import { prisma } from "@/lib/db";

export const ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION =
  "engagement-evidence-packet-v1" as const;
export const ENGAGEMENT_EVIDENCE_REVIEW_ARTIFACT_VERSION =
  "engagement-evidence-review-v1" as const;

const EventCountSchema = z.record(z.number().int().nonnegative());
const EvidenceConfidenceSchema = z.enum(["high", "medium", "low"]);
const EngagementCategorySchema = z.enum([
  "engaged",
  "moderately_engaged",
  "disengaged",
  "insufficient_process_evidence"
]);
const AiAssistanceSignalSchema = z.enum([
  "none_indicated",
  "possible_external_assistance_or_reference",
  "likely_external_assistance_pattern",
  "insufficient_evidence"
]);

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
  evidence_confidence: EvidenceConfidenceSchema,
  interpretation_cautions: z.array(z.string()),
  signal_notes: z.array(z.string())
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
    limitations: z.array(z.string())
  }),
  process_data_inventory: z.object({
    observed_event_counts: EventCountSchema,
    supported_event_types: z.array(z.string()),
    missing_or_unobserved_event_types: z.array(z.string()),
    instrumentation_limitations: z.array(z.string())
  }),
  safety_check: z.object({
    no_misconduct_label: z.literal(true),
    no_ai_cheating_label: z.literal(true),
    no_raw_reasoning: z.literal(true),
    no_raw_process_payloads: z.literal(true),
    no_answer_keys: z.literal(true)
  })
});

export type EngagementEvidencePacketV1 = z.infer<typeof EngagementEvidencePacketV1Schema>;
export type ItemEngagementEvidenceV1 = z.infer<typeof ItemEngagementEvidenceSchema>;

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

function normalizeReasoningForSignal(text?: string | null) {
  return (text ?? "").trim().toLowerCase();
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
  const rapidResponsePattern =
    Boolean(input.response_present) &&
    typeof input.item_response_time_ms === "number" &&
    input.item_response_time_ms > 0 &&
    input.item_response_time_ms < 3_000;
  const interpretationCautions = [
    "Process data are contextual evidence about participation and evidence sufficiency, not misconduct evidence.",
    "AI-assistance signals are not cheating labels and require human interpretation before any stronger claim."
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
  const engagementSignal: z.infer<typeof EngagementCategorySchema> = !input.response_present
    ? "insufficient_process_evidence"
    : rapidResponsePattern && sparseReasoning
      ? "disengaged"
      : idkMarked && sparseReasoning
        ? "moderately_engaged"
        : reasoningLengthBand === "medium" || reasoningLengthBand === "long" || revisionCount > 0
          ? "engaged"
          : "moderately_engaged";

  const aiAssistanceSignal: z.infer<typeof AiAssistanceSignalSchema> = !input.process_instrumentation_available
    ? "insufficient_evidence"
    : pasteEventCount > 0 && focusLossCount > 0
      ? "likely_external_assistance_pattern"
      : pasteEventCount > 0 || focusLossCount > 1
        ? "possible_external_assistance_or_reference"
        : "none_indicated";

  const evidenceConfidence: z.infer<typeof EvidenceConfidenceSchema> = !input.process_instrumentation_available
    ? "low"
    : typingSummaryCount > 0 || focusLossCount > 0 || pasteEventCount > 0
      ? "medium"
      : "low";

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
    evidence_confidence: evidenceConfidence,
    interpretation_cautions: interpretationCautions,
    signal_notes: signalNotes
  });
}

function summarizeSessionEngagement(
  items: ItemEngagementEvidenceV1[]
): EngagementEvidencePacketV1["session_engagement_summary"] {
  const engagedCount = items.filter((item) => item.engagement_signal === "engaged").length;
  const disengagedCount = items.filter((item) => item.engagement_signal === "disengaged").length;
  const possibleAiCount = items.filter((item) =>
    item.ai_assistance_signal === "possible_external_assistance_or_reference" ||
    item.ai_assistance_signal === "likely_external_assistance_pattern"
  ).length;
  const insufficientProcessCount = items.filter(
    (item) => item.engagement_signal === "insufficient_process_evidence"
  ).length;
  const category: z.infer<typeof EngagementCategorySchema> = items.length === 0
    ? "insufficient_process_evidence"
    : insufficientProcessCount === items.length
      ? "insufficient_process_evidence"
      : disengagedCount >= 2
        ? "disengaged"
        : engagedCount >= Math.max(1, Math.ceil(items.length / 2))
          ? "engaged"
          : "moderately_engaged";
  const aiSignal: z.infer<typeof AiAssistanceSignalSchema> = items.length === 0
    ? "insufficient_evidence"
    : items.some((item) => item.ai_assistance_signal === "likely_external_assistance_pattern")
      ? "likely_external_assistance_pattern"
      : possibleAiCount > 0
        ? "possible_external_assistance_or_reference"
        : items.every((item) => item.ai_assistance_signal === "insufficient_evidence")
          ? "insufficient_evidence"
          : "none_indicated";
  const limitations = new Set<string>();

  if (items.some((item) => item.evidence_confidence === "low")) {
    limitations.add("engagement_evidence_confidence_low_for_some_items");
  }
  if (aiSignal !== "none_indicated") {
    limitations.add("ai_assistance_signal_requires_human_contextual_review");
  }
  limitations.add("process_data_must_not_be_used_as_direct_ability_evidence");

  return {
    provisional_engagement_category: category,
    category_confidence: items.some((item) => item.evidence_confidence === "medium") ? "medium" : "low",
    ai_assistance_signal: aiSignal,
    item_count: items.length,
    engaged_item_count: engagedCount,
    disengaged_item_count: disengagedCount,
    process_data_interpretation_policy:
      "Process data are contextual engagement and evidence-sufficiency signals. They are not misconduct evidence and do not directly determine ability.",
    limitations: [...limitations]
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
      no_ai_cheating_label: true,
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
    "item_stem"
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
    "student cheated",
    "cheating detected",
    "used genai",
    "answer key",
    "correct option",
    "distractor metadata",
    "raw reasoning",
    "clipboard content"
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
