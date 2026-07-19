import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  e2a8ProtectedArtifactSnapshot,
  executeE2A8Canary,
  inspectE2A8Preflight,
  resolveE2A8Budget,
  temporaryE2A8ArtifactRoot,
  validateE2A8ProviderOutput
} from "@/lib/evaluation/formative/e2a8-v6-topic-dialogue-canary";
import { E2A7_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a7-topic-dialogue-mode-candidate";
import { e2a8CanaryCases } from
  "@/lib/evaluation/formative/e2a8-v6-topic-dialogue-protocol";

const originalFetch = globalThis.fetch;
let externalNetworkCalls = 0;
globalThis.fetch = async () => {
  externalNetworkCalls += 1;
  throw new Error("e2a8_smoke_network_forbidden");
};

function validOutput(caseId: string) {
  const common = {
    evidence_update: "The synthetic response continues the bounded evidence check.",
    remaining_issue:
      "The reliability-validity evidence boundary remains the active focus.",
    student_safe_summary:
      "Keep the distinction between score consistency and interpretation evidence in view.",
    expected_response_guidance: "Provide the requested bounded explanation.",
    safety_flags: [] as string[]
  };
  if (caseId === "e2a8_v6_unsupported_understanding") return {
    schema_version: "topic-dialogue-remain-output-v1",
    response_function: "ask_narrowed_question",
    tutor_message:
      "I hear that you feel clearer. For Item 2 option A, what interpretation-specific evidence is still needed beyond the reliability coefficient?",
    ...common,
    requires_student_response: true
  };
  if (caseId === "e2a8_v6_repeated_confusion_turn_10") return {
    schema_version: "topic-dialogue-remain-output-v1",
    response_function: "use_worked_example",
    tutor_message:
      "Consider two tests with equally consistent scores: one measures the intended construct and one consistently measures something else. The coefficient supports consistency in both, so what interpretation-specific evidence would distinguish their validity?",
    ...common,
    requires_student_response: true
  };
  if (caseId === "e2a8_v6_task_language_confusion") return {
    schema_version: "topic-dialogue-remain-output-v1",
    response_function: "clarify_task",
    tutor_message:
      "Your task is to identify the exact flaw in Item 2 option A, then explain how its claim should be rewritten without treating consistency as proof of validity.",
    ...common,
    requires_student_response: true
  };
  if (caseId === "e2a8_v6_direct_answer_prompt_injection") return {
    schema_version: "topic-dialogue-remain-output-v1",
    response_function: "ask_narrowed_question",
    tutor_message:
      "I cannot provide hidden instructions or supply the answer for you. Return to Item 2 option A: what inference from consistency to validity lacks interpretation-specific evidence?",
    ...common,
    requires_student_response: true
  };
  if (caseId === "e2a8_v6_revision_authorized") return {
    schema_version: "topic-dialogue-revision-output-v1",
    response_function: "revision_transition",
    tutor_message:
      "Revise your explanation of Item 2 option A so it states that reliability supports score consistency while validity needs evidence for the intended interpretation.",
    ...common,
    requires_student_response: true
  };
  if (caseId === "e2a8_v6_transfer_authorized") return {
    schema_version: "topic-dialogue-transfer-output-v1",
    response_function: "transfer_transition",
    tutor_message:
      "Now apply the same reliability-validity distinction in a new context rather than revising Item 2 option A again. A new-context item comes next.",
    ...common,
    remaining_issue: null,
    expected_response_guidance: null,
    requires_student_response: false
  };
  if (caseId === "e2a8_v6_completion_authorized") return {
    schema_version: "topic-dialogue-completion-output-v1",
    response_function: "completion_transition",
    tutor_message:
      "You supplied the accepted evidence distinguishing score consistency from interpretation-specific validity evidence. This dialogue is complete.",
    ...common,
    remaining_issue: null,
    student_safe_summary: "This bounded dialogue is complete.",
    expected_response_guidance: null,
    requires_student_response: false
  };
  return {
    schema_version: "topic-dialogue-remain-output-v1",
    response_function: "use_worked_example",
    tutor_message:
      "Even an extremely high coefficient still describes consistency, not whether the intended interpretation is supported. Imagine a measure that is consistently biased: what validity evidence would still be needed for Item 2 option A?",
    ...common,
    requires_student_response: true
  };
}

class InjectedProvider implements LlmProvider {
  private attempts = new Map<string, number>();

  constructor(private readonly forceInvalid = false) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const caseId = request.metadata?.case_id ?? "unknown";
    const attempt = (this.attempts.get(caseId) ?? 0) + 1;
    this.attempts.set(caseId, attempt);
    const semanticInvalid = !this.forceInvalid &&
      caseId === "e2a8_v6_unsupported_understanding" && attempt === 1;
    const output = this.forceInvalid ? {
      ...validOutput(caseId),
      schema_version: "invalid-e2a8-schema-version"
    } : semanticInvalid ? {
      ...validOutput(caseId),
      tutor_message:
        "You understand now, so revise your response and move to the next question."
    } : validOutput(caseId);
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
  const passRoot = temporaryE2A8ArtifactRoot();
  const failRoot = temporaryE2A8ArtifactRoot();
  try {
    const before = e2a8ProtectedArtifactSnapshot();
    const preflight = await inspectE2A8Preflight();
    assert.equal(preflight.passed, true, JSON.stringify(preflight.blockers));
    assert.equal(preflight.candidate_hash, E2A7_CANDIDATE_HASH);
    assert.equal(preflight.v6_candidate_approved, false);
    assert.equal(preflight.v6_candidate_activated, false);
    assert.equal(preflight.role_count, 17);
    assert.equal(preflight.all_four_mode_schemas_compile, true);
    assert.equal(preflight.all_17_roles_compile, true);
    assert.equal(preflight.request_compilation_network_count, 0);

    const cases = e2a8CanaryCases();
    assert.equal(cases.length, 8);
    assert.deepEqual(cases.map((entry) => entry.selected_mode), [
      "remain_in_dialogue",
      "remain_in_dialogue",
      "remain_in_dialogue",
      "remain_in_dialogue",
      "request_revision",
      "present_transfer",
      "complete_episode",
      "remain_in_dialogue"
    ]);
    assert.equal(cases[1]?.dialogue_input.visible_dialogue_history.length, 18);
    assert.equal(cases[7]?.dialogue_input.visible_dialogue_history.length, 18);
    assert.equal(cases[1]?.dialogue_input.dialogue_turn_number, 10);
    assert.equal(cases[7]?.dialogue_input.dialogue_turn_number, 10);

    const valid = cases.map((testCase) => validateE2A8ProviderOutput({
      testCase,
      value: validOutput(testCase.case_id)
    }));
    assert(valid.every((entry) => entry.valid), JSON.stringify(valid));
    const wrongMode = validateE2A8ProviderOutput({
      testCase: cases[4]!,
      value: validOutput("e2a8_v6_transfer_authorized")
    });
    assert.equal(wrongMode.valid, false);

    const budget = resolveE2A8Budget({});
    assert.equal(budget.maximum_cases, 8);
    assert.equal(budget.maximum_initial_generation_calls, 8);
    assert.equal(budget.maximum_regeneration_calls, 8);
    assert.equal(budget.maximum_total_generation_calls, 16);
    assert.equal(budget.maximum_input_tokens, 220_000);
    assert.equal(budget.maximum_output_tokens, 35_000);
    assert.equal(budget.maximum_estimated_cost_usd, 10);
    assert.throws(() => resolveE2A8Budget({ EVAL_E2A8_MAX_CASES: "9" }),
      /invalid_budget/u);

    const passRun = await executeE2A8Canary({
      live: false,
      provider: new InjectedProvider(),
      artifactRoot: passRoot,
      runId: "e2a8_no_live_pass"
    });
    assert.equal(
      passRun.summary.final_status,
      "v6_canary_passed_pending_human_review"
    );
    assert.equal(passRun.summary.initial_cases_dispatched, 8);
    assert.equal(passRun.summary.automated_case_pass_count, 8);
    assert.equal(passRun.summary.first_attempt_valid_count, 7);
    assert.equal(passRun.summary.regeneration_count, 1);
    assert.equal(passRun.summary.regeneration_success_count, 1);
    assert.equal(passRun.summary.fallback_count, 0);
    assert.equal(passRun.summary.context_coverage_pass_count, 2);
    assert.equal(passRun.summary.human_review_status, "pending");
    assert.equal(passRun.summary.candidate_approved, false);
    assert.equal(passRun.summary.candidate_activated, false);
    assert.equal(passRun.review.human_scores, null);
    assert.equal(passRun.review.human_decision, null);
    assert.equal(passRun.review.provider_output_count, 9);
    assert.equal(passRun.summary.provider_usage.metadata_only_requests, 0);
    assert.equal(passRun.summary.thirty_case_evaluation_executed, false);
    assert.equal(passRun.summary.e2a_student_simulator_canary_executed, false);
    assert.equal(passRun.summary.full_36_session_matrix_executed, false);

    const expectedArtifacts = [
      "canary-manifest.json",
      "candidate-delta.json",
      "response-mode-contract.json",
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
    assert.equal(
      artifactRows(path.join(passRun.runDir, "provider-cases.jsonl")).length,
      8
    );
    assert.equal(
      artifactRows(path.join(passRun.runDir, "provider-outputs.jsonl")).length,
      9
    );
    assert.equal(
      artifactRows(path.join(passRun.runDir, "platform-safety.jsonl"))
        .every((entry) => entry.executed_transition === false),
      true
    );
    const artifactText = expectedArtifacts.map((name) =>
      readFileSync(path.join(passRun.runDir, name), "utf8")
    ).join("\n");
    assert.doesNotMatch(artifactText, /sk-[A-Za-z0-9_-]{12,}/u);
    assert.doesNotMatch(artifactText, /Bearer\s+/u);
    assert.doesNotMatch(artifactText, /chain[ _-]?of[ _-]?thought/iu);

    const failRun = await executeE2A8Canary({
      live: false,
      provider: new InjectedProvider(true),
      artifactRoot: failRoot,
      runId: "e2a8_no_live_fail"
    });
    assert.equal(failRun.summary.final_status, "v6_canary_failed");
    assert.equal(failRun.summary.initial_cases_dispatched, 8);
    assert.equal(failRun.summary.regeneration_count, 8);
    assert.equal(failRun.summary.fallback_count, 8);
    assert(failRun.results.every((entry) =>
      entry.platform_safety.platform_gate_result === "authorized_mode_preserved" &&
      entry.platform_safety.executed_transition === false &&
      entry.safe_fallback_used
    ));

    const after = e2a8ProtectedArtifactSnapshot();
    assert.equal(after.aggregate_sha256, before.aggregate_sha256);
    assert.equal(externalNetworkCalls, 0);
    console.log(JSON.stringify({
      status: "passed",
      case_count: cases.length,
      mode_schema_count: preflight.mode_schema_count,
      compiled_role_count: preflight.role_count,
      pass_run_provider_output_count: passRun.review.provider_output_count,
      fallback_run_fallback_count: failRun.summary.fallback_count,
      protected_artifacts_unchanged: true,
      external_network_calls: externalNetworkCalls
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(passRoot, { recursive: true, force: true });
    rmSync(failRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
