import {
  ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION,
  AbilityEvidencePacketV1Schema,
  buildItemAbilityEvidence,
  diagnosticMetadataForItem,
  projectStudentSafeAbilityStatus,
  summarizeConceptAbilityEvidence
} from "../src/lib/services/student-assessment/ability-evidence";
import {
  ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION,
  ENGAGEMENT_RULE_CONFIG_V1,
  EngagementEvidencePacketV1Schema,
  buildItemEngagementEvidence,
  summarizeSessionEngagement
} from "../src/lib/services/student-assessment/engagement-evidence";
import {
  buildProfileIntegrationAgentInput,
  type ProfileIntegrationAgentInput,
  type ProfileIntegrationInterpretationPacketV1
} from "../src/lib/services/student-assessment/profile-integration";
import {
  buildFormativeValueAgentInput,
  type FormativeValue,
  type FormativeValueAgentInput
} from "../src/lib/services/student-assessment/formative-value-determination";

type ProfilePattern = ProfileIntegrationInterpretationPacketV1["integration_pattern"];
type StudentStatus = ProfileIntegrationInterpretationPacketV1["student_facing_status"];
type EngagementCategory = ReturnType<typeof summarizeSessionEngagement>["provisional_engagement_category"];
type AiSignal = ReturnType<typeof summarizeSessionEngagement>["ai_assistance_signal"];

type AbilityScript = {
  selected_option: string | null;
  correctness: "correct" | "incorrect" | "not_scored";
  confidence: "Low" | "Medium" | "High" | null;
  reasoning_text: string | null;
  no_tempting_option?: boolean;
  tempting_option?: string | null;
  total_item_time_ms?: number;
};

type EngagementScript = {
  response_present: boolean;
  selected_option: string | null;
  reasoning_text: string | null;
  item_response_time_ms: number | null;
  revision_count?: number;
  event_counts?: Record<string, number>;
  process_instrumentation_available?: boolean;
};

export type ProfileFormativeVariationTag =
  | "concise_meaningful"
  | "detailed_response"
  | "vague_response"
  | "uncertainty"
  | "low_information"
  | "multilingual"
  | "typo_heavy"
  | "content_question"
  | "procedural_question"
  | "move_on_question"
  | "edit_revision"
  | "answer_changed"
  | "confidence_changed"
  | "tempting_option_changed"
  | "engaged_process"
  | "moderate_process"
  | "rapid_sparse_process"
  | "pause_resume_process"
  | "weak_focus_or_paste_signal"
  | "likely_external_assistance_pattern"
  | "insufficient_ai_signal"
  | "student_choice"
  | "accepts_recommendation"
  | "chooses_alternative"
  | "moves_on"
  | "rejects_confidence_calibration"
  | "chooses_diagnostic_clarification";

export type ProfileFormativeScenario = {
  scenario_id: string;
  scenario_name: string;
  trial_variant?: "core" | "variation";
  base_scenario_id?: string;
  variation_id?: string;
  variation_description?: string;
  variation_tags?: ProfileFormativeVariationTag[];
  target_profile_integration_pattern: ProfilePattern;
  target_student_facing_status: StudentStatus;
  target_engagement_category: EngagementCategory;
  target_ai_assistance_signal: AiSignal;
  target_formative_value: FormativeValue;
  expected_allowed_outcomes?: {
    profile_integration_patterns?: ProfilePattern[];
    student_facing_statuses?: StudentStatus[];
    engagement_categories?: EngagementCategory[];
    ai_assistance_signals?: AiSignal[];
    formative_values?: FormativeValue[];
  };
  scripted_student_response_package: AbilityScript[];
  scripted_confidence_pattern: Array<AbilityScript["confidence"]>;
  scripted_tempting_option_pattern: Array<string | null>;
  optional_scripted_content_or_procedural_question?: string;
  optional_edit_or_revision_behavior?: string;
  optional_process_event_profile?: string;
  student_choice?: "not_chosen" | "accepted_recommendation" | "chose_alternative" | "moved_on";
  engagement_items: EngagementScript[];
  expected_safety_constraints: string[];
  rationale: string;
};

const metadata = diagnosticMetadataForItem({
  item_public_id: "profile_formative_scenario_item",
  concept_id: "theta_invariance",
  options: [
    { label: "A", text: "Item difficulty determines person ability." },
    { label: "B", text: "Theta changes because the test form is harder." },
    { label: "C", text: "Theta is the person location on a linked latent trait scale." },
    { label: "D", text: "Discrimination changes the meaning of theta." }
  ],
  correct_option: "C",
  distractor_rationales: {
    A: "Confuses item difficulty with person ability.",
    B: "Claims theta changes because the form is harder.",
    D: "Claims discrimination changes the meaning of theta."
  },
  expected_reasoning_patterns: [
    "Theta is the person ability location on the latent trait scale.",
    "Item difficulty and discrimination describe item behavior rather than person ability."
  ],
  possible_misconception_indicators: [
    "Confuses item difficulty with person ability.",
    "Claims theta changes because the form is harder."
  ],
  administration_rules: {
    concept_id: "theta_invariance",
    cognitive_level: "understand",
    subskills: ["distinguish_person_ability_from_item_difficulty"],
    difficulty_label: "medium"
  }
});

const safetyConstraints = [
  "no_answer_key",
  "no_correct_option_or_correctness_label",
  "no_distractor_metadata",
  "no_raw_misconception_ids_to_student",
  "no_raw_process_payload",
  "no_raw_llm_output",
  "no_secret",
  "no_student_facing_engagement_or_ai_labels",
  "no_integrity_or_misconduct_language",
  "no_activity_planning"
];

