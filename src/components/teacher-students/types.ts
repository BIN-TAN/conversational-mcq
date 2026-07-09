import type { StructuredApiError } from "@/components/teacher-content/types";

export type { StructuredApiError };

export type OneTimeCredential = {
  user_id: string;
  display_name: string | null;
  email?: string | null;
  temporary_access_code: string;
  temporary_password?: string;
};

export type CredentialResponse = {
  one_time_credentials: OneTimeCredential[];
  credential_csv: string;
  credential_warning: string;
};

export type StudentListRow = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  account_status: "active" | "inactive";
  must_change_password: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
  deactivated_at: string | null;
  credential_reset_at: string | null;
  password_changed_at: string | null;
  assessment_session_count: number;
  completed_session_count: number;
  active_session_count: number;
  summative_outcome_count: number;
};

export type StudentListResponse = {
  students: StudentListRow[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

export type StudentDetail = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  account_status: "active" | "inactive";
  must_change_password: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
  deactivated_at: string | null;
  credential_updated_at: string | null;
  credential_reset_at: string | null;
  password_changed_at: string | null;
  assessment_sessions: Array<{
    session_public_id: string;
    assessment_public_id: string;
    assessment_title: string;
    attempt_number: number;
    status: string;
    current_phase: string;
    started_at: string | null;
    last_activity_at: string | null;
    completed_at: string | null;
  }>;
  summative_outcomes: Array<{
    outcome_public_id: string;
    outcome_name: string;
    outcome_score: string;
    max_score: string;
    assessment_date: string | null;
    notes: string | null;
  }>;
  account_events: Array<{
    event_public_id: string;
    event_type: string;
    metadata: unknown;
    created_at: string | null;
    performed_by_user_id: string;
    roster_import_batch: {
      batch_public_id: string;
      source_file_name: string | null;
    } | null;
  }>;
};

export type StudentDetailResponse = {
  student: StudentDetail;
};

export type RosterPreview = {
  batch_public_id: string;
  source_file_name: string | null;
  total_rows: number;
  new_student_rows: number;
  existing_unchanged_rows: number;
  display_name_change_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  role_conflict_rows: number;
  preview_rows: Array<Record<string, unknown>>;
  validation_errors: Array<Record<string, unknown>>;
};

export type RosterImportBatch = {
  batch_public_id: string;
  source_file_name: string | null;
  status: string;
  total_rows: number;
  new_student_rows: number;
  existing_unchanged_rows: number;
  display_name_change_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  role_conflict_rows: number;
  committed_new_students: number;
  committed_display_name_updates: number;
  created_at: string | null;
  committed_at: string | null;
};

export type RosterImportBatchesResponse = {
  import_batches: RosterImportBatch[];
};
