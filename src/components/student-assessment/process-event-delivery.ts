import type { FrontendProcessEvent } from "./api";

const MAX_PENDING = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SAFE_TYPES = new Set(["page_hidden", "page_visible", "page_visibility_hidden", "page_visibility_visible", "window_blur", "window_focus", "paste_detected", "typing_activity_summary", "long_pause", "inactivity_detected", "navigation_event", "refresh_recovery"]);
const SAFE_PAYLOAD_KEYS = new Set(["key_count", "backspace_count", "enter_key_count", "duration_ms", "focus_duration_ms", "target_kind", "pasted_text_length_band", "clipboard_type_count", "includes_plain_text", "reason", "navigation_type", "delivery_gap_count"]);

type Pending = { event: FrontendProcessEvent; queued_at: number };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

// Only aggregate instrumentation enters this queue, never response text or
// feedback payloads. Session storage retains unacknowledged events on reload.
export function createProcessEventDelivery(input: {
  sessionId: string;
  tabId: string;
  storage?: Storage;
  send: (events: FrontendProcessEvent[], keepalive: boolean) => Promise<void>;
  now?: () => number;
  newId?: () => string;
}) {
  const now = input.now ?? Date.now;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const key = `process-events-v1:${input.sessionId}`;
  let pending: Pending[] = [];
  let gaps = 0;
  let attempts = 0;
  let disposed = false;
  let flight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function safeEvent(event: FrontendProcessEvent): FrontendProcessEvent {
    if (!SAFE_TYPES.has(event.event_type)) throw new Error("unsafe_process_queue_event");
    return {
      event_type: event.event_type,
      client_event_id: event.client_event_id ?? newId(),
      browser_tab_id: event.browser_tab_id ?? input.tabId,
      client_occurred_at: event.client_occurred_at ?? new Date(now()).toISOString(),
      item_public_id: event.item_public_id,
      pause_duration_ms: event.pause_duration_ms,
      visibility_duration_ms: event.visibility_duration_ms,
      payload: Object.fromEntries(Object.entries(event.payload ?? {}).filter(([name, value]) =>
        SAFE_PAYLOAD_KEYS.has(name) && (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 80))))
    };
  }

  try {
    const stored = JSON.parse(input.storage?.getItem(key) ?? "null");
    if (stored && Array.isArray(stored.pending)) {
      gaps = Number.isSafeInteger(stored.gaps) && stored.gaps >= 0 ? stored.gaps : 0;
      for (const row of stored.pending.slice(-MAX_PENDING)) {
        if (!Number.isFinite(row.queued_at) || now() - row.queued_at > MAX_AGE_MS) { gaps += 1; continue; }
        try { pending.push({ event: safeEvent(row.event), queued_at: row.queued_at }); } catch { gaps += 1; }
      }
    }
  } catch { gaps += 1; }

  function persist() {
    try {
      if (pending.length || gaps) input.storage?.setItem(key, JSON.stringify({ pending, gaps }));
      else input.storage?.removeItem(key);
    } catch {
      // Memory delivery still works when browser storage is disabled/full.
      // Do not claim durability or manufacture a count of unobserved losses.
    }
  }

  function addGapMarker() {
    if (!gaps || pending.length >= MAX_PENDING) return;
    pending.push({ queued_at: now(), event: safeEvent({ event_type: "navigation_event", payload: { reason: "process_delivery_gap", delivery_gap_count: gaps } }) });
    gaps = 0;
  }

  async function flush(keepalive = false): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (disposed || flight || attempts >= MAX_ATTEMPTS) return flight ?? Promise.resolve();
    addGapMarker();
    const batch = pending.slice(0, 20);
    if (!batch.length) { persist(); return; }
    attempts += 1;
    flight = (async () => {
      try {
        await input.send(batch.map((row) => row.event), keepalive);
        const acknowledged = new Set(batch.map((row) => row.event.client_event_id));
        pending = pending.filter((row) => !acknowledged.has(row.event.client_event_id));
        attempts = 0;
      } catch {
        // Ambiguous network results retry with the same IDs; the server deduplicates.
      } finally {
        flight = null;
        persist();
        if (!disposed && (pending.length || gaps) && attempts < MAX_ATTEMPTS) {
          timer = setTimeout(() => { timer = null; void flush(); }, attempts ? 1000 * 2 ** attempts : 0);
        }
      }
    })();
    return flight;
  }

  return {
    enqueue(event: FrontendProcessEvent, keepalive = false) {
      pending.push({ event: safeEvent(event), queued_at: now() });
      if (pending.length > MAX_PENDING) { pending.shift(); gaps += 1; }
      persist();
      void flush(keepalive);
    },
    flush,
    retry() {
      if (timer) clearTimeout(timer);
      timer = null;
      attempts = 0;
      return flush();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      persist();
    },
    pendingCount: () => pending.length
  };
}
