import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { buildAssessmentInterpretationContextFromResponsePackage } from "../src/lib/services/student-assessment/assessment-interpretation-context";
import {
  completeInitialConceptUnitAdministration,
  exitStudentAssessmentSession,
  getStudentSessionState,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import { downloadTeacherAssessmentDashboardCsv, getTeacherAssessmentDashboard } from "../src/lib/services/teacher-dashboard/assessment-dashboard";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { completeInitialItem, createSmokeStudent } from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup(prefix: string) {
  const users = await prisma.user.findMany({
    where: { user_id: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const assessments = await prisma.assessment.findMany({
    where: { assessment_public_id: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const sessions = await prisma.assessmentSession.findMany({
    where: {
      OR: [
        { user_db_id: { in: userIds } },
        { assessment_db_id: { in: assessmentIds } }
      ]
    },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);
  const conceptUnits = await prisma.conceptUnit.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const conceptUnitIds = conceptUnits.map((unit) => unit.id);

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
  await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptUnitIds } } });
  await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptUnitIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function createTeacher(prefix: string) {
  return prisma.user.create({
    data: {
      user_id: `${prefix}_teacher`,
      user_id_normalized: normalizeUserId(`${prefix}_teacher`),
      role: "teacher_researcher",
      password_hash: await hashSecret(`${prefix}_teacher_password`)
    }
  });
}

async function createAssessment(input: {
  prefix: string;
  teacherDbId: string;
  itemCount: number;
  extraExcludedItem?: boolean;
}) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: `${input.prefix}_assessment_${input.itemCount}`,
      title: `Dynamic ${input.itemCount} item smoke`,
      description: "Synthetic dynamic item-count smoke assessment.",
      diagnostic_focus: "Distinguish person theta from item parameters.",
      status: "published",
      created_by_user_db_id: input.teacherDbId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `${input.prefix}_concept_${input.itemCount}`,
      assessment_db_id: assessment.id,
      title: `Dynamic ${input.itemCount} item concept`,
      learning_objective: "Use MCQ response evidence without assuming a fixed item count.",
      related_concept_description: "Synthetic theta and item-parameter distinction.",
      order_index: 1,
      status: "published"
    }
  });

  for (let index = 1; index <= input.itemCount; index += 1) {
    await prisma.item.create({
      data: {
        item_public_id: `${input.prefix}_item_${input.itemCount}_${index}`,
        concept_unit_db_id: conceptUnit.id,
        item_order: index,
        item_stem: `Dynamic item ${index}: which statement best separates theta from item parameters?`,
        options: [
          { label: "A", text: "Theta is a person location; item parameters describe item behavior." },
          { label: "B", text: "Theta and item difficulty are always the same value." },
          { label: "C", text: "Only the selected option determines theta." },
          { label: "D", text: "Confidence alone is enough to estimate the item." }
        ],
        correct_option: "A",
        status: "published",
        included_in_published_set: true,
        version: 1,
        administration_rules: {
          item_role: "initial",
          cognitive_demand: "conceptual_distinction",
          difficulty: "moderate",
          knowledge_component: "theta_item_parameter_distinction",
          misconception_cluster: "theta_item_confusion"
        }
      }
    });
  }

  if (input.extraExcludedItem) {
    await prisma.item.create({
      data: {
        item_public_id: `${input.prefix}_excluded_${input.itemCount}`,
        concept_unit_db_id: conceptUnit.id,
        item_order: input.itemCount + 1,
        item_stem: "Excluded item should not be administered.",
        options: [
          { label: "A", text: "Excluded A" },
          { label: "B", text: "Excluded B" },
          { label: "C", text: "Excluded C" },
          { label: "D", text: "Excluded D" }
        ],
        correct_option: "A",
        status: "published",
        included_in_published_set: false,
        version: 1
      }
    });
  }

  return { assessment, conceptUnit };
}

async function startDynamicSession(input: {
  studentDbId: string;
  assessmentPublicId: string;
  conceptUnitPublicId: string;
}) {
  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: input.studentDbId,
    assessment_public_id: input.assessmentPublicId
  });
  const state = await startConceptUnitInitialAdministration({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: input.conceptUnitPublicId
  });
  return { started, state };
}

