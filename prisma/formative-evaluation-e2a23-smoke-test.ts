import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  compileE2A23RequestsNoNetwork,
  executeE2A23NoLiveAbortSmoke,
  executeE2A23NoLiveBoundedStopSmoke,
  executeE2A23NoLiveSmoke,
  inspectE2A23Preflight,
  loadE2A23Run,
  removeTemporaryE2A23ArtifactRoot,
  temporaryE2A23ArtifactRoot,
  validateE2A23Artifacts
} from "@/lib/evaluation/formative/e2a23-evidence-first-micro-canary";
import {
  E2A23_AUTHORIZED_ARTIFACTS,
  E2A23_BUDGET,
  E2A23_PROTOCOL_HASH,
  validateE2A23Protocol
} from "@/lib/evaluation/formative/e2a23-protocol";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a17-protocol";
import {
  runE2A20DeterministicTransitionTests
} from "@/lib/evaluation/formative/e2a20-evidence-driven-transition-adjudication";
import { EVIDENCE_FIRST_PROFILE_ROUTING_VERSION } from
  "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
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
  const result = validateE2A23Protocol();
  assert(result.passed, "e2a23 protocol validation failed");
  assert(E2A23_PROTOCOL_HASH.length === 64,
    "e2a23 protocol hash is invalid");
  assert(result.protocol.evidence_classifier_version ===
    E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  "e2a23 classifier version mismatch");
  assert(result.protocol.orchestration_version ===
    EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    "e2a23 orchestration version mismatch");
  assert(E2A23_AUTHORIZED_ARTIFACTS.length === 33,
    "e2a23 artifact count mismatch");
  return result;
}

function budgetSuite() {
  const logical = E2A23_BUDGET.maximum_simulator_calls +
    E2A23_BUDGET.maximum_tutor_initial_generation_calls +
    E2A23_BUDGET.maximum_tutor_regeneration_calls;
  const adapter = logical *
    (1 + E2A23_BUDGET.maximum_transport_retries_per_generation_call);
  assert(logical === 14 && adapter === 42,
    "e2a23 call budget mismatch");
  assert(E2A23_BUDGET.maximum_input_tokens === 400_000 &&
    E2A23_BUDGET.maximum_output_tokens === 31_000 &&
    E2A23_BUDGET.maximum_total_tokens === 431_000,
  "e2a23 token budget mismatch");
  assert(E2A23_BUDGET.maximum_estimated_cost_usd_when_pricing_available === 10,
    "e2a23 cost budget mismatch");
  assert(E2A23_BUDGET.provider_concurrency === 1,
    "e2a23 concurrency mismatch");
  return { logical, adapter, budget: E2A23_BUDGET };
}

function requestCompilationSuite() {
  const result = compileE2A23RequestsNoNetwork();
  assert(result.passed, "e2a23 request compilation failed");
  assert(result.request_pair_count === 6 && result.network_request_count === 0,
    "e2a23 request compilation count mismatch");
  assert(result.rows.every((row) => row.information_flow.passed),
    "e2a23 compiled information flow failed");
  return result;
}

function classifierAndTransitionSuite() {
  const calibration = evaluateE2A20ACalibrationCorpus(
    buildE2A20ACalibrationCorpus()
  );
  const historical = buildE2A20AHistoricalRegressions();
  const transitions = runE2A20DeterministicTransitionTests();
  assert(calibration.length === 36 && calibration.every((row) => row.passed),
    "e2a23 classifier V3 calibration failed");
  assert(historical.length === 57 && historical.every((row) => row.passed),
    "e2a23 classifier historical regression failed");
  assert(transitions.passed,
    "e2a23 evidence-first transition regression failed");
  return {
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    calibration_count: calibration.length,
    historical_regression_count: historical.length,
    transition_case_count: transitions.case_count
  };
}

