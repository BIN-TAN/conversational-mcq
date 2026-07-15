import assert from "node:assert/strict";
import {
  buildEvidenceIntegratedProfileBundle
} from "../src/lib/services/student-assessment/evidence-integrated-profile";

const options = [
  { label: "A", text: "Reliability alone proves validity." },
  { label: "B", text: "Reliability is consistency, while validity concerns interpretation evidence." },
  { label: "C", text: "Validity only means the test has many items." },
  { label: "D", text: "Reliability and validity are unrelated." }
];

function fixturePackage(name: string, correctness: Array<"correct" | "incorrect">) {
  return {
    package_type: "initial_concept_unit_response_package",
    response_package_public_id: `rp_${name}`,
    assessment_session: { session_public_id: `sess_${name}` },
    assessment: {
      assessment_public_id: "assessment_mvp_irt_theta_invariance",
      title: "IRT Theta Invariance and Item Parameters"
    },
    concept_unit: {
      concept_unit_public_id: "cu_reliability_validity",
      title: "Reliability and validity",
      learning_objective: "Distinguish reliability as consistency from validity as interpretation evidence."
    },
    included_items: [1, 2, 3].map((position) => ({
      item_public_id: `item_${name}_${position}`,
      initial_item_position: position,
      item_stem: `Question ${position}.`,
      options
    })),
    item_responses: [1, 2, 3].map((position, index) => ({
      item_response_public_id: `ir_${name}_${position}`,
      item_public_id: `item_${name}_${position}`,
      initial_item_position: position,
      selected_option: correctness[index] === "correct" ? "B" : "A",
      selected_answer_final: correctness[index] === "correct" ? "B" : "A",
      correct_option_snapshot: "B",
      correctness: correctness[index],
      reasoning_text:
        correctness[index] === "correct"
          ? "Reliability is consistency and validity is interpretation evidence."
          : "A reliable score proves that the interpretation is valid.",
      reasoning_text_final:
        correctness[index] === "correct"
          ? "Reliability is consistency and validity is interpretation evidence."
          : "A reliable score proves that the interpretation is valid.",
      confidence_rating: correctness[index] === "correct" ? "medium" : "high",
      no_tempting_option: correctness[index] === "correct",
      tempting_option: correctness[index] === "correct" ? null : "B",
      tempting_option_reason: correctness[index] === "correct" ? null : "It mentioned validity evidence.",
      item_version_snapshot: 1,
      item_snapshot: { options },
      answer_explanation_revealed: true,
      student_safe_answer_explanation:
        "Reliability describes consistency, while validity concerns evidence for score interpretation.",
      student_safe_distractor_boundary:
        "Reliability can support score use, but it does not prove validity by itself."
    }))
  };
}

const banned = /\b(Overall pattern|Your explanations|How sure you were|What to keep in mind|Next focus|Confidence calibration|Reasoning quality|selected_option|scored_outcome|reasonably_calibrated|overconfident|underconfident|profile schema|evidence package|runtime|routing|diagnostic purpose|fallback|schema)\b/i;

for (const scenario of [
  { name: "all_correct", correctness: ["correct", "correct", "correct"] as const },
  { name: "mixed", correctness: ["correct", "incorrect", "correct"] as const }
]) {
  const bundle = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage(scenario.name, [...scenario.correctness]),
    generated_at: new Date("2026-07-15T00:00:00.000Z")
  });
  const output = bundle.student_communication.output;
  const paragraphs = output.package_feedback_narrative.split(/\n\s*\n/).filter(Boolean);

  assert(paragraphs.length <= 2, `${scenario.name}: narrative should be one or two paragraphs.`);
  assert.doesNotMatch(output.package_feedback_narrative, banned, `${scenario.name}: narrative leaked internal wording.`);
  assert.doesNotMatch(output.activity_transition, banned, `${scenario.name}: transition leaked internal wording.`);
  assert.doesNotMatch(output.activity_prompt, banned, `${scenario.name}: activity prompt leaked internal wording.`);
  assert.match(
    output.package_feedback_narrative,
    /Based on your responses, here is a recommended activity/i,
    `${scenario.name}: narrative should use the approved activity transition.`
  );
  assert.equal(bundle.student_communication.fact_validation.valid, true);
  assert.equal(bundle.student_communication.language_validation.valid, true);
}

console.log(JSON.stringify({
  status: "passed",
  smoke: "student-narrative-language",
  openai_calls: 0
}, null, 2));
