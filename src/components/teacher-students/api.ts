"use client";

import { apiRequest, errorFromUnknown } from "@/components/teacher-content/api";
import type {
  CredentialResponse,
  RosterImportBatchesResponse,
  RosterPreview,
  StudentDeletionPreview,
  StudentDeletionSummary,
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

export function createStudent(input: {
  user_id: string;
  display_name?: string;
  email?: string;
  temporary_password?: string;
  generate_password?: boolean;
}) {
  return apiRequest<
    {
      student: {
        user_id: string;
        display_name: string | null;
        email: string | null;
        account_status: string;
        must_change_password: boolean;
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

export function updateStudentProfile(userId: string, input: { display_name?: string; email?: string }) {
  return apiRequest<{ student: { user_id: string; display_name: string | null; email: string | null } }>(
    `/api/teacher/students/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export function resetStudentAccessCode(userId: string) {
  return apiRequest<
    {
      student: {
        user_id: string;
        display_name: string | null;
        email: string | null;
        account_status: string;
        must_change_password: boolean;
        credential_updated_at: string | null;
        credential_reset_at: string | null;
      };
    } & CredentialResponse
  >(`/api/teacher/students/${encodeURIComponent(userId)}/reset-access-code`, {
    method: "POST"
  });
}

export function resetStudentPassword(userId: string, input: { temporary_password?: string; generate_password?: boolean } = {}) {
  return apiRequest<
    {
      student: {
        user_id: string;
        display_name: string | null;
        email: string | null;
        account_status: string;
        must_change_password: boolean;
        credential_updated_at: string | null;
        credential_reset_at: string | null;
      };
    } & CredentialResponse
  >(`/api/teacher/students/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify(input)
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

export function previewStudentDeletion(userId: string) {
  return apiRequest<StudentDeletionPreview>(
    `/api/teacher/students/${encodeURIComponent(userId)}/deletion/preview`
  );
}

export function deleteStudentData(
  userId: string,
  input: { student_id: string; delete_confirmation: string }
) {
  return apiRequest<StudentDeletionSummary>(
    `/api/teacher/students/${encodeURIComponent(userId)}/deletion`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
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
