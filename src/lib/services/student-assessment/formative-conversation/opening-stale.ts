/**
 * An opening reservation left "reserved" by an interrupted process (a restart during the
 * inline retry, or a worker crash) would otherwise show "preparing" for good, with no Retry.
 * After this window, longer than the longest opening generation (two attempts of up to
 * 120 seconds each), the reservation counts as interrupted: the student sees Retry, and a
 * retry may reclaim it. Students are never held at a spinner.
 */
export const FORMATIVE_CONVERSATION_STALE_OPENING_MS = 6 * 60 * 1000;

export function isStaleOpeningReservation(
  receipt: { status: string; updated_at: Date; assistant_turn_db_id?: string | null } | null | undefined,
  now = new Date()
) {
  return Boolean(receipt) && receipt!.status === "reserved" && !receipt!.assistant_turn_db_id &&
    now.getTime() - receipt!.updated_at.getTime() > FORMATIVE_CONVERSATION_STALE_OPENING_MS;
}
