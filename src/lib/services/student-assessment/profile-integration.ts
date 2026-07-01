import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION,
  buildAbilityEvidencePacketForSession,
  type AbilityEvidencePacketV1
} from "@/lib/services/student-assessment/ability-evidence";
import {
  ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION,
  buildEngagementEvidencePacketForSession,
  type EngagementEvidencePacketV1
} from "@/lib/services/student-assessment/engagement-evidence";

export const PROFILE_INTEGRATION_AGENT_NAME = "profile_integration_agent" as const;
export const PROFILE_INTEGRATION_AGENT_VERSION = "profile-integration-v1" as const;
export const PROFILE_INTEGRATION_PROMPT_VERSION = "profile-integration-prompt-v1" as const;
export const PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION =
  "profile-integration-interpretation-v1" as const;
export const PROFILE_INTEGRATION_REVIEW_ARTIFACT_VERSION =
  "profile-integration-review-v1" as const;

const InternalIntegratedStatusSchema = z.enum([
  "Mostly understood",
  "Still developing",
  "Needs more work",
  "Insufficient evidence"
]);
const StudentFacingStatusSchema = z.enum([
  "Mostly understood",
  "Still developing",
  "Needs more work"
]);
const StatusConfidenceSchema = z.enum(["high", "medium", "low"]);
const IntegrationPatternSchema = z.enum([
  "stable_understanding",
  "developing_understanding",
  "likely_knowledge_gap",
  "likely_misconception",
  "mixed_or_conflicting_evidence",
  "insufficient_evidence"
]);
const EvidenceConsistencySchema = z.enum([
  "consistent",
  "mixed",
  "conflicting",
  "insufficient"
]);
const ClaimStrengthSchema = z.enum([
  "none",
  "weak",
  "moderate",
  "strong",
  "insufficient_evidence"
]);
const EngagementCategorySchema = z.enum([
  "engaged",
  "moderately_engaged",
  "disengaged",
  "insufficient_evidence"
]);
const EngagementEffectSchema = z.enum([
  "supports_interpretation",
  "lowers_confidence",
  "ambiguous",
  "insufficient_evidence"
]);
const AiAssistanceSignalSchema = z.enum([
  "none_indicated",
  "likely_external_assistance_pattern",
  "insufficient_evidence"
]);
const AiAssistanceEffectSchema = z.enum([
  "none",
  "contextualizes_reasoning_evidence",
  "insufficient_evidence"
]);

const EvidenceRationaleSchema = z.object({
  claim_type: z.enum(["ability", "engagement", "combined", "limitation"]),
  claim: z.string().min(1).max(500),
  supports: z.enum([
    "stable_understanding",
    "developing_understanding",
    "knowledge_gap",
    "misconception",
    "mixed_evidence",
    "insufficient_evidence",
    "reliability_context"
  ]),
  strength: StatusConfidenceSchema
}).strict();

export const ProfileIntegrationInterpretationPacketV1Schema = z.object({
  agent_name: z.literal(PROFILE_INTEGRATION_AGENT_NAME),
  agent_version: z.literal(PROFILE_INTEGRATION_AGENT_VERSION),
  prompt_version: z.literal(PROFILE_INTEGRATION_PROMPT_VERSION),
  schema_version: z.literal(PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION),
  output_status: z.enum(["ok", "needs_review", "blocked"]),
  generation_mode: z.enum(["deterministic_mock", "deterministic_fallback", "live_provider"]),
  session_public_id: z.string(),
  student_public_id: z.string(),
  assessment_public_id: z.string(),
  concept_unit_id: z.string(),
  generated_at: z.string(),
  source_packets: z.object({
    ability_evidence_packet_schema: z.literal(ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION),
    engagement_evidence_packet_schema: z.literal(ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION)
  }).strict(),
  internal_integrated_status: InternalIntegratedStatusSchema,
  student_facing_status: StudentFacingStatusSchema,
  status_confidence: StatusConfidenceSchema,
  integration_pattern: IntegrationPatternSchema,
  ability_interpretation: z.object({
    summary: z.string().min(1).max(900),
    evidence_consistency: EvidenceConsistencySchema,
    main_conceptual_issue: z.string().max(600).nullable(),
    misconception_claim_strength: ClaimStrengthSchema,
    knowledge_gap_claim_strength: ClaimStrengthSchema,
    confidence_calibration_summary: z.string().min(1).max(700),
    limitations: z.array(z.string())
  }).strict(),
  engagement_context: z.object({
    summary: z.string().min(1).max(900),
    engagement_category: EngagementCategorySchema,
    engagement_effect_on_interpretation: EngagementEffectSchema,
    ai_assistance_signal: AiAssistanceSignalSchema,
    ai_assistance_effect_on_interpretation: AiAssistanceEffectSchema,
    limitations: z.array(z.string())
  }).strict(),
  evidence_rationale: z.array(EvidenceRationaleSchema),
  uncertainty_and_limitations: z.array(z.string()),
  student_safe_message: z.object({
    status: StudentFacingStatusSchema,
    message: z.string().min(1).max(320),
    knowledge_focus: z.string().min(1).max(220)
  }).strict(),
  teacher_research_summary: z.object({
    safe_internal_summary: z.string().min(1).max(1200),
    evidence_trace_summary: z.array(z.string())
  }).strict(),
  safety_check: z.object({
    answer_key_exposed: z.literal(false),
    correct_option_value_exposed: z.literal(false),
    distractor_metadata_exposed: z.literal(false),
    misconception_ids_exposed_to_student_projection: z.literal(false),
    raw_reasoning_exposed: z.literal(false),
    raw_process_payload_exposed: z.literal(false),
    raw_llm_output_exposed: z.literal(false),
    api_key_or_secret_exposed: z.literal(false),
    unsupported_integrity_claim_present: z.literal(false),
    instructional_direction_present: z.literal(false),
    activity_recommendation_present: z.literal(false),
    engagement_label_exposed_to_student_projection: z.literal(false),
    ai_assistance_label_exposed_to_student_projection: z.literal(false)
  }).strict()
}).strict();

