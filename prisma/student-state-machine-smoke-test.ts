import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import {
  completeInitialConceptUnitAdministration,
  getStudentSessionState,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitItemResponse
} from "../src/lib/services/student-assessment/service";
import { demoAssessmentPublicId, ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertStudentError(
  action: () => Promise<unknown>,
  expectedCode: string,
  message: string
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, `${message}: unexpected error type`);
    assert(error.code === expectedCode, `${message}: expected ${expectedCode}, got ${error.code}`);
    return;
  }

  throw new Error(`${message}: expected error ${expectedCode}`);
}

function assertNoAnswerKey(value: unknown) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes("correct_option"), "Student payload leaked answer-key field.");
  assert(!serialized.includes("correctness"), "Student payload leaked correctness field.");
}

async function cleanup(userDbId: string) {
  const sessions = await prisma.assessmentSession.findMany({
    where: { user_db_id: userDbId },
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
  await prisma.followupRound.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.formativeDecision.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.studentProfile.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.agentCall.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.user.deleteMany({ where: { id: userDbId } });
}

async function completeCurrentItem(input: {
  studentDbId: string;
  sessionPublicId: string;
  selectedOption: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  temptingOption?: string;
  temptingReason?: string;
  noTemptingOption?: boolean;
  prefix: string;
}) {
  let state = await getStudentSessionState({
    student_user_db_id: input.studentDbId,
    session_public_id: input.sessionPublicId
  });
  const item = state.current_item;
  assert(item, "Expected a current item.");
  assert(state.assessment_state === "AWAIT_ANSWER", "Expected AWAIT_ANSWER.");

  state = (
    await recordSelectedOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        selected_option: input.selectedOption,
        client_action_id: `${input.prefix}_answer`
      }
    })
  ).state;
  assert(state.assessment_state === "AWAIT_REASON", "Answer should advance to AWAIT_REASON.");

  state = (
    await recordReasoning({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        reasoning_text: input.reasoning,
        client_action_id: `${input.prefix}_reason`
      }
    })
  ).state;
  assert(state.assessment_state === "AWAIT_CONFIDENCE", "Reasoning should advance to AWAIT_CONFIDENCE.");

  state = (
    await recordConfidence({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        confidence_rating: input.confidence,
        client_action_id: `${input.prefix}_confidence`
      }
    })
  ).state;
  assert(state.assessment_state === "AWAIT_TEMPTING_OPTION", "Confidence should advance to AWAIT_TEMPTING_OPTION.");

  state = (
    await recordTemptingOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        tempting_option: input.temptingOption ?? null,
        tempting_option_reason: input.temptingReason ?? null,
        no_tempting_option: Boolean(input.noTemptingOption),
        client_action_id: `${input.prefix}_tempting`
      }
    })
  ).state;

  return { item, state };
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const userId = `state_machine_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      role: "student",
      access_code_hash: await hashSecret("state_machine_smoke_access")
    }
  });

  try {
    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    assert(started.state.assessment_state === "SESSION_START", "New session should start at SESSION_START.");
    assertNoAnswerKey(started.state);

    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(state.assessment_state === "AWAIT_ANSWER", "Concept start should await the first answer.");
    assert(state.next_step === "present_item", "Legacy next_step should remain present_item for current UI.");
    assertNoAnswerKey(state);
    const firstItem = state.current_item;
    assert(firstItem, "First item missing.");

    await assertStudentError(
      () =>
        recordReasoning({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          item_public_id: firstItem.item_public_id,
          data: {
            reasoning_text: "This is out of order.",
            client_action_id: `${userId}_invalid_reason_first`
          }
        }),
      "invalid_phase_for_action",
      "Reasoning before answer should be rejected"
    );

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          selected_option: firstItem.options[0]?.label,
          client_action_id: `${userId}_item1_answer`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Answer should advance to reasoning.");

    await assertStudentError(
      () =>
        recordConfidence({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          item_public_id: firstItem.item_public_id,
          data: {
            confidence_rating: "high",
            client_action_id: `${userId}_invalid_confidence_first`
          }
        }),
      "invalid_phase_for_action",
      "Confidence before reasoning should be rejected"
    );

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: "The evidence in the item points to this answer.",
          client_action_id: `${userId}_item1_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_CONFIDENCE", "Reasoning should advance to confidence.");

    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          confidence_rating: "medium",
          client_action_id: `${userId}_item1_confidence`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_TEMPTING_OPTION", "Confidence should advance to tempting option.");

    await assertStudentError(
      () =>
        submitItemResponse({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          item_public_id: firstItem.item_public_id,
          data: { client_action_id: `${userId}_invalid_item_submit` }
        }),
      "invalid_phase_for_action",
      "Item-level submit before tempting option should be rejected"
    );

    const temptingOnly = await recordTemptingOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: firstItem.item_public_id,
      data: {
        tempting_option: firstItem.options[1]?.label,
        client_action_id: `${userId}_item1_tempting_option`
      }
    });
    assert(
      temptingOnly.state.assessment_state === "AWAIT_TEMPTING_REASON",
      "Tempting option without reason should ask for tempting reason."
    );
    assert(
      temptingOnly.state.current_item?.item_public_id === firstItem.item_public_id,
      "Item should remain active until tempting reason is provided."
    );

    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          tempting_option_reason: "It used similar wording to the stem.",
          client_action_id: `${userId}_item1_tempting_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_ANSWER", "Completed first item should advance to the next answer.");
    assert(state.current_item?.item_public_id !== firstItem.item_public_id, "First item should no longer be active.");

    const firstResponse = await prisma.itemResponse.findFirstOrThrow({
      where: { item: { item_public_id: firstItem.item_public_id } },
      select: { item_submitted_at: true }
    });
    assert(firstResponse.item_submitted_at, "Tempting reason should auto-complete the item.");

    const secondItem = state.current_item;
    assert(secondItem, "Second item missing.");
    const secondResult = await completeCurrentItem({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      selectedOption: secondItem.options[0]?.label ?? "A",
      reasoning: "This answer best matches the evidence.",
      confidence: "high",
      noTemptingOption: true,
      prefix: `${userId}_item2`
    });
    assert(secondResult.state.assessment_state === "AWAIT_ANSWER", "Second item should advance to third answer.");

    const thirdItem = secondResult.state.current_item;
    assert(thirdItem, "Third item missing.");
    const thirdResult = await completeCurrentItem({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      selectedOption: thirdItem.options[0]?.label ?? "A",
      reasoning: "The same rule applies to the final question.",
      confidence: "medium",
      noTemptingOption: true,
      prefix: `${userId}_item3`
    });
    assert(thirdResult.state.assessment_state === "PACKAGE_REVIEW", "Three completed items should enter PACKAGE_REVIEW.");
    assert(thirdResult.state.next_step === "package_review", "Legacy next_step should expose package_review.");
    assert(!thirdResult.state.current_item, "No current item should remain at package review.");

    const completed = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: thirdResult.state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Package submit should enter FORMATIVE_ACTIVITY.");
    assert(completed.state.current_phase === "planning_completed", "Package submit should prepare the formative activity.");

    const temptingEvents = await prisma.processEvent.count({
      where: {
        assessment_session: { session_public_id: started.session.session_public_id },
        event_type: "tempting_option_submitted"
      }
    });
    assert(temptingEvents === 4, "Expected four tempting-option submissions including option and reason turns.");

    console.log("Student assessment state-machine smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanup(student.id);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
