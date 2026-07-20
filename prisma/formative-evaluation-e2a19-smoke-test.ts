import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  compileE2A19RequestsNoNetwork,
  executeE2A19NoLiveAbortSmoke,
  executeE2A19NoLiveSmoke,
  inspectE2A19Preflight,
  loadE2A19Run,
  removeTemporaryE2A19ArtifactRoot,
  temporaryE2A19ArtifactRoot,
  validateE2A19Artifacts
} from "@/lib/evaluation/formative/e2a19-single-session-micro-canary";
import {
  E2A19_AUTHORIZED_ARTIFACTS,
  E2A19_BUDGET,
  validateE2A19FrozenProtocol
} from "@/lib/evaluation/formative/e2a19-protocol";
import {
  buildE2A18CalibrationCorpus,
  buildE2A18MutationResults,
  evaluateE2A18CalibrationCorpus
} from "@/lib/evaluation/formative/e2a18-simulator-contract-adjudication";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function protocolSuite() {
  const result = validateE2A19FrozenProtocol();
  assert(result.passed, "e2a19 protocol validation failed");
  assert(result.protocol.session_count === 1,
    "e2a19 must contain exactly one session");
  assert(result.protocol.session.turns.length <= 6,
    "e2a19 frozen session exceeds six turns");
  assert(result.protocol.maximum_visible_dialogue_turns === 12,
    "e2a19 visible dialogue limit mismatch");
  assert(E2A19_AUTHORIZED_ARTIFACTS.length === 26,
    "e2a19 artifact contract count mismatch");
  return result;
}

function budgetSuite() {
  const logical = E2A19_BUDGET.maximum_simulator_calls +
    E2A19_BUDGET.maximum_tutor_initial_generation_calls +
    E2A19_BUDGET.maximum_tutor_regeneration_calls;
  const adapter = logical *
    (1 + E2A19_BUDGET.maximum_transport_retries_per_generation_call);
  assert(logical === 14, "e2a19 logical generation budget mismatch");
  assert(adapter === 42, "e2a19 adapter attempt budget mismatch");
  assert(E2A19_BUDGET.maximum_input_tokens === 400_000,
    "e2a19 input token budget mismatch");
  assert(E2A19_BUDGET.maximum_output_tokens === 31_000,
    "e2a19 output token budget mismatch");
  assert(E2A19_BUDGET.maximum_total_tokens === 431_000,
    "e2a19 total token budget mismatch");
  assert(E2A19_BUDGET.maximum_estimated_cost_usd_when_pricing_available === 10,
    "e2a19 cost ceiling mismatch");
  return { logical, adapter, budget: E2A19_BUDGET };
}

function requestCompilationSuite() {
  const result = compileE2A19RequestsNoNetwork();
  assert(result.passed, "e2a19 request compilation failed");
  assert(result.network_request_count === 0,
    "e2a19 request compilation made a network request");
  assert(result.request_pair_count === 4,
    "e2a19 frozen request pair count mismatch");
  assert(result.rows.every((row) => row.information_flow.passed),
    "e2a19 information flow compilation failed");
  return result;
}

function evidenceSpanSuite() {
  const corpus = buildE2A18CalibrationCorpus();
  const calibration = evaluateE2A18CalibrationCorpus(corpus);
  const mutations = buildE2A18MutationResults();
  assert(calibration.every((entry) => entry.passed),
    "e2a18 calibration regressed before e2a19");
  assert(mutations.every((entry) => entry.passed),
    "e2a18 mutation suite regressed before e2a19");
  assert(calibration.filter((entry) => !entry.actual_accept).every((entry) =>
    entry.exact_evidence_spans.length > 0
  ), "e2a19 above-ceiling calibration rejection lacks an exact span");
  return {
    calibration_count: calibration.length,
    calibration_pass_count: calibration.filter((entry) => entry.passed).length,
    mutation_count: mutations.length,
    mutation_pass_count: mutations.filter((entry) => entry.passed).length
  };
}

