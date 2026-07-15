import assert from "node:assert/strict";
import {
  buildEvidenceIntegratedProfileBundle,
  buildStudentCommunicationInputForEvidenceBundle,
  studentSafeProjectionFromEvidenceProfile,
  packageResultsForStudent
} from "../src/lib/services/student-assessment/evidence-integrated-profile";
import {
  buildDeterministicStudentCommunicationFallback,
  validateStudentCommunicationOutputFacts,
  validateStudentCommunicationLanguage
} from "../src/lib/services/student-assessment/student-communication-agent";

function fixturePackage(overrides?: {
  correctness?: Array<"correct" | "incorrect">;
  reasoning?: string[];
  confidence?: Array<"low" | "medium" | "high">;
  noTemptingOption?: boolean;
}) {
  const correctness = overrides?.correctness ?? ["correct", "correct", "correct"];
  const reasoning = overrides?.reasoning ?? [
    "Reliability is about consistency of scores, while validity is about the interpretation.",
    "A high reliability coefficient can help, but it does not by itself show the interpretation is valid.",
    "Reliability may be necessary for defensible interpretation, but validity needs more evidence."
  ];
  const confidence = overrides?.confidence ?? ["high", "medium", "medium"];
  const options = [
    { label: "A", text: "Reliability alone proves validity." },
    { label: "B", text: "Reliability is consistency, while validity concerns interpretation evidence." },
    { label: "C", text: "Validity only means the test has many items." },
    { label: "D", text: "Reliability and validity are unrelated." }
  ];

  return {
    package_type: "initial_concept_unit_response_package",
    response_package_public_id: "rp_student_communication_fixture",
    created_at: "2026-07-15T00:00:00.000Z",
    assessment_session: {
      session_public_id: "sess_student_communication_fixture"
    },
    assessment: {
      assessment_public_id: "assessment_mvp_irt_theta_invariance",
      title: "IRT Theta Invariance and Item Parameters",
      diagnostic_focus: "Reliability and validity distinctions"
    },
    concept_unit: {
      concept_unit_public_id: "cu_reliability_validity",
      title: "Reliability and validity",
      learning_objective:
        "Distinguish reliability as consistency from validity as interpretation evidence.",
      related_concept_description:
        "Reliability may be necessary but does not itself constitute validity evidence."
    },
    included_items: [1, 2, 3].map((position) => ({
      item_public_id: `item_reliability_validity_${position}`,
      initial_item_position: position,
      item_stem: `Question ${position} about reliability and validity.`,
      options
    })),
    item_responses: [1, 2, 3].map((position, index) => ({
      item_response_public_id: `ir_${position}`,
      item_public_id: `item_reliability_validity_${position}`,
      initial_item_position: position,
      selected_option: correctness[index] === "correct" ? "B" : "A",
      selected_answer_final: correctness[index] === "correct" ? "B" : "A",
      correct_option_snapshot: "B",
      correctness: correctness[index],
      reasoning_text: reasoning[index],
      reasoning_text_final: reasoning[index],
      confidence_rating: confidence[index],
      no_tempting_option: overrides?.noTemptingOption ?? true,
      tempting_option: overrides?.noTemptingOption === false ? "C" : null,
      tempting_option_reason:
        overrides?.noTemptingOption === false
          ? "It sounded like it might connect to validity but it overreached."
          : null,
      item_version_snapshot: 1,
      item_snapshot: { options },
      answer_explanation_revealed: true,
      revealed_at: "2026-07-15T00:01:00.000Z",
      reveal_trigger: "initial_package_completed",
      explanation_version: "initial-package-answer-explanation-v1",
      student_safe_answer_explanation:
        "Reliability describes consistency, while validity concerns evidence for score interpretation.",
      student_safe_distractor_boundary:
        "Reliability can support score use, but it does not prove validity by itself."
    }))
  };
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(strings);
  }
  return [];
}

const forbidden = /\b(selected_option|scored_outcome|tempting_option_unavailable|reasonably_calibrated|overconfident|underconfident|profile schema|evidence package|persisted|runtime|routing|diagnostic purpose|source reference|recorded for this version|future version|schema|fallback)\b/i;

function assertStudentVisibleTextIsClean(values: string[]) {
  for (const value of values) {
    assert.doesNotMatch(value, forbidden, `student-visible text leaked internal language: ${value}`);
  }
}

