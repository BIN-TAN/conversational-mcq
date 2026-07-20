import { loadE2A16Run } from
  "@/lib/evaluation/formative/e2a16-human-review-closure";

const index = process.argv.indexOf("--run");
const runId = index >= 0 ? process.argv[index + 1] : undefined;
if (!runId) throw new Error("e2a16_report_run_required");

const report = loadE2A16Run(runId);
console.log(JSON.stringify({
  run_directory: report.runDir,
  summary: report.summary,
  human_review_attestation: report.attestation,
  human_review_closure: report.closure,
  three_layer_reconciliation: report.reconciliation,
  candidate_readiness: report.readiness,
  e2a17_protocol: report.protocol,
  e2a17_budget: report.budget,
  artifact_validation: report.validation
}, null, 2));
