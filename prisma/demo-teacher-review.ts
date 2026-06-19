import { PrismaClient } from "@prisma/client";
import {
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId,
  teacherReviewSessionPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

async function main() {
  await ensureTeacherReviewDemoFixture(prisma);
  console.log("Teacher-review demo fixture is ready.");
  console.log(`- assessment_public_id: ${teacherReviewAssessmentPublicId}`);
  console.log(`- session_public_id: ${teacherReviewSessionPublicId}`);
  console.log("- teacher login: teacher_demo / teacher_demo_password");
  console.log("- student login: student_demo / student_demo_access_code");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
