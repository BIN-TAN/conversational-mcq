import { stringify } from "csv-stringify/sync";
import { processEventTypes } from "@/lib/domain/enums";

export const RESEARCH_DATASET_EXPORT_VERSION = "research-dataset-v1" as const;
export const ANALYSIS_READY_EXPORT_VERSION = RESEARCH_DATASET_EXPORT_VERSION;
export const RESEARCH_DATA_DICTIONARY_VERSION = "research-data-dictionary-v2" as const;
export const RESEARCH_DATA_DICTIONARY_SCHEMA_VERSION = "research-data-dictionary-v3" as const;

export const RESEARCH_DATASET_TABLES = [
  "sessions",
  "item_responses",
  "process_events",
  "conversation_turns",
  "agent_activity_records",
  "assessment_content",
  "assessment_summary"
] as const;

export const ANALYSIS_READY_TABLES = RESEARCH_DATASET_TABLES;

export type AnalysisReadyTableName = (typeof RESEARCH_DATASET_TABLES)[number];

export const SESSIONS_COLUMNS = [
  "research_student_id",
  "student_id",
  "student_public_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "session_public_id",
  "attempt_number",
  "export_run_public_id",
  "export_generated_at",
  "export_schema_version",
  "app_environment",
  "app_commit_sha",
  "database_instance_fingerprint",
  "context_schema_version",
  "assessment_context_hash",
  "assessment_title",
  "assessment_status",
  "folder_week_module",
  "release_at",
  "close_at",
  "session_status",
  "current_phase",
  "started_at",
  "last_activity_at",
  "completed_at",
  "resumed_at",
  "exited_at",
  "actual_initial_item_count",
  "completed_initial_item_count",
  "current_item_index",
  "session_completion_status",
  "session_limitations",
  "active_interaction_time_ms",
  "elapsed_session_time_ms",
  "timing_metric_available",
  "timing_metric_type",
  "total_idle_time_ms",
  "total_page_hidden_ms",
  "idle_ratio",
  "long_pause_count",
  "total_long_pause_ms",
  "maximum_long_pause_ms",
  "item_response_count",
  "process_event_count",
  "conversation_turn_count",
  "agent_call_count",
  "total_input_tokens",
  "total_output_tokens",
  "total_tokens",
  "formative_activity_attempt_count",
  "post_activity_evidence_count",
  "diagnostic_snapshot_count",
  "assessment_specific_understanding_category",
  "engagement_review_category",
  "latest_student_safe_status",
  "evidence_sufficiency",
  "interpretation_limitations",
  "unsupported_correct_response_count",
  "estimated_guessing_risk_max"
] as const;

export const ITEM_RESPONSES_COLUMNS = [
  "session_public_id",
  "research_student_id",
  "student_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "item_public_id",
  "item_snapshot_public_id",
  "item_version",
  "item_order",
  "response_public_id",
  "media_snapshot_public_ids",
  "selected_option",
  "reasoning_text",
  "confidence_rating",
  "tempting_option",
  "tempting_option_reason",
  "insufficient_knowledge_selected",
  "skipped_item",
  "skipped_reasoning",
  "skipped_confidence",
  "response_finalized",
  "submitted_at",
  "revised_at",
  "revision_count",
  "correct_option",
  "correctness",
  "correctness_support_level",
  "unsupported_correct_response",
  "estimated_guessing_risk",
  "answer_selection_evidence_weight",
  "item_presented_at",
  "first_student_action_at",
  "time_to_first_action_ms",
  "first_option_selected_at",
  "time_to_first_option_selection_ms",
  "reasoning_prompted_at",
  "reasoning_started_at",
  "reasoning_submitted_at",
  "reasoning_prompt_to_submission_ms",
  "reasoning_active_time_ms",
  "confidence_prompted_at",
  "confidence_selected_at",
  "confidence_prompt_to_selection_ms",
  "last_student_action_at",
  "item_submitted_at",
  "last_action_to_submission_ms",
  "item_response_time_ms",
  "option_selection_count",
  "option_revision_count",
  "reasoning_submission_count",
  "reasoning_revision_count",
  "confidence_selection_count",
  "confidence_revision_count",
  "navigation_event_count",
  "page_hidden_count",
  "typing_activity_event_count",
  "response_quality_check_count",
  "response_quality_rejection_count",
  "insufficient_knowledge_count",
  "procedural_clarification_count",
  "content_question_count",
  "invalid_help_request_count",
  "reasoning_quality_signal",
  "observed_evidence_summary",
  "misconception_hypothesis",
  "alternative_explanations",
  "evidence_sufficiency",
  "interpretation_limitations",
  "teacher_diagnostic_guidance_available",
  "teacher_guidance_considered",
  "diagnostic_snapshot_before",
  "diagnostic_snapshot_after"
] as const;

export const PROCESS_EVENTS_COLUMNS = [
  "event_public_id",
  "session_public_id",
  "research_student_id",
  "student_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "item_public_id",
  "item_snapshot_public_id",
  "event_sequence_index",
  "event_type",
  "event_category",
  "event_source",
  "phase",
  "occurred_at",
  "created_at",
  "item_position",
  "actual_total_item_count",
  "payload_source",
  "payload_action_status",
  "payload_prompt_type",
  "payload_text_length",
  "payload_selected_option",
  "payload_confidence_rating",
  "payload_no_tempting_option",
  "duration_ms",
  "visibility_duration_ms",
  "pause_duration_ms",
  "limitation_code"
] as const;

export const CONVERSATION_TURNS_COLUMNS = [
  "session_public_id",
  "research_student_id",
  "student_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "item_public_id",
  "turn_index",
  "actor_type",
  "actor_name",
  "phase",
  "context_label",
  "created_at",
  "message_text",
  "response_or_action_latency_ms",
  "response_text_present",
  "turn_status",
  "limitation_code"
] as const;

export const AGENT_ACTIVITY_RECORDS_COLUMNS = [
  "record_type",
  "session_public_id",
  "research_student_id",
  "student_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "item_snapshot_public_id",
  "agent_call_public_id",
  "agent_name",
  "provider",
  "model",
  "status",
  "blocked_reason",
  "started_at",
  "completed_at",
  "retry_count",
  "input_token_count",
  "output_token_count",
  "total_token_count",
  "prompt_version",
  "schema_version",
  "output_validated",
  "repair_attempted",
  "repair_status",
  "context_schema_version",
  "assessment_context_hash",
  "teacher_diagnostic_context_present",
  "interpretation_caution_present",
  "student_evidence_present",
  "context_version_bound",
  "answer_key_internal_only",
  "protected_content_exposed",
  "understanding_category",
  "engagement_category",
  "response_profile",
  "diagnostic_purpose",
  "formative_value",
  "selected_strategy",
  "evidence_sufficiency",
  "uncertainty",
  "limitations",
  "activity_public_id",
  "activity_type",
  "activity_target",
  "activity_prompt",
  "attempt_number",
  "student_response",
  "evaluation_status",
  "misconception_persisted",
  "misconception_weakened",
  "misconception_changed",
  "misconception_resolved",
  "evidence_insufficient",
  "next_action"
] as const;

export const AGENT_AND_ACTIVITY_RECORDS_COLUMNS = AGENT_ACTIVITY_RECORDS_COLUMNS;

export const ASSESSMENT_CONTENT_COLUMNS = [
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "assessment_title",
  "assessment_diagnostic_focus",
  "folder_week_module",
  "item_public_id",
  "item_snapshot_public_id",
  "item_version",
  "item_order",
  "stem",
  "option_a_text",
  "option_b_text",
  "option_c_text",
  "option_d_text",
  "media_public_ids",
  "student_alt_text",
  "teacher_llm_media_description",
  "target_reasoning_note",
  "strong_reasoning_note",
  "distractor_diagnostic_notes",
  "correct_option",
  "snapshot_created_at"
] as const;

export const ASSESSMENT_SUMMARY_COLUMNS = [
  "research_student_id",
  "student_id",
  "student_public_id",
  "assessment_public_id",
  "assessment_title",
  "session_public_id",
  "attempt_number",
  "session_status",
  "completion_status",
  "started_at",
  "completed_at",
  "item_response_count",
  "completed_initial_item_count",
  "process_event_count",
  "conversation_turn_count",
  "agent_call_count",
  "formative_activity_attempt_count",
  "latest_student_safe_status",
  "assessment_specific_understanding_category",
  "engagement_review_category",
  "evidence_sufficiency",
  "elapsed_session_time_ms",
  "active_interaction_time_ms",
  "unsupported_correct_response_count",
  "estimated_guessing_risk_max",
  "summary_limitations"
] as const;

