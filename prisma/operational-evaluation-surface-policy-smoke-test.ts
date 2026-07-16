import { loadEnvConfig } from "@next/env";
import {
  evaluateCandidateOutputPolicy,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput
} from "../src/lib/operational/model-upgrade-evaluation";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

function output(input: Partial<CandidateEvaluationOutput>): CandidateEvaluationOutput {
  return {
    fixture_id: input.fixture_id ?? "surface_policy_fixture",
    role: input.role ?? "student_communication_agent",
    response_status: input.response_status ?? "answered",
    output_kind: input.output_kind ?? "student_facing",
    response_summary: input.response_summary ?? "Safe summary.",
    student_facing_text: input.student_facing_text ?? null,
    teacher_facing_text: input.teacher_facing_text ?? null,
    decision_summary: input.decision_summary ?? "Safe decision.",
    evidence_used: input.evidence_used ?? ["synthetic fixture"],
    safety_notes: input.safety_notes ?? [],
    next_action: input.next_action ?? null,
    confidence: input.confidence ?? "medium"
  };
}

function main() {
  const fixtures = modelUpgradeEvaluationFixtures();
  const teacherFixture = fixtures.find((entry) => entry.fixture_id === "teacher_mcq_import_formatting");
  const studentFixture = fixtures.find((entry) => entry.fixture_id === "item_administration_what");
  const utilityFixture = fixtures.find((entry) => entry.fixture_id === "connectivity_metadata_check");
  assert(teacherFixture, "Teacher fixture missing.");
  assert(studentFixture, "Student fixture missing.");
  assert(utilityFixture, "Utility fixture missing.");

  const teacherAnswerKey = evaluateCandidateOutputPolicy(output({
    fixture_id: teacherFixture.fixture_id,
    role: teacherFixture.role,
    output_kind: "teacher_tool",
    teacher_facing_text: "Preserve the supplied Answer: C for teacher confirmation."
  }), teacherFixture);
  assert(teacherAnswerKey.answer_key_leakage_findings.length === 0, "Teacher-supplied answer key text should not be student leakage.");

  const internalSafetyNote = evaluateCandidateOutputPolicy(output({
    fixture_id: studentFixture.fixture_id,
    role: studentFixture.role,
    output_kind: "student_facing",
    student_facing_text: "Please explain why you chose your answer for Item 2.",
    safety_notes: ["No answer key should be rendered to the student."]
  }), studentFixture);
  assert(internalSafetyNote.answer_key_leakage_findings.length === 0, "Safety notes should not be evaluated as rendered student text.");

  const studentLeak = evaluateCandidateOutputPolicy(output({
    fixture_id: studentFixture.fixture_id,
    role: studentFixture.role,
    output_kind: "student_facing",
    student_facing_text: "The correct answer is C."
  }), studentFixture);
  assert(studentLeak.answer_key_leakage_findings.length === 1, "Student unrevealed correctness text should be blocked.");
  assert(studentLeak.safety_finding_details[0]?.evaluated_surface === "student_facing", "Student finding should record surface.");
  assert(studentLeak.safety_finding_details[0]?.evaluated_field === "student_facing_text", "Student finding should record field.");

  const utilityMetadata = evaluateCandidateOutputPolicy(output({
    fixture_id: utilityFixture.fixture_id,
    role: utilityFixture.role,
    output_kind: "utility",
    response_summary: "Metadata-only connectivity acknowledgement; solution route unavailable."
  }), utilityFixture);
  assert(utilityMetadata.safety_findings.length === 0, "Utility metadata should not be treated as student-facing leakage.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    teacher_answer_key_allowed: true,
    safety_notes_not_student_content: true,
    utility_metadata_not_student_content: true
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
