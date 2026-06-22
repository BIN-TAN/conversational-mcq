import { prisma } from "../src/lib/db";
import { seedEvalFixtures } from "../src/lib/services/evals/service";

async function main() {
  const teacher = await prisma.user.findUnique({
    where: { user_id: "teacher_demo" },
    select: { id: true, role: true }
  });

  if (!teacher || teacher.role !== "teacher_researcher") {
    throw new Error("Run npm run prisma:seed before seeding evaluation fixtures.");
  }

  const result = await seedEvalFixtures(teacher.id);

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
