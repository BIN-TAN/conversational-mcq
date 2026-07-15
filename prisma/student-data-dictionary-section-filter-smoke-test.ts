import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildCoreResearchDictionaryEntries,
  buildExcludedPlatformVariableEntries,
  buildInternalSchemaAppendixEntries,
  buildProcessEventCodebookEntries,
  filterDictionaryEntries
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function assertIncludes(value: string, expected: string, label: string) {
  assert(value.includes(expected), `${label} should include ${expected}.`);
}

function assertNotIncludes(value: string, unexpected: string, label: string) {
  assert(!value.includes(unexpected), `${label} should not include ${unexpected}.`);
}

function main() {
  const client = source("src/components/teacher-data/research-data-exports-client.tsx");
  const coreResearch = buildCoreResearchDictionaryEntries();
  const processEvents = filterDictionaryEntries(buildProcessEventCodebookEntries(), {
    process_event_tier: "core_learning_process",
    deprecated: "false"
  });
  const internalFields = buildInternalSchemaAppendixEntries();
  const excludedFields = buildExcludedPlatformVariableEntries();

  assert(coreResearch.length > 0, "Research-variable section needs fixture rows.");
  assert(processEvents.length > 0, "Learning-process event section needs fixture rows.");
  assert(internalFields.length > 0, "Internal-schema section needs fixture rows.");
  assert(excludedFields.length > 0, "Excluded-field section needs fixture rows.");

  assertIncludes(client, "Search variable name", "Research variable filters");
  assertIncludes(client, "Category", "Research variable filters");
  assertIncludes(client, "Search event name", "Process-event filters");
  assertIncludes(client, "Search field name", "Technical field filters");
  assertIncludes(client, "Page size", "Dictionary filters");

  for (const removedVisibleFilter of [
    "All production methods",
    "How the data are produced",
    "All code groups",
    "All actor/source values",
    "All scopes",
    "All Prisma models",
    "All exclusion categories",
    "All permitted audiences",
    "All export policies",
    "Deprecated status"
  ]) {
    assertNotIncludes(client, removedVisibleFilter, "Visible dictionary filters");
  }
  assertNotIncludes(client, "setDictionaryMeasurementLevelFilter", "Measurement-level filter state");
  assertNotIncludes(client, "setDictionaryDerivationFilter", "Source-nature filter state");
  assertNotIncludes(client, "setDictionaryActorSourceFilter", "Actor/source filter state");
  assertNotIncludes(client, "setDictionaryPermittedAudienceFilter", "Permitted-audience filter state");
  assertNotIncludes(client, "setDictionaryExportPolicyFilter", "Export-policy filter state");

  assertIncludes(client, "setDictionarySearch(\"\");", "Section reset should clear stale search filters.");
  assertIncludes(client, "category: dictionaryEntityType === \"research_variable\" ? dictionaryCategoryFilter : undefined", "Category query should be research-only.");
  assertIncludes(client, "documentation_tier: dictionaryEntityType === \"research_variable\" ? \"core_research\"", "Research section should force core tier.");
  assertIncludes(client, "process_event_tier: dictionaryEntityType === \"process_event_code\" ? \"core_learning_process\"", "Process section should force core tier.");
  assertNotIncludes(client, "actor_or_source:", "Process-event actor/source should not be sent from ordinary UI.");
  assertNotIncludes(client, "permitted_audience:", "Excluded-field permitted audience should not be sent from ordinary UI.");

  console.log(JSON.stringify({
    status: "passed",
    research_rows: coreResearch.length,
    process_event_rows: processEvents.length,
    internal_schema_rows: internalFields.length,
    excluded_field_rows: excludedFields.length,
    no_openai_call_occurred: true
  }, null, 2));
}

main();
