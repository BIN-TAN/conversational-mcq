import { PrismaClient } from "@prisma/client";
import { sendInitialAdministrationMessage } from "../src/lib/agents/response-collection/service";
import { getStudentSessionState, getStudentSafeTranscript } from "../src/lib/services/student-assessment/service";
import {
  cleanupResponseCollectionFixture,
  createResponseCollectionFixture
} from "./response-collection-smoke-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoForbiddenInput(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "password_hash",
    "access_code_hash",
    "correct_option",
    "distractor_rationales",
    "expected_reasoning_patterns",
    "possible_misconception_indicators",
    "session_secret",
    "openai_api_key",
    "database_url"
  ];

  for (const key of forbidden) {
    assert(!serialized.includes(key), `Response collection input leaked ${key}.`);
  }
}

async function main() {
  const prefix = `phase7c_agent_smoke_${Date.now()}`;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW = "true";
  process.env.OPERATIONAL_AGENT_MODE = "mock";
  process.env.OPERATIONAL_AGENT_INTEGRATION_ENABLED = "true";
  process.env.OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED = "false";
  await cleanupResponseCollectionFixture(prisma, prefix);

  const beforeProfiles = await prisma.studentProfile.count();
  const beforeDecisions = await prisma.formativeDecision.count();
  const beforeFollowups = await prisma.followupRound.count();

  try {
    const fixture = await createResponseCollectionFixture({
      prisma,
      prefix,
      responseCollectionMode: "llm_assisted"
    });
    const message =
      "I choose C because the prompt mentions both quantities changing together.";

    const result = await sendInitialAdministrationMessage({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      data: {
        message,
        client_message_id: `${prefix}_message_1`
      }
    });

    assert(result.message_status === "assistant_replied", "Mock agent path should reply as assistant.");
    assert(result.reasoning_saved, "Reasoning should be saved from the exact message segment.");
    assert(result.state.current_item?.existing_reasoning_text === message, "Saved reasoning mismatch.");
    assert(
      result.state.current_item.existing_selected_option === null,
      "Natural-language option text must not set selected_option."
    );
    assert(
      result.state.current_item.existing_confidence_rating === null,
      "Natural-language confidence text must not set confidence."
    );

    const itemResponse = await prisma.itemResponse.findFirstOrThrow({
      where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
    });
    assert(itemResponse.reasoning_text === message, "Item response reasoning was not persisted.");
    assert(itemResponse.selected_option === null, "Option should remain unset.");
    assert(itemResponse.confidence_rating === null, "Confidence should remain unset.");

    const agentCalls = await prisma.agentCall.findMany({
      where: {
        assessment_session_db_id: fixture.session.id,
        agent_name: "response_collection_agent"
      }
    });
    assert(agentCalls.length === 1, "Exactly one response collection agent call should be audited.");
    assert(agentCalls[0].provider === "mock", "Smoke test should use mock provider.");
    assert(agentCalls[0].output_validated, "Mock output should validate.");
    assert(agentCalls[0].call_status === "succeeded", "Agent call should succeed.");
    assertNoForbiddenInput(agentCalls[0].input_payload);

    const events = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: fixture.session.id },
      select: { event_type: true }
    });
    const eventTypes = events.map((event) => event.event_type);
    assert(eventTypes.includes("response_collection_agent_invoked"), "Agent invocation event missing.");
    assert(eventTypes.includes("response_collection_agent_succeeded"), "Agent success event missing.");
    assert(
      eventTypes.includes("response_collection_reasoning_extracted"),
      "Reasoning extraction event missing."
    );
    assert(!eventTypes.includes("response_collection_fallback_used"), "Agent path should not fallback.");

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(
      transcript.transcript.some((turn) => turn.actor === "assistant"),
      "Student-safe transcript should include the response collection assistant turn."
    );

    const beforeRepeatTurns = await prisma.conversationTurn.count({
      where: { assessment_session_db_id: fixture.session.id }
    });
    const repeat = await sendInitialAdministrationMessage({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      data: {
        message,
        client_message_id: `${prefix}_message_1`
      }
    });
    const afterRepeatTurns = await prisma.conversationTurn.count({
      where: { assessment_session_db_id: fixture.session.id }
    });
    const afterRepeatAgentCalls = await prisma.agentCall.count({
      where: {
        assessment_session_db_id: fixture.session.id,
        agent_name: "response_collection_agent"
      }
    });

    assert(repeat.reasoning_saved, "Idempotent replay should return saved reasoning result.");
    assert(beforeRepeatTurns === afterRepeatTurns, "Idempotent replay should not duplicate turns.");
    assert(afterRepeatAgentCalls === 1, "Idempotent replay should not duplicate agent calls.");

    const state = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(state.initial_chat.message_max_chars > 0, "Student state should include initial chat bounds.");
    assert((await prisma.studentProfile.count()) === beforeProfiles, "No student profile should be created.");
    assert((await prisma.formativeDecision.count()) === beforeDecisions, "No formative decision should be created.");
    assert((await prisma.followupRound.count()) === beforeFollowups, "No follow-up round should be created.");

    console.log("Response Collection Agent smoke test passed. No OpenAI call was made.");
  } finally {
    await cleanupResponseCollectionFixture(prisma, prefix);
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
