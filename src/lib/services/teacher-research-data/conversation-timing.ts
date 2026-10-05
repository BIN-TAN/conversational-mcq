export function separateConversationTiming(actor: string, input: { typing_duration_method?: string | null; typing_duration_ms?: number | null } | null | undefined, callLatency: number | null | undefined) {
  const method = input?.typing_duration_method;
  const elapsed = actor === "student" && ["elapsed_first_input_to_submit", "elapsed_monotonic_first_input_to_submit"].includes(method ?? "") ? input?.typing_duration_ms ?? null : null;
  return {
    student_input_elapsed_ms: elapsed,
    model_call_latency_ms: actor === "agent" ? callLatency ?? null : null,
    student_timing_method: actor === "student" ? method ?? null : null,
    student_timing_status: actor !== "student" ? "not_applicable" : elapsed === null ? "unavailable_or_different_method" :
      method === "elapsed_monotonic_first_input_to_submit" ? "monotonic_first_submission" : "legacy_wall_clock_retry_unverified"
  };
}
