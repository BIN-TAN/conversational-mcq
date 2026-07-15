import { buildAnalysisReadyDictionaryEntries } from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const entries = buildAnalysisReadyDictionaryEntries();
const canonical = entries.find(
  (entry) => entry.qualified_name === "conversation_turns.prompt_to_student_action_latency_ms"
);
const compatibility = entries.find(
  (entry) => entry.qualified_name === "conversation_turns.response_or_action_latency_ms"
);
const placement = entries.find((entry) => entry.qualified_name === "conversation_turns.latency_recorded_on_turn");

assert(canonical, "Missing canonical prompt-to-student latency dictionary row.");
assert(compatibility, "Missing compatibility latency dictionary row.");
assert(placement, "Missing latency placement dictionary row.");
assert(canonical.measurement_level === "conversation_turn", "Canonical latency should be turn-grain.");
assert(
  canonical.definition.toLowerCase().includes("agent prompt") ||
    canonical.collection_or_generation_method.toLowerCase().includes("prompt turn"),
  "Canonical latency should document prompt-turn placement."
);
assert(compatibility.deprecated === "true", "Old conversation latency field should be deprecated.");
assert(
  compatibility.replacement_variable === "prompt_to_student_action_latency_ms",
  "Old conversation latency replacement mismatch."
);
assert(
  placement.definition.toLowerCase().includes("prompt turn"),
  "Latency placement field should identify prompt turn storage."
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      canonical_latency_field: canonical.qualified_name,
      compatibility_field_deprecated: compatibility.deprecated,
      row_placement: "prompt_turn",
      no_openai_call_occurred: true
    },
    null,
    2
  )
);
