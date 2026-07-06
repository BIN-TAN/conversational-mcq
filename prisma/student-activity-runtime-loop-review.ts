import { loadEnvConfig } from "@next/env";
import { writeActivityRuntimeLoopReview } from "../src/lib/services/student-assessment/activity-runtime-loop";
import { prisma } from "../src/lib/db";

const envLoadResult = loadEnvConfig(process.cwd());

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const sessionPublicId = argValue("--session-public-id");
  const review = await writeActivityRuntimeLoopReview({
    session_public_id: sessionPublicId
  });

  console.log(JSON.stringify({
    status: review.status,
    session_public_id: review.session_public_id,
    runtime_attempt_count: review.runtime_attempt_count,
    evidence_record_count: review.evidence_record_count,
    snapshot_count: review.snapshot_count,
    latest_status: review.latest_status,
    limitations: review.limitations,
    artifact_path: review.artifact_path,
    no_openai_call_made: true,
    env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
