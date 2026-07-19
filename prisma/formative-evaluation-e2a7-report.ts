import {
  latestE2A7RunId,
  readE2A7Adjudication
} from "@/lib/evaluation/formative/e2a7-v5-forensic-adjudication";

function requestedRunId() {
  const index = process.argv.indexOf("--run");
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function main() {
  const runId = requestedRunId() ?? latestE2A7RunId();
  if (!runId) throw new Error("e2a7_adjudication_run_not_found");
  const result = readE2A7Adjudication(runId);
  console.log(JSON.stringify({
    status: "read_only_report",
    run_id: runId,
    artifact_directory: result.runDir,
    manifest: result.manifest,
    case_accounting: result.cases,
    output_reclassification_count: result.outputs.length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
