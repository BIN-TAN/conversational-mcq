import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { getTeacherReviewItemResponses } from "../src/lib/services/teacher-review/item-responses";
import {
  completeInitialConceptUnitAdministration,
  getStudentSessionState,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitItemResponse
} from "../src/lib/services/student-assessment/service";
import { buildStudentConversationFrame } from "../src/lib/student-assessment-ui/presenter";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
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
  await prisma.agentCall.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.processEvent.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.conversationTurn.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.user.deleteMany({ where: { id: userDbId } });
}

async function assertStudentComponentShape() {
  const source = await readFile(
    path.join(process.cwd(), "src/components/student-assessment/assessment-session-client.tsx"),
    "utf8"
  );

  assert(source.includes("continue-after-option"), "Option step Continue control is missing.");
  assert(source.includes("continue-after-reasoning"), "Reasoning step Continue control is missing.");
  assert(source.includes("continue-after-confidence"), "Confidence step Continue control is missing.");
  assert(source.includes("current-answer-summary"), "Current answer summary is missing.");
  assert(!source.includes("function ReviewPanel"), "Old review panel function should not be present.");
  assert(!source.includes("Review responses"), "Old survey-style review heading should not be present.");
  assert(!source.includes("Editable before completion"), "Old review-panel editing copy should not be present.");
  assert(!source.includes("lg:grid-cols-[minmax(0,1fr)_340px]"), "Student page should not use the old two-column answer layout.");
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await assertStudentComponentShape();
  await ensureDemoStudentAssessment(prisma);

  const userId = `phase8d_conversation_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      role: "student",
      access_code_hash: await hashSecret("phase8d_conversation_smoke_access")
    }
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
    let frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "present_item", "Expected one current item option step.");
    assert(state.current_item, "Current item is missing.");
    const item = state.current_item;
    const selectedOption = item.options[0]?.label;
    assert(selectedOption, "Demo item has no selectable option.");

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          selected_option: selectedOption,
          client_action_id: `${userId}_option`
        }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "request_reasoning", "Option selection should advance to reasoning.");
    assert(
      state.current_item?.existing_selected_option === selectedOption,
      "Selected option did not persist in session state."
    );

    const resumedAfterOption = await getStudentSessionState({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      resumedAfterOption.current_item?.existing_selected_option === selectedOption,
      "Selected option did not hydrate on resume."
    );

    const reasoning = "The option matches the evidence because it directly supports the claim.";
    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          reasoning_text: reasoning,
          client_action_id: `${userId}_reasoning`
        }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "request_confidence", "Reasoning should advance to confidence.");
    assert(state.current_item?.existing_reasoning_text === reasoning, "Reasoning did not persist.");

    const resumedAfterReasoning = await getStudentSessionState({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      resumedAfterReasoning.current_item?.existing_reasoning_text === reasoning,
      "Reasoning did not hydrate on resume."
    );

    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item.item_public_id,
        data: {
          confidence_rating: "medium",
          client_action_id: `${userId}_confidence`
        }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "item_completed", "Confidence should advance to review before submit.");
    assert(state.current_item?.existing_confidence_rating === "medium", "Confidence did not persist.");

    const submitActionId = `${userId}_submit_once`;
    await submitItemResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item.item_public_id,
      data: { client_action_id: submitActionId }
    });
    state = (
      await submitItemResponse({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item.item_public_id,
        data: { client_action_id: submitActionId }
      })
    ).state;

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const itemResponses = await prisma.itemResponse.findMany({
      where: {
        concept_unit_session: {
          assessment_session_db_id: session.id
        },
        item: {
          item_public_id: item.item_public_id
        }
      }
    });
    assert(itemResponses.length === 1, "Repeated submit created duplicate item responses.");
    assert(itemResponses[0]?.item_submitted_at, "Item was not submitted.");

    const teacherReview = await getTeacherReviewItemResponses(started.session.session_public_id);
    const teacherItem = teacherReview.concept_units
      .flatMap((conceptUnit) => conceptUnit.item_responses)
      .find((response) => response.item_public_id === item.item_public_id);
    assert(teacherItem, "Teacher review did not include submitted item.");
    assert(teacherItem.selected_option === selectedOption, "Teacher review selected option mismatch.");
    assert(teacherItem.reasoning_text === reasoning, "Teacher review reasoning mismatch.");
    assert(teacherItem.confidence_rating === "medium", "Teacher review confidence mismatch.");
    assert(teacherItem.item_submitted_at, "Teacher review missing submission timestamp.");

    assert(
      state.current_item?.item_public_id !== item.item_public_id,
      "Submitted item remained the active item."
    );

    await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    }).catch(() => undefined);

    console.log("Student conversational flow smoke test passed. No OpenAI calls are made by this script.");
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
