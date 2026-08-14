import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { CANONICAL_EVIDENCE_IDENTITY_VERSION } from "../src/lib/domain/canonical-evidence-identity";
import { MISCONCEPTION_CLAIM_IDENTITY_VERSION } from "../src/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
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
  FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/opening-contract";
import { FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-update-v18";
import {
  v18r2TestContext,
  v18r2TestContinueOutput
} from "./formative-conversation-v18r2-test-fixtures";

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
      "formative-conversation-host-v7.2"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION,
      "formative-conversation-v18r2-candidate-acceptance-v2"
    );
    assert.equal(
      FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION,
      "formative-conversation-v18r2-opening-acknowledgement-v1"
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
      return {
        case_id: entry.case_id,
        accepted: validation.valid,
        validation_status: validation.validation_status
      };
    });

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
    assert.match(String(compiled.input), /formative_lifecycle/u);
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
          response_length_constraint_introduced: false,
          question_required_on_every_turn: false,
          no_question_continue_conversation_accepted: true,
          nonterminal_profile_transition_recommendation: null,
          canonical_contracts_unchanged: true,
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
