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
  E2A47_ARTIFACT_NAMES,
  E2A47_ARTIFACT_ROOT,
  inspectE2A47FreezeRun,
  latestE2A47FreezeRunDirectory,
  makeE2A47FreezeRunId,
  writeE2A47FreezeArtifacts
} from "../src/lib/evaluation/formative/e2a47-pilot-dry-run-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a47_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const before = networkRequestCount;
  const result = writeE2A47FreezeArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - before
  });
  assert(
    networkRequestCount === before,
    "e2a47_provider_call_guard_detected_network_request"
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
    path.join(tmpdir(), "e2a47-pilot-dry-run-")
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
      workflow: suites.workflow.passed,
      "end-to-end": suites.data_trace.passed,
      "schema-alignment":
        suites.schema_alignment.passed &&
        suites.e2a44_alignment.passed,
      export: suites.research_export.passed,
      "teacher-review": suites.teacher_review.passed,
      "failure-recovery": suites.failure_recovery.passed,
      privacy: suites.privacy.passed,
      "audit-preservation": suites.audit_preservation.passed,
      "profile-evolution": suites.profile_evolution.passed,
      "engagement-evolution": suites.engagement_evolution.passed,
      "intervention-history": suites.intervention_history.passed,
      "multi-student-isolation":
        suites.multi_student_isolation.passed,
      metrics:
        result.deterministic.metrics
          .synthetic_protocol_metrics_passed,
      replay: result.deterministic.replay.passed,
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
        !result.budget.execution_authorized &&
        !result.budget.deployment_authorized,
      "protected-components":
        result.protectedIntegrity.passed &&
        result.candidateIntegrity.passed,
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length ===
          E2A47_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a47_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a47_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity
          .composite_runtime_identity_hash,
      contract_count: result.summary.contract_count,
      synthetic_student_count:
        result.summary.synthetic_student_count,
      trace_stage_count: result.summary.trace_stage_count,
      failure_scenario_count:
        result.summary.failure_scenario_count,
      required_regression_count:
        result.summary.required_regression_count,
      deterministic_check_count:
        result.summary.deterministic_check_count,
      synthetic_end_to_end_validation_passed: true,
      actual_classroom_pilot_executed: false,
      classroom_effectiveness_established: false,
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
      E2A47_ARTIFACT_ROOT,
      makeE2A47FreezeRunId()
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
          E2A47_ARTIFACT_ROOT,
          process.argv[runIndex + 1] ??
            "missing_e2a47_run_identifier"
        )
      : latestE2A47FreezeRunDirectory();
    console.log(JSON.stringify(
      inspectE2A47FreezeRun(runDirectory),
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
  throw new Error(`e2a47_unknown_command:${command}`);
}

main();
