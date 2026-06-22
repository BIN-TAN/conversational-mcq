import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { EvalServiceError } from "./errors";

export async function requireEvalTeacher() {
  return requireRoleApi("teacher_researcher");
}

export function evalRouteError(error: unknown): NextResponse {
  if (error instanceof EvalServiceError) {
    return jsonApiError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return jsonApiError("validation_failed", "Request validation failed.", 400, {
      issues: error.issues
    });
  }

  console.error(error);

  return jsonApiError("internal_error", "Evaluation harness request failed.", 500);
}

export function queryObjectFromUrl(url: string) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}
