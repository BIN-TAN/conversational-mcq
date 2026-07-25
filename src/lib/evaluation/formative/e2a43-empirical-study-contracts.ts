import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";

export const RESEARCH_PROTOCOL_CONTRACT_VERSION =
  "cba-empirical-research-protocol-v1" as const;
export const RESEARCH_QUESTION_FRAMEWORK_VERSION =
  "research-question-framework-v1" as const;
export const EMPIRICAL_STUDY_DESIGN_VERSION =
  "empirical-evaluation-study-design-v1" as const;
export const EXPERT_RATING_FRAMEWORK_VERSION =
  "expert-rating-framework-v1" as const;
export const CLASSROOM_PILOT_CONTRACT_VERSION =
  "classroom-pilot-contract-v1" as const;
export const STUDY_COMPARISON_FRAMEWORK_VERSION =
  "study-comparison-framework-v1" as const;
export const RESEARCH_DATA_SCHEMA_VERSION =
  "research-data-schema-v1" as const;
export const RESEARCH_ETHICS_BOUNDARY_VERSION =
  "research-ethics-boundary-v1" as const;
export const ANALYSIS_FRAMEWORK_VERSION =
  "analysis-framework-v1" as const;
export const STUDY_LIMITATIONS_VERSION =
  "empirical-study-limitations-v1" as const;

export const ResearchQuestionIdSchema = z.enum([
  "RQ1",
  "RQ2",
  "RQ3",
  "RQ4",
  "RQ5"
]);
export type ResearchQuestionId = z.infer<
  typeof ResearchQuestionIdSchema
>;

export const ResearchQuestionSchema = z.object({
  research_question_id: ResearchQuestionIdSchema,
  question: z.string().min(20),
  constructs: z.array(z.string().min(1)).min(1).max(12),
  evidence_sources: z.array(z.string().min(1)).min(1).max(16),
  evaluation_dimensions: z.array(z.string().min(1)).min(1).max(12),
  claim_boundary: z.string().min(1)
}).strict();
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

export const StudyPhaseSchema = z.object({
  phase_number: z.number().int().min(1).max(3),
  phase_id: z.enum([
    "system_validation",
    "expert_evaluation",
    "classroom_pilot"
  ]),
  purpose: z.string().min(1),
  participant_source: z.enum([
    "synthetic_cases_and_expert_created_scenarios",
    "subject_matter_experts_or_instructors",
    "consenting_students_and_course_instructors"
  ]),
  evaluates: z.array(z.string().min(1)).min(1).max(16),
  permitted_claims: z.array(z.string().min(1)).min(1).max(12),
  prohibited_claims: z.array(z.string().min(1)).min(1).max(12),
  reb_approval_required_before_execution: z.boolean(),
  execution_authorized_in_this_freeze: z.literal(false)
}).strict();
export type StudyPhase = z.infer<typeof StudyPhaseSchema>;

export const ResearchVariableDefinitionSchema = z.object({
  variable_name: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  level: z.enum(["student", "item", "interaction"]),
  description: z.string().min(1),
  source: z.enum([
    "student_authored",
    "student_selected",
    "application_logged",
    "item_metadata",
    "validated_system_decision",
    "pseudonymization_service"
  ]),
  data_type: z.enum([
    "pseudonymous_identifier",
    "categorical",
    "ordinal",
    "integer",
    "duration_ms",
    "boolean",
    "student_authored_text",
    "versioned_structured_record"
  ]),
  direct_identifier: z.literal(false),
  required_for_all_records: z.boolean(),
  research_purpose: z.string().min(1),
  interpretation_caution: z.string().min(1)
}).strict();
export type ResearchVariableDefinition = z.infer<
  typeof ResearchVariableDefinitionSchema
>;

export const PlannedAnalysisSchema = z.object({
  analysis_id: z.string().min(1),
  family: z.enum([
    "diagnostic",
    "learning",
    "process",
    "qualitative"
  ]),
  research_question_ids: z.array(ResearchQuestionIdSchema).min(1).max(5),
  outcome_or_focus: z.string().min(1),
  candidate_analyses: z.array(z.string().min(1)).min(1).max(12),
  required_data: z.array(z.string().min(1)).min(1).max(20),
  method_selected_before_data_review: z.literal(false),
  requires_sample_and_assumption_review: z.literal(true),
  no_result_claimed: z.literal(true)
}).strict();
export type PlannedAnalysis = z.infer<typeof PlannedAnalysisSchema>;

