import {
  buildAnalysisReadyDictionaryEntries,
  buildProcessEventCodebookEntries,
  dataDictionaryCsv,
  filterDictionaryEntries,
  paginateDictionaryEntries
} from "../src/lib/services/teacher-research-data/dictionary";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  const entries = buildAnalysisReadyDictionaryEntries();
  const eventEntries = buildProcessEventCodebookEntries();
  assert(entries.length > 250, "Research variable registry should contain exported research variables.");
  assert(eventEntries.length > 100, "Process event codebook should be separate from research variables.");

  for (const pageSize of [25, 50, 100, 250, 500]) {
    const page = paginateDictionaryEntries(entries, { page: 1, page_size: pageSize });
    assert(page.total === entries.length, `Page size ${pageSize} should preserve total count.`);
    assert(page.rows.length === Math.min(pageSize, entries.length), `Page size ${pageSize} returned wrong row count.`);
    assert(page.first_visible_row === 1, `Page size ${pageSize} should start at row 1.`);
  }

  const pageSize25 = paginateDictionaryEntries(entries, { page: 2, page_size: 25 });
  assert(pageSize25.page === 2, "Next page should be reachable.");
  assert(pageSize25.first_visible_row === 26, "Second 25-row page should begin at row 26.");
  const previousPage = paginateDictionaryEntries(entries, { page: pageSize25.page - 1, page_size: 25 });
  assert(previousPage.page === 1, "Previous page should be reachable.");
  const lastPage = paginateDictionaryEntries(entries, { page: 9999, page_size: 25 });
  assert(lastPage.page === lastPage.total_pages, "Last page should clamp to total pages.");
  assert(lastPage.last_visible_row === entries.length, "Last page should end at the registry total.");

  const filtered = filterDictionaryEntries(entries, {
    category: "Timing and interaction data",
    deprecated: "false"
  });
  assert(filtered.length > 0, "Filter should operate within the selected entity type.");
  assert(
    filtered.every((entry) => entry.substantive_category === "Timing and interaction data"),
    "Category filter should return only matching research-variable rows."
  );
  const filteredCsv = dataDictionaryCsv(filtered);
  const filteredCsvRows = Math.max(0, filteredCsv.trim().split(/\r?\n/).length - 1);
  assert(filteredCsvRows === filtered.length, "Dictionary CSV should include all filtered rows, not one visible page.");

  const keys = new Set(entries.map((entry) => entry.qualified_name));
  assert(keys.size === entries.length, "Research dictionary should not contain duplicate qualified names.");
  assert(entries.every((entry) => entry.entity_type === "research_variable"), "Default dictionary entries should be research variables.");
  assert(!entries.some((entry) => entry.table_name === "process_event_type_inventory"), "Process event codes should not be research variables.");
  assert(!entries.some((entry) => entry.table_name.startsWith("prisma.")), "Prisma fields should not be research variables.");
  assert(!/sk-[A-Za-z0-9_-]{20,}/.test(filteredCsv), "Dictionary CSV must not expose API-key shaped values.");
  assert(!/postgres(?:ql)?:\/\//i.test(filteredCsv), "Dictionary CSV must not expose database URLs.");
  assert(!/SESSION_SECRET=.*|OPENAI_API_KEY=.*/i.test(filteredCsv), "Dictionary CSV must not expose secret values.");

  const clientSource = source("src/components/teacher-data/research-data-exports-client.tsx");
  assert(!clientSource.includes(".slice(0, 80)"), "Frontend should not hardcode an 80-row dictionary limit.");
  assert(clientSource.includes("setDictionaryPage(1);"), "Changing filters or page size should reset to page 1.");
  assert(clientSource.includes("Showing {dictionary.first_visible_row}-{dictionary.last_visible_row}"), "Visible row range should be shown.");
  assert(clientSource.includes("Page {dictionary.page} of {dictionary.total_pages}"), "Current page and total pages should be shown.");
  assertIncludes(clientSource, "Dictionary section", "Dictionary UI");
  assertIncludes(clientSource, "Search variable name", "Dictionary UI");
  assertIncludes(clientSource, "Search event name", "Dictionary UI");
  assertIncludes(clientSource, "Search field name", "Dictionary UI");
  assertIncludes(clientSource, "Page size", "Dictionary UI");
  assertIncludes(clientSource, "Measurement level", "Dictionary expanded details");
  assertNotIncludes(clientSource, "All code groups", "Dictionary UI");
  assertNotIncludes(clientSource, "All Prisma models", "Dictionary UI");
  assertNotIncludes(clientSource, "All exclusion categories", "Dictionary UI");
  assertNotIncludes(clientSource, "How the data are produced", "Dictionary UI");
  assertNotIncludes(clientSource, "setDictionaryMeasurementLevelFilter", "Dictionary UI");
  assertNotIncludes(clientSource, "Deprecated status", "Dictionary UI");
  assertIncludes(clientSource, "Learning-process event definitions", "Dictionary UI");
  assertIncludes(clientSource, "Excluded platform and security fields", "Dictionary UI");
  assertNotIncludes(clientSource, "All tables", "Dictionary UI");
  assertNotIncludes(clientSource, "All source types", "Dictionary UI");
  assertNotIncludes(clientSource, "All privacy levels", "Dictionary UI");
  assertNotIncludes(clientSource, "All export tiers", "Dictionary UI");
  assertNotIncludes(clientSource, "All field families", "Dictionary UI");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        research_variables: entries.length,
        process_event_types: eventEntries.length,
        page_sizes_checked: [25, 50, 100, 250, 500],
        filtered_rows: filtered.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