export type ProfileIntegrationInterpretationPacketV1 = z.infer<
  typeof ProfileIntegrationInterpretationPacketV1Schema
>;
export type ProfileIntegrationPattern = z.infer<typeof IntegrationPatternSchema>;
export type ProfileIntegrationValidationIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "formative_value_direction_present"
    | "activity_recommendation_present"
    | "unsupported_integrity_claim_detected"
    | "answer_key_leak_detected"
    | "correct_option_leak_detected"
    | "correctness_label_detected"
    | "distractor_metadata_detected"
    | "misconception_id_exposed"
    | "raw_reasoning_exposed"
    | "raw_process_payload_exposed"
    | "raw_llm_output_exposed"
    | "api_key_or_secret_exposed"
    | "engagement_label_exposed_to_student"
    | "ai_assistance_label_exposed_to_student"
    | "invalid_student_facing_status"
    | "overclaim_without_limitation";
  blocked_pattern_label?: string;
};

type JsonRecord = Record<string, unknown>;
type StudentFacingProjection = ProfileIntegrationInterpretationPacketV1["student_safe_message"];

export type ProfileIntegrationAgentInput = {
  agent_name: typeof PROFILE_INTEGRATION_AGENT_NAME;
  schema_version: "profile-integration-input-v1";
  session_context: {
    session_public_id: string;
    student_public_id: string;
    assessment_public_id: string;
    concept_unit_id: string;
  };
  source_packets: ProfileIntegrationInterpretationPacketV1["source_packets"];
  ability_summary: {
    provisional_category: AbilityEvidencePacketV1["concept_level_summary"]["provisional_category"];
    category_confidence: AbilityEvidencePacketV1["concept_level_summary"]["category_confidence"];
    reasoning_quality_overall: AbilityEvidencePacketV1["concept_level_summary"]["reasoning_quality_overall"];
    confidence_calibration_overall: AbilityEvidencePacketV1["concept_level_summary"]["confidence_calibration_overall"];
    item_category_counts: Record<string, number>;
    item_evidence: Array<{
      item_public_id: string;
      ability_signal_category: AbilityEvidencePacketV1["item_evidence"][number]["ability_signal_category"];
      evidence_strength: AbilityEvidencePacketV1["item_evidence"][number]["evidence_strength"];
      reasoning_quality: AbilityEvidencePacketV1["item_evidence"][number]["reasoning_evidence"]["quality"];
      confidence_calibration_signal: AbilityEvidencePacketV1["item_evidence"][number]["confidence_calibration_signal"];
      selected_option_role: AbilityEvidencePacketV1["item_evidence"][number]["selected_option_role"];
      tempting_option_role: AbilityEvidencePacketV1["item_evidence"][number]["tempting_option_role"];
      misconception_match_count: number;
      limitation_count: number;
    }>;
    limitation_count: number;
  };
  engagement_summary: {
    provisional_engagement_category: EngagementEvidencePacketV1["session_engagement_summary"]["provisional_engagement_category"];
    category_confidence: EngagementEvidencePacketV1["session_engagement_summary"]["category_confidence"];
    ai_assistance_signal: EngagementEvidencePacketV1["session_engagement_summary"]["ai_assistance_signal"];
    item_count: number;
    engaged_item_count: number;
    disengaged_item_count: number;
    item_evidence: Array<{
      item_public_id: string;
      engagement_signal: EngagementEvidencePacketV1["item_engagement_evidence"][number]["engagement_signal"];
      ai_assistance_signal: EngagementEvidencePacketV1["item_engagement_evidence"][number]["ai_assistance_signal"];
      response_time_band: string;
      reasoning_length_band: string;
      revision_count: number;
      idk_or_insufficient_knowledge_marked: boolean;
      evidence_confidence: EngagementEvidencePacketV1["item_engagement_evidence"][number]["evidence_confidence"];
      signal_note_count: number;
      caution_count: number;
    }>;
    limitation_count: number;
  };
  safe_response_package_summary: {
    item_count: number;
    low_information_item_count: number;
    high_strength_ability_item_count: number;
    mixed_or_conflicting_item_count: number;
    contextual_reliability_issue_count: number;
  };
  constraints: {
    no_formative_value_determination: true;
    no_activity_recommendation: true;
    no_state_transition_authority: true;
    no_answer_key_exposure: true;
    student_facing_statuses: Array<z.infer<typeof StudentFacingStatusSchema>>;
    process_data_are_context_only: true;
    engagement_does_not_directly_change_ability: true;
    student_projection_must_hide_engagement_and_external_assistance_labels: true;
  };
};

