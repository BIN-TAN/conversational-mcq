import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { buildStudentConversationFrame } from "../src/lib/student-assessment-ui/presenter";
import {
  completeInitialConceptUnitAdministration,
  getStudentReviewResponses,
  getStudentSafeTranscript,
  listAvailableAssessments,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import {
  demoAssessmentPublicId,
  demoItemPublicIds,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoForbiddenFields(value: unknown) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    "correct_option",
    "correctness",
    "distractor_rationales",
    "expected_reasoning_patterns",
    "possible_misconception_indicators",
    "ability_profile",
    "engagement_profile",
    "integrated_diagnostic_profile",
    "formative_value"
  ];

  for (const field of forbidden) {
    assert(!serialized.includes(field), `Student UI payload leaked ${field}.`);
  }
}

async function cleanupTempStudent(userDbId: string, sessionPublicIds: string[]) {
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

  await prisma.workflowOverride.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.workflowJob.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.studentActionIdempotencyKey.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.responsePackage.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.itemResponse.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.conceptUnitSession.deleteMany({
    where: { id: { in: conceptUnitSessionIds } }
  });
  await prisma.assessmentSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await prisma.user.deleteMany({
    where: { id: userDbId }
  });
}

async function expectStudentError(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, `Expected ${code} StudentAssessmentServiceError.`);
    assert(error.code === code, `Expected ${code}, received ${error.code}.`);
    return;
  }

  throw new Error(`Expected ${code} error.`);
}

