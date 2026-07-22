import path from "node:path";
import {
  E2A29B_ARTIFACT_ROOT,
  auditE2A29B,
  e2a30ArtifactContract,
  e2a30Budget,
  e2a30FrozenProtocol,
  latestE2A29BRun,
  runE2A29B,
  runE2A29BBoundaryCalibration
} from "@/lib/evaluation/formative/e2a29b-nonconceptual-profile-consistency";
import { stableHash } from "@/lib/operational/stable-hash";

function flag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function withNetworkGuard<T>(action: () => T | Promise<T>) {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a29b_network_request_prohibited");
  }) as typeof fetch;
  try {
    const result = await action();
    if (networkRequests !== 0) throw new Error("e2a29b_network_detected");
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const e1ArtifactDir = flag("--e1-artifact-dir");
    if (!e1ArtifactDir) throw new Error("e2a29b_e1_artifact_dir_required");
    const result = await withNetworkGuard(() => runE2A29B({
      runId: flag("--run-id"),
      e1ArtifactDir: path.resolve(e1ArtifactDir)
    }));
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.summary.run_id,
      artifact_path: result.runDir,
      e1_result: result.summary.e1,
      boundary_calibration: result.summary.boundary_calibration,
      transport_calibration: result.summary.transport_calibration,
      composite_runtime_identity_hash:
        result.summary.composite_runtime_identity_hash,
      e2a30_protocol_hash: result.summary.e2a30_protocol_hash,
      provider_calls_made: 0,
      network_requests_made: 0,
      e2a30_executed: false
    }, null, 2));
    return;
  }

  if (command === "report" || command === "audit") {
    const audit = auditE2A29B(flag("--run") ?? latestE2A29BRun() ?? undefined);
    console.log(JSON.stringify(audit, null, 2));
    if (!audit.passed) process.exitCode = 1;
    return;
  }

  if (command === "smoke") {
    const suite = flag("--suite") ?? "all";
    const supported = [
      "all",
      "conceptual-evidence-applicability",
      "nonconceptual-preservation",
      "mixed-intent-retention",
      "unsupported-understanding",
      "profile-update-disposition",
      "cross-artifact-consistency",
      "immediate-intent-routing",
      "re-engagement",
      "stale-profile",
      "sound-gate",
      "anchor-contradiction",
      "boundary-calibration",
      "historical-replay",
      "transport-preservation",
      "request-tracing",
      "exactly-once",
      "human-review-applicability",
      "e2a30-overlap",
      "e2a30-protocol",
      "e2a30-budget",
      "artifact-contract",
      "identity",
      "candidate-integrity",
      "provider-call-guard"
    ];
    if (!supported.includes(suite)) {
      throw new Error(`e2a29b_unknown_smoke_suite:${suite}`);
    }
    const calibration = await withNetworkGuard(() =>
      runE2A29BBoundaryCalibration()
    );
    if (calibration.summary.case_count < 96 ||
        calibration.summary.failed_count !== 0 ||
        !calibration.summary.same_layer_negative_mismatch_detected) {
      throw new Error(`e2a29b_${suite}_calibration_failed`);
    }
    const protocol = e2a30FrozenProtocol();
    const budget = e2a30Budget();
    const artifactContract = e2a30ArtifactContract();
    if (protocol.execution_authorized !== false ||
        protocol.live_execution_performed !== false ||
        budget.maximum.logical_generation_calls !== 29 ||
        budget.maximum.adapter_attempts !== 87 ||
        budget.expected_normal.logical_generation_calls !== 17 ||
        artifactContract.execution_authorized !== false) {
      throw new Error(`e2a29b_${suite}_protocol_invariant_failed`);
    }
    const latest = latestE2A29BRun();
    const audit = latest ? auditE2A29B(latest) : null;
    if (audit && !audit.passed) {
      throw new Error(`e2a29b_${suite}_artifact_audit_failed`);
    }
    console.log(JSON.stringify({
      status: "passed",
      suite,
      calibration_case_count: calibration.summary.case_count,
      calibration_passed_count: calibration.summary.passed_count,
      same_layer_negative_mismatch_detected:
        calibration.summary.same_layer_negative_mismatch_detected,
      e2a30_protocol_hash: stableHash(protocol),
      latest_artifact_audit_passed: audit?.passed ?? null,
      artifact_root: E2A29B_ARTIFACT_ROOT,
      provider_calls_made: 0,
      network_requests_made: 0,
      e2a29_rerun: false,
      e2a30_executed: false
    }, null, 2));
    return;
  }

  throw new Error("usage: formative-evaluation-e2a29b.ts run|report|audit|smoke");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a29b_failed");
  process.exitCode = 1;
});
