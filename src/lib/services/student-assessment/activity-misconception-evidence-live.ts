import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import type { AgentName } from "@/lib/agents/names";
import { getServerEnv } from "@/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError, type AgentModelConfig } from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { toPrismaJson } from "@/lib/services/json";
import {
  assessmentInterpretationContextAuditMetadata,
  buildAssessmentInterpretationContextFromResponsePackage,
  type AssessmentInterpretationContextAuditMetadata,
  type AssessmentInterpretationContextV1
} from "@/lib/services/student-assessment/assessment-interpretation-context";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
  ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
  ActivityMisconceptionEvidencePacketV1Schema,
  assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate,
  validateActivityMisconceptionEvidencePacket,
  type ActivityMisconceptionEvidencePacketV1,
  type ActivityMisconceptionEvidenceValidationIssue,
  type ActivityResponseKind,
  type DiagnosticPurpose,
  type MisconceptionUpdateStatus
} from "./activity-misconception-evidence";
import type { FormativeActivityFamily } from "./formative-activity-design";
import type { FormativeValue } from "./formative-value-determination";

export const ACTIVITY_RESPONSE_EVALUATOR_AGENT_VERSION =
  "formative-activity-response-evaluator-v1" as const;
export const ACTIVITY_RESPONSE_EVALUATOR_PROMPT_VERSION =
  "formative-activity-response-evaluator-prompt-v6" as const;
export const ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_VERSION =
  "formative-activity-response-evaluator-repair-prompt-v2" as const;
export const ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION =
  "formative-activity-response-evaluator-input-v1" as const;
export const ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_ARTIFACT_VERSION =
  "activity-misconception-evidence-live-smoke-v1" as const;

export const ACTIVITY_RESPONSE_EVALUATOR_PROMPT_INSTRUCTIONS = [
  "You are the formative_activity_response_evaluator_agent.",
  "Evaluate a student's response to a formative activity using only the supplied synthetic, redacted evidence.",
  "Your output is an internal evidence packet, not a student-facing activity and not a profile update.",
  "Set evaluation_source to live_llm, runtime_servable_to_student to false, review_only to false, and deterministic_final_diagnostic_decision_used to false.",
  "Do not expose answer keys, correct options, correctness labels, distractor metadata, misconception IDs, raw student text, raw process payloads, raw LLM output, or secret-like content.",
  "In free-text fields, do not name forbidden categories such as answer-key terms, correctness terms, raw metadata terms, raw model terms, or secret/header terms. If needed, say protected assessment details.",
  "Do not claim misconduct, cheating, GenAI use, response provenance, or authenticity.",
  "Process context may only affect evidence quality or limitations. It must never create a misconception status by itself.",
  "Do not use process-context-only limitation wording when the update status is based on the student's response evidence.",
  "For source_diagnostic_purpose=conceptual_entry_grounding, use conceptual_entry_gap_remains, conceptual_entry_improved, or ready_for_distractor_probe. Do not use distractor-update statuses for conceptual-entry grounding.",
  "For source_diagnostic_purpose=distractor_misconception_probe, use misconception_persisted, misconception_weakened, misconception_unsupported, or no_actionable_misconception_evidence. Reserve boundary_understanding_improved for source_diagnostic_purpose=reasoning_boundary_repair.",
  "For partial distractor evidence that names some tempting-assumption evidence but leaves the target boundary incomplete, use misconception_weakened rather than boundary_understanding_improved.",
  "A response that restates the targeted tempting assumption is elicited response evidence even when the reasoning remains problematic. Do not set evidence types to none solely because the misconception appears to persist.",
  "If response_kind_hint is move_on or the response explicitly chooses to move on, use student_chose_move_on. If response_kind_hint is choose_other_activity or the response asks for a different activity, use student_requested_alternative_activity. These are student-choice states, not concept-evidence states.",
  "A low-information response such as 'I understand now' is insufficient new evidence unless the response also explains a concept boundary, hidden assumption, reasoning link, or independent reconstruction.",
  "Use conservative status labels when evidence is incomplete or conflicting.",
  "Return only the required JSON schema."
].join("\n");

