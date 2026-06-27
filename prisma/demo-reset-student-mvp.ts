import { PrismaClient } from "@prisma/client";
import { resetStudentDemoFixedMvpAttempt } from "./demo-reset-student-mvp-helper";

const prisma = new PrismaClient();

async function main() {
  const result = await resetStudentDemoFixedMvpAttempt(prisma);

  console.log(
    JSON.stringify(
      {
        status: "reset_complete",
        message:
          "student_demo can start the fixed IRT MVP assessment again from the student dashboard.",
        ...result,
        dashboard_url: "http://localhost:3000/student/assessment"
      },
      null,
      2
    )
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
