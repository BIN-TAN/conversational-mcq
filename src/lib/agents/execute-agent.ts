import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import {
  agentInputSchemas,
  agentOutputSchemas,
  type AgentInputByName,
  type AgentOutputByName
} from "@/lib/agents/contracts";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import {
  assertNoProhibitedProviderInput,
  ProhibitedProviderInputError,
  redactForAudit
} from "@/lib/agents/redaction";
import {
  getLlmRuntimeConfig,
  LlmConfigurationError,
  resolveAgentModelConfig,
  type AgentModelConfig
} from "@/lib/llm/config";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type {
  OpenAITransportTelemetry,
  SanitizedAgentError,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  checkLlmLiveCallReadiness,
  type LlmUsageGuardBlockedReason,
  type LlmUsageGuardResult
} from "@/lib/llm/usage/usage-guard";
import { toPrismaJson } from "@/lib/services/json";

export type AgentExecutionResult<TOutput> =
  | {
      status: "succeeded";
      output: TOutput;
      agent_call_id: string;
      provider_response_id?: string;
      provider_request_id?: string;
      transport_telemetry?: OpenAITransportTelemetry;
      retry_count: number;
      idempotent_replay?: boolean;
    }
  | {
      status: "refused";
      refusal: string;
      agent_call_id: string;
      transport_telemetry?: OpenAITransportTelemetry;
      retry_count: number;
    }
  | {
      status: "incomplete";
      reason: string;
      agent_call_id: string;
      transport_telemetry?: OpenAITransportTelemetry;
      retry_count: number;
    }
  | {
      status: "failed";
      error: SanitizedAgentError;
      agent_call_id?: string;
      transport_telemetry?: OpenAITransportTelemetry;
      retry_count: number;
    }
  | {
      status: "invalid_output";
      validation_error: string;
      agent_call_id: string;
      transport_telemetry?: OpenAITransportTelemetry;
      retry_count: number;
    }
  | {
      status: "blocked_by_usage_limit";
      reason: LlmUsageGuardBlockedReason;
      agent_call_id: string;
      usage_snapshot: object;
      retry_after?: string;
      retry_count: number;
    };

export type ExecuteAgentInput<TAgentName extends AgentNameType> = {
  agent_name: TAgentName;
  input: AgentInputByName[TAgentName];
  assessment_session_db_id?: string | null;
  concept_unit_session_db_id?: string | null;
  followup_round_db_id?: string | null;
  agent_invocation_key?: string;
  force_new_invocation?: boolean;
  metadata?: Record<string, string>;
  model_config_override?: AgentModelConfig;
  prismaClient?: PrismaClient;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number) {
  return 20 * 2 ** Math.max(0, attempt - 1) + Math.floor(Math.random() * 10);
}

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function usageNumbers(result: StructuredAgentResult<unknown>) {
  return {
    input_tokens: result.usage?.input_tokens,
    output_tokens: result.usage?.output_tokens,
    total_tokens: result.usage?.total_tokens,
    token_usage: result.usage ? prismaJson(result.usage.raw ?? result.usage) : undefined
  };
}

function providerEvidenceUpdate(result: StructuredAgentResult<unknown>) {
  return {
    provider: result.provider,
    provider_response_id: result.provider_response_id,
    provider_request_id: result.provider_request_id,
    raw_output: prismaJson(redactForAudit(result.raw_output)),
    latency_ms: result.latency_ms,
    ...usageNumbers(result)
  };
}