export const ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS = [
  "You are repairing a formative_activity_response_evaluator_agent output that failed safe schema or wording checks.",
  "Use only the original synthetic evaluator input and safe repair instructions.",
  "Make one corrected student-activity misconception evidence packet.",
  "Do not add answer keys, correctness labels, raw metadata, raw student text, process payloads, or secrets.",
  "In free-text fields, do not name forbidden categories such as answer-key terms, correctness terms, raw metadata terms, raw model terms, or secret/header terms. If needed, say protected assessment details.",
  "Do not change to no_live_fixture or any deterministic source. The repaired packet must use evaluation_source live_llm.",
  "Return only the required JSON schema."
].join("\n");

export const ACTIVITY_RESPONSE_EVALUATOR_PROMPT_HASH = createHash("sha256")
  .update(ACTIVITY_RESPONSE_EVALUATOR_PROMPT_INSTRUCTIONS)
  .digest("hex");
export const ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_HASH = createHash("sha256")
  .update(ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS)
  .digest("hex");

type ProviderLabel = "mock" | "openai";

export type ActivityMisconceptionEvidenceProviderAudit = {
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

export type ActivityMisconceptionEvidenceLivePipelineIssue = {
  field_path: string;
  rule_code:
    | "candidate_validation_failed"
    | "repair_validation_failed"
    | "missing_provider_metadata"
    | "missing_token_usage"
    | "missing_audit_metadata"
    | "repair_missing"
    | "repair_not_allowed"
    | "runtime_guard_rejected";
  blocked_pattern_label?: string;
};

export type ActivityMisconceptionEvidenceLivePipelineResult =
  | {
      status: "accepted";
      packet: ActivityMisconceptionEvidencePacketV1;
      repair_attempted: boolean;
      issues: [];
    }
  | {
      status: "rejected";
      repair_attempted: boolean;
      issues: ActivityMisconceptionEvidenceLivePipelineIssue[];
      blocked_reason: string;
    };

export type ActivityMisconceptionEvidenceLiveEvaluationInput = {
  case_id?: string;
  session_public_id: string;
  student_public_id: string;
  assessment_public_id: string;
  concept_unit_id: string;
  activity_attempt_id: string;
  source_activity_family: FormativeActivityFamily;
  selected_formative_value: FormativeValue;
  source_diagnostic_purpose: DiagnosticPurpose;
  profile_condition: string;
  distractor_role: string;
  safe_activity_prompt: string;
  safe_student_activity_response: string;
  response_kind_hint?: ActivityResponseKind;
  expected_evidence_focus: string;
  assessment_interpretation_context?: AssessmentInterpretationContextV1;
};

export type ActivityMisconceptionEvidenceLiveAgentInput =
  ReturnType<typeof buildActivityMisconceptionEvidenceLiveAgentInput>;

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
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
    | "activity_misconception_evidence_validation"
    | "activity_misconception_evidence_provider_failure";
  issues?: ActivityMisconceptionEvidenceLivePipelineIssue[];
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

function resolveActivityEvidenceEvaluatorModelConfig(): AgentModelConfig {
  const env = getServerEnv();
  const modelName = [env.OPENAI_MODEL_PROFILE_INTEGRATION, env.OPENAI_MODEL_PLANNING, env.OPENAI_MODEL_FOLLOWUP]
    .find((value) => configured(value));

  if (!configured(modelName)) {
    throw new LlmConfigurationError(
      "activity_misconception_evidence_model_missing",
      "OPENAI_MODEL_PROFILE_INTEGRATION, OPENAI_MODEL_PLANNING, or OPENAI_MODEL_FOLLOWUP is required when live activity misconception evidence evaluation is explicitly enabled.",
      { agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME }
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
      3000
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

async function resolveAssessmentContext(sessionPublicId: string) {
  const responsePackage = await prisma.responsePackage.findFirst({
    where: {
      package_type: "initial_concept_unit_response_package",
      concept_unit_session: {
        assessment_session: {
          session_public_id: sessionPublicId
        }
      }
    },
    orderBy: [{ created_at: "desc" }],
    select: { payload: true }
  });

  return responsePackage
    ? buildAssessmentInterpretationContextFromResponsePackage({
        response_package_payload: responsePackage.payload,
        phase: "post_activity_evaluation",
        prior_activity_evidence_summary:
          "Activity response evaluator receives the current activity response and prior assessment context."
      })
    : undefined;
}

export function buildActivityMisconceptionEvidenceLiveAgentInput(
  input: ActivityMisconceptionEvidenceLiveEvaluationInput
) {
  const contextFields = input.assessment_interpretation_context
    ? {
        assessment_interpretation_context: input.assessment_interpretation_context,
        assessment_context_audit: assessmentInterpretationContextAuditMetadata(
          input.assessment_interpretation_context
        ) satisfies AssessmentInterpretationContextAuditMetadata
      }
    : {};
  const liveInput = {
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
    case_id: input.case_id ?? null,
    session_public_id: input.session_public_id,
    student_public_id: input.student_public_id,
    assessment_public_id: input.assessment_public_id,
    concept_unit_id: input.concept_unit_id,
    activity_attempt_id: input.activity_attempt_id,
    required_output_contract: {
      schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
      evaluator_agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
      evaluation_source: "live_llm",
      runtime_servable_to_student: false,
      review_only: false
    },
    source_activity_context: {
      source_activity_schema: "formative-activity-v1",
      source_activity_generation_source: "live_llm",
      source_activity_runtime_servable_to_student: true,
      source_activity_family: input.source_activity_family,
      selected_formative_value: input.selected_formative_value,
      source_diagnostic_purpose: input.source_diagnostic_purpose,
      profile_condition: input.profile_condition,
      distractor_role: input.distractor_role,
      safe_activity_prompt: input.safe_activity_prompt
    },
    student_activity_response: {
      safe_response_summary: input.safe_student_activity_response,
      response_kind_hint: input.response_kind_hint ?? null
    },
    diagnostic_task: {
      expected_evidence_focus: input.expected_evidence_focus,
      process_context_is_reliability_context_only: true,
      low_information_response_policy:
        "Low-information agreement such as 'I understand now' is insufficient new evidence unless supported by a concept boundary, hidden assumption, reasoning link, or independent reconstruction."
    },
    required_safety_constraints: {
      no_answer_key: true,
      no_correct_option: true,
      no_correctness_label: true,
      no_raw_distractor_metadata: true,
      no_misconception_ids: true,
      no_engagement_or_ai_labels: true,
      no_raw_process_payload: true,
      no_raw_student_text: true,
      no_raw_llm_output: true,
      no_secrets_or_headers: true,
      no_misconduct_or_genai_accusation: true
    },
    ...contextFields
  } as const;

  assertNoProhibitedProviderInput(liveInput);
  return liveInput;
}

function auditHasProviderMetadata(audit: ActivityMisconceptionEvidenceProviderAudit | undefined) {
  return Boolean(audit?.provider_request_id || audit?.provider_response_id);
}

function auditHasTokenUsage(audit: ActivityMisconceptionEvidenceProviderAudit | undefined) {
  return Boolean(
    typeof audit?.input_tokens === "number" ||
      typeof audit?.output_tokens === "number" ||
      typeof audit?.total_tokens === "number"
  );
}

function auditHasCoreMetadata(audit: ActivityMisconceptionEvidenceProviderAudit | undefined) {
  return Boolean(audit?.agent_call_id && audit.client_request_id && audit.model_name && audit.provider);
}

function providerAuditFromResult(input: {
  agent_call_id: string;
  model_name: string;
  providerResult: StructuredAgentResult<unknown>;
}): ActivityMisconceptionEvidenceProviderAudit {
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
  issues: ActivityMisconceptionEvidenceLivePipelineIssue[],
  field_path: string,
  rule_code: ActivityMisconceptionEvidenceLivePipelineIssue["rule_code"],
  blocked_pattern_label?: string
) {
  issues.push({ field_path, rule_code, ...(blocked_pattern_label ? { blocked_pattern_label } : {}) });
}

function addAuditGateIssues(
  issues: ActivityMisconceptionEvidenceLivePipelineIssue[],
  prefix: "evaluator" | "repair",
  audit: ActivityMisconceptionEvidenceProviderAudit | undefined
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

const NON_REPAIRABLE_VALIDATION_RULES = new Set<ActivityMisconceptionEvidenceValidationIssue["rule_code"]>([
  "invalid_generation_source_metadata",
  "deterministic_fixture_not_production_evaluation",
  "deterministic_final_diagnostic_decision_used",
  "answer_key_leak_detected",
  "correct_option_value_leak_detected",
  "correctness_label_detected",
  "raw_distractor_metadata_exposed",
  "raw_misconception_id_exposed",
  "engagement_or_ai_label_exposed",
  "raw_process_payload_exposed",
  "raw_llm_output_exposed",
  "secret_or_header_exposed",
  "misconduct_language_detected",
  "invalid_no_actionable_claim",
  "invalid_conceptual_entry_improvement_claim",
  "process_context_only_misconception_claim"
]);

function issueCanTriggerRepair(issue: ActivityMisconceptionEvidenceLivePipelineIssue) {
  if (issue.rule_code !== "candidate_validation_failed") {
    return false;
  }
  if (
    issue.blocked_pattern_label?.startsWith("activity_misconception_evidence_runtime_rejected") ||
    issue.blocked_pattern_label === "live_evaluator_output_must_use_live_llm_source"
  ) {
    return false;
  }

  return !NON_REPAIRABLE_VALIDATION_RULES.has(
    issue.blocked_pattern_label as ActivityMisconceptionEvidenceValidationIssue["rule_code"]
  );
}

export function activityMisconceptionEvidencePipelineIssuesAllowRepair(
  issues: ActivityMisconceptionEvidenceLivePipelineIssue[]
) {
  return issues.length > 0 && issues.every(issueCanTriggerRepair);
}

function validateProductionLivePacket(
  value: unknown,
  target: "candidate" | "repair"
): {
  packet?: ActivityMisconceptionEvidencePacketV1;
  issues: ActivityMisconceptionEvidenceLivePipelineIssue[];
} {
  const issues: ActivityMisconceptionEvidenceLivePipelineIssue[] = [];
  const validation = validateActivityMisconceptionEvidencePacket(value);

  if (!validation.valid) {
    for (const issue of validation.issues) {
      pushPipelineIssue(
        issues,
        issue.field_path,
        target === "candidate" ? "candidate_validation_failed" : "repair_validation_failed",
        issue.rule_code
      );
    }
    return { issues };
  }

  try {
    assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate(value);
  } catch (error) {
    pushPipelineIssue(
      issues,
      "evaluation_source",
      target === "candidate" ? "candidate_validation_failed" : "repair_validation_failed",
      error instanceof Error ? error.message : "runtime_guard_rejected"
    );
    return { issues };
  }

  const packet = ActivityMisconceptionEvidencePacketV1Schema.parse(value);
  if (packet.evaluation_source !== "live_llm") {
    pushPipelineIssue(
      issues,
      "evaluation_source",
      target === "candidate" ? "candidate_validation_failed" : "repair_validation_failed",
      "live_evaluator_output_must_use_live_llm_source"
    );
  }

  return { packet, issues };
}

export function evaluateActivityMisconceptionEvidenceLivePipeline(input: {
  candidate_packet: unknown;
  evaluator_audit: ActivityMisconceptionEvidenceProviderAudit;
  repair_packet?: unknown;
  repair_audit?: ActivityMisconceptionEvidenceProviderAudit;
}): ActivityMisconceptionEvidenceLivePipelineResult {
  const issues: ActivityMisconceptionEvidenceLivePipelineIssue[] = [];
  addAuditGateIssues(issues, "evaluator", input.evaluator_audit);

  const candidateValidation = validateProductionLivePacket(input.candidate_packet, "candidate");
  issues.push(...candidateValidation.issues);

  if (issues.length === 0 && candidateValidation.packet) {
    return {
      status: "accepted",
      packet: candidateValidation.packet,
      repair_attempted: false,
      issues: []
    };
  }

  const repairAllowed = activityMisconceptionEvidencePipelineIssuesAllowRepair(issues);
  if (!repairAllowed) {
    return {
      status: "rejected",
      repair_attempted: false,
      issues,
      blocked_reason: "activity_misconception_evidence_live_hard_gate_failed"
    };
  }

  if (!input.repair_packet || !input.repair_audit) {
    pushPipelineIssue(issues, "repair_packet", "repair_missing");
    return {
      status: "rejected",
      repair_attempted: false,
      issues,
      blocked_reason: "activity_misconception_evidence_repair_missing"
    };
  }

  const repairIssues: ActivityMisconceptionEvidenceLivePipelineIssue[] = [];
  addAuditGateIssues(repairIssues, "repair", input.repair_audit);
  const repairValidation = validateProductionLivePacket(input.repair_packet, "repair");
  repairIssues.push(...repairValidation.issues);

  if (repairIssues.length > 0 || !repairValidation.packet) {
    return {
      status: "rejected",
      repair_attempted: true,
      issues: repairIssues,
      blocked_reason: "activity_misconception_evidence_repair_failed_hard_gate"
    };
  }

  return {
    status: "accepted",
    packet: repairValidation.packet,
    repair_attempted: true,
    issues: []
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
            category: "activity_misconception_evidence_provider_failure",
            message:
              providerResult.error?.message ??
              providerResult.refusal ??
              providerResult.incomplete_reason ??
              "Activity misconception evidence provider call did not complete."
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
          category: "activity_misconception_evidence_provider_failure",
          message: error instanceof Error ? error.message : "Activity misconception evidence provider call failed."
        }),
        call_status: "failed",
        error_category: "unexpected_provider_response",
        completed_at: new Date()
      }
    });

    throw error;
  }
}

