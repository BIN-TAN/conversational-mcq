import { PrismaClient } from "@prisma/client";
import { cleanupRosterDemoFixture } from "./demo-roster-fixture";

const prisma = new PrismaClient();

async function main() {
  const result = await cleanupRosterDemoFixture(prisma);

  console.log("Roster demo cleanup complete.");
  console.log(`Deleted fixture students: ${result.deleted.join(", ") || "none"}`);
  console.log(
    `Retained and deactivated fixture students: ${
      result.retainedAndDeactivated.join(", ") || "none"
    }`
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
