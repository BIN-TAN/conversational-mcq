import { deriveVisibilityIntervals } from "../src/lib/services/student-assessment/timing-contract";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const hidden1 = new Date("2026-07-01T21:05:37.943Z");
const visible1 = new Date("2026-07-01T21:05:44.529Z");
const hidden2 = new Date("2026-07-01T21:08:36.145Z");
const visible2 = new Date("2026-07-01T21:09:40.921Z");

const intervals = deriveVisibilityIntervals([
  {
    event_type: "page_visibility_hidden",
    occurred_at: hidden1,
    created_at: hidden1,
    visibility_duration_ms: 125_700,
    payload: { duration_kind: "legacy_cumulative_not_interval" }
  },
  { event_type: "page_visibility_visible", occurred_at: visible1, created_at: visible1 },
  {
    event_type: "window_blur",
    occurred_at: new Date("2026-07-01T21:06:00.000Z"),
    created_at: new Date("2026-07-01T21:06:00.000Z"),
    visibility_duration_ms: 10_000
  },
  {
    event_type: "page_visibility_hidden",
    occurred_at: hidden2,
    created_at: hidden2,
    visibility_duration_ms: 171_569,
    payload: { duration_kind: "legacy_cumulative_not_interval" }
  },
  { event_type: "page_visibility_visible", occurred_at: visible2, created_at: visible2 }
]);

const durations = intervals.map((interval) => interval.duration_ms);
const total = durations.reduce<number>((sum, value) => sum + (value ?? 0), 0);

assert(intervals.length === 2, "Visibility pairing should produce exactly two intervals.");
assert(durations[0] === 6_586, "First hidden interval should be 6,586 ms.");
assert(durations[1] === 64_776, "Second hidden interval should be 64,776 ms.");
assert(total === 71_362, "Total hidden duration should be 71,362 ms.");
assert(
  intervals.every((interval) => interval.quality_status === "valid"),
  "Observed visibility fixture should pair cleanly."
);

const unmatched = deriveVisibilityIntervals([
  { event_type: "page_visibility_visible", occurred_at: visible1, created_at: visible1 },
  { event_type: "page_visibility_hidden", occurred_at: hidden2, created_at: hidden2 }
]);

assert(
  unmatched.some((interval) => interval.quality_status === "missing_start"),
  "Visible without hidden should be flagged."
);
assert(
  unmatched.some((interval) => interval.quality_status === "missing_end"),
  "Hidden without visible should be flagged."
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      interval_durations_ms: durations,
      total_page_hidden_ms: total,
      cumulative_payload_ignored: true,
      blur_not_double_counted: true,
      no_openai_call_occurred: true
    },
    null,
    2
  )
);
