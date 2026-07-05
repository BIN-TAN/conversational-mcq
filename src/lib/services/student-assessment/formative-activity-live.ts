import { createHash, randomUUID } from "node:crypto";
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
import {
  FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
  type FormativeValueDeterminationPacketV1
} from "@/lib/services/student-assessment/formative-value-determination";
import {
  PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
  type ProfileIntegrationInterpretationPacketV1
} from "@/lib/services/student-assessment/profile-integration";
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FORMATIVE_ACTIVITY_SCHEMA_VERSION,
  FormativeActivityFamilySchema,
  FormativeActivityPacketV1Schema,
  assertFormativeActivityPacketIsNotReviewOnlyForRuntime,
  buildFormativeActivityDesignPacketFromPackets,
  validateFormativeActivityPacket,
  type FormativeActivityPacketV1,
  type FormativeActivityValidationIssue
} from "@/lib/services/student-assessment/formative-activity-design";

export const FORMATIVE_ACTIVITY_AGENT_VERSION = "formative-activity-dialogue-v1" as const;
export const FORMATIVE_ACTIVITY_PROMPT_VERSION = "formative-activity-dialogue-prompt-v1" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME =
  "formative_activity_quality_reviewer_agent" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_VERSION =
  "formative-activity-quality-reviewer-v1" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION =
  "formative-activity-quality-review-v1" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_VERSION =
  "formative-activity-quality-review-prompt-v1" as const;
export const FORMATIVE_ACTIVITY_REPAIR_PROMPT_VERSION =
  "formative-activity-dialogue-repair-prompt-v1" as const;
export const FORMATIVE_ACTIVITY_LIVE_INPUT_SCHEMA_VERSION =
  "formative-activity-live-input-v1" as const;

export const FORMATIVE_ACTIVITY_PROMPT_INSTRUCTIONS = `
You are the Formative Activity Dialogue Agent for a web-based chat-native MCQ formative assessment platform.

Generate only the first tutor turn and protocol packet for the next formative activity. The platform owns state transitions, persistence, scoring, and whether the packet can be shown to a student.

Hard requirements:
1. Return exactly the student-formative-activity-v1 JSON schema.
2. Set agent_name to formative_activity_dialogue_agent.
3. Set generation_source to live_llm, runtime_servable_to_student to true, and review_only to false.
4. Use the selected formative value and requested activity family from the input.
5. The first turn must include a complete, student-friendly explanation before asking for one next student action.
6. The first turn must be specific to the current profile interpretation, concept focus, and distractor role when relevant.
7. End the first turn with exactly one question.
8. Do not expose answer keys, correct options, correctness labels, distractor metadata, misconception IDs, engagement labels, AI-assistance labels, process data, raw reasoning, raw provider output, system prompts, API keys, headers, or secrets.
9. Do not mention profile integration, formative value, ability evidence, packet confidence, metadata, structured output, agent calls, raw model output, or internal labels in student-facing text.
10. Do not accuse the student of cheating, misconduct, integrity problems, AI use, or suspicious behavior.
11. Do not generate a new scored item or ask the student to answer a scored question.
12. For transfer_and_distractor_generation, make clear that the activity is unscored.
13. Do not use rigid headings such as "What you did well", "Reasoning detail", "Current focus", or "Earlier".
14. If evidence is limited, use conservative language and ask for a fresh explanation rather than overclaiming.

Return only the JSON object.
`;

export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_INSTRUCTIONS = `
You are the Formative Activity Quality Reviewer Agent.

Review a proposed formative activity first-turn packet. You do not approve unsafe output by yourself; deterministic validators and hard gates remain authoritative.

Evaluate:
1. Schema and agent-name alignment.
2. Student specificity.
3. Conceptual depth.
4. Quality of distractor use when a distractor role is present.
5. Alignment to selected formative value and activity family.
6. Overclaiming risk.
7. Student safety risk.
8. Internal-label leakage.
9. Answer-key or correctness leakage.

Use review_status=pass only if the packet is ready for deterministic final checks.
Use repair_needed only for text-quality issues that can be safely repaired without revealing protected content.
Use fail_closed for protected leaks, unsafe claims, unsupported source flags, missing provenance requirements, or severe mismatch.

Return only the required formative-activity-quality-review-v1 JSON object.
`;