function inspectSafeRun(runDir: string, expectedOutcome: string) {
  const profiles = readJsonl<{
    profile?: {
      profile_snapshot_id?: string;
      source_student_turn_id?: string;
      source_sequence_index?: number;
      reasoning_quality?: string;
      revision_readiness?: boolean;
    };
  }>(path.join(runDir, "turn-profile-snapshots.jsonl"));
  const cumulative = readJsonl<{
    cumulative_profile?: {
      latest_turn_profile_snapshot_id?: string;
      latest_evidence_precedence?: boolean;
    };
  }>(path.join(runDir, "cumulative-profile-updates.jsonl"));
  const routes = readJsonl<{
    platform_route?: {
      source_profile_snapshot_id?: string;
      selected_mode?: string;
    };
    route_selected_after_profile_creation?: boolean;
    provider_selected_route?: boolean;
  }>(path.join(runDir, "routing-decisions.jsonl"));
  const freshness = readJsonl<{ passed?: boolean }>(path.join(
    runDir, "profile-freshness-results.jsonl"
  ));
  const requests = readJsonl<{
    profile_snapshot_id?: string;
    source_student_turn_id?: string;
    source_sequence_index?: number;
    stale_profile_request_dispatched?: boolean;
  }>(path.join(runDir, "tutor-request-provenance.jsonl"));
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
  const causal = readJson<{ passed?: boolean; rows?: Array<{
    passed?: boolean;
  }> }>(path.join(runDir, "causal-timeline.json"));
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
    stale_profile_finding_count?: number;
    revision_requested_immediately_after_sound?: boolean;
    unnecessary_refinement_after_sound_count?: number;
    no_minimum_turn_invariant_passed?: boolean;
  }>(path.join(runDir, "canary-summary.json"));
  assert(summary.session_outcome === expectedOutcome,
    "e2a23 session outcome mismatch");
  assert(summary.persisted_student_turns === summary.effective_tutor_replies,
    "e2a23 student/tutor response parity failed");
  assert(profiles.length === summary.persisted_student_turns &&
    cumulative.length === profiles.length && routes.length === profiles.length &&
    freshness.length === profiles.length && requests.length === profiles.length,
  "e2a23 profile-first artifact count mismatch");
  assert(profiles.every((row, index) =>
    Boolean(row.profile?.profile_snapshot_id) &&
    cumulative[index]?.cumulative_profile?.latest_turn_profile_snapshot_id ===
      row.profile?.profile_snapshot_id &&
    routes[index]?.platform_route?.source_profile_snapshot_id ===
      row.profile?.profile_snapshot_id &&
    requests[index]?.profile_snapshot_id === row.profile?.profile_snapshot_id &&
    routes[index]?.route_selected_after_profile_creation === true &&
    routes[index]?.provider_selected_route === false &&
    freshness[index]?.passed === true &&
    requests[index]?.stale_profile_request_dispatched === false
  ), "e2a23 profile, route, freshness, or request identity mismatch");
  assert(persistence.every((row) => row.passed) &&
    transcript.every((row) => row.passed) &&
    information.every((row) => row.passed),
  "e2a23 persistence, transcript, or information-flow audit failed");
  assert(studentProjection.every((row) => row.passed &&
    !row.hidden_simulator_state_included &&
    !row.internal_review_metadata_visible),
  "e2a23 student projection exposed audit state");
  assert((summary.privacy_finding_count ?? 0) === 0 &&
    (summary.answer_key_finding_count ?? 0) === 0 &&
    (summary.hidden_state_finding_count ?? 0) === 0 &&
    (summary.provider_control_finding_count ?? 0) === 0,
  "e2a23 safety finding present");
  assert((summary.deterministic_fallback_count ?? 0) === 0 &&
    (summary.soft_only_regeneration_count ?? 0) === 0,
  "e2a23 forbidden fallback or regeneration present");
  assert(summary.fixture_cleanup_passed && !summary.candidate_approved &&
    !summary.candidate_activated,
  "e2a23 cleanup or candidate state failed");
  assert((summary.stale_profile_finding_count ?? 0) === 0 &&
    causal.passed === true && causal.rows?.every((row) => row.passed),
  "e2a23 stale profile or causal-order finding present");
  if (expectedOutcome === "passed_required_endpoint") {
    assert(summary.revision_requested_immediately_after_sound === true &&
      (summary.unnecessary_refinement_after_sound_count ?? 0) === 0 &&
      summary.no_minimum_turn_invariant_passed === true,
    "e2a23 sound response did not immediately authorize revision");
  }
  assert(review.human_review_completed === false &&
    (review.rows?.length ?? 0) >= (summary.persisted_student_turns ?? 0) &&
    review.rows?.every((row) => row.human_review && Object.values(
      row.human_review
    ).every((value) => value === null)),
  "e2a23 human review packet is incomplete or pre-adjudicated");
  return {
    profile_rows: profiles.length,
    cumulative_rows: cumulative.length,
    route_rows: routes.length,
    freshness_rows: freshness.length,
    request_provenance_rows: requests.length,
    persistence_rows: persistence.length,
    transcript_rows: transcript.length,
    information_flow_rows: information.length,
    human_review_rows: review.rows?.length ?? 0
  };
}

