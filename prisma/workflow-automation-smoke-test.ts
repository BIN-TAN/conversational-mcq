import { PrismaClient } from "@prisma/client";
import { enqueueInitialProfilingJobIfAutomatic } from "../src/lib/workflow/automation";
import { drainAvailableWorkflowJobsOnce } from "../src/lib/workflow/worker";
import {
  pauseWorkflowAutomation,
  resumeWorkflowAutomation,
  retryCurrentWorkflowStep
} from "../src/lib/workflow/overrides";
import {
  assert,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";
import { generatePublicId } from "../src/lib/services/ids";

const prisma = new PrismaClient();
const prefix = `phase6d2a_workflow_${Date.now()}`;

async function drainUntilAtLeast(input: { worker_id: string; expected_count: number }) {
  const processed = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    processed.push(
      ...(await drainAvailableWorkflowJobsOnce({
        worker_id: `${input.worker_id}_${attempt}`
      }))
    );

    if (processed.length >= input.expected_count) {
      return processed;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return processed;
}

async function makeAutomaticFixture(suffix: string) {
  const fixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix,
    withProfile: false,
    withPlanning: false
  });

  await prisma.assessmentSession.update({
    where: { id: fixture.session.id },
    data: { workflow_mode_snapshot: "automatic" }
  });

  return fixture;
}

