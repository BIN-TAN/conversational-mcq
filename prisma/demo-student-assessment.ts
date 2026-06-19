import { PrismaClient } from "@prisma/client";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";

const prisma = new PrismaClient();

async function main() {
  await ensureDemoStudentAssessment(prisma);
  console.log("Demo student assessment is ready.");
  console.log(`- assessment_public_id: ${demoAssessmentPublicId}`);
  console.log("- student login: student_demo / student_demo_access_code");
  console.log("- teacher login: teacher_demo / teacher_demo_password");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
