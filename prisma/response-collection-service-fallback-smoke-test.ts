import { PrismaClient } from "@prisma/client";
import { sendInitialAdministrationMessage } from "../src/lib/agents/response-collection/service";
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

async function main() {
  const prefix = `phase7c_fallback_smoke_${Date.now()}`;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW = "false";
  await cleanupResponseCollectionFixture(prisma, prefix);

  try {
    const fixture = await createResponseCollectionFixture({
      prisma,
      prefix,
      responseCollectionMode: "llm_assisted"
    });
    const message =
      "I think it depends on the paired quantities because they change together. Can you tell me if that is correct?";

    const result = await sendInitialAdministrationMessage({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      data: {
        message,
        client_message_id: `${prefix}_fallback_message`
      }
    });

    assert(result.message_status === "fallback_replied", "Mock-disabled student workflow should use fallback.");
    assert(result.reasoning_saved, "Fallback should preserve valid mixed-message reasoning.");
    assert(
      result.assistant_message.includes("can't provide hints"),
      "Fallback should refuse answer help neutrally."
    );

    const agentCallCount = await prisma.agentCall.count({
      where: {
        assessment_session_db_id: fixture.session.id,
        agent_name: "response_collection_agent"
      }
    });
    assert(agentCallCount === 0, "Fallback should not create fake agent-call metadata.");

    const response = await prisma.itemResponse.findFirstOrThrow({
      where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
    });
    assert(
      response.reasoning_text ===
        "I think it depends on the paired quantities because they change together.",
      "Fallback should save only the exact reasoning segment before the help request."
    );
    assert(response.selected_option === null, "Fallback should not set option from text.");
    assert(response.confidence_rating === null, "Fallback should not set confidence from text.");

    const events = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: fixture.session.id },
      select: { event_type: true }
    });
    const eventTypes = events.map((event) => event.event_type);
    assert(eventTypes.includes("response_collection_fallback_used"), "Fallback event missing.");
    assert(eventTypes.includes("invalid_help_request"), "Invalid help request event missing.");
    assert(
      eventTypes.includes("response_collection_reasoning_extracted"),
      "Reasoning extraction event missing."
    );

    console.log("Response collection service fallback smoke test passed. No OpenAI call was made.");
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

