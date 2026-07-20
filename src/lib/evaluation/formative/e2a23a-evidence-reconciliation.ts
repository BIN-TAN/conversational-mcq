import {
  createTopicDialogueTurnEvidenceProfile,
  integrateTopicDialogueEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  assertTargetEvidenceObservationConsistent,
  mapTargetEvidenceAdjudicationToObservation,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
  TargetEvidenceAdjudicationSchema,
  TargetEvidenceContractSchema,
  TARGET_EVIDENCE_CONTRACT_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
  type TargetEvidenceAdjudication,
  type TargetEvidenceContract
} from "@/lib/services/student-assessment/target-evidence-contract";

export const E2A23A_VERSION =
  "e2a23a-production-evidence-profile-reconciliation-v1" as const;
export const E2A23A_ITEM16_CONTRACT_ID =
  "e2a23a-item16-theta-information-target-evidence-v1" as const;

type PatternCriterion = {
  id: string;
  kind:
    | "conceptual_relationship"
    | "required_mechanism"
    | "anchor_application"
    | "coherent_conclusion"
    | "optional_deepening";
  description: string;
  essential: boolean;
  patterns: string[];
};

type ContractFixture = {
  contract: TargetEvidenceContract;
  messages: {
    generic: string;
    vocabulary: string;
    misconception: string;
    relationshipOnly: string;
    mechanismOnly: string;
    anchorOnly: string;
    relationshipMechanismNoAnchor: string;
    relationshipAnchorNoMechanism: string;
    mechanismAnchorNoRelationship: string;
    sound: string;
    soundParaphrase: string;
    soundOptionalMissing: string;
    laterContradiction: string;
  };
};

function criterion(input: PatternCriterion) {
  return {
    criterion_id: input.id,
    criterion_kind: input.kind,
    description: input.description,
    essential_for_revision: input.essential,
    acceptable_evidence_patterns: input.patterns
  };
}

