import assert from "node:assert/strict";
import {
  buildEvidenceIntegratedProfileBundle,
  packageResultsForStudent,
  validateEvidenceProfileCoherence,
  validatePackageFeedbackSpecificity,
  validateSingleActionState
} from "../src/lib/services/student-assessment/evidence-integrated-profile";

function fixturePackage(overrides?: {
  correctness?: Array<"correct" | "incorrect">;
  reasoning?: string[];
  confidence?: Array<"low" | "medium" | "high">;
  noTemptingOption?: boolean;
  administrationRules?: Record<string, unknown>;
}) {
  const correctness = overrides?.correctness ?? ["correct", "correct", "correct"];
  const reasoning = overrides?.reasoning ?? [
    "Reliability is about consistency of scores, while validity is about the interpretation.",
    "A high reliability coefficient can help, but it does not by itself show the interpretation is valid.",
    "Reliability is a foundation for defensible interpretation, but validity needs more evidence."
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
    created_at: "2026-07-15T00:00:00.000Z",
    assessment_session: {
      session_public_id: "sess_incident_profile_routing"
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
        "Reliability may be necessary but does not itself constitute validity evidence.",
      administration_rules: overrides?.administrationRules ?? {}
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
      item_snapshot: {
        options
      },
      answer_explanation_revealed: true,
      revealed_at: "2026-07-15T00:01:00.000Z",
      reveal_trigger: "initial_package_completed",
      explanation_version: "initial-package-answer-explanation-v1",
      student_safe_answer_explanation:
        "Reliability describes consistency, while validity concerns evidence for score interpretation."
    }))
  };
}

function assertIncidentPattern() {
  const bundle = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage()
  });

  assert.equal(bundle.profile.outcome_summary.items_correct, 3);
  assert.equal(bundle.profile.outcome_summary.items_administered, 3);
  assert.equal(
    bundle.profile.assessment_specific_understanding.value,
    "sound_understanding"
  );
  assert.notEqual(
    bundle.profile.assessment_specific_understanding.value,
    "partial_understanding"
  );
  assert.equal(bundle.profile.reasoning_quality.value, "accurate_but_concise");
  assert.equal(bundle.profile.confidence_calibration.value, "reasonably_calibrated");
  assert.ok(
    bundle.profile.evidence_limitations.some((entry) => entry.code === "limited_elaboration")
  );
  assert.ok(
    bundle.profile.evidence_limitations.some((entry) => entry.code === "transfer_not_yet_observed")
  );
  assert.ok(
    bundle.profile.item_evidence.every((item) => !item.possible_misconception.present),
    "incident fixture should not assert a misconception"
  );
  assert.equal(bundle.profile.item_evidence.length, 3);
  assert.ok(
    bundle.feedback.evidence_references.length >= 3,
    "feedback should cite all administered item evidence"
  );
  assert.equal(bundle.next_interaction.interaction_type, "distractor_focused_activity");
  assert.equal(bundle.next_interaction.activity_type, "identify_specific_flaw");
  assert.equal(bundle.next_interaction.cognitive_level, "evaluating");
  assert.equal(bundle.next_interaction.next_runtime_state, "AWAIT_FORMATIVE_ACTIVITY_RESPONSE");
  assert.equal((bundle.next_interaction.prompt.match(/\?/g) ?? []).length, 0);
  assert.ok(!/Quick check|Prepare learning activity/i.test(JSON.stringify(bundle)));
  assert.equal(bundle.validators.profile_coherence.valid, true);
  assert.equal(bundle.validators.feedback_specificity.valid, true);
  assert.equal(bundle.validators.single_action_state.valid, true);
  assert.equal(bundle.validators.activity_routing_coherence.valid, true);
}

function assertRoutingVariants() {
  const strong = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      reasoning: [
        "Reliability means consistent scores across comparable conditions, while validity depends on whether evidence supports the intended score interpretation for the actual use being made.",
        "A high reliability coefficient is useful because unstable scores are hard to interpret, but validity still requires evidence for the specific inference, population, and decision context.",
        "Reliability may be necessary for defensible interpretations, but it is not itself validity evidence because validity concerns whether the score interpretation and use are supported."
      ]
    })
  });
  assert.equal(
    strong.profile.assessment_specific_understanding.value,
    "strong_well_supported_understanding"
  );
  assert.equal(strong.next_interaction.interaction_type, "distractor_focused_activity");
  assert.equal(strong.next_interaction.activity_type, "rank_distractors");

  const contradictory = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      reasoning: [
        "Reliability is validity because both mean the score is good.",
        "Reliability equals validity when the coefficient is high.",
        "Reliability proves validity because consistency is the same thing."
      ]
    })
  });
  assert.equal(contradictory.profile.reasoning_quality.value, "internally_inconsistent");
  assert.equal(
    contradictory.profile.assessment_specific_understanding.value,
    "partial_understanding"
  );
  assert.ok(
    contradictory.profile.evidence_limitations.some(
      (entry) => entry.code === "contradictory_responses"
    )
  );

  const incorrect = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      correctness: ["incorrect", "incorrect", "incorrect"],
      reasoning: [
        "Reliability alone proves validity.",
        "If reliability is high then validity is automatically high.",
        "Consistency is all validity needs."
      ],
      confidence: ["high", "high", "medium"]
    })
  });
  assert.equal(
    incorrect.profile.assessment_specific_understanding.value,
    "specific_misconception"
  );
  assert.equal(incorrect.next_interaction.activity_type, "distractor_temptation_analysis");
  assert.match(
    incorrect.next_interaction.prompt,
    /You now know option B is correct/i,
    "Post-reveal misconception work should acknowledge the known correct answer."
  );
  assert.doesNotMatch(
    incorrect.next_interaction.prompt,
    /which option is correct|discover which option|find the correct/i,
    "Post-reveal activity must not ask the student to rediscover the correct answer."
  );

  const partial = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      correctness: ["correct", "incorrect", "correct"],
      reasoning: [
        "Reliability is consistency.",
        "I am not sure how the coefficient connects here.",
        "Validity needs evidence for the interpretation, not only consistency."
      ],
      confidence: ["medium", "medium", "medium"]
    })
  });
  assert.equal(
    partial.profile.assessment_specific_understanding.value,
    "partial_understanding"
  );
  assert.equal(partial.next_interaction.interaction_type, "scaffolded_distractor_activity");
  assert.equal(partial.next_interaction.activity_type, "correct_incorrect_parts");

  const lowInfo = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      correctness: ["incorrect", "incorrect", "incorrect"],
      reasoning: ["idk", "not sure", "guess"],
      confidence: ["low", "low", "low"]
    })
  });
  assert.equal(
    lowInfo.next_interaction.interaction_type,
    "foundational_support_activity"
  );

  const offConstruct = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      correctness: ["incorrect", "incorrect", "incorrect"],
      reasoning: ["weather", "lunch", "movie"],
      confidence: ["low", "low", "low"]
    })
  });
  assert.equal(offConstruct.next_interaction.interaction_type, "diagnostic_clarification");
  assert.ok(
    offConstruct.profile.evidence_limitations.some(
      (entry) => entry.code === "construct_identification_unclear"
    )
  );
}

