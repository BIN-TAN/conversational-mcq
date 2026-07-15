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
  const client = source("src/components/teacher-data/research-data-exports-client.tsx");

  assertIncludes(client, "This page documents research fields. Use Research dataset", "Dictionary header");
  assertIncludes(client, "Go to Research dataset", "Dictionary header");
  assertIncludes(client, "Dictionary section", "Dictionary selector");
  assertIncludes(client, "Research documentation", "Dictionary selector optgroup");
  assertIncludes(client, "Technical documentation", "Dictionary selector optgroup");

  for (const description of [
    "Columns and derived measures available in research data exports. Restricted fields require explicit authorization.",
    "Definitions of logged learning-process event types. Actual event occurrences are stored as rows in the process-events dataset.",
    "Developer-facing source-schema and lineage documentation. These internal fields are not ordinary research export columns.",
    "Account, security, credential, infrastructure, and other fields intentionally excluded from ordinary research exports. Values are never shown here."
  ]) {
    assertIncludes(client, description, "Dynamic section explanation");
  }

  for (const label of [
    "Download research variable dictionary CSV",
    "Download learning-process event codebook CSV",
    "Download internal schema appendix CSV",
    "Download excluded-field inventory CSV"
  ]) {
    assertIncludes(client, label, "Contextual dictionary download labels");
  }
  assertIncludes(client, "Download includes all matching records, not only the current page.", "Download helper text");
  assertIncludes(client, "dictionarySectionMeta[dictionaryEntityType].downloadLabel", "Contextual single download implementation");

  for (const removedText of [
    "Advanced data documentation",
    "Download supplementary dictionary CSV",
    "Download full process-event codebook CSV",
    "Download core data dictionary CSV",
    "Core variables currently shown",
    "Selected category",
    "Core / supplementary variables",
    "Operational process events"
  ]) {
    assertNotIncludes(client, removedText, "Simplified dictionary header");
  }

  console.log(JSON.stringify({
    status: "passed",
    advanced_panel_absent: true,
    contextual_downloads_present: true,
    research_dataset_link_present: true,
    no_openai_call_occurred: true
  }, null, 2));
}

main();
