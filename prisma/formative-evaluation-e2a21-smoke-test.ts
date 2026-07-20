import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  compileE2A21RequestsNoNetwork,
  executeE2A21NoLiveAbortSmoke,
  executeE2A21NoLiveBoundedStopSmoke,
  executeE2A21NoLiveSmoke,
  inspectE2A21Preflight,
  loadE2A21Run,
  removeTemporaryE2A21ArtifactRoot,
  temporaryE2A21ArtifactRoot,
  validateE2A21Artifacts
} from "@/lib/evaluation/formative/e2a21-evidence-driven-micro-canary";
import {
  E2A21_AUTHORIZED_ARTIFACTS,
  E2A21_BUDGET,
  E2A21_PROTOCOL_HASH,
  validateE2A21FrozenProtocol
} from "@/lib/evaluation/formative/e2a21-protocol";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a17-protocol";
import {
  E2A20_ORCHESTRATION_VERSION,
  runE2A20DeterministicTransitionTests
} from "@/lib/evaluation/formative/e2a20-evidence-driven-transition-adjudication";
import {
  E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
} from "@/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3";
import {
  buildE2A20ACalibrationCorpus,
  buildE2A20AHistoricalRegressions,
  evaluateE2A20ACalibrationCorpus
} from "@/lib/evaluation/formative/e2a20a-turn4-classification-adjudication";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function protocolSuite() {
  const result = validateE2A21FrozenProtocol();
  assert(result.passed, "e2a21 protocol validation failed");
  assert(E2A21_PROTOCOL_HASH ===
    "ad396a3a0f2aaf06941288019067262c32e44a306467f191e734a0e0e66da7c6",
  "e2a21 protocol hash changed");
  assert(result.protocol.evidence_classifier_version ===
    E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  "e2a21 classifier version mismatch");
  assert(result.protocol.orchestration_version === E2A20_ORCHESTRATION_VERSION,
    "e2a21 orchestration version mismatch");
  assert(E2A21_AUTHORIZED_ARTIFACTS.length === 28,
    "e2a21 artifact count mismatch");
  return result;
}

function budgetSuite() {
  const logical = E2A21_BUDGET.maximum_simulator_calls +
    E2A21_BUDGET.maximum_tutor_initial_generation_calls +
    E2A21_BUDGET.maximum_tutor_regeneration_calls;
  const adapter = logical *
    (1 + E2A21_BUDGET.maximum_transport_retries_per_generation_call);
  assert(logical === 14 && adapter === 42,
    "e2a21 call budget mismatch");
  assert(E2A21_BUDGET.maximum_input_tokens === 400_000 &&
    E2A21_BUDGET.maximum_output_tokens === 31_000 &&
    E2A21_BUDGET.maximum_total_tokens === 431_000,
  "e2a21 token budget mismatch");
  assert(E2A21_BUDGET.maximum_estimated_cost_usd_when_pricing_available === 10,
    "e2a21 cost budget mismatch");
  assert(E2A21_BUDGET.provider_concurrency === 1,
    "e2a21 concurrency mismatch");
  return { logical, adapter, budget: E2A21_BUDGET };
}

function requestCompilationSuite() {
  const result = compileE2A21RequestsNoNetwork();
  assert(result.passed, "e2a21 request compilation failed");
  assert(result.request_pair_count === 6 && result.network_request_count === 0,
    "e2a21 request compilation count mismatch");
  assert(result.rows.every((row) => row.information_flow.passed),
    "e2a21 compiled information flow failed");
  return result;
}

function classifierAndTransitionSuite() {
  const calibration = evaluateE2A20ACalibrationCorpus(
    buildE2A20ACalibrationCorpus()
  );
  const historical = buildE2A20AHistoricalRegressions();
  const transitions = runE2A20DeterministicTransitionTests();
  assert(calibration.length === 36 && calibration.every((row) => row.passed),
    "e2a21 classifier V3 calibration failed");
  assert(historical.length === 57 && historical.every((row) => row.passed),
    "e2a21 classifier historical regression failed");
  assert(transitions.passed,
    "e2a21 evidence-driven transition regression failed");
  return {
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    calibration_count: calibration.length,
    historical_regression_count: historical.length,
    transition_case_count: transitions.case_count
  };
}

