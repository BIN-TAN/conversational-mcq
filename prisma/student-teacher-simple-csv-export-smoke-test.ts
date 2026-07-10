import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import {
  downloadAssessmentCsv,
  downloadStudentAssessmentMatrixCsv,
  downloadStudentCsv,
  MATRIX_CSV_COLUMNS,
  SESSION_CSV_COLUMNS
} from "../src/lib/services/teacher-simple-csv-export/service";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId,
  teacherReviewConceptUnitPublicId,
  teacherReviewSessionPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseCsv<T extends Record<string, string>>(content: string): T[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true
  }) as T[];
}

function headers(content: string) {
  return content.split(/\r?\n/, 1)[0]?.split(",") ?? [];
}

function assertHeaders(content: string, expected: readonly string[]) {
  const actual = headers(content);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `CSV headers did not match. Expected ${expected.join(",")} got ${actual.join(",")}`
  );
}

function assertNoProtectedFields(content: string) {
  const lower = content.toLowerCase();
  const forbidden = [
    "answer_key",
    "correct_option",
    "correctness_label",
    "distractor_rationales",
    "possible_misconception_indicators",
    "expected_reasoning_patterns",
    "raw_output",
    "input_payload",
    "output_payload",
    "process_payload",
    "provider_response",
    "password_hash",
    "access_code_hash",
    "api_key",
    "authorization:",
    "bearer "
  ];

  for (const term of forbidden) {
    assert(!lower.includes(term), `Simple CSV leaked protected field marker ${term}.`);
  }
}

async function createSecondAttempt() {
  const existing = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: teacherReviewSessionPublicId },
    select: {
      user_db_id: true,
      assessment_db_id: true
    }
  });
  const conceptUnit = await prisma.conceptUnit.findUniqueOrThrow({
    where: { concept_unit_public_id: teacherReviewConceptUnitPublicId },
    select: { id: true }
  });
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: "session_phase31j_simple_csv_attempt2",
      user_db_id: existing.user_db_id,
      assessment_db_id: existing.assessment_db_id,
      attempt_number: 2,
      status: "completed",
      current_phase: "session_completed",
      current_concept_unit_db_id: conceptUnit.id,
      started_at: new Date("2026-06-19T16:00:00.000Z"),
      completed_at: new Date("2026-06-19T16:05:00.000Z")
    }
  });

  await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "completed",
      initial_started_at: new Date("2026-06-19T16:00:00.000Z"),
      initial_completed_at: new Date("2026-06-19T16:05:00.000Z")
    }
  });
}

async function createMatrixOnlyAssessment(teacherDbId: string) {
  return prisma.assessment.create({
    data: {
      assessment_public_id: "assessment_phase31j_matrix_only",
      title: "Phase 31j Matrix Only Assessment",
      status: "published",
      created_by_user_db_id: teacherDbId
    },
    select: { assessment_public_id: true }
  });
}

async function createAndDeleteStudent() {
  const userId = "phase31j_deleted_student";
  await prisma.user.upsert({
    where: { user_id: userId },
    update: {
      role: "student",
      user_id_normalized: normalizeUserId(userId),
      display_name: "Deleted smoke student"
    },
    create: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      display_name: "Deleted smoke student",
      role: "student"
    }
  });
  await prisma.user.delete({ where: { user_id: userId } });

  return userId;
}

