import { LlmConfigurationError, resolveConnectivityModelConfig } from "../src/lib/llm/config";
import { runOpenAIConnectivityTest } from "../src/lib/llm/connectivity";

async function main() {
  try {
    const modelConfig = resolveConnectivityModelConfig();
    const result = await runOpenAIConnectivityTest();
    const diagnostic = {
      scope: "synthetic_connectivity_only",
      model: modelConfig.model_name,
      max_output_tokens: modelConfig.max_output_tokens,
      agent_call_id: result.agent_call_id
    };

    if (result.status !== "succeeded") {
      console.log(
        JSON.stringify(
          {
            ...diagnostic,
            status: result.status,
            incomplete_reason: result.status === "incomplete" ? result.reason : undefined,
            retry_count: result.retry_count,
            message:
              result.status === "failed"
                ? result.error.message
                : result.status === "refused"
                  ? "Provider refused the synthetic connectivity request."
                  : result.status === "incomplete"
                    ? result.reason === "max_output_tokens"
                      ? "The AI provider responded, but the diagnostic output reached its token ceiling. This is not a student attempt failure."
                      : result.reason
                    : result.status === "blocked_by_usage_limit"
                      ? `Diagnostic blocked by usage policy: ${result.reason}`
                    : "Connectivity output was invalid."
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify(
        {
          ...diagnostic,
          status: "succeeded",
          provider_response_id: result.provider_response_id,
          provider_request_id: result.provider_request_id,
          retry_count: result.retry_count
        },
        null,
        2
      )
    );
  } catch (error) {
    if (error instanceof LlmConfigurationError) {
      console.log(`${error.message}`);
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Connectivity test failed.");
  process.exitCode = 1;
});
