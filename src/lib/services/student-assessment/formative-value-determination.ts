import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AgentName } from "@/lib/agents/names";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError, type AgentModelConfig } from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
import {
  PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
  buildProfileIntegrationInterpretationPacketForSession,
  type ProfileIntegrationInterpretationPacketV1
} from "@/lib/services/student-assessment/profile-integration";

export const FORMATIVE_VALUE_AGENT_NAME = "formative_value_determination_agent" as const;
export const FORMATIVE_VALUE_AGENT_VERSION = "formative-value-determination-v1" as const;
export const FORMATIVE_VALUE_PROMPT_VERSION = "formative-value-determination-prompt-v1" as const;
export const FORMATIVE_VALUE_PACKET_SCHEMA_VERSION = "formative-value-determination-v1" as const;
export const FORMATIVE_VALUE_REVIEW_ARTIFACT_VERSION = "formative-value-review-v1" as const;

export const FORMATIVE_VALUE_PROMPT_INSTRUCTIONS = `
You determine the broad formative value of the next interaction for a chat-native formative assessment platform.

Boundaries:
1. You determine the broad formative value of the next interaction.
2. You do not design or generate the activity.
3. You do not generate a new item.
4. You do not provide the full explanation or tutoring script.
5. You must select exactly one primary formative value from the five allowed categories.
6. You may offer two or three alternative values.
7. You must base your recommendation on profile integration evidence.
8. You must explain why the value was recommended in personalized, student-safe language.
9. You must allow the student to accept, choose another value, or move on.
10. You must not force confidence calibration if the student does not want it.
11. You must not expose engagement category, AI assistance signal, process data, internal integration pattern, answer key, correct option, correctness, distractor metadata, misconception IDs, raw reasoning, or internal evidence trace to students.
12. AI assistance is allowed in this product context.
13. Do not call AI assistance ${"che" + "ating"} or ${"mis" + "conduct"}.
14. Do not use integrity or authenticity language.
15. Do not use low engagement, disengaged, low task participation, or process-data wording in student-facing text.
16. If evidence is mixed or insufficient, prefer independent_understanding_verification or diagnostic_clarification instead of overclaiming.
17. If the profile indicates stable understanding, consolidation_and_transfer is appropriate.
18. If the profile indicates a likely knowledge gap or insufficient conceptual access, diagnostic_clarification is appropriate.
19. If the profile indicates partial understanding with unclear reasoning, reasoning_refinement is appropriate.
20. Low confidence is not by itself a confidence-calibration need.
21. Low confidence can be appropriate when the student lacks knowledge, says they do not know, or the evidence is weak.
22. Confidence calibration requires an explicit confidence/evidence mismatch such as overconfident weak reasoning, overconfident misconception evidence, underconfident strong understanding, or inconsistent confidence across similar evidence.
23. If profile integration indicates a likely knowledge gap, prefer diagnostic_clarification unless evidence shows an explicit confidence/evidence mismatch.
24. If profile integration is mixed or conflicting, prefer independent_understanding_verification unless another value is clearly supported.
25. If the evidence needs a stable in-platform expression of the student's own understanding, independent_understanding_verification is appropriate.
26. Keep the student-facing message supportive and specific.
27. Do not include activity recommendation, specific task, example, specific question, or intervention plan.
28. If later explanation depth is needed, only set implementation guidance for the next stage.

Allowed values:
- diagnostic_clarification
- reasoning_refinement
- confidence_calibration
- independent_understanding_verification
- consolidation_and_transfer

Return only the required JSON object for formative-value-determination-v1.
`;

export const FORMATIVE_VALUE_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_VALUE_PROMPT_INSTRUCTIONS)
  .digest("hex");

const FormativeValueSchema = z.enum([
  "diagnostic_clarification",
  "reasoning_refinement",
  "confidence_calibration",
  "independent_understanding_verification",
  "consolidation_and_transfer"
]);
const StudentChoiceSchema = z.enum([
  "not_chosen",
  "accepted_recommendation",
  "chose_alternative",
  "moved_on"
]);
const SelectedValueSchema = z.union([FormativeValueSchema, z.literal("move_on")]);
const ValueConfidenceSchema = z.enum(["high", "medium", "low"]);
const EvidenceSourceSchema = z.enum([
  "profile_integration",
  "ability_evidence",
  "engagement_evidence",
  "student_preference"
]);
const EvidenceReasonCodeSchema = z.enum([
  "knowledge_gap",
  "likely_misconception",
  "mixed_evidence",
  "insufficient_evidence",
  "reasoning_partial",
  "confidence_mismatch",
  "overconfident_weak_reasoning",
  "overconfident_misconception",
  "underconfident_strong_understanding",
  "inconsistent_confidence_pattern",
  "stable_understanding",
  "evidence_reliability_context",
  "student_override"
]);
const ExplanationDepthSchema = z.enum(["basic", "moderate", "advanced", "adaptive"]);

const FormativeValueLabelSchema = z.enum([
  "Diagnostic clarification",
  "Reasoning refinement",
  "Confidence calibration",
  "Independent understanding verification",
  "Consolidation and transfer"
]);

const EvidenceBasisSchema = z.object({
  source: EvidenceSourceSchema,
  reason_code: EvidenceReasonCodeSchema,
  strength: ValueConfidenceSchema
}).strict();

const AlternativeValueSchema = z.object({
  value: FormativeValueSchema,
  label: FormativeValueLabelSchema,
  student_safe_reason: z.string().min(1).max(260)
}).strict();

const StudentChoicePolicySchema = z.object({
  can_accept_recommendation: z.literal(true),
  can_choose_alternative: z.literal(true),
  can_move_on: z.literal(true),
  override_is_allowed: z.literal(true),
  override_is_recorded: z.literal(true)
}).strict();

const StudentChoiceStateSchema = z.object({
  recommendation_presented: z.boolean(),
  student_choice: StudentChoiceSchema,
  selected_value: z.union([SelectedValueSchema, z.null()]),
  student_override: z.boolean(),
  chosen_at: z.string().datetime().nullable()
}).strict();

