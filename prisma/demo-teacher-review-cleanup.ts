import { PrismaClient } from "@prisma/client";
import { cleanupTeacherReviewDemoFixture } from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

async function main() {
  const result = await cleanupTeacherReviewDemoFixture(prisma);
  console.log(result.deleted ? "Teacher-review demo fixture removed." : "No teacher-review demo fixture found.");
  console.log("Demo users were preserved.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
