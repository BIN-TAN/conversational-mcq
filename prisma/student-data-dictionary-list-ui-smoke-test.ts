import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildAnalysisReadyDictionaryEntries,
  DATA_DICTIONARY_COLUMNS,
  dataDictionaryCsv
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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

  assertIncludes(clientSource, "Data dictionary variable list", "Data dictionary UI");
  assertIncludes(clientSource, "Variable", "Data dictionary cards");
  assertIncludes(clientSource, "Category", "Data dictionary cards");
  assertIncludes(clientSource, "Type", "Data dictionary cards");
  assertIncludes(clientSource, "Definition", "Data dictionary cards");
  assertIncludes(clientSource, "Collection or generation method", "Data dictionary cards");
  assertIncludes(clientSource, "Download filtered dictionary CSV", "Data dictionary actions");

  assertNotIncludes(clientSource, "View current page JSON", "Data dictionary actions");
  assertNotIncludes(clientSource, "Definition and method", "Data dictionary cards");
  assertNotIncludes(clientSource, "All tables", "Data dictionary filters");
  assertNotIncludes(clientSource, "All source types", "Data dictionary filters");
  assertNotIncludes(clientSource, "All privacy levels", "Data dictionary filters");
  assertNotIncludes(clientSource, "All export tiers", "Data dictionary filters");
  assertNotIncludes(clientSource, "All field families", "Data dictionary filters");
  assertNotIncludes(clientSource, "<th className=\"px-3 py-2\">Table</th>", "Data dictionary table");
  assertNotIncludes(clientSource, "<th className=\"px-3 py-2\">Source</th>", "Data dictionary table");
  assertNotIncludes(clientSource, "<th className=\"px-3 py-2\">Privacy</th>", "Data dictionary table");
  assertNotIncludes(clientSource, "<th className=\"px-3 py-2\">Export tier</th>", "Data dictionary table");

  for (const column of DATA_DICTIONARY_COLUMNS) {
    assert(header.split(",").includes(column), `Downloaded data dictionary CSV should preserve ${column}.`);
  }

  const interpretiveEntries = entries.filter((entry) =>
    entry.category === "Diagnostic and interpretation data" ||
    entry.source_type === "persisted LLM output" ||
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
        total_variables: entries.length,
        visible_layout: "variable_cards",
        csv_metadata_columns: DATA_DICTIONARY_COLUMNS.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
