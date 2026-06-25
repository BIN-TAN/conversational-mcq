import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { sendInitialAdministrationMessage } from "../src/lib/agents/response-collection/service";
import { getGuardedOperationalAgentIntegrationReadiness } from "../src/lib/operational/guarded-agent-integration";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { enqueueInitialProfilingJobIfAutomatic } from "../src/lib/workflow/automation";
import { drainAvailableWorkflowJobsOnce, processWorkflowJob } from "../src/lib/workflow/worker";
import { enqueueWorkflowJob } from "../src/lib/workflow/jobs";
import {
  assert,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";
import {
  cleanupResponseCollectionFixture,
  createResponseCollectionFixture
} from "./response-collection-smoke-fixture";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const prefix = `phase8a_guarded_${Date.now()}`;

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

function setBaseMockEnv(input: {
  mode: "disabled" | "mock" | "guarded_live";
  evidenceRequired?: boolean;
  allowMockResponseCollection?: boolean;
}) {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPENAI_API_KEY = "";
  process.env.OPERATIONAL_AGENT_MODE = input.mode;
  delete process.env.OPERATIONAL_AGENT_INTEGRATION_ENABLED;
  process.env.OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED =
    input.evidenceRequired === undefined || input.evidenceRequired ? "true" : "false";
  process.env.OPERATIONAL_AGENT_INTEGRATION_APPROVED_TARGETED_RUN_ID = "evr_20260624_bltzgtq";
  process.env.ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW =
    input.allowMockResponseCollection ? "true" : "false";
}

async function createAutomaticCompletedFixture(suffix: string) {
  const fixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix,
    withProfile: false,
    withPlanning: false
  });

  await prisma.assessmentSession.update({
    where: { id: fixture.session.id },
    data: {
      workflow_mode_snapshot: "automatic",
      current_phase: "profiling_pending"
    }
  });
  await prisma.conceptUnitSession.update({
    where: { id: fixture.conceptUnitSession.id },
    data: {
      initial_completed_at: new Date(),
      status: "initial_completed"
    }
  });
  await createResponsePackage({
    concept_unit_session_db_id: fixture.conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package"
  });

  return fixture;
}

async function defaultOffEnqueuesFallbackWorkflow() {
  setFollowupSmokeEnv({
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    OPERATIONAL_AGENT_MODE: "disabled",
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: "true",
    FOLLOWUP_CONTEXT_MAX_TURNS: "4",
    FOLLOWUP_MESSAGE_MAX_CHARS: "600",
    FOLLOWUP_CONTEXT_MAX_CHARS: "4000",
    FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE: "3"
  });
  const fixture = await createAutomaticCompletedFixture("default_off");
  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  assert(!readiness.allowed, "Default Phase 8A integration should be blocked.");
  assert(
    readiness.block_reason === "operational_agent_mode_disabled",
    "Default-off block reason should be explicit."
  );

  const enqueued = await enqueueInitialProfilingJobIfAutomatic(fixture.conceptUnitSession.id);
  assert(enqueued?.created, "Default-off integration should enqueue automatic fallback profiling.");
  const processed = await drainUntilAtLeast({
    worker_id: `${prefix}_default_off_worker`,
    expected_count: 3
  });
  assert(processed.length >= 3, "Default-off workflow should process through deterministic fallbacks.");
  assert(
    (await prisma.agentCall.count({ where: { assessment_session_db_id: fixture.session.id } })) === 0,
    "Default-off fallback workflow should not create provider agent calls."
  );
  assert(
    (await prisma.operationalAgentEffectiveResult.count({
      where: { operational_context_public_id: { contains: fixture.session.session_public_id } }
    })) >= 2,
    "Default-off fallback workflow should persist operational effective results."
  );
}

