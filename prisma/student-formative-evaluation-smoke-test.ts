import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  ChatNativeTargetedFeedbackOutputSchema
} from "../src/lib/services/student-assessment/formative-profile";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse,
  submitRevisionResponse
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  assertEventsPresent,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent,
  eventCounts
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();
const TARGETED_SCHEMA_VERSION = "chat-native-formative-activity-evaluation-output-v1";

type Scenario = {
  name: string;
  activityResponse: string;
  expectedNextAction:
    | "confirm_and_next_choice"
    | "ask_revision"
    | "provide_scaffold"
    | "clarify_question";
  expectedStateAfterActivity: "NEXT_CHOICE" | "REVISION";
  expectedEvent?: string;
};

async function startScenario(prefix: string) {
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];
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

  for (const itemIndex of [1, 2, 3]) {
    state = await completeInitialItem({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex,
      withTemptingReason: itemIndex === 2
    });
  }
  assert(state.assessment_state === "PACKAGE_REVIEW", `${prefix}: expected package review.`);

  const completedInitial = await completeInitialConceptUnitAdministration({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
  });
  assert(completedInitial.state.assessment_state === "FORMATIVE_ACTIVITY", `${prefix}: expected formative activity.`);
  assertStudentVisibleTextIsSafe(completedInitial.state);

  return { student, sessionPublicIds, sessionPublicId: started.session.session_public_id };
}

async function runScenario(scenario: Scenario) {
  const prefix = `phase12_${scenario.name}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, sessionPublicId } = await startScenario(prefix);

  try {
    const activity = await submitFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: sessionPublicId,
      message: scenario.activityResponse,
      client_message_id: `${prefix}_activity`
    });
    assert(
      activity.state.assessment_state === scenario.expectedStateAfterActivity,
      `${scenario.name}: expected ${scenario.expectedStateAfterActivity} after formative activity; got ${activity.state.assessment_state}.`
    );
    assertStudentVisibleTextIsSafe(activity.state);

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: sessionPublicId },
      select: { id: true, current_phase: true }
    });
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true, latest_student_profile_db_id: true }
    });
    const targetedCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "followup_agent",
        schema_version: TARGETED_SCHEMA_VERSION
      },
      orderBy: [{ created_at: "desc" }]
    });
    const targetedOutput = ChatNativeTargetedFeedbackOutputSchema.safeParse(targetedCall.output_payload);
    assert(targetedOutput.success, `${scenario.name}: formative activity evaluation output did not validate.`);
    assert(
      targetedOutput.data.formative_activity_evaluation.next_action === scenario.expectedNextAction,
      `${scenario.name}: unexpected next action.`
    );

    const updatedProfile = await prisma.studentProfile.findFirst({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        profile_type: "updated",
        based_on_agent_call_db_id: targetedCall.id
      },
      orderBy: [{ created_at: "desc" }]
    });
    assert(updatedProfile, `${scenario.name}: missing updated student profile.`);

    const eventRowsBeforeRevision = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      select: { event_type: true }
    });
    const countsBeforeRevision = eventCounts(eventRowsBeforeRevision);
    assertEventsPresent(countsBeforeRevision, [
      "followup_response_submitted",
      "formative_activity_evaluated",
      "learning_profile_updated",
      "engagement_profile_updated",
      "targeted_feedback_shown"
    ]);

    if (scenario.expectedEvent) {
      assert((countsBeforeRevision[scenario.expectedEvent] ?? 0) > 0, `${scenario.name}: missing ${scenario.expectedEvent}.`);
    }

    if (scenario.expectedStateAfterActivity === "NEXT_CHOICE") {
      assert(session.current_phase === "followup_stopped", `${scenario.name}: ready response should stop followup.`);
      assert((countsBeforeRevision.next_choice_shown ?? 0) > 0, `${scenario.name}: next choice should be shown.`);
      assert(
        (countsBeforeRevision.revision_requested ?? 0) === 0,
        `${scenario.name}: revision should not be requested for ready response.`
      );
    } else {
      assert(session.current_phase === "followup_active", `${scenario.name}: non-ready response should stay active.`);
      assert(
        (countsBeforeRevision.next_choice_shown ?? 0) === 0,
        `${scenario.name}: next choice was shown before readiness.`
      );

      const revision = await submitRevisionResponse({
        student_user_db_id: student.id,
        session_public_id: sessionPublicId,
        message: "I will revise: theta describes the person on the linked latent trait scale, while item parameters describe item behavior.",
        client_message_id: `${prefix}_revision`
      });
      assert(revision.state.assessment_state === "NEXT_CHOICE", `${scenario.name}: expected next choice after revision.`);
      assertStudentVisibleTextIsSafe(revision.state);
    }

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: sessionPublicId
    });
    assertStudentVisibleTextIsSafe(transcript);
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const scenarios: Scenario[] = [
    {
      name: "strong",
      activityResponse:
        "A higher discrimination parameter makes the ICC sharper or steeper and gives more item information. Theta remains the person's location on the linked latent trait scale, so its meaning stays comparable across forms.",
      expectedNextAction: "confirm_and_next_choice",
      expectedStateAfterActivity: "NEXT_CHOICE"
    },
    {
      name: "partial",
      activityResponse:
        "Theta is about the person and difficulty is about the item.",
      expectedNextAction: "ask_revision",
      expectedStateAfterActivity: "REVISION"
    },
    {
      name: "clarification",
      activityResponse:
        "Can you clarify what theta means here?",
      expectedNextAction: "clarify_question",
      expectedStateAfterActivity: "REVISION"
    },
    {
      name: "confused",
      activityResponse:
        "I am confused and not sure.",
      expectedNextAction: "provide_scaffold",
      expectedStateAfterActivity: "REVISION",
      expectedEvent: "scaffold_prompt_shown"
    }
  ];

  for (const scenario of scenarios) {
    await runScenario(scenario);
  }

  console.log("Phase 12 formative activity evaluation smoke test passed. No OpenAI calls are made by this script.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