export function item16TargetEvidenceContract(): TargetEvidenceContract {
  return TargetEvidenceContractSchema.parse({
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION,
    concept_id: "theta_information",
    item_id: "item_16",
    distractor_option: "A",
    distractor_claim:
      "An extremely difficult item provides high information at every theta.",
    target_conceptual_relationships: [
      "Item information is localized around the item's difficulty.",
      "Information decreases as theta moves farther from item difficulty."
    ],
    required_mechanisms: [
      "Responses near the information peak are less predictable or change more sharply, which helps distinguish nearby theta levels."
    ],
    acceptable_equivalent_explanations: [
      "Information peaks near the theta-difficulty match.",
      "Far from the difficulty, responses are more predictable and less informative.",
      "The response probability changes most sharply near the matching theta."
    ],
    required_anchor_application:
      "Reject Item 16 option A's claim that extreme difficulty makes information high at every theta.",
    prohibited_contradictions: [
      "Extreme difficulty makes information high at every theta.",
      "Option A is correct because difficulty alone shows ability everywhere."
    ],
    revision_ready_criteria: [
      "localized_information_relationship",
      "distance_decline_relationship",
      "predictability_or_probability_mechanism",
      "item_16_option_a_application",
      "coherent_rejection_conclusion"
    ],
    optional_deepening_criteria: ["formal_information_equation"],
    evidence_limitations: [
      "Deterministic replay patterns are Item-16-specific analytic fixtures and are not the generic production evaluator."
    ],
    criteria: [
      criterion({
        id: "localized_information_relationship",
        kind: "conceptual_relationship",
        description: "Information is highest or localized near item difficulty.",
        essential: true,
        patterns: [
          "(?:most|highest)\\s+(?:item\\s+)?information.*(?:near|close).*difficult",
          "most informative.*theta.*close.*difficulty",
          "near item 16['’]s difficulty.*more information",
          "(?:near|close).*theta.*difficult.*(?:more information|most informative|information|distinguish)",
          "(?:difficulty|difficult item).*highest information.*(?:near|correspondingly high).*theta",
          "theta.*(?:near|close).*difficulty.*(?:information|distinguish)"
        ]
      }),
      criterion({
        id: "distance_decline_relationship",
        kind: "conceptual_relationship",
        description: "Information declines as theta moves away from difficulty.",
        essential: true,
        patterns: [
          "far (?:above|below|from).*?(?:less information|less informative|do not distinguish|does not distinguish)",
          "far below it.*get less",
          "responses? (?:becomes?|are) more predictable.*less information",
          "not equally informative at every theta",
          "does not give high information everywhere"
        ]
      }),
      criterion({
        id: "predictability_or_probability_mechanism",
        kind: "required_mechanism",
        description: "Predictability or response-probability change explains information.",
        essential: true,
        patterns: [
          "(?:less|more) predictable.*(?:information|informative)",
          "predictable.*(?:less information|distinguish)",
          "chance.*correct.*changes?.*(?:information|distinguish)",
          "probability.*changes?.*(?:information|distinguish)",
          "distinguish.*nearby ability"
        ]
      }),
      criterion({
        id: "item_16_option_a_application",
        kind: "anchor_application",
        description: "The explanation directly applies to Item 16 option A.",
        essential: true,
        patterns: [
          "item 16.*option a",
          "option a.*item 16",
          "option a (?:is|isn['’]?t|is not|was|claims?).*(?:wrong|false|right|not|every theta)",
          "as option a claims",
          "which is why option a is wrong"
        ]
      }),
      criterion({
        id: "coherent_rejection_conclusion",
        kind: "coherent_conclusion",
        description: "The response coherently rejects the distractor boundary.",
        essential: true,
        patterns: [
          "option a.*(?:wrong|false|isn['’]?t right|is not right)",
          "(?:wrong|false).*option a",
          "not equally informative at every theta",
          "does not give high information everywhere"
        ]
      }),
      criterion({
        id: "formal_information_equation",
        kind: "optional_deepening",
        description: "The response may optionally state a formal information equation.",
        essential: false,
        patterns: ["i\\(theta\\)", "fisher information"]
      })
    ],
    contradiction_criteria: [{
      contradiction_id: "extreme_difficulty_high_information_everywhere",
      description:
        "The response retains the claim that extreme difficulty makes information high everywhere.",
      observable_patterns: [
        "option a is right",
        "(?<!not )equally informative at every theta",
        "(?<!not )high information at every theta",
        "(?<!not )information high everywhere"
      ]
    }]
  });
}

function sentenceSpans(message: string, patterns: RegExp[], label: string) {
  return message.split(/(?<=[.!?])\s+/u)
    .map((span) => span.trim())
    .filter((span) => span.length > 0 && patterns.some((pattern) =>
      pattern.test(span)
    ))
    .map((span) => ({ label, span }));
}

function regexes(patterns: string[]) {
  return patterns.map((pattern) => new RegExp(pattern, "iu"));
}

export function deterministicallyAdjudicateTargetEvidence(input: {
  message: string;
  contract: TargetEvidenceContract;
}): TargetEvidenceAdjudication {
  const criterionResults = input.contract.criteria.map((entry) => {
    const patterns = regexes(entry.acceptable_evidence_patterns);
    const spans = sentenceSpans(
      input.message,
      patterns,
      entry.criterion_id
    );
    return {
      criterion_id: entry.criterion_id,
      satisfied: spans.length > 0,
      exact_evidence_spans: spans,
      confidence: spans.length > 0 ? "high" as const : "medium" as const
    };
  });
  const contradictionResults = input.contract.contradiction_criteria.map(
    (entry) => {
      const spans = sentenceSpans(
        input.message,
        regexes(entry.observable_patterns),
        entry.contradiction_id
      );
      return {
        contradiction_id: entry.contradiction_id,
        present: spans.length > 0,
        exact_evidence_spans: spans
      };
    }
  );
  const essential = input.contract.criteria.filter((entry) =>
    entry.essential_for_revision
  );
  const satisfiedIds = new Set(criterionResults
    .filter((entry) => entry.satisfied)
    .map((entry) => entry.criterion_id));
  const allEssential = essential.every((entry) =>
    satisfiedIds.has(entry.criterion_id)
  );
  const anySatisfied = satisfiedIds.size > 0;
  const coherentConclusion = input.contract.criteria
    .filter((entry) => entry.criterion_kind === "coherent_conclusion")
    .every((entry) => satisfiedIds.has(entry.criterion_id));
  return TargetEvidenceAdjudicationSchema.parse({
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
    target_evidence_contract_version: input.contract.contract_version,
    criterion_results: criterionResults,
    contradiction_results: contradictionResults,
    evidence_quality: allEssential
      ? "high"
      : anySatisfied ? "medium" : "insufficient",
    coherent_conclusion: coherentConclusion,
    limitations: [
      "no_live_deterministic_contract_adjudication",
      "exact_patterns_support_replay_only"
    ]
  });
}

