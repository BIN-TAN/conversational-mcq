import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  E2A45_ARTIFACT_NAMES,
  E2A45_ARTIFACT_ROOT,
  inspectE2A45FreezeRun,
  latestE2A45FreezeRunDirectory,
  makeE2A45FreezeRunId,
  writeE2A45FreezeArtifacts
} from "../src/lib/evaluation/formative/e2a45-teacher-evidence-review-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a45_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const before = networkRequestCount;
  const result = writeE2A45FreezeArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - before
  });
  assert(
    networkRequestCount === before,
    "e2a45_provider_call_guard_detected_network_request"
  );
  return result;
}

function artifactsAreReadOnly(runDirectory: string) {
  return readdirSync(runDirectory).every((name) =>
    (statSync(path.join(runDirectory, name)).mode & 0o777) === 0o444
  );
}

function runSmoke(suite: string) {
  const runDirectory = mkdtempSync(
    path.join(tmpdir(), "e2a45-teacher-review-")
  );
  try {
    rmSync(runDirectory, { recursive: true, force: true });
    const result = execute(runDirectory);
    const suites = result.deterministic.suites;
    const checks: Record<string, boolean> = {
      all:
        result.summary.passed &&
        result.artifactValidation.passed &&
        result.deterministic.passed,
      "teacher-view": suites.teacher_view.passed,
      "role-separation": suites.role_separation.passed,
      privacy: suites.privacy.passed,
      "access-control": suites.access_control.passed,
      "audit-preservation": suites.audit_preservation.passed,
      "classroom-summary": suites.classroom_summary.passed,
      interpretation: suites.interpretation.passed,
      actions: suites.actions.passed,
      feedback: suites.feedback.passed,
      metrics: suites.metrics.passed,
      replay: suites.replay.passed,
      regressions: result.deterministic.regressions.passed,
      historical: result.historicalIntegrity.passed,
      budget:
        result.budget.frozen_future_live_limits
          .maximum_logical_calls === 29 &&
        result.budget.frozen_future_live_limits
          .maximum_adapter_attempts === 87 &&
        result.budget.frozen_future_live_limits
          .provider_concurrency === 1 &&
        result.budget.frozen_future_live_limits
          .maximum_transport_retries_per_logical_call === 2 &&
        result.budget.frozen_future_live_limits
          .maximum_input_tokens === 900_000 &&
        result.budget.frozen_future_live_limits
          .maximum_output_tokens === 70_000 &&
        result.budget.frozen_future_live_limits
          .maximum_total_tokens === 970_000 &&
        result.budget.frozen_future_live_limits
          .maximum_cost_usd_when_pricing_available === 25 &&
        result.budget.protocol_freeze_provider_call_budget === 0 &&
        !result.budget.execution_authorized,
      "protected-components":
        result.protectedIntegrity.passed &&
        result.candidateIntegrity.passed,
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length ===
          E2A45_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a45_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a45_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity
          .composite_runtime_identity_hash,
      contract_count: result.summary.contract_count,
      synthetic_scenario_count:
        result.summary.synthetic_scenario_count,
      required_regression_count:
        result.summary.required_regression_count,
      deterministic_check_count:
        result.summary.deterministic_check_count,
      metrics_passed: result.summary.metrics_passed,
      teacher_ui_modified: false,
      runtime_intelligence_modified: false,
      database_schema_modified: false,
      candidate_approved: false,
      candidate_activated: false,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount
    }, null, 2));
  } finally {
    if (readdirSync(runDirectory).length > 0) {
      chmodSync(runDirectory, 0o755);
      for (const name of readdirSync(runDirectory)) {
        chmodSync(path.join(runDirectory, name), 0o644);
      }
    }
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const runDirectory = path.join(
      E2A45_ARTIFACT_ROOT,
      makeE2A45FreezeRunId()
    );
    const result = execute(runDirectory);
    console.log(JSON.stringify({
      ...result.summary,
      artifact_directory:
        path.relative(process.cwd(), runDirectory)
    }, null, 2));
    return;
  }
  if (command === "report") {
    const runIndex = process.argv.indexOf("--run");
    const runDirectory = runIndex >= 0
      ? path.join(
          E2A45_ARTIFACT_ROOT,
          process.argv[runIndex + 1] ??
            "missing_e2a45_run_identifier"
        )
      : latestE2A45FreezeRunDirectory();
    console.log(JSON.stringify(
      inspectE2A45FreezeRun(runDirectory),
      null,
      2
    ));
    return;
  }
  if (command === "smoke") {
    const suiteIndex = process.argv.indexOf("--suite");
    runSmoke(
      suiteIndex >= 0
        ? process.argv[suiteIndex + 1] ?? "all"
        : "all"
    );
    return;
  }
  throw new Error(`e2a45_unknown_command:${command}`);
}

main();