export const DATA_DICTIONARY_COLUMNS = [
  "entity_type",
  "qualified_name",
  "dataset_name",
  "table_name",
  "variable_name",
  "display_name",
  "substantive_category",
  "measurement_level",
  "definition",
  "data_type",
  "unit",
  "allowed_values",
  "nullable",
  "missing_value_meaning",
  "zero_value_meaning",
  "false_value_meaning",
  "not_applicable_condition",
  "data_availability_flag",
  "source_nature",
  "source_table_or_event",
  "collection_or_generation_method",
  "calculation_formula",
  "timing_construct",
  "timing_start_event",
  "timing_end_event",
  "idle_time_handling",
  "page_hidden_handling",
  "aggregation_rule",
  "attempt_policy",
  "version_binding",
  "generating_agent",
  "generating_schema_version",
  "interpretation_guidance",
  "interpretation_caution",
  "privacy_level",
  "audience",
  "export_policy",
  "example_value",
  "deprecated",
  "replacement_variable",
  "notes"
] as const;

export type DataDictionaryEntry = Record<(typeof DATA_DICTIONARY_COLUMNS)[number], string>;

export const PROCESS_EVENT_CODEBOOK_COLUMNS = [
  "entity_type",
  "event_type",
  "event_category",
  "trigger",
  "actor_or_source",
  "measurement_level",
  "session_or_item_scope",
  "timestamp_meaning",
  "payload_fields",
  "derived_variables",
  "directly_recorded",
  "interpretation_guidance",
  "interpretation_caution",
  "deprecated",
  "notes"
] as const;

export type ProcessEventCodebookEntry = Record<(typeof PROCESS_EVENT_CODEBOOK_COLUMNS)[number], string>;

export const INTERNAL_SCHEMA_APPENDIX_COLUMNS = [
  "entity_type",
  "qualified_name",
  "model_name",
  "field_name",
  "database_type",
  "nullable",
  "relation_role",
  "internal_purpose",
  "research_variable_mapping",
  "privacy_level",
  "audience",
  "export_policy",
  "notes"
] as const;

export type InternalSchemaAppendixEntry = Record<(typeof INTERNAL_SCHEMA_APPENDIX_COLUMNS)[number], string>;

export const EXCLUDED_PLATFORM_VARIABLE_COLUMNS = [
  "entity_type",
  "qualified_name",
  "source_table",
  "field_name",
  "exclusion_category",
  "exclusion_reason",
  "permitted_audience",
  "export_policy",
  "notes"
] as const;

export type ExcludedPlatformVariableEntry = Record<(typeof EXCLUDED_PLATFORM_VARIABLE_COLUMNS)[number], string>;

export type DictionaryEntityType =
  | "research_variable"
  | "process_event_code"
  | "internal_schema_field"
  | "excluded_platform_field";

export type DictionaryEntityEntry =
  | DataDictionaryEntry
  | ProcessEventCodebookEntry
  | InternalSchemaAppendixEntry
  | ExcludedPlatformVariableEntry;

const ROW_GRAINS: Record<AnalysisReadyTableName, string> = {
  sessions: "one row per student assessment attempt/session",
  item_responses: "one row per student response to one administered item snapshot",
  process_events: "one row per recorded process event",
  conversation_turns: "one row per visible or research-readable conversation turn",
  agent_activity_records:
    "one row per agent call, workflow decision, formative activity attempt, or diagnostic update record",
  assessment_content: "one row per administered item snapshot",
  assessment_summary: "one row per student-assessment attempt summary"
};

const TABLE_COLUMNS: Record<AnalysisReadyTableName, readonly string[]> = {
  sessions: SESSIONS_COLUMNS,
  item_responses: ITEM_RESPONSES_COLUMNS,
  process_events: PROCESS_EVENTS_COLUMNS,
  conversation_turns: CONVERSATION_TURNS_COLUMNS,
  agent_activity_records: AGENT_ACTIVITY_RECORDS_COLUMNS,
  assessment_content: ASSESSMENT_CONTENT_COLUMNS,
  assessment_summary: ASSESSMENT_SUMMARY_COLUMNS
};

export const DATA_DICTIONARY_PAGE_SIZES = [25, 50, 100, 250, 500] as const;

export const DATA_DICTIONARY_CATEGORIES = [
  "Assessment design and content",
  "Session and participation variables",
  "Item response data",
  "Process event data",
  "Timing and interaction data",
  "Diagnostic and interpretation outputs",
  "Formative activity and follow-up data",
  "Outcome and scoring data",
  "LLM execution and reproducibility data",
  "Export, provenance, and versioning data",
  "Platform administration",
  "Internal security"
] as const;

export type DataDictionaryCategory = (typeof DATA_DICTIONARY_CATEGORIES)[number];

export const DICTIONARY_ENTITY_LABELS: Record<DictionaryEntityType, string> = {
  research_variable: "Research variables",
  process_event_code: "Process event codebook",
  internal_schema_field: "Internal source-schema appendix",
  excluded_platform_field: "Platform administration and excluded variables"
};

const RESTRICTED_COLUMNS = new Set([
  "correct_option",
  "correctness",
  "correctness_support_level",
  "unsupported_correct_response",
  "estimated_guessing_risk",
  "answer_selection_evidence_weight",
  "teacher_llm_media_description",
  "target_reasoning_note",
  "strong_reasoning_note",
  "distractor_diagnostic_notes"
]);

const SENSITIVE_TEXT_COLUMNS = new Set([
  "reasoning_text",
  "tempting_option_reason",
  "message_text",
  "student_response",
  "activity_prompt"
]);

const LLM_INTERPRETIVE_COLUMNS = new Set([
  "assessment_specific_understanding_category",
  "engagement_review_category",
  "latest_student_safe_status",
  "evidence_sufficiency",
  "interpretation_limitations",
  "observed_evidence_summary",
  "misconception_hypothesis",
  "alternative_explanations",
  "diagnostic_snapshot_before",
  "diagnostic_snapshot_after",
  "understanding_category",
  "engagement_category",
  "response_profile",
  "diagnostic_purpose",
  "formative_value",
  "selected_strategy",
  "uncertainty"
]);

function titleize(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function sentenceTitle(name: string) {
  return titleize(name).replace(/\bId\b/g, "ID").replace(/\bLlm\b/g, "LLM");
}

function guessDataType(variable: string) {
  if (variable.endsWith("_at")) return "datetime";
  if (variable.endsWith("_ms")) return "integer";
  if (variable.endsWith("_count") || variable.endsWith("_index") || variable === "attempt_number" || variable === "item_order") return "integer";
  if (variable.endsWith("_pct") || variable.endsWith("_ratio") || variable.endsWith("_proportion")) return "decimal";
  if (
    variable.startsWith("is_") ||
    variable.startsWith("has_") ||
    variable.endsWith("_available") ||
    variable.endsWith("_present") ||
    variable.endsWith("_exposed") ||
    variable.endsWith("_validated") ||
    variable.endsWith("_only") ||
    variable.endsWith("_bound") ||
    variable.endsWith("_finalized") ||
    variable.endsWith("_selected") ||
    variable.endsWith("_changed") ||
    variable.endsWith("_skipped")
  ) {
    return "boolean";
  }
  return "string";
}

function isTimingVariable(variable: string) {
  return (
    variable.endsWith("_ms") ||
    variable.endsWith("_duration") ||
    variable.endsWith("_duration_ms") ||
    variable.endsWith("_latency") ||
    variable.endsWith("_latency_ms") ||
    variable.endsWith("_time") ||
    /elapsed|duration|latency|pause|idle|hidden|typing|time_to|active_interaction|response_time/.test(variable)
  );
}

function sourceNature(variable: string): string {
  if (variable.endsWith("_count")) return "aggregate_derived";
  if (isTimingVariable(variable) || variable.endsWith("_at")) return "timestamp_derived";
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) return "persisted_llm_interpretation";
  if (RESTRICTED_COLUMNS.has(variable)) return "teacher_authored";
  if (variable.includes("diagnostic") || variable.includes("teacher_guidance")) return "teacher_authored";
  if (variable.includes("outcome")) return "externally_imported";
  if (variable.startsWith("export_") || variable.includes("schema_version") || variable.includes("commit") || variable.includes("fingerprint")) {
    return "system_configuration";
  }
  if (/reasoning|confidence|selected_option|tempting_option|student_response|message_text/.test(variable)) return "student_reported";
  return "directly_recorded";
}

function researchPrivacyLevel(variable: string) {
  if (RESTRICTED_COLUMNS.has(variable)) return "restricted_answer_key_or_teacher_diagnostic";
  if (SENSITIVE_TEXT_COLUMNS.has(variable)) return "research_sensitive_text";
  if (variable === "research_student_id" || variable === "student_id" || variable === "student_public_id") return "pseudonymous_research_id";
  if (variable.includes("provider_request") || variable.includes("provider_response")) return "advanced_audit_only";
  return "ordinary_research";
}

function researchExportPolicy(variable: string) {
  if (RESTRICTED_COLUMNS.has(variable)) return "restricted_research_dataset_only";
  if (variable === "student_id" || variable === "student_public_id") return "research_dataset_deprecated_alias";
  return "research_dataset";
}