export function reconcileMessageToProfile(input: {
  message: string;
  contract: TargetEvidenceContract;
  sourceStudentTurnId: string;
  sourceSequenceIndex: number;
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  createdAt: string;
}) {
  const adjudication = deterministicallyAdjudicateTargetEvidence({
    message: input.message,
    contract: input.contract
  });
  const observation = mapTargetEvidenceAdjudicationToObservation({
    contract: input.contract,
    adjudication,
    interaction_intent: "ordinary_conceptual_response"
  });
  const consistency = assertTargetEvidenceObservationConsistent({
    contract: input.contract,
    adjudication,
    observation
  });
  const profile = createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: input.sourceStudentTurnId,
    source_sequence_index: input.sourceSequenceIndex,
    concept_id: input.contract.concept_id,
    distractor_anchor:
      `${input.contract.item_id} option ${input.contract.distractor_option}`,
    observation,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
    created_at: input.createdAt
  });
  const cumulative = integrateTopicDialogueEvidenceProfile({
    prior: input.prior,
    current: profile
  });
  const route = selectEvidenceFirstTopicDialogueRoute({ profile, cumulative });
  return {
    contract_version: input.contract.contract_version,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
    adjudication,
    observation,
    consistency,
    profile,
    cumulative,
    route
  };
}

function genericContract(input: {
  conceptId: string;
  itemId: string;
  option: string;
  claim: string;
  relationship: string;
  mechanism: string;
  application: string;
  conclusion: string;
  contradiction: string;
}): TargetEvidenceContract {
  return TargetEvidenceContractSchema.parse({
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION,
    concept_id: input.conceptId,
    item_id: input.itemId,
    distractor_option: input.option,
    distractor_claim: input.claim,
    target_conceptual_relationships: [input.relationship],
    required_mechanisms: [input.mechanism],
    acceptable_equivalent_explanations: [
      input.relationship,
      input.mechanism
    ],
    required_anchor_application: input.application,
    prohibited_contradictions: [input.contradiction],
    revision_ready_criteria: [
      "relationship",
      "mechanism",
      "anchor",
      "conclusion"
    ],
    optional_deepening_criteria: ["optional_detail"],
    evidence_limitations: ["synthetic_calibration_contract"],
    criteria: [
      criterion({ id: "relationship", kind: "conceptual_relationship",
        description: input.relationship, essential: true,
        patterns: [input.relationship] }),
      criterion({ id: "mechanism", kind: "required_mechanism",
        description: input.mechanism, essential: true,
        patterns: [input.mechanism] }),
      criterion({ id: "anchor", kind: "anchor_application",
        description: input.application, essential: true,
        patterns: [input.application] }),
      criterion({ id: "conclusion", kind: "coherent_conclusion",
        description: input.conclusion, essential: true,
        patterns: [input.conclusion] }),
      criterion({ id: "optional_detail", kind: "optional_deepening",
        description: "Optional advanced detail.", essential: false,
        patterns: ["advanced detail"] })
    ],
    contradiction_criteria: [{
      contradiction_id: "active_contradiction",
      description: input.contradiction,
      observable_patterns: [input.contradiction]
    }]
  });
}

