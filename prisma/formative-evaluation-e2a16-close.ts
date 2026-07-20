import { executeE2A16HumanReviewClosure } from
  "@/lib/evaluation/formative/e2a16-human-review-closure";

const requiredFlags = [
  "--confirm-user-supplied-dual-attestation",
  "--confirm-no-item-level-ratings-retained",
  "--confirm-no-inter-rater-reliability",
  "--confirm-no-provider-calls"
];

for (const flag of requiredFlags) {
  if (!process.argv.includes(flag)) {
    throw new Error(`e2a16_confirmation_missing:${flag}`);
  }
}

const result = executeE2A16HumanReviewClosure({
  confirmUserSuppliedDualAttestation: true,
  confirmNoItemLevelRatingsRetained: true,
  confirmNoInterRaterReliability: true,
  confirmNoProviderCalls: true
});

console.log(JSON.stringify({
  status: result.status,
  run_id: result.runId,
  run_directory: result.runDir,
  review_item_count: result.attestation.review_package_identity.review_item_count,
  closure_result: result.closure.closure_result,
  reconciliation_result: result.reconciliation.reconciliation_result,
  readiness_status: result.readiness.readiness_status,
  e2a17_session_count: result.protocol.session_count,
  e2a17_maximum_generation_calls: result.budget.maximum_total_generation_calls,
  provider_calls_made: 0,
  candidate_approved: false,
  candidate_activated: false
}, null, 2));
