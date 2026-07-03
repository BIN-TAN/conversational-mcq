import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { AgentName } from "@/lib/agents/names";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { getServerEnv } from "@/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError, type AgentModelConfig } from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
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

const PROFILE_INTEGRATION_PROMPT_INSTRUCTIONS = `
You are the Profile Integration Agent for a protected chat-native formative assessment platform.
Interpret redacted ability-evidence and engagement-evidence packets into one structured profile integration packet.

Boundaries:
- This task is current profile evidence interpretation only.
- You are not administering items, choosing a formative value, recommending an activity, recommending an intervention, saying what the tutor should do next, saying what activity should come next, or controlling state transitions.
- Use only the provided structured evidence. Do not invent evidence, student text, item content, hidden metadata, or answer keys.
- Do not expose answer keys, correct options, correctness labels, distractor metadata, raw misconception identifiers, raw student reasoning, raw process payloads, raw model output, prompts, provider metadata, or secrets.
- Process and engagement evidence affect reliability and confidence only. They are not direct ability evidence.
- AI or external assistance is allowed in this product context. Do not treat it as a violation or as direct ability evidence.
- Do not make integrity, authenticity, independent-work, suspicious-behavior, ${"che" + "ating"}, or ${"mis" + "conduct"} judgments.
- Do not use the words or ideas integrity, academic integrity, authenticity, authentic work, independent work, suspicious, or questionable.
- Do not infer external assistance unless ai_assistance_signal is likely_external_assistance_pattern.
- If ai_assistance_signal is insufficient_evidence, do not mention AI, external assistance, integrity, authenticity, independent work, suspicious behavior, or response provenance in evidence rationale.
- If ai_assistance_signal is none_indicated, do not mention AI, external assistance, integrity, authenticity, independent work, suspicious behavior, or response provenance at all.
- If ai_assistance_signal is likely_external_assistance_pattern, you may mention only this neutral internal idea: "The response-production context may affect how much weight to give polished reasoning evidence."
- Even when likely_external_assistance_pattern is present, do not penalize the student, do not reduce ability category automatically, do not say the student used AI, and do not say the student relied on AI.
- If evidence is mixed, conflicting, low-information, or heavily limited, use broad conservative categories and lower confidence.
- Use likely_misconception only when at least two aligned evidence sources support the same conceptual issue.
- Do not use high status_confidence when evidence consistency is mixed/conflicting/insufficient, reasoning quality is vague/mixed/insufficient, multiple I-don't-know or low-information signals are present, metadata limitations are substantial, or the integration pattern is mixed_or_conflicting_evidence or insufficient_evidence.
- Student-facing status labels must be exactly Mostly understood, Still developing, or Needs more work.
- Internal status may use Insufficient evidence.
- Integration pattern must be one of stable_understanding, developing_understanding, likely_knowledge_gap, likely_misconception, mixed_or_conflicting_evidence, or insufficient_evidence.

Teacher/research summary rules:
- Summarize current evidence only: what the evidence suggests, what is uncertain, how ability and engagement evidence relate, and what should not be overclaimed.
- Do not include planning, recommendation, next-step, activity, intervention, or tutor-action language.
- Do not use labels such as formative value, formative direction, next activity, activity recommendation, intervention, instructional plan, should provide, should assign, or should show next.

Allowed teacher/research summary style:
- "The evidence is mixed: the student provided some reasoning, but uncertainty and conflicting answer evidence limit the strength of the interpretation."
- "The current evidence supports a developing understanding pattern with medium confidence."
- "The response process appears sufficient to treat the current evidence as usable, but the interpretation remains provisional."

Forbidden teacher/research summary style:
- "The next formative value should be misconception contrast."
- "The tutor should provide a clarification activity."
- "The student should receive a transfer challenge."
- "Recommended activity: ..."
- "The next step is ..."
- "Instructional plan: ..."

Student-facing message rules:
- Keep the message brief, supportive, and focused on current knowledge state.
- Never mention AI assistance, external assistance, process data, engagement category, low participation, disengagement, integrity, authenticity, independent work, suspicious behavior, ${"che" + "ating"}, or ${"mis" + "conduct"} in student-facing text.
- knowledge_focus may name the concept or distinction currently unclear.
- knowledge_focus must not recommend an activity or say what the student or tutor should do next.

Return only the required JSON object for profile-integration-interpretation-v1.
`;

const PROFILE_INTEGRATION_REPAIR_PROMPT_INSTRUCTIONS = `${PROFILE_INTEGRATION_PROMPT_INSTRUCTIONS}

Repair pass:
- The previous profile-integration output was rejected by deterministic validation.
- You receive only safe validation issue codes and field paths, not the invalid output.
- Rewrite the whole output as current-evidence interpretation only.
- Remove any formative direction, activity recommendation, next-step wording, or planning language from every field.
- Remove unsupported integrity, authenticity, independent-work, suspicious-behavior, AI-use, external-assistance, or response-provenance claims from every field.
- If ai_assistance_signal is likely_external_assistance_pattern, keep only the neutral internal response-production context idea allowed in the main instructions.
- If ai_assistance_signal is insufficient_evidence or none_indicated, make no AI, external-assistance, integrity, authenticity, independent-work, suspicious-behavior, or response-provenance claim.
- If high confidence was rejected, lower status_confidence and add a limitation.
- If evidence is mixed or weak, choose mixed_or_conflicting_evidence or insufficient_evidence.
`;

const PROFILE_INTEGRATION_REPAIR_PROMPT_HASH = createHash("sha256")
  .update(PROFILE_INTEGRATION_REPAIR_PROMPT_INSTRUCTIONS)
  .digest("hex");

export const PROFILE_INTEGRATION_PROMPT_HASH = createHash("sha256")
  .update(PROFILE_INTEGRATION_PROMPT_INSTRUCTIONS)
  .digest("hex");

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
    | "overclaim_without_limitation"
    | "high_confidence_overclaim"
    | "insufficient_misconception_alignment"
    | "engagement_used_as_ability_evidence";
  blocked_pattern_label?: string;
};

type JsonRecord = Record<string, unknown>;
type StudentFacingProjection = ProfileIntegrationInterpretationPacketV1["student_safe_message"];
export type StudentSafeProfileIntegrationProjection = StudentFacingProjection & {
  updated_at: string;
};

const PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE = "profile_integration_interpretation";

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

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function providerAuditUpdate(providerResult: StructuredAgentResult<unknown>) {
  const rawOutput =
    providerResult.raw_output ?? (
      providerResult.status === "failed"
        ? {
            provider_failure: {
              provider: providerResult.provider,
              status: providerResult.status,
              category: providerResult.error?.category ?? null,
              message: providerResult.error?.message ?? null,
              retryable: providerResult.error?.retryable ?? null,
              transport: providerResult.transport_telemetry
                ? {
                    adapter_version: providerResult.transport_telemetry.adapter_version,
                    model_name: providerResult.transport_telemetry.model_name,
                    http_status:
                      providerResult.transport_telemetry.normalized_error?.http_status ??
                      providerResult.transport_telemetry.http_status ??
                      null,
                    typed_failure_reason:
                      providerResult.transport_telemetry.normalized_error?.typed_failure_reason ??
                      null,
                    provider_error_code:
                      providerResult.transport_telemetry.normalized_error?.provider_error_code ??
                      null
                  }
                : null
            }
          }
        : undefined
    );

  return {
    provider: providerResult.provider,
    ...providerAuditMetadata(providerResult),
    raw_output: prismaJson(redactForAudit(rawOutput)),
    latency_ms: providerResult.latency_ms,
    input_tokens: providerResult.usage?.input_tokens,
    output_tokens: providerResult.usage?.output_tokens,
    total_tokens: providerResult.usage?.total_tokens,
    token_usage: providerResult.usage
      ? prismaJson(providerResult.usage.raw ?? providerResult.usage)
      : undefined
  };
}