export function buildResearchProtocolContractV1() {
  return {
    contract_version: RESEARCH_PROTOCOL_CONTRACT_VERSION,
    purpose:
      "dissertation_level_empirical_evaluation_protocol_for_cba",
    supports: [
      "research_ethics_board_preparation",
      "pilot_implementation_planning",
      "dissertation_evaluation_chapters"
    ],
    evaluation_domains: [
      "diagnostic_capability",
      "personalized_formative_feedback",
      "learning_progression",
      "process_evidence",
      "student_experience",
      "teacher_research_usefulness"
    ],
    predecessor_framework: "evaluation-framework-v1",
    execution_authorized: false,
    reb_approval_assumed: false,
    empirical_outcomes_present: false,
    effect_sizes_present: false,
    live_provider_calls_required: false
  } as const;
}

export function buildResearchQuestionFrameworkV1() {
  const questions: ResearchQuestion[] = [
    {
      research_question_id: "RQ1",
      question:
        "How accurately can CBA identify student misconceptions and knowledge gaps beyond answer correctness alone?",
      constructs: [
        "misconception_identification",
        "knowledge_gap_identification",
        "false_sound",
        "missed_misconception"
      ],
      evidence_sources: [
        "selected_answer",
        "student_reasoning",
        "distractor_stance",
        "expert_judgment"
      ],
      evaluation_dimensions: [
        "diagnostic_accuracy",
        "evidence_quality"
      ],
      claim_boundary:
        "Accuracy requires comparison with an independently defined expert reference and cannot be inferred from system output alone."
    },
    {
      research_question_id: "RQ2",
      question:
        "How does CBA support personalized formative feedback through reasoning, confidence, distractor, and process evidence?",
      constructs: [
        "personalization",
        "intervention_appropriateness",
        "strategy_adaptation"
      ],
      evidence_sources: [
        "student_reasoning",
        "confidence",
        "distractor_selection",
        "process_indicators",
        "intervention_decision"
      ],
      evaluation_dimensions: [
        "intervention_quality",
        "evidence_quality"
      ],
      claim_boundary:
        "Personalization quality must be judged against observed evidence and pedagogical criteria, not model novelty."
    },
    {
      research_question_id: "RQ3",
      question:
        "How do students' learning profiles change during CBA interactions?",
      constructs: [
        "profile_transition",
        "revision_quality",
        "transfer_performance",
        "regression_handling"
      ],
      evidence_sources: [
        "profile_snapshots",
        "revision_evidence",
        "transfer_evidence",
        "interaction_sequence"
      ],
      evaluation_dimensions: [
        "learning_progression",
        "dialogue_efficiency"
      ],
      claim_boundary:
        "Within-session profile change is not a stable trait estimate or proof of durable learning."
    },
    {
      research_question_id: "RQ4",
      question:
        "How do students and instructors perceive the usefulness and usability of CBA?",
      constructs: [
        "perceived_usefulness",
        "usability",
        "cognitive_burden",
        "instructional_utility"
      ],
      evidence_sources: [
        "student_feedback",
        "instructor_feedback",
        "usability_measures",
        "qualitative_comments"
      ],
      evaluation_dimensions: [
        "student_experience",
        "teacher_research_utility"
      ],
      claim_boundary:
        "Perceptions describe participant experience and do not establish diagnostic accuracy or learning effectiveness."
    },
    {
      research_question_id: "RQ5",
      question:
        "How do process data contribute to understanding student reasoning and assessment validity?",
      constructs: [
        "response_revision",
        "confidence_change",
        "help_seeking",
        "interaction_trajectory"
      ],
      evidence_sources: [
        "process_events",
        "conversation_turns",
        "response_timing",
        "profile_transitions"
      ],
      evaluation_dimensions: [
        "process_evidence",
        "evidence_traceability"
      ],
      claim_boundary:
        "Process signals are contextual evidence and do not independently prove understanding, effort, motivation, cheating, or misconduct."
    }
  ];
  return {
    framework_version: RESEARCH_QUESTION_FRAMEWORK_VERSION,
    questions: questions.map((question) =>
      ResearchQuestionSchema.parse(question)
    ),
    research_question_count: questions.length
  };
}

