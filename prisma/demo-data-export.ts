import { PrismaClient } from "@prisma/client";
import {
  dataExportAssessmentPublicId,
  dataExportCompleteSessionPublicId,
  dataExportInactiveSessionPublicId,
  dataExportInactiveStudentAccessCode,
  dataExportInactiveStudentUserId,
  dataExportIncompleteSessionPublicId,
  dataExportSkippedSessionPublicId,
  dataExportSecondStudentAccessCode,
  dataExportSecondStudentUserId,
  ensureDataExportDemoFixture
} from "./demo-data-export-fixture";

const prisma = new PrismaClient();

async function main() {
  await ensureDataExportDemoFixture(prisma);
  console.log("Data/export demo fixture is ready.");
  console.log(`- assessment_public_id: ${dataExportAssessmentPublicId}`);
  console.log(`- complete session_public_id: ${dataExportCompleteSessionPublicId}`);
  console.log(`- incomplete session_public_id: ${dataExportIncompleteSessionPublicId}`);
  console.log(`- skipped session_public_id: ${dataExportSkippedSessionPublicId}`);
  console.log(`- inactive placeholder session_public_id: ${dataExportInactiveSessionPublicId}`);
  console.log("- teacher login: teacher_demo / teacher_demo_password");
  console.log("- student login: student_demo / student_demo_access_code");
  console.log(`- second student login: ${dataExportSecondStudentUserId} / ${dataExportSecondStudentAccessCode}`);
  console.log(
    `- inactive fixture student: ${dataExportInactiveStudentUserId} / ${dataExportInactiveStudentAccessCode}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
