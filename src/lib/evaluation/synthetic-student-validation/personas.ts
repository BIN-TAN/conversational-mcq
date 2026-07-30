import {
  SYNTHETIC_STUDENT_VALIDATION_VERSION,
  SyntheticStudentPersonaSchema,
  type SyntheticStudentPersona,
  type SyntheticStudentPersonaId
} from "./contracts";

function parsePersona(
  persona: Omit<SyntheticStudentPersona, "validation_version">
) {
  return SyntheticStudentPersonaSchema.parse({
    validation_version: SYNTHETIC_STUDENT_VALIDATION_VERSION,
    ...persona
  });
}

export const SYNTHETIC_STUDENT_PERSONAS = [
  parsePersona({
    persona_id: "correct_shallow",
    display_name: "Correct but shallow understanding",
    description:
      "Selects correct answers but gives brief restatements with limited conceptual boundaries.",
    initial_knowledge_state:
      "Recognizes the target terms and usually selects the keyed distinction, but does not yet make the conceptual limits explicit.",
    response_behavior:
      "Mostly correct option selections paired with short explanations that omit why nearby alternatives are insufficient.",
    reasoning_style:
      "Short answer-focused explanations that name the correct idea without explaining why competing interpretations fail.",
    confidence_pattern: "Medium confidence across otherwise correct responses.",
    interaction_behavior:
      "Requests foundational explanation, clarification of significance, and a concrete example.",
    process_behavior:
      "Steady response timing, little revision, and no extended navigation away from the assessment.",
    validation_purpose:
      "Test whether shallow but correct evidence remains distinguishable from fully elaborated understanding without prescribing an outcome.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text: "Alpha is mainly about consistency.",
        confidence_rating: "medium",
        response_time_ms: 28_000,
        time_to_first_action_ms: 5_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text: "The standard error describes measurement error.",
        confidence_rating: "medium",
        response_time_ms: 31_000,
        time_to_first_action_ms: 6_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text: "Validity depends on how the scores are used.",
        confidence_rating: "medium",
        response_time_ms: 35_000,
        time_to_first_action_ms: 7_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "explanation_request",
        message_text: "Can you explain the main distinction from the beginning?",
        response_time_ms: 11_000,
        typing_duration_ms: 6_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "clarification_request",
        message_text: "I know the terms, but I am not sure why the distinction matters.",
        response_time_ms: 15_000,
        typing_duration_ms: 8_000,
        edit_count: 2,
        backspace_count: 2,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "example_request",
        message_text: "Can you show me a concrete example?",
        response_time_ms: 9_000,
        typing_duration_ms: 5_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "confident_misconception",
    display_name: "Misconception with confidence",
    description:
      "Consistently applies a plausible but incorrect rule and explains it with confidence.",
    initial_knowledge_state:
      "Uses a coherent but incorrect model that treats favorable reliability evidence as sufficient validity evidence.",
    response_behavior:
      "Selects misconception-aligned distractors and supports them with plausible, internally consistent explanations.",
    reasoning_style:
      "Coherent reasoning built around the misconception that one favorable statistic establishes the broader interpretation.",
    confidence_pattern: "High confidence on misconception-aligned answers.",
    interaction_behavior:
      "Requests justification, restates the misconception, and asks for a counterexample.",
    process_behavior:
      "Deliberate response timing with one answer revision and minimal navigation.",
    validation_purpose:
      "Test whether confident misconception evidence and subsequent conversation remain traceable without forcing a profile result.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "B",
        prior_option_selections: ["A"],
        reasoning_text:
          "A high alpha means the test is reliable, so its scores must also be valid.",
        confidence_rating: "high",
        response_time_ms: 44_000,
        time_to_first_action_ms: 8_000,
        reasoning_revision_count: 1,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "A small standard error means an individual observed score is essentially exact.",
        confidence_rating: "high",
        response_time_ms: 40_000,
        time_to_first_action_ms: 7_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "Once a test has a strong reliability statistic, the intended interpretation is established.",
        confidence_rating: "high",
        response_time_ms: 48_000,
        time_to_first_action_ms: 9_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "direct_answer_request",
        message_text: "Why is my rule not enough if the statistic is high?",
        response_time_ms: 13_000,
        typing_duration_ms: 7_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "clarification_request",
        message_text: "I still think a strong coefficient should prove the scores are valid.",
        response_time_ms: 17_000,
        typing_duration_ms: 9_000,
        edit_count: 2,
        backspace_count: 3,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "example_request",
        message_text: "Can you give an example where scores are consistent but the interpretation is wrong?",
        response_time_ms: 18_000,
        typing_duration_ms: 10_000,
        edit_count: 1,
        backspace_count: 2,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "correct_low_confidence",
    display_name: "Correct but low confidence",
    description:
      "Chooses correct answers and supplies relevant reasons while expressing uncertainty.",
    initial_knowledge_state:
      "Shows the target conceptual distinctions but treats them tentatively and does not trust the conclusions.",
    response_behavior:
      "Selects correct options with relevant reasoning while explicitly hedging or revising responses.",
    reasoning_style:
      "Tentative but conceptually relevant explanations that hedge otherwise appropriate distinctions.",
    confidence_pattern: "Low confidence despite correct responses.",
    interaction_behavior:
      "Requests explanation and reassurance, then reflects on the mismatch between reasoning and confidence.",
    process_behavior:
      "Longer pauses, one reasoning revision, and a brief page leave and return.",
    validation_purpose:
      "Test whether the conversation can support uncertainty without assuming remediation or a predetermined improvement.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text:
          "I think alpha is about consistency rather than proving validity, but I am not completely sure.",
        confidence_rating: "low",
        response_time_ms: 64_000,
        time_to_first_action_ms: 14_000,
        reasoning_revision_count: 1,
        navigation_observations: [
          {
            event_type: "page_hidden",
            offset_ms: 25_000,
            observed_interval_duration_ms: 8_000
          },
          {
            event_type: "page_visible",
            offset_ms: 33_000,
            observed_interval_duration_ms: null
          }
        ]
      },
      {
        item_number: 2,
        selected_option: "A",
        prior_option_selections: ["B"],
        reasoning_text:
          "The standard error gives a range of expected score error, not certainty about one exact score.",
        confidence_rating: "low",
        response_time_ms: 70_000,
        time_to_first_action_ms: 18_000,
        reasoning_revision_count: 1,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text:
          "The evidence should match the interpretation and use of the scores.",
        confidence_rating: "low",
        response_time_ms: 58_000,
        time_to_first_action_ms: 12_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "explanation_request",
        message_text: "Could you walk through why my answers make sense?",
        response_time_ms: 12_000,
        typing_duration_ms: 7_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "clarification_request",
        message_text: "How can I tell when I have enough evidence for an interpretation?",
        response_time_ms: 16_000,
        typing_duration_ms: 9_000,
        edit_count: 2,
        backspace_count: 2,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text: "I think I was using the right distinction, but I did not trust it.",
        response_time_ms: 14_000,
        typing_duration_ms: 8_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "overconfident_incorrect",
    display_name: "Overconfident incorrect student",
    description:
      "Selects incorrect options quickly and presents unsupported conclusions with high confidence.",
    initial_knowledge_state:
      "Applies categorical but unsupported rules and does not initially recognize the evidentiary boundary.",
    response_behavior:
      "Selects incorrect options rapidly, gives brief assertions, and does not revise assessment responses.",
    reasoning_style:
      "Brief categorical claims that skip the evidentiary boundary required by the item.",
    confidence_pattern: "High confidence across incorrect responses.",
    interaction_behavior:
      "Requests direct correction, challenges the distinction, and asks for a short example.",
    process_behavior:
      "Fast first actions, short total response times, and no revisions.",
    validation_purpose:
      "Test conversational adaptation to resistant, high-confidence incorrect evidence without fixing the tutor response.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text: "High reliability proves the test works.",
        confidence_rating: "high",
        response_time_ms: 12_000,
        time_to_first_action_ms: 1_500,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "C",
        prior_option_selections: [],
        reasoning_text: "The standard error is the percentage of wrong answers.",
        confidence_rating: "high",
        response_time_ms: 10_000,
        time_to_first_action_ms: 1_200,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text: "A good coefficient automatically establishes validity.",
        confidence_rating: "high",
        response_time_ms: 11_000,
        time_to_first_action_ms: 1_300,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "direct_answer_request",
        message_text: "Just tell me why those answers were wrong.",
        response_time_ms: 7_000,
        typing_duration_ms: 4_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "clarification_request",
        message_text: "I do not see why reliability does not settle the question.",
        response_time_ms: 10_000,
        typing_duration_ms: 5_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "example_request",
        message_text: "Give me a short example.",
        response_time_ms: 6_000,
        typing_duration_ms: 3_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "disengaged",
    display_name: "Disengaged student",
    description:
      "Responds rapidly with minimal reasoning and intermittently leaves the page.",
    initial_knowledge_state:
      "Provides too little conceptual evidence to establish a stable account of understanding.",
    response_behavior:
      "Uses short answers, inconsistent options, and minimal explanations.",
    reasoning_style:
      "Very short uncertainty statements with little observable conceptual evidence.",
    confidence_pattern: "Low or medium confidence without stable alignment.",
    interaction_behavior:
      "Provides minimal follow-up, signals uncertainty, and may indicate a desire to stop.",
    process_behavior:
      "Fast responses, repeated visibility changes, and no substantive revision.",
    validation_purpose:
      "Test whether sparse interaction and possible quitting behavior are preserved and handled without a forced learning outcome.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "C",
        prior_option_selections: [],
        reasoning_text: "Not sure.",
        confidence_rating: "low",
        response_time_ms: 9_000,
        time_to_first_action_ms: 1_000,
        reasoning_revision_count: 0,
        navigation_observations: [
          {
            event_type: "page_hidden",
            offset_ms: 2_000,
            observed_interval_duration_ms: 3_000
          },
          {
            event_type: "page_visible",
            offset_ms: 5_000,
            observed_interval_duration_ms: null
          }
        ]
      },
      {
        item_number: 2,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text: "It seems closest.",
        confidence_rating: "medium",
        response_time_ms: 8_000,
        time_to_first_action_ms: 900,
        reasoning_revision_count: 0,
        navigation_observations: [
          {
            event_type: "window_blur",
            offset_ms: 2_500,
            observed_interval_duration_ms: 2_000
          },
          {
            event_type: "window_focus",
            offset_ms: 4_500,
            observed_interval_duration_ms: null
          }
        ]
      },
      {
        item_number: 3,
        selected_option: "C",
        prior_option_selections: [],
        reasoning_text: "I guessed.",
        confidence_rating: "low",
        response_time_ms: 7_000,
        time_to_first_action_ms: 800,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "clarification_request",
        message_text: "What do you mean?",
        response_time_ms: 5_000,
        typing_duration_ms: 2_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "explanation_request",
        message_text: "Can you explain it simply?",
        response_time_ms: 6_000,
        typing_duration_ms: 3_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "example_request",
        message_text: "Maybe one example?",
        response_time_ms: 5_000,
        typing_duration_ms: 2_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "high_performing_extension",
    display_name: "High-performing extension-seeking student",
    description:
      "Responds accurately with well-developed reasoning and seeks transfer beyond the administered examples.",
    initial_knowledge_state:
      "Demonstrates strong distinctions among reliability, measurement error, and validity evidence.",
    response_behavior:
      "Selects correct options and provides detailed explanations that address interpretation and competing claims.",
    reasoning_style:
      "Explains conceptual boundaries, qualifies claims, and connects evidence to intended score interpretation.",
    confidence_pattern: "High confidence supported by detailed reasoning.",
    interaction_behavior:
      "Requests high-stakes and fairness extensions, works through an advanced example, and tests a broader generalization.",
    process_behavior:
      "Moderate deliberate timing, targeted revision, and uninterrupted assessment work.",
    validation_purpose:
      "Test whether the tutor can extend an already strong discussion without imposing unnecessary remedial structure.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text:
          "A high alpha supports internal consistency, but validity requires evidence for the intended interpretation and use of the scores.",
        confidence_rating: "high",
        response_time_ms: 52_000,
        time_to_first_action_ms: 8_000,
        reasoning_revision_count: 1,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text:
          "The standard error describes expected measurement error around an observed score; it does not make the observed score exact.",
        confidence_rating: "high",
        response_time_ms: 55_000,
        time_to_first_action_ms: 9_000,
        reasoning_revision_count: 1,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text:
          "Validity concerns the evidence supporting a particular interpretation and use, so it is not an automatic property established by reliability alone.",
        confidence_rating: "high",
        response_time_ms: 60_000,
        time_to_first_action_ms: 10_000,
        reasoning_revision_count: 1,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "extension_request",
        message_text:
          "How would this distinction change when a score is used for a high-stakes decision?",
        response_time_ms: 18_000,
        typing_duration_ms: 10_000,
        edit_count: 2,
        backspace_count: 2,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "example_request",
        message_text:
          "Can we work through an example where reliability is adequate but fairness evidence is weak?",
        response_time_ms: 20_000,
        typing_duration_ms: 11_000,
        edit_count: 2,
        backspace_count: 3,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text:
          "So the same score could support one use but not another because the required validity evidence changes. Is that the right way to frame it?",
        response_time_ms: 24_000,
        typing_duration_ms: 13_000,
        edit_count: 3,
        backspace_count: 4,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "fragmented_inconsistent",
    display_name: "Fragmented or inconsistent understanding",
    description:
      "Shows a correct distinction on one item while applying conflicting rules to closely related items.",
    initial_knowledge_state:
      "Recognizes that internal consistency is limited evidence, but does not apply that boundary consistently to score uncertainty or validity.",
    response_behavior:
      "Combines one correct response with two related incorrect responses and conflicting explanations.",
    reasoning_style:
      "Uses relevant vocabulary but changes the conceptual rule across items without reconciling the conflict.",
    confidence_pattern:
      "Medium to high confidence despite inconsistent conclusions.",
    interaction_behavior:
      "Asks for help reconciling the items, tests a general rule, and attempts to restate the distinction.",
    process_behavior:
      "Moderate response times, one option revision, and a short visibility interruption.",
    validation_purpose:
      "Test whether cross-item inconsistency and a later independent application remain visible to profiling, conversation, and research traces without prescribing a profile label.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text:
          "Alpha shows consistency, but I do not think it proves every interpretation is valid.",
        confidence_rating: "high",
        response_time_ms: 38_000,
        time_to_first_action_ms: 6_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "B",
        prior_option_selections: ["A"],
        reasoning_text:
          "If the standard error is small, the observed score should be the exact true score.",
        confidence_rating: "medium",
        response_time_ms: 47_000,
        time_to_first_action_ms: 9_000,
        reasoning_revision_count: 1,
        navigation_observations: [
          {
            event_type: "window_blur",
            offset_ms: 18_000,
            observed_interval_duration_ms: 4_000
          },
          {
            event_type: "window_focus",
            offset_ms: 22_000,
            observed_interval_duration_ms: null
          }
        ]
      },
      {
        item_number: 3,
        selected_option: "C",
        prior_option_selections: [],
        reasoning_text:
          "Once a test is validated, I think validity stays with the test in every context.",
        confidence_rating: "high",
        response_time_ms: 42_000,
        time_to_first_action_ms: 7_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "clarification_request",
        message_text:
          "I thought I understood the first question, so why do my other answers not follow the same rule?",
        response_time_ms: 16_000,
        typing_duration_ms: 9_000,
        edit_count: 2,
        backspace_count: 3,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "explanation_request",
        message_text:
          "Can you connect consistency, score error, and validity without treating them as three unrelated facts?",
        response_time_ms: 20_000,
        typing_duration_ms: 11_000,
        edit_count: 2,
        backspace_count: 2,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text:
          "A small SEM narrows uncertainty but does not make an observed score exact, and reliable scores still need separate evidence for a particular use. For a placement decision, I would report the uncertainty and ask for validity evidence instead of treating consistency as proof.",
        response_time_ms: 23_000,
        typing_duration_ms: 13_000,
        edit_count: 3,
        backspace_count: 4,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "strategic_answerer",
    display_name: "Strategic answerer or test-taking behavior",
    description:
      "Selects keyed options using surface cues while providing weak explanations and unusually fast process evidence.",
    initial_knowledge_state:
      "Can recognize target keywords but supplies little evidence of an independently connected conceptual model.",
    response_behavior:
      "Selects correct options while relying on wording cues and brief keyword-based reasoning.",
    reasoning_style:
      "Names terms from the options without explaining their conceptual relationship or boundary.",
    confidence_pattern:
      "High confidence that is not matched by explanation depth or deliberation time.",
    interaction_behavior:
      "Asks whether the answers were right, discloses use of wording cues, and requests a conceptual way to distinguish the choices.",
    process_behavior:
      "Very fast first actions and completion, no revisions, and one pasted follow-up message.",
    validation_purpose:
      "Test whether correctness, weak reasoning, confidence, and process evidence remain jointly available without turning process data into a trait claim.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text: "Consistency is the keyword.",
        confidence_rating: "high",
        response_time_ms: 8_000,
        time_to_first_action_ms: 800,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text: "Measurement error matches standard error.",
        confidence_rating: "high",
        response_time_ms: 7_500,
        time_to_first_action_ms: 700,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "A",
        prior_option_selections: [],
        reasoning_text: "Interpretation and use are the validity words.",
        confidence_rating: "high",
        response_time_ms: 8_500,
        time_to_first_action_ms: 900,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "direct_answer_request",
        message_text: "Did I get all three right?",
        response_time_ms: 4_000,
        typing_duration_ms: 2_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text:
          "I mostly matched words in the options instead of working through the ideas.",
        response_time_ms: 6_000,
        typing_duration_ms: 0,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 1,
        paste_character_count: 77
      },
      {
        intent: "explanation_request",
        message_text:
          "What conceptual question should I ask myself instead of looking for keywords?",
        response_time_ms: 11_000,
        typing_duration_ms: 6_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "help_seeking_confused",
    display_name: "Help-seeking but confused",
    description:
      "Actively requests support but has difficulty identifying or articulating the source of confusion.",
    initial_knowledge_state:
      "Distinguishes few of the target concepts and cannot yet state how reliability, score uncertainty, and validity differ.",
    response_behavior:
      "Provides uncertain, mixed responses and explicitly acknowledges not knowing how to justify them.",
    reasoning_style:
      "Uses questions and uncertainty statements rather than a stable explanatory rule.",
    confidence_pattern: "Low confidence across mixed responses.",
    interaction_behavior:
      "Repeatedly asks for help, narrows the confusing terms, and requests a very simple example.",
    process_behavior:
      "Long pauses, one page leave and return, and multiple reasoning edits.",
    validation_purpose:
      "Test supportive conversational behavior when a student wants help but supplies initially sparse conceptual evidence.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "C",
        prior_option_selections: ["B"],
        reasoning_text:
          "I am not sure whether reliability is about validity or about error.",
        confidence_rating: "low",
        response_time_ms: 72_000,
        time_to_first_action_ms: 18_000,
        reasoning_revision_count: 2,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "C",
        prior_option_selections: [],
        reasoning_text:
          "I do not know what the standard error tells me about a score.",
        confidence_rating: "low",
        response_time_ms: 83_000,
        time_to_first_action_ms: 22_000,
        reasoning_revision_count: 1,
        navigation_observations: [
          {
            event_type: "page_hidden",
            offset_ms: 31_000,
            observed_interval_duration_ms: 12_000
          },
          {
            event_type: "page_visible",
            offset_ms: 43_000,
            observed_interval_duration_ms: null
          }
        ]
      },
      {
        item_number: 3,
        selected_option: "A",
        prior_option_selections: ["C"],
        reasoning_text:
          "I picked the answer about interpretation, but I cannot explain why context matters.",
        confidence_rating: "low",
        response_time_ms: 76_000,
        time_to_first_action_ms: 20_000,
        reasoning_revision_count: 2,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "clarification_request",
        message_text:
          "Can you help me? I know I am confused, but I cannot tell which part I am missing.",
        response_time_ms: 18_000,
        typing_duration_ms: 10_000,
        edit_count: 3,
        backspace_count: 4,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "explanation_request",
        message_text:
          "Reliability, validity, and measurement error are all blending together for me.",
        response_time_ms: 16_000,
        typing_duration_ms: 9_000,
        edit_count: 2,
        backspace_count: 2,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "example_request",
        message_text:
          "Could you use one very simple example and show what each term says and does not say?",
        response_time_ms: 17_000,
        typing_duration_ms: 10_000,
        edit_count: 2,
        backspace_count: 3,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "resistant_challenging",
    display_name: "Resistant or challenging student",
    description:
      "Challenges the tutor's claims, requests justification, and continues to defend an alternative interpretation.",
    initial_knowledge_state:
      "Treats reliability statistics as decisive and is skeptical that validity requires a separate argument.",
    response_behavior:
      "Selects misconception-aligned options with deliberate arguments rather than random or low-effort responses.",
    reasoning_style:
      "Uses assertive counterclaims and demands evidence for distinctions that conflict with the preferred rule.",
    confidence_pattern: "High confidence maintained across incorrect responses.",
    interaction_behavior:
      "Disagrees directly, requests a counterexample, and challenges the evidentiary standard.",
    process_behavior:
      "Deliberate response times, repeated editing, and no navigation away from the conversation.",
    validation_purpose:
      "Test robustness and epistemic dialogue when the student challenges the tutor without defining how the tutor must respond.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "If the coefficient is high, calling the scores invalid seems unreasonable because reliability is the main quality check.",
        confidence_rating: "high",
        response_time_ms: 52_000,
        time_to_first_action_ms: 9_000,
        reasoning_revision_count: 1,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "A sufficiently small error should make the observed score effectively exact.",
        confidence_rating: "high",
        response_time_ms: 49_000,
        time_to_first_action_ms: 8_000,
        reasoning_revision_count: 1,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "C",
        prior_option_selections: [],
        reasoning_text:
          "A validated test should stay valid; otherwise validation would never settle anything.",
        confidence_rating: "high",
        response_time_ms: 58_000,
        time_to_first_action_ms: 10_000,
        reasoning_revision_count: 2,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "clarification_request",
        message_text:
          "I disagree. Why should a high reliability coefficient not be enough evidence that the test works?",
        response_time_ms: 15_000,
        typing_duration_ms: 9_000,
        edit_count: 2,
        backspace_count: 3,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "example_request",
        message_text:
          "Give me a concrete counterexample where the scores are highly consistent but the intended conclusion is not justified.",
        response_time_ms: 19_000,
        typing_duration_ms: 11_000,
        edit_count: 3,
        backspace_count: 3,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text:
          "Even with that example, what evidence would justify saying the intended use is valid rather than just reliable?",
        response_time_ms: 21_000,
        typing_duration_ms: 12_000,
        edit_count: 3,
        backspace_count: 4,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "sudden_improvement",
    display_name: "Sudden improvement trajectory",
    description:
      "Begins with weak and incorrect evidence, then later supplies a substantially clearer conceptual explanation.",
    initial_knowledge_state:
      "Initially conflates reliability with validity and treats observed scores as more exact than the evidence supports.",
    response_behavior:
      "Provides weak misconception-aligned assessment responses before articulating a stronger distinction during conversation.",
    reasoning_style:
      "Moves from short causal assertions to an independently stated explanation of evidentiary limits.",
    confidence_pattern:
      "Medium confidence initially, followed by more qualified conversational language.",
    interaction_behavior:
      "States the initial rule, checks a partial distinction, and later offers a fuller explanation in the student's own words.",
    process_behavior:
      "Moderate assessment timing followed by longer, more edited reflective messages.",
    validation_purpose:
      "Test sensitivity to later conversation evidence while leaving any profile transition entirely to the production agent.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text: "A reliable test should also be valid.",
        confidence_rating: "medium",
        response_time_ms: 29_000,
        time_to_first_action_ms: 5_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "A small standard error means the observed score is probably exact.",
        confidence_rating: "medium",
        response_time_ms: 32_000,
        time_to_first_action_ms: 6_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "High reliability should provide the validity evidence we need.",
        confidence_rating: "medium",
        response_time_ms: 30_000,
        time_to_first_action_ms: 5_500,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "reflection",
        message_text:
          "I started with the idea that reliability means the test is accurate and valid.",
        response_time_ms: 12_000,
        typing_duration_ms: 7_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "clarification_request",
        message_text:
          "Is the key difference that consistency describes how scores behave, while validity asks whether a particular interpretation is supported?",
        response_time_ms: 19_000,
        typing_duration_ms: 11_000,
        edit_count: 3,
        backspace_count: 4,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text:
          "A test can produce consistent scores and still fail to support the intended use. For example, an admissions test could reliably measure reading difficulty instead of readiness. Measurement error leaves uncertainty around observed scores, and validity needs evidence for the interpretation and context.",
        response_time_ms: 31_000,
        typing_duration_ms: 18_000,
        edit_count: 5,
        backspace_count: 7,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  }),
  parsePersona({
    persona_id: "persistent_non_improvement",
    display_name: "Persistent non-improvement",
    description:
      "Continues to express the same conceptual confusion across repeated explanations and remains unable to apply the distinction.",
    initial_knowledge_state:
      "Treats consistency, accuracy, and validity as interchangeable and does not initially distinguish score uncertainty.",
    response_behavior:
      "Selects related distractors and repeats the same rule across all assessment responses.",
    reasoning_style:
      "Restates the initial claim rather than applying new distinctions to the evidence.",
    confidence_pattern:
      "Medium to high confidence in the initial rule with intermittent statements of confusion.",
    interaction_behavior:
      "Requests explanation, reports continued confusion, and restates the original interpretation after further support.",
    process_behavior:
      "Moderate response time, little revision, and increasingly short follow-up messages.",
    validation_purpose:
      "Test preservation of persistent confusion and any agent-authored teacher-assistance pathway without forcing that outcome.",
    assessment_response_behavior: [
      {
        item_number: 1,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "High reliability means the test is accurate enough to be valid.",
        confidence_rating: "high",
        response_time_ms: 34_000,
        time_to_first_action_ms: 6_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 2,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "A small error means the score is the person's true score.",
        confidence_rating: "medium",
        response_time_ms: 36_000,
        time_to_first_action_ms: 7_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      },
      {
        item_number: 3,
        selected_option: "B",
        prior_option_selections: [],
        reasoning_text:
          "Reliability is the evidence that makes the interpretation valid.",
        confidence_rating: "high",
        response_time_ms: 33_000,
        time_to_first_action_ms: 6_000,
        reasoning_revision_count: 0,
        navigation_observations: []
      }
    ],
    conversation_behavior: [
      {
        intent: "explanation_request",
        message_text:
          "Please explain again why a reliable test would not automatically be valid.",
        response_time_ms: 13_000,
        typing_duration_ms: 7_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "clarification_request",
        message_text:
          "I still do not understand the difference. They both sound like whether the test is good.",
        response_time_ms: 11_000,
        typing_duration_ms: 6_000,
        edit_count: 1,
        backspace_count: 1,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text:
          "Even after the different explanations, I still think consistent scores prove that the interpretation is valid, and I cannot explain why separate validity evidence would be needed.",
        response_time_ms: 10_000,
        typing_duration_ms: 5_000,
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  })
] as const satisfies readonly SyntheticStudentPersona[];

export function syntheticStudentPersonas(
  personaIds?: readonly SyntheticStudentPersonaId[]
) {
  if (!personaIds || personaIds.length === 0) {
    return [...SYNTHETIC_STUDENT_PERSONAS];
  }
  const selected = new Set(personaIds);
  return SYNTHETIC_STUDENT_PERSONAS.filter((persona) =>
    selected.has(persona.persona_id)
  );
}

export function parseSyntheticStudentPersonas(input: unknown) {
  return zodPersonaArray(input);
}

function zodPersonaArray(input: unknown) {
  const parsed = Array.isArray(input) ? input : [input];
  return parsed.map((persona) => SyntheticStudentPersonaSchema.parse(persona));
}
