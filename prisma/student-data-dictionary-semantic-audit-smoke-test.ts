import {
  buildAnalysisReadyDictionaryEntries,
  buildInternalSchemaAppendixEntries,
  buildProcessEventCodebookEntries,
  researchDataDictionarySemanticReport
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main() {
  const researchVariables = buildAnalysisReadyDictionaryEntries();
  const processEvents = buildProcessEventCodebookEntries();
  const internalSchema = buildInternalSchemaAppendixEntries();
  const report = researchDataDictionarySemanticReport();

  assert(researchVariables.length > 250, "Research variables should be present.");
  assert(processEvents.length > 100, "Process event codebook should be present.");
  assert(internalSchema.length > 100, "Internal schema appendix should be present.");
  assert(researchVariables.every((entry) => entry.entity_type === "research_variable"), "Research rows need research entity type.");
  assert(!researchVariables.some((entry) => entry.table_name === "process_event_type_inventory"), "Research variables must not include process-event codes.");
  assert(!researchVariables.some((entry) => entry.qualified_name.startsWith("prisma.")), "Research variables must not include raw Prisma fields.");
  assert(report.placeholder_research_definitions === 0, "No placeholder research definitions should remain.");
  assert(report.placeholder_process_event_definitions === 0, "No placeholder event definitions should remain.");
  assert(report.generic_research_definitions === 0, "No generic row-based research definitions should remain.");
  assert(report.generic_research_methods === 0, "No generic research methods should remain.");
  assert(researchVariables.every((entry) => entry.measurement_level), "Every research variable needs measurement level.");
  assert(researchVariables.every((entry) => entry.qualified_name.includes(".")), "Every research variable needs a qualified name.");
  assert(researchVariables.every((entry) => entry.source_code_reference), "Every research variable needs source-code evidence.");
  assert(researchVariables.every((entry) => entry.semantic_review_status === "source_verified"), "Codex review should be source verification, not domain approval.");
  assert(report.privacy_export_contradictions === 0, "No privacy/export contradiction should remain.");
  assert(report.pii_fields_in_ordinary_research_export === 0, "No ordinary research PII fields should remain.");
  assert(report.undocumented_exported_columns.length === 0, "Every exported column should be documented.");
  assert(report.documented_but_absent_columns.length === 0, "Every documented research variable should exist in an export table.");
  assert(report.formula_reference_issues.length === 0, "Formula references should resolve to exported fields, event codes, or documented payload fields.");
  assert(report.internal_nullable_placeholder_count === 0, "Internal appendix should not use placeholder nullable values.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        report,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
