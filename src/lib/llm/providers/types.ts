import type { z } from "zod";
import type { AgentName } from "@/lib/agents/names";
import type { AgentModelConfig } from "@/lib/llm/config";
import type {
  OpenAIResponsesEffectiveOutcome,
  OpenAIResponsesFallbackReason,
  OpenAIResponsesRawOutputOutcome,
  OpenAIResponsesTransportOutcome,
  normalizeOpenAIResponsesResult
} from "@/lib/llm/openai-responses-normalizer";

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
    | "structured_output_schema_incompatible"
    | "provider_request_schema_invalid"
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

export type OpenAITransportTypedFailureReason =
  | "openai_authentication_failed"
  | "openai_permission_denied"
  | "openai_model_not_found"
  | "openai_rate_limited"
  | "openai_quota_exceeded"
  | "openai_bad_request"
  | "openai_server_error"
  | "openai_request_timeout"
  | "openai_connection_failed"
  | "openai_dns_failed"
  | "openai_tls_failed"
  | "openai_response_parse_failed"
  | "test_transport_hook_active"
  | "nonapproved_base_url"
  | "unknown_transport_error";

export type OpenAITransportMilestone = {
  transport_adapter_entered: boolean;
  request_serialization_completed: boolean;
  fetch_invoked: boolean;
  response_headers_received: boolean;
  response_body_received: boolean;
};

export type SanitizedOpenAITransportError = {
  typed_failure_reason: OpenAITransportTypedFailureReason;
  error_class: string | null;
  error_name: string | null;
  error_type: string | null;
  http_status: number | null;
  provider_error_code: string | null;
  provider_error_type: string | null;
  provider_error_param: string | null;
  provider_request_id: string | null;
  provider_request_header_id: string | null;
  retry_after_ms: number | null;
  node_cause_name: string | null;
  node_cause_code: string | null;
  network_category:
    | "dns"
    | "socket"
    | "tls"
    | "timeout"
    | "abort"
    | "http_error"
    | "response_parse"
    | "unknown"
    | null;
  sanitized_message: string;
  has_http_response: boolean;
  before_request_serialization: boolean;
  fetch_invoked: boolean;
  response_headers_received: boolean;
  response_body_received: boolean;
};

export type OpenAITransportTelemetry = OpenAITransportMilestone & {
  provider: "openai";
  transport: "openai_responses";
  adapter_version: string;
  client_request_id: string;
  model_name: string;
  base_url_host: string;
  base_url_approved: boolean;
  provider_request_id?: string;
  provider_response_id?: string;
  http_status?: number;
  retry_after_ms?: number | null;
  normalized_error?: SanitizedOpenAITransportError;
  response_status?: string | null;
  incomplete_details?: unknown;
  normalized_response?: ReturnType<typeof normalizeOpenAIResponsesResult>;
  transport_outcome?: OpenAIResponsesTransportOutcome;
  raw_output_outcome?: OpenAIResponsesRawOutputOutcome;
  effective_system_outcome?: OpenAIResponsesEffectiveOutcome;
  fallback_reason?: OpenAIResponsesFallbackReason | null;
  usage_status?: string;
  usage_source_paths?: string[];
  raw_response_hash?: string;
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
  transport_telemetry?: OpenAITransportTelemetry;
};

export interface LlmProvider {
  executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>>;
}
