import {
  analysisReadyColumnsByTable,
  buildAnalysisReadyDictionaryEntries,
  buildExcludedPlatformVariableEntries,
  buildInternalSchemaAppendixEntries,
  buildProcessEventCodebookEntries,
  DATA_DICTIONARY_CATEGORIES
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const placeholderFragments = [
  "Captured Prisma field",
  "exported from",
  "See source and generation fields",
  "defined by the application domain enum",
  "Persisted by application services",
  "Read from persisted relational records",
  "Derived automatically",
  "System generated"
];

function hasPlaceholder(value: string) {
  return placeholderFragments.some((fragment) => value.includes(fragment));
}

function main() {
  const entries = buildAnalysisReadyDictionaryEntries();
  const byKey = new Map(entries.map((entry) => [entry.qualified_name, entry]));
  const categories = new Set(entries.map((entry) => entry.substantive_category));

  const expectedResearchCategories = DATA_DICTIONARY_CATEGORIES.filter((category) =>
    !["Platform administration", "Internal security"].includes(category)
  );
  for (const category of expectedResearchCategories) {
    assert(categories.has(category), `Research dictionary should include ${category}.`);
  }
  assert(!categories.has("Platform administration"), "Platform administration should not be an ordinary research variable category.");
  assert(!categories.has("Internal security"), "Internal security should not be an ordinary research variable category.");
  for (const obsolete of ["Quick summary", "Analysis-ready", "Analysis-ready dataset", "Full archive", "Export tier"]) {
    assert(!categories.has(obsolete), `Primary dictionary categories should not use export product ${obsolete}.`);
  }

  for (const [table, columns] of Object.entries(analysisReadyColumnsByTable())) {
    for (const column of columns) {
      assert(byKey.has(`${table}.${column}`), `Exported field ${table}.${column} lacks dictionary entry.`);
    }
  }

  for (const entry of entries) {
    assert(entry.entity_type === "research_variable", `${entry.qualified_name} should be a research variable.`);
    assert(entry.qualified_name === `${entry.table_name}.${entry.variable_name}`, `${entry.qualified_name} should be table-qualified.`);
    assert(entry.measurement_level.trim(), `${entry.qualified_name} needs measurement level.`);
    assert(entry.source_nature.trim(), `${entry.qualified_name} needs source nature.`);
    assert(entry.collection_or_generation_method.trim(), `${entry.qualified_name} needs collection method.`);
    assert(!hasPlaceholder(entry.definition), `${entry.qualified_name} has placeholder definition.`);
    assert(!hasPlaceholder(entry.collection_or_generation_method), `${entry.qualified_name} has placeholder method.`);
  }

  const timingEntries = entries.filter((entry) => entry.substantive_category === "Timing and interaction data");
  assert(timingEntries.length > 0, "Expected timing dictionary entries.");
  assert(
    timingEntries.every((entry) => entry.unit && entry.measurement_level && entry.timing_construct),
    "Timing entries should have unit, measurement level, and timing construct."
  );

  const interpretiveEntries = entries.filter((entry) =>
    entry.substantive_category === "Diagnostic and interpretation outputs" ||
    entry.source_nature === "persisted_llm_interpretation" ||
    /misconception|engagement|understanding|guessing|profile/i.test(entry.variable_name)
  );
  assert(interpretiveEntries.length > 0, "Expected interpretive dictionary entries.");
  assert(
    interpretiveEntries.every((entry) => entry.interpretation_guidance.trim() || entry.interpretation_caution.trim()),
    "Interpretive fields need guidance or caution."
  );

  const llmEntries = entries.filter((entry) => entry.source_nature === "persisted_llm_interpretation");
  assert(llmEntries.length > 0, "Expected LLM-derived dictionary entries.");
  assert(
    llmEntries.every((entry) => /agent|schema|workflow/i.test(entry.collection_or_generation_method + entry.generating_agent)),
    "LLM-derived fields should identify generating agent/schema/workflow provenance."
  );

  const processEvents = buildProcessEventCodebookEntries();
  assert(processEvents.length > 100, "Expected process-event codebook coverage.");
  assert(processEvents.every((entry) => !hasPlaceholder(entry.trigger)), "Process events should not use placeholder triggers.");

  const internal = buildInternalSchemaAppendixEntries();
  const excluded = buildExcludedPlatformVariableEntries();
  assert(internal.length > 100, "Expected internal schema appendix rows.");
  assert(excluded.length > 30, "Expected excluded platform rows.");
  assert(excluded.some((entry) => entry.field_name === "email"), "Email should be an excluded/platform field.");
  assert(excluded.some((entry) => entry.field_name === "password_hash"), "Password hash should be an excluded/platform field.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        research_variables: entries.length,
        category_count: categories.size,
        timing_variables: timingEntries.length,
        interpretive_variables: interpretiveEntries.length,
        llm_variables: llmEntries.length,
        process_event_types: processEvents.length,
        internal_schema_fields: internal.length,
        excluded_platform_fields: excluded.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
