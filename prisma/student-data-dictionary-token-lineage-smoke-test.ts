import {
  buildAnalysisReadyDictionaryEntries,
  buildExcludedPlatformVariableEntries,
  buildInternalSchemaAppendixEntries
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function row(qualifiedName: string) {
  const entry = buildAnalysisReadyDictionaryEntries().find((candidate) => candidate.qualified_name === qualifiedName);
  assert(entry, `Missing ${qualifiedName}.`);
  return entry;
}

function main() {
  for (const qualifiedName of [
    "agent_activity_records.input_token_count",
    "agent_activity_records.output_token_count",
    "agent_activity_records.total_token_count"
  ]) {
    const entry = row(qualifiedName);
    assert(entry.source_nature === "provider_reported_usage_metadata", `${qualifiedName} should be provider-reported usage metadata.`);
    assert(entry.collection_or_generation_method.includes("AgentCall."), `${qualifiedName} should name the AgentCall source field.`);
  }

  for (const qualifiedName of [
    "sessions.total_input_tokens",
    "sessions.total_output_tokens",
    "sessions.total_tokens",
    "sessions.agent_call_count",
    "assessment_summary.agent_call_count"
  ]) {
    const entry = row(qualifiedName);
    assert(entry.source_nature === "aggregate_derived", `${qualifiedName} should be aggregate-derived.`);
  }

  const internal = buildInternalSchemaAppendixEntries().filter((entry) =>
    /input_tokens|output_tokens|total_tokens|token_usage|max_output_tokens/.test(entry.field_name)
  );
  assert(internal.length >= 5, "Expected AgentCall token/usage internal lineage rows.");
  assert(
    internal.every((entry) => entry.privacy_level === "llm_usage_audit_metadata"),
    "Token/usage internal rows should be LLM usage/audit metadata."
  );

  const excluded = buildExcludedPlatformVariableEntries();
  assert(
    !excluded.some((entry) => /input_tokens|output_tokens|total_tokens|token_usage|max_output_tokens/.test(entry.field_name)),
    "Safe token scalar fields must not be excluded as secrets."
  );
  assert(
    !internal.some((entry) => /credential|secret/i.test(entry.privacy_level + entry.export_policy)),
    "Token scalar lineage must not be classified as credentials or secrets."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        token_lineage_rows: internal.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
