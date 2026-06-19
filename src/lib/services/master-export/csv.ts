import { stringify } from "csv-stringify/sync";
import { stripInternalKeys } from "@/lib/services/teacher-review/serializers";

export const MASTER_EXPORT_SCHEMA_VERSION = "1.0.0";

export const MASTER_EXPORT_COLUMNS = [
  "export_generated_at",
  "export_schema_version",
  "row_type",
  "record_key",
  "spreadsheet_formula_sanitization_applied",
  "user_id",
  "student_display_name",
  "session_id",
  "assessment_id",
  "assessment_title",
  "attempt_number",
  "session_status",
  "current_phase",
  "needs_review",
  "needs_review_reason",
  "session_started_at",
  "session_last_activity_at",
  "session_completed_at",
  "student_chose_exit",
  "concept_unit_id",
  "concept_unit_title",
  "concept_unit_order",
  "concept_unit_status",
  "initial_started_at",
  "initial_completed_at",
  "followup_started_at",
  "followup_completed_at",
  "followup_status",
  "followup_round_count",
  "completed_initial_item_set",
  "completed_followup",
  "item_id",
  "item_order",
  "item_stem",
  "item_version_snapshot",
  "options_snapshot_json",
  "selected_option",
  "correct_option",
  "correctness",
  "reasoning_text",
  "confidence_rating",
  "item_response_time_ms",
  "item_started_at",
  "item_submitted_at",
  "skipped_item",
  "skipped_reasoning",
  "skipped_confidence",
  "revision_count",
  "missing_evidence_repair_offered",
  "response_finalized",
  "page_switch_count",
  "long_pause_count",
  "inactivity_count",
  "navigation_event_count",
  "invalid_help_request_count",
  "prompt_injection_attempt_count",
  "procedural_clarification_count",
  "emotional_response_count",
  "reasoning_revision_count",
  "option_revision_count",
  "validation_failure_count",
  "agent_retry_count",
  "followup_turn_count",
  "initial_conversation_transcript_text",
  "followup_conversation_transcript_text",
  "full_conversation_transcript_text",
  "conversation_turns_json",
  "process_events_json",
  "response_packages_json",
  "initial_ability_profile",
  "latest_ability_profile",
  "ability_pattern_flags_latest",
  "initial_engagement_profile",
  "latest_engagement_profile",
  "engagement_pattern_flags_latest",
  "initial_integrated_diagnostic_profile",
  "latest_integrated_diagnostic_profile",
  "integrated_profile_confidence_latest",
  "integrated_profile_rationale_latest",
  "evidence_sufficiency_latest",
  "confidence_alignment_latest",
  "independence_interpretability_latest",
  "misconception_indicators_latest",
  "reasoning_quality_summary_latest",
  "engagement_summary_latest",
  "process_interpretation_cautions_latest",
  "profile_change_count",
  "profile_history_json",
  "integrated_profile_history_json",
  "initial_formative_value",
  "latest_formative_value",
  "formative_action_plan_latest",
  "formative_value_change_count",
  "formative_value_history_json",
  "followup_rounds_json",
  "agent_model_names",
  "agent_versions",
  "prompt_versions",
  "schema_versions",
  "agent_call_count",
  "agent_validation_failure_count",
  "agent_calls_json",
  "primary_summative_outcome_name",
  "primary_summative_outcome_score",
  "primary_summative_outcome_max_score",
  "primary_summative_outcome_percent",
  "primary_summative_assessment_date",
  "summative_outcomes_json"
] as const;

export type MasterExportColumn = (typeof MASTER_EXPORT_COLUMNS)[number];
export type MasterExportRow = Record<MasterExportColumn, string | number | boolean | null>;

const formulaPrefixes = ["=", "+", "-", "@"];

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)])
  );
}

export function stableJson(value: unknown) {
  return JSON.stringify(sortValue(stripInternalKeys(value)));
}

export function sanitizeSpreadsheetText(value: string) {
  if (!value) {
    return { value, changed: false };
  }

  if (formulaPrefixes.some((prefix) => value.startsWith(prefix))) {
    return { value: `'${value}`, changed: true };
  }

  return { value, changed: false };
}

const textColumns = new Set<MasterExportColumn>([
  "student_display_name",
  "assessment_title",
  "needs_review_reason",
  "concept_unit_title",
  "item_stem",
  "options_snapshot_json",
  "reasoning_text",
  "initial_conversation_transcript_text",
  "followup_conversation_transcript_text",
  "full_conversation_transcript_text",
  "conversation_turns_json",
  "process_events_json",
  "response_packages_json",
  "integrated_profile_rationale_latest",
  "misconception_indicators_latest",
  "reasoning_quality_summary_latest",
  "engagement_summary_latest",
  "process_interpretation_cautions_latest",
  "profile_history_json",
  "integrated_profile_history_json",
  "formative_action_plan_latest",
  "formative_value_history_json",
  "followup_rounds_json",
  "agent_calls_json",
  "summative_outcomes_json"
]);

export function serializeMasterCsv(
  rows: MasterExportRow[],
  options: { spreadsheet_safe_text: boolean }
) {
  const preparedRows = rows.map((row) => {
    let sanitized = false;
    const output: Record<string, string | number | boolean> = {};

    for (const column of MASTER_EXPORT_COLUMNS) {
      const rawValue = row[column];
      let value = rawValue === null || rawValue === undefined ? "" : rawValue;

      if (options.spreadsheet_safe_text && typeof value === "string" && textColumns.has(column)) {
        const result = sanitizeSpreadsheetText(value);
        value = result.value;
        sanitized = sanitized || result.changed;
      }

      output[column] = typeof value === "boolean" ? String(value) : value;
    }

    output.spreadsheet_formula_sanitization_applied = String(sanitized);
    return output;
  });

  return stringify(preparedRows, {
    header: true,
    columns: [...MASTER_EXPORT_COLUMNS],
    bom: true,
    record_delimiter: "windows"
  });
}