export function buildEmpiricalStudyDesignV1() {
  const phases: StudyPhase[] = [
    {
      phase_number: 1,
      phase_id: "system_validation",
      purpose:
        "Validate technical and workflow reliability before classroom deployment.",
      participant_source:
        "synthetic_cases_and_expert_created_scenarios",
      evaluates: [
        "evidence_extraction",
        "profile_transitions",
        "intervention_selection",
        "stopping_decisions",
        "audit_traceability"
      ],
      permitted_claims: [
        "contract_consistency",
        "workflow_reliability_on_defined_cases",
        "failure_detection_on_defined_cases"
      ],
      prohibited_claims: [
        "student_learning_effectiveness",
        "classroom_generalizability",
        "psychometric_validity"
      ],
      reb_approval_required_before_execution: false,
      execution_authorized_in_this_freeze: false
    },
    {
      phase_number: 2,
      phase_id: "expert_evaluation",
      purpose:
        "Evaluate the quality, appropriateness, and instructional usefulness of CBA outputs.",
      participant_source: "subject_matter_experts_or_instructors",
      evaluates: [
        "misconception_identification",
        "feedback_quality",
        "pedagogical_appropriateness",
        "actionability",
        "instructional_usefulness"
      ],
      permitted_claims: [
        "expert_ratings_for_reviewed_outputs",
        "agreement_estimates_when_supported",
        "qualitative_expert_feedback"
      ],
      prohibited_claims: [
        "student_learning_effectiveness",
        "population_level_generalization",
        "unreviewed_model_accuracy"
      ],
      reb_approval_required_before_execution: true,
      execution_authorized_in_this_freeze: false
    },
    {
      phase_number: 3,
      phase_id: "classroom_pilot",
      purpose:
        "Evaluate authentic consenting student interaction in a bounded university-course pilot.",
      participant_source: "consenting_students_and_course_instructors",
      evaluates: [
        "diagnostic_evidence",
        "formative_feedback",
        "learning_progression",
        "process_evidence",
        "student_experience",
        "instructor_utility"
      ],
      permitted_claims: [
        "pilot_context_findings",
        "descriptive_participant_experience",
        "bounded_within_study_comparisons"
      ],
      prohibited_claims: [
        "universal_learning_effectiveness",
        "stable_learner_traits",
        "cross_context_generalization_without_replication"
      ],
      reb_approval_required_before_execution: true,
      execution_authorized_in_this_freeze: false
    }
  ];
  return {
    design_version: EMPIRICAL_STUDY_DESIGN_VERSION,
    phases: phases.map((phase) => StudyPhaseSchema.parse(phase)),
    phase_order_locked: true,
    classroom_deployment_requires_prior_system_validation: true,
    no_phase_executed_by_protocol_freeze: true
  };
}

export function buildExpertRatingFrameworkV1() {
  return {
    framework_version: EXPERT_RATING_FRAMEWORK_VERSION,
    reviewer_population: "subject_matter_experts_or_instructors",
    rating_dimensions: [
      "diagnostic_usefulness",
      "feedback_usefulness",
      "pedagogical_appropriateness",
      "instructional_value",
      "actionability"
    ],
    ordinal_scale: {
      minimum: 1,
      maximum: 5,
      anchors: {
        1: "not_useful_or_inappropriate",
        3: "partly_useful_with_material_revision_needed",
        5: "useful_appropriate_and_actionable"
      }
    },
    reviewer_training_required: true,
    independent_rating_before_discussion: true,
    disagreement_preserved_for_analysis: true,
    agreement_measure: {
      status: "select_after_rating_design_and_data_review",
      candidates: [
        "percent_agreement",
        "chance_corrected_agreement",
        "ordinal_inter_rater_reliability"
      ],
      statistic_preselected_without_data: false
    },
    ratings_collected_in_this_freeze: false,
    results_claimed: false
  } as const;
}

export function buildClassroomPilotContractV1() {
  return {
    contract_version: CLASSROOM_PILOT_CONTRACT_VERSION,
    potential_context: "EDPY_507_or_equivalent_university_course",
    context_is_confirmed: false,
    participants: "consenting_students_and_course_instructors",
    collected_evidence: [
      "selected_responses",
      "student_authored_reasoning",
      "confidence",
      "distractor_selection",
      "revision",
      "transfer",
      "process_data",
      "student_experience_feedback",
      "instructor_feedback"
    ],
    unnecessary_private_information_collected: false,
    direct_identifiers_in_analysis_dataset: false,
    pseudonymous_research_identifier_required: true,
    informed_consent_required: true,
    participation_voluntary: true,
    withdrawal_procedure_required: true,
    reb_approval_required: true,
    reb_approval_assumed: false,
    implementation_authorized: false
  } as const;
}

