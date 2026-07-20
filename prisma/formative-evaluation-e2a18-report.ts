import {
  E2A18_ARTIFACT_ROOT,
  loadE2A18Run
} from "@/lib/evaluation/formative/e2a18-simulator-contract-adjudication";
import { existsSync, readdirSync } from "node:fs";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function latestRunId() {
  if (!existsSync(E2A18_ARTIFACT_ROOT)) return null;
  return readdirSync(E2A18_ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a18_"))
    .map((entry) => entry.name)
    .sort()
    .at(-1) ?? null;
}

function main() {
  const runId = argument("--run") ?? latestRunId();
  if (!runId) throw new Error("e2a18_run_not_found");
  const result = loadE2A18Run(runId);
  console.log(JSON.stringify({
    run_id: runId,
    run_directory: result.runDir,
    summary: result.summary,
    historical_replay: result.replay,
    abort_aware_integrity: result.integrity,
    artifact_validation: result.artifactValidation
  }, null, 2));
  if (!result.artifactValidation.passed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message :
    "e2a18_report_failed");
  process.exitCode = 1;
}
