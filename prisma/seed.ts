import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";

const prisma = new PrismaClient();

const teacherUserId = "teacher_demo";
const teacherPassword = "teacher_demo_password";
const studentUserId = "student_demo";
const studentAccessCode = "student_demo_access_code";

async function main() {
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret(teacherPassword),
    hashSecret(studentAccessCode)
  ]);

  await prisma.user.upsert({
    where: { user_id: teacherUserId },
    update: {
      role: "teacher_researcher",
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: teacherUserId,
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });

  await prisma.user.upsert({
    where: { user_id: studentUserId },
    update: {
      role: "student",
      password_hash: null,
      access_code_hash: studentAccessCodeHash
    },
    create: {
      user_id: studentUserId,
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });

  console.log("Seeded local development users:");
  console.log(`- teacher_researcher user_id: ${teacherUserId}`);
  console.log(`- student user_id: ${studentUserId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
