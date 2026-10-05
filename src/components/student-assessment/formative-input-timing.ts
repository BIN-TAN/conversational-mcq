export const FORMATIVE_INPUT_TIMING_METHOD = "elapsed_monotonic_first_input_to_submit" as const;

// A transport retry is the same response, not another period of student work.
export function createFormativeInputTiming(now: () => number, wallNow: () => string) {
  let start: { monotonic: number; wall: string } | null = null;
  let submitted: { id: string; value: ReturnType<typeof snapshot> } | null = null;
  function snapshot() {
    const end = now(), wall = wallNow();
    const elapsed = start ? Math.round(end - start.monotonic) : null;
    const duration = elapsed !== null && Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 2147483647 ? elapsed : null;
    return { turn_started_at: start && start.wall <= wall ? start.wall : null,
      submitted_at: wall, response_time_ms: duration,
      typing_started_at: start && (duration !== null || start.wall <= wall) ? start.wall : null, typing_ended_at: wall,
      typing_duration_ms: duration, typing_duration_method: duration === null ? null : FORMATIVE_INPUT_TIMING_METHOD };
  }
  return {
    input(length: number) { if (!start && length > 0) start = { monotonic: now(), wall: wallNow() }; },
    submit(id: string) {
      if (submitted?.id !== id) submitted = { id, value: snapshot() };
      return submitted.value;
    },
    reset() { start = null; submitted = null; }
  };
}
