import { loadEnvConfig } from "@next/env";
import { inspectE2A13Preflight } from
  "@/lib/evaluation/formative/e2a13-v8-30-case-evaluation";

loadEnvConfig(process.cwd());

async function main() {
  const result = await inspectE2A13Preflight({
    requireLiveEnvironment: process.argv.includes("--live"),
    requireCleanTrackedTree: process.argv.includes("--require-clean-tree")
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a13_preflight_failed");
  process.exitCode = 1;
});
