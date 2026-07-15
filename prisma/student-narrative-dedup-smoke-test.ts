import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEvidenceIntegratedProfileBundle
} from "../src/lib/services/student-assessment/evidence-integrated-profile";

const componentSource = readFileSync(
  "src/components/student-assessment/assessment-session-client.tsx",
  "utf8"
);

function fixturePackage() {
  const options = [
    { label: "A", text: "Reliability alone proves validity." },
    { label: "B", text: "Reliability is consistency, while validity concerns interpretation evidence." },
    { label: "C", text: "Validity only means the test has many items." },
    { label: "D", text: "Reliability and validity are unrelated." }
  ];

  return {
    package_type: "initial_concept_unit_response_package",
    response_package_public_id: "rp_student_narrative_dedup",
    assessment_session: { session_public_id: "sess_student_narrative_dedup" },
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
      item_public_id: `item_dedup_${position}`,
      initial_item_position: position,
      item_stem: `Question ${position}.`,
      options
    })),
    item_responses: [1, 2, 3].map((position) => ({
      item_response_public_id: `ir_dedup_${position}`,
      item_public_id: `item_dedup_${position}`,
      initial_item_position: position,
      selected_option: "B",
      selected_answer_final: "B",
      correct_option_snapshot: "B",
      correctness: "correct",
      reasoning_text: "Reliability is consistency and validity is interpretation evidence.",
      reasoning_text_final: "Reliability is consistency and validity is interpretation evidence.",
      confidence_rating: "high",
      no_tempting_option: true,
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

const bundle = buildEvidenceIntegratedProfileBundle({
  response_package_payload: fixturePackage(),
  generated_at: new Date("2026-07-15T00:00:00.000Z")
});

assert.equal(
  bundle.feedback.result_summary,
  bundle.student_communication.output.package_feedback_narrative,
  "chat package feedback should use the communication narrative"
);
assert(
  bundle.feedback.strengths.length >= 1,
  "stored package feedback should retain schema-valid internal evidence fields"
);
assert(
  !bundle.feedback.result_summary.includes(bundle.feedback.strengths.join("\n\n")),
  "chat package feedback should not be assembled by joining structured profile fields"
);
assert.match(
  bundle.student_communication.output.package_feedback_narrative,
  /Based on your responses, here is a recommended activity/i,
  "narrative should introduce the actual activity naturally"
);

for (const phrase of [
  "What your responses show",
  "Your explanations",
  "How sure you were",
  "What to keep in mind",
  "Next focus"
]) {
  assert(
    !componentSource.includes(`<p className="text-xs font-semibold uppercase tracking-wide text-muted">${phrase}</p>`),
    `sidebar should not render duplicated profile heading: ${phrase}`
  );
}

assert(
  componentSource.includes("data-testid=\"initial-answer-review-list\""),
  "sidebar should retain answer reviews"
);
assert(
  componentSource.includes("Total correct"),
  "sidebar should retain compact initial-results summary"
);

console.log(JSON.stringify({
  status: "passed",
  smoke: "student-narrative-dedup",
  openai_calls: 0
}, null, 2));
