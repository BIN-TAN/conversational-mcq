import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildCoreResearchDictionaryEntries,
  buildProcessEventCodebookEntries,
  dictionaryFilterOptions,
  filterDictionaryEntries
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function main() {
  const client = source("src/components/teacher-data/research-data-exports-client.tsx");
  const route = source("src/app/api/teacher/research-data/dictionary/route.ts");
  const processEvents = buildProcessEventCodebookEntries();
  const processSelection = filterDictionaryEntries(processEvents, {
    category: "item_response_process",
    measurement_level: "process_event:item_scoped",
    process_event_tier: "all",
    deprecated: "false"
  });
  assert(processSelection.length > 0, "Fixture needs process-event rows for the stale-filter regression.");

  const coreResearch = buildCoreResearchDictionaryEntries();
  const researchOptions = dictionaryFilterOptions(coreResearch);
  assert(!researchOptions.categories.includes("agent_or_formative_workflow"), "Research category options must not include process-event groups.");
  assert(!researchOptions.measurement_levels.some((level) => level.startsWith("process_event:")), "Research filter options must not expose process-event measurement levels.");
  assert(coreResearch.every((entry) => entry.entity_type === "research_variable"), "Core research view must contain only research variables.");
  assert(!coreResearch.some((entry) => entry.table_name === "process_event_type_inventory"), "Core research view must not include event-code rows.");

  assert(client.includes("dictionaryEntryType(entry, entityType)"), "Card renderer must dispatch from row entity_type.");
  assert(client.includes("let cancelled = false"), "Dictionary fetch effect should ignore stale responses after section changes.");
  assert(client.includes("documentation_tier: dictionaryEntityType === \"research_variable\" ? \"core_research\""), "Research query should force the core tier.");
  assert(client.includes("process_event_tier: dictionaryEntityType === \"process_event_code\" ? \"core_learning_process\""), "Process-event query should force the core process tier.");
  assert(!client.includes("setDictionaryMeasurementLevelFilter"), "Visible measurement-level filter state should be removed.");
  assert(route.includes("documentation_tier") && route.includes("process_event_tier"), "Dictionary route must normalize tier filters.");

  console.log(JSON.stringify({
    status: "passed",
    stale_process_filter_rows: processSelection.length,
    core_research_rows: coreResearch.length,
    no_openai_call_occurred: true
  }, null, 2));
}

main();