export function buildStudyComparisonFrameworkV1() {
  return {
    framework_version: STUDY_COMPARISON_FRAMEWORK_VERSION,
    conditions: [
      {
        condition_id: "traditional_mcq",
        evidence: ["selected_answer"]
      },
      {
        condition_id: "mcq_generic_ai_feedback",
        evidence: ["selected_answer", "generic_explanation"]
      },
      {
        condition_id: "conversation_based_assessment",
        evidence: [
          "selected_answer",
          "reasoning",
          "confidence",
          "distractor",
          "process_data",
          "adaptive_feedback",
          "profile_transitions"
        ]
      }
    ],
    comparison_dimensions: [
      "diagnostic_capability",
      "personalization",
      "learning_progression",
      "process_evidence",
      "student_experience",
      "teacher_research_usefulness"
    ],
    expected_outcomes_fabricated: false,
    effect_sizes_fabricated: false,
    superiority_assumed: false,
    assignment_design_status:
      "to_be_selected_during_reb_and_pilot_design",
    causal_interpretation_requires_appropriate_design: true
  } as const;
}

export function buildResearchDataSchemaV1() {
  const variables: ResearchVariableDefinition[] = [
    {
      variable_name: "research_student_id",
      level: "student",
      description:
        "Versioned pseudonymous research join key generated by the approved pseudonymization service.",
      source: "pseudonymization_service",
      data_type: "pseudonymous_identifier",
      direct_identifier: false,
      required_for_all_records: true,
      research_purpose: "Link approved research records without exporting the operational username.",
      interpretation_caution:
        "The identifier is pseudonymous, not anonymous, and linkage access must remain restricted."
    },
    {
      variable_name: "selected_response",
      level: "student",
      description: "Student-selected response for an administered item.",
      source: "student_selected",
      data_type: "categorical",
      direct_identifier: false,
      required_for_all_records: true,
      research_purpose: "Support item-response and diagnostic analyses.",
      interpretation_caution:
        "A selected response alone does not establish the student's reasoning."
    },
    {
      variable_name: "student_reasoning",
      level: "student",
      description: "Student-authored explanation submitted during assessment.",
      source: "student_authored",
      data_type: "student_authored_text",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Support observable reasoning and misconception analysis.",
      interpretation_caution:
        "Free text may contain volunteered personal information and requires approved access and redaction procedures."
    },
    {
      variable_name: "confidence",
      level: "student",
      description: "Student-selected confidence category.",
      source: "student_selected",
      data_type: "ordinal",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Contextualize answer and reasoning evidence.",
      interpretation_caution:
        "Confidence is task-specific and is not a stable personal trait."
    },
    {
      variable_name: "tempting_distractor",
      level: "student",
      description: "Student-selected tempting option when provided.",
      source: "student_selected",
      data_type: "categorical",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Support distractor-informed misconception analysis.",
      interpretation_caution:
        "A tempting distractor is evidence for review, not a confirmed misconception."
    },
    {
      variable_name: "revision_record",
      level: "student",
      description: "Versioned record of a student response revision.",
      source: "application_logged",
      data_type: "versioned_structured_record",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Study response change and revision quality.",
      interpretation_caution:
        "Revision does not by itself demonstrate durable learning."
    },
    {
      variable_name: "process_indicators",
      level: "student",
      description: "Versioned, bounded process indicators from assessment interaction.",
      source: "application_logged",
      data_type: "versioned_structured_record",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Study interaction trajectory and evidence context.",
      interpretation_caution:
        "Process indicators alone do not prove effort, motivation, understanding, cheating, or misconduct."
    },
    {
      variable_name: "item_public_id",
      level: "item",
      description: "Public identifier for the administered item.",
      source: "item_metadata",
      data_type: "pseudonymous_identifier",
      direct_identifier: false,
      required_for_all_records: true,
      research_purpose: "Join item characteristics to response evidence.",
      interpretation_caution:
        "Item identifiers should not be used to expose protected answer keys."
    },
    {
      variable_name: "item_characteristics",
      level: "item",
      description: "Versioned teacher-authored or imported item descriptors.",
      source: "item_metadata",
      data_type: "versioned_structured_record",
      direct_identifier: false,
      required_for_all_records: true,
      research_purpose: "Describe item design and cognitive demand.",
      interpretation_caution:
        "Descriptors are design metadata and may require expert review."
    },
    {
      variable_name: "target_concept",
      level: "item",
      description: "Concept targeted by the item.",
      source: "item_metadata",
      data_type: "categorical",
      direct_identifier: false,
      required_for_all_records: true,
      research_purpose: "Organize concept-level analyses.",
      interpretation_caution:
        "One item may provide incomplete evidence about a broader concept."
    },
    {
      variable_name: "misconception_category",
      level: "item",
      description: "Teacher-authored candidate misconception category linked to a distractor.",
      source: "item_metadata",
      data_type: "categorical",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Support comparison of observed evidence with item diagnostic design.",
      interpretation_caution:
        "The category is a candidate interpretation, not a confirmed student state."
    },
    {
      variable_name: "intervention_decision",
      level: "interaction",
      description: "Validated intervention selected for the current evidence state.",
      source: "validated_system_decision",
      data_type: "versioned_structured_record",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Evaluate intervention appropriateness and adaptation.",
      interpretation_caution:
        "A selected intervention is a system decision, not evidence that it was effective."
    },
    {
      variable_name: "profile_transition",
      level: "interaction",
      description: "Versioned transition between assessment-specific evidence states.",
      source: "validated_system_decision",
      data_type: "versioned_structured_record",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Study within-session evidence progression.",
      interpretation_caution:
        "Profile transitions are assessment-specific and not stable learner traits."
    },
    {
      variable_name: "stopping_decision",
      level: "interaction",
      description: "Validated decision to continue, revise, close, or offer instructor support.",
      source: "validated_system_decision",
      data_type: "categorical",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Evaluate dialogue efficiency and stopping appropriateness.",
      interpretation_caution:
        "Stopping decisions require evidence and policy context."
    },
    {
      variable_name: "interaction_outcome",
      level: "interaction",
      description: "Observed bounded outcome of the interaction episode.",
      source: "application_logged",
      data_type: "categorical",
      direct_identifier: false,
      required_for_all_records: false,
      research_purpose: "Connect interventions and stopping decisions to observed outcomes.",
      interpretation_caution:
        "An interaction outcome does not establish a causal treatment effect."
    }
  ];
  return {
    schema_version: RESEARCH_DATA_SCHEMA_VERSION,
    variables: variables.map((variable) =>
      ResearchVariableDefinitionSchema.parse(variable)
    ),
    levels: ["student", "item", "interaction"],
    prohibited_fields: [
      "chain_of_thought",
      "hidden_model_reasoning",
      "hidden_prompt",
      "api_key",
      "password_hash",
      "access_code_hash"
    ],
    direct_identifiers_exported: false,
    pseudonymization_required: true,
    unnecessary_private_information_collected: false
  };
}