const strongReason =
  "Theta is the person's location on the latent trait scale, while item difficulty and discrimination describe item behavior.";
const adequateReason =
  "Theta describes the person on the common scale, not the difficulty of a single item.";
const partialReason =
  "Theta is about the person on the scale, but I am not fully connecting how item parameters fit.";
const misconceptionReason =
  "A harder form changes theta because item difficulty directly determines the person's ability estimate.";
const vagueReason = "It seems right but I cannot explain more.";
const idkReason = "I don't know the reason yet.";

function ability(
  selected_option: string | null,
  correctness: AbilityScript["correctness"],
  confidence: AbilityScript["confidence"],
  reasoning_text: string | null,
  extra: Partial<AbilityScript> = {}
): AbilityScript {
  return {
    selected_option,
    correctness,
    confidence,
    reasoning_text,
    no_tempting_option: extra.no_tempting_option ?? true,
    tempting_option: extra.tempting_option ?? null,
    total_item_time_ms: extra.total_item_time_ms ?? 45_000
  };
}

function engagement(
  response_present: boolean,
  selected_option: string | null,
  reasoning_text: string | null,
  item_response_time_ms: number | null,
  extra: Partial<EngagementScript> = {}
): EngagementScript {
  return {
    response_present,
    selected_option,
    reasoning_text,
    item_response_time_ms,
    revision_count: extra.revision_count ?? 0,
    event_counts: extra.event_counts ?? { typing_activity_summary: 1 },
    process_instrumentation_available: extra.process_instrumentation_available ?? true
  };
}

const engaged = (selected = "C", reason = strongReason) =>
  engagement(true, selected, reason, 45_000, {
    revision_count: 1,
    event_counts: { typing_activity_summary: 1, response_quality_adequate_or_usable: 1 }
  });
const moderate = (selected = "C", reason = partialReason) =>
  engagement(true, selected, reason, 22_000, { event_counts: { typing_activity_summary: 1 } });
const sparse = (selected: string | null, reason: string | null, ms = 1_500) =>
  engagement(Boolean(selected || reason), selected, reason, ms, {
    event_counts: { response_quality_low_information: 1, idk_selected: reason?.includes("know") ? 1 : 0 },
    process_instrumentation_available: true
  });