function calibrationFixtures(): ContractFixture[] {
  return [
    {
      contract: genericContract({
        conceptId: "correlation_causation", itemId: "item_corr_1", option: "B",
        claim: "A strong correlation proves causation.",
        relationship: "association does not establish causation",
        mechanism: "a third variable or reverse direction can explain it",
        application: "option b overstates the evidence",
        conclusion: "the causal conclusion is not supported",
        contradiction: "correlation proves causation"
      }),
      messages: {
        generic: "I understand.", vocabulary: "Correlation and causation are terms.",
        misconception: "For item corr 1, correlation proves causation, so option B is right.",
        relationshipOnly: "Association does not establish causation.",
        mechanismOnly: "A third variable or reverse direction can explain it.",
        anchorOnly: "Option B overstates the evidence.",
        relationshipMechanismNoAnchor: "Association does not establish causation because a third variable or reverse direction can explain it.",
        relationshipAnchorNoMechanism: "Association does not establish causation, so option B overstates the evidence.",
        mechanismAnchorNoRelationship: "A third variable or reverse direction can explain it, so option B overstates the evidence.",
        sound: "Association does not establish causation; a third variable or reverse direction can explain it. Option B overstates the evidence, so the causal conclusion is not supported.",
        soundParaphrase: "Association does not establish causation because a third variable or reverse direction can explain it. Option B overstates the evidence and the causal conclusion is not supported.",
        soundOptionalMissing: "Association does not establish causation. A third variable or reverse direction can explain it. Option B overstates the evidence; the causal conclusion is not supported.",
        laterContradiction: "Correlation proves causation."
      }
    },
    {
      contract: genericContract({
        conceptId: "reliability_validity", itemId: "item_rel_1", option: "C",
        claim: "High reliability proves validity.",
        relationship: "reliability does not establish validity",
        mechanism: "consistent scores can still measure the wrong construct",
        application: "option c makes a claim that is too strong",
        conclusion: "validity needs separate evidence",
        contradiction: "reliability proves validity"
      }),
      messages: {
        generic: "That makes sense.", vocabulary: "Reliability and validity matter.",
        misconception: "Reliability proves validity, so option C is correct.",
        relationshipOnly: "Reliability does not establish validity.",
        mechanismOnly: "Consistent scores can still measure the wrong construct.",
        anchorOnly: "Option C makes a claim that is too strong.",
        relationshipMechanismNoAnchor: "Reliability does not establish validity because consistent scores can still measure the wrong construct.",
        relationshipAnchorNoMechanism: "Reliability does not establish validity, so option C makes a claim that is too strong.",
        mechanismAnchorNoRelationship: "Consistent scores can still measure the wrong construct, so option C makes a claim that is too strong.",
        sound: "Reliability does not establish validity. Consistent scores can still measure the wrong construct. Option C makes a claim that is too strong, and validity needs separate evidence.",
        soundParaphrase: "Reliability does not establish validity because consistent scores can still measure the wrong construct. Option C makes a claim that is too strong; validity needs separate evidence.",
        soundOptionalMissing: "Reliability does not establish validity. Consistent scores can still measure the wrong construct. Option C makes a claim that is too strong. Validity needs separate evidence.",
        laterContradiction: "Reliability proves validity."
      }
    },
    {
      contract: genericContract({
        conceptId: "photosynthesis_energy", itemId: "item_bio_1", option: "D",
        claim: "Plants obtain their mass primarily from soil minerals.",
        relationship: "plant biomass carbon comes mainly from carbon dioxide",
        mechanism: "photosynthesis incorporates carbon into sugars",
        application: "option d confuses mineral uptake with carbon gain",
        conclusion: "soil minerals are not the main source of plant mass",
        contradiction: "plant mass comes mainly from soil"
      }),
      messages: {
        generic: "Okay.", vocabulary: "Photosynthesis uses light.",
        misconception: "Plant mass comes mainly from soil, so option D is correct.",
        relationshipOnly: "Plant biomass carbon comes mainly from carbon dioxide.",
        mechanismOnly: "Photosynthesis incorporates carbon into sugars.",
        anchorOnly: "Option D confuses mineral uptake with carbon gain.",
        relationshipMechanismNoAnchor: "Plant biomass carbon comes mainly from carbon dioxide because photosynthesis incorporates carbon into sugars.",
        relationshipAnchorNoMechanism: "Plant biomass carbon comes mainly from carbon dioxide, so option D confuses mineral uptake with carbon gain.",
        mechanismAnchorNoRelationship: "Photosynthesis incorporates carbon into sugars, so option D confuses mineral uptake with carbon gain.",
        sound: "Plant biomass carbon comes mainly from carbon dioxide. Photosynthesis incorporates carbon into sugars. Option D confuses mineral uptake with carbon gain, so soil minerals are not the main source of plant mass.",
        soundParaphrase: "Plant biomass carbon comes mainly from carbon dioxide because photosynthesis incorporates carbon into sugars. Option D confuses mineral uptake with carbon gain; soil minerals are not the main source of plant mass.",
        soundOptionalMissing: "Plant biomass carbon comes mainly from carbon dioxide. Photosynthesis incorporates carbon into sugars. Option D confuses mineral uptake with carbon gain. Soil minerals are not the main source of plant mass.",
        laterContradiction: "Plant mass comes mainly from soil."
      }
    },
    {
      contract: genericContract({
        conceptId: "sampling_bias", itemId: "item_methods_1", option: "A",
        claim: "A large convenience sample is automatically representative.",
        relationship: "sample size does not remove selection bias",
        mechanism: "systematic undercoverage can persist in a large sample",
        application: "option a ignores the selection process",
        conclusion: "representativeness depends on how participants are sampled",
        contradiction: "a large sample is automatically representative"
      }),
      messages: {
        generic: "I get it.", vocabulary: "Sampling has bias and size.",
        misconception: "A large sample is automatically representative, so option A is right.",
        relationshipOnly: "Sample size does not remove selection bias.",
        mechanismOnly: "Systematic undercoverage can persist in a large sample.",
        anchorOnly: "Option A ignores the selection process.",
        relationshipMechanismNoAnchor: "Sample size does not remove selection bias because systematic undercoverage can persist in a large sample.",
        relationshipAnchorNoMechanism: "Sample size does not remove selection bias, so option A ignores the selection process.",
        mechanismAnchorNoRelationship: "Systematic undercoverage can persist in a large sample, so option A ignores the selection process.",
        sound: "Sample size does not remove selection bias. Systematic undercoverage can persist in a large sample. Option A ignores the selection process, and representativeness depends on how participants are sampled.",
        soundParaphrase: "Sample size does not remove selection bias because systematic undercoverage can persist in a large sample. Option A ignores the selection process; representativeness depends on how participants are sampled.",
        soundOptionalMissing: "Sample size does not remove selection bias. Systematic undercoverage can persist in a large sample. Option A ignores the selection process. Representativeness depends on how participants are sampled.",
        laterContradiction: "A large sample is automatically representative."
      }
    }
  ];
}