function categoryFor(table: string, variable: string): DataDictionaryCategory {
  if (isTimingVariable(variable)) return "Timing and interaction data";
  if (LLM_INTERPRETIVE_COLUMNS.has(variable) || /understanding|engagement|profile|misconception|evidence_sufficiency|interpretation|alternative|guessing|uncertainty/i.test(variable)) {
    return "Diagnostic and interpretation outputs";
  }
  if (/formative|activity|followup|revision|transfer|post_activity/i.test(variable)) {
    return "Formative activity and follow-up data";
  }
  if (/correctness|outcome|score|unsupported_correct|completed_initial|session_completion/i.test(variable)) return "Outcome and scoring data";
  if (/export_|schema_version|version|snapshot|hash|commit|fingerprint|context_|source_|provenance/i.test(variable)) {
    return "Export, provenance, and versioning data";
  }
  if (table === "agent_activity_records" || /agent|provider|model|prompt|token|workflow|retry|validated|blocked|repair/i.test(variable)) {
    return "LLM execution and reproducibility data";
  }
  if (table === "assessment_content" || /stem|option|media|diagnostic_focus|teacher_llm|distractor|correct_option|item_|assessment_title/i.test(variable)) {
    return "Assessment design and content";
  }
  if (table === "sessions" || table === "assessment_summary" || /session_status|attempt|phase|started_at|completed_at|resumed_at|current_|completion|participation/i.test(variable)) {
    return "Session and participation variables";
  }
  if (table === "process_events" || /event_|payload_|phase/.test(variable)) return "Process event data";
  if (table === "conversation_turns" || /turn_|message|actor|context_label/.test(variable)) return "Process event data";
  if (table === "item_responses" || /selected_option|reasoning|confidence|tempting|skipped|revision|response_/.test(variable)) {
    return "Item response data";
  }
  return "Session and participation variables";
}

function definition(table: string, variable: string) {
  const overrides: Record<string, string> = {
    research_student_id:
      "Pseudonymous student join key generated for research exports. It is stable inside the export policy and is not the student's login username or email.",
    student_id:
      "Deprecated research-export alias for the pseudonymous student join key. It is not the student's login username in rebuilt research datasets.",
    student_public_id:
      "Deprecated research-export alias for the pseudonymous student join key retained for older analysis scripts.",
    session_public_id: "Public assessment-session identifier used as the primary join key across session-level export files.",
    assessment_snapshot_public_id:
      "Deterministic assessment-session snapshot identifier binding exported rows to the administered content context.",
    item_snapshot_public_id:
      "Deterministic identifier for the item version or item context as administered in this session.",
    selected_option: "Student-selected MCQ option as recorded for the administered item snapshot.",
    reasoning_text: "Student reasoning text stored for the item response. This is research-sensitive text.",
    confidence_rating: "Student-selected confidence rating for the response.",
    tempting_option: "Student-reported tempting alternative option when provided.",
    tempting_option_reason: "Student explanation of why an alternative option was tempting when provided.",
    correct_option: "Restricted item-key field. Export only in explicitly restricted teacher/research contexts.",
    correctness: "Restricted scored response classification. Export only in explicitly restricted teacher/research contexts.",
    message_text: "Visible or research-readable conversation turn text, excluding hidden prompts and raw provider output.",
    event_type: "Allow-listed process-event code recorded for one process event row. Event-code semantics are documented in the process event codebook.",
    provider: "Provider family recorded for an agent call or activity record when a backend LLM or mock provider path is attempted.",
    model: "Model name recorded for an agent call when available.",
    output_validated: "Boolean indicator that the stored agent output passed the applicable schema and safety validation."
  };
  if (overrides[variable]) return overrides[variable];
  const grain = ROW_GRAINS[table as AnalysisReadyTableName] ?? "the documented row";
  if (isTimingVariable(variable)) return `${sentenceTitle(variable)} measured for ${grain}.`;
  if (variable.endsWith("_count")) return `${sentenceTitle(variable)} counted within ${grain}.`;
  if (variable.endsWith("_at")) return `${sentenceTitle(variable)} timestamp associated with ${grain}.`;
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) {
    return `${sentenceTitle(variable)} persisted as an assessment-specific interpretation from validated diagnostic or activity evidence.`;
  }
  if (RESTRICTED_COLUMNS.has(variable)) {
    return `${sentenceTitle(variable)} restricted teacher/research context for interpreting the administered item or response.`;
  }
  return `${sentenceTitle(variable)} value recorded for ${grain}.`;
}

function collectionMethod(table: string, variable: string) {
  const overrides: Record<string, string> = {
    research_student_id:
      "Computed by hashing the student's internal login key with the research export pseudonymization namespace before CSV serialization; raw usernames and emails are not written to ordinary research dataset files.",
    student_id:
      "Filled with the same pseudonymous value as research_student_id for backward compatibility with older analysis scripts.",
    student_public_id:
      "Filled with the same pseudonymous value as research_student_id for backward compatibility with older analysis scripts.",
    selected_option: "Recorded when the student submits or confirms an option selection for the administered item snapshot.",
    reasoning_text: "Recorded from the student's submitted reasoning response for the current item.",
    confidence_rating: "Recorded when the student selects the confidence control for the administered item.",
    tempting_option: "Recorded from the student's submitted tempting-option response when one is provided.",
    tempting_option_reason: "Recorded from the student's explanation of why another option seemed tempting.",
    time_to_first_action_ms:
      "Calculated as the timestamp difference between item presentation or item start and the first qualifying student-action event for the same item.",
    option_revision_count: "Count of valid option changes after the first recorded option selection for one item response.",
    assessment_specific_understanding_category:
      "Persisted output from the assessment-specific profile/evidence integration workflow using response package, item evidence, and process context.",
    engagement_review_category:
      "Persisted evidence-quality review output from the profile integration or engagement evidence workflow; agent and prompt/schema provenance are recorded in adjacent audit fields when available; it is not a motivation or misconduct label.",
    misconception_hypothesis:
      "Generated by the validated profile/activity interpretation agent workflow or teacher-reviewed as a tentative interpretation from response-package evidence. It is inferred, not directly observed.",
    event_type: "Recorded by the frontend, backend, agent, or workflow component that emits the process event; event meanings are maintained in process_event_codebook.csv.",
    provider: "Recorded by the agent execution audit layer when an LLM or mock provider call is attempted.",
    total_token_count: "Recorded from provider usage metadata when available, or left null when unavailable."
  };
  if (overrides[variable]) return overrides[variable];
  if (variable.endsWith("_count")) return `Calculated by counting matching records or process events within ${ROW_GRAINS[table as AnalysisReadyTableName] ?? "the documented row grain"}.`;
  if (isTimingVariable(variable)) return timingMetadata(variable, table).method;
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) {
    return "Generated by a validated LLM-backed or effective-system interpretation workflow from response packages, process evidence, and approved context; generating agent and prompt/schema versions are recorded in agent/workflow audit fields when available; missing values mean no valid output was recorded.";
  }
  if (sourceNature(variable) === "teacher_authored") return "Recorded when a teacher authors or imports assessment/item diagnostic context for the selected assessment or item.";
  if (sourceNature(variable) === "externally_imported") return "Imported through the validated external outcome workflow and linked to the assessment/session scope recorded in the row.";
  if (sourceNature(variable) === "system_configuration") return "Written by the export/runtime service from version, snapshot, or application provenance metadata at export time.";
  return `Read from the ${table} research dataset serialization path for ${ROW_GRAINS[table as AnalysisReadyTableName] ?? "the documented row grain"}.`;
}

function interpretationGuidance(variable: string) {
  if (LLM_INTERPRETIVE_COLUMNS.has(variable) || /misconception|guessing|engagement|understanding|profile/i.test(variable)) {
    return "Use as assessment-context evidence requiring human interpretation; do not treat it as a stable trait or ground truth.";
  }
  if (variable.endsWith("_ms") || /time|latency|duration|pause|idle|hidden|typing/i.test(variable)) {
    return "Use as process context. Short or long timing alone does not prove understanding, guessing, disengagement, cheating, or misconduct.";
  }
  if (/correct_option|correctness/i.test(variable)) return "Restricted scoring/key context for teacher/research analysis only; never show to students during protected phases.";
  if (/password|access_code|hash|secret|cookie|token/i.test(variable)) return "Documented only to prevent export; values must never be exposed.";
  return "Interpret within the documented row grain and alongside adjacent status and limitation fields.";
}

function interpretationCaution(variable: string) {
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) return "LLM-derived interpretive signal; not a directly observed fact, not a stable trait, and not ground truth.";
  if (/misconception|guessing/i.test(variable)) return "Inferred hypothesis; not confirmed misconception or confirmed guessing.";
  if (/engagement/i.test(variable)) return "Evidence-quality signal; not a motivation, effort, cheating, or misconduct label.";
  if (variable.endsWith("_ms") || /latency|duration|pause|idle|hidden|typing/i.test(variable)) {
    return "Timing context may include reading, thinking, idle, connectivity, or device effects.";
  }
  return "";
}

