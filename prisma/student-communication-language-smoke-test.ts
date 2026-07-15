import assert from "node:assert/strict";
import {
  buildEvidenceIntegratedProfileBundle,
  packageResultsForStudent,
  studentSafeProjectionFromEvidenceProfile
} from "../src/lib/services/student-assessment/evidence-integrated-profile";

type Scenario = {
  name: string;
  correctness: Array<"correct" | "incorrect">;
  reasoning: string[];
  confidence: Array<"low" | "medium" | "high">;
  noTemptingOption?: boolean;
};

const options = [
  { label: "A", text: "Reliability alone proves validity." },
  { label: "B", text: "Reliability is consistency, while validity concerns interpretation evidence." },
  { label: "C", text: "Validity only means the test has many items." },
  { label: "D", text: "Reliability and validity are unrelated." }
];

function fixturePackage(scenario: Scenario) {
  return {
    package_type: "initial_concept_unit_response_package",
    response_package_public_id: `rp_${scenario.name}`,
    created_at: "2026-07-15T00:00:00.000Z",
    assessment_session: {
      session_public_id: `sess_${scenario.name}`
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
      item_public_id: `item_${scenario.name}_${position}`,
      initial_item_position: position,
      item_stem: `Question ${position} about reliability and validity.`,
      options
    })),
    item_responses: [1, 2, 3].map((position, index) => ({
      item_response_public_id: `ir_${scenario.name}_${position}`,
      item_public_id: `item_${scenario.name}_${position}`,
      initial_item_position: position,
      selected_option: scenario.correctness[index] === "correct" ? "B" : "A",
      selected_answer_final: scenario.correctness[index] === "correct" ? "B" : "A",
      correct_option_snapshot: "B",
      correctness: scenario.correctness[index],
      reasoning_text: scenario.reasoning[index],
      reasoning_text_final: scenario.reasoning[index],
      confidence_rating: scenario.confidence[index],
      no_tempting_option: scenario.noTemptingOption ?? true,
      tempting_option: scenario.noTemptingOption === false ? "A" : null,
      tempting_option_reason:
        scenario.noTemptingOption === false
          ? "It sounded plausible because it mentioned reliability, but it overstates what reliability proves."
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

const scenarios: Scenario[] = [
  {
    name: "all_correct_concise_reasoning",
    correctness: ["correct", "correct", "correct"],
    reasoning: [
      "Reliability is consistency and validity is interpretation evidence.",
      "Reliability helps but does not prove validity.",
      "Validity needs support for the interpretation."
    ],
    confidence: ["high", "medium", "medium"],
    noTemptingOption: true
  },
  {
    name: "incorrect_clear_misconception",
    correctness: ["incorrect", "incorrect", "incorrect"],
    reasoning: [
      "Reliability alone proves validity because consistent scores are valid.",
      "High reliability means validity is automatic.",
      "Validity is the same thing as reliability when scores are stable."
    ],
    confidence: ["high", "high", "medium"],
    noTemptingOption: false
  },
  {
    name: "partial_knowledge",
    correctness: ["correct", "incorrect", "correct"],
    reasoning: [
      "Reliability is consistency.",
      "I think the coefficient proves validity.",
      "Validity also needs evidence for the interpretation."
    ],
    confidence: ["medium", "medium", "low"],
    noTemptingOption: false
  },
  {
    name: "missing_reasoning",
    correctness: ["incorrect", "incorrect", "incorrect"],
    reasoning: ["idk", "not sure", "guess"],
    confidence: ["low", "low", "low"],
    noTemptingOption: true
  },
  {
    name: "mixed_confidence",
    correctness: ["correct", "correct", "incorrect"],
    reasoning: [
      "Reliability is consistency, validity is interpretation.",
      "A stable score is useful but not enough for validity.",
      "The coefficient means validity is established."
    ],
    confidence: ["low", "high", "high"],
    noTemptingOption: false
  },
  {
    name: "foundational_gap",
    correctness: ["incorrect", "incorrect", "incorrect"],
    reasoning: ["weather", "lunch", "movie"],
    confidence: ["low", "low", "low"],
    noTemptingOption: true
  }
];

const bannedStudentVisibleLanguage = /\b(selected_option|scored_outcome|tempting_option_unavailable|reasoning_unavailable|confidence_unavailable|reasonably_calibrated|overconfident|underconfident|calibration|ontology|profile schema|evidence package|persisted|runtime|routing|diagnostic purpose|source reference|recorded for this version|future version|structured output|agent call|system prompt|raw llm output|raw model output)\b/i;

function collectStudentVisibleStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStudentVisibleStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectStudentVisibleStrings);
  }
  return [];
}

function studentVisibleStringsForScenario(scenario: Scenario) {
  const bundle = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage(scenario),
    generated_at: new Date("2026-07-15T00:02:00.000Z")
  });
  const projection = studentSafeProjectionFromEvidenceProfile(
    bundle.profile,
    "2026-07-15T00:03:00.000Z"
  );
  const packageResults = packageResultsForStudent(bundle.profile);

  return {
    bundle,
    strings: [
      projection.status,
      projection.explanation,
      projection.next_focus,
      projection.initial_results,
      projection.current_understanding.label,
      projection.reasoning.label,
      projection.confidence.label,
      projection.evidence_limitation ?? "",
      bundle.feedback.result_summary,
      ...bundle.feedback.strengths,
      bundle.feedback.growth_target,
      bundle.feedback.cross_item_pattern,
      bundle.feedback.confidence_comment,
      bundle.feedback.evidence_limitation ?? "",
      bundle.next_interaction.prompt,
      bundle.next_interaction.expected_response_format,
      ...collectStudentVisibleStrings(packageResults),
      ...collectStudentVisibleStrings(bundle.student_communication.output)
    ]
  };
}

function main() {
  for (const scenario of scenarios) {
    const { bundle, strings } = studentVisibleStringsForScenario(scenario);
    for (const value of strings.filter(Boolean)) {
      assert.doesNotMatch(
        value,
        bannedStudentVisibleLanguage,
        `${scenario.name} leaked internal student-facing language: ${value}`
      );
    }

    if (bundle.next_interaction.distractor_refs.length > 0) {
      assert.match(
        bundle.next_interaction.prompt,
        /\bItem\s+\d+\b/i,
        `${scenario.name} activity prompt should include item context`
      );
      assert.match(
        bundle.next_interaction.prompt,
        /\boption\s+[A-D]\b/i,
        `${scenario.name} activity prompt should include option context`
      );
    }

    assert.equal(bundle.student_communication.fact_validation.valid, true);
    assert.equal(bundle.student_communication.language_validation.valid, true);
  }

  console.log(JSON.stringify({
    status: "passed",
    smoke: "student-communication-language",
    scenario_count: scenarios.length,
    openai_calls: 0
  }, null, 2));
}

main();
