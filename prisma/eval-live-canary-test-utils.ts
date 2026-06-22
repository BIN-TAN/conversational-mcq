import { PrismaClient } from "@prisma/client";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanupLiveCanaryRecords(prisma: PrismaClient) {
  const runs = await prisma.evalRun.findMany({
    where: {
      run_mode: "live_provider",
      model_snapshot: "gpt-5.4-mini-2026-03-17",
      model_config: {
        path: ["mock_provider_smoke"],
        equals: true
      }
    },
    select: { id: true }
  });
  const runIds = runs.map((run) => run.id);
  const runItemIds = (
    await prisma.evalRunItem.findMany({
      where: { run_db_id: { in: runIds } },
      select: { id: true }
    })
  ).map((item) => item.id);

  await prisma.evalAnnotation.deleteMany({
    where: {
      OR: [
        { run_item_db_id: { in: runItemIds } },
        { run_item: { run_db_id: { in: runIds } } }
      ]
    }
  });
  await prisma.evalRunItem.deleteMany({ where: { run_db_id: { in: runIds } } });
  await prisma.evalRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.evalSuite.deleteMany({
    where: {
      title: "Phase 7E2A live canary",
      runs: { none: {} }
    }
  });
}

export async function operationalCounts(prisma: PrismaClient) {
  const [
    studentProfiles,
    formativeDecisions,
    followupRounds,
    itemVerificationRuns,
    assessmentSessions,
    itemResponses,
    agentCalls,
    workflowJobs
  ] = await Promise.all([
    prisma.studentProfile.count(),
    prisma.formativeDecision.count(),
    prisma.followupRound.count(),
    prisma.itemVerificationRun.count(),
    prisma.assessmentSession.count(),
    prisma.itemResponse.count(),
    prisma.agentCall.count(),
    prisma.workflowJob.count()
  ]);

  return {
    studentProfiles,
    formativeDecisions,
    followupRounds,
    itemVerificationRuns,
    assessmentSessions,
    itemResponses,
    agentCalls,
    workflowJobs
  };
}

export function withCanaryEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>) {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

export const liveCanarySmokeEnv = {
  EVAL_PROVIDER: "openai",
  EVAL_LIVE_CALLS_ENABLED: "true",
  EVAL_TARGET_MODEL: "gpt-5.4-mini-2026-03-17",
  EVAL_REASONING_EFFORT: "low",
  EVAL_CANARY_REPETITIONS: "1",
  EVAL_CANARY_CASES_PER_AGENT: "5",
  EVAL_COST_HARD_LIMIT_USD: "50",
  EVAL_MAX_CONCURRENCY: "1",
  EVAL_MAX_RETRIES: "1",
  EVAL_REQUEST_TIMEOUT_MS: "60000",
  EVAL_MAX_PROVIDER_REQUESTS: "50",
  LLM_PROVIDER: "mock",
  LLM_LIVE_CALLS_ENABLED: "false",
  OPENAI_API_KEY: "fake-smoke-key-never-sent"
};