function timingMetadata(variable: string, table: string) {
  const fallback = {
    construct: "timing_timestamp_or_duration",
    start: "documented source timestamp or event payload",
    end: "documented endpoint timestamp or event payload",
    formula: "Endpoint timestamp minus start timestamp when both are available.",
    idle: "Idle time is included unless a paired active-time or idle-adjusted variable says otherwise.",
    hidden: "Page-hidden time is included unless a paired focus-adjusted or visibility-adjusted variable says otherwise.",
    aggregation: variable.endsWith("_count") ? "Counted within the documented row grain." : "",
    method: "Calculated from the recorded timestamps or allow-listed timing payload field named by this variable."
  };
  const overrides: Record<string, Partial<typeof fallback>> = {
    active_interaction_time_ms: {
      construct: "session_active_interaction_time",
      start: "session_started or first recorded active interaction",
      end: "session_completed or last recorded active interaction",
      formula: "elapsed_session_time_ms minus recorded idle intervals when instrumentation is available",
      idle: "Recorded idle intervals are subtracted when available; null means active-time instrumentation was insufficient.",
      hidden: "Page-hidden time may remain unless it was included in recorded idle intervals.",
      method: "Calculated in the export service from session start/end timestamps and recorded idle process-event durations."
    },
    elapsed_session_time_ms: {
      construct: "session_elapsed_time",
      start: "session.started_at or session.created_at",
      end: "session.completed_at, last_activity_at, or updated_at for incomplete sessions",
      formula: "end timestamp minus start timestamp",
      idle: "Includes idle periods.",
      hidden: "Includes page-hidden periods.",
      method: "Calculated at export time from persisted session timestamps."
    },
    total_idle_time_ms: {
      construct: "session_recorded_idle_time",
      start: "long_pause or inactivity_detected event start",
      end: "event payload pause duration endpoint",
      formula: "sum of pause_duration_ms across idle events in the session",
      idle: "This variable is the recorded idle duration.",
      hidden: "Page-hidden intervals are separate unless also logged as idle events."
    },
    total_page_hidden_ms: {
      construct: "session_page_hidden_time",
      start: "page_hidden, page_visibility_hidden, or window_blur event start",
      end: "event payload visibility duration endpoint",
      formula: "sum of visibility_duration_ms across page-hidden events in the session",
      hidden: "This variable is the recorded page-hidden duration."
    },
    maximum_long_pause_ms: {
      construct: "maximum_recorded_pause_duration",
      formula: "maximum pause_duration_ms among long_pause events in the session",
      idle: "Represents the largest recorded pause interval."
    },
    total_long_pause_ms: {
      construct: "session_long_pause_time",
      formula: "sum of pause_duration_ms across long_pause events in the session"
    },
    item_response_time_ms: {
      construct: "item_elapsed_response_time",
      start: "item_started_at",
      end: "item_submitted_at",
      formula: "item_submitted_at minus item_started_at",
      idle: "Includes idle periods unless adjusted by separate active-time fields.",
      hidden: "Includes page-hidden periods unless adjusted by separate focus/visibility fields.",
      method: "Stored on the item response when the item response is finalized."
    },
    time_to_first_action_ms: {
      construct: "item_prompt_to_first_student_action_latency",
      start: "item_started_at",
      end: "first qualifying student action event",
      formula: "first_student_action_at minus item_started_at"
    },
    time_to_first_option_selection_ms: {
      construct: "item_prompt_to_first_option_selection_latency",
      start: "item_started_at",
      end: "first option selection event",
      formula: "first_option_selected_at minus item_started_at"
    },
    reasoning_prompt_to_submission_ms: {
      construct: "reasoning_prompt_to_response_latency",
      start: "reasoning prompt agent message timestamp",
      end: "reasoning submitted event timestamp",
      formula: "reasoning_submitted_at minus reasoning_prompted_at"
    },
    reasoning_active_time_ms: {
      construct: "reasoning_input_active_or_elapsed_time",
      start: "first reasoning input activity event",
      end: "reasoning submission or typing summary endpoint",
      formula: "active_typing_time_ms when available; otherwise reasoning_input_elapsed_time_ms from typing_activity_summary payload",
      idle: "Active typing excludes idle only when the active_typing_time_ms payload is available; otherwise elapsed input time may include pauses.",
      hidden: "Page-hidden handling depends on the frontend typing summary payload."
    },
    confidence_prompt_to_selection_ms: {
      construct: "confidence_prompt_to_selection_latency",
      start: "confidence prompt agent message timestamp",
      end: "confidence selected event timestamp",
      formula: "confidence_selected_at minus confidence_prompted_at"
    },
    last_action_to_submission_ms: {
      construct: "last_student_action_to_item_submission_latency",
      start: "last qualifying student action timestamp",
      end: "item_submitted_at",
      formula: "item_submitted_at minus last_student_action_at"
    },
    response_or_action_latency_ms: {
      construct: "conversation_prompt_to_next_student_turn_latency",
      start: "agent conversation turn timestamp",
      end: "next student conversation turn timestamp",
      formula: "next student turn created_at minus agent turn created_at"
    },
    duration_ms: {
      construct: "process_event_payload_duration",
      start: "process event start indicated by event timestamp or payload",
      end: "process event endpoint indicated by payload duration",
      formula: "duration_ms payload value or pause/visibility duration fallback"
    },
    pause_duration_ms: {
      construct: "recorded_pause_duration",
      start: "pause event start",
      end: "pause event end",
      formula: "pause_duration_ms payload value"
    },
    visibility_duration_ms: {
      construct: "recorded_visibility_or_hidden_duration",
      start: "visibility event start",
      end: "visibility event end",
      formula: "visibility_duration_ms payload value",
      hidden: "This variable directly records page visibility or hidden interval duration."
    },
    latency_ms: {
      construct: "agent_call_latency",
      start: "agent call started_at",
      end: "agent call completed_at",
      formula: "completed_at minus started_at"
    }
  };
  const entry = { ...fallback, ...(overrides[variable] ?? {}) };
  if (variable.endsWith("_at")) {
    return {
      ...entry,
      construct: "event_timestamp",
      start: `${variable} recorded by ${table}`,
      end: "not_applicable_timestamp_value",
      formula: "Timestamp value; not a duration.",
      idle: "Not applicable to timestamp fields.",
      hidden: "Not applicable to timestamp fields.",
      method: "Recorded as the timestamp for the named lifecycle event or persisted record."
    };
  }
  return entry;
}

function measurementLevel(table: string, variable: string) {
  if (table === "sessions" || table === "assessment_summary") return "session";
  if (table === "item_responses") return "item_response";
  if (table === "process_events") return "process_event";
  if (table === "conversation_turns") return "conversation_turn";
  if (table === "agent_activity_records") {
    if (/activity|attempt|post_activity|diagnostic_snapshot/.test(variable)) return "formative_activity";
    return "agent_call";
  }
  if (table === "assessment_content") return variable.startsWith("assessment_") ? "assessment" : "item";
  return "not_applicable";
}

function nullableSemantics(variable: string) {
  if (variable === "research_student_id" || variable.endsWith("_public_id") || variable.startsWith("export_")) return "false";
  return "true";
}

function missingValueMeaning(variable: string) {
  if (variable === "research_student_id" || variable.endsWith("_public_id")) return "Missing value indicates an export construction error for a required join key.";
  if (isTimingVariable(variable)) return "Null means the timing construct was not applicable, the relevant start/end event was absent, or instrumentation was insufficient; consult limitation and availability fields.";
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) return "Null means no validated interpretive output was recorded for this row and scope.";
  if (RESTRICTED_COLUMNS.has(variable)) return "Blank in the default dataset means the restricted field was intentionally omitted; available only in explicitly confirmed restricted exports.";
  return "Null means no valid value was recorded for this row or the construct did not apply at this row grain.";
}

function zeroValueMeaning(variable: string) {
  if (variable.endsWith("_count")) return "Zero means the construct was applicable and observed, but no qualifying records or events occurred.";
  if (isTimingVariable(variable)) return "Zero means the interval was applicable and the recorded start and end were simultaneous or the observed duration was zero.";
  return "Not a numeric count or duration field.";
}

function falseValueMeaning(variable: string) {
  return guessDataType(variable) === "boolean"
    ? "False means the condition was explicitly evaluated and did not hold for this row."
    : "Not a Boolean field.";
}

function notApplicableCondition(table: string, variable: string) {
  if (variable.includes("reasoning")) return "Not applicable when the item or activity did not include a reasoning step.";
  if (variable.includes("confidence")) return "Not applicable when the workflow did not ask for confidence.";
  if (variable.includes("tempting")) return "Not applicable when the tempting-option step was not administered or the student reported no tempting option.";
  if (table === "agent_activity_records" && /token|model|provider/.test(variable)) return "Not applicable to deterministic workflow or activity records that did not call a provider.";
  if (RESTRICTED_COLUMNS.has(variable)) return "Not applicable in ordinary exports without restricted-field confirmation.";
  return "Not applicable when the documented construct is outside the row's phase, source, or workflow path.";
}

function dataAvailabilityFlag(variable: string) {
  if (isTimingVariable(variable)) return "timing_metric_available or limitation_code";
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) return "output_validated, evidence_sufficiency, interpretation_limitations, or status";
  if (RESTRICTED_COLUMNS.has(variable)) return "include_restricted_fields";
  return "adjacent status or limitation fields when available";
}

