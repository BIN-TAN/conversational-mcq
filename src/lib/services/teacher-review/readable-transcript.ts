import { prisma } from "@/lib/db";
import { TeacherReviewServiceError } from "./errors";
import { asRecord, serializeDate } from "./serializers";
import { buildTurnResponseLatencyRows } from "./turn-response-latencies";

export type TeacherReadableTranscriptTurn = {
  turn_index: number;
  speaker: "agent" | "student" | "system";
  timestamp: string | null;
  phase_label: string;
  safe_context_label: string | null;
  message_text: string;
  has_structured_payload_available_elsewhere: boolean;
  next_student_response_latency_ms: number | null;
  next_student_response_latency_seconds: number | null;
  next_student_response_latency_source: string | null;
};

export type TeacherReadableTranscriptProjection = {
  session_public_id: string;
  student_display_label: string;
  assessment_label: string;
  turns: TeacherReadableTranscriptTurn[];
  limitations: string[];
};

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function phaseLabel(phase: string) {
  if (phase === "initial_item_administration" || phase === "missing_evidence_repair") {
    return "Initial item administration";
  }

  if (
    phase === "followup_active" ||
    phase === "followup_profile_update_pending" ||
    phase === "followup_planning_update_pending"
  ) {
    return "Activity dialogue";
  }

  if (phase === "profiling_pending" || phase === "profiling_completed" || phase === "planning_completed") {
    return "Feedback";
  }

  if (phase === "completed") {
    return "Session completion";
  }

  return "Other";
}

function speakerLabel(actorType: string): TeacherReadableTranscriptTurn["speaker"] {
  if (actorType === "student") {
    return "student";
  }

  if (actorType === "agent" || actorType === "orchestrator") {
    return "agent";
  }

  return "system";
}

