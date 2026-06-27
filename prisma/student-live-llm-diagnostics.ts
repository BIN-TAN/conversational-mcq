import {
  ChatNativeFormativeProfileOutputSchema,
  ChatNativeTargetedFeedbackOutputSchema
} from "../src/lib/services/student-assessment/formative-profile";

export type LiveAuditCall = {
  id: string;
  agent_name: string;
  schema_version: string;
  provider: string;
  model_name: string;
  live_call_allowed: boolean;
  output_payload: unknown;
  output_validated: boolean;
  validation_error: string | null;
  error_category: string | null;
  call_status: string;
  provider_request_id: string | null;
  provider_response_id: string | null;
  client_request_id: string | null;
  prompt_version: string;
  raw_output?: unknown;
  token_usage?: unknown;
  created_at: Date;
  completed_at: Date | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function objectKeys(value: unknown) {
  return record(value) ? Object.keys(value as Record<string, unknown>).sort() : [];
}

function providerFailureRecord(call: LiveAuditCall) {
  return record(record(call.raw_output)?.provider_failure);
}

function failureErrorRecord(call: LiveAuditCall) {
  return record(providerFailureRecord(call)?.error);
}

function failureTransportRecord(call: LiveAuditCall) {
  return record(providerFailureRecord(call)?.transport);
}

export function sanitizedAuditSummary(call: LiveAuditCall) {
  const error = failureErrorRecord(call);
  const transport = failureTransportRecord(call);

  return {
    agent_call_id: call.id,
    agent_name: call.agent_name,
    schema_version: call.schema_version,
    provider: call.provider,
    model_name: call.model_name,
    call_status: call.call_status,
    live_call_allowed: call.live_call_allowed,
    provider_metadata_present: Boolean(call.provider_request_id || call.provider_response_id),
    provider_request_id_present: Boolean(call.provider_request_id),
    provider_response_id_present: Boolean(call.provider_response_id),
    client_request_id_present: Boolean(call.client_request_id),
    output_validated: call.output_validated,
    validation_error_present: Boolean(call.validation_error),
    error_category: call.error_category,
    sanitized_error_category: typeof error?.category === "string" ? error.category : null,
    sanitized_error_type: typeof error?.type === "string" ? error.type : null,
    sanitized_error_code: typeof error?.code === "string" ? error.code : null,
    sanitized_error_message: typeof error?.message === "string" ? error.message : null,
    provider_http_status:
      typeof transport?.http_status === "number" ? transport.http_status : null,
    provider_error_code:
      typeof transport?.provider_error_code === "string" ? transport.provider_error_code : null,
    provider_error_type:
      typeof transport?.provider_error_type === "string" ? transport.provider_error_type : null,
    typed_failure_reason:
      typeof transport?.typed_failure_reason === "string" ? transport.typed_failure_reason : null,
    provider_endpoint_host:
      typeof transport?.base_url_host === "string" ? transport.base_url_host : null,
    raw_output_exists: call.raw_output !== null && call.raw_output !== undefined,
    raw_output_keys: objectKeys(call.raw_output),
    token_usage_exists: call.token_usage !== null && call.token_usage !== undefined,
    token_usage_keys: objectKeys(call.token_usage),
    created_at: call.created_at.toISOString(),
    completed_at: call.completed_at?.toISOString() ?? null
  };
}

function diagnosticJson(input: {
  checked_call: LiveAuditCall;
  relevant_agent_calls: Array<ReturnType<typeof sanitizedAuditSummary>>;
}) {
  return JSON.stringify(
    {
      checked_call: sanitizedAuditSummary(input.checked_call),
      relevant_agent_calls: input.relevant_agent_calls
    },
    null,
    2
  );
}

export function assertLiveAgentCallIsAudited(input: {
  label: string;
  call: LiveAuditCall;
  schema: typeof ChatNativeFormativeProfileOutputSchema | typeof ChatNativeTargetedFeedbackOutputSchema;
  audit_context: Array<ReturnType<typeof sanitizedAuditSummary>>;
}) {
  assert(input.call.provider === "openai", `${input.label}: expected OpenAI provider audit.`);
  assert(input.call.live_call_allowed === true, `${input.label}: live_call_allowed was not stored.`);
  assert(input.call.model_name.trim().length > 0, `${input.label}: model name was not stored.`);
  assert(input.call.prompt_version.trim().length > 0, `${input.label}: prompt version was not stored.`);
  assert(input.call.schema_version.trim().length > 0, `${input.label}: schema version was not stored.`);

  if (input.call.call_status === "failed") {
    throw new Error(
      `${input.label}: live provider call failed before usable structured output.\n${diagnosticJson({
        checked_call: input.call,
        relevant_agent_calls: input.audit_context
      })}`
    );
  }

  if (input.call.call_status === "succeeded" || input.call.call_status === "completed") {
    assert(
      Boolean(input.call.provider_request_id || input.call.provider_response_id),
      `${input.label}: provider request/response ID metadata was not stored.\n${diagnosticJson({
        checked_call: input.call,
        relevant_agent_calls: input.audit_context
      })}`
    );
  }

  assert(
    input.schema.safeParse(input.call.output_payload).success,
    `${input.label}: stored output payload is not schema-shaped, including fallback output if used.`
  );

  if (input.call.output_validated) {
    assert(input.call.call_status === "succeeded", `${input.label}: validated output should be succeeded.`);
    assert(!input.call.validation_error, `${input.label}: validated output should not have validation_error.`);
  } else {
    assert(
      Boolean(input.call.validation_error),
      `${input.label}: unsafe or invalid output should store a validation error before fallback.`
    );
    assert(
      input.call.call_status === "invalid_output",
      `${input.label}: invalid or unsafe output should not be audited as succeeded.`
    );
  }
}
