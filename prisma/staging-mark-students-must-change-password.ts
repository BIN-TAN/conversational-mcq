import { PrismaClient } from "@prisma/client";
import {
  markStudentsMustChangePassword,
  markStudentsMustChangePasswordErrorPayload,
  parseMarkStudentsMustChangePasswordConfig
} from "./staging-mark-students-must-change-password-core";

const prisma = new PrismaClient();

async function main() {
  const config = parseMarkStudentsMustChangePasswordConfig(process.env);
  const summary = await markStudentsMustChangePassword(prisma, config);

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify(markStudentsMustChangePasswordErrorPayload(error), null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
