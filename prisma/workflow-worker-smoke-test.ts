import { PrismaClient } from "@prisma/client";
import {
  claimNextWorkflowJob,
  enqueueWorkflowJob,
  releaseAbandonedWorkflowJobs
} from "../src/lib/workflow/jobs";
import {
  assert,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `phase6d2a_worker_${Date.now()}`;

async function main() {
  setFollowupSmokeEnv({
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    LLM_DAILY_STUDENT_CALL_LIMIT: "100",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "100000",
    LLM_DAILY_CLASS_CALL_LIMIT: "100",
    LLM_DAILY_CLASS_TOKEN_LIMIT: "100000",
    LLM_SESSION_CALL_LIMIT: "100",
    LLM_SESSION_TOKEN_LIMIT: "100000",
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "20",
    LLM_USAGE_TIMEZONE: "UTC",
    FOLLOWUP_CONTEXT_MAX_TURNS: "4",
    FOLLOWUP_MESSAGE_MAX_CHARS: "600",
    FOLLOWUP_CONTEXT_MAX_CHARS: "4000"
  });
  process.env.WORKFLOW_JOB_LEASE_TIMEOUT_MS = "1000";
  await cleanupFollowupSmoke(prisma, prefix);

  const fixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix: "claim",
    withProfile: false,
    withPlanning: false
  });
  await prisma.assessmentSession.update({
    where: { id: fixture.session.id },
    data: { workflow_mode_snapshot: "automatic" }
  });

  const enqueued = await enqueueWorkflowJob({
    job_type: "run_initial_profiling",
    assessment_session_db_id: fixture.session.id,
    concept_unit_session_db_id: fixture.conceptUnitSession.id,
    idempotency_key: `${prefix}:claim`,
    payload: {
      session_public_id: fixture.session.session_public_id,
      concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id
    }
  });
  const claimed = await claimNextWorkflowJob(`${prefix}_worker_a`);
  assert(claimed?.job_public_id === enqueued.job.job_public_id, "First worker should claim the available job.");
  const secondClaim = await claimNextWorkflowJob(`${prefix}_worker_b`);
  assert(secondClaim === null, "Concurrent worker should not claim the same running job.");

  await prisma.workflowJob.update({
    where: { id: claimed.id },
    data: { locked_at: new Date(Date.now() - 10_000) }
  });
  await releaseAbandonedWorkflowJobs();
  const reclaimed = await claimNextWorkflowJob(`${prefix}_worker_c`);
  assert(reclaimed?.job_public_id === claimed.job_public_id, "Expired lease should become claimable again.");
  assert(reclaimed.attempt_count === claimed.attempt_count + 1, "Reclaimed job should increment attempts.");

  const pausedFixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix: "paused_worker",
    withProfile: false,
    withPlanning: false
  });
  await prisma.assessmentSession.update({
    where: { id: pausedFixture.session.id },
    data: {
      workflow_mode_snapshot: "automatic",
      automation_paused_at: new Date()
    }
  });
  await enqueueWorkflowJob({
    job_type: "run_initial_profiling",
    assessment_session_db_id: pausedFixture.session.id,
    concept_unit_session_db_id: pausedFixture.conceptUnitSession.id,
    idempotency_key: `${prefix}:paused`,
    payload: {
      session_public_id: pausedFixture.session.session_public_id,
      concept_unit_public_id: pausedFixture.conceptUnit.concept_unit_public_id
    }
  });
  const pausedClaim = await claimNextWorkflowJob(`${prefix}_paused_worker`);
  assert(pausedClaim === null, "Paused automation should prevent pending jobs from being claimed.");

  const payloadText = JSON.stringify(enqueued.job.payload).toLowerCase();
  for (const secret of ["api_key", "authorization", "session_secret", "database_url", "password_hash", "access_code_hash"]) {
    assert(!payloadText.includes(secret), `Workflow payload should not include ${secret}.`);
  }
  const openAiCalls = await prisma.agentCall.count({
    where: {
      assessment_session: {
        assessment: { title: { startsWith: prefix } }
      },
      provider: "openai"
    }
  });
  assert(openAiCalls === 0, "Worker smoke should not call OpenAI.");

  await cleanupFollowupSmoke(prisma, prefix);
  console.log("workflow worker smoke passed");
}

main()
  .catch(async (error) => {
    console.error(error);
    await cleanupFollowupSmoke(prisma, prefix).catch(() => null);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