function inspectRunSuites(runDir: string) {
  const information = readJsonl<{
    passed?: boolean;
    tutor?: {
      simulator_hidden_truth_findings?: unknown[];
      future_simulator_turn_present?: boolean;
    } | null;
  }>(path.join(runDir, "information-flow-audit.jsonl"));
  const classifications = readJsonl<{
    evidence_adjudication?: {
      above_ceiling?: boolean;
      exact_evidence_spans?: unknown[];
    };
  }>(path.join(runDir, "simulator-evidence-classifications.jsonl"));
  const progression = readJsonl<{
    passed?: boolean;
    state_after?: string;
    transition_authorized_by_platform?: boolean;
  }>(path.join(runDir, "progression-results.jsonl"));
  const persistence = readJsonl<{ passed?: boolean }>(
    path.join(runDir, "persistence-results.jsonl")
  );
  const transcript = readJsonl<{ passed?: boolean }>(
    path.join(runDir, "transcript-refresh-results.jsonl")
  );
  const cleanup = JSON.parse(readFileSync(path.join(
    runDir, "fixture-cleanup-result.json"
  ), "utf8")) as { passed?: boolean };
  const usage = JSON.parse(readFileSync(path.join(
    runDir, "provider-usage.json"
  ), "utf8")) as {
    within_budget?: boolean;
    actual?: {
      simulator_provider_calls?: number;
      initial_tutor_provider_calls?: number;
      tutor_regeneration_provider_calls?: number;
      total_logical_generation_calls?: number;
      provider_adapter_attempts?: number;
    };
  };
  assert(information.length > 0 && information.every((row) => row.passed),
    "e2a19 information-flow artifact failed");
  assert(information.every((row) => !row.tutor ||
    (row.tutor.simulator_hidden_truth_findings?.length ?? 0) === 0 &&
    row.tutor.future_simulator_turn_present === false),
  "e2a19 simulator/tutor isolation failed");
  assert(classifications.every((row) => !row.evidence_adjudication?.above_ceiling ||
    (row.evidence_adjudication.exact_evidence_spans?.length ?? 0) > 0),
  "e2a19 above-ceiling artifact lacks exact evidence span");
  assert(progression.length > 0 && progression.every((row) =>
    row.passed && row.transition_authorized_by_platform
  ), "e2a19 progression artifact failed");
  assert(progression.at(-1)?.state_after === "revision_authorized",
    "e2a19 progression endpoint mismatch");
  assert(persistence.length > 0 && persistence.every((row) => row.passed),
    "e2a19 persistence artifact failed");
  assert(transcript.length > 0 && transcript.every((row) => row.passed),
    "e2a19 transcript artifact failed");
  assert(cleanup.passed, "e2a19 fixture cleanup artifact failed");
  assert(usage.within_budget, "e2a19 usage artifact exceeds budget");
  assert((usage.actual?.simulator_provider_calls ?? 0) <= 6 &&
    (usage.actual?.initial_tutor_provider_calls ?? 0) <= 6 &&
    (usage.actual?.tutor_regeneration_provider_calls ?? 0) <= 2 &&
    (usage.actual?.total_logical_generation_calls ?? 0) <= 14 &&
    (usage.actual?.provider_adapter_attempts ?? 0) <= 42,
  "e2a19 usage counters exceed frozen limits");
  return {
    information_flow_rows: information.length,
    evidence_classification_rows: classifications.length,
    progression_rows: progression.length,
    persistence_rows: persistence.length,
    transcript_rows: transcript.length,
    fixture_cleanup_passed: cleanup.passed,
    usage_within_budget: usage.within_budget
  };
}

