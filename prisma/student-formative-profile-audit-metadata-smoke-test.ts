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