export const FORMATIVE_ACTIVITY_REPAIR_PROMPT_INSTRUCTIONS = `
You are repairing a formative activity packet after quality review.

You may repair only safe text-quality issues from the supplied review instructions. Do not repair protected leaks by restating them. Do not change source provenance except preserving live_llm/runtime_servable_to_student=true/review_only=false. Do not expose answer keys, correct options, correctness, distractor metadata, misconception IDs, raw reasoning, process data, engagement labels, AI-assistance labels, raw LLM output, prompts, headers, API keys, or secrets.

Return exactly one corrected student-formative-activity-v1 JSON object.
`;

export const FORMATIVE_ACTIVITY_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_ACTIVITY_PROMPT_INSTRUCTIONS)
  .digest("hex");
export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_INSTRUCTIONS)
  .digest("hex");
export const FORMATIVE_ACTIVITY_REPAIR_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_ACTIVITY_REPAIR_PROMPT_INSTRUCTIONS)
  .digest("hex");

const QualityReviewStatusSchema = z.enum(["pass", "repair_needed", "fail_closed"]);
const QualityScoreSchema = z.enum(["strong", "adequate", "weak", "unsafe"]);
const ReviewerDimensionSchema = z.enum(["strong", "adequate", "weak", "unsafe"]);
const ReviewerRiskSchema = z.enum(["none", "low", "medium", "high"]);

export const FormativeActivityQualityReviewV1Schema = z.object({
  schema_version: z.literal(FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION),
  agent_name: z.literal(FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME),
  review_status: QualityReviewStatusSchema,
  quality_score: QualityScoreSchema,
  student_specificity: ReviewerDimensionSchema,
  conceptual_depth: ReviewerDimensionSchema,
  distractor_use_quality: ReviewerDimensionSchema,
  formative_value_alignment: ReviewerDimensionSchema,
  activity_family_alignment: ReviewerDimensionSchema,
  overclaiming_risk: ReviewerRiskSchema,
  student_safety_risk: ReviewerRiskSchema,
  issues: z.array(z.object({
    field_path: z.string().min(1).max(160),
    rule_code: z.string().min(1).max(120),
    severity: z.enum(["minor", "major", "critical"]),
    safe_summary: z.string().min(1).max(300)
  }).strict()).max(20),
  repair_instructions: z.array(z.string().min(1).max(300)).max(10)
}).strict();

export type FormativeActivityQualityReviewV1 = z.infer<
  typeof FormativeActivityQualityReviewV1Schema
>;

type ProviderLabel = "mock" | "openai";

export type FormativeActivityProviderAudit = {
  agent_call_id?: string;
  provider: ProviderLabel;
  model_name: string;
  client_request_id?: string;
  provider_request_id?: string;
  provider_response_id?: string;
  call_status?: "succeeded" | "failed" | "invalid_output" | "started";
  output_validated?: boolean;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type FormativeActivityLivePipelineIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "generator_deterministic_validation_failed"
    | "reviewer_schema_invalid"
    | "reviewer_fail_closed"
    | "reviewer_repair_needed"
    | "repair_missing"
    | "repair_not_allowed"
    | "repair_deterministic_validation_failed"
    | "missing_provider_metadata"
    | "missing_token_usage"
    | "missing_audit_metadata"
    | "runtime_guard_rejected";
  blocked_pattern_label?: string;
};

export type FormativeActivityLivePipelineResult =
  | {
      status: "accepted";
      packet: FormativeActivityPacketV1;
      quality_review: FormativeActivityQualityReviewV1;
      repair_attempted: boolean;
      issues: [];
    }
  | {
      status: "rejected";
      quality_review?: FormativeActivityQualityReviewV1;
      repair_attempted: boolean;
      issues: FormativeActivityLivePipelineIssue[];
      blocked_reason: string;
    };

type LiveActivitySourceInput = {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
};

export type FormativeActivityLiveAgentInput = ReturnType<typeof buildFormativeActivityLiveAgentInput>;