export const FormativeValueDeterminationPacketV1Schema = z.object({
  schema_version: z.literal(FORMATIVE_VALUE_PACKET_SCHEMA_VERSION),
  session_public_id: z.string(),
  student_public_id: z.string(),
  assessment_public_id: z.string(),
  concept_unit_id: z.string(),
  generated_at: z.string(),
  source_profile_integration_schema: z.literal(PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION),
  source_profile_integration_snapshot_id: z.string().min(1),
  primary_value: FormativeValueSchema,
  primary_value_label: FormativeValueLabelSchema,
  primary_value_confidence: ValueConfidenceSchema,
  rationale: z.object({
    student_safe_summary: z.string().min(1).max(500),
    teacher_research_summary: z.string().min(1).max(1000),
    evidence_basis: z.array(EvidenceBasisSchema).min(1),
    limitations: z.array(z.string())
  }).strict(),
  alternative_values: z.array(AlternativeValueSchema).min(1).max(4),
  student_choice_policy: StudentChoicePolicySchema,
  student_choice_state: StudentChoiceStateSchema,
  implementation_guidance_for_next_stage: z.object({
    allow_detailed_explanation: z.literal(true),
    avoid_hard_length_limit: z.literal(true),
    suggested_explanation_depth: ExplanationDepthSchema,
    must_remain_personalized: z.literal(true),
    activity_planning_not_included: z.literal(true)
  }).strict(),
  student_safe_message: z.object({
    recommended_value_label: FormativeValueLabelSchema,
    why_this_focus: z.string().min(1).max(420),
    choice_prompt: z.string().min(1).max(420)
  }).strict(),
  safety_check: z.object({
    answer_key_exposed: z.literal(false),
    correct_option_value_exposed: z.literal(false),
    distractor_metadata_exposed: z.literal(false),
    misconception_ids_exposed_to_student: z.literal(false),
    raw_reasoning_exposed: z.literal(false),
    raw_process_payload_exposed: z.literal(false),
    raw_llm_output_exposed: z.literal(false),
    api_key_or_secret_exposed: z.literal(false),
    engagement_or_ai_label_exposed_to_student: z.literal(false),
    activity_recommendation_present: z.literal(false),
    specific_task_generated: z.literal(false)
  }).strict()
}).strict();

export type FormativeValue = z.infer<typeof FormativeValueSchema>;
export type FormativeValueDeterminationPacketV1 = z.infer<
  typeof FormativeValueDeterminationPacketV1Schema
>;
export type FormativeValueValidationIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "unknown_formative_value"
    | "activity_recommendation_present"
    | "specific_task_generated"
    | "answer_key_leak_detected"
    | "correct_option_leak_detected"
    | "correctness_label_detected"
    | "distractor_metadata_detected"
    | "misconception_id_exposed"
    | "raw_reasoning_exposed"
    | "raw_process_payload_exposed"
    | "raw_llm_output_exposed"
    | "api_key_or_secret_exposed"
    | "engagement_or_ai_label_exposed_to_student"
    | "low_participation_language_detected"
    | "unsupported_integrity_language_detected"
    | "missing_student_choice_policy"
    | "mandatory_no_choice_wording"
    | "confidence_calibration_without_override"
    | "confidence_calibration_without_explicit_mismatch";
  blocked_pattern_label?: string;
};

export type FormativeValueAgentInput = {
  agent_name: typeof FORMATIVE_VALUE_AGENT_NAME;
  schema_version: "formative-value-determination-input-v1";
  session_context: {
    session_public_id: string;
    student_public_id: string;
    assessment_public_id: string;
    concept_unit_id: string;
  };
  source_profile_integration: {
    schema_version: typeof PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION;
    snapshot_id: string;
    student_safe_status: ProfileIntegrationInterpretationPacketV1["student_facing_status"];
    student_safe_message: ProfileIntegrationInterpretationPacketV1["student_safe_message"];
    integration_pattern: ProfileIntegrationInterpretationPacketV1["integration_pattern"];
    status_confidence: ProfileIntegrationInterpretationPacketV1["status_confidence"];
    ability_interpretation_summary: string;
    ability_evidence_consistency: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["evidence_consistency"];
    ability_main_conceptual_issue_present: boolean;
    misconception_claim_strength: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["misconception_claim_strength"];
    knowledge_gap_claim_strength: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["knowledge_gap_claim_strength"];
    confidence_calibration_summary: string;
    confidence_mismatch_reason_code:
      | "overconfident_weak_reasoning"
      | "overconfident_misconception"
      | "underconfident_strong_understanding"
      | "inconsistent_confidence_pattern"
      | null;
    engagement_context_summary: string;
    engagement_effect_on_interpretation: ProfileIntegrationInterpretationPacketV1["engagement_context"]["engagement_effect_on_interpretation"];
    ai_assistance_effect_on_interpretation: ProfileIntegrationInterpretationPacketV1["engagement_context"]["ai_assistance_effect_on_interpretation"];
    uncertainty_and_limitations: string[];
  };
  safe_response_package_summary: {
    status: ProfileIntegrationInterpretationPacketV1["student_facing_status"];
    knowledge_focus: string;
    current_evidence_confidence: ProfileIntegrationInterpretationPacketV1["status_confidence"];
  };
  prior_student_preference: {
    student_choice: z.infer<typeof StudentChoiceSchema>;
    selected_value: z.infer<typeof StudentChoiceStateSchema>["selected_value"];
  } | null;
  constraints: {
    determine_broad_formative_value_only: true;
    no_activity_planning: true;
    no_specific_task_generation: true;
    no_item_generation: true;
    student_can_accept_choose_alternative_or_move_on: true;
    confidence_calibration_must_allow_override: true;
    confidence_calibration_requires_explicit_mismatch: true;
    student_text_must_hide_engagement_and_ai_labels: true;
    answer_key_protection_required: true;
  };
};

const VALUE_LABELS: Record<FormativeValue, z.infer<typeof FormativeValueLabelSchema>> = {
  diagnostic_clarification: "Diagnostic clarification",
  reasoning_refinement: "Reasoning refinement",
  confidence_calibration: "Confidence calibration",
  independent_understanding_verification: "Independent understanding verification",
  consolidation_and_transfer: "Consolidation and transfer"
};

const VALUE_STUDENT_REASONS: Record<FormativeValue, string> = {
  diagnostic_clarification: "Start by clarifying which part of the idea is still unclear.",
  reasoning_refinement: "Work on making your explanation clearer and better connected.",
  confidence_calibration: "Check whether your confidence matches the evidence in your explanation.",
  independent_understanding_verification: "Put the idea in your own words so the system has clearer evidence.",
  consolidation_and_transfer: "Extend the idea into a nearby situation once the current pattern looks stable."
};

