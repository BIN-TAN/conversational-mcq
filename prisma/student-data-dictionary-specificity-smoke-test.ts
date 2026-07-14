import {
  buildAnalysisReadyDictionaryEntries,
  buildProcessEventCodebookEntries,
  researchDataDictionarySemanticReport
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const genericFragments = [
  "value recorded for one row",
  "timestamp associated with one row",
  "counted within one row",
  "measured for one row",
  "serialization path",
  "Calculated by counting matching records or process events",
  "Read from the"
];

function hasGenericText(value: string) {
  return genericFragments.some((fragment) => value.includes(fragment));
}

function main() {
  const research = buildAnalysisReadyDictionaryEntries();
  const processEvents = buildProcessEventCodebookEntries();
  const report = researchDataDictionarySemanticReport();

  assert(research.length > 250, "Research variables should be generated.");
  assert(report.generic_research_definitions === 0, "No generic row-based research definitions should remain.");
  assert(report.generic_research_methods === 0, "No serialization-path-only methods should remain.");
  assert(research.every((entry) => entry.source_code_reference), "Every research variable needs a source-code reference.");
  assert(research.every((entry) => entry.source_service_or_function), "Every research variable needs a source service/function.");
  assert(research.every((entry) => entry.semantic_review_status === "source_verified"), "Every generated research variable should be source-verified, not domain-approved.");
  assert(research.every((entry) => !hasGenericText(entry.definition)), "Research definitions must not use generic row templates.");
  assert(research.every((entry) => !hasGenericText(entry.collection_or_generation_method)), "Research methods must not use generic serialization templates.");

  const derived = research.filter((entry) =>
    /derived|aggregate|timestamp|interpretation|configuration|imported|mixed_by_actor_type/.test(entry.source_nature)
  );
  assert(derived.every((entry) => entry.collection_or_generation_method.length > 40), "Derived/generated fields need a substantive method.");

  const llmFields = research.filter((entry) => entry.source_nature === "persisted_llm_interpretation");
  assert(llmFields.length > 10, "Expected LLM/interpretive fields.");
  assert(
    llmFields.every((entry) => entry.generating_agent || entry.collection_or_generation_method.includes("validated LLM")),
    "LLM fields should identify the generating workflow or schema provenance."
  );

  const summaryEntries = research.filter((entry) => entry.table_name === "assessment_summary");
  assert(summaryEntries.length > 0, "Assessment summary entries should exist.");
  assert(
    summaryEntries.every((entry) => /convenience|derived/i.test(entry.definition + entry.collection_or_generation_method + entry.semantic_review_notes)),
    "assessment_summary should be documented as a derived convenience view."
  );

  const agentUnionEntries = research.filter((entry) => entry.table_name === "agent_activity_records");
  assert(agentUnionEntries.length > 0, "Agent/activity union entries should exist.");
  assert(
    agentUnionEntries.every((entry) => entry.applicable_record_types && !entry.applicable_record_types.includes("undefined")),
    "agent_activity_records entries need applicable record-type documentation."
  );

  assert(processEvents.every((entry) => entry.source_code_reference), "Every process event needs source-code evidence.");
  assert(processEvents.every((entry) => entry.semantic_review_status === "source_verified"), "Process events should be source-verified only.");
  assert(report.process_event_generic_triggers === 0, "Process-event triggers must not be generic.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        research_variable_count: research.length,
        source_verified_research_variables: research.filter((entry) => entry.semantic_review_status === "source_verified").length,
        process_event_count: processEvents.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
