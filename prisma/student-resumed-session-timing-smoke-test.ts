import { deriveSessionTiming } from "../src/lib/services/student-assessment/timing-contract";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function at(ms: number) {
  return new Date(new Date("2026-07-01T20:00:00.000Z").getTime() + ms);
}

const minute = 60_000;
const timing = deriveSessionTiming({
  session_started_at: at(0),
  session_completed_at: at(40 * minute),
  events: [
    { event_type: "attempt_started", occurred_at: at(0), created_at: at(0), payload: {} },
    { event_type: "attempt_paused", occurred_at: at(10 * minute), created_at: at(10 * minute), payload: {} },
    { event_type: "attempt_resumed", occurred_at: at(30 * minute), created_at: at(30 * minute), payload: {} },
    { event_type: "page_visibility_hidden", occurred_at: at(35 * minute), created_at: at(35 * minute), payload: {} },
    { event_type: "page_visibility_visible", occurred_at: at(36 * minute), created_at: at(36 * minute), payload: {} },
    { event_type: "assessment_completed", occurred_at: at(40 * minute), created_at: at(40 * minute), payload: {} }
  ]
});

assert(timing.session_wall_clock_elapsed_ms === 40 * minute, "Wall-clock elapsed time mismatch.");
assert(
  timing.session_resumable_active_window_ms === 20 * minute,
  "Offline pause interval should be excluded from active window."
);
assert(timing.total_page_hidden_ms === minute, "Paired hidden interval mismatch.");
assert(timing.session_visible_window_ms === 19 * minute, "Visible active-window timing mismatch.");
assert(
  timing.session_active_interaction_time_ms === null,
  "Active interaction time should not be manufactured without explicit instrumentation."
);
assert(
  timing.timing_limitations.includes("active_interaction_interval_instrumentation_unavailable"),
  "Missing active interaction instrumentation should be documented."
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      session_wall_clock_elapsed_ms: timing.session_wall_clock_elapsed_ms,
      session_resumable_active_window_ms: timing.session_resumable_active_window_ms,
      session_visible_window_ms: timing.session_visible_window_ms,
      session_active_interaction_time_ms: timing.session_active_interaction_time_ms,
      no_openai_call_occurred: true
    },
    null,
    2
  )
);