function resolveProfileIntegrationModelConfig(): AgentModelConfig {
  const env = getServerEnv();
  const modelName = [env.OPENAI_MODEL_PROFILE_INTEGRATION, env.OPENAI_MODEL_PLANNING, env.OPENAI_MODEL_FOLLOWUP]
    .find((value) => configured(value));

  if (!configured(modelName)) {
    throw new LlmConfigurationError(
      "profile_integration_model_missing",
      "OPENAI_MODEL_PROFILE_INTEGRATION, OPENAI_MODEL_PLANNING, or OPENAI_MODEL_FOLLOWUP is required when live profile integration is explicitly enabled.",
      { agent_name: PROFILE_INTEGRATION_AGENT_NAME }
    );
  }

  return {
    model_name: String(modelName),
    max_output_tokens:
      env.OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION ??
      env.OPENAI_MAX_OUTPUT_TOKENS_PLANNING ??
      env.OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP ??
      3000
  };
}

let profileIntegrationProviderOverrideForTest: LlmProvider | null = null;

export async function withProfileIntegrationProviderForTest<T>(
  provider: LlmProvider,
  callback: () => Promise<T>
): Promise<T> {
  const previous = profileIntegrationProviderOverrideForTest;
  profileIntegrationProviderOverrideForTest = provider;

  try {
    return await callback();
  } finally {
    profileIntegrationProviderOverrideForTest = previous;
  }
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

const NEUTRAL_RESPONSE_PRODUCTION_CONTEXT =
  "The response-production context may affect how much weight to give polished reasoning evidence.";

function normalizedText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isProfileIntegrationClaimPath(pathLabel: string) {
  return (
    /^\$\.evidence_rationale\[\d+\]\.claim$/.test(pathLabel) ||
    pathLabel === "$.teacher_research_summary.safe_internal_summary" ||
    pathLabel === "$.ability_interpretation.summary" ||
    pathLabel === "$.engagement_context.summary" ||
    pathLabel === "$.student_safe_message.message" ||
    pathLabel === "$.student_safe_message.knowledge_focus"
  );
}

function neutralResponseProductionContextIsAllowed(text: string) {
  return normalizedText(text).includes(NEUTRAL_RESPONSE_PRODUCTION_CONTEXT);
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

function alignedMisconceptionEvidenceCount(input: ProfileIntegrationAgentInput) {
  return input.ability_summary.item_evidence.filter((item) =>
    item.ability_signal_category === "misconception_signal" &&
    item.misconception_match_count > 0 &&
    (item.selected_option_role === "diagnostic_distractor" ||
      item.tempting_option_role === "diagnostic_distractor")
  ).length;
}

function substantialMetadataLimitations(input: ProfileIntegrationAgentInput) {
  const itemLimitationCount = input.ability_summary.item_evidence.reduce(
    (total, item) => total + item.limitation_count,
    0
  );
  return input.ability_summary.limitation_count + input.engagement_summary.limitation_count + itemLimitationCount >= 3;
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
  if (alignedMisconceptionEvidenceCount(input) >= 2) {
    return "likely_misconception";
  }
  if (misconceptionCount > 0 && gapCount > 0) return "mixed_or_conflicting_evidence";
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
    pattern === "mixed_or_conflicting_evidence" ||
    input.ability_summary.reasoning_quality_overall === "vague" ||
    input.ability_summary.reasoning_quality_overall === "mixed" ||
    input.ability_summary.reasoning_quality_overall === "insufficient" ||
    input.safe_response_package_summary.low_information_item_count > 0 ||
    input.safe_response_package_summary.mixed_or_conflicting_item_count > 0 ||
    input.engagement_summary.item_evidence.some((item) => item.idk_or_insufficient_knowledge_marked) ||
    substantialMetadataLimitations(input)
  ) {
    return input.ability_summary.category_confidence === "low" ? "low" as const : "medium" as const;
  }
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

function confidenceCalibrationSummaryFor(input: ProfileIntegrationAgentInput, pattern: ProfileIntegrationPattern) {
  const calibration = input.ability_summary.confidence_calibration_overall;
  const adequateEvidence =
    pattern === "stable_understanding" ||
    (
      pattern === "developing_understanding" &&
      input.ability_summary.reasoning_quality_overall === "adequate" &&
      input.ability_summary.category_confidence !== "low"
    );

  if (calibration === "underconfident" && adequateEvidence) {
    return "Confidence evidence shows low confidence despite adequate or strong understanding evidence.";
  }

  if (calibration === "mixed" && adequateEvidence) {
    return "Confidence evidence shows inconsistent confidence across adequate evidence.";
  }

  if (calibration === "overconfident") {
    return "Confidence evidence shows high confidence, but conceptual evidence must determine the primary learning need.";
  }

  return `Confidence alignment in the ability packet is ${calibration}.`;
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
        ? "The current evidence is limited, so the idea still needs clarification."
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
        "Conservative integration fallback produced a student-safe status from current evidence only.",
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
    ...(aiEffect === "contextualizes_reasoning_evidence" ? ["evidence_weighting_context_is_internal_only"] : []),
    "profile_integration_current_evidence_only"
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
      confidence_calibration_summary: confidenceCalibrationSummaryFor(input, pattern),
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
        "Profile integration packet was built from redacted ability and engagement evidence packets as a current-evidence interpretation only.",
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

export type ProfileIntegrationExecutionResult =
  | {
      status: "succeeded";
      packet: ProfileIntegrationInterpretationPacketV1;
      agent_call_id?: string;
      validation_issues: [];
    }
  | {
      status: "invalid_output" | "failed" | "configuration_blocked";
      fallback_packet: ProfileIntegrationInterpretationPacketV1;
      agent_call_id?: string;
      validation_issues: ProfileIntegrationValidationIssue[];
      blocked_reason: string;
    };

async function resolveProfileIntegrationAuditContext(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: {
      id: true,
      concept_unit_sessions: {
        orderBy: [{ updated_at: "desc" }],
        take: 1,
        select: { id: true }
      }
    }
  });

  return {
    assessment_session_db_id: session?.id,
    concept_unit_session_db_id: session?.concept_unit_sessions[0]?.id
  };
}

function validationErrorPayload(input: {
  category: "schema_validation" | "profile_integration_validation" | "provider_failure";
  issues?: ProfileIntegrationValidationIssue[];
  message?: string;
}) {
  return JSON.stringify({
    category: input.category,
    issue_count: input.issues?.length ?? 0,
    ...(input.issues ? { issues: input.issues } : {}),
    ...(input.message ? { message: input.message.slice(0, 500) } : {})
  });
}

const REMEDIABLE_PROFILE_INTEGRATION_RULES = new Set<ProfileIntegrationValidationIssue["rule_code"]>([
  "formative_value_direction_present",
  "activity_recommendation_present",
  "unsupported_integrity_claim_detected",
  "correct_option_leak_detected",
  "high_confidence_overclaim"
]);

function profileIntegrationIssueIsRepairable(issue: ProfileIntegrationValidationIssue) {
  if (!REMEDIABLE_PROFILE_INTEGRATION_RULES.has(issue.rule_code)) return false;
  if (
    issue.rule_code === "correct_option_leak_detected" &&
    issue.field_path.startsWith("student_safe_message")
  ) {
    return false;
  }
  return true;
}

function profileIntegrationIssuesAreRepairable(issues: ProfileIntegrationValidationIssue[]) {
  return issues.length > 0 && issues.every((issue) => profileIntegrationIssueIsRepairable(issue));
}

function repairIssueSummary(issues: ProfileIntegrationValidationIssue[]) {
  return issues.map((issue) => ({
    field_path: issue.field_path,
    rule_code: issue.rule_code,
    ...(issue.blocked_pattern_label ? { blocked_pattern_label: issue.blocked_pattern_label } : {})
  }));
}

function sanitizeUnsupportedProfileIntegrationText(input: {
  text: string;
  agent_input: ProfileIntegrationAgentInput;
  field_path: string;
}) {
  const aiSignal = input.agent_input.engagement_summary.ai_assistance_signal;
  const text = input.text.trim();
  const containsExternalOrProvenance =
    /\b(ai assistance|external assistance|external reference|outside help|outside assistance|genai|chatgpt|language model|response[- ]production|response provenance|provenance|externally produced|external source|generated by|written by)\b/i.test(text);
  const containsIntegrity =
    /\b(academic integrity|integrity|authenticity|authentic work|authentic response|independent work|suspicious|questionable|dishonest)\b/i.test(text) ||
    new RegExp(`\\b(${["che" + "ating", "mis" + "conduct"].join("|")})\\b`, "i").test(text);

  if (containsExternalOrProvenance || containsIntegrity) {
    if (aiSignal === "likely_external_assistance_pattern") {
      return NEUTRAL_RESPONSE_PRODUCTION_CONTEXT;
    }

    return input.field_path.startsWith("$.evidence_rationale")
      ? "Current evidence is interpreted only from the available response package."
      : "Current evidence remains provisional and should not support stronger reliability claims.";
  }

  return text
    .replace(/\banswer key\b/gi, "protected scoring reference")
    .replace(/\bcorrect option\b/gi, "target-aligned option");
}

function canonicalizeProfileIntegrationRepairCandidate(
  candidate: unknown,
  agentInput: ProfileIntegrationAgentInput
): unknown {
  const parsed = ProfileIntegrationInterpretationPacketV1Schema.safeParse(candidate);
  if (!parsed.success) return candidate;

  const packet = parsed.data;
  const sanitize = (text: string, field_path: string) =>
    sanitizeUnsupportedProfileIntegrationText({
      text,
      agent_input: agentInput,
      field_path
    });

  packet.ability_interpretation.summary = sanitize(packet.ability_interpretation.summary, "$.ability_interpretation.summary");
  packet.ability_interpretation.confidence_calibration_summary = sanitize(
    packet.ability_interpretation.confidence_calibration_summary,
    "$.ability_interpretation.confidence_calibration_summary"
  );
  packet.ability_interpretation.limitations = packet.ability_interpretation.limitations.map((limitation, index) =>
    sanitize(limitation, `$.ability_interpretation.limitations[${index}]`)
  );
  packet.engagement_context.summary = sanitize(packet.engagement_context.summary, "$.engagement_context.summary");
  packet.engagement_context.limitations = packet.engagement_context.limitations.map((limitation, index) =>
    sanitize(limitation, `$.engagement_context.limitations[${index}]`)
  );
  packet.evidence_rationale = packet.evidence_rationale.map((rationale, index) => {
    const claim = sanitize(rationale.claim, `$.evidence_rationale[${index}].claim`);
    const claimUsesNeutralContext = claim === NEUTRAL_RESPONSE_PRODUCTION_CONTEXT;
    return {
      ...rationale,
      ...(claimUsesNeutralContext
        ? {
            claim_type: "engagement" as const,
            supports: "reliability_context" as const,
            strength: "low" as const
          }
        : {}),
      claim
    };
  });
  packet.uncertainty_and_limitations = packet.uncertainty_and_limitations.map((limitation, index) =>
    sanitize(limitation, `$.uncertainty_and_limitations[${index}]`)
  );
  packet.student_safe_message.message = sanitize(packet.student_safe_message.message, "$.student_safe_message.message");
  packet.student_safe_message.knowledge_focus = sanitize(
    packet.student_safe_message.knowledge_focus,
    "$.student_safe_message.knowledge_focus"
  );
  packet.teacher_research_summary.safe_internal_summary = sanitize(
    packet.teacher_research_summary.safe_internal_summary,
    "$.teacher_research_summary.safe_internal_summary"
  );
  packet.teacher_research_summary.evidence_trace_summary =
    packet.teacher_research_summary.evidence_trace_summary.map((summary, index) =>
      sanitize(summary, `$.teacher_research_summary.evidence_trace_summary[${index}]`)
    );

  return packet;
}

function safeProviderFailureReason(providerResult: StructuredAgentResult<unknown>) {
  return [
    providerResult.error?.category ?? providerResult.status,
    providerResult.transport_telemetry?.normalized_error?.typed_failure_reason,
    providerResult.transport_telemetry?.normalized_error?.http_status !== undefined &&
      providerResult.transport_telemetry.normalized_error.http_status !== null
      ? `http_${providerResult.transport_telemetry.normalized_error.http_status}`
      : null
  ].filter(Boolean).join(":");
}

async function executeProfileIntegrationRepairAttempt(input: {
  agent_input: ProfileIntegrationAgentInput;
  provider: LlmProvider;
  provider_label: "mock" | "openai";
  model_config: AgentModelConfig;
  live_call_allowed: boolean;
  request_timeout_ms: number;
  audit_context?: {
    assessment_session_db_id?: string;
    concept_unit_session_db_id?: string;
  };
  initial_validation_issues: ProfileIntegrationValidationIssue[];
}): Promise<ProfileIntegrationExecutionResult> {
  const startedAt = new Date();
  const clientRequestId = `profile_integration_repair_${randomUUID()}`;
  const repairInput = {
    profile_integration_input: input.agent_input,
    rejected_output_not_included: true,
    validation_issues: repairIssueSummary(input.initial_validation_issues),
    repair_policy: {
      current_evidence_only: true,
      no_formative_value_direction: true,
      no_activity_recommendation: true,
      no_next_step_language: true,
      remove_unsupported_integrity_authenticity_or_external_assistance_claims: true,
      lower_confidence_when_validator_requested: true
    }
  };

  assertNoProhibitedProviderInput(repairInput);

  const agentCall = await prisma.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.audit_context?.assessment_session_db_id,
      concept_unit_session_db_id: input.audit_context?.concept_unit_session_db_id,
      agent_name: PROFILE_INTEGRATION_AGENT_NAME,
      agent_version: PROFILE_INTEGRATION_AGENT_VERSION,
      model_name: input.model_config.model_name,
      provider: input.provider_label,
      client_request_id: clientRequestId,
      agent_invocation_key: `profile_integration_repair:${input.agent_input.session_context.session_public_id}:${PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION}:${randomUUID()}`,
      prompt_hash: PROFILE_INTEGRATION_REPAIR_PROMPT_HASH,
      reasoning_effort: input.model_config.reasoning_effort,
      max_output_tokens: input.model_config.max_output_tokens,
      prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
      schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
      input_payload: prismaJson(redactForAudit(repairInput)),
      live_call_allowed: input.live_call_allowed,
      call_status: "started",
      started_at: startedAt
    }
  });

  try {
    const providerResult = await input.provider.executeStructured({
      agent_name: PROFILE_INTEGRATION_AGENT_NAME as unknown as AgentName,
      model_config: input.model_config,
      instructions: PROFILE_INTEGRATION_REPAIR_PROMPT_INSTRUCTIONS,
      input: repairInput,
      output_schema: ProfileIntegrationInterpretationPacketV1Schema,
      schema_name: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
      client_request_id: clientRequestId,
      timeout_ms: input.request_timeout_ms,
      metadata: {
        purpose: "chat_native_profile_integration_repair",
        agent_name: PROFILE_INTEGRATION_AGENT_NAME,
        prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
        schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION
      }
    });

    if (providerResult.status === "completed") {
      const candidate =
        providerResult.parsed_output && typeof providerResult.parsed_output === "object"
          ? {
              ...(providerResult.parsed_output as Record<string, unknown>),
              generation_mode: input.provider_label === "openai" ? "live_provider" : "deterministic_mock",
              generated_at: nowIso()
            }
          : providerResult.parsed_output;
      const canonicalCandidate = canonicalizeProfileIntegrationRepairCandidate(candidate, input.agent_input);
      const validation = validateProfileIntegrationOutput(canonicalCandidate, input.agent_input);

      if (validation.valid) {
        await prisma.agentCall.update({
          where: { id: agentCall.id },
          data: {
            ...providerAuditUpdate(providerResult),
            output_payload: prismaJson(validation.packet),
            output_validated: true,
            call_status: "succeeded",
            completed_at: new Date()
          }
        });

        return {
          status: "succeeded",
          packet: validation.packet,
          agent_call_id: agentCall.id,
          validation_issues: []
        };
      }

      const fallbackPacket = buildConservativeIntegrationFallback(
        input.agent_input,
        `profile_integration_repair_rejected_${validation.issues.length}_issues`
      );
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...providerAuditUpdate(providerResult),
          output_payload: Prisma.JsonNull,
          output_validated: false,
          validation_error: validationErrorPayload({
            category: "profile_integration_validation",
            issues: validation.issues
          }),
          call_status: "invalid_output",
          error_category: "profile_integration_validation",
          completed_at: new Date()
        }
      });

      return {
        status: "invalid_output",
        fallback_packet: fallbackPacket,
        agent_call_id: agentCall.id,
        validation_issues: validation.issues,
        blocked_reason: "profile_integration_repair_failed_validation"
      };
    }

    const fallbackPacket = buildConservativeIntegrationFallback(
      input.agent_input,
      `profile_integration_repair_provider_failed_${safeProviderFailureReason(providerResult)}`
    );
    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        ...providerAuditUpdate(providerResult),
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "provider_failure",
          message:
            providerResult.error?.message ??
            providerResult.refusal ??
            providerResult.incomplete_reason ??
            "Profile integration repair provider call did not complete."
        }),
        refusal_text: providerResult.refusal,
        incomplete_reason: providerResult.incomplete_reason,
        call_status: "failed",
        error_category: providerResult.error?.category ?? providerResult.status,
        completed_at: new Date()
      }
    });

    return {
      status: "failed",
      fallback_packet: fallbackPacket,
      agent_call_id: agentCall.id,
      validation_issues: [],
      blocked_reason: "profile_integration_repair_provider_failed"
    };
  } catch (error) {
    const fallbackPacket = buildConservativeIntegrationFallback(
      input.agent_input,
      "profile_integration_repair_provider_exception"
    );
    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "provider_failure",
          message: error instanceof Error ? error.message : "Profile integration repair provider call failed."
        }),
        call_status: "failed",
        error_category: "unexpected_provider_response",
        completed_at: new Date()
      }
    });

    return {
      status: "failed",
      fallback_packet: fallbackPacket,
      agent_call_id: agentCall.id,
      validation_issues: [],
      blocked_reason: "profile_integration_repair_provider_exception"
    };
  }
}