async function cleanupExtraRows() {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: "session_phase31j_simple_csv_attempt2" },
    select: { id: true }
  });

  if (session) {
    const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    await prisma.conceptUnitSession.deleteMany({
      where: { id: { in: conceptUnitSessions.map((entry) => entry.id) } }
    });
    await prisma.assessmentSession.delete({ where: { id: session.id } });
  }

  await prisma.assessment.deleteMany({
    where: { assessment_public_id: "assessment_phase31j_matrix_only" }
  });
  await prisma.user.deleteMany({ where: { user_id: "phase31j_deleted_student" } });
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await cleanupExtraRows();
  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    await createSecondAttempt();
    const matrixOnlyAssessment = await createMatrixOnlyAssessment(teacher.id);
    const deletedUserId = await createAndDeleteStudent();

    const beforeCounts = {
      agent_calls: await prisma.agentCall.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count()
    };

    const assessmentCsv = await downloadAssessmentCsv({
      teacher_user_db_id: teacher.id,
      assessment_public_id: teacherReviewAssessmentPublicId
    });
    const studentCsv = await downloadStudentCsv({
      teacher_user_db_id: teacher.id,
      student_user_id: "student_demo"
    });
    const matrixCsv = await downloadStudentAssessmentMatrixCsv({
      teacher_user_db_id: teacher.id
    });

    assert(assessmentCsv.file_name === "assessment_assessment_demo_teacher_review_students.csv", "Assessment CSV filename should be stable.");
    assert(studentCsv.file_name === "student_student_demo_sessions.csv", "Student CSV filename should be stable.");
    assert(matrixCsv.file_name === "student_assessment_matrix.csv", "Matrix CSV filename should be stable.");

    assertHeaders(assessmentCsv.content, SESSION_CSV_COLUMNS);
    assertHeaders(studentCsv.content, SESSION_CSV_COLUMNS);
    assertHeaders(matrixCsv.content, MATRIX_CSV_COLUMNS);

    const assessmentRows = parseCsv<Record<string, string>>(assessmentCsv.content);
    const studentRows = parseCsv<Record<string, string>>(studentCsv.content);
    const matrixRows = parseCsv<Record<string, string>>(matrixCsv.content);

    assert(
      assessmentRows.filter((row) => row.assessment_public_id === teacherReviewAssessmentPublicId).length >= 2,
      "Assessment CSV should include both synthetic attempts for the selected assessment."
    );
    assert(
      studentRows.filter((row) => row.student_id === "student_demo").length >= 2,
      "Student CSV should include multiple sessions for the selected student."
    );
    assert(
      assessmentRows.every((row) => row.assessment_public_id === teacherReviewAssessmentPublicId),
      "Assessment CSV should be filtered to the selected assessment."
    );
    assert(
      studentRows.every((row) => row.student_id === "student_demo"),
      "Student CSV should be filtered to the selected student."
    );

    const matrixKeys = matrixRows.map((row) => `${row.student_id}|${row.assessment_public_id}`);
    assert(new Set(matrixKeys).size === matrixKeys.length, "Matrix rows should be unique by student and assessment.");
    const demoMatrix = matrixRows.find(
      (row) => row.student_id === "student_demo" && row.assessment_public_id === teacherReviewAssessmentPublicId
    );
    assert(demoMatrix, "Matrix should include the demo student and demo assessment.");
    assert(Number(demoMatrix.session_count) >= 2, "Matrix should summarize multiple sessions.");
    const noSessionMatrix = matrixRows.find(
      (row) => row.student_id === "student_demo" && row.assessment_public_id === matrixOnlyAssessment.assessment_public_id
    );
    assert(noSessionMatrix, "Matrix should include current student by matrix-only assessment.");
    assert(noSessionMatrix.session_count === "0", "Matrix no-session row should have zero sessions.");
    assert(!matrixCsv.content.includes(deletedUserId), "Deleted student should not appear in matrix CSV.");

    for (const content of [assessmentCsv.content, studentCsv.content, matrixCsv.content]) {
      assertNoProtectedFields(content);
      assert(!content.includes("The spoon warms because"), "Raw reasoning text should not be exported.");
      assert(!content.includes("Please choose an option"), "Raw prompt text should not be exported.");
    }

    const afterCounts = {
      agent_calls: await prisma.agentCall.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count()
    };
    assert(
      beforeCounts.agent_calls === afterCounts.agent_calls &&
        beforeCounts.activity_attempts === afterCounts.activity_attempts,
      "Simple CSV export should be read-only and should not create agent calls or activity attempts."
    );

    console.log("Teacher simple CSV export smoke test passed.");
  } finally {
    await cleanupExtraRows();
    await cleanupTeacherReviewDemoFixture(prisma);
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
