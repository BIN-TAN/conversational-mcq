import { asRecord } from "./serializers";

export type LatencyConversationTurn = {
  session_public_id: string;
  student_user_id: string;
  assessment_public_id: string;
  turn_index: number;
  actor_type: string;
  phase: string;
  agent_name: string | null;
  message_text: string | null;
  structured_payload: unknown;
  created_at: Date | string | null;
  concept_unit_public_id: string | null;
  item_public_id: string | null;
  item_order: number | null;
};

export type LatencyProcessEvent = {
  session_public_id: string;
  concept_unit_public_id: string | null;
  item_public_id: string | null;
  item_order: number | null;
  event_type: string;
  event_category: string;
  event_source: string;
  occurred_at: Date | string | null;
  created_at: Date | string | null;
};

export type TurnResponseLatencyRow = {
  session_public_id: string;
  student_user_id: string;
  assessment_public_id: string;
  concept_unit_public_id: string | null;
  item_public_id: string | null;
  item_order: number | null;
  prompt_turn_index: number;
  prompt_actor: string;
  prompt_phase: string;
  prompt_type: string | null;
  prompt_shown_at: string | null;
  next_student_turn_index: number | null;
  next_student_event_type: string | null;
  next_student_response_at: string | null;
  response_latency_ms: number | null;
  response_latency_seconds: number | null;
  latency_source: "conversation_turns" | "process_events" | "mixed" | "unavailable";
  latency_scope:
    | "item"
    | "confidence"
    | "reasoning"
    | "tempting_option"
    | "activity"
    | "general_dialogue";
  student_response_text_present: boolean;
  structured_payload_available_elsewhere: boolean;
  limitations: string[];
};

const STUDENT_ACTION_EVENT_TYPES = new Set([
  "option_selected",
  "answer_changed",
  "reasoning_started",
  "reasoning_entered",
  "reasoning_revised",
  "reasoning_submitted",
  "confidence_selected",
  "tempting_option_submitted",
  "tempting_option_reason_submitted",
  "student_response_edit_started",
  "student_response_edit_submitted",
  "reasoning_edited",
  "confidence_changed",
  "tempting_option_changed",
  "item_submitted",
  "package_review_opened",
  "package_submitted",
  "idk_selected",
  "invalid_help_request",
  "procedural_clarification_request",
  "content_question_deferred",
  "clarification_answered",
  "formative_activity_response_submitted",
  "activity_response_submitted",
  "activity_choice_submitted",
  "activity_turn_submitted",
  "next_choice_submitted",
  "move_next_requested",
  "transfer_item_submitted",
  "revision_submitted",
  "followup_turn_completed"
]);

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestamp(value: Date | string | null | undefined) {
  const serialized = iso(value);
  return serialized ? new Date(serialized).getTime() : null;
}

function hasStructuredPayload(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(asRecord(value)).length > 0;
}

function safePayloadString(payload: unknown, keys: string[]) {
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(value)) {
      return value;
    }
  }
  return null;
}

function isPromptTurn(turn: LatencyConversationTurn) {
  return (
    (turn.actor_type === "agent" || turn.actor_type === "orchestrator" || turn.actor_type === "system") &&
    typeof turn.message_text === "string" &&
    turn.message_text.trim().length > 0 &&
    timestamp(turn.created_at) !== null
  );
}

function contextMatches(
  prompt: Pick<LatencyConversationTurn, "item_public_id" | "concept_unit_public_id">,
  candidate: Pick<LatencyConversationTurn | LatencyProcessEvent, "item_public_id" | "concept_unit_public_id">
) {
  if (prompt.item_public_id) {
    return candidate.item_public_id === prompt.item_public_id;
  }

  if (prompt.concept_unit_public_id) {
    return candidate.concept_unit_public_id === prompt.concept_unit_public_id;
  }

  return true;
}

function isSafeStudentActionEvent(event: LatencyProcessEvent) {
  if (STUDENT_ACTION_EVENT_TYPES.has(event.event_type)) return true;
  return (
    event.event_category === "student_response" &&
    !event.event_type.includes("presented") &&
    !event.event_type.includes("shown")
  );
}

function inferLatencyScope(turn: LatencyConversationTurn, promptType: string | null): TurnResponseLatencyRow["latency_scope"] {
  const normalizedPromptType = promptType?.toLowerCase() ?? "";
  if (normalizedPromptType.includes("activity") || normalizedPromptType.includes("followup")) return "activity";
  if (normalizedPromptType.includes("tempting")) return "tempting_option";
  if (normalizedPromptType.includes("confidence")) return "confidence";
  if (normalizedPromptType.includes("reason")) return "reasoning";
  if (
    normalizedPromptType.includes("item_presented") ||
    normalizedPromptType.includes("request_answer") ||
    normalizedPromptType.includes("answer")
  ) {
    return "item";
  }

  const haystack = [
    turn.agent_name,
    turn.message_text
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" ")
    .toLowerCase();

  if (haystack.includes("activity") || haystack.includes("followup")) return "activity";
  if (haystack.includes("tempting")) return "tempting_option";
  if (haystack.includes("confidence")) return "confidence";
  if (haystack.includes("reason")) return "reasoning";
  if (turn.item_public_id) return "item";
  return "general_dialogue";
}

