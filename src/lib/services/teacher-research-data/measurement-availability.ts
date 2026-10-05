export const MEASUREMENT_AVAILABILITY_VERSION = "research-measurement-availability-v1";

export function measurementAvailability(dataset: string, variable: string) {
  const table = dataset.replace(/\.csv$/, "");
  if ((table === "sessions" && ["session_active_interaction_time_ms", "active_interaction_time_ms", "session_idle_time_ms", "total_idle_time_ms", "idle_ratio"].includes(variable)) ||
      (table === "item_responses" && ["reasoning_active_typing_time_ms", "reasoning_active_time_ms"].includes(variable)) ||
      (table === "formative_conversation_events" && variable === "observed_interval_duration_ms")) {
    return { collection_status: "not_collected_by_current_browser",
      analysis_guidance: "Retained compatibility field. Current browser does not emit the required intervals. Historical values, if present, require their original method. Leave unavailable values blank; never substitute elapsed time or zero." };
  }
  if (["profile_valid_for_learning_analysis", "profile_provenance_eligible"].includes(variable)) {
    return { collection_status: "derived_pipeline_provenance",
      analysis_guidance: "Technical provenance eligibility only. Not an independent human rating, established diagnostic validity, mastery, or learning gain. Legacy and preferred fields are aliases, not two measures." };
  }
  if (table === "formative_conversation_turns" && ["typing_duration_ms", "response_time_ms"].includes(variable)) {
    return { collection_status: "actor_and_method_dependent_elapsed_time",
      analysis_guidance: "Current student rows: first nonempty input to submission, including pauses; both fields duplicate this interval. Tutor response_time_ms is provider latency. Separate actors and methods; do not add the fields." };
  }
  if (table === "feedback_exposure_events") return { collection_status: "browser_display_observation",
    analysis_guidance: "Display-ack-v2 observes partial viewport visibility for at least 500 ms. Generated, displayed, read and understood are distinct; absence of a receipt does not prove non-exposure." };
  if (table === "pause_episodes") return { collection_status: "explicit_lifecycle_observation",
    analysis_guidance: "Explicit pause and matching return only. No return is censored at the export snapshot. Does not identify motivation, dissatisfaction or browser-close duration." };
  return { collection_status: "see_dictionary", analysis_guidance: "Use the dataset dictionary, actor, phase, source version and quality flags. Population alone does not establish applicability or validity." };
}
