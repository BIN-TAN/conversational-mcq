import { loadEnvConfig } from "@next/env";
import { runE2A5Adjudication } from "@/lib/evaluation/formative/e2a5-progression-adjudication";

loadEnvConfig(process.cwd());

const result = runE2A5Adjudication();
console.log(JSON.stringify({
  status: "adjudication_ready_for_human_review",
  run_id: result.runId,
  artifact_directory: result.runDir,
  selected_path: result.adjudication.candidateDecision.selected_path,
  v5_candidate_hash: result.adjudication.candidate.candidate_configuration_hash,
  v5_candidate_file_sha256: result.adjudication.candidate.candidate_file_sha256,
  reviewed_case_count: result.adjudication.caseEvidence.length,
  provider_calls: 0,
  candidate_approved: false,
  candidate_activated: false
}, null, 2));
