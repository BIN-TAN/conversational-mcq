import { PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import { parseEvalProviderUsage } from "../src/lib/services/evals/usage-parser";
import { inspectLiveCanaryRun, runLiveCanary } from "../src/lib/services/evals/live-execution";
import { cleanupEvalFixtures } from "../src/lib/services/evals/service";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import {
  assert,
  cleanupLiveCanaryRecords,
  liveCanarySmokeEnv,
  operationalCounts,
  withCanaryEnv
} from "./eval-live-canary-test-utils";

const prisma = new PrismaClient();

type UsageMode = "responses_usage" | "missing_usage" | "optional_absent" | "malformed_usage";

class UsageShapeProvider implements LlmProvider {
  private readonly mock = new MockLlmProvider();

  constructor(private readonly mode: UsageMode) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const base = await this.mock.executeStructured(request);
    const rawBase =
      base.raw_output && typeof base.raw_output === "object" && !Array.isArray(base.raw_output)
        ? base.raw_output
        : { raw_output: base.raw_output };

    if (this.mode === "missing_usage") {
      return {
        ...base,
        usage: undefined,
        raw_output: rawBase
      };
    }

    if (this.mode === "malformed_usage") {
      return {
        ...base,
        usage: undefined,
        raw_output: {
          ...rawBase,
          usage: {
            input_tokens: "bad",
            output_tokens: 20,
            total_tokens: 30,
            input_tokens_details: { cached_tokens: 1 },
            output_tokens_details: { reasoning_tokens: 2 }
          }
        }
      };
    }

    if (this.mode === "optional_absent") {
      return {
        ...base,
        usage: undefined,
        raw_output: {
          ...rawBase,
          usage: {
            input_tokens: 15,
            output_tokens: 7,
            total_tokens: 22
          }
        }
      };
    }

    return {
      ...base,
      usage: undefined,
      raw_output: {
        ...rawBase,
        usage: {
          input_tokens: 120,
          output_tokens: 34,
          total_tokens: 154,
          input_tokens_details: { cached_tokens: 12 },
          output_tokens_details: { reasoning_tokens: 5 }
        }
      }
    };
  }
}

async function runWithProvider(mode: UsageMode) {
  await cleanupLiveCanaryRecords(prisma);

  return runLiveCanary({
    confirmPaidApi: true,
    runInstanceMode: "new_run",
    provider: new UsageShapeProvider(mode),
    allowMockProvider: true
  });
}

async function firstRunItem(runPublicId: string) {
  return prisma.evalRunItem.findFirstOrThrow({
    where: { run: { run_public_id: runPublicId } },
    orderBy: { run_order: "asc" },
    select: {
      execution_status: true,
      error_category: true,
      schema_validation_error: true,
      token_usage: true,
      input_tokens: true,
      cached_input_tokens: true,
      output_tokens: true,
      reasoning_tokens: true,
      total_tokens: true,
      estimated_cost_usd: true
    }
  });
}

async function main() {
  await ensureTeacherReviewDemoUsers(prisma);
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  try {
    await withCanaryEnv(liveCanarySmokeEnv, async () => {
      const before = await operationalCounts(prisma);
      const direct = parseEvalProviderUsage({
        raw_output: {
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            total_tokens: 14,
            input_tokens_details: { cached_tokens: 3 },
            output_tokens_details: { reasoning_tokens: 2 }
          }
        }
      });
      assert(direct.ok, "Direct Responses API usage shape should parse.");
      assert(direct.ok && direct.usage.cached_input_tokens === 3, "Cached input tokens should parse.");
      assert(direct.ok && direct.usage.reasoning_tokens === 2, "Reasoning tokens should parse.");

      const parsedRun = await runWithProvider("responses_usage");
      assert(parsedRun.status === "completed", "Responses usage shape should allow run completion.");
      const parsedItem = await firstRunItem(parsedRun.run_public_id);
      assert(parsedItem.input_tokens === 120, "Input tokens should persist from raw Responses usage.");
      assert(parsedItem.cached_input_tokens === 12, "Cached input tokens should persist.");
      assert(parsedItem.output_tokens === 34, "Output tokens should persist.");
      assert(parsedItem.reasoning_tokens === 5, "Reasoning tokens should persist.");
      assert(parsedItem.total_tokens === 154, "Total tokens should persist.");
      assert(Number(parsedItem.estimated_cost_usd ?? 0) > 0, "Estimated item cost should persist.");

      const missingRun = await runWithProvider("missing_usage");
      assert(missingRun.status === "budget_unverifiable", "Missing usage should pause run.");
      assert(missingRun.provider_request_count === 1, "Missing usage should stop after one provider request.");
      const missingItem = await firstRunItem(missingRun.run_public_id);
      assert(missingItem.execution_status === "budget_unverifiable", "Missing usage item should be budget_unverifiable.");
      assert(missingItem.error_category === "usage_missing", "Missing usage should store usage_missing.");
      const missingInspection = await inspectLiveCanaryRun(missingRun.run_public_id);
      assert(missingInspection.fresh_run_recommended, "Missing usage inspection should recommend a fresh run.");
      assert(!missingInspection.safe_to_resume, "Missing usage inspection should not mark run safe to resume.");

      const optionalAbsentRun = await runWithProvider("optional_absent");
      assert(optionalAbsentRun.status === "completed", "Absent optional token details should still complete.");
      const optionalAbsentItem = await firstRunItem(optionalAbsentRun.run_public_id);
      assert(optionalAbsentItem.input_tokens === 15, "Input tokens should persist when optional fields are absent.");
      assert(optionalAbsentItem.output_tokens === 7, "Output tokens should persist when optional fields are absent.");
      assert(optionalAbsentItem.cached_input_tokens === null, "Absent cached tokens should remain null.");
      assert(optionalAbsentItem.reasoning_tokens === null, "Absent reasoning tokens should remain null.");

      const malformedRun = await runWithProvider("malformed_usage");
      assert(malformedRun.status === "budget_unverifiable", "Malformed usage should pause run.");
      assert(malformedRun.provider_request_count === 1, "Malformed usage should stop after one provider request.");
      const malformedItem = await firstRunItem(malformedRun.run_public_id);
      assert(malformedItem.execution_status === "budget_unverifiable", "Malformed usage item should be budget_unverifiable.");
      assert(malformedItem.error_category === "usage_malformed", "Malformed usage should store usage_malformed.");

      const after = await operationalCounts(prisma);
      assert(after.agentCalls === before.agentCalls, "Usage parser smoke created operational agent calls.");
      assert(after.studentProfiles === before.studentProfiles, "Usage parser smoke created profiles.");
      assert(after.formativeDecisions === before.formativeDecisions, "Usage parser smoke created decisions.");
      assert(after.followupRounds === before.followupRounds, "Usage parser smoke created follow-up rounds.");
      assert(after.itemVerificationRuns === before.itemVerificationRuns, "Usage parser smoke created item verification runs.");
      assert(after.workflowJobs === before.workflowJobs, "Usage parser smoke created workflow jobs.");
    });

    console.log("Evaluation usage parser smoke test passed. No OpenAI network call was made.");
  } finally {
    await cleanupLiveCanaryRecords(prisma);
    await cleanupEvalFixtures();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupLiveCanaryRecords(prisma).catch(() => undefined);
    await cleanupEvalFixtures().catch(() => undefined);
    await prisma.$disconnect();
  });
