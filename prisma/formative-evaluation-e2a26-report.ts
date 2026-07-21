import {
  loadE2A26Run
} from "@/lib/evaluation/formative/e2a26-failure-path-evidence";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

try {
  const result = loadE2A26Run(argument("--run"));
  console.log(JSON.stringify({
    run_id: result.runId,
    run_directory: result.runDir,
    summary: result.summary,
    artifact_validation: result.validation
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "e2a26_report_failed");
  process.exitCode = 1;
}
