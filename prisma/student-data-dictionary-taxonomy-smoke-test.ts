import {
  analysisReadyColumnsByTable,
  buildAnalysisReadyDictionaryEntries,
  DATA_DICTIONARY_CATEGORIES
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const entries = buildAnalysisReadyDictionaryEntries();
  const byKey = new Map(entries.map((entry) => [`${entry.table_name}.${entry.variable_name}`, entry]));
  const categories = new Set(entries.map((entry) => entry.category));

  for (const category of DATA_DICTIONARY_CATEGORIES) {
    assert(categories.has(category), `Dictionary should include ${category}.`);
  }
  for (const obsolete of ["Quick summary", "Analysis-ready", "Analysis-ready dataset", "Full archive", "Export tier"]) {
    assert(!categories.has(obsolete), `Primary dictionary categories should not use export product ${obsolete}.`);
  }

  for (const [table, columns] of Object.entries(analysisReadyColumnsByTable())) {
    for (const column of columns) {
      assert(byKey.has(`${table}.${column}`), `Exported field ${table}.${column} lacks dictionary entry.`);
    }
  }

  for (const entry of entries) {
    assert(entry.collection_or_generation_method.trim(), `${entry.table_name}.${entry.variable_name} needs collection method.`);
    assert(
      !["system generated", "derived automatically", "calculated by the platform"].includes(
        entry.collection_or_generation_method.trim().toLowerCase()
      ),
      `${entry.table_name}.${entry.variable_name} has a vague collection method.`
    );
  }

  const timingEntries = entries.filter((entry) => entry.category === "Timing and interaction data" || entry.variable_name.endsWith("_ms"));
  assert(timingEntries.length > 0, "Expected timing dictionary entries.");
  assert(
    timingEntries.every((entry) => {
      if (!entry.variable_name.endsWith("_ms")) return true;
      return Boolean(entry.timing_start_event) === Boolean(entry.timing_end_event);
    }),
    "Timing duration entries should identify both start and end events when a formula is provided."
  );

  const interpretiveEntries = entries.filter((entry) =>
    entry.category === "Diagnostic and interpretation data" ||
    entry.source_type === "persisted LLM output" ||
    /misconception|engagement|understanding|guessing|profile/i.test(entry.variable_name)
  );
  assert(interpretiveEntries.length > 0, "Expected interpretive dictionary entries.");
  assert(
    interpretiveEntries.every((entry) => entry.interpretation_guidance.trim() || entry.interpretation_caution.trim()),
    "Interpretive fields need guidance or caution."
  );

  const llmEntries = entries.filter((entry) => entry.source_type === "persisted LLM output");
  assert(llmEntries.length > 0, "Expected LLM-derived dictionary entries.");
  assert(
    llmEntries.every((entry) => /agent|prompt|schema|workflow/i.test(entry.collection_or_generation_method)),
    "LLM-derived fields should identify generating agent or prompt/schema provenance."
  );

  const securityEntries = entries.filter((entry) => entry.category === "Internal security data");
  assert(securityEntries.length > 0, "Expected internal security dictionary entries.");
  assert(
    securityEntries.every((entry) => entry.export_tier === "never_exported"),
    "Internal security variables must be marked never_exported."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        total_variables: entries.length,
        category_count: categories.size,
        timing_variables: timingEntries.length,
        interpretive_variables: interpretiveEntries.length,
        llm_variables: llmEntries.length,
        internal_security_variables: securityEntries.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
