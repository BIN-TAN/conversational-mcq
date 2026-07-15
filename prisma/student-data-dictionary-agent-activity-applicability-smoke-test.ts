import { buildAnalysisReadyDictionaryEntries } from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function row(qualifiedName: string) {
  const entry = buildAnalysisReadyDictionaryEntries().find((candidate) => candidate.qualified_name === qualifiedName);
  assert(entry, `Missing ${qualifiedName}.`);
  return entry;
}

function main() {
  const agentRows = buildAnalysisReadyDictionaryEntries().filter((entry) => entry.table_name === "agent_activity_records");
  assert(agentRows.length > 40, "Expected agent/activity union dictionary rows.");
  assert(agentRows.every((entry) => entry.applicable_record_types), "Every agent/activity row needs applicability.");
  assert(
    agentRows.every((entry) => !/record_type-specific|undefined|heterogeneous agent\/activity attribute/i.test(entry.applicable_record_types + entry.definition)),
    "Agent/activity rows must not use unresolved generic applicability."
  );

  const activityPrompt = row("agent_activity_records.activity_prompt");
  assert(activityPrompt.applicable_record_types.includes("formative_activity"), "activity_prompt should apply to formative_activity.");
  assert(!activityPrompt.applicable_record_types.includes("agent_call"), "activity_prompt should not apply to agent_call.");
  assert(activityPrompt.source_nature === "persisted_llm_interpretation", "activity_prompt should be generated/persisted activity content, not system configuration.");
  assert(activityPrompt.collection_or_generation_method.includes("does not copy raw activity packets"), "activity_prompt should document current null/reserved behavior.");

  assert(row("agent_activity_records.agent_name").applicable_record_types === "agent_call", "agent_name should apply to agent_call.");
  assert(row("agent_activity_records.model").applicable_record_types === "agent_call", "model should apply to agent_call.");
  assert(row("agent_activity_records.prompt_version").applicable_record_types === "agent_call", "prompt_version should apply to agent_call.");
  assert(row("agent_activity_records.formative_value").applicable_record_types === "formative_decision", "formative_value should apply to formative_decision.");
  assert(row("agent_activity_records.evaluation_status").applicable_record_types === "post_activity_evidence; diagnostic_snapshot", "evaluation_status should apply to evidence/snapshot branches.");
  assert(row("agent_activity_records.student_response").applicable_record_types.includes("post_activity_evidence"), "student_response should be reserved for activity evidence/evaluation branches.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        agent_activity_rows: agentRows.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
