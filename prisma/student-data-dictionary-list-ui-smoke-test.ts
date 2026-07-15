import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildAnalysisReadyDictionaryEntries,
  DATA_DICTIONARY_COLUMNS,
  dataDictionaryCsv,
  PROCESS_EVENT_CODEBOOK_COLUMNS,
  processEventCodebookCsv
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
  const clientSource = source("src/components/teacher-data/research-data-exports-client.tsx");
  const entries = buildAnalysisReadyDictionaryEntries();
  const csv = dataDictionaryCsv(entries);
  const header = csv.split(/\r?\n/, 1)[0] ?? "";
  const eventHeader = processEventCodebookCsv().split(/\r?\n/, 1)[0] ?? "";

  assertIncludes(clientSource, "Data dictionary selected entity list", "Data dictionary UI");
  assertIncludes(clientSource, "Dictionary section", "Data dictionary section filter");
  assertIncludes(clientSource, "Core research variables", "Data dictionary sections");
  assertIncludes(clientSource, "Core learning-process events", "Data dictionary sections");
  assertIncludes(clientSource, "Internal schema appendix", "Data dictionary sections");
  assertIncludes(clientSource, "Platform administration and excluded variables", "Data dictionary sections");
  assertIncludes(clientSource, "Variable", "Research variable cards");
  assertIncludes(clientSource, "Dataset/table", "Research variable cards");
  assertIncludes(clientSource, "Measurement level", "Research variable cards");
  assertIncludes(clientSource, "Type", "Research variable cards");
  assertIncludes(clientSource, "Definition", "Research variable cards");
  assertIncludes(clientSource, "Collection or generation method", "Research variable cards");
  assertIncludes(clientSource, "Source code reference", "Research variable cards");
  assertIncludes(clientSource, "Review status", "Research variable cards");
  assertIncludes(clientSource, "Missing value meaning", "Research variable cards");
  assertIncludes(clientSource, "Zero value meaning", "Research variable cards");
  assertIncludes(clientSource, "Timing semantics", "Timing cards");
  assertIncludes(clientSource, "Trigger", "Process event cards");
  assertIncludes(clientSource, "Exclusion reason", "Excluded field cards");
  assertIncludes(clientSource, "Download core data dictionary CSV", "Data dictionary actions");
  assertIncludes(clientSource, "<details className=\"group rounded-lg", "Collapsed dictionary records");
  assertIncludes(clientSource, "Category guide", "Data dictionary category guide");

  assertNotIncludes(clientSource, "Total variables", "Data dictionary counts");
  assertNotIncludes(clientSource, "Category or code group", "Data dictionary filters");
  assertNotIncludes(clientSource, "View current page JSON", "Data dictionary actions");
  assertNotIncludes(clientSource, "<th className=\"px-3 py-2\">Table</th>", "Data dictionary table");

  for (const column of DATA_DICTIONARY_COLUMNS) {
    assert(header.split(",").includes(column), `Downloaded research dictionary CSV should preserve ${column}.`);
  }
  for (const column of PROCESS_EVENT_CODEBOOK_COLUMNS) {
    assert(eventHeader.split(",").includes(column), `Process event codebook CSV should preserve ${column}.`);
  }

  const interpretiveEntries = entries.filter((entry) =>
    entry.substantive_category === "Diagnostic and interpretation outputs" ||
    entry.source_nature === "persisted_llm_interpretation" ||
    /misconception|engagement|understanding|guessing|profile/i.test(entry.variable_name)
  );
  assert(interpretiveEntries.length > 0, "Expected interpretive dictionary variables.");
  assert(
    interpretiveEntries.some((entry) => entry.interpretation_caution.trim()),
    "At least one interpretive variable should preserve an interpretation caution."
  );
  assert(!/sk-[A-Za-z0-9_-]{20,}/.test(csv), "Data dictionary CSV must not expose API-key shaped values.");
  assert(!/postgres(?:ql)?:\/\//i.test(csv), "Data dictionary CSV must not expose database URLs.");
  assert(!/SESSION_SECRET=.*|OPENAI_API_KEY=.*/i.test(csv), "Data dictionary CSV must not expose secret values.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        research_variables: entries.length,
        visible_layout: "collapsed_entity_disclosures",
        csv_metadata_columns: DATA_DICTIONARY_COLUMNS.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
