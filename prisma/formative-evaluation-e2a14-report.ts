import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  E2A14_ARTIFACT_ROOT,
  loadE2A14Calibration
} from "@/lib/evaluation/formative/e2a14-protected-request-calibration";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function latestRun() {
  if (!existsSync(E2A14_ARTIFACT_ROOT)) return null;
  return readdirSync(E2A14_ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a14_"))
    .map((entry) => entry.name)
    .sort()
    .at(-1) ?? null;
}

function main() {
  const runId = argument("--run") ?? latestRun();
  if (!runId) throw new Error("e2a14_run_not_found");
  const runDir = path.join(E2A14_ARTIFACT_ROOT, runId);
  const result = loadE2A14Calibration(runDir);
  console.log(JSON.stringify({
    run_id: runId,
    run_directory: runDir,
    manifest: result.manifest,
    summary: result.summary,
    row_counts: {
      hard_negative_corpus: result.hardNegative.length,
      safe_refusal_corpus: result.safeRefusal.length,
      borderline_corpus: result.borderline.length,
      mutation_results: result.mutations.length,
      historical_replay: result.historicalReplay.length
    }
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "e2a14_report_failed");
  process.exitCode = 1;
}
