import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  startFollowupRoundForTeacher,
  submitStudentFollowupMessage
} from "../src/lib/agents/followup/service";
import {
  assert,
  assertNoForbiddenSerializedFields,
  assertNoStudentProfileOrPlanningLabels,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";

const prisma = new PrismaClient();

async function main() {
  const prefix = `student_followup_agent_compat_${Date.now()}_${randomUUID().slice(0, 8)}`;

  setFollowupSmokeEnv({
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    LLM_USAGE_TIMEZONE: "UTC",
    FOLLOWUP_CONTEXT_MAX_TURNS: "4",
    FOLLOWUP_MESSAGE_MAX_CHARS: "600",
    FOLLOWUP_CONTEXT_MAX_CHARS: "4000"
  });

  try {
    const fixture = await createFollowupSmokeFixture(prisma, {
      prefix,
      suffix: "compat"
    });
    const agentCallsBefore = await prisma.agentCall.count({
      where: { provider: "openai" }
    });

    const started = await startFollowupRoundForTeacher({
      session_public_id: fixture.session.session_public_id,
      concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
      requested_by_user_db_id: fixture.teacher.id,
      mock_provider_mode: "followup_opening"
    });
    assert(started.status === "followup_started", "Follow-up round should start.");
    assert(started.round?.status === "active", "Started follow-up round should be active.");
    assert(started.student_state.followup?.can_send, "Student state should allow follow-up messages.");
    assertNoForbiddenSerializedFields(started.round, "follow-up start round");
    assertNoStudentProfileOrPlanningLabels(started.student_state, "follow-up start student state");

    const response = await submitStudentFollowupMessage({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      message: "I think the option needs to connect more directly to the evidence in the item.",
      client_message_id: `${prefix}_message_1`,
      mock_provider_mode: "followup_reasoning_refinement"
    });
    const assistantMessage = response.assistant_message;
    assert(response.message_status === "assistant_replied", "Follow-up agent should reply in mock mode.");
    assert(
      typeof assistantMessage === "string" && assistantMessage.trim().length > 0,
      "Assistant reply should be present."
    );
    assertNoForbiddenSerializedFields(response, "follow-up message response");
    assertNoStudentProfileOrPlanningLabels(response, "follow-up message response");

    const agentCallsAfter = await prisma.agentCall.count({
      where: { provider: "openai" }
    });
    assert(agentCallsAfter === agentCallsBefore, "Compatibility smoke must not create OpenAI calls.");

    console.log(JSON.stringify({
      status: "passed",
      smoke: "student-followup-agent-compat",
      openai_calls_created: 0
    }, null, 2));
  } finally {
    await cleanupFollowupSmoke(prisma, prefix);
    await prisma.$disconnect();
  }
}

void main();
