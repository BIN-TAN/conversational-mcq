import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { getServerEnv } from "@/lib/env";
import { TeacherReviewServiceError } from "./errors";

export async function requireTeacherReview() {
  return requireRoleApi("teacher_researcher");
}

export function canAccessTeacherReview(role: string) {
  return role === "teacher_researcher";
}

export function requireDevelopmentActiveSessionControls() {
  if (getServerEnv().DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED) {
    return null;
  }

  return jsonApiError(
    "active_session_controls_disabled",
    "Active-session controls are disabled for standard classroom use.",
    403
  );
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
