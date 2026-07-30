import type { AgentOutputByName } from "@/lib/agents/contracts";
import type {
  FormativeConversationV5CaseId,
  FormativeConversationV5Fixture
} from "./contracts";

type Profile = AgentOutputByName["student_profiling_agent"];

const administeredItems = [
  {
    item_alias: "measurement_reliability" as const,
    item_order: 1,
    item_stem:
      "A test has a high internal-consistency coefficient. Which conclusion is best supported?",
    options: [
      {
        label: "A" as const,
        text: "The scores are internally consistent, but validity still needs separate evidence."
      },
      {
        label: "B" as const,
        text: "The high coefficient proves the scores are valid for every intended use."
      },
      {
        label: "C" as const,
        text: "The coefficient proves every observed score is free from measurement error."
      }
    ],
    correct_option: "A" as const,
    answer_explanation:
      "Internal consistency concerns how coherently scores behave. It does not by itself establish evidence for a particular interpretation or use.",
    distractor_rationales: {
      B: "Conflates reliability evidence with validity evidence.",
      C: "Treats a group-level reliability coefficient as error-free individual measurement."
    },
    expected_reasoning_patterns: [
      "Distinguishes score consistency from evidence for an intended interpretation."
    ],
    item_version: 1 as const
  },
  {
    item_alias: "standard_error_measurement" as const,
    item_order: 2,
    item_stem:
      "What does the standard error of measurement contribute when interpreting an observed score?",
    options: [
      {
        label: "A" as const,
        text: "It describes expected measurement error around an observed score."
      },
      {
        label: "B" as const,
        text: "It proves the observed score is the person's exact true score."
      },
      {
        label: "C" as const,
        text: "It reports the percentage of items answered incorrectly."
      }
    ],
    correct_option: "A" as const,
    answer_explanation:
      "The standard error of measurement represents expected score uncertainty; it does not make an observed score exact.",
    distractor_rationales: {
      B: "Removes uncertainty rather than representing it.",
      C: "Confuses measurement error with an item-level error percentage."
    },
    expected_reasoning_patterns: [
      "Connects the standard error of measurement with uncertainty around observed scores."
    ],
    item_version: 1 as const
  },
  {
    item_alias: "validity_argument" as const,
    item_order: 3,
    item_stem:
      "Which statement best reflects a contemporary validity argument?",
    options: [
      {
        label: "A" as const,
        text: "Evidence is evaluated for the intended interpretation and use of scores."
      },
      {
        label: "B" as const,
        text: "Validity is automatically established whenever reliability is high."
      },
      {
        label: "C" as const,
        text: "Validity is a permanent property of the test independent of context."
      }
    ],
    correct_option: "A" as const,
    answer_explanation:
      "Validity concerns the evidence supporting an intended score interpretation and use in context, not a context-free property of a test.",
    distractor_rationales: {
      B: "Treats reliability as sufficient validity evidence.",
      C: "Treats validity as detached from interpretation, use, and context."
    },
    expected_reasoning_patterns: [
      "Relates validity evidence to an intended interpretation and use."
    ],
    item_version: 1 as const
  }
];

