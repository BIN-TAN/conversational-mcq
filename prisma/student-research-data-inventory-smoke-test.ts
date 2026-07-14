import {
  analysisReadyColumnsByTable,
  buildAnalysisReadyDictionaryEntries,
  buildExcludedPlatformVariableEntries,
  buildInternalSchemaAppendixEntries,
  buildProcessEventCodebookEntries,
  dictionaryStats,
  researchDataDictionarySemanticReport
} from "../src/lib/services/teacher-research-data/dictionary";
import { processEventTypes } from "../src/lib/domain/enums";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main() {
  const entries = buildAnalysisReadyDictionaryEntries();
  const byKey = new Map(entries.map((entry) => [entry.qualified_name, entry]));
  const processEvents = buildProcessEventCodebookEntries();
  const internal = buildInternalSchemaAppendixEntries();
  const excluded = buildExcludedPlatformVariableEntries();

  for (const [table, columns] of Object.entries(analysisReadyColumnsByTable())) {
    for (const column of columns) {
      assert(byKey.has(`${table}.${column}`), `Missing research data dictionary entry for ${table}.${column}.`);
    }
  }

  for (const eventType of processEventTypes) {
    assert(processEvents.some((entry) => entry.event_type === eventType), `Missing process-event codebook row for ${eventType}.`);
  }

  for (const entry of entries) {
    assert(entry.entity_type === "research_variable", `${entry.qualified_name} must be a research variable.`);
    assert(entry.substantive_category.trim(), `${entry.qualified_name} needs a substantive category.`);
    assert(entry.definition.trim(), `${entry.qualified_name} needs a definition.`);
    assert(entry.measurement_level.trim(), `${entry.qualified_name} needs measurement level.`);
    assert(entry.source_nature.trim(), `${entry.qualified_name} needs source nature.`);
    assert(entry.missing_value_meaning.trim(), `${entry.qualified_name} needs missingness semantics.`);
    assert(entry.zero_value_meaning.trim(), `${entry.qualified_name} needs zero semantics.`);
    assert(entry.not_applicable_condition.trim(), `${entry.qualified_name} needs not-applicable semantics.`);
    assert(entry.collection_or_generation_method.trim(), `${entry.qualified_name} needs collection/generation method.`);
  }

  assert(!entries.some((entry) => entry.table_name.startsWith("prisma.")), "Prisma fields must not be research variables.");
  assert(!entries.some((entry) => entry.table_name === "process_event_type_inventory"), "Process event codes must not be research variables.");
  assert(excluded.some((entry) => entry.qualified_name === "prisma.User.email"), "User email should be in excluded inventory.");
  assert(excluded.some((entry) => entry.qualified_name === "prisma.User.password_hash"), "Password hash should be in excluded inventory.");
  assert(
    !entries.some((entry) => ["email", "password_hash", "access_code_hash", "user_id_normalized"].includes(entry.variable_name)),
    "PII/auth fields should be absent from ordinary research variables."
  );

  const restrictedEntries = entries.filter((entry) =>
    ["correct_option", "correctness", "distractor_diagnostic_notes", "teacher_llm_media_description"].includes(entry.variable_name)
  );
  assert(restrictedEntries.length >= 4, "Expected restricted answer-key/diagnostic fields in research dictionary.");
  assert(
    restrictedEntries.every((entry) => entry.export_policy === "restricted_research_dataset_only"),
    "Answer-key and diagnostic-note fields must be restricted."
  );

  const llmEntries = entries.filter((entry) => entry.source_nature === "persisted_llm_interpretation");
  assert(llmEntries.length > 0, "Expected persisted LLM output entries.");
  assert(
    llmEntries.every((entry) => entry.interpretation_caution.includes("not a stable trait")),
    "Persisted LLM output entries must include interpretation cautions."
  );

  const report = researchDataDictionarySemanticReport();
  assert(report.placeholder_research_definitions === 0, "Research dictionary should have no placeholder text.");
  assert(report.placeholder_process_event_definitions === 0, "Process event codebook should have no placeholder text.");
  assert(report.privacy_export_contradictions === 0, "Dictionary should have no privacy/export contradictions.");
  assert(report.pii_fields_in_ordinary_research_export === 0, "Ordinary research variables should not include PII.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        dictionary_stats: dictionaryStats(entries),
        process_event_types_documented: processEvents.length,
        internal_schema_fields: internal.length,
        excluded_platform_fields: excluded.length,
        semantic_report: report,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
