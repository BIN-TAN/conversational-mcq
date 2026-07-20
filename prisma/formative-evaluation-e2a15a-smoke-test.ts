import assert from "node:assert/strict";
import {
  cleanupTemporaryE2A15aArtifactRoot,
  E2A15A_SOURCE_RUN_ID,
  executeE2A15aProtocolAudit,
  temporaryE2A15aArtifactRoot,
  validateE2A15aAuditArtifacts
} from "@/lib/evaluation/formative/e2a15a-protocol-completeness-audit";
import { E2A14_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a14-protected-request-validator-candidate";

async function main() {
  let networkRequestCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a15a_network_request_forbidden");
  }) as typeof fetch;

  const root = temporaryE2A15aArtifactRoot();
  try {
    const result = executeE2A15aProtocolAudit({ artifactRoot: root });
    const validation = validateE2A15aAuditArtifacts(result.runDir);
    assert.equal(validation.passed, true);
    assert.equal(result.summary.source_e2a15_run_id, E2A15A_SOURCE_RUN_ID);
    assert.equal(result.summary.protocol_defined_case_count, 6);
    assert.equal(result.summary.authorized_required_case_count, 8);
    assert.equal(result.summary.scheduled_case_count, 6);
    assert.equal(result.summary.dispatched_case_count, 6);
    assert.equal(result.summary.completed_case_count, 6);
    assert.equal(result.summary.provider_call_count, 6);
    assert.equal(result.summary.audit_provider_call_count, 0);
    assert.equal(result.summary.supplemental_two_case_protocol_required, true);
    assert.equal(result.supplemental.case_count, 2);
    assert.equal(result.supplemental.provider_dispatch_authorized, false);
    assert.equal(result.overlap.exact_overlap_count, 0);
    assert.equal(result.overlap.all_cases_passed, true);
    assert.equal(result.humanRows.length, 38);
    assert.equal(new Set(result.humanRows.map((entry) =>
      entry.review_item_id
    )).size, 38);
    assert.equal(result.humanRows.filter((entry) =>
      entry.item_type === "fresh_live_case"
    ).length, 6);
    assert.equal(result.humanRows.filter((entry) =>
      entry.item_type === "historical_case_recomposition"
    ).length, 30);
    assert.equal(result.humanRows.filter((entry) =>
      entry.item_type === "historical_attempt"
    ).length, 2);
    assert(result.humanRows.every((entry) =>
      entry.disclosure_safety === null &&
      entry.answer_key_safety === null &&
      entry.redirect_quality_score === null &&
      entry.distractor_continuity_score === null &&
      entry.naturalness_score === null &&
      entry.overall_human_decision === null &&
      entry.critical_failure === null &&
      entry.reviewer_id === null &&
      entry.reviewer_notes === null &&
      entry.reviewer_confidence === null &&
      entry.reviewed_timestamp === null
    ));
    assert.deepEqual(
      result.categoryMapping.filter((entry) => !entry.covered).map((entry) =>
        entry.required_category
      ),
      [
        "informal_or_grammatically_imperfect_protected_request",
        "long_history_refusal_and_distractor_continuity_stress"
      ]
    );
    assert.deepEqual(result.discrepancy.selected_classifications, [
      "protocol_generation_defect",
      "incomplete_execution",
      "authorization_scope_misinterpretation"
    ]);
    assert.equal(result.summary.candidate_hash, E2A14_CANDIDATE_HASH);
    assert.equal(result.summary.candidate_unchanged, true);
    assert.equal(result.summary.candidate_approved, false);
    assert.equal(result.summary.candidate_activated, false);
    assert.equal(result.summary.approval_evidence_created, false);
    assert.equal(result.summary.activation_evidence_created, false);
    assert.equal(networkRequestCount, 0);
    console.log(JSON.stringify({
      status: "passed",
      source_run_id: E2A15A_SOURCE_RUN_ID,
      protocol_defined_case_count: 6,
      authorized_required_case_count: 8,
      supplemental_case_count: 2,
      supplemental_protocol_hash: result.supplementalHash,
      human_review_item_count: result.humanRows.length,
      validation_checks: validation.checks,
      provider_call_count: 0,
      network_request_count: networkRequestCount,
      candidate_approved: false,
      candidate_activated: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    cleanupTemporaryE2A15aArtifactRoot(root);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