function profile(input: {
  ability: Profile["ability_profile"];
  ability_flags: Profile["ability_pattern_flags"];
  engagement?: Profile["engagement_profile"];
  engagement_flags?: Profile["engagement_pattern_flags"];
  integrated: Profile["integrated_diagnostic_profile"];
  integrated_confidence?: Profile["integrated_profile_confidence"];
  rationale: string;
  sufficiency: Profile["evidence_sufficiency"];
  confidence_alignment: Profile["confidence_alignment"];
  independence: Profile["independence_interpretability"];
  misconception?: string | null;
  reasoning_summary: string;
  next_evidence: string;
}): Profile {
  return {
    agent_name: "student_profiling_agent",
    agent_version: "synthetic-frozen-profile-v1",
    prompt_version: "synthetic-frozen-profile-v1",
    schema_version: "student-profile-output-v2",
    output_status: "ok",
    warnings: ["Synthetic operational-evaluation context only."],
    profile_type: "initial",
    ability_profile: input.ability,
    ability_pattern_flags: input.ability_flags,
    engagement_profile:
      input.engagement ?? "adequate_engagement",
    engagement_pattern_flags:
      input.engagement_flags ?? ["no_clear_pattern"],
    integrated_diagnostic_profile: input.integrated,
    integrated_profile_confidence:
      input.integrated_confidence ?? "medium",
    integrated_profile_rationale: input.rationale,
    evidence_sufficiency: input.sufficiency,
    confidence_alignment: input.confidence_alignment,
    independence_interpretability: input.independence,
    misconception_indicators: input.misconception
      ? [
          {
            indicator: input.misconception,
            evidence_reference: "administered_assessment_evidence",
            confidence: "medium",
            rationale: input.rationale
          }
        ]
      : [],
    item_level_evidence: administeredItems.map((item) => ({
      item_public_id: null,
      evidence_summary: `Frozen synthetic evidence for administered item ${item.item_order}.`,
      correctness: null,
      reasoning_quality: "case_specific_reasoning_in_assessment_response",
      confidence_rating: null
    })),
    reasoning_quality_summary: input.reasoning_summary,
    engagement_summary:
      "The synthetic student completed all assessment evidence fields; process observations are not interpreted as traits.",
    process_interpretation_cautions: [
      "Timing, navigation, and revision observations do not establish motivation, strategy, or learning."
    ],
    profile_confidence:
      input.integrated_confidence ?? "medium",
    rationale: input.rationale,
    recommended_next_evidence: [
      {
        evidence_type: "conversation_evidence",
        reason: input.next_evidence,
        item_public_id: null
      }
    ]
  };
}

function response(input: {
  item: 1 | 2 | 3;
  selected: "A" | "B" | "C";
  reasoning: string;
  confidence: "low" | "medium" | "high";
  tempting?: "A" | "B" | "C" | null;
  temptingReason?: string | null;
  prior?: Array<"A" | "B" | "C">;
  responseTime?: number;
  firstAction?: number;
  revisions?: number;
  navigation?: Array<{
    event_type:
      | "page_hidden"
      | "page_visible"
      | "window_blur"
      | "window_focus"
      | "navigation_event";
    offset_ms: number;
    observed_interval_duration_ms: number | null;
  }>;
}) {
  return {
    item_number: input.item,
    selected_option: input.selected,
    prior_option_selections: input.prior ?? [],
    tempting_option: input.tempting ?? null,
    tempting_option_reason: input.temptingReason ?? null,
    reasoning_text: input.reasoning,
    confidence_rating: input.confidence,
    response_time_ms: input.responseTime ?? 42_000,
    time_to_first_action_ms: input.firstAction ?? 7_000,
    reasoning_revision_count: input.revisions ?? 0,
    navigation_observations: input.navigation ?? []
  };
}

function message(
  sequence: number,
  intent:
    | "explanation_request"
    | "clarification_request"
    | "example_request"
    | "direct_answer_request"
    | "reflection"
    | "extension_request",
  messageText: string,
  responseTime = 16_000
) {
  return {
    sequence,
    intent,
    message_text: messageText,
    observable_input_telemetry: {
      response_time_ms: responseTime,
      typing_duration_ms: Math.max(1_000, responseTime - 4_000),
      edit_count: sequence % 2,
      backspace_count: sequence % 3,
      paste_event_count: 0,
      paste_character_count: 0
    }
  };
}

function assertion(
  assertionId: string,
  description: string,
  method:
    | "deterministic_artifact_check"
    | "human_review" = "human_review",
  severity: "blocking" | "human_review" =
    method === "deterministic_artifact_check"
      ? "blocking"
      : "human_review"
) {
  return {
    assertion_id: assertionId,
    description,
    severity,
    evaluation_method: method
  };
}