function promptType(turn: LatencyConversationTurn) {
  return (
    safePayloadString(turn.structured_payload, [
      "prompt_type",
      "message_type",
      "prompt_kind",
      "kind",
      "source",
      "action_type"
    ]) ?? inferLatencyScope(turn, null)
  );
}

function findNextStudentTurn(prompt: LatencyConversationTurn, turns: LatencyConversationTurn[]) {
  const promptTime = timestamp(prompt.created_at);
  if (promptTime === null) return null;

  return turns.find((turn) => {
    const turnTime = timestamp(turn.created_at);
    return (
      turn.actor_type === "student" &&
      turnTime !== null &&
      turnTime >= promptTime &&
      turn.turn_index > prompt.turn_index &&
      contextMatches(prompt, turn)
    );
  }) ?? null;
}

function findNextStudentAction(prompt: LatencyConversationTurn, events: LatencyProcessEvent[]) {
  const promptTime = timestamp(prompt.created_at);
  if (promptTime === null) return null;

  return events.find((event) => {
    const eventTime = timestamp(event.occurred_at) ?? timestamp(event.created_at);
    return (
      eventTime !== null &&
      eventTime >= promptTime &&
      contextMatches(prompt, event) &&
      isSafeStudentActionEvent(event)
    );
  }) ?? null;
}

export function buildTurnResponseLatencyRows(input: {
  turns: LatencyConversationTurn[];
  processEvents: LatencyProcessEvent[];
}): TurnResponseLatencyRow[] {
  const turns = [...input.turns].sort((left, right) => (timestamp(left.created_at) ?? 0) - (timestamp(right.created_at) ?? 0));
  const processEvents = [...input.processEvents].sort(
    (left, right) =>
      (timestamp(left.occurred_at) ?? timestamp(left.created_at) ?? 0) -
      (timestamp(right.occurred_at) ?? timestamp(right.created_at) ?? 0)
  );

  return turns.filter(isPromptTurn).map((prompt) => {
    const nextTurn = findNextStudentTurn(prompt, turns);
    const nextEvent = findNextStudentAction(prompt, processEvents);
    const promptTime = timestamp(prompt.created_at);
    const nextEventTime = timestamp(nextEvent?.occurred_at) ?? timestamp(nextEvent?.created_at);
    const nextTurnTime = timestamp(nextTurn?.created_at);
    const preferredTime = nextEventTime ?? nextTurnTime ?? null;
    const responseLatencyMs =
      promptTime !== null && preferredTime !== null ? Math.max(0, preferredTime - promptTime) : null;
    const source: TurnResponseLatencyRow["latency_source"] =
      nextEvent && nextTurn ? "mixed" : nextEvent ? "process_events" : nextTurn ? "conversation_turns" : "unavailable";
    const limitations: string[] = [];

    if (!nextEvent && nextTurn) {
      limitations.push("process_event_action_not_found_for_prompt");
    }

    if (!nextEvent && !nextTurn) {
      limitations.push("next_student_response_or_action_missing");
    }

    if (source === "process_events" || source === "mixed") {
      limitations.push("latency_may_include_reading_thinking_or_idle_time");
    }

    const safePromptType = promptType(prompt);

    return {
      session_public_id: prompt.session_public_id,
      student_user_id: prompt.student_user_id,
      assessment_public_id: prompt.assessment_public_id,
      concept_unit_public_id: prompt.concept_unit_public_id,
      item_public_id: prompt.item_public_id,
      item_order: prompt.item_order,
      prompt_turn_index: prompt.turn_index,
      prompt_actor: prompt.actor_type,
      prompt_phase: prompt.phase,
      prompt_type: safePromptType,
      prompt_shown_at: iso(prompt.created_at),
      next_student_turn_index: nextTurn?.turn_index ?? null,
      next_student_event_type: nextEvent?.event_type ?? (nextTurn ? "student_conversation_turn" : null),
      next_student_response_at: preferredTime !== null ? new Date(preferredTime).toISOString() : null,
      response_latency_ms: responseLatencyMs,
      response_latency_seconds: responseLatencyMs === null ? null : Number((responseLatencyMs / 1000).toFixed(3)),
      latency_source: source,
      latency_scope: inferLatencyScope(prompt, safePromptType),
      student_response_text_present: Boolean(nextTurn?.message_text?.trim()),
      structured_payload_available_elsewhere: hasStructuredPayload(prompt.structured_payload),
      limitations
    };
  });
}
