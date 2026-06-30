import { rm } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { cleanupSmokeStudentSessions } from "./student-mvp-smoke-helpers";
import { LIVE_LLM_FAILURE_ARTIFACT_DIR } from "./student-live-llm-failure-artifacts";

const prisma = new PrismaClient();
const LIVE_SMOKE_USER_PREFIX = "phase8_live_llm_";

async function main() {
  const keepArtifacts = process.argv.includes("--keep-artifacts");
  const users = await prisma.user.findMany({
    where: {
      role: "student",
      user_id: { startsWith: LIVE_SMOKE_USER_PREFIX }
    },
    select: {
      id: true,
      user_id: true,
      assessment_sessions: {
        select: { session_public_id: true }
      }
    }
  });
  let sessionCount = 0;

  for (const user of users) {
    const sessionPublicIds = user.assessment_sessions.map((session) => session.session_public_id);
    sessionCount += sessionPublicIds.length;
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: user.id,
      sessionPublicIds
    });
  }

  if (!keepArtifacts) {
    await rm(LIVE_LLM_FAILURE_ARTIFACT_DIR, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    status: "completed",
    deleted_synthetic_user_count: users.length,
    deleted_synthetic_session_count: sessionCount,
    artifact_directory: LIVE_LLM_FAILURE_ARTIFACT_DIR,
    artifacts_deleted: !keepArtifacts,
    scope: {
      user_id_prefix: LIVE_SMOKE_USER_PREFIX,
      role: "student"
    }
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
