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

  if (envPresent("ITEM_ADMIN_TUTOR_MODE") && !["auto", "live"].includes(String(process.env.ITEM_ADMIN_TUTOR_MODE))) {
    invalid.push("ITEM_ADMIN_TUTOR_MODE");
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
      process.env.LLM_PROVIDER === "openai" &&
      process.env.LLM_LIVE_CALLS_ENABLED === "true",
    missing_variables: missing,
    invalid_variables: invalid,
    env_files_loaded: loadedEnvFileNames()
  };
}

async function latestItemAdminCall(
  sessionPublicId: string,
  expectedClassification: string,
  expected: {
    response_quality?: string;
    should_advance?: boolean;
    deferred_concern_summary_present?: boolean;
  } = {}
) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true, current_phase: true, status: true }
  });
  const calls = await prisma.agentCall.findMany({
    where: {
      assessment_session_db_id: session.id,
      agent_name: ITEM_ADMINISTRATION_TUTOR_AGENT_NAME
    },
    orderBy: [{ created_at: "desc" }],
    take: 10,
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
      raw_output: true,
      created_at: true,
      completed_at: true
    }
  });
  const processEvents = await prisma.processEvent.findMany({
    where: {
      assessment_session_db_id: session.id,
      OR: [
        { event_category: "response_quality" },
        { event_type: { in: ["reasoning_submitted", "content_question_deferred"] } }
      ]
    },
    orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }],
    take: 20,
    select: {
      event_type: true,
      event_category: true,
      event_source: true,
      payload: true,
      occurred_at: true,
      created_at: true
    }
  });
  const turns = await prisma.conversationTurn.findMany({
    where: {
      assessment_session_db_id: session.id,
      OR: [
        { actor_type: "agent" },
        { actor_type: "student" }
      ]
    },
    orderBy: [{ created_at: "desc" }],
    take: 20,
    select: {
      actor_type: true,
      agent_name: true,
      structured_payload: true,
      created_at: true
    }
  });

  const callSummaries = calls.map((entry) => {
    const parsed = ItemAdministrationTutorOutputSchema.safeParse(entry.output_payload);

    return {
      agent_call_id: entry.id,
      agent_name: entry.agent_name,
      provider: entry.provider,
      model_name: entry.model_name,
      call_status: entry.call_status,
      live_call_allowed: entry.live_call_allowed,
      schema_version: entry.schema_version,
      output_payload_schema_shaped: parsed.success,
      message_classification: parsed.success ? parsed.data.message_classification : null,
      response_quality: parsed.success ? parsed.data.response_quality : null,
      should_advance: parsed.success ? parsed.data.should_advance : null,
      deferred_concern_summary_present: parsed.success ? Boolean(parsed.data.deferred_concern_summary) : null,
      output_validated: entry.output_validated,
      validation_error_present: Boolean(entry.validation_error),
      validation_error_summary: entry.validation_error
        ? entry.validation_error.split("; ").slice(0, 8)
        : [],
      provider_request_id_present: Boolean(entry.provider_request_id),
      provider_response_id_present: Boolean(entry.provider_response_id),
      token_usage_present: Boolean(entry.token_usage),
      raw_output_present: entry.raw_output !== null && entry.raw_output !== undefined,
      created_at: entry.created_at.toISOString(),
      completed_at: entry.completed_at?.toISOString() ?? null
    };
  });

  function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  function itemAdminPayload(value: unknown) {
    const payload = record(value);
    const nested = record(payload?.item_administration_tutor);

    return {
      message_classification:
        typeof nested?.message_classification === "string"
          ? nested.message_classification
          : typeof payload?.message_classification === "string"
            ? payload.message_classification
            : null,
      response_quality:
        typeof nested?.response_quality === "string"
          ? nested.response_quality
          : typeof payload?.response_quality === "string"
            ? payload.response_quality
            : null,
      should_advance:
        typeof nested?.should_advance === "boolean"
          ? nested.should_advance
          : null,
      deferred_concern_summary_present:
        Boolean(nested?.deferred_concern_summary ?? payload?.deferred_concern_summary),
      agent_call_id:
        typeof nested?.agent_call_id === "string"
          ? nested.agent_call_id
          : typeof payload?.item_admin_agent_call_id === "string"
            ? payload.item_admin_agent_call_id
            : null,
      live_status:
        typeof nested?.live_status === "string"
          ? nested.live_status
          : typeof payload?.item_admin_live_status === "string"
            ? payload.item_admin_live_status
            : null,
      item_admin_tutor_source:
        typeof nested?.item_admin_tutor_source === "string"
          ? nested.item_admin_tutor_source
          : typeof payload?.item_admin_tutor_source === "string"
            ? payload.item_admin_tutor_source
            : null
    };
  }

  const processEventSummaries = processEvents.map((event) => ({
    event_type: event.event_type,
    event_category: event.event_category,
    event_source: event.event_source,
    ...itemAdminPayload(event.payload),
    occurred_at: event.occurred_at.toISOString(),
    created_at: event.created_at.toISOString()
  }));

  const turnSummaries = turns.map((turn) => ({
    actor_type: turn.actor_type,
    agent_name: turn.agent_name,
    ...itemAdminPayload(turn.structured_payload),
    created_at: turn.created_at.toISOString()
  }));

  const diagnostics = {
    session_public_id: sessionPublicId,
    session_status: session.status,
    current_phase: session.current_phase,
    expected_classification: expectedClassification,
    tutor_mode: process.env.ITEM_ADMIN_TUTOR_MODE ?? null,
    provider: process.env.LLM_PROVIDER ?? null,
    live_calls_enabled: process.env.LLM_LIVE_CALLS_ENABLED === "true",
    item_admin_agent_call_count: calls.length,
    agent_calls: callSummaries,
    process_events: processEventSummaries,
    conversation_turns: turnSummaries
  };

  const call = calls.find((entry) => {
    const parsed = ItemAdministrationTutorOutputSchema.safeParse(entry.output_payload);
    return parsed.success && parsed.data.message_classification === expectedClassification;
  });

  assert(
    call,
    `Expected audited item-admin call with classification ${expectedClassification}.\n${JSON.stringify(diagnostics, null, 2)}`
  );
  const output = ItemAdministrationTutorOutputSchema.parse(call.output_payload);
  const matchingProcessEvidence = processEventSummaries.filter(
    (event) => event.agent_call_id === call.id || event.message_classification === expectedClassification
  );

  assert(call.agent_name === ITEM_ADMINISTRATION_TUTOR_AGENT_NAME, "Item admin call should use tutor agent name.");
  assert(call.provider === "openai", "Item admin live smoke should audit OpenAI provider.");
  assert(call.live_call_allowed === true, "Item admin call should store live_call_allowed=true.");
  assert(call.schema_version === ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION, "Item admin schema version mismatch.");
  assert(call.completed_at, "Item admin call should store completed_at.");
  assert(
    call.call_status === "succeeded",
    `Item admin live smoke requires a validated live provider output; fallback cannot satisfy success.\n${JSON.stringify(diagnostics, null, 2)}`
  );
  assert(call.output_validated === true, "Item admin output should be validated.");
  assert(!call.validation_error, "Validated item admin output should not store validation_error.");
  assert(
    matchingProcessEvidence.some(
      (entry) => entry.agent_call_id === call.id && entry.item_admin_tutor_source === "live_llm"
    ),
    `Validated live item-admin turn should store process-event evidence with live_llm tutor source.\n${JSON.stringify(diagnostics, null, 2)}`
  );
  if (expected.response_quality) {
    assert(
      output.response_quality === expected.response_quality,
      `Expected response_quality ${expected.response_quality}, got ${output.response_quality}.\n${JSON.stringify(diagnostics, null, 2)}`
    );
  }
  if (typeof expected.should_advance === "boolean") {
    assert(
      output.should_advance === expected.should_advance,
      `Expected should_advance ${expected.should_advance}, got ${output.should_advance}.\n${JSON.stringify(diagnostics, null, 2)}`
    );
  }
  if (typeof expected.deferred_concern_summary_present === "boolean") {
    assert(
      Boolean(output.deferred_concern_summary) === expected.deferred_concern_summary_present,
      `Deferred concern presence mismatch.\n${JSON.stringify(diagnostics, null, 2)}`
    );
  }

  assert(
    Boolean(call.provider_request_id || call.provider_response_id),
    `Item admin live call should store provider request/response metadata.\n${JSON.stringify(diagnostics, null, 2)}`
  );

  return {
    id: call.id,
    output,
    provider_metadata_present: Boolean(call.provider_request_id || call.provider_response_id),
    token_usage_present: Boolean(call.token_usage),
    call_status: call.call_status,
    output_validated: call.output_validated,
    item_admin_tutor_source: "live_llm"
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
    const contentCall = await latestItemAdminCall(started.session.session_public_id, "content_question", {
      response_quality: "not_usable",
      should_advance: false,
      deferred_concern_summary_present: true
    });
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
    const unknownCall = await latestItemAdminCall(started.session.session_public_id, "insufficient_knowledge", {
      response_quality: "low_information",
      should_advance: true
    });
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
          content_question_tutor_source: contentCall.item_admin_tutor_source,
          insufficient_knowledge_tutor_source: unknownCall.item_admin_tutor_source,
          content_question_call_status: contentCall.call_status,
          insufficient_knowledge_call_status: unknownCall.call_status,
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