function validationMessage(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`)
    .join("; ");
}

function toFailure(error: unknown): SanitizedAgentError {
  if (error instanceof ProhibitedProviderInputError) {
    return {
      category: "invalid_request",
      message: "Provider input contains prohibited secret or authentication fields.",
      retryable: false
    };
  }

  return {
    category: "unexpected_provider_response",
    message: error instanceof Error ? error.message : "Agent execution failed.",
    retryable: false
  };
}

function usageWindowStart(result?: LlmUsageGuardResult | null) {
  return result?.usage_snapshot.window_start ? new Date(result.usage_snapshot.window_start) : undefined;
}

function usageWindowEnd(result?: LlmUsageGuardResult | null) {
  return result?.usage_snapshot.window_end ? new Date(result.usage_snapshot.window_end) : undefined;
}

export async function executeAgent<TAgentName extends AgentNameType>(
  input: ExecuteAgentInput<TAgentName>
): Promise<AgentExecutionResult<AgentOutputByName[TAgentName]>> {
  const db = input.prismaClient ?? prisma;
  const agentName = AgentName.parse(input.agent_name);
  const inputSchema = agentInputSchemas[agentName] as unknown as z.ZodType<
    AgentInputByName[TAgentName]
  >;
  const outputSchema = agentOutputSchemas[agentName] as unknown as z.ZodType<
    AgentOutputByName[TAgentName]
  >;
  const parsedInput = inputSchema.parse(input.input);
  assertNoProhibitedProviderInput(parsedInput);

  const runtime = getLlmRuntimeConfig();
  const prompt = getPromptForAgent(agentName);
  let modelConfig: AgentModelConfig;
  let modelConfigured = true;

  try {
    modelConfig = input.model_config_override ?? resolveAgentModelConfig(agentName);
  } catch (error) {
    if (error instanceof LlmConfigurationError && error.code === "agent_model_missing") {
      modelConfigured = false;
      modelConfig = { model_name: "__model_not_configured__" };
    } else {
      throw error;
    }
  }

  const agentInvocationKey =
    input.agent_invocation_key ?? `agent-${agentName}-${randomUUID()}`;

  if (!input.force_new_invocation) {
    const existing = await db.agentCall.findUnique({
      where: { agent_invocation_key: agentInvocationKey }
    });

    if (existing?.call_status === "succeeded" && existing.output_payload) {
      const parsedOutput = outputSchema.safeParse(existing.output_payload);

      if (parsedOutput.success) {
        return {
          status: "succeeded",
          output: parsedOutput.data,
          agent_call_id: existing.id,
          provider_response_id: existing.provider_response_id ?? undefined,
          provider_request_id: existing.provider_request_id ?? undefined,
          retry_count: existing.retry_count,
          idempotent_replay: true
        };
      }
    }

    if (existing) {
      return {
        status: "failed",
        error: {
          category: "invalid_request",
          message:
            "Agent invocation key already exists and is not a successful replayable call.",
          retryable: false
        },
        agent_call_id: existing.id,
        retry_count: existing.retry_count
      };
    }
  }

  const clientRequestId = `agent_req_${randomUUID()}`;
  const startedAt = new Date();
  const usageGuardResult =
    runtime.provider === "openai"
      ? await checkLlmLiveCallReadiness({
          agent_name: agentName,
          assessment_session_db_id: input.assessment_session_db_id ?? null,
          model_configured: modelConfigured
        })
      : null;

  if (usageGuardResult && !usageGuardResult.allowed) {
    const blockedCall = await db.agentCall.create({
      data: {
        id: randomUUID(),
        assessment_session_db_id: input.assessment_session_db_id ?? null,
        concept_unit_session_db_id: input.concept_unit_session_db_id ?? null,
        followup_round_db_id: input.followup_round_db_id ?? null,
        agent_name: agentName,
        agent_version: prompt.agent_version,
        model_name: modelConfig.model_name,
        provider: runtime.provider,
        client_request_id: clientRequestId,
        agent_invocation_key: agentInvocationKey,
        prompt_hash: prompt.prompt_hash,
        temperature:
          modelConfig.temperature === undefined
            ? null
            : new Prisma.Decimal(modelConfig.temperature),
        reasoning_effort: modelConfig.reasoning_effort ?? null,
        verbosity: modelConfig.verbosity ?? null,
        max_output_tokens: modelConfig.max_output_tokens ?? null,
        prompt_version: prompt.prompt_version,
        schema_version: prompt.schema_version,
        input_payload: prismaJson(redactForAudit(parsedInput)),
        output_validated: false,
        validation_error: `LLM live call blocked: ${usageGuardResult.reason}.`,
        error_category: usageGuardResult.reason,
        blocked_reason: usageGuardResult.reason,
        usage_guard_snapshot: prismaJson(usageGuardResult.usage_snapshot),
        live_call_allowed: false,
        usage_window_start: usageWindowStart(usageGuardResult),
        usage_window_end: usageWindowEnd(usageGuardResult),
        call_status: "failed",
        started_at: startedAt,
        completed_at: new Date()
      }
    });

    return {
      status: "blocked_by_usage_limit",
      reason: usageGuardResult.reason,
      agent_call_id: blockedCall.id,
      usage_snapshot: usageGuardResult.usage_snapshot,
      retry_after: usageGuardResult.retry_after,
      retry_count: 0
    };
  }

  const provider = createLlmProvider();
  const agentCall = await db.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.assessment_session_db_id ?? null,
      concept_unit_session_db_id: input.concept_unit_session_db_id ?? null,
      followup_round_db_id: input.followup_round_db_id ?? null,
      agent_name: agentName,
      agent_version: prompt.agent_version,
      model_name: modelConfig.model_name,
      provider: runtime.provider,
      client_request_id: clientRequestId,
      agent_invocation_key: agentInvocationKey,
      prompt_hash: prompt.prompt_hash,
      temperature:
        modelConfig.temperature === undefined
          ? null
          : new Prisma.Decimal(modelConfig.temperature),
      reasoning_effort: modelConfig.reasoning_effort ?? null,
      verbosity: modelConfig.verbosity ?? null,
      max_output_tokens: modelConfig.max_output_tokens ?? null,
      prompt_version: prompt.prompt_version,
      schema_version: prompt.schema_version,
      input_payload: prismaJson(redactForAudit(parsedInput)),
      usage_guard_snapshot: usageGuardResult
        ? prismaJson(usageGuardResult.usage_snapshot)
        : undefined,
      live_call_allowed: runtime.provider === "openai",
      usage_window_start: usageWindowStart(usageGuardResult),
      usage_window_end: usageWindowEnd(usageGuardResult),
      call_status: "started",
      started_at: startedAt
    }
  });

  let retryCount = 0;
  let schemaRepairAttempted = false;
  let lastProviderResult: StructuredAgentResult<AgentOutputByName[TAgentName]> | null = null;

  try {
    while (true) {
      const providerResult = await provider.executeStructured({
        agent_name: agentName,
        model_config: modelConfig,
        instructions: prompt.instructions,
        input: parsedInput,
        output_schema: outputSchema,
        schema_name: prompt.schema_version.replace(/[^a-zA-Z0-9_-]/g, "_"),
        client_request_id: clientRequestId,
        timeout_ms: runtime.request_timeout_ms,
        metadata: {
          agent_name: agentName,
          prompt_version: prompt.prompt_version,
          schema_version: prompt.schema_version,
          ...(input.metadata ?? {})
        }
      });
      lastProviderResult = providerResult;
      await db.agentCall.update({
        where: { id: agentCall.id },
        data: providerEvidenceUpdate(providerResult)
      });

      if (
        providerResult.status === "failed" &&
        providerResult.error?.retryable &&
        retryCount < runtime.max_retries
      ) {
        retryCount += 1;
        await sleep(retryDelayMs(retryCount));
        continue;
      }

      if (providerResult.status === "completed") {
        const parsedOutput = outputSchema.safeParse(providerResult.parsed_output);

        if (!parsedOutput.success) {
          if (!schemaRepairAttempted) {
            schemaRepairAttempted = true;
            retryCount += 1;

            if (retryCount <= runtime.max_retries + 1) {
              await sleep(retryDelayMs(retryCount));
              continue;
            }
          }

          const message = validationMessage(parsedOutput.error);
          await db.agentCall.update({
            where: { id: agentCall.id },
            data: {
              validation_error: message,
              output_validated: false,
              retry_count: retryCount,
              call_status: "invalid_output",
              error_category: "schema_validation",
              completed_at: new Date(),
              ...usageNumbers(providerResult)
            }
          });

          return {
            status: "invalid_output",
            validation_error: message,
            agent_call_id: agentCall.id,
            transport_telemetry: providerResult.transport_telemetry,
            retry_count: retryCount
          };
        }

        await db.agentCall.update({
          where: { id: agentCall.id },
          data: {
            output_payload: prismaJson(parsedOutput.data),
            output_validated: true,
            retry_count: retryCount,
            call_status: "succeeded",
            completed_at: new Date(),
            ...usageNumbers(providerResult)
          }
        });

        return {
          status: "succeeded",
          output: parsedOutput.data,
          agent_call_id: agentCall.id,
          provider_response_id: providerResult.provider_response_id,
          provider_request_id: providerResult.provider_request_id,
          transport_telemetry: providerResult.transport_telemetry,
          retry_count: retryCount
        };
      }

      if (providerResult.status === "refused") {
        await db.agentCall.update({
          where: { id: agentCall.id },
          data: {
            refusal_text: providerResult.refusal ?? "Provider refused the request.",
            output_validated: false,
            retry_count: retryCount,
            call_status: "failed",
            error_category: "provider_refusal",
            completed_at: new Date(),
            ...usageNumbers(providerResult)
          }
        });

        return {
          status: "refused",
          refusal: providerResult.refusal ?? "Provider refused the request.",
          agent_call_id: agentCall.id,
          transport_telemetry: providerResult.transport_telemetry,
          retry_count: retryCount
        };
      }

      if (providerResult.status === "incomplete") {
        await db.agentCall.update({
          where: { id: agentCall.id },
          data: {
            incomplete_reason: providerResult.incomplete_reason ?? "incomplete",
            output_validated: false,
            retry_count: retryCount,
            call_status: "failed",
            error_category: "incomplete",
            completed_at: new Date(),
            ...usageNumbers(providerResult)
          }
        });

        return {
          status: "incomplete",
          reason: providerResult.incomplete_reason ?? "incomplete",
          agent_call_id: agentCall.id,
          transport_telemetry: providerResult.transport_telemetry,
          retry_count: retryCount
        };
      }

      const error =
        providerResult.error ?? ({
          category: "unexpected_provider_response",
          message: "Provider request failed.",
          retryable: false
        } satisfies SanitizedAgentError);
      await db.agentCall.update({
        where: { id: agentCall.id },
        data: {
          output_validated: false,
          retry_count: retryCount,
          call_status: "failed",
          error_category: error.category,
          validation_error: error.message,
          completed_at: new Date(),
          ...usageNumbers(providerResult)
        }
      });

      return {
        status: "failed",
        error,
        agent_call_id: agentCall.id,
        transport_telemetry: providerResult.transport_telemetry,
        retry_count: retryCount
      };
    }
  } catch (error) {
    const sanitized = toFailure(error);
    await db.agentCall.update({
      where: { id: agentCall.id },
      data: {
        output_validated: false,
        retry_count: retryCount,
        call_status: "failed",
        error_category: sanitized.category,
        validation_error: sanitized.message,
        raw_output: lastProviderResult?.raw_output
          ? prismaJson(redactForAudit(lastProviderResult.raw_output))
          : undefined,
        completed_at: new Date()
      }
    });

    return {
      status: "failed",
      error: sanitized,
      agent_call_id: agentCall.id,
      transport_telemetry: lastProviderResult?.transport_telemetry,
      retry_count: retryCount
    };
  }
}
