import { FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID } from "@/lib/services/student-assessment/formative-conversation/opening-contract";
import { isStaleOpeningReservation } from "@/lib/services/student-assessment/formative-conversation/opening-stale";

/**
 * Research-export projections of how a formative conversation opened and ended, and how long
 * the student engaged (RQ3). Derived from stored fields at export time; nothing is written back.
 * A conversation the system could not open, or closed itself, stays distinguishable from a
 * student who read the feedback and stopped.
 */
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const CONVERSATION_END_REASONS = [
  "student_ended", "student_ended_attempt", "turn_limit_reached", "closed_by_system",
  "attempt_finished_while_active", "attempt_ended_while_active", "still_active", "other"
] as const;
export type ConversationEndReason = typeof CONVERSATION_END_REASONS[number];

export function conversationEndReason(
  conversation: { status: string; lifecycle_reason: string | null },
  attempt: { completed: boolean; terminal: boolean }
): ConversationEndReason {
  // Finishing or ending the attempt by other paths does not close an open conversation record.
  if (conversation.status === "active" || conversation.status === "paused") {
    return attempt.completed ? "attempt_finished_while_active" : attempt.terminal ? "attempt_ended_while_active" : "still_active";
  }
  const reason = conversation.lifecycle_reason ?? "";
  if (reason === "student_ended_conversation") return "student_ended";
  if (reason === "student_ended_attempt") return "student_ended_attempt";
  // runtime.ts stores the close after the reply to the final allowed student turn as
  // llm_terminal_recommendation:final_allowed_turn_... (feedback v8 included); when that reply
  // could not be produced the platform closes with its handoff message instead.
  if (reason.startsWith("llm_terminal_recommendation:final_allowed_turn") ||
    reason === "platform_student_turn_limit_terminal_recommendation_unavailable") return "turn_limit_reached";
  if (reason.startsWith("platform_")) return "closed_by_system";
  return "other";
}

export function conversationEngagement(turns: Array<{ actor_type: string; created_at: Date }>, firstDisplayAt: string | null) {
  const all = turns.map((turn) => turn.created_at.getTime());
  const student = turns.filter((turn) => turn.actor_type === "student").map((turn) => turn.created_at.getTime());
  const display = firstDisplayAt ? new Date(firstDisplayAt).getTime() : null;
  // A display receipt delivered late (queued browser events) never starts after the first student message.
  const start = display !== null ? Math.min(display, ...student) : all.length ? Math.min(...all) : null;
  const end = all.length ? Math.max(...all) : null;
  return {
    student_participated: student.length > 0,
    last_turn_at: end === null ? null : new Date(end).toISOString(),
    engaged_duration_ms: start === null || end === null ? null : Math.max(0, end - start)
  };
}

export type OpeningStatus = "delivered" | "failed" | "blocked" | "pending" | "interrupted" | "not_requested";

export function openingOutcome(
  receipts: Array<{
    client_message_id: string; status: string; assistant_turn_db_id: string | null; failure_code: string | null;
    assistant_response_last_failure_category: string | null; response_payload: unknown; updated_at: Date;
  }>,
  turns: Array<{ structured_payload: unknown }>,
  now = new Date()
): { opening_status: OpeningStatus; opening_failure_code: string | null } {
  const receipt = receipts.find((entry) => entry.client_message_id === FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID) ?? null;
  const delivered = Boolean(receipt?.assistant_turn_db_id) ||
    turns.some((turn) => record(turn.structured_payload).message_type === "formative_conversation_opening");
  const opening_status: OpeningStatus = delivered ? "delivered"
    : !receipt ? "not_requested"
    : receipt.status === "failed" ? record(receipt.response_payload).retryable === false ? "blocked" : "failed"
    : isStaleOpeningReservation(receipt, now) ? "interrupted" : "pending";
  // A retry clears failure_code; the last failure category survives a later success.
  return { opening_status, opening_failure_code: receipt?.failure_code ?? receipt?.assistant_response_last_failure_category ?? null };
}

const MESSAGE_TYPES: Record<string, string> = {
  formative_conversation_opening: "opening",
  formative_conversation_tutor_message: "reply",
  formative_conversation_student_message: "student",
  formative_conversation_lifecycle_handoff: "lifecycle_handoff"
};

export function conversationMessageType(actorType: string, payload: unknown) {
  const stored = record(payload).message_type;
  if (typeof stored === "string") return MESSAGE_TYPES[stored] ?? stored;
  return actorType === "student" ? "student" : null;
}
