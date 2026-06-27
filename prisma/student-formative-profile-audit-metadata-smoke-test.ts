import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  chatNativeProviderAuditUpdate
} from "../src/lib/services/student-assessment/formative-profile";
import type { StructuredAgentResult } from "../src/lib/llm/providers/types";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

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

async function main() {
  const invocationKey = `student_formative_profile_audit_smoke_${randomUUID()}`;
  const clientRequestId = `chat_native_profile_${randomUUID()}`;

  try {
    const agentCall = await prisma.agentCall.create({
      data: {
        id: randomUUID(),
        agent_name: "formative_value_and_planning_agent",
        agent_version: "chat-native-phase5-v1",
        model_name: "synthetic-openai-model",
        provider: "openai",
        client_request_id: clientRequestId,
        agent_invocation_key: invocationKey,
        prompt_hash: "0".repeat(64),
        prompt_version: "chat-native-formative-profile-v1",
        schema_version: "chat-native-formative-profile-output-v1",
        input_payload: { synthetic: true },
        live_call_allowed: true,
        call_status: "started",
        started_at: new Date()
      }
    });

    const providerResult = {
      provider: "openai",
      client_request_id: clientRequestId,
      status: "completed",
      parsed_output: {},
      raw_output: {
        status: "completed",
        output: [{ type: "message" }],
        output_parsed: { synthetic: true },
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          total_tokens: 5
        }
      },
      usage: {
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 5,
        raw: {
          input_tokens: 3,
          output_tokens: 2,
          total_tokens: 5
        }
      },
      latency_ms: 7,
      transport_telemetry: {
        provider: "openai",
        transport: "openai_responses",
        adapter_version: "synthetic-openai-responses-adapter",
        client_request_id: clientRequestId,
        model_name: "synthetic-openai-model",
        base_url_host: "api.openai.com",
        base_url_approved: true,
        provider_request_id: "req_synthetic_formative_profile",
        transport_adapter_entered: true,
        request_serialization_completed: true,
        fetch_invoked: true,
        response_headers_received: true,
        response_body_received: true
      }
    } satisfies StructuredAgentResult<Record<string, never>>;

    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        ...chatNativeProviderAuditUpdate(providerResult),
        output_payload: Prisma.JsonNull,
        output_validated: true,
        call_status: "succeeded",
        completed_at: new Date()
      }
    });

    const saved = await prisma.agentCall.findUniqueOrThrow({
      where: { id: agentCall.id },
      select: {
        provider_request_id: true,
        provider_response_id: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true,
        token_usage: true,
        raw_output: true
      }
    });

    assert(
      saved.provider_request_id === "req_synthetic_formative_profile",
      "Formative profile audit storage did not persist the provider request ID."
    );
    assert(
      saved.provider_response_id?.startsWith("openai_response_hash:"),
      "Formative profile audit storage did not persist stable response evidence."
    );
    assert(saved.input_tokens === 3, "Formative profile audit storage did not persist input tokens.");
    assert(saved.output_tokens === 2, "Formative profile audit storage did not persist output tokens.");
    assert(saved.total_tokens === 5, "Formative profile audit storage did not persist total tokens.");
    assert(saved.token_usage, "Formative profile audit storage did not persist token usage.");
    assert(saved.raw_output, "Formative profile audit storage did not persist sanitized raw output.");

    const failedInvocationKey = `${invocationKey}_failed`;
    const failedCall = await prisma.agentCall.create({
      data: {
        id: randomUUID(),
        agent_name: "formative_value_and_planning_agent",
        agent_version: "chat-native-phase5-v1",
        model_name: "synthetic-openai-model",
        provider: "openai",
        client_request_id: `chat_native_profile_${randomUUID()}`,
        agent_invocation_key: failedInvocationKey,
        prompt_hash: "0".repeat(64),
        prompt_version: "chat-native-formative-profile-v1",
        schema_version: "chat-native-formative-profile-output-v1",
        input_payload: { synthetic: true },
        live_call_allowed: true,
        call_status: "started",
        started_at: new Date()
      }
    });
    const failedProviderResult = {
      provider: "openai",
      client_request_id: failedCall.client_request_id ?? "chat_native_profile_failed",
      status: "failed",
      latency_ms: 5,
      error: {
        category: "provider_request_schema_invalid",
        message: "Provider-facing Structured Outputs schema is invalid.",
        retryable: false
      },
      transport_telemetry: {
        provider: "openai",
        transport: "openai_responses",
        adapter_version: "synthetic-openai-responses-adapter",
        client_request_id: failedCall.client_request_id ?? "chat_native_profile_failed",
        model_name: "synthetic-openai-model",
        base_url_host: "api.openai.com",
        base_url_approved: true,
        transport_adapter_entered: true,
        request_serialization_completed: true,
        fetch_invoked: false,
        response_headers_received: false,
        response_body_received: false,
        normalized_error: {
          typed_failure_reason: "openai_bad_request",
          error_class: "BadRequestError",
          error_name: "BadRequestError",
          error_type: "invalid_request_error",
          http_status: 400,
          provider_error_code: "invalid_request_error",
          provider_error_type: "invalid_request_error",
          provider_error_param: "text.format.schema",
          provider_request_id: null,
          provider_request_header_id: null,
          retry_after_ms: null,
          node_cause_name: null,
          node_cause_code: null,
          network_category: "http_error",
          sanitized_message: "Provider-facing Structured Outputs schema is invalid.",
          has_http_response: true,
          before_request_serialization: false,
          fetch_invoked: false,
          response_headers_received: false,
          response_body_received: false
        }
      }
    } satisfies StructuredAgentResult<Record<string, never>>;

    await prisma.agentCall.update({
      where: { id: failedCall.id },
      data: {
        ...chatNativeProviderAuditUpdate(failedProviderResult),
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: "synthetic provider failure",
        error_category: failedProviderResult.error.category,
        call_status: "failed",
        completed_at: new Date()
      }
    });

    const failedSaved = await prisma.agentCall.findUniqueOrThrow({
      where: { id: failedCall.id },
      select: {
        error_category: true,
        raw_output: true,
        provider_request_id: true,
        provider_response_id: true
      }
    });
    const providerFailure = record(record(failedSaved.raw_output)?.provider_failure);
    const failureError = record(providerFailure?.error);
    const failureTransport = record(providerFailure?.transport);
    assert(
      failedSaved.error_category === "provider_request_schema_invalid",
      "Formative profile provider failure category was not persisted."
    );
    assert(providerFailure, "Formative profile provider failure audit object was not persisted.");
    assert(
      failureError?.category === "provider_request_schema_invalid",
      "Formative profile provider failure error category was not persisted safely."
    );
    assert(
      failureTransport?.http_status === 400,
      "Formative profile provider failure HTTP status was not persisted safely."
    );
    assert(
      !failedSaved.provider_request_id && !failedSaved.provider_response_id,
      "Synthetic pre-dispatch provider failure should not fabricate provider metadata."
    );

    console.log(
      "Formative profile audit metadata smoke test passed. Synthetic provider result only; no OpenAI call was made."
    );
  } finally {
    await prisma.agentCall.deleteMany({
      where: { agent_invocation_key: invocationKey }
    });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
