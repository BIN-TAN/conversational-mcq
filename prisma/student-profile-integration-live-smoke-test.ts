import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  PROFILE_INTEGRATION_AGENT_NAME,
  buildProfileIntegrationInterpretationPacketForSession,
  validateProfileIntegrationOutput
} from "../src/lib/services/student-assessment/profile-integration";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { logProcessEvent } from "../src/lib/services/process-events";
import {
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";

const envLoadResult = loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

const REQUIRED_DATABASE_ENV = ["DATABASE_URL", "SESSION_SECRET"] as const;
const REQUIRED_PROVIDER_ENV = ["LLM_PROVIDER", "LLM_LIVE_CALLS_ENABLED"] as const;
const MODEL_ENV_OPTIONS = [
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP"
] as const;

function envPresent(name: string) {
  return typeof process.env[name] === "string" && process.env[name]?.trim().length > 0;
}

function liveReadiness() {
  const missingDatabaseOrSession = REQUIRED_DATABASE_ENV.filter((name) => !envPresent(name));
  const missingProvider = REQUIRED_PROVIDER_ENV.filter((name) => !envPresent(name));
  const invalidProvider: string[] = [];

  if (envPresent("LLM_PROVIDER") && process.env.LLM_PROVIDER !== "openai") {
    invalidProvider.push("LLM_PROVIDER");
  }
  if (envPresent("LLM_LIVE_CALLS_ENABLED") && process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
    invalidProvider.push("LLM_LIVE_CALLS_ENABLED");
  }

  const credentialConfigured = envPresent("OPENAI_API_KEY") || envPresent("OPENAI_API_KEY_FILE");
  const modelConfigured = MODEL_ENV_OPTIONS.some((name) => envPresent(name));

  return {
    ready:
      missingDatabaseOrSession.length === 0 &&
      missingProvider.length === 0 &&
      invalidProvider.length === 0 &&
      credentialConfigured &&
      modelConfigured,
    env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path),
    missing_database_or_session_variables: missingDatabaseOrSession,
    missing_provider_variables: missingProvider,
    invalid_provider_variable_names: invalidProvider,
    credential_configured: credentialConfigured,
    model_configured_by_one_of: modelConfigured ? MODEL_ENV_OPTIONS : [],
    missing_model_variable_options: modelConfigured ? [] : MODEL_ENV_OPTIONS
  };
}

async function addSyntheticProcessContext(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });
  const responses = await prisma.itemResponse.findMany({
    where: { concept_unit_session_db_id: conceptUnitSession.id },
    orderBy: [{ item: { item_order: "asc" } }],
    select: { item_db_id: true }
  });

  for (const [index, response] of responses.entries()) {
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: response.item_db_id,
      event_type: index === 1 ? "paste_detected" : "typing_activity_summary",
      event_category: "student_process",
      event_source: "frontend",
      payload: { synthetic_profile_integration_live_smoke_setup: true, index }
    });
  }
}

async function createSampleSessionWithMockSetup() {
  const liveEnvSnapshot = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: process.env.LLM_LIVE_CALLS_ENABLED,
    ITEM_ADMIN_TUTOR_MODE: process.env.ITEM_ADMIN_TUTOR_MODE,
    ALLOW_LOCAL_MOCK_RUNTIME: process.env.ALLOW_LOCAL_MOCK_RUNTIME
  };

  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";

  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const prefix = `profile_integration_live_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];
  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: demoAssessmentPublicId
  });
  sessionPublicIds.push(started.session.session_public_id);

  let state = await startConceptUnitInitialAdministration({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
  });

  for (const itemIndex of [1, 2, 3]) {
    state = await completeInitialItem({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex,
      withTemptingReason: itemIndex === 2
    });
  }

  assert(state.assessment_state === "PACKAGE_REVIEW", "Live profile integration setup did not reach package review.");
  await addSyntheticProcessContext(started.session.session_public_id);

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: started.session.session_public_id },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });
  await createResponsePackage({ concept_unit_session_db_id: conceptUnitSession.id });

  process.env.LLM_PROVIDER = liveEnvSnapshot.LLM_PROVIDER;
  process.env.LLM_LIVE_CALLS_ENABLED = liveEnvSnapshot.LLM_LIVE_CALLS_ENABLED;
  process.env.ITEM_ADMIN_TUTOR_MODE = liveEnvSnapshot.ITEM_ADMIN_TUTOR_MODE;
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = liveEnvSnapshot.ALLOW_LOCAL_MOCK_RUNTIME;

  return {
    session_public_id: started.session.session_public_id,
    cleanup: () =>
      cleanupSmokeStudentSessions({
        prisma,
        userDbId: student.id,
        sessionPublicIds
      })
  };
}

async function main() {
  if (process.env.RUN_LIVE_PROFILE_INTEGRATION_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_PROFILE_INTEGRATION_SMOKE is not set to 1.",
      env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
    }, null, 2));
    return;
  }

  const readiness = liveReadiness();
  if (!readiness.ready) {
    console.log(JSON.stringify({
      status: "not_ready",
      ...readiness
    }, null, 2));
    throw new Error("Live profile integration smoke is not configured. No provider call was made.");
  }

  const sample = await createSampleSessionWithMockSetup();

  try {
    const packet = await buildProfileIntegrationInterpretationPacketForSession(
      sample.session_public_id,
      { execution_mode: "live_provider" }
    );
    const validation = validateProfileIntegrationOutput(packet);
    assert(validation.valid, `Live profile integration packet failed validation: ${JSON.stringify(validation.issues)}`);

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: sample.session_public_id },
      select: { id: true }
    });
    const agentCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: PROFILE_INTEGRATION_AGENT_NAME
      },
      orderBy: [{ created_at: "desc" }],
      select: {
        id: true,
        provider: true,
        call_status: true,
        output_validated: true,
        provider_request_id: true,
        provider_response_id: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true
      }
    });

    assert(agentCall.provider === "openai", "Live profile integration should use the OpenAI provider.");
    assert(agentCall.call_status === "succeeded", "Live profile integration agent call should succeed.");
    assert(agentCall.output_validated, "Live profile integration output should validate.");
    assert(
      Boolean(agentCall.provider_request_id || agentCall.provider_response_id),
      "Live profile integration provider metadata should be audited."
    );

    console.log(JSON.stringify({
      status: "passed",
      session_public_id: sample.session_public_id,
      student_facing_status: packet.student_facing_status,
      integration_pattern: packet.integration_pattern,
      status_confidence: packet.status_confidence,
      profile_integration_call_status: agentCall.call_status,
      profile_integration_output_validated: agentCall.output_validated,
      provider_metadata_present: Boolean(agentCall.provider_request_id || agentCall.provider_response_id),
      token_usage_present: Boolean(agentCall.input_tokens || agentCall.output_tokens || agentCall.total_tokens)
    }, null, 2));
  } finally {
    await sample.cleanup();
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
