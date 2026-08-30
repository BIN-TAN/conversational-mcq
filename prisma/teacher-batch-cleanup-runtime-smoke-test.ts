import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  deleteArchivedAssessmentsAndAuthoringData,
  previewArchivedAssessmentBatchDeletion
} from "../src/lib/services/content/assessment-deletion";
import { ContentServiceError } from "../src/lib/services/content/errors";
import {
  deleteStudentSessionsAndAssociatedData,
  previewSessionBatchDeletion
} from "../src/lib/services/teacher-review/session-deletion";
import { TeacherReviewServiceError } from "../src/lib/services/teacher-review/errors";

const prisma = new PrismaClient();
const prefix = `batch_cleanup_${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertServiceError(
  action: () => Promise<unknown>,
  expectedCode: string,
  errorType: typeof ContentServiceError | typeof TeacherReviewServiceError
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof errorType, `Expected ${errorType.name}.`);
    assert(error.code === expectedCode, `Expected ${expectedCode}, received ${error.code}.`);
    return;
  }
  throw new Error(`Expected ${expectedCode}.`);
}

async function cleanup() {
  await prisma.assessmentLifecycleOperation.deleteMany({
    where: { target_session_public_id: { startsWith: prefix } }
  });
  await prisma.assessmentDeletionEvent.deleteMany({
    where: { assessment_title_snapshot: { startsWith: prefix } }
  });
  const assessments = await prisma.assessment.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  await prisma.assessmentSession.deleteMany({
    where: { assessment_db_id: { in: assessmentIds } }
  });
  await prisma.item.deleteMany({
    where: { concept_unit: { assessment_db_id: { in: assessmentIds } } }
  });
  await prisma.conceptUnit.deleteMany({
    where: { assessment_db_id: { in: assessmentIds } }
  });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
  await prisma.user.deleteMany({ where: { user_id: { startsWith: prefix } } });
}

async function main() {
  await cleanup();

  const teacher = await prisma.user.create({
    data: {
      user_id: `${prefix}_teacher`,
      user_id_normalized: `${prefix}_teacher`,
      role: "teacher_researcher",
      password_hash: "synthetic-smoke-password-hash"
    }
  });
  const student = await prisma.user.create({
    data: {
      user_id: `${prefix}_student`,
      user_id_normalized: `${prefix}_student`,
      role: "student",
      password_hash: "synthetic-smoke-password-hash"
    }
  });
  const sessionAssessment = await prisma.assessment.create({
    data: {
      assessment_public_id: `${prefix}_session_assessment`,
      title: `${prefix} session assessment`,
      status: "published",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: teacher.id
    }
  });
  const completedSession = await prisma.assessmentSession.create({
    data: {
      session_public_id: `${prefix}_completed`,
      user_db_id: student.id,
      assessment_db_id: sessionAssessment.id,
      status: "completed",
      current_phase: "session_completed",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted",
      completed_at: new Date()
    }
  });
  const activeSession = await prisma.assessmentSession.create({
    data: {
      session_public_id: `${prefix}_active`,
      user_db_id: student.id,
      assessment_db_id: sessionAssessment.id,
      attempt_number: 2,
      status: "active",
      current_phase: "initial_item_administration",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted"
    }
  });

  await assertServiceError(
    () =>
      previewSessionBatchDeletion({
        teacher_user_db_id: teacher.id,
        data: { session_public_ids: [activeSession.session_public_id] }
      }),
    "session_batch_delete_blocked",
    TeacherReviewServiceError
  );

  const sessionPreview = await previewSessionBatchDeletion({
    teacher_user_db_id: teacher.id,
    data: { session_public_ids: [completedSession.session_public_id] }
  });
  assert(sessionPreview.counts.assessment_session_count === 1, "Session preview count mismatch.");
  await assertServiceError(
    () =>
      deleteStudentSessionsAndAssociatedData({
        teacher_user_db_id: teacher.id,
        data: {
          session_public_ids: [completedSession.session_public_id],
          selection_fingerprint: sessionPreview.selection_fingerprint,
          delete_confirmation: "DELETE"
        }
      }),
    "session_batch_delete_confirmation_mismatch",
    TeacherReviewServiceError
  );
  const sessionDeletion = await deleteStudentSessionsAndAssociatedData({
    teacher_user_db_id: teacher.id,
    data: {
      session_public_ids: [completedSession.session_public_id],
      selection_fingerprint: sessionPreview.selection_fingerprint,
      delete_confirmation: sessionPreview.required_delete_confirmation
    }
  });
  assert(sessionDeletion.deleted_counts.assessment_session_count === 1, "Session was not deleted.");
  assert(
    (await prisma.assessmentSession.count({ where: { id: completedSession.id } })) === 0,
    "Deleted session still exists."
  );
  assert(
    (await prisma.assessmentSession.count({ where: { id: activeSession.id } })) === 1,
    "Active session should be retained."
  );
  assert((await prisma.user.count({ where: { id: student.id } })) === 1, "Student account was deleted.");
  assert(
    (await prisma.assessmentLifecycleOperation.count({
      where: { target_session_public_id: completedSession.session_public_id }
    })) === 1,
    "Safe session deletion audit is missing."
  );

  const archivedUnused = await prisma.assessment.create({
    data: {
      assessment_public_id: `${prefix}_archived_unused`,
      title: `${prefix} archived unused`,
      status: "archived",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: teacher.id
    }
  });
  await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `${prefix}_concept`,
      assessment_db_id: archivedUnused.id,
      title: "Synthetic topic",
      learning_objective: "Verify archived batch cleanup.",
      related_concept_description: "Synthetic cleanup concept.",
      order_index: 1,
      status: "archived",
      version: 1
    }
  });
  const archivedWithSession = await prisma.assessment.create({
    data: {
      assessment_public_id: `${prefix}_archived_with_session`,
      title: `${prefix} archived with session`,
      status: "archived",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: teacher.id
    }
  });
  await prisma.assessmentSession.create({
    data: {
      session_public_id: `${prefix}_archived_session`,
      user_db_id: student.id,
      assessment_db_id: archivedWithSession.id,
      status: "student_exited",
      current_phase: "student_exited",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted"
    }
  });

  const blockedAssessmentPreview = await previewArchivedAssessmentBatchDeletion({
    teacher_user_db_id: teacher.id,
    data: {
      assessment_public_ids: [
        archivedUnused.assessment_public_id,
        archivedWithSession.assessment_public_id
      ]
    }
  });
  assert(!blockedAssessmentPreview.allowed, "Archived mini test with a session must be blocked.");
  assert(blockedAssessmentPreview.blocked_assessments.length === 1, "Expected one blocked mini test.");

  const assessmentPreview = await previewArchivedAssessmentBatchDeletion({
    teacher_user_db_id: teacher.id,
    data: { assessment_public_ids: [archivedUnused.assessment_public_id] }
  });
  assert(assessmentPreview.allowed, "Unused archived mini test should be deletable.");
  await assertServiceError(
    () =>
      deleteArchivedAssessmentsAndAuthoringData({
        teacher_user_db_id: teacher.id,
        data: {
          assessment_public_ids: [archivedUnused.assessment_public_id],
          selection_fingerprint: "0".repeat(64),
          delete_confirmation: assessmentPreview.required_delete_confirmation
        }
      }),
    "assessment_delete_confirmation_mismatch",
    ContentServiceError
  );
  const assessmentDeletion = await deleteArchivedAssessmentsAndAuthoringData({
    teacher_user_db_id: teacher.id,
    data: {
      assessment_public_ids: [archivedUnused.assessment_public_id],
      selection_fingerprint: assessmentPreview.selection_fingerprint,
      delete_confirmation: assessmentPreview.required_delete_confirmation
    }
  });
  assert(assessmentDeletion.deleted_counts.assessment_count === 1, "Archived mini test was not deleted.");
  assert(
    (await prisma.assessment.count({ where: { id: archivedUnused.id } })) === 0,
    "Deleted archived mini test still exists."
  );
  assert(
    (await prisma.assessment.count({ where: { id: archivedWithSession.id } })) === 1,
    "Blocked archived mini test should be retained."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        terminal_session_deleted: true,
        active_session_retained: true,
        student_account_retained: true,
        archived_unused_deleted: true,
        archived_with_session_retained: true,
        provider_calls: 0,
        synthetic_nonce: randomUUID()
      },
      null,
      2
    )
  );
}

main()
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