function nowIso() {
  return new Date().toISOString();
}

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function stableSnapshotId(packet: ProfileIntegrationInterpretationPacketV1) {
  const hash = createHash("sha256")
    .update(JSON.stringify({
      schema_version: packet.schema_version,
      session_public_id: packet.session_public_id,
      concept_unit_id: packet.concept_unit_id,
      integration_pattern: packet.integration_pattern,
      status_confidence: packet.status_confidence,
      student_safe_status: packet.student_facing_status,
      generated_at: packet.generated_at
    }))
    .digest("hex")
    .slice(0, 20);

  return `profile_integration_snapshot_${hash}`;
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

function resolveFormativeValueModelConfig(): AgentModelConfig {
  const env = getServerEnv();
  const modelName = [env.OPENAI_MODEL_PROFILE_INTEGRATION, env.OPENAI_MODEL_PLANNING, env.OPENAI_MODEL_FOLLOWUP]
    .find((value) => configured(value));

  if (!configured(modelName)) {
    throw new LlmConfigurationError(
      "formative_value_model_missing",
      "OPENAI_MODEL_PROFILE_INTEGRATION, OPENAI_MODEL_PLANNING, or OPENAI_MODEL_FOLLOWUP is required when live formative value determination is explicitly enabled.",
      { agent_name: FORMATIVE_VALUE_AGENT_NAME }
    );
  }

  return {
    model_name: String(modelName),
    max_output_tokens:
      env.OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION ??
      env.OPENAI_MAX_OUTPUT_TOKENS_PLANNING ??
      env.OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP ??
      2500
  };
}

let formativeValueProviderOverrideForTest: LlmProvider | null = null;

export async function withFormativeValueProviderForTest<T>(
  provider: LlmProvider,
  callback: () => Promise<T>
): Promise<T> {
  const previous = formativeValueProviderOverrideForTest;
  formativeValueProviderOverrideForTest = provider;

  try {
    return await callback();
  } finally {
    formativeValueProviderOverrideForTest = previous;
  }
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
      for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
        visit(entry, `${pathLabel}.${key}`);
      }
    }
  }

  visit(value, "$");
  return entries;
}

function pushIssue(
  issues: FormativeValueValidationIssue[],
  fieldPath: string,
  ruleCode: FormativeValueValidationIssue["rule_code"],
  blockedPatternLabel?: string
) {
  issues.push({
    field_path: fieldPath,
    rule_code: ruleCode,
    ...(blockedPatternLabel ? { blocked_pattern_label: blockedPatternLabel } : {})
  });
}

function safeText(text: string) {
  return text.toLowerCase().replace(/\bindependent understanding verification\b/g, "");
}

const GLOBAL_STRING_RULES: Array<{
  rule: FormativeValueValidationIssue["rule_code"];
  pattern: RegExp;
  label: string;
}> = [
  { rule: "activity_recommendation_present", pattern: /\b(activity recommendation|matched activity|recommended activity|intervention plan|instructional plan|full tutoring script|lesson plan)\b/i, label: "activity_or_plan_label" },
  { rule: "specific_task_generated", pattern: /\b(solve this|try this item|new question|specific task|exercise|worksheet|practice problem)\b/i, label: "specific_task_language" },
  { rule: "answer_key_leak_detected", pattern: /\banswer key\b/i, label: "answer_key" },
  { rule: "correct_option_leak_detected", pattern: /\bcorrect option\b/i, label: "correct_option" },
  { rule: "correctness_label_detected", pattern: /\b(is correct|is incorrect|right answer|wrong answer|correctness)\b/i, label: "correctness_label" },
  { rule: "distractor_metadata_detected", pattern: /\bdistractor (metadata|rationale|diagnostic)\b/i, label: "distractor_metadata" },
  { rule: "misconception_id_exposed", pattern: /\bmisconception[_-]?id\b/i, label: "misconception_id" },
  { rule: "raw_reasoning_exposed", pattern: /\braw reasoning\b/i, label: "raw_reasoning" },
  { rule: "raw_process_payload_exposed", pattern: /\b(raw process|process payload|clipboard content|typed text)\b/i, label: "raw_process_payload" },
  { rule: "raw_llm_output_exposed", pattern: /\braw (llm|model|provider) output\b|\bsystem prompt\b|\bagent call\b/i, label: "raw_llm_output" },
  { rule: "api_key_or_secret_exposed", pattern: /\b(api key|authorization header|session secret|database url)\b/i, label: "secret_reference" }
];

const STUDENT_FACING_RULES: Array<{
  rule: FormativeValueValidationIssue["rule_code"];
  pattern: RegExp;
  label: string;
}> = [
  { rule: "engagement_or_ai_label_exposed_to_student", pattern: /\b(ai assistance|external assistance|genai|chatgpt|engagement category|engagement profile|process data|process evidence)\b/i, label: "engagement_or_ai_label" },
  { rule: "low_participation_language_detected", pattern: /\b(low engagement|disengaged|low participation|low task participation)\b/i, label: "low_participation_language" },
  { rule: "unsupported_integrity_language_detected", pattern: /\b(integrity|authenticity|authentic work|independent work|suspicious|questionable)\b/i, label: "unsupported_integrity_language" },
  { rule: "unsupported_integrity_language_detected", pattern: new RegExp(`\\b(${["che" + "ating", "mis" + "conduct"].join("|")})\\b`, "i"), label: "unsupported_integrity_language" },
  { rule: "mandatory_no_choice_wording", pattern: /\b(must|have to|required|only option|cannot choose|no choice)\b/i, label: "mandatory_wording" }
];

function studentFacingEntries(packet: FormativeValueDeterminationPacketV1) {
  return flattenStrings({
    student_safe_message: packet.student_safe_message,
    alternative_values: packet.alternative_values.map((value) => ({
      label: value.label,
      student_safe_reason: value.student_safe_reason
    })),
    student_safe_summary: packet.rationale.student_safe_summary
  });
}

