import { loadEnvConfig } from "@next/env";
import {
  inspectE2A17Preflight
} from "@/lib/evaluation/formative/e2a17-bounded-student-simulator-canary";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const live = process.argv.includes("--live");
  const result = await inspectE2A17Preflight({
    requireLiveEnvironment: live,
    requireCleanTrackedTree: live,
    expectedCheckpointCommit: argument("--checkpoint-commit")
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a17_preflight_failed");
  process.exitCode = 1;
});