async function fixtureAndArtifactSuite() {
  const root = temporaryE2A19ArtifactRoot();
  const abortRoot = temporaryE2A19ArtifactRoot();
  try {
    const result = await executeE2A19NoLiveSmoke({ artifactRoot: root });
    assert(result.summary.status ===
      "e2a19_micro_canary_pass_pending_human_review",
    "e2a19 no-live micro-canary did not pass");
    assert(result.summary.persisted_student_turns === 4 &&
      result.summary.effective_tutor_replies === 4,
    "e2a19 no-live turn/reply count mismatch");
    assert(result.summary.simulator_calls === 4 &&
      result.summary.initial_tutor_calls === 4,
    "e2a19 no-live provider accounting mismatch");
    assert(result.summary.fixture_cleanup_passed,
      "e2a19 no-live fixture cleanup failed");
    assert(result.artifactValidation.passed,
      "e2a19 no-live artifact validation failed");
    assert(result.artifactValidation.actual_artifact_count === 26,
      "e2a19 no-live artifact count mismatch");
    assert(validateE2A19Artifacts(result.runDir).passed,
      "e2a19 no-live artifact revalidation failed");
    const inspection = inspectRunSuites(result.runDir);
    const aborted = await executeE2A19NoLiveAbortSmoke({
      artifactRoot: abortRoot
    });
    assert(aborted.summary.status === "e2a19_micro_canary_incomplete",
      "e2a19 no-live abort status mismatch");
    assert(aborted.summary.early_abort,
      "e2a19 no-live abort was not recorded");
    assert(aborted.artifactValidation.passed,
      "e2a19 abort-aware artifact validation failed");
    const expectedEmpty = aborted.artifactValidation.artifact_classifications
      .filter((entry) =>
        entry.classification === "expected_empty_due_to_early_abort"
      );
    assert(expectedEmpty.length > 0,
      "e2a19 abort-aware validation found no expected empty artifacts");
    return {
      status: result.summary.status,
      run_directory: result.runDir,
      artifact_count: result.artifactValidation.actual_artifact_count,
      abort_aware_expected_empty_count: expectedEmpty.length,
      ...inspection
    };
  } finally {
    removeTemporaryE2A19ArtifactRoot(root);
    rmSync(root, { recursive: true, force: true });
    removeTemporaryE2A19ArtifactRoot(abortRoot);
    rmSync(abortRoot, { recursive: true, force: true });
  }
}

async function providerGuardSuite() {
  const prior = {
    RUN_LIVE_E2A19: process.env.RUN_LIVE_E2A19,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: process.env.LLM_LIVE_CALLS_ENABLED,
    OPERATIONAL_APPROVED_CONFIG_HASH:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH
  };
  delete process.env.RUN_LIVE_E2A19;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  delete process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
  try {
    const result = await inspectE2A19Preflight({
      requireLiveEnvironment: true,
      requireCleanTrackedTree: false
    });
    assert(!result.passed, "e2a19 live preflight unexpectedly passed");
    assert(result.blockers.includes("live_e2a19_opt_in_missing"),
      "e2a19 guard did not require live opt-in");
    assert(result.blockers.includes("provider_not_openai"),
      "e2a19 guard did not require OpenAI");
    assert(result.blockers.includes("live_calls_not_enabled"),
      "e2a19 guard did not require live-call enablement");
    assert(!result.blockers.includes("approved_config_hash_mismatch"),
      "e2a19 guard rejected an absent optional config hash assertion");
    assert(result.network_request_count === 0,
      "e2a19 provider guard made a network request");
    process.env.OPERATIONAL_APPROVED_CONFIG_HASH = "0".repeat(64);
    const mismatch = await inspectE2A19Preflight({
      requireLiveEnvironment: true,
      requireCleanTrackedTree: false
    });
    assert(mismatch.blockers.includes("approved_config_hash_mismatch"),
      "e2a19 guard accepted an explicit mismatched config hash assertion");
    assert(mismatch.network_request_count === 0,
      "e2a19 mismatched config hash guard made a network request");
    return {
      blockers: result.blockers,
      explicit_hash_mismatch_blocked: true,
      network_request_count: 0
    };
  } finally {
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
  if (["all", "evidence-span"].includes(suite)) {
    results.evidence_span = evidenceSpanSuite();
  }
  if (["all", "fixture", "artifact", "usage", "progression", "persistence",
    "transcript"].includes(suite)) {
    if (runId) {
      const loaded = loadE2A19Run(runId);
      assert(loaded.artifactValidation.passed,
        "e2a19 persisted artifact validation failed");
      results.persisted_run = {
        run_id: runId,
        artifact_validation: loaded.artifactValidation,
        runtime_inspection: inspectRunSuites(loaded.runDir)
      };
    } else {
      results.fixture_and_artifact = await fixtureAndArtifactSuite();
    }
  }
  if (["all", "provider-guard"].includes(suite)) {
    results.provider_guard = await providerGuardSuite();
  }
  if (Object.keys(results).length === 0) {
    throw new Error(`unknown e2a19 smoke suite: ${suite}`);
  }
  console.log(JSON.stringify({
    status: "passed",
    suite,
    provider_requests_made: 0,
    results
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a19_smoke_failed");
  process.exitCode = 1;
});
