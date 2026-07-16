import {
  evaluateModelUpgradeOutputLayers,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput,
  type ModelUpgradeFixture
} from "../src/lib/operational/model-upgrade-evaluation";
import { fixtureOutputContract } from "../src/lib/operational/model-upgrade-output-contracts";
import { preflightModelUpgradeFixture } from "../src/lib/operational/model-upgrade-evaluation-protocol";
import {
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";
import { assert } from "./operational-model-upgrade-test-helpers";

const candidate = readCandidateOperationalModelConfig(FULL_GPT56_V2_CANDIDATE_CONFIG_PATH);
const fixtures = modelUpgradeEvaluationFixtures();

function fixture(fixtureId: string) {
  const found = fixtures.find((entry) => entry.fixture_id === fixtureId);
  if (!found) throw new Error(`fixture_missing:${fixtureId}`);
  return found;
}

function output(input: Partial<CandidateEvaluationOutput> & Pick<CandidateEvaluationOutput, "role" | "output_kind">): CandidateEvaluationOutput {
  return {
    fixture_id: "synthetic_contract_case",
    response_status: "answered",
    response_summary: "Bounded synthetic contract response.",
    student_facing_text: null,
    teacher_facing_text: null,
    decision_summary: "Use only the supplied synthetic evidence.",
    evidence_used: ["fixed synthetic fixture context"],
    safety_notes: [],
    next_action: null,
    confidence: "medium",
    ...input
  };
}

function completeness(targetFixture: ModelUpgradeFixture, candidateOutput: CandidateEvaluationOutput) {
  return evaluateModelUpgradeOutputLayers({
    fixture: targetFixture,
    candidate,
    output: candidateOutput
  }).validator_results;
}

const profile = fixture("student_profiling_specific_misconception");
const profileResult = completeness(profile, output({
  role: profile.role,
  output_kind: "teacher_tool",
  teacher_facing_text: "The supplied package supports a cautious misconception hypothesis for teacher review."
}));
assert(profileResult.output_completeness.status === "passed", "Teacher profiling output must not require student text.");

const planning = fixture("formative_value_and_planning_distractor_first_selection");
const planningResult = completeness(planning, output({
  role: planning.role,
  output_kind: "teacher_tool",
  teacher_facing_text: "Use a distractor-informed activity plan for teacher review."
}));
assert(planningResult.output_completeness.status === "passed", "Teacher planning output must not require student text.");

const communication = fixture("student_communication_package_feedback");
const communicationMissing = completeness(communication, output({
  role: communication.role,
  output_kind: "student_facing"
}));
assert(
  communicationMissing.output_completeness.issue_codes.includes("required_student_facing_text_missing"),
  "Student communication must fail when student-facing text is absent."
);

const activity = fixture("formative_activity_distractor_probe");
const activityPass = completeness(activity, output({
  role: activity.role,
  output_kind: "student_facing",
  student_facing_text: "For Item 2, identify the exact flaw in option A, then rewrite it accurately."
}));
assert(activityPass.output_completeness.status === "passed", "An elicitation turn must not require a correctness summary.");

const activityPremature = completeness(activity, output({
  role: activity.role,
  output_kind: "student_facing",
  student_facing_text: "Items 1 and 3 were correct and Item 2 was incorrect. Identify the flaw in option A."
}));
assert(
  activityPremature.instruction_following.issue_codes.includes("forbidden_correctness_summary_present"),
  "An elicitation turn that repeats package correctness must be flagged."
);

const feedbackMissingCorrectness = completeness(communication, output({
  role: communication.role,
  output_kind: "student_facing",
  student_facing_text: "Focus next on separating consistency from evidence for score interpretation."
}));
assert(
  feedbackMissingCorrectness.output_completeness.issue_codes.includes("required_correctness_summary_missing"),
  "A feedback/reveal contract must require correctness when explicitly declared."
);

const internalSource = fixture("formative_activity_response_evaluation");
const internalFixture: ModelUpgradeFixture = {
  ...internalSource,
  input_contract: {
    ...internalSource.input_contract,
    permitted_surfaces: ["internal"],
    output_contract: fixtureOutputContract("internal_evaluation", internalSource.role)
  }
};
const internalResult = completeness(internalFixture, output({
  role: internalSource.role,
  output_kind: "internal"
}));
assert(internalResult.output_completeness.status === "passed", "Internal evaluator output must not require student text.");

const contradiction: ModelUpgradeFixture = {
  ...profile,
  input_contract: {
    ...profile.input_contract,
    output_contract: {
      ...profile.input_contract.output_contract,
      required_fields: [...profile.input_contract.output_contract.required_fields, "student_facing_text"],
      forbidden_fields: [...profile.input_contract.output_contract.forbidden_fields, "student_facing_text"]
    }
  }
};
const contradictionPreflight = preflightModelUpgradeFixture(contradiction);
assert(contradictionPreflight.status === "fixture_invalid", "Contradictory fixture output contracts must be invalid.");
assert(!contradictionPreflight.provider_dispatch_permitted, "Contradictory fixture contracts must block before dispatch.");

console.log(JSON.stringify({
  status: "passed",
  cases: 8,
  output_contract_registry_is_single_source: true,
  no_openai_call: true
}, null, 2));
