import type { z } from "zod";
import {
  agentOutputSchemas,
  type AgentInputByName,
  type AgentOutputByName
} from "@/lib/agents/contracts";
import type { AgentName } from "@/lib/agents/names";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import type { AgentModelConfig } from "@/lib/llm/config";
import { compileOpenAIResponsesRequestBody } from "@/lib/llm/providers/openai-responses-provider";
import type { StructuredAgentRequest } from "@/lib/llm/providers/types";

export function buildProductionStructuredAgentRequest<TInput, TOutput>(input: {
  agent_name: string;
  model_config: AgentModelConfig;
  instructions: string;
  input: TInput;
  output_schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>;
  schema_name: string;
  client_request_id: string;
  timeout_ms: number;
  metadata?: Record<string, string>;
}): StructuredAgentRequest<TInput, TOutput> {
  return {
    agent_name: input.agent_name,
    model_config: input.model_config,
    instructions: input.instructions,
    input: input.input,
    output_schema: input.output_schema,
    schema_name: input.schema_name,
    client_request_id: input.client_request_id,
    timeout_ms: input.timeout_ms,
    metadata: input.metadata
  };
}

export function compileProductionStructuredAgentRequest<TInput, TOutput>(
  request: StructuredAgentRequest<TInput, TOutput>
) {
  return compileOpenAIResponsesRequestBody(request);
}

export function buildProductionAgentRequest<TAgentName extends AgentName>(input: {
  agent_name: TAgentName;
  model_config: AgentModelConfig;
  input: AgentInputByName[TAgentName];
  client_request_id: string;
  timeout_ms: number;
  metadata?: Record<string, string>;
}): StructuredAgentRequest<
  AgentInputByName[TAgentName],
  AgentOutputByName[TAgentName]
> {
  const prompt = getPromptForAgent(input.agent_name);
  const outputSchema = agentOutputSchemas[
    input.agent_name
  ] as unknown as z.ZodType<AgentOutputByName[TAgentName]>;
  return buildProductionStructuredAgentRequest({
    agent_name: input.agent_name,
    model_config: input.model_config,
    instructions: prompt.instructions,
    input: input.input,
    output_schema: outputSchema,
    schema_name: prompt.schema_version.replace(/[^a-zA-Z0-9_-]/g, "_"),
    client_request_id: input.client_request_id,
    timeout_ms: input.timeout_ms,
    metadata: {
      agent_name: input.agent_name,
      prompt_version: prompt.prompt_version,
      schema_version: prompt.schema_version,
      ...(input.metadata ?? {})
    }
  }) as StructuredAgentRequest<
    AgentInputByName[TAgentName],
    AgentOutputByName[TAgentName]
  >;
}

export function compileProductionAgentRequest<TAgentName extends AgentName>(
  input: Parameters<typeof buildProductionAgentRequest<TAgentName>>[0]
) {
  return compileProductionStructuredAgentRequest(
    buildProductionAgentRequest(input)
  );
}
