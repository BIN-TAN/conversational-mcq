import {
  loadE2A23ARun
} from "@/lib/evaluation/formative/e2a23a-turn-profile-reconciliation";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const result = loadE2A23ARun(argument("--run"));
  console.log(JSON.stringify({
    run_id: result.runId,
    run_directory: result.runDir,
    summary: result.summary,
    artifact_validation: result.validation
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message :
    "e2a23a_report_failed");
  process.exitCode = 1;
}
