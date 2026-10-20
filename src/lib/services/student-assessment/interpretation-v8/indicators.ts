import {
  browserItemTiming,
  deriveResponseStageVisits,
  deriveResponseSubmissions,
  summarizeItemStudentTime,
  type ResponseStageEvent
} from "../response-stage-data";
import type { ProcessIndicator, ProcessIndicatorRole } from "./contract";
import { RAPID_SELECTION_THRESHOLD_MS } from "./rules";

/**
 * Process indicators for interpretation v8 (docs/AI_MODULE_REDESIGN_2026-10-19.md, section
 * 6.1). The application computes them from the recorded events; each carries a fixed role
 * that limits what the models may conclude. They are for the profiling and feedback models'
 * own interpretation only: instructors keep the recorded process data panel, and students
 * are never told about them.
 */
export const PROCESS_INDICATORS_VERSION = "process-indicators-v1" as const;

type IndicatorName = ProcessIndicator["name"];

type IndicatorDefinition = {
  computed_as: string;
  role: ProcessIndicatorRole;
  may: string;
  may_not: string;
  alternatives: string[];
  unit: string | null;
};

const CONTEXT_MAY_NOT = "Infer GenAI use, copying, independent work or misconduct, or change a rating.";

export const PROCESS_INDICATOR_DEFINITIONS: Record<IndicatorName, IndicatorDefinition> = {
  rapid_selection: {
    computed_as: `true when the first answer choice came less than ${RAPID_SELECTION_THRESHOLD_MS / 1000} seconds after the item appeared; null when the time was not recorded`,
    role: "qualifies_evidence",
    may: "Treat the answer as possibly chosen before the item was read.",
    may_not: "Call it guessing or low effort as a fact.",
    alternatives: ["the answer was recognised at once", "the item was familiar from an earlier attempt", "a quick guess"],
    unit: null
  },
  answer_change: {
    computed_as: "first and final selected option compared with the key: none, incorrect_to_correct, correct_to_incorrect, incorrect_to_incorrect, or changed_and_returned",
    role: "with_content",
    may: "Interpret a possible revision of reasoning, together with what the student wrote.",
    may_not: "Treat a change alone as confusion or guessing.",
    alternatives: ["reconsidering after more thought", "correcting a mis-click", "uncertainty between two options"],
    unit: null
  },
  explanation_revised: {
    computed_as: "true when the final explanation differs from the first version, including edits during the final review",
    role: "with_content",
    may: "Compare the two versions and say what changed.",
    may_not: "Rate the first version instead of the final one.",
    alternatives: ["clarifying the wording", "reconsidering the reasoning", "adding detail"],
    unit: null
  },
  confidence_change: {
    computed_as: "first and final confidence rating compared: none, higher or lower",
    role: "with_content",
    may: "Note the shift beside an answer or explanation change.",
    may_not: "Infer calibration or personality.",
    alternatives: ["reconsidering", "correcting a mis-click", "reacting to later items"],
    unit: null
  },
  focused_time: {
    computed_as: "seconds spent answering the item with the page visible and focused (system waiting excluded); null when not recorded",
    role: "context",
    may: "Weigh unusually short or long engagement.",
    may_not: "Treat time as a measure of understanding or effort.",
    alternatives: ["careful reading", "reading speed or language", "the difficulty of the item"],
    unit: "seconds"
  },
  focus_loss: {
    computed_as: "seconds the page was hidden or the window lacked focus while the item was being answered; null when not recorded",
    role: "context",
    may: "Weigh it with its alternatives.",
    may_not: CONTEXT_MAY_NOT,
    alternatives: ["looking something up", "using another tool", "an interruption", "switching to another application"],
    unit: "seconds"
  },
  longest_pause: {
    computed_as: "longest pause recorded while the item was open; a pause is recorded once it passes two minutes, so the value is a lower bound; 0 when none was recorded",
    role: "context",
    may: "Weigh it with its alternatives.",
    may_not: CONTEXT_MAY_NOT,
    alternatives: ["thinking", "an interruption", "reading or writing elsewhere"],
    unit: "seconds"
  },
  blocked_paste_attempts: {
    computed_as: "number of paste attempts blocked in the written answer fields of this item",
    role: "context",
    may: "Weigh it with its alternatives.",
    may_not: CONTEXT_MAY_NOT,
    alternatives: ["text the student drafted elsewhere", "text from a source", "an accidental paste"],
    unit: "attempts"
  }
};

