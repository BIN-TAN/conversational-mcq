import { prisma } from "../src/lib/db";
import { seedEvalFixtures, createMockEvaluationRuns } from "../src/lib/services/evals/service";
import type { PublicUser } from "../src/types/auth";

async function main() {
  const teacher = await prisma.user.findUnique({
    where: { user_id: "teacher_demo" },
    select: { id: true, user_id: true, role: true, auth_version: true }
  });

  if (!teacher || teacher.role !== "teacher_researcher") {
    throw new Error("Run npm run prisma:seed before running mock evaluation.");
  }

  await seedEvalFixtures(teacher.id);

  const user: PublicUser = {
    user_db_id: teacher.id,
    user_id: teacher.user_id,
    role: "teacher_researcher",
    auth_version: teacher.auth_version
  };
  const result = await createMockEvaluationRuns({}, user);

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
