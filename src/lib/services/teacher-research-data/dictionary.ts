import { stringify } from "csv-stringify/sync";
import { processEventTypes } from "@/lib/domain/enums";

export const RESEARCH_DATASET_EXPORT_VERSION = "research-dataset-v1" as const;
export const ANALYSIS_READY_EXPORT_VERSION = RESEARCH_DATASET_EXPORT_VERSION;
export const RESEARCH_DATA_DICTIONARY_VERSION = "research-data-dictionary-v2" as const;

export const RESEARCH_DATASET_TABLES = [
  "sessions",
  "item_responses",
  "process_events",
  "conversation_turns",
  "agent_activity_records",
  "assessment_content",
  "assessment_summary",
  "data_dictionary"
] as const;

export const ANALYSIS_READY_TABLES = RESEARCH_DATASET_TABLES;

export type AnalysisReadyTableName = (typeof RESEARCH_DATASET_TABLES)[number];

export const SESSIONS_COLUMNS = [
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
  "category",
  "table_name",
  "variable_name",
  "display_name",
  "definition",
  "row_grain",
  "data_type",
  "unit",
  "allowed_values",
  "nullable",
  "missing_value_meaning",
  "zero_value_meaning",
  "source_type",
  "source_table_or_event",
  "collection_or_generation_method",
  "calculation_formula",
  "timing_start_event",
  "timing_end_event",
  "aggregation_rule",
  "attempt_policy",
  "version_binding",
  "interpretation_guidance",
  "interpretation_caution",
  "privacy_level",
  "export_tier",
  "example_value",
  "deprecated",
  "notes"
] as const;

export type DataDictionaryEntry = Record<(typeof DATA_DICTIONARY_COLUMNS)[number], string>;

const ROW_GRAINS: Record<AnalysisReadyTableName, string> = {
  sessions: "one row per student assessment attempt/session",
  item_responses: "one row per student response to one administered item snapshot",
  process_events: "one row per recorded process event",
  conversation_turns: "one row per visible or research-readable conversation turn",
  agent_activity_records:
    "one row per agent call, workflow decision, formative activity attempt, or diagnostic update record",
  assessment_content: "one row per administered item snapshot",
  assessment_summary: "one row per student-assessment attempt summary",
  data_dictionary: "one row per exported or classified variable"
};

const TABLE_COLUMNS: Record<AnalysisReadyTableName, readonly string[]> = {
  sessions: SESSIONS_COLUMNS,
  item_responses: ITEM_RESPONSES_COLUMNS,
  process_events: PROCESS_EVENTS_COLUMNS,
  conversation_turns: CONVERSATION_TURNS_COLUMNS,
  agent_activity_records: AGENT_ACTIVITY_RECORDS_COLUMNS,
  assessment_content: ASSESSMENT_CONTENT_COLUMNS,
  assessment_summary: ASSESSMENT_SUMMARY_COLUMNS,
  data_dictionary: DATA_DICTIONARY_COLUMNS
};

export const DATA_DICTIONARY_PAGE_SIZES = [25, 50, 100, 250, 500] as const;

export const DATA_DICTIONARY_CATEGORIES = [
  "Assessment system variables",
  "Assessment variables",
  "Session and participation variables",
  "Process and response data",
  "Timing and interaction data",
  "Diagnostic and interpretation data",
  "Formative activity and follow-up data",
  "Outcome data",
  "LLM and workflow audit data",
  "Export, provenance, and versioning data",
  "Account and access data",
  "Internal security data"
] as const;

export type DataDictionaryCategory = (typeof DATA_DICTIONARY_CATEGORIES)[number];

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

function sourceType(variable: string) {
  if (variable.endsWith("_count")) return "derived count";
  if (variable.endsWith("_ms") || variable.endsWith("_ratio")) return "derived from timestamps";
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) return "persisted LLM output";
  if (RESTRICTED_COLUMNS.has(variable)) return "restricted answer-key field";
  if (variable.includes("diagnostic") || variable.includes("teacher_guidance")) return "teacher-authored metadata";
  if (variable.includes("outcome")) return "externally imported outcome";
  if (variable.startsWith("export_") || variable.includes("schema_version") || variable.includes("commit")) return "system configuration";
  return "directly recorded";
}

