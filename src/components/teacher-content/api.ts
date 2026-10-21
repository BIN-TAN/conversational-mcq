"use client";

import type {
  ApiErrorResponse,
  ArchivedAssessmentBatchDeletionPreview,
  ArchivedAssessmentBatchDeletionSummary,
  StructuredApiError
} from "./types";
import { isNetworkFailure, SERVER_UNAVAILABLE_MESSAGE, SERVER_UNREACHABLE_MESSAGE } from "@/components/server-unavailable-message";

export class ClientApiError extends Error {
  code: string;
  details: unknown;
  status: number;

  constructor(error: StructuredApiError, status: number) {
    super(error.message);
    this.name = "ClientApiError";
    this.code = error.code;
    this.details = error.details;
    this.status = status;
  }
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorResponse).error?.message === "string"
  );
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: isFormData
        ? init?.headers
        : {
            "Content-Type": "application/json",
            ...(init?.headers ?? {})
          }
    });
  } catch (caught) {
    // The request never reached the server: no connection, or the server was restarting.
    if (isNetworkFailure(caught)) {
      throw new ClientApiError({ code: "network_error", message: SERVER_UNREACHABLE_MESSAGE }, 0);
    }
    throw caught;
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      // A web page in place of data: the hosting platform answered while the application
      // was restarting or unreachable.
      throw new ClientApiError(
        {
          code: "unexpected_response",
          message: SERVER_UNAVAILABLE_MESSAGE,
          details: { status: response.status }
        },
        response.status
      );
    }
  }

  if (!response.ok) {
    if (isApiErrorResponse(payload)) {
      throw new ClientApiError(payload.error, response.status);
    }

    throw new ClientApiError(
      {
        code: "request_failed",
        message: "Something went wrong and the request was not completed. Try again in a moment.",
        details: payload
      },
      response.status
    );
  }

  return payload as T;
}

export function errorFromUnknown(error: unknown): StructuredApiError {
  if (error instanceof ClientApiError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  return {
    code: "client_error",
    message: error instanceof Error ? error.message : "The request could not be completed."
  };
}

export function previewArchivedAssessmentBatchDeletion(assessmentPublicIds: string[]) {
  return apiRequest<ArchivedAssessmentBatchDeletionPreview>(
    "/api/teacher/assessments/batch-deletion/preview",
    {
      method: "POST",
      body: JSON.stringify({ assessment_public_ids: assessmentPublicIds })
    }
  );
}

export function deleteArchivedAssessmentBatch(input: {
  assessment_public_ids: string[];
  selection_fingerprint: string;
  deletion_mode: "unused_assessment" | "assessment_and_all_data";
  delete_confirmation: string;
  confirm_delete_all_assessment_data?: boolean;
}) {
  return apiRequest<ArchivedAssessmentBatchDeletionSummary>(
    "/api/teacher/assessments/batch-deletion",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}
