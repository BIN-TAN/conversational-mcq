import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { prisma } from "@/lib/db";
import {
  getLlmRuntimeConfig,
  LlmConfigurationError,
  resolveOpenAIModelConfigForRole,
  type AgentModelConfig,
  type LiveModelRole
} from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { StructuredAgentResult } from "@/lib/llm/providers/types";
import { toPrismaJson } from "@/lib/services/json";

type PrismaClientLike = typeof prisma;

export type StudentRuntimeLiveAgentResult<TOutput> =
  | {
      status: "succeeded";
      output: TOutput;
      agent_call_id: string;
      provider: "openai";
      model_config: AgentModelConfig;
    }
  | {
      status: "not_attempted";
      blocked_reason: string;
    }
  | {
      status: "failed" | "invalid_output";
      blocked_reason: string;
      agent_call_id?: string;
    };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashStudentRuntimeValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function rawOutputForAudit(providerResult: StructuredAgentResult<unknown>) {
  if (providerResult.raw_output !== undefined) {
    return providerResult.raw_output;
  }

  if (providerResult.status !== "failed") {
    return undefined;
  }

  return {
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
              providerResult.transport_telemetry.normalized_error?.typed_failure_reason ?? null,
            provider_error_code:
              providerResult.transport_telemetry.normalized_error?.provider_error_code ?? null
          }
        : null
    }
  };
}

function providerAuditUpdate(providerResult: StructuredAgentResult<unknown>) {
  return {
    provider: providerResult.provider,
    ...providerAuditMetadata(providerResult),
    raw_output: prismaJson(redactForAudit(rawOutputForAudit(providerResult))),
    refusal_text: providerResult.refusal ?? undefined,
    incomplete_reason: providerResult.incomplete_reason ?? undefined,
    error_category: providerResult.error?.category,
    blocked_reason:
      providerResult.error?.category ??
      providerResult.transport_telemetry?.normalized_error?.typed_failure_reason,
    latency_ms: providerResult.latency_ms,
    input_tokens: providerResult.usage?.input_tokens,
    output_tokens: providerResult.usage?.output_tokens,
    total_tokens: providerResult.usage?.total_tokens,
    token_usage: providerResult.usage
      ? prismaJson(providerResult.usage.raw ?? providerResult.usage)
      : undefined
  };
}

function safeFailureReason(error: unknown) {
  if (error instanceof LlmConfigurationError) {
    return error.code;
  }
  if (error instanceof Error && error.name === "ProhibitedProviderInputError") {
    return "prohibited_provider_input";
  }
  return "student_runtime_live_agent_error";
}

function providerFailureReason(providerResult: StructuredAgentResult<unknown>) {
  return [
    providerResult.error?.category ?? providerResult.status,
    providerResult.transport_telemetry?.normalized_error?.typed_failure_reason,
    providerResult.transport_telemetry?.normalized_error?.http_status !== undefined &&
    providerResult.transport_telemetry.normalized_error.http_status !== null
      ? `http_${providerResult.transport_telemetry.normalized_error.http_status}`
      : null
  ]
    .filter(Boolean)
    .join(":");
}

export async function executeStudentRuntimeLiveAgent<TInput, TOutput>(input: {
  client?: PrismaClientLike;
  live_enabled: boolean;
  role: LiveModelRole;
  agent_name: string;
  agent_version: string;
  prompt_version: string;
  prompt_hash: string;
  schema_version: string;
  schema_name: string;
  instructions: string;
  request_input: TInput;
  output_schema: z.ZodType<TOutput>;
  invocation_key: string;
  assessment_session_db_id?: string | null;
  concept_unit_session_db_id?: string | null;
  metadata?: Record<string, string>;
}): Promise<StudentRuntimeLiveAgentResult<TOutput>> {
  if (!input.live_enabled) {
    return { status: "not_attempted", blocked_reason: "role_live_calls_disabled" };
  }

  let modelConfig: AgentModelConfig;
  try {
    const runtime = getLlmRuntimeConfig();
    if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
      return { status: "not_attempted", blocked_reason: "global_live_calls_disabled" };
    }
    modelConfig = resolveOpenAIModelConfigForRole(input.role);
    assertNoProhibitedProviderInput(input.request_input);
  } catch (error) {
    return { status: "not_attempted", blocked_reason: safeFailureReason(error) };
  }

  const client = input.client ?? prisma;
  const startedAt = new Date();
  const clientRequestId = `${input.agent_name}:${randomUUID()}`;
  const agentCall = await client.agentCall.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id ?? null,
      concept_unit_session_db_id: input.concept_unit_session_db_id ?? null,
      agent_name: input.agent_name,
      agent_version: input.agent_version,
      model_name: modelConfig.model_name,
      provider: "openai",
      client_request_id: clientRequestId,
      agent_invocation_key: input.invocation_key,
      prompt_hash: input.prompt_hash,
      reasoning_effort: modelConfig.reasoning_effort,
      max_output_tokens: modelConfig.max_output_tokens,
      prompt_version: input.prompt_version,
      schema_version: input.schema_version,
      input_payload: prismaJson(redactForAudit(input.request_input)),
      output_payload: Prisma.JsonNull,
      raw_output: Prisma.JsonNull,
      output_validated: false,
      call_status: "started",
      live_call_allowed: true,
      started_at: startedAt
    }
  });

  const provider = createLlmProvider();
  const providerResult = await provider.executeStructured({
    agent_name: input.agent_name,
    model_config: modelConfig,
    instructions: input.instructions,
    input: input.request_input,
    output_schema: input.output_schema,
    schema_name: input.schema_name,
    client_request_id: clientRequestId,
    timeout_ms: getLlmRuntimeConfig().request_timeout_ms,
    metadata: input.metadata
  });

  if (providerResult.status !== "completed" || !providerResult.parsed_output) {
    await client.agentCall.update({
      where: { id: agentCall.id },
      data: {
        ...providerAuditUpdate(providerResult),
        output_validated: false,
        validation_error: providerFailureReason(providerResult),
        call_status: "failed",
        completed_at: new Date()
      }
    });
    return {
      status: "failed",
      blocked_reason: providerFailureReason(providerResult),
      agent_call_id: agentCall.id
    };
  }

  const parsed = input.output_schema.safeParse(providerResult.parsed_output);
  if (!parsed.success) {
    await client.agentCall.update({
      where: { id: agentCall.id },
      data: {
        ...providerAuditUpdate(providerResult),
        output_payload: prismaJson(redactForAudit(providerResult.parsed_output)),
        output_validated: false,
        validation_error: JSON.stringify({
          category: "schema_validation",
          issue_count: parsed.error.issues.length,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join(".") || "output",
            code: issue.code
          }))
        }),
        call_status: "invalid_output",
        completed_at: new Date()
      }
    });
    return {
      status: "invalid_output",
      blocked_reason: "schema_validation_failed",
      agent_call_id: agentCall.id
    };
  }

  await client.agentCall.update({
    where: { id: agentCall.id },
    data: {
      ...providerAuditUpdate(providerResult),
      output_payload: prismaJson(redactForAudit(parsed.data)),
      output_validated: true,
      validation_error: null,
      call_status: "succeeded",
      completed_at: new Date()
    }
  });

  return {
    status: "succeeded",
    output: parsed.data,
    agent_call_id: agentCall.id,
    provider: "openai",
    model_config: modelConfig
  };
}
