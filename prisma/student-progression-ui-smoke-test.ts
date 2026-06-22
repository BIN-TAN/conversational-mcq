import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildStudentConversationFrame } from "../src/lib/student-assessment-ui/presenter";
import {
  chooseStudentConceptProgression,
  requestStudentConceptProgression
} from "../src/lib/services/concept-progression/progression";
import { getStudentSessionState } from "../src/lib/services/student-assessment/service";
import {
  assert,
  assertNoStudentProfileOrPlanningLabels,
  cleanupFollowupSmoke
} from "./followup-smoke-fixture";
import {
  createReadyFollowupFixture,
  setPhase6D3SmokeEnv
} from "./concept-progression-smoke-helpers";

const prisma = new PrismaClient();
const prefix = `phase6d3_ui_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function main() {
  setPhase6D3SmokeEnv();
  await cleanupFollowupSmoke(prisma, prefix);

  try {
    const fixture = await createReadyFollowupFixture({
      prisma,
      prefix,
      suffix: "ui_state",
      extra_concept_count: 1
    });
    const initialState = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });

    assert(initialState.next_step === "followup_active", "UI fixture should start in active follow-up.");
    assert(initialState.progression?.available, "Progression request control should be available during follow-up.");
    assert(initialState.progression.progression_public_id === null, "No progression ID should exist before request.");
    assert(initialState.progression.allowed_choices.includes("request_progression"), "Student state should allow progression request.");
    assertNoStudentProfileOrPlanningLabels(initialState, "Initial progression UI state");

    const initialFrame = buildStudentConversationFrame(initialState);
    assert(initialFrame.interaction_type === "followup_active", "Presenter should keep ChatGPT-style follow-up active.");
    assert(
      initialFrame.allowed_actions.includes("request_progression"),
      "Presenter should expose progression request action."
    );

    const request = await requestStudentConceptProgression({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      data: { client_action_id: `${prefix}_ui_request` }
    });
    assert(request.progression?.progression_public_id, "Request should return progression public ID.");
    assert(
      request.progression.allowed_choices.includes("next_concept"),
      "Non-final concept should offer next concept choice after request."
    );
    assertNoStudentProfileOrPlanningLabels(request, "Progression request UI response");

    await chooseStudentConceptProgression({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      progression_public_id: request.progression.progression_public_id,
      data: {
        choice: "continue_current_concept",
        client_action_id: `${prefix}_ui_continue`
      }
    });
    const continuedState = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(continuedState.next_step === "followup_active", "Continue choice should keep follow-up active.");
    assert(!continuedState.progression?.progression_public_id, "Cancelled progression should not remain active.");
    assertNoStudentProfileOrPlanningLabels(continuedState, "Continued progression UI state");

    await cleanupFollowupSmoke(prisma, prefix);
    console.log("student progression UI smoke passed");
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