function contextLabel(input: {
  concept_unit_title: string | null;
  concept_unit_public_id: string | null;
  item_order: number | null;
  item_public_id: string | null;
  followup_round_index: number | null;
}) {
  const parts: string[] = [];

  if (input.concept_unit_title) {
    parts.push(input.concept_unit_title);
  } else if (input.concept_unit_public_id) {
    parts.push(input.concept_unit_public_id);
  }

  if (input.item_order !== null) {
    parts.push(`Item ${input.item_order}`);
  } else if (input.item_public_id) {
    parts.push(input.item_public_id);
  }

  if (input.followup_round_index !== null) {
    parts.push(`Activity round ${input.followup_round_index}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function isLegacyEditedResponsePlaceholder(value: string | null | undefined) {
  const text = value?.trim();
  return Boolean(text && (text === "Edited my response." || /^Edited Question \d+ response\.$/.test(text)));
}

function stringPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "boolean" ? value : null;
}

function changedFieldsFromPayload(payload: Record<string, unknown>) {
  return Array.isArray(payload.changed_fields)
    ? payload.changed_fields.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function confidenceLabel(value: string | null | undefined) {
  if (value === "low") return "Low";
  if (value === "medium") return "Medium";
  if (value === "high") return "High";
  return "Not selected";
}

function reconstructEditedResponseText(input: {
  message_text: string | null;
  structured_payload: unknown;
  current_response?: {
    selected_option: string | null;
    reasoning_text: string | null;
    confidence_rating: string | null;
  } | null;
}) {
  if (!isLegacyEditedResponsePlaceholder(input.message_text)) {
    return input.message_text;
  }

  const payload = asRecord(input.structured_payload);
  const source = stringPayloadValue(payload, "source");

  if (source !== "student_response_in_flow_edit" && source !== "package_review_tempting_option") {
    return "I updated my response.";
  }

  const parts: string[] = [];
  const changedFields = changedFieldsFromPayload(payload);
  const selectedOption = stringPayloadValue(payload, "selected_option") ?? input.current_response?.selected_option ?? null;
  const reasoningText = input.current_response?.reasoning_text?.trim() ?? null;
  const confidenceRating =
    stringPayloadValue(payload, "confidence_rating") ?? input.current_response?.confidence_rating ?? null;
  const noTemptingOption = booleanPayloadValue(payload, "no_tempting_option") ?? false;
  const temptingOption = stringPayloadValue(payload, "tempting_option");
  const temptingOptionReason = stringPayloadValue(payload, "tempting_option_reason");

  if (changedFields.includes("answer")) {
    parts.push(`I changed my answer to ${selectedOption ?? "the selected option"}.`);
  }

  if (changedFields.includes("reasoning")) {
    parts.push(reasoningText || "I updated my reason.");
  }

  if (changedFields.includes("confidence")) {
    parts.push(`I changed my confidence to ${confidenceLabel(confidenceRating)}.`);
  }

  if (changedFields.includes("tempting_option")) {
    if (noTemptingOption) {
      parts.push("No other option was tempting.");
    } else if (temptingOption && temptingOptionReason) {
      parts.push(`I was tempted by ${temptingOption} because ${temptingOptionReason}`);
    } else if (temptingOption) {
      parts.push(`I was tempted by ${temptingOption}.`);
    } else {
      parts.push("I updated my tempting-option response.");
    }
  }

  return parts.length > 0 ? parts.join("\n") : "I updated my response.";
}

function hasStructuredPayload(value: unknown) {
  return Object.keys(asRecord(value)).length > 0 || Array.isArray(value);
}

function sanitizeReadableMessageText(value: string) {
  return value
    .replace(/\b(correct option|answer key)\b/gi, "[restricted item key]")
    .replace(/\bcorrectness\s*:/gi, "[restricted correctness]:")
    .replace(/\bdistractor rationales?\b/gi, "[restricted item metadata]");
}

export async function getTeacherReadableTranscript(
  sessionPublicId: string
): Promise<TeacherReadableTranscriptProjection> {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: {
      id: true,
      session_public_id: true,
      user: { select: { user_id: true, display_name: true } },
      assessment: { select: { assessment_public_id: true, title: true } }
    }
  });

  if (!session) {
    throw new TeacherReviewServiceError(
      "not_found",
      "Assessment session was not found.",
      404,
      { session_public_id: sessionPublicId }
    );
  }

  const [turns, processEvents, responses] = await Promise.all([
    prisma.conversationTurn.findMany({
      where: { assessment_session_db_id: session.id },
      orderBy: [{ created_at: "asc" }],
      select: {
        phase: true,
        actor_type: true,
        agent_name: true,
        message_text: true,
        structured_payload: true,
        created_at: true,
        item_db_id: true,
        concept_unit_session: {
          select: {
            concept_unit: {
              select: {
                concept_unit_public_id: true,
                title: true
              }
            }
          }
        },
        item: {
          select: {
            item_public_id: true,
            item_order: true,
            concept_unit: {
              select: {
                concept_unit_public_id: true
              }
            }
          }
        },
        followup_round: {
          select: { round_index: true }
        }
      }
    }),
    prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      orderBy: [{ occurred_at: "asc" }],
      select: {
        event_type: true,
        event_category: true,
        event_source: true,
        occurred_at: true,
        created_at: true,
        item: {
          select: {
            item_public_id: true,
            item_order: true,
            concept_unit: {
              select: { concept_unit_public_id: true }
            }
          }
        },
        concept_unit_session: {
          select: {
            concept_unit: {
              select: { concept_unit_public_id: true }
            }
          }
        }
      }
    }),
    prisma.itemResponse.findMany({
      where: {
        concept_unit_session: {
          assessment_session_db_id: session.id
        }
      },
      select: {
        item_db_id: true,
        selected_option: true,
        reasoning_text: true,
        confidence_rating: true
      }
    })
  ]);

  const responseByItemDbId = new Map(
    responses.map((response) => [
      response.item_db_id,
      {
        selected_option: response.selected_option,
        reasoning_text: response.reasoning_text,
        confidence_rating: response.confidence_rating
      }
    ])
  );
  const limitations = new Set<string>();
  const latencyRows = buildTurnResponseLatencyRows({
    turns: turns.map((turn, index) => ({
      session_public_id: session.session_public_id,
      student_user_id: session.user.user_id,
      assessment_public_id: session.assessment.assessment_public_id,
      turn_index: index + 1,
      actor_type: turn.actor_type,
      phase: turn.phase,
      agent_name: turn.agent_name,
      message_text: turn.message_text,
      structured_payload: turn.structured_payload,
      created_at: turn.created_at,
      concept_unit_public_id:
        turn.concept_unit_session?.concept_unit.concept_unit_public_id ??
        turn.item?.concept_unit.concept_unit_public_id ??
        null,
      item_public_id: turn.item?.item_public_id ?? null,
      item_order: turn.item?.item_order ?? null
    })),
    processEvents: processEvents.map((event) => ({
      session_public_id: session.session_public_id,
      concept_unit_public_id:
        event.concept_unit_session?.concept_unit.concept_unit_public_id ??
        event.item?.concept_unit.concept_unit_public_id ??
        null,
      item_public_id: event.item?.item_public_id ?? null,
      item_order: event.item?.item_order ?? null,
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      occurred_at: event.occurred_at,
      created_at: event.created_at
    }))
  });
  const latencyByPromptTurnIndex = new Map(latencyRows.map((row) => [row.prompt_turn_index, row]));

  const projectedTurns = turns.flatMap((turn, index) => {
    const turnIndex = index + 1;
    const reconstructedText = reconstructEditedResponseText({
      message_text: turn.message_text,
      structured_payload: turn.structured_payload,
      current_response: turn.item_db_id ? responseByItemDbId.get(turn.item_db_id) ?? null : null
    });

    if (!isNonEmptyText(reconstructedText)) {
      limitations.add("empty_text_turns_hidden");
      return [];
    }

    return [{
      turn_index: turnIndex,
      speaker: speakerLabel(turn.actor_type),
      timestamp: serializeDate(turn.created_at),
      phase_label: phaseLabel(turn.phase),
      safe_context_label: contextLabel({
        concept_unit_title: turn.concept_unit_session?.concept_unit.title ?? null,
        concept_unit_public_id:
          turn.concept_unit_session?.concept_unit.concept_unit_public_id ??
          turn.item?.concept_unit.concept_unit_public_id ??
          null,
        item_order: turn.item?.item_order ?? null,
        item_public_id: turn.item?.item_public_id ?? null,
        followup_round_index: turn.followup_round?.round_index ?? null
      }),
      message_text: sanitizeReadableMessageText(reconstructedText.trim()),
      has_structured_payload_available_elsewhere: hasStructuredPayload(turn.structured_payload),
      next_student_response_latency_ms:
        latencyByPromptTurnIndex.get(turnIndex)?.response_latency_ms ?? null,
      next_student_response_latency_seconds:
        latencyByPromptTurnIndex.get(turnIndex)?.response_latency_seconds ?? null,
      next_student_response_latency_source:
        latencyByPromptTurnIndex.get(turnIndex)?.latency_source ?? null
    }];
  });

  return {
    session_public_id: session.session_public_id,
    student_display_label: session.user.display_name ?? session.user.user_id,
    assessment_label: session.assessment.title,
    turns: projectedTurns,
    limitations: [...limitations]
  };
}

export function renderTeacherReadableTranscriptMarkdown(
  transcript: TeacherReadableTranscriptProjection
) {
  const lines = [
    `# Readable transcript`,
    "",
    `Session: ${transcript.session_public_id}`,
    `Student: ${transcript.student_display_label}`,
    `Assessment: ${transcript.assessment_label}`,
    "",
    "This teacher/research transcript omits structured payloads, answer keys, correctness labels, raw provider data, and process-event payloads.",
    ""
  ];

  for (const turn of transcript.turns) {
    const context = turn.safe_context_label ? ` · ${turn.safe_context_label}` : "";
    lines.push(
      `## ${turn.turn_index}. ${turn.speaker} · ${turn.phase_label}${context}`,
      "",
      `Timestamp: ${turn.timestamp ?? "Not recorded"}`,
      turn.next_student_response_latency_seconds !== null
        ? `Next student response/action after: ${turn.next_student_response_latency_seconds}s`
        : "",
      "",
      turn.message_text,
      ""
    );
  }

  if (transcript.limitations.length > 0) {
    lines.push("## Limitations", "", ...transcript.limitations.map((entry) => `- ${entry}`), "");
  }

  return `${lines.join("\n").trim()}\n`;
}