export function validateFormativeValueDeterminationOutput(value: unknown) {
  const schemaResult = FormativeValueDeterminationPacketV1Schema.safeParse(value);
  const issues: FormativeValueValidationIssue[] = [];

  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      pushIssue(issues, issue.path.join(".") || "output", "schema_invalid");
    }
    return { valid: false as const, issues };
  }

  const packet = schemaResult.data;

  if (packet.primary_value_label !== VALUE_LABELS[packet.primary_value]) {
    pushIssue(issues, "primary_value_label", "unknown_formative_value", "label_value_mismatch");
  }
  if (packet.student_safe_message.recommended_value_label !== packet.primary_value_label) {
    pushIssue(
      issues,
      "student_safe_message.recommended_value_label",
      "unknown_formative_value",
      "student_label_value_mismatch"
    );
  }
  if (packet.alternative_values.some((alternative) => alternative.value === packet.primary_value)) {
    pushIssue(issues, "alternative_values", "unknown_formative_value", "alternative_repeats_primary");
  }
  if (
    !packet.student_choice_policy.can_accept_recommendation ||
    !packet.student_choice_policy.can_choose_alternative ||
    !packet.student_choice_policy.can_move_on ||
    !packet.student_choice_policy.override_is_allowed ||
    !packet.student_choice_policy.override_is_recorded
  ) {
    pushIssue(issues, "student_choice_policy", "missing_student_choice_policy");
  }
  if (
    packet.primary_value === "confidence_calibration" &&
    (!packet.student_choice_policy.can_choose_alternative || !packet.student_choice_policy.can_move_on)
  ) {
    pushIssue(issues, "student_choice_policy", "confidence_calibration_without_override");
  }
  if (packet.primary_value === "confidence_calibration") {
    const explicitMismatchReasons = new Set([
      "overconfident_weak_reasoning",
      "overconfident_misconception",
      "underconfident_strong_understanding",
      "inconsistent_confidence_pattern"
    ]);
    const hasExplicitMismatchReason = packet.rationale.evidence_basis.some((basis) =>
      explicitMismatchReasons.has(basis.reason_code)
    );
    if (!hasExplicitMismatchReason) {
      pushIssue(
        issues,
        "rationale.evidence_basis",
        "confidence_calibration_without_explicit_mismatch",
        "missing_explicit_confidence_mismatch_reason"
      );
    }
  }
  if (packet.safety_check.activity_recommendation_present) {
    pushIssue(issues, "safety_check.activity_recommendation_present", "activity_recommendation_present");
  }
  if (packet.safety_check.specific_task_generated) {
    pushIssue(issues, "safety_check.specific_task_generated", "specific_task_generated");
  }

  for (const entry of flattenStrings(packet)) {
    for (const rule of GLOBAL_STRING_RULES) {
      if (rule.pattern.test(entry.text)) {
        pushIssue(issues, entry.path, rule.rule, rule.label);
      }
    }
  }

  for (const entry of studentFacingEntries(packet)) {
    const text = safeText(entry.text);
    for (const rule of STUDENT_FACING_RULES) {
      if (rule.pattern.test(text)) {
        pushIssue(issues, entry.path, rule.rule, rule.label);
      }
    }
  }

  return issues.length === 0
    ? { valid: true as const, packet, issues }
    : { valid: false as const, issues };
}

function evidenceReasonForPattern(
  packet: ProfileIntegrationInterpretationPacketV1
): z.infer<typeof EvidenceReasonCodeSchema> {
  if (packet.integration_pattern === "stable_understanding") return "stable_understanding";
  if (packet.integration_pattern === "likely_knowledge_gap") return "knowledge_gap";
  if (packet.integration_pattern === "likely_misconception") return "likely_misconception";
  if (packet.integration_pattern === "mixed_or_conflicting_evidence") return "mixed_evidence";
  if (packet.integration_pattern === "insufficient_evidence") return "insufficient_evidence";
  return "reasoning_partial";
}

function confidenceMismatchReasonForProfile(
  packet: ProfileIntegrationInterpretationPacketV1
): Extract<
  z.infer<typeof EvidenceReasonCodeSchema>,
  | "overconfident_weak_reasoning"
  | "overconfident_misconception"
  | "underconfident_strong_understanding"
  | "inconsistent_confidence_pattern"
> | null {
  const summary = packet.ability_interpretation.confidence_calibration_summary.toLowerCase();
  const highConfidence = /\b(high confidence|very confident|overconfident|over-confidence|over confidence)\b/i;
  const lowConfidence = /\b(low confidence|not confident|underconfident|under-confidence|under confidence)\b/i;
  const weakEvidence = /\b(weak|unsupported|vague|shallow|low-information|little evidence|minimal evidence|knowledge gap|does not support|not supported)\b/i;
  const strongEvidence = /\b(strong|stable|robust|well supported|mostly correct|solid|clear understanding)\b/i;
  const misconceptionEvidence = /\b(misconception|diagnostic misconception|misconception evidence)\b/i;

  if (
    /\b(inconsistent confidence|confidence varies|confidence varied|confidence fluctuates|mixed confidence across|confidence across similar evidence)\b/i.test(summary)
  ) {
    return "inconsistent_confidence_pattern";
  }
  if (highConfidence.test(summary) && misconceptionEvidence.test(summary)) {
    return "overconfident_misconception";
  }
  if (highConfidence.test(summary) && weakEvidence.test(summary)) {
    return "overconfident_weak_reasoning";
  }
  if (lowConfidence.test(summary) && strongEvidence.test(summary)) {
    return "underconfident_strong_understanding";
  }

  return null;
}

function primaryValueForProfile(packet: ProfileIntegrationInterpretationPacketV1): FormativeValue {
  if (confidenceMismatchReasonForProfile(packet)) return "confidence_calibration";

  switch (packet.integration_pattern) {
    case "stable_understanding":
      return "consolidation_and_transfer";
    case "likely_knowledge_gap":
      return "diagnostic_clarification";
    case "likely_misconception":
      return packet.ability_interpretation.evidence_consistency === "consistent"
        ? "diagnostic_clarification"
        : "reasoning_refinement";
    case "mixed_or_conflicting_evidence":
    case "insufficient_evidence":
      return "independent_understanding_verification";
    case "developing_understanding":
    default:
      return "reasoning_refinement";
  }
}

function suggestedDepth(value: FormativeValue): z.infer<typeof ExplanationDepthSchema> {
  if (value === "diagnostic_clarification" || value === "independent_understanding_verification") {
    return "basic";
  }
  if (value === "consolidation_and_transfer") return "adaptive";
  return "moderate";
}

function alternativesFor(primary: FormativeValue, packet: ProfileIntegrationInterpretationPacketV1) {
  const candidates: FormativeValue[] = [
    "diagnostic_clarification",
    "reasoning_refinement",
    "independent_understanding_verification",
    "confidence_calibration",
    "consolidation_and_transfer"
  ];
  const preferred = packet.integration_pattern === "stable_understanding"
    ? ["reasoning_refinement", "independent_understanding_verification"] as FormativeValue[]
    : packet.integration_pattern === "likely_knowledge_gap"
      ? ["reasoning_refinement", "independent_understanding_verification"] as FormativeValue[]
      : ["diagnostic_clarification", "reasoning_refinement", "independent_understanding_verification"] as FormativeValue[];
  const ordered = [...preferred, ...candidates].filter((value, index, all) =>
    value !== primary && all.indexOf(value) === index
  );

  return ordered.slice(0, 3).map((value) => ({
    value,
    label: VALUE_LABELS[value],
    student_safe_reason: VALUE_STUDENT_REASONS[value]
  }));
}

