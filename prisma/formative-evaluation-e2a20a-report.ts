import { loadE2A20ARun } from
  "@/lib/evaluation/formative/e2a20a-turn4-classification-adjudication";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runId = argument("--run");
  if (!runId) throw new Error("e2a20a_run_id_required");
  const result = loadE2A20ARun(runId);
  console.log(JSON.stringify({
    run_id: runId,
    run_directory: result.runDir,
    summary: result.summary,
    artifact_validation: result.artifactValidation
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a20a_report_failed");
  process.exitCode = 1;
});
