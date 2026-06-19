import { LlmConfigurationError } from "../src/lib/llm/config";
import { runOpenAIConnectivityTest } from "../src/lib/llm/connectivity";

async function main() {
  try {
    const result = await runOpenAIConnectivityTest();

    if (result.status !== "succeeded") {
      console.log(
        JSON.stringify(
          {
            status: result.status,
            retry_count: result.retry_count,
            message:
              result.status === "failed"
                ? result.error.message
                : result.status === "refused"
                  ? "Provider refused the synthetic connectivity request."
                  : result.status === "incomplete"
                    ? result.reason
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
