import { prisma } from "../src/lib/db";
import { drainAvailableWorkflowJobsOnce } from "../src/lib/workflow/worker";

async function main() {
  const processed = await drainAvailableWorkflowJobsOnce();

  console.log(
    JSON.stringify(
      {
        processed_count: processed.length,
        processed
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
