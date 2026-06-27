import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { resolveAgentModelConfig, getLlmRuntimeConfig } from "../src/lib/llm/config";
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

const prisma = new PrismaClient();

function assertLiveAgentCallIsAudited(input: {
  label: string;
  call: {
    provider: string;
    model_name: string;
    live_call_allowed: boolean;
    output_payload: unknown;
    output_validated: boolean;
    validation_error: string | null;
    call_status: string;
    provider_request_id: string | null;
    provider_response_id: string | null;
    prompt_version: string;
    schema_version: string;
  };
  schema: typeof ChatNativeFormativeProfileOutputSchema | typeof ChatNativeTargetedFeedbackOutputSchema;
}) {
  assert(input.call.provider === "openai", `${input.label}: expected OpenAI provider audit.`);
  assert(input.call.live_call_allowed === true, `${input.label}: live_call_allowed was not stored.`);
  assert(input.call.model_name.trim().length > 0, `${input.label}: model name was not stored.`);
  assert(input.call.prompt_version.trim().length > 0, `${input.label}: prompt version was not stored.`);
  assert(input.call.schema_version.trim().length > 0, `${input.label}: schema version was not stored.`);
  assert(
    Boolean(input.call.provider_request_id || input.call.provider_response_id),
    `${input.label}: provider request/response ID metadata was not stored.`
  );
  assert(
    input.schema.safeParse(input.call.output_payload).success,
    `${input.label}: stored output payload is not schema-shaped, including fallback output if used.`
  );

  if (input.call.output_validated) {
    assert(input.call.call_status === "succeeded", `${input.label}: validated output should be succeeded.`);
    assert(!input.call.validation_error, `${input.label}: validated output should not have validation_error.`);
  } else {
    assert(
      Boolean(input.call.validation_error),
      `${input.label}: unsafe or invalid output should store a validation error before fallback.`
    );
    assert(
      input.call.call_status === "invalid_output" || input.call.call_status === "failed",
      `${input.label}: invalid or unsafe output should not be audited as succeeded.`
    );
  }
}

function requireLiveSmokeConfiguration() {
  const runtime = getLlmRuntimeConfig();
  assert(runtime.provider === "openai", "RUN_LIVE_LLM_SMOKE=1 requires LLM_PROVIDER=openai.");
  assert(runtime.live_calls_enabled, "RUN_LIVE_LLM_SMOKE=1 requires LLM_LIVE_CALLS_ENABLED=true.");
  assert(runtime.openai_key_configured, "RUN_LIVE_LLM_SMOKE=1 requires OPENAI_API_KEY.");
  const profileModel = resolveAgentModelConfig("formative_value_and_planning_agent");
  const feedbackModel = resolveAgentModelConfig("followup_agent");

  return {
    provider: runtime.provider,
    live_calls_enabled: runtime.live_calls_enabled,
    profile_model_configured: Boolean(profileModel.model_name),
    feedback_model_configured: Boolean(feedbackModel.model_name)
  };
}

async function main() {
  if (process.env.RUN_LIVE_LLM_SMOKE !== "1") {
    console.log(
      JSON.stringify(
        {
          status: "skipped",
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
  const readiness = requireLiveSmokeConfiguration();

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
    assert(activity.state.assessment_state === "REVISION", "Expected revision after live targeted feedback.");
    assertStudentVisibleTextIsSafe(activity.state);

    const revision = await submitRevisionResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message:
        "Theta is about the student on the latent trait scale; item difficulty is about the item.",
      client_message_id: `${prefix}_revision`
    });
    assert(revision.state.assessment_state === "NEXT_CHOICE", "Expected next choice after revision.");

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
    const profileCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "formative_value_and_planning_agent",
        schema_version: "chat-native-formative-profile-output-v1"
      }
    });
    const targetedCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "followup_agent",
        schema_version: "chat-native-targeted-feedback-output-v1"
      }
    });

    assertLiveAgentCallIsAudited({
      label: "formative profile",
      call: profileCall,
      schema: ChatNativeFormativeProfileOutputSchema
    });
    assertLiveAgentCallIsAudited({
      label: "targeted feedback",
      call: targetedCall,
      schema: ChatNativeTargetedFeedbackOutputSchema
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
