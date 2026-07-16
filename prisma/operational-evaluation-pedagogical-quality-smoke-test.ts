import { loadEnvConfig } from "@next/env";
import {
  evaluateCandidateOutputPolicy,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput,
  type ModelUpgradeFixture
} from "../src/lib/operational/model-upgrade-evaluation";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

function fixtureById(id: string) {
  const fixture = modelUpgradeEvaluationFixtures().find((entry) => entry.fixture_id === id);
  assert(fixture, `Missing fixture ${id}.`);
  return fixture;
}

function output(fixture: ModelUpgradeFixture, text: string): CandidateEvaluationOutput {
  const teacher = fixture.teacher_facing_review_required;
  return {
    fixture_id: fixture.fixture_id,
    role: fixture.role,
    response_status: "answered",
    output_kind: teacher ? "teacher_tool" : "student_facing",
    response_summary: text,
    student_facing_text: teacher ? null : text,
    teacher_facing_text: teacher ? text : null,
    decision_summary: "Safe decision.",
    evidence_used: ["synthetic fixture"],
    safety_notes: [],
    next_action: null,
    confidence: "medium"
  };
}

function findingCodes(result: ReturnType<typeof evaluateCandidateOutputPolicy>) {
  return [...result.quality_findings, ...result.safety_findings];
}

function main() {
  const systemLike = evaluateCandidateOutputPolicy(
    output(
      fixtureById("item_administration_what"),
      "Please explain why you chose C for Item 2. I won’t give content help."
    ),
    fixtureById("item_administration_what")
  );
  assert(
    findingCodes(systemLike).includes("item_admin_system_like_content_help_disclaimer"),
    "System-like content-help disclaimer should be a quality warning."
  );

  const missingTask = evaluateCandidateOutputPolicy(
    output(
      fixtureById("item_administration_which_item_do_you_mean"),
      "I mean Item 2, the current item. Which part would you like me to clarify?"
    ),
    fixtureById("item_administration_which_item_do_you_mean")
  );
  assert(
    findingCodes(missingTask).includes("item_admin_current_task_not_stated"),
    "Item clarification should state the current reasoning task."
  );

  const deterministicStateIgnored = evaluateCandidateOutputPolicy(
    output(
      fixtureById("followup_assessment_system_question"),
      "I can’t see how many questions are left from the available information."
    ),
    fixtureById("followup_assessment_system_question")
  );
  assert(
    findingCodes(deterministicStateIgnored).includes("assessment_system_question_ignored_deterministic_state"),
    "Assessment-system question should use supplied deterministic state facts."
  );

  const simplisticValidity = evaluateCandidateOutputPolicy(
    output(
      fixtureById("formative_value_determination_conceptual_need"),
      "Validity is whether a measure assesses what it is intended to assess."
    ),
    fixtureById("formative_value_determination_conceptual_need")
  );
  assert(
    findingCodes(simplisticValidity).includes("measurement_validity_definition_too_simplistic"),
    "Simplistic validity definition should be blocked."
  );

  const qualifiedValidity = evaluateCandidateOutputPolicy(
    output(
      fixtureById("formative_value_determination_conceptual_need"),
      "Validity concerns evidence supporting intended interpretations and uses of scores."
    ),
    fixtureById("formative_value_determination_conceptual_need")
  );
  assert(
    !findingCodes(qualifiedValidity).includes("measurement_validity_definition_too_simplistic"),
    "Course-appropriate validity wording should pass."
  );

  const relationshipClaim = evaluateCandidateOutputPolicy(
    output(
      fixtureById("formative_activity_quality_review"),
      "Reliability is necessary for, but does not by itself establish, validity."
    ),
    fixtureById("formative_activity_quality_review")
  );
  assert(
    !findingCodes(relationshipClaim).includes("measurement_validity_evidence_use_language_missing"),
    "A relationship claim should not be evaluated as an attempted validity definition."
  );

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    system_like_item_admin_warning: true,
    deterministic_state_failure_detected: true,
    validity_accuracy_control_passed: true,
    reliability_relationship_classification_passed: true
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
