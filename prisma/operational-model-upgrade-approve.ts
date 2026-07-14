import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const candidateRun = argValue("--candidate-run");
const expectedHash = argValue("--expected-hash");
const confirmation = argValue("--confirm");
const comparison = buildOperationalModelUpgradeComparison();
const actualHash = comparison.candidate.candidate_configuration_hash;

if (!candidateRun || !expectedHash || confirmation !== "approve GPT-5.6 operational candidate") {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_approval_arguments",
    required: [
      "--candidate-run <run_public_id>",
      "--expected-hash <candidate_hash>",
      "--confirm \"approve GPT-5.6 operational candidate\""
    ],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

if (expectedHash !== actualHash) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "candidate_hash_mismatch",
    expected_hash: expectedHash,
    actual_hash: actualHash,
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

console.error(JSON.stringify({
  status: "blocked",
  reason: "candidate_evaluation_and_human_review_evidence_required",
  candidate_run_public_id: candidateRun,
  candidate_hash: actualHash,
  no_provider_call: true,
  message: "Approval must verify a completed live candidate evaluation and required human review before updating the approved manifest."
}, null, 2));
process.exit(1);
