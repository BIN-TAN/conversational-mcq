import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import {
  DATA_DICTIONARY_COLUMNS,
  DUPLICATE_VARIABLE_AUDIT_COLUMNS,
  EXCLUDED_PLATFORM_VARIABLE_COLUMNS,
  INTERNAL_SCHEMA_APPENDIX_COLUMNS,
  PROCESS_EVENT_CODEBOOK_COLUMNS,
  RESEARCH_CATEGORY_DICTIONARY_COLUMNS,
  dataDictionaryCsv,
  duplicateVariableAuditCsv,
  excludedPlatformVariablesCsv,
  internalSchemaAppendixCsv,
  processEventCodebookCsv,
  researchCategoryDictionaryCsv,
  researchDataDictionarySemanticReport
} from "../src/lib/services/teacher-research-data/dictionary";

type CsvRow = Record<string, string>;

const artifactDirectory = path.join(process.cwd(), ".data", "research-data-dictionary-artifacts", "latest");
const reportPath = path.join(artifactDirectory, "artifact_verification_report.json");

const requiredResearchColumns = [
  "source_code_reference",
  "source_service_or_function",
  "semantic_review_status",
  "semantic_review_notes",
  "documentation_tier",
  "research_category_id",
  "research_category_display_name",
  "duplicate_relationship",
  "canonical_qualified_name",
  "applicable_record_types"
];

