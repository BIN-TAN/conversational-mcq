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
  E2A49_ARTIFACT_NAMES,
  E2A49_ARTIFACT_ROOT,
  inspectE2A49ProtocolRun,
  latestE2A49ProtocolRunDirectory,
  makeE2A49ProtocolRunId,
  writeE2A49ProtocolArtifacts
} from "../src/lib/evaluation/formative/e2a49-render-staging-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a49_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const before = networkRequestCount;
  const result = writeE2A49ProtocolArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - before
  });
  assert(
    networkRequestCount === before,
    "e2a49_provider_call_guard_detected_network_request"
  );
  return result;
}

function artifactsAreReadOnly(runDirectory: string) {
  return readdirSync(runDirectory).every(
    (name) =>
      (statSync(path.join(runDirectory, name)).mode & 0o777) === 0o444
  );
}

function runSmoke(suite: string) {
  const runDirectory = mkdtempSync(
    path.join(tmpdir(), "e2a49-render-staging-protocol-")
  );
  try {
    rmSync(runDirectory, { recursive: true, force: true });
    const result = execute(runDirectory);
    const checks: Record<string, boolean> = {
      all:
        result.summary.passed &&
        result.artifactValidation.passed &&
        result.validations.failure_recovery.passed,
      configuration:
        result.validations.configuration.repository_checks_passed &&
        result.validations.configuration.operator_evidence_codes
          .length === 3 &&
        result.validations.configuration.raw_values_suppressed,
      build:
        result.validations.build.repository_checks_passed &&
        result.validations.build.configured_node_major === 22 &&
        result.validations.build.expected_node_heap_megabytes ===
          12288,
      database:
        result.validations.database.repository_checks_passed &&
        result.validations.database.migration_directory_count > 0 &&
        !result.validations.database.production_database_contacted &&
        !result.validations.database.migration_executed,
      health:
        result.validations.health.repository_checks_passed &&
        result.validations.health.endpoint === "/api/health" &&
        !result.validations.health.deployed_staging_contacted,
      "cba-smoke":
        result.validations.cba_smoke.passed &&
        result.validations.cba_smoke.ordered_steps.length === 10 &&
        result.validations.cba_smoke.synthetic_student_count === 2 &&
        result.validations.cba_smoke.staging_execution_status ===
          "operator_evidence_required",
      "data-integrity":
        result.validations.data_integrity.passed &&
        result.validations.data_integrity.checks.length === 6 &&
        result.validations.data_integrity.synthetic_state_only,
      security:
        result.validations.security.passed &&
        result.validations.security.direct_production_console_references
          .length === 0 &&
        result.validations.security.raw_values_suppressed &&
        !result.validations.security.student_private_content_recorded,
      "failure-recovery":
        result.validations.failure_recovery.passed &&
        result.validations.failure_recovery.required_case_count === 8 &&
        result.validations.failure_recovery.cases.length === 8,
      rollback:
        result.validations.rollback.repository_checks_passed &&
        !result.validations.rollback.destructive_rollback_performed,
      "operator-checklist":
        result.validations.operator_checklist.passed &&
        result.validations.operator_checklist.pending_check_count > 0 &&
        !result.validations.operator_checklist.deployment_executed,
      historical:
        result.historicalIntegrity.passed &&
        !result.historicalIntegrity.historical_artifacts_modified,
      "protected-components":
        result.protectedIntegrity.passed &&
        result.protectedIntegrity.evaluator_v5_unchanged &&
        result.protectedIntegrity.tutor_candidate_unchanged &&
        result.protectedIntegrity.deployment_hardening_logger_unchanged &&
        result.protectedIntegrity.e2a48_sources_unchanged,
      budget:
        result.budget.frozen_future_staging_ceiling
          .logical_calls_maximum === 29 &&
        result.budget.frozen_future_staging_ceiling
          .adapter_attempts_maximum === 87 &&
        result.budget.frozen_future_staging_ceiling
          .provider_concurrency === 1 &&
        result.budget.protocol_freeze_execution_budget.provider_calls ===
          0 &&
        result.budget.protocol_freeze_execution_budget
          .network_requests === 0 &&
        !result.budget.deployment_executed &&
        !result.budget.candidate_approved &&
        !result.budget.candidate_activated,
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length ===
          E2A49_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        result.providerCallGuard.database_queries_made === 0 &&
        result.providerCallGuard.render_api_calls_made === 0 &&
        !result.providerCallGuard.provider_credentials_read &&
        !result.providerCallGuard.environment_secret_values_read &&
        !result.providerCallGuard.deployment_executed &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a49_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a49_${suite}_smoke_failed`);
    console.log(
      JSON.stringify(
        {
          status: "passed",
          suite,
          protocol_version: result.protocol.protocol_version,
          protocol_hash: result.protocol.protocol_hash,
          composite_runtime_identity_hash:
            result.compositeRuntimeIdentity
              .composite_runtime_identity_hash,
          contract_count: result.summary.contract_count,
          synthetic_cba_step_count:
            result.summary.synthetic_cba_step_count,
          failure_recovery_case_count:
            result.summary.failure_recovery_case_count,
          staging_execution_status:
            result.summary.staging_execution_status,
          staging_deployment_validated: false,
          deployment_executed: false,
          candidate_approved: false,
          candidate_activated: false,
          provider_calls_made: 0,
          network_requests_made: networkRequestCount
        },
        null,
        2
      )
    );
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
      E2A49_ARTIFACT_ROOT,
      makeE2A49ProtocolRunId()
    );
    const result = execute(runDirectory);
    console.log(
      JSON.stringify(
        {
          ...result.summary,
          artifact_directory: path.relative(
            process.cwd(),
            runDirectory
          )
        },
        null,
        2
      )
    );
    return;
  }
  if (command === "report") {
    const runIndex = process.argv.indexOf("--run");
    const runDirectory =
      runIndex >= 0
        ? path.join(
            E2A49_ARTIFACT_ROOT,
            process.argv[runIndex + 1] ??
              "missing_e2a49_run_identifier"
          )
        : latestE2A49ProtocolRunDirectory();
    console.log(
      JSON.stringify(inspectE2A49ProtocolRun(runDirectory), null, 2)
    );
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
  throw new Error(`e2a49_unknown_command:${command}`);
}

main();
