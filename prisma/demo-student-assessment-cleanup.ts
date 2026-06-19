import { PrismaClient } from "@prisma/client";
import { cleanupDemoStudentAssessment } from "./demo-student-assessment-fixture";

const prisma = new PrismaClient();

async function main() {
  const result = await cleanupDemoStudentAssessment(prisma);

  console.log(
    result.deleted
      ? "Deleted the development demo student assessment and its own records."
      : "No development demo student assessment was present."
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
