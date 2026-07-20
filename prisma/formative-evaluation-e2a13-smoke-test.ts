import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  executeE2A13Evaluation,
  analyzeE2A13ProtocolOverlap,
  cleanupE2A13Fixture,
  createE2A13Fixture,
  inspectE2A13Preflight,
  resolveE2A13Budget,
  temporaryE2A13ArtifactRoot,
  validateE2A13Artifacts,
  validateE2A13HeldOutProtocol
} from "@/lib/evaluation/formative/e2a13-v8-30-case-evaluation";
import {
  E2A13_PROTOCOL_HASH,
  assertE2A13ProtocolFrozen,
  e2a13HeldOutCases
} from "@/lib/evaluation/formative/e2a13-v8-30-case-protocol";
import {
  E2A11_CANDIDATE_HASH,
  evaluateE2A11Candidate
} from "@/lib/evaluation/formative/e2a11-v8-validator-candidate";
import {
  compileE2A11CandidateRequestsNoNetwork
} from "@/lib/evaluation/formative/e2a11-request-compilation";
import {
  fallbackForCase,
  validateE2A10ProviderOutput
} from "@/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary";
import {
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import {
  executeTopicDialogueCandidateRuntimeV2
} from "@/lib/services/student-assessment/topic-dialogue-candidate-runtime-v2";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function result(output: unknown, suffix: string): StructuredAgentResult<unknown> {
  return {
    provider: "mock",
    provider_request_id: `mock_request_${suffix}`,
    provider_response_id: `mock_response_${suffix}`,
    client_request_id: `mock_client_${suffix}`,
    status: "completed",
    parsed_output: output,
    raw_output: output,
    usage: {
      input_tokens: 120,
      output_tokens: 45,
      reasoning_tokens: 0,
      total_tokens: 165
    },
    latency_ms: 8
  };
}

class DeterministicNoLiveProvider implements LlmProvider {
  callCount = 0;

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.callCount += 1;
    const caseId = e2a13HeldOutCases().find((entry) =>
      request.client_request_id.includes(entry.case_id)
    );
    if (!caseId) throw new Error("e2a13_mock_case_not_found");
    const parsed = request.output_schema.parse(fallbackForCase(caseId));
    return {
      provider: "mock",
      provider_request_id: `mock_request_${this.callCount}`,
      provider_response_id: `mock_response_${this.callCount}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: parsed,
      raw_output: parsed,
      usage: {
        input_tokens: 200,
        output_tokens: 80,
        reasoning_tokens: 0,
        total_tokens: 280
      },
      latency_ms: 5
    };
  }
}

function contextFor(testCase: ReturnType<typeof e2a13HeldOutCases>[number]) {
  return {
    selected_mode: testCase.selected_mode,
    selected_operation: testCase.selected_operation,
    latest_student_message: testCase.dialogue_input.latest_student_message,
    distractor_anchor: testCase.distractor_anchor,
    misconception_target: testCase.misconception_target,
    strategies_already_attempted: testCase.strategies_already_attempted,
    prohibited_repeated_strategies:
      testCase.strategies_marked_unsuccessful
  };
}

async function runRuntimeScenarioAssertions(suite: string) {
  const shouldRun = (name: string) => suite === "all" || suite === name ||
    (suite === "integration" && [
      "accepted",
      "flagged",
      "regeneration",
      "fallback",
      "persistence"
    ].includes(name));
  const inventory = e2a13HeldOutCases();
  const cases = [
    inventory.find((entry) =>
      entry.selected_operation === "elicit_anchor_evidence"
    )!,
    inventory.find((entry) =>
      entry.selected_operation === "clarify_concept_with_new_strategy"
    )!,
    inventory.find((entry) => entry.selected_operation === "clarify_task")!,
    inventory.find((entry) =>
      entry.selected_operation === "protected_redirect"
    )!
  ];
  const prisma = new PrismaClient();
  const runId = `smoke_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const fixture = await createE2A13Fixture(prisma, runId, cases);
  const modelConfig = evaluateE2A11Candidate().full_candidate.roles
    .topic_dialogue_agent;
  try {
    if (shouldRun("accepted")) {
      const testCase = cases[0]!;
      const fixtureSession = fixture.sessions.get(testCase.case_id)!;
      const output = fallbackForCase(testCase);
      assert("student_facing_message" in output,
        "operation fallback should contain a student-facing message");
      const execution = await executeTopicDialogueCandidateRuntimeV2({
        prisma,
        assessment_session_db_id:
          fixtureSession.assessment_session_db_id,
        concept_unit_session_db_id:
          fixtureSession.concept_unit_session_db_id,
        session_public_id: fixtureSession.session_public_id,
        invocation_key: `e2a13:${fixtureSession.session_public_id}`,
        candidate_hash: E2A11_CANDIDATE_HASH,
        protocol_hash: E2A13_PROTOCOL_HASH,
        model_config: modelConfig,
        validation_context: contextFor(testCase),
        deterministic_fallback_output: fallbackForCase(testCase),
        invoke_provider: async () => result(output, "accepted")
      });
      assert(execution.final_runtime_acceptance === "accepted",
        "fully accepted output should remain accepted");
      assert(execution.regeneration_count === 0,
        "fully accepted output must not regenerate");
      assert(!execution.deterministic_fallback_used,
        "fully accepted output must not use fallback");
      assert(execution.persisted_visible_message ===
        output.student_facing_message,
      "fully accepted output should persist and display unchanged");
    }

    if (shouldRun("flagged")) {
      const testCase = cases[1]!;
      const fixtureSession = fixture.sessions.get(testCase.case_id)!;
      const output = {
        schema_version:
          TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS
            .clarify_concept_with_new_strategy,
        student_facing_message:
          "Try a residual-link example for Item 14 option B. How could two items remain connected after the intended trait is accounted for?"
      };
      const execution = await executeTopicDialogueCandidateRuntimeV2({
        prisma,
        assessment_session_db_id:
          fixtureSession.assessment_session_db_id,
        concept_unit_session_db_id:
          fixtureSession.concept_unit_session_db_id,
        session_public_id: fixtureSession.session_public_id,
        invocation_key: `e2a13:${fixtureSession.session_public_id}`,
        candidate_hash: E2A11_CANDIDATE_HASH,
        protocol_hash: E2A13_PROTOCOL_HASH,
        model_config: modelConfig,
        validation_context: contextFor(testCase),
        deterministic_fallback_output: fallbackForCase(testCase),
        invoke_provider: async () => result(output, "flagged")
      });
      assert(execution.final_runtime_acceptance ===
        "accepted_with_review_flags",
      "soft concern should remain accepted with review flags");
      assert(execution.regeneration_count === 0,
        "soft concern must not regenerate");
      assert(execution.persisted_visible_message ===
        output.student_facing_message,
      "flagged provider text should display unchanged");
      assert(execution.audit_projection.review_flags.length > 0,
        "authorized audit should include review flags");
      const studentSurface = JSON.stringify({
        state: execution.student_projection,
        transcript: execution.refreshed_transcript,
        action: execution.action_response,
        rendered: execution.rendered_text
      });
      assert(!/review_flag|validator_version|rubric_version/iu.test(studentSurface),
        "student surfaces must omit review flags and provenance");
    }

    if (shouldRun("regeneration")) {
      const testCase = cases[2]!;
      const fixtureSession = fixture.sessions.get(testCase.case_id)!;
      const hard = {
        schema_version:
          TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS.clarify_task,
        student_facing_message: "The correct answer is C."
      };
      const accepted = {
        schema_version:
          TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS.clarify_task,
        student_facing_message:
          "For Item 11 option C, state which inference you are evaluating and name one item-level comparison that would test it."
      };
      const execution = await executeTopicDialogueCandidateRuntimeV2({
        prisma,
        assessment_session_db_id:
          fixtureSession.assessment_session_db_id,
        concept_unit_session_db_id:
          fixtureSession.concept_unit_session_db_id,
        session_public_id: fixtureSession.session_public_id,
        invocation_key: `e2a13:${fixtureSession.session_public_id}`,
        candidate_hash: E2A11_CANDIDATE_HASH,
        protocol_hash: E2A13_PROTOCOL_HASH,
        model_config: modelConfig,
        validation_context: contextFor(testCase),
        deterministic_fallback_output: fallbackForCase(testCase),
        invoke_provider: async ({ attempt_index }) => result(
          attempt_index === 1 ? hard : accepted,
          `regeneration_${attempt_index}`
        )
      });
      assert(execution.regeneration_count === 1,
        "initial hard rejection should regenerate exactly once");
      assert(execution.final_runtime_acceptance !== "deterministic_fallback",
        "accepted regeneration should not use fallback");
      assert(execution.persisted_visible_message ===
        accepted.student_facing_message,
      "accepted regeneration should be the only visible output");
      assert(!execution.refreshed_transcript.some((turn) =>
        turn.message_text === hard.student_facing_message
      ), "initial rejected output must never be visible");
      assert(execution.audit_projection.hard_rejection_history.length === 1,
        "rejected initial attempt should remain auditable");
    }

    if (shouldRun("fallback") || shouldRun("persistence")) {
      const testCase = cases[3]!;
      const fixtureSession = fixture.sessions.get(testCase.case_id)!;
      const hard = {
        schema_version:
          TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS.protected_redirect,
        student_facing_message: "The correct answer is B."
      };
      const execution = await executeTopicDialogueCandidateRuntimeV2({
        prisma,
        assessment_session_db_id:
          fixtureSession.assessment_session_db_id,
        concept_unit_session_db_id:
          fixtureSession.concept_unit_session_db_id,
        session_public_id: fixtureSession.session_public_id,
        invocation_key: `e2a13:${fixtureSession.session_public_id}`,
        candidate_hash: E2A11_CANDIDATE_HASH,
        protocol_hash: E2A13_PROTOCOL_HASH,
        model_config: modelConfig,
        validation_context: contextFor(testCase),
        deterministic_fallback_output: fallbackForCase(testCase),
        invoke_provider: async ({ attempt_index }) => result(
          hard,
          `fallback_${attempt_index}`
        )
      });
      assert(execution.regeneration_count === 1,
        "two hard outputs should still regenerate only once");
      assert(execution.deterministic_fallback_used,
        "second hard rejection should use deterministic fallback");
      assert(!execution.refreshed_transcript.some((turn) =>
        turn.message_text === hard.student_facing_message
      ), "hard-rejected output must not enter the transcript");
      assert(execution.audit_projection.hard_rejection_history.length === 2,
        "both rejected attempts should remain auditable");
      assert(execution.visible_chronological_order_valid,
        "refreshed transcript should retain chronological order");
      const session = await prisma.assessmentSession.findUniqueOrThrow({
        where: { id: fixtureSession.assessment_session_db_id },
        select: { status: true, current_phase: true }
      });
      assert(session.status === "active" &&
        session.current_phase === "followup_active",
      "fallback must leave the activity safe and resumable");
    }
  } finally {
    await cleanupE2A13Fixture(prisma, fixture);
    await prisma.$disconnect();
  }
}

async function runArtifactAssertions() {
  const root = temporaryE2A13ArtifactRoot();
  const provider = new DeterministicNoLiveProvider();
  try {
    const evaluation = await executeE2A13Evaluation({
      live: false,
      provider,
      artifactRoot: root,
      runId: "e2a13_no_live_artifact_smoke"
    });
    const validation = validateE2A13Artifacts(evaluation.runDir);
    assert(validation.passed, "emitted E2A13 artifacts should validate");
    assert(provider.callCount === 30,
      "no-live artifact run should dispatch exactly 30 injected calls");
    assert(evaluation.summary.provider_usage.generation_provider_calls === 30,
      "no-live artifact run should report 30 generation calls");
    assert(evaluation.summary.initial_schema_valid_count === 30,
      "all injected no-live outputs should satisfy strict schemas");
    assert(evaluation.summary.fallback_count === 0,
      "accepted injected outputs should not use deterministic fallback");
    assert(evaluation.summary.final_status ===
      "v8_30case_pass_pending_human_review",
    "production-equivalent no-live artifact run should satisfy the automated gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const index = process.argv.indexOf("--suite");
  const suite = index >= 0 ? process.argv[index + 1] ?? "all" : "all";
  const known = new Set([
    "all",
    "protocol",
    "overlap",
    "integration",
    "accepted",
    "flagged",
    "regeneration",
    "fallback",
    "shadow",
    "persistence",
    "budget",
    "resource",
    "artifact",
    "compilation",
    "preflight"
  ]);
  assert(known.has(suite), `unknown_e2a13_suite:${suite}`);
  if (["all", "protocol"].includes(suite)) {
    const protocol = validateE2A13HeldOutProtocol();
    assert(protocol.passed, "held-out protocol should pass inventory checks");
    assert(assertE2A13ProtocolFrozen() === E2A13_PROTOCOL_HASH,
      "held-out protocol hash should be frozen and reproducible");
  }
  if (["all", "overlap"].includes(suite)) {
    const overlap = analyzeE2A13ProtocolOverlap();
    assert(overlap.passed, "held-out protocol must not overlap prior corpora");
    assert(overlap.exact_match_count === 0 && overlap.near_duplicate_count === 0,
      "held-out protocol must contain zero exact or near duplicates");
  }
  if ([
    "all",
    "integration",
    "accepted",
    "flagged",
    "regeneration",
    "fallback",
    "persistence"
  ].includes(suite)) {
    await runRuntimeScenarioAssertions(suite);
  }
  if (["all", "shadow"].includes(suite)) {
    const testCase = e2a13HeldOutCases().find((entry) =>
      entry.selected_operation === "clarify_concept_with_new_strategy"
    )!;
    const output = {
      schema_version:
        TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS
          .clarify_concept_with_new_strategy,
      student_facing_message:
        "Try a residual-link example for Item 14 option B. How could two items remain connected after the intended trait is accounted for?"
    };
    const shadow = validateE2A10ProviderOutput({ testCase, value: output });
    assert(typeof shadow.valid === "boolean",
      "V7 shadow validator should return a read-only result");
  }
  if (["all", "budget"].includes(suite)) {
    const budget = resolveE2A13Budget({});
    assert(budget.maximum_cases === 30 &&
      budget.maximum_total_generation_calls === 60 &&
      budget.maximum_input_tokens === 900000 &&
      budget.maximum_output_tokens === 150000 &&
      budget.maximum_estimated_cost_usd === 35,
    "E2A13 hard budgets should match the bounded protocol");
    let failed = false;
    try {
      resolveE2A13Budget({ EVAL_E2A13_MAX_TOTAL_CALLS: "61" });
    } catch {
      failed = true;
    }
    assert(failed, "budget expansion should fail closed");
  }
  if (["all", "resource"].includes(suite)) {
    const protocol = validateE2A13HeldOutProtocol();
    assert(protocol.checks.case_count_30,
      "resource policy should be bounded to 30 cases");
    assert(protocol.remain_in_dialogue_count >= 21 &&
      protocol.progression_count >= 6 &&
      protocol.stress_case_count >= 3 &&
      protocol.tenth_turn_checks.length >= 6,
    "protocol should satisfy operation, progression, stress, and history bounds");
    assert(resolveE2A13Budget().provider_case_concurrency === 1,
      "provider concurrency must remain one");
  }
  if (["all", "compilation"].includes(suite)) {
    const root = mkdtempSync(path.join(os.tmpdir(), "e2a13-compile-"));
    try {
      const compiled = await compileE2A11CandidateRequestsNoNetwork(
        path.join(root, "requests.json")
      );
      assert(compiled.artifact.all_17_roles_compile &&
        compiled.artifact.request_count === 26 &&
        compiled.artifact.network_request_count === 0,
      "all 17 candidate roles should compile without network access");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  if (["all", "preflight"].includes(suite)) {
    const preflight = await inspectE2A13Preflight();
    assert(preflight.passed,
      `no-live E2A13 preflight failed:${preflight.blockers.join(",")}`);
    assert(!preflight.v8_candidate_approved &&
      !preflight.v8_candidate_activated,
    "V8 must remain unapproved and inactive");
  }
  if (["all", "artifact"].includes(suite)) {
    await runArtifactAssertions();
  }
  console.log(JSON.stringify({
    status: "passed",
    suite,
    candidate_hash: E2A11_CANDIDATE_HASH,
    protocol_hash: E2A13_PROTOCOL_HASH,
    provider_generation_call_count: 0,
    external_network_request_count: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a13_smoke_failed");
  process.exitCode = 1;
});
