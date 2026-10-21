/**
 * Item-builder calls (authoring assistant, draft generation) still marked started after these
 * windows had their request cut off by an application restart or a deployment, since each
 * provider call times out after 120 seconds. They are closed as abandoned so the same message
 * or draft generation can run again.
 */
export const ITEM_DESIGN_ASSISTANT_STALE_CALL_MS = 10 * 60_000;
export const ITEM_GENERATION_STALE_CALL_MS = 20 * 60_000;

export type CallTiming = { id: string; call_status: string; started_at: Date | null; created_at: Date };

/** Calls still marked started longer than staleAfterMs after they began. */
export function abandonedStartedCalls<T extends CallTiming>(calls: T[], staleAfterMs: number, now = new Date()): T[] {
  return calls.filter((call) =>
    call.call_status === "started" && now.getTime() - (call.started_at ?? call.created_at).getTime() > staleAfterMs);
}