function allowedValues(variable: string) {
  if (variable === "confidence_rating") return "low; medium; high";
  if (variable === "actor_type") return "student; agent; system; orchestrator; teacher_researcher";
  if (variable === "event_type") return "See process_event_codebook.csv.";
  if (variable === "assessment_specific_understanding_category" || variable === "latest_student_safe_status") {
    return "Mostly understood; Still developing; Needs more work; or validated internal diagnostic categories when exported for research.";
  }
  if (variable === "engagement_review_category" || variable === "engagement_category") return "low_engagement; moderate_engagement; high_engagement; insufficient_evidence; or validated workflow categories";
  if (guessDataType(variable) === "boolean") return "true; false";
  return "";
}

export function analysisReadyColumnsByTable() {
  return TABLE_COLUMNS;
}

export function buildAnalysisReadyDictionaryEntries(): DataDictionaryEntry[] {
  const entries: DataDictionaryEntry[] = [];
  for (const [tableName, columns] of Object.entries(TABLE_COLUMNS)) {
    for (const variable of columns) {
      const timing = timingMetadata(variable, tableName);
      const deprecated = variable === "student_id" || variable === "student_public_id";
      entries.push({
        entity_type: "research_variable",
        qualified_name: `${tableName}.${variable}`,
        dataset_name: tableName,
        table_name: tableName,
        variable_name: variable,
        display_name: titleize(variable),
        substantive_category: categoryFor(tableName, variable),
        measurement_level: measurementLevel(tableName, variable),
        definition: definition(tableName, variable),
        data_type: guessDataType(variable),
        unit: variable.endsWith("_ms")
          ? "milliseconds"
          : variable.endsWith("_count")
            ? "count"
            : variable.endsWith("_ratio")
              ? "ratio"
              : variable.endsWith("_at")
                ? "ISO 8601 UTC timestamp"
                : "",
        allowed_values: allowedValues(variable),
        nullable: nullableSemantics(variable),
        missing_value_meaning: missingValueMeaning(variable),
        zero_value_meaning: zeroValueMeaning(variable),
        false_value_meaning: falseValueMeaning(variable),
        not_applicable_condition: notApplicableCondition(tableName, variable),
        data_availability_flag: dataAvailabilityFlag(variable),
        source_nature: sourceNature(variable),
        source_table_or_event: tableName,
        collection_or_generation_method: collectionMethod(tableName, variable),
        calculation_formula: isTimingVariable(variable) || variable.endsWith("_at") ? timing.formula : "",
        timing_construct: isTimingVariable(variable) || variable.endsWith("_at") ? timing.construct : "",
        timing_start_event: isTimingVariable(variable) || variable.endsWith("_at") ? timing.start : "",
        timing_end_event: isTimingVariable(variable) || variable.endsWith("_at") ? timing.end : "",
        idle_time_handling: isTimingVariable(variable) || variable.endsWith("_at") ? timing.idle : "",
        page_hidden_handling: isTimingVariable(variable) || variable.endsWith("_at") ? timing.hidden : "",
        aggregation_rule: variable.endsWith("_count") ? "Count matching records or events within the documented row grain." : timing.aggregation,
        attempt_policy: "Attempts remain separate by session_public_id and attempt_number.",
        version_binding:
          variable.includes("snapshot") || variable.includes("context") || variable.includes("schema")
            ? "Bound to exported snapshot/context/schema metadata."
            : "",
        generating_agent: LLM_INTERPRETIVE_COLUMNS.has(variable) ? "validated profile, activity, or diagnostic interpretation workflow" : "",
        generating_schema_version: LLM_INTERPRETIVE_COLUMNS.has(variable) ? "recorded in adjacent agent_activity_records schema_version when available" : "",
        interpretation_guidance: interpretationGuidance(variable),
        interpretation_caution: interpretationCaution(variable),
        privacy_level: researchPrivacyLevel(variable),
        audience: RESTRICTED_COLUMNS.has(variable) ? "restricted_researcher" : "teacher; researcher",
        export_policy: researchExportPolicy(variable),
        example_value: "",
        deprecated: deprecated ? "true" : "false",
        replacement_variable: deprecated ? "research_student_id" : "",
        notes: RESTRICTED_COLUMNS.has(variable)
          ? "Excluded from default research dataset exports unless explicitly requested in restricted research mode."
          : deprecated
            ? "Legacy column name retained for backward compatibility; values are pseudonymous and match research_student_id."
          : ""
      });
    }
  }

  return entries.sort((left, right) =>
    left.qualified_name.localeCompare(right.qualified_name)
  );
}

const RESEARCH_RELEVANT_MODEL_FIELDS: Record<string, readonly string[]> = {
  User: [
    "id", "user_id", "user_id_normalized", "display_name", "email", "email_normalized", "email_verified_at",
    "pending_email", "pending_email_normalized", "email_change_requested_at", "role", "password_hash",
    "access_code_hash", "account_status", "auth_version", "must_change_password", "deactivated_at",
    "credential_updated_at", "credential_reset_at", "password_changed_at", "last_login_at",
    "created_by_teacher_user_id", "created_at", "updated_at"
  ],
  Assessment: [
    "id", "assessment_public_id", "title", "description", "diagnostic_focus", "folder_label",
    "folder_order_index", "assessment_order_index", "status", "workflow_mode", "response_collection_mode",
    "release_at", "close_at", "created_by_user_db_id", "created_at", "updated_at"
  ],
  ConceptUnit: [
    "id", "concept_unit_public_id", "assessment_db_id", "title", "learning_objective",
    "related_concept_description", "administration_rules", "order_index", "status", "version",
    "latest_item_verification_run_db_id", "created_at", "updated_at"
  ],
  Item: [
    "id", "item_public_id", "concept_unit_db_id", "item_order", "item_stem", "options", "correct_option",
    "distractor_rationales", "expected_reasoning_patterns", "possible_misconception_indicators",
    "administration_rules", "included_in_published_set", "status", "version", "created_at", "updated_at"
  ],
  ItemMediaAsset: [
    "id", "media_public_id", "item_db_id", "option_label", "placement", "media_type", "source_type",
    "storage_key", "public_or_signed_url", "external_url", "title", "alt_text_or_description",
    "student_alt_text", "teacher_llm_media_description", "caption", "transcript_or_content_summary",
    "source_attribution", "media_context_hash", "order_index", "active", "media_version", "created_at", "updated_at"
  ],
  AssessmentSession: [
    "id", "session_public_id", "user_db_id", "assessment_db_id", "attempt_number", "status", "current_phase",
    "workflow_mode_snapshot", "response_collection_mode_snapshot", "current_concept_unit_db_id", "resume_phase",
    "resume_context", "needs_review", "needs_review_reason", "automation_paused_at", "automation_exception_reason",
    "started_at", "last_activity_at", "completed_at", "created_at", "updated_at"
  ],
  ConceptUnitSession: [
    "id", "assessment_session_db_id", "concept_unit_db_id", "status", "initial_started_at", "initial_completed_at",
    "followup_started_at", "followup_completed_at", "followup_status", "followup_round_count",
    "latest_student_profile_db_id", "latest_formative_decision_db_id", "created_at", "updated_at"
  ],
  ItemResponse: [
    "id", "concept_unit_session_db_id", "item_db_id", "selected_option", "correct_option_snapshot", "correctness",
    "reasoning_text", "confidence_rating", "item_response_time_ms", "item_started_at", "item_submitted_at",
    "skipped_reasoning", "skipped_confidence", "skipped_item", "revision_count",
    "missing_evidence_repair_offered", "item_version_snapshot", "item_snapshot", "client_submission_id",
    "created_at", "updated_at"
  ],
  ConversationTurn: [
    "id", "assessment_session_db_id", "concept_unit_session_db_id", "item_db_id", "followup_round_db_id",
    "phase", "actor_type", "agent_name", "message_text", "structured_payload", "created_at"
  ],
  ProcessEvent: [
    "id", "assessment_session_db_id", "concept_unit_session_db_id", "item_db_id", "event_type",
    "event_category", "event_source", "visibility_duration_ms", "pause_duration_ms", "payload", "occurred_at", "created_at"
  ],
  WorkflowJob: [
    "id", "job_public_id", "job_type", "status", "assessment_session_db_id", "concept_unit_session_db_id",
    "idempotency_key", "payload", "attempt_count", "max_attempts", "run_after", "locked_at", "locked_by",
    "last_error_category", "last_error_message", "created_at", "updated_at", "completed_at"
  ],
  AgentCall: [
    "id", "assessment_session_db_id", "concept_unit_session_db_id", "followup_round_db_id", "agent_name",
    "agent_version", "model_name", "provider", "provider_response_id", "provider_request_id", "client_request_id",
    "agent_invocation_key", "prompt_hash", "temperature", "reasoning_effort", "verbosity", "max_output_tokens",
    "prompt_version", "schema_version", "input_payload", "raw_output", "output_payload", "output_validated",
    "validation_error", "refusal_text", "incomplete_reason", "error_category", "blocked_reason",
    "usage_guard_snapshot", "live_call_allowed", "usage_window_start", "usage_window_end", "retry_count",
    "call_status", "latency_ms", "input_tokens", "output_tokens", "total_tokens", "token_usage",
    "estimated_cost", "started_at", "completed_at", "created_at", "updated_at"
  ],
  ActivityRuntimeAttempt: [
    "id", "activity_attempt_public_id", "session_public_id", "student_public_id", "assessment_public_id",
    "concept_unit_id", "source_activity_packet_ref", "activity_family", "diagnostic_purpose", "generation_source",
    "first_turn_agent_call_db_id", "reviewer_agent_call_db_id", "repair_agent_call_db_id", "status", "started_at",
    "completed_at", "latest_activity_response_reference", "latest_evidence_record_public_id", "latest_snapshot_public_id",
    "limitations", "created_at", "updated_at"
  ],
  ActivityMisconceptionEvidenceRecord: [
    "id", "evidence_public_id", "session_public_id", "student_public_id", "assessment_public_id", "concept_unit_id",
    "activity_attempt_id", "source_activity_packet_ref", "source_evaluator_agent_call_db_id", "schema_version",
    "evaluation_source", "review_only", "runtime_servable_to_student", "production_mode", "diagnostic_purpose",
    "activity_family", "student_response_kind", "evidence_elicited_types", "misconception_update_status",
    "evidence_quality", "recommended_next_diagnostic_purpose", "student_safe_feedback", "safety_flags",
    "limitations", "evidence_packet", "evidence_hash", "created_at"
  ],
  PostActivityDiagnosticSnapshot: [
    "id", "snapshot_public_id", "evidence_record_db_id", "session_public_id", "student_public_id",
    "assessment_public_id", "concept_unit_id", "activity_attempt_id", "pre_activity_diagnostic_state",
    "activity_update_status", "post_activity_diagnostic_state", "update_strength", "evidence_quality",
    "next_diagnostic_purpose", "student_safe_feedback", "limitations", "snapshot_payload", "created_at"
  ],
  ResponsePackage: ["id", "concept_unit_session_db_id", "package_type", "payload", "created_at"],
  StudentProfile: [
    "id", "concept_unit_session_db_id", "profile_type", "ability_profile", "ability_pattern_flags",
    "engagement_profile", "engagement_pattern_flags", "integrated_diagnostic_profile",
    "integrated_profile_confidence", "integrated_profile_rationale", "evidence_sufficiency",
    "confidence_alignment", "independence_interpretability", "misconception_indicators",
    "item_level_evidence", "reasoning_quality_summary", "engagement_summary", "process_interpretation_cautions",
    "profile_confidence", "rationale", "recommended_next_evidence", "based_on_agent_call_db_id", "created_at"
  ],
  FormativeDecision: [
    "id", "concept_unit_session_db_id", "student_profile_db_id", "formative_value", "formative_action_plan",
    "target_evidence", "success_criteria", "followup_prompt_constraints", "profile_update_triggers",
    "rationale", "mapping_followed", "mapping_deviation_reason", "based_on_agent_call_db_id", "created_at"
  ],
  FollowupRound: [
    "id", "concept_unit_session_db_id", "round_index", "formative_decision_db_id", "status",
    "evidence_trigger_type", "started_at", "completed_at", "updated_student_profile_db_id", "created_at", "updated_at"
  ],
  ExportJob: [
    "id", "export_public_id", "requested_by_user_db_id", "status", "file_name", "storage_key", "row_count",
    "options", "export_schema_version", "created_at", "completed_at", "expires_at", "error_message"
  ],
  SummativeOutcome: [
    "id", "outcome_public_id", "user_db_id", "user_id_snapshot", "outcome_name", "outcome_score", "max_score",
    "assessment_date", "notes", "uploaded_by_user_db_id", "import_batch_db_id", "source_row_number",
    "record_status", "revision_number", "supersedes_outcome_db_id", "created_at", "updated_at"
  ]
};

