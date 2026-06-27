import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse,
  submitNextChoice,
  submitRevisionResponse
} from "../src/lib/services/student-assessment/service";
import {
  ChatNativeTargetedFeedbackOutputSchema
} from "../src/lib/services/student-assessment/formative-profile";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import type { StudentSessionState } from "../src/lib/student-assessment-ui/types";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStudentVisibleTextIsSafe(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "response profile",
    "formative need",
    "metadata",
    "answer key",
    "system prompt",
    "structured output",
    "agent call",
    "correct_option",
    "correctness",
    "ability_profile",
    "engagement_profile",
    "integrated_diagnostic_profile",
    "formative_value"
  ];

  for (const term of forbidden) {
    assert(!serialized.includes(term), `Student-visible payload leaked ${term}.`);
  }
}

async function cleanup(userDbId: string, sessionPublicIds: string[]) {
  const sessions = await prisma.assessmentSession.findMany({
    where: {
      OR: [{ user_db_id: userDbId }, { session_public_id: { in: sessionPublicIds } }]
    },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

  await prisma.workflowJob.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.workflowOverride.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.studentActionIdempotencyKey.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.responsePackage.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.processEvent.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.conversationTurn.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.agentCall.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.followupRound.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.formativeDecision.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.studentProfile.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.user.deleteMany({ where: { id: userDbId } });
}

async function completeItemFromState(input: {
  studentDbId: string;
  sessionPublicId: string;
  prefix: string;
  state: StudentSessionState;
  itemIndex: number;
  withTemptingReason?: boolean;
}) {
  const item = input.state.current_item;
  assert(item, `Expected item ${input.itemIndex}.`);
  const selectedOption = item.options[0]?.label;
  assert(selectedOption, `Item ${input.itemIndex} needs a selected option.`);

  let state = (
    await recordSelectedOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        selected_option: selectedOption,
        client_action_id: `${input.prefix}_item${input.itemIndex}_answer`
      }
    })
  ).state;
  state = (
    await recordReasoning({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        reasoning_text: `Item ${input.itemIndex} reasoning compares theta with item difficulty.`,
        client_action_id: `${input.prefix}_item${input.itemIndex}_reason`
      }
    })
  ).state;
  state = (
    await recordConfidence({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        confidence_rating: input.itemIndex === 1 ? "medium" : "high",
        client_action_id: `${input.prefix}_item${input.itemIndex}_confidence`
      }
    })
  ).state;

  if (input.withTemptingReason) {
    const temptingOption = item.options[1]?.label ?? selectedOption;
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          tempting_option: temptingOption,
          client_action_id: `${input.prefix}_item${input.itemIndex}_tempting`
        }
      })
    ).state;
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          tempting_option_reason: "The wording sounded close to the option I chose.",
          client_action_id: `${input.prefix}_item${input.itemIndex}_tempting_reason`
        }
      })
    ).state;
  } else {
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: input.sessionPublicId,
        item_public_id: item.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${input.prefix}_item${input.itemIndex}_tempting_no`
        }
      })
    ).state;
  }

  return state;
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase6_targeted_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await prisma.user.create({
    data: {
      user_id: prefix,
      user_id_normalized: normalizeUserId(prefix),
      role: "student",
      access_code_hash: await hashSecret("phase6_targeted_access")
    },
    select: { id: true }
  });
  const sessionPublicIds: string[] = [];

  try {
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

    state = await completeItemFromState({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex: 1
    });
    state = await completeItemFromState({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex: 2,
      withTemptingReason: true
    });
    state = await completeItemFromState({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex: 3
    });
    assert(state.assessment_state === "PACKAGE_REVIEW", "Expected package review.");

    const completed = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Expected formative activity.");

    const activityResponse = await submitFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message:
        "Difficulty is about the item and theta is about the person, so linked forms should keep the person scale stable.",
      client_message_id: `${prefix}_activity_response`
    });
    assert(activityResponse.targeted_feedback_available === true, "Targeted feedback was not generated.");
    assert(activityResponse.state.assessment_state === "REVISION", "Expected revision state.");
    assert(activityResponse.state.next_step === "revision_requested", "Expected revision prompt.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_phase: true }
    });
    assert(session.current_phase === "followup_active", "Session should wait for revision in followup_active.");
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const targetedCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "followup_agent",
        schema_version: "chat-native-targeted-feedback-output-v1"
      }
    });
    const targetedOutput = ChatNativeTargetedFeedbackOutputSchema.safeParse(targetedCall.output_payload);
    assert(targetedOutput.success, "Targeted feedback output did not validate.");
    assert(
      targetedOutput.data.revision_prompt !==
        "Please revise your answer, reasoning, or confidence based on this feedback.",
      "Revision prompt used the prohibited generic sentence."
    );

    let transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      transcript.transcript.some((turn) => turn.interaction_type === "targeted_feedback"),
      "Transcript missing targeted feedback."
    );
    assert(
      transcript.transcript.some((turn) => turn.interaction_type === "revision_prompt"),
      "Transcript missing revision prompt."
    );
    assertStudentVisibleTextIsSafe(transcript);

    const revision = await submitRevisionResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message: "Item difficulty describes the item; theta describes the person on the latent trait scale.",
      client_message_id: `${prefix}_revision_response`
    });
    assert(revision.revision_status === "saved", "Revision was not saved.");
    assert(revision.next_choice_available === true, "Next choice should become available.");
    assert(revision.state.assessment_state === "NEXT_CHOICE", "Expected next choice after revision.");

    transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      transcript.transcript.some((turn) => turn.interaction_type === "revision_response"),
      "Transcript missing student revision."
    );
    assertStudentVisibleTextIsSafe(transcript);

    const choiceA = await submitNextChoice({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      choice: "move_next",
      client_action_id: `${prefix}_next_choice_a`
    });
    assert(choiceA.choice_status === "session_completed", "Choice A should complete this MVP session.");
    assert(choiceA.state.assessment_state === "SESSION_COMPLETE", "Expected completed session after choice A.");

    const eventTypes = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      select: { event_type: true }
    });
    const eventCounts = eventTypes.reduce<Record<string, number>>((counts, event) => {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
      return counts;
    }, {});

    for (const expected of [
      "followup_response_submitted",
      "targeted_feedback_shown",
      "revision_requested",
      "revision_submitted",
      "next_choice_shown",
      "next_choice_selected"
    ]) {
      assert((eventCounts[expected] ?? 0) > 0, `Missing process event ${expected}.`);
    }
    assert(
      (eventCounts.next_choice_selected ?? 0) === 1,
      "Expected one next_choice_selected event for A completion."
    );

    const round = await prisma.followupRound.findFirstOrThrow({
      where: { concept_unit_session_db_id: conceptUnitSession.id },
      orderBy: [{ round_index: "desc" }]
    });
    assert(round.status === "completed", "Round should be completed after revision.");

    console.log("Phase 6 targeted feedback smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanup(student.id, sessionPublicIds);
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
