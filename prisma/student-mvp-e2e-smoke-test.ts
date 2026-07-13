import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  ChatNativeFormativeProfileOutputSchema,
  ChatNativeTargetedFeedbackOutputSchema
} from "../src/lib/services/student-assessment/formative-profile";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse,
  submitNextChoice,
  submitRevisionResponse
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  demoItemPublicIds,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  assertEventsPresent,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  collectMvpSessionEvidence,
  completeInitialItem,
  completeTransferItem,
  createSmokeStudent,
  eventCounts,
  hashEvidenceShape,
  itemRole,
  writeMvpSessionEvidence,
  type MvpPathChoice
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

type ScenarioResult = {
  scenario: string;
  session_public_id: string;
  evidence_path: string;
  evidence_shape_hash: string;
};

function packageItemResponses(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const responses = (payload as Record<string, unknown>).item_responses;
  return Array.isArray(responses) ? responses as Array<Record<string, unknown>> : [];
}

function assertInitialPackage(payload: unknown) {
  const responses = packageItemResponses(payload);
  assert(responses.length === 3, "Initial response package should contain exactly three item responses.");
  assert(
    responses.every((response) => response.item_public_id !== demoItemPublicIds[3]),
    "Initial response package must exclude the transfer item."
  );
  assert(
    responses.every((response) => response.item_role !== "transfer"),
    "Initial response package must exclude transfer-role responses."
  );
}

function assertNoEarlyCorrectnessInTranscript(turns: Array<{ message_text: string | null }>) {
  const packageReviewIndex = turns.findIndex((turn) =>
    /I have your \d+ responses|I have your responses/.test(turn.message_text ?? "")
  );
  const initialTurns = packageReviewIndex >= 0 ? turns.slice(0, packageReviewIndex + 1) : turns;
  const serialized = JSON.stringify(initialTurns).toLowerCase();
  const forbidden = [
    "correct answer",
    "incorrect",
    "the answer is",
    "answer key",
    "correct_option",
    "correctness",
    "distractor rationale"
  ];

  for (const term of forbidden) {
    assert(!serialized.includes(term), `Initial transcript leaked protected correctness term: ${term}.`);
  }
}