function nowIso() {
  return new Date().toISOString();
}

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function validationErrorPayload(input: {
  category:
    | "formative_activity_validation"
    | "formative_activity_review_validation"
    | "formative_activity_pipeline_validation"
    | "provider_failure";
  issues?: Array<FormativeActivityValidationIssue | FormativeActivityLivePipelineIssue>;
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

function resolveFormativeActivityModelConfig(): AgentModelConfig {
  const env = getServerEnv();
  const modelName = [env.OPENAI_MODEL_PROFILE_INTEGRATION, env.OPENAI_MODEL_PLANNING, env.OPENAI_MODEL_FOLLOWUP]
    .find((value) => configured(value));

  if (!configured(modelName)) {
    throw new LlmConfigurationError(
      "formative_activity_model_missing",
      "OPENAI_MODEL_PROFILE_INTEGRATION, OPENAI_MODEL_PLANNING, or OPENAI_MODEL_FOLLOWUP is required when live formative activity generation is explicitly enabled.",
      { agent_name: FORMATIVE_ACTIVITY_AGENT_NAME }
    );
  }

  return {
    model_name: String(modelName),
    reasoning_effort: (env.OPENAI_REASONING_EFFORT_PLANNING ??
      env.OPENAI_REASONING_EFFORT_FOLLOWUP) as AgentModelConfig["reasoning_effort"],
    max_output_tokens:
      env.OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION ??
      env.OPENAI_MAX_OUTPUT_TOKENS_PLANNING ??
      env.OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP ??
      3500
  };
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

function selectedFormativeValue(packet: FormativeValueDeterminationPacketV1) {
  return packet.student_choice_state.selected_value &&
    packet.student_choice_state.selected_value !== "move_on"
    ? packet.student_choice_state.selected_value
    : packet.primary_value;
}

export function buildFormativeActivityLiveAgentInput(input: LiveActivitySourceInput) {
  const designPacket = buildFormativeActivityDesignPacketFromPackets(input);
  const profile = input.profile_integration_packet;
  const formative = input.formative_value_packet;

  const liveInput = {
    schema_version: FORMATIVE_ACTIVITY_LIVE_INPUT_SCHEMA_VERSION,
    session_public_id: formative.session_public_id,
    student_public_id: formative.student_public_id,
    assessment_public_id: formative.assessment_public_id,
    concept_unit_id: formative.concept_unit_id,
    required_output_contract: {
      schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      generation_source: "live_llm",
      runtime_servable_to_student: true,
      review_only: false
    },
    source_schemas: {
      profile_integration_schema: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
      formative_value_schema: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION
    },
    selected_formative_value: selectedFormativeValue(formative),
    required_activity_family: designPacket.activity_family,
    required_activity_mode: designPacket.activity_mode,
    concept_focus: profile.student_safe_message.knowledge_focus,
    student_safe_profile_status: profile.student_facing_status,
    student_safe_profile_message: profile.student_safe_message.message,
    ability_summary: profile.ability_interpretation.summary,
    confidence_summary: profile.ability_interpretation.confidence_calibration_summary,
    evidence_consistency: profile.ability_interpretation.evidence_consistency,
    main_conceptual_issue: profile.ability_interpretation.main_conceptual_issue,
    formative_value_student_summary: formative.rationale.student_safe_summary,
    formative_value_choice_prompt: formative.student_safe_message.choice_prompt,
    distractor_role: designPacket.distractor_use.distractor_role,
    distractor_student_safe_description: designPacket.distractor_use.student_safe_description,
    activity_goal: designPacket.activity_goal.student_safe_goal,
    expected_student_action_type: designPacket.expected_student_action.action_type,
    required_dialogue_protocol: designPacket.dialogue_protocol,
    required_student_choice_policy: designPacket.student_choice_policy,
    safety_constraints: {
      no_answer_key: true,
      no_correct_option: true,
      no_correctness_label: true,
      no_raw_distractor_metadata: true,
      no_misconception_ids: true,
      no_engagement_or_ai_labels: true,
      no_raw_process_payload: true,
      no_raw_reasoning: true,
      no_raw_llm_output: true,
      no_secrets_or_headers: true,
      no_scored_item_generation: true
    }
  } as const;

  assertNoProhibitedProviderInput(liveInput);
  return liveInput;
}

function candidateWithGeneratedAt(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    return {
      ...candidate,
      generated_at: typeof candidate.generated_at === "string" ? candidate.generated_at : nowIso()
    };
  }
  return value;
}

function auditHasProviderMetadata(audit: FormativeActivityProviderAudit | undefined) {
  return Boolean(audit?.provider_request_id || audit?.provider_response_id);
}

function auditHasTokenUsage(audit: FormativeActivityProviderAudit | undefined) {
  return Boolean(
    typeof audit?.input_tokens === "number" ||
      typeof audit?.output_tokens === "number" ||
      typeof audit?.total_tokens === "number"
  );
}

function auditHasCoreMetadata(audit: FormativeActivityProviderAudit | undefined) {
  return Boolean(audit?.agent_call_id && audit.client_request_id && audit.model_name && audit.provider);
}

function providerAuditFromResult(input: {
  agent_call_id: string;
  model_name: string;
  providerResult: StructuredAgentResult<unknown>;
}): FormativeActivityProviderAudit {
  const ids = providerAuditMetadata(input.providerResult);
  return {
    agent_call_id: input.agent_call_id,
    provider: input.providerResult.provider,
    model_name: input.model_name,
    client_request_id: input.providerResult.client_request_id,
    provider_request_id: ids.provider_request_id,
    provider_response_id: ids.provider_response_id,
    call_status:
      input.providerResult.status === "completed"
        ? "succeeded"
        : input.providerResult.status === "failed"
          ? "failed"
          : "invalid_output",
    output_validated: input.providerResult.status === "completed",
    input_tokens: input.providerResult.usage?.input_tokens,
    output_tokens: input.providerResult.usage?.output_tokens,
    total_tokens: input.providerResult.usage?.total_tokens
  };
}

function pushPipelineIssue(
  issues: FormativeActivityLivePipelineIssue[],
  field_path: string,
  rule_code: FormativeActivityLivePipelineIssue["rule_code"],
  blocked_pattern_label?: string
) {
  issues.push({ field_path, rule_code, ...(blocked_pattern_label ? { blocked_pattern_label } : {}) });
}

const NON_REPAIRABLE_VALIDATION_RULES = new Set<FormativeActivityValidationIssue["rule_code"]>([
  "schema_invalid",
  "invalid_generation_source_metadata",
  "answer_key_leak_detected",
  "correct_option_leak_detected",
  "correctness_label_detected",
  "distractor_metadata_detected",
  "misconception_id_exposed",
  "raw_reasoning_exposed",
  "raw_process_payload_exposed",
  "raw_llm_output_exposed",
  "secret_or_header_exposed",
  "engagement_or_ai_label_exposed",
  "internal_evidence_label_exposed",
  "unsupported_integrity_language_detected",
  "low_participation_language_detected",
  "new_scored_item_generated",
  "unsafe_safety_flag"
]);

function validationIssuesAreRepairable(issues: FormativeActivityValidationIssue[]) {
  return issues.length > 0 && issues.every((issue) => !NON_REPAIRABLE_VALIDATION_RULES.has(issue.rule_code));
}

function addAuditGateIssues(
  issues: FormativeActivityLivePipelineIssue[],
  prefix: "generator" | "reviewer" | "repair",
  audit: FormativeActivityProviderAudit | undefined
) {
  if (!auditHasCoreMetadata(audit)) {
    pushPipelineIssue(issues, `${prefix}_audit`, "missing_audit_metadata");
  }
  if (!auditHasProviderMetadata(audit)) {
    pushPipelineIssue(issues, `${prefix}_audit`, "missing_provider_metadata");
  }
  if (!auditHasTokenUsage(audit)) {
    pushPipelineIssue(issues, `${prefix}_audit`, "missing_token_usage");
  }
}

export function evaluateFormativeActivityLivePipeline(input: {
  candidate_packet: unknown;
  generator_audit: FormativeActivityProviderAudit;
  reviewer_output: unknown;
  reviewer_audit: FormativeActivityProviderAudit;
  repair_packet?: unknown;
  repair_audit?: FormativeActivityProviderAudit;
}): FormativeActivityLivePipelineResult {
  const issues: FormativeActivityLivePipelineIssue[] = [];
  addAuditGateIssues(issues, "generator", input.generator_audit);
  addAuditGateIssues(issues, "reviewer", input.reviewer_audit);

  const reviewParse = FormativeActivityQualityReviewV1Schema.safeParse(input.reviewer_output);
  if (!reviewParse.success) {
    for (const issue of reviewParse.error.issues) {
      pushPipelineIssue(issues, issue.path.join(".") || "quality_review", "reviewer_schema_invalid");
    }
  }
  const review = reviewParse.success ? reviewParse.data : undefined;

  const candidate = candidateWithGeneratedAt(input.candidate_packet);
  const validation = validateFormativeActivityPacket(candidate);
  if (!validation.valid) {
    for (const issue of validation.issues) {
      pushPipelineIssue(
        issues,
        issue.field_path,
        "generator_deterministic_validation_failed",
        issue.rule_code
      );
    }
  }

  if (review?.review_status === "fail_closed") {
    pushPipelineIssue(issues, "quality_review.review_status", "reviewer_fail_closed");
  }

  const repairRequested = review?.review_status === "repair_needed";
  const deterministicRepairAllowed = !validation.valid && validationIssuesAreRepairable(validation.issues);
  const reviewerRepairAllowed = validation.valid && repairRequested;
  const repairAllowed = deterministicRepairAllowed || reviewerRepairAllowed;

  if (repairRequested && !repairAllowed) {
    pushPipelineIssue(issues, "quality_review.review_status", "repair_not_allowed");
  }

  if (issues.length > 0 && !repairAllowed) {
    return {
      status: "rejected",
      quality_review: review,
      repair_attempted: false,
      issues,
      blocked_reason: "formative_activity_live_hard_gate_failed"
    };
  }

  if (repairAllowed) {
    if (!input.repair_packet || !input.repair_audit) {
      pushPipelineIssue(issues, "repair_packet", "repair_missing");
      return {
        status: "rejected",
        quality_review: review,
        repair_attempted: false,
        issues,
        blocked_reason: "formative_activity_repair_missing"
      };
    }

    const repairIssues = issues.filter((issue) =>
      !["generator_deterministic_validation_failed", "reviewer_repair_needed"].includes(issue.rule_code)
    );
    addAuditGateIssues(repairIssues, "repair", input.repair_audit);
    const repairValidation = validateFormativeActivityPacket(candidateWithGeneratedAt(input.repair_packet));
    if (!repairValidation.valid) {
      for (const issue of repairValidation.issues) {
        pushPipelineIssue(
          repairIssues,
          issue.field_path,
          "repair_deterministic_validation_failed",
          issue.rule_code
        );
      }
    }
    if (repairIssues.length > 0 || !repairValidation.valid) {
      return {
        status: "rejected",
        quality_review: review,
        repair_attempted: true,
        issues: repairIssues,
        blocked_reason: "formative_activity_repair_failed_hard_gate"
      };
    }

    try {
      assertFormativeActivityPacketIsNotReviewOnlyForRuntime(repairValidation.packet);
    } catch (error) {
      pushPipelineIssue(
        repairIssues,
        "repair_packet",
        "runtime_guard_rejected",
        error instanceof Error ? error.message : "runtime_guard_error"
      );
      return {
        status: "rejected",
        quality_review: review,
        repair_attempted: true,
        issues: repairIssues,
        blocked_reason: "formative_activity_runtime_guard_rejected_repair"
      };
    }

    return {
      status: "accepted",
      packet: repairValidation.packet,
      quality_review: review ?? failClosedReview("reviewer_schema_missing_after_repair"),
      repair_attempted: true,
      issues: []
    };
  }

  if (!validation.valid || issues.length > 0 || !review || review.review_status !== "pass") {
    if (review?.review_status === "repair_needed") {
      pushPipelineIssue(issues, "quality_review.review_status", "reviewer_repair_needed");
    }
    return {
      status: "rejected",
      quality_review: review,
      repair_attempted: false,
      issues,
      blocked_reason: "formative_activity_live_pipeline_rejected"
    };
  }

  try {
    assertFormativeActivityPacketIsNotReviewOnlyForRuntime(validation.packet);
  } catch (error) {
    pushPipelineIssue(
      issues,
      "candidate_packet",
      "runtime_guard_rejected",
      error instanceof Error ? error.message : "runtime_guard_error"
    );
    return {
      status: "rejected",
      quality_review: review,
      repair_attempted: false,
      issues,
      blocked_reason: "formative_activity_runtime_guard_rejected"
    };
  }

  return {
    status: "accepted",
    packet: validation.packet,
    quality_review: review,
    repair_attempted: false,
    issues: []
  };
}

function failClosedReview(reason: string): FormativeActivityQualityReviewV1 {
  return {
    schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
    review_status: "fail_closed",
    quality_score: "unsafe",
    student_specificity: "unsafe",
    conceptual_depth: "unsafe",
    distractor_use_quality: "unsafe",
    formative_value_alignment: "unsafe",
    activity_family_alignment: "unsafe",
    overclaiming_risk: "high",
    student_safety_risk: "high",
    issues: [{
      field_path: "quality_review",
      rule_code: reason,
      severity: "critical",
      safe_summary: "Quality review could not safely approve this output."
    }],
    repair_instructions: []
  };
}

function passedQualityReview(): FormativeActivityQualityReviewV1 {
  return {
    schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
    review_status: "pass",
    quality_score: "strong",
    student_specificity: "strong",
    conceptual_depth: "strong",
    distractor_use_quality: "adequate",
    formative_value_alignment: "strong",
    activity_family_alignment: "strong",
    overclaiming_risk: "none",
    student_safety_risk: "none",
    issues: [],
    repair_instructions: []
  };
}

async function createAgentCall(input: {
  audit_context?: Awaited<ReturnType<typeof resolveAuditContext>>;
  agent_name: string;
  agent_version: string;
  model_config: AgentModelConfig;
  provider_label: ProviderLabel;
  prompt_hash: string;
  prompt_version: string;
  schema_version: string;
  input_payload: unknown;
  live_call_allowed: boolean;
  invocation_prefix: string;
}) {
  const startedAt = new Date();
  const clientRequestId = `${input.invocation_prefix}_${randomUUID()}`;

  const agentCall = await prisma.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.audit_context?.assessment_session_db_id,
      concept_unit_session_db_id: input.audit_context?.concept_unit_session_db_id,
      agent_name: input.agent_name,
      agent_version: input.agent_version,
      model_name: input.model_config.model_name,
      provider: input.provider_label,
      client_request_id: clientRequestId,
      agent_invocation_key: `${input.invocation_prefix}:${hashJson(input.input_payload).slice(0, 24)}:${randomUUID()}`,
      prompt_hash: input.prompt_hash,
      reasoning_effort: input.model_config.reasoning_effort,
      max_output_tokens: input.model_config.max_output_tokens,
      prompt_version: input.prompt_version,
      schema_version: input.schema_version,
      input_payload: prismaJson(redactForAudit(input.input_payload)),
      live_call_allowed: input.live_call_allowed,
      call_status: "started",
      started_at: startedAt
    }
  });

  return { agentCall, clientRequestId };
}

