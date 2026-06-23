import { PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import {
  createLivePilotDryRunReport,
  createLivePilotPreflightReport,
  inspectLivePilotRun,
  livePilotTestInternals,
  runLivePilot
} from "../src/lib/services/evals/pilot-execution";
import { EVAL_PILOT_TOTAL_ITEMS } from "../src/lib/services/evals/pilot-manifest";
import {
  assert,
  cleanupLiveCanaryRecords,
  livePilotSmokeEnv,
  operationalCounts,
  withCanaryEnv
} from "./eval-live-canary-test-utils";
import { createApprovedMockCanaryRun } from "./eval-live-pilot-test-utils";

const prisma = new PrismaClient();

async function expectReject(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }

  throw new Error(`${label} should have been rejected.`);
}

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  const approvedCanaryRunPublicId = await createApprovedMockCanaryRun(prisma);

  await withCanaryEnv(
    {
      ...livePilotSmokeEnv,
      EVAL_PILOT_APPROVED_CANARY_RUN_ID: approvedCanaryRunPublicId
    },
    async () => {
      const preflight = await createLivePilotPreflightReport({ approvedCanaryRunPublicId });
      assert(preflight.ready, `Pilot preflight should pass: ${JSON.stringify(preflight.issues)}`);
      assert(preflight.planned_outputs === EVAL_PILOT_TOTAL_ITEMS, "Pilot preflight should plan 100 outputs.");
      assert(preflight.approved_canary_id === approvedCanaryRunPublicId, "Preflight should use the explicit approved canary.");
      assert(preflight.classroom_live_calls_enabled === false, "Classroom live calls should remain disabled.");

      const dryRun = await createLivePilotDryRunReport({ approvedCanaryRunPublicId });
      assert(dryRun.ready, "Pilot dry run should pass.");
      assert(dryRun.openai_call_made === false, "Dry run must not call OpenAI.");
      assert(dryRun.provider_payload_count === EVAL_PILOT_TOTAL_ITEMS, "Dry run should build 100 payloads.");
      assert(dryRun.operational_records_referenced === false, "Dry run should not reference operational records.");

      const plan = await livePilotTestInternals.buildLivePilotPlan({ approvedCanaryRunPublicId });
      assert(plan.valid, "Pilot plan should validate.");
      assert(plan.cases.length === EVAL_PILOT_TOTAL_ITEMS, "Pilot plan should contain 100 planned outputs.");
      assert(plan.cases.every((entry) => entry.case_source === "synthetic"), "Pilot plan should be synthetic-only.");
      assert(plan.cases.every((entry) => entry.repetition_index === 1 || entry.repetition_index === 2), "Pilot should enforce two repetitions.");

      await expectReject("missing confirmation", () =>
        runLivePilot({
          approvedCanaryRunPublicId,
          confirmPaidApi: false,
          runInstanceMode: "new_run",
          provider: new MockLlmProvider(),
          allowMockProvider: true
        })
      );

      await withCanaryEnv({ OPENAI_API_KEY: "" }, async () => {
        await expectReject("missing API key", () =>
          runLivePilot({
            approvedCanaryRunPublicId,
            confirmPaidApi: true,
            runInstanceMode: "new_run",
            provider: new MockLlmProvider()
          })
        );
      });

      await withCanaryEnv({ EVAL_PILOT_LIVE_CALLS_ENABLED: "false" }, async () => {
        await expectReject("live pilot disabled", () =>
          runLivePilot({
            approvedCanaryRunPublicId,
            confirmPaidApi: true,
            runInstanceMode: "new_run",
            provider: new MockLlmProvider()
          })
        );
      });

      const before = await operationalCounts(prisma);
      const summary = await runLivePilot({
        approvedCanaryRunPublicId,
        confirmPaidApi: true,
        runInstanceMode: "new_run",
        provider: new MockLlmProvider(),
        allowMockProvider: true
      });
      const after = await operationalCounts(prisma);

      assert(summary.run_item_count === EVAL_PILOT_TOTAL_ITEMS, "Pilot should create 100 run items.");
      assert(summary.status === "completed", "Mock-backed pilot should complete.");
      assert(summary.provider_request_count === EVAL_PILOT_TOTAL_ITEMS, "Pilot should make one mock provider request per output.");
      assert(after.agentCalls === before.agentCalls, "Pilot created operational agent calls.");
      assert(after.studentProfiles === before.studentProfiles, "Pilot created operational profiles.");
      assert(after.formativeDecisions === before.formativeDecisions, "Pilot created operational decisions.");
      assert(after.followupRounds === before.followupRounds, "Pilot created operational follow-up rounds.");
      assert(after.workflowJobs === before.workflowJobs, "Pilot created workflow jobs.");

      const run = await prisma.evalRun.findUniqueOrThrow({
        where: { run_public_id: summary.run_public_id },
        include: { run_items: true }
      });
      assert(run.evaluation_phase === "full_pilot", "Run should store full_pilot phase.");
      assert(run.approved_canary_run_public_id === approvedCanaryRunPublicId, "Run should store approved canary ID.");
      assert(run.run_items.every((item) => item.evaluation_stratum), "Run items should store stratum.");
      assert(run.run_items.every((item) => item.paired_case_key), "Run items should store paired case key.");

      const inspection = await inspectLivePilotRun(summary.run_public_id);
      assert(inspection.safe_to_resume === false, "Completed pilot should not be resumable.");

      await expectReject("resume completed pilot", () =>
        runLivePilot({
          runPublicId: summary.run_public_id,
          runInstanceMode: "resume",
          confirmPaidApi: true,
          provider: new MockLlmProvider(),
          allowMockProvider: true
        })
      );
    }
  );

  await cleanupLiveCanaryRecords(prisma);
  console.log("Live pilot runner smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupLiveCanaryRecords(prisma).catch(() => undefined);
    await prisma.$disconnect();
  });
