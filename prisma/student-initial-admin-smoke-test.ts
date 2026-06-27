import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createAssessment, updateAssessment, archiveAssessment } from "../src/lib/services/content/assessments";
import { createConceptUnit } from "../src/lib/services/content/concept-units";
import { createItem } from "../src/lib/services/content/items";
import { publishAssessment, publishConceptUnit } from "../src/lib/services/content/publishing";
import { ContentServiceError } from "../src/lib/services/content/errors";
import {
  completeInitialConceptUnitAdministration,
  exitStudentAssessmentSession,
  getStudentSessionState,
  ingestFrontendProcessEvents,
  listAvailableAssessments,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitItemResponse
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertStudentError(
  action: () => Promise<unknown>,
  code: string,
  message: string
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, `${message}: expected StudentAssessmentServiceError.`);
    assert(error.code === code, `${message}: expected ${code}, received ${error.code}.`);
    return;
  }

  throw new Error(`${message}: expected ${code} error.`);
}

async function assertContentError(
  action: () => Promise<unknown>,
  code: string,
  message: string
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ContentServiceError, `${message}: expected ContentServiceError.`);
    assert(error.code === code, `${message}: expected ${code}, received ${error.code}.`);
    return;
  }

  throw new Error(`${message}: expected ${code} error.`);
}

function assertNoForbiddenStudentFields(value: unknown) {
  assertStudentPayloadIsSafe(value);
  const serialized = JSON.stringify(value);
  const forbidden = [
    "correct_option",
    "correctness",
    "distractor_rationales",
    "expected_reasoning_patterns",
    "possible_misconception_indicators"
  ];

  for (const field of forbidden) {
    assert(!serialized.includes(field), `Student payload leaked ${field}.`);
  }
}