function prismaFieldExportPolicy(field: string) {
  if (/password|access_code|token_hash|session|cookie|secret|database_url/i.test(field)) {
    return "never_exported";
  }
  if (/^id$|_db_id$|hash$|_hash$|raw_output|input_payload|raw_provider|prompt_hash/i.test(field)) {
    return "advanced_archive_only";
  }
  if (/correct_option|correctness|distractor|misconception|diagnostic_focus|teacher_llm/i.test(field)) {
    return "restricted_research_or_advanced_audit_only";
  }
  return "internal_schema_appendix_only";
}

function prismaFieldPrivacy(field: string) {
  if (/password|access_code|token_hash|session|cookie|secret|database_url/i.test(field)) {
    return "secret, never exported";
  }
  if (/^id$|_db_id$|hash$|_hash$|raw_output|input_payload|output_payload|provider_request|provider_response/i.test(field)) {
    return "internal audit only";
  }
  if (/correct_option|correctness|distractor|teacher_llm/i.test(field)) return "restricted answer-key";
  if (/email|user_id|student_public_id/i.test(field)) return "PII";
  if (/reasoning|message|rationale|notes|payload/i.test(field)) return "research-sensitive";
  return "ordinary teacher data";
}

function isExcludedPrismaField(modelName: string, field: string) {
  return (
    modelName === "User" ||
    /password|access_code|token|secret|cookie|database_url|email|user_id|auth_version|credential|created_by_teacher_user_id/i.test(field) ||
    /^id$|_db_id$|raw_output|input_payload|output_payload|provider_request|provider_response|prompt_hash|lease|locked_by|storage_key|public_or_signed_url|external_url/i.test(field)
  );
}

function exclusionCategory(modelName: string, field: string) {
  if (/password|access_code|token|secret|cookie|database_url/i.test(field)) return "credential_or_secret";
  if (/email|user_id|display_name|last_login|created_by_teacher_user_id/i.test(field) || modelName === "User") return "account_pii_or_administration";
  if (/^id$|_db_id$/.test(field)) return "internal_database_identifier";
  if (/raw_output|input_payload|output_payload|provider_request|provider_response|prompt_hash/i.test(field)) return "raw_provider_or_prompt_audit";
  if (/lease|locked_by|storage_key|public_or_signed_url|external_url/i.test(field)) return "platform_operations_metadata";
  return "not_in_ordinary_research_dataset";
}

function exclusionReason(modelName: string, field: string) {
  const category = exclusionCategory(modelName, field);
  if (category === "credential_or_secret") return "Credential, token, hash, or secret field. Values are never exported.";
  if (category === "account_pii_or_administration") return "Account administration or personally identifying information, not an assessment research construct.";
  if (category === "internal_database_identifier") return "Internal database identifier. Public IDs or research_student_id are used for research joins instead.";
  if (category === "raw_provider_or_prompt_audit") return "Raw prompt/provider audit material may contain sensitive context and is not part of ordinary analysis exports.";
  if (category === "platform_operations_metadata") return "Operational storage or worker-coordination metadata, not student assessment evidence.";
  return "Excluded from ordinary research exports because it is not needed for teacher/research analysis.";
}

function schemaFieldPurpose(modelName: string, field: string) {
  if (/correct_option|correctness|distractor|teacher_llm/i.test(field)) return "Restricted item-key or teacher-authored diagnostic context used for authorized audit and item review.";
  if (/profile|formative|diagnostic|evidence|misconception|activity/i.test(field)) return "Source field for diagnostic, formative activity, or post-activity evidence lineage.";
  if (/event|payload|message|reasoning|response/i.test(field)) return "Source field for process, transcript, or response evidence lineage.";
  if (/status|phase|started_at|completed_at|created_at|updated_at|attempt/i.test(field)) return "Source field for lifecycle, timing, or attempt-state lineage.";
  return "Internal implementation field documented for reproducibility and data-lineage review.";
}

function mappedResearchVariable(modelName: string, field: string) {
  const fieldOnly = field.replace(/_snapshot$/, "");
  const match = buildAnalysisReadyDictionaryEntries().find((entry) => entry.variable_name === fieldOnly || entry.variable_name === field);
  if (match) return match.qualified_name;
  if (modelName === "ProcessEvent" && field === "event_type") return "process_events.event_type; process_event_codebook.event_type";
  return "";
}

export function buildInternalSchemaAppendixEntries(): InternalSchemaAppendixEntry[] {
  return Object.entries(RESEARCH_RELEVANT_MODEL_FIELDS)
    .flatMap(([modelName, fields]) =>
      fields
        .filter((field) => !isExcludedPrismaField(modelName, field))
        .map((field) => ({
          entity_type: "internal_schema_field",
          qualified_name: `prisma.${modelName}.${field}`,
          model_name: modelName,
          field_name: field,
          database_type: guessDataType(field),
          nullable: "see Prisma schema",
          relation_role: /^id$|_db_id$/.test(field) ? "database relation or primary-key field" : "",
          internal_purpose: schemaFieldPurpose(modelName, field),
          research_variable_mapping: mappedResearchVariable(modelName, field),
          privacy_level: prismaFieldPrivacy(field),
          audience: "developer_internal; operator",
          export_policy: prismaFieldExportPolicy(field),
          notes: "Appendix row for data lineage; not counted as a research dataset variable."
        }))
    )
    .sort((left, right) => left.qualified_name.localeCompare(right.qualified_name));
}

