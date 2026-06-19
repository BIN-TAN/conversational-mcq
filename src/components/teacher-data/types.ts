import type { StructuredApiError } from "@/components/teacher-content/types";

export type { StructuredApiError };

export type SummativeImportPreview = {
  batch_public_id: string;
  source_file_name: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  conflicting_rows: number;
  unmatched_user_rows: number;
  preview_rows: Array<Record<string, unknown>>;
  validation_errors: Array<Record<string, unknown>>;
};

export type ImportBatchSummary = {
  batch_public_id: string;
  source_file_name: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  conflicting_rows: number;
  unmatched_user_rows: number;
  committed_rows: number;
  created_at: string | null;
  committed_at: string | null;
};

export type ImportBatchesResponse = {
  import_batches: ImportBatchSummary[];
};

export type OutcomeNamesResponse = {
  outcome_names: Array<{
    outcome_name: string;
    active_outcome_count: number;
  }>;
};

export type ExportJob = {
  export_public_id: string;
  status: string;
  file_name: string | null;
  row_count: number | null;
  options: unknown;
  export_schema_version: string | null;
  created_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  error_message: string | null;
  download_url: string | null;
};

export type ExportJobsResponse = {
  export_jobs: ExportJob[];
};

export type AssessmentOption = {
  assessment_public_id: string;
  title: string;
  description: string | null;
  status: string;
};