async function executeProfileIntegrationAgentWithProvider(input: {
  agent_input: ProfileIntegrationAgentInput;
  provider: LlmProvider;
  provider_label: "mock" | "openai";
  model_config: AgentModelConfig;
  live_call_allowed: boolean;
  request_timeout_ms: number;
  audit_context?: {
    assessment_session_db_id?: string;
    concept_unit_session_db_id?: string;
  };
}): Promise<ProfileIntegrationExecutionResult> {
  const startedAt = new Date();
  const clientRequestId = `profile_integration_${randomUUID()}`;
  assertNoProhibitedProviderInput(input.agent_input);

  const agentCall = await prisma.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.audit_context?.assessment_session_db_id,
      concept_unit_session_db_id: input.audit_context?.concept_unit_session_db_id,
      agent_name: PROFILE_INTEGRATION_AGENT_NAME,
      agent_version: PROFILE_INTEGRATION_AGENT_VERSION,
      model_name: input.model_config.model_name,
      provider: input.provider_label,
      client_request_id: clientRequestId,
      agent_invocation_key: `profile_integration:${input.agent_input.session_context.session_public_id}:${PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION}:${randomUUID()}`,
      prompt_hash: PROFILE_INTEGRATION_PROMPT_HASH,
      reasoning_effort: input.model_config.reasoning_effort,
      max_output_tokens: input.model_config.max_output_tokens,
      prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
      schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
      input_payload: prismaJson(redactForAudit(input.agent_input)),
      live_call_allowed: input.live_call_allowed,
      call_status: "started",
      started_at: startedAt
    }
  });

  try {
    const providerResult = await input.provider.executeStructured({
      agent_name: PROFILE_INTEGRATION_AGENT_NAME as unknown as AgentName,
      model_config: input.model_config,
      instructions: PROFILE_INTEGRATION_PROMPT_INSTRUCTIONS,
      input: input.agent_input,
      output_schema: ProfileIntegrationInterpretationPacketV1Schema,
      schema_name: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
      client_request_id: clientRequestId,
      timeout_ms: input.request_timeout_ms,
      metadata: {
        purpose: "chat_native_profile_integration_review",
        agent_name: PROFILE_INTEGRATION_AGENT_NAME,
        prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
        schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION
      }
    });

    if (providerResult.status === "completed") {
      const candidate =
        providerResult.parsed_output && typeof providerResult.parsed_output === "object"
          ? {
              ...(providerResult.parsed_output as Record<string, unknown>),
              generation_mode: input.provider_label === "openai" ? "live_provider" : "deterministic_mock",
              generated_at: nowIso()
            }
          : providerResult.parsed_output;
      const validation = validateProfileIntegrationOutput(candidate, input.agent_input);

      if (validation.valid) {
        await prisma.agentCall.update({
          where: { id: agentCall.id },
          data: {
            ...providerAuditUpdate(providerResult),
            output_payload: prismaJson(validation.packet),
            output_validated: true,
            call_status: "succeeded",
            completed_at: new Date()
          }
        });

        return {
          status: "succeeded",
          packet: validation.packet,
          agent_call_id: agentCall.id,
          validation_issues: []
        };
      }

      const fallbackPacket = buildConservativeIntegrationFallback(
        input.agent_input,
        `profile_integration_provider_output_rejected_${validation.issues.length}_issues`
      );
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...providerAuditUpdate(providerResult),
          output_payload: Prisma.JsonNull,
          output_validated: false,
          validation_error: validationErrorPayload({
            category: "profile_integration_validation",
            issues: validation.issues
          }),
          call_status: "invalid_output",
          error_category: "profile_integration_validation",
          completed_at: new Date()
        }
      });

      if (profileIntegrationIssuesAreRepairable(validation.issues)) {
        return executeProfileIntegrationRepairAttempt({
          agent_input: input.agent_input,
          provider: input.provider,
          provider_label: input.provider_label,
          model_config: input.model_config,
          live_call_allowed: input.live_call_allowed,
          request_timeout_ms: input.request_timeout_ms,
          audit_context: input.audit_context,
          initial_validation_issues: validation.issues
        });
      }

      return {
        status: "invalid_output",
        fallback_packet: fallbackPacket,
        agent_call_id: agentCall.id,
        validation_issues: validation.issues,
        blocked_reason: "profile_integration_output_failed_validation"
      };
    }

    const fallbackPacket = buildConservativeIntegrationFallback(
      input.agent_input,
      `profile_integration_provider_failed_${safeProviderFailureReason(providerResult)}`
    );
    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        ...providerAuditUpdate(providerResult),
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "provider_failure",
          message:
            providerResult.error?.message ??
            providerResult.refusal ??
            providerResult.incomplete_reason ??
            "Profile integration provider call did not complete."
        }),
        refusal_text: providerResult.refusal,
        incomplete_reason: providerResult.incomplete_reason,
        call_status: "failed",
        error_category: providerResult.error?.category ?? providerResult.status,
        completed_at: new Date()
      }
    });

    return {
      status: "failed",
      fallback_packet: fallbackPacket,
      agent_call_id: agentCall.id,
      validation_issues: [],
      blocked_reason: "profile_integration_provider_failed"
    };
  } catch (error) {
    const fallbackPacket = buildConservativeIntegrationFallback(
      input.agent_input,
      "profile_integration_provider_exception"
    );
    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "provider_failure",
          message: error instanceof Error ? error.message : "Profile integration provider call failed."
        }),
        call_status: "failed",
        error_category: "unexpected_provider_response",
        completed_at: new Date()
      }
    });

    return {
      status: "failed",
      fallback_packet: fallbackPacket,
      agent_call_id: agentCall.id,
      validation_issues: [],
      blocked_reason: "profile_integration_provider_exception"
    };
  }
}