async function runScenario(input: {
  scenario: string;
  nextChoice: MvpPathChoice;
  withInitialTemptingReason?: boolean;
}): Promise<ScenarioResult> {
  const prefix = `phase8_${input.scenario}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  try {
    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    sessionPublicIds.push(started.session.session_public_id);
    const resumed = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    assert(
      resumed.session.session_public_id === started.session.session_public_id,
      `${input.scenario}: active attempt should resume by default.`
    );

    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
    });

    const observedStates: string[] = [state.assessment_state];

    for (const itemIndex of [1, 2, 3]) {
      state = await completeInitialItem({
        studentDbId: student.id,
        sessionPublicId: started.session.session_public_id,
        prefix,
        state,
        itemIndex,
        withTemptingReason: input.withInitialTemptingReason && itemIndex === 2
      });
      observedStates.push(state.assessment_state);
    }
    assert(
      state.assessment_state === "PACKAGE_REVIEW",
      `${input.scenario}: expected PACKAGE_REVIEW after three initial items.`
    );

    const packageReviewTranscript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assertStudentVisibleTextIsSafe(packageReviewTranscript);
    assert(
      packageReviewTranscript.transcript.some((turn) =>
        /I have your \d+ responses|I have your responses/.test(turn.message_text ?? "")
      ),
      `${input.scenario}: missing package-level review message.`
    );
    assertNoEarlyCorrectnessInTranscript(packageReviewTranscript.transcript);

    const completedInitial = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(
      completedInitial.state.assessment_state === "FORMATIVE_ACTIVITY",
      `${input.scenario}: expected formative activity after package submission.`
    );
    assertStudentVisibleTextIsSafe(completedInitial.state);
    observedStates.push(completedInitial.state.assessment_state);

    const activity = await submitFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message:
        "Theta describes the person location on the linked scale, while item difficulty describes an item location.",
      client_message_id: `${prefix}_formative_activity`
    });
    assert(activity.state.assessment_state === "REVISION", `${input.scenario}: expected revision.`);
    assert(activity.targeted_feedback_available === true, `${input.scenario}: targeted feedback missing.`);
    assertStudentVisibleTextIsSafe(activity.state);
    observedStates.push(activity.state.assessment_state);

    const revision = await submitRevisionResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message:
        "Theta describes the student on the linked latent trait scale, while item parameters describe item behavior.",
      client_message_id: `${prefix}_revision`
    });
    assert(revision.state.assessment_state === "NEXT_CHOICE", `${input.scenario}: expected next choice.`);
    assert(revision.next_choice_available === true, `${input.scenario}: next choice missing.`);
    assertStudentVisibleTextIsSafe(revision.state);
    observedStates.push(revision.state.assessment_state);

    const choice = await submitNextChoice({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      choice: input.nextChoice,
      client_action_id: `${prefix}_next_choice`
    });
    assertStudentVisibleTextIsSafe(choice.state);

    if (input.nextChoice === "try_another") {
      assert(choice.choice_status === "transfer_item_started", `${input.scenario}: choice B should start transfer.`);
      assert(choice.state.assessment_state === "TRANSFER_ITEM", `${input.scenario}: expected transfer item.`);
      assert(choice.state.current_item?.item_public_id === demoItemPublicIds[3], `${input.scenario}: wrong transfer item.`);
      observedStates.push(choice.state.assessment_state);
      const transfer = await completeTransferItem({
        studentDbId: student.id,
        sessionPublicId: started.session.session_public_id,
        prefix,
        state: choice.state
      });
      observedStates.push(transfer.state.assessment_state);
      assert(transfer.state.assessment_state === "SESSION_COMPLETE", `${input.scenario}: transfer should complete.`);
    } else {
      assert(choice.choice_status === "session_completed", `${input.scenario}: choice A should complete.`);
      assert(choice.state.assessment_state === "SESSION_COMPLETE", `${input.scenario}: A path should complete.`);
      observedStates.push(choice.state.assessment_state);
    }

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_phase: true, status: true }
    });
    assert(session.current_phase === "session_completed", `${input.scenario}: DB phase should be complete.`);
    assert(session.status === "completed", `${input.scenario}: DB status should be complete.`);
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        package_type: "initial_concept_unit_response_package"
      },
      orderBy: [{ created_at: "desc" }]
    });
    assertInitialPackage(responsePackage.payload);

    const initialResponseCount = await prisma.itemResponse.count({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        item: { included_in_published_set: true }
      }
    });
    assert(initialResponseCount === 3, `${input.scenario}: expected three initial item responses.`);
    const transferResponseCount = await prisma.itemResponse.count({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        item: { item_public_id: demoItemPublicIds[3] }
      }
    });

    if (input.nextChoice === "try_another") {
      assert(transferResponseCount === 1, `${input.scenario}: expected one transfer response.`);
      const transferDbItem = await prisma.item.findUniqueOrThrow({
        where: { item_public_id: demoItemPublicIds[3] },
        select: { included_in_published_set: true, administration_rules: true }
      });
      assert(!transferDbItem.included_in_published_set, `${input.scenario}: transfer item must be excluded.`);
      assert(itemRole(transferDbItem.administration_rules) === "transfer", `${input.scenario}: transfer role missing.`);
    } else {
      assert(transferResponseCount === 0, `${input.scenario}: A path should not administer transfer.`);
    }

    const events = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      orderBy: [{ occurred_at: "asc" }],
      select: { event_type: true }
    });
    const counts = eventCounts(events);
    assertEventsPresent(counts, [
      "session_started",
      "agent_message_shown",
      "item_presented",
      "option_clicked",
      "reasoning_submitted",
      "confidence_clicked",
      "tempting_option_submitted",
      "item_completed",
      "package_review_opened",
      "package_submitted",
      "llm_profile_requested",
      "llm_profile_received",
      "formative_activity_shown",
      "followup_response_submitted",
      "formative_activity_evaluated",
      "learning_profile_updated",
      "engagement_profile_updated",
      "targeted_feedback_shown",
      "revision_submitted",
      "next_choice_shown",
      "next_choice_selected",
      "session_completed"
    ]);

    if (input.nextChoice === "try_another") {
      assertEventsPresent(counts, [
        "transfer_item_presented",
        "transfer_answer_selected",
        "transfer_reasoning_submitted",
        "transfer_confidence_clicked",
        "transfer_tempting_option_submitted",
        "transfer_tempting_option_reason_submitted",
        "transfer_item_completed"
      ]);
    } else {
      assert((counts.transfer_item_presented ?? 0) === 0, `${input.scenario}: unexpected transfer event.`);
    }

    const [profileCall, targetedCall] = await Promise.all([
      prisma.agentCall.findFirstOrThrow({
        where: {
          assessment_session_db_id: session.id,
          agent_name: "formative_value_and_planning_agent",
          schema_version: "chat-native-formative-profile-output-v1"
        }
      }),
      prisma.agentCall.findFirstOrThrow({
        where: {
          assessment_session_db_id: session.id,
          agent_name: "followup_agent",
          schema_version: "chat-native-formative-activity-evaluation-output-v1"
        }
      })
    ]);
    assert(profileCall.provider === "mock", `${input.scenario}: MVP smoke must use mock provider.`);
    assert(targetedCall.provider === "mock", `${input.scenario}: MVP smoke must use mock provider.`);
    assert(profileCall.live_call_allowed === false, `${input.scenario}: MVP smoke must not allow live profile calls.`);
    assert(targetedCall.live_call_allowed === false, `${input.scenario}: MVP smoke must not allow live feedback calls.`);
    assert(
      ChatNativeFormativeProfileOutputSchema.safeParse(profileCall.output_payload).success,
      `${input.scenario}: formative profile output schema mismatch.`
    );
    assert(
      ChatNativeTargetedFeedbackOutputSchema.safeParse(targetedCall.output_payload).success,
      `${input.scenario}: targeted feedback output schema mismatch.`
    );

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assertStudentVisibleTextIsSafe(transcript);
    if (input.nextChoice === "try_another") {
      assert(
        transcript.transcript.some((turn) => turn.interaction_type === "transfer_item"),
        `${input.scenario}: transcript missing transfer item.`
      );
    } else {
      assert(
        !transcript.transcript.some((turn) => turn.interaction_type === "transfer_item"),
        `${input.scenario}: A path transcript should not include transfer item.`
      );
    }

    const requiredStateMarkers =
      input.nextChoice === "try_another"
        ? ["PACKAGE_REVIEW", "FORMATIVE_ACTIVITY", "REVISION", "NEXT_CHOICE", "TRANSFER_ITEM", "SESSION_COMPLETE"]
        : ["PACKAGE_REVIEW", "FORMATIVE_ACTIVITY", "REVISION", "NEXT_CHOICE", "SESSION_COMPLETE"];
    for (const marker of requiredStateMarkers) {
      assert(observedStates.includes(marker), `${input.scenario}: missing state marker ${marker}.`);
    }

    const evidence = await collectMvpSessionEvidence({
      prisma,
      sessionPublicId: started.session.session_public_id,
      scenario: input.scenario
    });
    const evidencePath = await writeMvpSessionEvidence({
      evidence,
      scenario: input.scenario,
      sessionPublicId: started.session.session_public_id
    });
    const newAttempt = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId,
      new_attempt: true
    });
    sessionPublicIds.push(newAttempt.session.session_public_id);
    assert(
      newAttempt.session.session_public_id !== started.session.session_public_id,
      `${input.scenario}: completed attempt should not be overwritten.`
    );
    assert(
      newAttempt.session.attempt_number > started.session.attempt_number,
      `${input.scenario}: new attempt should increment attempt number.`
    );

    return {
      scenario: input.scenario,
      session_public_id: started.session.session_public_id,
      evidence_path: evidencePath,
      evidence_shape_hash: hashEvidenceShape(evidence)
    };
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const results = [
    await runScenario({
      scenario: "path-a-complete",
      nextChoice: "move_next",
      withInitialTemptingReason: true
    }),
    await runScenario({
      scenario: "path-b-transfer",
      nextChoice: "try_another",
      withInitialTemptingReason: true
    })
  ];

  console.log(
    JSON.stringify(
      {
        status: "passed",
        message: "Phase 8 full MVP E2E smoke passed. No OpenAI calls are made by this script.",
        evidence_exports: results.map((result) => ({
          scenario: result.scenario,
          path: result.evidence_path,
          evidence_shape_hash: result.evidence_shape_hash
        }))
      },
      null,
      2
    )
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