export function buildExcludedPlatformVariableEntries(): ExcludedPlatformVariableEntry[] {
  return Object.entries(RESEARCH_RELEVANT_MODEL_FIELDS)
    .flatMap(([modelName, fields]) =>
      fields
        .filter((field) => isExcludedPrismaField(modelName, field))
        .map((field) => ({
          entity_type: "excluded_platform_field",
          qualified_name: `prisma.${modelName}.${field}`,
          source_table: `prisma.${modelName}`,
          field_name: field,
          exclusion_category: exclusionCategory(modelName, field),
          exclusion_reason: exclusionReason(modelName, field),
          permitted_audience: /password|access_code|token|secret|cookie|database_url/i.test(field)
            ? "never_exposed"
            : "operator_or_developer_internal",
          export_policy: /password|access_code|token|secret|cookie|database_url/i.test(field)
            ? "never_exported"
            : "excluded_from_ordinary_research_dataset",
          notes: "No field values are exposed in this inventory."
        }))
    )
    .sort((left, right) => left.qualified_name.localeCompare(right.qualified_name));
}

export function prismaFieldClassificationEntries() {
  return [...buildInternalSchemaAppendixEntries(), ...buildExcludedPlatformVariableEntries()];
}

function eventCategory(eventType: string) {
  if (/session|assessment|package|completion|resume|exit|start/.test(eventType)) return "session_lifecycle";
  if (/item|option|answer|reasoning|confidence|tempting|idk|clarification|help/.test(eventType)) return "item_response_process";
  if (/page|window|focus|blur|visibility|pause|typing|navigation/.test(eventType)) return "interaction_instrumentation";
  if (/llm|agent|profile|formative|activity|feedback|followup|revision|transfer|workflow/.test(eventType)) return "agent_or_formative_workflow";
  return "platform_process";
}

function eventActor(eventType: string) {
  if (/option|answer|reasoning|confidence|tempting|idk|clarification|help|typing|page|window|focus|blur|navigation/.test(eventType)) return "student_browser_or_student_action";
  if (/agent|llm|profile|formative|activity|feedback|followup|workflow/.test(eventType)) return "backend_agent_or_workflow_service";
  return "application_backend";
}

function eventScope(eventType: string) {
  if (/item|option|answer|reasoning|confidence|tempting|transfer/.test(eventType)) return "one session and one administered item when item_public_id is present";
  if (/activity|followup|feedback|revision/.test(eventType)) return "one session and one formative activity or follow-up phase when applicable";
  return "one assessment session";
}

function eventTrigger(eventType: string) {
  const triggers: Record<string, string> = {
    item_presented:
      "Recorded after the student-facing item stem and option set are rendered or acknowledged as shown for the administered item snapshot.",
    option_clicked: "Recorded when the student selects an answer option in the chat-native item administration UI.",
    answer_changed: "Recorded when a student revises an already recorded answer before package continuation.",
    reasoning_submitted: "Recorded when the student submits reasoning text for the current item.",
    confidence_clicked: "Recorded when the student selects a confidence option for the current item.",
    tempting_option_submitted: "Recorded when the student reports whether another option was tempting.",
    package_submitted: "Recorded when the completed initial response package is sent into the package-analysis workflow.",
    typing_activity_summary: "Recorded when the browser sends summarized typing-timing instrumentation without raw keystrokes or text."
  };
  if (triggers[eventType]) return triggers[eventType];
  if (/session_started/.test(eventType)) return "Recorded when a student assessment session is created or first opened.";
  if (/session_completed/.test(eventType)) return "Recorded when the application marks the assessment session complete.";
  if (/agent_message|message_shown/.test(eventType)) return "Recorded when a student-visible agent message is created or acknowledged as shown.";
  if (/profile|llm|agent/.test(eventType)) return "Recorded when the backend agent or LLM workflow reaches the named lifecycle step.";
  if (/activity|followup|feedback|revision/.test(eventType)) return "Recorded when the formative activity, follow-up, feedback, or revision workflow reaches the named step.";
  if (/page|window|focus|blur|visibility|pause|typing|navigation/.test(eventType)) return "Recorded from allow-listed browser process instrumentation for visibility, navigation, typing, or pause context.";
  return `Recorded when the platform emits the ${eventType} workflow event at the relevant session or item scope.`;
}

function eventPayloadFields(eventType: string) {
  const fields = ["source", "action_status", "status", "phase"];
  if (/item|option|answer/.test(eventType)) fields.push("selected_option", "item_public_id");
  if (/reasoning|message|typing/.test(eventType)) fields.push("text_length", "reasoning_length", "active_typing_time_ms", "reasoning_input_elapsed_time_ms");
  if (/confidence/.test(eventType)) fields.push("confidence_rating");
  if (/tempting/.test(eventType)) fields.push("no_tempting_option", "tempting_option");
  if (/pause|visibility|hidden|blur|focus/.test(eventType)) fields.push("duration_ms", "pause_duration_ms", "visibility_duration_ms");
  return [...new Set(fields)].join("; ");
}

export function buildProcessEventCodebookEntries(): ProcessEventCodebookEntry[] {
  return processEventTypes
    .map((eventType) => ({
      entity_type: "process_event_code",
      event_type: eventType,
      event_category: eventCategory(eventType),
      trigger: eventTrigger(eventType),
      actor_or_source: eventActor(eventType),
      measurement_level: eventScope(eventType).includes("item") ? "process_event:item_scoped" : "process_event:session_scoped",
      session_or_item_scope: eventScope(eventType),
      timestamp_meaning:
        "occurred_at records when the application or browser observed the event; created_at records when the row was persisted.",
      payload_fields: eventPayloadFields(eventType),
      derived_variables:
        "May contribute to process_events flattened payload columns, item response counts, timing summaries, engagement signals, and data-completeness checks.",
      directly_recorded: "true",
      interpretation_guidance:
        "Use as process context at the documented scope and alongside adjacent payload/status fields.",
      interpretation_caution:
        "Event presence, absence, or timing alone does not prove understanding, effort, motivation, cheating, or misconduct.",
      deprecated: "false",
      notes: ""
    }))
    .sort((left, right) => left.event_type.localeCompare(right.event_type));
}

