import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  compileE2A17RequestsNoNetwork,
  executeE2A17NoLiveSmoke,
  inspectE2A17Preflight,
  removeTemporaryE2A17ArtifactRoot,
  temporaryE2A17ArtifactRoot,
  validateE2A17Artifacts
} from "@/lib/evaluation/formative/e2a17-bounded-student-simulator-canary";
import {
  E2A17_BUDGET,
  E2A17_REQUIRED_ARTIFACTS,
  validateE2A17Protocol
} from "@/lib/evaluation/formative/e2a17-protocol";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function protocolSuite() {
  const result = validateE2A17Protocol();
  assert(result.passed, "e2a17 protocol validation failed");
  assert(result.student_turn_count === 18,
    "e2a17 protocol must contain 18 bounded student turns");
  assert(result.operation_coverage.length === 7,
    "e2a17 protocol must cover all seven operations");
  assert(result.progression_coverage.length === 3,
    "e2a17 protocol must cover all three progression modes");
  return result;
}

async function budgetSuite() {
  const maximumLogicalCalls =
    E2A17_BUDGET.maximum_simulator_calls +
    E2A17_BUDGET.maximum_tutor_initial_generation_calls +
    E2A17_BUDGET.maximum_tutor_regeneration_calls;
  const maximumAdapterAttempts = maximumLogicalCalls *
    (1 + E2A17_BUDGET.maximum_transport_retries_per_generation_call);
  const maximumInput = E2A17_BUDGET.maximum_simulator_calls *
    E2A17_BUDGET.per_request_token_caps.simulator_input_tokens +
    (E2A17_BUDGET.maximum_tutor_initial_generation_calls +
      E2A17_BUDGET.maximum_tutor_regeneration_calls) *
    E2A17_BUDGET.per_request_token_caps.tutor_input_tokens;
  const maximumOutput = E2A17_BUDGET.maximum_simulator_calls *
    E2A17_BUDGET.per_request_token_caps.simulator_output_tokens +
    (E2A17_BUDGET.maximum_tutor_initial_generation_calls +
      E2A17_BUDGET.maximum_tutor_regeneration_calls) *
    E2A17_BUDGET.per_request_token_caps.tutor_output_tokens;
  assert(maximumLogicalCalls === 72,
    "e2a17 logical generation budget formula mismatch");
  assert(maximumAdapterAttempts === 216,
    "e2a17 adapter attempt budget formula mismatch");
  assert(maximumInput === E2A17_BUDGET.maximum_input_tokens,
    "e2a17 input token budget formula mismatch");
  assert(maximumOutput === E2A17_BUDGET.maximum_output_tokens,
    "e2a17 output token budget formula mismatch");
  assert(maximumInput + maximumOutput ===
    E2A17_BUDGET.maximum_total_tokens,
  "e2a17 total token budget formula mismatch");
  return { maximumLogicalCalls, maximumAdapterAttempts, maximumInput,
    maximumOutput };
}

async function requestSuite() {
  const result = compileE2A17RequestsNoNetwork();
  assert(result.passed, "e2a17 request compilation failed");
  assert(result.network_request_count === 0,
    "e2a17 request compilation made a network request");
  assert(result.request_pair_count === 18,
    "e2a17 request pair count mismatch");
  assert(result.rows.every((row) => row.information_flow.passed),
    "e2a17 information-flow request audit failed");
  return result;
}

