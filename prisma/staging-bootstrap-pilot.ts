import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import {
  bootstrapErrorPayload,
  bootstrapPilotDatabase,
  parseBootstrapPilotConfig
} from "./staging-bootstrap-pilot-core";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

async function main() {
  const config = parseBootstrapPilotConfig(process.env);
  const summary = await bootstrapPilotDatabase(prisma, config);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify(bootstrapErrorPayload(error), null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
