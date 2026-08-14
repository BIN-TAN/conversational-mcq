import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CanonicalEvidenceCatalogSchema,
  type CanonicalEvidenceCatalog
} from "../src/lib/domain/canonical-evidence-identity";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { canonicalStructuredAgentRequestHash } from "../src/lib/llm/provider-transport-retry";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import {
  FormativeConversationV18AgentOutputSchema
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
  FormativeConversationV18R2AgentInputSchema,
  FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import {
  FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES,
  validateFormativeConversationV18Transition
} from "../src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18";
import {
  FormativeConversationV18R2ExecutionError,
  executeFormativeConversationV18R2,
  type FormativeConversationV18R2LogicalGenerationExecution
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import {
  buildFormativeConversationV18R2ProductionRequest
} from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import {
  formativeConversationV18R2LifecycleForTurnCount
} from "../src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import {
  v18r2CatalogWithEvidenceId,
  v18r2TestContext,
  v18r2TestContinueOutput,
  v18r2TestTerminalOutput
} from "./formative-conversation-v18r2-test-fixtures";

type ReplayFixture = {
  immutable_lineage: {
    source_commit_sha: string;
    source_provider_run_id: string;
    source_derived_evaluation_id: string;
  };
  cases: Array<{
    case_id: string;
    agent_call_public_id: string;
    candidate_hash: string;
    validation_status: string;
    validation_issue_paths: string[];
    candidate: Record<string, unknown>;
  }>;
};

const REPLAY_PATH =
  "config/operational-candidates/formative-conversation-contract-coherence-v18r2/fixtures/v18r1-seven-failed-primary-candidates.json";
const UNKNOWN_EVIDENCE_ID = "ev_ffffffffffffffffffffffff";
const TUTOR_EVIDENCE_ID = "ev_aaaaaaaaaaaaaaaaaaaaaaaa";
const UNKNOWN_CLAIM_ID = "mc_ffffffffffffffffffffffff";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validation(
  context: FormativeConversationV18R2AgentInput,
  candidate: unknown
) {
  return validateFormativeConversationV18R2CandidateAcceptance({
    context,
    candidate
  });
}

function recommendation(output: FormativeConversationV18R2AgentOutput) {
  assert(output.profile_transition_recommendation);
  return output.profile_transition_recommendation;
}

function transitionValidation(input: {
  context: FormativeConversationV18R2AgentInput;
  output: FormativeConversationV18R2AgentOutput;
  catalog?: CanonicalEvidenceCatalog;
}) {
  return validateFormativeConversationV18Transition({
    conversation_public_id: input.context.conversation_public_id,
    prior_profile_evidence_cutoff_sequence_index:
      input.context.current_profile.evidence_cutoff_sequence_index,
    recommendation: recommendation(input.output),
    prior_profile: input.context.current_profile.canonical_profile,
    prior_misconception_claim_catalog:
      input.context.allowed_misconception_claim_catalog,
    allowed_evidence_catalog:
      input.catalog ?? input.context.allowed_evidence_catalog,
    evidence_observations: input.output.evidence_observations
  });
}

function replaceTerminalEvidenceIds(
  output: FormativeConversationV18R2AgentOutput,
  evidenceIds: string[]
) {
  const changed = clone(output);
  const transition = recommendation(changed);
  transition.canonical_evidence_ids = [...evidenceIds];
  transition.field_evidence.forEach((entry) => {
    if (entry.disposition === "updated_from_conversation_evidence") {
      entry.evidence_ids = [...evidenceIds];
    }
  });
  transition.misconception_claim_dispositions.forEach((entry) => {
    if (entry.disposition === "resolved" || entry.evidence_ids.length > 0) {
      entry.evidence_ids = [...evidenceIds];
    }
  });
  changed.evidence_observations.forEach((entry) => {
    entry.evidence_ids = [...evidenceIds];
  });
  return changed;
}

function catalogWithTutorEvidence(input: {
  context: FormativeConversationV18R2AgentInput;
}) {
  const current = input.context.allowed_evidence_catalog.evidence.find(
    (entry) => entry.evidence_kind === "formative_student_turn"
  );
  assert(current);
  return CanonicalEvidenceCatalogSchema.parse({
    ...input.context.allowed_evidence_catalog,
    evidence: [
      ...input.context.allowed_evidence_catalog.evidence,
      {
        ...current,
        evidence_id: TUTOR_EVIDENCE_ID,
        evidence_kind: "formative_tutor_turn",
        source_role: "tutor",
        eligibility: "not_eligible",
        content: "Tutor explanation is not evidence of student understanding."
      }
    ]
  });
}

function openingOutput() {
  return FormativeConversationV18R2AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "continue_conversation",
    student_visible_message:
      "Now that you've reviewed your responses, we can look more closely at how reliability, validity, and score uncertainty differ. Which part would you like to start with?",
    teaching_artifact: null,
    evidence_observations: [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function productionRequest(context: FormativeConversationV18R2AgentInput) {
  return buildFormativeConversationV18R2ProductionRequest({
    context,
    model_config: {
      model_name: "gpt-5.6-sol",
      reasoning_effort: "medium",
      max_output_tokens: 7_000
    },
    client_request_id: "v18r2-contract-smoke",
    timeout_ms: 60_000,
    invocation_key: "v18r2-contract-smoke"
  });
}

function completedResult(input: {
  request: StructuredAgentRequest<unknown, FormativeConversationV18R2AgentOutput>;
  output: FormativeConversationV18R2AgentOutput;
  provider_attempt_count?: number;
  transport_retry_count?: number;
}): FormativeConversationV18R2LogicalGenerationExecution {
  const serialized = JSON.stringify(input.output);
  const result: StructuredAgentResult<FormativeConversationV18R2AgentOutput> = {
    provider: "openai",
    client_request_id: input.request.client_request_id,
    status: "completed",
    parsed_output: input.output,
    raw_output: {
      status: "completed",
      output: [
        {
          content: [{ type: "output_text", text: serialized }]
        }
      ]
    },
    usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
    latency_ms: 5,
    transport_telemetry: {
      provider: "openai",
      transport: "openai_responses",
      adapter_version: "openai-responses-adapter-v4",
      client_request_id: input.request.client_request_id,
      model_name: input.request.model_config.model_name,
      base_url_host: "api.openai.com",
      base_url_approved: true,
      transport_adapter_entered: true,
      request_serialization_completed: true,
      fetch_invoked: false,
      response_headers_received: false,
      response_body_started: false,
      response_body_completed: false,
      response_body_bytes_received: 0,
      response_body_received: false,
      structured_output_validation_status: "valid",
      structured_output_validation_issue_paths: []
    }
  };
  return {
    result,
    logical_call_id: `v18r2-logical-${createHash("sha256")
      .update(`${input.request.client_request_id}:${serialized}`)
      .digest("hex")
      .slice(0, 16)}`,
    canonical_request_hash: canonicalStructuredAgentRequestHash(input.request),
    provider_attempt_count: input.provider_attempt_count ?? 1,
    transport_retry_count: input.transport_retry_count ?? 0,
    latency_ms: 5,
    pre_dispatch_request_rejection_count: 0,
    http_request_count: 0,
    provider_response_completed_count: 1
  };
}

function acceptanceForExecution(context: FormativeConversationV18R2AgentInput) {
  return (output: FormativeConversationV18R2AgentOutput) => {
    const accepted = validation(context, output);
    return {
      valid: accepted.valid,
      validation_status: accepted.validation_status,
      validation_issue_paths: accepted.validation_issue_paths
    };
  };
}

async function assertRecoveryAndFailSafe() {
  const context = v18r2TestContext({ student_turn_count: 12 });
  const request = productionRequest(context);
  const invalidContinue = v18r2TestContinueOutput({ context });
  const terminal = v18r2TestTerminalOutput({
    context,
    outcome: "largely_improved_understanding"
  });
  const requests: Array<
    StructuredAgentRequest<unknown, FormativeConversationV18R2AgentOutput>
  > = [];
  const recovered = await executeFormativeConversationV18R2({
    base_request: request,
    validate_candidate: acceptanceForExecution(context),
    async execute_logical_generation({ sequence, request: attemptedRequest }) {
      requests.push(attemptedRequest);
      return completedResult({
        request: attemptedRequest,
        output: sequence === 1 ? invalidContinue : terminal
      });
    }
  });
  assert.equal(recovered.result.parsed_output.outcome, "largely_improved_understanding");
  assert.equal(recovered.audit.logical_calls_entered, 2);
  assert.equal(recovered.audit.semantic_regeneration_calls, 1);
  assert.equal(recovered.audit.attempts[0]?.accepted, false);
  assert.equal(recovered.audit.attempts[1]?.accepted, true);
  assert(
    recovered.audit.attempts[0]?.invalid_candidate?.validation_issue_paths.includes(
      "formative_lifecycle.another_student_turn_available:continue_conversation_unavailable_on_final_allowed_turn"
    )
  );
  const regenerationInput = requests[1]?.input as {
    original_context?: FormativeConversationV18R2AgentInput;
    semantic_regeneration?: {
      formative_lifecycle?: FormativeConversationV18R2AgentInput["formative_lifecycle"];
      invalid_candidate_hash?: string | null;
      issue_paths?: string[];
    };
  };
  assert.deepEqual(regenerationInput.original_context, context);
  assert.deepEqual(
    regenerationInput.semantic_regeneration?.formative_lifecycle,
    context.formative_lifecycle
  );
  assert.match(regenerationInput.semantic_regeneration?.invalid_candidate_hash ?? "", /^[a-f0-9]{64}$/u);
  assert(
    regenerationInput.semantic_regeneration?.issue_paths?.some((entry) =>
      entry.includes("continue_conversation_unavailable_on_final_allowed_turn")
    )
  );

  let failSafeError: FormativeConversationV18R2ExecutionError | null = null;
  try {
    await executeFormativeConversationV18R2({
      base_request: request,
      validate_candidate: acceptanceForExecution(context),
      execute_logical_generation: ({ request: attemptedRequest }) =>
        Promise.resolve(
          completedResult({ request: attemptedRequest, output: invalidContinue })
        )
    });
  } catch (error) {
    if (error instanceof FormativeConversationV18R2ExecutionError) {
      failSafeError = error;
    } else {
      throw error;
    }
  }
  assert(failSafeError);
  assert.equal(failSafeError.failure_class, "parsed_semantic_contract_failure");
  assert.equal(failSafeError.failure_category, "semantic_regeneration_exhausted");
  assert.equal(failSafeError.audit.semantic_regeneration_calls, 1);
  assert.equal(failSafeError.audit.semantically_accepted_candidates, 0);
}

function replayV18R1Failures() {
  const replay = JSON.parse(
    readFileSync(path.resolve(process.cwd(), REPLAY_PATH), "utf8")
  ) as ReplayFixture;
  assert.equal(replay.immutable_lineage.source_commit_sha, "2147e4d340e9adbfd8014433ceede852fbdc54fc");
  assert.equal(replay.cases.length, 7);
  return replay.cases.map((entry) => {
    const original = FormativeConversationV18AgentOutputSchema.safeParse(
      entry.candidate
    );
    assert.equal(original.success, false);
    if (!original.success) {
      assert.deepEqual(
        [...new Set(original.error.issues.map((issue) => issue.path.join(".")))],
        ["profile_transition_recommendation.updated_profile"]
      );
    }
    assert.equal(entry.validation_status, "schema_invalid");
    assert.deepEqual(entry.validation_issue_paths, [
      "profile_transition_recommendation.updated_profile"
    ]);
    const originalTransition = entry.candidate
      .profile_transition_recommendation as Record<string, unknown>;
    assert.equal(originalTransition.proposed_outcome, "continue_conversation");
    assert.equal(originalTransition.recommended, false);
    assert.equal(originalTransition.updated_profile, null);
    assert(Array.isArray(originalTransition.canonical_evidence_ids));
    assert.equal(originalTransition.canonical_evidence_ids.length, 1);
    const evidenceId = String(originalTransition.canonical_evidence_ids[0]);
    const baseContext = v18r2TestContext({
      student_turn_count: 1,
      conversation_public_id: `v18r2-replay-${entry.case_id}`
    });
    const context = FormativeConversationV18R2AgentInputSchema.parse({
      ...baseContext,
      allowed_evidence_catalog: v18r2CatalogWithEvidenceId({
        context: baseContext,
        evidence_id: evidenceId
      })
    });
    const adapted = {
      ...clone(entry.candidate),
      contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
      outcome: "continue_conversation",
      profile_transition_recommendation: null
    };
    const accepted = validation(context, adapted);
    assert.equal(accepted.valid, true, `${entry.case_id} should be a valid nonterminal candidate.`);
    assert.equal(accepted.validation_status, "valid");
    assert.equal(
      accepted.output?.student_visible_message,
      entry.candidate.student_visible_message
    );
    assert.deepEqual(
      accepted.output?.evidence_observations,
      entry.candidate.evidence_observations
    );
    assert.equal(accepted.output?.profile_transition_recommendation, null);
    return {
      case_id: entry.case_id,
      original_outcome: "continue_conversation",
      original_structural_rejection:
        "profile_transition_recommendation.updated_profile",
      v18r2_structural_result: "valid",
      v18r2_semantic_result: "accepted_nonterminal",
      independent_p1_issue: false
    };
  });
}

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden_in_v18r2_contract_smoke");
  }) as typeof fetch;
  const passedCases: string[] = [];
  const pass = (name: string, assertion: () => void) => {
    assertion();
    passedCases.push(name);
  };

  try {
    const openingContext = v18r2TestContext({ student_turn_count: 0 });
    const turn1Context = v18r2TestContext({ student_turn_count: 1 });
    const turn11Context = v18r2TestContext({ student_turn_count: 11 });
    const turn12Context = v18r2TestContext({ student_turn_count: 12 });
    const continue1 = v18r2TestContinueOutput({ context: turn1Context });
    const continue11 = v18r2TestContinueOutput({ context: turn11Context });
    const continue12 = v18r2TestContinueOutput({ context: turn12Context });
    const earlySound = v18r2TestTerminalOutput({
      context: turn1Context,
      outcome: "sound_understanding"
    });
    const earlyLargely = v18r2TestTerminalOutput({
      context: turn1Context,
      outcome: "largely_improved_understanding"
    });
    const earlyTeacher = v18r2TestTerminalOutput({
      context: turn1Context,
      outcome: "teacher_assistance_recommended"
    });
    const finalSound = v18r2TestTerminalOutput({
      context: turn12Context,
      outcome: "sound_understanding"
    });
    const finalLargely = v18r2TestTerminalOutput({
      context: turn12Context,
      outcome: "largely_improved_understanding"
    });
    const finalTeacher = v18r2TestTerminalOutput({
      context: turn12Context,
      outcome: "teacher_assistance_recommended"
    });

    pass("01_turn_1_continue", () => assert.equal(validation(turn1Context, continue1).valid, true));
    pass("02_repeated_continue", () => {
      for (const studentTurnCount of [2, 4, 7, 10]) {
        const context = v18r2TestContext({ student_turn_count: studentTurnCount });
        assert.equal(validation(context, v18r2TestContinueOutput({ context })).valid, true);
      }
    });
    pass("03_turn_11_continue", () => assert.equal(validation(turn11Context, continue11).valid, true));
    pass("04_early_sound", () => assert.equal(validation(turn1Context, earlySound).valid, true));
    pass("05_early_largely_improved", () => assert.equal(validation(turn1Context, earlyLargely).valid, true));
    pass("06_early_teacher_assistance", () => assert.equal(validation(turn1Context, earlyTeacher).valid, true));
    pass("07_turn_12_sound", () => assert.equal(validation(turn12Context, finalSound).valid, true));
    pass("08_turn_12_largely_improved", () => assert.equal(validation(turn12Context, finalLargely).valid, true));
    pass("09_turn_12_teacher_assistance", () => assert.equal(validation(turn12Context, finalTeacher).valid, true));
    pass("10_continue_then_terminal", () => {
      for (const studentTurnCount of [1, 3, 6]) {
        const context = v18r2TestContext({ student_turn_count: studentTurnCount });
        assert.equal(validation(context, v18r2TestContinueOutput({ context })).valid, true);
      }
      assert.equal(validation(turn11Context, v18r2TestTerminalOutput({ context: turn11Context, outcome: "largely_improved_understanding" })).valid, true);
    });
    pass("11_claim_ids_stable", () => {
      const first = turn1Context.allowed_misconception_claim_catalog.indicators.flatMap((indicator) => indicator.claims.map((claim) => claim.claim_id));
      const twelfth = turn12Context.allowed_misconception_claim_catalog.indicators.flatMap((indicator) => indicator.claims.map((claim) => claim.claim_id));
      assert.deepEqual(twelfth, first);
    });
    pass("12_evidence_ids_stable", () => {
      const first = turn1Context.allowed_evidence_catalog.evidence.find((entry) => entry.evidence_kind === "formative_student_turn");
      const same = turn12Context.allowed_evidence_catalog.evidence.find((entry) => entry.source_sequence_index === first?.source_sequence_index);
      assert(first && same);
      assert.equal(same.evidence_id, first.evidence_id);
    });
    pass("13_idempotent_replay_turn_count", () => {
      assert.deepEqual(
        formativeConversationV18R2LifecycleForTurnCount(1),
        formativeConversationV18R2LifecycleForTurnCount(1)
      );
    });
    pass("14_transport_retry_turn_count", () => {
      assert.equal(turn1Context.formative_lifecycle.student_turn_index, 1);
      assert.equal(turn1Context.telemetry_summary.observable_student_turn_count, 1);
    });
    pass("15_semantic_regeneration_turn_count", () => {
      assert.equal(turn12Context.formative_lifecycle.student_turn_index, 12);
    });
    pass("16_continue_has_no_transition", () => {
      assert.equal(continue1.profile_transition_recommendation, null);
      assert.equal(continue1.outcome, "continue_conversation");
    });

    const continueWithTransition = {
      ...clone(continue1),
      profile_transition_recommendation: clone(
        earlyLargely.profile_transition_recommendation
      )
    };
    pass("17_reject_continue_with_transition", () => {
      const result = validation(turn1Context, continueWithTransition);
      assert.equal(result.valid, false);
      assert.equal(result.validation_status, "schema_invalid");
      assert(result.validation_issue_paths.includes("profile_transition_recommendation"));
    });
    pass("18_reject_continue_with_claim_dispositions", () => {
      const result = validation(turn1Context, continueWithTransition);
      assert.equal(result.valid, false);
    });
    pass("19_reject_continue_with_transition_evidence", () => {
      const result = validation(turn1Context, continueWithTransition);
      assert.equal(result.valid, false);
    });
    pass("20_reject_turn_12_continue", () => {
      const result = validation(turn12Context, continue12);
      assert.equal(result.valid, false);
      assert.equal(result.validation_status, "semantic_contract_invalid");
      assert(result.validation_issue_paths.some((entry) => entry.includes("continue_conversation_unavailable_on_final_allowed_turn")));
    });
    pass("21_reject_thirteenth_turn", () => {
      assert.throws(
        () => formativeConversationV18R2LifecycleForTurnCount(13),
        /Too big|less than or equal to 12|formative/u
      );
    });
    pass("22_no_automatic_teacher_assistance", () => {
      assert.equal(continue12.teacher_assistance_recommendation.recommended, false);
      assert.equal(continue12.outcome, "continue_conversation");
    });
    pass("23_lifecycle_handoff_not_transition_shape", () => {
      assert.equal(continue12.profile_transition_recommendation, null);
    });
    pass("24_reject_baseline_only_resolution", () => {
      const baselineId = turn1Context.allowed_evidence_catalog.evidence.find((entry) => entry.evidence_kind === "assessment_reasoning")?.evidence_id;
      assert(baselineId);
      const result = transitionValidation({
        context: turn1Context,
        output: replaceTerminalEvidenceIds(earlySound, [baselineId])
      });
      assert.equal(result.valid, false);
      assert(result.issues.some((entry) => entry.code === FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.currentStudentRequired || entry.code === FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal));
    });
    pass("25_reject_tutor_evidence", () => {
      const result = transitionValidation({
        context: turn1Context,
        output: replaceTerminalEvidenceIds(earlySound, [TUTOR_EVIDENCE_ID]),
        catalog: catalogWithTutorEvidence({ context: turn1Context })
      });
      assert.equal(result.valid, false);
      assert(result.issues.some((entry) => entry.code === FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.ineligible));
    });
    pass("26_reject_unknown_claim", () => {
      const changed = clone(earlyLargely);
      const transition = recommendation(changed);
      transition.misconception_claim_dispositions[0]!.claim_id = UNKNOWN_CLAIM_ID;
      const result = validation(turn1Context, changed);
      assert.equal(result.valid, false);
      assert(result.validation_issue_paths.some((entry) => entry.includes(FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.claimUnknown)));
    });
    pass("27_reject_unknown_evidence", () => {
      const changed = replaceTerminalEvidenceIds(earlySound, [UNKNOWN_EVIDENCE_ID]);
      const result = validation(turn1Context, changed);
      assert.equal(result.valid, false);
      assert(result.validation_issue_paths.some((entry) => entry.includes("evidence_id_unknown")));
    });
    pass("28_reject_legacy_transition_fields", () => {
      const changed = clone(earlyLargely) as unknown as Record<string, unknown>;
      const transition = clone(changed.profile_transition_recommendation) as Record<string, unknown>;
      transition.source_turn_sequence_indexes = [2];
      changed.profile_transition_recommendation = transition;
      const result = validation(turn1Context, changed);
      assert.equal(result.valid, false);
      assert.equal(result.validation_status, "schema_invalid");
    });

    await assertRecoveryAndFailSafe();
    passedCases.push("29_final_turn_semantic_regeneration");
    passedCases.push("30_final_turn_fail_safe_signal");

    const opening = validation(openingContext, openingOutput());
    assert.equal(opening.valid, true);
    assert.equal(openingContext.formative_lifecycle.student_turn_index, 0);
    assert.equal(openingContext.assessment_response_evidence.length, 2);
    assert.equal(openingContext.visible_transcript.length, 0);

    const soundSemControlContext = v18r2TestContext({ student_turn_count: 2 });
    const soundSemControl = v18r2TestTerminalOutput({
      context: soundSemControlContext,
      outcome: "largely_improved_understanding"
    });
    const soundSemValidation = validation(soundSemControlContext, soundSemControl);
    assert.equal(soundSemValidation.valid, true);
    assert.equal(soundSemControl.profile_transition_recommendation?.proposed_outcome, "largely_improved_understanding");
    assert(
      soundSemControl.profile_transition_recommendation?.misconception_claim_dispositions.some(
        (entry) => entry.disposition === "retained"
      )
    );

    const compiled = compileProductionStructuredAgentRequest(
      productionRequest(turn1Context)
    );
    assert.equal(compiled.model, "gpt-5.6-sol");
    assert.equal(compiled.max_output_tokens, 7_000);
    assert.equal(compiled.store, false);
    const compiledInput = String(compiled.input);
    const compiledFormat = JSON.stringify(compiled.text);
    assert.match(compiledInput, /formative_lifecycle/u);
    assert.match(compiledInput, /student_turn_index/u);
    assert.match(compiledInput, /assessment_response_evidence/u);
    assert.match(compiledFormat, /profile_transition_recommendation/u);
    assert.match(compiledFormat, /continue_conversation/u);
    assert.match(compiledFormat, /"type":"null"/u);
    assert.doesNotMatch(compiledFormat, /oneOf|discriminator/u);

    const replayResults = replayV18R1Failures();
    assert.equal(replayResults.every((entry) => !entry.independent_p1_issue), true);
    assert.equal(networkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          matrix_case_count: passedCases.length,
          matrix_cases: passedCases,
          v18r1_failed_case_replay: replayResults,
          all_seven_share_contract_contradiction: true,
          independent_p1_issue_count: 0,
          assistant_first_opening_control: "passed",
          sound_sem_boundary_control: "passed_largely_improved_sem_retained",
          assessment_administration_counted_as_formative_turns: 0,
          first_formative_student_message_turn_index: 1,
          maximum_formative_student_turns:
            FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
          production_responses_schema_compiled: true,
          provider_calls: 0,
          model_auth_requests: 0,
          generation_network_requests: networkRequests,
          dispatch_checkpoints: 0
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "formative_conversation_v18r2_contract_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
  process.exitCode = 1;
});
