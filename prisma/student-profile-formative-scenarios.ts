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
  | "chooses_diagnostic_clarification"
  | "chooses_independent_verification"
  | "chooses_reasoning_refinement"
  | "prefers_consolidation"
  | "boundary_case";

export type ProfileFormativeScenario = {
  scenario_id: string;
  scenario_name: string;
  scenario_group?: string;
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
  scripted_selected_options?: Array<string | null>;
  optional_scripted_content_or_procedural_question?: string;
  optional_edit_or_revision_behavior?: string;
  optional_process_event_profile?: string;
  student_choice?: "not_chosen" | "accepted_recommendation" | "chose_alternative" | "moved_on";
  scripted_student_choice_selected_value?: FormativeValue | "move_on";
  strict_outcomes?: string[];
  non_evaluated_outcomes?: string[];
  engagement_items: EngagementScript[];
  expected_safety_constraints: string[];
  rationale: string;
  why_target_outcome_is_reasonable?: string;
  defensible_alternative?: string;
  real_failure_criteria?: string;
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

const scenarioGroupByPattern: Record<ProfilePattern, string> = {
  stable_understanding: "stable_understanding",
  developing_understanding: "developing_understanding",
  likely_knowledge_gap: "knowledge_gap",
  likely_misconception: "misconception",
  mixed_or_conflicting_evidence: "mixed_conflicting_evidence",
  insufficient_evidence: "insufficient_evidence"
};

function uniqueValues<T>(values: T[]) {
  return [...new Set(values.filter((value): value is T => value !== undefined && value !== null))];
}

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
    expected_allowed_outcomes: {
      formative_values: ["independent_understanding_verification"]
    },
    scripted_student_response_package: [
      ability("C", "correct", "High", strongReason),
      ability("C", "correct", "High", adequateReason),
      ability("C", "correct", "Medium", strongReason)
    ],
    scripted_confidence_pattern: ["High", "High", "Medium"],
    scripted_tempting_option_pattern: [null, null, null],
    engagement_items: [engaged(), engaged(), engaged()],
    expected_safety_constraints: safetyConstraints,
    rationale: "Consistently target-aligned responses with adequate reasoning should be ready for consolidation. Independent verification is accepted as a conservative boundary alternative when live interpretation keeps the student-facing status safe."
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
      profile_integration_patterns: ["likely_knowledge_gap", "insufficient_evidence"],
      student_facing_statuses: ["Needs more work", "Still developing"],
      engagement_categories: ["moderately_engaged", "disengaged", "engaged"]
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
    rationale: "Low confidence is appropriate here because the primary evidence is a conceptual gap. Insufficient evidence is accepted as a conservative boundary alternative when sparse low-confidence evidence is not interpreted strongly enough for a knowledge-gap pattern."
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
      profile_integration_patterns: ["likely_misconception", "mixed_or_conflicting_evidence"],
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
    rationale: "High confidence with misconception evidence should stay conceptual, not primary calibration. Content-question variants may reasonably read as mixed evidence while keeping diagnostic clarification as the target value."
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
      formative_values: ["independent_understanding_verification", "reasoning_refinement", "diagnostic_clarification"]
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
      student_facing_statuses: ["Mostly understood", "Still developing"],
      formative_values: ["confidence_calibration", "independent_understanding_verification", "consolidation_and_transfer"]
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
    rationale: "Adequate or strong understanding with low confidence is the clean calibration case. If live evidence confidence is only medium, independent verification or consolidation are accepted conservative alternatives."
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
      profile_integration_patterns: ["insufficient_evidence", "likely_knowledge_gap", "mixed_or_conflicting_evidence", "developing_understanding"],
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
    rationale: "Rapid sparse behavior is internal reliability context and must not appear in student-facing text. Very low-information evidence targets insufficient evidence, while a low-confidence developing interpretation is accepted as a conservative boundary alternative when student-facing text remains safe."
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
      formative_values: ["independent_understanding_verification", "reasoning_refinement", "diagnostic_clarification"],
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
    rationale: "Mixed short and meaningful reasoning should remain cautious. Diagnostic clarification is accepted when the live value focuses on clarifying the uncertain concept rather than verifying independence."
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
    expected_allowed_outcomes: {
      formative_values: ["independent_understanding_verification"]
    },
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
      formative_values: ["reasoning_refinement", "independent_understanding_verification", "consolidation_and_transfer"]
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
    scenario_group: updates.scenario_group ?? base.scenario_group ?? scenarioGroupByPattern[updates.target_profile_integration_pattern ?? base.target_profile_integration_pattern],
    trial_variant: "variation",
    base_scenario_id: scenarioId,
    variation_id: variationId,
    variation_description: description,
    variation_tags: tags,
    expected_allowed_outcomes: {
      ...base.expected_allowed_outcomes,
      ...updates.expected_allowed_outcomes,
      profile_integration_patterns: uniqueValues([
        ...(base.expected_allowed_outcomes?.profile_integration_patterns ?? []),
        ...(updates.expected_allowed_outcomes?.profile_integration_patterns ?? [])
      ]),
      student_facing_statuses: uniqueValues([
        ...(base.expected_allowed_outcomes?.student_facing_statuses ?? []),
        ...(updates.expected_allowed_outcomes?.student_facing_statuses ?? [])
      ]),
      engagement_categories: uniqueValues([
        ...(base.expected_allowed_outcomes?.engagement_categories ?? []),
        ...(updates.expected_allowed_outcomes?.engagement_categories ?? [])
      ]),
      ai_assistance_signals: uniqueValues([
        ...(base.expected_allowed_outcomes?.ai_assistance_signals ?? []),
        ...(updates.expected_allowed_outcomes?.ai_assistance_signals ?? [])
      ]),
      formative_values: uniqueValues([
        ...(base.expected_allowed_outcomes?.formative_values ?? []),
        ...(updates.expected_allowed_outcomes?.formative_values ?? [])
      ])
    },
    strict_outcomes: updates.strict_outcomes ?? base.strict_outcomes ?? [
      "student_facing_safety",
      "schema_validation",
      "student_choice_policy"
    ],
    non_evaluated_outcomes: updates.non_evaluated_outcomes ?? base.non_evaluated_outcomes ?? [
      "activity_planning",
      "activity_generation",
      "item_scoring"
    ],
    rationale: `${base.rationale} Variation coverage: ${description}.`,
    why_target_outcome_is_reasonable:
      updates.why_target_outcome_is_reasonable ??
      base.why_target_outcome_is_reasonable ??
      `${base.target_profile_integration_pattern} and ${base.target_formative_value} follow from the scripted response package and process context.`,
    defensible_alternative:
      updates.defensible_alternative ??
      base.defensible_alternative ??
      "A conservative adjacent profile or formative value is defensible only when the evidence remains ambiguous and student-facing safety holds.",
    real_failure_criteria:
      updates.real_failure_criteria ??
      base.real_failure_criteria ??
      "A real failure requires unsafe student-facing text, invalid schema output, unsupported high-certainty claims, or an outcome not supported by the scripted evidence."
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

type ExtraVariationStyle =
  | "stable_detailed"
  | "stable_tempting"
  | "stable_edit"
  | "stable_multilingual"
  | "stable_typo"
  | "low_confidence_correct"
  | "stable_pause"
  | "partial_medium"
  | "correct_weak"
  | "wrong_partial"
  | "edit_improved"
  | "partial_multilingual"
  | "fragile_tempting"
  | "procedural_partial"
  | "typo_partial"
  | "answer_changed_correct"
  | "idk_clear"
  | "low_conf_normal"
  | "missing_key"
  | "very_short"
  | "basic_question"
  | "correct_no_reason"
  | "wrong_uncertain"
  | "repeated_idk"
  | "help_no_content"
  | "misconception_a"
  | "misconception_b"
  | "misconception_question"
  | "misconception_tempting"
  | "misconception_edit"
  | "misconception_typo"
  | "misconception_multilingual"
  | "overconfident_b"
  | "low_conf_misconception"
  | "correct_wrong_reason"
  | "wrong_partly_correct"
  | "confidence_conflict"
  | "option_tempting_conflict"
  | "multilingual_uncertainty"
  | "answer_changed_mid"
  | "improved_unstable"
  | "high_low_conf_mix"
  | "selected_c_tempted_a"
  | "sparse_not_rapid"
  | "placeholder_extra"
  | "skipped_reasoning"
  | "procedural_little"
  | "incomplete_like"
  | "too_short"
  | "no_process"
  | "lowinfo_typo"
  | "rapid_sparse_extra"
  | "moderate_process_mix"
  | "normal_timing"
  | "long_pause"
  | "one_focus"
  | "external_convergent"
  | "typing_mismatch"
  | "long_idle_quick";

type ExtraVariationSpec = {
  base: string;
  id: string;
  description: string;
  tags: ProfileFormativeVariationTag[];
  style?: ExtraVariationStyle;
  choice?: ProfileFormativeScenario["student_choice"];
  selected_choice_value?: FormativeValue | "move_on";
  question?: string;
  expected_allowed_outcomes?: ProfileFormativeScenario["expected_allowed_outcomes"];
};

function styleUpdates(style: ExtraVariationStyle | undefined, base: ProfileFormativeScenario): Partial<ProfileFormativeScenario> {
  switch (style) {
    case "stable_detailed":
      return {
        scripted_student_response_package: withReasoning(base, [
          "Theta is the person's location on the linked latent trait scale, so item difficulty changes how hard an item is rather than changing who the person is.",
          "The item parameters describe the item response curve, while theta is the person's position on the shared scale.",
          "A harder item can change the probability of a correct response, but it does not redefine the person's theta."
        ])
      };
    case "stable_tempting":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "High", strongReason, { no_tempting_option: false, tempting_option: "A" }),
          ability("C", "correct", "High", adequateReason),
          ability("C", "correct", "Medium", strongReason, { no_tempting_option: false, tempting_option: "B" })
        ],
        scripted_tempting_option_pattern: ["A", null, "B"],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["stable_understanding", "developing_understanding", "mixed_or_conflicting_evidence"],
          student_facing_statuses: ["Mostly understood", "Still developing"],
          formative_values: ["consolidation_and_transfer", "independent_understanding_verification", "reasoning_refinement", "confidence_calibration"]
        }
      };
    case "stable_edit":
      return {
        optional_edit_or_revision_behavior: "initial uncertainty revised into aligned explanation",
        scripted_student_response_package: [
          ability("C", "correct", "Medium", adequateReason),
          ability("C", "correct", "High", "I revised my explanation: item difficulty affects items, while theta stays the person location."),
          ability("C", "correct", "High", strongReason)
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["stable_understanding", "developing_understanding"],
          formative_values: ["consolidation_and_transfer", "reasoning_refinement", "independent_understanding_verification", "confidence_calibration"]
        }
      };
    case "stable_multilingual":
      return {
        scripted_student_response_package: withReasoning(base, [
          "Theta 是人的位置 on the latent scale, not the item difficulty.",
          "Item parameters describe questions; theta describes the learner/person.",
          "Harder items change probability, 不是直接改变 theta."
        ])
      };
    case "stable_typo":
      return {
        scripted_student_response_package: withReasoning(base, [
          "Theta is persn abiltiy locaton, not item dificulty.",
          "Item paramaters are about the item, theta is about the persn.",
          "A hardr item changes chance of correct answr but not the meaning of theta."
        ])
      };
    case "low_confidence_correct":
      return {
        expected_allowed_outcomes: {
          formative_values: ["confidence_calibration", "independent_understanding_verification", "consolidation_and_transfer"]
        }
      };
    case "stable_pause":
      return {
        optional_process_event_profile: "pause_resume_without_quality_loss",
        engagement_items: [
          engagement(true, "C", strongReason, 65_000, { revision_count: 1, event_counts: { long_pause: 1, typing_activity_summary: 1, response_quality_adequate_or_usable: 1 } }),
          engaged(),
          engaged()
        ]
      };
    case "partial_medium":
      return {
        scripted_student_response_package: withReasoning(base, [
          "Theta is probably about the person, but I do not fully see the item part.",
          "The item has difficulty and theta is kind of separate.",
          "I know theta is on a scale, but I am missing part of the explanation."
        ]),
        expected_allowed_outcomes: {
          profile_integration_patterns: ["developing_understanding", "stable_understanding"],
          student_facing_statuses: ["Still developing", "Mostly understood"],
          formative_values: ["reasoning_refinement", "consolidation_and_transfer", "independent_understanding_verification"]
        }
      };
    case "correct_weak":
      return {
        scripted_student_response_package: withReasoning(base, [
          "C seems right.",
          "It is about the person somehow.",
          "I remember theta is ability."
        ]),
        expected_allowed_outcomes: {
          profile_integration_patterns: ["developing_understanding", "likely_knowledge_gap", "mixed_or_conflicting_evidence", "stable_understanding"],
          student_facing_statuses: ["Still developing", "Mostly understood"],
          formative_values: ["reasoning_refinement", "diagnostic_clarification", "independent_understanding_verification", "consolidation_and_transfer"]
        }
      };
    case "wrong_partial":
      return {
        scripted_student_response_package: [
          ability("A", "incorrect", "Medium", "Theta is about the person, but I still think difficulty decides it."),
          ability("C", "correct", "Medium", partialReason),
          ability("B", "incorrect", "Low", "Harder tests might move the estimate, but I am unsure.")
        ],
        scripted_confidence_pattern: ["Medium", "Medium", "Low"],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["developing_understanding", "mixed_or_conflicting_evidence", "likely_knowledge_gap"],
          formative_values: ["reasoning_refinement", "diagnostic_clarification", "independent_understanding_verification"]
        }
      };
    case "edit_improved":
      return {
        optional_edit_or_revision_behavior: "student expands vague reasoning after review",
        scripted_student_response_package: withReasoning(base, [
          partialReason,
          "At first I only said it seemed right, then I added that item difficulty is about the item, not the person's theta.",
          adequateReason
        ]),
        expected_allowed_outcomes: {
          profile_integration_patterns: ["developing_understanding", "stable_understanding"],
          formative_values: ["reasoning_refinement", "consolidation_and_transfer", "independent_understanding_verification"]
        }
      };
    case "partial_multilingual":
      return {
        scripted_student_response_package: withReasoning(base, [
          "Theta 是 about person ability, but item difficulty 我还不太清楚.",
          "I think parameters are for the item, 但是 connection is fuzzy.",
          "Theta is person scale location, I think."
        ]),
        expected_allowed_outcomes: {
          profile_integration_patterns: ["developing_understanding", "stable_understanding"],
          student_facing_statuses: ["Still developing", "Mostly understood"],
          formative_values: ["reasoning_refinement", "consolidation_and_transfer", "independent_understanding_verification"]
        }
      };
    case "fragile_tempting":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "Medium", partialReason, { no_tempting_option: false, tempting_option: "A" }),
          ability("C", "correct", "Medium", vagueReason, { no_tempting_option: false, tempting_option: "B" }),
          ability("C", "correct", "Medium", adequateReason)
        ],
        scripted_tempting_option_pattern: ["A", "B", null],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["developing_understanding", "mixed_or_conflicting_evidence"],
          formative_values: ["reasoning_refinement", "independent_understanding_verification", "diagnostic_clarification"]
        }
      };
    case "procedural_partial":
      return {
        optional_scripted_content_or_procedural_question: "Should I answer in a full sentence?",
        expected_allowed_outcomes: {
          formative_values: ["reasoning_refinement", "independent_understanding_verification", "diagnostic_clarification"]
        }
      };
    case "typo_partial":
      return {
        scripted_student_response_package: withReasoning(base, [
          "Theta is persn on scal but I dont get item dificlty.",
          "Item paramters maybe separate but im not fully shure.",
          "It is abot person abiltiy, I think."
        ])
      };
    case "answer_changed_correct":
      return {
        optional_edit_or_revision_behavior: "wrong answer changed to correct with incomplete reasoning",
        scripted_student_response_package: [
          ability("C", "correct", "Medium", partialReason),
          ability("C", "correct", "Medium", vagueReason),
          ability("C", "correct", "Medium", "I changed to C, but I am still not fully sure why.")
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["developing_understanding", "mixed_or_conflicting_evidence", "stable_understanding"],
          student_facing_statuses: ["Still developing", "Mostly understood"],
          formative_values: ["reasoning_refinement", "independent_understanding_verification", "diagnostic_clarification"]
        }
      };
    case "idk_clear":
      return {
        scripted_student_response_package: withReasoning(base, [
          "I don't know this yet.",
          "I am guessing.",
          "I do not know how theta and item difficulty differ."
        ])
      };
    case "low_conf_normal":
      return {
        engagement_items: [
          engagement(true, "E", idkReason, 45_000, { event_counts: { typing_activity_summary: 1 } }),
          engagement(true, "A", "I am not sure.", 42_000, { event_counts: { typing_activity_summary: 1 } }),
          engagement(true, "E", "No idea yet.", 44_000, { event_counts: { typing_activity_summary: 1 } })
        ],
        expected_allowed_outcomes: {
          engagement_categories: ["engaged", "moderately_engaged", "disengaged"]
        }
      };
    case "missing_key":
      return {
        scripted_student_response_package: [
          ability("A", "incorrect", "Low", "I think harder items mean lower ability."),
          ability("B", "incorrect", "Low", "I am missing what theta means."),
          ability("A", "incorrect", "Low", "It might just be difficulty.")
        ]
      };
    case "very_short":
      return {
        scripted_student_response_package: withReasoning(base, ["idk", "guess", "not sure"])
      };
    case "basic_question":
      return {
        optional_scripted_content_or_procedural_question: "What is theta supposed to mean?",
        expected_allowed_outcomes: {
          formative_values: ["diagnostic_clarification", "independent_understanding_verification"]
        }
      };
    case "correct_no_reason":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "Medium", ""),
          ability("C", "correct", "Low", "not sure"),
          ability("C", "correct", "Low", "I guessed")
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_knowledge_gap", "insufficient_evidence", "developing_understanding"],
          formative_values: ["diagnostic_clarification", "independent_understanding_verification", "reasoning_refinement"]
        }
      };
    case "wrong_uncertain":
      return {
        scripted_student_response_package: [
          ability("A", "incorrect", "Low", "I am unsure and think difficulty might determine ability."),
          ability("B", "incorrect", "Low", "Maybe hard forms change theta."),
          ability("D", "incorrect", "Low", "I am not sure; discrimination sounds related.")
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_knowledge_gap", "developing_understanding", "insufficient_evidence"],
          student_facing_statuses: ["Needs more work", "Still developing"]
        }
      };
    case "repeated_idk":
      return {
        expected_allowed_outcomes: {
          engagement_categories: ["disengaged", "moderately_engaged"],
          formative_values: ["independent_understanding_verification", "diagnostic_clarification"]
        }
      };
    case "help_no_content":
      return {
        optional_scripted_content_or_procedural_question: "Can you tell me the answer?",
        scripted_student_response_package: withReasoning(base, [
          "I need help with the concept.",
          "I cannot explain it.",
          "I am stuck."
        ])
      };
    case "misconception_a":
      return {
        scripted_student_response_package: [
          ability("A", "incorrect", "High", "Item difficulty determines the person's ability because harder items lower theta."),
          ability("A", "incorrect", "High", misconceptionReason),
          ability("C", "correct", "Medium", partialReason, { no_tempting_option: false, tempting_option: "A" })
        ],
        scripted_tempting_option_pattern: [null, null, "A"],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_misconception", "mixed_or_conflicting_evidence", "developing_understanding"]
        }
      };
    case "misconception_b":
      return {
        scripted_student_response_package: [
          ability("B", "incorrect", "High", "Theta changes because the hard form moves the person's scale location."),
          ability("B", "incorrect", "High", "Different item difficulties make theta different."),
          ability("C", "correct", "Medium", partialReason)
        ]
      };
    case "misconception_question":
      return {
        optional_scripted_content_or_procedural_question: "Is theta just the difficulty of the item?",
        scripted_student_response_package: withReasoning(base, [
          "I think yes, theta is basically how hard the item is.",
          "Hard forms make theta lower.",
          "Item difficulty seems to define person ability."
        ])
      };
    case "misconception_tempting":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "Medium", adequateReason, { no_tempting_option: false, tempting_option: "A" }),
          ability("A", "incorrect", "High", misconceptionReason),
          ability("C", "correct", "Medium", partialReason, { no_tempting_option: false, tempting_option: "B" })
        ],
        scripted_tempting_option_pattern: ["A", null, "B"],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_misconception", "mixed_or_conflicting_evidence", "developing_understanding"],
          formative_values: ["diagnostic_clarification", "reasoning_refinement", "independent_understanding_verification"]
        }
      };
    case "misconception_edit":
      return {
        optional_edit_or_revision_behavior: "student edits from item-difficulty misconception toward partial separation",
        scripted_student_response_package: [
          ability("A", "incorrect", "High", misconceptionReason),
          ability("C", "correct", "Medium", "I edited this: theta is the person, item difficulty is separate, but I am still shaky."),
          ability("C", "correct", "Medium", partialReason)
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_misconception", "developing_understanding", "mixed_or_conflicting_evidence"],
          formative_values: ["diagnostic_clarification", "reasoning_refinement", "independent_understanding_verification"]
        }
      };
    case "misconception_typo":
      return {
        scripted_student_response_package: withReasoning(base, [
          "hardr items make the persn theta lower becuase dificulty is abiltiy",
          "a hard form chnages theta locaton",
          "I think item discrimnation changes what theta means"
        ])
      };
    case "misconception_multilingual":
      return {
        scripted_student_response_package: withReasoning(base, [
          "我觉得 harder item 会 change theta because difficulty decides ability.",
          "Theta changes when item difficulty changes, 我是这样理解的.",
          "Discrimination maybe changes the meaning of theta."
        ]),
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_misconception", "mixed_or_conflicting_evidence", "developing_understanding"]
        }
      };
    case "overconfident_b":
      return {
        scripted_student_response_package: [
          ability("B", "incorrect", "High", "A harder test form changes theta, so B is definitely right."),
          ability("B", "incorrect", "High", "The item form controls where the person is on the scale."),
          ability("B", "incorrect", "High", "Theta should move when item difficulty moves.")
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_knowledge_gap", "likely_misconception", "developing_understanding"],
          formative_values: ["diagnostic_clarification", "reasoning_refinement"]
        }
      };
    case "low_conf_misconception":
      return {
        scripted_student_response_package: [
          ability("A", "incorrect", "Low", "I think difficulty determines ability, but I am not confident."),
          ability("B", "incorrect", "Low", "Maybe hard forms change theta."),
          ability("C", "correct", "Low", "I am unsure; theta might be person ability.")
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["likely_misconception", "likely_knowledge_gap", "developing_understanding", "mixed_or_conflicting_evidence"],
          formative_values: ["diagnostic_clarification", "reasoning_refinement", "independent_understanding_verification"]
        }
      };
    case "correct_wrong_reason":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "High", "C is right because item difficulty determines theta."),
          ability("C", "correct", "Medium", vagueReason),
          ability("A", "incorrect", "Medium", partialReason)
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["mixed_or_conflicting_evidence", "developing_understanding", "likely_misconception"],
          formative_values: ["independent_understanding_verification", "diagnostic_clarification", "reasoning_refinement"]
        }
      };
    case "wrong_partly_correct":
      return {
        scripted_student_response_package: [
          ability("A", "incorrect", "Medium", "Theta is about the person, but I think difficulty still determines it."),
          ability("C", "correct", "Medium", adequateReason),
          ability("B", "incorrect", "Low", "Harder items might move theta, but I am unsure.")
        ]
      };
    case "confidence_conflict":
      return {
        scripted_confidence_pattern: ["High", "Low", "High"],
        scripted_student_response_package: [
          ability("C", "correct", "High", vagueReason),
          ability("A", "incorrect", "Low", adequateReason),
          ability("C", "correct", "High", partialReason)
        ],
        expected_allowed_outcomes: {
          formative_values: ["independent_understanding_verification", "reasoning_refinement", "diagnostic_clarification"]
        }
      };
    case "option_tempting_conflict":
      return {
        scripted_student_response_package: [
          ability("A", "incorrect", "Medium", partialReason, { no_tempting_option: false, tempting_option: "C" }),
          ability("C", "correct", "Medium", vagueReason, { no_tempting_option: false, tempting_option: "A" }),
          ability("C", "correct", "Low", adequateReason)
        ],
        scripted_tempting_option_pattern: ["C", "A", null]
      };
    case "multilingual_uncertainty":
      return {
        scripted_student_response_package: withReasoning(base, [
          "I choose C, 但我不确定 because difficulty still feels connected.",
          "Maybe A because item difficulty seems important, but theta 是 person.",
          "Theta is person ability location, but my explanation is not stable."
        ]),
        expected_allowed_outcomes: {
          formative_values: ["independent_understanding_verification", "reasoning_refinement", "diagnostic_clarification"]
        }
      };
    case "answer_changed_mid":
      return {
        optional_edit_or_revision_behavior: "student changes between A and C during package review",
        scripted_student_response_package: [
          ability("C", "correct", "Medium", adequateReason),
          ability("A", "incorrect", "Medium", "I switched because I still think difficulty matters."),
          ability("C", "correct", "Medium", "I switched back to C but need to explain better.")
        ]
      };
    case "improved_unstable":
      return {
        optional_edit_or_revision_behavior: "student improves one answer while leaving another conflict",
        scripted_student_response_package: [
          ability("C", "correct", "Medium", adequateReason),
          ability("A", "incorrect", "Medium", "I still think the harder item changes the ability estimate."),
          ability("C", "correct", "Medium", "I edited to say theta is person ability, but I am still unsure.")
        ]
      };
    case "high_low_conf_mix":
      return {
        scripted_confidence_pattern: ["High", "Low", "Medium"],
        scripted_student_response_package: [
          ability("C", "correct", "High", adequateReason),
          ability("A", "incorrect", "Low", partialReason),
          ability("C", "correct", "Medium", vagueReason)
        ],
        expected_allowed_outcomes: {
          formative_values: ["independent_understanding_verification", "reasoning_refinement", "diagnostic_clarification"]
        }
      };
    case "selected_c_tempted_a":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "Medium", adequateReason, { no_tempting_option: false, tempting_option: "A" }),
          ability("C", "correct", "Medium", partialReason, { no_tempting_option: false, tempting_option: "A" }),
          ability("C", "correct", "Low", vagueReason, { no_tempting_option: false, tempting_option: "A" })
        ],
        scripted_tempting_option_pattern: ["A", "A", "A"]
      };
    case "sparse_not_rapid":
      return {
        engagement_items: [
          sparse("C", "maybe", 45_000),
          sparse("A", "not sure", 47_000),
          sparse("E", "idk", 49_000)
        ],
        expected_allowed_outcomes: {
          engagement_categories: ["insufficient_evidence", "moderately_engaged"],
          student_facing_statuses: ["Still developing", "Needs more work"],
          ai_assistance_signals: ["insufficient_evidence", "none_indicated"],
          formative_values: ["independent_understanding_verification", "diagnostic_clarification"]
        }
      };
    case "placeholder_extra":
      return {
        scripted_student_response_package: withReasoning(base, ["same as before", "same", "same"])
      };
    case "skipped_reasoning":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "Low", null),
          ability("A", "incorrect", "Low", ""),
          ability("E", "not_scored", "Low", null)
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["insufficient_evidence", "likely_knowledge_gap"],
          formative_values: ["independent_understanding_verification", "diagnostic_clarification"]
        }
      };
    case "procedural_little":
      return {
        optional_scripted_content_or_procedural_question: "Do I need to write more?",
        scripted_student_response_package: withReasoning(base, [
          "I don't know what format to use.",
          "not sure",
          "maybe"
        ])
      };
    case "incomplete_like":
      return {
        scripted_student_response_package: [
          ability("C", "correct", "Medium", adequateReason),
          ability(null, "not_scored", null, null),
          ability("E", "not_scored", "Low", null)
        ],
        expected_allowed_outcomes: {
          profile_integration_patterns: ["insufficient_evidence", "developing_understanding", "mixed_or_conflicting_evidence"],
          formative_values: ["independent_understanding_verification", "diagnostic_clarification", "reasoning_refinement"]
        }
      };
    case "too_short":
      return {
        scripted_student_response_package: withReasoning(base, ["C", "A", "?"])
      };
    case "no_process":
      return {
        engagement_items: [
          engagement(true, "C", vagueReason, null, { process_instrumentation_available: false, event_counts: {} }),
          engagement(true, "A", "not sure", null, { process_instrumentation_available: false, event_counts: {} }),
          engagement(true, "E", "idk", null, { process_instrumentation_available: false, event_counts: {} })
        ],
        expected_allowed_outcomes: {
          ai_assistance_signals: ["insufficient_evidence", "none_indicated"],
          engagement_categories: ["insufficient_evidence", "moderately_engaged"]
        }
      };
    case "lowinfo_typo":
      return {
        scripted_student_response_package: withReasoning(base, ["idk abt theta", "not shure", "i gess"])
      };
    case "rapid_sparse_extra":
      return {
        expected_allowed_outcomes: {
          engagement_categories: ["disengaged", "moderately_engaged"],
          formative_values: ["independent_understanding_verification", "diagnostic_clarification"]
        }
      };
    case "moderate_process_mix":
      return {
        optional_process_event_profile: "moderate_timing_with_some_short_reasoning"
      };
    case "normal_timing":
      return {
        engagement_items: [engaged(), engaged(), engaged()]
      };
    case "long_pause":
      return {
        optional_process_event_profile: "long_idle_then_resume",
        engagement_items: [
          engagement(true, "C", adequateReason, 90_000, { event_counts: { long_pause: 1, typing_activity_summary: 1 } }),
          moderate("A", partialReason),
          moderate("C", vagueReason)
        ]
      };
    case "one_focus":
      return {
        optional_process_event_profile: "single_window_blur_only",
        engagement_items: [
          engagement(true, "C", strongReason, 42_000, { event_counts: { window_blur: 1, typing_activity_summary: 1 } }),
          engaged(),
          engaged()
        ]
      };
    case "external_convergent":
      return {
        optional_process_event_profile: "paste_focus_pause_convergent",
        engagement_items: [
          engagement(true, "C", strongReason, 35_000, { event_counts: { paste_detected: 1, window_blur: 1, typing_activity_summary: 1 } }),
          engagement(true, "C", adequateReason, 36_000, { event_counts: { paste_detected: 1, page_visibility_hidden: 1, typing_activity_summary: 1 } }),
          engaged()
        ]
      };
    case "typing_mismatch":
      return {
        optional_process_event_profile: "typing_duration_mismatch_context",
        engagement_items: [
          engagement(true, "C", adequateReason, 20_000, { event_counts: { typing_activity_summary: 1, response_quality_adequate_or_usable: 1 } }),
          engagement(true, "A", partialReason, 4_000, { event_counts: { typing_activity_summary: 1, response_quality_low_information: 1 } }),
          moderate("C", vagueReason)
        ],
        expected_allowed_outcomes: {
          engagement_categories: ["moderately_engaged", "engaged", "disengaged"]
        }
      };
    case "long_idle_quick":
      return {
        optional_process_event_profile: "long_idle_then_quick_sparse",
        engagement_items: [
          sparse("E", "idk", 1_200),
          sparse("E", "idk", 1_300),
          sparse("A", "because", 1_400)
        ]
      };
    default:
      return {};
  }
}

