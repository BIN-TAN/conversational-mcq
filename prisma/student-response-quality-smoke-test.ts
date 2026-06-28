import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent,
  eventCounts
} from "./student-mvp-smoke-helpers";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  getStudentSessionState,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  updateInFlowItemResponse
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  submitChatNativeFormativeActivityResponse
} from "../src/lib/services/student-assessment/formative-profile";

const prisma = new PrismaClient();

async function assertStudentComponentQualityShape() {
  const source = await readFile(
    path.join(process.cwd(), "src/components/student-assessment/assessment-session-client.tsx"),
    "utf8"
  );
  const agentItemStart = source.indexOf("function AgentItemMessage");
  const confidenceStart = source.indexOf("function ConfidenceMessage");
  const agentItemSource =
    agentItemStart >= 0 && confidenceStart > agentItemStart
      ? source.slice(agentItemStart, confidenceStart)
      : "";

  assert(source.includes("I don't know yet."), "E uncertainty option copy is missing.");
  assert(source.includes("answerOptionsFor(item).map"), "Answer option cards should include the E option.");
  assert(agentItemSource.includes("<button"), "Answer option cards should be buttons.");
  assert(!agentItemSource.includes("<OptionChip"), "Answer selection should not render separate A-D chips.");
  assert(source.includes("in-flow-edit-panel"), "In-flow edit affordance is missing.");
  assert(source.includes("Current learning profile"), "Student-safe learning profile panel is missing.");
  assert(!source.includes("submit-item"), "Initial item-level submit should not return.");
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await assertStudentComponentQualityShape();
  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase13_quality_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: "phase13_quality_access"
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
    const firstItem = state.current_item;
    assert(firstItem, "Expected first item.");

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          selected_option: "E",
          client_action_id: `${prefix}_idk_answer`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "E selection should ask for reasoning.");
    assert(state.current_item?.existing_selected_option === "E", "E selection should persist.");

    let response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: firstItem.item_public_id },
        concept_unit_session: { assessment_session: { session_public_id: started.session.session_public_id } }
      },
      select: { correctness: true, reasoning_text: true }
    });
    assert(response.correctness === "not_scored", "E should be stored as explicit uncertainty, not incorrect.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: "deadw",
          client_action_id: `${prefix}_gibberish_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Gibberish reasoning should not advance.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: "I think",
          client_action_id: `${prefix}_short_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Very short reasoning should not advance.");
    response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: firstItem.item_public_id },
        concept_unit_session: { assessment_session: { session_public_id: started.session.session_public_id } }
      },
      select: { correctness: true, reasoning_text: true }
    });
    assert(!response.reasoning_text, "Rejected reasoning should not be stored on item_responses.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: "B",
          client_action_id: `${prefix}_mark_unknown_reason`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_CONFIDENCE", "Marking unknown reasoning should advance.");
    response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: firstItem.item_public_id },
        concept_unit_session: { assessment_session: { session_public_id: started.session.session_public_id } }
      },
      select: { correctness: true, reasoning_text: true }
    });
    assert(
      response.reasoning_text === "I don't know the reason yet.",
      "Unknown reasoning choice should be stored explicitly."
    );

    const editedReasoning =
      "It is hard because I can tell theta belongs to the person, but the item parameter wording is still close.";
    state = (
      await updateInFlowItemResponse({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: editedReasoning,
          client_action_id: `${prefix}_edit_reasoning`
        }
      })
    ).state;
    assert(state.current_item?.existing_reasoning_text === editedReasoning, "Edited reasoning should hydrate.");

    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          confidence_rating: "low",
          client_action_id: `${prefix}_confidence`
        }
      })
    ).state;
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${prefix}_no_tempting`
        }
      })
    ).state;

    for (let index = 2; index <= 3; index += 1) {
      state = await completeInitialItem({
        studentDbId: student.id,
        sessionPublicId: started.session.session_public_id,
        prefix,
        state,
        itemIndex: index,
        withTemptingReason: index === 2
      });
    }
    assert(state.assessment_state === "PACKAGE_REVIEW", "Initial package should reach review.");

    state = (
      await completeInitialConceptUnitAdministration({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
      })
    ).state;
    assert(state.assessment_state === "FORMATIVE_ACTIVITY", "Mock formative activity should be available.");

    const offTopic = await submitChatNativeFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message: "What is the weather today?",
      client_message_id: `${prefix}_off_topic_activity`
    });
    assert(
      offTopic.targeted_feedback_available === false,
      "Off-topic formative response should not create targeted feedback."
    );
    state = await getStudentSessionState({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(state.assessment_state === "FORMATIVE_ACTIVITY", "Off-topic formative response should stay on activity.");

    const clarification = await submitChatNativeFormativeActivityResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      message: "Can you clarify what I should write?",
      client_message_id: `${prefix}_clarify_activity`
    });
    assert(
      clarification.targeted_feedback_available === false,
      "Clarification request should not create targeted feedback."
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const events = await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      select: { event_type: true }
    });
    const counts = eventCounts(events);
    assert((counts.idk_selected ?? 0) > 0, "idk_selected event missing.");
    assert((counts.response_quality_checked ?? 0) >= 4, "response_quality_checked events missing.");
    assert((counts.response_quality_rejected ?? 0) >= 3, "response_quality_rejected events missing.");
    assert((counts.repeated_invalid_response ?? 0) > 0, "Repeated invalid response event missing.");
    assert((counts.insufficient_knowledge_marked ?? 0) > 0, "Insufficient knowledge event missing.");
    assert((counts.student_response_edit_submitted ?? 0) > 0, "In-flow edit event missing.");
    assert((counts.reasoning_edited ?? 0) > 0, "Reasoning edit event missing.");
    assert((counts.clarification_answered ?? 0) > 0, "Clarification event missing.");

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(
      transcript.transcript.some((entry) => entry.message_text === "I don't know yet."),
      "E selection should appear as an uncertainty chat bubble."
    );
    assertStudentVisibleTextIsSafe(transcript);

    console.log("Student response-quality smoke passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