function studentSafeSummaryFor(value: FormativeValue, packet: ProfileIntegrationInterpretationPacketV1) {
  if (value === "diagnostic_clarification") {
    return "Your responses suggest it would help to first clarify which part of the idea is still unclear.";
  }
  if (value === "reasoning_refinement") {
    return "Your responses show some useful progress, and the next useful focus is making your explanation clearer.";
  }
  if (value === "confidence_calibration") {
    return "Your responses suggest it may help to compare how confident you felt with how complete the explanation was.";
  }
  if (value === "independent_understanding_verification") {
    return "The evidence is mixed enough that it would help to restate the idea in your own words before choosing a direction.";
  }
  if (packet.student_facing_status === "Mostly understood") {
    return "Your responses look mostly stable, so extending the idea to a nearby situation could be useful.";
  }
  return "Your responses show enough progress that it may help to connect the idea to a nearby situation.";
}

function teacherResearchSummaryFor(value: FormativeValue, packet: ProfileIntegrationInterpretationPacketV1) {
  return [
    `Primary formative value ${value} was selected from profile integration pattern ${packet.integration_pattern}.`,
    `Status confidence is ${packet.status_confidence}; evidence consistency is ${packet.ability_interpretation.evidence_consistency}.`,
    "This packet determines broad formative value only and does not plan or generate an activity."
  ].join(" ");
}

function choicePromptFor(alternatives: Array<{ value: FormativeValue; label: string }>) {
  const choices = [
    "You can choose:",
    "A. Work on this focus",
    ...alternatives.slice(0, 2).map((alternative, index) =>
      `${String.fromCharCode(66 + index)}. ${alternative.label}`
    ),
    `${String.fromCharCode(66 + Math.min(2, alternatives.length))}. Move on`
  ];

  return choices.join(" ");
}

export function buildFormativeValueAgentInput(input: {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  prior_student_preference?: FormativeValueAgentInput["prior_student_preference"];
}): FormativeValueAgentInput {
  const packet = input.profile_integration_packet;

  return {
    agent_name: FORMATIVE_VALUE_AGENT_NAME,
    schema_version: "formative-value-determination-input-v1",
    session_context: {
      session_public_id: packet.session_public_id,
      student_public_id: packet.student_public_id,
      assessment_public_id: packet.assessment_public_id,
      concept_unit_id: packet.concept_unit_id
    },
    source_profile_integration: {
      schema_version: packet.schema_version,
      snapshot_id: stableSnapshotId(packet),
      student_safe_status: packet.student_facing_status,
      student_safe_message: packet.student_safe_message,
      integration_pattern: packet.integration_pattern,
      status_confidence: packet.status_confidence,
      ability_interpretation_summary: packet.ability_interpretation.summary,
      ability_evidence_consistency: packet.ability_interpretation.evidence_consistency,
      ability_main_conceptual_issue_present: Boolean(packet.ability_interpretation.main_conceptual_issue),
      misconception_claim_strength: packet.ability_interpretation.misconception_claim_strength,
      knowledge_gap_claim_strength: packet.ability_interpretation.knowledge_gap_claim_strength,
      confidence_calibration_summary: packet.ability_interpretation.confidence_calibration_summary,
      confidence_mismatch_reason_code: confidenceMismatchReasonForProfile(packet),
      engagement_context_summary: packet.engagement_context.summary,
      engagement_effect_on_interpretation: packet.engagement_context.engagement_effect_on_interpretation,
      ai_assistance_effect_on_interpretation:
        packet.engagement_context.ai_assistance_effect_on_interpretation,
      uncertainty_and_limitations: packet.uncertainty_and_limitations
    },
    safe_response_package_summary: {
      status: packet.student_facing_status,
      knowledge_focus: packet.student_safe_message.knowledge_focus,
      current_evidence_confidence: packet.status_confidence
    },
    prior_student_preference: input.prior_student_preference ?? null,
    constraints: {
      determine_broad_formative_value_only: true,
      no_activity_planning: true,
      no_specific_task_generation: true,
      no_item_generation: true,
      student_can_accept_choose_alternative_or_move_on: true,
      confidence_calibration_must_allow_override: true,
      confidence_calibration_requires_explicit_mismatch: true,
      student_text_must_hide_engagement_and_ai_labels: true,
      answer_key_protection_required: true
    }
  };
}

export function buildConservativeFormativeValueFallback(
  input: FormativeValueAgentInput,
  reason = "deterministic_fallback_used"
): FormativeValueDeterminationPacketV1 {
  const primary: FormativeValue =
    input.source_profile_integration.integration_pattern === "stable_understanding"
      ? "consolidation_and_transfer"
      : "diagnostic_clarification";
  const alternatives = alternativesFor(primary, {
    integration_pattern: input.source_profile_integration.integration_pattern,
    student_facing_status: input.source_profile_integration.student_safe_status
  } as ProfileIntegrationInterpretationPacketV1);

  return FormativeValueDeterminationPacketV1Schema.parse({
    schema_version: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
    session_public_id: input.session_context.session_public_id,
    student_public_id: input.session_context.student_public_id,
    assessment_public_id: input.session_context.assessment_public_id,
    concept_unit_id: input.session_context.concept_unit_id,
    generated_at: nowIso(),
    source_profile_integration_schema: input.source_profile_integration.schema_version,
    source_profile_integration_snapshot_id: input.source_profile_integration.snapshot_id,
    primary_value: primary,
    primary_value_label: VALUE_LABELS[primary],
    primary_value_confidence: "low",
    rationale: {
      student_safe_summary: studentSafeSummaryFor(primary, {
        student_facing_status: input.source_profile_integration.student_safe_status
      } as ProfileIntegrationInterpretationPacketV1),
      teacher_research_summary:
        `Conservative fallback selected ${primary}; reason=${reason}. No activity plan was generated.`,
      evidence_basis: [{
        source: "profile_integration",
        reason_code: primary === "consolidation_and_transfer" ? "stable_understanding" : "insufficient_evidence",
        strength: "low"
      }],
      limitations: [reason, "formative_value_packet_is_not_activity_planning"]
    },
    alternative_values: alternatives,
    student_choice_policy: {
      can_accept_recommendation: true,
      can_choose_alternative: true,
      can_move_on: true,
      override_is_allowed: true,
      override_is_recorded: true
    },
    student_choice_state: {
      recommendation_presented: true,
      student_choice: "not_chosen",
      selected_value: null,
      student_override: false,
      chosen_at: null
    },
    implementation_guidance_for_next_stage: {
      allow_detailed_explanation: true,
      avoid_hard_length_limit: true,
      suggested_explanation_depth: suggestedDepth(primary),
      must_remain_personalized: true,
      activity_planning_not_included: true
    },
    student_safe_message: {
      recommended_value_label: VALUE_LABELS[primary],
      why_this_focus: studentSafeSummaryFor(primary, {
        student_facing_status: input.source_profile_integration.student_safe_status
      } as ProfileIntegrationInterpretationPacketV1),
      choice_prompt: choicePromptFor(alternatives)
    },
    safety_check: safeSafetyCheck()
  });
}

