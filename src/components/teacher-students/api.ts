"use client";

import { apiRequest, errorFromUnknown } from "@/components/teacher-content/api";
import type {
  CredentialResponse,
  RosterImportBatchesResponse,
  RosterPreview,
  StudentDetailResponse,
  StudentListResponse
} from "./types";

export { errorFromUnknown };

export function fetchStudents(input: {
  search?: string;
  account_status?: string;
  has_sessions?: string;
  sort?: string;
  direction?: "asc" | "desc";
  page?: number;
  page_size?: number;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  return apiRequest<StudentListResponse>(`/api/teacher/students?${params.toString()}`);
}

export function createStudent(input: { user_id: string; display_name?: string }) {
  return apiRequest<
    {
      student: {
        user_id: string;
        display_name: string | null;
        account_status: string;
        created_at: string | null;
      };
    } & CredentialResponse
  >("/api/teacher/students", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function fetchStudent(userId: string) {
  return apiRequest<StudentDetailResponse>(`/api/teacher/students/${encodeURIComponent(userId)}`);
}

export function updateStudentDisplayName(userId: string, displayName: string) {
  return apiRequest<{ student: { user_id: string; display_name: string | null } }>(
    `/api/teacher/students/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ display_name: displayName })
    }
  );
}

export function resetStudentAccessCode(userId: string) {
  return apiRequest<
    {
      student: {
        user_id: string;
        display_name: string | null;
        account_status: string;
        credential_updated_at: string | null;
      };
    } & CredentialResponse
  >(`/api/teacher/students/${encodeURIComponent(userId)}/reset-access-code`, {
    method: "POST"
  });
}

export function deactivateStudent(userId: string) {
  return apiRequest<{ student: { user_id: string; account_status: string } }>(
    `/api/teacher/students/${encodeURIComponent(userId)}/deactivate`,
    { method: "POST" }
  );
}

export function reactivateStudent(userId: string) {
  return apiRequest<{ student: { user_id: string; account_status: string } }>(
    `/api/teacher/students/${encodeURIComponent(userId)}/reactivate`,
    { method: "POST" }
  );
}

export function previewRoster(input: { csv_text: string; source_file_name?: string }) {
  return apiRequest<RosterPreview>("/api/teacher/students/import/preview", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function commitRoster(batchPublicId: string, applyDisplayNameUpdates: boolean) {
  return apiRequest<
    {
      batch_public_id: string;
      status: string;
      committed_new_students: number;
      committed_display_name_updates: number;
      already_committed: boolean;
    } & CredentialResponse
  >(`/api/teacher/students/import/${batchPublicId}/commit`, {
    method: "POST",
    body: JSON.stringify({ apply_display_name_updates: applyDisplayNameUpdates })
  });
}

export function fetchRosterImportBatches() {
  return apiRequest<RosterImportBatchesResponse>("/api/teacher/students/import-batches");
}
