import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import type { AppRole } from "@/types/auth";
import { SummativeOutcomeServiceError } from "./errors";

export function canAccessSummativeOutcomeManagement(role: AppRole) {
  return role === "teacher_researcher";
}

export async function requireSummativeOutcomeTeacher() {
  return requireRoleApi("teacher_researcher");
}

export function summativeOutcomeRouteError(error: unknown): NextResponse {
  if (error instanceof SummativeOutcomeServiceError) {
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
    "Summative outcome request failed.",
    500
  );
}
