"use client";

import {
  apiRequest,
  errorFromUnknown
} from "@/components/teacher-content/api";
import type {
  AssessmentOption,
  ExportJobsResponse,
  OutcomeNamesResponse,
  ResearchExportReadinessResponse,
  SummativeImportPreview
} from "./types";

export { errorFromUnknown };

export function previewSummativeImport(input: {
  csv_text: string;
  source_file_name?: string;
}) {
  return apiRequest<SummativeImportPreview>(
    "/api/teacher/summative-outcomes/import/preview",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function commitSummativeImport(batchPublicId: string) {
  return apiRequest<{ batch_public_id: string; status: string; committed_rows: number }>(
    `/api/teacher/summative-outcomes/import/${batchPublicId}/commit`,
    { method: "POST" }
  );
}

export function fetchImportBatches() {
  return apiRequest<import("./types").ImportBatchesResponse>(
    "/api/teacher/summative-outcomes/import-batches",
    { method: "GET" }
  );
}

export function fetchOutcomeNames() {
  return apiRequest<OutcomeNamesResponse>("/api/teacher/summative-outcomes/outcome-names", {
    method: "GET"
  });
}

export function fetchAssessments() {
  return apiRequest<{ assessments: AssessmentOption[] }>("/api/teacher/assessments", {
    method: "GET"
  });
}

export function createMasterExport(input: {
  assessment_public_id?: string;
  session_status?: string[];
  include_incomplete_sessions: boolean;
  primary_outcome_name?: string;
  include_raw_json_columns: boolean;
  spreadsheet_safe_text: boolean;
}) {
  return apiRequest<{ export_job: import("./types").ExportJob }>(
    "/api/teacher/export/master-csv",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function fetchExportJobs() {
  return apiRequest<ExportJobsResponse>("/api/teacher/export/jobs", {
    method: "GET"
  });
}

export function fetchResearchExportReadiness() {
  return apiRequest<ResearchExportReadinessResponse>("/api/teacher/research-data/readiness", {
    method: "GET"
  });
}