function assertAnswerReveal() {
  const defaultResults = packageResultsForStudent(buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage()
  }).profile);
  assert.equal(defaultResults.full_answer_revealed, true);
  assert.ok(defaultResults.items.every((item) => item.revealed_answer === "B"));
  assert.ok(defaultResults.items.every((item) => item.student_answer));
  assert.ok(defaultResults.items.every((item) => item.answer_explanation_revealed));
  assert.ok(defaultResults.items.every((item) => item.answer_explanation && item.answer_explanation.length > 20));
  assert.ok(
    defaultResults.items.every((item) =>
      !/This option is correct because it is the correct answer\./i.test(item.answer_explanation ?? "")
    ),
    "Answer explanations must not use generic correct-answer wording."
  );

  const hidden = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage(),
    answer_reveal_policy: "after_formative_activity"
  });
  const hiddenResults = packageResultsForStudent(hidden.profile);
  assert.equal(hiddenResults.result_summary, "Initial item results: 3 of 3 correct");
  assert.equal(hiddenResults.full_answer_revealed, false);
  assert.ok(hiddenResults.items.every((item) => item.status_label === "Correct"));
  assert.ok(hiddenResults.items.every((item) => item.revealed_answer === null));
  assert.ok(hiddenResults.items.every((item) => item.answer_explanation === null));

  const revealed = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage(),
    answer_reveal_policy: "after_package"
  });
  const revealedResults = packageResultsForStudent(revealed.profile);
  assert.equal(revealedResults.full_answer_revealed, true);
  assert.ok(revealedResults.items.every((item) => item.revealed_answer === "B"));

  const configured = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      administrationRules: {
        answer_reveal_policy: "after_package",
        correctness_status_reveal_policy: "after_package"
      }
    })
  });
  assert.equal(
    configured.profile.outcome_summary.restricted_answer_reveal_state.answer_reveal_policy,
    "after_package"
  );
  assert.ok(packageResultsForStudent(configured.profile).items.every((item) => item.revealed_answer === "B"));
}

function assertNeutralEvidenceAndSafety() {
  const bundle = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      confidence: ["high", "medium", "medium"],
      noTemptingOption: true
    })
  });
  assert.equal(bundle.profile.confidence_calibration.value, "reasonably_calibrated");
  assert.equal(bundle.profile.assessment_specific_understanding.value, "sound_understanding");
  assert.ok(
    bundle.profile.evidence_limitations.every(
      (entry) => entry.code !== "no_tempting_option_reported"
    ),
    "no tempting option should not become a negative understanding limitation"
  );
  assert.ok(!/low effort|misconduct|cheat|dishonest/i.test(JSON.stringify(bundle.profile)));

  const withTempting = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage({
      noTemptingOption: false
    })
  });
  assert.ok(
    withTempting.profile.item_evidence.some(
      (item) => item.tempting_option === "C" && item.tempting_option_reason
    )
  );
  assert.ok(
    withTempting.feedback.evidence_references.every((ref) =>
      ref.evidence_types.includes("tempting option evidence")
    )
  );
}

function assertValidatorsRejectBrokenArtifacts() {
  const bundle = buildEvidenceIntegratedProfileBundle({
    response_package_payload: fixturePackage()
  });
  const brokenFeedback = {
    ...bundle.feedback,
    evidence_references: [],
    growth_target: "add more detail"
  };
  const feedbackValidation = validatePackageFeedbackSpecificity({
    feedback: brokenFeedback,
    profile: bundle.profile
  });
  assert.equal(feedbackValidation.valid, false);

  const brokenSingleAction = validateSingleActionState({
    feedback: {
      ...bundle.feedback,
      result_summary: `${bundle.feedback.result_summary} Quick check?`
    },
    next_interaction: bundle.next_interaction
  });
  assert.equal(brokenSingleAction.valid, false);

  const profileValidation = validateEvidenceProfileCoherence(bundle.profile);
  assert.equal(profileValidation.valid, true);
}

function main() {
  assertIncidentPattern();
  assertRoutingVariants();
  assertAnswerReveal();
  assertNeutralEvidenceAndSafety();
  assertValidatorsRejectBrokenArtifacts();
  console.log(JSON.stringify({
    status: "passed",
    smoke: "student-evidence-integrated-profile",
    openai_calls: 0
  }, null, 2));
}

main();
