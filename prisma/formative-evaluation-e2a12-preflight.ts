import { loadEnvConfig } from "@next/env";
import { inspectE2A12Preflight } from
  "@/lib/evaluation/formative/e2a12-v8-runtime-canary";

loadEnvConfig(process.cwd());

async function main() {
  const result = await inspectE2A12Preflight({
    requireLiveEnvironment: process.argv.includes("--live"),
    requireCleanTrackedTree: process.argv.includes("--require-clean-tree")
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a12_preflight_failed");
  process.exitCode = 1;
});
