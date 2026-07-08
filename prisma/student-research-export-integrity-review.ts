import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/db";
import { buildResearchExportIntegrityReview } from "../src/lib/services/teacher-research-export/integrity-review";

const envLoadResult = loadEnvConfig(process.cwd());

function argValue(name: string) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = process.env.LLM_LIVE_CALLS_ENABLED ?? "false";

  const sessionPublicId = argValue("--session-public-id");
  const review = await buildResearchExportIntegrityReview({
    session_public_id: sessionPublicId,
    write_artifact: true
  });

  console.log(JSON.stringify({
    ...review.summary,
    no_live_provider_call_made: review.no_live_provider_call_made,
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