const genericFragments = [
  "value recorded for one row",
  "timestamp associated with one row",
  "counted within one row",
  "measured for one row",
  "serialization path",
  "Calculated by counting matching records or process events",
  "lifecycle timestamp for the",
  "aggregate count for the",
  "timing construct documented for the",
  "measured value for the"
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseCsv(content: string): CsvRow[] {
  return parse(content, { columns: true, skip_empty_lines: true }) as CsvRow[];
}

function csvHeader(content: string) {
  return (content.split(/\r?\n/, 1)[0] ?? "").split(",");
}

function readGeneratedCsv(fileName: string) {
  const filePath = path.join(artifactDirectory, fileName);
  const content = readFileSync(filePath, "utf8");
  return {
    filePath,
    content,
    headers: csvHeader(content),
    rows: parseCsv(content)
  };
}

function requireRow(rows: CsvRow[], key: string, value: string) {
  const row = rows.find((candidate) => candidate[key] === value);
  assert(row, `Missing emitted CSV row where ${key} = ${value}.`);
  return row;
}

function expectValue(row: CsvRow, key: string, expected: string) {
  assert(row[key] === expected, `${row.qualified_name ?? row.event_type ?? row.qualified_name} expected ${key}=${expected}, received ${row[key]}.`);
}

function expectContains(row: CsvRow, key: string, fragment: string) {
  assert(row[key]?.includes(fragment), `${row.qualified_name ?? row.event_type} expected ${key} to include "${fragment}".`);
}

function expectNotContains(row: CsvRow, key: string, fragment: string) {
  assert(!row[key]?.includes(fragment), `${row.qualified_name ?? row.event_type} expected ${key} not to include "${fragment}".`);
}

function verifyRequiredColumns(headers: string[], requiredColumns: readonly string[]) {
  const presence = Object.fromEntries(requiredColumns.map((column) => [column, headers.includes(column)]));
  const missing = Object.entries(presence)
    .filter(([, present]) => !present)
    .map(([column]) => column);
  assert(missing.length === 0, `Missing required artifact columns: ${missing.join(", ")}.`);
  return presence;
}

function verifyResearchRows(rows: CsvRow[]) {
  assert(rows.length === 287, `research_data_dictionary.csv expected 287 rows, received ${rows.length}.`);
  assert(
    rows.every((row) => !genericFragments.some((fragment) => (row.definition + row.collection_or_generation_method).includes(fragment))),
    "research_data_dictionary.csv still contains generic row, timestamp, count, measured-value, or serialization wording."
  );
  assert(rows.every((row) => row.source_code_reference), "Every emitted research row needs source_code_reference.");
  assert(rows.every((row) => row.source_service_or_function), "Every emitted research row needs source_service_or_function.");
  assert(rows.every((row) => row.semantic_review_status === "source_verified"), "Every emitted research row needs source_verified semantic status.");
  assert(rows.every((row) => row.semantic_review_notes), "Every emitted research row needs semantic_review_notes.");
  assert(rows.every((row) => row.applicable_record_types), "Every emitted research row needs applicable_record_types.");

  const selectedOption = requireRow(rows, "qualified_name", "item_responses.selected_option");
  expectValue(selectedOption, "substantive_category", "Item response data");
  expectValue(selectedOption, "documentation_tier", "core_research");
  expectValue(selectedOption, "research_category_display_name", "Item responses and metacognitive reports");
  expectValue(selectedOption, "source_nature", "student_reported");
  expectContains(selectedOption, "definition", "Option label selected by the student");

  const temptingOption = requireRow(rows, "qualified_name", "item_responses.tempting_option");
  expectValue(temptingOption, "substantive_category", "Item response data");
  expectValue(temptingOption, "source_nature", "student_reported");
  expectContains(temptingOption, "definition", "Student-reported alternative option");

  const reasoningPromptedAt = requireRow(rows, "qualified_name", "item_responses.reasoning_prompted_at");
  expectValue(reasoningPromptedAt, "substantive_category", "Timing and interaction data");
  expectValue(reasoningPromptedAt, "source_nature", "timestamp_derived");
  expectContains(reasoningPromptedAt, "definition", "reasoning prompt");

  const confidencePromptedAt = requireRow(rows, "qualified_name", "item_responses.confidence_prompted_at");
  expectValue(confidencePromptedAt, "substantive_category", "Timing and interaction data");
  expectValue(confidencePromptedAt, "source_nature", "timestamp_derived");
  expectContains(confidencePromptedAt, "definition", "confidence prompt");

  const optionRevisionCount = requireRow(rows, "qualified_name", "item_responses.option_revision_count");
  expectValue(optionRevisionCount, "substantive_category", "Item response data");
  expectValue(optionRevisionCount, "source_nature", "aggregate_derived");
  expectContains(optionRevisionCount, "collection_or_generation_method", "answer_changed process events");

  const reasoningRevisionCount = requireRow(rows, "qualified_name", "item_responses.reasoning_revision_count");
  expectValue(reasoningRevisionCount, "substantive_category", "Item response data");
  expectValue(reasoningRevisionCount, "source_nature", "aggregate_derived");
  expectContains(reasoningRevisionCount, "collection_or_generation_method", "reasoning_revised");

  const researchStudentId = requireRow(rows, "qualified_name", "sessions.research_student_id");
  expectValue(researchStudentId, "source_nature", "deterministic_derived");
  expectContains(researchStudentId, "definition", "Pseudonymous student join key");
  expectContains(researchStudentId, "definition", "not the student's login username");
  expectContains(researchStudentId, "collection_or_generation_method", "researchStudentId()");
  expectContains(researchStudentId, "collection_or_generation_method", "HMAC-SHA-256");
  expectContains(researchStudentId, "interpretation_caution", "Pseudonymous, not anonymous");

  const pseudonymVersion = requireRow(rows, "qualified_name", "sessions.research_pseudonym_version");
  expectValue(pseudonymVersion, "source_nature", "system_configuration");
  expectContains(pseudonymVersion, "allowed_values", "hmac_sha256_v1");

  const pseudonymFingerprint = requireRow(rows, "qualified_name", "sessions.pseudonymization_key_fingerprint");
  expectValue(pseudonymFingerprint, "privacy_level", "export_provenance");
  expectContains(pseudonymFingerprint, "definition", "Short one-way fingerprint");

  const correctness = requireRow(rows, "qualified_name", "item_responses.correctness");
  expectValue(correctness, "source_nature", "deterministic_derived");
  expectValue(correctness, "export_policy", "restricted_research_dataset_only");
  expectContains(correctness, "definition", "Restricted deterministic response classification");

  const guessingRisk = requireRow(rows, "qualified_name", "item_responses.estimated_guessing_risk");
  expectValue(guessingRisk, "source_nature", "persisted_llm_interpretation");
  expectContains(guessingRisk, "interpretation_caution", "not confirmed guessing");

  const teacherGuidance = requireRow(rows, "qualified_name", "item_responses.teacher_guidance_considered");
  expectValue(teacherGuidance, "source_nature", "deterministic_derived");
  expectContains(teacherGuidance, "definition", "teacher-authored diagnostic guidance");

  const messageText = requireRow(rows, "qualified_name", "conversation_turns.message_text");
  expectValue(messageText, "source_nature", "mixed_by_actor_type");
  expectContains(messageText, "definition", "Source meaning depends on actor_type");

  const itemResponseTime = requireRow(rows, "qualified_name", "item_responses.item_response_time_ms");
  expectValue(itemResponseTime, "substantive_category", "Timing and interaction data");
  expectValue(itemResponseTime, "timing_start_event", "item_presented_at");
  expectNotContains(itemResponseTime, "calculation_formula", "item_started_at");

  const itemAttemptNumber = requireRow(rows, "qualified_name", "item_responses.attempt_number");
  expectValue(itemAttemptNumber, "measurement_level", "item_response");
  expectContains(itemAttemptNumber, "definition", "Assessment-session attempt number");
  expectContains(itemAttemptNumber, "collection_or_generation_method", "item_responses.csv");

  const timeToFirstAction = requireRow(rows, "qualified_name", "item_responses.time_to_first_action_ms");
  expectValue(timeToFirstAction, "timing_start_event", "item_presented_at");
  expectContains(timeToFirstAction, "calculation_formula", "first_student_action_at minus item_presented_at");
  expectNotContains(timeToFirstAction, "calculation_formula", "item_started_at");

  const pageHiddenCount = requireRow(rows, "qualified_name", "item_responses.page_hidden_count");
  expectValue(pageHiddenCount, "unit", "count");
  expectContains(pageHiddenCount, "calculation_formula", "count of page_hidden");
  expectNotContains(pageHiddenCount, "calculation_formula", "minus");

  const idleRatio = requireRow(rows, "qualified_name", "sessions.idle_ratio");
  expectValue(idleRatio, "unit", "ratio");
  expectValue(idleRatio, "source_nature", "aggregate_derived");
  expectContains(idleRatio, "calculation_formula", "total_idle_time_ms divided by elapsed_session_time_ms");

  const longPauseCount = requireRow(rows, "qualified_name", "sessions.long_pause_count");
  expectValue(longPauseCount, "unit", "count");
  expectContains(longPauseCount, "calculation_formula", "count of long_pause");
  expectNotContains(longPauseCount, "calculation_formula", "duration");

  const activityPrompt = requireRow(rows, "qualified_name", "agent_activity_records.activity_prompt");
  expectValue(activityPrompt, "source_nature", "persisted_llm_interpretation");
  expectContains(activityPrompt, "applicable_record_types", "formative_activity");
  expectNotContains(activityPrompt, "applicable_record_types", "agent_call");
  expectContains(activityPrompt, "collection_or_generation_method", "does not copy raw activity packets");

  const agentInputTokens = requireRow(rows, "qualified_name", "agent_activity_records.input_token_count");
  expectValue(agentInputTokens, "source_nature", "provider_reported_usage_metadata");
  expectContains(agentInputTokens, "collection_or_generation_method", "AgentCall.input_tokens");

  const sessionInputTokens = requireRow(rows, "qualified_name", "sessions.total_input_tokens");
  expectValue(sessionInputTokens, "source_nature", "aggregate_derived");
  expectContains(sessionInputTokens, "definition", "Number of");

  const assessmentSummaryStudent = requireRow(rows, "qualified_name", "assessment_summary.research_student_id");
  expectContains(assessmentSummaryStudent, "definition", "Pseudonymous student join key");
  expectValue(assessmentSummaryStudent, "documentation_tier", "supplementary_research");
  expectValue(assessmentSummaryStudent, "duplicate_relationship", "derived_convenience_copy");
  expectValue(assessmentSummaryStudent, "canonical_qualified_name", "sessions.research_student_id");
}

function verifyProcessEventRows(rows: CsvRow[]) {
  assert(rows.length === 156, `process_event_codebook.csv expected 156 rows, received ${rows.length}.`);
  assert(rows.every((row) => row.source_code_reference), "Every emitted process-event row needs source_code_reference.");
  assert(rows.every((row) => row.source_service_or_function), "Every emitted process-event row needs source_service_or_function.");
  assert(rows.every((row) => row.semantic_review_status === "source_verified"), "Every emitted process-event row needs source_verified semantic status.");

  const agentCallFailed = requireRow(rows, "event_type", "agent_call_failed");
  expectValue(agentCallFailed, "process_event_tier", "operational_system");
  expectContains(agentCallFailed, "trigger", "provider transport");
  expectContains(agentCallFailed, "interpretation_caution", "sanitized agent-call metadata");

  const itemPresented = requireRow(rows, "event_type", "item_presented");
  expectValue(itemPresented, "process_event_tier", "core_learning_process");
  expectContains(itemPresented, "trigger", "item-presentation step");
  expectContains(itemPresented, "timestamp_meaning", "application-side item-presentation acknowledgement");

  const pageHidden = requireRow(rows, "event_type", "page_hidden");
  expectContains(pageHidden, "trigger", "browser visibility API");
  expectContains(pageHidden, "payload_fields", "visibility_duration_ms");
}

function verifyInternalRows(rows: CsvRow[]) {
  assert(rows.length === 281, `internal_schema_appendix.csv expected 281 rows, received ${rows.length}.`);
  assert(rows.every((row) => row.nullable === "true" || row.nullable === "false"), "Internal appendix nullable values must be true/false.");
  assert(!rows.some((row) => row.nullable === "see Prisma schema"), "Internal appendix must not contain placeholder nullable values.");

  const tokenFields = ["input_tokens", "output_tokens", "total_tokens", "token_usage"];
  for (const field of tokenFields) {
    const row = requireRow(rows, "qualified_name", `prisma.AgentCall.${field}`);
    expectValue(row, "privacy_level", "llm_usage_audit_metadata");
    expectContains(row, "internal_purpose", "LLM provider usage");
    expectContains(row, "research_variable_mapping", "agent_activity_records");
  }
  const maxOutputTokens = requireRow(rows, "qualified_name", "prisma.AgentCall.max_output_tokens");
  expectValue(maxOutputTokens, "privacy_level", "llm_usage_audit_metadata");
  expectContains(maxOutputTokens, "internal_purpose", "token-limit");
}

function verifyExcludedRows(rows: CsvRow[]) {
  assert(rows.length === 102, `excluded_platform_variables.csv expected 102 rows, received ${rows.length}.`);
  assert(
    !rows.some((row) => /input_tokens|output_tokens|total_tokens|max_output_tokens|token_usage/.test(row.field_name)),
    "Token usage fields must not be classified as excluded credentials/secrets."
  );
  assert(
    rows.some((row) => row.field_name === "password_hash" && row.exclusion_category === "credential_or_secret"),
    "Password hashes should remain excluded as credentials/secrets."
  );
  const userId = requireRow(rows, "qualified_name", "prisma.User.user_id");
  expectContains(userId, "research_variable_mapping", "sessions.research_student_id");
  expectContains(userId, "exclusion_reason", "research-facing representation");
}

function verifySemanticReport() {
  const report = researchDataDictionarySemanticReport();
  assert(report.research_variable_count === 287, "Semantic report row count mismatch for research variables.");
  assert(report.process_event_type_count === 156, "Semantic report row count mismatch for process events.");
  assert(report.internal_schema_field_count === 281, "Semantic report row count mismatch for internal schema appendix.");
  assert(report.excluded_platform_field_count === 102, "Semantic report row count mismatch for excluded fields.");
  assert(report.generic_research_definitions === 0, "Semantic report found generic research definitions.");
  assert(report.generic_research_methods === 0, "Semantic report found generic research methods.");
  assert(report.formula_reference_issues.length === 0, "Semantic report found formula reference issues.");
  assert(report.count_duration_formula_issues.length === 0, "Semantic report found count/duration formula issues.");
  assert(report.ratio_formula_issues.length === 0, "Semantic report found ratio formula issues.");
  assert(report.process_event_generic_triggers === 0, "Semantic report found generic process-event triggers.");
  assert(report.internal_nullable_placeholder_count === 0, "Semantic report found internal nullable placeholders.");
  assert(report.privacy_export_contradictions === 0, "Semantic report found privacy/export contradictions.");
  assert(report.pii_fields_in_ordinary_research_export === 0, "Semantic report found PII in ordinary research export.");
  assert(report.undocumented_exported_columns.length === 0, "Semantic report found undocumented exported columns.");
  assert(report.documented_but_absent_columns.length === 0, "Semantic report found documented but absent columns.");
  return report;
}

function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  if (existsSync(artifactDirectory)) rmSync(artifactDirectory, { recursive: true, force: true });
  mkdirSync(artifactDirectory, { recursive: true });

  const artifactInputs = [
    {
      fileName: "research_data_dictionary.csv",
      content: dataDictionaryCsv(),
      expectedRowCount: 287,
      expectedColumns: DATA_DICTIONARY_COLUMNS,
      requiredColumns: requiredResearchColumns
    },
    {
      fileName: "process_event_codebook.csv",
      content: processEventCodebookCsv(),
      expectedRowCount: 156,
      expectedColumns: PROCESS_EVENT_CODEBOOK_COLUMNS,
      requiredColumns: ["source_code_reference", "source_service_or_function", "semantic_review_status", "semantic_review_notes"]
    },
    {
      fileName: "internal_schema_appendix.csv",
      content: internalSchemaAppendixCsv(),
      expectedRowCount: 281,
      expectedColumns: INTERNAL_SCHEMA_APPENDIX_COLUMNS,
      requiredColumns: ["nullable", "internal_purpose", "research_variable_mapping", "privacy_level", "export_policy"]
    },
    {
      fileName: "excluded_platform_variables.csv",
      content: excludedPlatformVariablesCsv(),
      expectedRowCount: 102,
      expectedColumns: EXCLUDED_PLATFORM_VARIABLE_COLUMNS,
      requiredColumns: ["research_variable_mapping", "exclusion_category", "exclusion_reason", "permitted_audience", "export_policy"]
    },
    {
      fileName: "research_category_dictionary.csv",
      content: researchCategoryDictionaryCsv(),
      expectedRowCount: 10,
      expectedColumns: RESEARCH_CATEGORY_DICTIONARY_COLUMNS,
      requiredColumns: ["category_id", "display_name", "definition", "inclusion_criteria", "exclusion_criteria", "variable_count"]
    },
    {
      fileName: "duplicate_variable_audit.csv",
      content: duplicateVariableAuditCsv(),
      expectedRowCount: 287,
      expectedColumns: DUPLICATE_VARIABLE_AUDIT_COLUMNS,
      requiredColumns: ["variable_name", "qualified_name", "canonical_qualified_name", "duplicate_relationship", "core_visibility"]
    }
  ];

  for (const artifact of artifactInputs) {
    writeFileSync(path.join(artifactDirectory, artifact.fileName), artifact.content);
  }

  const generated = Object.fromEntries(
    artifactInputs.map((artifact) => [artifact.fileName, readGeneratedCsv(artifact.fileName)])
  ) as Record<string, ReturnType<typeof readGeneratedCsv>>;

  verifyResearchRows(generated["research_data_dictionary.csv"].rows);
  verifyProcessEventRows(generated["process_event_codebook.csv"].rows);
  verifyInternalRows(generated["internal_schema_appendix.csv"].rows);
  verifyExcludedRows(generated["excluded_platform_variables.csv"].rows);
  const semanticReport = verifySemanticReport();

  const artifacts = artifactInputs.map((artifact) => {
    const generatedArtifact = generated[artifact.fileName];
    const requiredColumnPresence = verifyRequiredColumns(generatedArtifact.headers, artifact.requiredColumns);
    assert(
      generatedArtifact.headers.length === artifact.expectedColumns.length,
      `${artifact.fileName} expected ${artifact.expectedColumns.length} columns, received ${generatedArtifact.headers.length}.`
    );
    assert(
      artifact.expectedColumns.every((column, index) => generatedArtifact.headers[index] === column),
      `${artifact.fileName} emitted header order does not match the source column contract.`
    );
    assert(
      generatedArtifact.rows.length === artifact.expectedRowCount,
      `${artifact.fileName} expected ${artifact.expectedRowCount} rows, received ${generatedArtifact.rows.length}.`
    );
    return {
      file_path: generatedArtifact.filePath,
      sha256: sha256(generatedArtifact.content),
      row_count: generatedArtifact.rows.length,
      column_count: generatedArtifact.headers.length,
      required_column_presence: requiredColumnPresence,
      semantic_audit_result: "passed"
    };
  });

  const report = {
    status: "passed",
    generated_at: new Date().toISOString(),
    artifact_directory: artifactDirectory,
    artifacts,
    semantic_audit_result: {
      status: "passed",
      row_counts: {
        research_data_dictionary: semanticReport.research_variable_count,
        process_event_codebook: semanticReport.process_event_type_count,
        internal_schema_appendix: semanticReport.internal_schema_field_count,
        excluded_platform_variables: semanticReport.excluded_platform_field_count,
        research_category_dictionary: 10,
        duplicate_variable_audit: 287
      },
      generic_research_definitions: semanticReport.generic_research_definitions,
      generic_research_methods: semanticReport.generic_research_methods,
      placeholder_research_definitions: semanticReport.placeholder_research_definitions,
      placeholder_process_event_definitions: semanticReport.placeholder_process_event_definitions,
      formula_reference_issues: semanticReport.formula_reference_issues.length,
      count_duration_formula_issues: semanticReport.count_duration_formula_issues.length,
      ratio_formula_issues: semanticReport.ratio_formula_issues.length,
      process_event_generic_triggers: semanticReport.process_event_generic_triggers,
      internal_nullable_placeholder_count: semanticReport.internal_nullable_placeholder_count
    },
    no_openai_call_occurred: true
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
}

main();
