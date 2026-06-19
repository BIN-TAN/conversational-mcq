"use client";

import type { ApiErrorResponse, StructuredApiError } from "./types";

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
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    if (isApiErrorResponse(payload)) {
      throw new ClientApiError(payload.error, response.status);
    }

    throw new ClientApiError(
      {
        code: "request_failed",
        message: "The request could not be completed.",
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
