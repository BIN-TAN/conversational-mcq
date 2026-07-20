import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  cleanupTemporaryE2A16ArtifactRoot,
  executeE2A16HumanReviewClosure,
  temporaryE2A16ArtifactRoot,
  validateE2A16Artifacts
} from "@/lib/evaluation/formative/e2a16-human-review-closure";

const suiteIndex = process.argv.indexOf("--suite");
const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : "all";
const allowedSuites = new Set([
  "all", "attestation", "reconciliation", "readiness", "protocol",
  "budget", "provider", "artifact"
]);
assert(allowedSuites.has(suite), `Unknown E2A.16 smoke suite: ${suite}`);

const root = temporaryE2A16ArtifactRoot();
let networkRequestCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  networkRequestCount += 1;
  throw new Error("e2a16_smoke_network_request_blocked");
}) as typeof fetch;

try {
  const result = executeE2A16HumanReviewClosure({
    confirmUserSuppliedDualAttestation: true,
    confirmNoItemLevelRatingsRetained: true,
    confirmNoInterRaterReliability: true,
    confirmNoProviderCalls: true,
    artifactRoot: root,
    runId: "e2a16_no_live_smoke",
    generatedAt: "2026-07-20T12:00:00.000Z"
  });
  const runDir = result.runDir;
  const attestation = result.attestation;
  const reviewers = attestation.reviewers;
  if (suite === "all" || suite === "attestation") {
    assert.equal(reviewers.length, 2);
    assert.deepEqual(reviewers.map((entry) => entry.reviewer_audit_alias), [
      "primary_project_owner", "secondary_colleague_reviewer"
    ]);
    assert(reviewers.every((entry) =>
      entry.full_package_reviewed && entry.reviewed_item_count_attested === 40 &&
      entry.overall_decision === "acceptable" &&
      entry.reported_critical_failure_count === 0
    ));
    assert.equal(attestation.item_level_ratings_retained, false);
    assert.equal(attestation.inter_rater_reliability_available, false);
    assert.equal(attestation.inter_rater_reliability_claimed, false);
  }
  if (suite === "all" || suite === "reconciliation") {
    assert.equal(result.reconciliation.reconciliation_result, "concordant");
    assert.equal(result.reconciliation.layers_kept_separate, true);
    assert.equal(
      result.reconciliation.fabricated_combined_rating_dataset_created, false
    );
    assert.equal(
      result.reconciliation.ai_assisted_independent_review.not_human_review,
      true
    );
  }
  if (suite === "all" || suite === "readiness") {
    assert.equal(
      result.readiness.readiness_status,
      "candidate_ready_for_bounded_student_simulator_canary"
    );
    assert.equal(result.readiness.candidate_approved, false);
    assert.equal(result.readiness.candidate_activated, false);
  }
  if (suite === "all" || suite === "protocol") {
    assert.equal(result.protocol.session_count, 4);
    assert.equal(result.protocol.maximum_student_turns_per_session, 6);
    assert.equal(result.protocol.dispatch_authorized, false);
    assert.equal(result.protocol.provider_requests_made, 0);
    const sessions = result.protocol.sessions;
    assert.equal(sessions.length, 4);
    assert(sessions.every((entry) =>
      entry.fresh_database_fixture_required &&
      entry.independent_hidden_student_state &&
      entry.maximum_student_turns === 6
    ));
  }
  if (suite === "all" || suite === "budget") {
    const budget = result.budget;
    assert.equal(budget.maximum_simulator_calls, 24);
    assert.equal(budget.maximum_tutor_initial_generation_calls, 24);
    assert.equal(budget.maximum_tutor_regeneration_calls, 24);
    assert.equal(budget.maximum_total_generation_calls, 72);
    assert.equal(budget.maximum_provider_adapter_attempts, 216);
    assert.equal(budget.maximum_input_tokens, 2_112_000);
    assert.equal(budget.maximum_output_tokens, 180_000);
    assert.equal(budget.maximum_total_tokens, 2_292_000);
  }
  if (suite === "all" || suite === "provider") {
    assert.equal(networkRequestCount, 0);
    assert.equal(result.protocol.provider_requests_made, 0);
  }
  if (suite === "all" || suite === "artifact") {
    assert.equal(validateE2A16Artifacts(runDir).passed, true);
    const files = [
      "e2a16-manifest.json", "human-review-attestation.json",
      "human-review-closure-summary.json",
      "three-layer-evidence-reconciliation.json",
      "candidate-readiness-gate.json", "candidate-integrity.json",
      "evidence-source-index.json",
      "e2a17-student-simulator-protocol-draft.json",
      "e2a17-budget-draft.json", "e2a17-artifact-contract.json",
      "e2a17-human-review-plan.json", "summary.json"
    ];
    assert(files.every((name) => existsSync(path.join(runDir, name))));
    const serialized = files.map((name) =>
      readFileSync(path.join(runDir, name), "utf8")
    ).join("\n");
    assert(!/\bsk-[A-Za-z0-9_-]{12,}/u.test(serialized));
    assert(!/OPENAI_API_KEY\s*=/u.test(serialized));
    assert(!/chain[ _-]?of[ _-]?thought/iu.test(serialized));
  }
  assert.equal(result.status,
    "e2a16_human_review_closed_candidate_ready_for_bounded_simulator");
  assert.equal(networkRequestCount, 0);
  console.log(JSON.stringify({
    status: "passed",
    suite,
    review_item_count: 40,
    reconciliation: result.reconciliation.reconciliation_result,
    readiness: result.readiness.readiness_status,
    e2a17_session_count: result.protocol.session_count,
    e2a17_maximum_generation_calls:
      result.budget.maximum_total_generation_calls,
    network_request_count: networkRequestCount,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  cleanupTemporaryE2A16ArtifactRoot(root);
}
