import {
  buildAnalysisReadyDictionaryEntries,
  researchDataDictionarySemanticReport
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isTiming(variable: string) {
  return (
    variable.endsWith("_ms") ||
    variable.endsWith("_at") ||
    /duration|latency|elapsed|pause|idle|hidden|typing|response_time|time_to/.test(variable)
  );
}

function main() {
  const entries = buildAnalysisReadyDictionaryEntries();
  const timingEntries = entries.filter((entry) => isTiming(entry.variable_name));
  assert(timingEntries.length > 30, "Expected broad timing/timestamp coverage.");
  assert(timingEntries.every((entry) => entry.substantive_category === "Timing and interaction data" || entry.variable_name.endsWith("_at")), "Duration and latency fields should be timing data.");
  assert(timingEntries.every((entry) => entry.measurement_level), "Timing fields need measurement levels.");
  assert(timingEntries.every((entry) => entry.unit), "Timing fields need units.");
  assert(
    timingEntries.every((entry) => entry.timing_start_event && entry.timing_end_event),
    "Timing fields need start/end events or a documented timestamp alternative."
  );
  assert(
    timingEntries.every((entry) => entry.calculation_formula),
    "Timing fields need calculation formulas or timestamp-value explanations."
  );
  assert(timingEntries.every((entry) => entry.idle_time_handling), "Timing fields need idle-time handling.");
  assert(timingEntries.every((entry) => entry.page_hidden_handling), "Timing fields need page-hidden handling.");

  const sessionElapsed = entries.find((entry) => entry.qualified_name === "sessions.elapsed_session_time_ms");
  const itemElapsed = entries.find((entry) => entry.qualified_name === "item_responses.item_response_time_ms");
  const turnLatency = entries.find((entry) => entry.qualified_name === "conversation_turns.response_or_action_latency_ms");
  assert(sessionElapsed?.measurement_level === "session", "Session elapsed time should be session-level.");
  assert(itemElapsed?.measurement_level === "item_response", "Item response time should be item-response-level.");
  assert(turnLatency?.measurement_level === "conversation_turn", "Turn latency should be conversation-turn-level.");
  assert(
    sessionElapsed.timing_construct !== itemElapsed.timing_construct &&
      itemElapsed.timing_construct !== turnLatency.timing_construct,
    "Session, item, and conversation timing constructs should be distinguishable."
  );

  const ambiguousResponseTime = entries.find((entry) => entry.qualified_name === "item_responses.item_response_time_ms");
  assert(ambiguousResponseTime?.definition.includes("one row per student response"), "Legacy item_response_time_ms should be clarified at item-response grain.");

  const report = researchDataDictionarySemanticReport();
  assert(report.timing_variables_missing_level === 0, "Timing variables should not miss measurement level.");
  assert(report.timing_variables_missing_formula === 0, "Timing variables should not miss formulas.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        timing_variable_count: timingEntries.length,
        session_elapsed_construct: sessionElapsed?.timing_construct,
        item_elapsed_construct: itemElapsed?.timing_construct,
        turn_latency_construct: turnLatency?.timing_construct,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
