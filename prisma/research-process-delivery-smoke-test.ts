import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createProcessEventDelivery } from "../src/components/student-assessment/process-event-delivery";
import { deriveSessionTiming, deriveItemTiming } from "../src/lib/services/student-assessment/timing-contract";

async function main() {
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
  const ids: string[] = [];
  let attempts = 0;
  const queue = createProcessEventDelivery({ sessionId: "synthetic", tabId: randomUUID(), storage, newId: randomUUID,
    send: async (events) => { attempts += 1; ids.push(events[0].client_event_id!); throw new Error("simulated_lost_ack"); } });
  queue.enqueue({ event_type: "typing_activity_summary", payload: { key_count: 17, raw_text: "DO_NOT_PERSIST" } });
  await queue.flush();
  assert.equal(queue.pendingCount(), 1);
  assert(![...stored.values()].join("").includes("DO_NOT_PERSIST"));
  for (let i = 0; i < 10; i += 1) await queue.flush();
  assert.equal(attempts, 5, "Retries must be bounded.");
  assert.equal(new Set(ids).size, 1, "Ambiguous sends reuse the same event ID.");
  queue.dispose();
  let delivered = 0;
  const restored = createProcessEventDelivery({ sessionId: "synthetic", tabId: randomUUID(), storage, newId: randomUUID,
    send: async (events) => { delivered += events.length; assert.equal(events[0].client_event_id, ids[0]); } });
  await restored.flush();
  assert.equal(delivered, 1);
  assert.equal(restored.pendingCount(), 0);
  assert.equal(stored.size, 0);
  restored.dispose();
  const overflow = createProcessEventDelivery({ sessionId: "overflow", tabId: randomUUID(), storage, newId: randomUUID,
    send: async () => { throw new Error("offline"); } });
  for (let i = 0; i < 225; i += 1) overflow.enqueue({ event_type: "window_focus" });
  await overflow.flush();
  assert.equal(overflow.pendingCount(), 200);
  overflow.dispose();
  let reportedGap = 0;
  const recovered = createProcessEventDelivery({ sessionId: "overflow", tabId: randomUUID(), storage, newId: randomUUID,
    send: async (events) => { reportedGap += events.reduce((n, event) => n + Number(event.payload?.delivery_gap_count ?? 0), 0); } });
  for (let i = 0; i < 12; i += 1) await recovered.flush();
  assert.equal(reportedGap, 25);
  assert.equal(recovered.pendingCount(), 0);
  recovered.dispose();

  const at = (n: number) => new Date(1_800_000_000_000 + n * 1000);
  const timing = deriveSessionTiming({ session_started_at: at(0), session_completed_at: at(400), events: [
    { event_type: "attempt_paused", occurred_at: at(100) },
    { event_type: "attempt_resumed", occurred_at: at(300) },
    { event_type: "long_pause", occurred_at: at(120), pause_duration_ms: 120000 },
    { event_type: "inactivity_detected", occurred_at: at(400), pause_duration_ms: 400000 }
  ] });
  assert.equal(timing.session_idle_time_ms, 200000);
  assert.equal(timing.session_visible_window_ms, null);
  assert.notEqual(timing.timing_quality_status, "valid");
  const multiTab = deriveSessionTiming({ session_started_at: at(0), session_completed_at: at(60), events: [
    { event_type: "page_hidden", occurred_at: at(10), payload: { browser_tab_id: "a" } },
    { event_type: "page_visible", occurred_at: at(20), payload: { browser_tab_id: "b" } }
  ] });
  assert.equal(multiTab.session_visible_window_ms, null);
  const typing = deriveItemTiming({ events: [
    { event_type: "typing_activity_summary", occurred_at: at(10), payload: { duration_ms: 5000 } }
  ] });
  assert.equal(typing.reasoning_active_typing_time_ms, null, "Elapsed input time must not become active typing.");
  console.log(JSON.stringify({ status: "passed", provider_calls: 0, model_auth_requests: 0, real_dispatch_checkpoints: 0 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
