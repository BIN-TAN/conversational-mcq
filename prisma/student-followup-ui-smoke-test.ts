import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  startFollowupRoundForTeacher,
  stopStudentFollowup,
  submitStudentFollowupMessage
} from "../src/lib/agents/followup/service";
import {
  getStudentReviewResponses,
  getStudentSafeTranscript,
  getStudentSessionState
} from "../src/lib/services/student-assessment/service";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import { buildStudentConversationFrame } from "../src/lib/student-assessment-ui/presenter";
import {
  assert,
  assertNoStudentProfileOrPlanningLabels,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  followupSmokeEnvKeys,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";

const prisma = new PrismaClient();

async function main() {
  const prefix = `phase6d1_followup_ui_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const originalEnv = Object.fromEntries(followupSmokeEnvKeys.map((key) => [key, process.env[key]]));

  try {
    setFollowupSmokeEnv({
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: "",
      LLM_USAGE_TIMEZONE: "UTC",
      FOLLOWUP_CONTEXT_MAX_TURNS: "4",
      FOLLOWUP_MESSAGE_MAX_CHARS: "600",
      FOLLOWUP_CONTEXT_MAX_CHARS: "4000"
    });

    const fixture = await createFollowupSmokeFixture(prisma, {
      prefix,
      suffix: "ui",
      withProfile: true,
      withPlanning: true
    });

    const start = await startFollowupRoundForTeacher({
      session_public_id: fixture.session.session_public_id,
      concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
      requested_by_user_db_id: fixture.teacher.id,
      mock_provider_mode: "followup_opening"
    });
    assert(start.status === "followup_started", "Teacher start should create an active follow-up round.");

    let state = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(state.next_step === "followup_active", "Student state should enter followup_active.");
    assert(state.followup?.can_send, "Student follow-up controls should allow sending.");
    assert(state.followup.can_stop, "Student follow-up controls should allow stopping.");
    assert(state.followup.can_save_exit, "Student follow-up controls should allow save and exit.");
    assert(state.followup.message_max_chars === 600, "Student UI should receive message limit.");
    assertStudentPayloadIsSafe(state);
    assertNoStudentProfileOrPlanningLabels(state, "Student follow-up UI state");

    let frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "followup_active", "Presenter should render followup_active frame.");
    assert(
      frame.assistant_message.includes("Continue the follow-up conversation"),
      "Presenter should show neutral follow-up conversation text."
    );
    assertNoStudentProfileOrPlanningLabels(frame, "Student follow-up frame");

    const transcriptBefore = await getStudentSafeTranscript({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(
      transcriptBefore.transcript.some((turn) => turn.actor === "assistant"),
      "Student transcript should include the assistant opening."
    );
    assertNoStudentProfileOrPlanningLabels(transcriptBefore, "Student follow-up transcript before reply");

    const messageResult = await submitStudentFollowupMessage({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      message: "ok",
      client_message_id: "ui_message_1",
      mock_provider_mode: "followup_diagnostic_clarification"
    });
    assert(messageResult.message_status === "assistant_replied", "Student message should receive assistant reply.");
    assertNoStudentProfileOrPlanningLabels(messageResult, "Student follow-up message response");

    const review = await getStudentReviewResponses({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(review.locked, "Initial responses should remain locked during follow-up.");
    assertNoStudentProfileOrPlanningLabels(review, "Student review during follow-up");

    const transcriptAfter = await getStudentSafeTranscript({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(
      transcriptAfter.transcript.some((turn) => turn.actor === "student"),
      "Student transcript should include the student follow-up reply."
    );
    assert(
      transcriptAfter.transcript.some((turn) => turn.actor === "assistant"),
      "Student transcript should include the assistant follow-up reply."
    );
    assertNoStudentProfileOrPlanningLabels(transcriptAfter, "Student follow-up transcript after reply");

    const stopped = await stopStudentFollowup({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(stopped.current_phase === "followup_stopped", "Student stop should return stopped phase.");
    assert(stopped.followup?.can_send === false, "Stopped follow-up should disable sending.");
    assertNoStudentProfileOrPlanningLabels(stopped, "Student stopped follow-up state");

    state = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "followup_stopped", "Presenter should render stopped follow-up frame.");
    assert(
      frame.assistant_message.includes("follow-up round has been stopped"),
      "Presenter should show neutral stopped follow-up text."
    );
    assertNoStudentProfileOrPlanningLabels(frame, "Student stopped follow-up frame");

    console.log("Student follow-up UI smoke test passed. Mock provider only; no OpenAI network call was made.");
  } finally {
    setFollowupSmokeEnv(originalEnv);
    await cleanupFollowupSmoke(prisma, prefix);
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
