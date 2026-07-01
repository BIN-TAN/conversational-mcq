import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  completeInitialConceptUnitAdministration,
  getStudentReviewResponses,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  updatePackageReviewItemResponse
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent,
  eventCounts
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const prefix = `phase11_review_edit_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: "phase11_review_edit_access"
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

    for (let itemIndex = 1; itemIndex <= 3; itemIndex += 1) {
      state = await completeInitialItem({
        studentDbId: student.id,
        sessionPublicId: started.session.session_public_id,
        prefix,
        state,
        itemIndex,
        withTemptingReason: itemIndex === 2
      });
    }

    assert(state.assessment_state === "PACKAGE_REVIEW", "Expected package review after three initial items.");

    let review = await getStudentReviewResponses({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(review.items.length === 3, "Package review should show the three initial responses.");
    assert(review.items.every((item) => item.can_edit), "Package review responses should be editable before feedback.");
    assertStudentVisibleTextIsSafe(review);

    const reviewItem = review.items[0];
    assert(reviewItem, "Missing first review item.");
    const previousAnswer = reviewItem.existing_selected_option;
    const revisedAnswer =
      reviewItem.options.find((option) => option.label !== previousAnswer)?.label ?? reviewItem.options[0]?.label;
    const temptingOption =
      reviewItem.options.find((option) => option.label !== revisedAnswer)?.label ?? reviewItem.options[1]?.label;

    assert(revisedAnswer, "Review item needs a revised answer option.");
    assert(temptingOption, "Review item needs a tempting option.");

    const editResult = await updatePackageReviewItemResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: reviewItem.item_public_id,
      data: {
        selected_option: revisedAnswer,
        reasoning_text: "I revised this because the item evidence is stronger for the other option.",
        confidence_rating: "medium",
        no_tempting_option: false,
        tempting_option: temptingOption,
        tempting_option_reason: "The wording still sounded partly relevant.",
        client_action_id: `${prefix}_package_review_edit`
      }
    });

    assert(editResult.state.assessment_state === "PACKAGE_REVIEW", "Editing should return to package review.");
    assert(editResult.edit_status === "updated", "Expected package review edit to update stored evidence.");
    assert(editResult.changed_fields.includes("answer"), "Edit should record answer change.");
    assert(editResult.changed_fields.includes("reasoning"), "Edit should record reasoning change.");
    assert(editResult.changed_fields.includes("confidence"), "Edit should record confidence change.");
    assert(editResult.changed_fields.includes("tempting_option"), "Edit should record tempting-option change.");
    assertStudentVisibleTextIsSafe(editResult);

    review = await getStudentReviewResponses({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    const revisedReviewItem = review.items.find((item) => item.item_public_id === reviewItem.item_public_id);
    assert(revisedReviewItem, "Revised item missing from package review.");
    assert(revisedReviewItem.existing_selected_option === revisedAnswer, "Package review did not show revised answer.");
    assert(
      revisedReviewItem.existing_reasoning_text ===
        "I revised this because the item evidence is stronger for the other option.",
      "Package review did not show revised reasoning."
    );
    assert(revisedReviewItem.existing_confidence_rating === "medium", "Package review did not show revised confidence.");
    assert(revisedReviewItem.tempting_option === temptingOption, "Package review did not show revised tempting option.");
    assert(
      revisedReviewItem.tempting_option_reason === "The wording still sounded partly relevant.",
      "Package review did not show revised tempting-option reason."
    );
    assertStudentVisibleTextIsSafe(review);

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const storedResponse = await prisma.itemResponse.findFirstOrThrow({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        item: { item_public_id: reviewItem.item_public_id }
      },
      select: {
        selected_option: true,
        reasoning_text: true,
        confidence_rating: true,
        revision_count: true
      }
    });
    assert(storedResponse.selected_option === revisedAnswer, "Stored response did not update selected answer.");
    assert(storedResponse.confidence_rating === "medium", "Stored response did not update confidence.");
    assert((storedResponse.revision_count ?? 0) > 0, "Stored response did not increment revision count.");

    const events = await prisma.processEvent.findMany({
      where: {
        assessment_session_db_id: session.id,
        event_category: "package_review"
      },
      select: { event_type: true }
    });
    const counts = eventCounts(events);
    assert((counts.answer_changed ?? 0) > 0, "Package review answer change event missing.");
    assert((counts.reasoning_revised ?? 0) > 0, "Package review reasoning revision event missing.");
    assert((counts.confidence_clicked ?? 0) > 0, "Package review confidence event missing.");
    assert((counts.tempting_option_submitted ?? 0) > 0, "Package review tempting-option event missing.");
    assert(
      (counts.tempting_option_reason_submitted ?? 0) > 0,
      "Package review tempting-option reason event missing."
    );

    const editTurn = await prisma.conversationTurn.findFirst({
      where: {
        assessment_session_db_id: session.id,
        actor_type: "student",
        item: { item_public_id: reviewItem.item_public_id },
        structured_payload: {
          path: ["source"],
          equals: "package_review_tempting_option"
        }
      },
      select: { message_text: true, structured_payload: true }
    });
    assert(editTurn, "Package review edit conversation turn missing.");
    const editMessage = editTurn.message_text ?? "";
    assert(
      !editMessage.includes("Edited my response"),
      "Package review transcript should not use the generic edit placeholder."
    );
    assert(
      editMessage.includes(`I changed my answer to ${revisedAnswer}.`),
      "Package review transcript should show the revised answer."
    );
    assert(
      editMessage.includes("I revised this because the item evidence is stronger for the other option."),
      "Package review transcript should show the revised reasoning."
    );
    assert(
      editMessage.includes("I changed my confidence to Medium."),
      "Package review transcript should show the revised confidence."
    );
    assert(
      editMessage.includes(`I was tempted by ${temptingOption} because The wording still sounded partly relevant.`),
      "Package review transcript should show the revised tempting-option evidence."
    );
    assertStudentVisibleTextIsSafe(editTurn);

    const continued = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(
      continued.state.assessment_state === "FORMATIVE_ACTIVITY",
      "Continuing after package review edit should reach formative activity."
    );
    assertStudentVisibleTextIsSafe(continued.state);

    console.log("Student package review edit smoke passed.");
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
    await prisma.$disconnect();
  }
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