async function fixtureAndArtifactSuite() {
  const root = temporaryE2A17ArtifactRoot();
  try {
    const result = await executeE2A17NoLiveSmoke({ artifactRoot: root });
    assert(result.summary.status ===
      "e2a17_canary_pass_pending_human_review",
    "e2a17 no-live canary did not pass");
    assert(result.summary.completed_session_count === 4,
      "e2a17 no-live session count mismatch");
    assert(result.summary.student_turn_count === 18 &&
      result.summary.visible_tutor_reply_count === 18,
    "e2a17 no-live turn/reply count mismatch");
    assert(result.summary.fixture_cleanup_passed === true,
      "e2a17 fixture cleanup did not pass");
    assert(result.summary.provider_usage.total_generation_calls === 36,
      "e2a17 no-live provider call accounting mismatch");
    assert(result.summary.provider_usage.estimated_cost_usd === null,
      "e2a17 no-live cost must not be fabricated");
    assert(result.artifactValidation.passed,
      "e2a17 artifact validation failed");
    assert(result.artifactValidation.actual_artifact_count ===
      E2A17_REQUIRED_ARTIFACTS.length,
    "e2a17 artifact count mismatch");
    assert(validateE2A17Artifacts(result.runDir).passed,
      "e2a17 artifact revalidation failed");
    const fixtures = JSON.parse(readFileSync(path.join(
      result.runDir, "session-fixtures.json"
    ), "utf8")) as {
      fixture_count: number;
      fixtures: Array<{
        fixture_id: string;
        session_public_id: string;
        cleanup_status: string;
      }>;
    };
    assert(fixtures.fixture_count === 4 && fixtures.fixtures.length === 4,
      "e2a17 fixture inventory count mismatch");
    assert(new Set(fixtures.fixtures.map((entry) => entry.fixture_id)).size === 4,
      "e2a17 fixtures were reused between sessions");
    assert(new Set(fixtures.fixtures.map((entry) => entry.session_public_id))
      .size === 4,
    "e2a17 session records were reused between sessions");
    assert(fixtures.fixtures.every((entry) =>
      entry.cleanup_status === "removed"
    ), "e2a17 fixture cleanup status mismatch");
    const informationFlowRows = readFileSync(path.join(
      result.runDir, "information-flow-audit.jsonl"
    ), "utf8").trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {
      passed: boolean;
    });
    assert(informationFlowRows.length === 18 &&
      informationFlowRows.every((entry) => entry.passed),
    "e2a17 per-turn information-flow audit mismatch");
    return {
      status: result.summary.status,
      session_count: result.summary.completed_session_count,
      student_turn_count: result.summary.student_turn_count,
      visible_tutor_reply_count: result.summary.visible_tutor_reply_count,
      artifact_count: result.artifactValidation.actual_artifact_count,
      fixture_cleanup_passed: result.summary.fixture_cleanup_passed
    };
  } finally {
    removeTemporaryE2A17ArtifactRoot(root);
    rmSync(root, { recursive: true, force: true });
  }
}

async function providerGuardSuite() {
  const prior = {
    RUN_LIVE_E2A17: process.env.RUN_LIVE_E2A17,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: process.env.LLM_LIVE_CALLS_ENABLED,
    OPERATIONAL_APPROVED_CONFIG_HASH:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH
  };
  delete process.env.RUN_LIVE_E2A17;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  delete process.env.OPERATIONAL_APPROVED_CONFIG_HASH;
  try {
    const result = await inspectE2A17Preflight({
      requireLiveEnvironment: true,
      requireCleanTrackedTree: false
    });
    assert(!result.passed, "e2a17 live preflight unexpectedly passed");
    assert(result.blockers.includes("live_e2a17_opt_in_missing"),
      "e2a17 provider guard did not require live opt-in");
    assert(result.blockers.includes("provider_not_openai"),
      "e2a17 provider guard did not require OpenAI");
    assert(result.blockers.includes("live_calls_not_enabled"),
      "e2a17 provider guard did not require live-call enablement");
    assert(result.network_request_count === 0,
      "e2a17 provider guard made a network request");
    return { blockers: result.blockers, network_request_count: 0 };
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main() {
  const suite = process.argv.includes("--suite")
    ? process.argv[process.argv.indexOf("--suite") + 1]
    : "all";
  const results: Record<string, unknown> = {};
  if (["all", "protocol"].includes(suite)) {
    results.protocol = await protocolSuite();
  }
  if (["all", "budget"].includes(suite)) {
    results.budget = await budgetSuite();
  }
  if (["all", "information-flow", "request-compilation"].includes(suite)) {
    results.request_compilation = await requestSuite();
  }
  if (["all", "fixture", "artifact"].includes(suite)) {
    results.fixture_and_artifact = await fixtureAndArtifactSuite();
  }
  if (["all", "provider-guard"].includes(suite)) {
    results.provider_guard = await providerGuardSuite();
  }
  if (Object.keys(results).length === 0) {
    throw new Error(`unknown e2a17 smoke suite: ${suite}`);
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
    "e2a17_smoke_failed");
  process.exitCode = 1;
});
