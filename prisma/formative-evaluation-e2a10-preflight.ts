import { loadEnvConfig } from "@next/env";
import { inspectE2A10Preflight } from
  "@/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary";

loadEnvConfig(process.cwd());

async function main() {
  const result = await inspectE2A10Preflight({
    requireLiveEnvironment: process.argv.includes("--live"),
    requireCleanTree: process.argv.includes("--require-clean-tree")
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a10_preflight_failed");
  process.exitCode = 1;
});