export function buildResearchEthicsBoundaryV1() {
  return {
    boundary_version: RESEARCH_ETHICS_BOUNDARY_VERSION,
    requirements: {
      informed_consent: true,
      voluntary_participation: true,
      student_privacy: true,
      teacher_role_defined: true,
      research_use_separated_from_course_operations: true,
      withdrawal_procedure_defined_before_recruitment: true,
      access_control_and_retention_plan_required: true,
      adverse_event_and_concern_contact_required: true
    },
    teacher_boundary: {
      recruitment_and_consent_power_differential_must_be_addressed: true,
      ordinary_course_decisions_must_not_depend_on_research_participation: true,
      access_to_identifiable_research_data_must_be_role_limited: true
    },
    withdrawal_boundary: {
      withdrawal_window_must_be_stated: true,
      records_already_deidentified_or_aggregated_may_have_limits: true,
      external_copies_are_outside_application_control: true
    },
    reb_status: "not_submitted_or_approved_by_this_protocol",
    approval_assumed: false,
    recruitment_authorized: false,
    data_collection_authorized: false
  } as const;
}

export function buildAnalysisFrameworkV1() {
  const analyses: PlannedAnalysis[] = [
    {
      analysis_id: "diagnostic_accuracy_and_expert_agreement",
      family: "diagnostic",
      research_question_ids: ["RQ1"],
      outcome_or_focus:
        "Misconception and knowledge-gap classifications relative to an expert reference.",
      candidate_analyses: [
        "classification_accuracy",
        "false_sound_and_missed_misconception_rates",
        "agreement_with_expert_judgment"
      ],
      required_data: [
        "validated_system_classification",
        "independent_expert_reference",
        "adjudication_record"
      ],
      method_selected_before_data_review: false,
      requires_sample_and_assumption_review: true,
      no_result_claimed: true
    },
    {
      analysis_id: "learning_revision_and_transfer",
      family: "learning",
      research_question_ids: ["RQ3"],
      outcome_or_focus:
        "Within-study profile change, revision quality, and transfer performance.",
      candidate_analyses: [
        "pre_post_or_repeated_measure_comparison",
        "revision_improvement",
        "transfer_performance"
      ],
      required_data: [
        "profile_snapshots",
        "revision_records",
        "transfer_responses",
        "timing_and_attempt_context"
      ],
      method_selected_before_data_review: false,
      requires_sample_and_assumption_review: true,
      no_result_claimed: true
    },
    {
      analysis_id: "process_trajectory_analysis",
      family: "process",
      research_question_ids: ["RQ2", "RQ3", "RQ5"],
      outcome_or_focus:
        "Interaction trajectories, profile transitions, confidence change, help seeking, and intervention sequences.",
      candidate_analyses: [
        "descriptive_trajectory_analysis",
        "transition_analysis",
        "interaction_pattern_analysis"
      ],
      required_data: [
        "ordered_process_events",
        "conversation_turns",
        "profile_transitions",
        "intervention_decisions",
        "stopping_decisions"
      ],
      method_selected_before_data_review: false,
      requires_sample_and_assumption_review: true,
      no_result_claimed: true
    },
    {
      analysis_id: "student_and_instructor_perceptions",
      family: "qualitative",
      research_question_ids: ["RQ4"],
      outcome_or_focus:
        "Student usability and usefulness perceptions and instructor feedback.",
      candidate_analyses: [
        "descriptive_rating_summary",
        "qualitative_coding",
        "theme_development_with_audit_trail"
      ],
      required_data: [
        "student_feedback",
        "instructor_feedback",
        "approved_interview_or_open_text_records"
      ],
      method_selected_before_data_review: false,
      requires_sample_and_assumption_review: true,
      no_result_claimed: true
    }
  ];
  return {
    framework_version: ANALYSIS_FRAMEWORK_VERSION,
    analyses: analyses.map((analysis) =>
      PlannedAnalysisSchema.parse(analysis)
    ),
    statistical_methods_claimed_without_data: false,
    effect_sizes_claimed: false,
    inferential_results_present: false,
    missing_data_plan_required_before_confirmatory_analysis: true,
    multiplicity_and_model_assumptions_require_review: true,
    qualitative_reflexivity_and_audit_trail_required: true
  };
}

