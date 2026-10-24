import type { FrontendProcessEvent } from "./api";

const MAX_PENDING = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SLOW_RETRY_MS = 60_000;
const SAFE_TYPES = new Set(["page_hidden", "page_visible", "page_visibility_hidden", "page_visibility_visible", "window_blur", "window_focus", "paste_detected", "typing_activity_summary", "long_pause", "inactivity_detected", "navigation_event", "refresh_recovery"]);
const SAFE_PAYLOAD_KEYS = new Set(["key_count", "backspace_count", "enter_key_count", "duration_ms", "focus_duration_ms", "target_kind", "pasted_text_length_band", "clipboard_type_count", "includes_plain_text", "paste_blocked", "reason", "navigation_type", "delivery_gap_count"]);

type Pending = { event: FrontendProcessEvent; queued_at: number };
SAFE_TYPES.add("response_stage_observation");
for (const type of ["package_results_shown", "item_correctness_status_shown", "formative_feedback_shown"]) SAFE_TYPES.add(type);
for (const key of ["content_id", "content_kind", "turn_id", "source_turn_sequence_index", "conversation_public_id", "display_event_contract_version", "observation_method", "minimum_visible_ms"]) SAFE_PAYLOAD_KEYS.add(key);
for (const key of ["observation_version", "stage_visit_id", "response_stage", "response_phase", "observation_kind", "monotonic_ms", "observation_sequence", "submission_id", "result", "input_length", "input_change_count"]) SAFE_PAYLOAD_KEYS.add(key);
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A 4xx answer that refuses the content itself. Sign-in, ownership, timeout, conflict and
 * rate-limit answers are not content refusals: those events stay queued and are retried.
 */
export function isRejection(error: unknown): boolean {
  const status = typeof (error as { status?: unknown } | null)?.status === "number"
    ? (error as { status: number }).status
    : Number(/process_event_delivery_failed:(\d{3})/.exec(String((error as { message?: unknown } | null)?.message ?? ""))?.[1] ?? NaN);
  return status >= 400 && status < 500 && ![401, 403, 404, 408, 409, 425, 429].includes(status);
}

// Only aggregate instrumentation enters this queue, never response text or
// feedback text. Display identifiers are safe; unacknowledged events survive reload.
export function createProcessEventDelivery(input: {
  sessionId: string;
  tabId: string;
  storage?: Storage;
  send: (events: FrontendProcessEvent[], keepalive: boolean) => Promise<void>;
  now?: () => number;
  newId?: () => string;
  /** Test seam; defaults to the browser timers. */
  timers?: { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}) {
  const now = input.now ?? Date.now;
  const setTimer = (run: () => void, ms: number) => input.timers ? input.timers.set(run, ms) : setTimeout(run, ms);
  const clearTimer = (handle: unknown) => input.timers ? input.timers.clear(handle) : clearTimeout(handle as ReturnType<typeof setTimeout>);
  const newId = input.newId ?? (() => crypto.randomUUID());
  const key = `process-events-v1:${input.sessionId}`;
  let pending: Pending[] = [];
  let gaps = 0;
  let attempts = 0;
  let disposed = false;
  let finishing = false;
  let flight: Promise<void> | null = null;
  let timer: unknown = null;

  function safeEvent(event: FrontendProcessEvent): FrontendProcessEvent {
    if (!SAFE_TYPES.has(event.event_type)) throw new Error("unsafe_process_queue_event");
    return {
      event_type: event.event_type,
      client_event_id: event.client_event_id ?? newId(),
      browser_tab_id: event.browser_tab_id ?? input.tabId,
      client_occurred_at: event.client_occurred_at ?? new Date(now()).toISOString(),
      item_public_id: event.item_public_id,
      concept_unit_public_id: event.concept_unit_public_id,
      event_category: event.event_category,
      pause_duration_ms: event.pause_duration_ms,
      visibility_duration_ms: event.visibility_duration_ms,
      payload: Object.fromEntries(Object.entries(event.payload ?? {}).filter(([name, value]) =>
        SAFE_PAYLOAD_KEYS.has(name) && (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= (name === "content_id" ? 400 : 80)))))
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

  function scheduleNext() {
    if (disposed || finishing || timer || flight || !(pending.length || gaps)) return;
    // Fast backoff for the first failures, then a slow retry so a long outage (for
    // example a dropped school network) never stops delivery for the rest of the visit.
    const delay = attempts === 0 ? 0 : attempts < MAX_ATTEMPTS ? 1000 * 2 ** attempts : SLOW_RETRY_MS;
    timer = setTimer(() => { timer = null; void send(); }, delay);
  }

  function acknowledge(rows: Pending[]) {
    const acknowledged = new Set(rows.map((row) => row.event.client_event_id));
    pending = pending.filter((row) => !acknowledged.has(row.event.client_event_id));
  }

  // A rejected batch saved nothing (the server ingests a batch atomically). Resend its
  // events one at a time, unchanged, and leave out only the ones the server refuses; each
  // refused event is counted in the existing delivery-gap marker. Returns false when the
  // connection failed part-way, so the remaining events stay queued for the next attempt.
  async function isolateRejected(batch: Pending[], keepalive: boolean): Promise<boolean> {
    const refuse = (row: Pending) => {
      acknowledge([row]);
      // A refused gap marker is not counted again, so a marker can never loop.
      if (row.event.payload?.reason !== "process_delivery_gap") gaps += 1;
    };
    if (batch.length === 1) { refuse(batch[0]); return true; }
    for (const row of batch) {
      try {
        await input.send([row.event], keepalive);
        acknowledge([row]);
      } catch (error) {
        if (!isRejection(error)) return false;
        refuse(row);
      }
    }
    return true;
  }

  async function send(keepalive = false): Promise<void> {
    if (timer) { clearTimer(timer); timer = null; }
    if (disposed || flight) return flight ?? Promise.resolve();
    addGapMarker();
    const batch = pending.slice(0, 20);
    if (!batch.length) { persist(); return; }
    attempts += 1;
    flight = (async () => {
      try {
        await input.send(batch.map((row) => row.event), keepalive);
        acknowledge(batch);
        attempts = 0;
      } catch (error) {
        // Ambiguous network results retry with the same IDs; the server deduplicates.
        if (isRejection(error) && await isolateRejected(batch, keepalive)) attempts = 0;
      } finally {
        flight = null;
        persist();
        scheduleNext();
      }
    })();
    return flight;
  }

  async function flush(keepalive = false): Promise<void> {
    // After repeated failures, new events wait for the slow retry (or for retry(), which
    // runs when the connection or the page comes back) instead of sending at once.
    if (attempts >= MAX_ATTEMPTS && !disposed) {
      if (flight) return flight;
      scheduleNext();
      return;
    }
    return send(keepalive);
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
      if (timer) clearTimer(timer);
      timer = null;
      attempts = 0;
      return flush();
    },
    async finish() {
      // Drain trailing summaries after an in-flight acknowledgement, but do
      // not keep retrying after the page has stopped collecting events.
      finishing = true;
      if (timer) { clearTimer(timer); timer = null; }
      const awaited = flight;
      if (flight) await flight;
      // Earlier failures (a backoff or the slow retry was waiting) still get one final
      // keepalive attempt; a request that has just failed is not repeated here.
      if (!awaited) attempts = 0;
      while (!disposed && (pending.length || gaps) && attempts === 0) await send(true);
      disposed = true;
      persist();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimer(timer);
      persist();
    },
    pendingCount: () => pending.length
  };
}
