import {
  analysisReadyColumnsByTable,
  buildAnalysisReadyDictionaryEntries,
  DATA_DICTIONARY_CATEGORIES,
  dictionaryStats,
  prismaFieldClassificationEntries
} from "../src/lib/services/teacher-research-data/dictionary";
import { processEventTypes } from "../src/lib/domain/enums";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const entries = buildAnalysisReadyDictionaryEntries();
  const byKey = new Map(entries.map((entry) => [`${entry.table_name}.${entry.variable_name}`, entry]));

  for (const [table, columns] of Object.entries(analysisReadyColumnsByTable())) {
    for (const column of columns) {
      assert(byKey.has(`${table}.${column}`), `Missing data dictionary entry for ${table}.${column}.`);
    }
  }

  for (const eventType of processEventTypes) {
    assert(
      byKey.has(`process_event_type_inventory.${eventType}`),
      `Missing process-event inventory row for ${eventType}.`
    );
  }

  for (const entry of entries.filter((entry) => entry.export_tier === "research_dataset")) {
    assert(entry.category.trim(), `${entry.table_name}.${entry.variable_name} needs a substantive category.`);
    assert(entry.definition.trim(), `${entry.table_name}.${entry.variable_name} needs a definition.`);
    assert(entry.row_grain.trim(), `${entry.table_name}.${entry.variable_name} needs row grain.`);
    assert(entry.source_type.trim(), `${entry.table_name}.${entry.variable_name} needs source type.`);
    assert(entry.missing_value_meaning.trim(), `${entry.table_name}.${entry.variable_name} needs missingness semantics.`);
    assert(
      entry.collection_or_generation_method.trim(),
      `${entry.table_name}.${entry.variable_name} needs collection/generation method.`
    );
  }

  const categories = new Set(entries.map((entry) => entry.category));
  for (const category of DATA_DICTIONARY_CATEGORIES) {
    assert(categories.has(category), `Missing data-nature dictionary category ${category}.`);
  }
  assert(!categories.has("Quick summary"), "Dictionary category should not be an old export product.");
  assert(!categories.has("Analysis-ready"), "Dictionary category should not be an old export product.");
  assert(!categories.has("Full archive"), "Dictionary category should not be an old export product.");

  const classifications = prismaFieldClassificationEntries();
  assert(classifications.length > 200, "Expected broad Prisma research-field classification coverage.");
  for (const entry of classifications) {
    assert(entry.export_tier, `${entry.table_name}.${entry.variable_name} should be classified by export tier.`);
    assert(entry.privacy_level, `${entry.table_name}.${entry.variable_name} should be classified by privacy.`);
  }

  const secretEntries = classifications.filter((entry) =>
    /password_hash|access_code_hash|token_hash/i.test(entry.variable_name)
  );
  assert(secretEntries.length >= 2, "Expected credential/hash fields in the classified inventory.");
  assert(
    secretEntries.every((entry) => entry.export_tier === "never_exported"),
    "Credential/hash fields must be marked never exported."
  );

  const restrictedEntries = entries.filter((entry) =>
    ["correct_option", "correctness", "distractor_diagnostic_notes", "teacher_llm_media_description"].includes(entry.variable_name)
  );
  assert(restrictedEntries.length >= 4, "Expected restricted answer-key/diagnostic fields in dictionary.");
  assert(
    restrictedEntries.every((entry) =>
      entry.export_tier === "restricted_research_dataset" || entry.privacy_level === "restricted answer-key"
    ),
    "Answer-key and diagnostic-note fields must be restricted."
  );

  const llmEntries = entries.filter((entry) => entry.source_type === "persisted LLM output");
  assert(llmEntries.length > 0, "Expected persisted LLM output entries.");
  assert(
    llmEntries.every((entry) => entry.interpretation_caution.includes("not a stable trait")),
    "Persisted LLM output entries must include interpretation cautions."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        dictionary_stats: dictionaryStats(entries),
        process_event_types_documented: processEventTypes.length,
        prisma_fields_classified: classifications.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
