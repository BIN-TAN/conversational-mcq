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
  const docs = source("docs/RESEARCH_DATA_FORMAT_DECISIONS.md");
  const exportService = source("src/lib/services/teacher-research-data/analysis-ready-export.ts");

  for (const entity of [
    "sessions.csv",
    "item_responses.csv",
    "process_events.csv",
    "conversation_turns.csv",
    "agent_activity_records.csv",
    "assessment_content.csv",
    "assessment_summary.csv",
    "export_manifest.json",
    "process_event_payloads.jsonl"
  ]) {
    assertIncludes(docs, entity, "Research data format decisions");
  }

  assertIncludes(docs, "Stable scalar data", "Research data format decisions");
  assertIncludes(docs, "Append-only event streams", "Research data format decisions");
  assertIncludes(docs, "JSONL", "Research data format decisions");
  assertIncludes(docs, "deprecated legacy compatibility view", "Research data format decisions");
  assertNotIncludes(docs, "hidden chain of thought", "Research data format decisions");
  assert(!/sk-[A-Za-z0-9_-]{20,}|postgres(?:ql)?:\/\//i.test(docs), "Format documentation must not contain secrets.");

  assertIncludes(exportService, "process_events.csv", "Analysis-ready export service");
  assertIncludes(exportService, "conversation_turns.csv", "Analysis-ready export service");
  assertIncludes(exportService, "research_data_dictionary.csv", "Analysis-ready export service");
  assertIncludes(exportService, "process_event_codebook.csv", "Analysis-ready export service");

  console.log(JSON.stringify({
    status: "passed",
    documented_entities: 9,
    manifest_documented: true,
    no_openai_call_occurred: true
  }, null, 2));
}

main();
