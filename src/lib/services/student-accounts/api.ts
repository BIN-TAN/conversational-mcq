import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { StudentAccountServiceError } from "./errors";

export function requireStudentAccountTeacher() {
  return requireRoleApi("teacher_researcher");
}

export function canAccessStudentAccountManagement(role: string) {
  return role === "teacher_researcher";
}

export function studentAccountRouteError(error: unknown): NextResponse {
  if (error instanceof StudentAccountServiceError) {
    return jsonApiError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return jsonApiError("validation_failed", "Request validation failed.", 400, {
      issues: error.issues
    });
  }

  console.error(error);

  return jsonApiError("internal_error", "Student account request failed.", 500);
}

export function queryObjectFromUrl(url: string) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}