export function buildE2A23ACalibrationCorpus() {
  const rows: Array<{
    case_id: string;
    concept_id: string;
    message: string;
    expected_reasoning_quality: "insufficient" | "misconception" | "partial" | "sound";
    expected_anchor_application: "absent" | "explicit";
    expected_revision_readiness: boolean;
    expected_mode: "remain_in_dialogue" | "request_revision";
    expected_operation: string | null;
    prior_case: "none" | "prior_misconception" | "prior_sound";
  }> = [];
  const add = (
    fixture: ContractFixture,
    suffix: string,
    message: string,
    quality: "insufficient" | "misconception" | "partial" | "sound",
    anchor: "absent" | "explicit",
    prior: "none" | "prior_misconception" | "prior_sound" = "none"
  ) => rows.push({
    case_id: `${fixture.contract.concept_id}_${suffix}`,
    concept_id: fixture.contract.concept_id,
    message,
    expected_reasoning_quality: quality,
    expected_anchor_application: anchor,
    expected_revision_readiness: quality === "sound",
    expected_mode: quality === "sound" ? "request_revision" : "remain_in_dialogue",
    expected_operation: quality === "sound" ? null : quality === "misconception"
      ? (prior === "prior_sound" ? "repair_recurrence" : "clarify_concept_with_new_strategy")
      : quality === "partial" ? "refine_partial_reasoning" : "elicit_anchor_evidence",
    prior_case: prior
  });
  for (const fixture of calibrationFixtures()) {
    const m = fixture.messages;
    add(fixture, "generic", m.generic, "insufficient", "absent");
    add(fixture, "vocabulary", m.vocabulary, "insufficient", "absent");
    add(fixture, "misconception", m.misconception, "misconception", "absent");
    add(fixture, "relationship", m.relationshipOnly, "partial", "absent");
    add(fixture, "mechanism", m.mechanismOnly, "partial", "absent");
    add(fixture, "anchor", m.anchorOnly, "partial", "explicit");
    add(fixture, "relationship_mechanism", m.relationshipMechanismNoAnchor,
      "partial", "absent");
    add(fixture, "relationship_anchor", m.relationshipAnchorNoMechanism,
      "partial", "explicit");
    add(fixture, "mechanism_anchor", m.mechanismAnchorNoRelationship,
      "partial", "explicit");
    add(fixture, "sound", m.sound, "sound", "explicit");
    add(fixture, "sound_paraphrase", m.soundParaphrase, "sound", "explicit");
    add(fixture, "sound_optional_missing", m.soundOptionalMissing,
      "sound", "explicit");
    add(fixture, "sound_after_misconception", m.sound, "sound", "explicit",
      "prior_misconception");
    add(fixture, "later_contradiction", m.laterContradiction,
      "misconception", "absent", "prior_sound");
    add(fixture, "partial_after_misconception", m.relationshipAnchorNoMechanism,
      "partial", "explicit", "prior_misconception");
    add(fixture, "sound_repeat", m.soundParaphrase, "sound", "explicit",
      "prior_sound");
  }
  return { rows, fixtures: calibrationFixtures() };
}

