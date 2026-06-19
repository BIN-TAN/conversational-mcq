import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { ContentServiceError } from "./errors";

export async function requireTeacherResearcher() {
  return requireRoleApi("teacher_researcher");
}

export function contentRouteError(error: unknown): NextResponse {
  if (error instanceof ContentServiceError) {
    return jsonApiError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return jsonApiError(
      "validation_failed",
      "Request validation failed.",
      400,
      { issues: error.issues }
    );
  }

  console.error(error);

  return jsonApiError(
    "internal_error",
    "Content management request failed.",
    500
  );
}
