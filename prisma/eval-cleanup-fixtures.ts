import { prisma } from "../src/lib/db";
import { cleanupEvalFixtures } from "../src/lib/services/evals/service";

async function main() {
  const result = await cleanupEvalFixtures();

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