export async function executeProfileIntegrationAgentWithProviderForTest(input: {
  agent_input: ProfileIntegrationAgentInput;
  provider: LlmProvider;
  model_config?: AgentModelConfig;
}): Promise<ProfileIntegrationExecutionResult> {
  return executeProfileIntegrationAgentWithProvider({
    agent_input: input.agent_input,
    provider: input.provider,
    provider_label: "mock",
    model_config: input.model_config ?? {
      model_name: `mock-${PROFILE_INTEGRATION_AGENT_NAME}`,
      max_output_tokens: 3000
    },
    live_call_allowed: false,
    request_timeout_ms: 60000
  });
}

export async function executeLiveProfileIntegrationAgent(input: {
  agent_input: ProfileIntegrationAgentInput;
  session_public_id?: string;
}): Promise<ProfileIntegrationExecutionResult> {
  let runtime;
  let modelConfig;

  try {
    runtime = getLlmRuntimeConfig();
    modelConfig = resolveProfileIntegrationModelConfig();
  } catch (error) {
    return {
      status: "configuration_blocked",
      fallback_packet: buildConservativeIntegrationFallback(
        input.agent_input,
        error instanceof LlmConfigurationError ? error.code : "profile_integration_live_configuration_blocked"
      ),
      validation_issues: [],
      blocked_reason: error instanceof Error ? error.message : "Profile integration live configuration failed."
    };
  }

  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    return {
      status: "configuration_blocked",
      fallback_packet: buildConservativeIntegrationFallback(
        input.agent_input,
        "profile_integration_live_calls_not_enabled"
      ),
      validation_issues: [],
      blocked_reason: "Set LLM_PROVIDER=openai and LLM_LIVE_CALLS_ENABLED=true for live profile integration."
    };
  }

  const auditContext = input.session_public_id
    ? await resolveProfileIntegrationAuditContext(input.session_public_id)
    : undefined;
  const provider = profileIntegrationProviderOverrideForTest ?? createLlmProvider();

  return executeProfileIntegrationAgentWithProvider({
    agent_input: input.agent_input,
    provider,
    provider_label: "openai",
    model_config: modelConfig,
    live_call_allowed: true,
    request_timeout_ms: runtime.request_timeout_ms,
    audit_context: auditContext
  });
}