function main() {
  const fixedDate = new Date("2026-07-15T00:02:00.000Z");
  const payload = fixturePackage();
  const bundle = buildEvidenceIntegratedProfileBundle({
    response_package_payload: payload,
    generated_at: fixedDate
  });
  const communication = bundle.student_communication;

  assert.equal(communication.metadata.agent_name, "student_communication_agent");
  assert.equal(communication.metadata.fallback_used, true);
  assert.equal(communication.metadata.live_generation_approved, false);
  assert.equal(communication.fact_validation.valid, true);
  assert.equal(communication.language_validation.valid, true);
  assert.equal(communication.output.item_review_introductions.length, 3);
  assert.deepEqual(
    communication.output.item_review_introductions.map((item) => item.status_label),
    ["Correct", "Correct", "Correct"]
  );
  assert.ok(
    communication.output.package_feedback_narrative.includes(
      "Based on your responses, here is a recommended activity"
    ),
    "package narrative should transition naturally into the recommended activity"
  );
  assert.ok(
    communication.output.activity_prompt.includes("For Item 1"),
    "activity prompt should name the source item"
  );
  assert.ok(
    communication.output.activity_prompt.includes("option A"),
    "activity prompt should name the source option"
  );
  assert.ok(
    communication.output.activity_prompt.includes("Reliability alone proves validity."),
    "activity prompt should include enough option text for context"
  );
  assert.ok(
    /\b(write|explain|identify|name|rewrite|rank)\b/i.test(communication.output.activity_prompt),
    "activity prompt should tell the student exactly what to type"
  );

  const projection = studentSafeProjectionFromEvidenceProfile(
    bundle.profile,
    "2026-07-15T00:03:00.000Z"
  );
  const packageResults = packageResultsForStudent(bundle.profile);
  assertStudentVisibleTextIsClean([
    projection.explanation,
    projection.next_focus,
    projection.initial_results,
    projection.current_understanding.label,
    projection.reasoning.label,
    projection.confidence.label,
    bundle.feedback.result_summary,
    ...bundle.feedback.strengths,
    bundle.feedback.confidence_comment,
    bundle.next_interaction.prompt,
    bundle.student_communication.output.package_feedback_narrative,
    bundle.student_communication.output.post_activity_feedback,
    bundle.student_communication.output.ready_to_advance_message,
    bundle.student_communication.output.topic_dialogue_transition,
    ...strings(packageResults)
  ]);

  const frozenInput = buildStudentCommunicationInputForEvidenceBundle({
    profile: bundle.profile,
    feedback: bundle.feedback,
    next_interaction: bundle.next_interaction,
    response_package_payload: payload
  });
  const fallback = buildDeterministicStudentCommunicationFallback(frozenInput);
  assert.equal(validateStudentCommunicationLanguage(fallback).valid, true);

  const changedCorrectness = {
    ...fallback,
    item_review_introductions: fallback.item_review_introductions.map((item, index) =>
      index === 0 ? { ...item, status_label: "Incorrect" as const } : item
    )
  };
  assert.equal(
    validateStudentCommunicationOutputFacts({ frozen_input: frozenInput, output: changedCorrectness }).valid,
    false,
    "fact lock should reject changed item correctness"
  );

  const changedAnswer = {
    ...fallback,
    item_review_introductions: fallback.item_review_introductions.map((item, index) =>
      index === 0 ? { ...item, correct_answer_label: "Option A" } : item
    )
  };
  assert.equal(
    validateStudentCommunicationOutputFacts({ frozen_input: frozenInput, output: changedAnswer }).valid,
    false,
    "fact lock should reject changed correct answer"
  );

  const changedFocus = { ...fallback, package_feedback_narrative: "Study more." };
  assert.equal(
    validateStudentCommunicationOutputFacts({ frozen_input: frozenInput, output: changedFocus }).valid,
    false,
    "fact lock should reject changed growth target"
  );

  const missingActivitySource = {
    ...fallback,
    activity_prompt: "Explain why the tempting option is wrong."
  };
  assert.equal(
    validateStudentCommunicationOutputFacts({ frozen_input: frozenInput, output: missingActivitySource }).valid,
    false,
    "fact lock should reject missing item or option context"
  );

  const repeatBundle = buildEvidenceIntegratedProfileBundle({
    response_package_payload: payload,
    generated_at: fixedDate
  });
  assert.deepEqual(
    repeatBundle.student_communication.output,
    bundle.student_communication.output,
    "refresh/rebuild should reuse deterministic communication output for identical frozen facts"
  );

  console.log(JSON.stringify({
    status: "passed",
    smoke: "student-communication-agent",
    openai_calls: 0
  }, null, 2));
}

main();
