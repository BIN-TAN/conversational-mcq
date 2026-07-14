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
  "source_code_reference",
  "source_service_or_function",
  "semantic_review_status",
  "semantic_review_notes",
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
  "applicable_record_types",
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
  "source_code_reference",
  "source_service_or_function",
  "semantic_review_status",
  "semantic_review_notes",
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

function sourceNature(table: string, variable: string): string {
  if (variable === "research_student_id" || variable === "student_id" || variable === "student_public_id") {
    return "deterministic_derived";
  }
  if (table === "conversation_turns" && variable === "message_text") return "mixed_by_actor_type";
  if (variable === "reasoning_quality_signal") return "persisted_llm_interpretation";
  if (variable === "correctness") return "deterministic_derived";
  if (variable === "correctness_support_level" || variable === "estimated_guessing_risk" || variable === "answer_selection_evidence_weight") {
    return "persisted_llm_interpretation";
  }
  if (variable === "teacher_diagnostic_guidance_available" || variable === "teacher_guidance_considered") {
    return "deterministic_derived";
  }
  if (variable === "app_environment") return "system_configuration";
  if (table === "agent_activity_records" && /token|model|provider|prompt|schema|retry|validated|repair|status/.test(variable)) {
    return "system_configuration";
  }
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
  if (table === "item_responses") {
    if (/correctness|score|unsupported_correct|guessing|answer_selection_evidence_weight/.test(variable)) return "Outcome and scoring data";
    if (/reasoning_quality|misconception|evidence_sufficiency|interpretation|diagnostic|teacher_guidance|alternative/.test(variable)) {
      return "Diagnostic and interpretation outputs";
    }
    return "Item response data";
  }
  if (table === "conversation_turns" || table === "process_events") return "Process event data";
  if (table === "sessions" || table === "assessment_summary") {
    if (/export_|schema_version|version|snapshot|hash|commit|fingerprint|context_|source_|provenance|app_environment/i.test(variable)) {
      return "Export, provenance, and versioning data";
    }
    if (/understanding|engagement|profile|misconception|evidence_sufficiency|interpretation|alternative|guessing|uncertainty/i.test(variable)) {
      return "Diagnostic and interpretation outputs";
    }
    if (/correctness|outcome|score|unsupported_correct|completed_initial|session_completion/i.test(variable)) return "Outcome and scoring data";
    return "Session and participation variables";
  }
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
  return "Session and participation variables";
}

function definition(table: string, variable: string) {
  const overrides: Record<string, string> = {
    research_student_id:
      "Pseudonymous student join key generated for research exports from the operational login identifier through the export namespace hash. It is not the student's login username, email, or internal database UUID.",
    student_id:
      "Deprecated compatibility alias for research_student_id. New analyses should use research_student_id.",
    student_public_id:
      "Deprecated compatibility alias for research_student_id retained for older analysis scripts.",
    session_public_id: "Public assessment-session identifier used as the primary join key across session-level export files.",
    assessment_snapshot_public_id:
      "Deterministic assessment-session snapshot identifier binding exported rows to the administered content context.",
    item_snapshot_public_id:
      "Deterministic identifier for the item version or item context as administered in this session.",
    selected_option: "Option label selected by the student for the administered item snapshot in the chat-native answer step.",
    reasoning_text: "Student-authored reasoning text submitted for the item response. This is research-sensitive text.",
    confidence_rating: "Student-selected confidence rating for the item response after the reasoning prompt.",
    tempting_option: "Student-reported alternative option that seemed tempting, when the tempting-option step was administered and the student named one.",
    tempting_option_reason: "Student-authored explanation for why the reported tempting option seemed plausible.",
    correct_option: "Restricted item-key field. Export only in explicitly restricted teacher/research contexts.",
    correctness: "Restricted deterministic response classification comparing the student-selected option with the session-bound correct-option snapshot.",
    message_text:
      "Conversation turn text. Source meaning depends on actor_type: student turns are student-authored, agent turns are generated or scripted system messages, and system turns are application-authored messages.",
    event_type: "Allow-listed process-event code recorded for one process event row. Event-code semantics are documented in the process event codebook.",
    provider: "Provider family recorded for an agent call or activity record when a backend LLM or mock provider path is attempted.",
    model: "Model name recorded for an agent call when available.",
    output_validated: "Boolean indicator that the stored agent output passed the applicable schema and safety validation.",
    item_response_count:
      "Number of item-response records associated with the assessment attempt or assessment-summary row.",
    app_environment:
      "Application environment label captured with the export source identity for reproducibility.",
    release_at:
      "Assessment release timestamp used to document the availability window for the assessment attempt context."
  };
  if (overrides[variable]) return overrides[variable];
  if (isTimingVariable(variable)) return `${sentenceTitle(variable)} timing construct documented for the ${table} export and measured at ${measurementLevel(table, variable)} scope.`;
  if (variable.endsWith("_count")) return `${sentenceTitle(variable)} aggregate count for the ${table} export at ${measurementLevel(table, variable)} scope.`;
  if (variable.endsWith("_at")) return `${sentenceTitle(variable)} lifecycle timestamp for the ${table} export at ${measurementLevel(table, variable)} scope.`;
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) {
    return `${sentenceTitle(variable)} persisted as an assessment-specific interpretation from validated diagnostic, profile, activity, or post-activity evidence.`;
  }
  if (RESTRICTED_COLUMNS.has(variable)) {
    return `${sentenceTitle(variable)} restricted teacher/research context for interpreting the administered item or response.`;
  }
  if (table === "sessions") {
    return `${sentenceTitle(variable)} session-level field drawn from the AssessmentSession, assessment context, or safe session aggregate for one assessment attempt.`;
  }
  if (table === "item_responses") {
    return `${sentenceTitle(variable)} item-response field drawn from the ItemResponse record, response package evidence, or item-scoped process events for one administered item snapshot.`;
  }
  if (table === "process_events") {
    return `${sentenceTitle(variable)} flattened allow-listed process-event attribute for one recorded event; raw payload JSON is excluded.`;
  }
  if (table === "conversation_turns") {
    return `${sentenceTitle(variable)} conversation-turn attribute for one visible or research-readable transcript turn.`;
  }
  if (table === "agent_activity_records") {
    return `${sentenceTitle(variable)} heterogeneous agent/activity attribute whose applicability depends on record_type.`;
  }
  if (table === "assessment_content") {
    return `${sentenceTitle(variable)} administered-content snapshot field for the assessment or item version shown in a student session.`;
  }
  if (table === "assessment_summary") {
    return `${sentenceTitle(variable)} derived convenience summary field copied or aggregated from the canonical sessions and related export tables.`;
  }
  return `${sentenceTitle(variable)} research-export field documented at ${measurementLevel(table, variable)} scope.`;
}

