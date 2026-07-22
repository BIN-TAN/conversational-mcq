import {
  E2A28A_ARTIFACT_ROOT,
  assertE2A28ALiveEvaluatorV5ContractSelection,
  auditE2A28A,
  latestE2A28ARun,
  runE2A28A,
  runE2A28ACalibration
} from "@/lib/evaluation/formative/e2a28a-semantic-anchor-consistency";

function flag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function withNetworkGuard<T>(action: () => T | Promise<T>) {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a28a_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await action();
    if (networkRequests !== 0) throw new Error("e2a28a_network_detected");
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const result = await withNetworkGuard(() => runE2A28A());
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.summary.run_id,
      artifact_path: result.runDir,
      calibration_case_count: result.summary.calibration.case_count,
      provider_calls_made: result.summary.provider_calls_made,
      network_requests_made: result.summary.network_requests_made,
      e2a29_executed: result.summary.e2a29_executed
    }, null, 2));
    return;
  }
  if (command === "report" || command === "audit") {
    const audit = auditE2A28A(flag("--run") ?? latestE2A28ARun() ?? undefined);
    console.log(JSON.stringify(audit, null, 2));
    if (!audit.passed) process.exitCode = 1;
    return;
  }
  if (command === "smoke") {
    const suite = flag("--suite") ?? "all";
    const audit = auditE2A28A();
    if (!audit.passed) throw new Error("e2a28a_artifact_audit_failed");
    const liveEvaluatorSelection = ["all", "live-evaluator-contract"]
      .includes(suite)
      ? assertE2A28ALiveEvaluatorV5ContractSelection()
      : null;
    if (["all", "calibration", "anchor-alias", "live-evaluator-contract",
      "evaluator-v5",
      "mapper-v5", "contradiction-propagation", "cross-artifact-consistency",
      "pre-tutor-finalization", "tutor-dispatch-order", "replay",
      "human-review-binding",
      "e2a29-protocol", "e2a29-budget", "identity", "candidate-integrity",
      "provider-call-guard"].includes(suite)) {
      const calibration = runE2A28ACalibration();
      if (calibration.summary.failed_count !== 0 ||
          calibration.summary.case_count < 180) {
        throw new Error(`e2a28a_${suite}_smoke_failed`);
      }
    } else {
      throw new Error(`e2a28a_unknown_smoke_suite:${suite}`);
    }
    console.log(JSON.stringify({
      status: "passed",
      suite,
      run_id: audit.run_id,
      artifact_root: E2A28A_ARTIFACT_ROOT,
      provider_calls_made: 0,
      network_requests_made: 0,
      live_evaluator_v5_selection_passed:
        liveEvaluatorSelection?.passed ?? null,
      e2a29_executed: false
    }, null, 2));
    return;
  }
  throw new Error(
    "usage: formative-evaluation-e2a28a.ts run|report|audit|smoke"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a28a_failed");
  process.exitCode = 1;
});