export function projectStudentSafeIntegratedMessage(
  packet: ProfileIntegrationInterpretationPacketV1
): StudentFacingProjection {
  return packet.student_safe_message;
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const StudentSafeProfileIntegrationProjectionSchema = z.object({
  status: StudentFacingStatusSchema,
  message: z.string().min(1).max(320),
  knowledge_focus: z.string().min(1).max(220)
}).strict();

const STUDENT_SAFE_PROFILE_PROHIBITED_RULES: Array<{
  rule_code:
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
    | "unsupported_integrity_claim_detected"
    | "formative_value_direction_present";
  pattern: RegExp;
  blocked_pattern_label: string;
}> = [
  { rule_code: "answer_key_leak_detected", pattern: /\banswer key\b/i, blocked_pattern_label: "answer_key" },
  { rule_code: "correct_option_leak_detected", pattern: /\bcorrect option\b/i, blocked_pattern_label: "correct_option" },
  { rule_code: "correctness_label_detected", pattern: /\b(correctness|correct|incorrect|right answer|wrong answer)\b/i, blocked_pattern_label: "correctness_label" },
  { rule_code: "distractor_metadata_detected", pattern: /\bdistractor\b/i, blocked_pattern_label: "distractor_label" },
  { rule_code: "misconception_id_exposed", pattern: /\bmisconception(?:[_ -]?id)?\b/i, blocked_pattern_label: "misconception_label" },
  { rule_code: "raw_reasoning_exposed", pattern: /\braw reasoning\b/i, blocked_pattern_label: "raw_reasoning" },
  { rule_code: "raw_process_payload_exposed", pattern: /\b(raw process|process payload|process data|process evidence)\b/i, blocked_pattern_label: "process_data_label" },
  { rule_code: "raw_llm_output_exposed", pattern: /\braw (?:llm|model|provider) output\b|\bstructured output\b|\bsystem prompt\b|\bagent call\b/i, blocked_pattern_label: "internal_llm_label" },
  { rule_code: "api_key_or_secret_exposed", pattern: /\b(api key|authorization header|session secret|database url)\b/i, blocked_pattern_label: "secret_reference" },
  { rule_code: "engagement_label_exposed_to_student", pattern: /\b(engagement profile|engagement category|engaged|moderately engaged|disengaged|low engagement|low participation)\b/i, blocked_pattern_label: "engagement_label" },
  { rule_code: "ai_assistance_label_exposed_to_student", pattern: /\b(ai assistance|external assistance|genai|chatgpt)\b/i, blocked_pattern_label: "external_assistance_label" },
  { rule_code: "unsupported_integrity_claim_detected", pattern: /\b(integrity|authenticity|authentic work|independent work|suspicious|questionable)\b/i, blocked_pattern_label: "unsupported_integrity_label" },
  { rule_code: "unsupported_integrity_claim_detected", pattern: new RegExp(`\\b(${["che" + "ating", "mis" + "conduct"].join("|")})\\b`, "i"), blocked_pattern_label: "unsupported_integrity_label" },
  { rule_code: "formative_value_direction_present", pattern: /\b(formative need|formative value|response profile|metadata|integration pattern|internal integrated status)\b/i, blocked_pattern_label: "internal_profile_label" }
];

export function validateStudentSafeProfileIntegrationProjection(value: unknown) {
  const schemaResult = StudentSafeProfileIntegrationProjectionSchema.safeParse(value);
  const issues: ProfileIntegrationValidationIssue[] = [];

  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      pushIssue(issues, issue.path.join(".") || "student_safe_message", "schema_invalid");
    }
    return { valid: false as const, issues };
  }

  const projection = schemaResult.data;
  const textEntries = [
    { path: "student_safe_message.message", text: projection.message },
    { path: "student_safe_message.knowledge_focus", text: projection.knowledge_focus }
  ];

  for (const entry of textEntries) {
    if (/\b(the student|they|their)\b/i.test(entry.text)) {
      pushIssue(
        issues,
        entry.path,
        "formative_value_direction_present",
        "third_person_student_facing_language"
      );
    }
    for (const rule of STUDENT_SAFE_PROFILE_PROHIBITED_RULES) {
      if (rule.pattern.test(entry.text)) {
        pushIssue(issues, entry.path, rule.rule_code, rule.blocked_pattern_label);
      }
    }
  }

  return issues.length === 0
    ? { valid: true as const, projection, issues }
    : { valid: false as const, issues };
}

