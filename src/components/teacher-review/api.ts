"use client";

import {
  apiRequest,
  errorFromUnknown
} from "@/components/teacher-content/api";
import type {
  ItemResponsesResponse,
  ProcessEventsResponse,
  ResponsePackagesResponse,
  RunPlanningResponse,
  RunProfilingResponse,
  SessionDetailResponse,
  StartFollowupResponse,
  SessionListResponse,
  StructuredApiError,
  TranscriptResponse
} from "./types";

export { errorFromUnknown };
export type { StructuredApiError };

function queryString(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function fetchTeacherSessions(params: Record<string, string | number | boolean | undefined>) {
  return apiRequest<SessionListResponse>(`/api/teacher/sessions${queryString(params)}`, {
    method: "GET"
  });
}

export function fetchSessionDetail(sessionPublicId: string) {
  return apiRequest<SessionDetailResponse>(`/api/teacher/sessions/${sessionPublicId}`, {
    method: "GET"
  });
}

export function fetchItemResponses(sessionPublicId: string) {
  return apiRequest<ItemResponsesResponse>(
    `/api/teacher/sessions/${sessionPublicId}/item-responses`,
    { method: "GET" }
  );
}

export function fetchTranscript(sessionPublicId: string) {
  return apiRequest<TranscriptResponse>(
    `/api/teacher/sessions/${sessionPublicId}/transcript`,
    { method: "GET" }
  );
}

export function fetchProcessEvents(
  sessionPublicId: string,
  params: Record<string, string | number | boolean | undefined> = {}
) {
  return apiRequest<ProcessEventsResponse>(
    `/api/teacher/sessions/${sessionPublicId}/process-events${queryString(params)}`,
    { method: "GET" }
  );
}

export function fetchResponsePackages(sessionPublicId: string) {
  return apiRequest<ResponsePackagesResponse>(
    `/api/teacher/sessions/${sessionPublicId}/response-packages`,
    { method: "GET" }
  );
}

export function runStudentProfiling(sessionPublicId: string, conceptUnitPublicId: string) {
  return apiRequest<RunProfilingResponse>(
    `/api/teacher/sessions/${sessionPublicId}/concept-units/${conceptUnitPublicId}/run-profiling`,
    { method: "POST" }
  );
}

export function runFormativePlanning(sessionPublicId: string, conceptUnitPublicId: string) {
  return apiRequest<RunPlanningResponse>(
    `/api/teacher/sessions/${sessionPublicId}/concept-units/${conceptUnitPublicId}/run-planning`,
    { method: "POST" }
  );
}

export function startFollowup(sessionPublicId: string, conceptUnitPublicId: string) {
  return apiRequest<StartFollowupResponse>(
    `/api/teacher/sessions/${sessionPublicId}/concept-units/${conceptUnitPublicId}/start-followup`,
    { method: "POST" }
  );
}

export function pauseAutomation(sessionPublicId: string) {
  return apiRequest<{ result: { status: string; override_public_id: string } }>(
    `/api/teacher/sessions/${sessionPublicId}/automation/pause`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function resumeAutomation(sessionPublicId: string) {
  return apiRequest<{ result: { status: string; override_public_id: string } }>(
    `/api/teacher/sessions/${sessionPublicId}/automation/resume`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function retryAutomation(sessionPublicId: string) {
  return apiRequest<{ result: { status: string; override_public_id: string; job_public_id: string } }>(
    `/api/teacher/sessions/${sessionPublicId}/automation/retry`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function stopAutomationFollowup(sessionPublicId: string, conceptUnitPublicId?: string) {
  return apiRequest<{ result: { status: string; override_public_id: string } }>(
    `/api/teacher/sessions/${sessionPublicId}/automation/stop-followup`,
    {
      method: "POST",
      body: JSON.stringify({ concept_unit_public_id: conceptUnitPublicId })
    }
  );
}
