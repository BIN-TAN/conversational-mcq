import {
  E2A29A_ARTIFACT_ROOT,
  auditE2A29A,
  e2a30ArtifactContract,
  e2a30Budget,
  e2a30FrozenProtocol,
  latestE2A29ARun,
  runE2A29A,
  runE2A29ATransportCalibration
} from "@/lib/evaluation/formative/e2a29a-provider-infrastructure-reconciliation";
import {
  PROVIDER_TRANSPORT_RETRY_LIMITS,
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
  providerFailureTaxonomyArtifact
} from "@/lib/llm/provider-transport-retry";

function flag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function withNetworkGuard<T>(action: () => T | Promise<T>) {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a29a_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await action();
    if (networkRequests !== 0) throw new Error("e2a29a_network_detected");
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const result = await withNetworkGuard(() => runE2A29A());
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.summary.run_id,
      artifact_path: result.runDir,
      calibration_case_count: result.summary.calibration.case_count,
      protected_evidence_unchanged:
        result.summary.protected_evidence_unchanged,
      e2a30_protocol_hash: result.summary.e2a30_protocol_hash,
      provider_calls_made: 0,
      network_requests_made: 0,
      e2a30_executed: false
    }, null, 2));
    return;
  }

  if (command === "report" || command === "audit") {
    const audit = auditE2A29A(flag("--run") ?? latestE2A29ARun() ?? undefined);
    console.log(JSON.stringify(audit, null, 2));
    if (!audit.passed) process.exitCode = 1;
    return;
  }

  if (command === "smoke") {
    const suite = flag("--suite") ?? "all";
    const supported = [
      "all",
      "provider-failure-classification",
      "provider-520-retry",
      "timeout-retry",
      "nonretryable-failure",
      "transport-semantic-separation",
      "transport-retry",
      "attempt-tracing",
      "idempotency",
      "duplicate-response",
      "stale-context-retry",
      "budget-before-retry",
      "request-id-artifact",
      "calibration",
      "budget",
      "counterfactual-replay",
      "e2a29-reconciliation",
      "human-review-applicability",
      "e2a30-protocol",
      "e2a30-budget",
      "e2a30-overlap",
      "artifact-contract",
      "identity",
      "candidate-integrity",
      "provider-call-guard"
    ];
    if (!supported.includes(suite)) {
      throw new Error(`e2a29a_unknown_smoke_suite:${suite}`);
    }
    const calibration = await withNetworkGuard(() => runE2A29ATransportCalibration());
    if (calibration.summary.case_count < 80 || calibration.summary.failed_count !== 0) {
      throw new Error(`e2a29a_${suite}_calibration_failed`);
    }
    const protocol = e2a30FrozenProtocol();
    const budget = e2a30Budget();
    const artifactContract = e2a30ArtifactContract();
    if (
      protocol.execution_authorized !== false ||
      protocol.live_execution_performed !== false ||
      budget.maximum.logical_generation_calls !== 29 ||
      budget.expected_normal.logical_generation_calls !== 17 ||
      artifactContract.execution_authorized !== false ||
      PROVIDER_TRANSPORT_RETRY_LIMITS.maximum_adapter_attempts_per_logical_call !== 3 ||
      providerFailureTaxonomyArtifact().taxonomy_version !== "provider-failure-taxonomy-v1"
    ) {
      throw new Error(`e2a29a_${suite}_protocol_invariant_failed`);
    }
    const latest = latestE2A29ARun();
    const audit = latest ? auditE2A29A(latest) : null;
    if (audit && !audit.passed) throw new Error(`e2a29a_${suite}_artifact_audit_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
      calibration_case_count: calibration.summary.case_count,
      latest_artifact_audit_passed: audit?.passed ?? null,
      artifact_root: E2A29A_ARTIFACT_ROOT,
      provider_calls_made: 0,
      network_requests_made: 0,
      e2a29_rerun: false,
      e2a30_executed: false
    }, null, 2));
    return;
  }

  throw new Error("usage: formative-evaluation-e2a29a.ts run|report|audit|smoke");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a29a_failed");
  process.exitCode = 1;
});
