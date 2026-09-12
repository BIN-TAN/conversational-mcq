import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type AssessmentStatus } from "@prisma/client";
import { prisma as appPrisma } from "../src/lib/db";
import { listAssessments } from "../src/lib/services/content/assessments";
import { generatePublicId } from "../src/lib/services/ids";
import {
  endStudentAssessmentAttempt,
  getStudentReviewResponses,
  listAvailableAssessments,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import {
  canStartAssessmentFromCatalog,
  LEGACY_IRT_DEMO_ASSESSMENT_ID,
  studentAssessmentCatalogWhere
} from "../src/lib/services/student-assessment/catalog-access";
import { cleanupFollowupSmoke } from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `catalog_smoke_${randomUUID().slice(0, 8)}`;

function assertDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert(url.pathname.endsWith("_catalog_smoke"), "Use a disposable local *_catalog_smoke database.");
}

async function createUser(role: "student" | "teacher_researcher", teacherId?: string) {
  const userId = `${prefix}_${randomUUID().slice(0, 8)}`;
  return prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: userId,
      role,
      created_by_teacher_user_id: teacherId
    }
  });
}

async function createAssessment(
  teacherId: string,
  publicId = generatePublicId("assessment"),
  status: AssessmentStatus = "published"
) {
  return prisma.assessment.create({
    data: {
      assessment_public_id: publicId,
      title: `${prefix} IRT Theta Invariance and Item Parameters`,
      status,
      workflow_mode: "automatic",
      created_by_user_db_id: teacherId,
      concept_units: {
        create: {
          concept_unit_public_id: generatePublicId("concept_unit"),
          title: "Synthetic catalog topic",
          learning_objective: "Distinguish the supported answer.",
          related_concept_description: "Synthetic local test content.",
          order_index: 1,
          status: "published",
          items: {
            create: [1, 2, 3].map((order) => ({
              item_public_id: generatePublicId("item"),
              item_order: order,
              item_stem: `Synthetic catalog item ${order}`,
              options: [{ label: "A", text: "First" }, { label: "B", text: "Second" }, { label: "C", text: "Third" }],
              correct_option: "A",
              distractor_rationales: { B: "Unsupported.", C: "Unsupported." },
              expected_reasoning_patterns: ["Uses evidence."],
              possible_misconception_indicators: [],
              administration_rules: {},
              included_in_published_set: true,
              status: "published" as const
            }))
          }
        }
      }
    },
    include: { concept_units: { include: { items: true } } }
  });
}

async function expectBlocked(studentId: string, assessmentId: string) {
  const before = {
    sessions: await prisma.assessmentSession.count(),
    events: await prisma.processEvent.count(),
    operations: await prisma.assessmentLifecycleOperation.count(),
    calls: await prisma.agentCall.count()
  };
  for (const newAttempt of [false, true]) {
    await assert.rejects(
      startOrResumeStudentAssessmentSession({
        student_user_db_id: studentId,
        assessment_public_id: assessmentId,
        new_attempt: newAttempt
      }),
      (error: unknown) => error instanceof StudentAssessmentServiceError &&
        error.code === "assessment_not_available" && error.status === 403
    );
  }
  assert.deepEqual({
    sessions: await prisma.assessmentSession.count(),
    events: await prisma.processEvent.count(),
    operations: await prisma.assessmentLifecycleOperation.count(),
    calls: await prisma.agentCall.count()
  }, before, "Blocked new starts must not create attempts, operations, evidence, or calls.");
}

