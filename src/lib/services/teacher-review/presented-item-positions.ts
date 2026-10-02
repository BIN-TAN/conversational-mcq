import type { TimingEventLike } from "../student-assessment/timing-contract";

export function presentedItemPositions(events: (TimingEventLike & { item_public_id?: string | null })[]) {
  const positions = new Map<string, number>();
  const conflicts = new Set<string>();
  for (const event of events) {
    if (event.event_type !== "item_presented" || !event.item_public_id) continue;
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    const position = payload.item_position;
    if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 1) continue;
    if (positions.has(event.item_public_id) && positions.get(event.item_public_id) !== position) conflicts.add(event.item_public_id);
    positions.set(event.item_public_id, position);
  }
  for (const id of conflicts) positions.delete(id);
  return positions;
}
