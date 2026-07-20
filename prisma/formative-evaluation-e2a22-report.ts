import { loadE2A22Run } from
  "@/lib/evaluation/formative/e2a22-evidence-first-profile-routing";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const runId = argument("--run");
  if (!runId) throw new Error("e2a22_run_argument_required");
  const result = loadE2A22Run(runId);
  console.log(JSON.stringify({
    run_id: runId,
    run_directory: result.runDir,
    summary: result.summary,
    protected_evidence_unchanged:
      result.manifest.protected_evidence_unchanged,
    artifact_validation: result.artifact_validation
  }, null, 2));
  if (!result.artifact_validation.passed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "e2a22_report_failed");
  process.exitCode = 1;
}