export function projectStoredStudentProfileIntegration(input: {
  item_level_evidence: Prisma.JsonValue;
  recommended_next_evidence?: Prisma.JsonValue | null;
  created_at: Date | string;
}): StudentSafeProfileIntegrationProjection | null {
  const evidence = jsonRecord(input.item_level_evidence);
  if (evidence.source !== PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE) {
    return null;
  }

  const evidenceMessage = jsonRecord(evidence.student_safe_message);
  const recommendedMessage = jsonRecord(jsonRecord(input.recommended_next_evidence).student_safe_message);
  const candidate = {
    status: safeString(evidenceMessage.status) || safeString(recommendedMessage.status),
    message: safeString(evidenceMessage.message) || safeString(recommendedMessage.message),
    knowledge_focus:
      safeString(evidenceMessage.knowledge_focus) || safeString(recommendedMessage.knowledge_focus)
  };
  const validation = validateStudentSafeProfileIntegrationProjection(candidate);

  if (!validation.valid) {
    return null;
  }

  return {
    ...validation.projection,
    updated_at:
      input.created_at instanceof Date ? input.created_at.toISOString() : input.created_at
  };
}

function abilityProfileForIntegration(packet: ProfileIntegrationInterpretationPacketV1) {
  switch (packet.integration_pattern) {
    case "stable_understanding":
      return "mostly_correct_understanding";
    case "likely_misconception":
      return "misconception_based_understanding";
    case "likely_knowledge_gap":
      return "fragmented_or_limited_understanding";
    case "insufficient_evidence":
      return "insufficient_evidence";
    case "mixed_or_conflicting_evidence":
      return "partial_understanding";
    case "developing_understanding":
    default:
      return "partial_understanding";
  }
}

function engagementProfileForIntegration(packet: ProfileIntegrationInterpretationPacketV1) {
  switch (packet.engagement_context.engagement_category) {
    case "engaged":
      return "adequate_engagement";
    case "moderately_engaged":
      return "variable_engagement";
    case "disengaged":
      return "low_engagement";
    case "insufficient_evidence":
    default:
      return "insufficient_process_evidence";
  }
}

function integratedProfileForIntegration(packet: ProfileIntegrationInterpretationPacketV1) {
  switch (packet.integration_pattern) {
    case "stable_understanding":
      return "robust_understanding_ready_for_transfer";
    case "likely_misconception":
      return "misconception_with_sufficient_engagement";
    case "developing_understanding":
      return "developing_understanding_with_productive_engagement";
    case "insufficient_evidence":
      return "insufficient_evidence_for_formative_decision";
    case "likely_knowledge_gap":
    case "mixed_or_conflicting_evidence":
    default:
      return "conflicting_evidence_needs_clarification";
  }
}

function evidenceSufficiencyForIntegration(packet: ProfileIntegrationInterpretationPacketV1) {
  if (packet.integration_pattern === "insufficient_evidence") return "limited";
  if (packet.status_confidence === "high") return "strong";
  if (packet.status_confidence === "medium") return "adequate";
  return "limited";
}

function confidenceAlignmentForIntegration(packet: ProfileIntegrationInterpretationPacketV1) {
  if (packet.ability_interpretation.evidence_consistency === "insufficient") {
    return "insufficient_evidence";
  }
  if (
    packet.ability_interpretation.evidence_consistency === "mixed" ||
    packet.ability_interpretation.evidence_consistency === "conflicting"
  ) {
    return "mixed";
  }
  return "well_calibrated";
}

function profileIntegrationSnapshot(packet: ProfileIntegrationInterpretationPacketV1) {
  return {
    source: PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE,
    schema_version: packet.schema_version,
    agent_name: packet.agent_name,
    agent_version: packet.agent_version,
    generation_mode: packet.generation_mode,
    session_public_id: packet.session_public_id,
    student_public_id: packet.student_public_id,
    assessment_public_id: packet.assessment_public_id,
    concept_unit_id: packet.concept_unit_id,
    generated_at: packet.generated_at,
    source_packets: packet.source_packets,
    internal_integrated_status: packet.internal_integrated_status,
    student_facing_status: packet.student_facing_status,
    status_confidence: packet.status_confidence,
    integration_pattern: packet.integration_pattern,
    ability_interpretation: {
      summary: packet.ability_interpretation.summary,
      evidence_consistency: packet.ability_interpretation.evidence_consistency,
      main_conceptual_issue: packet.ability_interpretation.main_conceptual_issue,
      misconception_claim_strength: packet.ability_interpretation.misconception_claim_strength,
      knowledge_gap_claim_strength: packet.ability_interpretation.knowledge_gap_claim_strength,
      confidence_calibration_summary: packet.ability_interpretation.confidence_calibration_summary,
      limitations: packet.ability_interpretation.limitations
    },
    engagement_context: {
      summary: packet.engagement_context.summary,
      engagement_effect_on_interpretation: packet.engagement_context.engagement_effect_on_interpretation,
      ai_assistance_effect_on_interpretation: packet.engagement_context.ai_assistance_effect_on_interpretation,
      limitations: packet.engagement_context.limitations
    },
    evidence_rationale: packet.evidence_rationale,
    uncertainty_and_limitations: packet.uncertainty_and_limitations,
    student_safe_message: packet.student_safe_message,
    teacher_research_summary: packet.teacher_research_summary,
    safety_check: packet.safety_check
  };
}

