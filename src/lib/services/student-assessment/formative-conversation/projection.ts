import { prisma } from "@/lib/db";
import { FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID } from "./opening-contract";
import {
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
  projectFormativeConversationV18R2LifecycleForTurnCount
} from "./lifecycle-contract-v18r2";
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
}, response?: {
  receipt_public_id: string;
  assistant_response_status: "pending" | "completed" | "failed" | "retrying";
  assistant_response_retry_count: number;
} | null) {
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
        : false,
    response_receipt_public_id:
      turn.actor_type === "student"
        ? response?.receipt_public_id ?? null
        : null,
    assistant_response_status:
      turn.actor_type === "student"
        ? response?.assistant_response_status ?? null
        : null,
    assistant_response_retry_count:
      turn.actor_type === "student"
        ? response?.assistant_response_retry_count ?? 0
        : 0
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
        orderBy: { created_at: "asc" },
        include: {
          student_turn: true,
          assistant_turn: true
        }
      }
    }
  });
  if (!conversation) {
    return null;
  }
  const openingReceipt =
    conversation.message_receipts.find(
      (receipt) =>
        receipt.client_message_id ===
        FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID
    ) ?? null;
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
  const responseReceipts =
    conversation.message_receipts.filter(
      (receipt) =>
        receipt.client_message_id !==
          FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID &&
        Boolean(receipt.student_turn)
    );
  const responseByStudentTurnId = new Map(
    responseReceipts.flatMap((receipt) =>
      receipt.student_turn_db_id
        ? [[receipt.student_turn_db_id, receipt] as const]
        : []
    )
  );
  const incompleteResponse =
    [...responseReceipts]
      .reverse()
      .find(
        (receipt) =>
          !receipt.assistant_turn &&
          receipt.assistant_response_status !== "completed"
      ) ?? null;
  const studentFormativeTurnCount = conversation.conversation_turns.filter(
    (turn) => turn.actor_type === "student"
  ).length;
  const lifecycle = projectFormativeConversationV18R2LifecycleForTurnCount(
    studentFormativeTurnCount
  );
  const anotherStudentTurnAvailable =
    conversation.status === "active" &&
    lifecycle.another_student_turn_available;

  return {
    conversation_public_id: conversation.conversation_public_id,
    status: conversation.status,
    started_at: conversation.started_at.toISOString(),
    last_activity_at: conversation.last_activity_at.toISOString(),
    paused_at: conversation.paused_at?.toISOString() ?? null,
    completed_at: conversation.completed_at?.toISOString() ?? null,
    opening_status: openingStatus,
    can_retry_opening: canRetryOpening,
    can_send:
      conversation.status === "active" &&
      openingReady &&
      !incompleteResponse &&
      anotherStudentTurnAvailable,
    can_pause: conversation.status === "active",
    can_resume: conversation.status === "paused",
    can_end: ["active", "paused"].includes(conversation.status),
    message_max_chars: 5_000,
    student_formative_turn_count: studentFormativeTurnCount,
    current_student_turn_index: studentFormativeTurnCount,
    max_student_turns: FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
    final_allowed_turn: lifecycle.final_allowed_turn,
    another_student_turn_available: anotherStudentTurnAvailable,
    lifecycle_termination_source:
      conversation.lifecycle_reason?.startsWith("platform_")
        ? "platform_lifecycle"
        : conversation.lifecycle_reason?.startsWith(
              "llm_terminal_recommendation:"
            )
          ? "llm_terminal_recommendation"
        : conversation.lifecycle_reason
          ? "student_or_session_lifecycle"
          : null,
    lifecycle_termination_reason: conversation.lifecycle_reason,
    assistant_response: incompleteResponse
      ? {
          receipt_public_id: incompleteResponse.receipt_public_id,
          status: incompleteResponse.assistant_response_status,
          retry_count:
            incompleteResponse.assistant_response_retry_count,
          can_retry:
            conversation.status === "active" &&
            incompleteResponse.assistant_response_status === "failed"
        }
      : null,
    transcript: conversation.conversation_turns.map((turn) =>
      turnProjection(
        turn,
        responseByStudentTurnId.get(turn.id) ?? null
      )
    )
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
