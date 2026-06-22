import { PrismaClient } from "@prisma/client";
import { generatePublicId } from "../src/lib/services/ids";
import { listAvailableAssessments, startOrResumeStudentAssessmentSession } from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import { updateAssessment } from "../src/lib/services/content/assessments";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { cleanupFollowupSmoke, assert } from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `phase6d2a_availability_${Date.now()}`;

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

async function createValidAssessment(input: {
  teacherId: string;
  title: string;
  releaseAt?: Date | null;
  closeAt?: Date | null;
}) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: input.title,
      description: "Phase 6D2A availability smoke fixture.",
      status: "published",
      workflow_mode: "automatic",
      release_at: input.releaseAt ?? null,
      close_at: input.closeAt ?? null,
      created_by_user_db_id: input.teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `${input.title} concept`,
      learning_objective: "Verify availability behavior.",
      related_concept_description: "Temporary concept for availability smoke.",
      administration_rules: {},
      order_index: 1,
      status: "published",
      version: 1
    }
  });

  for (const order of [1, 2, 3]) {
    await prisma.item.create({
      data: {
        item_public_id: generatePublicId("item"),
        concept_unit_db_id: conceptUnit.id,
        item_order: order,
        item_stem: `${input.title} item ${order}`,
        options: [
          { label: "A", text: "Correct" },
          { label: "B", text: "Distractor" },
          { label: "C", text: "Distractor" }
        ],
        correct_option: "A",
        distractor_rationales: { B: "Partial distractor", C: "Misconception distractor" },
        expected_reasoning_patterns: ["Explains why A is supported."],
        possible_misconception_indicators: ["Selects C with reversed reasoning."],
        administration_rules: {},
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
  }

  return { assessment, conceptUnit };
}

async function expectStudentStartError(assessmentPublicId: string, studentId: string, code: string) {
  try {
    await startOrResumeStudentAssessmentSession({
      student_user_db_id: studentId,
      assessment_public_id: assessmentPublicId
    });
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, `Expected ${code} student error.`);
    assert(error.code === code, `Expected ${code}, received ${error.code}.`);
    return;
  }

  throw new Error(`Expected ${code} student start error.`);
}

async function main() {
  process.env.COURSE_TIMEZONE = "America/Edmonton";
  await cleanupFollowupSmoke(prisma, prefix);

  const teacher = await prisma.user.create({
    data: {
      user_id: `${prefix}_teacher`,
      role: "teacher_researcher"
    }
  });
  const student = await prisma.user.create({
    data: {
      user_id: `${prefix}_student`,
      role: "student"
    }
  });
  const now = new Date();
  const open = await createValidAssessment({
    teacherId: teacher.id,
    title: `${prefix} open`
  });
  const future = await createValidAssessment({
    teacherId: teacher.id,
    title: `${prefix} future`,
    releaseAt: minutesAfter(now, 60)
  });
  const closed = await createValidAssessment({
    teacherId: teacher.id,
    title: `${prefix} closed`,
    releaseAt: minutesAfter(now, -120),
    closeAt: minutesAfter(now, -30)
  });
  const closedResume = await createValidAssessment({
    teacherId: teacher.id,
    title: `${prefix} closed resume`,
    releaseAt: minutesAfter(now, -120),
    closeAt: minutesAfter(now, -30)
  });
  const resumeSession = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: closedResume.assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "concept_unit_intro",
      workflow_mode_snapshot: "automatic",
      current_concept_unit_db_id: closedResume.conceptUnit.id,
      started_at: minutesAfter(now, -90),
      last_activity_at: minutesAfter(now, -70)
    }
  });
  await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: resumeSession.id,
      concept_unit_db_id: closedResume.conceptUnit.id,
      status: "initial_in_progress",
      initial_started_at: minutesAfter(now, -90)
    }
  });

  const available = await listAvailableAssessments({ student_user_db_id: student.id });
  const openRow = available.assessments.find(
    (assessment) => assessment.assessment_public_id === open.assessment.assessment_public_id
  );
  const futureRow = available.assessments.find(
    (assessment) => assessment.assessment_public_id === future.assessment.assessment_public_id
  );
  const closedRow = available.assessments.find(
    (assessment) => assessment.assessment_public_id === closed.assessment.assessment_public_id
  );
  const resumeRow = available.assessments.find(
    (assessment) => assessment.assessment_public_id === closedResume.assessment.assessment_public_id
  );

  assert(openRow?.availability_state === "open", "Open assessment should be open.");
  assert(openRow.can_start, "Open assessment should allow new starts.");
  assert(futureRow?.availability_state === "not_released", "Future assessment should not be released.");
  assert(!futureRow.can_start, "Future assessment should block new starts.");
  assert(closedRow?.availability_state === "closed_to_new_starts", "Closed assessment should block new starts.");
  assert(!closedRow.can_start, "Closed assessment without existing session should not start.");
  assert(resumeRow?.availability_state === "closed_to_new_starts", "Closed resume assessment should remain closed to new starts.");
  assert(resumeRow.can_resume, "Existing session should be resumable after close.");

  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: open.assessment.assessment_public_id
  });
  assert(started.session.session_public_id, "Open assessment start should create session.");
  await expectStudentStartError(future.assessment.assessment_public_id, student.id, "assessment_not_released");
  await expectStudentStartError(closed.assessment.assessment_public_id, student.id, "assessment_closed_to_new_starts");

  const resumed = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: closedResume.assessment.assessment_public_id
  });
  assert(
    resumed.session.session_public_id === resumeSession.session_public_id,
    "Closed assessment should resume existing session."
  );

  try {
    await updateAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: open.assessment.assessment_public_id,
      data: {
        release_at_course_time: "2026-06-21T10:00",
        close_at_course_time: "2026-06-21T09:00"
      }
    });
    throw new Error("Expected invalid availability window.");
  } catch (error) {
    assert(error instanceof ContentServiceError, "Expected ContentServiceError for invalid window.");
    assert(error.code === "validation_failed", "Invalid window should be a validation failure.");
    assert(
      JSON.stringify(error.details).includes("invalid_assessment_availability_window"),
      "Invalid window details should include invalid_assessment_availability_window."
    );
  }

  await cleanupFollowupSmoke(prisma, prefix);
  console.log("assessment availability smoke passed");
}

main()
  .catch(async (error) => {
    console.error(error);
    await cleanupFollowupSmoke(prisma, prefix).catch(() => null);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