function repairInstructionsFromIssues(issues: ActivityMisconceptionEvidenceLivePipelineIssue[]) {
  return issues.map((issue) => {
    switch (issue.blocked_pattern_label) {
      case "schema_invalid":
        return "Return a complete object matching the required schema and enum labels.";
      case "generic_student_feedback_detected":
        return "Replace generic feedback with a concise student-safe message that names what the response did or did not evidence and offers safe next options.";
      case "missing_evidence_type":
        return "Use 'none' only when no evidence was elicited, otherwise use specific evidence types without mixing 'none' with other labels.";
      default:
        return `Repair safe issue at ${issue.field_path}: ${issue.blocked_pattern_label ?? issue.rule_code}.`;
    }
  }).slice(0, 10);
}

export type ActivityMisconceptionEvidenceLiveExecutionResult =
  | {
      status: "succeeded";
      packet: ActivityMisconceptionEvidencePacketV1;
      evaluator_agent_call_id: string;
      repair_agent_call_id?: string;
      repair_attempted: boolean;
      evaluator_call_status: "succeeded" | "invalid_output";
      repair_status: "not_attempted" | "succeeded";
    }
  | {
      status: "failed" | "invalid_output" | "configuration_blocked";
      blocked_reason: string;
      validation_issues: ActivityMisconceptionEvidenceLivePipelineIssue[];
      evaluator_agent_call_id?: string;
      repair_agent_call_id?: string;
      repair_attempted: boolean;
      evaluator_call_status?: "not_started" | "succeeded" | "failed" | "invalid_output";
      repair_status?: "not_attempted" | "succeeded" | "failed" | "invalid_output";
    };

