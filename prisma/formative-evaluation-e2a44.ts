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
  E2A44_ARTIFACT_NAMES,
  E2A44_ARTIFACT_ROOT,
  inspectE2A44FreezeRun,
  latestE2A44FreezeRunDirectory,
  makeE2A44FreezeRunId,
  writeE2A44FreezeArtifacts
} from "../src/lib/evaluation/formative/e2a44-classroom-pilot-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a44_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const before = networkRequestCount;
  const result = writeE2A44FreezeArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - before
  });
  assert(
    networkRequestCount === before,
    "e2a44_provider_call_guard_detected_network_request"
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
    path.join(tmpdir(), "e2a44-classroom-pilot-")
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
      architecture: suites.architecture.passed,
      "research-boundary": suites.research_boundary.passed,
      "teacher-visibility": suites.teacher_visibility.passed,
      "student-visibility": suites.student_visibility.passed,
      "consent-withdrawal": suites.consent_withdrawal.passed,
      anonymization: suites.anonymization.passed,
      "export-reproducibility":
        suites.export_reproducibility.passed,
      "evidence-history": suites.evidence_history.passed,
      "multi-student-isolation":
        suites.multi_student_isolation.passed,
      privacy: suites.privacy.passed,
      replay: suites.replay.passed,
      regressions: result.deterministic.regressions.passed,
      historical: result.historicalIntegrity.passed,
      budget:
        result.budget.protocol_freeze_provider_call_budget === 0 &&
        result.budget.protocol_freeze_network_request_budget === 0 &&
        !result.budget.execution_authorized &&
        !result.budget.live_entrypoint_present,
      "protected-components":
        result.protectedIntegrity.passed &&
        result.candidateIntegrity.passed,
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length ===
          E2A44_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a44_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a44_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity.composite_runtime_identity_hash,
      architecture_layer_count:
        result.summary.architecture_layer_count,
      architecture_entity_count:
        result.summary.architecture_entity_count,
      workflow_state_count: result.summary.workflow_state_count,
      required_regression_count:
        result.summary.required_regression_count,
      deterministic_check_count:
        result.summary.deterministic_check_count,
      classroom_deployment_authorized: false,
      research_collection_authorized: false,
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
      E2A44_ARTIFACT_ROOT,
      makeE2A44FreezeRunId()
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
          E2A44_ARTIFACT_ROOT,
          process.argv[runIndex + 1] ??
            "missing_e2a44_run_identifier"
        )
      : latestE2A44FreezeRunDirectory();
    console.log(JSON.stringify(
      inspectE2A44FreezeRun(runDirectory),
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
  throw new Error(`e2a44_unknown_command:${command}`);
}

main();
