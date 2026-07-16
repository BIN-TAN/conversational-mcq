import { loadEnvConfig } from "@next/env";
import {
  evaluateCandidateOutputPolicy,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput,
  type ModelUpgradeFixture
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";
import { liveModelRoles } from "../src/lib/llm/config";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

type Suite =
  | "all"
  | "item-admin"
  | "measurement"
  | "activity-context"
  | "confidence"
  | "prompt-provenance";

function selectedSuite(): Suite {
  const index = process.argv.indexOf("--suite");
  const value = index >= 0 ? process.argv[index + 1] : "all";
  if (
    value === "all" ||
    value === "item-admin" ||
    value === "measurement" ||
    value === "activity-context" ||
    value === "confidence" ||
    value === "prompt-provenance"
  ) {
    return value;
  }
  throw new Error(`Unknown suite: ${value}`);
}

function fixtureById(id: string) {
  const fixture = modelUpgradeEvaluationFixtures().find((entry) => entry.fixture_id === id);
  assert(fixture, `Missing fixture ${id}.`);
  return fixture;
}

function output(fixture: ModelUpgradeFixture, text: string, overrides: Partial<CandidateEvaluationOutput> = {}): CandidateEvaluationOutput {
  const teacher = fixture.teacher_facing_review_required;
  return {
    fixture_id: fixture.fixture_id,
    role: fixture.role,
    response_status: "answered",
    output_kind: teacher ? "teacher_tool" : fixture.role === "connectivity_test" ? "utility" : "student_facing",
    response_summary: text,
    student_facing_text: teacher || fixture.role === "connectivity_test" ? null : text,
    teacher_facing_text: teacher ? text : null,
    decision_summary: "Contract smoke decision.",
    evidence_used: ["synthetic fixture"],
    safety_notes: [],
    next_action: null,
    confidence: "medium",
    ...overrides
  };
}

function cloneFixture(fixture: ModelUpgradeFixture, synthetic_input_context: Record<string, unknown>): ModelUpgradeFixture {
  return {
    ...fixture,
    synthetic_input_context
  };
}

function codes(result: ReturnType<typeof evaluateCandidateOutputPolicy>) {
  return new Set([
    ...result.quality_findings,
    ...result.safety_findings,
    ...result.evidence_grounding_findings
  ]);
}

function assertHas(result: ReturnType<typeof evaluateCandidateOutputPolicy>, code: string, message: string) {
  assert(codes(result).has(code), message);
}

function assertNotHas(result: ReturnType<typeof evaluateCandidateOutputPolicy>, code: string, message: string) {
  assert(!codes(result).has(code), message);
}

function runItemAdminSuite() {
  const full = fixtureById("item_administration_which_item_do_you_mean");
  const fullResult = evaluateCandidateOutputPolicy(
    output(full, "I mean Item 2. You are being asked to explain why you chose option C. In one or two sentences, describe the idea you used to make your choice."),
    full
  );
  assertNotHas(fullResult, "item_admin_current_item_not_stated", "Full clarification should state item number.");
  assertNotHas(fullResult, "item_admin_current_task_not_stated", "Full clarification should state reasoning task.");
  assertNotHas(fullResult, "item_admin_selected_option_not_referenced", "Full clarification should reference selected option.");
  assertNotHas(fullResult, "item_admin_actionable_prompt_missing", "Full clarification should ask one actionable prompt.");

  const itemOnly = cloneFixture(full, {
    student_message: "which item?",
    current_item_number: 2,
    expected_behavior: "Clarify the item only."
  });
  const itemOnlyResult = evaluateCandidateOutputPolicy(
    output(itemOnly, "I mean Item 2. Tell me what you want to write next."),
    itemOnly
  );
  assertNotHas(itemOnlyResult, "item_admin_current_item_not_stated", "Item-present/task-absent clarification should name item.");
  assertNotHas(itemOnlyResult, "item_admin_current_task_not_stated", "Task-absent clarification should not require a task statement.");

  const taskOnly = cloneFixture(full, {
    student_message: "what should I do?",
    current_step: "reasoning",
    selected_option: "C",
    expected_behavior: "Clarify the current reasoning task."
  });
  const taskOnlyResult = evaluateCandidateOutputPolicy(
    output(taskOnly, "Explain why you chose option C in one or two sentences."),
    taskOnly
  );
  assertNotHas(taskOnlyResult, "item_admin_current_task_not_stated", "Task-present/item-absent clarification should state the task.");
  assertNotHas(taskOnlyResult, "item_admin_current_item_not_stated", "Item-absent clarification should not require item number.");

  const leakage = evaluateCandidateOutputPolicy(
    output(full, "The correct answer is C, so explain why you chose it."),
    full
  );
  assertHas(leakage, "answer_key_or_correctness_phrase_detected", "Item-admin clarification must not leak correctness.");

  const exampleFixture = fixtureById("item_administration_request_for_an_example");
  const responseForm = evaluateCandidateOutputPolicy(
    output(exampleFixture, "A reasoning response can follow this form: “I chose option C because ____. The key idea I used was ____.”"),
    exampleFixture
  );
  assertNotHas(responseForm, "item_admin_example_not_procedural_response_form", "Response-form example should pass.");
  assertNotHas(responseForm, "item_admin_example_item_specific_hint", "Response-form example should not be treated as a hint.");

  const genericAdvice = evaluateCandidateOutputPolicy(
    output(exampleFixture, "Read the question carefully, eliminate wrong answers, and look for keywords before choosing."),
    exampleFixture
  );
  assertHas(genericAdvice, "item_admin_example_generic_problem_solving_advice", "Generic problem-solving advice should warn.");

  const hint = evaluateCandidateOutputPolicy(
    output(exampleFixture, "For example, think about reliability as consistency and validity as score interpretation evidence."),
    exampleFixture
  );
  assertHas(hint, "item_admin_example_item_specific_hint", "Item-specific conceptual hints should block.");
}

function runMeasurementSuite() {
  const fixture = fixtureById("formative_value_determination_conceptual_need");
  const valid = evaluateCandidateOutputPolicy(
    output(fixture, "Validity concerns evidence supporting intended interpretations and uses of scores."),
    fixture
  );
  assertNotHas(valid, "measurement_validity_definition_too_simplistic", "Course-appropriate validity definition should pass.");
  assertNotHas(valid, "measurement_validity_evidence_use_language_missing", "Course-appropriate validity wording should include evidence/use language.");

  const simplistic = evaluateCandidateOutputPolicy(
    output(fixture, "Validity means the measure assesses what it is intended to assess."),
    fixture
  );
  assertHas(simplistic, "measurement_validity_definition_too_simplistic", "Simplistic validity definition should block.");

  const reliabilityProves = evaluateCandidateOutputPolicy(
    output(fixture, "A high reliability coefficient proves validity."),
    fixture
  );
  assertHas(reliabilityProves, "reliability_alone_establishes_validity", "Reliability-alone validity claim should block.");

  const reliabilityQualified = evaluateCandidateOutputPolicy(
    output(fixture, "Reliability is score consistency or precision; by itself it does not establish validity."),
    fixture
  );
  assertNotHas(reliabilityQualified, "reliability_alone_establishes_validity", "Qualified reliability language should pass.");
}

function runActivityContextSuite() {
  const fixture = fixtureById("formative_activity_distractor_probe");
  const complete = evaluateCandidateOutputPolicy(
    output(fixture, "For Item 2, option A says, “A high reliability coefficient proves that the scores are valid.” What is the precise flaw in that claim? Rewrite it accurately."),
    fixture
  );
  assertNotHas(complete, "activity_context_item_number_missing", "Complete activity context should include item number.");
  assertNotHas(complete, "activity_context_option_label_missing", "Complete activity context should include option label.");
  assertNotHas(complete, "activity_context_option_text_missing", "Complete activity context should include option text.");

  const missing = evaluateCandidateOutputPolicy(
    output(fixture, "For this item, a tempting option makes a reliability-validity claim. Identify the flaw and rewrite it."),
    fixture
  );
  assertHas(missing, "activity_context_item_number_missing", "Missing item number should be detected.");
  assertHas(missing, "activity_context_option_label_missing", "Missing option label should be detected.");
  assertHas(missing, "activity_context_option_text_missing", "Missing option text should be detected.");

  const rawId = evaluateCandidateOutputPolicy(
    output(fixture, "For Item 2, option A says, “A high reliability coefficient proves that the scores are valid.” Internal id 1af3a25f-ff9e-4692-802e-9e631746b51d identifies this option."),
    fixture
  );
  assertHas(rawId, "raw_uuid_detected", "Raw internal IDs should block.");
}

function runConfidenceSuite() {
  const fixture = fixtureById("student_communication_package_feedback");
  const reported = evaluateCandidateOutputPolicy(
    output(fixture, "You reported high confidence on Item 2, so focus on making the reliability-validity boundary explicit."),
    fixture
  );
  assertNotHas(reported, "confidence_self_report_inferred_language", "Reported-confidence wording should pass.");

  const inferred = evaluateCandidateOutputPolicy(
    output(fixture, "You sounded highly confident on Item 2, so focus on making the reliability-validity boundary explicit."),
    fixture
  );
  assertHas(inferred, "confidence_self_report_inferred_language", "Inferred confidence wording should warn.");
}

function runPromptProvenanceSuite() {
  const candidate = readCandidateOperationalModelConfig(FULL_GPT56_V2_CANDIDATE_CONFIG_PATH);
  for (const role of liveModelRoles) {
    const metadata = candidate.configuration_fingerprint?.role_version_metadata[role];
    assert(metadata, `Missing role metadata for ${role}.`);
    assert(typeof metadata?.prompt_hash === "string" && /^[a-f0-9]{64}$/u.test(metadata.prompt_hash), `${role} prompt hash should be non-null and deterministic.`);
  }
  assert(
    candidate.configuration_fingerprint?.role_version_metadata.connectivity_test?.prompt_hash_semantics === "deterministic_config_not_applicable",
    "Connectivity test should document not-applicable prompt semantics with a deterministic config hash."
  );
}

function main() {
  const suite = selectedSuite();
  if (suite === "all" || suite === "item-admin") runItemAdminSuite();
  if (suite === "all" || suite === "measurement") runMeasurementSuite();
  if (suite === "all" || suite === "activity-context") runActivityContextSuite();
  if (suite === "all" || suite === "confidence") runConfidenceSuite();
  if (suite === "all" || suite === "prompt-provenance") runPromptProvenanceSuite();
  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    suite
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
