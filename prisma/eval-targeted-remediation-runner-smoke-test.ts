import { PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import {
  createTargetedRemediationPreflightReport,
  inspectTargetedRemediationRun,
  runTargetedRemediation
} from "../src/lib/services/evals/targeted-remediation-execution";
import { assert, operationalCounts, withCanaryEnv } from "./eval-live-canary-test-utils";
import {
  cleanupTargetedRemediationRecords,
  createMockTargetedRemediationRun,
  targetedRemediationSmokeEnv
} from "./eval-targeted-remediation-test-utils";

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
  await cleanupTargetedRemediationRecords(prisma);

  await withCanaryEnv(targetedRemediationSmokeEnv, async () => {
    const preflight = await createTargetedRemediationPreflightReport();
    assert(preflight.ready, `Preflight should pass: ${JSON.stringify(preflight.issues)}`);
    assert(preflight.planned_run_item_count === 22, "Preflight should plan 22 outputs.");
    assert(preflight.classroom_live_calls_enabled === false, "Classroom live calls should remain disabled.");

    await expectReject("missing confirmation", () =>
      runTargetedRemediation({
        confirmPaidApi: false,
        runInstanceMode: "new_run",
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );

    await withCanaryEnv({ OPENAI_API_KEY: "" }, async () => {
      await expectReject("missing API key", () =>
        runTargetedRemediation({
          confirmPaidApi: true,
          runInstanceMode: "new_run",
          provider: new MockLlmProvider()
        })
      );
    });

    await withCanaryEnv({ EVAL_LIVE_CALLS_ENABLED: "false" }, async () => {
      await expectReject("live eval disabled", () =>
        runTargetedRemediation({
          confirmPaidApi: true,
          runInstanceMode: "new_run",
          provider: new MockLlmProvider()
        })
      );
    });

    const before = await operationalCounts(prisma);
    const created = await createMockTargetedRemediationRun(prisma);
    const after = await operationalCounts(prisma);
    const summary = created.summary;

    assert(summary.run_item_count === 22, "Targeted run should create 22 run items.");
    assert(summary.status === "completed", "Mock targeted run should complete.");
    assert(summary.provider_request_count === 22, "Targeted run should make one mock provider request per output.");
    assert(after.agentCalls === before.agentCalls, "Targeted run created operational agent calls.");
    assert(after.studentProfiles === before.studentProfiles, "Targeted run created operational profiles.");
    assert(after.formativeDecisions === before.formativeDecisions, "Targeted run created operational decisions.");
    assert(after.followupRounds === before.followupRounds, "Targeted run created operational follow-up rounds.");
    assert(after.workflowJobs === before.workflowJobs, "Targeted run created workflow jobs.");

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { run_public_id: summary.run_public_id },
      include: { run_items: true }
    });
    assert(run.evaluation_phase === "targeted_remediation", "Run should store targeted remediation phase.");
    assert(run.run_items.every((item) => item.evaluation_stratum === "affected" || item.evaluation_stratum === "control"), "Run items should store affected/control stratum.");
    assert(run.run_items.every((item) => item.paired_case_key), "Run items should store paired case keys.");

    const inspection = await inspectTargetedRemediationRun(summary.run_public_id);
    assert(inspection.safe_to_resume === false, "Completed targeted run should not be resumable.");

    await expectReject("resume completed targeted run", () =>
      runTargetedRemediation({
        runPublicId: summary.run_public_id,
        runInstanceMode: "resume",
        confirmPaidApi: true,
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );
  });

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Targeted remediation runner smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupTargetedRemediationRecords(prisma).catch(() => undefined);
    await prisma.$disconnect();
  });