async function executeStructuredWithAudit<TInput, TOutput>(input: {
  audit_context?: Awaited<ReturnType<typeof resolveAuditContext>>;
  provider: LlmProvider;
  provider_label: ProviderLabel;
  model_config: AgentModelConfig;
  request_timeout_ms: number;
  live_call_allowed: boolean;
  agent_name: string;
  agent_version: string;
  prompt_hash: string;
  prompt_version: string;
  instructions: string;
  request_input: TInput;
  output_schema: z.ZodType<TOutput>;
  schema_version: string;
  schema_name: string;
  invocation_prefix: string;
  metadata: Record<string, string>;
}) {
  assertNoProhibitedProviderInput(input.request_input);
  const { agentCall, clientRequestId } = await createAgentCall({
    audit_context: input.audit_context,
    agent_name: input.agent_name,
    agent_version: input.agent_version,
    model_config: input.model_config,
    provider_label: input.provider_label,
    prompt_hash: input.prompt_hash,
    prompt_version: input.prompt_version,
    schema_version: input.schema_version,
    input_payload: input.request_input,
    live_call_allowed: input.live_call_allowed,
    invocation_prefix: input.invocation_prefix
  });

  try {
    const providerResult = await input.provider.executeStructured({
      agent_name: input.agent_name as unknown as AgentName,
      model_config: input.model_config,
      instructions: input.instructions,
      input: input.request_input,
      output_schema: input.output_schema,
      schema_name: input.schema_name.replace(/[^a-zA-Z0-9_-]/g, "_"),
      client_request_id: clientRequestId,
      timeout_ms: input.request_timeout_ms,
      metadata: input.metadata
    });

    if (providerResult.status === "completed") {
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...providerAuditUpdate(providerResult),
          output_payload: prismaJson(providerResult.parsed_output ?? Prisma.JsonNull),
          output_validated: true,
          call_status: "succeeded",
          completed_at: new Date()
        }
      });
    } else {
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
              "Formative activity provider call did not complete."
          }),
          refusal_text: providerResult.refusal,
          incomplete_reason: providerResult.incomplete_reason,
          call_status: "failed",
          error_category: providerResult.error?.category ?? providerResult.status,
          blocked_reason: safeProviderFailureReason(providerResult),
          completed_at: new Date()
        }
      });
    }

    return {
      agent_call_id: agentCall.id,
      providerResult
    };
  } catch (error) {
    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "provider_failure",
          message: error instanceof Error ? error.message : "Formative activity provider call failed."
        }),
        call_status: "failed",
        error_category: "unexpected_provider_response",
        completed_at: new Date()
      }
    });

    throw error;
  }
}

