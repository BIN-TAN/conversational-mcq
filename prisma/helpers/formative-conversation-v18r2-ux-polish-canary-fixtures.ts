import {
  FormativeConversationV18R2AgentInputSchema,
  type FormativeConversationV18R2AgentInput
} from "../../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS,
  V18R2_UX_CANARY_MACHINE_CRITERIA,
  type V18R2UxCanaryFixture
} from "../../src/lib/operational/formative-conversation-v18r2-ux-polish-canary/contracts";
import { v18r2TestContext } from "../formative-conversation-v18r2-test-fixtures";

type FixtureWithoutHash = Omit<V18R2UxCanaryFixture, "fixture_hash">;

function withTutorMessages(input: {
  context: FormativeConversationV18R2AgentInput;
  tutor_messages: readonly string[];
}) {
  const context = structuredClone(input.context);
  let tutorIndex = 0;
  context.visible_transcript = context.visible_transcript.map((turn) => {
    if (turn.actor !== "tutor") return turn;
    const replacement = input.tutor_messages[tutorIndex];
    tutorIndex += 1;
    return replacement ? { ...turn, message_text: replacement } : turn;
  });
  return FormativeConversationV18R2AgentInputSchema.parse(context);
}

function common(input: {
  case_id: FixtureWithoutHash["case_id"];
  case_order: number;
  title: string;
  purpose: string;
  context: FormativeConversationV18R2AgentInput;
  opening_case?: boolean;
  historical_reference?: FixtureWithoutHash["historical_reference"];
}): FixtureWithoutHash {
  return {
    fixture_version:
      "formative-conversation-v18r2-ux-polish-live-canary-fixture-v1",
    case_id: input.case_id,
    case_order: input.case_order,
    title: input.title,
    purpose: input.purpose,
    synthetic_only: true,
    real_student_information_present: false,
    opening_case: input.opening_case ?? false,
    context: input.context,
    historical_reference: input.historical_reference ?? null,
    machine_validation_criteria: [...V18R2_UX_CANARY_MACHINE_CRITERIA],
    human_review_dimensions: [...V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS],
    deterministic_ux_wording_assertions: false,
    call_graph: {
      agent_name: "formative_conversation_agent",
      base_logical_calls: 1,
      maximum_semantic_regenerations: 1,
      maximum_logical_calls: 2,
      maximum_provider_attempts_per_logical_call: 3,
      maximum_transport_retries_per_logical_call: 2
    }
  };
}

export function buildV18R2UxPolishCanaryFixtures(): FixtureWithoutHash[] {
  const directAnswer = v18r2TestContext({
    student_turn_count: 1,
    student_messages: [
      "Please give me the answer directly: does high reliability prove validity, and why?"
    ],
    conversation_public_id: "v18r2-ux-canary-direct-answer"
  });

  const explainDifferently = withTutorMessages({
    context: v18r2TestContext({
      student_turn_count: 2,
      student_messages: [
        "I still think repeated scores prove that a test is valid.",
        "That explanation did not help. Please explain it differently in plain language."
      ],
      conversation_public_id: "v18r2-ux-canary-explain-differently"
    }),
    tutor_messages: [
      "You connected repeatability with trust in a score. Reliability describes consistency, while validity asks whether evidence supports the intended interpretation and use.",
      "A test can produce stable scores and still support the wrong conclusion, so reliability alone cannot establish validity."
    ]
  });

  const persistentMisconception = withTutorMessages({
    context: v18r2TestContext({
      student_turn_count: 3,
      student_messages: [
        "If the same score keeps appearing, I think that proves the test is valid.",
        "I understand that validity is a separate word, but consistency still seems like proof to me.",
        "I still believe high reliability proves validity because repeated results cannot be wrong."
      ],
      conversation_public_id: "v18r2-ux-canary-persistent-misconception"
    }),
    tutor_messages: [
      "Reliability tells us that scores are consistent. Validity requires evidence that the score interpretation is justified for the intended purpose.",
      "Imagine a scale that is always five kilograms too high. Its readings repeat, but the repeated value is not accurate; consistency and justified interpretation remain different questions.",
      "The repeated result rules out some random variation, but it does not rule out a stable bias or measuring the wrong construct."
    ]
  });

  const naturalOpening = v18r2TestContext({
    student_turn_count: 0,
    conversation_public_id: "v18r2-ux-canary-natural-opening"
  });

  return [
    common({
      case_id: "uxc_01_direct_answer",
      case_order: 1,
      title: "Direct answer",
      purpose:
        "Observe whether the live tutor answers the explicit request directly without mechanically appending a comprehension or transfer question.",
      context: directAnswer
    }),
    common({
      case_id: "uxc_02_explain_differently",
      case_order: 2,
      title: "Explain differently",
      purpose:
        "Observe whether the live tutor changes explanatory representation or approach after the student says the prior explanation did not help.",
      context: explainDifferently
    }),
    common({
      case_id: "uxc_03_persistent_misconception",
      case_order: 3,
      title: "Persistent misconception",
      purpose:
        "Observe whether the live tutor responds to the student's continuing reasoning, with freedom to investigate why the misconception remains compelling.",
      context: persistentMisconception
    }),
    common({
      case_id: "uxc_04_natural_opening",
      case_order: 4,
      title: "Natural opening",
      purpose:
        "Confirm that a natural evidence-oriented primary opening is accepted without cosmetic semantic regeneration.",
      context: naturalOpening,
      opening_case: true,
      historical_reference: {
        reference_id: "v18r2_primary_opening_01_semantic_review",
        message:
          "You’ve reviewed the distinctions among reliability, measurement error, and validity. Let’s connect them in one practical situation.",
        prior_issue_code: "opening_assessment_acknowledgement_missing",
        revised_validator_accepts_reference: true
      }
    })
  ];
}
