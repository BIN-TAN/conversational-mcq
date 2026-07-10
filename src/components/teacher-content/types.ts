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
  created_at: string;
  updated_at: string;
};

export type AssessmentDetail = AssessmentSummary & {
  concept_units: ConceptUnitSummary[];
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

export type ItemDetail = {
  item_public_id: string;
  concept_unit_public_id?: string;
  item_order: number;
  item_stem: string;
  options: unknown;
  correct_option: string;
  distractor_rationales: unknown;
  expected_reasoning_patterns: unknown;
  possible_misconception_indicators: unknown;
  administration_rules: unknown;
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