async function completeDynamicPackage(input: {
  studentDbId: string;
  sessionPublicId: string;
  state: Awaited<ReturnType<typeof getStudentSessionState>>;
  itemCount: number;
  startIndex?: number;
  prefix: string;
}) {
  let state = input.state;
  for (let index = input.startIndex ?? 1; index <= input.itemCount; index += 1) {
    assert(state.current_item, `Expected current item ${index}.`);
    assert(state.current_item.initial_item_position === index, `Expected item position ${index}.`);
    assert(state.current_item.initial_item_total === input.itemCount, `Expected item total ${input.itemCount}.`);
    assert(state.progress.initial_item_count === input.itemCount, "State should expose actual initial item count.");

    state = await completeInitialItem({
      studentDbId: input.studentDbId,
      sessionPublicId: input.sessionPublicId,
      prefix: `${input.prefix}_${input.itemCount}_${index}`,
      state,
      itemIndex: index
    });

    if (index < input.itemCount) {
      assert(
        state.assessment_state !== "PACKAGE_REVIEW",
        `Package review should not open after item ${index} of ${input.itemCount}.`
      );
      assert(state.current_item?.initial_item_position === index + 1, "Next item position should advance by one.");
    }
  }

  assert(state.assessment_state === "PACKAGE_REVIEW", "Package review should open after item N.");
  assert(state.progress.completed_initial_item_count === input.itemCount, "Completed count should match item N.");
  return state;
}

