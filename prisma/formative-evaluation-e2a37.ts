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
  E2A37_ARTIFACT_NAMES,
  E2A37_ARTIFACT_ROOT,
  inspectE2A37PreparationRun,
  latestE2A37PreparationRunDirectory,
  makeE2A37PreparationRunId,
  writeE2A37PreparationArtifacts
} from "../src/lib/evaluation/formative/e2a37-instructor-handoff-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a37_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const requestCountBefore = networkRequestCount;
  const result = writeE2A37PreparationArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - requestCountBefore
  });
  assert(
    networkRequestCount === requestCountBefore,
    "e2a37_provider_call_guard_detected_network_request"
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
    path.join(tmpdir(), "e2a37-instructor-handoff-")
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
      "profile-evolution": suites.profile_evolution.passed,
      "stopping-policy": suites.stopping_policy.passed,
      "instructor-escalation": suites.instructor_escalation.passed,
      "student-facing-communication":
        suites.student_facing_communication.passed,
      "intervention-memory": suites.intervention_memory.passed,
      "trajectory-envelope": suites.trajectory_envelope.passed,
      "self-correction": suites.self_correction.passed,
      personalization: suites.personalization.passed,
      "evaluator-v5-request":
        result.protocol.evaluator_v5.request_compiled &&
        result.compiledEvaluatorRequest.schema_version ===
          result.protocol.evaluator_v5.input_schema_version,
      "target-contract":
        result.targetContract.contract_version ===
          result.protocol.contract_versions.target_evidence &&
        result.canonicalAnchor.required_anchor_stance ===
          "rejects_distractor",
      metrics:
        result.metrics.metrics.length === 8 &&
        result.metricsResults.metrics.every((entry) => entry.passed),
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length ===
          E2A37_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a37_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a37_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity
          .composite_runtime_identity_hash,
      deterministic_case_count:
        result.deterministic.total_case_count,
      e2a37_execution_authorized: false,
      e2a37_live_execution_performed: false,
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
      E2A37_ARTIFACT_ROOT,
      makeE2A37PreparationRunId()
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
          E2A37_ARTIFACT_ROOT,
          process.argv[runIndex + 1] ??
            "missing_e2a37_run_identifier"
        )
      : latestE2A37PreparationRunDirectory();
    console.log(JSON.stringify(
      inspectE2A37PreparationRun(runDirectory),
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
  throw new Error(`e2a37_unknown_command:${command}`);
}

main();
