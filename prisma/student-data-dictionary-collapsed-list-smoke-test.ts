import { readFileSync } from "node:fs";
import path from "node:path";
import { buildCoreResearchDictionaryEntries } from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function main() {
  const client = source("src/components/teacher-data/research-data-exports-client.tsx");
  const core = buildCoreResearchDictionaryEntries();

  assert(client.includes("<details className=\"group rounded-lg"), "Dictionary records should render as collapsed details elements.");
  assert(client.includes("<summary className=\"flex cursor-pointer"), "Dictionary records need accessible summaries.");
  assert(!client.includes("<article className=\"rounded-lg border border-line bg-white p-4 shadow-soft\""), "Dictionary records should not render as permanently expanded cards.");
  assert(client.includes("Category guide"), "Core dictionary page should include a category guide.");
  assert(client.includes("Download research variable dictionary CSV"), "Default download action should be labeled as research variable dictionary CSV.");
  assert(!client.includes("Advanced data documentation"), "Advanced documentation panel should be removed from the header.");
  assert(client.includes("key={`${dictionaryQuery.toString()}:${dictionaryEntryKey(entry, index)}`"), "Filtering/pagination/section changes should remount rows collapsed.");
  assert(client.includes("dictionaryEntryKey(entry, index)"), "Dictionary rows need robust unique summary keys.");
  assert(!client.includes("setDictionaryMeasurementLevelFilter"), "Measurement level should not be a visible browsing filter.");
  assert(!client.includes("Download filtered dictionary CSV"), "Default download label should not use the old generic wording.");

  assert(core.every((entry) => entry.qualified_name), "Collapsed summaries need qualified variable names.");
  assert(core.every((entry) => entry.display_name), "Collapsed summaries need display labels.");
  assert(core.every((entry) => entry.research_category_display_name), "Collapsed summaries need category labels.");
  assert(!core.some((entry) => !entry.qualified_name && !entry.variable_name), "No blank variable cards should be possible.");

  console.log(JSON.stringify({
    status: "passed",
    core_rows_checked: core.length,
    collapsed_by_default: true,
    no_openai_call_occurred: true
  }, null, 2));
}

main();
