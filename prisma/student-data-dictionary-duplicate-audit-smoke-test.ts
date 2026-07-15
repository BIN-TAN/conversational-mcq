import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildAnalysisReadyDictionaryEntries,
  buildCoreResearchDictionaryEntries,
  buildDuplicateVariableAuditEntries,
  duplicateVariableAuditCsv
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireAudit(rows: ReturnType<typeof buildDuplicateVariableAuditEntries>, qualifiedName: string) {
  const row = rows.find((entry) => entry.qualified_name === qualifiedName);
  assert(row, `Missing duplicate audit row for ${qualifiedName}.`);
  return row;
}

function main() {
  const entries = buildAnalysisReadyDictionaryEntries();
  const audit = buildDuplicateVariableAuditEntries(entries);
  const outputDir = path.join(process.cwd(), ".data", "research-data-dictionary-artifacts", "latest");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "duplicate_variable_audit.csv"), duplicateVariableAuditCsv(audit));

  const qualifiedNames = new Set(entries.map((entry) => entry.qualified_name));
  assert(qualifiedNames.size === entries.length, "Exact duplicate qualified names are invalid.");

  const repeatedNames = new Set<string>();
  for (const entry of entries) {
    if (entries.filter((candidate) => candidate.variable_name === entry.variable_name).length > 1) {
      repeatedNames.add(entry.variable_name);
    }
  }
  assert(repeatedNames.size > 0, "Fixture should contain repeated unqualified names.");
  for (const row of audit.filter((entry) => repeatedNames.has(entry.variable_name))) {
    assert(row.duplicate_relationship !== "", `${row.qualified_name} needs a duplicate relationship.`);
  }

  const summaryStudent = requireAudit(audit, "assessment_summary.research_student_id");
  assert(summaryStudent.duplicate_relationship === "derived_convenience_copy", "Assessment summary student ID should be a convenience copy.");
  assert(summaryStudent.canonical_qualified_name === "sessions.research_student_id", "Convenience copies need canonical variables.");

  const deprecatedAlias = requireAudit(audit, "sessions.student_id");
  assert(deprecatedAlias.duplicate_relationship === "deprecated_alias", "Legacy student ID should be a deprecated alias.");
  assert(deprecatedAlias.core_visibility === "hidden_by_default_or_advanced", "Deprecated aliases should be hidden by default.");

  assert(!audit.some((row) => row.duplicate_relationship === "semantic_duplicate_error" || row.duplicate_relationship === "exact_duplicate_error"), "Duplicate audit should not contain unresolved duplicate errors.");
  assert(!buildCoreResearchDictionaryEntries(entries).some((entry) => entry.duplicate_relationship === "derived_convenience_copy"), "Core counts must exclude hidden convenience copies.");

  console.log(JSON.stringify({
    status: "passed",
    research_variables: entries.length,
    repeated_unqualified_names: repeatedNames.size,
    audit_rows: audit.length,
    artifact_path: path.join(outputDir, "duplicate_variable_audit.csv"),
    no_openai_call_occurred: true
  }, null, 2));
}

main();