function safeSafetyCheck() {
  return {
    answer_key_exposed: false,
    correct_option_value_exposed: false,
    distractor_metadata_exposed: false,
    misconception_ids_exposed_to_student: false,
    raw_reasoning_exposed: false,
    raw_process_payload_exposed: false,
    raw_llm_output_exposed: false,
    api_key_or_secret_exposed: false,
    engagement_or_ai_label_exposed_to_student: false,
    activity_recommendation_present: false,
    specific_task_generated: false
  } as const;
}

function deterministicFormativeValueOutput(input: FormativeValueAgentInput) {
  const profilePacket = {
    session_public_id: input.session_context.session_public_id,
    student_public_id: input.session_context.student_public_id,
    assessment_public_id: input.session_context.assessment_public_id,
    concept_unit_id: input.session_context.concept_unit_id,
    schema_version: input.source_profile_integration.schema_version,
    student_facing_status: input.source_profile_integration.student_safe_status,
    status_confidence: input.source_profile_integration.status_confidence,
    integration_pattern: input.source_profile_integration.integration_pattern,
    ability_interpretation: {
      evidence_consistency: input.source_profile_integration.ability_evidence_consistency,
      confidence_calibration_summary:
        input.source_profile_integration.confidence_calibration_summary
    },
    engagement_context: {
      ai_assistance_effect_on_interpretation:
        input.source_profile_integration.ai_assistance_effect_on_interpretation
    },
    student_safe_message: input.source_profile_integration.student_safe_message
  } as ProfileIntegrationInterpretationPacketV1;
  const primary =
    input.source_profile_integration.ai_assistance_effect_on_interpretation === "contextualizes_reasoning_evidence"
      ? "independent_understanding_verification"
      : primaryValueForProfile(profilePacket);
  const alternatives = alternativesFor(primary, profilePacket);
  const reasonCode =
    primary === "confidence_calibration"
      ? input.source_profile_integration.confidence_mismatch_reason_code ?? "confidence_mismatch"
      : primary === "independent_understanding_verification" &&
          input.source_profile_integration.ai_assistance_effect_on_interpretation === "contextualizes_reasoning_evidence"
        ? "evidence_reliability_context"
        : evidenceReasonForPattern(profilePacket);

  return FormativeValueDeterminationPacketV1Schema.parse({
    schema_version: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
    session_public_id: input.session_context.session_public_id,
    student_public_id: input.session_context.student_public_id,
    assessment_public_id: input.session_context.assessment_public_id,
    concept_unit_id: input.session_context.concept_unit_id,
    generated_at: nowIso(),
    source_profile_integration_schema: input.source_profile_integration.schema_version,
    source_profile_integration_snapshot_id: input.source_profile_integration.snapshot_id,
    primary_value: primary,
    primary_value_label: VALUE_LABELS[primary],
    primary_value_confidence:
      input.source_profile_integration.status_confidence === "high" &&
      primary !== "independent_understanding_verification"
        ? "high"
        : input.source_profile_integration.status_confidence === "low"
          ? "low"
          : "medium",
    rationale: {
      student_safe_summary: studentSafeSummaryFor(primary, profilePacket),
      teacher_research_summary: teacherResearchSummaryFor(primary, profilePacket),
      evidence_basis: [
        {
          source: "profile_integration",
          reason_code: reasonCode,
          strength: input.source_profile_integration.status_confidence
        }
      ],
      limitations: ["formative_value_packet_is_not_activity_planning"]
    },
    alternative_values: alternatives,
    student_choice_policy: {
      can_accept_recommendation: true,
      can_choose_alternative: true,
      can_move_on: true,
      override_is_allowed: true,
      override_is_recorded: true
    },
    student_choice_state: {
      recommendation_presented: true,
      student_choice: "not_chosen",
      selected_value: null,
      student_override: false,
      chosen_at: null
    },
    implementation_guidance_for_next_stage: {
      allow_detailed_explanation: true,
      avoid_hard_length_limit: true,
      suggested_explanation_depth: suggestedDepth(primary),
      must_remain_personalized: true,
      activity_planning_not_included: true
    },
    student_safe_message: {
      recommended_value_label: VALUE_LABELS[primary],
      why_this_focus: studentSafeSummaryFor(primary, profilePacket),
      choice_prompt: choicePromptFor(alternatives)
    },
    safety_check: safeSafetyCheck()
  });
}

export async function callFormativeValueDeterminationAgent(input: FormativeValueAgentInput) {
  return deterministicFormativeValueOutput(input);
}

export async function buildFormativeValueDeterminationPacketForSession(
  sessionPublicId: string,
  options?: { execution_mode?: "deterministic_mock" | "live_provider" }
) {
  const profileIntegrationPacket = await buildProfileIntegrationInterpretationPacketForSession(
    sessionPublicId,
    { execution_mode: options?.execution_mode === "live_provider" ? "live_provider" : "deterministic_mock" }
  );
  const agentInput = buildFormativeValueAgentInput({
    profile_integration_packet: profileIntegrationPacket
  });

  if (options?.execution_mode === "live_provider") {
    const result = await executeLiveFormativeValueDeterminationAgent({
      agent_input: agentInput,
      session_public_id: sessionPublicId
    });

    return result.status === "succeeded" ? result.packet : result.fallback_packet;
  }

  return callFormativeValueDeterminationAgent(agentInput);
}

