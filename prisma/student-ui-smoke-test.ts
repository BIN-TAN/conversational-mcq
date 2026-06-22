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
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitItemResponse
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
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

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";

  await ensureDemoStudentAssessment(prisma);

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
    assert(frame.interaction_type === "item_completed", "Expected item completed frame.");

    state = (
      await submitItemResponse({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item1.item_public_id,
        data: { client_action_id: `${userId}_item1_submit` }
      })
    ).state;

    await recordSelectedOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item1.item_public_id,
      data: { selected_option: item1.options[1]?.label, client_action_id: `${userId}_item1_revise` }
    });
    await recordReasoning({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item1.item_public_id,
      data: {
        reasoning_text: "I revised this before the concept unit was completed.",
        client_action_id: `${userId}_item1_reasoning_revise`
      }
    });

    const item2 = state.current_item;
    assert(item2, "Item 2 was missing.");
    const repair = await submitItemResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item2.item_public_id,
      data: { client_action_id: `${userId}_item2_missing` }
    });
    assert(
      repair.submission_status === "missing_evidence_repair_required",
      "Missing evidence repair was not rendered by service state."
    );
    frame = buildStudentConversationFrame(repair.state);
    assert(frame.interaction_type === "missing_evidence_repair", "Expected missing evidence frame.");

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
      await submitItemResponse({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item2.item_public_id,
        data: { client_action_id: `${userId}_item2_submit` }
      })
    ).state;

    const item3 = state.current_item;
    assert(item3, "Item 3 was missing.");
    const repair2 = await submitItemResponse({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: item3.item_public_id,
      data: { client_action_id: `${userId}_item3_missing` }
    });
    assert(
      repair2.submission_status === "missing_evidence_repair_required",
      "Second missing evidence scenario did not trigger."
    );
    state = (
      await submitItemResponse({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: item3.item_public_id,
        data: { confirm_skip: true, client_action_id: `${userId}_item3_skip` }
      })
    ).state;
    frame = buildStudentConversationFrame(state);
    assert(frame.interaction_type === "concept_unit_completed", "Expected concept-unit completion frame.");

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
