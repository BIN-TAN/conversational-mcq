import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  e2a10ProtectedArtifactSnapshot,
  executeE2A10Canary,
  inspectE2A10Preflight,
  isSuccessfulE1Summary,
  resolveE2A10Budget,
  temporaryE2A10ArtifactRoot,
  validateE2A10ProviderOutput
} from "@/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary";
import { e2a10CanaryCases } from
  "@/lib/evaluation/formative/e2a10-v7-topic-dialogue-protocol";
import { E2A9_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a9-topic-dialogue-operation-candidate";
import { e2a9HeldOutOperationCases } from
  "@/lib/evaluation/formative/e2a9-topic-dialogue-operation-protocol";

const originalFetch = globalThis.fetch;
let externalNetworkCalls = 0;
globalThis.fetch = async () => {
  externalNetworkCalls += 1;
  throw new Error("e2a10_smoke_network_forbidden");
};

function validOutput(caseId: string) {
  const testCase = e2a10CanaryCases().find((entry) =>
    entry.case_id === caseId
  );
  if (!testCase) throw new Error(`e2a10_smoke_case_missing:${caseId}`);
  if (testCase.selected_operation) {
    const source = e2a9HeldOutOperationCases().find((entry) =>
      entry.operation === testCase.selected_operation
    );
    if (!source) throw new Error("e2a10_smoke_operation_source_missing");
    const schemaVersionByOperation = {
      elicit_anchor_evidence:
        "topic-dialogue-elicit-anchor-evidence-output-v1",
      clarify_concept_with_new_strategy:
        "topic-dialogue-clarify-concept-new-strategy-output-v1",
      clarify_task: "topic-dialogue-clarify-task-output-v1",
      protected_redirect: "topic-dialogue-protected-redirect-output-v1",
      repair_recurrence: "topic-dialogue-repair-recurrence-output-v1",
      redirect_off_topic: "topic-dialogue-redirect-off-topic-output-v1",
      refine_partial_reasoning:
        "topic-dialogue-refine-partial-reasoning-output-v1"
    } as const;
    return {
      schema_version: schemaVersionByOperation[testCase.selected_operation],
      student_facing_message: source.expected_valid_message
    };
  }
  const common = {
    evidence_update:
      "The bounded reliability-validity distinction was accepted by the platform.",
    remaining_issue: null,
    student_safe_summary:
      "Keep consistency evidence separate from interpretation evidence.",
    expected_response_guidance: null,
    safety_flags: [] as string[]
  };
  if (testCase.selected_mode === "request_revision") return {
    schema_version: "topic-dialogue-revision-output-v1",
    response_function: "revision_transition",
    tutor_message:
      "Revise your explanation so it clearly separates reliability evidence about consistency from validity evidence about the intended interpretation.",
    ...common,
    remaining_issue:
      "The revised response should state the evidence boundary precisely.",
    expected_response_guidance: "Provide the revised explanation.",
    requires_student_response: true
  };
  if (testCase.selected_mode === "present_transfer") return {
    schema_version: "topic-dialogue-transfer-output-v1",
    response_function: "transfer_transition",
    tutor_message:
      "Now apply the same distinction in a new context rather than revising the original response. The platform will present the transfer item.",
    ...common,
    requires_student_response: false
  };
  return {
    schema_version: "topic-dialogue-completion-output-v1",
    response_function: "completion_transition",
    tutor_message:
      "You supplied the bounded evidence accepted by the platform. This dialogue is complete.",
    ...common,
    student_safe_summary: "This bounded dialogue is complete.",
    requires_student_response: false
  };
}

class InjectedProvider implements LlmProvider {
  private attempts = new Map<string, number>();

  constructor(
    private readonly invalidInitialCaseCount: number,
    private readonly alwaysInvalid = false
  ) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const caseId = request.metadata?.case_id ?? "unknown";
    const caseNumber = e2a10CanaryCases().find((entry) =>
      entry.case_id === caseId
    )?.case_number ?? 99;
    const attempt = (this.attempts.get(caseId) ?? 0) + 1;
    this.attempts.set(caseId, attempt);
    const shouldBeInvalid = this.alwaysInvalid ||
      (caseNumber <= this.invalidInitialCaseCount && attempt === 1);
    const base = validOutput(caseId);
    const output = shouldBeInvalid
      ? { ...base, schema_version: "invalid-e2a10-schema-version" }
      : base;
    return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `req_${caseId}_${attempt}`,
      provider_response_id: `resp_${caseId}_${attempt}`,
      status: "completed",
      parsed_output: output as TOutput,
      raw_output: output,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        reasoning_tokens: 10,
        total_tokens: 150
      },
      latency_ms: 2
    };
  }
}