export function runE2A23ACalibration() {
  const { rows, fixtures } = buildE2A23ACalibrationCorpus();
  const contractByConcept = new Map(fixtures.map((entry) => [
    entry.contract.concept_id,
    entry
  ]));
  const results = rows.map((row, index) => {
    const fixture = contractByConcept.get(row.concept_id)!;
    let prior: TopicDialogueCumulativeEvidenceProfile | null = null;
    if (row.prior_case !== "none") {
      const priorMessage = row.prior_case === "prior_sound"
        ? fixture.messages.sound
        : fixture.messages.misconception;
      prior = reconcileMessageToProfile({
        message: priorMessage,
        contract: fixture.contract,
        sourceStudentTurnId: `prior_${row.case_id}`,
        sourceSequenceIndex: index * 2 + 1,
        prior: null,
        createdAt: "2026-07-20T20:00:00.000Z"
      }).cumulative;
    }
    const result = reconcileMessageToProfile({
      message: row.message,
      contract: fixture.contract,
      sourceStudentTurnId: `turn_${row.case_id}`,
      sourceSequenceIndex: index * 2 + 2,
      prior,
      createdAt: "2026-07-20T20:00:01.000Z"
    });
    const passed = result.profile.reasoning_quality ===
      row.expected_reasoning_quality &&
      result.profile.anchor_application === row.expected_anchor_application &&
      result.profile.revision_readiness === row.expected_revision_readiness &&
      result.route.selected_mode === row.expected_mode &&
      result.route.selected_operation === row.expected_operation &&
      !(result.profile.reasoning_quality === "sound" &&
        result.route.selected_mode === "remain_in_dialogue") &&
      !(result.profile.reasoning_quality === "partial" &&
        result.route.selected_mode === "request_revision");
    return { ...row, actual: result, passed };
  });
  return {
    corpus_size: rows.length,
    non_irt_case_count: rows.length,
    pass_count: results.filter((entry) => entry.passed).length,
    fail_count: results.filter((entry) => !entry.passed).length,
    provider_call_count: 0,
    passed: results.every((entry) => entry.passed),
    results
  };
}
