import { prisma } from "@/lib/db";
import { canFinishConversationAssessment, finishConversationAssessment } from "./finish-assessment";
import { logProcessEvent } from "@/lib/services/process-events";
import { logProductionError } from "@/lib/observability/production-safe-logger";
import { getInitialPreparationStatus } from "@/lib/workflow/initial-preparation-status";
import { studentTurnId } from "../student-turn-id";
import { resolveCanonicalAttemptLifecycle } from "../attempt-lifecycle";
import { attemptAllowsConversation, lockConversationAttempt } from "./attempt-boundary";
import { FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID } from "./opening-contract";
import {
  formativeConversationTurnLimit,
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
    turn_id: studentTurnId(turn.id),
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

/**
 * F-D2a: a tutor reply can be left "pending" or "retrying" when the server process
 * stops mid-generation (deploy, restart, crash). Nothing would ever move it to
 * "failed", so the student never saw Retry. After this window, longer than the
 * longest legitimate generation (several sequential provider calls, each with
 * timeout and retries), the reply is marked failed so the normal Retry claim applies.
 */
export const FORMATIVE_CONVERSATION_STALE_RESPONSE_MS = 15 * 60 * 1000;
export const FORMATIVE_CONVERSATION_INTERRUPTED_FAILURE = "assistant_response_interrupted";

type ReceiptForStaleCheck = {
  id: string;
  client_message_id: string;
  student_turn_db_id: string | null;
  assistant_turn_db_id: string | null;
  assistant_response_status: string;
  updated_at: Date;
};

export function isStaleFormativeConversationResponse(receipt: ReceiptForStaleCheck, now: Date) {
  return receipt.client_message_id !== FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID &&
    Boolean(receipt.student_turn_db_id) &&
    !receipt.assistant_turn_db_id &&
    (receipt.assistant_response_status === "pending" || receipt.assistant_response_status === "retrying") &&
    now.getTime() - receipt.updated_at.getTime() > FORMATIVE_CONVERSATION_STALE_RESPONSE_MS;
}

async function failStaleFormativeConversationResponses<T extends ReceiptForStaleCheck & {
  status: string;
  failure_code: string | null;
  assistant_response_last_failure_category: string | null;
  assistant_response_last_failed_at: Date | null;
}>(receipts: T[], context: { assessment_session_db_id: string; concept_unit_session_db_id: string }) {
  const now = new Date();
  for (const receipt of receipts) {
    if (!isStaleFormativeConversationResponse(receipt, now)) continue;
    const staleSince = receipt.updated_at;
    const priorStatus = receipt.assistant_response_status;
    const priorFailureCategory = receipt.assistant_response_last_failure_category;
    // Keep the original cause (for example a provider timeout); only a receipt
    // with no recorded cause gets the interruption category.
    const failureCategory = receipt.assistant_response_last_failure_category ?? FORMATIVE_CONVERSATION_INTERRUPTED_FAILURE;
    // Guarded update: a reply that completed or was claimed meanwhile is untouched.
    const updated = await prisma.formativeConversationMessageReceipt.updateMany({
      where: {
        id: receipt.id,
        assistant_turn_db_id: null,
        assistant_response_status: { in: ["pending", "retrying"] },
        updated_at: { lt: new Date(now.getTime() - FORMATIVE_CONVERSATION_STALE_RESPONSE_MS) }
      },
      data: {
        status: "failed",
        failure_code: FORMATIVE_CONVERSATION_INTERRUPTED_FAILURE,
        assistant_response_status: "failed",
        assistant_response_last_failure_category: failureCategory,
        assistant_response_last_failed_at: now
      }
    });
    if (updated.count === 1) {
      receipt.status = "failed";
      receipt.failure_code = FORMATIVE_CONVERSATION_INTERRUPTED_FAILURE;
      receipt.assistant_response_status = "failed";
      receipt.assistant_response_last_failure_category = failureCategory;
      receipt.assistant_response_last_failed_at = now;
      receipt.updated_at = now;
      // Research record of the rewrite: when it happened, the prior status and
      // how long the reply had been waiting.
      await logProcessEvent({
        assessment_session_db_id: context.assessment_session_db_id,
        concept_unit_session_db_id: context.concept_unit_session_db_id,
        event_type: "formative_reply_marked_interrupted",
        event_category: "formative_conversation",
        event_source: "backend",
        payload: {
          client_message_id: receipt.client_message_id,
          prior_assistant_response_status: priorStatus,
          stale_since: staleSince.toISOString(),
          prior_failure_category: priorFailureCategory,
          policy: "stale_reply_sweep_v1"
        },
        occurred_at: now
      });
    }
  }
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
    // One topic per mini-test (D1) makes this unique for new attempts; the
    // ordering keeps legacy multi-topic attempts deterministic.
    orderBy: { started_at: "desc" },
    include: {
      assessment_session: true,
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
  const attempt = resolveCanonicalAttemptLifecycle(conversation.assessment_session);
  const attemptActive = attemptAllowsConversation(conversation.assessment_session);
  // Only a live conversation is swept, so reopening a finished or historical attempt
  // never rewrites its receipts. A sweep failure must not block the student's state.
  if (attemptActive && ["active", "paused"].includes(conversation.status)) {
    try {
      await failStaleFormativeConversationResponses(conversation.message_receipts, {
        assessment_session_db_id: conversation.assessment_session_db_id,
        concept_unit_session_db_id: conversation.concept_unit_session_db_id
      });
    } catch (error) {
      logProductionError(error, { safe_error_code: "formative_stale_reply_sweep_failed" });
    }
  }
  const projectedStatus = attempt.terminal && ["active", "paused"].includes(conversation.status)
    ? "ended" as const : conversation.status;
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
  const preparation = await getInitialPreparationStatus(conversation.assessment_session);
  const preparationInProgress = preparation && ["queued", "preparing", "retrying", "paused"].includes(preparation.status);
  const openingStatus: FormativeConversationOpeningStatus = persistedOpening
    ? "ready"
    : preparationInProgress || openingReceipt?.status === "reserved"
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
    !preparationInProgress &&
    attemptActive &&
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
    studentFormativeTurnCount,
    formativeConversationTurnLimit({ ...conversation, status: projectedStatus })
  );
  const anotherStudentTurnAvailable =
    attemptActive &&
    conversation.status === "active" &&
    lifecycle.another_student_turn_available;

  return {
    conversation_public_id: conversation.conversation_public_id,
    status: projectedStatus,
    started_at: conversation.started_at.toISOString(),
    last_activity_at: conversation.last_activity_at.toISOString(),
    paused_at: conversation.paused_at?.toISOString() ?? null,
    completed_at: conversation.completed_at?.toISOString() ?? null,
    opening_status: openingStatus,
    can_retry_opening: canRetryOpening,
    can_send:
      attemptActive &&
      conversation.status === "active" &&
      openingReady &&
      !incompleteResponse &&
      anotherStudentTurnAvailable,
    can_pause: attemptActive && conversation.status === "active",
    can_resume: attemptActive && conversation.status === "paused",
    // D2: the student may end the optional conversation at any point, including
    // while a tutor reply is pending or failed. Unanswered messages stay saved.
    can_end: attemptActive && ["active", "paused"].includes(conversation.status),
    can_finish_assessment: attemptActive && !["active", "paused"].includes(conversation.status) &&
      await canFinishConversationAssessment(conversation.assessment_session_db_id, conversation.assessment_session.assessment_db_id),
    message_max_chars: 5_000,
    student_formative_turn_count: studentFormativeTurnCount,
    current_student_turn_index: studentFormativeTurnCount,
    max_student_turns: lifecycle.max_student_turns,
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
            attemptActive &&
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
  action: "pause" | "resume" | "end" | "finish";
}) {
  if (input.action === "finish") {
    await finishConversationAssessment(input);
    return getStudentFormativeConversationProjection(input);
  }
  const conversation = await prisma.formativeConversationSession.findFirst({
    where: {
      assessment_session: {
        user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      }
    },
    orderBy: { started_at: "desc" },
    select: {
      id: true,
      conversation_public_id: true,
      concept_unit_session_db_id: true,
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
  await prisma.$transaction(async (tx) => {
    await lockConversationAttempt(tx, conversation.conversation_public_id);
    const parent = await tx.assessmentSession.findFirstOrThrow({
      where: { session_public_id: input.session_public_id, user_db_id: input.student_user_db_id }
    });
    if (!attemptAllowsConversation(parent)) return;
    // D2: an explicit stop is always honored. Messages still awaiting a tutor
    // reply are recorded as unanswered rather than blocking the stop.
    const unansweredReceiptCount = input.action === "end"
      ? await tx.formativeConversationMessageReceipt.count({ where: {
          formative_conversation_session_db_id: conversation.id,
          client_message_id: { not: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID },
          OR: [{ assistant_turn_db_id: null }, { assistant_response_status: { not: "completed" } }]
        } })
      : 0;
    const changed = await tx.formativeConversationSession.updateMany({
      where: { id: conversation.id, status: conversation.status },
      data: {
        ...next,
        concurrency_version: { increment: 1 },
        last_activity_at: now
      }
    });
    if (changed.count !== 1) return;
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
    }, tx);
    if (input.action === "end") {
      await logProcessEvent({
        assessment_session_db_id: parent.id,
        concept_unit_session_db_id: conversation.concept_unit_session_db_id,
        event_type: "formative_conversation_ended_by_student",
        event_category: "formative_conversation",
        event_source: "backend",
        payload: {
          conversation_public_id: conversation.conversation_public_id,
          unanswered_message_count: unansweredReceiptCount,
          policy: "student_may_end_at_any_point_v1"
        },
        occurred_at: now
      }, tx);
    }
  });
  return getStudentFormativeConversationProjection(input);
}
