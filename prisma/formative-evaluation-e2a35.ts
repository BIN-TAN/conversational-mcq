import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  E2A35_ARTIFACT_NAMES,
  E2A35_ARTIFACT_ROOT,
  inspectE2A35PreparationRun,
  latestE2A35PreparationRunDirectory,
  makeE2A35PreparationRunId,
  writeE2A35PreparationArtifacts
} from "../src/lib/evaluation/formative/e2a35-self-correction-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a35_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const requestCountBefore = networkRequestCount;
  const result = writeE2A35PreparationArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - requestCountBefore
  });
  assert(
    networkRequestCount === requestCountBefore,
    "e2a35_provider_call_guard_detected_network_request"
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
    path.join(tmpdir(), "e2a35-self-correction-")
  );
  try {
    const result = execute(runDirectory);
    const checks: Record<string, boolean> = {
      all:
        result.summary.passed &&
        result.artifactValidation.passed &&
        result.artifactValidation.complete_artifact_set,
      calibration: result.calibration.passed,
      "self-correction": result.selfCorrectionRegressions.passed,
      "profile-update": result.profileRegressions.passed,
      "regression-reopening": result.reopeningRegressions.passed,
      "trajectory-envelope": result.trajectoryRegressions.passed,
      "target-contract":
        result.targetContract.contract_version ===
          result.protocol.contract_versions.target_evidence &&
        result.canonicalAnchor.required_anchor_stance ===
          "rejects_distractor",
      "evaluator-v5-request":
        result.protocol.deterministic_gate_results
          .evaluator_v5_request_compiled,
      artifact:
        result.artifactValidation.passed &&
        result.artifactValidation.complete_artifact_set &&
        readdirSync(runDirectory).length ===
          E2A35_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a35_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a35_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity
          .composite_runtime_identity_hash,
      calibration_case_count: result.calibration.case_count,
      deterministic_self_correction_case_count:
        result.selfCorrectionRegressions.case_count,
      e2a35_execution_authorized: false,
      e2a35_live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount
    }, null, 2));
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const runDirectory = path.join(
      E2A35_ARTIFACT_ROOT,
      makeE2A35PreparationRunId()
    );
    const result = execute(runDirectory);
    console.log(JSON.stringify({
      ...result.summary,
      artifact_directory: path.relative(process.cwd(), runDirectory)
    }, null, 2));
    return;
  }
  if (command === "report") {
    console.log(JSON.stringify(
      inspectE2A35PreparationRun(
        latestE2A35PreparationRunDirectory()
      ),
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
  throw new Error(`e2a35_unknown_command:${command}`);
}

main();