function csvSafe(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function dataDictionaryCsv(entries = buildAnalysisReadyDictionaryEntries()) {
  return stringify(
    entries.map((entry) =>
      Object.fromEntries(DATA_DICTIONARY_COLUMNS.map((column) => [column, csvSafe(entry[column])]))
    ),
    { header: true, columns: [...DATA_DICTIONARY_COLUMNS] }
  );
}

export function processEventCodebookCsv(entries = buildProcessEventCodebookEntries()) {
  return stringify(
    entries.map((entry) =>
      Object.fromEntries(PROCESS_EVENT_CODEBOOK_COLUMNS.map((column) => [column, csvSafe(entry[column])]))
    ),
    { header: true, columns: [...PROCESS_EVENT_CODEBOOK_COLUMNS] }
  );
}

export function internalSchemaAppendixCsv(entries = buildInternalSchemaAppendixEntries()) {
  return stringify(
    entries.map((entry) =>
      Object.fromEntries(INTERNAL_SCHEMA_APPENDIX_COLUMNS.map((column) => [column, csvSafe(entry[column])]))
    ),
    { header: true, columns: [...INTERNAL_SCHEMA_APPENDIX_COLUMNS] }
  );
}

export function excludedPlatformVariablesCsv(entries = buildExcludedPlatformVariableEntries()) {
  return stringify(
    entries.map((entry) =>
      Object.fromEntries(EXCLUDED_PLATFORM_VARIABLE_COLUMNS.map((column) => [column, csvSafe(entry[column])]))
    ),
    { header: true, columns: [...EXCLUDED_PLATFORM_VARIABLE_COLUMNS] }
  );
}

export function dictionaryEntityColumns(entityType: DictionaryEntityType) {
  switch (entityType) {
    case "process_event_code":
      return PROCESS_EVENT_CODEBOOK_COLUMNS;
    case "internal_schema_field":
      return INTERNAL_SCHEMA_APPENDIX_COLUMNS;
    case "excluded_platform_field":
      return EXCLUDED_PLATFORM_VARIABLE_COLUMNS;
    case "research_variable":
    default:
      return DATA_DICTIONARY_COLUMNS;
  }
}

export function dictionaryEntriesForEntityType(entityType: DictionaryEntityType): DictionaryEntityEntry[] {
  switch (entityType) {
    case "process_event_code":
      return buildProcessEventCodebookEntries();
    case "internal_schema_field":
      return buildInternalSchemaAppendixEntries();
    case "excluded_platform_field":
      return buildExcludedPlatformVariableEntries();
    case "research_variable":
    default:
      return buildAnalysisReadyDictionaryEntries();
  }
}

export function dictionaryCsvForEntityType(entityType: DictionaryEntityType, entries = dictionaryEntriesForEntityType(entityType)) {
  const columns = dictionaryEntityColumns(entityType);
  return stringify(
    entries.map((entry) =>
      Object.fromEntries(columns.map((column) => [column, csvSafe((entry as Record<string, string>)[column])]))
    ),
    { header: true, columns: [...columns] }
  );
}

export type DictionaryFilters = {
  entity_type?: DictionaryEntityType | "all";
  search?: string;
  category?: string;
  table_name?: string;
  source_nature?: string;
  privacy_level?: string;
  export_policy?: string;
  derivation?: string;
  field_family?: string;
  deprecated?: string;
};

export type DictionaryPageQuery = DictionaryFilters & {
  page?: number;
  page_size?: number;
};

function isAllowedPageSize(value: number): value is (typeof DATA_DICTIONARY_PAGE_SIZES)[number] {
  return DATA_DICTIONARY_PAGE_SIZES.includes(value as (typeof DATA_DICTIONARY_PAGE_SIZES)[number]);
}

function entryValue(entry: DictionaryEntityEntry, key: string) {
  return (entry as Record<string, string>)[key] ?? "";
}

function entryCategory(entry: DictionaryEntityEntry) {
  return entryValue(entry, "substantive_category") || entryValue(entry, "event_category") || entryValue(entry, "exclusion_category");
}

function fieldFamily(entry: DictionaryEntityEntry) {
  const combined = Object.values(entry as Record<string, string>).join(" ").toLowerCase();
  if (/llm|agent|provider|model|prompt|workflow/.test(combined)) return "LLM fields";
  if (/time|timing|latency|duration|pause|idle|hidden|typing|_ms/.test(combined)) return "Timing fields";
  if (/process|event|response|reasoning|confidence|selected|tempting|turn/.test(combined)) return "Process/response fields";
  return "Other fields";
}

function derivationKind(entry: DictionaryEntityEntry) {
  const source = entryValue(entry, "source_nature") || entryValue(entry, "internal_purpose");
  if (/derived|calculated|count|timestamp|llm|interpretation|configuration|imported/i.test(source)) {
    return "derived_or_generated";
  }
  return "directly_recorded";
}

export function dictionaryFilterOptions(entries: DictionaryEntityEntry[] = buildAnalysisReadyDictionaryEntries()) {
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  return {
    page_sizes: [...DATA_DICTIONARY_PAGE_SIZES],
    entity_types: Object.entries(DICTIONARY_ENTITY_LABELS).map(([value, label]) => ({ value, label })),
    categories: [...DATA_DICTIONARY_CATEGORIES],
    table_names: unique(entries.map((entry) => entryValue(entry, "table_name") || entryValue(entry, "source_table") || entryValue(entry, "model_name"))),
    source_natures: unique(entries.map((entry) => entryValue(entry, "source_nature"))),
    privacy_levels: unique(entries.map((entry) => entryValue(entry, "privacy_level"))),
    export_policies: unique(entries.map((entry) => entryValue(entry, "export_policy"))),
    derivations: ["directly_recorded", "derived_or_generated"],
    field_families: ["Process/response fields", "Timing fields", "LLM fields", "Other fields"],
    deprecated_values: ["false", "true"]
  };
}

export function filterDictionaryEntries<T extends DictionaryEntityEntry>(entries: T[], filters: DictionaryFilters): T[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  return entries
    .filter((entry) => !filters.category || filters.category === "all" || entryCategory(entry) === filters.category)
    .filter((entry) => !filters.table_name || filters.table_name === "all" || [entryValue(entry, "table_name"), entryValue(entry, "source_table"), entryValue(entry, "model_name")].includes(filters.table_name))
    .filter((entry) => !filters.source_nature || filters.source_nature === "all" || entryValue(entry, "source_nature") === filters.source_nature)
    .filter((entry) => !filters.privacy_level || filters.privacy_level === "all" || entryValue(entry, "privacy_level") === filters.privacy_level)
    .filter((entry) => !filters.export_policy || filters.export_policy === "all" || entryValue(entry, "export_policy") === filters.export_policy)
    .filter((entry) => !filters.deprecated || filters.deprecated === "all" || entryValue(entry, "deprecated") === filters.deprecated)
    .filter((entry) => !filters.derivation || filters.derivation === "all" || derivationKind(entry) === filters.derivation)
    .filter((entry) => !filters.field_family || filters.field_family === "all" || fieldFamily(entry) === filters.field_family)
    .filter((entry) => {
      if (!search) return true;
      return Object.values(entry as Record<string, string>).some((value) => value.toLowerCase().includes(search));
    });
}

export function paginateDictionaryEntries<T extends DictionaryEntityEntry>(entries: T[], query: DictionaryPageQuery) {
  const pageSize = isAllowedPageSize(Number(query.page_size)) ? Number(query.page_size) : 100;
  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number.isFinite(Number(query.page)) ? Math.floor(Number(query.page)) : 1;
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  const rows = entries.slice(start, start + pageSize);
  return {
    rows,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    first_visible_row: total === 0 ? 0 : start + 1,
    last_visible_row: Math.min(total, start + rows.length)
  };
}

function countBy(entries: DictionaryEntityEntry[], key: string) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const value = entryValue(entry, key);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}

export function dictionaryStats(entries: DictionaryEntityEntry[] = buildAnalysisReadyDictionaryEntries()) {
  const allResearch = buildAnalysisReadyDictionaryEntries();
  const processEvents = buildProcessEventCodebookEntries();
  const internal = buildInternalSchemaAppendixEntries();
  const excluded = buildExcludedPlatformVariableEntries();
  return {
    variable_count: allResearch.length,
    research_variable_count: allResearch.length,
    process_event_type_count: processEvents.length,
    internal_schema_field_count: internal.length,
    excluded_platform_field_count: excluded.length,
    selected_entity_count: entries.length,
    by_category: countBy(entries, "substantive_category"),
    by_event_category: countBy(entries, "event_category"),
    by_export_policy: countBy(entries, "export_policy"),
    by_privacy_level: countBy(entries, "privacy_level"),
    by_source_nature: countBy(entries, "source_nature")
  };
}

const PLACEHOLDER_PATTERNS = [
  "Captured Prisma field",
  "exported from",
  "See source and generation fields",
  "defined by the application domain enum",
  "Persisted by application services",
  "Read from persisted relational records",
  "Derived automatically",
  "System generated"
];

function containsPlaceholder(value: string) {
  return PLACEHOLDER_PATTERNS.some((pattern) => value.includes(pattern));
}

export function researchDataDictionarySemanticReport() {
  const research = buildAnalysisReadyDictionaryEntries();
  const processEvents = buildProcessEventCodebookEntries();
  const internal = buildInternalSchemaAppendixEntries();
  const excluded = buildExcludedPlatformVariableEntries();
  const exportedColumns = Object.entries(TABLE_COLUMNS).flatMap(([table, columns]) =>
    columns.map((column) => `${table}.${column}`)
  );
  const documentedColumns = new Set(research.map((entry) => entry.qualified_name));
  const timingVariables = research.filter((entry) => isTimingVariable(entry.variable_name) || entry.variable_name.endsWith("_at"));
  const duplicates = new Map<string, number>();
  for (const entry of research) duplicates.set(entry.variable_name, (duplicates.get(entry.variable_name) ?? 0) + 1);
  const ordinaryPii = research.filter((entry) =>
    /email|password|access_code|auth_token|session_token|secret|database_url/.test(entry.variable_name) ||
    (entry.variable_name === "user_id" && entry.export_policy === "research_dataset")
  );
  const contradictions = research.filter((entry) =>
    (entry.privacy_level.includes("never") && entry.export_policy.includes("research")) ||
    (entry.export_policy === "research_dataset" && /never expose|never exported/i.test(entry.interpretation_guidance + entry.interpretation_caution))
  );
  const missingZeroIssues = research.filter((entry) =>
    !entry.missing_value_meaning || !entry.zero_value_meaning || !entry.not_applicable_condition
  );
  return {
    dictionary_schema_version: RESEARCH_DATA_DICTIONARY_SCHEMA_VERSION,
    research_variable_count: research.length,
    process_event_type_count: processEvents.length,
    internal_schema_field_count: internal.length,
    excluded_platform_field_count: excluded.length,
    placeholder_research_definitions: research.filter((entry) =>
      containsPlaceholder(entry.definition) || containsPlaceholder(entry.collection_or_generation_method)
    ).length,
    placeholder_process_event_definitions: processEvents.filter((entry) =>
      containsPlaceholder(entry.trigger) || containsPlaceholder(entry.interpretation_guidance)
    ).length,
    timing_variables_missing_level: timingVariables.filter((entry) => !entry.measurement_level).length,
    timing_variables_missing_formula: timingVariables.filter((entry) => !entry.calculation_formula).length,
    duplicate_variable_names_without_qualified_names: [...duplicates.entries()].filter(([name, count]) =>
      count > 1 && research.some((entry) => entry.variable_name === name && !entry.qualified_name)
    ).length,
    privacy_export_contradictions: contradictions.length,
    pii_fields_in_ordinary_research_export: ordinaryPii.length,
    undocumented_exported_columns: exportedColumns.filter((qualified) => !documentedColumns.has(qualified)),
    documented_but_absent_columns: research
      .map((entry) => entry.qualified_name)
      .filter((qualified) => !exportedColumns.includes(qualified)),
    fields_with_ambiguous_missing_zero_semantics: missingZeroIssues.length,
    no_openai_call_occurred: true
  };
}
