import { prisma } from "@/lib/db";
import { FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID } from "./opening-contract";
import { recordFormativeConversationLifecycleEvent } from "./telemetry";

export type FormativeConversationOpeningStatus =
  | "ready"
  | "preparing"
  | "retry_available"
  | "unavailable";

function jsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function turnProjection(turn: {
  id: string;
  sequence_index: number;
  actor_type: string;
  agent_name: string | null;
  message_text: string | null;
  structured_payload: unknown;
  created_at: Date;
}) {
  const payload =
    turn.structured_payload &&
    typeof turn.structured_payload === "object" &&
    !Array.isArray(turn.structured_payload)
      ? (turn.structured_payload as Record<string, unknown>)
      : {};
  return {
    turn_id: turn.id,
    sequence_index: turn.sequence_index,
    actor: turn.actor_type === "student" ? ("student" as const) : ("tutor" as const),
    message_text: turn.message_text ?? "",
    created_at: turn.created_at.toISOString(),
    agent_name: turn.agent_name,
    generation_source:
      typeof payload.generation_source === "string"
        ? payload.generation_source
        : null,
    validator_status:
      typeof payload.validator_status === "string"
        ? payload.validator_status
        : null,
    fallback_used:
      typeof payload.fallback_used === "boolean"
        ? payload.fallback_used
        : false
  };
}

export async function getStudentFormativeConversationProjection(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const conversation = await prisma.formativeConversationSession.findFirst({
    where: {
      assessment_session: {
        user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      }
    },
    include: {
      conversation_turns: {
        where: {
          actor_type: { in: ["student", "agent"] },
          message_text: { not: null }
        },
        orderBy: { sequence_index: "asc" }
      },
      message_receipts: {
        where: {
          client_message_id:
            FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID
        },
        take: 1,
        include: {
          assistant_turn: true
        }
      }
    }
  });
  if (!conversation) {
    return null;
  }
  const openingReceipt = conversation.message_receipts[0] ?? null;
  const persistedOpening =
    openingReceipt?.assistant_turn ??
    conversation.conversation_turns.find(
      (turn) =>
        jsonRecord(turn.structured_payload).message_type ===
        "formative_conversation_opening"
    ) ??
    null;
  const failurePayload = jsonRecord(openingReceipt?.response_payload);
  const failureRetryable = failurePayload.retryable !== false;
  const openingStatus: FormativeConversationOpeningStatus = persistedOpening
    ? "ready"
    : openingReceipt?.status === "reserved"
      ? "preparing"
      : openingReceipt?.status === "failed"
        ? failureRetryable
          ? "retry_available"
          : "unavailable"
        : conversation.conversation_turns.length === 0
          ? "retry_available"
          : "unavailable";
  const openingReady = openingStatus === "ready";
  const canRetryOpening =
    conversation.status === "active" &&
    openingStatus === "retry_available";

  return {
    conversation_public_id: conversation.conversation_public_id,
    status: conversation.status,
    started_at: conversation.started_at.toISOString(),
    last_activity_at: conversation.last_activity_at.toISOString(),
    paused_at: conversation.paused_at?.toISOString() ?? null,
    completed_at: conversation.completed_at?.toISOString() ?? null,
    opening_status: openingStatus,
    can_retry_opening: canRetryOpening,
    can_send: conversation.status === "active" && openingReady,
    can_pause: conversation.status === "active",
    can_resume: conversation.status === "paused",
    can_end: ["active", "paused"].includes(conversation.status),
    message_max_chars: 5_000,
    transcript: conversation.conversation_turns.map(turnProjection)
  };
}

export async function updateStudentFormativeConversationLifecycle(input: {
  student_user_db_id: string;
  session_public_id: string;
  action: "pause" | "resume" | "end";
}) {
  const conversation = await prisma.formativeConversationSession.findFirst({
    where: {
      assessment_session: {
        user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      }
    },
    select: {
      id: true,
      conversation_public_id: true,
      status: true
    }
  });
  if (!conversation) {
    throw new Error("formative_conversation_not_found");
  }
  const now = new Date();
  const next =
    input.action === "pause"
      ? {
          status: "paused" as const,
          paused_at: now,
          lifecycle_reason: "student_paused"
        }
      : input.action === "resume"
        ? {
            status: "active" as const,
            paused_at: null,
            lifecycle_reason: "student_resumed"
          }
        : {
            status: "ended" as const,
            ended_at: now,
            lifecycle_reason: "student_ended_conversation"
          };
  if (
    (input.action === "pause" && conversation.status !== "active") ||
    (input.action === "resume" && conversation.status !== "paused") ||
    (input.action === "end" &&
      !["active", "paused"].includes(conversation.status))
  ) {
    return getStudentFormativeConversationProjection(input);
  }
  await prisma.formativeConversationSession.update({
    where: { id: conversation.id },
    data: {
      ...next,
      last_activity_at: now
    }
  });
  await recordFormativeConversationLifecycleEvent({
    conversation_public_id: conversation.conversation_public_id,
    client_event_id: `conversation-lifecycle:${input.action}:${now.toISOString()}`,
    event_type:
      input.action === "pause"
        ? "paused"
        : input.action === "resume"
          ? "resumed"
          : "conversation_ended",
    event_source: "backend",
    observed_interval_duration_ms: null,
    client_instance_id: null,
    occurred_at: now
  });
  return getStudentFormativeConversationProjection(input);
}
