import { PrismaClient } from "@prisma/client";
import { cleanupDataExportDemoFixture } from "./demo-data-export-fixture";

const prisma = new PrismaClient();

async function main() {
  const result = await cleanupDataExportDemoFixture(prisma);
  console.log(
    result.deleted_assessment
      ? "Data/export demo fixture records removed."
      : "No data/export demo assessment found."
  );
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
