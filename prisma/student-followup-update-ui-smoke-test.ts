import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { startFollowupRoundForTeacher, submitStudentFollowupMessage } from "../src/lib/agents/followup/service";
import { getStudentSessionState } from "../src/lib/services/student-assessment/service";
import { buildStudentConversationFrame } from "../src/lib/student-assessment-ui/presenter";
import {
  assert,
  assertNoStudentProfileOrPlanningLabels,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `phase6d2b_update_ui_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function main() {
  setFollowupSmokeEnv({
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    LLM_DAILY_STUDENT_CALL_LIMIT: "100",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "100000",
    LLM_DAILY_CLASS_CALL_LIMIT: "100",
    LLM_DAILY_CLASS_TOKEN_LIMIT: "100000",
    LLM_SESSION_CALL_LIMIT: "100",
    LLM_SESSION_TOKEN_LIMIT: "100000",
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "50",
    LLM_USAGE_TIMEZONE: "UTC",
    FOLLOWUP_CONTEXT_MAX_TURNS: "8",
    FOLLOWUP_MESSAGE_MAX_CHARS: "1000",
    FOLLOWUP_CONTEXT_MAX_CHARS: "8000",
    FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE: "3",
    OPERATIONAL_AGENT_MODE: "mock"
  });
  await cleanupFollowupSmoke(prisma, prefix);

  try {
    const fixture = await createFollowupSmokeFixture(prisma, {
      prefix,
      suffix: "ui",
      withProfile: true,
      withPlanning: true
    });
    await prisma.assessmentSession.update({
      where: { id: fixture.session.id },
      data: { workflow_mode_snapshot: "automatic" }
    });
    await startFollowupRoundForTeacher({
      session_public_id: fixture.session.session_public_id,
      concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
      requested_by_user_db_id: fixture.teacher.id
    });
    await submitStudentFollowupMessage({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      message: "I revised my explanation and can connect it to the concept evidence.",
      client_message_id: `${prefix}_ui_message`,
      mock_provider_mode: "followup_evidence_trigger"
    });

    const state = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(state.next_step === "followup_updating", "Student state should expose neutral followup_updating step.");
    assert(state.followup?.can_send === false, "Student composer should be disabled during update.");
    assert(state.followup?.can_stop === true, "Student should be able to request stop during update.");
    assertNoStudentProfileOrPlanningLabels(state, "Student updating state");

    const frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "followup_updating", "Presenter should render followup_updating frame.");
    assert(frame.allowed_actions.includes("stop_followup"), "Updating frame should keep stop_followup available.");
    assert(!frame.can_continue, "Updating frame should not allow continuing conversation.");
    assertNoStudentProfileOrPlanningLabels(frame, "Student updating frame");

    await cleanupFollowupSmoke(prisma, prefix);
    console.log("student follow-up update UI smoke passed");
  } catch (error) {
    await cleanupFollowupSmoke(prisma, prefix).catch(() => null);
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
