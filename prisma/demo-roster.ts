import { PrismaClient } from "@prisma/client";
import { ensureRosterDemoFixture } from "./demo-roster-fixture";

const prisma = new PrismaClient();

async function main() {
  const { commit } = await ensureRosterDemoFixture(prisma);

  console.log("Roster demo fixture is ready.");
  if (commit.one_time_credentials.length > 0) {
    console.log("Development-only one-time access codes:");
    for (const credential of commit.one_time_credentials) {
      console.log(`- ${credential.user_id}: ${credential.temporary_access_code}`);
    }
    console.log(commit.credential_warning);
  } else {
    console.log("No new credentials were generated. Existing demo students were reused.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