function validItemInput(itemOrder: number) {
  return {
    item_stem: `Phase 4A smoke item ${itemOrder}`,
    options: [
      { label: "A", text: "Correct option" },
      { label: "B", text: "Partial answer" },
      { label: "C", text: "Misconception answer" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B reflects partial understanding.",
      C: "C reflects a plausible misconception."
    },
    expected_reasoning_patterns: ["Explains why A is supported."],
    possible_misconception_indicators: ["Chooses B or C with aligned reasoning."],
    administration_rules: { no_feedback_during_initial_administration: true },
    included_in_published_set: true,
    item_order: itemOrder
  };
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";

  const prefix = `phase4a_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const created = {
    userIds: [] as string[],
    assessmentPublicIds: [] as string[],
    conceptUnitPublicIds: [] as string[],
    itemPublicIds: [] as string[],
    sessionPublicIds: [] as string[]
  };

  try {
    const [teacherPasswordHash, studentAccessCodeHash, otherAccessCodeHash] = await Promise.all([
      hashSecret("teacher_demo_password"),
      hashSecret("student_demo_access_code"),
      hashSecret("other_student_access_code")
    ]);
    const teacher = await prisma.user.upsert({
      where: { user_id: "teacher_demo" },
      update: {
        role: "teacher_researcher",
        user_id_normalized: normalizeUserId("teacher_demo"),
        password_hash: teacherPasswordHash,
        access_code_hash: null
      },
      create: {
        user_id: "teacher_demo",
        user_id_normalized: normalizeUserId("teacher_demo"),
        role: "teacher_researcher",
        password_hash: teacherPasswordHash
      }
    });
    const student = await prisma.user.create({
      data: {
        user_id: `${prefix}_student`,
        user_id_normalized: normalizeUserId(`${prefix}_student`),
        role: "student",
        access_code_hash: studentAccessCodeHash
      }
    });
    const otherStudent = await prisma.user.create({
      data: {
        user_id: `${prefix}_other_student`,
        user_id_normalized: normalizeUserId(`${prefix}_other_student`),
        role: "student",
        access_code_hash: otherAccessCodeHash
      }
    });
    created.userIds.push(student.id, otherStudent.id);

    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Phase 4A smoke assessment ${prefix}`,
        description: "Temporary Phase 4A backend smoke assessment.",
        workflow_mode: "manual_review"
      }
    });
    created.assessmentPublicIds.push(assessment.assessment_public_id);

    const conceptUnit = await createConceptUnit({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        title: "Teacher-defined initial administration concept",
        learning_objective: "Verify backend initial administration.",
        related_concept_description: "Temporary teacher-defined concept boundary.",
        administration_rules: { initial_administration: "no_feedback" }
      }
    });
    created.conceptUnitPublicIds.push(conceptUnit.concept_unit_public_id);

    const items: Array<{ item_public_id: string }> = [];
    for (const itemOrder of [1, 2, 3]) {
      const item = await createItem({
        teacher_user_db_id: teacher.id,
        concept_unit_public_id: conceptUnit.concept_unit_public_id,
        data: validItemInput(itemOrder)
      });
      items.push(item);
      created.itemPublicIds.push(item.item_public_id);
    }

    await publishConceptUnit({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id,
      confirm_publish_without_current_verification: true
    });
    await publishAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });

    const availableBeforeStart = await listAvailableAssessments({
      student_user_db_id: student.id
    });
    assertNoForbiddenStudentFields(availableBeforeStart);
    assert(
      availableBeforeStart.assessments.some(
        (entry) => entry.assessment_public_id === assessment.assessment_public_id && entry.can_start
      ),
      "Published assessment was not available to the student."
    );

    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: assessment.assessment_public_id
    });
    created.sessionPublicIds.push(started.session.session_public_id);
    assertNoForbiddenStudentFields(started);
    assert(
      started.state.current_concept_unit?.concept_unit_public_id === conceptUnit.concept_unit_public_id,
      "Start did not select the first teacher-ordered concept unit."
    );
    assert(started.state.next_step === "concept_unit_intro", "Start should enter concept_unit_intro.");

    await assertContentError(
      () =>
        updateAssessment({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessment.assessment_public_id,
          data: { title: "Blocked after student session" }
        }),
      "content_locked_after_student_session",
      "Starting a student session should lock assessment content"
    );

    const resumed = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(
      resumed.session.session_public_id === started.session.session_public_id,
      "Repeated start did not resume the existing attempt."
    );
    const sessionCount = await prisma.assessmentSession.count({
      where: {
        user_db_id: student.id,
        assessment: { assessment_public_id: assessment.assessment_public_id },
        attempt_number: 1
      }
    });
    assert(sessionCount === 1, "Duplicate attempt-1 session was created.");

    const initialState = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assertNoForbiddenStudentFields(initialState);
    assert(initialState.next_step === "present_item", "Concept unit start should present the first item.");
    assert(initialState.current_item?.item_public_id === items[0].item_public_id, "First item order was not respected.");

    const optionFirst = await recordSelectedOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[0].item_public_id,
      data: { selected_option: "A", client_action_id: `${prefix}_item1_option_a` }
    });
    assertNoForbiddenStudentFields(optionFirst);
    const optionRepeat = await recordSelectedOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[0].item_public_id,
      data: { selected_option: "A", client_action_id: `${prefix}_item1_option_a` }
    });
    assertNoForbiddenStudentFields(optionRepeat);
    await assertStudentError(
      () =>
        recordSelectedOption({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          item_public_id: items[0].item_public_id,
          data: { selected_option: "B", client_action_id: `${prefix}_item1_option_a` }
        }),
      "idempotency_conflict",
      "Idempotency conflict should be rejected"
    );

    await recordReasoning({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[0].item_public_id,
      data: {
        reasoning_text: "A is supported by the condition in the stem.",
        client_action_id: `${prefix}_item1_reasoning`
      }
    });
    await recordConfidence({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[0].item_public_id,
      data: { confidence_rating: "high", client_action_id: `${prefix}_item1_confidence` }
    });
    await assertStudentError(
      () =>
        submitItemResponse({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          item_public_id: items[0].item_public_id,
          data: { client_action_id: `${prefix}_item1_submit_before_tempting` }
        }),
      "invalid_phase_for_action",
      "Item-level submit should not bypass tempting-option evidence"
    );
    const completedFirst = await recordTemptingOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[0].item_public_id,
      data: { no_tempting_option: true, client_action_id: `${prefix}_item1_tempting_no` }
    });
    assertNoForbiddenStudentFields(completedFirst);
    assert(
      completedFirst.state.current_item?.item_public_id === items[1].item_public_id,
      "Completing item 1 should advance to item 2."
    );

    const firstResponseAfterSubmit = await prisma.itemResponse.findFirstOrThrow({
      where: { item: { item_public_id: items[0].item_public_id } },
      select: { correctness: true, revision_count: true }
    });
    assert(firstResponseAfterSubmit.correctness === "correct", "Correctness was not calculated by the backend.");
    assert(firstResponseAfterSubmit.revision_count === 0, "Completed item should not be revised in chat-native flow.");

    await recordSelectedOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[1].item_public_id,
      data: { selected_option: "A", client_action_id: `${prefix}_item2_option` }
    });
    await recordReasoning({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[1].item_public_id,
      data: {
        reasoning_text: "The second item also supports A.",
        client_action_id: `${prefix}_item2_reasoning`
      }
    });
    await recordConfidence({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[1].item_public_id,
      data: { confidence_rating: "low", client_action_id: `${prefix}_item2_confidence` }
    });
    const completedSecond = await recordTemptingOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[1].item_public_id,
      data: { no_tempting_option: true, client_action_id: `${prefix}_item2_tempting_no` }
    });
    assertNoForbiddenStudentFields(completedSecond);
    assert(
      completedSecond.state.current_item?.item_public_id === items[2].item_public_id,
      "Completing item 2 should advance to item 3."
    );
    const secondResponse = await prisma.itemResponse.findFirstOrThrow({
      where: { item: { item_public_id: items[1].item_public_id } },
      select: {
        correctness: true,
        skipped_item: true,
        skipped_reasoning: true,
        skipped_confidence: true
      }
    });
    assert(secondResponse.correctness === "correct", "Item 2 backend correctness mismatch.");
    assert(!secondResponse.skipped_item, "Item 2 should not be stored as skipped.");
    assert(!secondResponse.skipped_reasoning, "Item 2 reasoning should not be skipped.");
    assert(!secondResponse.skipped_confidence, "Item 2 confidence should not be skipped.");

    const acceptedEvents = await ingestFrontendProcessEvents({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      data: {
        events: [
          {
            event_type: "page_hidden",
            visibility_duration_ms: 250,
            client_occurred_at: new Date().toISOString(),
            payload: { browser_visibility: "hidden" }
          }
        ]
      }
    });
    assert(acceptedEvents.accepted_event_count === 1, "Frontend event was not accepted.");
    await assertStudentError(
      () =>
        ingestFrontendProcessEvents({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          data: { event_type: "invalid_help_request" }
        }),
      "validation_failed",
      "Forbidden frontend event type should be rejected"
    );

    await recordSelectedOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[2].item_public_id,
      data: { selected_option: "A", client_action_id: `${prefix}_item3_option` }
    });
    await recordReasoning({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[2].item_public_id,
      data: {
        reasoning_text: "The final item also supports A.",
        client_action_id: `${prefix}_item3_reasoning`
      }
    });
    await recordConfidence({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[2].item_public_id,
      data: { confidence_rating: "medium", client_action_id: `${prefix}_item3_confidence` }
    });
    await recordTemptingOption({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      item_public_id: items[2].item_public_id,
      data: { no_tempting_option: true, client_action_id: `${prefix}_item3_tempting_no` }
    });

    const completed = await completeInitialConceptUnitAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(completed.completion_status === "completed", "Concept-unit completion did not complete.");
    assert(completed.state.current_phase === "planning_completed", "Session did not prepare the formative activity.");
    assert(completed.state.next_step === "formative_activity", "Completion should show the formative activity.");
    const packageCount = await prisma.responsePackage.count({
      where: {
        concept_unit_session: {
          assessment_session: { session_public_id: started.session.session_public_id }
        },
        package_type: "initial_concept_unit_response_package"
      }
    });
    assert(packageCount === 1, "Initial response package was not created exactly once.");

    await assertStudentError(
      () =>
        recordReasoning({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          item_public_id: items[0].item_public_id,
          data: {
            reasoning_text: "Attempt after concept completion.",
            client_action_id: `${prefix}_locked_reasoning`
          }
        }),
      "initial_response_locked_after_concept_completion",
      "Initial responses should be locked after completion"
    );

    await assertStudentError(
      () =>
        getStudentSessionState({
          student_user_db_id: otherStudent.id,
          session_public_id: started.session.session_public_id
        }),
      "session_not_owned",
      "Another student should not access the session"
    );

    const exited = await exitStudentAssessmentSession({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(exited.exit_status === "student_exited", "Student exit did not preserve a resumable session.");

    await archiveAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    await assertStudentError(
      () =>
        startOrResumeStudentAssessmentSession({
          student_user_db_id: otherStudent.id,
          assessment_public_id: assessment.assessment_public_id
        }),
      "assessment_archived",
      "Archived assessment should not start for another student"
    );

    console.log("Phase 4A student initial administration smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    if (created.sessionPublicIds.length > 0) {
      const sessions = await prisma.assessmentSession.findMany({
        where: { session_public_id: { in: created.sessionPublicIds } },
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
      await prisma.processEvent.deleteMany({
        where: { assessment_session_db_id: { in: sessionIds } }
      });
      await prisma.conversationTurn.deleteMany({
        where: { assessment_session_db_id: { in: sessionIds } }
      });
      await prisma.followupRound.deleteMany({
        where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
      });
      await prisma.formativeDecision.deleteMany({
        where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
      });
      await prisma.studentProfile.deleteMany({
        where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
      });
      await prisma.agentCall.deleteMany({
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
    }

    if (created.itemPublicIds.length > 0) {
      await prisma.item.deleteMany({
        where: { item_public_id: { in: created.itemPublicIds } }
      });
    }

    if (created.conceptUnitPublicIds.length > 0) {
      await prisma.conceptUnit.deleteMany({
        where: { concept_unit_public_id: { in: created.conceptUnitPublicIds } }
      });
    }

    if (created.assessmentPublicIds.length > 0) {
      await prisma.assessment.deleteMany({
        where: { assessment_public_id: { in: created.assessmentPublicIds } }
      });
    }

    if (created.userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: created.userIds } }
      });
    }
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
