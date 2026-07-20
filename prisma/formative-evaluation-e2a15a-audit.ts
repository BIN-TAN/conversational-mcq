import {
  executeE2A15aProtocolAudit,
  validateE2A15aAuditArtifacts
} from "@/lib/evaluation/formative/e2a15a-protocol-completeness-audit";

function main() {
  const result = executeE2A15aProtocolAudit();
  const validation = validateE2A15aAuditArtifacts(result.runDir);
  if (!validation.passed) {
    throw new Error("e2a15a_audit_artifact_validation_failed");
  }
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: result.runId,
    run_directory: result.runDir,
    protocol_defined_case_count:
      result.summary.protocol_defined_case_count,
    authorized_required_case_count:
      result.summary.authorized_required_case_count,
    scheduled_case_count: result.summary.scheduled_case_count,
    dispatched_case_count: result.summary.dispatched_case_count,
    completed_case_count: result.summary.completed_case_count,
    missing_categories: result.categoryMapping.filter((entry) =>
      !entry.covered
    ).map((entry) => entry.required_category),
    supplemental_protocol_hash: result.supplementalHash,
    human_review_original_item_count:
      result.summary.human_review_original_item_count,
    human_review_formal_template_item_count:
      result.summary.human_review_formal_template_item_count,
    human_review_completed: false,
    provider_call_count: 0,
    candidate_approved: false,
    candidate_activated: false,
    validation
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
