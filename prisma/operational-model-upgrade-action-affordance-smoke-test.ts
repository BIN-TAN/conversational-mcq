import {
  adjudicateModelUpgradeActionRequest,
  MODEL_UPGRADE_ACTION_AFFORDANCE_REGISTRY
} from "../src/lib/operational/model-upgrade-action-affordances";
import {
  evaluateModelUpgradeOutputLayers,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  fixtureOutputContract,
  type ModelUpgradeExpectedActionType,
  type ModelUpgradeFixtureOutputContract
} from "../src/lib/operational/model-upgrade-output-contracts";
import {
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";
import { assert } from "./operational-model-upgrade-test-helpers";

const candidate = readCandidateOperationalModelConfig(FULL_GPT56_V2_CANDIDATE_CONFIG_PATH);
const fixtures = modelUpgradeEvaluationFixtures();
const clarification = fixtureOutputContract(
  "student_pre_reveal_clarification",
  "item_administration_tutor_agent"
);

function contract(expected: ModelUpgradeExpectedActionType): ModelUpgradeFixtureOutputContract {
  return { ...clarification, expected_action_type: expected };
}

function output(studentText: string, nextAction: string | null): Record<string, unknown> {
  return {
    output_kind: "student_facing",
    response_summary: "Bounded action-affordance test.",
    decision_summary: "Use the declared action contract.",
    evidence_used: ["synthetic action test"],
    student_facing_text: studentText,
    next_action: nextAction
  };
}

const passing: Array<{
  expected: ModelUpgradeExpectedActionType;
  studentText: string;
  nextAction: string;
}> = [
  { expected: "explain_reasoning", studentText: "Why did you choose C?", nextAction: "Student explains why they chose C." },
  { expected: "explain_reasoning", studentText: "Please explain why you chose C.", nextAction: "Student explains their reasoning." },
  { expected: "complete_response_template", studentText: "Complete: \"I chose C because ____.\"", nextAction: "Student completes the response template." },
  { expected: "complete_response_template", studentText: "Fill in the two blanks with your reasoning.", nextAction: "Student fills in the reasoning blanks." },
  { expected: "select_option", studentText: "Choose one option below.", nextAction: "Student selects one option." },
  { expected: "confirm_choice", studentText: "Confirm your answer to continue.", nextAction: "Student confirms the final answer." },
  { expected: "revise_response", studentText: "Rewrite the statement accurately.", nextAction: "Student revises the response statement." },
  { expected: "ask_topic_question", studentText: "What would you like to clarify?", nextAction: "Student asks a topic question." }
];

for (const testCase of passing) {
  const result = adjudicateModelUpgradeActionRequest({
    contract: contract(testCase.expected),
    output: output(testCase.studentText, testCase.nextAction)
  });
  assert(result.status === "action_present", `Expected action_present for ${testCase.studentText}`);
}

const currentCase = adjudicateModelUpgradeActionRequest({
  contract: fixtureOutputContract(
    "student_pre_reveal_response_example",
    "item_administration_tutor_agent"
  ),
  output: output(
    "For Item 2, in the reasoning step: \"I chose option C because ____. The key idea I used was ____.\" Please complete the two blanks with your reasoning.",
    "Student completes the two reasoning blanks."
  )
});
assert(currentCase.status === "action_present", "The retained response-template output must classify as action_present.");
assert(currentCase.expected_action_type === "complete_response_template", "The procedural example must use its canonical action type.");
const exampleFixture = fixtures.find((entry) => entry.fixture_id === "item_administration_request_for_an_example");
assert(exampleFixture, "Procedural-example fixture must exist.");
const currentOutput: CandidateEvaluationOutput = {
  fixture_id: exampleFixture.fixture_id,
  role: exampleFixture.role,
  response_status: "clarified",
  output_kind: "student_facing",
  response_summary: "Provided a procedural response template.",
  student_facing_text: "For Item 2, in the reasoning step: \"I chose option C because ____. The key idea I used was ____.\" Please complete the two blanks with your reasoning.",
  teacher_facing_text: null,
  decision_summary: "Clarify response form without content help.",
  evidence_used: ["fixed synthetic context"],
  safety_notes: [],
  next_action: "Student completes the two reasoning blanks.",
  confidence: "high"
};
const currentLayers = evaluateModelUpgradeOutputLayers({ fixture: exampleFixture, candidate, output: currentOutput });
assert(currentLayers.action_adjudication.status === "action_present", "The full evaluator must classify the retained output as action_present.");
assert(currentLayers.validator_results.output_completeness.status === "passed", "The retained output must pass structural completeness.");
assert(
  !currentLayers.validator_results.output_completeness.issue_codes.includes("required_actionable_student_prompt_missing"),
  "Action quality must not emit a completeness finding."
);

const failing = [
  adjudicateModelUpgradeActionRequest({ contract: clarification, output: output("", null) }),
  adjudicateModelUpgradeActionRequest({ contract: clarification, output: output("Item 2 is the current item.", "Student explains their reasoning.") }),
  adjudicateModelUpgradeActionRequest({ contract: clarification, output: output("", "Student explains their reasoning.") }),
  adjudicateModelUpgradeActionRequest({
    contract: contract("select_option"),
    output: output("Explain why option C was tempting.", "Student selects one option.")
  })
];
assert(failing.every((entry) => entry.status === "action_absent"), "All explicit failing forms must classify as action_absent.");

const uncertain = [
  adjudicateModelUpgradeActionRequest({
    contract: clarification,
    output: output("You might want to explain your reason.", "Student explains their reasoning.")
  }),
  adjudicateModelUpgradeActionRequest({
    contract: clarification,
    output: output("Please continue.", "Student explains their reasoning.")
  }),
  adjudicateModelUpgradeActionRequest({
    contract: contract("select_option"),
    output: output("Do the next part now.", "Student selects one option.")
  })
];
assert(uncertain.every((entry) => entry.status === "action_uncertain"), "Ambiguous forms must classify as action_uncertain.");
assert(uncertain.every((entry) => entry.reason_codes.includes("action_request_review_required")), "Uncertain forms must route to review.");

const itemFixture = fixtures.find((entry) => entry.fixture_id === "item_administration_what");
assert(itemFixture, "Item-administration fixture must exist.");
const contradictoryOutput: CandidateEvaluationOutput = {
  fixture_id: itemFixture.fixture_id,
  role: itemFixture.role,
  response_status: "clarified",
  output_kind: "student_facing",
  response_summary: "Clarified the current item.",
  student_facing_text: "Choose one option below.",
  teacher_facing_text: null,
  decision_summary: "Ask for the required reasoning.",
  evidence_used: ["fixed synthetic context"],
  safety_notes: [],
  next_action: "Student explains why they chose C.",
  confidence: "high"
};
const separated = evaluateModelUpgradeOutputLayers({
  fixture: itemFixture,
  candidate,
  output: contradictoryOutput
});
assert(separated.validator_results.output_completeness.status === "passed", "Completeness must check structure only.");
assert(separated.validator_results.instruction_following.status === "failed", "Action mismatch belongs to instruction following.");
assert(!separated.validator_results.instruction_following.critical, "Action mismatch must not be an automatic critical failure.");
assert(separated.validator_results.fact_consistency.status === "passed", "Fact consistency must not adjudicate actionability.");

const uncertainOutput = { ...contradictoryOutput, student_facing_text: "Please continue." };
const uncertainLayers = evaluateModelUpgradeOutputLayers({ fixture: itemFixture, candidate, output: uncertainOutput });
assert(uncertainLayers.validator_results.output_completeness.status === "passed", "Uncertain action language must remain structurally complete.");
assert(uncertainLayers.validator_results.instruction_following.status === "review_required", "Uncertain action language must route to instruction review.");
assert(uncertainLayers.validator_results.pedagogical_quality.status === "review_required", "Uncertain action usability must route to pedagogical review.");
assert(uncertainLayers.validator_results.language_quality.status === "review_required", "Uncertain action clarity must route to language review.");
assert(!uncertainLayers.validator_results.output_completeness.critical, "Uncertain action language must not be critical completeness.");

assert(Object.keys(MODEL_UPGRADE_ACTION_AFFORDANCE_REGISTRY).length === 8, "All canonical action types must be registered once.");

console.log(JSON.stringify({
  status: "passed",
  passing_action_forms: passing.length + 1,
  failing_action_forms: failing.length,
  uncertain_action_forms: uncertain.length,
  responsibility_separation_verified: true,
  no_openai_call: true
}, null, 2));
