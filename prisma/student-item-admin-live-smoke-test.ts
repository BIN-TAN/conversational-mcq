import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import {
  getStudentSafeTranscript,
  recordReasoning,
  recordSelectedOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  ITEM_ADMINISTRATION_TUTOR_AGENT_NAME,
  ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION,
  ItemAdministrationTutorOutputSchema
} from "../src/lib/services/student-assessment/item-administration-tutor";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";

const envLoadResult = loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

function envPresent(name: string) {
  return typeof process.env[name] === "string" && process.env[name]?.trim().length > 0;
}

function loadedEnvFileNames() {
  return envLoadResult.loadedEnvFiles.map((file) => file.path);
}

function liveItemAdminReadiness() {
  const missing = ["DATABASE_URL", "SESSION_SECRET", "OPENAI_API_KEY"].filter((name) => !envPresent(name));
  const invalid: string[] = [];

  if (envPresent("ITEM_ADMIN_TUTOR_LIVE_ENABLED") && process.env.ITEM_ADMIN_TUTOR_LIVE_ENABLED !== "true") {
    invalid.push("ITEM_ADMIN_TUTOR_LIVE_ENABLED");
  }

  if (envPresent("LLM_PROVIDER") && process.env.LLM_PROVIDER !== "openai") {
    invalid.push("LLM_PROVIDER");
  }

  if (envPresent("LLM_LIVE_CALLS_ENABLED") && process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
    invalid.push("LLM_LIVE_CALLS_ENABLED");
  }

  if (!envPresent("OPENAI_MODEL_ITEM_ADMIN") && !envPresent("OPENAI_MODEL_FOLLOWUP")) {
    missing.push("OPENAI_MODEL_ITEM_ADMIN_or_OPENAI_MODEL_FOLLOWUP");
  }

  return {
    ready:
      missing.length === 0 &&
      invalid.length === 0 &&
      process.env.ITEM_ADMIN_TUTOR_LIVE_ENABLED === "true" &&
      process.env.LLM_PROVIDER === "openai" &&
      process.env.LLM_LIVE_CALLS_ENABLED === "true",
    missing_variables: missing,
    invalid_variables: invalid,
    env_files_loaded: loadedEnvFileNames()
  };
}

async function latestItemAdminCall(sessionPublicId: string, expectedClassification: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });
  const calls = await prisma.agentCall.findMany({
    where: {
      assessment_session_db_id: session.id,
      agent_name: ITEM_ADMINISTRATION_TUTOR_AGENT_NAME
    },
    orderBy: [{ created_at: "desc" }],
    take: 5,
    select: {
      id: true,
      agent_name: true,
      model_name: true,
      provider: true,
      provider_request_id: true,
      provider_response_id: true,
      prompt_version: true,
      schema_version: true,
      output_payload: true,
      output_validated: true,
      validation_error: true,
      call_status: true,
      live_call_allowed: true,
      token_usage: true,
      created_at: true,
      completed_at: true
    }
  });
  const call = calls.find((entry) => {
    const parsed = ItemAdministrationTutorOutputSchema.safeParse(entry.output_payload);
    return parsed.success && parsed.data.message_classification === expectedClassification;
  });

  assert(call, `Expected audited item-admin call with classification ${expectedClassification}.`);
  const output = ItemAdministrationTutorOutputSchema.parse(call.output_payload);

  assert(call.agent_name === ITEM_ADMINISTRATION_TUTOR_AGENT_NAME, "Item admin call should use tutor agent name.");
  assert(call.provider === "openai", "Item admin live smoke should audit OpenAI provider.");
  assert(call.live_call_allowed === true, "Item admin call should store live_call_allowed=true.");
  assert(call.call_status === "succeeded", `Item admin call should succeed, got ${call.call_status}.`);
  assert(call.output_validated === true, "Item admin output should be validated.");
  assert(!call.validation_error, "Validated item admin output should not store validation_error.");
  assert(call.schema_version === ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION, "Item admin schema version mismatch.");
  assert(
    Boolean(call.provider_request_id || call.provider_response_id),
    "Item admin live call should store provider request/response metadata."
  );
  assert(call.completed_at, "Item admin call should store completed_at.");

  return {
    id: call.id,
    output,
    provider_metadata_present: Boolean(call.provider_request_id || call.provider_response_id),
    token_usage_present: Boolean(call.token_usage)
  };
}

async function main() {
  if (process.env.RUN_LIVE_ITEM_ADMIN_SMOKE !== "1") {
    console.log(
      JSON.stringify(
        {
          status: "skipped",
          diagnostic_category: "live_item_admin_smoke_intentionally_skipped",
          env_files_loaded: loadedEnvFileNames(),
          reason:
            "RUN_LIVE_ITEM_ADMIN_SMOKE is not 1. No OpenAI call was made. Set it explicitly to run this paid item-admin smoke."
        },
        null,
        2
      )
    );
    return;
  }

  const readiness = liveItemAdminReadiness();

  if (!readiness.ready) {
    console.log(
      JSON.stringify(
        {
          status: "not_ready",
          message:
            "RUN_LIVE_ITEM_ADMIN_SMOKE=1 was set, but required live item-admin configuration is missing or invalid. No OpenAI call was made.",
          readiness
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase19_item_admin_live_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
    const item = state.current_item;
    assert(item, "Expected first item for live item-admin smoke.");
    const selectedOption = item.options[0]?.label;
    assert(selectedOption, "Expected selectable first option.");

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          selected_option: selectedOption,
          client_action_id: `${prefix}_answer`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Answer should advance to reasoning.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          reasoning_text: "What is theta?",
          client_action_id: `${prefix}_content_question`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Content question should not advance to confidence.");
    const contentCall = await latestItemAdminCall(started.session.session_public_id, "content_question");
    assert(contentCall.output.should_advance === false, "Content-question output must not advance.");
    assert(
      /after the three-question set/i.test(contentCall.output.student_facing_message),
      "Content-question output should defer explanation."
    );

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          reasoning_text: "I don't know the reason yet.",
          client_action_id: `${prefix}_unknown_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_CONFIDENCE", "Explicit uncertainty should advance to confidence.");
    const unknownCall = await latestItemAdminCall(started.session.session_public_id, "insufficient_knowledge");
    assert(unknownCall.output.response_quality === "low_information", "Unknown reason should be low-information evidence.");
    assert(unknownCall.output.should_advance === true, "Unknown reason should advance.");

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assertStudentVisibleTextIsSafe(state);
    assertStudentVisibleTextIsSafe(transcript);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          session_public_id: started.session.session_public_id,
          content_question_call_id: contentCall.id,
          insufficient_knowledge_call_id: unknownCall.id,
          provider_metadata_present:
            contentCall.provider_metadata_present && unknownCall.provider_metadata_present,
          token_usage_present: contentCall.token_usage_present || unknownCall.token_usage_present,
          no_answer_key_or_correctness_exposed: true
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
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