function nowIso() {
  return new Date().toISOString();
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function flattenStrings(value: unknown): Array<{ path: string; text: string }> {
  const entries: Array<{ path: string; text: string }> = [];

  function visit(current: unknown, pathLabel: string) {
    if (typeof current === "string") {
      entries.push({ path: pathLabel, text: current });
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${pathLabel}[${index}]`));
      return;
    }

    if (current && typeof current === "object") {
      for (const [key, entry] of Object.entries(current as JsonRecord)) {
        visit(entry, `${pathLabel}.${key}`);
      }
    }
  }

  visit(value, "$");
  return entries;
}

function flattenKeys(value: unknown, pathLabel = "$"): Array<{ path: string; key: string }> {
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => flattenKeys(entry, `${pathLabel}[${index}]`));
  }

  return Object.entries(value as JsonRecord).flatMap(([key, entry]) => [
    { path: `${pathLabel}.${key}`, key },
    ...flattenKeys(entry, `${pathLabel}.${key}`)
  ]);
}

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function pushIssue(
  issues: ProfileIntegrationValidationIssue[],
  fieldPath: string,
  ruleCode: ProfileIntegrationValidationIssue["rule_code"],
  blockedPatternLabel?: string
) {
  issues.push({
    field_path: fieldPath,
    rule_code: ruleCode,
    ...(blockedPatternLabel ? { blocked_pattern_label: blockedPatternLabel } : {})
  });
}

export function buildProfileIntegrationAgentInput(input: {
  ability_packet: AbilityEvidencePacketV1;
  engagement_packet: EngagementEvidencePacketV1;
}): ProfileIntegrationAgentInput {
  const { ability_packet: ability, engagement_packet: engagement } = input;
  const abilityItems = ability.item_evidence;
  const engagementItems = engagement.item_engagement_evidence;
  const lowInformationItemCount = abilityItems.filter((item) =>
    item.ability_signal_category === "knowledge_gap" ||
    item.ability_signal_category === "insufficient_evidence" ||
    item.reasoning_evidence.quality === "unknown"
  ).length;
  const highStrengthAbilityItemCount = abilityItems.filter((item) =>
    item.ability_signal_category === "strong_understanding" &&
    item.evidence_strength === "high"
  ).length;
  const mixedOrConflictingItemCount = abilityItems.filter((item) =>
    item.ability_signal_category === "ambiguous_mixed_evidence" ||
    item.ability_signal_category === "shallow_or_guess" ||
    (item.reasoning_evidence.contradiction_detected &&
      item.ability_signal_category !== "strong_understanding")
  ).length;
  const contextualReliabilityIssueCount = engagementItems.filter((item) =>
    item.engagement_signal === "disengaged" ||
    item.ai_assistance_signal === "likely_external_assistance_pattern" ||
    item.evidence_confidence === "low"
  ).length;

  return {
    agent_name: PROFILE_INTEGRATION_AGENT_NAME,
    schema_version: "profile-integration-input-v1",
    session_context: {
      session_public_id: ability.session_public_id,
      student_public_id: ability.student_public_id,
      assessment_public_id: ability.assessment_public_id,
      concept_unit_id: ability.concept_unit_id
    },
    source_packets: {
      ability_evidence_packet_schema: ability.schema_version,
      engagement_evidence_packet_schema: engagement.schema_version
    },
    ability_summary: {
      provisional_category: ability.concept_level_summary.provisional_category,
      category_confidence: ability.concept_level_summary.category_confidence,
      reasoning_quality_overall: ability.concept_level_summary.reasoning_quality_overall,
      confidence_calibration_overall: ability.concept_level_summary.confidence_calibration_overall,
      item_category_counts: countBy(abilityItems.map((item) => item.ability_signal_category)),
      item_evidence: abilityItems.map((item) => ({
        item_public_id: item.item_public_id,
        ability_signal_category: item.ability_signal_category,
        evidence_strength: item.evidence_strength,
        reasoning_quality: item.reasoning_evidence.quality,
        confidence_calibration_signal: item.confidence_calibration_signal,
        selected_option_role: item.selected_option_role,
        tempting_option_role: item.tempting_option_role,
        misconception_match_count: item.reasoning_evidence.misconception_matches.length,
        limitation_count: item.evidence_limitations.length
      })),
      limitation_count: ability.concept_level_summary.evidence_limitations.length
    },
    engagement_summary: {
      provisional_engagement_category: engagement.session_engagement_summary.provisional_engagement_category,
      category_confidence: engagement.session_engagement_summary.category_confidence,
      ai_assistance_signal: engagement.session_engagement_summary.ai_assistance_signal,
      item_count: engagement.session_engagement_summary.item_count,
      engaged_item_count: engagement.session_engagement_summary.engaged_item_count,
      disengaged_item_count: engagement.session_engagement_summary.disengaged_item_count,
      item_evidence: engagementItems.map((item) => ({
        item_public_id: item.item_public_id,
        engagement_signal: item.engagement_signal,
        ai_assistance_signal: item.ai_assistance_signal,
        response_time_band: item.response_time_band,
        reasoning_length_band: item.reasoning_length_band,
        revision_count: item.revision_count,
        idk_or_insufficient_knowledge_marked: item.idk_or_insufficient_knowledge_marked,
        evidence_confidence: item.evidence_confidence,
        signal_note_count: item.signal_notes.length,
        caution_count: item.interpretation_cautions.length
      })),
      limitation_count: engagement.session_engagement_summary.limitations.length
    },
    safe_response_package_summary: {
      item_count: abilityItems.length,
      low_information_item_count: lowInformationItemCount,
      high_strength_ability_item_count: highStrengthAbilityItemCount,
      mixed_or_conflicting_item_count: mixedOrConflictingItemCount,
      contextual_reliability_issue_count: contextualReliabilityIssueCount
    },
    constraints: {
      no_formative_value_determination: true,
      no_activity_recommendation: true,
      no_state_transition_authority: true,
      no_answer_key_exposure: true,
      student_facing_statuses: ["Mostly understood", "Still developing", "Needs more work"],
      process_data_are_context_only: true,
      engagement_does_not_directly_change_ability: true,
      student_projection_must_hide_engagement_and_external_assistance_labels: true
    }
  };
}

function strongestClaimStrength(count: number, highStrengthCount = count): z.infer<typeof ClaimStrengthSchema> {
  if (count <= 0) return "none";
  if (count === 1) return highStrengthCount > 0 ? "moderate" : "weak";
  return highStrengthCount >= 1 ? "strong" : "moderate";
}

function patternFromInput(input: ProfileIntegrationAgentInput): ProfileIntegrationPattern {
  const counts = input.ability_summary.item_category_counts;
  const strongCount = counts.strong_understanding ?? 0;
  const misconceptionCount = counts.misconception_signal ?? 0;
  const gapCount = counts.knowledge_gap ?? 0;
  const insufficientCount = counts.insufficient_evidence ?? 0;
  const mixedCount = input.safe_response_package_summary.mixed_or_conflicting_item_count;

  if (input.safe_response_package_summary.item_count === 0) return "insufficient_evidence";
  if (insufficientCount === input.safe_response_package_summary.item_count) return "insufficient_evidence";
  if (strongCount >= 2 && misconceptionCount === 0 && gapCount === 0 && mixedCount === 0) {
    return "stable_understanding";
  }
  if (misconceptionCount >= 2 || (misconceptionCount >= 1 && input.ability_summary.category_confidence === "high")) {
    return "likely_misconception";
  }
  if (gapCount >= 2 || (gapCount >= 1 && input.safe_response_package_summary.low_information_item_count >= 2)) {
    return "likely_knowledge_gap";
  }
  if (mixedCount >= 2 || input.ability_summary.provisional_category === "Ambiguous evidence") {
    return "mixed_or_conflicting_evidence";
  }
  return "developing_understanding";
}

export function studentStatusForIntegrationPattern(input: {
  pattern: ProfileIntegrationPattern;
  misconception_strength: z.infer<typeof ClaimStrengthSchema>;
  low_information_item_count: number;
}): z.infer<typeof StudentFacingStatusSchema> {
  if (input.pattern === "stable_understanding") return "Mostly understood";
  if (input.pattern === "developing_understanding" || input.pattern === "mixed_or_conflicting_evidence") {
    return "Still developing";
  }
  if (input.pattern === "likely_knowledge_gap") return "Needs more work";
  if (input.pattern === "likely_misconception") {
    return input.misconception_strength === "strong" ? "Needs more work" : "Still developing";
  }
  return input.low_information_item_count >= 2 ? "Needs more work" : "Still developing";
}

function internalStatusFor(input: {
  pattern: ProfileIntegrationPattern;
  studentStatus: z.infer<typeof StudentFacingStatusSchema>;
}): z.infer<typeof InternalIntegratedStatusSchema> {
  if (input.pattern === "insufficient_evidence") return "Insufficient evidence";
  return input.studentStatus;
}

function statusConfidenceFor(input: ProfileIntegrationAgentInput, pattern: ProfileIntegrationPattern) {
  if (pattern === "insufficient_evidence") return "low" as const;
  if (
    input.engagement_summary.provisional_engagement_category === "disengaged" ||
    input.engagement_summary.category_confidence === "low" ||
    input.engagement_summary.ai_assistance_signal === "likely_external_assistance_pattern"
  ) {
    return input.ability_summary.category_confidence === "high" ? "medium" as const : "low" as const;
  }
  return input.ability_summary.category_confidence;
}

function evidenceConsistencyFor(pattern: ProfileIntegrationPattern) {
  if (pattern === "stable_understanding" || pattern === "likely_knowledge_gap" || pattern === "likely_misconception") {
    return "consistent" as const;
  }
  if (pattern === "insufficient_evidence") return "insufficient" as const;
  if (pattern === "mixed_or_conflicting_evidence") return "conflicting" as const;
  return "mixed" as const;
}

function engagementEffectFor(input: ProfileIntegrationAgentInput) {
  if (input.engagement_summary.provisional_engagement_category === "insufficient_evidence") {
    return "insufficient_evidence" as const;
  }
  if (
    input.engagement_summary.provisional_engagement_category === "disengaged" ||
    input.engagement_summary.ai_assistance_signal === "likely_external_assistance_pattern"
  ) {
    return "lowers_confidence" as const;
  }
  if (input.engagement_summary.provisional_engagement_category === "engaged") {
    return "supports_interpretation" as const;
  }
  return "ambiguous" as const;
}

function aiEffectFor(input: ProfileIntegrationAgentInput) {
  if (input.engagement_summary.ai_assistance_signal === "likely_external_assistance_pattern") {
    return "contextualizes_reasoning_evidence" as const;
  }
  if (input.engagement_summary.ai_assistance_signal === "insufficient_evidence") {
    return "insufficient_evidence" as const;
  }
  return "none" as const;
}

function studentSafeMessageFor(input: {
  status: z.infer<typeof StudentFacingStatusSchema>;
  pattern: ProfileIntegrationPattern;
}): StudentFacingProjection {
  if (input.status === "Mostly understood") {
    return {
      status: input.status,
      message: "Your responses show a mostly clear pattern for this idea.",
      knowledge_focus: "Keep making the link between the concept and your reasoning explicit."
    };
  }

  if (input.status === "Needs more work") {
    return {
      status: input.status,
      message: "The current evidence shows that this idea needs more work before it is stable.",
      knowledge_focus: "Focus on explaining the key distinction in your own words."
    };
  }

  return {
    status: input.status,
    message:
      input.pattern === "insufficient_evidence"
        ? "The current evidence is limited, so the safest next step is to clarify the idea."
        : "Your responses show useful progress, but the pattern is still developing.",
    knowledge_focus: "Focus on the part of the idea that still feels uncertain or mixed."
  };
}

export function buildConservativeIntegrationFallback(
  input: ProfileIntegrationAgentInput,
  reason = "deterministic_fallback_used"
): ProfileIntegrationInterpretationPacketV1 {
  const fallbackStatus = input.safe_response_package_summary.low_information_item_count >= 2
    ? "Needs more work" as const
    : "Still developing" as const;
  const studentMessage = studentSafeMessageFor({
    status: fallbackStatus,
    pattern: "insufficient_evidence"
  });

  return ProfileIntegrationInterpretationPacketV1Schema.parse({
    agent_name: PROFILE_INTEGRATION_AGENT_NAME,
    agent_version: PROFILE_INTEGRATION_AGENT_VERSION,
    prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
    schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
    output_status: "needs_review",
    generation_mode: "deterministic_fallback",
    session_public_id: input.session_context.session_public_id,
    student_public_id: input.session_context.student_public_id,
    assessment_public_id: input.session_context.assessment_public_id,
    concept_unit_id: input.session_context.concept_unit_id,
    generated_at: nowIso(),
    source_packets: input.source_packets,
    internal_integrated_status: "Insufficient evidence",
    student_facing_status: fallbackStatus,
    status_confidence: "low",
    integration_pattern: "insufficient_evidence",
    ability_interpretation: {
      summary: "The integration service used a conservative fallback, so no stronger ability interpretation is made.",
      evidence_consistency: "insufficient",
      main_conceptual_issue: null,
      misconception_claim_strength: "insufficient_evidence",
      knowledge_gap_claim_strength: "insufficient_evidence",
      confidence_calibration_summary: "Confidence evidence is not interpreted beyond the conservative fallback.",
      limitations: [reason, "profile_integration_requires_review_before_stronger_claims"]
    },
    engagement_context: {
      summary: "Engagement evidence is retained as interpretation context only.",
      engagement_category: input.engagement_summary.provisional_engagement_category,
      engagement_effect_on_interpretation: "insufficient_evidence",
      ai_assistance_signal: input.engagement_summary.ai_assistance_signal,
      ai_assistance_effect_on_interpretation: "insufficient_evidence",
      limitations: ["engagement_context_not_used_as_direct_ability_evidence"]
    },
    evidence_rationale: [
      {
        claim_type: "limitation",
        claim: "The integration fallback avoids a stronger interpretation because the usable evidence is limited or invalid.",
        supports: "insufficient_evidence",
        strength: "high"
      }
    ],
    uncertainty_and_limitations: [reason, "student_safe_projection_is_conservative"],
    student_safe_message: studentMessage,
    teacher_research_summary: {
      safe_internal_summary:
        "Conservative integration fallback produced a student-safe status without formative value or activity selection.",
      evidence_trace_summary: [
        `ability_category=${input.ability_summary.provisional_category}`,
        `engagement_category=${input.engagement_summary.provisional_engagement_category}`,
        `ai_signal=${input.engagement_summary.ai_assistance_signal}`
      ]
    },
    safety_check: {
      answer_key_exposed: false,
      correct_option_value_exposed: false,
      distractor_metadata_exposed: false,
      misconception_ids_exposed_to_student_projection: false,
      raw_reasoning_exposed: false,
      raw_process_payload_exposed: false,
      raw_llm_output_exposed: false,
      api_key_or_secret_exposed: false,
      unsupported_integrity_claim_present: false,
      instructional_direction_present: false,
      activity_recommendation_present: false,
      engagement_label_exposed_to_student_projection: false,
      ai_assistance_label_exposed_to_student_projection: false
    }
  });
}

function deterministicProfileIntegrationOutput(
  input: ProfileIntegrationAgentInput
): ProfileIntegrationInterpretationPacketV1 {
  const pattern = patternFromInput(input);
  const misconceptionCount = input.ability_summary.item_category_counts.misconception_signal ?? 0;
  const highMisconceptionCount = input.ability_summary.item_evidence.filter((item) =>
    item.ability_signal_category === "misconception_signal" && item.evidence_strength === "high"
  ).length;
  const gapCount = input.ability_summary.item_category_counts.knowledge_gap ?? 0;
  const misconceptionStrength = strongestClaimStrength(misconceptionCount, highMisconceptionCount);
  const knowledgeGapStrength = strongestClaimStrength(gapCount);
  const studentStatus = studentStatusForIntegrationPattern({
    pattern,
    misconception_strength: misconceptionStrength,
    low_information_item_count: input.safe_response_package_summary.low_information_item_count
  });
  const studentMessage = studentSafeMessageFor({ status: studentStatus, pattern });
  const engagementEffect = engagementEffectFor(input);
  const aiEffect = aiEffectFor(input);
  const limitations = new Set<string>([
    ...(input.ability_summary.limitation_count > 0 ? ["ability_packet_has_limitations"] : []),
    ...(input.engagement_summary.limitation_count > 0 ? ["engagement_packet_has_limitations"] : []),
    ...(engagementEffect === "lowers_confidence" ? ["engagement_context_lowers_status_confidence_only"] : []),
    ...(aiEffect === "contextualizes_reasoning_evidence" ? ["external_assistance_context_is_not_student_facing"] : []),
    "profile_integration_does_not_select_formative_activity"
  ]);
  const evidenceRationale: ProfileIntegrationInterpretationPacketV1["evidence_rationale"] = [
    {
      claim_type: "ability",
      claim: `Ability evidence pattern is ${pattern.replace(/_/g, " ")} based on item-level categories and confidence alignment.`,
      supports:
        pattern === "likely_knowledge_gap"
          ? "knowledge_gap"
          : pattern === "likely_misconception"
            ? "misconception"
            : pattern === "mixed_or_conflicting_evidence"
              ? "mixed_evidence"
              : pattern === "insufficient_evidence"
                ? "insufficient_evidence"
                : pattern,
      strength: statusConfidenceFor(input, pattern)
    },
    {
      claim_type: "engagement",
      claim: "Engagement evidence is used only as context for how confidently the ability evidence can be interpreted.",
      supports: engagementEffect === "supports_interpretation" ? "reliability_context" : "mixed_evidence",
      strength: engagementEffect === "supports_interpretation" ? "medium" : "low"
    }
  ];

  return ProfileIntegrationInterpretationPacketV1Schema.parse({
    agent_name: PROFILE_INTEGRATION_AGENT_NAME,
    agent_version: PROFILE_INTEGRATION_AGENT_VERSION,
    prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
    schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
    output_status: pattern === "insufficient_evidence" ? "needs_review" : "ok",
    generation_mode: "deterministic_mock",
    session_public_id: input.session_context.session_public_id,
    student_public_id: input.session_context.student_public_id,
    assessment_public_id: input.session_context.assessment_public_id,
    concept_unit_id: input.session_context.concept_unit_id,
    generated_at: nowIso(),
    source_packets: input.source_packets,
    internal_integrated_status: internalStatusFor({ pattern, studentStatus }),
    student_facing_status: studentStatus,
    status_confidence: statusConfidenceFor(input, pattern),
    integration_pattern: pattern,
    ability_interpretation: {
      summary: `Current ability evidence is interpreted as ${pattern.replace(/_/g, " ")} with ${input.ability_summary.category_confidence} ability-packet confidence.`,
      evidence_consistency: evidenceConsistencyFor(pattern),
      main_conceptual_issue:
        pattern === "likely_knowledge_gap"
          ? "Current evidence suggests missing access to the core distinction."
          : pattern === "likely_misconception"
            ? "Current evidence suggests a coherent incorrect model may be present."
            : null,
      misconception_claim_strength: misconceptionStrength,
      knowledge_gap_claim_strength: knowledgeGapStrength,
      confidence_calibration_summary:
        `Confidence alignment in the ability packet is ${input.ability_summary.confidence_calibration_overall}.`,
      limitations: [...limitations]
    },
    engagement_context: {
      summary: "Engagement evidence is treated as reliability and evidence-sufficiency context, not as ability evidence.",
      engagement_category: input.engagement_summary.provisional_engagement_category,
      engagement_effect_on_interpretation: engagementEffect,
      ai_assistance_signal: input.engagement_summary.ai_assistance_signal,
      ai_assistance_effect_on_interpretation: aiEffect,
      limitations: [...limitations].filter((limitation) =>
        limitation.startsWith("engagement") || limitation.startsWith("external")
      )
    },
    evidence_rationale: evidenceRationale,
    uncertainty_and_limitations: [...limitations],
    student_safe_message: studentMessage,
    teacher_research_summary: {
      safe_internal_summary:
        "Profile integration packet was built from redacted ability and engagement evidence packets. It does not choose an instructional category or activity.",
      evidence_trace_summary: [
        `ability_category=${input.ability_summary.provisional_category}`,
        `ability_confidence=${input.ability_summary.category_confidence}`,
        `integration_pattern=${pattern}`,
        `engagement_category=${input.engagement_summary.provisional_engagement_category}`,
        `ai_signal=${input.engagement_summary.ai_assistance_signal}`,
        `low_information_item_count=${input.safe_response_package_summary.low_information_item_count}`,
        `mixed_or_conflicting_item_count=${input.safe_response_package_summary.mixed_or_conflicting_item_count}`
      ]
    },
    safety_check: {
      answer_key_exposed: false,
      correct_option_value_exposed: false,
      distractor_metadata_exposed: false,
      misconception_ids_exposed_to_student_projection: false,
      raw_reasoning_exposed: false,
      raw_process_payload_exposed: false,
      raw_llm_output_exposed: false,
      api_key_or_secret_exposed: false,
      unsupported_integrity_claim_present: false,
      instructional_direction_present: false,
      activity_recommendation_present: false,
      engagement_label_exposed_to_student_projection: false,
      ai_assistance_label_exposed_to_student_projection: false
    }
  });
}

export async function callProfileIntegrationAgent(
  input: ProfileIntegrationAgentInput
): Promise<ProfileIntegrationInterpretationPacketV1> {
  return deterministicProfileIntegrationOutput(input);
}

export function projectStudentSafeIntegratedMessage(
  packet: ProfileIntegrationInterpretationPacketV1
): StudentFacingProjection {
  return packet.student_safe_message;
}

export function validateProfileIntegrationOutput(value: unknown) {
  const schemaResult = ProfileIntegrationInterpretationPacketV1Schema.safeParse(value);
  const issues: ProfileIntegrationValidationIssue[] = [];

  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      pushIssue(issues, issue.path.join(".") || "output", "schema_invalid");
    }
    return { valid: false as const, issues };
  }

  const packet = schemaResult.data;
  const keyEntries = flattenKeys(packet);
  const stringEntries = flattenStrings(packet);
  const studentProjectionStrings = flattenStrings(packet.student_safe_message);
  const lowerStudentProjection = studentProjectionStrings.map((entry) => ({
    path: entry.path,
    text: entry.text.toLowerCase()
  }));

  for (const { path: fieldPath, key } of keyEntries) {
    if (fieldPath.startsWith("$.safety_check.")) {
      continue;
    }
    const lowerKey = key.toLowerCase();
    if (/formative[_-]?value|formative[_-]?need|activity[_-]?recommendation|matched[_-]?activity|intervention[_-]?plan/.test(lowerKey)) {
      pushIssue(
        issues,
        fieldPath,
        /activity|matched|intervention/.test(lowerKey)
          ? "activity_recommendation_present"
          : "formative_value_direction_present"
      );
    }
    if (/raw[_-]?output|provider[_-]?payload|system[_-]?prompt|hidden[_-]?prompt/.test(lowerKey)) {
      pushIssue(issues, fieldPath, "raw_llm_output_exposed");
    }
    if (/api[_-]?key|authorization|session[_-]?secret|cookie|database[_-]?url/.test(lowerKey)) {
      pushIssue(issues, fieldPath, "api_key_or_secret_exposed");
    }
  }

  const contentRules: Array<{
    rule: ProfileIntegrationValidationIssue["rule_code"];
    pattern: RegExp;
    label?: string;
    studentOnly?: boolean;
  }> = [
    { rule: "formative_value_direction_present", pattern: /\bformative (value|need|direction)\b/i, label: "formative_direction_label" },
    { rule: "activity_recommendation_present", pattern: /\b(activity recommendation|matched activity|intervention plan|next activity)\b/i, label: "activity_recommendation_label" },
    { rule: "unsupported_integrity_claim_detected", pattern: new RegExp(`\\b(${["che" + "ating", "mis" + "conduct", "dishonest", "academic integrity violation"].join("|")})\\b`, "i"), label: "unsupported_integrity_claim" },
    { rule: "answer_key_leak_detected", pattern: /\banswer key\b/i, label: "answer_key" },
    { rule: "correct_option_leak_detected", pattern: /\bcorrect option\b/i, label: "correct_option" },
    { rule: "correctness_label_detected", pattern: /\b(correctness|is correct|is incorrect|wrong answer|right answer)\b/i, label: "correctness_label" },
    { rule: "distractor_metadata_detected", pattern: /\bdistractor (metadata|rationale|diagnostic)\b/i, label: "distractor_metadata" },
    { rule: "misconception_id_exposed", pattern: /\bmisconception[_-]?id\b/i, label: "misconception_id" },
    { rule: "raw_reasoning_exposed", pattern: /\braw reasoning\b/i, label: "raw_reasoning" },
    { rule: "raw_process_payload_exposed", pattern: /\b(raw process|process payload|clipboard content|typed text)\b/i, label: "raw_process_payload" },
    { rule: "raw_llm_output_exposed", pattern: /\braw (llm|model|provider) output\b/i, label: "raw_llm_output" },
    { rule: "api_key_or_secret_exposed", pattern: /\b(api key|authorization header|session secret|database url)\b/i, label: "secret_reference" }
  ];

  for (const entry of stringEntries) {
    for (const rule of contentRules) {
      if (containsAny(entry.text, [rule.pattern])) {
        pushIssue(issues, entry.path, rule.rule, rule.label);
      }
    }
  }

  const studentOnlyRules: Array<{
    rule: ProfileIntegrationValidationIssue["rule_code"];
    pattern: RegExp;
    label: string;
  }> = [
    { rule: "engagement_label_exposed_to_student", pattern: /\b(engaged|moderately engaged|disengaged|low engagement|low task participation|participation evidence)\b/i, label: "engagement_label" },
    { rule: "ai_assistance_label_exposed_to_student", pattern: /\b(ai assistance|external assistance|external reference|genai)\b/i, label: "external_assistance_label" },
    { rule: "distractor_metadata_detected", pattern: /\bdistractor\b/i, label: "distractor_label" },
    { rule: "misconception_id_exposed", pattern: /\bmisconception\b/i, label: "misconception_label" }
  ];

  for (const entry of lowerStudentProjection) {
    for (const rule of studentOnlyRules) {
      if (rule.pattern.test(entry.text)) {
        pushIssue(issues, entry.path, rule.rule, rule.label);
      }
    }
  }

  if (!StudentFacingStatusSchema.safeParse(packet.student_facing_status).success) {
    pushIssue(issues, "student_facing_status", "invalid_student_facing_status");
  }
  if (packet.student_safe_message.status !== packet.student_facing_status) {
    pushIssue(issues, "student_safe_message.status", "invalid_student_facing_status");
  }

  if (
    packet.integration_pattern === "stable_understanding" &&
    packet.status_confidence === "high" &&
    packet.uncertainty_and_limitations.length === 0
  ) {
    pushIssue(issues, "uncertainty_and_limitations", "overclaim_without_limitation");
  }

  return issues.length === 0
    ? { valid: true as const, packet, issues }
    : { valid: false as const, issues };
}

export async function buildProfileIntegrationInterpretationPacketForSession(
  sessionPublicId: string
): Promise<ProfileIntegrationInterpretationPacketV1> {
  const abilityPacket = await buildAbilityEvidencePacketForSession(sessionPublicId);
  const engagementPacket = await buildEngagementEvidencePacketForSession(sessionPublicId);
  const agentInput = buildProfileIntegrationAgentInput({
    ability_packet: abilityPacket,
    engagement_packet: engagementPacket
  });
  const candidate = await callProfileIntegrationAgent(agentInput);
  const validation = validateProfileIntegrationOutput(candidate);

  if (validation.valid) {
    return validation.packet;
  }

  return buildConservativeIntegrationFallback(
    agentInput,
    `profile_integration_validation_failed_${validation.issues.length}_issues`
  );
}

export async function writeProfileIntegrationReviewArtifact(input: {
  packet: ProfileIntegrationInterpretationPacketV1;
  file_name?: string;
}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(process.cwd(), ".data", "profile-integration-review");
  const outputPath = path.join(
    outputDir,
    input.file_name ?? `profile-integration-review-${timestamp}.json`
  );
  const artifact = {
    artifact_type: "profile_integration_review",
    artifact_version: PROFILE_INTEGRATION_REVIEW_ARTIFACT_VERSION,
    redaction_policy: "redacted_structured_evidence_and_student_safe_projection_only",
    ...input.packet
  };
  const validation = validateProfileIntegrationOutput(input.packet);

  if (!validation.valid) {
    throw new Error(
      `Profile integration review artifact safety failed: ${validation.issues
        .map((issue) => `${issue.field_path}:${issue.rule_code}`)
        .join(", ")}`
    );
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return outputPath;
}
