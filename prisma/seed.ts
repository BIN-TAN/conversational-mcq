import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

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
      user_id_normalized: normalizeUserId(teacherUserId),
      account_status: "active",
      auth_version: 1,
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: teacherUserId,
      user_id_normalized: normalizeUserId(teacherUserId),
      role: "teacher_researcher",
      password_hash: teacherPasswordHash,
      account_status: "active",
      auth_version: 1
    }
  });

  await prisma.user.upsert({
    where: { user_id: studentUserId },
    update: {
      role: "student",
      user_id_normalized: normalizeUserId(studentUserId),
      account_status: "active",
      auth_version: 1,
      password_hash: null,
      access_code_hash: studentAccessCodeHash,
      credential_updated_at: new Date()
    },
    create: {
      user_id: studentUserId,
      user_id_normalized: normalizeUserId(studentUserId),
      role: "student",
      access_code_hash: studentAccessCodeHash,
      account_status: "active",
      auth_version: 1,
      credential_updated_at: new Date()
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
