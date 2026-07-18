import { loadEnvConfig } from "@next/env";
import { inspectE2A4Preflight } from "@/lib/evaluation/formative/e2a4-topic-dialogue-evaluation";

loadEnvConfig(process.cwd());

const live = process.argv.includes("--live");

async function main() {
  const result = await inspectE2A4Preflight({ requireLiveEnvironment: live });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a4_preflight_failed");
  process.exitCode = 1;
});