async function workerBackstopRunsFallbackQueuedJob() {
  setBaseMockEnv({ mode: "disabled", evidenceRequired: true });
  const fixture = await createAutomaticCompletedFixture("worker_backstop");
  const enqueued = await enqueueWorkflowJob({
    job_type: "run_initial_profiling",
    assessment_session_db_id: fixture.session.id,
    concept_unit_session_db_id: fixture.conceptUnitSession.id,
    idempotency_key: `${prefix}:worker_backstop`,
    payload: { smoke: true }
  });
  const result = await processWorkflowJob(enqueued.job);

  assert(result.outcome === "completed", "Worker backstop should run deterministic fallback while mode is disabled.");
  const updated = await prisma.workflowJob.findUniqueOrThrow({ where: { id: enqueued.job.id } });
  assert(
    updated.last_error_category === null,
    "Worker backstop should not mark disabled-mode fallback as an error."
  );
  assert(
    (await prisma.agentCall.count({ where: { assessment_session_db_id: fixture.session.id } })) === 0,
    "Worker backstop must not create agent calls."
  );
}

async function mockOnlyOptInAllowsAutomaticWorkflow() {
  setFollowupSmokeEnv({
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    OPERATIONAL_AGENT_MODE: "mock",
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: "false",
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
    FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE: "3"
  });
  const fixture = await createAutomaticCompletedFixture("mock_opt_in");
  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  assert(readiness.allowed, "Mock-only synthetic smoke opt-in should allow guarded integration.");
  assert(
    readiness.evidence_status === "manifest_verified",
    "Mock operational mode should verify the approved manifest."
  );

  const enqueued = await enqueueInitialProfilingJobIfAutomatic(fixture.conceptUnitSession.id);
  assert(enqueued?.created, "Mock-only opt-in should enqueue automatic profiling.");
  const processed = await drainUntilAtLeast({
    worker_id: `${prefix}_opt_in_worker`,
    expected_count: 3
  });
  assert(processed.length >= 3, "Mock-only opt-in should process the automatic agent chain.");
  assert(
    (await prisma.agentCall.count({ where: { assessment_session_db_id: fixture.session.id, provider: "openai" } })) === 0,
    "Mock-only opt-in must not create OpenAI calls."
  );
}

async function responseCollectionFallsBackWhenGateOff() {
  setBaseMockEnv({ mode: "disabled", evidenceRequired: true, allowMockResponseCollection: true });
  const fixture = await createResponseCollectionFixture({
    prisma,
    prefix,
    responseCollectionMode: "llm_assisted"
  });
  const result = await sendInitialAdministrationMessage({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    data: {
      message: "I think it doubles because each value is twice the last one.",
      client_message_id: `${prefix}_rc_gate_off`
    }
  });

  assert(result.message_status === "fallback_replied", "Response Collection should fallback while integration gate is off.");
  assert(
    (await prisma.agentCall.count({ where: { assessment_session_db_id: fixture.session.id } })) === 0,
    "Response Collection fallback should not create an agent call while gate is off."
  );
}

async function liveClassroomConfigStillBlocked() {
  process.env.OPERATIONAL_AGENT_MODE = "guarded_live";
  delete process.env.OPERATIONAL_AGENT_INTEGRATION_ENABLED;
  process.env.OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED = "false";
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_LIVE_CALLS_ENABLED = "true";
  process.env.OPENAI_API_KEY = "fake-smoke-key-never-sent";

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  assert(!readiness.allowed, "Guarded live must remain blocked without full approved readiness.");
  assert(
    readiness.blocking_reasons.includes("approved_config_hash_missing") ||
      readiness.blocking_reasons.includes("approved_manifest_invalid"),
    "Guarded live should be blocked by missing approved readiness, not by a provider call."
  );
}

async function main() {
  await cleanupFollowupSmoke(prisma, prefix);
  await cleanupResponseCollectionFixture(prisma, prefix);

  try {
    await defaultOffEnqueuesFallbackWorkflow();
    await workerBackstopRunsFallbackQueuedJob();
    await mockOnlyOptInAllowsAutomaticWorkflow();
    await responseCollectionFallsBackWhenGateOff();
    await liveClassroomConfigStillBlocked();
    await cleanupFollowupSmoke(prisma, prefix);
    await cleanupResponseCollectionFixture(prisma, prefix);
    console.log("Operational guarded integration smoke test passed. No OpenAI call was made.");
  } catch (error) {
    await cleanupFollowupSmoke(prisma, prefix).catch(() => null);
    await cleanupResponseCollectionFixture(prisma, prefix).catch(() => null);
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
