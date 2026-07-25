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
  E2A39_ARTIFACT_NAMES,
  E2A39_ARTIFACT_ROOT,
  inspectE2A39FreezeRun,
  latestE2A39FreezeRunDirectory,
  makeE2A39FreezeRunId,
  writeE2A39FreezeArtifacts
} from "../src/lib/evaluation/formative/e2a39-transfer-closure-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a39_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const requestCountBefore = networkRequestCount;
  const result = writeE2A39FreezeArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - requestCountBefore
  });
  assert(
    networkRequestCount === requestCountBefore,
    "e2a39_provider_call_guard_detected_network_request"
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
    path.join(tmpdir(), "e2a39-transfer-closure-")
  );
  try {
    rmSync(runDirectory, { recursive: true, force: true });
    const result = execute(runDirectory);
    const suites = result.deterministic.suites;
    const checks: Record<string, boolean> = {
      all:
        result.summary.passed &&
        result.artifactValidation.passed &&
        result.deterministic.passed &&
        result.trajectory.passed,
      transfer: suites.transfer.passed,
      closure: suites.closure.passed,
      "profile-evolution": suites.profile_evolution.passed,
      stopping: suites.stopping_integration.passed,
      "student-facing-communication":
        suites.student_facing_communication.passed,
      "evidence-preservation": suites.evidence_preservation.passed,
      "trajectory-envelope": result.trajectory.passed,
      personalization: suites.personalization.passed,
      budget:
        result.budget.maximum_logical_generation_calls === 29 &&
        result.budget.maximum_adapter_attempts === 87 &&
        result.budget.maximum_transport_retries_per_logical_call === 2 &&
        result.budget.maximum_input_tokens === 900_000 &&
        result.budget.maximum_output_tokens === 70_000 &&
        result.budget.maximum_total_tokens === 970_000 &&
        result.budget.maximum_cost_usd_when_pricing_metadata_exists ===
          25 &&
        result.budget.provider_concurrency === 1,
      "protected-components":
        result.protectedIntegrity.passed &&
        result.candidateIntegrity.passed,
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length ===
          E2A39_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a39_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a39_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity.composite_runtime_identity_hash,
      deterministic_case_count: result.deterministic.cases.length,
      deterministic_regression_count:
        result.summary.deterministic_regression_count,
      e2a39_execution_authorized: false,
      e2a39_live_execution_performed: false,
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
      E2A39_ARTIFACT_ROOT,
      makeE2A39FreezeRunId()
    );
    const result = execute(runDirectory);
    console.log(JSON.stringify({
      ...result.summary,
      artifact_directory: path.relative(process.cwd(), runDirectory)
    }, null, 2));
    return;
  }
  if (command === "report") {
    const runIndex = process.argv.indexOf("--run");
    const runDirectory = runIndex >= 0
      ? path.join(
          E2A39_ARTIFACT_ROOT,
          process.argv[runIndex + 1] ??
            "missing_e2a39_run_identifier"
        )
      : latestE2A39FreezeRunDirectory();
    console.log(JSON.stringify(
      inspectE2A39FreezeRun(runDirectory),
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
  throw new Error(`e2a39_unknown_command:${command}`);
}

main();
