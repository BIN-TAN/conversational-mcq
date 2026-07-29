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
    reasoning_style:
      "Short answer-focused explanations that name the correct idea without explaining why competing interpretations fail.",
    confidence_pattern: "Medium confidence across otherwise correct responses.",
    process_behavior:
      "Steady response timing, little revision, and no extended navigation away from the assessment.",
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
    reasoning_style:
      "Coherent reasoning built around the misconception that one favorable statistic establishes the broader interpretation.",
    confidence_pattern: "High confidence on misconception-aligned answers.",
    process_behavior:
      "Deliberate response timing with one answer revision and minimal navigation.",
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
    reasoning_style:
      "Tentative but conceptually relevant explanations that hedge otherwise appropriate distinctions.",
    confidence_pattern: "Low confidence despite correct responses.",
    process_behavior:
      "Longer pauses, one reasoning revision, and a brief page leave and return.",
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
    reasoning_style:
      "Brief categorical claims that skip the evidentiary boundary required by the item.",
    confidence_pattern: "High confidence across incorrect responses.",
    process_behavior:
      "Fast first actions, short total response times, and no revisions.",
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
    reasoning_style:
      "Very short uncertainty statements with little observable conceptual evidence.",
    confidence_pattern: "Low or medium confidence without stable alignment.",
    process_behavior:
      "Fast responses, repeated visibility changes, and no substantive revision.",
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
    reasoning_style:
      "Explains conceptual boundaries, qualifies claims, and connects evidence to intended score interpretation.",
    confidence_pattern: "High confidence supported by detailed reasoning.",
    process_behavior:
      "Moderate deliberate timing, targeted revision, and uninterrupted assessment work.",
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