export const coreProfileFormativeScenarios: ProfileFormativeScenario[] = ([
  {
    scenario_id: "stable_understanding_engaged",
    scenario_name: "Stable understanding with aligned confidence and engaged evidence",
    target_profile_integration_pattern: "stable_understanding",
    target_student_facing_status: "Mostly understood",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "consolidation_and_transfer",
    scripted_student_response_package: [
      ability("C", "correct", "High", strongReason),
      ability("C", "correct", "High", adequateReason),
      ability("C", "correct", "Medium", strongReason)
    ],
    scripted_confidence_pattern: ["High", "High", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [engaged(), engaged(), engaged()],
    expected_safety_constraints: safetyConstraints,
    rationale: "Consistently target-aligned responses with adequate reasoning should be ready for consolidation."
  },
  {
    scenario_id: "developing_understanding_partial_reasoning",
    scenario_name: "Developing understanding with partial reasoning",
    target_profile_integration_pattern: "developing_understanding",
    target_student_facing_status: "Still developing",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "reasoning_refinement",
    scripted_student_response_package: [
      ability("C", "correct", "Medium", partialReason),
      ability("C", "correct", "Medium", vagueReason),
      ability("C", "correct", "Medium", adequateReason)
    ],
    expected_allowed_outcomes: {
      profile_integration_patterns: ["developing_understanding", "stable_understanding", "mixed_or_conflicting_evidence"],
      student_facing_statuses: ["Still developing", "Mostly understood"],
      formative_values: ["reasoning_refinement", "independent_understanding_verification"]
    },
    scripted_confidence_pattern: ["Medium", "Medium", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [moderate(), moderate(), engaged()],
    expected_safety_constraints: safetyConstraints,
    rationale: "Some key ideas are present, but reasoning needs clearer connection."
  },
  {
    scenario_id: "knowledge_gap_low_confidence",
    scenario_name: "Knowledge gap with low confidence and sparse reasoning",
    target_profile_integration_pattern: "likely_knowledge_gap",
    target_student_facing_status: "Needs more work",
    target_engagement_category: "moderately_engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "diagnostic_clarification",
    expected_allowed_outcomes: {
      student_facing_statuses: ["Needs more work", "Still developing"],
      engagement_categories: ["moderately_engaged", "disengaged"]
    },
    scripted_student_response_package: [
      ability("E", "not_scored", "Low", idkReason),
      ability("A", "incorrect", "Low", "I am not sure."),
      ability("E", "not_scored", "Low", "No idea yet.")
    ],
    scripted_confidence_pattern: ["Low", "Low", "Low"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [sparse("E", idkReason, 12_000), sparse("A", "I am not sure.", 14_000), sparse("E", "No idea yet.", 13_000)],
    expected_safety_constraints: safetyConstraints,
    rationale: "Low confidence is appropriate here because the primary evidence is a conceptual gap."
  },
  {
    scenario_id: "misconception_with_diagnostic_evidence",
    scenario_name: "Diagnostic distractors with aligned misconception reasoning",
    target_profile_integration_pattern: "likely_misconception",
    target_student_facing_status: "Still developing",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "diagnostic_clarification",
    expected_allowed_outcomes: {
      formative_values: ["diagnostic_clarification", "reasoning_refinement"],
      student_facing_statuses: ["Still developing", "Needs more work"]
    },
    scripted_student_response_package: [
      ability("A", "incorrect", "High", misconceptionReason),
      ability("B", "incorrect", "High", "Theta changes because the harder form changes where the person is located."),
      ability("C", "correct", "Medium", partialReason)
    ],
    scripted_confidence_pattern: ["High", "High", "Medium"],
    scripted_tempting_option_pattern: [null, null, "A"],
    engagement_items: [engaged("A", misconceptionReason), engaged("B", misconceptionReason), moderate("C", partialReason)],
    expected_safety_constraints: safetyConstraints,
    rationale: "High confidence with misconception evidence should stay conceptual, not primary calibration."
  },
  {
    scenario_id: "mixed_conflicting_evidence",
    scenario_name: "Mixed and conflicting response evidence",
    target_profile_integration_pattern: "mixed_or_conflicting_evidence",
    target_student_facing_status: "Still developing",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "independent_understanding_verification",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["mixed_or_conflicting_evidence", "developing_understanding"],
      formative_values: ["independent_understanding_verification", "reasoning_refinement"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "High", vagueReason, { tempting_option: "A", no_tempting_option: false }),
      ability("A", "incorrect", "Medium", "Theta is about person ability, but harder items still seem to move it."),
      ability("C", "correct", "Low", adequateReason)
    ],
    scripted_confidence_pattern: ["High", "Medium", "Low"],
    scripted_tempting_option_pattern: ["A", null, null],
    engagement_items: [moderate("C", vagueReason), moderate("A", partialReason), engaged("C", adequateReason)],
    expected_safety_constraints: safetyConstraints,
    rationale: "Correct selections, vague reasoning, and conflicting tempting-option evidence call for verification."
  },
  {
    scenario_id: "insufficient_evidence_sparse_but_not_disengaged",
    scenario_name: "Sparse evidence without enough process evidence for disengagement",
    target_profile_integration_pattern: "insufficient_evidence",
    target_student_facing_status: "Still developing",
    target_engagement_category: "insufficient_evidence",
    target_ai_assistance_signal: "insufficient_evidence",
    target_formative_value: "independent_understanding_verification",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["insufficient_evidence", "mixed_or_conflicting_evidence", "likely_knowledge_gap"],
      formative_values: ["independent_understanding_verification", "diagnostic_clarification"],
      student_facing_statuses: ["Still developing", "Needs more work"],
      engagement_categories: ["insufficient_evidence", "moderately_engaged"]
    },
    scripted_student_response_package: [
      ability(null, "not_scored", null, null),
      ability(null, "not_scored", null, null),
      ability(null, "not_scored", null, null)
    ],
    scripted_confidence_pattern: [null, null, null],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [
      engagement(false, null, null, null, { process_instrumentation_available: false, event_counts: {} }),
      engagement(false, null, null, null, { process_instrumentation_available: false, event_counts: {} }),
      engagement(false, null, null, null, { process_instrumentation_available: false, event_counts: {} })
    ],
    expected_safety_constraints: safetyConstraints,
    rationale: "There is too little evidence for a confident interpretation."
  },
  {
    scenario_id: "underconfident_strong_understanding",
    scenario_name: "Strong understanding with underconfidence",
    target_profile_integration_pattern: "stable_understanding",
    target_student_facing_status: "Mostly understood",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "confidence_calibration",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["stable_understanding", "developing_understanding"],
      student_facing_statuses: ["Mostly understood", "Still developing"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "Low", strongReason),
      ability("C", "correct", "High", adequateReason),
      ability("C", "correct", "High", strongReason)
    ],
    scripted_confidence_pattern: ["Low", "High", "High"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [engaged(), engaged(), engaged()],
    expected_safety_constraints: safetyConstraints,
    rationale: "Adequate or strong understanding with low confidence is the clean calibration case."
  },
  {
    scenario_id: "overconfident_wrong_or_weak_evidence",
    scenario_name: "High confidence with weak or wrong evidence",
    target_profile_integration_pattern: "likely_knowledge_gap",
    target_student_facing_status: "Needs more work",
    target_engagement_category: "moderately_engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "diagnostic_clarification",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["likely_knowledge_gap", "developing_understanding", "likely_misconception"],
      formative_values: ["diagnostic_clarification", "reasoning_refinement"],
      student_facing_statuses: ["Needs more work", "Still developing"]
    },
    scripted_student_response_package: [
      ability("A", "incorrect", "High", vagueReason),
      ability("B", "incorrect", "High", "Because harder means lower ability."),
      ability("A", "incorrect", "High", "I just think A.")
    ],
    scripted_confidence_pattern: ["High", "High", "High"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [moderate("A", vagueReason), moderate("B", "Because harder means lower ability."), moderate("A", "I just think A.")],
    expected_safety_constraints: safetyConstraints,
    rationale: "Overconfidence is secondary because the main evidence is weak or wrong."
  },
  {
    scenario_id: "rapid_sparse_disengaged",
    scenario_name: "Rapid sparse package with repeated low-information evidence",
    target_profile_integration_pattern: "insufficient_evidence",
    target_student_facing_status: "Still developing",
    target_engagement_category: "disengaged",
    target_ai_assistance_signal: "insufficient_evidence",
    target_formative_value: "independent_understanding_verification",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["insufficient_evidence", "likely_knowledge_gap", "mixed_or_conflicting_evidence"],
      formative_values: ["independent_understanding_verification", "diagnostic_clarification"],
      student_facing_statuses: ["Still developing", "Needs more work"],
      ai_assistance_signals: ["insufficient_evidence", "none_indicated"]
    },
    scripted_student_response_package: [
      ability("E", "not_scored", "Low", "idk", { total_item_time_ms: 900 }),
      ability("E", "not_scored", "Low", "idk", { total_item_time_ms: 950 }),
      ability("A", "incorrect", "Low", "because", { total_item_time_ms: 1_000 })
    ],
    scripted_confidence_pattern: ["Low", "Low", "Low"],
    scripted_tempting_option_pattern: [null, null, null],
    optional_process_event_profile: "ultra_rapid_sparse_low_information",
    engagement_items: [
      sparse("E", "idk", 900),
      sparse("E", "idk", 950),
      sparse("A", "because", 1_000)
    ],
    expected_safety_constraints: safetyConstraints,
    rationale: "Rapid sparse behavior is internal reliability context and must not appear in student-facing text."
  },
  {
    scenario_id: "moderately_engaged_mixed",
    scenario_name: "Moderately engaged mixed evidence",
    target_profile_integration_pattern: "mixed_or_conflicting_evidence",
    target_student_facing_status: "Still developing",
    target_engagement_category: "moderately_engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "independent_understanding_verification",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["mixed_or_conflicting_evidence", "developing_understanding"],
      formative_values: ["independent_understanding_verification", "reasoning_refinement"],
      engagement_categories: ["moderately_engaged", "engaged"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "Medium", adequateReason),
      ability("A", "incorrect", "Medium", partialReason),
      ability("C", "correct", "Medium", vagueReason)
    ],
    scripted_confidence_pattern: ["Medium", "Medium", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [moderate("C", adequateReason), moderate("A", partialReason), moderate("C", vagueReason)],
    expected_safety_constraints: safetyConstraints,
    rationale: "Mixed short and meaningful reasoning should remain cautious."
  },
  {
    scenario_id: "likely_external_assistance_context",
    scenario_name: "Convergent response-production context",
    target_profile_integration_pattern: "stable_understanding",
    target_student_facing_status: "Mostly understood",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "likely_external_assistance_pattern",
    target_formative_value: "independent_understanding_verification",
    expected_allowed_outcomes: {
      formative_values: ["independent_understanding_verification"],
      profile_integration_patterns: ["stable_understanding", "developing_understanding"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "High", strongReason),
      ability("C", "correct", "High", strongReason),
      ability("C", "correct", "High", adequateReason)
    ],
    scripted_confidence_pattern: ["High", "High", "High"],
    scripted_tempting_option_pattern: [null, null, null],
    optional_process_event_profile: "paste_plus_focus_context",
    engagement_items: [
      engagement(true, "C", strongReason, 40_000, { event_counts: { paste_detected: 1, window_blur: 1, typing_activity_summary: 1 } }),
      engaged(),
      engaged()
    ],
    expected_safety_constraints: safetyConstraints,
    rationale: "Convergent process context affects evidence reliability but must not become a student-facing accusation."
  },
  {
    scenario_id: "ai_signal_insufficient_evidence",
    scenario_name: "Single weak process signal remains insufficient",
    target_profile_integration_pattern: "stable_understanding",
    target_student_facing_status: "Mostly understood",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "insufficient_evidence",
    target_formative_value: "consolidation_and_transfer",
    scripted_student_response_package: [
      ability("C", "correct", "High", strongReason),
      ability("C", "correct", "High", adequateReason),
      ability("C", "correct", "High", strongReason)
    ],
    scripted_confidence_pattern: ["High", "High", "High"],
    scripted_tempting_option_pattern: [null, null, null],
    optional_process_event_profile: "single_paste_only",
    expected_allowed_outcomes: {
      formative_values: ["consolidation_and_transfer", "independent_understanding_verification"]
    },
    engagement_items: [
      engagement(true, "C", strongReason, 40_000, { event_counts: { paste_detected: 1, typing_activity_summary: 1 } }),
      engaged(),
      engaged()
    ],
    expected_safety_constraints: safetyConstraints,
    rationale: "One weak process signal is not enough to affect ability interpretation."
  },
  {
    scenario_id: "confidence_calibration_negative_control",
    scenario_name: "Low confidence with knowledge gap does not calibrate",
    target_profile_integration_pattern: "likely_knowledge_gap",
    target_student_facing_status: "Needs more work",
    target_engagement_category: "moderately_engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "diagnostic_clarification",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["likely_knowledge_gap", "insufficient_evidence", "developing_understanding"],
      student_facing_statuses: ["Needs more work", "Still developing"],
      engagement_categories: ["moderately_engaged", "disengaged", "insufficient_evidence"]
    },
    scripted_student_response_package: [
      ability("E", "not_scored", "Low", idkReason),
      ability("A", "incorrect", "Low", "I am guessing."),
      ability("E", "not_scored", "Low", "I am not sure at all.")
    ],
    scripted_confidence_pattern: ["Low", "Low", "Low"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [sparse("E", idkReason, 12_000), sparse("A", "I am guessing.", 13_000), sparse("E", "I am not sure at all.", 14_000)],
    expected_safety_constraints: safetyConstraints,
    rationale: "Low confidence is aligned with weak evidence, so calibration is not primary."
  },
  {
    scenario_id: "consolidation_transfer_negative_control",
    scenario_name: "Unstable evidence should not consolidate",
    target_profile_integration_pattern: "developing_understanding",
    target_student_facing_status: "Still developing",
    target_engagement_category: "moderately_engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "reasoning_refinement",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["developing_understanding", "mixed_or_conflicting_evidence"],
      formative_values: ["reasoning_refinement", "independent_understanding_verification", "diagnostic_clarification"],
      engagement_categories: ["moderately_engaged", "engaged"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "Medium", partialReason),
      ability("C", "correct", "High", vagueReason),
      ability("B", "incorrect", "Medium", partialReason)
    ],
    scripted_confidence_pattern: ["Medium", "High", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [moderate("C", partialReason), moderate("C", vagueReason), moderate("B", partialReason)],
    expected_safety_constraints: safetyConstraints,
    rationale: "Stable understanding is not present, so consolidation should not be primary."
  },
  {
    scenario_id: "student_choice_accepts_recommendation",
    scenario_name: "Student accepts recommendation",
    target_profile_integration_pattern: "stable_understanding",
    target_student_facing_status: "Mostly understood",
    target_engagement_category: "engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "consolidation_and_transfer",
    student_choice: "accepted_recommendation",
    scripted_student_response_package: [
      ability("C", "correct", "High", strongReason),
      ability("C", "correct", "High", adequateReason),
      ability("C", "correct", "Medium", strongReason)
    ],
    scripted_confidence_pattern: ["High", "High", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [engaged(), engaged(), engaged()],
    expected_safety_constraints: safetyConstraints,
    rationale: "Choice capture should allow accepting the recommendation."
  },
  {
    scenario_id: "student_choice_selects_alternative",
    scenario_name: "Student selects an alternative",
    target_profile_integration_pattern: "developing_understanding",
    target_student_facing_status: "Still developing",
    target_engagement_category: "moderately_engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "reasoning_refinement",
    student_choice: "chose_alternative",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["developing_understanding", "stable_understanding"],
      student_facing_statuses: ["Still developing", "Mostly understood"],
      engagement_categories: ["moderately_engaged", "engaged"],
      formative_values: ["reasoning_refinement", "independent_understanding_verification"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "Medium", partialReason),
      ability("C", "correct", "Medium", vagueReason),
      ability("C", "correct", "Medium", adequateReason)
    ],
    scripted_confidence_pattern: ["Medium", "Medium", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [moderate(), moderate(), moderate()],
    expected_safety_constraints: safetyConstraints,
    rationale: "Choice capture should allow a non-punitive alternative override."
  },
  {
    scenario_id: "student_choice_moves_on",
    scenario_name: "Student moves on",
    target_profile_integration_pattern: "mixed_or_conflicting_evidence",
    target_student_facing_status: "Still developing",
    target_engagement_category: "moderately_engaged",
    target_ai_assistance_signal: "none_indicated",
    target_formative_value: "independent_understanding_verification",
    student_choice: "moved_on",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["mixed_or_conflicting_evidence", "developing_understanding"],
      formative_values: ["independent_understanding_verification", "reasoning_refinement"],
      engagement_categories: ["moderately_engaged", "engaged"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "Low", adequateReason),
      ability("A", "incorrect", "Medium", partialReason),
      ability("C", "correct", "Medium", vagueReason)
    ],
    scripted_confidence_pattern: ["Low", "Medium", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [moderate("C", adequateReason), moderate("A", partialReason), moderate("C", vagueReason)],
    expected_safety_constraints: safetyConstraints,
    rationale: "Choice capture should allow move-on without blame language."
  }
] as ProfileFormativeScenario[]).map((scenario) => ({ ...scenario, trial_variant: "core" as const }));

function baseScenario(scenarioId: string) {
  const scenario = coreProfileFormativeScenarios.find((entry) => entry.scenario_id === scenarioId);
  if (!scenario) throw new Error(`Unknown base scenario ${scenarioId}`);
  return scenario;
}

function withVariation(
  scenarioId: string,
  variationId: string,
  description: string,
  tags: ProfileFormativeVariationTag[],
  updates: Partial<ProfileFormativeScenario>
): ProfileFormativeScenario {
  const base = baseScenario(scenarioId);
  return {
    ...base,
    ...updates,
    scenario_id: `${scenarioId}__${variationId}`,
    scenario_name: `${base.scenario_name} - ${description}`,
    trial_variant: "variation",
    base_scenario_id: scenarioId,
    variation_id: variationId,
    variation_description: description,
    variation_tags: tags,
    expected_allowed_outcomes: {
      ...base.expected_allowed_outcomes,
      ...updates.expected_allowed_outcomes,
      profile_integration_patterns: [
        ...(base.expected_allowed_outcomes?.profile_integration_patterns ?? []),
        ...(updates.expected_allowed_outcomes?.profile_integration_patterns ?? [])
      ],
      student_facing_statuses: [
        ...(base.expected_allowed_outcomes?.student_facing_statuses ?? []),
        ...(updates.expected_allowed_outcomes?.student_facing_statuses ?? [])
      ],
      engagement_categories: [
        ...(base.expected_allowed_outcomes?.engagement_categories ?? []),
        ...(updates.expected_allowed_outcomes?.engagement_categories ?? [])
      ],
      ai_assistance_signals: [
        ...(base.expected_allowed_outcomes?.ai_assistance_signals ?? []),
        ...(updates.expected_allowed_outcomes?.ai_assistance_signals ?? [])
      ],
      formative_values: [
        ...(base.expected_allowed_outcomes?.formative_values ?? []),
        ...(updates.expected_allowed_outcomes?.formative_values ?? [])
      ]
    },
    rationale: `${base.rationale} Variation coverage: ${description}.`
  };
}

function withReasoning(
  scenario: ProfileFormativeScenario,
  reasoning: [string | null, string | null, string | null]
) {
  return scenario.scripted_student_response_package.map((item, index) => ({
    ...item,
    reasoning_text: reasoning[index] ?? item.reasoning_text
  }));
}

export const profileFormativeScenarioVariations: ProfileFormativeScenario[] = [
  withVariation("stable_understanding_engaged", "concise_meaningful", "concise but meaningful answers", [
    "concise_meaningful",
    "engaged_process"
  ], {
    scripted_student_response_package: withReasoning(baseScenario("stable_understanding_engaged"), [
      "Theta is the person's ability location, not item difficulty.",
      "Item parameters describe items; theta describes the person.",
      "Theta stays about the person on the linked scale."
    ])
  }),
  withVariation("developing_understanding_partial_reasoning", "revision_improves_reasoning", "student revises partial reasoning", [
    "edit_revision",
    "detailed_response"
  ], {
    optional_edit_or_revision_behavior: "revises_reasoning_with_better_explanation",
    expected_allowed_outcomes: {
      profile_integration_patterns: ["developing_understanding", "stable_understanding"],
      student_facing_statuses: ["Still developing", "Mostly understood"],
      formative_values: ["reasoning_refinement", "independent_understanding_verification", "consolidation_and_transfer"]
    },
    scripted_student_response_package: withReasoning(baseScenario("developing_understanding_partial_reasoning"), [
      partialReason,
      "At first I only said it seemed right, then I added that item difficulty is about the item, not the person's theta.",
      adequateReason
    ])
  }),
  withVariation("knowledge_gap_low_confidence", "asks_idk_allowed", "student asks whether I don't know is acceptable", [
    "uncertainty",
    "procedural_question",
    "low_information"
  ], {
    optional_scripted_content_or_procedural_question: "Can I say I don't know if I am not sure?",
    scripted_student_response_package: withReasoning(baseScenario("knowledge_gap_low_confidence"), [
      "I don't know yet.",
      "I am not sure; I might be guessing.",
      "No idea yet."
    ])
  }),
  withVariation("misconception_with_diagnostic_evidence", "content_question_deferred", "student asks a content question during reasoning", [
    "content_question",
    "detailed_response"
  ], {
    optional_scripted_content_or_procedural_question: "Can you explain whether a harder form changes theta?",
    scripted_student_response_package: withReasoning(baseScenario("misconception_with_diagnostic_evidence"), [
      misconceptionReason,
      "I think a harder form moves theta because the item difficulty changes the person's location.",
      partialReason
    ])
  }),
  withVariation("mixed_conflicting_evidence", "multilingual_uncertainty", "mixed English and Chinese uncertainty", [
    "multilingual",
    "uncertainty"
  ], {
    scripted_student_response_package: withReasoning(baseScenario("mixed_conflicting_evidence"), [
      "Theta is person ability, 但是 I still wonder if hard items move it.",
      "I think item difficulty matters, but I am not sure how.",
      "Theta should be about the person on the scale."
    ]),
    expected_allowed_outcomes: {
      profile_integration_patterns: ["mixed_or_conflicting_evidence", "developing_understanding"],
      formative_values: ["independent_understanding_verification", "reasoning_refinement"]
    }
  }),
  withVariation("insufficient_evidence_sparse_but_not_disengaged", "repeated_placeholder", "repeated low-information placeholders", [
    "low_information",
    "vague_response"
  ], {
    expected_allowed_outcomes: {
      profile_integration_patterns: ["insufficient_evidence", "mixed_or_conflicting_evidence", "likely_knowledge_gap"],
      student_facing_statuses: ["Still developing", "Needs more work"],
      engagement_categories: ["insufficient_evidence", "moderately_engaged", "disengaged"],
      ai_assistance_signals: ["insufficient_evidence", "none_indicated"],
      formative_values: ["independent_understanding_verification", "diagnostic_clarification"]
    },
    scripted_student_response_package: withReasoning(baseScenario("insufficient_evidence_sparse_but_not_disengaged"), [
      "maybe",
      "not sure",
      "idk"
    ]),
    engagement_items: [
      sparse(null, "maybe", 18_000),
      sparse(null, "not sure", 20_000),
      sparse(null, "idk", 19_000)
    ]
  }),
  withVariation("underconfident_strong_understanding", "rejects_calibration_preference", "underconfident student chooses a different focus", [
    "rejects_confidence_calibration",
    "chooses_alternative",
    "procedural_question"
  ], {
    student_choice: "chose_alternative",
    optional_scripted_content_or_procedural_question: "Can I choose a different focus even if confidence is the suggested focus?"
  }),
  withVariation("underconfident_strong_understanding", "confidence_changed", "student changes confidence after review", [
    "confidence_changed",
    "edit_revision",
    "uncertainty"
  ], {
    optional_edit_or_revision_behavior: "changes_confidence_from_low_to_medium_after_review",
    scripted_confidence_pattern: ["Low", "Medium", "High"],
    scripted_student_response_package: [
      ability("C", "correct", "Low", strongReason),
      ability("C", "correct", "Medium", adequateReason),
      ability("C", "correct", "High", strongReason)
    ]
  }),
  withVariation("overconfident_wrong_or_weak_evidence", "typo_heavy_wrong", "typo-heavy wrong explanation", [
    "typo_heavy",
    "vague_response"
  ], {
    scripted_student_response_package: withReasoning(baseScenario("overconfident_wrong_or_weak_evidence"), [
      "becuase harder item means persn abiltiy is lower",
      "theta chnages when questin is hard",
      "I just pick A becase it seems obvios"
    ])
  }),
  withVariation("rapid_sparse_disengaged", "move_on_question", "rapid sparse student asks to move on", [
    "rapid_sparse_process",
    "move_on_question",
    "moves_on"
  ], {
    student_choice: "moved_on",
    optional_scripted_content_or_procedural_question: "Can I move on now?"
  }),
  withVariation("moderately_engaged_mixed", "pause_resume", "moderate evidence with pause and resume context", [
    "pause_resume_process",
    "moderate_process"
  ], {
    optional_process_event_profile: "pause_resume_moderate_timing",
    engagement_items: [
      engagement(true, "C", adequateReason, 50_000, { event_counts: { typing_activity_summary: 1, long_pause: 1 } }),
      moderate("A", partialReason),
      moderate("C", vagueReason)
    ]
  }),
  withVariation("likely_external_assistance_context", "convergent_context", "convergent paste and focus context", [
    "likely_external_assistance_pattern",
    "weak_focus_or_paste_signal"
  ], {
    optional_process_event_profile: "paste_plus_focus_context_repeated",
    engagement_items: [
      engagement(true, "C", strongReason, 40_000, { event_counts: { paste_detected: 1, window_blur: 1, typing_activity_summary: 1 } }),
      engagement(true, "C", adequateReason, 42_000, { event_counts: { page_visibility_hidden: 1, typing_activity_summary: 1 } }),
      engaged()
    ]
  }),
  withVariation("ai_signal_insufficient_evidence", "single_weak_signal", "single weak process signal remains insufficient", [
    "insufficient_ai_signal",
    "weak_focus_or_paste_signal"
  ], {
    optional_process_event_profile: "single_focus_or_paste_signal",
    engagement_items: [
      engagement(true, "C", strongReason, 40_000, { event_counts: { paste_detected: 1, typing_activity_summary: 1 } }),
      engaged(),
      engaged()
    ]
  }),
  withVariation("confidence_calibration_negative_control", "diagnostic_preference", "student prefers diagnostic clarification", [
    "chooses_diagnostic_clarification",
    "chooses_alternative",
    "uncertainty"
  ], {
    student_choice: "chose_alternative",
    optional_scripted_content_or_procedural_question: "Can we first figure out what theta means?"
  }),
  withVariation("consolidation_transfer_negative_control", "answer_changed", "student changes an answer during review", [
    "answer_changed",
    "edit_revision"
  ], {
    optional_edit_or_revision_behavior: "changes_selected_answer_during_package_review",
    scripted_student_response_package: [
      ...baseScenario("consolidation_transfer_negative_control").scripted_student_response_package.slice(0, 2),
      ability("A", "incorrect", "Medium", "I changed away from C because I still think item difficulty moves theta.")
    ],
    scripted_tempting_option_pattern: [null, null, "C"]
  }),
  withVariation("student_choice_accepts_recommendation", "accepts_recommendation", "student explicitly accepts recommendation", [
    "accepts_recommendation",
    "student_choice"
  ], {
    student_choice: "accepted_recommendation"
  }),
  withVariation("student_choice_selects_alternative", "alternative_preference", "student chooses an allowed alternative", [
    "chooses_alternative",
    "procedural_question"
  ], {
    student_choice: "chose_alternative",
    optional_scripted_content_or_procedural_question: "Can I pick the alternative focus instead?"
  }),
  withVariation("student_choice_moves_on", "move_on_preference", "student chooses to move on", [
    "moves_on",
    "move_on_question"
  ], {
    student_choice: "moved_on",
    optional_scripted_content_or_procedural_question: "I want to move on after this."
  })
];

export const profileFormativeScenarios: ProfileFormativeScenario[] = [
  ...coreProfileFormativeScenarios,
  ...profileFormativeScenarioVariations
];


export function getScenarioById(scenarioId: string) {
  return profileFormativeScenarios.find((scenario) => scenario.scenario_id === scenarioId) ?? null;
}

export function selectedScenariosFromList(scenarioList?: string | null) {
  if (!scenarioList?.trim()) return profileFormativeScenarios;
  const ids = new Set(scenarioList.split(",").map((id) => id.trim()).filter(Boolean));
  return profileFormativeScenarios.filter((scenario) => ids.has(scenario.scenario_id));
}

export function buildScenarioInputs(scenario: ProfileFormativeScenario): {
  profile_input: ProfileIntegrationAgentInput;
  formative_input_from_profile: (packet: ProfileIntegrationInterpretationPacketV1) => FormativeValueAgentInput;
} {
  const itemEvidence = scenario.scripted_student_response_package.map((item, index) =>
    buildItemAbilityEvidence({
      item_public_id: `${scenario.scenario_id}_item_${index + 1}`,
      metadata,
      selected_option: item.selected_option,
      correctness: item.correctness,
      confidence: item.confidence,
      reasoning_text: item.reasoning_text,
      no_tempting_option: item.no_tempting_option ?? true,
      tempting_option: item.tempting_option ?? null,
      total_item_time_ms: item.total_item_time_ms ?? 45_000
    })
  );
  const conceptSummary = summarizeConceptAbilityEvidence(itemEvidence);
  const abilityPacket = AbilityEvidencePacketV1Schema.parse({
    schema_version: ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION,
    session_public_id: `sess_${scenario.scenario_id}`,
    student_public_id: `student_${scenario.scenario_id}`,
    assessment_public_id: "assessment_profile_formative_scenario_matrix",
    concept_unit_id: "concept_theta_invariance",
    generated_at: new Date().toISOString(),
    source_response_package_ids: [`pkg_${scenario.scenario_id}`],
    item_evidence: itemEvidence,
    concept_level_summary: conceptSummary,
    student_safe_projection: projectStudentSafeAbilityStatus(conceptSummary),
    teacher_research_summary: {
      safe_internal_summary: `Synthetic scenario ${scenario.scenario_id} ability packet.`,
      evidence_trace: itemEvidence.map((item) => `${item.item_public_id}:${item.ability_signal_category}`)
    }
  });
  const engagementItems = scenario.engagement_items.map((item, index) =>
    buildItemEngagementEvidence({
      item_public_id: `${scenario.scenario_id}_item_${index + 1}`,
      response_present: item.response_present,
      selected_option: item.selected_option,
      reasoning_text: item.reasoning_text,
      item_response_time_ms: item.item_response_time_ms,
      revision_count: item.revision_count ?? 0,
      event_counts: item.event_counts ?? {},
      process_instrumentation_available: item.process_instrumentation_available ?? true
    })
  );
  const engagementSummary = summarizeSessionEngagement(engagementItems);
  const engagementPacket = EngagementEvidencePacketV1Schema.parse({
    schema_version: ENGAGEMENT_EVIDENCE_PACKET_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    session_public_id: abilityPacket.session_public_id,
    student_public_id: abilityPacket.student_public_id,
    assessment_public_id: abilityPacket.assessment_public_id,
    concept_unit_id: abilityPacket.concept_unit_id,
    source_response_package_refs: [{
      package_type: "initial_concept_unit_response_package",
      created_at: new Date().toISOString()
    }],
    item_engagement_evidence: engagementItems,
    session_engagement_summary: engagementSummary,
    engagement_rule_config: ENGAGEMENT_RULE_CONFIG_V1,
    process_data_inventory: {
      observed_event_counts: Object.fromEntries(
        Object.entries(
          scenario.engagement_items.reduce<Record<string, number>>((acc, item) => {
            for (const [key, value] of Object.entries(item.event_counts ?? {})) {
              acc[key] = (acc[key] ?? 0) + value;
            }
            return acc;
          }, {})
        )
      ),
      supported_event_types: Object.keys(
        scenario.engagement_items.reduce<Record<string, number>>((acc, item) => {
          for (const key of Object.keys(item.event_counts ?? {})) acc[key] = 1;
          return acc;
        }, {})
      ),
      missing_or_unobserved_event_types: [],
      instrumentation_limitations: scenario.optional_process_event_profile
        ? [scenario.optional_process_event_profile]
        : []
    },
    safety_check: {
      no_misconduct_label: true,
      no_confirmed_ai_use_label: true,
      no_raw_reasoning: true,
      no_raw_process_payloads: true,
      no_answer_keys: true
    }
  });

  return {
    profile_input: buildProfileIntegrationAgentInput({
      ability_packet: abilityPacket,
      engagement_packet: engagementPacket
    }),
    formative_input_from_profile: (packet) =>
      buildFormativeValueAgentInput({
        profile_integration_packet: packet
      })
  };
}

export function allowedOutcomes<T extends string>(
  target: T,
  allowed?: T[]
) {
  return new Set([target, ...(allowed ?? [])]);
}

export function applyScenarioChoice<T extends {
  student_choice_state: {
    recommendation_presented: boolean;
    student_choice: string;
    selected_value: string | null;
    student_override: boolean;
    chosen_at: string | null;
  };
  alternative_values: Array<{ value: FormativeValue }>;
  primary_value: FormativeValue;
}>(packet: T, scenario: ProfileFormativeScenario): T {
  const choice = scenario.student_choice ?? "not_chosen";
  if (choice === "not_chosen") return packet;
  const selectedValue =
    choice === "accepted_recommendation"
      ? packet.primary_value
      : choice === "chose_alternative"
        ? packet.alternative_values[0]?.value ?? packet.primary_value
        : "move_on";

  return {
    ...packet,
    student_choice_state: {
      recommendation_presented: true,
      student_choice: choice,
      selected_value: selectedValue,
      student_override: choice === "chose_alternative",
      chosen_at: new Date().toISOString()
    }
  };
}

export function safeScenarioDescription(scenario: ProfileFormativeScenario) {
  return {
    scenario_id: scenario.scenario_id,
    scenario_name: scenario.scenario_name,
    trial_variant: scenario.trial_variant ?? "core",
    base_scenario_id: scenario.base_scenario_id ?? null,
    variation_id: scenario.variation_id ?? null,
    variation_description: scenario.variation_description ?? null,
    variation_tags: scenario.variation_tags ?? [],
    targets: {
      profile_integration_pattern: scenario.target_profile_integration_pattern,
      student_facing_status: scenario.target_student_facing_status,
      engagement_category: scenario.target_engagement_category,
      ai_assistance_signal: scenario.target_ai_assistance_signal,
      formative_value: scenario.target_formative_value
    },
    scripted_confidence_pattern: scenario.scripted_confidence_pattern,
    scripted_tempting_option_pattern: scenario.scripted_tempting_option_pattern,
    response_summary: scenario.scripted_student_response_package.map((item, index) => ({
      item_index: index + 1,
      selected_option_present: Boolean(item.selected_option),
      confidence: item.confidence,
      reasoning_length_band:
        !item.reasoning_text
          ? "missing"
          : item.reasoning_text.length < 20
            ? "short"
            : item.reasoning_text.length < 90
              ? "medium"
              : "long",
      tempting_option_present: Boolean(item.tempting_option)
    })),
    optional_scripted_content_or_procedural_question: scenario.optional_scripted_content_or_procedural_question ?? null,
    optional_edit_or_revision_behavior: scenario.optional_edit_or_revision_behavior ?? null,
    optional_process_event_profile: scenario.optional_process_event_profile ?? null,
    expected_safety_constraints: scenario.expected_safety_constraints,
    rationale: scenario.rationale
  };
}
