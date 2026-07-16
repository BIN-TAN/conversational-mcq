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

const claimBasedFindingCodes = new Set([
  "unsupported_misconduct_motivation_or_ability_claim_detected",
  "unsupported_engagement_construct_claim",
  "confidence_inferred_from_language_style",
  "reliability_alone_establishes_validity",
  "measurement_validity_definition_too_simplistic",
  "measurement_validity_evidence_use_language_missing"
]);

function assertClaimBasedFindingsAreStructured(result: ReturnType<typeof evaluateCandidateOutputPolicy>) {
  const findings = [
    ...result.safety_finding_details,
    ...result.evidence_grounding_details,
    ...result.quality_finding_details
  ].filter((entry) => claimBasedFindingCodes.has(entry.finding_code));
  for (const entry of findings) {
    const claim = entry.claim_details;
    assert(claim, `${entry.finding_code} must include claim_details.`);
    assert(Boolean(claim?.exact_claim.trim()), `${entry.finding_code} must include a complete proposition.`);
    assert(Boolean(claim?.exact_clause.trim()), `${entry.finding_code} must include an exact clause.`);
    assert(Boolean(claim?.speaker_source), `${entry.finding_code} must include speaker/source.`);
    assert(Boolean(claim?.assertion_mode), `${entry.finding_code} must classify assertion versus mention/report.`);
    assert(Boolean(claim?.claim_type), `${entry.finding_code} must include claim type.`);
    assert(Boolean(claim?.polarity), `${entry.finding_code} must include polarity.`);
    assert(Boolean(claim?.modality), `${entry.finding_code} must include modality.`);
    assert(Boolean(claim?.source_field), `${entry.finding_code} must include evaluated field.`);
  }
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
  const actionableCases = [
    {
      label: "imperative",
      text: "Item 2 — Reasoning: You selected option C. Explain the idea you used in your own words."
    },
    {
      label: "question",
      text: "Item 2 — Reasoning: You selected option C. What idea led you to choose option C?"
    },
    {
      label: "response template with completion instruction",
      text: "Item 2 — Reasoning: You selected option C. Example: “I chose option C because ____. The key idea I used was ____.” Please complete the two blanks in your own words."
    }
  ];
  for (const entry of actionableCases) {
    const result = evaluateCandidateOutputPolicy(output(exampleFixture, entry.text), exampleFixture);
    assertNotHas(result, "item_admin_current_task_not_stated", `${entry.label} should state the current task semantically.`);
    assertNotHas(result, "item_admin_actionable_prompt_missing", `${entry.label} should be actionable without exact wording requirements.`);
    assertNotHas(result, "item_admin_example_item_specific_hint", `${entry.label} should not be treated as a hint.`);
  }

  const vague = evaluateCandidateOutputPolicy(
    output(exampleFixture, "Item 2 is the current item. Your response can be brief."),
    exampleFixture
  );
  assertHas(vague, "item_admin_current_task_not_stated", "A vague statement must not count as the reasoning task.");
  assertHas(vague, "item_admin_actionable_prompt_missing", "A vague statement must not count as a next action.");

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
  const mentionFixture = fixtureById("student_profiling_specific_misconception");
  const activityFixture = fixtureById("formative_activity_distractor_probe");
  const mentionAssertionCases = [
    {
      label: "reported misconception",
      fixture: mentionFixture,
      text: "The student treated reliability as proof of validity.",
      shouldBlock: false,
      assertionMode: "mention_or_report",
      speakerSource: "reported_student",
      claimType: "misconception_description"
    },
    {
      label: "quoted distractor",
      fixture: activityFixture,
      text: "For Item 2, option A claims that reliability proves validity.",
      shouldBlock: false,
      assertionMode: "mention_or_report",
      speakerSource: "quoted_distractor",
      claimType: "reported_student_statement"
    },
    {
      label: "corrective relationship",
      fixture,
      text: "Reliability does not prove validity.",
      shouldBlock: false,
      assertionMode: "correction_or_rejection",
      speakerSource: "instructional_voice",
      claimType: "relationship_claim"
    },
    {
      label: "endorsed false relationship",
      fixture,
      text: "Reliability proves validity.",
      shouldBlock: true,
      assertionMode: "assertion",
      speakerSource: "instructional_voice",
      claimType: "relationship_claim"
    }
  ] as const;
  for (const entry of mentionAssertionCases) {
    const result = evaluateCandidateOutputPolicy(output(entry.fixture, entry.text), entry.fixture);
    if (entry.shouldBlock) {
      assertHas(result, "reliability_alone_establishes_validity", `${entry.label} should block.`);
    } else {
      assertNotHas(result, "reliability_alone_establishes_validity", `${entry.label} must not be treated as system endorsement.`);
    }
    const claim = result.claim_details.find((candidate) => candidate.exact_clause === entry.text);
    assert(claim?.assertion_mode === entry.assertionMode, `${entry.label} assertion-mode classification mismatch.`);
    assert(claim?.speaker_source === entry.speakerSource, `${entry.label} speaker/source classification mismatch.`);
    assert(claim?.claim_type === entry.claimType, `${entry.label} claim-type classification mismatch.`);
    assertClaimBasedFindingsAreStructured(result);
  }

  const definitionRelationshipCases = [
    {
      label: "complete validity definition",
      text: "Validity concerns evidence supporting intended interpretations and uses.",
      blockedCode: null
    },
    {
      label: "correct reliability relationship",
      text: "Reliability alone does not establish validity.",
      blockedCode: null
    },
    {
      label: "reported mention",
      text: "The response mentions validity.",
      blockedCode: null
    },
    {
      label: "false accuracy definition",
      text: "Validity simply means accuracy.",
      blockedCode: "measurement_validity_definition_too_simplistic"
    },
    {
      label: "false test-accuracy definition",
      text: "Validity simply means the test is accurate.",
      blockedCode: "measurement_validity_definition_too_simplistic"
    }
  ];
  for (const entry of definitionRelationshipCases) {
    const result = evaluateCandidateOutputPolicy(output(fixture, entry.text), fixture);
    if (entry.blockedCode) {
      assertHas(result, entry.blockedCode, `${entry.label} should block.`);
    } else {
      assertNotHas(result, "measurement_validity_definition_too_simplistic", `${entry.label} should not be treated as a false definition.`);
      assertNotHas(result, "reliability_alone_establishes_validity", `${entry.label} should not be treated as an endorsed reliability-validity error.`);
    }
    assertClaimBasedFindingsAreStructured(result);
  }

  const abbreviated = evaluateCandidateOutputPolicy(
    output(fixture, "Validity requires evidence for an interpretation."),
    fixture
  );
  assertHas(abbreviated, "measurement_validity_evidence_use_language_missing", "Abbreviated authoritative wording should receive a precision warning.");
  const abbreviatedFinding = abbreviated.quality_finding_details.find((entry) => entry.finding_code === "measurement_validity_evidence_use_language_missing");
  assert(abbreviatedFinding?.severity === "language_quality_warning", "Abbreviated wording must not be a substantive accuracy failure.");
  assert(abbreviatedFinding?.blocking === false, "Abbreviated wording must not block automatically.");
  assertClaimBasedFindingsAreStructured(abbreviated);

  const qualityFixture = fixtureById("formative_activity_quality_review");
  const qualityRelationship = evaluateCandidateOutputPolicy(
    output(qualityFixture, "The prompt correctly targets the flaw that reliability alone does not establish validity."),
    qualityFixture
  );
  assertNotHas(qualityRelationship, "measurement_validity_evidence_use_language_missing", "A quality-review relationship statement is not a validity definition.");
  assertNotHas(qualityRelationship, "reliability_alone_establishes_validity", "A quality review that rejects the false relation must not be treated as endorsement.");

  const evaluatorFixture = fixtureById("formative_activity_response_evaluation");
  const reportedAbbreviation = evaluateCandidateOutputPolicy(
    output(evaluatorFixture, "The response identifies validity as requiring evidence for an interpretation."),
    evaluatorFixture
  );
  assertNotHas(reportedAbbreviation, "measurement_validity_evidence_use_language_missing", "Faithfully reported student wording must not be treated as an authoritative definition.");
  assertNotHas(reportedAbbreviation, "measurement_validity_definition_too_simplistic", "Faithfully reported student wording must not be treated as a false system claim.");

  const incompleteAnalysis = evaluateCandidateOutputPolicy(
    output(fixture, "Reliability and validity."),
    fixture
  );
  const analysisWarning = incompleteAnalysis.quality_finding_details.find((entry) => entry.finding_code === "evaluator_claim_analysis_incomplete");
  assert(analysisWarning?.severity === "review_required", "Incomplete structured analysis should create a review warning.");
  assert(analysisWarning?.blocking === false, "Phrase-level fallback must not create a blocking claim failure.");
  assert(analysisWarning?.claim_details === null, "An evaluator-analysis warning must not fabricate a claim record.");
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
