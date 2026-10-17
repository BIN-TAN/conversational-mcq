/**
 * D10: a paste into a written-explanation field is blocked and logged as
 * paste_detected with payload.paste_blocked=true. No text was inserted, so it is
 * not a paste for any count, signal or flag; it is counted separately as a
 * blocked paste attempt.
 */
export const BLOCKED_PASTE_COUNT_KEY = "paste_blocked_attempt";

export function isBlockedPasteEvent(event: { event_type: string; payload?: unknown }) {
  if (event.event_type !== "paste_detected") return false;
  const payload = event.payload;
  return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload) &&
    (payload as Record<string, unknown>).paste_blocked === true;
}

/** Event type to count under: blocked pastes are counted apart from real pastes. */
export function countedEventType(event: { event_type: string; payload?: unknown }) {
  return isBlockedPasteEvent(event) ? BLOCKED_PASTE_COUNT_KEY : event.event_type;
}

/** Pastes that actually inserted text. */
export function insertedPasteCount(events: Array<{ event_type: string; payload?: unknown }>) {
  return events.filter((event) => event.event_type === "paste_detected" && !isBlockedPasteEvent(event)).length;
}
