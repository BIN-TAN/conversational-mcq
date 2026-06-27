import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  LlmConfigurationError,
  getLlmRuntimeConfig,
  resolveAgentModelConfig
} from "../src/lib/llm/config";
import {
  ChatNativeFormativeProfileOutputSchema,
  ChatNativeTargetedFeedbackOutputSchema
} from "../src/lib/services/student-assessment/formative-profile";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse,
  submitNextChoice,
  submitRevisionResponse
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import {
  assertLiveAgentCallIsAudited,
  sanitizedAuditSummary
} from "./student-live-llm-diagnostics";

const envLoadResult = loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const REQUIRED_DATABASE_ENV = ["DATABASE_URL", "SESSION_SECRET"] as const;
const REQUIRED_PROVIDER_ENV = [
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP"
] as const;

function envPresent(name: string) {
  return typeof process.env[name] === "string" && process.env[name]?.trim().length > 0;
}

function loadedEnvFileNames() {
  return envLoadResult.loadedEnvFiles.map((file) => file.path);
}

function liveSmokeReadiness() {
  const missingDatabaseOrSession = REQUIRED_DATABASE_ENV.filter((name) => !envPresent(name));
  const missingProvider = REQUIRED_PROVIDER_ENV.filter((name) => !envPresent(name));
  const providerConfigIssues: string[] = [];
  const warnings: string[] = [];

  if (envPresent("LLM_PROVIDER") && process.env.LLM_PROVIDER !== "openai") {
    providerConfigIssues.push("LLM_PROVIDER");
  }

  if (envPresent("LLM_LIVE_CALLS_ENABLED") && process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
    providerConfigIssues.push("LLM_LIVE_CALLS_ENABLED");
  }

  const categories: string[] = [];

  if (loadedEnvFileNames().length === 0) {
    warnings.push("local_env_files_not_loaded");
  }

  if (missingDatabaseOrSession.length > 0) {
    categories.push("database_session_config_missing");
  }

  if (missingProvider.length > 0 || providerConfigIssues.length > 0) {
    categories.push("openai_provider_config_missing");
  }

  if (categories.length > 0) {
    return {
      ready: false as const,
      categories,
      missing_database_or_session_variables: missingDatabaseOrSession,
      missing_provider_variables: missingProvider,
      invalid_provider_variable_names: providerConfigIssues,
      warnings,
      env_files_loaded: loadedEnvFileNames()
    };
  }

  try {
    const runtime = getLlmRuntimeConfig();
    const profileModel = resolveAgentModelConfig("formative_value_and_planning_agent");
    const feedbackModel = resolveAgentModelConfig("followup_agent");

    return {
      ready: true as const,
      categories: ["ready"],
      env_files_loaded: loadedEnvFileNames(),
      provider: runtime.provider,
      live_calls_enabled: runtime.live_calls_enabled,
      openai_key_configured: runtime.openai_key_configured,
      profile_model_configured: Boolean(profileModel.model_name),
      feedback_model_configured: Boolean(feedbackModel.model_name),
      warnings
    };
  } catch (error) {
    return {
      ready: false as const,
      categories: ["openai_provider_config_missing"],
      missing_database_or_session_variables: [] as string[],
      missing_provider_variables: [] as string[],
      invalid_provider_variable_names: [] as string[],
      warnings,
      env_files_loaded: loadedEnvFileNames(),
      configuration_error_code:
        error instanceof LlmConfigurationError ? error.code : "environment_validation_failed"
    };
  }
}

async function main() {
  if (process.env.RUN_LIVE_LLM_SMOKE !== "1") {
    console.log(
      JSON.stringify(
        {
          status: "skipped",
          diagnostic_category: "live_smoke_intentionally_skipped",
          env_files_loaded: loadedEnvFileNames(),
          reason:
            "RUN_LIVE_LLM_SMOKE is not 1. No OpenAI call was made. Set it explicitly to run this paid live-readiness smoke."
        },
        null,
        2
      )
    );
    return;
  }

  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  const readiness = liveSmokeReadiness();

  if (!readiness.ready) {
    console.log(
      JSON.stringify(
        {
          status: "not_ready",
          message:
            "RUN_LIVE_LLM_SMOKE=1 was set, but required live-smoke configuration is missing or invalid. No OpenAI call was made.",
          readiness
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase8_live_llm_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  try {
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
    assert(state.assessment_state === "PACKAGE_REVIEW", "Expected package review before live profile call.");

    const completedInitial = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(completedInitial.state.assessment_state === "FORMATIVE_ACTIVITY", "Expected formative activity.");
    assertStudentVisibleTextIsSafe(completedInitial.state);

    const activity = await submitFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message:
        "Theta is the person estimate on the linked scale. Difficulty describes where an item is located.",
      client_message_id: `${prefix}_activity`
    });
    assert(
      activity.state.assessment_state === "REVISION" || activity.state.assessment_state === "NEXT_CHOICE",
      "Expected revision or next choice after live formative activity evaluation."
    );
    assertStudentVisibleTextIsSafe(activity.state);

    if (activity.state.assessment_state === "REVISION") {
      const revision = await submitRevisionResponse({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        message:
          "Theta is about the student on the latent trait scale; item difficulty is about the item.",
        client_message_id: `${prefix}_revision`
      });
      assert(revision.state.assessment_state === "NEXT_CHOICE", "Expected next choice after revision.");
    }

    const choice = await submitNextChoice({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      choice: "move_next",
      client_action_id: `${prefix}_next_choice_a`
    });
    assert(choice.state.assessment_state === "SESSION_COMPLETE", "Expected session completion.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const auditCalls = await prisma.agentCall.findMany({
      where: {
        assessment_session_db_id: session.id,
        OR: [
          {
            agent_name: "formative_value_and_planning_agent",
            schema_version: "chat-native-formative-profile-output-v1"
          },
          {
            agent_name: "followup_agent",
            schema_version: "chat-native-formative-activity-evaluation-output-v1"
          }
        ]
      },
      orderBy: [{ created_at: "asc" }]
    });
    const auditContext = auditCalls.map((call) => sanitizedAuditSummary(call));
    const profileCall = auditCalls.find(
      (call) =>
        call.agent_name === "formative_value_and_planning_agent" &&
        call.schema_version === "chat-native-formative-profile-output-v1"
    );
    const targetedCall = auditCalls.find(
      (call) =>
        call.agent_name === "followup_agent" &&
        call.schema_version === "chat-native-formative-activity-evaluation-output-v1"
    );
    assert(profileCall, `Missing formative profile agent call.\n${JSON.stringify(auditContext, null, 2)}`);
    assert(targetedCall, `Missing targeted feedback agent call.\n${JSON.stringify(auditContext, null, 2)}`);

    assertLiveAgentCallIsAudited({
      label: "formative profile",
      call: profileCall,
      schema: ChatNativeFormativeProfileOutputSchema,
      audit_context: auditContext
    });
    assertLiveAgentCallIsAudited({
      label: "targeted feedback",
      call: targetedCall,
      schema: ChatNativeTargetedFeedbackOutputSchema,
      audit_context: auditContext
    });

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assertStudentVisibleTextIsSafe(transcript);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          message: "Opt-in live LLM smoke completed. This script is not run by default.",
          readiness,
          session_public_id: started.session.session_public_id,
          profile_call_status: profileCall.call_status,
          profile_output_validated: profileCall.output_validated,
          targeted_call_status: targetedCall.call_status,
          targeted_output_validated: targetedCall.output_validated
        },
        null,
        2
      )
    );
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
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