function privacyLevel(variable: string) {
  if (RESTRICTED_COLUMNS.has(variable)) return "restricted answer-key";
  if (SENSITIVE_TEXT_COLUMNS.has(variable)) return "research-sensitive";
  if (variable.includes("student_id")) return "PII";
  if (variable.includes("provider_request") || variable.includes("provider_response")) return "internal audit only";
  return "ordinary teacher data";
}

function exportTier(table: string, variable: string) {
  if (/password|access_code|token_hash|session_secret|cookie|api_key|database_url/i.test(variable)) {
    return "never_exported";
  }
  if (RESTRICTED_COLUMNS.has(variable)) return "restricted_research_dataset";
  if (table === "data_dictionary") return "research_dataset";
  if (table.startsWith("prisma.")) return prismaFieldExportTier(variable);
  return "research_dataset";
}

function categoryFor(table: string, variable: string): DataDictionaryCategory {
  if (/password|access_code|token_hash|secret|cookie|api_key|database_url/i.test(variable)) return "Internal security data";
  if (/user_id|email|role|account|credential|login|teacher_user/i.test(variable)) return "Account and access data";
  if (/export_|schema_version|version|snapshot|hash|commit|fingerprint|context_|source_|provenance/i.test(variable)) {
    return "Export, provenance, and versioning data";
  }
  if (table === "agent_activity_records" || table === "prisma.AgentCall" || table === "prisma.WorkflowJob" || /agent|provider|model|prompt|token|workflow|retry|validated|blocked|repair/i.test(variable)) {
    return "LLM and workflow audit data";
  }
  if (table === "assessment_content" || table === "prisma.Assessment" || table === "prisma.ConceptUnit" || table === "prisma.Item" || table === "prisma.ItemMediaAsset" || /stem|option|media|diagnostic_focus|teacher_llm|distractor|correct_option|item_|assessment_title/i.test(variable)) {
    return "Assessment variables";
  }
  if (table === "sessions" || table === "assessment_summary" || table === "prisma.AssessmentSession" || table === "prisma.ConceptUnitSession" || /session_status|attempt|phase|started_at|completed_at|resumed_at|current_|completion|participation/i.test(variable)) {
    return "Session and participation variables";
  }
  if (table === "process_events" || table === "conversation_turns" || table === "item_responses" || table === "process_event_type_inventory" || /selected_option|reasoning|confidence|tempting|skipped|revision|event_|turn_|message|response_/i.test(variable)) {
    if (variable.endsWith("_ms") || /time|latency|duration|pause|idle|hidden|typing/i.test(variable)) {
      return "Timing and interaction data";
    }
    return "Process and response data";
  }
  if (/understanding|engagement|profile|misconception|evidence_sufficiency|interpretation|alternative|guessing/i.test(variable)) {
    return "Diagnostic and interpretation data";
  }
  if (/formative|activity|followup|revision|transfer|post_activity|snapshot/i.test(variable)) {
    return "Formative activity and follow-up data";
  }
  if (/correctness|outcome|score|completed/i.test(variable)) return "Outcome data";
  if (/status|mode|included|published|archived|created_at|updated_at/i.test(variable)) return "Assessment system variables";
  return "Assessment system variables";
}

function definition(table: string, variable: string) {
  const overrides: Record<string, string> = {
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
    event_type: "Recorded process-event type. The process-event inventory rows document allowed event names.",
    message_text: "Visible or research-readable conversation turn text, excluding hidden prompts and raw provider output.",
    provider: "Provider name for an agent call or activity record.",
    model: "Model name recorded for an agent call when available.",
    output_validated: "Whether the stored agent output passed the relevant schema/safety validation.",
    data_dictionary: "Machine-readable variable inventory with row grain, source, missingness, privacy, and limitations."
  };
  return (
    overrides[variable] ??
    `${titleize(variable)} exported from ${table}. See source and generation fields for how it is recorded or derived.`
  );
}