function collectionMethod(table: string, variable: string) {
  const overrides: Record<string, string> = {
    research_student_id:
      "Computed in researchStudentId() by hashing the operational user_id with namespace research_student_id:v1 before CSV serialization; raw usernames and emails are not written to ordinary research dataset files.",
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
      "Calculated in itemResponseRows() as first_student_action_at minus item_presented_at for the same administered item when both timestamps are available.",
    option_revision_count: "Calculated in itemResponseRows() from item-scoped answer_changed process events after the first option selection.",
    reasoning_revision_count: "Calculated in itemResponseRows() from item-scoped reasoning_revised and reasoning_edited process events.",
    confidence_revision_count: "Calculated in itemResponseRows() from item-scoped confidence_changed process events.",
    page_hidden_count: "Calculated in itemResponseRows() by counting item-scoped page_hidden, page_visibility_hidden, and window_blur process events.",
    long_pause_count: "Calculated in sessionRows() by counting session-scoped long_pause process events.",
    idle_ratio: "Calculated in sessionRows() as total_idle_time_ms divided by elapsed_session_time_ms; null when the denominator is missing or zero.",
    item_response_time_ms: "Read from ItemResponse.item_response_time_ms, which is finalized by the item-response service from item presentation/start through item submission.",
    assessment_specific_understanding_category:
      "Persisted output from the assessment-specific profile/evidence integration workflow using response package, item evidence, and process context.",
    engagement_review_category:
      "Persisted evidence-quality review output from the profile integration or engagement evidence workflow; agent and prompt/schema provenance are recorded in adjacent audit fields when available; it is not a motivation or misconduct label.",
    misconception_hypothesis:
      "Generated by the validated profile/activity interpretation agent workflow or teacher-reviewed as a tentative interpretation from response-package evidence. It is inferred, not directly observed.",
    reasoning_quality_signal:
      "Serialized by itemResponseRows() from response-package evidence produced by the validated response/profile interpretation workflow.",
    correctness_support_level:
      "Serialized by itemResponseRows() from restricted response-package evidence that qualifies correctness with reasoning and confidence support.",
    estimated_guessing_risk:
      "Serialized by itemResponseRows() from restricted response-package evidence generated by the validated interpretation workflow; not teacher-authored and not student-facing.",
    answer_selection_evidence_weight:
      "Serialized by itemResponseRows() from restricted response-package evidence describing how much the selected answer should contribute to interpretation.",
    event_type: "Recorded by the frontend, backend, agent, or workflow component that emits the process event; event meanings are maintained in process_event_codebook.csv.",
    provider: "Recorded by the agent execution audit layer when an LLM or mock provider call is attempted.",
    total_token_count: "Recorded from provider usage metadata when available, or left null when unavailable."
  };
  if (overrides[variable]) return overrides[variable];
  if (variable.endsWith("_count")) {
    return `Computed by the ${sourceServiceOrFunction(table, variable)} export path from the relevant ${table} records or allow-listed event types at ${measurementLevel(table, variable)} scope.`;
  }
  if (isTimingVariable(variable)) return timingMetadata(variable, table).method;
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) {
    return "Generated by a validated LLM-backed or effective-system interpretation workflow from response packages, process evidence, and approved context; generating agent and prompt/schema versions are recorded in agent/workflow audit fields when available; missing values mean no valid output was recorded.";
  }
  if (sourceNature(table, variable) === "teacher_authored") return "Recorded when a teacher authors or imports assessment/item diagnostic context for the selected assessment or item.";
  if (sourceNature(table, variable) === "externally_imported") return "Imported through the validated external outcome workflow and linked to the assessment/session scope recorded in the row.";
  if (sourceNature(table, variable) === "system_configuration") return `Written by ${sourceServiceOrFunction(table, variable)} from version, snapshot, configuration, or application provenance metadata at export time.`;
  if (table === "sessions") return `Serialized by sessionRows() or sessionBase() from AssessmentSession, Assessment, profile, event, and supplemental activity records.`;
  if (table === "item_responses") return `Serialized by itemResponseRows() from ItemResponse, item snapshots, response-package evidence, and item-scoped process events.`;
  if (table === "process_events") return `Serialized by processEventRows() from ProcessEvent fields and allow-listed payload keys; raw payload JSON is not exported.`;
  if (table === "conversation_turns") return `Serialized by conversationRows() from ConversationTurn fields with safe context labels and latency calculations.`;
  if (table === "agent_activity_records") return `Serialized by agentAndActivityRows() from agent calls, profiles, formative decisions, follow-up rounds, workflow jobs, and activity-runtime evidence records; record_type determines applicability.`;
  if (table === "assessment_content") return `Serialized by assessmentContentRows() from administered item snapshots and active media metadata.`;
  if (table === "assessment_summary") return `Serialized by assessmentSummaryRows() as a convenience view derived from sessionRows() and related session aggregates.`;
  return `Serialized by the analysis-ready export service for ${measurementLevel(table, variable)} scope.`;
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
  if (/reasoning_quality_signal|correctness_support_level|estimated_guessing_risk|answer_selection_evidence_weight/.test(variable)) {
    return "Interpretive evidence-quality signal; not a directly observed fact, not a stable trait, not a student-facing label, and not ground truth.";
  }
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
      start: "item_presented_at",
      end: "item_submitted_at",
      formula: "item_submitted_at minus item_presented_at, or persisted ItemResponse.item_response_time_ms when the backend finalized the response",
      idle: "Includes idle periods unless adjusted by separate active-time fields.",
      hidden: "Includes page-hidden periods unless adjusted by separate focus/visibility fields.",
      method: "Stored on the item response when the item response is finalized."
    },
    time_to_first_action_ms: {
      construct: "item_prompt_to_first_student_action_latency",
      start: "item_presented_at",
      end: "first_student_action_at",
      formula: "first_student_action_at minus item_presented_at"
    },
    time_to_first_option_selection_ms: {
      construct: "item_prompt_to_first_option_selection_latency",
      start: "item_presented_at",
      end: "first_option_selected_at",
      formula: "first_option_selected_at minus item_presented_at"
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
    page_hidden_count: {
      construct: "item_page_hidden_event_count",
      start: "item_presented_at",
      end: "item_submitted_at",
      formula: "count of page_hidden, page_visibility_hidden, and window_blur process events for the item",
      idle: "Not an idle-duration measure; it counts visibility/blur events.",
      hidden: "This count is evidence that page-hidden or blur events occurred, not their duration.",
      aggregation: "Counted across item-scoped visibility events.",
      method: "Calculated in itemResponseRows() from item-scoped visibility process events."
    },
    idle_ratio: {
      construct: "session_idle_time_ratio",
      start: "started_at",
      end: "completed_at or last_activity_at",
      formula: "total_idle_time_ms divided by elapsed_session_time_ms; null when elapsed_session_time_ms is missing or zero",
      idle: "Numerator is recorded idle time. A zero value means no idle duration was recorded while elapsed time was positive.",
      hidden: "Page-hidden time is separate unless it was also logged as idle.",
      aggregation: "Ratio ranges from 0 to 1.",
      method: "Calculated in sessionRows() after elapsed_session_time_ms and total_idle_time_ms are available."
    },
    long_pause_count: {
      construct: "session_long_pause_event_count",
      start: "started_at",
      end: "completed_at or last_activity_at",
      formula: "count of long_pause process events for the session",
      idle: "Counts long-pause events; durations are reported separately in total_long_pause_ms and maximum_long_pause_ms.",
      hidden: "Page-hidden handling is separate unless the pause event also represents hidden time.",
      aggregation: "Counted across session-scoped long_pause events.",
      method: "Calculated in sessionRows() from session-scoped long_pause process events."
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
  if (variable.endsWith("_count") && !overrides[variable]) {
    return {
      ...entry,
      construct: `${variable.replace(/_count$/, "")}_event_or_record_count`,
      start: `${measurementLevel(table, variable)} scope start`,
      end: `${measurementLevel(table, variable)} scope end`,
      formula: `count of qualifying ${variable.replace(/_count$/, "").replace(/_/g, " ")} records or allow-listed process events at ${measurementLevel(table, variable)} scope`,
      idle: "Not a duration measure; idle handling is not applicable except through the source events being counted.",
      hidden: "Not a duration measure; page-hidden handling is not applicable except through the source events being counted.",
      aggregation: "Counted within the documented row grain.",
      method: `Computed by ${sourceServiceOrFunction(table, variable)} from source records or allow-listed process events.`
    };
  }
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

function sourceServiceOrFunction(table: string, variable: string) {
  if (variable === "research_student_id" || variable === "student_id" || variable === "student_public_id") {
    return "researchStudentId";
  }
  const functions: Record<string, string> = {
    sessions: "sessionRows; sessionBase",
    item_responses: "itemResponseRows",
    process_events: "processEventRows",
    conversation_turns: "conversationRows",
    agent_activity_records: "agentAndActivityRows",
    assessment_content: "assessmentContentRows",
    assessment_summary: "assessmentSummaryRows"
  };
  return functions[table] ?? "analysis-ready export service";
}

function sourceCodeReference(table: string, variable: string) {
  if (variable === "research_student_id" || variable === "student_id" || variable === "student_public_id") {
    return "src/lib/services/teacher-research-data/analysis-ready-export.ts:researchStudentId";
  }
  const references: Record<string, string> = {
    sessions: "src/lib/services/teacher-research-data/analysis-ready-export.ts:sessionRows/sessionBase",
    item_responses: "src/lib/services/teacher-research-data/analysis-ready-export.ts:itemResponseRows",
    process_events: "src/lib/services/teacher-research-data/analysis-ready-export.ts:processEventRows",
    conversation_turns: "src/lib/services/teacher-research-data/analysis-ready-export.ts:conversationRows",
    agent_activity_records: "src/lib/services/teacher-research-data/analysis-ready-export.ts:agentAndActivityRows",
    assessment_content: "src/lib/services/teacher-research-data/analysis-ready-export.ts:assessmentContentRows",
    assessment_summary: "src/lib/services/teacher-research-data/analysis-ready-export.ts:assessmentSummaryRows"
  };
  return references[table] ?? "src/lib/services/teacher-research-data/analysis-ready-export.ts";
}

function semanticReviewStatus(table: string, variable: string) {
  void table;
  void variable;
  return "source_verified";
}

function semanticReviewNotes(table: string, variable: string) {
  const suffix = LLM_INTERPRETIVE_COLUMNS.has(variable) || RESTRICTED_COLUMNS.has(variable)
    ? " Source path is verified; domain-owner interpretation remains pending."
    : " Source path is verified from code; domain-owner review remains pending for final research wording.";
  if (table === "assessment_summary") {
    return `Convenience view derived from canonical session-level rows.${suffix}`;
  }
  if (table === "agent_activity_records") {
    return `Heterogeneous union export; use record_type and applicable_record_types before analysis.${suffix}`;
  }
  return suffix.trim();
}

function applicableRecordTypes(table: string, variable: string) {
  if (table !== "agent_activity_records") return `all ${table} rows when the construct applies`;
  if (/provider|model|token|prompt|schema|validated|repair|retry|agent_call|blocked_reason|answer_key|protected_content|context_|teacher_diagnostic|interpretation_caution|student_evidence/.test(variable)) {
    return "agent_call";
  }
  if (/understanding|engagement|response_profile|evidence_sufficiency|uncertainty/.test(variable)) {
    return "profile_result; diagnostic_snapshot";
  }
  if (/formative_value|selected_strategy/.test(variable)) return "formative_decision";
  if (/activity_prompt|student_response|misconception_|evidence_|next_action|evaluation_status/.test(variable)) {
    return "formative_activity; activity_attempt; post_activity_evidence; diagnostic_snapshot";
  }
  if (/activity_|attempt_number/.test(variable)) return "activity_attempt; formative_activity; workflow_job";
  if (/status|started_at|completed_at|limitations/.test(variable)) {
    return "agent_call; profile_result; formative_decision; activity_attempt; workflow_job; formative_activity; post_activity_evidence; diagnostic_snapshot";
  }
  return "record_type-specific; inspect record_type before using";
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
        source_nature: sourceNature(tableName, variable),
        source_table_or_event: tableName,
        source_code_reference: sourceCodeReference(tableName, variable),
        source_service_or_function: sourceServiceOrFunction(tableName, variable),
        semantic_review_status: semanticReviewStatus(tableName, variable),
        semantic_review_notes: semanticReviewNotes(tableName, variable),
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
        generating_agent: sourceNature(tableName, variable) === "persisted_llm_interpretation" ? "validated profile, activity, or diagnostic interpretation workflow" : "",
        generating_schema_version: sourceNature(tableName, variable) === "persisted_llm_interpretation" ? "recorded in adjacent agent_activity_records schema_version when available" : "",
        interpretation_guidance: interpretationGuidance(variable),
        interpretation_caution: interpretationCaution(variable),
        privacy_level: researchPrivacyLevel(variable),
        audience: RESTRICTED_COLUMNS.has(variable) ? "restricted_researcher" : "teacher; researcher",
        export_policy: researchExportPolicy(variable),
        example_value: "",
        deprecated: deprecated ? "true" : "false",
        replacement_variable: deprecated ? "research_student_id" : "",
        applicable_record_types: applicableRecordTypes(tableName, variable),
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
    return "credential_secret";
  }
  if (/^id$|_db_id$|hash$|_hash$|raw_output|input_payload|output_payload|provider_request|provider_response/i.test(field)) {
    return "internal_audit_metadata";
  }
  if (/token_usage|input_tokens|output_tokens|total_tokens|max_output_tokens|estimated_cost|latency_ms/i.test(field)) {
    return "llm_usage_audit_metadata";
  }
  if (/correct_option|correctness|distractor|teacher_llm/i.test(field)) return "restricted_answer_key_or_teacher_diagnostic";
  if (/email|user_id|student_public_id|display_name/i.test(field)) return "account_pii";
  if (/reasoning|message|rationale|notes|payload/i.test(field)) return "research_sensitive_text_or_payload";
  if (/status|phase|attempt|started_at|completed_at|created_at|updated_at|release_at|close_at|version|order_index/i.test(field)) {
    return "internal_system_metadata";
  }
  return "internal_lineage_metadata";
}

function isExcludedPrismaField(modelName: string, field: string) {
  return (
    modelName === "User" ||
    /password|access_code|token_hash|account_security_token|secret|cookie|database_url|email|user_id|auth_version|credential|created_by_teacher_user_id/i.test(field) ||
    /^id$|_db_id$|raw_output|input_payload|output_payload|provider_request|provider_response|prompt_hash|lease|locked_by|storage_key|public_or_signed_url|external_url/i.test(field)
  );
}

function exclusionCategory(modelName: string, field: string) {
  if (/password|access_code|token_hash|account_security_token|secret|cookie|database_url/i.test(field)) return "credential_or_secret";
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

function prismaFieldNullable(modelName: string, field: string) {
  if (field === "id" || field.endsWith("_public_id") || field === "user_id" || field === "role" || field === "status" || field === "created_at" || field === "updated_at") {
    return "false";
  }
  if (/_db_id$/.test(field) && !/latest_|updated_|based_on_|supersedes_|import_batch|followup_round/.test(field)) return "false";
  if (modelName === "Assessment" && ["title", "status", "workflow_mode", "response_collection_mode"].includes(field)) return "false";
  if (modelName === "Item" && ["item_public_id", "item_stem", "options", "correct_option", "item_order", "status", "version"].includes(field)) return "false";
  if (modelName === "AssessmentSession" && ["session_public_id", "attempt_number", "status", "current_phase"].includes(field)) return "false";
  if (modelName === "ProcessEvent" && ["event_type", "event_category", "event_source", "occurred_at", "created_at"].includes(field)) return "false";
  if (modelName === "AgentCall" && ["agent_name", "provider", "call_status", "created_at"].includes(field)) return "false";
  return "true";
}

function prismaFieldRelationRole(field: string) {
  if (field === "id") return "internal primary key";
  if (/_db_id$/.test(field)) return "internal foreign key";
  if (field.endsWith("_public_id") || field === "user_id") return "public or login identifier source";
  return "";
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
          nullable: prismaFieldNullable(modelName, field),
          relation_role: prismaFieldRelationRole(field),
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
          permitted_audience: /password|access_code|token_hash|account_security_token|secret|cookie|database_url/i.test(field)
            ? "never_exposed"
            : "operator_or_developer_internal",
          export_policy: /password|access_code|token_hash|account_security_token|secret|cookie|database_url/i.test(field)
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
      "Recorded when the application persists or acknowledges the item-presentation step for the administered item snapshot; it is not proof of browser paint or reading.",
    option_clicked: "Recorded when the student selects an answer option in the chat-native item administration UI.",
    answer_changed: "Recorded when a student revises an already recorded answer before package continuation.",
    reasoning_submitted: "Recorded when the student submits reasoning text for the current item.",
    confidence_clicked: "Recorded when the student selects a confidence option for the current item.",
    tempting_option_submitted: "Recorded when the student reports whether another option was tempting.",
    package_submitted: "Recorded when the completed initial response package is sent into the package-analysis workflow.",
    typing_activity_summary: "Recorded when the browser sends summarized typing-timing instrumentation without raw keystrokes or text.",
    page_hidden: "Recorded from the browser visibility API when the page becomes hidden; paired visible/blur/focus events are used for duration context when available.",
    page_visibility_hidden: "Recorded from the browser visibility API when visibilityState becomes hidden.",
    window_blur: "Recorded when the browser window loses focus during the assessment session.",
    agent_call_failed: "Recorded when an agent call fails because of provider transport, authentication, schema validation, safety validation, runtime readiness, or workflow failure; inspect AgentCall status/error metadata for subtype.",
    schema_validation_failed: "Recorded when structured provider output or effective output fails the schema or safety validation step.",
    llm_runtime_blocked: "Recorded when runtime readiness or configuration guards block an LLM-backed path before provider dispatch.",
    response_quality_rejected: "Recorded when response-quality validation rejects a student submission and requires a revised or more usable response."
  };
  if (triggers[eventType]) return triggers[eventType];
  if (/session_started/.test(eventType)) return "Recorded when a student assessment session is created or first opened.";
  if (/session_completed/.test(eventType)) return "Recorded when the application marks the assessment session complete.";
  if (/agent_message|message_shown/.test(eventType)) return "Recorded when a student-visible agent message is created or acknowledged as shown.";
  if (/profile|llm|agent/.test(eventType)) return "Recorded when the backend agent or LLM workflow reaches the named lifecycle step.";
  if (/activity|followup|feedback|revision/.test(eventType)) return "Recorded when the formative activity, follow-up, feedback, or revision workflow reaches the named step.";
  if (/page|window|focus|blur|visibility|pause|typing|navigation/.test(eventType)) return "Recorded from allow-listed browser process instrumentation for visibility, navigation, typing, or pause context.";
  return `Recorded by the backend service responsible for the ${eventCategory(eventType)} stage when that named workflow milestone occurs at the documented scope.`;
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

function eventTimestampMeaning(eventType: string) {
  if (eventType === "item_presented") {
    return "occurred_at is the application-side item-presentation acknowledgement timestamp, not guaranteed browser-render completion or reading time.";
  }
  if (/page_hidden|page_visibility_hidden|window_blur/.test(eventType)) {
    return "occurred_at marks the browser visibility or focus transition; duration fields, when present, describe the observed hidden/blur interval.";
  }
  if (/page_visible|page_visibility_visible|window_focus/.test(eventType)) {
    return "occurred_at marks the browser returning to visible or focused state.";
  }
  if (/typing_activity_summary/.test(eventType)) {
    return "occurred_at marks when the typing summary was received or flushed; payload durations summarize input timing without raw text.";
  }
  if (/agent_call|schema_validation|llm|profile|planning|followup/.test(eventType)) {
    return "occurred_at marks the backend agent/workflow lifecycle transition; provider timing lives in agent audit metadata when available.";
  }
  if (/option|answer|reasoning|confidence|tempting|revision|idk|clarification|help/.test(eventType)) {
    return "occurred_at marks when the backend accepted the student action or recorded the student-facing response event.";
  }
  if (/workflow_job/.test(eventType)) {
    return "occurred_at marks the workflow worker/job lifecycle transition.";
  }
  return "occurred_at records when the application observed the event; created_at records when the row was persisted.";
}

function eventDerivedVariables(eventType: string) {
  if (/page_hidden|page_visibility_hidden|window_blur|page_visible|window_focus|long_pause|inactivity/.test(eventType)) {
    return "visibility_duration_ms, pause_duration_ms, total_page_hidden_ms, total_idle_time_ms, idle_ratio, long_pause_count, engagement process features";
  }
  if (/option|answer|transfer_answer/.test(eventType)) {
    return "selected_option, first_option_selected_at, time_to_first_option_selection_ms, option_selection_count, option_revision_count, answer-change indicators";
  }
  if (/reasoning/.test(eventType)) {
    return "reasoning_submitted_at, reasoning_prompt_to_submission_ms, reasoning_submission_count, reasoning_revision_count, reasoning-quality evidence";
  }
  if (/confidence/.test(eventType)) {
    return "confidence_selected_at, confidence_prompt_to_selection_ms, confidence_selection_count, confidence_revision_count";
  }
  if (/tempting/.test(eventType)) {
    return "tempting_option, tempting_option_reason, tempting-option counts and evidence-completeness fields";
  }
  if (/agent_call|schema_validation|llm|profile|formative|activity|followup|workflow/.test(eventType)) {
    return "agent_activity_records status/provenance fields, profile/formative/activity rows, workflow limitations, validation status";
  }
  if (/item_presented|item_completed|item_submitted/.test(eventType)) {
    return "item_presented_at, item_submitted_at, item_response_time_ms, item completion counts";
  }
  if (/package/.test(eventType)) {
    return "response package availability, package-level completion status, response-package evidence fields";
  }
  return "process_events flattened payload columns and session/item process-event counts when applicable";
}

function eventInterpretationGuidance(eventType: string) {
  if (/page|window|pause|typing|navigation|inactivity/.test(eventType)) {
    return "Use as instrumentation context for availability, timing, and evidence-quality review; pair with event durations and limitations.";
  }
  if (/agent|llm|schema|workflow/.test(eventType)) {
    return "Use to reconstruct backend agent/workflow lifecycle; inspect associated audit records before interpreting success or failure.";
  }
  if (/option|reasoning|confidence|tempting|idk|clarification|help|revision/.test(eventType)) {
    return "Use to reconstruct the chat-native evidence-collection sequence and response revisions for the scoped item.";
  }
  return "Use with event category, source, scope, timestamp, and allow-listed payload fields to reconstruct process evidence.";
}

function eventInterpretationCaution(eventType: string) {
  if (/page|window|pause|typing|navigation|inactivity/.test(eventType)) {
    return "Visibility, focus, typing, or pause events are imperfect proxies and must not be treated as effort, attention, cheating, or misconduct labels.";
  }
  if (/agent_call_failed|schema_validation_failed|llm_runtime_blocked/.test(eventType)) {
    return "Failure event names identify a blocked lifecycle point only; sanitized agent-call metadata is required to distinguish provider, validation, readiness, and workflow failures.";
  }
  if (/item_presented/.test(eventType)) {
    return "Presentation timestamp indicates application acknowledgement, not immediate student reading.";
  }
  if (/correct|quality|rejected|invalid_help|prompt_injection/.test(eventType)) {
    return "Use as workflow/safety context, not as a stable student trait or misconduct finding.";
  }
  return "Event presence, absence, or timing alone does not prove understanding, effort, motivation, cheating, or misconduct.";
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
      timestamp_meaning: eventTimestampMeaning(eventType),
      payload_fields: eventPayloadFields(eventType),
      derived_variables: eventDerivedVariables(eventType),
      source_code_reference: "src/lib/domain/enums.ts:processEventTypes; process-event emitters in student assessment services and frontend instrumentation",
      source_service_or_function: `${eventCategory(eventType)} event emitter`,
      semantic_review_status: "source_verified",
      semantic_review_notes: "Event enum and export projection verified from source code; domain-owner review pending for final research wording.",
      directly_recorded: "true",
      interpretation_guidance: eventInterpretationGuidance(eventType),
      interpretation_caution: eventInterpretationCaution(eventType),
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
  measurement_level?: string;
  actor_or_source?: string;
  scope?: string;
  source_nature?: string;
  privacy_level?: string;
  permitted_audience?: string;
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
    categories: unique(entries.map((entry) => entryCategory(entry))),
    table_names: unique(entries.map((entry) => entryValue(entry, "table_name") || entryValue(entry, "source_table") || entryValue(entry, "model_name"))),
    measurement_levels: unique(entries.map((entry) => entryValue(entry, "measurement_level"))),
    actor_or_sources: unique(entries.map((entry) => entryValue(entry, "actor_or_source"))),
    scopes: unique(entries.map((entry) => entryValue(entry, "session_or_item_scope"))),
    source_natures: unique(entries.map((entry) => entryValue(entry, "source_nature"))),
    privacy_levels: unique(entries.map((entry) => entryValue(entry, "privacy_level"))),
    permitted_audiences: unique(entries.map((entry) => entryValue(entry, "permitted_audience") || entryValue(entry, "audience"))),
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
    .filter((entry) => !filters.measurement_level || filters.measurement_level === "all" || entryValue(entry, "measurement_level") === filters.measurement_level)
    .filter((entry) => !filters.actor_or_source || filters.actor_or_source === "all" || entryValue(entry, "actor_or_source") === filters.actor_or_source)
    .filter((entry) => !filters.scope || filters.scope === "all" || entryValue(entry, "session_or_item_scope") === filters.scope)
    .filter((entry) => !filters.source_nature || filters.source_nature === "all" || entryValue(entry, "source_nature") === filters.source_nature)
    .filter((entry) => !filters.privacy_level || filters.privacy_level === "all" || entryValue(entry, "privacy_level") === filters.privacy_level)
    .filter((entry) => !filters.permitted_audience || filters.permitted_audience === "all" || [entryValue(entry, "permitted_audience"), entryValue(entry, "audience")].includes(filters.permitted_audience))
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
  "System generated",
  "value recorded for one row",
  "timestamp associated with one row",
  "counted within one row",
  "measured for one row",
  "Read from the",
  "serialization path",
  "Calculated by counting matching records or process events"
];

function containsPlaceholder(value: string) {
  return PLACEHOLDER_PATTERNS.some((pattern) => value.includes(pattern));
}

const FORMULA_STOPWORDS = new Set([
  "and", "or", "when", "both", "are", "available", "minus", "divided", "by", "count", "of", "the",
  "for", "from", "to", "with", "as", "is", "a", "an", "null", "missing", "zero", "persisted", "backend",
  "finalized", "response", "available", "qualifying", "allow", "listed", "process", "events", "records",
  "scope", "timestamp", "timestamps", "value", "payload", "field", "fields", "duration", "durations",
  "endpoint", "start", "end", "item", "session", "turn", "row", "same", "recorded"
]);

function formulaReferences(formula: string) {
  return [...new Set((formula.match(/[a-z][a-z0-9_]+/g) ?? [])
    .filter((token) => token.includes("_"))
    .filter((token) => !FORMULA_STOPWORDS.has(token)))];
}

function formulaReferenceIssues(research: DataDictionaryEntry[]) {
  const exported = new Set(research.flatMap((entry) => [entry.variable_name, entry.qualified_name]));
  const eventNames = new Set<string>(processEventTypes);
  const documentedPayloadFields = new Set([
    "duration_ms",
    "pause_duration_ms",
    "visibility_duration_ms",
    "active_typing_time_ms",
    "reasoning_input_elapsed_time_ms",
    "typing_duration_ms",
    "text_length",
    "message_length",
    "reasoning_length",
    "item_response",
    "process_event",
    "conversation_turn",
    "agent_call",
    "formative_activity",
    "assessment_attempt"
  ]);
  return research.flatMap((entry) => {
    if (!entry.calculation_formula) return [];
    return formulaReferences(entry.calculation_formula)
      .filter((reference) => !exported.has(reference) && !eventNames.has(reference) && !documentedPayloadFields.has(reference) && !/^ItemResponse$/.test(reference))
      .map((reference) => `${entry.qualified_name}:${reference}`);
  });
}

function processEventBoilerplateIssues(processEvents: ProcessEventCodebookEntry[]) {
  const countIdentical = (field: keyof ProcessEventCodebookEntry) => new Set(processEvents.map((entry) => entry[field])).size;
  return {
    timestamp_meaning_unique_count: countIdentical("timestamp_meaning"),
    derived_variables_unique_count: countIdentical("derived_variables"),
    guidance_unique_count: countIdentical("interpretation_guidance"),
    caution_unique_count: countIdentical("interpretation_caution"),
    generic_trigger_count: processEvents.filter((entry) => /workflow event at the relevant session or item scope|domain enum|Process event type/i.test(entry.trigger)).length
  };
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
  const formulaIssues = formulaReferenceIssues(research);
  const processBoilerplate = processEventBoilerplateIssues(processEvents);
  const countDurationFormulaIssues = timingVariables.filter((entry) =>
    entry.variable_name.endsWith("_count") && /minus|duration|timestamp difference/i.test(entry.calculation_formula)
  );
  const ratioFormulaIssues = timingVariables.filter((entry) =>
    entry.variable_name.endsWith("_ratio") && !/divided by|numerator|denominator/i.test(entry.calculation_formula)
  );
  const internalNullableIssues = internal.filter((entry) => entry.nullable === "see Prisma schema");
  const internalPrivacyIssues = internal.filter((entry) =>
    entry.audience.includes("developer") && entry.privacy_level === "ordinary teacher data"
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
    generic_research_definitions: research.filter((entry) => containsPlaceholder(entry.definition)).length,
    generic_research_methods: research.filter((entry) => containsPlaceholder(entry.collection_or_generation_method)).length,
    formula_reference_issues: formulaIssues,
    count_duration_formula_issues: countDurationFormulaIssues.map((entry) => entry.qualified_name),
    ratio_formula_issues: ratioFormulaIssues.map((entry) => entry.qualified_name),
    process_event_generic_triggers: processBoilerplate.generic_trigger_count,
    process_event_timestamp_meaning_unique_count: processBoilerplate.timestamp_meaning_unique_count,
    process_event_derived_variables_unique_count: processBoilerplate.derived_variables_unique_count,
    process_event_guidance_unique_count: processBoilerplate.guidance_unique_count,
    process_event_caution_unique_count: processBoilerplate.caution_unique_count,
    internal_nullable_placeholder_count: internalNullableIssues.length,
    internal_privacy_audience_mismatch_count: internalPrivacyIssues.length,
    no_openai_call_occurred: true
  };
}