async function fixtureArtifactSuite() {
  const passRoot = temporaryE2A23ArtifactRoot();
  const boundedRoot = temporaryE2A23ArtifactRoot();
  const abortRoot = temporaryE2A23ArtifactRoot();
  try {
    const passed = await executeE2A23NoLiveSmoke({ artifactRoot: passRoot });
    assert(passed.summary.status ===
      "e2a23_micro_canary_pass_profile_first_revision",
    "e2a23 no-live required endpoint did not pass");
    assert(passed.summary.persisted_student_turns === 4 &&
      passed.summary.effective_tutor_replies === 4,
    "e2a23 required endpoint turn count mismatch");
    assert(passed.artifactValidation.passed &&
      validateE2A23Artifacts(passed.runDir).passed,
    "e2a23 required endpoint artifact validation failed");
    const passInspection = inspectSafeRun(
      passed.runDir, "passed_required_endpoint"
    );

    const bounded = await executeE2A23NoLiveBoundedStopSmoke({
      artifactRoot: boundedRoot
    });
    assert(bounded.summary.status ===
      "e2a23_micro_canary_complete_bounded_stop_pending_adjudication",
    "e2a23 no-live bounded stop did not complete");
    assert(bounded.summary.persisted_student_turns === 6 &&
      bounded.summary.effective_tutor_replies === 6 &&
      bounded.summary.session_endpoint === "bounded_stop",
    "e2a23 bounded stop turn/reply count mismatch");
    assert(bounded.artifactValidation.passed,
      "e2a23 bounded stop artifact validation failed");
    const boundedInspection = inspectSafeRun(
      bounded.runDir, "completed_valid_bounded_stop"
    );

    const aborted = await executeE2A23NoLiveAbortSmoke({
      artifactRoot: abortRoot
    });
    assert(aborted.summary.status ===
      "e2a23_micro_canary_incomplete_infrastructure" &&
      aborted.summary.early_abort && aborted.artifactValidation.passed,
    "e2a23 no-live early-abort contract failed");
    return {
      required_endpoint: passInspection,
      bounded_stop: boundedInspection,
      abort_status: aborted.summary.status,
      artifact_count: passed.artifactValidation.actual_artifact_count
    };
  } finally {
    removeTemporaryE2A23ArtifactRoot(passRoot);
    removeTemporaryE2A23ArtifactRoot(boundedRoot);
    removeTemporaryE2A23ArtifactRoot(abortRoot);
  }
}

async function providerGuardSuite() {
  const liveCliSource = readFileSync(path.join(
    process.cwd(), "prisma/formative-evaluation-e2a23-live.ts"
  ), "utf8");
  const requiredConfirmationFlags = [
    "--confirm-e2a23-single-session-authorization",
    "--confirm-paid-provider-evaluation",
    "--confirm-single-isolated-session",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-candidate-remains-unapproved",
    "--confirm-no-e2a17-rerun",
    "--confirm-no-e2a19-rerun",
    "--confirm-no-e2a21-rerun",
    "--confirm-no-four-session-canary",
    "--confirm-no-36-session-matrix",
    "--confirm-no-e2b",
    "--confirm-stop-after-micro-canary"
  ];
  assert(requiredConfirmationFlags.every((flag) =>
    liveCliSource.includes(`"${flag}"`)
  ), "e2a23 live CLI confirmation contract is incomplete");
  const prior = {
    RUN_LIVE_E2A23: process.env.RUN_LIVE_E2A23,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: process.env.LLM_LIVE_CALLS_ENABLED,
    OPERATIONAL_APPROVED_CONFIG_HASH:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH
  };
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a23_network_request_prohibited");
  }) as typeof fetch;
  delete process.env.RUN_LIVE_E2A23;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  delete process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
  try {
    const result = await inspectE2A23Preflight({
      requireLiveEnvironment: true,
      requireCleanTrackedTree: false
    });
    assert(!result.passed &&
      result.blockers.includes("live_e2a23_opt_in_missing") &&
      result.blockers.includes("provider_not_openai") &&
      result.blockers.includes("live_calls_not_enabled"),
    "e2a23 explicit live guard failed");
    assert(networkRequestCount === 0 && result.network_request_count === 0,
      "e2a23 provider guard made a network request");
    process.env.OPERATIONAL_APPROVED_CONFIG_HASH = "0".repeat(64);
    const mismatch = await inspectE2A23Preflight({
      requireLiveEnvironment: true,
      requireCleanTrackedTree: false
    });
    assert(mismatch.blockers.includes("approved_config_hash_mismatch"),
      "e2a23 approved baseline mismatch was not blocked");
    return {
      blockers: result.blockers,
      required_confirmation_flags: requiredConfirmationFlags,
      network_request_count: 0
    };
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
  if (["all", "fixture", "fixture-lifecycle", "artifact", "artifact-contract",
    "usage", "progression", "progression-separation", "persistence",
    "projection", "transcript", "privacy", "information-flow",
    "profile-first-routing", "stale-profile-guard",
    "latest-evidence-precedence", "no-minimum-turn", "idempotency"]
    .includes(suite)) {
    if (runId) {
      const loaded = loadE2A23Run(runId);
      assert(loaded.artifactValidation.passed,
        "e2a23 persisted artifact validation failed");
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
  if (["all", "composite-identity"].includes(suite)) {
    const preflight = await inspectE2A23Preflight({
      requireLiveEnvironment: false,
      requireCleanTrackedTree: false
    });
    assert(preflight.candidate_integrity !== null &&
      preflight.candidate_integrity.source_logic.aggregate_sha256.length === 64 &&
      preflight.candidate_integrity.protected_evidence_snapshot_hash.length === 64 &&
      Object.values(preflight.candidate_integrity.checks).every(Boolean),
    "e2a23 composite runtime identity preflight failed");
    results.composite_identity = {
      source_logic_aggregate_sha256:
        preflight.candidate_integrity.source_logic.aggregate_sha256,
      protected_evidence_snapshot_hash:
        preflight.candidate_integrity.protected_evidence_snapshot_hash,
      network_request_count: preflight.network_request_count
    };
  }
  if (Object.keys(results).length === 0) {
    throw new Error(`unknown e2a23 smoke suite:${suite}`);
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
    "e2a23_smoke_failed");
  process.exitCode = 1;
});
