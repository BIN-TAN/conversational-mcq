import { Prisma, type PrismaClient } from "@prisma/client";
import type { AgentModelConfig } from "@/lib/llm/config";
import type { StructuredAgentResult } from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import {
  TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
  TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION,
  evaluateTopicDialoguePedagogicalRubric,
  type TopicDialogueRuntimeValidationContext,
  type TopicDialogueSoftReviewFlag
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";
import {
  TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION,
  TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION,
  resolveTopicDialogueRegenerationPolicyV3,
  validateTopicDialogueRuntimeAcceptanceV3,
  type TopicDialogueRuntimeValidationV3Result
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v3";

export const E2A15B_RUNTIME_VERSION =
  "e2a15b-topic-dialogue-candidate-runtime-persistence-v1" as const;
export const E2A15B_EFFECTIVE_RESULT_VERSION =
  "e2a15b-topic-dialogue-effective-result-v1" as const;
export const E2A15B_STUDENT_PROJECTION_VERSION =
  "e2a15b-topic-dialogue-student-safe-projection-v1" as const;
export const E2A15B_AUDIT_PROJECTION_VERSION =
  "e2a15b-topic-dialogue-authorized-audit-v1" as const;

type ProviderInvoker = (input: {
  attempt_index: 1 | 2;
  prior_validation: TopicDialogueRuntimeValidationV3Result | null;
}) => Promise<StructuredAgentResult<unknown>>;

function json(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function usageFor(result: StructuredAgentResult<unknown>) {
  const normalized = result.transport_telemetry?.normalized_response?.usage;
  return {
    input_tokens: result.usage?.input_tokens ?? normalized?.inputTokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? normalized?.outputTokens ?? 0,
    reasoning_tokens:
      result.usage?.reasoning_tokens ?? normalized?.reasoningTokens ?? 0,
    cached_input_tokens:
      result.usage?.cached_input_tokens ?? normalized?.cachedInputTokens ?? 0,
    total_tokens: result.usage?.total_tokens ?? normalized?.totalTokens ?? 0,
    usage_verified: normalized?.status === "usage_verified" || Boolean(
      result.usage?.input_tokens !== undefined &&
      result.usage?.output_tokens !== undefined
    ),
    pricing_available: normalized?.pricingFound ?? false,
    estimated_cost_usd: normalized?.calculatedCostUsd ?? null
  };
}

function adapterAttemptCount(result: StructuredAgentResult<unknown>) {
  const normalized = result.transport_telemetry?.normalized_response;
  const record = normalized && typeof normalized === "object"
    ? normalized as Record<string, unknown>
    : null;
  const count = record?.adapterAttemptCount ?? record?.adapter_attempt_count;
  return typeof count === "number" && Number.isInteger(count) && count > 0
    ? count
    : result.transport_telemetry?.fetch_invoked ? 1 : 0;
}

function sanitizedProviderError(result: StructuredAgentResult<unknown>) {
  if (!result.error) return null;
  return {
    category: result.error.category,
    typed_failure_reason:
      result.transport_telemetry?.normalized_error?.typed_failure_reason ?? null,
    http_status:
      result.transport_telemetry?.normalized_error?.http_status ?? null,
    retryable: result.error.retryable
  };
}

function assertStudentProjectionSafe(value: unknown) {
  const serialized = JSON.stringify(value);
  const prohibited = [
    "review_flag",
    "hard_rejection",
    "validator_version",
    "validation_policy",
    "rubric_version",
    "candidate_hash",
    "fallback_applied",
    "provider_request_id",
    "provider_response_id"
  ];
  const found = prohibited.filter((field) => serialized.includes(field));
  if (found.length > 0) {
    throw new Error(`e2a15b_student_projection_internal_leak:${found.join(",")}`);
  }
}

export type E2A15BRuntimeAttempt = {
  attempt_index: 1 | 2;
  agent_call_id: string;
  client_request_id: string;
  provider: string;
  provider_status: StructuredAgentResult<unknown>["status"];
  provider_request_id: string | null;
  provider_response_id: string | null;
  generation_dispatched: boolean;
  parsed_output: unknown | null;
  raw_output_present: boolean;
  runtime_validation: TopicDialogueRuntimeValidationV3Result;
  pedagogical_rubric: TopicDialogueSoftReviewFlag[];
  usage: ReturnType<typeof usageFor>;
  latency_ms: number;
  adapter_attempt_count: number;
  transport_retry_count: number;
  sanitized_provider_error: ReturnType<typeof sanitizedProviderError>;
};

export type E2A15BRuntimeExecution = {
  runtime_version: typeof E2A15B_RUNTIME_VERSION;
  attempts: E2A15BRuntimeAttempt[];
  final_runtime_acceptance:
    | "accepted"
    | "accepted_with_review_flags"
    | "deterministic_fallback";
  regeneration_count: 0 | 1;
  deterministic_fallback_used: boolean;
  persisted_effective_result_public_id: string;
  persisted_visible_turn_sequence_index: number;
  persisted_visible_message: string;
  student_projection: {
    projection_version: typeof E2A15B_STUDENT_PROJECTION_VERSION;
    session_public_id: string;
    visible_message: string;
    selected_mode: string;
    selected_operation: string | null;
  };
  audit_projection: {
    projection_version: typeof E2A15B_AUDIT_PROJECTION_VERSION;
    candidate_hash: string;
    protocol_hash: string;
    source_attempt_index: number | null;
    runtime_acceptance: string;
    validator_version: string;
    validation_policy_version: string;
    rubric_version: string;
    review_flag_schema_version: string;
    review_flags: TopicDialogueSoftReviewFlag[];
    hard_rejection_history: Array<{
      attempt_index: number;
      reasons: TopicDialogueRuntimeValidationV3Result["hard_rejection_reasons"];
    }>;
    fallback_applied: boolean;
  };
  persistence_result: {
    agent_call_count: number;
    effective_result_count: number;
    visible_turn_count: number;
    process_event_count: number;
    passed: boolean;
  };
  refreshed_transcript: Array<{
    sequence_index: number;
    actor_type: string;
    message_text: string | null;
  }>;
  visible_chronological_order_valid: boolean;
  final_message_is_last_visible_turn: boolean;
  platform_transition_executed: false;
};

async function persistAttempt(input: {
  prisma: PrismaClient;
  assessmentSessionDbId: string;
  conceptUnitSessionDbId: string;
  invocationKey: string;
  attemptIndex: 1 | 2;
  candidateHash: string;
  protocolHash: string;
  modelConfig: AgentModelConfig;
  context: TopicDialogueRuntimeValidationContext;
  result: StructuredAgentResult<unknown>;
  validation: TopicDialogueRuntimeValidationV3Result;
  rubric: TopicDialogueSoftReviewFlag[];
}) {
  const usage = usageFor(input.result);
  const call = await input.prisma.agentCall.create({
    data: {
      assessment_session_db_id: input.assessmentSessionDbId,
      concept_unit_session_db_id: input.conceptUnitSessionDbId,
      agent_name: "topic_dialogue_agent",
      agent_version: E2A15B_RUNTIME_VERSION,
      model_name: input.modelConfig.model_name,
      provider: input.result.provider,
      provider_response_id: input.result.provider_response_id ??
        input.result.transport_telemetry?.provider_response_id ?? null,
      provider_request_id: input.result.provider_request_id ??
        input.result.transport_telemetry?.provider_request_id ?? null,
      client_request_id: input.result.client_request_id,
      agent_invocation_key: `${input.invocationKey}:attempt:${input.attemptIndex}`,
      prompt_hash: null,
      reasoning_effort: input.modelConfig.reasoning_effort,
      max_output_tokens: input.modelConfig.max_output_tokens,
      prompt_version: "v8-inherited-v7-topic-dialogue-prompt",
      schema_version: `v8-operation:${input.context.selected_operation}`,
      input_payload: json({
        candidate_hash: input.candidateHash,
        protocol_hash: input.protocolHash,
        selected_mode: input.context.selected_mode,
        selected_operation: input.context.selected_operation,
        latest_student_message: input.context.latest_student_message,
        distractor_anchor: input.context.distractor_anchor
      }),
      raw_output: input.result.raw_output === undefined
        ? undefined
        : json(input.result.raw_output),
      output_payload: input.result.parsed_output === undefined
        ? undefined
        : json(input.result.parsed_output),
      output_validated:
        input.validation.runtime_acceptance !== "hard_rejected",
      validation_error: input.validation.runtime_acceptance === "hard_rejected"
        ? JSON.stringify({
            category: "e2a15b_runtime_hard_rejection",
            reasons: input.validation.hard_rejection_reasons
          })
        : null,
      error_category: input.result.error?.category ?? null,
      blocked_reason: input.result.status === "completed"
        ? null
        : "provider_execution_not_completed",
      live_call_allowed: input.result.provider === "openai",
      retry_count: Math.max(adapterAttemptCount(input.result) - 1, 0),
      call_status: input.result.status !== "completed"
        ? "failed"
        : input.validation.runtime_acceptance === "hard_rejected"
          ? "invalid_output"
          : "succeeded",
      latency_ms: input.result.latency_ms,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      token_usage: json({
        ...usage,
        pedagogical_rubric_version:
          TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
        pedagogical_review_flags: input.rubric
      }),
      estimated_cost: usage.estimated_cost_usd,
      started_at: new Date(Date.now() - input.result.latency_ms),
      completed_at: new Date()
    },
    select: { id: true }
  });
  return { call, usage };
}

export async function executeE2A15BRuntime(input: {
  prisma: PrismaClient;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  session_public_id: string;
  invocation_key: string;
  candidate_hash: string;
  protocol_hash: string;
  model_config: AgentModelConfig;
  validation_context: TopicDialogueRuntimeValidationContext;
  deterministic_fallback_output: unknown;
  invoke_provider: ProviderInvoker;
}): Promise<E2A15BRuntimeExecution> {
  const attempts: E2A15BRuntimeAttempt[] = [];
  let initialValidation: TopicDialogueRuntimeValidationV3Result | null = null;
  let finalValidation: TopicDialogueRuntimeValidationV3Result | null = null;
  let finalOutput: unknown = null;
  let finalVisibleMessage: string | null = null;
  let finalCallId: string | null = null;
  let sourceAttemptIndex: number | null = null;

  for (const attemptIndex of [1, 2] as const) {
    if (attemptIndex === 2 && initialValidation?.runtime_acceptance !==
      "hard_rejected") break;
    const result = await input.invoke_provider({
      attempt_index: attemptIndex,
      prior_validation: attempts.at(-1)?.runtime_validation ?? null
    });
    const validation = validateTopicDialogueRuntimeAcceptanceV3({
      context: input.validation_context,
      output: result.parsed_output
    });
    const rubric = validation.visible_message
      ? evaluateTopicDialoguePedagogicalRubric({
          context: input.validation_context,
          message: validation.visible_message
        })
      : [];
    const persisted = await persistAttempt({
      prisma: input.prisma,
      assessmentSessionDbId: input.assessment_session_db_id,
      conceptUnitSessionDbId: input.concept_unit_session_db_id,
      invocationKey: input.invocation_key,
      attemptIndex,
      candidateHash: input.candidate_hash,
      protocolHash: input.protocol_hash,
      modelConfig: input.model_config,
      context: input.validation_context,
      result,
      validation,
      rubric
    });
    const adapterAttempts = adapterAttemptCount(result);
    attempts.push({
      attempt_index: attemptIndex,
      agent_call_id: persisted.call.id,
      client_request_id: result.client_request_id,
      provider: result.provider,
      provider_status: result.status,
      provider_request_id: result.provider_request_id ??
        result.transport_telemetry?.provider_request_id ?? null,
      provider_response_id: result.provider_response_id ??
        result.transport_telemetry?.provider_response_id ?? null,
      generation_dispatched:
        result.transport_telemetry?.fetch_invoked === true ||
        result.provider === "mock",
      parsed_output: result.parsed_output ?? null,
      raw_output_present: result.raw_output !== undefined,
      runtime_validation: validation,
      pedagogical_rubric: rubric,
      usage: persisted.usage,
      latency_ms: result.latency_ms,
      adapter_attempt_count: adapterAttempts,
      transport_retry_count: Math.max(adapterAttempts - 1, 0),
      sanitized_provider_error: sanitizedProviderError(result)
    });
    if (attemptIndex === 1) initialValidation = validation;
    finalValidation = validation;
    finalCallId = persisted.call.id;
    sourceAttemptIndex = attemptIndex;
    if (result.status !== "completed" ||
      validation.runtime_acceptance !== "hard_rejected") {
      finalOutput = validation.parsed_output;
      finalVisibleMessage = validation.visible_message;
      break;
    }
  }

  if (!initialValidation || !finalValidation) {
    throw new Error("e2a15b_runtime_attempt_missing");
  }
  const policy = resolveTopicDialogueRegenerationPolicyV3({
    initial: initialValidation,
    regenerated: attempts.length === 2 ? finalValidation : undefined
  });
  const fallbackApplied = policy.deterministic_fallback_required ||
    !finalVisibleMessage;
  if (fallbackApplied) {
    const fallbackValidation = validateTopicDialogueRuntimeAcceptanceV3({
      context: input.validation_context,
      output: input.deterministic_fallback_output
    });
    if (fallbackValidation.runtime_acceptance === "hard_rejected" ||
      !fallbackValidation.visible_message) {
      throw new Error("e2a15b_runtime_fallback_not_student_safe");
    }
    finalOutput = fallbackValidation.parsed_output;
    finalVisibleMessage = fallbackValidation.visible_message;
    sourceAttemptIndex = null;
  }
  if (!finalVisibleMessage) throw new Error("e2a15b_runtime_message_missing");

  const reviewFlags = fallbackApplied ? [] : finalValidation.soft_review_flags;
  const effective = await input.prisma.operationalAgentEffectiveResult.create({
    data: {
      public_id: generatePublicId("operational_effective_result"),
      agent_call_db_id: finalCallId,
      agent_name: "topic_dialogue_agent",
      operational_context_type: "e2a15b_frozen_supplement",
      operational_context_public_id: input.session_public_id,
      invocation_key: input.invocation_key,
      effective_result_version: E2A15B_EFFECTIVE_RESULT_VERSION,
      effective_validator_version: TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION,
      deterministic_guard_version:
        TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION,
      canonicalization_version: null,
      fallback_version: fallbackApplied
        ? "inherited-v7-topic-dialogue-fallback"
        : null,
      raw_output_status: finalValidation.runtime_acceptance,
      raw_semantic_status: finalValidation.runtime_acceptance,
      raw_safety_status: finalValidation.runtime_acceptance === "hard_rejected"
        ? "rejected"
        : "pass",
      effective_semantic_status: fallbackApplied ? "fallback_safe" : "pass",
      effective_safety_status: "pass",
      effective_overall_status: fallbackApplied
        ? "fallback_applied"
        : "succeeded",
      effective_student_facing_usable: true,
      effective_workflow_usable: true,
      deterministic_guard_applied: attempts.some((attempt) =>
        attempt.runtime_validation.runtime_acceptance === "hard_rejected"
      ),
      canonicalization_applied: false,
      fallback_applied: fallbackApplied,
      effective_output_json: json({
        visible_message: finalVisibleMessage,
        structured_output: finalOutput,
        display_source: policy.display_source
      }),
      effective_actions_json: json({
        selected_mode: input.validation_context.selected_mode,
        selected_operation: input.validation_context.selected_operation,
        platform_transition_executed: false
      }),
      warnings_json: json(reviewFlags),
      effective_result_hash: stableHash({
        invocation_key: input.invocation_key,
        candidate_hash: input.candidate_hash,
        protocol_hash: input.protocol_hash,
        output: finalOutput,
        fallback_applied: fallbackApplied
      })
    }
  });
  const visibleTurn = await input.prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      phase: "followup_active",
      actor_type: "agent",
      agent_name: "topic_dialogue_agent",
      message_text: finalVisibleMessage,
      structured_payload: json({
        effective_result_public_id: effective.public_id,
        selected_mode: input.validation_context.selected_mode,
        selected_operation: input.validation_context.selected_operation
      })
    }
  });
  await input.prisma.processEvent.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "e2a15b_candidate_effective_response_persisted",
      event_category: "agent_runtime",
      event_source: "backend",
      payload: json({
        effective_result_public_id: effective.public_id,
        runtime_acceptance: fallbackApplied
          ? "deterministic_fallback"
          : finalValidation.runtime_acceptance,
        review_flag_count: reviewFlags.length,
        fallback_applied: fallbackApplied
      }),
      occurred_at: new Date()
    }
  });

  const studentProjection = {
    projection_version: E2A15B_STUDENT_PROJECTION_VERSION,
    session_public_id: input.session_public_id,
    visible_message: finalVisibleMessage,
    selected_mode: input.validation_context.selected_mode,
    selected_operation: input.validation_context.selected_operation
  };
  assertStudentProjectionSafe(studentProjection);
  const transcript = await input.prisma.conversationTurn.findMany({
    where: { assessment_session_db_id: input.assessment_session_db_id },
    orderBy: { sequence_index: "asc" },
    select: {
      sequence_index: true,
      actor_type: true,
      message_text: true
    }
  });
  const chronological = transcript.every((turn, index) =>
    index === 0 || turn.sequence_index > transcript[index - 1]!.sequence_index
  );
  const persistenceCounts = await Promise.all([
    input.prisma.agentCall.count({
      where: { assessment_session_db_id: input.assessment_session_db_id }
    }),
    input.prisma.operationalAgentEffectiveResult.count({
      where: { invocation_key: input.invocation_key }
    }),
    input.prisma.conversationTurn.count({
      where: {
        assessment_session_db_id: input.assessment_session_db_id,
        actor_type: "agent",
        message_text: finalVisibleMessage
      }
    }),
    input.prisma.processEvent.count({
      where: {
        assessment_session_db_id: input.assessment_session_db_id,
        event_type: "e2a15b_candidate_effective_response_persisted"
      }
    })
  ]);
  const persistenceResult = {
    agent_call_count: persistenceCounts[0],
    effective_result_count: persistenceCounts[1],
    visible_turn_count: persistenceCounts[2],
    process_event_count: persistenceCounts[3],
    passed: persistenceCounts[0] === attempts.length &&
      persistenceCounts[1] === 1 && persistenceCounts[2] === 1 &&
      persistenceCounts[3] === 1
  };
  const finalMessageIsLast = transcript.at(-1)?.message_text ===
    finalVisibleMessage;
  const auditProjection = {
    projection_version: E2A15B_AUDIT_PROJECTION_VERSION,
    candidate_hash: input.candidate_hash,
    protocol_hash: input.protocol_hash,
    source_attempt_index: sourceAttemptIndex,
    runtime_acceptance: fallbackApplied
      ? "deterministic_fallback"
      : finalValidation.runtime_acceptance,
    validator_version: TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION,
    validation_policy_version: TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION,
    rubric_version: TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
    review_flag_schema_version: TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION,
    review_flags: reviewFlags,
    hard_rejection_history: attempts.filter((attempt) =>
      attempt.runtime_validation.runtime_acceptance === "hard_rejected"
    ).map((attempt) => ({
      attempt_index: attempt.attempt_index,
      reasons: attempt.runtime_validation.hard_rejection_reasons
    })),
    fallback_applied: fallbackApplied
  };
  return {
    runtime_version: E2A15B_RUNTIME_VERSION,
    attempts,
    final_runtime_acceptance: fallbackApplied
      ? "deterministic_fallback"
      : finalValidation.runtime_acceptance as
        "accepted" | "accepted_with_review_flags",
    regeneration_count: attempts.length === 2 ? 1 : 0,
    deterministic_fallback_used: fallbackApplied,
    persisted_effective_result_public_id: effective.public_id,
    persisted_visible_turn_sequence_index: visibleTurn.sequence_index,
    persisted_visible_message: finalVisibleMessage,
    student_projection: studentProjection,
    audit_projection: auditProjection,
    persistence_result: persistenceResult,
    refreshed_transcript: transcript,
    visible_chronological_order_valid: chronological,
    final_message_is_last_visible_turn: finalMessageIsLast,
    platform_transition_executed: false
  };
}