function artifactRows(filePath: string) {
  return readFileSync(filePath, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function main() {
  assert.equal(isSuccessfulE1Summary({
    run_count: 12,
    scenario_pass_rate: 1,
    critical_invariant_failure_rate: 0,
    provider_call_count: 0
  }), true);
  assert.equal(isSuccessfulE1Summary({
    run_count: 12,
    scenario_pass_rate: 11 / 12,
    critical_invariant_failure_rate: 0,
    provider_call_count: 0
  }), false);
  const passRoot = temporaryE2A10ArtifactRoot();
  const stabilityRoot = temporaryE2A10ArtifactRoot();
  const failRoot = temporaryE2A10ArtifactRoot();
  try {
    const protectedBefore = e2a10ProtectedArtifactSnapshot();
    const preflight = await inspectE2A10Preflight();
    assert.equal(preflight.passed, true, JSON.stringify(preflight.blockers));
    assert.equal(preflight.candidate_hash, E2A9_CANDIDATE_HASH);
    assert.equal(preflight.v7_candidate_approved, false);
    assert.equal(preflight.v7_candidate_activated, false);
    assert.equal(preflight.active_runtime_references_v7, false);
    assert.equal(preflight.role_count, 17);
    assert.equal(preflight.operation_schema_count, 7);
    assert.equal(preflight.retained_progression_schema_count, 3);
    assert.equal(preflight.all_operation_schemas_compile, true);
    assert.equal(preflight.all_retained_progression_schemas_compile, true);
    assert.equal(preflight.all_17_roles_compile, true);
    assert.equal(preflight.request_count, 26);
    assert.equal(preflight.request_compilation_network_count, 0);

    const liveBlocked = await inspectE2A10Preflight({
      requireLiveEnvironment: true
    });
    assert.equal(liveBlocked.passed, false);
    assert(liveBlocked.blockers.includes("live_e2a10_opt_in_missing"));

    const cases = e2a10CanaryCases();
    assert.equal(cases.length, 10);
    assert.deepEqual(cases.map((entry) => entry.selected_mode), [
      "remain_in_dialogue",
      "remain_in_dialogue",
      "remain_in_dialogue",
      "remain_in_dialogue",
      "remain_in_dialogue",
      "remain_in_dialogue",
      "remain_in_dialogue",
      "request_revision",
      "present_transfer",
      "complete_episode"
    ]);
    assert.equal(cases.filter((entry) =>
      entry.require_tenth_turn_context
    ).length, 2);
    assert.equal(cases[1]?.dialogue_input.visible_dialogue_history.length, 18);
    assert.equal(cases[4]?.dialogue_input.visible_dialogue_history.length, 18);

    for (const testCase of cases) {
      const validation = validateE2A10ProviderOutput({
        testCase,
        value: validOutput(testCase.case_id)
      });
      assert.equal(validation.valid, true, JSON.stringify(validation.findings));
    }
    const providerControl = validateE2A10ProviderOutput({
      testCase: cases[0]!,
      value: { ...validOutput(cases[0]!.case_id), dialogue_operation: "x" }
    });
    assert.equal(providerControl.valid, false);

    const budget = resolveE2A10Budget({});
    assert.equal(budget.maximum_cases, 10);
    assert.equal(budget.maximum_initial_generation_calls, 10);
    assert.equal(budget.maximum_regeneration_calls, 10);
    assert.equal(budget.maximum_total_generation_calls, 20);
    assert.equal(budget.maximum_input_tokens, 280_000);
    assert.equal(budget.maximum_output_tokens, 45_000);
    assert.equal(budget.maximum_estimated_cost_usd, 12);
    assert.equal(budget.provider_case_concurrency, 1);
    assert.throws(() => resolveE2A10Budget({ EVAL_E2A10_MAX_CASES: "11" }),
      /invalid_budget/u);

    const passRun = await executeE2A10Canary({
      live: false,
      provider: new InjectedProvider(1),
      artifactRoot: passRoot,
      runId: "e2a10_no_live_pass"
    });
    assert.equal(
      passRun.summary.final_status,
      "v7_canary_passed_pending_human_review"
    );
    assert.equal(passRun.summary.initial_cases_dispatched, 10);
    assert.equal(passRun.summary.automated_case_pass_count, 10);
    assert.equal(passRun.summary.first_attempt_valid_count, 9);
    assert.equal(passRun.summary.regeneration_count, 1);
    assert.equal(passRun.summary.regeneration_success_count, 1);
    assert.equal(passRun.summary.fallback_count, 0);
    assert.equal(passRun.summary.context_coverage_pass_count, 2);
    assert.equal(passRun.summary.provider_usage.generation_provider_calls, 11);
    assert.equal(passRun.summary.human_review_status, "pending");
    assert.equal(passRun.summary.candidate_approved, false);
    assert.equal(passRun.summary.candidate_activated, false);
    assert.equal(passRun.review.provider_output_count, 11);

    const expectedArtifacts = [
      "canary-manifest.json",
      "candidate-delta.json",
      "dialogue-operation-contract.json",
      "all-role-request-compilation.json",
      "canary-protocol.json",
      "provider-cases.jsonl",
      "provider-outputs.jsonl",
      "candidate-validation.jsonl",
      "platform-safety.jsonl",
      "context-coverage.jsonl",
      "privacy-results.jsonl",
      "deterministic-rubric.jsonl",
      "provider-usage.json",
      "human-review-packet.json",
      "canary-summary.json"
    ];
    assert(expectedArtifacts.every((name) =>
      existsSync(path.join(passRun.runDir, name))
    ));
    assert.equal(artifactRows(path.join(
      passRun.runDir,
      "provider-cases.jsonl"
    )).length, 10);
    assert.equal(artifactRows(path.join(
      passRun.runDir,
      "provider-outputs.jsonl"
    )).length, 11);
    assert.equal(artifactRows(path.join(
      passRun.runDir,
      "platform-safety.jsonl"
    )).every((entry) => entry.executed_transition === false), true);
    const artifactText = expectedArtifacts.map((name) =>
      readFileSync(path.join(passRun.runDir, name), "utf8")
    ).join("\n");
    assert.doesNotMatch(artifactText, /sk-[A-Za-z0-9_-]{12,}/u);
    assert.doesNotMatch(artifactText, /Bearer\s+/u);
    assert.doesNotMatch(artifactText, /chain[ _-]?of[ _-]?thought/iu);
    assert.doesNotMatch(artifactText, /OPENAI_API_KEY/u);

    const stabilityRun = await executeE2A10Canary({
      live: false,
      provider: new InjectedProvider(3),
      artifactRoot: stabilityRoot,
      runId: "e2a10_no_live_stability"
    });
    assert.equal(
      stabilityRun.summary.final_status,
      "v7_canary_failed_stability_threshold"
    );
    assert.equal(stabilityRun.summary.automated_case_pass_count, 10);
    assert.equal(stabilityRun.summary.regeneration_count, 3);
    assert.equal(stabilityRun.summary.fallback_count, 0);

    const failRun = await executeE2A10Canary({
      live: false,
      provider: new InjectedProvider(0, true),
      artifactRoot: failRoot,
      runId: "e2a10_no_live_fail"
    });
    assert.equal(failRun.summary.final_status, "v7_canary_failed");
    assert.equal(failRun.summary.initial_cases_dispatched, 10);
    assert.equal(failRun.summary.regeneration_count, 10);
    assert.equal(failRun.summary.fallback_count, 10);
    assert(failRun.results.every((entry) =>
      entry.platform_safety.platform_gate_result ===
        "authorized_mode_and_operation_preserved" &&
      entry.platform_safety.executed_transition === false &&
      entry.deterministic_fallback_used
    ));

    const protectedAfter = e2a10ProtectedArtifactSnapshot();
    assert.equal(
      protectedAfter.aggregate_sha256,
      protectedBefore.aggregate_sha256
    );
    assert.equal(externalNetworkCalls, 0);
    console.log(JSON.stringify({
      status: "passed",
      case_count: cases.length,
      operation_case_count: 7,
      progression_case_count: 3,
      pass_run_provider_output_count: passRun.review.provider_output_count,
      stability_threshold_regeneration_count:
        stabilityRun.summary.regeneration_count,
      fallback_run_fallback_count: failRun.summary.fallback_count,
      protected_artifacts_unchanged: true,
      external_network_calls: externalNetworkCalls,
      provider_case_concurrency: 1
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(passRoot, { recursive: true, force: true });
    rmSync(stabilityRoot, { recursive: true, force: true });
    rmSync(failRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
