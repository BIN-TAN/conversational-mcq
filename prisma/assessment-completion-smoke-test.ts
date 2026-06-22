import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
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
  assertNoOpenAiCalls,
  createReadyFollowupFixture,
  setPhase6D3SmokeEnv
} from "./concept-progression-smoke-helpers";

const prisma = new PrismaClient();
const prefix = `phase6d3_completion_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function finalConceptCompletion() {
  const fixture = await createReadyFollowupFixture({
    prisma,
    prefix,
    suffix: "final_concept",
    extra_concept_count: 0
  });
  const request = await requestStudentConceptProgression({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    data: { client_action_id: `${prefix}_request_complete` }
  });
  const progressionPublicId = request.progression?.progression_public_id;

  assert(progressionPublicId, "Completion request should produce a progression public ID.");
  assert(request.progression?.is_final_concept, "Completion request should identify final concept.");

  const choice = await chooseStudentConceptProgression({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    progression_public_id: progressionPublicId,
    data: {
      choice: "complete_assessment",
      client_action_id: `${prefix}_choice_complete`
    }
  });
  assert(choice.choice_status === "assessment_completed", "Final concept choice should complete assessment.");

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: fixture.session.id }
  });
  assert(session.status === "completed", "Assessment session status should be completed.");
  assert(session.current_phase === "session_completed", "Assessment phase should be session_completed.");
  assert(session.completed_at, "Completed session should have completed_at timestamp.");

  const state = await getStudentSessionState({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id
  });
  assert(state.next_step === "session_completed", "Student state should show session_completed.");
  assertNoStudentProfileOrPlanningLabels(state, "Student completed state");

  const completionEvents = await prisma.processEvent.count({
    where: {
      assessment_session_db_id: fixture.session.id,
      event_type: "assessment_completed"
    }
  });
  assert(completionEvents >= 1, "Assessment completion event should be logged.");
  await assertNoOpenAiCalls(prisma, fixture.session.id);
}

async function main() {
  setPhase6D3SmokeEnv();
  await cleanupFollowupSmoke(prisma, prefix);

  try {
    await finalConceptCompletion();
    await cleanupFollowupSmoke(prisma, prefix);
    console.log("assessment completion smoke passed");
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
