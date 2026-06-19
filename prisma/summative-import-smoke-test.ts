import { PrismaClient } from "@prisma/client";
import { canAccessSummativeOutcomeManagement } from "../src/lib/services/summative-outcomes/api";
import {
  previewSummativeOutcomeImport,
  commitSummativeOutcomeImport,
  replaceSummativeOutcome
} from "../src/lib/services/summative-outcomes/import";
import {
  cleanupDataExportDemoFixture,
  dataExportOutcomeNames,
  dataExportSecondStudentUserId,
  ensureDataExportDemoFixture
} from "./demo-data-export-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function csv(rows: string[]) {
  return [
    "user_id,outcome_name,outcome_score,max_score,assessment_date,notes",
    ...rows
  ].join("\n");
}

async function expectPreviewError(row: string, expectedCode: string) {
  const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
  const preview = await previewSummativeOutcomeImport({
    teacher_user_db_id: teacher.id,
    data: {
      source_file_name: `summative-import-smoke-${expectedCode}.csv`,
      csv_text: csv([row])
    }
  });
  const codes = preview.validation_errors.map((error) =>
    String((error as Record<string, unknown>).code)
  );

  assert(codes.includes(expectedCode), `Expected validation code ${expectedCode}.`);
  assert(preview.valid_rows === 0, `Invalid preview for ${expectedCode} should have no valid rows.`);
}

async function main() {
  await ensureDataExportDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const student = await prisma.user.findUniqueOrThrow({ where: { user_id: "student_demo" } });
    const beforeCount = await prisma.summativeOutcome.count();
    const validCsv = csv([
      `${dataExportSecondStudentUserId},final_exam,88,100,2026-06-19,Supervised final exam`,
      `${dataExportSecondStudentUserId},final_course_score,91,100,2026-06-19,Supervised final course score`,
      "student_demo,final_exam,79,100,2026-06-19,Supervised final exam"
    ]);
    const preview = await previewSummativeOutcomeImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: "summative-import-smoke-valid.csv",
        csv_text: validCsv
      }
    });

    assert(preview.total_rows === 3, "Valid preview should parse three rows.");
    assert(preview.valid_rows === 3, "Valid preview should report three valid rows.");
    assert(preview.invalid_rows === 0, "Valid preview should report zero invalid rows.");
    assert(
      (await prisma.summativeOutcome.count()) === beforeCount,
      "Preview must not create outcome records."
    );

    await expectPreviewError(
      `${dataExportSecondStudentUserId},final_exam,nope,100,2026-06-19,Invalid score`,
      "outcome_score_invalid"
    );
    await expectPreviewError(
      `${dataExportSecondStudentUserId},final_exam,10,0,2026-06-19,Invalid max`,
      "max_score_invalid"
    );
    await expectPreviewError(
      `${dataExportSecondStudentUserId},final_exam,10,100,2026-99-99,Invalid date`,
      "assessment_date_invalid"
    );
    await expectPreviewError(
      "unknown_student,final_exam,10,100,2026-06-19,Unknown user",
      "unmatched_user"
    );
    await expectPreviewError(
      "teacher_demo,final_exam,10,100,2026-06-19,Teacher account rejected",
      "teacher_user_rejected"
    );

    const duplicatePreview = await previewSummativeOutcomeImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: "summative-import-smoke-duplicate.csv",
        csv_text: csv([
          `${dataExportSecondStudentUserId},unit_test,10,10,2026-06-19,First`,
          `${dataExportSecondStudentUserId},unit_test,10,10,2026-06-19,Duplicate`
        ])
      }
    });

    assert(duplicatePreview.duplicate_rows === 1, "Duplicate source rows should be detected.");

    const commit = await commitSummativeOutcomeImport({
      teacher_user_db_id: teacher.id,
      batch_public_id: preview.batch_public_id
    });

    assert(commit.committed_rows === 3, "Valid commit should create three active outcomes.");
    assert(
      (await prisma.summativeOutcome.count({
        where: { user_id_snapshot: dataExportSecondStudentUserId, record_status: "active" }
      })) >= 2,
      "Committed outcomes should be active."
    );

    const repeatedPreview = await previewSummativeOutcomeImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: "summative-import-smoke-repeat.csv",
        csv_text: validCsv
      }
    });

    assert(
      repeatedPreview.preview_rows.every((row) => row.row_status === "exact_duplicate_existing"),
      "Repeated exact import should be reported as existing duplicates."
    );

    const conflictPreview = await previewSummativeOutcomeImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: "summative-import-smoke-conflict.csv",
        csv_text: csv([
          `${dataExportSecondStudentUserId},final_exam,89,100,2026-06-19,Changed score`
        ])
      }
    });

    assert(conflictPreview.conflicting_rows === 1, "Conflicting active outcome should be reported.");

    const activeOutcome = await prisma.summativeOutcome.findFirstOrThrow({
      where: {
        user_id_snapshot: dataExportSecondStudentUserId,
        outcome_name: dataExportOutcomeNames[0],
        record_status: "active"
      },
      select: { outcome_public_id: true, id: true }
    });
    const replacement = await replaceSummativeOutcome({
      teacher_user_db_id: teacher.id,
      outcome_public_id: activeOutcome.outcome_public_id,
      data: {
        outcome_score: 92,
        max_score: 100,
        notes: "Audited replacement"
      }
    });
    const superseded = await prisma.summativeOutcome.findUniqueOrThrow({
      where: { id: activeOutcome.id },
      select: { record_status: true }
    });

    assert(superseded.record_status === "superseded", "Previous outcome should be superseded.");
    assert(replacement.outcome.revision_number === 2, "Replacement should increment revision.");
    assert(
      canAccessSummativeOutcomeManagement(teacher.role),
      "Teacher should be authorized for summative outcome management."
    );
    assert(
      !canAccessSummativeOutcomeManagement(student.role),
      "Student should not be authorized for summative outcome APIs."
    );

    await cleanupDataExportDemoFixture(prisma);
    assert(
      await prisma.user.findUnique({ where: { user_id: "teacher_demo" } }),
      "Cleanup should preserve teacher_demo."
    );
    assert(
      await prisma.user.findUnique({ where: { user_id: "student_demo" } }),
      "Cleanup should preserve student_demo."
    );

    console.log("Summative import smoke test passed.");
  } finally {
    await cleanupDataExportDemoFixture(prisma);
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