function inspectSafeRun(runDir: string, expectedOutcome: string) {
  const objective = readJsonl<{ fulfillment?: string }>(path.join(
    runDir, "objective-fulfillment-results.jsonl"
  ));
  const hidden = readJsonl<{
    observed_evidence_controls_transition?: boolean;
    desired_transition_forced_state?: boolean;
    passed?: boolean;
  }>(path.join(runDir, "hidden-state-transition-results.jsonl"));
  const persistence = readJsonl<{ passed?: boolean }>(path.join(
    runDir, "persistence-results.jsonl"
  ));
  const studentProjection = readJsonl<{
    hidden_simulator_state_included?: boolean;
    internal_review_metadata_visible?: boolean;
    passed?: boolean;
  }>(path.join(runDir, "student-projection-results.jsonl"));
  const transcript = readJsonl<{ passed?: boolean }>(path.join(
    runDir, "transcript-refresh-results.jsonl"
  ));
  const information = readJsonl<{ passed?: boolean }>(path.join(
    runDir, "information-flow-audit.jsonl"
  ));
  const review = readJson<{
    human_review_completed?: boolean;
    rows?: Array<{
      exact_evidence_spans?: unknown[];
      human_review?: Record<string, unknown>;
    }>;
  }>(path.join(runDir, "human-review-packet.json"));
  const summary = readJson<{
    session_outcome?: string;
    persisted_student_turns?: number;
    effective_tutor_replies?: number;
    privacy_finding_count?: number;
    answer_key_finding_count?: number;
    hidden_state_finding_count?: number;
    provider_control_finding_count?: number;
    deterministic_fallback_count?: number;
    soft_only_regeneration_count?: number;
    fixture_cleanup_passed?: boolean;
    candidate_approved?: boolean;
    candidate_activated?: boolean;
  }>(path.join(runDir, "canary-summary.json"));
  assert(summary.session_outcome === expectedOutcome,
    "e2a21 session outcome mismatch");
  assert(summary.persisted_student_turns === summary.effective_tutor_replies,
    "e2a21 student/tutor response parity failed");
  assert(objective.length === summary.persisted_student_turns,
    "e2a21 objective audit count mismatch");
  assert(hidden.length === summary.persisted_student_turns && hidden.every(
    (row) => row.passed && row.observed_evidence_controls_transition &&
      !row.desired_transition_forced_state
  ), "e2a21 hidden-state audit failed");
  assert(persistence.every((row) => row.passed) &&
    transcript.every((row) => row.passed) &&
    information.every((row) => row.passed),
  "e2a21 persistence, transcript, or information-flow audit failed");
  assert(studentProjection.every((row) => row.passed &&
    !row.hidden_simulator_state_included &&
    !row.internal_review_metadata_visible),
  "e2a21 student projection exposed audit state");
  assert((summary.privacy_finding_count ?? 0) === 0 &&
    (summary.answer_key_finding_count ?? 0) === 0 &&
    (summary.hidden_state_finding_count ?? 0) === 0 &&
    (summary.provider_control_finding_count ?? 0) === 0,
  "e2a21 safety finding present");
  assert((summary.deterministic_fallback_count ?? 0) === 0 &&
    (summary.soft_only_regeneration_count ?? 0) === 0,
  "e2a21 forbidden fallback or regeneration present");
  assert(summary.fixture_cleanup_passed && !summary.candidate_approved &&
    !summary.candidate_activated,
  "e2a21 cleanup or candidate state failed");
  assert(review.human_review_completed === false &&
    (review.rows?.length ?? 0) >= (summary.persisted_student_turns ?? 0) &&
    review.rows?.every((row) => row.human_review && Object.values(
      row.human_review
    ).every((value) => value === null)),
  "e2a21 human review packet is incomplete or pre-adjudicated");
  return {
    objective_rows: objective.length,
    hidden_state_rows: hidden.length,
    persistence_rows: persistence.length,
    transcript_rows: transcript.length,
    information_flow_rows: information.length,
    human_review_rows: review.rows?.length ?? 0
  };
}