export async function executeLiveActivityMisconceptionEvidenceEvaluator(input: {
  evaluation_input: ActivityMisconceptionEvidenceLiveEvaluationInput;
  provider_override?: LlmProvider;
}): Promise<ActivityMisconceptionEvidenceLiveExecutionResult> {
  let runtime;
  let modelConfig;

  try {
    runtime = getLlmRuntimeConfig();
    modelConfig = resolveActivityEvidenceEvaluatorModelConfig();
  } catch (error) {
    return {
      status: "configuration_blocked",
      blocked_reason: error instanceof Error ? error.message : "Activity evidence live configuration failed.",
      validation_issues: [{
        field_path: "configuration",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: error instanceof LlmConfigurationError ? error.code : "configuration_error"
      }],
      repair_attempted: false,
      evaluator_call_status: "not_started",
      repair_status: "not_attempted"
    };
  }

  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    return {
      status: "configuration_blocked",
      blocked_reason: "Set LLM_PROVIDER=openai and LLM_LIVE_CALLS_ENABLED=true for live activity misconception evidence evaluation.",
      validation_issues: [{
        field_path: "configuration",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: "live_calls_not_enabled"
      }],
      repair_attempted: false,
      evaluator_call_status: "not_started",
      repair_status: "not_attempted"
    };
  }

  const provider = input.provider_override ?? createLlmProvider();
  const providerLabel: ProviderLabel = input.provider_override ? "mock" : "openai";
  const assessmentContext = input.evaluation_input.assessment_interpretation_context ??
    await resolveAssessmentContext(input.evaluation_input.session_public_id);
  const agentInput = buildActivityMisconceptionEvidenceLiveAgentInput({
    ...input.evaluation_input,
    assessment_interpretation_context: assessmentContext
  });
  const auditContext = await resolveAuditContext(input.evaluation_input.session_public_id);

  const evaluator = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    agent_version: ACTIVITY_RESPONSE_EVALUATOR_AGENT_VERSION,
    prompt_hash: ACTIVITY_RESPONSE_EVALUATOR_PROMPT_HASH,
    prompt_version: ACTIVITY_RESPONSE_EVALUATOR_PROMPT_VERSION,
    instructions: ACTIVITY_RESPONSE_EVALUATOR_PROMPT_INSTRUCTIONS,
    request_input: agentInput,
    output_schema: ActivityMisconceptionEvidencePacketV1Schema,
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    schema_name: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    invocation_prefix: "activity_misconception_evaluator",
    metadata: {
      purpose: "post_activity_misconception_evidence_evaluation",
      agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
      prompt_version: ACTIVITY_RESPONSE_EVALUATOR_PROMPT_VERSION,
      schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION
    }
  });

  if (evaluator.providerResult.status !== "completed") {
    return {
      status: "failed",
      blocked_reason: "activity_misconception_evaluator_provider_failed",
      validation_issues: [{
        field_path: "evaluator_provider",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: safeProviderFailureReason(evaluator.providerResult)
      }],
      evaluator_agent_call_id: evaluator.agent_call_id,
      repair_attempted: false,
      evaluator_call_status: "failed",
      repair_status: "not_attempted"
    };
  }

  const firstPipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: evaluator.providerResult.parsed_output,
    evaluator_audit: providerAuditFromResult({
      agent_call_id: evaluator.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: evaluator.providerResult
    })
  });

  if (firstPipeline.status === "accepted") {
    return {
      status: "succeeded",
      packet: firstPipeline.packet,
      evaluator_agent_call_id: evaluator.agent_call_id,
      repair_attempted: false,
      evaluator_call_status: "succeeded",
      repair_status: "not_attempted"
    };
  }

  const repairIsAllowed = activityMisconceptionEvidencePipelineIssuesAllowRepair(firstPipeline.issues);
  if (!repairIsAllowed) {
    await prisma.agentCall.update({
      where: { id: evaluator.agent_call_id },
      data: {
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "activity_misconception_evidence_validation",
          issues: firstPipeline.issues
        }),
        call_status: "invalid_output",
        error_category: "activity_misconception_evidence_validation"
      }
    });
    return {
      status: "invalid_output",
      blocked_reason: firstPipeline.blocked_reason,
      validation_issues: firstPipeline.issues,
      evaluator_agent_call_id: evaluator.agent_call_id,
      repair_attempted: false,
      evaluator_call_status: "invalid_output",
      repair_status: "not_attempted"
    };
  }

  await prisma.agentCall.update({
    where: { id: evaluator.agent_call_id },
    data: {
      output_validated: false,
      validation_error: validationErrorPayload({
        category: "activity_misconception_evidence_validation",
        issues: firstPipeline.issues
      }),
      call_status: "invalid_output",
      error_category: "activity_misconception_evidence_validation"
    }
  });

  const repairInput = {
    schema_version: "formative-activity-response-evaluator-repair-input-v1",
    source_input: agentInput,
    candidate_packet_summary: {
      validation_issue_count: firstPipeline.issues.length,
      validation_issue_codes: firstPipeline.issues.map((issue) =>
        issue.blocked_pattern_label ?? issue.rule_code
      )
    },
    safe_repair_instructions: repairInstructionsFromIssues(firstPipeline.issues)
  };

  const repair = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    agent_version: ACTIVITY_RESPONSE_EVALUATOR_AGENT_VERSION,
    prompt_hash: ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_HASH,
    prompt_version: ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_VERSION,
    instructions: ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS,
    request_input: repairInput,
    output_schema: ActivityMisconceptionEvidencePacketV1Schema,
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    schema_name: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    invocation_prefix: "activity_misconception_evaluator_repair",
    metadata: {
      purpose: "post_activity_misconception_evidence_evaluation_repair",
      agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
      prompt_version: ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_VERSION,
      schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION
    }
  });

  if (repair.providerResult.status !== "completed") {
    return {
      status: "failed",
      blocked_reason: "activity_misconception_evaluator_repair_provider_failed",
      validation_issues: [{
        field_path: "repair_provider",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: safeProviderFailureReason(repair.providerResult)
      }],
      evaluator_agent_call_id: evaluator.agent_call_id,
      repair_agent_call_id: repair.agent_call_id,
      repair_attempted: true,
      evaluator_call_status: "invalid_output",
      repair_status: "failed"
    };
  }

  const repairedPipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: evaluator.providerResult.parsed_output,
    evaluator_audit: providerAuditFromResult({
      agent_call_id: evaluator.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: evaluator.providerResult
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
      evaluator_agent_call_id: evaluator.agent_call_id,
      repair_agent_call_id: repair.agent_call_id,
      repair_attempted: true,
      evaluator_call_status: "invalid_output",
      repair_status: "succeeded"
    };
  }

  await prisma.agentCall.update({
    where: { id: repair.agent_call_id },
    data: {
      output_validated: false,
      validation_error: validationErrorPayload({
        category: "activity_misconception_evidence_validation",
        issues: repairedPipeline.issues
      }),
      call_status: "invalid_output",
      error_category: "activity_misconception_evidence_validation"
    }
  });

  return {
    status: "invalid_output",
    blocked_reason: repairedPipeline.blocked_reason,
    validation_issues: repairedPipeline.issues,
    evaluator_agent_call_id: evaluator.agent_call_id,
    repair_agent_call_id: repair.agent_call_id,
    repair_attempted: true,
    evaluator_call_status: "invalid_output",
    repair_status: "invalid_output"
  };
}