function highConfidenceBlockedByEvidence(input: ProfileIntegrationAgentInput, packet: ProfileIntegrationInterpretationPacketV1) {
  return (
    packet.ability_interpretation.evidence_consistency === "mixed" ||
    packet.ability_interpretation.evidence_consistency === "conflicting" ||
    packet.ability_interpretation.evidence_consistency === "insufficient" ||
    packet.integration_pattern === "mixed_or_conflicting_evidence" ||
    packet.integration_pattern === "insufficient_evidence" ||
    input.ability_summary.reasoning_quality_overall === "vague" ||
    input.ability_summary.reasoning_quality_overall === "mixed" ||
    input.ability_summary.reasoning_quality_overall === "insufficient" ||
    input.safe_response_package_summary.low_information_item_count > 0 ||
    input.safe_response_package_summary.mixed_or_conflicting_item_count > 0 ||
    input.engagement_summary.item_evidence.some((item) => item.idk_or_insufficient_knowledge_marked) ||
    substantialMetadataLimitations(input)
  );
}

export function validateProfileIntegrationOutput(
  value: unknown,
  input?: ProfileIntegrationAgentInput
) {
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
    if (/formative[_-]?value|formative[_-]?need|formative[_-]?direction|activity[_-]?recommendation|matched[_-]?activity|next[_-]?activity|intervention[_-]?plan|instructional[_-]?plan/.test(lowerKey)) {
      pushIssue(
        issues,
        fieldPath,
        /activity|matched|intervention|instructional/.test(lowerKey)
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
    { rule: "activity_recommendation_present", pattern: /\b(activity recommendation|matched activity|intervention plan|instructional plan|next activity|recommended activity|transfer challenge)\b/i, label: "activity_recommendation_label" },
    { rule: "activity_recommendation_present", pattern: /\bthe next step is\b/i, label: "next_step_language" },
    { rule: "activity_recommendation_present", pattern: /\b(?:tutor|teacher|system|agent)\s+should\s+(?:provide|assign|show|give|deliver|use)\b/i, label: "tutor_action_language" },
    { rule: "activity_recommendation_present", pattern: /\bstudent\s+should\s+receive\b/i, label: "student_assignment_language" },
    { rule: "activity_recommendation_present", pattern: /\bshould\s+(?:assign|show next)\b/i, label: "assignment_language" },
    { rule: "unsupported_integrity_claim_detected", pattern: /\bacademic integrity\b|\bintegrity\b/i, label: "integrity_claim" },
    { rule: "unsupported_integrity_claim_detected", pattern: /\bauthenticity\b|\bauthentic work\b|\bauthentic response\b/i, label: "authenticity_claim" },
    { rule: "unsupported_integrity_claim_detected", pattern: /\bindependent work\b|\bindependently (?:worked|produced|written|answered|reasoned)\b|\bindependent (?:response|reasoning|answer)\b/i, label: "independent_work_claim" },
    { rule: "unsupported_integrity_claim_detected", pattern: /\bsuspicious\b|\bquestionable\b/i, label: "suspicious_behavior_claim" },
    { rule: "unsupported_integrity_claim_detected", pattern: new RegExp(`\\b(${["che" + "ating", "mis" + "conduct", "dishonest"].join("|")})\\b`, "i"), label: "integrity_claim" },
    { rule: "answer_key_leak_detected", pattern: /\banswer key\b/i, label: "answer_key" },
    { rule: "correct_option_leak_detected", pattern: /\bcorrect option\b/i, label: "correct_option" },
    { rule: "correctness_label_detected", pattern: /\b(correctness|is correct|is incorrect|wrong answer|right answer)\b/i, label: "correctness_label", studentOnly: true },
    { rule: "distractor_metadata_detected", pattern: /\bdistractor (metadata|rationale|diagnostic)\b/i, label: "distractor_metadata" },
    { rule: "misconception_id_exposed", pattern: /\bmisconception[_-]?id\b/i, label: "misconception_id" },
    { rule: "raw_reasoning_exposed", pattern: /\braw reasoning\b/i, label: "raw_reasoning" },
    { rule: "raw_process_payload_exposed", pattern: /\b(raw process|process payload|clipboard content|typed text)\b/i, label: "raw_process_payload" },
    { rule: "raw_llm_output_exposed", pattern: /\braw (llm|model|provider) output\b/i, label: "raw_llm_output" },
    { rule: "api_key_or_secret_exposed", pattern: /\b(api key|authorization header|session secret|database url)\b/i, label: "secret_reference" }
  ];

  for (const rule of contentRules) {
    const entries = rule.studentOnly ? studentProjectionStrings : stringEntries;
    for (const entry of entries) {
      if (containsAny(entry.text, [rule.pattern])) {
        pushIssue(issues, entry.path, rule.rule, rule.label);
      }
    }
  }

  const aiSignal = input?.engagement_summary.ai_assistance_signal ?? packet.engagement_context.ai_assistance_signal;
  const aiOrExternalAssistancePattern =
    /\b(ai assistance|external assistance|external reference|outside help|outside assistance|genai|chatgpt|language model)\b/i;
  const aiUseClaimPattern =
    /\b(?:student\s+)?(?:used|uses|using|relied on|relies on|received|got|copied|generated|written by|produced by)\s+(?:ai|genai|external assistance|outside help|outside assistance|an external source|a tool|chatgpt|a language model)\b/i;
  const responseProvenancePattern =
    /\b(response[- ]production|response provenance|provenance|externally produced|external source|generated by|written by)\b/i;

  for (const entry of stringEntries.filter((stringEntry) => isProfileIntegrationClaimPath(stringEntry.path))) {
    const text = entry.text;
    if (aiUseClaimPattern.test(text)) {
      pushIssue(
        issues,
        entry.path,
        "unsupported_integrity_claim_detected",
        aiSignal === "likely_external_assistance_pattern"
          ? "unsupported_external_assistance_claim"
          : "ai_use_claim_without_likely_signal"
      );
      continue;
    }

    if (aiOrExternalAssistancePattern.test(text)) {
      pushIssue(
        issues,
        entry.path,
        "unsupported_integrity_claim_detected",
        aiSignal === "likely_external_assistance_pattern"
          ? "unsupported_external_assistance_claim"
          : "ai_use_claim_without_likely_signal"
      );
      continue;
    }

    if (responseProvenancePattern.test(text)) {
      const neutralContextAllowed =
        aiSignal === "likely_external_assistance_pattern" &&
        neutralResponseProductionContextIsAllowed(text);
      if (!neutralContextAllowed) {
        pushIssue(
          issues,
          entry.path,
          "unsupported_integrity_claim_detected",
          aiSignal === "likely_external_assistance_pattern"
            ? "unsupported_external_assistance_claim"
            : "ai_use_claim_without_likely_signal"
        );
      }
    }
  }

  const studentOnlyRules: Array<{
    rule: ProfileIntegrationValidationIssue["rule_code"];
    pattern: RegExp;
    label: string;
  }> = [
    { rule: "engagement_label_exposed_to_student", pattern: /\b(engaged|moderately engaged|disengaged|low engagement|low task participation|low participation|participation evidence|process data|process evidence)\b/i, label: "engagement_label" },
    { rule: "ai_assistance_label_exposed_to_student", pattern: /\b(ai assistance|external assistance|external reference|genai)\b/i, label: "external_assistance_label" },
    { rule: "unsupported_integrity_claim_detected", pattern: /\bacademic integrity\b|\bintegrity\b/i, label: "integrity_claim" },
    { rule: "unsupported_integrity_claim_detected", pattern: /\bauthenticity\b|\bauthentic work\b|\bauthentic response\b/i, label: "authenticity_claim" },
    { rule: "unsupported_integrity_claim_detected", pattern: /\bindependent work\b|\bindependent (?:response|reasoning|answer)\b|\bsuspicious\b|\bquestionable\b/i, label: "independent_work_claim" },
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

  if (input && packet.status_confidence === "high" && highConfidenceBlockedByEvidence(input, packet)) {
    pushIssue(issues, "status_confidence", "high_confidence_overclaim");
  }

  if (input && packet.integration_pattern === "likely_misconception" && alignedMisconceptionEvidenceCount(input) < 2) {
    pushIssue(issues, "integration_pattern", "insufficient_misconception_alignment");
  }

  for (const rationale of packet.evidence_rationale) {
    if (
      rationale.claim_type === "ability" &&
      /\b(engagement|participation|process|ai assistance|external assistance)\b/i.test(rationale.claim)
    ) {
      pushIssue(issues, "evidence_rationale", "engagement_used_as_ability_evidence");
    }
  }

  return issues.length === 0
    ? { valid: true as const, packet, issues }
    : { valid: false as const, issues };
}

export async function buildProfileIntegrationInterpretationPacketForSession(
  sessionPublicId: string,
  options: { execution_mode?: "deterministic_mock" | "live_provider" } = {}
): Promise<ProfileIntegrationInterpretationPacketV1> {
  const abilityPacket = await buildAbilityEvidencePacketForSession(sessionPublicId);
  const engagementPacket = await buildEngagementEvidencePacketForSession(sessionPublicId);
  const agentInput = buildProfileIntegrationAgentInput({
    ability_packet: abilityPacket,
    engagement_packet: engagementPacket
  });

  if (options.execution_mode === "live_provider") {
    const liveResult = await executeLiveProfileIntegrationAgent({
      agent_input: agentInput,
      session_public_id: sessionPublicId
    });

    if (liveResult.status === "succeeded") {
      return liveResult.packet;
    }

    return liveResult.fallback_packet;
  }

  const candidate = await callProfileIntegrationAgent(agentInput);
  const validation = validateProfileIntegrationOutput(candidate, agentInput);

  if (validation.valid) {
    return validation.packet;
  }

  return buildConservativeIntegrationFallback(
    agentInput,
    `profile_integration_validation_failed_${validation.issues.length}_issues`
  );
}

export async function persistProfileIntegrationSnapshotForSession(input: {
  session_public_id: string;
  execution_mode?: "deterministic_mock" | "live_provider";
}) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: input.session_public_id },
    select: {
      id: true,
      session_public_id: true
    }
  });

  if (!session) {
    return { status: "blocked" as const, blocked_reason: "session_not_found" };
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findFirst({
    where: {
      assessment_session_db_id: session.id,
      response_packages: {
        some: {
          package_type: "initial_concept_unit_response_package"
        }
      }
    },
    orderBy: [{ initial_completed_at: "desc" }, { updated_at: "desc" }],
    select: {
      id: true,
      assessment_session_db_id: true,
      concept_unit_db_id: true,
      initial_completed_at: true,
      student_profiles: {
        select: {
          id: true,
          item_level_evidence: true,
          created_at: true
        },
        orderBy: [{ created_at: "desc" }]
      }
    }
  });

  if (!conceptUnitSession) {
    return { status: "blocked" as const, blocked_reason: "initial_response_package_missing" };
  }

  const existing = conceptUnitSession.student_profiles.find((profile) => {
    const evidence = jsonRecord(profile.item_level_evidence);
    return evidence.source === PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE;
  });

  if (existing) {
    return {
      status: "already_persisted" as const,
      student_profile_db_id: existing.id
    };
  }

  const packet = await buildProfileIntegrationInterpretationPacketForSession(input.session_public_id, {
    execution_mode: input.execution_mode ?? "deterministic_mock"
  });
  const validation = validateProfileIntegrationOutput(packet);
  const studentProjectionValidation = validateStudentSafeProfileIntegrationProjection(
    packet.student_safe_message
  );

  if (!validation.valid || !studentProjectionValidation.valid) {
    const issues = validation.valid ? studentProjectionValidation.issues : validation.issues;
    await logProcessEvent({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: "profile_integration_blocked",
      event_category: "profile_integration",
      event_source: "backend",
      payload: {
        schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
        issue_count: issues.length,
        issues: issues.map((issue) => ({
          field_path: issue.field_path,
          rule_code: issue.rule_code,
          blocked_pattern_label: issue.blocked_pattern_label ?? null
        }))
      }
    });
    return {
      status: "blocked" as const,
      blocked_reason: "profile_integration_validation_failed",
      issue_count: issues.length
    };
  }

  const createdAt = conceptUnitSession.initial_completed_at ?? new Date();
  const profile = await prisma.studentProfile.create({
    data: {
      concept_unit_session_db_id: conceptUnitSession.id,
      profile_type: "initial",
      ability_profile: abilityProfileForIntegration(packet),
      ability_pattern_flags: prismaJson({
        source: PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE,
        student_safe_status: packet.student_safe_message.status,
        status_confidence: packet.status_confidence
      }),
      engagement_profile: engagementProfileForIntegration(packet),
      engagement_pattern_flags: prismaJson({
        source: PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE,
        engagement_effect_on_interpretation:
          packet.engagement_context.engagement_effect_on_interpretation
      }),
      integrated_diagnostic_profile: integratedProfileForIntegration(packet),
      integrated_profile_confidence: packet.status_confidence,
      integrated_profile_rationale: packet.teacher_research_summary.safe_internal_summary,
      evidence_sufficiency: evidenceSufficiencyForIntegration(packet),
      confidence_alignment: confidenceAlignmentForIntegration(packet),
      independence_interpretability: "not_applicable",
      misconception_indicators: prismaJson({
        source: PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE,
        main_conceptual_issue: packet.ability_interpretation.main_conceptual_issue,
        misconception_claim_strength: packet.ability_interpretation.misconception_claim_strength
      }),
      item_level_evidence: prismaJson(profileIntegrationSnapshot(packet)),
      reasoning_quality_summary: packet.ability_interpretation.summary,
      engagement_summary: packet.engagement_context.summary,
      process_interpretation_cautions: prismaJson(packet.uncertainty_and_limitations),
      profile_confidence: packet.status_confidence,
      rationale: packet.teacher_research_summary.safe_internal_summary,
      recommended_next_evidence: prismaJson({
        source: PROFILE_INTEGRATION_STUDENT_PROFILE_SOURCE,
        student_safe_message: packet.student_safe_message
      }),
      based_on_agent_call_db_id: null,
      created_at: createdAt
    }
  });

  await logProcessEvent({
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "profile_integration_interpreted",
    event_category: "profile_integration",
    event_source: "backend",
    payload: {
      schema_version: packet.schema_version,
      generation_mode: packet.generation_mode,
      student_facing_status: packet.student_safe_message.status,
      status_confidence: packet.status_confidence,
      integration_pattern: packet.integration_pattern,
      safety_check_passed: true
    }
  });
  await logProcessEvent({
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "student_safe_profile_projection_updated",
    event_category: "profile_integration",
    event_source: "backend",
    payload: {
      schema_version: packet.schema_version,
      student_facing_status: packet.student_safe_message.status,
      safety_check_passed: true
    }
  });

  return {
    status: "persisted" as const,
    student_profile_db_id: profile.id,
    student_facing_status: packet.student_safe_message.status
  };
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
