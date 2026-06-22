import { PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import { runLiveCanary } from "../src/lib/services/evals/live-execution";
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

async function contentCounts() {
  const [assessments, conceptUnits, items] = await Promise.all([
    prisma.assessment.count(),
    prisma.conceptUnit.count(),
    prisma.item.count()
  ]);

  return { assessments, conceptUnits, items };
}

async function main() {
  await ensureTeacherReviewDemoUsers(prisma);
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  await withCanaryEnv(liveCanarySmokeEnv, async () => {
    const beforeOperational = await operationalCounts(prisma);
    const beforeContent = await contentCounts();

    const summary = await runLiveCanary({
      confirmPaidApi: true,
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });

    assert(summary.run_item_count === 25, "Isolation smoke should create eval run items.");
    const afterOperational = await operationalCounts(prisma);
    const afterContent = await contentCounts();

    assert(afterOperational.agentCalls === beforeOperational.agentCalls, "Eval execution created operational agent_calls.");
    assert(afterOperational.workflowJobs === beforeOperational.workflowJobs, "Eval execution created workflow jobs.");
    assert(afterOperational.assessmentSessions === beforeOperational.assessmentSessions, "Eval execution changed assessment sessions.");
    assert(afterOperational.studentProfiles === beforeOperational.studentProfiles, "Eval execution created student profiles.");
    assert(afterOperational.formativeDecisions === beforeOperational.formativeDecisions, "Eval execution created formative decisions.");
    assert(afterOperational.followupRounds === beforeOperational.followupRounds, "Eval execution created follow-up rounds.");
    assert(afterOperational.itemVerificationRuns === beforeOperational.itemVerificationRuns, "Eval execution created item verification runs.");
    assert(afterContent.assessments === beforeContent.assessments, "Eval execution changed assessments.");
    assert(afterContent.conceptUnits === beforeContent.conceptUnits, "Eval execution changed concept units.");
    assert(afterContent.items === beforeContent.items, "Eval execution changed items.");
  });

  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  console.log("Live evaluation isolation smoke test passed.");
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
