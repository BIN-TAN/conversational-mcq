import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { CANONICAL_EVIDENCE_IDENTITY_VERSION } from "../src/lib/domain/canonical-evidence-identity";
import { MISCONCEPTION_CLAIM_IDENTITY_VERSION } from "../src/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
  FormativeConversationV18R2AgentInputSchema,
  FormativeConversationV18R2AgentOutputSchema
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION,
  validateFormativeConversationV18R2CandidateAcceptance
} from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import {
  FORMATIVE_CONVERSATION_V18R2_LIFECYCLE_VERSION,
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS
} from "../src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import {
  buildFormativeConversationV18R2ProductionRequest,
  FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import {
  FORMATIVE_CONVERSATION_OPENING_VERSION,
  FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_OPENING_REVIEW_SIGNAL
} from "../src/lib/services/student-assessment/formative-conversation/opening-contract";
import { FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-update-v18";
import {
  v18r2TestContext,
  v18r2TestContinueOutput,
  v18r2TestTerminalOutput
} from "./formative-conversation-v18r2-test-fixtures";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import { profileRecordProvenance } from "../src/lib/services/student-assessment/profile-record";

const FIXTURE_PATH =
  "config/operational-candidates/formative-conversation-v18r2-ux-polish/fixtures/ux-polish-regression-cases.json";

type BehaviorCase = {
  case_id: string;
  student_message: string;
  tutor_message: string;
  expected_outcome: "continue_conversation";
  expected_question: boolean;
};

type OpeningCase = {
  case_id: string;
  message: string;
  expected_valid: boolean;
  expected_issue_code?: string;
  expected_review_signal_code?: string;
};

type Fixture = {
  fixture_version: string;
  behavior_cases: BehaviorCase[];
  opening_cases: OpeningCase[];
};

function continueCandidate(input: {
  context: ReturnType<typeof v18r2TestContext>;
  message: string;
}) {
  return FormativeConversationV18R2AgentOutputSchema.parse({
    ...v18r2TestContinueOutput({
      context: input.context,
      include_observation: false
    }),
    student_visible_message: input.message,
    evidence_observations: [],
    profile_transition_recommendation: null
  });
}

function openingCandidate(message: string) {
  return FormativeConversationV18R2AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "continue_conversation",
    student_visible_message: message,
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

function main() {
  const fixture = JSON.parse(
    readFileSync(path.resolve(process.cwd(), FIXTURE_PATH), "utf8")
  ) as Fixture;
  assert.equal(
    fixture.fixture_version,
    "formative-conversation-v18r2-ux-polish-regression-v1"
  );

  const originalFetch = globalThis.fetch;
  let generationNetworkRequests = 0;
  globalThis.fetch = (async () => {
    generationNetworkRequests += 1;
    throw new Error("network_forbidden_in_v18r2_ux_polish_smoke");
  }) as typeof fetch;

  try {
    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
      "formative-conversation-host-v7.15"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION,
      "formative-conversation-v18r2-candidate-acceptance-v4"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION,
      "formative-conversation-v18r2-opening-acknowledgement-v2"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_OPENING_VERSION,
      "formative-conversation-opening-v3",
      "The persisted opening receipt identity must remain stable."
    );

    assert.match(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /Do not follow a fixed or preferred word count/u
    );
    assert.doesNotMatch(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /\b\d+\s*(?:-|–|to)\s*\d+\s+words?\b|\b(?:maximum|minimum|preferred|target)\s+(?:of\s+)?\d+\s+words?\b/iu
    );
    assert.match(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /does not need to end with a question/u
    );
    assert.match(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /Ask a substantive question only when it materially helps/u
    );
    assert.match(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /Answer a request for the answer directly/u
    );
    assert.match(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /change\s+the explanatory representation or approach/u
    );
    assert.match(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /investigate the student's mental model/u
    );
    assert.doesNotMatch(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /\bafter\s+(?:two|three|\d+)\s+(?:failed\s+)?explanations?\b/iu
    );
    assert.match(
      FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS,
      /Do not reconstruct or follow those legacy routes/u
    );
    for (const rule of [
      "Group difficulties only when the",
      "without waiting for a practice request",
      "not a ranking algorithm, remediation queue, or required teaching sequence",
      "not automatically because several answers are wrong",
      "Requested hints, explanations and direct answers remain available afterward",
      "Add no confidence or tempting-alternative question",
      "do not extract a separate follow-up answer",
      "One substantive",
      "one correct response does not resolve unrelated claims",
      "Consider preceding hints, supplied reasoning and worked examples",
      "recognition of the explanation, not a new application",
      "Do not override that rule simply because the supplied explanation is correct",
      "including when the same message also requests an overview",
      "correct option cannot be identified just by its length",
      "Design the reasoning decision before writing the options",
      "Move shared qualifications into the stem",
      "Agreement with an objection is not automatic",
      "do not upgrade adjacent claims merely because the criticism is correct",
      "Apply the same assistance-aware standard to summaries and praise as to profile changes",
      "a student summarizing that same study has",
      "followed by explicit endorsement of the original error is conflicting evidence",
      "do not merely repeat the exact-true-score subtraction question",
      "A direct question, objection, request for help",
      "a stop-only message after an already validated improvement",
      "openly correct or replace it"
    ]) assert(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS.replace(/\s+/g, " ").includes(rule), rule);
    assert.doesNotMatch(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /Say to reply with the question number and chosen letter/);
    assert.equal(profileRecordProvenance({
      id: "synthetic-v714-profile", profile_type: "updated", item_level_evidence: [],
      misconception_indicators: [], process_interpretation_cautions: [], confidence_alignment: "mixed",
      based_on_agent_call: { agent_name: "formative_conversation_agent", call_status: "succeeded",
        output_validated: true, prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION }
    }).profile_confidence_alignment_scope, "carried_forward_not_reassessed");

    // These are contract fixtures, not evidence that a live tutor makes the same choices.
    const flexibleReplies = [
      ["A", "That choice fits this distinction. What part of the example mattered to you?"],
      ["Consistency does not establish the intended interpretation.", "That identifies the key distinction without needing an option letter."],
      ["I don't know. Can you help before I answer?", "Yes. Consistency concerns agreement; the intended interpretation needs different evidence."],
      ["Please just tell me the answer.", "The option separating consistency from validity fits, because repeatable scores could reflect the wrong attribute."],
      ["I understand.", "We can leave that explanation there."],
      ["I would rather not answer that question.", "We can leave the example and discuss your question instead."],
      ["Can we go back to the earlier example?", "Yes. We were distinguishing repeatable scores from evidence about what those scores mean."],
      ["I want to finish now.", "You can finish here; there is no need to answer the example."],
      ["That interval was not guaranteed. Your example did not give distribution assumptions.", "You are right. My claim of guaranteed coverage was wrong. SEM alone does not guarantee that interval; let me correct the example."]
    ];
    for (const [student, tutor] of flexibleReplies) {
      const context = v18r2TestContext({ student_turn_count: 1, student_messages: [student] });
      const before = JSON.stringify(context);
      const candidate = continueCandidate({ context, message: tutor });
      const accepted = validateFormativeInterpretation({ context, candidate });
      assert.equal(accepted.valid, true, `${student}: ${accepted.validation_issue_paths}`);
      assert.equal(candidate.profile_transition_recommendation, null);
      assert.deepEqual(candidate.evidence_observations, []);
      assert.equal(JSON.stringify(context), before, "Validation must not rewrite assessment or dialogue evidence.");
    }
    const partialContext = v18r2TestContext({ student_turn_count: 1, student_messages: [
      "Consistency does not establish the intended interpretation, but I still think subtracting SEM gives the exact true score."
    ] });
    partialContext.current_profile.canonical_profile!.confidence_alignment = "mixed";
    partialContext.initial_profile.canonical_profile!.confidence_alignment = "mixed";
    const partial = v18r2TestTerminalOutput({ context: partialContext, outcome: "largely_improved_understanding" });
    const partialValidation = validateFormativeInterpretation({ context: partialContext, candidate: partial });
    assert.equal(partialValidation.valid, true, partialValidation.validation_issue_paths.join(", "));
    assert(partial.profile_transition_recommendation?.misconception_claim_dispositions.some(claim => claim.disposition === "retained"));
    const falseCompletion = { ...partial, lifecycle_recommendation: "complete" };
    assert.equal(validateFormativeInterpretation({ context: partialContext, candidate: falseCompletion }).valid, false,
      "Tutor-recommended completion must not erase remaining claims; explicit student finish uses its separate lifecycle path.");

    const contextText = JSON.stringify(partialContext);
    assert(partialContext.assessment_response_evidence.length > 1);
    for (const response of partialContext.assessment_response_evidence) {
      assert(contextText.includes(response.item_public_id));
      assert("written_reasoning" in response && "tempting_option_reason" in response && "confidence" in response);
    }

    const behaviorResults = fixture.behavior_cases.map((entry, index) => {
      const context = v18r2TestContext({
        student_turn_count: 1,
        student_messages: [entry.student_message],
        conversation_public_id: `v18r2-ux-polish-${index + 1}`
      });
      const candidate = continueCandidate({
        context,
        message: entry.tutor_message
      });
      const validation =
        validateFormativeConversationV18R2CandidateAcceptance({
          candidate,
          context
        });
      assert.equal(validation.valid, true, entry.case_id);
      assert.equal(candidate.outcome, entry.expected_outcome);
      assert.equal(candidate.profile_transition_recommendation, null);
      assert.equal(candidate.evidence_observations.length, 0);
      assert.equal(
        /\?\s*$/u.test(candidate.student_visible_message.trim()),
        entry.expected_question,
        entry.case_id
      );
      return {
        case_id: entry.case_id,
        accepted: true,
        tutor_question_present: entry.expected_question,
        profile_transition_recommendation: null
      };
    });

    const openingContext = v18r2TestContext({ student_turn_count: 0 });
    const openingResults = fixture.opening_cases.map((entry) => {
      const validation =
        validateFormativeConversationV18R2CandidateAcceptance({
          candidate: openingCandidate(entry.message),
          context: openingContext
        });
      assert.equal(validation.valid, entry.expected_valid, entry.case_id);
      if (entry.expected_issue_code) {
        assert(
          validation.validation_issue_paths.some((issue) =>
            issue.includes(entry.expected_issue_code as string)
          ),
          `${entry.case_id} must report ${entry.expected_issue_code}`
        );
      }
      if (entry.expected_review_signal_code) {
        assert.deepEqual(
          validation.non_blocking_review_signals,
          [entry.expected_review_signal_code],
          `${entry.case_id} review signals`
        );
      } else if (entry.expected_valid) {
        assert.deepEqual(
          validation.non_blocking_review_signals,
          [],
          `${entry.case_id} review signals`
        );
      }
      return {
        case_id: entry.case_id,
        accepted: validation.valid,
        validation_status: validation.validation_status,
        non_blocking_review_signals:
          validation.non_blocking_review_signals
      };
    });

    const malformedOpening =
      validateFormativeConversationV18R2CandidateAcceptance({
        candidate: {
          contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
          student_visible_message: "A malformed opening."
        },
        context: openingContext
      });
    assert.equal(malformedOpening.valid, false);
    assert.equal(malformedOpening.validation_status, "schema_invalid");

    const invalidLifecycleOpening =
      validateFormativeConversationV18R2CandidateAcceptance({
        candidate: {
          ...openingCandidate(
            "Here is a safe opening that must not close the conversation."
          ),
          lifecycle_recommendation: "pause"
        },
        context: openingContext
      });
    assert.equal(invalidLifecycleOpening.valid, false);
    assert.equal(
      invalidLifecycleOpening.validation_status,
      "opening_contract_invalid"
    );
    assert(
      invalidLifecycleOpening.validation_issue_paths.includes(
        "student_visible_message:opening_must_continue_conversation"
      )
    );

    const unauthorizedItemContext =
      FormativeConversationV18R2AgentInputSchema.parse({
        ...structuredClone(openingContext),
        administered_items: [
          {
            item_public_id: "unrevealed_transfer_item",
            item_number: 4,
            item_stem: "A protected transfer item.",
            options: [
              { label: "A", text: "First option" },
              { label: "B", text: "Second option" }
            ],
            student_answer: null,
            correct_answer: "B",
            concise_explanation: "Protected assessment truth.",
            administered: true
          }
        ]
      });
    const unadministeredAnswerOpening =
      validateFormativeConversationV18R2CandidateAcceptance({
        candidate: openingCandidate(
          "The correct answer to the unrevealed transfer item is B."
        ),
        context: unauthorizedItemContext
      });
    assert.equal(unadministeredAnswerOpening.valid, false);
    assert.equal(unadministeredAnswerOpening.validation_status, "safety_invalid");
    assert(
      unadministeredAnswerOpening.validation_issue_paths.includes(
        "context.safety_boundary.administered_item_boundary_mismatch"
      )
    );

    const safeOpeningWithoutAcknowledgement = openingResults.find(
      (entry) => entry.case_id === "generic_disconnected_opening"
    );
    assert.equal(safeOpeningWithoutAcknowledgement?.accepted, true);
    assert.deepEqual(
      safeOpeningWithoutAcknowledgement?.non_blocking_review_signals,
      [FORMATIVE_CONVERSATION_V18R2_OPENING_REVIEW_SIGNAL]
    );

    const livePrimaryReplay = openingResults.find(
      (entry) => entry.case_id === "live_ux_canary_primary_replay"
    );
    const liveRegenerationReplay = openingResults.find(
      (entry) => entry.case_id === "live_ux_canary_regeneration_replay"
    );
    assert.equal(livePrimaryReplay?.accepted, true);
    assert.equal(liveRegenerationReplay?.accepted, true);

    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
      "formative-conversation-agent-contract-v4"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
      "formative-conversation-context-v4"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_LIFECYCLE_VERSION,
      "formative-conversation-lifecycle-v1"
    );
    assert.equal(FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS, 12);
    assert.equal(
      CANONICAL_EVIDENCE_IDENTITY_VERSION,
      "canonical-evidence-identity-v2"
    );
    assert.equal(
      MISCONCEPTION_CLAIM_IDENTITY_VERSION,
      "misconception-claim-identity-v1"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION,
      "formative-conversation-profile-transition-v7"
    );

    const productionRequest =
      buildFormativeConversationV18R2ProductionRequest({
        context: v18r2TestContext({ student_turn_count: 1 }),
        model_config: {
          model_name: "gpt-5.6-sol",
          reasoning_effort: "medium",
          max_output_tokens: 7_000
        },
        client_request_id: "v18r2-ux-polish-production-schema",
        timeout_ms: 60_000,
        invocation_key: "v18r2-ux-polish-production-schema"
      });
    const compiled = compileProductionStructuredAgentRequest(productionRequest);
    assert.equal(compiled.model, "gpt-5.6-sol");
    assert.equal(compiled.max_output_tokens, 7_000);
    assert.equal(compiled.store, false);
    assert.match(JSON.stringify(compiled.input), /formative_lifecycle/u);
    assert.match(
      JSON.stringify(compiled.text),
      /profile_transition_recommendation/u
    );
    assert.equal(generationNetworkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          fixture_version: fixture.fixture_version,
          behavior_results: behaviorResults,
          opening_results: openingResults,
          exact_live_opening_replays_accepted: 2,
          acknowledgement_only_semantic_regenerations_required: 0,
          hard_negative_controls: {
            malformed_structured_output: "blocked",
            invalid_opening_lifecycle: "blocked",
            unadministered_answer_boundary: "blocked"
          },
          response_length_constraint_introduced: false,
          question_required_on_every_turn: false,
          no_question_continue_conversation_accepted: true,
          nonterminal_profile_transition_recommendation: null,
          canonical_contracts_unchanged: true,
          flexible_conversation_contract_cases: flexibleReplies.length,
          partial_improvement_retains_other_claim: true,
          forced_tutor_completion_with_remaining_claim_blocked: true,
          exact_production_responses_schema_compiled: true,
          provider_calls: 0,
          model_auth_requests: 0,
          generation_network_requests: generationNetworkRequests,
          real_dispatch_checkpoints: 0
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main();
