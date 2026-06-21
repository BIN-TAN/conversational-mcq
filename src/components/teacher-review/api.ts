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