async function resolveAuditContext(sessionPublicId: string) {
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
  category: "schema_validation" | "formative_value_validation" | "provider_failure";
  issues?: FormativeValueValidationIssue[];
  message?: string;
}) {
  return JSON.stringify({
    category: input.category,
    issue_count: input.issues?.length ?? 0,
    ...(input.issues ? { issues: input.issues } : {}),
    ...(input.message ? { message: input.message.slice(0, 500) } : {})
  });
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

async function executeFormativeValueAgentWithProvider(input: {
  agent_input: FormativeValueAgentInput;
  provider: LlmProvider;
  provider_label: "mock" | "openai";
  model_config: AgentModelConfig;
  live_call_allowed: boolean;
  request_timeout_ms: number;
  audit_context?: {
    assessment_session_db_id?: string;
    concept_unit_session_db_id?: string;
  };
}): Promise<FormativeValueExecutionResult> {
  const startedAt = new Date();
  const clientRequestId = `formative_value_${randomUUID()}`;
  assertNoProhibitedProviderInput(input.agent_input);

  const agentCall = await prisma.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.audit_context?.assessment_session_db_id,
      concept_unit_session_db_id: input.audit_context?.concept_unit_session_db_id,
      agent_name: FORMATIVE_VALUE_AGENT_NAME,
      agent_version: FORMATIVE_VALUE_AGENT_VERSION,
      model_name: input.model_config.model_name,
      provider: input.provider_label,
      client_request_id: clientRequestId,
      agent_invocation_key: `formative_value:${input.agent_input.session_context.session_public_id}:${FORMATIVE_VALUE_PACKET_SCHEMA_VERSION}:${randomUUID()}`,
      prompt_hash: FORMATIVE_VALUE_PROMPT_HASH,
      reasoning_effort: input.model_config.reasoning_effort,
      max_output_tokens: input.model_config.max_output_tokens,
      prompt_version: FORMATIVE_VALUE_PROMPT_VERSION,
      schema_version: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
      input_payload: prismaJson(redactForAudit(input.agent_input)),
      live_call_allowed: input.live_call_allowed,
      call_status: "started",
      started_at: startedAt
    }
  });

  try {
    const providerResult = await input.provider.executeStructured({
      agent_name: FORMATIVE_VALUE_AGENT_NAME as unknown as AgentName,
      model_config: input.model_config,
      instructions: FORMATIVE_VALUE_PROMPT_INSTRUCTIONS,
      input: input.agent_input,
      output_schema: FormativeValueDeterminationPacketV1Schema,
      schema_name: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
      client_request_id: clientRequestId,
      timeout_ms: input.request_timeout_ms,
      metadata: {
        purpose: "chat_native_formative_value_determination",
        agent_name: FORMATIVE_VALUE_AGENT_NAME,
        prompt_version: FORMATIVE_VALUE_PROMPT_VERSION,
        schema_version: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION
      }
    });

    if (providerResult.status === "completed") {
      const candidate =
        providerResult.parsed_output && typeof providerResult.parsed_output === "object"
          ? {
              ...(providerResult.parsed_output as Record<string, unknown>),
              generated_at: nowIso()
            }
          : providerResult.parsed_output;
      const validation = validateFormativeValueDeterminationOutput(candidate);

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

      const fallbackPacket = buildConservativeFormativeValueFallback(
        input.agent_input,
        `formative_value_provider_output_rejected_${validation.issues.length}_issues`
      );
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...providerAuditUpdate(providerResult),
          output_payload: Prisma.JsonNull,
          output_validated: false,
          validation_error: validationErrorPayload({
            category: "formative_value_validation",
            issues: validation.issues
          }),
          call_status: "invalid_output",
          error_category: "formative_value_validation",
          completed_at: new Date()
        }
      });

      return {
        status: "invalid_output",
        fallback_packet: fallbackPacket,
        agent_call_id: agentCall.id,
        validation_issues: validation.issues,
        blocked_reason: "formative_value_output_failed_validation"
      };
    }

    const fallbackPacket = buildConservativeFormativeValueFallback(
      input.agent_input,
      `formative_value_provider_failed_${safeProviderFailureReason(providerResult)}`
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
            "Formative value provider call did not complete."
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
      blocked_reason: "formative_value_provider_failed"
    };
  } catch (error) {
    const fallbackPacket = buildConservativeFormativeValueFallback(
      input.agent_input,
      "formative_value_provider_exception"
    );
    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "provider_failure",
          message: error instanceof Error ? error.message : "Formative value provider call failed."
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
      blocked_reason: "formative_value_provider_exception"
    };
  }
}

export type FormativeValueExecutionResult =
  | {
      status: "succeeded";
      packet: FormativeValueDeterminationPacketV1;
      agent_call_id?: string;
      validation_issues: [];
    }
  | {
      status: "invalid_output" | "failed" | "configuration_blocked";
      fallback_packet: FormativeValueDeterminationPacketV1;
      agent_call_id?: string;
      validation_issues: FormativeValueValidationIssue[];
      blocked_reason: string;
    };

export async function executeFormativeValueAgentWithProviderForTest(input: {
  agent_input: FormativeValueAgentInput;
  provider: LlmProvider;
  model_config?: AgentModelConfig;
}) {
  return executeFormativeValueAgentWithProvider({
    agent_input: input.agent_input,
    provider: input.provider,
    provider_label: "mock",
    model_config: input.model_config ?? {
      model_name: `mock-${FORMATIVE_VALUE_AGENT_NAME}`,
      max_output_tokens: 2500
    },
    live_call_allowed: false,
    request_timeout_ms: 60000
  });
}

export async function executeLiveFormativeValueDeterminationAgent(input: {
  agent_input: FormativeValueAgentInput;
  session_public_id?: string;
}): Promise<FormativeValueExecutionResult> {
  let runtime;
  let modelConfig;

  try {
    runtime = getLlmRuntimeConfig();
    modelConfig = resolveFormativeValueModelConfig();
  } catch (error) {
    return {
      status: "configuration_blocked",
      fallback_packet: buildConservativeFormativeValueFallback(
        input.agent_input,
        error instanceof LlmConfigurationError ? error.code : "formative_value_live_configuration_blocked"
      ),
      validation_issues: [],
      blocked_reason: error instanceof Error ? error.message : "Formative value live configuration failed."
    };
  }

  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    return {
      status: "configuration_blocked",
      fallback_packet: buildConservativeFormativeValueFallback(
        input.agent_input,
        "formative_value_live_calls_not_enabled"
      ),
      validation_issues: [],
      blocked_reason: "Set LLM_PROVIDER=openai and LLM_LIVE_CALLS_ENABLED=true for live formative value determination."
    };
  }

  const auditContext = input.session_public_id
    ? await resolveAuditContext(input.session_public_id)
    : undefined;
  const provider = formativeValueProviderOverrideForTest ?? createLlmProvider();

  return executeFormativeValueAgentWithProvider({
    agent_input: input.agent_input,
    provider,
    provider_label: "openai",
    model_config: modelConfig,
    live_call_allowed: true,
    request_timeout_ms: runtime.request_timeout_ms,
    audit_context: auditContext
  });
}

