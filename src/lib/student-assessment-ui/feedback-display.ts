export const FEEDBACK_DISPLAY_VERSION = "display-ack-v2";
export const FEEDBACK_DISPLAY_MIN_VISIBLE_MS = 500;

export function feedbackContentId(sessionId: string, conceptId: string, content: string) {
  return `${sessionId}:${conceptId}:${content}`;
}