export function buildStudyLimitationsV1() {
  return {
    limitations_version: STUDY_LIMITATIONS_VERSION,
    limitations: [
      {
        code: "pilot_context_limit",
        statement:
          "Findings from one course or institution may depend on the specific content, participants, and implementation context."
      },
      {
        code: "sample_size_limit",
        statement:
          "A small pilot may support feasibility and descriptive analysis but may not support stable inferential estimates."
      },
      {
        code: "generalizability_limit",
        statement:
          "Generalization beyond the sampled course, items, and population requires replication."
      },
      {
        code: "ai_model_dependency",
        statement:
          "Observed behavior may depend on the frozen model, prompts, schemas, validators, and runtime configuration."
      },
      {
        code: "future_replication_required",
        statement:
          "Independent replication across domains, courses, models, and institutions is required."
      }
    ],
    limitations_acknowledged_before_execution: true
  } as const;
}

export function validateEmpiricalStudyContracts(input: {
  researchQuestions: ReturnType<typeof buildResearchQuestionFrameworkV1>;
  studyDesign: ReturnType<typeof buildEmpiricalStudyDesignV1>;
  expertRating: ReturnType<typeof buildExpertRatingFrameworkV1>;
  classroomPilot: ReturnType<typeof buildClassroomPilotContractV1>;
  comparison: ReturnType<typeof buildStudyComparisonFrameworkV1>;
  dataSchema: ReturnType<typeof buildResearchDataSchemaV1>;
  ethics: ReturnType<typeof buildResearchEthicsBoundaryV1>;
  analysis: ReturnType<typeof buildAnalysisFrameworkV1>;
  limitations: ReturnType<typeof buildStudyLimitationsV1>;
}) {
  const researchQuestionIds = input.researchQuestions.questions.map(
    (question) => question.research_question_id
  );
  const phaseNumbers = input.studyDesign.phases.map(
    (phase) => phase.phase_number
  );
  const variableNames = input.dataSchema.variables.map(
    (variable) => variable.variable_name
  );
  const requiredVariables = [
    "research_student_id",
    "selected_response",
    "student_reasoning",
    "confidence",
    "tempting_distractor",
    "revision_record",
    "process_indicators",
    "item_public_id",
    "item_characteristics",
    "target_concept",
    "misconception_category",
    "intervention_decision",
    "profile_transition",
    "stopping_decision",
    "interaction_outcome"
  ];
  const serialized = JSON.stringify(input);
  const prohibitedStorage = [
    "\"variable_name\":\"chain_of_thought\"",
    "\"variable_name\":\"hidden_model_reasoning\"",
    "\"variable_name\":\"hidden_prompt\"",
    "\"variable_name\":\"api_key\"",
    "\"variable_name\":\"password_hash\"",
    "\"variable_name\":\"access_code_hash\""
  ].filter((value) => serialized.includes(value));
  const questionCoverage = new Set(
    input.analysis.analyses.flatMap(
      (analysis) => analysis.research_question_ids
    )
  );
  return {
    research_question_count: researchQuestionIds.length,
    research_question_ids: researchQuestionIds,
    phase_count: input.studyDesign.phases.length,
    phase_order: phaseNumbers,
    research_variable_count: variableNames.length,
    missing_required_variables: requiredVariables.filter(
      (name) => !variableNames.includes(name)
    ),
    prohibited_storage_entries: prohibitedStorage,
    analysis_rq_coverage: [...questionCoverage].sort(),
    direct_identifier_count: input.dataSchema.variables.filter(
      (variable) => variable.direct_identifier
    ).length,
    reb_approval_assumed: input.ethics.approval_assumed,
    empirical_outcomes_present: false,
    passed:
      researchQuestionIds.join("|") === "RQ1|RQ2|RQ3|RQ4|RQ5" &&
      phaseNumbers.join("|") === "1|2|3" &&
      requiredVariables.every((name) => variableNames.includes(name)) &&
      prohibitedStorage.length === 0 &&
      questionCoverage.size === 5 &&
      input.dataSchema.variables.every(
        (variable) => !variable.direct_identifier
      ) &&
      !input.ethics.approval_assumed &&
      !input.classroomPilot.implementation_authorized &&
      !input.comparison.expected_outcomes_fabricated &&
      !input.analysis.statistical_methods_claimed_without_data &&
      input.limitations.limitations.length === 5
  };
}

