import { PrismaClient } from "@prisma/client";
import { sendInitialAdministrationMessage } from "../src/lib/agents/response-collection/service";
import { buildStudentConversationFrame } from "../src/lib/student-assessment-ui/presenter";
import { getStudentSafeTranscript } from "../src/lib/services/student-assessment/service";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
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

function assertNoStudentLeak(value: unknown) {
  assertStudentPayloadIsSafe(value);
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "correct_option",
    "correctness",
    "distractor_rationales",
    "expected_reasoning_patterns",
    "possible_misconception_indicators",
    "ability_profile",
    "engagement_profile",
    "integrated_diagnostic_profile",
    "formative_value",
    "agent_call",
    "prompt_hash",
    "model_name"
  ];

  for (const key of forbidden) {
    assert(!serialized.includes(key), `Student initial-chat payload leaked ${key}.`);
  }
}

async function main() {
  const prefix = `phase7c_initial_chat_ui_${Date.now()}`;
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
    const result = await sendInitialAdministrationMessage({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      data: {
        message: "I think the quantities are paired because each value has a match.",
        client_message_id: `${prefix}_chat`
      }
    });

    assertNoStudentLeak(result);
    assert(result.state.initial_chat.message_max_chars > 0, "Initial chat bounds missing.");
    assert(result.state.current_item, "Current item should remain visible.");
    const frame = buildStudentConversationFrame(result.state);
    assert(
      ["request_confidence", "request_reasoning", "present_item"].includes(frame.interaction_type),
      "Initial chat should not advance orchestration beyond backend state."
    );

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assertNoStudentLeak(transcript);
    assert(
      transcript.transcript.some((turn) => turn.actor === "student"),
      "Student transcript should show student free-text message."
    );
    assert(
      transcript.transcript.some((turn) => turn.actor === "assistant"),
      "Student transcript should show assistant/fallback message."
    );

    console.log("Student initial chat UI smoke test passed. No OpenAI call was made.");
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

