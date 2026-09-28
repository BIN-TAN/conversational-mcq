export const CONVERSATION_VISIBILITY_VERSION = "conversation-visibility-v1";

export type ConversationVisibility = "internal_only" | "student_visible" | "legacy_unspecified";

// Eligibility for the student transcript is not proof of viewport exposure or reading.
export function conversationVisibility(payload: unknown, hasFormativeConversation = false): ConversationVisibility {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const messageType = record.message_type;
  if (
    record.student_visible === false || record.shown_to_student === false ||
    [record.visibility_status, record.visibility].some(value => ["draft", "internal", "not_shown"].includes(String(value ?? ""))) ||
    messageType === "next_interaction" ||
    (hasFormativeConversation && ["package_feedback", "pattern_statement"].includes(String(messageType ?? "")))
  ) return "internal_only";
  if (record.student_visible === true || record.shown_to_student === true ||
    record.visibility === "student_visible" || record.visibility_status === "shown") return "student_visible";
  return "legacy_unspecified";
}
