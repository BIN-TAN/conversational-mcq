export type ContentStatus = "draft" | "published" | "archived";

export type ContentState =
  | "draft_editable"
  | "published_unused"
  | "locked_after_student_session"
  | "archived";

export type ContentGovernanceFields = {
  content_state: ContentState;
  is_content_locked: boolean;
  content_lock_reason: string | null;
  has_student_sessions: boolean;
};

export type StructuredApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiErrorResponse = {
  error: StructuredApiError;
};

export type AssessmentSummary = ContentGovernanceFields & {
  assessment_public_id: string;
  title: string;
  description: string | null;
  diagnostic_focus: string | null;
  folder_label: string | null;
  folder_order_index: number;
  assessment_order_index: number;
  status: ContentStatus;
  workflow_mode: "manual_review" | "automatic";
  response_collection_mode: "deterministic" | "llm_assisted";
  release_at: string | null;
  close_at: string | null;
  release_at_course_time: string | null;
  close_at_course_time: string | null;
  release_at_course_time_input: string;
  close_at_course_time_input: string;
  course_timezone: string;
  concept_unit_count?: number;
  item_count?: number;
  assessment_session_count?: number;
  created_at: string;
  updated_at: string;
};

export type AssessmentDetail = AssessmentSummary & {
  concept_units: ConceptUnitSummary[];
  mini_test_items?: ItemDetail[];
};

export type ConceptUnitSummary = ContentGovernanceFields & {
  concept_unit_public_id: string;
  assessment_public_id?: string;
  title: string;
  learning_objective: string;
  related_concept_description: string;
  administration_rules: unknown;
  order_index: number;
  status: ContentStatus;
  version: number;
  item_count?: number;
  candidate_item_count?: number;
  included_active_item_count?: number;
  created_at: string;
  updated_at: string;
};

export type ConceptUnitDetail = ConceptUnitSummary & {
  items: ItemDetail[];
};

export type ItemVerificationFinding = {
  issue_code: string;
  item_public_id?: string;
  location: string;
  option_label?: string;
  brief_explanation: string;
};

export type ItemVerificationRun = {
  verification_public_id: string;
  status: string;
  verification_status: string;
  is_current: boolean;
  is_stale: boolean;
  content_fingerprint: string;
  concept_unit_version: number;
  warning_count: number;
  teacher_review_required: boolean;
  acknowledged: boolean;
  acknowledged_at: string | null;
  acknowledged_by: { user_id: string; display_name: string | null } | null;
  agent_call: {
    provider: string;
    model_name: string;
    prompt_version: string;
    schema_version: string;
    call_status: string;
    live_call_allowed: boolean;
  } | null;
  output: {
    verification_status: string;
    set_level_findings: ItemVerificationFinding[];
    item_results: Array<{
      item_public_id: string;
      findings: ItemVerificationFinding[];
      teacher_review_required: boolean;
    }>;
    teacher_review_required: boolean;
  } | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
};

export type ItemVerificationStatus = {
  content_fingerprint: string;
  deterministic_validation: PublishValidation;
  latest_verification: ItemVerificationRun | null;
  content_state: ContentGovernanceFields;
};

export type ItemOption = {
  label: string;
  text: string;
};

export type ItemMediaAsset = {
  media_public_id: string;
  placement: "item_stem" | "option";
  option_label: string | null;
  media_type: "image" | "video" | "reference_link";
  source_type: "uploaded" | "external_url";
  url: string | null;
  title: string | null;
  alt_text_or_description: string;
  student_alt_text?: string | null;
  teacher_llm_media_description?: string | null;
  caption: string | null;
  transcript_or_content_summary: string | null;
  source_attribution: string | null;
  media_context_hash: string;
  media_version: number;
  order_index: number;
  active: boolean;
};

