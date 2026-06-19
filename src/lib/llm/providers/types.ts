import type { z } from "zod";
import type { AgentName } from "@/lib/agents/names";
import type { AgentModelConfig } from "@/lib/llm/config";

export type SanitizedAgentError = {
  category:
    | "configuration"
    | "timeout"
    | "network"
    | "authentication"
    | "permission"
    | "rate_limit"
    | "quota"
    | "provider_5xx"
    | "invalid_request"
    | "schema_validation"
    | "unexpected_provider_response"
    | "permanent";
  message: string;
  retryable: boolean;
};

export type LlmUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  raw?: unknown;
};

export type StructuredAgentRequest<TInput, TOutput> = {
  agent_name: AgentName;
  model_config: AgentModelConfig;
  instructions: string;
  input: TInput;
  output_schema: z.ZodType<TOutput>;
  schema_name: string;
  client_request_id: string;
  timeout_ms: number;
  metadata?: Record<string, string>;
};

export type StructuredAgentResult<TOutput> = {
  provider: "mock" | "openai";
  provider_response_id?: string;
  provider_request_id?: string;
  client_request_id: string;
  status: "completed" | "refused" | "incomplete" | "failed";
  parsed_output?: TOutput;
  raw_output?: unknown;
  refusal?: string;
  incomplete_reason?: string;
  usage?: LlmUsage;
  latency_ms: number;
  error?: SanitizedAgentError;
};

export interface LlmProvider {
  executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>>;
}
