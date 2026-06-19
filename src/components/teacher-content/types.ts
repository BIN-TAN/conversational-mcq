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
};

export type ImportResult = {
  validation: {
    ok: boolean;
    errors: PublishValidationIssue[];
  };
  assessment: AssessmentSummary;
  concept_units: Array<ConceptUnitSummary & { items: ItemDetail[] }>;
};