export type ItemDetail = {
  item_public_id: string;
  concept_unit_public_id?: string;
  assessment_public_id?: string;
  assessment_title?: string;
  item_order: number;
  item_stem: string;
  options: unknown;
  correct_option: string;
  distractor_rationales: unknown;
  expected_reasoning_patterns: unknown;
  possible_misconception_indicators: unknown;
  administration_rules: unknown;
  media_assets: ItemMediaAsset[];
  media_present_count?: number;
  media_type_summary?: string;
  llm_media_context?: unknown;
  included_in_published_set: boolean;
  status: ContentStatus;
  concept_unit_status?: ContentStatus;
  content_state?: ContentState;
  is_content_locked?: boolean;
  content_lock_reason?: string | null;
  has_student_sessions?: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type PublishValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type PublishValidation = {
  ok: boolean;
  active_item_count?: number;
  included_active_item_count?: number;
  candidate_item_count?: number;
  errors?: PublishValidationIssue[];
  warnings?: PublishValidationIssue[];
};

export type ImportResult = {
  validation: {
    ok: boolean;
    errors: PublishValidationIssue[];
  };
  assessment: AssessmentSummary;
  concept_units: Array<ConceptUnitSummary & { items: ItemDetail[] }>;
};

export type McqImportCandidate = {
  candidate_public_id: string;
  source_item_number: number;
  source_location: string;
  source_line_range: { start: number; end: number } | null;
  item_label: string | null;
  stem: string;
  options: ItemOption[];
  imported_key: string | null;
  llm_suggested_key: string | null;
  teacher_confirmed_key: string | null;
  target_reasoning_note: string | null;
  strong_reasoning_should_mention: string | null;
  distractor_diagnostic_notes: string | null;
  media_assets: unknown[];
  missing_fields: string[];
  parsing_confidence: number;
  issue_flags: string[];
  duplicate_warnings: Array<{
    scope: "batch" | "assessment" | "teacher_owned";
    existing_assessment_public_id: string | null;
    existing_assessment_title: string | null;
    existing_item_public_id: string | null;
    message: string;
  }>;
  status: string;
  import_selected: boolean;
  original_source_text: string;
  normalized_changed_wording: boolean;
  normalized_diff_summary: string | null;
  suggestion?: unknown;
  suggestion_decisions?: Record<string, { decision: string; edited_value?: string | null }>;
  imported_item_public_id?: string | null;
};

export type McqImportBatch = {
  batch_public_id: string;
  source_type: string;
  source_file_name: string | null;
  source_checksum: string;
  status: string;
  candidate_count: number;
  imported_count: number;
  rejected_count: number;
  key_missing_count: number;
  llm_suggestion_count: number;
  duplicate_count: number;
  validation_summary: unknown;
  candidates: McqImportCandidate[];
  suggestion_payload: unknown | null;
  import_summary: unknown | null;
  created_at: string;
  committed_at: string | null;
};

export type McqImportPreviewResponse = {
  batch: McqImportBatch;
  supported_sources: string[];
  template_url: string;
};

export type McqImportBatchResponse = {
  batch: McqImportBatch;
};

export type McqImportCommitResponse = {
  batch: McqImportBatch;
  imported_item_public_ids: string[];
  imported_count: number;
  blocked_count: number;
  review_imported_items_url: string;
  add_more_items_url: string;
};

export type AssessmentDeletionMode = "unused_assessment" | "assessment_and_all_data";

export type AssessmentDeletionCounts = {
  assessment_count: number;
  concept_unit_count: number;
  item_count: number;
  option_count: number;
  assessment_session_count: number;
  distinct_student_count: number;
  concept_unit_session_count: number;
  item_response_count: number;
  conversation_turn_count: number;
  process_event_count: number;
  response_package_count: number;
  student_profile_count: number;
  formative_decision_count: number;
  followup_round_count: number;
  followup_update_cycle_count: number;
  concept_progression_record_count: number;
  workflow_job_count: number;
  workflow_override_count: number;
  student_action_idempotency_key_count: number;
  activity_runtime_count: number;
  post_activity_evidence_count: number;
  diagnostic_snapshot_count: number;
  agent_call_summary_count: number;
  operational_effective_result_count: number;
  item_verification_run_count: number;
  summative_outcome_count: number;
  import_export_reference_count: number;
};

export type AssessmentDeletionPreview = {
  assessment_public_id: string;
  assessment_title: string;
  status: ContentStatus;
  folder_label: string | null;
  counts: AssessmentDeletionCounts;
  retained_reference_counts: Record<string, number>;
  deletion_modes: {
    unused_assessment: {
      allowed: boolean;
      required_delete_confirmation: "DELETE";
      blocked_reasons: string[];
    };
    assessment_and_all_data: {
      allowed: boolean;
      required_delete_confirmation: "DELETE ALL ASSESSMENT DATA";
      blocked_reasons: string[];
    };
  };
  warnings: string[];
  deletion_limitations: string[];
};

export type AssessmentDeletionSummary = AssessmentDeletionPreview & {
  deletion_event_public_id: string;
  deletion_mode: AssessmentDeletionMode;
  deleted_at: string;
  deleted_counts: AssessmentDeletionCounts;
};
