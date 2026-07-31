import { z } from "zod";
import { classifyProviderFailure } from "../src/lib/llm/provider-transport-retry";
import { createOpenAITransportEnvironmentReport } from "../src/lib/llm/openai-transport-diagnostics";
import {
  OPENAI_RESPONSES_ADAPTER_VERSION,
  OpenAIResponsesProvider,
  parseOpenAIResponsesStructuredOutput
} from "../src/lib/llm/providers/openai-responses-provider";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";

const OutputSchema = z
  .object({
    message: z.string().min(1),
    retained: z.boolean()
  })
  .strict();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function responseWithText(text: string) {
  return {
    id: "resp_deterministic",
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text
          }
        ]
      }
    ]
  };
}

function sdkResponse(text: string) {
  return {
    id: "resp_deterministic",
    object: "response",
    created_at: 1_700_000_000,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: 100,
    model: "deterministic-no-provider",
    output: [
      {
        id: "msg_deterministic",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            annotations: [],
            logprobs: [],
            text
          }
        ]
      }
    ],
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: null,
    text: { format: { type: "json_schema" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: {
      input_tokens: 20,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 25
    }
  };
}

function request(): StructuredAgentRequest<
  { prompt: string },
  z.infer<typeof OutputSchema>
> {
  return {
    agent_name: "formative_conversation_agent",
    model_config: {
      model_name: "deterministic-no-provider",
      max_output_tokens: 100
    },
    instructions: "No-provider structured output boundary smoke.",
    input: { prompt: "Validate the structured response boundary." },
    output_schema: OutputSchema,
    schema_name: "openai-responses-structured-output-v4-smoke",
    client_request_id: "request_deterministic",
    timeout_ms: 10_000
  };
}

async function verifySdkBoundary() {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  const responseTexts = [
    JSON.stringify({ message: "SDK boundary valid.", retained: true }),
    JSON.stringify({ message: "", retained: "yes" })
  ];
  try {
    process.env.OPENAI_API_KEY =
      "sk-deterministic-test-credential-not-real";
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    globalThis.fetch = async () => {
      const responseText = responseTexts[fetchCalls];
      fetchCalls += 1;
      assert(responseText, "Unexpected mocked SDK request.");
      return new Response(JSON.stringify(sdkResponse(responseText)), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": `req_deterministic_${fetchCalls}`
        }
      });
    };
    const provider = new OpenAIResponsesProvider({
      isolated_evaluation_runtime: {
        purpose: "bounded_candidate_evaluation",
        request_timeout_ms: 10_000
      }
    });
    const accepted = await provider.executeStructured(request());
    assert(
      accepted.status === "completed" &&
        accepted.parsed_output?.message === "SDK boundary valid." &&
        accepted.transport_telemetry?.response_body_received &&
        accepted.transport_telemetry
          .structured_output_validation_status === "valid",
      "The SDK boundary must return locally validated output after raw receipt."
    );

    const rejected = await provider.executeStructured({
      ...request(),
      client_request_id: "request_deterministic_invalid"
    });
    assert(
      rejected.status === "failed" &&
        rejected.error?.category === "schema_validation" &&
        rejected.transport_telemetry?.response_body_completed &&
        rejected.transport_telemetry?.response_body_received &&
        rejected.transport_telemetry
          .structured_output_validation_status === "schema_invalid" &&
        rejected.transport_telemetry
          .structured_output_validation_issue_paths?.includes("message"),
      "The SDK boundary must preserve a complete body as a typed model-output failure."
    );
    assert(fetchCalls === 2, "The SDK boundary smoke must use exactly two mocked calls.");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousKey;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousBaseUrl;
    }
  }
}

async function main() {
  assert(
    OPENAI_RESPONSES_ADAPTER_VERSION === "openai-responses-adapter-v4",
    "The structured-output boundary must use adapter v4."
  );
  assert(
    createOpenAITransportEnvironmentReport()
      .openai_sdk_adapter_version ===
      OPENAI_RESPONSES_ADAPTER_VERSION,
    "Transport readiness must report the provider's canonical adapter version."
  );

  const valid = parseOpenAIResponsesStructuredOutput(
    responseWithText(
      JSON.stringify({ message: "Validated locally.", retained: true })
    ),
    OutputSchema
  );
  assert(
    valid.success &&
      valid.status === "valid" &&
      valid.data.message === "Validated locally.",
    "A valid complete response must parse after raw response receipt."
  );

  const invalidJson = parseOpenAIResponsesStructuredOutput(
    responseWithText("{"),
    OutputSchema
  );
  assert(
    !invalidJson.success && invalidJson.status === "invalid_json",
    "Malformed JSON must remain a typed local output failure."
  );

  const schemaInvalid = parseOpenAIResponsesStructuredOutput(
    responseWithText(JSON.stringify({ message: "", retained: "yes" })),
    OutputSchema
  );
  assert(
    !schemaInvalid.success &&
      schemaInvalid.status === "schema_invalid" &&
      schemaInvalid.issue_paths.includes("message") &&
      schemaInvalid.issue_paths.includes("retained"),
    "Schema-invalid output must preserve safe field paths."
  );

  const missing = parseOpenAIResponsesStructuredOutput(
    { id: "resp_missing", status: "completed", output: [] },
    OutputSchema
  );
  assert(
    !missing.success && missing.status === "missing_output_text",
    "A complete response without output text must remain a typed output failure."
  );

  const receivedSchemaFailure: StructuredAgentResult<z.infer<typeof OutputSchema>> = {
    provider: "openai",
    client_request_id: "request_schema_failure",
    status: "failed",
    latency_ms: 25,
    error: {
      category: "schema_validation",
      message: "OpenAI structured output failed local schema validation.",
      retryable: false
    },
    transport_telemetry: {
      provider: "openai",
      transport: "openai_responses",
      adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
      client_request_id: "request_schema_failure",
      model_name: "deterministic-no-provider",
      base_url_host: "api.openai.com",
      base_url_approved: true,
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: true,
      response_headers_received: true,
      response_body_started: true,
      response_body_completed: true,
      response_body_bytes_received: 512,
      response_body_received: true,
      structured_output_validation_status: "schema_invalid",
      structured_output_validation_issue_paths: ["message", "retained"]
    }
  };
  const classification = classifyProviderFailure(receivedSchemaFailure);
  assert(
    classification.category === "response_schema_invalid" &&
      classification.domain === "model_result" &&
      !classification.retryable_transport_failure &&
      classification.semantic_regeneration_eligible,
    "A fully received schema-invalid response must not be classified as transport failure."
  );

  await verifySdkBoundary();

  console.log(
    JSON.stringify(
      {
        status: "passed",
        adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
        complete_response_schema_failure:
          classification.category,
        sdk_boundary_mocked_calls: 2,
        transport_retry_authorized: false,
        provider_calls: 0,
        network_requests: 0
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "openai_responses_structured_output_v4_smoke_failed",
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
});