async function fixtureArtifactSuite() {
  const passRoot = temporaryE2A21ArtifactRoot();
  const boundedRoot = temporaryE2A21ArtifactRoot();
  const abortRoot = temporaryE2A21ArtifactRoot();
  try {
    const passed = await executeE2A21NoLiveSmoke({ artifactRoot: passRoot });
    assert(passed.summary.status ===
      "e2a21_micro_canary_pass_required_endpoint_pending_human_review",
    "e2a21 no-live required endpoint did not pass");
    assert(passed.summary.persisted_student_turns === 4 &&
      passed.summary.effective_tutor_replies === 4,
    "e2a21 required endpoint turn count mismatch");
    assert(passed.artifactValidation.passed &&
      validateE2A21Artifacts(passed.runDir).passed,
    "e2a21 required endpoint artifact validation failed");
    const passInspection = inspectSafeRun(
      passed.runDir, "passed_required_endpoint"
    );

    const bounded = await executeE2A21NoLiveBoundedStopSmoke({
      artifactRoot: boundedRoot
    });
    assert(bounded.summary.status ===
      "e2a21_micro_canary_complete_bounded_stop_pending_adjudication",
    "e2a21 no-live bounded stop did not complete");
    assert(bounded.summary.persisted_student_turns === 6 &&
      bounded.summary.effective_tutor_replies === 6 &&
      bounded.summary.session_endpoint === "bounded_stop",
    "e2a21 bounded stop turn/reply count mismatch");
    assert(bounded.artifactValidation.passed,
      "e2a21 bounded stop artifact validation failed");
    const boundedInspection = inspectSafeRun(
      bounded.runDir, "completed_valid_bounded_stop"
    );

    const aborted = await executeE2A21NoLiveAbortSmoke({
      artifactRoot: abortRoot
    });
    assert(aborted.summary.status ===
      "e2a21_micro_canary_incomplete_infrastructure" &&
      aborted.summary.early_abort && aborted.artifactValidation.passed,
    "e2a21 no-live early-abort contract failed");
    return {
      required_endpoint: passInspection,
      bounded_stop: boundedInspection,
      abort_status: aborted.summary.status,
      artifact_count: passed.artifactValidation.actual_artifact_count
    };
  } finally {
    removeTemporaryE2A21ArtifactRoot(passRoot);
    removeTemporaryE2A21ArtifactRoot(boundedRoot);
    removeTemporaryE2A21ArtifactRoot(abortRoot);
  }
}

async function providerGuardSuite() {
  const prior = {
    RUN_LIVE_E2A21: process.env.RUN_LIVE_E2A21,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: process.env.LLM_LIVE_CALLS_ENABLED,
    OPERATIONAL_APPROVED_CONFIG_HASH:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH
  };
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a21_network_request_prohibited");
  }) as typeof fetch;
  delete process.env.RUN_LIVE_E2A21;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  delete process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
  try {
    const result = await inspectE2A21Preflight({
      requireLiveEnvironment: true,
      requireCleanTrackedTree: false
    });
    assert(!result.passed &&
      result.blockers.includes("live_e2a21_opt_in_missing") &&
      result.blockers.includes("provider_not_openai") &&
      result.blockers.includes("live_calls_not_enabled"),
    "e2a21 explicit live guard failed");
    assert(networkRequestCount === 0 && result.network_request_count === 0,
      "e2a21 provider guard made a network request");
    process.env.OPERATIONAL_APPROVED_CONFIG_HASH = "0".repeat(64);
    const mismatch = await inspectE2A21Preflight({
      requireLiveEnvironment: true,
      requireCleanTrackedTree: false
    });
    assert(mismatch.blockers.includes("approved_config_hash_mismatch"),
      "e2a21 approved baseline mismatch was not blocked");
    return { blockers: result.blockers, network_request_count: 0 };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main() {
  const suite = argument("--suite") ?? "all";
  const runId = argument("--run");
  const results: Record<string, unknown> = {};
  if (["all", "protocol"].includes(suite)) results.protocol = protocolSuite();
  if (["all", "budget"].includes(suite)) results.budget = budgetSuite();
  if (["all", "request-compilation", "information-flow", "hidden-state"]
    .includes(suite)) results.request_compilation = requestCompilationSuite();
  if (["all", "classifier", "transition", "objective"].includes(suite)) {
    results.classifier_and_transition = classifierAndTransitionSuite();
  }
  if (["all", "fixture", "artifact", "usage", "progression", "persistence",
    "projection", "transcript", "privacy"].includes(suite)) {
    if (runId) {
      const loaded = loadE2A21Run(runId);
      assert(loaded.artifactValidation.passed,
        "e2a21 persisted artifact validation failed");
      results.persisted_run = {
        run_id: runId,
        artifact_validation: loaded.artifactValidation,
        runtime_inspection: inspectSafeRun(
          loaded.runDir, String(loaded.summary.session_outcome)
        )
      };
    } else {
      results.fixture_and_artifact = await fixtureArtifactSuite();
    }
  }
  if (["all", "provider-guard", "authorization-guard"].includes(suite)) {
    results.provider_guard = await providerGuardSuite();
  }
  if (Object.keys(results).length === 0) {
    throw new Error(`unknown e2a21 smoke suite:${suite}`);
  }
  console.log(JSON.stringify({
    status: "passed",
    suite,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    candidate_hash: E2A17_CANDIDATE_HASH,
    candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    candidate_approved: false,
    candidate_activated: false,
    provider_requests_made: 0,
    results
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a21_smoke_failed");
  process.exitCode = 1;
});
