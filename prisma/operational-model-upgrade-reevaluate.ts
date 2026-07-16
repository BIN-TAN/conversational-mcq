import { loadEnvConfig } from "@next/env";
import { reevaluateModelUpgradeRunOffline } from "../src/lib/operational/model-upgrade-reevaluation";
import { argValue } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

const candidateRun = argValue("--candidate-run");
const expectedRuntimeHash = argValue("--expected-runtime-hash");
const expectedSourceProtocolHash = argValue("--expected-source-evaluation-protocol-hash");

if (!candidateRun || !expectedRuntimeHash || !expectedSourceProtocolHash) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_offline_reevaluation_arguments",
    required: [
      "--candidate-run <source_run_public_id>",
      "--expected-runtime-hash <runtime_candidate_hash>",
      "--expected-source-evaluation-protocol-hash <source_evaluation_protocol_hash>"
    ],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

try {
  const result = reevaluateModelUpgradeRunOffline({
    candidateRunPublicId: candidateRun,
    expectedRuntimeCandidateHash: expectedRuntimeHash,
    expectedSourceEvaluationProtocolHash: expectedSourceProtocolHash
  });
  console.log(JSON.stringify({
    status: result.status,
    no_provider_call: true,
    source_provider_run_id: result.source_provider_run_id,
    derived_evaluation_id: result.derived_evaluation_id,
    runtime_candidate_hash: result.runtime_candidate_hash,
    source_evaluation_protocol_hash: result.source_evaluation_protocol_hash,
    evaluation_protocol_hash: result.evaluation_protocol_hash,
    source_artifact_sha256: result.source_artifact_sha256,
    source_artifacts_immutable: result.source_artifacts_immutable,
    provider_evidence_intact: result.provider_evidence_intact,
    original_failure_count: result.case_results.filter((entry) => entry.original_critical_failure).length,
    derived_failure_count: result.case_results.filter((entry) => entry.critical_failure).length,
    recommendation: result.recommendation,
    review_artifact_paths: result.review_artifact_paths,
    next_command:
      `npm run operational:model-upgrade:review-confirm -- --derived-evaluation ${result.derived_evaluation_id} --review-artifact ${result.review_artifact_paths.review_records_jsonl} --confirm "I reviewed all required candidate outputs" --decision approve --reviewer <safe_identifier>`
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof Error ? error.message : "offline_reevaluation_failed",
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}
