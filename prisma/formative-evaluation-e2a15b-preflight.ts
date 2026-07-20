import { loadEnvConfig } from "@next/env";
import { inspectE2A15BPreflight } from
  "@/lib/evaluation/formative/e2a15b-protected-request-supplement";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

inspectE2A15BPreflight({
  requireLiveEnvironment: process.argv.includes("--require-live-environment"),
  requireCleanTrackedTree:
    process.argv.includes("--require-clean-tracked-tree"),
  expectedCheckpointCommit: argument("--checkpoint-commit")
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}).catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a15b_preflight_failed");
  process.exitCode = 1;
});
