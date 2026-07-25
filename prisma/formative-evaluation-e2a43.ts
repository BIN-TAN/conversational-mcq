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
  E2A43_ARTIFACT_NAMES,
  E2A43_ARTIFACT_ROOT,
  inspectE2A43FreezeRun,
  latestE2A43FreezeRunDirectory,
  makeE2A43FreezeRunId,
  writeE2A43FreezeArtifacts
} from "../src/lib/evaluation/formative/e2a43-empirical-study-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a43_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const before = networkRequestCount;
  const result = writeE2A43FreezeArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - before
  });
  assert(
    networkRequestCount === before,
    "e2a43_provider_call_guard_detected_network_request"
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
    path.join(tmpdir(), "e2a43-empirical-study-")
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
      protocol: suites.protocol.passed,
      "research-questions": suites.research_questions.passed,
      "study-design": suites.study_design.passed,
      expert: suites.expert.passed,
      "classroom-pilot": suites.classroom_pilot.passed,
      comparison: suites.comparison.passed,
      measurement: suites.measurement.passed,
      "research-schema": suites.research_schema.passed,
      ethics: suites.ethics.passed,
      analysis: suites.analysis.passed,
      privacy: suites.privacy.passed,
      limitations: suites.limitations.passed,
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
          E2A43_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a43_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a43_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity.composite_runtime_identity_hash,
      research_question_count:
        result.summary.research_question_count,
      study_phase_count: result.summary.study_phase_count,
      research_variable_count:
        result.summary.research_variable_count,
      required_regression_count:
        result.summary.required_regression_count,
      deterministic_check_count:
        result.summary.deterministic_check_count,
      reb_approval_assumed: false,
      empirical_study_execution_authorized: false,
      empirical_data_collection_authorized: false,
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
      E2A43_ARTIFACT_ROOT,
      makeE2A43FreezeRunId()
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
          E2A43_ARTIFACT_ROOT,
          process.argv[runIndex + 1] ??
            "missing_e2a43_run_identifier"
        )
      : latestE2A43FreezeRunDirectory();
    console.log(JSON.stringify(
      inspectE2A43FreezeRun(runDirectory),
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
  throw new Error(`e2a43_unknown_command:${command}`);
}

main();
