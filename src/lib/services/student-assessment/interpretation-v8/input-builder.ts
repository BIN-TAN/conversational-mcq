import { prisma } from "@/lib/db";
import {
  INTERPRETATION_V8_INPUT_VERSION,
  type InterpretationInputV8,
  type InterpretationItemInputV8,
  type InterpretationReference
} from "./contract";
import { optionIdeaLabels } from "@/lib/services/content/teacher-diagnostic-context";
import { computeProcessIndicators, type IndicatorEvent } from "./indicators";

/**
 * Builds the v8 profiling input from the sealed initial response package (the same
 * evidence the student submitted) and the item's own recorded events. Raw event logs,
 * names and other students' responses are never included.
 */
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const textList = (value: unknown) =>
  Array.isArray(value) ? value.map(text).filter((entry): entry is string => Boolean(entry)) : [];

function options(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({ label: text(record(entry).label), text: text(record(entry).text) }))
    .filter((entry): entry is { label: string; text: string } => Boolean(entry.label && entry.text));
}

function confidence(value: unknown): "low" | "medium" | "high" | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

export function itemReferences(itemId: string, response: Record<string, unknown>, optionLabels: string[], correctOption: string) {
  const providerContext = record(response.teacher_diagnostic_context);
  const teacherContext = record(providerContext.teacher_diagnostic_context);
  const correctNotes = record(teacherContext.correct_option_notes);
  const expectedPatterns = textList(providerContext.expected_reasoning_patterns);
  const rationales = record(providerContext.distractor_rationales);
  const optionNotes = (Array.isArray(teacherContext.option_notes) ? teacherContext.option_notes : []).map(record);

  const target =
    text(correctNotes.target_reasoning_note) ??
    (expectedPatterns.length ? expectedPatterns.slice(0, 2).join(" ") : null) ??
    text(response.student_safe_answer_explanation);
  const essential = text(correctNotes.strong_reasoning_should_mention);
  const references: InterpretationReference[] = [];
  if (target) references.push({ reference_id: `${itemId}:target`, kind: "target_reasoning", option_label: null, text: target });
  if (essential) references.push({ reference_id: `${itemId}:elements`, kind: "essential_elements", option_label: null, text: essential });
  for (const label of optionLabels) {
    if (label.toUpperCase() === correctOption.toUpperCase()) continue;
    const note = optionNotes.find((entry) => text(entry.label)?.toUpperCase() === label.toUpperCase());
    const rationale = text(rationales[label]) ?? text(note?.misconception_reasoning_pattern) ?? text(note?.why_tempting);
    if (rationale) {
      references.push({ reference_id: `${itemId}:option:${label}`, kind: "distractor_rationale", option_label: label, text: rationale });
    }
  }
  return { target, essential, references };
}

