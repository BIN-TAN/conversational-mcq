import { loadE2A24Run } from
  "@/lib/evaluation/formative/e2a24-autonomous-formative-dialogue";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

try {
  const result = loadE2A24Run(argument("--run"));
  console.log(JSON.stringify({
    run_id: result.runId,
    run_directory: result.runDir,
    summary: result.summary,
    artifact_validation: result.validation
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "e2a24_report_failed");
  process.exitCode = 1;
}
