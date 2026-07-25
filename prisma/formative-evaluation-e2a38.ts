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
  E2A38_ARTIFACT_NAMES,
  E2A38_ARTIFACT_ROOT,
  inspectE2A38PreparationRun,
  latestE2A38PreparationRunDirectory,
  makeE2A38PreparationRunId,
  writeE2A38PreparationArtifacts
} from "../src/lib/evaluation/formative/e2a38-integrated-session-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a38_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const requestCountBefore = networkRequestCount;
  const result = writeE2A38PreparationArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - requestCountBefore
  });
  assert(
    networkRequestCount === requestCountBefore,
    "e2a38_provider_call_guard_detected_network_request"
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
    path.join(tmpdir(), "e2a38-integrated-session-")
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
      "integrated-workflow": suites.workflow_fidelity.passed,
      "profile-integration": suites.profile_integration.passed,
      "intervention-memory": suites.intervention_memory.passed,
      stopping: suites.stopping_quality.passed,
      "instructor-boundary": suites.human_boundary.passed,
      "student-facing-communication":
        suites.student_communication.passed,
      "trajectory-envelope": suites.trajectory_envelope.passed,
      "self-correction": suites.self_correction.passed,
      "evidence-preservation": suites.evidence_preservation.passed,
      personalization: suites.personalization.passed,
      "component-bindings":
        result.componentBindings.e2a37_protocol_hash ===
          result.protocol.upstream_e2a37.protocol_hash &&
        result.componentBindings.component_regressions_passed &&
        result.componentBindings.component_protected_sources_unchanged,
      budget:
        result.budget.maximum_logical_generation_calls === 29 &&
        result.budget.maximum_adapter_attempts === 87 &&
        result.budget.maximum_transport_retries_per_logical_call === 2 &&
        result.budget.maximum_input_tokens === 900_000 &&
        result.budget.maximum_output_tokens === 70_000 &&
        result.budget.maximum_total_tokens === 970_000 &&
        result.budget.maximum_cost_usd_when_pricing_metadata_available ===
          25 &&
        result.budget.provider_concurrency === 1,
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length ===
          E2A38_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a38_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a38_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity.composite_runtime_identity_hash,
      deterministic_case_count: result.deterministic.case_count,
      e2a38_execution_authorized: false,
      e2a38_live_execution_performed: false,
      candidate_approved: false,
      candidate_activated: false,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount
    }, null, 2));
  } finally {
    if (readdirSync(runDirectory).length > 0) {
      chmodSync(runDirectory, 0o755);
    }
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const runDirectory = path.join(
      E2A38_ARTIFACT_ROOT,
      makeE2A38PreparationRunId()
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
          E2A38_ARTIFACT_ROOT,
          process.argv[runIndex + 1] ??
            "missing_e2a38_run_identifier"
        )
      : latestE2A38PreparationRunDirectory();
    console.log(JSON.stringify(
      inspectE2A38PreparationRun(runDirectory),
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
  throw new Error(`e2a38_unknown_command:${command}`);
}

main();
