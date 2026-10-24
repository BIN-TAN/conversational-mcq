/**
 * Pure helpers for the student's waiting states: the tutor reply, the message being sent,
 * and the feedback being prepared after submission. Kept free of React so they can be
 * checked without a browser (prisma/feedback-chat-ux-unit-test.ts).
 */

export const FORMATIVE_REPLY_WAITING_MESSAGE = "Waiting for the tutor's reply...";
export const FORMATIVE_REPLY_DELAYED_MESSAGE =
  "Still waiting. You can read the earlier messages while you wait.";

/** The tutor-reply waiting text. It never says the message is saved: the transcript says so once the server confirms it. */
export function formativeReplyWaitingMessage(delayed: boolean) {
  return delayed ? FORMATIVE_REPLY_DELAYED_MESSAGE : FORMATIVE_REPLY_WAITING_MESSAGE;
}

export type FormativeOutgoingMessage = { client_message_id: string; text: string };

/**
 * A resend of the same text keeps its client_message_id, so a message that reached the server
 * before the connection dropped is not saved twice. Changed text is a new message with a new id
 * (reusing the old id would be refused as different content for the same message).
 */
export function formativeOutgoingMessageFor(
  previous: FormativeOutgoingMessage | null,
  text: string,
  newId: () => string
): FormativeOutgoingMessage {
  return previous && previous.text === text ? previous : { client_message_id: newId(), text };
}

/**
 * After a failed send, whether the server saved the message anyway: the refreshed conversation
 * has a new student turn, and the latest one has the text that was sent.
 */
export function sentFormativeMessageWasSaved(
  studentTurnCountBeforeSend: number,
  conversation: { transcript: Array<{ actor: string; message_text: string }> } | null,
  sentText: string
) {
  if (!conversation) return false;
  const studentTurns = conversation.transcript.filter((turn) => turn.actor === "student");
  return studentTurns.length > studentTurnCountBeforeSend &&
    studentTurns.at(-1)?.message_text.trim() === sentText.trim();
}

/** "Waiting for about N minutes": how long the student has waited for feedback. */
export function preparationWaitingLabel(elapsedMs: number) {
  const minutes = Math.round(Math.max(0, elapsedMs) / 60_000);
  if (elapsedMs < 60_000 || minutes < 1) return "Waiting for less than a minute.";
  return minutes === 1 ? "Waiting for about 1 minute." : `Waiting for about ${minutes} minutes.`;
}

/** The two steps of preparation as the student sees them. */
export function preparationStageLabel(stage: "reading_answers" | "writing_feedback" | null | undefined) {
  if (stage === "writing_feedback") return "Step 2 of 2: Writing your feedback";
  if (stage === "reading_answers") return "Step 1 of 2: Reading your answers";
  return null;
}

/** Polls quickly for the first 30 seconds (most preparations finish then), then every 4 seconds; failures back off. */
export const PREPARATION_FAST_POLL_WINDOW_MS = 30_000;
export function preparationPollDelayMs(elapsedMs: number, failures: number) {
  const base = elapsedMs < PREPARATION_FAST_POLL_WINDOW_MS ? 2000 : 4000;
  return Math.min(15_000, base * 2 ** Math.min(failures, 3));
}
