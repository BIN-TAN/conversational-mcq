import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  completeInitialConceptUnitAdministration,
  listAvailableAssessments,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse,
  submitNextChoice,
  submitRevisionResponse
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import {
  demoAssessmentPublicId,
  demoItemPublicIds,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import { resetStudentDemoFixedMvpAttempt } from "./demo-reset-student-mvp-helper";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

async function fixedMvpAvailability(studentDbId: string) {
  const availability = await listAvailableAssessments({ student_user_db_id: studentDbId });
  assertStudentPayloadIsSafe(availability);
  assertStudentVisibleTextIsSafe(availability);
  const row = availability.assessments.find(
    (assessment) => assessment.assessment_public_id === demoAssessmentPublicId
  );
  assert(row, "Fixed IRT MVP assessment should be visible on the student dashboard.");
  return row;
}

async function assertStartBlockedAfterCompletion(studentDbId: string) {
  try {
    await startOrResumeStudentAssessmentSession({
      student_user_db_id: studentDbId,
      assessment_public_id: demoAssessmentPublicId
    });
  } catch (error) {
    assert(
      error instanceof StudentAssessmentServiceError && error.code === "assessment_already_completed",
      "Completed fixed MVP attempt should block a second ordinary start."
    );
    return;
  }

  throw new Error("Completed fixed MVP attempt unexpectedly allowed a second ordinary start.");
}

async function completeFixedMvpOnce(input: {
  studentDbId: string;
  prefix: string;
}) {
  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: input.studentDbId,
    assessment_public_id: demoAssessmentPublicId
  });
  assertStudentPayloadIsSafe(started);
  assertStudentVisibleTextIsSafe(started);

  const conceptUnitPublicId = started.state.current_concept_unit?.concept_unit_public_id;
  assert(conceptUnitPublicId, "Started fixed MVP session should include the current concept unit.");
  let state = await startConceptUnitInitialAdministration({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: conceptUnitPublicId
  });
  assertStudentPayloadIsSafe(state);
  assertStudentVisibleTextIsSafe(state);
  assert(state.current_item?.item_public_id === demoItemPublicIds[0], "Initial flow should begin with item 1.");

  for (const itemIndex of [1, 2, 3]) {
    state = await completeInitialItem({
      studentDbId: input.studentDbId,
      sessionPublicId: started.session.session_public_id,
      prefix: input.prefix,
      state,
      itemIndex,
      withTemptingReason: itemIndex === 2
    });
    assertStudentPayloadIsSafe(state);
    assertStudentVisibleTextIsSafe(state);
  }
  assert(state.assessment_state === "PACKAGE_REVIEW", "Three initial items should reach package review.");

  const completedInitial = await completeInitialConceptUnitAdministration({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: conceptUnitPublicId
  });
  assert(completedInitial.state.assessment_state === "FORMATIVE_ACTIVITY", "Package submit should show activity.");
  assertStudentPayloadIsSafe(completedInitial);
  assertStudentVisibleTextIsSafe(completedInitial);

  const activity = await submitFormativeActivityResponse({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id,
    message:
      "Theta is the person location on the linked scale, while item parameters describe items.",
    client_message_id: `${input.prefix}_formative_activity`
  });
  assert(activity.state.assessment_state === "REVISION", "Formative response should advance to revision.");
  assertStudentPayloadIsSafe(activity);
  assertStudentVisibleTextIsSafe(activity);

  const revision = await submitRevisionResponse({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id,
    message:
      "The item parameters affect response probabilities and precision, but theta remains the linked ability estimate.",
    client_message_id: `${input.prefix}_revision`
  });
  assert(revision.state.assessment_state === "NEXT_CHOICE", "Revision should advance to next choice.");
  assertStudentPayloadIsSafe(revision);
  assertStudentVisibleTextIsSafe(revision);

  const completed = await submitNextChoice({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id,
    choice: "move_next",
    client_action_id: `${input.prefix}_next_choice`
  });
  assert(completed.state.assessment_state === "SESSION_COMPLETE", "Move-next choice should complete the MVP.");
  assertStudentPayloadIsSafe(completed);
  assertStudentVisibleTextIsSafe(completed);

  return started.session.session_public_id;
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "false";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);
  const studentDemo = await prisma.user.findUniqueOrThrow({
    where: { user_id: "student_demo" },
    select: { id: true }
  });
  const prefix = `demo_reset_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const unrelatedStudent = await createSmokeStudent({
    prisma,
    prefix: `${prefix}_unrelated`,
    accessCode: `${prefix}_access`
  });
  const unrelatedSessionPublicIds: string[] = [];

  try {
    await resetStudentDemoFixedMvpAttempt(prisma);

    const availableBeforeCompletion = await fixedMvpAvailability(studentDemo.id);
    assert(availableBeforeCompletion.can_start === true, "student_demo should start before completion.");

    const completedSessionPublicId = await completeFixedMvpOnce({
      studentDbId: studentDemo.id,
      prefix
    });
    const completedSession = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: completedSessionPublicId },
      select: { status: true, current_phase: true, completed_at: true }
    });
    assert(completedSession.status === "completed", "Completed demo session should be marked completed.");
    assert(
      completedSession.current_phase === "session_completed",
      "Completed demo session should be in session_completed phase."
    );
    assert(completedSession.completed_at, "Completed demo session should have completed_at.");

    const unavailableAfterCompletion = await fixedMvpAvailability(studentDemo.id);
    assert(
      unavailableAfterCompletion.availability_status === "completed",
      "Dashboard should mark the fixed MVP completed after one attempt."
    );
    assert(unavailableAfterCompletion.can_resume === false, "Completed fixed MVP should not resume.");
    await assertStartBlockedAfterCompletion(studentDemo.id);

    const unrelatedStarted = await startOrResumeStudentAssessmentSession({
      student_user_db_id: unrelatedStudent.id,
      assessment_public_id: demoAssessmentPublicId
    });
    unrelatedSessionPublicIds.push(unrelatedStarted.session.session_public_id);

    const resetResult = await resetStudentDemoFixedMvpAttempt(prisma);
    assert(resetResult.can_start_after_reset === true, "Reset should restore dashboard start availability.");
    assert(resetResult.sessions_deleted >= 1, "Reset should delete student_demo fixed MVP sessions.");

    const unrelatedStillExists = await prisma.assessmentSession.findUnique({
      where: { session_public_id: unrelatedStarted.session.session_public_id },
      select: { id: true }
    });
    assert(unrelatedStillExists, "Reset must not delete another student's fixed MVP session.");

    const restarted = await startOrResumeStudentAssessmentSession({
      student_user_db_id: studentDemo.id,
      assessment_public_id: demoAssessmentPublicId
    });
    assertStudentPayloadIsSafe(restarted);
    assertStudentVisibleTextIsSafe(restarted);
    assert(restarted.session.session_public_id, "Reset should allow a fresh student_demo session.");

    const conceptUnitPublicId = restarted.state.current_concept_unit?.concept_unit_public_id;
    assert(conceptUnitPublicId, "Restarted fixed MVP should include a concept unit.");
    const initialState = await startConceptUnitInitialAdministration({
      student_user_db_id: studentDemo.id,
      session_public_id: restarted.session.session_public_id,
      concept_unit_public_id: conceptUnitPublicId
    });
    assertStudentPayloadIsSafe(initialState);
    assertStudentVisibleTextIsSafe(initialState);
    assert(initialState.assessment_state === "AWAIT_ANSWER", "Restarted fixed MVP should reach answer state.");
    const restartedItemPublicId = initialState.current_item?.item_public_id ?? "";
    assert(
      restartedItemPublicId !== demoItemPublicIds[3],
      "Restarted initial package must not show the transfer item."
    );
    assert(restartedItemPublicId === demoItemPublicIds[0], "Restarted MVP should show item 1.");
  } finally {
    await resetStudentDemoFixedMvpAttempt(prisma).catch(() => null);
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: unrelatedStudent.id,
      sessionPublicIds: unrelatedSessionPublicIds
    }).catch(() => null);
  }

  console.log(
    "Demo reset smoke test passed. student_demo can complete, reset, and start the fixed IRT MVP again without exposing answer keys or deleting unrelated student data."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
