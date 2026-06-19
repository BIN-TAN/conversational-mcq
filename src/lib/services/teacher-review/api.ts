import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { TeacherReviewServiceError } from "./errors";

export async function requireTeacherReview() {
  return requireRoleApi("teacher_researcher");
}

export function canAccessTeacherReview(role: string) {
  return role === "teacher_researcher";
}

export function teacherReviewRouteError(error: unknown): NextResponse {
  if (error instanceof TeacherReviewServiceError) {
    return jsonApiError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return jsonApiError("validation_failed", "Request validation failed.", 400, {
      issues: error.issues
    });
  }

  console.error(error);

  return jsonApiError(
    "internal_error",
    "Teacher session-review request failed.",
    500
  );
}
