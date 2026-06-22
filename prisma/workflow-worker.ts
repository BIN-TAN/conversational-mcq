import { prisma } from "../src/lib/db";
import { runWorkflowWorker } from "../src/lib/workflow/worker";

async function main() {
  await runWorkflowWorker();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