export function buildEmpiricalProtocolReplayFingerprint(input: {
  researchQuestions: ReturnType<typeof buildResearchQuestionFrameworkV1>;
  studyDesign: ReturnType<typeof buildEmpiricalStudyDesignV1>;
  comparison: ReturnType<typeof buildStudyComparisonFrameworkV1>;
  dataSchema: ReturnType<typeof buildResearchDataSchemaV1>;
  ethics: ReturnType<typeof buildResearchEthicsBoundaryV1>;
  analysis: ReturnType<typeof buildAnalysisFrameworkV1>;
}) {
  const replayInput = {
    research_question_ids: input.researchQuestions.questions.map(
      (question) => question.research_question_id
    ),
    study_phases: input.studyDesign.phases.map((phase) => ({
      phase_number: phase.phase_number,
      phase_id: phase.phase_id,
      evaluates: [...phase.evaluates].sort()
    })),
    comparison_conditions: input.comparison.conditions.map(
      (condition) => ({
        condition_id: condition.condition_id,
        evidence: [...condition.evidence].sort()
      })
    ),
    research_variables: input.dataSchema.variables
      .map((variable) => ({
        variable_name: variable.variable_name,
        level: variable.level,
        source: variable.source,
        data_type: variable.data_type
      }))
      .sort((first, second) =>
        first.variable_name.localeCompare(second.variable_name)
      ),
    ethics_boundary_version: input.ethics.boundary_version,
    analysis_ids: input.analysis.analyses
      .map((analysis) => analysis.analysis_id)
      .sort(),
    hidden_reasoning_required: false,
    empirical_results_required: false
  };
  return {
    replay_version: "e2a43-empirical-protocol-replay-v1",
    replay_input: replayInput,
    replay_hash: stableHash(replayInput)
  };
}