function itemRole(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const role = (value as Record<string, unknown>).item_role;
  return typeof role === "string" ? role : null;
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";

  await ensureDemoStudentAssessment(prisma);
  const fixedAssessment = await prisma.assessment.findUniqueOrThrow({
    where: { assessment_public_id: demoAssessmentPublicId },
    include: {
      concept_units: {
        include: {
          items: { orderBy: [{ item_order: "asc" }, { created_at: "asc" }] }
        }
      }
    }
  });
  assert(
    fixedAssessment.title === "IRT Theta Invariance and Item Parameters",
    "Fixed IRT MVP assessment title mismatch."
  );
  const fixedConceptUnit = fixedAssessment.concept_units[0];
  assert(fixedConceptUnit, "Fixed IRT MVP concept unit is missing.");
  assert(
    fixedConceptUnit.title === "Theta invariance across calibrated IRT forms",
    "Fixed IRT MVP concept-unit title mismatch."
  );
  assert(fixedConceptUnit.items.length === 4, "Fixed IRT MVP item set should contain 4 items.");
  const initialItems = fixedConceptUnit.items.filter((item) => item.included_in_published_set);
  const transferItems = fixedConceptUnit.items.filter(
    (item) => itemRole(item.administration_rules) === "transfer"
  );
  assert(initialItems.length === 3, "Fixed IRT MVP should include 3 initial items.");
  assert(transferItems.length === 1, "Fixed IRT MVP should include 1 transfer item.");
  assert(
    transferItems[0]?.item_public_id === demoItemPublicIds[3] &&
      transferItems[0].included_in_published_set === false,
    "Transfer item should be stored but excluded from the initial package."
  );
  assert(
    fixedConceptUnit.items.every((item) => Array.isArray(item.options) && item.options.length === 4),
    "Every fixed IRT MVP item should have A/B/C/D options."
  );
  assert(
    fixedConceptUnit.items.every((item) => typeof item.correct_option === "string" && item.correct_option.length === 1),
    "Every fixed IRT MVP item should store a correct option internally."
  );

  const userId = `phase4b_ui_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const accessCodeHash = await hashSecret("phase4b_ui_smoke_access_code");
  const student = await prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      role: "student",
      access_code_hash: accessCodeHash
    }
  });
  const sessionPublicIds: string[] = [];

  try {
    const available = await listAvailableAssessments({ student_user_db_id: student.id });
    assertNoForbiddenFields(available);
    assert(
      available.assessments.some(
        (assessment) => assessment.assessment_public_id === demoAssessmentPublicId && assessment.can_start
      ),
      "Demo assessment was not available to the temporary student."
    );

    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    sessionPublicIds.push(started.session.session_public_id);
    assertNoForbiddenFields(started);
    assert(
      started.state.current_concept_unit?.title === "Theta invariance across calibrated IRT forms",
      "Student session did not start on the fixed IRT concept unit."
    );

    let frame = buildStudentConversationFrame(started.state);
    assert(frame.interaction_type === "concept_unit_intro", "Expected concept unit intro frame.");

    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "present_item", "Expected present item frame.");
    const item1 = state.current_item;
    assert(item1, "Item 1 was missing.");
    assert(
      item1.item_public_id === demoItemPublicIds[0] &&
        item1.item_stem.includes("two item sets to measure the same mathematics ability"),
      "First fixed IRT item was not presented first."
    );
    assertNoForbiddenFields(item1);

    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item1.item_public_id,
        data: { selected_option: item1.options[0]?.label, client_action_id: `${userId}_item1_option` }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "request_reasoning", "Expected reasoning frame.");

    state = (
      await recordReasoning({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item1.item_public_id,
        data: {
          reasoning_text: "I am explaining my current thinking without receiving feedback.",
          client_action_id: `${userId}_item1_reasoning`
        }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "request_confidence", "Expected confidence frame.");

    state = (
      await recordConfidence({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item1.item_public_id,
        data: { confidence_rating: "medium", client_action_id: `${userId}_item1_confidence` }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(
      frame.interaction_type === "request_tempting_option",
      "Expected tempting-option evidence frame."
    );
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item1.item_public_id,
        data: { no_tempting_option: true, client_action_id: `${userId}_item1_tempting_no` }
      })
    ).state;

    const item2 = state.current_item;
    assert(item2, "Item 2 was missing.");
    assert(item2.item_public_id === demoItemPublicIds[1], "Second fixed IRT item was not presented second.");
    await recordSelectedOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item2.item_public_id,
      data: { selected_option: item2.options[0]?.label, client_action_id: `${userId}_item2_option` }
    });
    await recordReasoning({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item2.item_public_id,
      data: {
        reasoning_text: "I added missing reasoning after the repair prompt.",
        client_action_id: `${userId}_item2_reasoning`
      }
    });
    await recordConfidence({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item2.item_public_id,
      data: { confidence_rating: "low", client_action_id: `${userId}_item2_confidence` }
    });
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item2.item_public_id,
        data: { no_tempting_option: true, client_action_id: `${userId}_item2_tempting_no` }
      })
    ).state;

    const item3 = state.current_item;
    assert(item3, "Item 3 was missing.");
    assert(item3.item_public_id === demoItemPublicIds[2], "Third fixed IRT item was not presented third.");
    await recordSelectedOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item3.item_public_id,
      data: { selected_option: item3.options[0]?.label, client_action_id: `${userId}_item3_option` }
    });
    await recordReasoning({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item3.item_public_id,
      data: {
        reasoning_text: "I am completing the third chat-native response.",
        client_action_id: `${userId}_item3_reasoning`
      }
    });
    await recordConfidence({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item3.item_public_id,
      data: { confidence_rating: "high", client_action_id: `${userId}_item3_confidence` }
    });
    const temptingOption = item3.options[1]?.label ?? item3.options[0]?.label;
    assert(temptingOption, "Item 3 needs a tempting option.");
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item3.item_public_id,
        data: {
          tempting_option: temptingOption,
          client_action_id: `${userId}_item3_tempting_option`
        }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "request_tempting_reason", "Expected tempting reason frame.");
    state = (
      await recordTemptingOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item3.item_public_id,
        data: {
          tempting_option_reason: "It used related wording from the item.",
          client_action_id: `${userId}_item3_tempting_reason`
        }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "package_review", "Expected package review frame.");
    assert(!state.current_item, "Transfer item should not appear during the initial package review.");

    state = (
      await completeInitialConceptUnitAdministration({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "awaiting_profiling", "Expected awaiting-profiling frame.");
    assertNoForbiddenFields(frame);

    const review = await getStudentReviewResponses({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(review.locked, "Review should be read-only after completion.");
    assert(review.items.length === 3, "Package review should include only the 3 initial items.");
    assert(
      !review.items.some((item) => item.item_public_id === demoItemPublicIds[3]),
      "Package review should not include the transfer item."
    );
    assert(review.items[0]?.no_tempting_option === true, "Review should show no tempting option for item 1.");
    assert(review.items[1]?.no_tempting_option === true, "Review should show no tempting option for item 2.");
    assert(
      review.items[2]?.tempting_option === temptingOption &&
        review.items[2]?.tempting_option_reason === "It used related wording from the item.",
      "Review should show tempting-option evidence for item 3."
    );
    assertNoForbiddenFields(review);

    const transcript = await getStudentSafeTranscript({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(transcript.transcript.length > 0, "Transcript was empty.");
    assertNoForbiddenFields(transcript);

    await expectStudentError(
      () =>
        recordReasoning({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          item_public_id: item1.item_public_id,
          data: {
            reasoning_text: "This edit should be locked.",
            client_action_id: `${userId}_locked_edit`
          }
        }),
      "initial_response_locked_after_concept_completion"
    );

    console.log("Phase 4B student UI smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanupTempStudent(student.id, sessionPublicIds);
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