async function assertZeroItemFailClosed(prefix: string, teacherDbId: string, studentDbId: string) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: `${prefix}_zero_assessment`,
      title: "Zero item smoke",
      status: "published",
      created_by_user_db_id: teacherDbId
    }
  });
  await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `${prefix}_zero_concept`,
      assessment_db_id: assessment.id,
      title: "Zero item concept",
      learning_objective: "Fail closed when no initial items exist.",
      related_concept_description: "Synthetic zero-item fail-closed fixture.",
      order_index: 1,
      status: "published"
    }
  });

  try {
    await startOrResumeStudentAssessmentSession({
      student_user_db_id: studentDbId,
      assessment_public_id: assessment.assessment_public_id
    });
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, "Zero-item start should fail with service error.");
    assert(
      error.code === "assessment_has_no_valid_published_concept_unit" || error.code === "assessment_not_available",
      `Unexpected zero-item error code: ${error.code}`
    );
    return;
  }

  throw new Error("Zero-item assessment should not be startable.");
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  const prefix = `dynamic_initial_count_${Date.now()}_${randomUUID().slice(0, 8)}`;
  await cleanup(prefix);

  try {
    const teacher = await createTeacher(prefix);
    const student = await createSmokeStudent({
      prisma,
      prefix: `${prefix}_student`,
      accessCode: `${prefix}_access`
    });

    for (const itemCount of [3, 4, 5]) {
      const { assessment, conceptUnit } = await createAssessment({
        prefix,
        teacherDbId: teacher.id,
        itemCount,
        extraExcludedItem: itemCount === 5
      });
      const { started, state: initialState } = await startDynamicSession({
        studentDbId: student.id,
        assessmentPublicId: assessment.assessment_public_id,
        conceptUnitPublicId: conceptUnit.concept_unit_public_id
      });

      assert(initialState.progress.initial_item_count === itemCount, `Expected ${itemCount} initial items.`);
      assert(initialState.current_item?.initial_item_position === 1, "First item should be position 1.");
      assert(initialState.current_item?.initial_item_total === itemCount, "First item should know total item count.");

      if (itemCount === 4) {
        let resumedState = await completeInitialItem({
          studentDbId: student.id,
          sessionPublicId: started.session.session_public_id,
          prefix: `${prefix}_resume`,
          state: initialState,
          itemIndex: 1
        });
        assert(resumedState.current_item?.initial_item_position === 2, "Resume fixture should advance to item 2.");
        await exitStudentAssessmentSession({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id
        });
        const resumed = await startOrResumeStudentAssessmentSession({
          student_user_db_id: student.id,
          assessment_public_id: assessment.assessment_public_id
        });
        assert(resumed.state.current_item?.initial_item_position === 2, "Resume should reopen the next incomplete item.");
        resumedState = await completeDynamicPackage({
          studentDbId: student.id,
          sessionPublicId: resumed.session.session_public_id,
          state: resumed.state,
          itemCount,
          startIndex: 2,
          prefix
        });
        assert(resumedState.assessment_state === "PACKAGE_REVIEW", "Resumed package should reach review.");
      } else {
        await completeDynamicPackage({
          studentDbId: student.id,
          sessionPublicId: started.session.session_public_id,
          state: initialState,
          itemCount,
          prefix
        });
      }

      await completeInitialConceptUnitAdministration({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        concept_unit_public_id: conceptUnit.concept_unit_public_id
      });

      const packageRecord = await prisma.responsePackage.findFirstOrThrow({
        where: {
          concept_unit_session: {
            assessment_session: {
              session_public_id: started.session.session_public_id
            }
          },
          package_type: "initial_concept_unit_response_package"
        }
      });
      const payload = packageRecord.payload as Record<string, unknown>;
      assert(payload.initial_item_count === itemCount, "Response package should store actual initial item count.");
      assert(
        payload.completed_initial_item_count === itemCount,
        "Response package should store completed initial item count."
      );
      assert(
        Array.isArray(payload.included_items) && payload.included_items.length === itemCount,
        "Response package should include only active included items."
      );
      assert(JSON.stringify(payload).includes(`"initial_item_count":${itemCount}`), "Package should expose count metadata.");

      const context = buildAssessmentInterpretationContextFromResponsePackage({
        response_package_payload: payload,
        phase: "post_initial_interpretation"
      });
      assert(
        context.observed_student_evidence.initial_item_count === itemCount,
        "Provider context should include actual initial item count."
      );
      assert(
        context.observed_student_evidence.completed_initial_item_count === itemCount,
        "Provider context should include completed initial item count."
      );

      const itemPresentedEvents = await prisma.processEvent.findMany({
        where: {
          assessment_session: { session_public_id: started.session.session_public_id },
          event_type: "item_presented"
        },
        select: { payload: true }
      });
      assert(itemPresentedEvents.length === itemCount, "One item_presented event should exist per included item.");
      assert(
        itemPresentedEvents.every((event) => (event.payload as Record<string, unknown>).initial_item_count === itemCount),
        "Item-presented events should record actual total item count."
      );
      const packageReviewEvent = await prisma.processEvent.findFirst({
        where: {
          assessment_session: { session_public_id: started.session.session_public_id },
          event_type: "package_review_opened"
        },
        select: { payload: true }
      });
      assert(packageReviewEvent, "Package review event should be logged.");
      assert(
        (packageReviewEvent.payload as Record<string, unknown>).initial_item_count === itemCount,
        "Package review event should record actual total item count."
      );
    }

    await assertZeroItemFailClosed(prefix, teacher.id, student.id);

    const dashboard = await getTeacherAssessmentDashboard({
      teacher_user_db_id: teacher.id,
      assessment_public_id: `${prefix}_assessment_5`
    });
    assert(
      dashboard.status_distribution.some((entry) => entry.label === "Started not completed" && entry.count === 1),
      "Dashboard should count the 5-item package submission as started-not-completed until the assessment completes."
    );
    assert(
      dashboard.status_distribution.reduce((total, entry) => total + entry.count, 0) === dashboard.eligible_student_count,
      "Dashboard participation categories should sum to total students."
    );
    const csv = await downloadTeacherAssessmentDashboardCsv({
      teacher_user_db_id: teacher.id,
      assessment_public_id: `${prefix}_assessment_5`
    });
    assert(csv.content.includes("participation_status"), "Dashboard export should include participation status rows.");
    assert(csv.content.includes("detailed_status_distribution"), "Dashboard export should preserve detailed status rows.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          dynamic_item_counts_checked: [3, 4, 5],
          completion_waited_until_item_n: true,
          resume_preserved_snapshot_position: true,
          included_filtering_checked: true,
          zero_item_fail_closed: true,
          process_events_include_counts: true,
          provider_context_includes_counts: true,
          dashboard_and_export_checked: true,
          openai_calls: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