async function main() {
  assertDisposableDatabase();
  Object.assign(process.env, {
    LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false",
    ITEM_ADMIN_TUTOR_MODE: "mock", ALLOW_LOCAL_MOCK_RUNTIME: "true",
    OPERATIONAL_AGENT_MODE: "disabled", FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "", OPENAI_API_KEY_FILE: ""
  });
  try {
    const teacher = await createUser("teacher_researcher");
    const demoTeacher = await createUser("teacher_researcher");
    const student = await createUser("student", teacher.id);
    const demoStudent = await createUser("student", demoTeacher.id);
    const legacyStudent = await createUser("student");
    const historyStudent = await createUser("student", teacher.id);
    const staleTeacherStudent = await createUser("student", randomUUID());
    const owned = await createAssessment(teacher.id);
    const demo = await createAssessment(demoTeacher.id, LEGACY_IRT_DEMO_ASSESSMENT_ID);
    const foreign = await createAssessment(demoTeacher.id);
    const archived = await createAssessment(teacher.id, undefined, "archived");
    const draft = await createAssessment(teacher.id, undefined, "draft");
    const future = await createAssessment(teacher.id);
    await prisma.assessment.update({ where: { id: future.id }, data: { release_at: new Date(Date.now() + 86400000) } });

    const teacherLibrary = await listAssessments({ teacher_user_db_id: teacher.id });
    assert(!teacherLibrary.some((row) => row.assessment_public_id === demo.assessment_public_id));
    const available = await listAvailableAssessments({ student_user_db_id: student.id });
    assertStudentPayloadIsSafe(available);
    assert.deepEqual(available.assessments.map((row) => row.assessment_public_id), [owned.assessment_public_id]);
    assert(available.assessments[0]?.can_start, "Same-title teacher-authored content must remain available.");
    for (const row of available.assessments) {
      assert(teacherLibrary.some((assessment) => assessment.assessment_public_id === row.assessment_public_id));
    }
    for (const hidden of [demo, foreign, archived, draft, future]) {
      assert(!available.assessments.some((row) => row.assessment_public_id === hidden.assessment_public_id));
    }
    await expectBlocked(student.id, demo.assessment_public_id);
    await expectBlocked(student.id, foreign.assessment_public_id);
    await expectBlocked(legacyStudent.id, demo.assessment_public_id);
    await expectBlocked(staleTeacherStudent.id, owned.assessment_public_id);
    assert.equal((await listAvailableAssessments({ student_user_db_id: staleTeacherStudent.id })).assessments.length, 0);

    // The query and direct-start policy agree, including the legacy compatibility case.
    for (const account of [student, demoStudent, legacyStudent, staleTeacherStudent]) {
      const rows = await prisma.assessment.findMany({ where: studentAssessmentCatalogWhere({
        student_user_db_id: account.id, student_teacher_db_id: account.created_by_teacher_user_id
      }) });
      for (const assessment of [owned, demo, foreign]) {
        assert.equal(rows.some((row) => row.id === assessment.id), canStartAssessmentFromCatalog({
          student_teacher_db_id: account.created_by_teacher_user_id,
          assessment_creator_db_id: assessment.created_by_user_db_id,
          assessment_public_id: assessment.assessment_public_id
        }));
      }
    }
    const legacyList = await listAvailableAssessments({ student_user_db_id: legacyStudent.id });
    assert(!legacyList.assessments.some((row) => row.assessment_public_id === demo.assessment_public_id));
    assert(legacyList.assessments.some((row) => row.assessment_public_id === owned.assessment_public_id && row.can_start));
    const demoList = await listAvailableAssessments({ student_user_db_id: demoStudent.id });
    assert(demoList.assessments.some((row) => row.assessment_public_id === demo.assessment_public_id && row.can_start));
    const started = await startOrResumeStudentAssessmentSession({ student_user_db_id: student.id, assessment_public_id: owned.assessment_public_id });
    assert(started.session.session_public_id);

    const concept = demo.concept_units[0]!;
    const completed = [];
    for (const attempt of [1, 2, 3, 4]) {
      completed.push(await prisma.assessmentSession.create({ data: {
        session_public_id: generatePublicId("session"),
        user_db_id: historyStudent.id, assessment_db_id: demo.id,
        attempt_number: attempt, status: "completed", current_phase: "session_completed",
        workflow_mode_snapshot: "automatic", current_concept_unit_db_id: concept.id,
        started_at: new Date(), completed_at: new Date()
      } }));
    }
    const lastCompleted = completed[3]!;
    const conceptSession = await prisma.conceptUnitSession.create({ data: {
      assessment_session_db_id: lastCompleted.id, concept_unit_db_id: concept.id,
      status: "initial_completed", initial_started_at: new Date(), initial_completed_at: new Date()
    } });
    const response = await prisma.itemResponse.create({ data: {
      concept_unit_session_db_id: conceptSession.id, item_db_id: concept.items[0]!.id,
      selected_option: "A", reasoning_text: "Historical synthetic reasoning.", confidence_rating: "high",
      correct_option_snapshot: "A", correctness: "correct", item_version_snapshot: 1,
      item_submitted_at: new Date(), item_snapshot: { preserved: true }
    } });
    const before = JSON.stringify({ demo, completed, response });
    const historyList = await listAvailableAssessments({ student_user_db_id: historyStudent.id });
    const historyRow = historyList.assessments.find((row) => row.assessment_public_id === demo.assessment_public_id)!;
    assert(historyRow && !historyRow.can_start && !historyRow.can_resume);
    assert.equal(historyRow.availability_state, "closed_to_new_starts");
    assert.equal(historyRow.attempt_policy.completed_attempts_permit_new_attempt, false);
    assert.deepEqual(historyRow.recent_reviewable_attempts.map((row) => row.attempt_number), [4, 3, 2]);
    const review = await getStudentReviewResponses({ student_user_db_id: historyStudent.id, session_public_id: lastCompleted.session_public_id });
    assertStudentPayloadIsSafe(review);
    assert(review.items.some((item) => item.existing_reasoning_text === response.reasoning_text));
    assert(review.locked);
    await assert.rejects(getStudentReviewResponses({ student_user_db_id: student.id, session_public_id: lastCompleted.session_public_id }),
      (error: unknown) => error instanceof StudentAssessmentServiceError && error.code === "session_not_owned");
    await expectBlocked(historyStudent.id, demo.assessment_public_id);
    assert.equal(JSON.stringify({
      demo: await prisma.assessment.findUniqueOrThrow({ where: { id: demo.id }, include: { concept_units: { include: { items: true } } } }),
      completed: await prisma.assessmentSession.findMany({ where: { id: { in: completed.map((row) => row.id) } }, orderBy: { attempt_number: "asc" } }),
      response: await prisma.itemResponse.findUniqueOrThrow({ where: { id: response.id } })
    }), before, "Catalog changes must not mutate existing content, attempts, or response evidence.");

    const paused = await prisma.assessmentSession.create({ data: {
      session_public_id: generatePublicId("session"), user_db_id: historyStudent.id,
      assessment_db_id: demo.id, attempt_number: 5, status: "paused",
      current_phase: "concept_unit_intro", resume_phase: "concept_unit_intro",
      current_concept_unit_db_id: concept.id, workflow_mode_snapshot: "automatic", started_at: new Date()
    } });
    const resumeRow = (await listAvailableAssessments({ student_user_db_id: historyStudent.id })).assessments.find((row) => row.assessment_public_id === demo.assessment_public_id)!;
    assert(resumeRow.can_resume && !resumeRow.can_start);
    const count = await prisma.assessmentSession.count();
    for (const newAttempt of [false, true]) {
      const resumed = await startOrResumeStudentAssessmentSession({ student_user_db_id: historyStudent.id, assessment_public_id: demo.assessment_public_id, new_attempt: newAttempt });
      assert.equal(resumed.session.session_public_id, paused.session_public_id);
    }
    assert.equal(await prisma.assessmentSession.count(), count, "Resume must not create a duplicate attempt.");
    await endStudentAssessmentAttempt({ student_user_db_id: historyStudent.id, session_public_id: paused.session_public_id });
    await expectBlocked(historyStudent.id, demo.assessment_public_id);
    assert.equal(await prisma.agentCall.count(), 0, "No provider calls or generated agent messages.");
    console.log("PASS: teacher/student catalog parity; reserved demo hidden; direct starts blocked; legacy compatibility; publication windows; historical evidence/review preserved; resume/end without duplicate attempts; student payload safety. Provider calls: 0.");
  } finally {
    await cleanupFollowupSmoke(prisma, prefix);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});
