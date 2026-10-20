import type { InterpretationInputV8, InterpretationOutputV8 } from "./contract";
import { explanationIsOptionText } from "./validate";

/**
 * Deterministic stand-in used only with the mock provider (local development and tests).
 * It is clearly labelled and never presented as an AI interpretation: every explanation is
 * rated limited (or no usable explanation when blank), and no misconception is claimed.
 */
export const LOCAL_TEST_INTERPRETATION_NOTE = "Local test interpretation: not an AI judgment.";

function firstWords(text: string, count: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  return words.slice(0, Math.min(count, words.length)).join(" ");
}

export function buildLocalTestInterpretationV8(input: InterpretationInputV8): InterpretationOutputV8 {
  return {
    items: input.items.map((item) => {
      const explanation = item.response.explanation;
      const answerIncorrect = item.response.answer_correct === false;
      if (!explanation) {
        return {
          item_id: item.item_id,
          explanation_quality: "no_usable_explanation" as const,
          no_usable_reason: "not_provided" as const,
          adds_beyond_option_text: null,
          evidence_quote: null,
          evidence_source: null,
          reference_id: null,
          missing_elements: null,
          rationale: LOCAL_TEST_INTERPRETATION_NOTE,
          error_source: answerIncorrect ? ("unclear" as const) : null,
          side_remark: null,
          uncertainty_note: null,
          process_interpretation: null
        };
      }
      return {
        item_id: item.item_id,
        explanation_quality: "limited" as const,
        no_usable_reason: null,
        adds_beyond_option_text: !explanationIsOptionText(item),
        evidence_quote: firstWords(explanation, 6),
        evidence_source: "explanation" as const,
        reference_id: item.references.find((reference) => reference.kind === "target_reasoning")?.reference_id ?? null,
        missing_elements: "Not judged in local test mode.",
        rationale: LOCAL_TEST_INTERPRETATION_NOTE,
        error_source: answerIncorrect ? ("unclear" as const) : null,
        side_remark: null,
        uncertainty_note: "Local test mode makes no judgment of the explanation.",
        process_interpretation: null
      };
    }),
    possible_misconceptions: [],
    considered_ideas: []
  };
}
