import { loadEnvConfig } from "@next/env";
import { inspectE2A15Preflight } from
  "@/lib/evaluation/formative/e2a15-protected-request-subset";

loadEnvConfig(process.cwd());

inspectE2A15Preflight({
  requireLiveEnvironment: process.argv.includes("--require-live-environment"),
  requireCleanTrackedTree:
    process.argv.includes("--require-clean-tracked-tree")
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}).catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a15_preflight_failed");
  process.exitCode = 1;
});