function fixture(input: {
  case_id: FormativeConversationV5CaseId;
  order: number;
  title: string;
  execution_case_type:
    | "opening_only"
    | "single_message_conversation"
    | "multi_message_adaptive"
    | "profile_transition";
  subject: FormativeConversationV5Fixture["execution_subject_id"];
  responses: FormativeConversationV5Fixture["assessment_responses"];
  consistency:
    | "coherent"
    | "mixed_resolved"
    | "mixed_unresolved"
    | "insufficient";
  initial_profile: Profile;
  messages: FormativeConversationV5Fixture["student_messages"];
  assertions: FormativeConversationV5Fixture["case_assertions"];
  outcomes: FormativeConversationV5Fixture["permitted_terminal_outcomes"];
  terminal_condition?: string;
}) {
  const logicalCalls = [
    {
      sequence: 1,
      call_type: "assistant_first_opening" as const,
      student_message_sequence: null,
      logical_call_issued_once: true as const
    },
    ...input.messages.map((entry, index) => ({
      sequence: index + 2,
      call_type: "student_message_response" as const,
      student_message_sequence: entry.sequence,
      logical_call_issued_once: true as const
    }))
  ];
  const terminalExecutionPoint =
    input.execution_case_type === "opening_only"
      ? ("opening_persisted_or_typed_failure" as const)
      : input.execution_case_type === "profile_transition"
        ? ("profile_transition_evaluated_after_messages" as const)
        : ("ordered_student_messages_exhausted" as const);
  return {
    fixture_version:
      "formative-conversation-v5-executable-fixture-v2",
    case_id: input.case_id,
    case_order: input.order,
    title: input.title,
    execution_case_type: input.execution_case_type,
    execution_subject_id: input.subject,
    synthetic_only: true,
    real_student_information_present: false,
    expected_outcome_in_runtime_input: false,
    opening_executed: true,
    expected_student_message_count: input.messages.length,
    expected_logical_call_count: logicalCalls.length,
    terminal_execution_point: terminalExecutionPoint,
    synthetic_identity: {
      namespace_template: `<provider_run_id>:${input.case_id}`,
      assessment_identity_template: "<provider_run_id>:assessment",
      session_identity_template: `<provider_run_id>:${input.case_id}:session`,
      student_identity_template: `<provider_run_id>:${input.subject}`
    },
    assessment: {
      title: "Synthetic measurement evidence assessment",
      concept_title: "Measurement evidence and score interpretation",
      learning_objective:
        "Explain how reliability, measurement error, and validity evidence support different claims about scores.",
      assessment_boundary:
        "Only the three administered measurement-theory items and directly related concepts may be discussed.",
      administered_items: administeredItems
    },
    assessment_responses: input.responses,
    observable_process_telemetry_policy: {
      raw_observations_only: true,
      inferred_behavior_fields_absent: true,
      source: "frozen_synthetic_fixture"
    },
    initial_profile_source: {
      mode: "frozen_validated_profile_context",
      production_schema_version: "student-profile-output-v2",
      generated_by_provider: false,
      evidence_consistency: {
        version: "student-profile-evidence-consistency-v1",
        classification: input.consistency,
        supporting_references: [
          "administered_item_1",
          "administered_item_2",
          "administered_item_3"
        ]
      },
      profile: input.initial_profile
    },
    student_messages: input.messages,
    case_assertions: input.assertions,
    permitted_terminal_outcomes: input.outcomes,
    required_provenance: [
      "conversation_public_id",
      "public AgentCall ID",
      "runtime candidate hash",
      "evaluation protocol hash",
      "fixture hash",
      "prompt and validator fingerprints",
      "supporting turn references for any transition"
    ],
    call_graph: {
      production_student_profiling_called: false,
      frozen_initial_profile_context_persisted: true,
      assistant_first_opening_called: true,
      student_message_count: input.messages.length,
      logical_calls: logicalCalls,
      expected_logical_calls: logicalCalls.length,
      maximum_logical_calls: logicalCalls.length,
      allowed_provider_attempts_per_logical_call: 3,
      maximum_transport_retries_per_logical_call: 2,
      terminal_condition:
        input.terminal_condition ??
        "Execute every frozen student message in order, then evaluate persisted evidence and any transition.",
      persistence_requirements: [
        "conversation session",
        "message receipts",
        "public AgentCalls",
        "student and tutor turns",
        "turn and input telemetry",
        "profile evidence references",
        "profile transition when recommended and validated"
      ],
      evaluation_steps: [
        "validate candidate and protocol identity",
        "validate every generated output and safety boundary",
        "validate persistence and public AgentCall joins",
        "evaluate case assertions",
        "queue all student-visible tutor text for human review"
      ]
    }
  };
}

