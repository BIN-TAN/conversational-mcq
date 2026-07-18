import { runE2AStage } from "../src/lib/evaluation/formative/e2a-runner";

async function main() {
  let providerCalls = 0;
  let blockedReason = "";
  try {
    await runE2AStage({
      prisma: {} as never,
      stage: "canary",
      env: {
        ...process.env,
        EVAL_E2A_LIVE_PROVIDER: undefined,
        EVAL_LLM_STUDENT_SIMULATOR_ENABLED: "true",
        EVAL_LLM_STUDENT_SIMULATOR_MODEL: "no-live-test-model"
      },
      simulator_provider_executor: async () => {
        providerCalls += 1;
        throw new Error("provider_must_not_be_called");
      }
    });
  } catch (error) {
    blockedReason = error instanceof Error ? error.message : "unknown";
  }
  if (blockedReason !== "e2a_live_provider_opt_in_required") throw new Error(`unexpected_no_live_guard_reason:${blockedReason}`);
  if (providerCalls !== 0) throw new Error("e2a_no_live_guard_allowed_provider_call");
  console.log(JSON.stringify({ status: "passed", blocked_reason: blockedReason, provider_calls: providerCalls }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "E2A no-live guard smoke failed.");
  process.exitCode = 1;
});