export function makeLiveActivityMisconceptionEvidencePacketForTest(
  packet: ActivityMisconceptionEvidencePacketV1,
  overrides: Partial<ActivityMisconceptionEvidencePacketV1> = {}
) {
  return ActivityMisconceptionEvidencePacketV1Schema.parse({
    ...packet,
    evaluation_source: "live_llm",
    review_only: false,
    runtime_servable_to_student: false,
    ...overrides
  });
}

export function makeActivityMisconceptionEvidenceAuditForTest(
  overrides: Partial<ActivityMisconceptionEvidenceProviderAudit> = {}
): ActivityMisconceptionEvidenceProviderAudit {
  return {
    agent_call_id: `agent_call_${randomUUID()}`,
    provider: "mock",
    model_name: "mock-activity-misconception-evaluator",
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

export function summarizeActivityMisconceptionEvidenceLiveSmokeOutcome(
  results: Array<Record<string, unknown> & {
    status?: unknown;
    case_id?: unknown;
    status_allowed?: unknown;
    status_disallowed?: unknown;
    optional?: unknown;
  }>
) {
  const required = results.filter((result) => result.optional !== true && result.status !== "skipped");
  const completed = required.filter((result) => result.status === "succeeded");
  const outcomeMismatches = required.filter((result) =>
    result.status === "succeeded" &&
    (result.status_allowed === false || result.status_disallowed === true)
  );
  const hardFailures = required.filter((result) => result.status !== "succeeded");
  const failed = [...hardFailures, ...outcomeMismatches];
  return {
    overall_status: failed.length === 0 ? "passed" : "failed",
    case_count: results.length,
    completed_count: completed.length,
    outcome_mismatch_count: outcomeMismatches.length,
    hard_failure_count: hardFailures.length,
    failed_case_ids: failed.map((result) => String(result.case_id ?? "unknown"))
  };
}

export const ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_EXPECTED_STATUSES: Record<
  string,
  MisconceptionUpdateStatus[]
> = {
  activity_misconception_live_001_conceptual_entry_no_usable_distinction: ["conceptual_entry_gap_remains"],
  activity_misconception_live_002_conceptual_entry_partial_improvement: [
    "conceptual_entry_gap_remains",
    "conceptual_entry_improved"
  ],
  activity_misconception_live_003_conceptual_entry_ready_for_probe: [
    "conceptual_entry_improved",
    "ready_for_distractor_probe"
  ],
  activity_misconception_live_004_strong_distractor_boundary: [
    "misconception_weakened",
    "no_actionable_misconception_evidence",
    "misconception_unsupported"
  ],
  activity_misconception_live_005_partial_distractor_boundary: ["misconception_weakened"],
  activity_misconception_live_006_repeats_distractor_logic: ["misconception_persisted"],
  activity_misconception_live_007_reasoning_boundary_strong: ["boundary_understanding_improved"],
  activity_misconception_live_008_independent_reconstruction_strong: ["independent_evidence_supported"],
  activity_misconception_live_009_low_information_understand: [
    "conceptual_entry_gap_remains",
    "insufficient_new_evidence"
  ],
  activity_misconception_live_010_move_on: ["student_chose_move_on"],
  activity_misconception_live_011_choose_other_activity: ["student_requested_alternative_activity"]
};
