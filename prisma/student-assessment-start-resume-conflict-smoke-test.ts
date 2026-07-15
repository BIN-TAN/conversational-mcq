import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { generatePublicId } from "../src/lib/services/ids";
import {
  getStudentSessionState,
  listAvailableAssessments,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import {
  normalizeAssessmentStartErrorForStudent,
  shouldDisplayStudentApiErrorCode,
  startErrorRecoverySessionPublicId
} from "../src/lib/student-assessment-ui/start-errors";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { assert, cleanupFollowupSmoke, minutesAfter } from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `p0_start_resume_${Date.now()}`;

function setNoLiveRuntimeEnv() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "false";
}

async function createUser(input: { role: "student" | "teacher_researcher"; suffix: string }) {
  const userId = `${prefix}_${input.suffix}`;

  return prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      role: input.role
    }
  });
}

async function createAssessment(input: {
  teacherId: string;
  suffix: string;
  status?: "draft" | "published" | "archived";
  conceptUnitStatus?: "draft" | "published" | "archived";
  releaseAt?: Date | null;
  closeAt?: Date | null;
}) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${prefix} ${input.suffix}`,
      description: "P0 start/resume conflict smoke fixture.",
      status: input.status ?? "published",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      release_at: input.releaseAt ?? null,
      close_at: input.closeAt ?? null,
      created_by_user_db_id: input.teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `${prefix} ${input.suffix} concept`,
      learning_objective: "Verify deterministic start and resume behavior.",
      related_concept_description: "Synthetic concept for start/resume conflict testing.",
      administration_rules: {},
      order_index: 1,
      status: input.conceptUnitStatus ?? "published",
      version: 1
    }
  });

  for (const itemOrder of [1, 2, 3]) {
    await prisma.item.create({
      data: {
        item_public_id: generatePublicId("item"),
        concept_unit_db_id: conceptUnit.id,
        item_order: itemOrder,
        item_stem: `${prefix} ${input.suffix} item ${itemOrder}`,
        options: [
          { label: "A", text: "First option" },
          { label: "B", text: "Second option" },
          { label: "C", text: "Third option" },
          { label: "D", text: "Fourth option" }
        ],
        correct_option: "A",
        distractor_rationales: {
          B: "Synthetic distractor.",
          C: "Synthetic distractor.",
          D: "Synthetic distractor."
        },
        expected_reasoning_patterns: ["Explains the selected option."],
        possible_misconception_indicators: ["Uses unsupported item evidence."],
        administration_rules: {},
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
  }

  return { assessment, conceptUnit };
}

async function expectStudentStartError(input: {
  assessmentPublicId: string;
  studentDbId: string;
  code: string;
}) {
  try {
    await startOrResumeStudentAssessmentSession({
      student_user_db_id: input.studentDbId,
      assessment_public_id: input.assessmentPublicId
    });
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, `Expected ${input.code} service error.`);
    assert(error.code === input.code, `Expected ${input.code}, received ${error.code}.`);
    return error;
  }

  throw new Error(`Expected ${input.code} service error.`);
}

async function sessionStartedEventCount(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });

  return prisma.processEvent.count({
    where: {
      assessment_session_db_id: session.id,
      event_type: "session_started"
    }
  });
}

async function activeSessionCount(input: { studentDbId: string; assessmentDbId: string }) {
  const sessions = await prisma.assessmentSession.findMany({
    where: {
      user_db_id: input.studentDbId,
      assessment_db_id: input.assessmentDbId
    },
    select: { status: true, current_phase: true, completed_at: true }
  });

  return sessions.filter(
    (session) =>
      (session.status === "active" || session.status === "paused") &&
      session.current_phase !== "session_completed" &&
      session.current_phase !== "student_exited" &&
      !session.completed_at
  ).length;
}

async function availableRow(studentDbId: string, assessmentPublicId: string) {
  const available = await listAvailableAssessments({ student_user_db_id: studentDbId });
  const row = available.assessments.find(
    (assessment) => assessment.assessment_public_id === assessmentPublicId
  );

  assert(row, `Expected assessment ${assessmentPublicId} in availability list.`);
  return row;
}

async function main() {
  setNoLiveRuntimeEnv();
  await cleanupFollowupSmoke(prisma, prefix);

  const teacher = await createUser({ role: "teacher_researcher", suffix: "teacher" });
  const student = await createUser({ role: "student", suffix: "student" });
  const otherStudent = await createUser({ role: "student", suffix: "other_student" });

  const open = await createAssessment({
    teacherId: teacher.id,
    suffix: "open"
  });
  const initialRow = await availableRow(student.id, open.assessment.assessment_public_id);
  assert(initialRow.can_start === true, "Open assessment should initially allow a new start.");
  assert(initialRow.can_resume === false, "Open assessment should not initially show resume.");

  const firstStart = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: open.assessment.assessment_public_id
  });
  assert(firstStart.session.session_public_id, "Initial start should return a session public ID.");
  assert(
    (await activeSessionCount({ studentDbId: student.id, assessmentDbId: open.assessment.id })) === 1,
    "Initial start should create exactly one active session."
  );
  assert(
    (await sessionStartedEventCount(firstStart.session.session_public_id)) === 1,
    "Initial session should have exactly one session_started event."
  );

  const resumeOnlyRow = await availableRow(student.id, open.assessment.assessment_public_id);
  assert(resumeOnlyRow.can_start === false, "Active attempt should block the dashboard new-start action.");
  assert(resumeOnlyRow.can_resume === true, "Active attempt should show a resume action.");
  assert(
    resumeOnlyRow.existing_session_public_id === firstStart.session.session_public_id,
    "Availability should point at the active resumable session."
  );

  const duplicateExplicitNewAttempt = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: open.assessment.assessment_public_id,
    new_attempt: true
  });
  assert(
    duplicateExplicitNewAttempt.session.session_public_id === firstStart.session.session_public_id,
    "Direct duplicate start with new_attempt=true should resume the active session."
  );
  assert(
    (await activeSessionCount({ studentDbId: student.id, assessmentDbId: open.assessment.id })) === 1,
    "Direct duplicate start should not create a second active session."
  );
  assert(
    (await sessionStartedEventCount(firstStart.session.session_public_id)) === 1,
    "Direct duplicate start should not duplicate session_started."
  );

  const duplicateResume = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: open.assessment.assessment_public_id
  });
  assert(
    duplicateResume.session.session_public_id === firstStart.session.session_public_id,
    "Repeated resume should return the active session."
  );

  await getStudentSessionState({
    student_user_db_id: otherStudent.id,
    session_public_id: firstStart.session.session_public_id
  })
    .then(() => {
      throw new Error("Other student should not access this session.");
    })
    .catch((error) => {
      assert(error instanceof StudentAssessmentServiceError, "Expected session ownership service error.");
      assert(error.code === "session_not_owned", "Other student should receive session_not_owned.");
    });

  const concurrent = await createAssessment({
    teacherId: teacher.id,
    suffix: "concurrent"
  });
  const concurrentInitial = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: concurrent.assessment.assessment_public_id
  });
  const [concurrentA, concurrentB] = await Promise.all([
    startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: concurrent.assessment.assessment_public_id,
      new_attempt: true
    }),
    startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: concurrent.assessment.assessment_public_id,
      new_attempt: true
    })
  ]);
  assert(
    concurrentA.session.session_public_id === concurrentInitial.session.session_public_id &&
      concurrentB.session.session_public_id === concurrentInitial.session.session_public_id,
    "Concurrent duplicate starts on an active assessment should converge on one session."
  );
  assert(
    (await activeSessionCount({ studentDbId: student.id, assessmentDbId: concurrent.assessment.id })) === 1,
    "Concurrent duplicate starts should leave one active session."
  );
  assert(
    (await sessionStartedEventCount(concurrentA.session.session_public_id)) === 1,
    "Concurrent duplicate starts should not duplicate session_started."
  );

  await prisma.assessmentSession.update({
    where: { session_public_id: firstStart.session.session_public_id },
    data: {
      status: "completed",
      current_phase: "session_completed",
      completed_at: new Date()
    }
  });
  const completedRow = await availableRow(student.id, open.assessment.assessment_public_id);
  assert(completedRow.can_start === true, "Completed attempt should allow a new attempt when assessment is open.");
  assert(completedRow.can_resume === false, "Completed attempt should not show resume.");
  const secondAttempt = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: open.assessment.assessment_public_id,
    new_attempt: true
  });
  assert(
    secondAttempt.session.attempt_number === 2,
    "New start after completion should create attempt 2."
  );

  const now = new Date();
  const closedResume = await createAssessment({
    teacherId: teacher.id,
    suffix: "closed-resume",
    releaseAt: minutesAfter(now, -120),
    closeAt: minutesAfter(now, -10)
  });
  const closedSession = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: closedResume.assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "concept_unit_intro",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted",
      current_concept_unit_db_id: closedResume.conceptUnit.id,
      started_at: minutesAfter(now, -60),
      last_activity_at: minutesAfter(now, -30)
    }
  });
  await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: closedSession.id,
      concept_unit_db_id: closedResume.conceptUnit.id,
      status: "initial_in_progress",
      initial_started_at: minutesAfter(now, -60)
    }
  });
  const closedResumeRow = await availableRow(student.id, closedResume.assessment.assessment_public_id);
  assert(closedResumeRow.can_start === false, "Closed assessment should not allow new starts.");
  assert(closedResumeRow.can_resume === true, "Closed assessment should allow resuming an existing session.");
  const closedResumed = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: closedResume.assessment.assessment_public_id,
    new_attempt: true
  });
  assert(
    closedResumed.session.session_public_id === closedSession.session_public_id,
    "Closed assessment duplicate new_attempt should resume the existing session."
  );

  const closedNoSession = await createAssessment({
    teacherId: teacher.id,
    suffix: "closed-no-session",
    releaseAt: minutesAfter(now, -120),
    closeAt: minutesAfter(now, -10)
  });
  await expectStudentStartError({
    assessmentPublicId: closedNoSession.assessment.assessment_public_id,
    studentDbId: student.id,
    code: "assessment_closed_to_new_starts"
  });

  const invalidExisting = await createAssessment({
    teacherId: teacher.id,
    suffix: "invalid-existing",
    conceptUnitStatus: "draft"
  });
  const invalidSession = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: invalidExisting.assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "concept_unit_intro",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted",
      current_concept_unit_db_id: null,
      started_at: now,
      last_activity_at: now
    }
  });
  await expectStudentStartError({
    assessmentPublicId: invalidExisting.assessment.assessment_public_id,
    studentDbId: student.id,
    code: "current_concept_unit_unavailable"
  });
  const preservedInvalidSession = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: invalidSession.id },
    select: { status: true, current_phase: true, current_concept_unit_db_id: true }
  });
  assert(
    preservedInvalidSession.status === "active" &&
      preservedInvalidSession.current_phase === "concept_unit_intro" &&
      preservedInvalidSession.current_concept_unit_db_id === null,
    "Invalid existing session should be preserved for repair instead of rewritten."
  );

  const draft = await createAssessment({
    teacherId: teacher.id,
    suffix: "draft",
    status: "draft"
  });
  await expectStudentStartError({
    assessmentPublicId: draft.assessment.assessment_public_id,
    studentDbId: student.id,
    code: "assessment_not_published"
  });
  assert(
    (await prisma.assessmentSession.count({
      where: {
        user_db_id: student.id,
        assessment_db_id: draft.assessment.id
      }
    })) === 0,
    "Unavailable draft assessment should not create a session."
  );

  const safeStartError = normalizeAssessmentStartErrorForStudent({
    code: "session_start_conflict",
    message: "CONFLICT",
    status: 409,
    details: { existing_session_public_id: secondAttempt.session.session_public_id }
  });
  assert(
    safeStartError.message ===
      "You already have an activity in progress. Resume your current attempt.",
    "Active-attempt conflicts should be converted to a student-safe recovery message."
  );
  assert(
    shouldDisplayStudentApiErrorCode(safeStartError) === false,
    "Raw active-attempt conflict code should not be displayed to students."
  );
  assert(
    startErrorRecoverySessionPublicId(safeStartError) === secondAttempt.session.session_public_id,
    "Student-safe conflict should preserve recovery session public ID."
  );

  const dashboardSource = await readFile(
    "src/components/student-assessment/available-assessments-client.tsx",
    "utf8"
  );
  assert(
    dashboardSource.includes("const canStartNew = assessment.can_start && !canOpen"),
    "Dashboard should not render Start new attempt when resume is available."
  );

  await cleanupFollowupSmoke(prisma, prefix);
  console.log("student assessment start/resume conflict smoke passed");
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