export function buildInterpretationInputV8FromPackage(
  packagePayload: unknown,
  eventsByItemPublicId: Map<string, IndicatorEvent[]>
): InterpretationInputV8 {
  const payload = record(packagePayload);
  const assessment = record(payload.assessment);
  const conceptUnit = record(payload.concept_unit);
  const objective = text(conceptUnit.learning_objective) ?? "";
  const description = text(conceptUnit.related_concept_description) ?? "";
  const topicReferences: InterpretationReference[] = [];
  if (objective) topicReferences.push({ reference_id: "topic:objective", kind: "learning_objective", option_label: null, text: objective });
  if (description) topicReferences.push({ reference_id: "topic:description", kind: "topic_description", option_label: null, text: description });

  const responses = (Array.isArray(payload.item_responses) ? payload.item_responses : []).map(record);
  const items: InterpretationItemInputV8[] = responses
    .map((response, index) => {
      const snapshot = record(response.item_snapshot);
      const itemId = text(response.item_public_id) ?? text(snapshot.item_public_id) ?? `item-${index + 1}`;
      const itemOptions = options(snapshot.options);
      const correctOption = text(response.correct_option_snapshot) ?? text(snapshot.correct_option) ?? "";
      const { target, essential, references } = itemReferences(itemId, response, itemOptions.map((option) => option.label), correctOption);
      const correctness = response.correctness;
      const skipped = response.skipped_item === true;
      const explanationFinal = text(response.reasoning_text_final) ?? text(response.reasoning_text);
      const explanationFirst = text(response.reasoning_text_initial);
      const position = typeof response.initial_item_position === "number" ? response.initial_item_position
        : typeof response.item_order === "number" ? response.item_order : index + 1;
      return {
        item_id: itemId,
        position,
        stem: text(snapshot.item_stem) ?? "",
        options: itemOptions,
        correct_option: correctOption,
        target_reasoning: target,
        essential_elements: essential,
        references,
        response: {
          skipped,
          selected_option: text(response.selected_answer_final) ?? text(response.selected_option),
          answer_correct: correctness === "correct" ? true : correctness === "incorrect" ? false : null,
          reported_confidence: confidence(response.confidence_final ?? response.confidence_rating),
          explanation: explanationFinal,
          explanation_first_version: explanationFirst && explanationFirst !== explanationFinal ? explanationFirst : null,
          tempting_option: text(response.tempting_option),
          tempting_option_reason: text(response.tempting_option_reason),
          no_tempting_option: typeof response.no_tempting_option === "boolean" ? response.no_tempting_option : null
        },
        process_indicators: computeProcessIndicators({
          item_public_id: itemId,
          selected_answer_initial: text(response.selected_answer_initial),
          selected_answer_final: text(response.selected_answer_final) ?? text(response.selected_option),
          answer_changed: typeof response.answer_changed === "boolean" ? response.answer_changed : null,
          correct_option: correctOption,
          reasoning_text_initial: explanationFirst,
          reasoning_text_final: explanationFinal,
          confidence_initial: text(response.confidence_initial),
          confidence_final: text(response.confidence_final) ?? text(response.confidence_rating),
          response_time_answer_ms: typeof response.response_time_answer_ms === "number" ? response.response_time_answer_ms : null
        }, eventsByItemPublicId.get(itemId) ?? [])
      };
    })
    .sort((a, b) => a.position - b.position);

  return {
    input_version: INTERPRETATION_V8_INPUT_VERSION,
    topic: {
      title: text(conceptUnit.title) ?? text(assessment.title) ?? "",
      learning_objective: objective,
      description,
      diagnostic_focus: text(assessment.diagnostic_focus),
      references: topicReferences
    },
    items
  };
}

/**
 * The instructor's idea label for each chosen option (section 4.2, answer patterns), read
 * from the item context sealed in the response package. Null when the chosen option has no
 * label or no option was chosen. Labels are used only to spot two or more incorrect choices
 * that share an idea; they never become claims about the student.
 */
export function chosenOptionTagsFromPackage(packagePayload: unknown): Map<string, string | null> {
  const payload = record(packagePayload);
  const responses = (Array.isArray(payload.item_responses) ? payload.item_responses : []).map(record);
  return new Map(responses.map((response, index) => {
    const snapshot = record(response.item_snapshot);
    const itemId = text(response.item_public_id) ?? text(snapshot.item_public_id) ?? `item-${index + 1}`;
    const chosen = text(response.selected_answer_final) ?? text(response.selected_option);
    const labels = optionIdeaLabels(response.teacher_diagnostic_context);
    return [itemId, chosen ? labels.get(chosen.toUpperCase()) ?? null : null] as const;
  }));
}

/** Loads the sealed package and each item's own events (initial administration only). */
export async function loadInterpretationInputV8(input: { concept_unit_session_db_id: string; response_package_id: string }) {
  const responsePackage = await prisma.responsePackage.findFirstOrThrow({
    where: {
      id: input.response_package_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      package_type: "initial_concept_unit_response_package"
    },
    select: { id: true, payload: true, created_at: true }
  });
  const events = await prisma.processEvent.findMany({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      item_db_id: { not: null },
      occurred_at: { lte: responsePackage.created_at }
    },
    orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }],
    select: {
      event_type: true,
      event_source: true,
      occurred_at: true,
      created_at: true,
      payload: true,
      pause_duration_ms: true,
      item: { select: { item_public_id: true } }
    }
  });
  const eventsByItem = new Map<string, IndicatorEvent[]>();
  for (const event of events) {
    const itemPublicId = event.item?.item_public_id;
    if (!itemPublicId) continue;
    const list = eventsByItem.get(itemPublicId) ?? [];
    list.push({
      event_type: event.event_type,
      event_source: event.event_source,
      item_public_id: itemPublicId,
      occurred_at: event.occurred_at,
      created_at: event.created_at,
      payload: event.payload,
      pause_duration_ms: event.pause_duration_ms
    });
    eventsByItem.set(itemPublicId, list);
  }
  return {
    response_package_id: responsePackage.id,
    input: buildInterpretationInputV8FromPackage(responsePackage.payload, eventsByItem)
  };
}