async function assertNoOpenAiCalls(sessionId: string) {
  const openAiCalls = await prisma.agentCall.count({
    where: {
      assessment_session_db_id: sessionId,
      provider: "openai"
    }
  });

  assert(openAiCalls === 0, "Workflow smoke should not create OpenAI provider calls.");
}

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
    FOLLOWUP_CONTEXT_MAX_CHARS: "4000",
    OPERATIONAL_AGENT_MODE: "mock",
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: "true",
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: "false",
    DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED: "true",
    ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true"
  });
  await cleanupFollowupSmoke(prisma, prefix);

  const manual = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix: "manual",
    withProfile: false,
    withPlanning: false
  });
  const manualEnqueue = await enqueueInitialProfilingJobIfAutomatic(manual.conceptUnitSession.id);
  assert(manualEnqueue === null, "Manual-review session should not enqueue automatic jobs.");
  assert(
    (await prisma.workflowJob.count({ where: { assessment_session_db_id: manual.session.id } })) === 0,
    "Manual-review session should have no workflow jobs."
  );

  const auto = await makeAutomaticFixture("auto");
  const enqueue = await enqueueInitialProfilingJobIfAutomatic(auto.conceptUnitSession.id);
  assert(enqueue?.created, "Automatic session should enqueue profiling job.");
  const processed = await drainUntilAtLeast({
    worker_id: `${prefix}_worker`,
    expected_count: 3
  });
  assert(processed.length >= 3, "Automatic workflow should process available jobs.");

  const autoSession = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: auto.session.id }
  });
  assert(autoSession.current_phase === "followup_active", "Automatic workflow should reach followup_active.");
  assert(
    (await prisma.studentProfile.count({ where: { concept_unit_session_db_id: auto.conceptUnitSession.id } })) === 1,
    "Automatic workflow should create one student profile."
  );
  assert(
    (await prisma.studentProfile.count({ where: { concept_unit_session_db_id: auto.conceptUnitSession.id, profile_type: "updated" } })) === 0,
    "Phase 6D2A should not create updated follow-up profiles."
  );
  assert(
    (await prisma.formativeDecision.count({ where: { concept_unit_session_db_id: auto.conceptUnitSession.id } })) === 1,
    "Automatic workflow should create one formative decision."
  );
  assert(
    (await prisma.followupRound.count({ where: { concept_unit_session_db_id: auto.conceptUnitSession.id } })) === 1,
    "Automatic workflow should create one first-round follow-up."
  );
  assert(
    (await prisma.workflowJob.count({ where: { assessment_session_db_id: auto.session.id, status: "completed" } })) === 3,
    "All automatic workflow jobs should complete."
  );
  await enqueueInitialProfilingJobIfAutomatic(auto.conceptUnitSession.id);
  await drainAvailableWorkflowJobsOnce({ worker_id: `${prefix}_worker_repeat` });
  assert(
    (await prisma.workflowJob.count({ where: { assessment_session_db_id: auto.session.id } })) === 3,
    "Repeated trigger should not duplicate jobs."
  );
  await assertNoOpenAiCalls(auto.session.id);

  const paused = await makeAutomaticFixture("paused");
  await enqueueInitialProfilingJobIfAutomatic(paused.conceptUnitSession.id);
  await pauseWorkflowAutomation({
    session_public_id: paused.session.session_public_id,
    teacher_user_db_id: paused.teacher.id
  });
  await drainAvailableWorkflowJobsOnce({ worker_id: `${prefix}_paused_worker` });
  assert(
    (await prisma.workflowJob.count({ where: { assessment_session_db_id: paused.session.id, status: "completed" } })) === 0,
    "Paused automatic session should not execute its pending jobs."
  );
  await resumeWorkflowAutomation({
    session_public_id: paused.session.session_public_id,
    teacher_user_db_id: paused.teacher.id
  });
  const resumedDrain = await drainUntilAtLeast({
    worker_id: `${prefix}_resumed_worker`,
    expected_count: 3
  });
  assert(resumedDrain.length >= 3, "Resumed automatic session should continue idempotently.");
  assert(
    (await prisma.workflowJob.count({ where: { assessment_session_db_id: paused.session.id, status: "completed" } })) === 3,
    "Resumed automatic session should complete its three workflow jobs."
  );

  const retry = await makeAutomaticFixture("retry");
  const failedJob = await prisma.workflowJob.create({
    data: {
      job_public_id: generatePublicId("workflow_job"),
      job_type: "run_initial_profiling",
      status: "failed",
      assessment_session_db_id: retry.session.id,
      concept_unit_session_db_id: retry.conceptUnitSession.id,
      idempotency_key: `${prefix}:failed_retry_seed`,
      payload: { smoke: true },
      attempt_count: 3,
      max_attempts: 3,
      run_after: new Date(),
      last_error_category: "smoke_seed",
      last_error_message: "Seeded failure for retry smoke."
    }
  });
  await prisma.assessmentSession.update({
    where: { id: retry.session.id },
    data: {
      needs_review: true,
      needs_review_reason: "automatic_workflow_failed:run_initial_profiling:smoke_seed",
      automation_exception_reason: "automatic_workflow_failed:run_initial_profiling:smoke_seed"
    }
  });
  const retryResult = await retryCurrentWorkflowStep({
    session_public_id: retry.session.session_public_id,
    teacher_user_db_id: retry.teacher.id
  });
  assert(retryResult.job_public_id !== failedJob.job_public_id, "Retry should preserve failed job and create a new job.");
  const retryDrain = await drainUntilAtLeast({
    worker_id: `${prefix}_retry_worker`,
    expected_count: 3
  });
  assert(retryDrain.length >= 3, "Retry job should drain available automatic jobs.");
  assert(
    (await prisma.workflowJob.count({ where: { assessment_session_db_id: retry.session.id, status: "completed" } })) === 3,
    "Retry job should complete the automatic chain for the retry fixture."
  );
  assert(
    (await prisma.workflowOverride.count({ where: { assessment_session_db_id: retry.session.id, action_type: "retry_current_step" } })) === 1,
    "Retry should create an append-only override record."
  );

  const unsupportedJobTypes = await prisma.workflowJob.count({
    where: {
      assessment_session: { assessment: { title: { startsWith: prefix } } },
      job_type: { notIn: ["run_initial_profiling", "run_initial_planning", "start_initial_followup"] }
    }
  });
  assert(unsupportedJobTypes === 0, "Phase 6D2A should only create the approved job types.");

  await cleanupFollowupSmoke(prisma, prefix);
  console.log("workflow automation smoke passed");
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