const extraVariationSpecs: ExtraVariationSpec[] = [
  { base: "stable_understanding_engaged", id: "qa_detailed_correct_reasoning", description: "detailed correct reasoning", tags: ["detailed_response", "engaged_process"], style: "stable_detailed" },
  { base: "stable_understanding_engaged", id: "qa_correct_tempting_distractor", description: "correct answer with a tempting distractor", tags: ["detailed_response", "boundary_case"], style: "stable_tempting" },
  { base: "stable_understanding_engaged", id: "qa_correct_after_edit", description: "correct after package review edit", tags: ["edit_revision", "answer_changed", "detailed_response"], style: "stable_edit" },
  { base: "stable_understanding_engaged", id: "qa_multilingual_correct", description: "multilingual but conceptually correct", tags: ["multilingual", "concise_meaningful"], style: "stable_multilingual", expected_allowed_outcomes: { formative_values: ["confidence_calibration"] } },
  { base: "stable_understanding_engaged", id: "qa_typo_heavy_correct", description: "typo-heavy but correct", tags: ["typo_heavy", "concise_meaningful"], style: "stable_typo", expected_allowed_outcomes: { formative_values: ["confidence_calibration"] } },
  { base: "underconfident_strong_understanding", id: "qa_low_confidence_correct_boundary", description: "correct but very unsure", tags: ["uncertainty", "boundary_case"], style: "low_confidence_correct" },
  { base: "stable_understanding_engaged", id: "qa_pause_resume_correct", description: "correct reasoning after pause and resume", tags: ["pause_resume_process", "engaged_process"], style: "stable_pause", expected_allowed_outcomes: { formative_values: ["confidence_calibration"], ai_assistance_signals: ["likely_external_assistance_pattern"] } },
  { base: "stable_understanding_engaged", id: "qa_prefers_consolidation", description: "student prefers consolidation", tags: ["student_choice", "prefers_consolidation", "accepts_recommendation"], choice: "accepted_recommendation", selected_choice_value: "consolidation_and_transfer" },
  { base: "developing_understanding_partial_reasoning", id: "qa_partial_medium_confidence", description: "medium confidence with partial evidence", tags: ["moderate_process", "vague_response"], style: "partial_medium" },
  { base: "developing_understanding_partial_reasoning", id: "qa_correct_weak_explanation", description: "correct answer with weak explanation", tags: ["vague_response", "boundary_case"], style: "correct_weak" },
  { base: "developing_understanding_partial_reasoning", id: "qa_wrong_answer_partial_correct_reasoning", description: "wrong answer with partly correct reasoning", tags: ["boundary_case", "moderate_process"], style: "wrong_partial" },
  { base: "developing_understanding_partial_reasoning", id: "qa_explanation_improves_after_edit", description: "explanation improves after edit", tags: ["edit_revision", "detailed_response"], style: "edit_improved" },
  { base: "developing_understanding_partial_reasoning", id: "qa_multilingual_partial", description: "multilingual partial explanation", tags: ["multilingual", "vague_response"], style: "partial_multilingual" },
  { base: "developing_understanding_partial_reasoning", id: "qa_tempting_option_fragility", description: "tempting option reveals fragility", tags: ["tempting_option_changed", "boundary_case"], style: "fragile_tempting" },
  { base: "developing_understanding_partial_reasoning", id: "qa_procedural_question_partial", description: "procedural question with partial evidence", tags: ["procedural_question", "moderate_process"], style: "procedural_partial" },
  { base: "developing_understanding_partial_reasoning", id: "qa_typo_partial", description: "typo-heavy partial explanation", tags: ["typo_heavy", "vague_response"], style: "typo_partial" },
  { base: "consolidation_transfer_negative_control", id: "qa_answer_changed_to_correct_still_unstable", description: "answer changed to correct but still unstable", tags: ["answer_changed", "edit_revision", "boundary_case"], style: "answer_changed_correct" },
  { base: "knowledge_gap_low_confidence", id: "qa_idk_clear", description: "clear I do not know pattern", tags: ["uncertainty", "low_information"], style: "idk_clear" },
  { base: "knowledge_gap_low_confidence", id: "qa_low_confidence_normal_process", description: "low confidence with normal process timing", tags: ["uncertainty", "engaged_process"], style: "low_conf_normal" },
  { base: "knowledge_gap_low_confidence", id: "qa_missing_key_idea", description: "missing key idea", tags: ["vague_response", "boundary_case"], style: "missing_key" },
  { base: "knowledge_gap_low_confidence", id: "qa_very_short_reasoning", description: "very short reasoning", tags: ["low_information", "vague_response"], style: "very_short" },
  { base: "knowledge_gap_low_confidence", id: "qa_basic_concept_question", description: "asks a basic concept question", tags: ["content_question", "uncertainty"], style: "basic_question" },
  { base: "overconfident_wrong_or_weak_evidence", id: "qa_correct_looking_no_reasoning", description: "correct-looking answer with no reasoning", tags: ["low_information", "boundary_case"], style: "correct_no_reason" },
  { base: "knowledge_gap_low_confidence", id: "qa_wrong_answer_uncertainty", description: "wrong answer with uncertainty", tags: ["uncertainty", "moderate_process"], style: "wrong_uncertain" },
  { base: "rapid_sparse_disengaged", id: "qa_repeated_idk_sparse", description: "repeated I don't know sparse pattern", tags: ["rapid_sparse_process", "uncertainty", "low_information"], style: "repeated_idk" },
  { base: "knowledge_gap_low_confidence", id: "qa_help_request_no_content", description: "asks for help but gives little content", tags: ["content_question", "low_information"], style: "help_no_content" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_diagnostic_a_aligned", description: "diagnostic A aligned reasoning", tags: ["detailed_response", "boundary_case"], style: "misconception_a" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_high_confidence_b", description: "high-confidence B misconception", tags: ["detailed_response", "boundary_case"], style: "misconception_b" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_misconception_content_question", description: "misconception after content question", tags: ["content_question", "detailed_response"], style: "misconception_question" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_tempting_distractor_reveals_misconception", description: "tempting distractor reveals misconception", tags: ["tempting_option_changed", "boundary_case"], style: "misconception_tempting" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_misconception_corrected_after_edit", description: "misconception partly corrected after edit", tags: ["edit_revision", "answer_changed"], style: "misconception_edit" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_typo_heavy_misconception", description: "typo-heavy misconception", tags: ["typo_heavy", "detailed_response"], style: "misconception_typo" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_multilingual_misconception", description: "multilingual misconception", tags: ["multilingual", "detailed_response"], style: "misconception_multilingual" },
  { base: "overconfident_wrong_or_weak_evidence", id: "qa_overconfident_b_wrong", description: "overconfident wrong B response", tags: ["boundary_case", "detailed_response"], style: "overconfident_b" },
  { base: "misconception_with_diagnostic_evidence", id: "qa_low_confidence_misconception", description: "low-confidence misconception evidence", tags: ["uncertainty", "boundary_case"], style: "low_conf_misconception" },
  { base: "mixed_conflicting_evidence", id: "qa_correct_answer_wrong_reasoning", description: "correct answer with wrong reasoning", tags: ["boundary_case", "vague_response"], style: "correct_wrong_reason" },
  { base: "mixed_conflicting_evidence", id: "qa_wrong_answer_partly_correct_reasoning", description: "wrong answer with partly correct reasoning", tags: ["boundary_case", "moderate_process"], style: "wrong_partly_correct" },
  { base: "mixed_conflicting_evidence", id: "qa_confidence_conflicts_with_evidence", description: "confidence conflicts with evidence", tags: ["confidence_changed", "boundary_case"], style: "confidence_conflict" },
  { base: "mixed_conflicting_evidence", id: "qa_selected_option_conflicts_with_tempting", description: "selected option conflicts with tempting option", tags: ["tempting_option_changed", "boundary_case"], style: "option_tempting_conflict" },
  { base: "mixed_conflicting_evidence", id: "qa_multilingual_uncertainty_extra", description: "extra multilingual uncertainty", tags: ["multilingual", "uncertainty"], style: "multilingual_uncertainty" },
  { base: "mixed_conflicting_evidence", id: "qa_answer_changed_mid_package", description: "answer changed mid-package", tags: ["answer_changed", "edit_revision"], style: "answer_changed_mid" },
  { base: "mixed_conflicting_evidence", id: "qa_improved_but_unstable", description: "reasoning improved but remains unstable", tags: ["edit_revision", "detailed_response"], style: "improved_unstable" },
  { base: "moderately_engaged_mixed", id: "qa_high_low_confidence_mix", description: "high and low confidence mixed", tags: ["confidence_changed", "moderate_process"], style: "high_low_conf_mix" },
  { base: "mixed_conflicting_evidence", id: "qa_selected_c_tempted_a", description: "selected C but tempted by A", tags: ["tempting_option_changed", "boundary_case"], style: "selected_c_tempted_a" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_sparse_not_rapid", description: "sparse but not rapid", tags: ["low_information", "moderate_process"], style: "sparse_not_rapid" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_repeated_placeholder_extra", description: "repeated placeholder responses", tags: ["low_information", "vague_response"], style: "placeholder_extra" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_skipped_reasoning", description: "skipped reasoning", tags: ["low_information", "uncertainty"], style: "skipped_reasoning" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_procedural_little_content", description: "procedural question with little content", tags: ["procedural_question", "low_information"], style: "procedural_little" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_incomplete_like_evidence", description: "incomplete package-like evidence", tags: ["low_information", "boundary_case"], style: "incomplete_like" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_too_short_to_classify", description: "evidence too short to classify", tags: ["low_information", "vague_response"], style: "too_short" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_no_reliable_process_data", description: "no reliable process data", tags: ["insufficient_ai_signal", "boundary_case"], style: "no_process" },
  { base: "insufficient_evidence_sparse_but_not_disengaged", id: "qa_lowinfo_typo", description: "low-information typo-heavy evidence", tags: ["typo_heavy", "low_information"], style: "lowinfo_typo", choice: "moved_on" },
  { base: "rapid_sparse_disengaged", id: "qa_rapid_sparse_extra", description: "rapid sparse extra pattern", tags: ["rapid_sparse_process", "low_information"], style: "rapid_sparse_extra" },
  { base: "moderately_engaged_mixed", id: "qa_moderate_mixed_process", description: "moderate engagement process mix", tags: ["moderate_process", "boundary_case"], style: "moderate_process_mix" },
  { base: "stable_understanding_engaged", id: "qa_normal_timing_engaged", description: "engaged normal timing", tags: ["engaged_process", "detailed_response"], style: "normal_timing", choice: "accepted_recommendation", expected_allowed_outcomes: { formative_values: ["confidence_calibration"] } },
  { base: "moderately_engaged_mixed", id: "qa_long_pause_resume", description: "long idle then resume", tags: ["pause_resume_process", "moderate_process"], style: "long_pause", expected_allowed_outcomes: { ai_assistance_signals: ["likely_external_assistance_pattern"] } },
  { base: "ai_signal_insufficient_evidence", id: "qa_one_weak_focus_signal", description: "one weak focus signal", tags: ["weak_focus_or_paste_signal", "insufficient_ai_signal"], style: "one_focus", expected_allowed_outcomes: { ai_assistance_signals: ["likely_external_assistance_pattern"] } },
  { base: "likely_external_assistance_context", id: "qa_external_convergent_extra", description: "convergent external assistance context", tags: ["likely_external_assistance_pattern", "weak_focus_or_paste_signal"], style: "external_convergent" },
  { base: "moderately_engaged_mixed", id: "qa_typing_mismatch", description: "typing mismatch context", tags: ["weak_focus_or_paste_signal", "moderate_process"], style: "typing_mismatch", expected_allowed_outcomes: { ai_assistance_signals: ["likely_external_assistance_pattern"] } },
  { base: "rapid_sparse_disengaged", id: "qa_long_idle_quick_response", description: "long idle then quick sparse response", tags: ["pause_resume_process", "rapid_sparse_process"], style: "long_idle_quick", expected_allowed_outcomes: { ai_assistance_signals: ["likely_external_assistance_pattern"] } },
  { base: "student_choice_accepts_recommendation", id: "qa_accepts_recommendation_extra", description: "accepts recommendation extra case", tags: ["student_choice", "accepts_recommendation"], choice: "accepted_recommendation" },
  { base: "student_choice_selects_alternative", id: "qa_chooses_diagnostic_alternative", description: "chooses diagnostic clarification alternative", tags: ["student_choice", "chooses_alternative", "chooses_diagnostic_clarification"], choice: "chose_alternative", selected_choice_value: "diagnostic_clarification", question: "Can I choose diagnostic clarification instead?" },
  { base: "student_choice_moves_on", id: "qa_moves_on_extra", description: "moves on after reviewing options", tags: ["student_choice", "moves_on"], choice: "moved_on", selected_choice_value: "move_on" },
  { base: "underconfident_strong_understanding", id: "qa_rejects_confidence_calibration", description: "rejects confidence calibration", tags: ["student_choice", "rejects_confidence_calibration", "chooses_alternative"], choice: "chose_alternative", selected_choice_value: "independent_understanding_verification", question: "I would rather verify the idea once more than focus on confidence." },
  { base: "mixed_conflicting_evidence", id: "qa_chooses_verification", description: "chooses independent verification", tags: ["student_choice", "chooses_independent_verification", "chooses_alternative"], choice: "chose_alternative", selected_choice_value: "independent_understanding_verification", question: "I want to check my understanding first." }
];

export const additionalProfileFormativeScenarioVariations: ProfileFormativeScenario[] = extraVariationSpecs.map((spec) => {
  const base = baseScenario(spec.base);
  const styledUpdates = styleUpdates(spec.style, base);
  return withVariation(spec.base, spec.id, spec.description, spec.tags, {
    ...styledUpdates,
    expected_allowed_outcomes: {
      ...styledUpdates.expected_allowed_outcomes,
      ...spec.expected_allowed_outcomes,
      profile_integration_patterns: uniqueValues([
        ...(styledUpdates.expected_allowed_outcomes?.profile_integration_patterns ?? []),
        ...(spec.expected_allowed_outcomes?.profile_integration_patterns ?? [])
      ]),
      student_facing_statuses: uniqueValues([
        ...(styledUpdates.expected_allowed_outcomes?.student_facing_statuses ?? []),
        ...(spec.expected_allowed_outcomes?.student_facing_statuses ?? [])
      ]),
      engagement_categories: uniqueValues([
        ...(styledUpdates.expected_allowed_outcomes?.engagement_categories ?? []),
        ...(spec.expected_allowed_outcomes?.engagement_categories ?? [])
      ]),
      ai_assistance_signals: uniqueValues([
        ...(styledUpdates.expected_allowed_outcomes?.ai_assistance_signals ?? []),
        ...(spec.expected_allowed_outcomes?.ai_assistance_signals ?? [])
      ]),
      formative_values: uniqueValues([
        ...(styledUpdates.expected_allowed_outcomes?.formative_values ?? []),
        ...(spec.expected_allowed_outcomes?.formative_values ?? [])
      ])
    },
    student_choice: spec.choice ?? styledUpdates.student_choice,
    scripted_student_choice_selected_value: spec.selected_choice_value ?? styledUpdates.scripted_student_choice_selected_value,
    optional_scripted_content_or_procedural_question:
      spec.question ?? styledUpdates.optional_scripted_content_or_procedural_question,
    why_target_outcome_is_reasonable:
      styledUpdates.why_target_outcome_is_reasonable ??
      "The target follows from the synthetic response pattern and internal evidence packets.",
    defensible_alternative:
      styledUpdates.defensible_alternative ??
      "Adjacent conservative outcomes are defensible when evidence remains ambiguous or a student preference changes the selected value.",
    real_failure_criteria:
      styledUpdates.real_failure_criteria ??
      "A real failure is unsafe student-facing text, invalid output, unsupported overclaiming, or an outcome outside target and allowed alternatives."
  });
});

export const profileFormativeScenarios: ProfileFormativeScenario[] = [
  ...coreProfileFormativeScenarios,
  ...profileFormativeScenarioVariations,
  ...additionalProfileFormativeScenarioVariations
];

export const profileFormativeCanaryScenarioIds = [
  "stable_understanding_engaged",
  "developing_understanding_partial_reasoning",
  "knowledge_gap_low_confidence",
  "misconception_with_diagnostic_evidence",
  "mixed_conflicting_evidence__multilingual_uncertainty",
  "underconfident_strong_understanding",
  "rapid_sparse_disengaged",
  "likely_external_assistance_context",
  "student_choice_accepts_recommendation",
  "student_choice_selects_alternative"
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
        ? scenario.scripted_student_choice_selected_value === "move_on"
          ? packet.alternative_values[0]?.value ?? packet.primary_value
          : scenario.scripted_student_choice_selected_value ?? packet.alternative_values[0]?.value ?? packet.primary_value
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
    scenario_group: scenario.scenario_group ?? scenarioGroupByPattern[scenario.target_profile_integration_pattern],
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
    scripted_selected_options: scenario.scripted_selected_options ?? scenario.scripted_student_response_package.map((item) => item.selected_option),
    scripted_student_choice: scenario.student_choice ?? "not_chosen",
    scripted_student_choice_selected_value: scenario.scripted_student_choice_selected_value ?? null,
    expected_allowed_outcomes: scenario.expected_allowed_outcomes ?? {},
    strict_outcomes: scenario.strict_outcomes ?? [
      "student_facing_safety",
      "schema_validation",
      "student_choice_policy"
    ],
    non_evaluated_outcomes: scenario.non_evaluated_outcomes ?? [
      "activity_planning",
      "activity_generation",
      "item_scoring"
    ],
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
    rationale: scenario.rationale,
    why_target_outcome_is_reasonable:
      scenario.why_target_outcome_is_reasonable ??
      `${scenario.target_profile_integration_pattern} and ${scenario.target_formative_value} are reasonable given the scripted response package and process context.`,
    defensible_alternative:
      scenario.defensible_alternative ??
      "A documented adjacent outcome is defensible only when the synthetic evidence is ambiguous and student-facing safety still holds.",
    real_failure_criteria:
      scenario.real_failure_criteria ??
      "A real failure requires unsafe student-facing text, invalid structured output, unsupported certainty, or an outcome outside target and allowed alternatives."
  };
}