function collectionMethod(table: string, variable: string) {
  const overrides: Record<string, string> = {
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
    event_type: "Recorded by frontend, backend, agent, or workflow services when the named process event occurs.",
    provider: "Recorded by the agent execution audit layer when an LLM or mock provider call is attempted.",
    total_token_count: "Recorded from provider usage metadata when available, or left null when unavailable."
  };
  if (overrides[variable]) return overrides[variable];
  if (variable.endsWith("_count")) return "Calculated by counting matching records or process events within the documented row grain.";
  if (variable.endsWith("_ms")) return "Calculated from recorded timestamps or timing payload fields identified by the timing start/end columns.";
  if (LLM_INTERPRETIVE_COLUMNS.has(variable)) {
    return "Generated by a validated LLM-backed or effective-system interpretation workflow from response packages, process evidence, and approved context; generating agent and prompt/schema versions are recorded in agent/workflow audit fields when available; missing values mean no valid output was recorded.";
  }
  if (sourceType(variable) === "teacher-authored metadata") return "Recorded when a teacher authors or imports assessment/item diagnostic context.";
  if (sourceType(variable) === "externally imported outcome") return "Imported from a teacher-provided summative outcome batch and linked by the validated import workflow.";
  if (sourceType(variable) === "system configuration") return "Generated by the export/runtime service from version, snapshot, or application provenance metadata.";
  if (table.startsWith("prisma.")) return "Persisted by application services in the normalized database; see the model and field name for the owning workflow.";
  return "Read from persisted relational records or safe flattened payload fields for the documented row grain.";
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

function timingStart(variable: string) {
  if (variable === "time_to_first_action_ms") return "item_presented";
  if (variable === "time_to_first_option_selection_ms") return "item_started_at or item_presented";
  if (variable === "reasoning_prompt_to_submission_ms") return "reasoning_prompted";
  if (variable === "confidence_prompt_to_selection_ms") return "confidence_prompted";
  if (variable === "last_action_to_submission_ms") return "last_student_action";
  if (variable === "elapsed_session_time_ms") return "started_at";
  return "";
}

function timingEnd(variable: string) {
  if (variable === "time_to_first_action_ms") return "first qualifying student action";
  if (variable === "time_to_first_option_selection_ms") return "first_option_selected_at";
  if (variable === "reasoning_prompt_to_submission_ms") return "reasoning_submitted_at";
  if (variable === "confidence_prompt_to_selection_ms") return "confidence_selected_at";
  if (variable === "last_action_to_submission_ms") return "item_submitted_at";
  if (variable === "elapsed_session_time_ms") return "completed_at or last_activity_at";
  return "";
}

export function analysisReadyColumnsByTable() {
  return TABLE_COLUMNS;
}

export function buildAnalysisReadyDictionaryEntries(): DataDictionaryEntry[] {
  const entries: DataDictionaryEntry[] = [];
  for (const [tableName, columns] of Object.entries(TABLE_COLUMNS)) {
    for (const variable of columns) {
      entries.push({
        category: categoryFor(tableName, variable),
        table_name: tableName,
        variable_name: variable,
        display_name: titleize(variable),
        definition: definition(tableName, variable),
        row_grain: ROW_GRAINS[tableName as AnalysisReadyTableName] ?? "classified variable",
        data_type: guessDataType(variable),
        unit: variable.endsWith("_ms") ? "milliseconds" : variable.endsWith("_count") ? "count" : "",
        allowed_values:
          variable === "confidence_rating"
            ? "low; medium; high"
            : variable === "actor_type"
              ? "student; agent; system; orchestrator; teacher_researcher"
              : variable === "event_type"
                ? "see process_event_type inventory rows"
                : "",
        nullable: variable.startsWith("export_") || variable.endsWith("_public_id") ? "false" : "true",
        missing_value_meaning:
          "Empty cell means unavailable, not recorded, not generated, or not applicable as qualified by adjacent status/limitation fields.",
        zero_value_meaning: variable.endsWith("_count") ? "Instrumented count was evaluated and the event did not occur." : "",
        source_type: sourceType(variable),
        source_table_or_event: tableName,
        collection_or_generation_method: collectionMethod(tableName, variable),
        calculation_formula:
          variable.endsWith("_ms") && timingStart(variable) && timingEnd(variable)
            ? `${timingEnd(variable)} minus ${timingStart(variable)}`
            : "",
        timing_start_event: timingStart(variable),
        timing_end_event: timingEnd(variable),
        aggregation_rule: variable.endsWith("_count") ? "Count matching records/events within the row grain." : "",
        attempt_policy: "Attempts remain separate by session_public_id and attempt_number.",
        version_binding:
          variable.includes("snapshot") || variable.includes("context") || variable.includes("schema")
            ? "Bound to exported snapshot/context/schema metadata."
            : "",
        interpretation_guidance: interpretationGuidance(variable),
        interpretation_caution: interpretationCaution(variable),
        privacy_level: privacyLevel(variable),
        export_tier: exportTier(tableName, variable),
        example_value: "",
        deprecated: "false",
        notes: RESTRICTED_COLUMNS.has(variable)
          ? "Excluded from default research dataset exports unless explicitly requested in restricted research mode."
          : ""
      });
    }
  }

  for (const eventType of processEventTypes) {
    entries.push({
      category: "Process and response data",
      table_name: "process_event_type_inventory",
      variable_name: eventType,
      display_name: titleize(eventType),
      definition: `Process event type '${eventType}' defined by the application domain enum.`,
      row_grain: "one row per defined process-event type",
      data_type: "enum value",
      unit: "",
      allowed_values: eventType,
      nullable: "false",
      missing_value_meaning: "The event type may be absent from a dataset when no matching event occurred.",
      zero_value_meaning: "A count of zero means no matching event occurred in the export scope.",
      source_type: "directly recorded",
      source_table_or_event: "process_events.event_type",
      collection_or_generation_method:
        `Logged by frontend, backend, agent, or workflow services when the ${eventType} process event occurs; payload fields are flattened only when allow-listed.`,
      calculation_formula: "",
      timing_start_event: "",
      timing_end_event: "",
      aggregation_rule: "Counts are scoped by session, item, or export query when used in derived variables.",
      attempt_policy: "Events remain scoped to their session_public_id.",
      version_binding: "Domain enum at export time.",
      interpretation_guidance:
        "Use as directly recorded process context within session/item scope. Event presence or absence alone is not a learner trait or misconduct finding.",
      interpretation_caution: "Process events are context signals and do not prove misconduct or stable traits.",
      privacy_level: "ordinary teacher data",
      export_tier: "research_dataset",
      example_value: eventType,
      deprecated: "false",
      notes: ""
    });
  }

  for (const entry of prismaFieldClassificationEntries()) {
    entries.push(entry);
  }

  return entries.sort((left, right) =>
    `${left.table_name}.${left.variable_name}`.localeCompare(`${right.table_name}.${right.variable_name}`)
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

function prismaFieldExportTier(field: string) {
  if (/password|access_code|token_hash|session|cookie|secret|database_url/i.test(field)) {
    return "never_exported";
  }
  if (/^id$|_db_id$|hash$|_hash$|raw_output|input_payload|raw_provider|prompt_hash/i.test(field)) {
    return "advanced_archive_only";
  }
  if (/correct_option|correctness|distractor|misconception|diagnostic_focus|teacher_llm/i.test(field)) {
    return "restricted_research_dataset";
  }
  return "research_dataset";
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

export function prismaFieldClassificationEntries(): DataDictionaryEntry[] {
  return Object.entries(RESEARCH_RELEVANT_MODEL_FIELDS).flatMap(([modelName, fields]) =>
    fields.map((field) => ({
      category: categoryFor(`prisma.${modelName}`, field),
      table_name: `prisma.${modelName}`,
      variable_name: field,
      display_name: `${modelName}.${field}`,
      definition: `Captured Prisma field ${modelName}.${field}. The export tier documents whether it is exported, full-archive-only, restricted, or never exportable.`,
      row_grain: "one row per captured Prisma model field",
      data_type: guessDataType(field),
      unit: field.endsWith("_ms") ? "milliseconds" : field.endsWith("_count") ? "count" : "",
      allowed_values: "",
      nullable: "see Prisma schema",
      missing_value_meaning: "See Prisma schema nullability and adjacent status fields.",
      zero_value_meaning: field.endsWith("_count") ? "Instrumented count was evaluated and did not occur." : "",
      source_type: prismaFieldExportTier(field) === "never_exported"
        ? "secret credential field"
        : prismaFieldExportTier(field) === "advanced_archive_only" || prismaFieldExportTier(field) === "restricted_research_dataset"
          ? "internal audit or restricted field"
          : "directly recorded",
      source_table_or_event: modelName,
      collection_or_generation_method: collectionMethod(`prisma.${modelName}`, field),
      calculation_formula: "",
      timing_start_event: "",
      timing_end_event: "",
      aggregation_rule: "",
      attempt_policy: "Session-scoped fields remain separated by session_public_id and attempt_number where applicable.",
      version_binding: "",
      interpretation_guidance: interpretationGuidance(field),
      interpretation_caution: interpretationCaution(field),
      privacy_level: prismaFieldPrivacy(field),
      export_tier: prismaFieldExportTier(field),
      example_value: "",
      deprecated: "false",
      notes: prismaFieldExportTier(field) === "never_exported" ? "Classified to prevent accidental export." : ""
    }))
  );
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

export type DictionaryFilters = {
  search?: string;
  category?: string;
  table_name?: string;
  source_type?: string;
  privacy_level?: string;
  export_tier?: string;
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

function fieldFamily(entry: DataDictionaryEntry) {
  const combined = `${entry.category} ${entry.variable_name} ${entry.source_type}`.toLowerCase();
  if (/llm|agent|provider|model|prompt|workflow/.test(combined)) return "LLM fields";
  if (/time|timing|latency|duration|pause|idle|hidden|typing|_ms/.test(combined)) return "Timing fields";
  if (/process|event|response|reasoning|confidence|selected|tempting|turn/.test(combined)) return "Process/response fields";
  return "Other fields";
}

function derivationKind(entry: DataDictionaryEntry) {
  if (/derived|calculated|count|timestamp|LLM|interpretation|system configuration|externally imported/i.test(entry.source_type)) {
    return "derived_or_generated";
  }
  return "directly_recorded";
}

export function dictionaryFilterOptions(entries = buildAnalysisReadyDictionaryEntries()) {
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  return {
    page_sizes: [...DATA_DICTIONARY_PAGE_SIZES],
    categories: [...DATA_DICTIONARY_CATEGORIES],
    table_names: unique(entries.map((entry) => entry.table_name)),
    source_types: unique(entries.map((entry) => entry.source_type)),
    privacy_levels: unique(entries.map((entry) => entry.privacy_level)),
    export_tiers: unique(entries.map((entry) => entry.export_tier)),
    derivations: ["directly_recorded", "derived_or_generated"],
    field_families: ["Process/response fields", "Timing fields", "LLM fields", "Other fields"],
    deprecated_values: ["false", "true"]
  };
}

export function filterDictionaryEntries(entries: DataDictionaryEntry[], filters: DictionaryFilters) {
  const search = filters.search?.trim().toLowerCase() ?? "";
  return entries
    .filter((entry) => !filters.category || filters.category === "all" || entry.category === filters.category)
    .filter((entry) => !filters.table_name || filters.table_name === "all" || entry.table_name === filters.table_name)
    .filter((entry) => !filters.source_type || filters.source_type === "all" || entry.source_type === filters.source_type)
    .filter((entry) => !filters.privacy_level || filters.privacy_level === "all" || entry.privacy_level === filters.privacy_level)
    .filter((entry) => !filters.export_tier || filters.export_tier === "all" || entry.export_tier === filters.export_tier)
    .filter((entry) => !filters.deprecated || filters.deprecated === "all" || entry.deprecated === filters.deprecated)
    .filter((entry) => !filters.derivation || filters.derivation === "all" || derivationKind(entry) === filters.derivation)
    .filter((entry) => !filters.field_family || filters.field_family === "all" || fieldFamily(entry) === filters.field_family)
    .filter((entry) => {
      if (!search) return true;
      return [
        entry.category,
        entry.table_name,
        entry.variable_name,
        entry.display_name,
        entry.definition,
        entry.collection_or_generation_method,
        entry.source_table_or_event,
        entry.source_type
      ].some((value) => value.toLowerCase().includes(search));
    });
}

export function paginateDictionaryEntries(entries: DataDictionaryEntry[], query: DictionaryPageQuery) {
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

function countBy(entries: DataDictionaryEntry[], key: keyof DataDictionaryEntry) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry[key], (counts.get(entry[key]) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}

export function dictionaryStats(entries = buildAnalysisReadyDictionaryEntries()) {
  const byTier = new Map<string, number>();
  const byPrivacy = new Map<string, number>();
  for (const entry of entries) {
    byTier.set(entry.export_tier, (byTier.get(entry.export_tier) ?? 0) + 1);
    byPrivacy.set(entry.privacy_level, (byPrivacy.get(entry.privacy_level) ?? 0) + 1);
  }
  return {
    variable_count: entries.length,
    process_event_type_count: processEventTypes.length,
    by_category: countBy(entries, "category"),
    by_export_tier: Object.fromEntries([...byTier.entries()].sort()),
    by_privacy_level: Object.fromEntries([...byPrivacy.entries()].sort()),
    by_source_type: countBy(entries, "source_type")
  };
}