export type FormativeActivityLiveExecutionResult =
  | {
      status: "succeeded";
      packet: FormativeActivityPacketV1;
      quality_review: FormativeActivityQualityReviewV1;
      generator_agent_call_id: string;
      reviewer_agent_call_id: string;
      repair_agent_call_id?: string;
      repair_attempted: boolean;
    }
  | {
      status: "failed" | "invalid_output" | "configuration_blocked";
      blocked_reason: string;
      validation_issues: FormativeActivityLivePipelineIssue[];
      generator_agent_call_id?: string;
      reviewer_agent_call_id?: string;
      repair_agent_call_id?: string;
      repair_attempted: boolean;
    };

export async function executeLiveFormativeActivityDialogueAgent(input: {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
  provider_override?: LlmProvider;
}): Promise<FormativeActivityLiveExecutionResult> {
  let runtime;
  let modelConfig;

  try {
    runtime = getLlmRuntimeConfig();
    modelConfig = resolveFormativeActivityModelConfig();
  } catch (error) {
    return {
      status: "configuration_blocked",
      blocked_reason: error instanceof Error ? error.message : "Formative activity live configuration failed.",
      validation_issues: [{
        field_path: "configuration",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: error instanceof LlmConfigurationError ? error.code : "configuration_error"
      }],
      repair_attempted: false
    };
  }

  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    return {
      status: "configuration_blocked",
      blocked_reason: "Set LLM_PROVIDER=openai and LLM_LIVE_CALLS_ENABLED=true for live formative activity generation.",
      validation_issues: [{
        field_path: "configuration",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: "live_calls_not_enabled"
      }],
      repair_attempted: false
    };
  }

  const provider = input.provider_override ?? createLlmProvider();
  const providerLabel: ProviderLabel = input.provider_override ? "mock" : "openai";
  const agentInput = buildFormativeActivityLiveAgentInput(input);
  const auditContext = await resolveAuditContext(input.formative_value_packet.session_public_id);

  const generator = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    agent_version: FORMATIVE_ACTIVITY_AGENT_VERSION,
    prompt_hash: FORMATIVE_ACTIVITY_PROMPT_HASH,
    prompt_version: FORMATIVE_ACTIVITY_PROMPT_VERSION,
    instructions: FORMATIVE_ACTIVITY_PROMPT_INSTRUCTIONS,
    request_input: agentInput,
    output_schema: FormativeActivityPacketV1Schema,
    schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    schema_name: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    invocation_prefix: "formative_activity_generator",
    metadata: {
      purpose: "chat_native_formative_activity_generation",
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      prompt_version: FORMATIVE_ACTIVITY_PROMPT_VERSION,
      schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION
    }
  });

  if (generator.providerResult.status !== "completed") {
    return {
      status: "failed",
      blocked_reason: "formative_activity_generator_provider_failed",
      validation_issues: [{
        field_path: "generator_provider",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: safeProviderFailureReason(generator.providerResult)
      }],
      generator_agent_call_id: generator.agent_call_id,
      repair_attempted: false
    };
  }

  const reviewerInput = {
    schema_version: "formative-activity-reviewer-input-v1",
    source_input: agentInput,
    candidate_packet: candidateWithGeneratedAt(generator.providerResult.parsed_output)
  };
  const reviewer = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
    agent_version: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_VERSION,
    prompt_hash: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_HASH,
    prompt_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_VERSION,
    instructions: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_INSTRUCTIONS,
    request_input: reviewerInput,
    output_schema: FormativeActivityQualityReviewV1Schema,
    schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    schema_name: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    invocation_prefix: "formative_activity_quality_review",
    metadata: {
      purpose: "chat_native_formative_activity_quality_review",
      agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
      prompt_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_VERSION,
      schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION
    }
  });

  if (reviewer.providerResult.status !== "completed") {
    return {
      status: "failed",
      blocked_reason: "formative_activity_reviewer_provider_failed",
      validation_issues: [{
        field_path: "reviewer_provider",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: safeProviderFailureReason(reviewer.providerResult)
      }],
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_attempted: false
    };
  }

  const firstPipeline = evaluateFormativeActivityLivePipeline({
    candidate_packet: generator.providerResult.parsed_output,
    generator_audit: providerAuditFromResult({
      agent_call_id: generator.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: generator.providerResult
    }),
    reviewer_output: reviewer.providerResult.parsed_output,
    reviewer_audit: providerAuditFromResult({
      agent_call_id: reviewer.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: reviewer.providerResult
    })
  });

  if (firstPipeline.status === "accepted") {
    return {
      status: "succeeded",
      packet: firstPipeline.packet,
      quality_review: firstPipeline.quality_review,
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_attempted: false
    };
  }

  const repairIsAllowed = firstPipeline.issues.every((issue) =>
    issue.rule_code === "generator_deterministic_validation_failed" ||
      issue.rule_code === "reviewer_repair_needed" ||
      issue.rule_code === "repair_missing"
  );
  const reviewerOutput = FormativeActivityQualityReviewV1Schema.safeParse(
    reviewer.providerResult.parsed_output
  );

  if (!repairIsAllowed || reviewerOutput.data?.review_status !== "repair_needed") {
    await prisma.agentCall.update({
      where: { id: generator.agent_call_id },
      data: {
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "formative_activity_pipeline_validation",
          issues: firstPipeline.issues
        }),
        call_status: "invalid_output",
        error_category: "formative_activity_pipeline_validation"
      }
    });
    return {
      status: "invalid_output",
      blocked_reason: firstPipeline.blocked_reason,
      validation_issues: firstPipeline.issues,
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_attempted: false
    };
  }

  if (firstPipeline.issues.some((issue) => issue.rule_code === "generator_deterministic_validation_failed")) {
    await prisma.agentCall.update({
      where: { id: generator.agent_call_id },
      data: {
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "formative_activity_pipeline_validation",
          issues: firstPipeline.issues
        }),
        call_status: "invalid_output",
        error_category: "formative_activity_pipeline_validation"
      }
    });
  }

  const repairInput = {
    schema_version: "formative-activity-repair-input-v1",
    source_input: agentInput,
    candidate_packet: candidateWithGeneratedAt(generator.providerResult.parsed_output),
    safe_repair_instructions: reviewerOutput.data.repair_instructions,
    safe_review_issues: reviewerOutput.data.issues.map((issue) => ({
      field_path: issue.field_path,
      rule_code: issue.rule_code,
      severity: issue.severity,
      safe_summary: issue.safe_summary
    }))
  };
  const repair = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    agent_version: FORMATIVE_ACTIVITY_AGENT_VERSION,
    prompt_hash: FORMATIVE_ACTIVITY_REPAIR_PROMPT_HASH,
    prompt_version: FORMATIVE_ACTIVITY_REPAIR_PROMPT_VERSION,
    instructions: FORMATIVE_ACTIVITY_REPAIR_PROMPT_INSTRUCTIONS,
    request_input: repairInput,
    output_schema: FormativeActivityPacketV1Schema,
    schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    schema_name: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    invocation_prefix: "formative_activity_repair",
    metadata: {
      purpose: "chat_native_formative_activity_repair",
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      prompt_version: FORMATIVE_ACTIVITY_REPAIR_PROMPT_VERSION,
      schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION
    }
  });

  const repairedPipeline = evaluateFormativeActivityLivePipeline({
    candidate_packet: generator.providerResult.parsed_output,
    generator_audit: providerAuditFromResult({
      agent_call_id: generator.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: generator.providerResult
    }),
    reviewer_output: reviewer.providerResult.parsed_output,
    reviewer_audit: providerAuditFromResult({
      agent_call_id: reviewer.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: reviewer.providerResult
    }),
    repair_packet: repair.providerResult.parsed_output,
    repair_audit: providerAuditFromResult({
      agent_call_id: repair.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: repair.providerResult
    })
  });

  if (repairedPipeline.status === "accepted") {
    return {
      status: "succeeded",
      packet: repairedPipeline.packet,
      quality_review: repairedPipeline.quality_review,
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_agent_call_id: repair.agent_call_id,
      repair_attempted: true
    };
  }

  return {
    status: "invalid_output",
    blocked_reason: repairedPipeline.blocked_reason,
    validation_issues: repairedPipeline.issues,
    generator_agent_call_id: generator.agent_call_id,
    reviewer_agent_call_id: reviewer.agent_call_id,
    repair_agent_call_id: repair.agent_call_id,
    repair_attempted: true
  };
}

export function makeLiveActivityPacketForTest(packet: FormativeActivityPacketV1) {
  return FormativeActivityPacketV1Schema.parse({
    ...packet,
    generation_source: "live_llm",
    runtime_servable_to_student: true,
    review_only: false,
    generated_at: nowIso()
  });
}

export function makePassingActivityQualityReviewForTest(
  overrides: Partial<FormativeActivityQualityReviewV1> = {}
) {
  return FormativeActivityQualityReviewV1Schema.parse({
    ...passedQualityReview(),
    ...overrides
  });
}

export function makeFormativeActivityAuditForTest(
  overrides: Partial<FormativeActivityProviderAudit> = {}
): FormativeActivityProviderAudit {
  return {
    agent_call_id: `agent_call_${randomUUID()}`,
    provider: "mock",
    model_name: "mock-formative-activity-dialogue",
    client_request_id: `client_${randomUUID()}`,
    provider_request_id: `mock_req_${randomUUID()}`,
    provider_response_id: `mock_resp_${randomUUID()}`,
    call_status: "succeeded",
    output_validated: true,
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    ...overrides
  };
}

export const FORMATIVE_ACTIVITY_LIVE_SMOKE_FAMILIES = FormativeActivityFamilySchema.options;