export const formativeConversationV5FixtureSources = [
    fixture({
      case_id: "fcv5_01_assistant_first_opening",
      order: 1,
      title: "Assistant-first opening",
      execution_case_type: "opening_only",
      subject: "correct_shallow",
      responses: [
        response({
          item: 1,
          selected: "A",
          tempting: "B",
          temptingReason:
            "The coefficient sounded like broad evidence that the test works.",
          reasoning:
            "A high coefficient supports consistency, but validity is a different question.",
          confidence: "medium"
        }),
        response({
          item: 2,
          selected: "A",
          tempting: "B",
          temptingReason:
            "An exact true score sounded simpler than an uncertainty statement.",
          reasoning:
            "SEM tells us there is error around an observed score.",
          confidence: "medium"
        }),
        response({
          item: 3,
          selected: "A",
          tempting: "C",
          temptingReason:
            "I used to think validity belonged to the test itself.",
          reasoning:
            "Validity evidence should fit the intended use.",
          confidence: "medium"
        })
      ],
      consistency: "coherent",
      initial_profile: profile({
        ability: "fragile_correct_understanding",
        ability_flags: ["correct_answer_weak_reasoning"],
        integrated: "correct_but_fragile_understanding",
        rationale:
          "All selections are correct, while the explanations state the distinctions only briefly.",
        sufficiency: "adequate",
        confidence_alignment: "well_calibrated",
        independence: "independent_understanding_uncertain",
        reasoning_summary:
          "The reasoning is directionally correct but shallow across all three administered items.",
        next_evidence:
          "A fuller explanation could clarify whether the distinctions are independently understood."
      }),
      messages: [],
      assertions: [
        assertion(
          "opening_acknowledges_review",
          "The opening naturally acknowledges that the assessment review occurred."
        ),
        assertion(
          "opening_avoids_result_repetition",
          "The opening does not repeat personal scores, correctness counts, or a performance summary.",
          "deterministic_artifact_check"
        ),
        assertion(
          "conceptual_score_terms_allowed",
          "Conceptual or hypothetical uses of score, percentage, SEM, or numerical examples remain allowed."
        ),
        assertion(
          "opening_persisted_with_provenance",
          "The opening is persisted exactly once and linked to a validated public AgentCall.",
          "deterministic_artifact_check"
        )
      ],
      outcomes: ["continue_conversation"],
      terminal_condition:
        "Opening is persisted or the opening call reaches a typed terminal failure."
    }),
    fixture({
      case_id: "fcv5_02_first_principles_adaptation",
      order: 2,
      title: "First-principles explanation and adaptation",
      execution_case_type: "multi_message_adaptive",
      subject: "help_seeking_confused",
      responses: [
        response({
          item: 1,
          selected: "B",
          tempting: "A",
          temptingReason:
            "I could not see why consistency was not enough.",
          reasoning:
            "A reliable test should be valid because it gives consistent results.",
          confidence: "low",
          responseTime: 78_000,
          navigation: [
            {
              event_type: "page_hidden",
              offset_ms: 31_000,
              observed_interval_duration_ms: 9_000
            },
            {
              event_type: "page_visible",
              offset_ms: 40_000,
              observed_interval_duration_ms: null
            }
          ]
        }),
        response({
          item: 2,
          selected: "B",
          reasoning:
            "I am not sure what standard error changes about a score.",
          confidence: "low",
          responseTime: 82_000
        }),
        response({
          item: 3,
          selected: "C",
          tempting: "A",
          temptingReason:
            "The phrase intended use seemed important, but I did not understand it.",
          reasoning:
            "I thought validity was a property of the test.",
          confidence: "low",
          responseTime: 75_000
        })
      ],
      consistency: "coherent",
      initial_profile: profile({
        ability: "misconception_based_understanding",
        ability_flags: [
          "misconception_indicator_present",
          "distractor_aligned_reasoning",
          "conceptual_error_possible"
        ],
        integrated: "misconception_with_sufficient_engagement",
        rationale:
          "The responses repeatedly conflate consistency with validity and treat scores as exact.",
        sufficiency: "adequate",
        confidence_alignment: "underconfident",
        independence: "independent_understanding_uncertain",
        misconception:
          "Reliability or a measurement statistic is treated as sufficient proof of validity or exactness.",
        reasoning_summary:
          "The explanations show a coherent but incorrect boundary among reliability, score uncertainty, and validity.",
        next_evidence:
          "A first-principles explanation followed by student application could clarify the distinctions."
      }),
      messages: [
        message(
          1,
          "explanation_request",
          "Can you explain the difference from the beginning? I am mixing up reliability, error, and validity."
        ),
        message(
          2,
          "clarification_request",
          "I still do not understand. Could you explain it in a different way instead of repeating the same definitions?"
        )
      ],
      assertions: [
        assertion(
          "first_principles_explanation",
          "The tutor rebuilds the distinction from first principles."
        ),
        assertion(
          "adaptive_strategy_change",
          "The second response changes explanatory strategy after continued confusion."
        ),
        assertion(
          "contextual_continuity",
          "The second tutor response uses the prior conversation coherently."
        ),
        assertion(
          "no_activity_routing_language",
          "No activity family, recommended activity, or platform-selected sequence appears.",
          "deterministic_artifact_check"
        )
      ],
      outcomes: [
        "continue_conversation",
        "largely_improved_understanding"
      ]
    }),
    fixture({
      case_id: "fcv5_03_direct_answer_handling",
      order: 3,
      title: "Direct-answer handling",
      execution_case_type: "single_message_conversation",
      subject: "strategic_answerer",
      responses: [
        response({
          item: 1,
          selected: "B",
          reasoning:
            "I selected the strongest sounding claim because I was unsure.",
          confidence: "medium",
          tempting: "A",
          temptingReason:
            "A was more cautious, but I thought the coefficient proved more."
        }),
        response({
          item: 2,
          selected: "A",
          reasoning:
            "SEM describes uncertainty around an observed score.",
          confidence: "medium"
        }),
        response({
          item: 3,
          selected: "A",
          reasoning:
            "Validity evidence depends on the interpretation and use.",
          confidence: "medium"
        })
      ],
      consistency: "coherent",
      initial_profile: profile({
        ability: "partial_understanding",
        ability_flags: [
          "distractor_aligned_reasoning",
          "correctness_reasoning_mismatch"
        ],
        integrated: "developing_understanding_with_productive_engagement",
        rationale:
          "The student distinguishes SEM and validity but overstates what reliability establishes.",
        sufficiency: "adequate",
        confidence_alignment: "mixed",
        independence: "independent_understanding_uncertain",
        misconception:
          "A reliability coefficient is treated as proof of validity.",
        reasoning_summary:
          "Two explanations are supported, while the reliability-validity boundary remains unresolved.",
        next_evidence:
          "A direct explanation of the administered answer can support a more precise comparison."
      }),
      messages: [
        message(
          1,
          "direct_answer_request",
          "Please give me the answer to the reliability item directly and explain why it is right."
        )
      ],
      assertions: [
        assertion(
          "direct_answer_permitted",
          "The tutor answers the request directly rather than forcing rediscovery."
        ),
        assertion(
          "administered_content_only",
          "Any answer reveal is limited to the three administered items.",
          "deterministic_artifact_check"
        ),
        assertion(
          "educational_explanation_present",
          "The direct answer includes a conceptually useful explanation."
        ),
        assertion(
          "no_evasive_scaffolding",
          "The tutor does not evade the direct request through a fixed scaffold."
        )
      ],
      outcomes: [
        "continue_conversation",
        "largely_improved_understanding"
      ]
    }),
    fixture({
      case_id: "fcv5_04_related_concept_discussion",
      order: 4,
      title: "Related-concept discussion",
      execution_case_type: "single_message_conversation",
      subject: "high_performing_extension",
      responses: [
        response({
          item: 1,
          selected: "A",
          reasoning:
            "Internal consistency is reliability evidence, while validity requires evidence for the intended interpretation.",
          confidence: "high"
        }),
        response({
          item: 2,
          selected: "A",
          reasoning:
            "SEM represents uncertainty around an observed score rather than an exact correction.",
          confidence: "high"
        }),
        response({
          item: 3,
          selected: "A",
          reasoning:
            "Validity is an argument about score interpretation and use in context.",
          confidence: "high"
        })
      ],
      consistency: "coherent",
      initial_profile: profile({
        ability: "mostly_correct_understanding",
        ability_flags: ["transfer_ready"],
        engagement: "productive_engagement",
        engagement_flags: ["sustained_engagement"],
        integrated: "robust_understanding_ready_for_transfer",
        integrated_confidence: "high",
        rationale:
          "All three explanations independently distinguish the relevant measurement claims.",
        sufficiency: "strong",
        confidence_alignment: "well_calibrated",
        independence: "independent_understanding_likely",
        reasoning_summary:
          "The student provides concise, accurate conceptual boundaries across the item set.",
        next_evidence:
          "A related application can test whether the distinction transfers beyond the administered wording."
      }),
      messages: [
        message(
          1,
          "extension_request",
          "Can we discuss how reliability and validity relate to fairness in testing, even though fairness was not one of the original items?"
        )
      ],
      assertions: [
        assertion(
          "related_concept_allowed",
          "The tutor may leave the original item to discuss a relevant related concept."
        ),
        assertion(
          "related_context_coherent",
          "The discussion remains connected to the administered measurement concepts."
        ),
        assertion(
          "no_platform_sequence",
          "No platform-selected pedagogical sequence or activity route appears.",
          "deterministic_artifact_check"
        )
      ],
      outcomes: [
        "continue_conversation",
        "sound_understanding"
      ]
    }),
    fixture({
      case_id: "fcv5_05_sound_profile_transition",
      order: 5,
      title: "Sound profile transition",
      execution_case_type: "profile_transition",
      subject: "sudden_improvement",
      responses: [
        response({
          item: 1,
          selected: "B",
          reasoning:
            "A consistent test should automatically be valid.",
          confidence: "medium",
          tempting: "A",
          temptingReason:
            "A separated consistency and validity, but I did not see why."
        }),
        response({
          item: 2,
          selected: "B",
          reasoning:
            "I thought SEM identifies the exact true score.",
          confidence: "medium"
        }),
        response({
          item: 3,
          selected: "C",
          reasoning:
            "Validity seems like a permanent test property.",
          confidence: "medium"
        })
      ],
      consistency: "coherent",
      initial_profile: profile({
        ability: "misconception_based_understanding",
        ability_flags: [
          "misconception_indicator_present",
          "distractor_aligned_reasoning"
        ],
        integrated: "misconception_with_sufficient_engagement",
        rationale:
          "The initial assessment consistently overstates what reliability, SEM, and a test alone establish.",
        sufficiency: "adequate",
        confidence_alignment: "mixed",
        independence: "independent_understanding_uncertain",
        misconception:
          "Measurement statistics are treated as definitive proof without interpretation-specific evidence.",
        reasoning_summary:
          "The initial explanations are coherent but conceptually incorrect.",
        next_evidence:
          "Independent explanation and application could show whether the conceptual boundary changes."
      }),
      messages: [
        message(
          1,
          "explanation_request",
          "Could you show me why consistency alone does not establish validity?"
        ),
        message(
          2,
          "reflection",
          "I can apply the distinction now: if a hiring test gives consistent scores, that supports score stability, but it does not show the scores predict job performance. We would still need evidence linking the scores to that intended hiring use."
        )
      ],
      assertions: [
        assertion(
          "sound_requires_observable_evidence",
          "A sound recommendation relies on the student's independent explanation and application, not self-report alone.",
          "deterministic_artifact_check"
        ),
        assertion(
          "sound_transition_allowed",
          "A sound transition may be recommended when the observable student evidence supports it."
        ),
        assertion(
          "transition_provenance_complete",
          "Any persisted transition links prior and updated profiles, supporting turns, evidence references, and the public AgentCall.",
          "deterministic_artifact_check"
        ),
        assertion(
          "teacher_export_transition_parity",
          "Teacher and export projections use the same persisted transition.",
          "deterministic_artifact_check"
        )
      ],
      outcomes: [
        "continue_conversation",
        "sound_understanding"
      ]
    }),
    fixture({
      case_id: "fcv5_06_largely_improved_temporal",
      order: 6,
      title: "Largely improved temporal transition",
      execution_case_type: "profile_transition",
      subject: "confident_misconception",
      responses: [
        response({
          item: 1,
          selected: "B",
          reasoning:
            "High reliability proves validity because consistent scores must be accurate.",
          confidence: "high",
          tempting: "A",
          temptingReason:
            "A seemed too cautious."
        }),
        response({
          item: 2,
          selected: "B",
          reasoning:
            "SEM should tell the exact score once error is removed.",
          confidence: "high"
        }),
        response({
          item: 3,
          selected: "C",
          reasoning:
            "A good test stays valid in every context.",
          confidence: "high"
        })
      ],
      consistency: "coherent",
      initial_profile: profile({
        ability: "misconception_based_understanding",
        ability_flags: [
          "misconception_indicator_present",
          "distractor_aligned_reasoning",
          "confidence_reasoning_mismatch"
        ],
        integrated: "misconception_with_sufficient_engagement",
        rationale:
          "High-confidence explanations consistently collapse reliability, score uncertainty, and validity into certainty.",
        sufficiency: "strong",
        confidence_alignment: "overconfident",
        independence: "independent_understanding_likely",
        misconception:
          "Reliability is treated as proof of validity and score exactness.",
        reasoning_summary:
          "The reasoning clearly expresses a stable initial misconception.",
        next_evidence:
          "A later explanation should be compared temporally with the initial misconception rather than treated as simultaneous conflict."
      }),
      messages: [
        message(
          1,
          "explanation_request",
          "I thought high reliability meant validity. Can you show me exactly where that reasoning crosses the boundary?"
        ),
        message(
          2,
          "reflection",
          "I see the change: reliability supports consistency, while validity needs evidence for the intended interpretation and use. I would not claim high reliability proves validity now. I still struggle to decide which kind of validity evidence fits a new use."
        )
      ],
      assertions: [
        assertion(
          "temporal_change_not_conflict",
          "Stronger later evidence is represented as temporal learning change rather than simultaneous unresolved conflict.",
          "deterministic_artifact_check"
        ),
        assertion(
          "largely_improved_supported",
          "Largely improved may be persisted when meaningful improvement and a supported limitation coexist."
        ),
        assertion(
          "prior_updated_profiles_linked",
          "Any transition preserves append-only links between prior and updated profiles.",
          "deterministic_artifact_check"
        ),
        assertion(
          "stale_misconception_not_blindly_copied",
          "Stale misconception fields are removed or retained only with explicit evidence."
        )
      ],
      outcomes: [
        "continue_conversation",
        "largely_improved_understanding"
      ]
    }),
    fixture({
      case_id: "fcv5_07_persistent_barrier_teacher_assistance",
      order: 7,
      title: "Persistent barrier and teacher assistance",
      execution_case_type: "profile_transition",
      subject: "persistent_non_improvement",
      responses: [
        response({
          item: 1,
          selected: "B",
          reasoning:
            "Consistency proves the interpretation is accurate.",
          confidence: "high",
          responseTime: 28_000
        }),
        response({
          item: 2,
          selected: "B",
          reasoning:
            "The observed score should become exact when SEM is known.",
          confidence: "high",
          responseTime: 30_000
        }),
        response({
          item: 3,
          selected: "C",
          reasoning:
            "Validity belongs to the test and does not change by use.",
          confidence: "high",
          responseTime: 27_000
        })
      ],
      consistency: "coherent",
      initial_profile: profile({
        ability: "misconception_based_understanding",
        ability_flags: [
          "misconception_indicator_present",
          "distractor_aligned_reasoning",
          "confidence_reasoning_mismatch"
        ],
        integrated: "misconception_with_sufficient_engagement",
        rationale:
          "The same broad certainty claim appears across reliability, SEM, and validity evidence.",
        sufficiency: "strong",
        confidence_alignment: "overconfident",
        independence: "independent_understanding_likely",
        misconception:
          "Consistency or a statistic is treated as conclusive proof of score interpretation.",
        reasoning_summary:
          "The student provides clear evidence of a persistent conceptual barrier at assessment.",
        next_evidence:
          "Materially different explanations can test whether the barrier changes while preserving agent discretion."
      }),
      messages: [
        message(
          1,
          "clarification_request",
          "I still think a high reliability coefficient proves the test is valid because a consistent test must be accurate."
        ),
        message(
          2,
          "clarification_request",
          "The example did not change my view. If a test repeats the same score, that seems enough to prove the interpretation is valid."
        ),
        message(
          3,
          "reflection",
          "I understand that you are separating consistency from validity evidence, but I cannot use that distinction. I would still tell a teacher that high reliability proves the score interpretation is valid."
        )
      ],
      assertions: [
        assertion(
          "teacher_assistance_agent_discretion",
          "Teacher assistance may be recommended from the persistent evidence without a fixed turn threshold."
        ),
        assertion(
          "assistance_outcome_coherent",
          "The authoritative transition outcome and assistance compatibility field are coherent.",
          "deterministic_artifact_check"
        ),
        assertion(
          "assistance_does_not_end_conversation",
          "A teacher-assistance recommendation does not automatically terminate the conversation.",
          "deterministic_artifact_check"
        ),
        assertion(
          "teacher_export_assistance_parity",
          "Teacher and export projections agree on any persisted assistance outcome.",
          "deterministic_artifact_check"
        )
      ],
      outcomes: [
        "continue_conversation",
        "teacher_assistance_recommended"
      ]
    }),
    fixture({
      case_id: "fcv5_08_mixed_resolved_evidence",
      order: 8,
      title: "Mixed resolved evidence",
      execution_case_type: "profile_transition",
      subject: "fragmented_inconsistent",
      responses: [
        response({
          item: 1,
          selected: "A",
          reasoning:
            "Reliability is consistency and does not establish every intended interpretation.",
          confidence: "medium",
          responseTime: 61_000,
          revisions: 1,
          prior: ["B"]
        }),
        response({
          item: 2,
          selected: "B",
          reasoning:
            "I know SEM is about error, but I still treated it as finding the exact true score.",
          confidence: "low",
          responseTime: 73_000
        }),
        response({
          item: 3,
          selected: "A",
          reasoning:
            "Validity evidence should match the interpretation and use.",
          confidence: "medium",
          responseTime: 59_000
        })
      ],
      consistency: "mixed_resolved",
      initial_profile: profile({
        ability: "fragmented_or_limited_understanding",
        ability_flags: [
          "incorrect_answer_strong_partial_reasoning",
          "correctness_reasoning_mismatch",
          "incomplete_reasoning"
        ],
        integrated: "developing_understanding_with_productive_engagement",
        rationale:
          "Evidence differs by item, but the dominant pattern distinguishes reliability and validity while leaving score uncertainty unresolved.",
        sufficiency: "adequate",
        confidence_alignment: "mixed",
        independence: "independent_understanding_uncertain",
        misconception:
          "SEM is still partly treated as identifying an exact true score.",
        reasoning_summary:
          "The evidence is fragmented but supports a dominant interpretation rather than a global unresolved conflict.",
        next_evidence:
          "Conversation can clarify the remaining SEM boundary without discarding supported reliability and validity evidence."
      }),
      messages: [
        message(
          1,
          "explanation_request",
          "Some of my answers pulled in different directions. Can you help me separate reliability, error, and validity?"
        ),
        message(
          2,
          "reflection",
          "The dominant distinction seems to be that reliability concerns consistency, SEM concerns uncertainty around an observed score, and validity concerns evidence for an intended interpretation. I am still unsure how much evidence is enough, so I want to keep discussing it."
        )
      ],
      assertions: [
        assertion(
          "mixed_resolved_initial_profile_valid",
          "The frozen initial profile represents mixed_resolved evidence with a supported dominant interpretation.",
          "deterministic_artifact_check"
        ),
        assertion(
          "opening_not_false_conflict",
          "The opening is not rejected because isolated or negated prose contains conflict language.",
          "deterministic_artifact_check"
        ),
        assertion(
          "conversation_proceeds",
          "The conversation proceeds from mixed resolved evidence."
        ),
        assertion(
          "continue_without_forced_transition",
          "Continue conversation remains valid when terminal evidence is absent.",
          "deterministic_artifact_check"
        )
      ],
      outcomes: [
        "continue_conversation",
        "largely_improved_understanding"
      ]
    })
  ] as const;