export type IndicatorItemResponse = {
  item_public_id: string;
  selected_answer_initial: string | null;
  selected_answer_final: string | null;
  answer_changed: boolean | null;
  correct_option: string;
  reasoning_text_initial: string | null;
  reasoning_text_final: string | null;
  confidence_initial: string | null;
  confidence_final: string | null;
  /** Server-side fallback: item start to first answer selection. */
  response_time_answer_ms: number | null;
};

export type IndicatorEvent = ResponseStageEvent & { pause_duration_ms?: number | null };

const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const seconds = (ms: number | null | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? Math.round(ms / 1000) : null);
const confidenceRank = (value: string | null) => (value === "low" ? 1 : value === "medium" ? 2 : value === "high" ? 3 : null);
const payloadRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function answerChangeValue(response: IndicatorItemResponse) {
  const first = response.selected_answer_initial;
  const final = response.selected_answer_final;
  if (!first || !final) return null;
  const key = response.correct_option.toUpperCase();
  if (first.toUpperCase() === final.toUpperCase()) return response.answer_changed ? "changed_and_returned" : "none";
  const firstCorrect = first.toUpperCase() === key;
  const finalCorrect = final.toUpperCase() === key;
  if (!firstCorrect && finalCorrect) return "incorrect_to_correct";
  if (firstCorrect && !finalCorrect) return "correct_to_incorrect";
  return "incorrect_to_incorrect";
}

export function timeToFirstChoiceMs(response: IndicatorItemResponse, itemEvents: IndicatorEvent[]) {
  const browser = browserItemTiming(itemEvents, true);
  return browser?.time_to_first_option_selection_ms ?? response.response_time_answer_ms ?? null;
}

/** Indicators for one item, from its recorded response and its own events only. */
export function computeProcessIndicators(response: IndicatorItemResponse, itemEvents: IndicatorEvent[]): ProcessIndicator[] {
  const firstChoiceMs = timeToFirstChoiceMs(response, itemEvents);
  const time = summarizeItemStudentTime(deriveResponseSubmissions(itemEvents), deriveResponseStageVisits(itemEvents));
  const pauses = itemEvents
    .filter((event) => event.event_type === "long_pause" || event.event_type === "inactivity_detected")
    .map((event) => event.pause_duration_ms ?? null)
    .filter((value): value is number => typeof value === "number");
  const blockedPastes = itemEvents.filter(
    (event) => event.event_type === "paste_detected" && payloadRecord(event.payload).paste_blocked === true
  ).length;
  const firstConfidence = confidenceRank(response.confidence_initial);
  const finalConfidence = confidenceRank(response.confidence_final);
  const firstExplanation = normalize(response.reasoning_text_initial);
  const finalExplanation = normalize(response.reasoning_text_final);

  const values: Record<IndicatorName, ProcessIndicator["value"]> = {
    rapid_selection: firstChoiceMs === null ? null : firstChoiceMs < RAPID_SELECTION_THRESHOLD_MS,
    answer_change: answerChangeValue(response),
    explanation_revised: firstExplanation && finalExplanation ? firstExplanation !== finalExplanation : null,
    confidence_change:
      firstConfidence === null || finalConfidence === null
        ? null
        : finalConfidence === firstConfidence ? "none" : finalConfidence > firstConfidence ? "higher" : "lower",
    focused_time: seconds(time.student_focused_response_time_ms),
    focus_loss: seconds(time.student_unfocused_time_ms),
    longest_pause: pauses.length ? seconds(Math.max(...pauses)) : 0,
    blocked_paste_attempts: blockedPastes
  };

  return (Object.keys(PROCESS_INDICATOR_DEFINITIONS) as IndicatorName[]).map((name) => {
    const definition = PROCESS_INDICATOR_DEFINITIONS[name];
    return {
      indicator_id: `${response.item_public_id}:${name}`,
      name,
      value: values[name],
      unit: definition.unit,
      computed_as: definition.computed_as,
      role: definition.role,
      may: definition.may,
      may_not: definition.may_not,
      alternatives: definition.alternatives
    };
  });
}

export function indicatorValue(indicators: ProcessIndicator[], name: IndicatorName) {
  return indicators.find((indicator) => indicator.name === name)?.value ?? null;
}