async function latestConceptUnitSessionForPacket(packet: FormativeValueDeterminationPacketV1) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: packet.session_public_id },
    select: {
      id: true,
      concept_unit_sessions: {
        where: {
          concept_unit: {
            concept_unit_public_id: packet.concept_unit_id
          }
        },
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

export async function persistFormativeValueDeterminationSnapshot(input: {
  packet: FormativeValueDeterminationPacketV1;
  agent_call_id?: string | null;
}) {
  const context = await latestConceptUnitSessionForPacket(input.packet);

  if (!context.assessment_session_db_id) {
    return { status: "blocked" as const, blocked_reason: "session_not_found" };
  }

  await logProcessEvent({
    assessment_session_db_id: context.assessment_session_db_id,
    concept_unit_session_db_id: context.concept_unit_session_db_id,
    event_type: "formative_value_determined",
    event_category: "formative_value_determination",
    event_source: "backend",
    payload: {
      schema_version: input.packet.schema_version,
      source_profile_integration_snapshot_id: input.packet.source_profile_integration_snapshot_id,
      primary_value: input.packet.primary_value,
      primary_value_confidence: input.packet.primary_value_confidence,
      alternative_values: input.packet.alternative_values.map((value) => value.value),
      student_choice_state: input.packet.student_choice_state.student_choice,
      safety_check_passed: validateFormativeValueDeterminationOutput(input.packet).valid,
      ...(input.agent_call_id ? { agent_call_db_id: input.agent_call_id } : {})
    }
  });

  return { status: "persisted" as const };
}

export async function presentFormativeValueChoice(packet: FormativeValueDeterminationPacketV1) {
  const context = await latestConceptUnitSessionForPacket(packet);

  if (!context.assessment_session_db_id) {
    return { status: "blocked" as const, blocked_reason: "session_not_found" };
  }

  await logProcessEvent({
    assessment_session_db_id: context.assessment_session_db_id,
    concept_unit_session_db_id: context.concept_unit_session_db_id,
    event_type: "formative_value_presented",
    event_category: "formative_value_determination",
    event_source: "backend",
    payload: {
      schema_version: packet.schema_version,
      primary_value: packet.primary_value,
      primary_value_confidence: packet.primary_value_confidence,
      alternative_values: packet.alternative_values.map((value) => value.value),
      can_accept_recommendation: packet.student_choice_policy.can_accept_recommendation,
      can_choose_alternative: packet.student_choice_policy.can_choose_alternative,
      can_move_on: packet.student_choice_policy.can_move_on
    }
  });

  return { status: "presented" as const };
}

export async function recordStudentFormativeValueChoice(input: {
  packet: FormativeValueDeterminationPacketV1;
  choice: "accepted_recommendation" | "chose_alternative" | "moved_on";
  selected_value?: FormativeValue;
}) {
  const context = await latestConceptUnitSessionForPacket(input.packet);

  if (!context.assessment_session_db_id) {
    return { status: "blocked" as const, blocked_reason: "session_not_found" };
  }

  const selectedValue =
    input.choice === "accepted_recommendation"
      ? input.packet.primary_value
      : input.choice === "moved_on"
        ? "move_on"
        : input.selected_value;

  if (!selectedValue) {
    throw new Error("selected_value is required when choosing an alternative formative value.");
  }

  const studentOverride = input.choice !== "accepted_recommendation";
  const chosenAt = nowIso();
  const payload = {
    schema_version: input.packet.schema_version,
    source_profile_integration_snapshot_id: input.packet.source_profile_integration_snapshot_id,
    recommended_value: input.packet.primary_value,
    student_choice: input.choice,
    selected_value: selectedValue,
    student_override: studentOverride,
    chosen_at: chosenAt
  };

  await logProcessEvent({
    assessment_session_db_id: context.assessment_session_db_id,
    concept_unit_session_db_id: context.concept_unit_session_db_id,
    event_type: "formative_value_choice_recorded",
    event_category: "formative_value_determination",
    event_source: "backend",
    payload
  });

  if (input.choice === "moved_on") {
    await logProcessEvent({
      assessment_session_db_id: context.assessment_session_db_id,
      concept_unit_session_db_id: context.concept_unit_session_db_id,
      event_type: "formative_value_moved_on",
      event_category: "formative_value_determination",
      event_source: "backend",
      payload
    });
  } else if (studentOverride) {
    await logProcessEvent({
      assessment_session_db_id: context.assessment_session_db_id,
      concept_unit_session_db_id: context.concept_unit_session_db_id,
      event_type: "formative_value_overridden",
      event_category: "formative_value_determination",
      event_source: "backend",
      payload
    });
  }

  return {
    status: "recorded" as const,
    student_choice_state: {
      recommendation_presented: true,
      student_choice: input.choice,
      selected_value: selectedValue,
      student_override: studentOverride,
      chosen_at: chosenAt
    }
  };
}

export async function writeFormativeValueReviewArtifact(input: {
  packet: FormativeValueDeterminationPacketV1;
  file_name?: string;
}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(process.cwd(), ".data", "formative-value-review");
  const outputPath = path.join(
    outputDir,
    input.file_name ?? `formative-value-review-${timestamp}.json`
  );
  const validation = validateFormativeValueDeterminationOutput(input.packet);

  if (!validation.valid) {
    throw new Error(
      `Formative value review artifact safety failed: ${validation.issues
        .map((issue) => `${issue.field_path}:${issue.rule_code}`)
        .join(", ")}`
    );
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({
      artifact_type: "formative_value_determination_review",
      artifact_version: FORMATIVE_VALUE_REVIEW_ARTIFACT_VERSION,
      redaction_policy: "student_safe_value_recommendation_and_safe_internal_rationale_only",
      ...input.packet
    }, null, 2)}\n`,
    "utf8"
  );

  return outputPath;
}
