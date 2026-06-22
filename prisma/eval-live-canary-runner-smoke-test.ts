import { PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import {
  createLiveCanaryDryRunReport,
  __liveCanaryTestInternals,
  runLiveCanary
} from "../src/lib/services/evals/live-execution";
import { validateEvalCanaryConfig } from "../src/lib/services/evals/canary-config";
import { loadLiveCanaryManifest } from "../src/lib/services/evals/canary-manifest";
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

async function expectReject(label: string, fn: () => Promise<unknown>) {
  let rejected = false;

  try {
    await fn();
  } catch {
    rejected = true;
  }

  assert(rejected, `${label} should have been rejected.`);
}

async function main() {
  await ensureTeacherReviewDemoUsers(prisma);
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  await withCanaryEnv(liveCanarySmokeEnv, async () => {
    const exact = validateEvalCanaryConfig({ requireLiveEnabled: true, requireApiKey: true });
    assert(exact.ready, "Exact snapshot configuration should validate.");

    await withCanaryEnv({ EVAL_TARGET_MODEL: "gpt-5.4-mini" }, async () => {
      const alias = validateEvalCanaryConfig({ requireLiveEnabled: true, requireApiKey: true });
      assert(!alias.ready, "Alias model should be rejected.");
      assert(alias.issues.some((issue) => issue.code === "alias_model_rejected"), "Alias rejection missing.");
    });

    await withCanaryEnv({ EVAL_TARGET_MODEL: "gpt-5.5" }, async () => {
      const wrong = validateEvalCanaryConfig({ requireLiveEnabled: true, requireApiKey: true });
      assert(!wrong.ready, "Wrong model should be rejected.");
      assert(wrong.issues.some((issue) => issue.code === "gpt_5_5_rejected"), "GPT-5.5 rejection missing.");
    });

    const manifest = await loadLiveCanaryManifest();
    assert(manifest.valid, "Canary manifest should be valid.");
    assert(manifest.ordered_cases.length === 25, "Manifest should contain 25 items.");
    assert(new Set(manifest.ordered_cases.map((entry) => `${entry.agent_name}:${entry.case_id}`)).size === 25, "Manifest case IDs should be unique per agent.");

    const countsByAgent = new Map<string, number>();
    for (const entry of manifest.ordered_cases) {
      countsByAgent.set(entry.agent_name, (countsByAgent.get(entry.agent_name) ?? 0) + 1);
    }
    for (const count of countsByAgent.values()) {
      assert(count === 5, "Each agent should have five manifest cases.");
    }

    const dryRun = await createLiveCanaryDryRunReport();
    assert(dryRun.ready, "Dry run should validate provider payloads.");
    assert(dryRun.openai_call_made === false, "Dry run must not make provider calls.");
    assert(dryRun.provider_payload_count === 25, "Dry run should build 25 provider payloads.");

    await expectReject("missing confirmation", () =>
      runLiveCanary({
        confirmPaidApi: false,
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );

    await withCanaryEnv({ OPENAI_API_KEY: "" }, async () => {
      await expectReject("missing API key", () =>
        runLiveCanary({
          confirmPaidApi: true,
          provider: new MockLlmProvider()
        })
      );
    });

    await withCanaryEnv({ EVAL_LIVE_CALLS_ENABLED: "false" }, async () => {
      await expectReject("live eval disabled", () =>
        runLiveCanary({
          confirmPaidApi: true,
          provider: new MockLlmProvider()
        })
      );
    });

    const teacher = await prisma.user.findUniqueOrThrow({
      where: { user_id: "teacher_demo" },
      select: { id: true }
    });
    await prisma.evalCase.updateMany({
      where: { case_id: "iva_clean_item_set_001" },
      data: { case_source: "teacher_authored" }
    });
    const nonsynthetic = await __liveCanaryTestInternals.buildLiveCanaryPlan({
      ensureFixtures: false
    });
    assert(!nonsynthetic.valid, "Nonsynthetic case should invalidate the canary plan.");
    assert(
      nonsynthetic.issues.some((issue) => issue.code === "nonsynthetic_case_rejected"),
      "Nonsynthetic rejection should be reported."
    );
    await prisma.evalCase.updateMany({
      where: { case_id: "iva_clean_item_set_001" },
      data: { case_source: "synthetic" }
    });

    const before = await operationalCounts(prisma);
    const summary = await runLiveCanary({
      confirmPaidApi: true,
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });
    assert(summary.run_item_count === 25, "Live canary runner should create 25 run items.");
    assert(summary.status === "completed", "Mock-backed canary run should complete.");
    assert(summary.provider_request_count === 25, "One repetition should make 25 provider requests.");

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { run_public_id: summary.run_public_id },
      include: { run_items: true }
    });
    assert(run.model_snapshot === "gpt-5.4-mini-2026-03-17", "Run should store exact snapshot.");
    assert(run.reasoning_effort === "low", "Run should store low reasoning effort.");
    assert(run.run_items.length === 25, "Run should have exactly 25 items.");
    assert(run.run_items.every((item) => item.idempotency_key), "Run items should have idempotency keys.");

    const beforeResumeRequests = run.provider_request_count;
    const resumed = await runLiveCanary({
      runPublicId: run.run_public_id,
      confirmPaidApi: true,
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });
    assert(resumed.provider_request_count === beforeResumeRequests, "Resume should skip completed items.");

    await withCanaryEnv({ EVAL_MAX_PROVIDER_REQUESTS: "1" }, async () => {
      const blocked = await runLiveCanary({
        confirmPaidApi: true,
        provider: new MockLlmProvider(),
        allowMockProvider: true
      });
      assert(blocked.status === "failed", "Request-count limit should block execution.");
      assert(blocked.provider_request_count === 0, "Budget/request guard should block before provider calls.");
    });

    const after = await operationalCounts(prisma);
    assert(after.agentCalls === before.agentCalls, "Eval runner created operational agent calls.");
    assert(after.studentProfiles === before.studentProfiles, "Eval runner created profiles.");
    assert(after.formativeDecisions === before.formativeDecisions, "Eval runner created decisions.");
    assert(after.followupRounds === before.followupRounds, "Eval runner created follow-up rounds.");
    assert(after.itemVerificationRuns === before.itemVerificationRuns, "Eval runner created item verification runs.");
    assert(after.workflowJobs === before.workflowJobs, "Eval runner created workflow jobs.");
    assert(after.assessmentSessions === before.assessmentSessions, "Eval runner changed assessment sessions.");
    assert(after.itemResponses === before.itemResponses, "Eval runner changed item responses.");

    assert(teacher.id, "Teacher fixture should remain available.");
  });

  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  console.log("Live canary runner smoke test passed.");
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
